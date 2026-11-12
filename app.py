"""Authenticated Flask API for the FoleyVox React/Floot frontend."""
import os
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from supabase import create_client
import edge_tts
import asyncio

app = Flask(__name__)
CORS(app, origins="*")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)
SIGNED_URL_SECONDS = int(os.getenv("SIGNED_URL_SECONDS", "3600"))


def current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        return supabase.auth.get_user(auth.split(" ", 1)[1]).user
    except Exception:
        return None


def owned_project(user, project_id):
    result = (supabase.table("projects").select("id")
              .eq("id", project_id).eq("user_id", user.id).limit(1).execute())
    return bool(result.data)


def auth_error():
    return jsonify({"error": "Unauthorized"}), 401


@app.get("/health")
def health():
    return jsonify({"status": "healthy", "service": "foleyvox-api"})


@app.post("/api/clone-demo")
def clone_demo():
    user = current_user()
    if not user:
        return auth_error()

    demo_project_id = os.environ.get("DEMO_PROJECT_ID")
    if not demo_project_id:
        return jsonify({"error": "Demo project is not configured"}), 500

    demo_result = (supabase.table("projects").select("*")
                   .eq("id", demo_project_id).limit(1).execute())
    if not demo_result.data:
        return jsonify({"error": "Demo project not found"}), 404
    demo_project = demo_result.data[0]

    demo_chapters = (supabase.table("chapters").select("*")
                     .eq("project_id", demo_project_id)
                     .order("chapter_number").execute().data)

    project_result = supabase.table("projects").insert({
        "user_id": user.id,
        "title": f"Demo: {demo_project.get('title') or 'Story'}",
        "status": "ready",
        "manuscript_path": demo_project.get("manuscript_path"),
    }).execute()
    if not project_result.data:
        return jsonify({"error": "Could not create demo project"}), 500
    new_project_id = project_result.data[0].get("id")
    if not new_project_id:
        return jsonify({"error": "Could not identify the new demo project"}), 500

    chapter_records = [{
        "project_id": new_project_id,
        "chapter_number": chapter["chapter_number"],
        "title": chapter.get("title"),
        "status": "awaiting_review",
        "json_blueprint": chapter.get("json_blueprint"),
        "audio_path": None,
        "audio_url": None,
    } for chapter in demo_chapters]
    if chapter_records:
        supabase.table("chapters").insert(chapter_records).execute()

    return jsonify({"project_id": new_project_id})


@app.post("/api/upload")
def queue_upload():
    user = current_user()
    if not user:
        return auth_error()
    body = request.get_json(silent=True) or {}
    project_id = body.get("project_id")
    manuscript_path = body.get("manuscript_path")
    if not project_id or not manuscript_path:
        return jsonify({"error": "project_id and manuscript_path are required"}), 400
    if not owned_project(user, project_id):
        return jsonify({"error": "Project not found"}), 404
    if not manuscript_path.startswith(f"{user.id}/{project_id}/"):
        return jsonify({"error": "Invalid manuscript storage path"}), 400
    supabase.table("projects").update({
        "manuscript_path": manuscript_path,
        "status": "queued",
        "error_message": None,
    }).eq("id", project_id).execute()
    return jsonify({"status": "queued", "project_id": project_id}), 202


@app.get("/api/projects/<project_id>")
def get_project(project_id):
    user = current_user()
    if not user:
        return auth_error()
    if not owned_project(user, project_id):
        return jsonify({"error": "Project not found"}), 404
    project = supabase.table("projects").select("*").eq("id", project_id).single().execute().data
    chapters = (supabase.table("chapters").select("*")
                .eq("project_id", project_id).order("chapter_number").execute().data)
    for chapter in chapters:
        path = chapter.get("audio_path")
        if path and chapter.get("status") == "ready":
            try:
                signed = supabase.storage.from_("renders").create_signed_url(path, SIGNED_URL_SECONDS)
                chapter["audio_url"] = signed.get("signedURL") or signed.get("signedUrl")
            except Exception:
                chapter["audio_url"] = None
    return jsonify({"project": project, "chapters": chapters})


@app.get("/api/studio/<project_id>/<int:chapter_num>")
def get_studio_data(project_id, chapter_num):
    user = current_user()
    if not user:
        return auth_error()
    if not owned_project(user, project_id):
        return jsonify({"error": "Project not found"}), 404
    result = (supabase.table("chapters").select("*")
              .eq("project_id", project_id)
              .eq("chapter_number", chapter_num).limit(1).execute())
    if not result.data:
        return jsonify({"error": "Chapter not found"}), 404
    chapter = result.data[0]
    path = chapter.get("audio_path")
    if path:
        try:
            signed = supabase.storage.from_("renders").create_signed_url(path, SIGNED_URL_SECONDS)
            chapter["audio_url"] = signed.get("signedURL") or signed.get("signedUrl")
        except Exception:
            chapter["audio_url"] = None
    return jsonify(chapter)


@app.delete("/api/projects/<project_id>")
def delete_project(project_id):
    user = current_user()
    if not user:
        return auth_error()

    try:
        project_result = (supabase.table("projects").select("id,manuscript_path")
                          .eq("id", project_id).eq("user_id", user.id).limit(1).execute())
        if not project_result.data:
            return jsonify({"error": "Project not found"}), 404
        project = project_result.data[0]
        chapter_result = (supabase.table("chapters").select("audio_path")
                          .eq("project_id", project_id).execute())

        owned_path_prefix = f"{user.id}/{project_id}/"
        manuscript_path = project.get("manuscript_path")
        manuscript_paths = ([manuscript_path] if isinstance(manuscript_path, str)
                            and manuscript_path.startswith(owned_path_prefix) else [])
        render_paths = [
            chapter["audio_path"] for chapter in chapter_result.data or []
            if isinstance(chapter.get("audio_path"), str)
            and chapter["audio_path"].startswith(owned_path_prefix)
        ]

        supabase.table("chapters").delete().eq("project_id", project_id).execute()
        supabase.table("projects").delete().eq("id", project_id).eq("user_id", user.id).execute()
    except Exception as exc:
        app.logger.exception("Could not delete project %s", project_id)
        return jsonify({"error": f"Failed to delete project: {exc}"}), 500

    storage_cleanup_errors = []
    for bucket, paths in (("manuscripts", manuscript_paths), ("renders", render_paths)):
        if not paths:
            continue
        try:
            supabase.storage.from_(bucket).remove(paths)
        except Exception:
            app.logger.exception("Could not clean up project files in the %s bucket", bucket)
            storage_cleanup_errors.append(bucket)

    return jsonify({
        "status": "deleted",
        "project_id": project_id,
        "storage_cleanup_errors": storage_cleanup_errors,
    })


@app.post("/api/rerender")
def rerender():
    user = current_user()
    if not user:
        return auth_error()
    body = request.get_json(silent=True) or {}
    project_id, number = body.get("project_id"), body.get("chapter_number")
    if not project_id or not isinstance(number, int):
        return jsonify({"error": "project_id and integer chapter_number are required"}), 400
    if not owned_project(user, project_id):
        return jsonify({"error": "Project not found"}), 404
    updated = (supabase.table("chapters").update({"status": "pending", "error_message": None})
               .eq("project_id", project_id).eq("chapter_number", number).execute())
    if not updated.data:
        return jsonify({"error": "Chapter not found"}), 404
    return jsonify({"status": "queued"}), 202


@app.post("/api/preview_voice")
def preview_voice():
    user = current_user()
    if not user:
        return auth_error()
    body = request.get_json(silent=True) or {}
    voice = str(body.get("voice") or "en-US-AriaNeural")
    text = str(body.get("text") or "").strip()
    if not text or len(text) > 500:
        return jsonify({"error": "Preview text must contain 1-500 characters"}), 400
    # Restrict voice identifiers to Microsoft's standard locale-voice format.
    import re
    if not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z0-9]+Neural", voice):
        return jsonify({"error": "Invalid voice identifier"}), 400
    temp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    temp.close()
    async def generate():
        await edge_tts.Communicate(text, voice).save(temp.name)
    try:
        asyncio.run(generate())
        response = send_file(temp.name, mimetype="audio/mpeg", as_attachment=False)
        response.call_on_close(lambda: Path(temp.name).unlink(missing_ok=True))
        return response
    except Exception:
        Path(temp.name).unlink(missing_ok=True)
        app.logger.exception("Voice preview failed")
        return jsonify({"error": "Voice preview failed"}), 502

import threading
from worker import main as worker_main

# Start the worker thread when the module is imported
def start_worker_thread():
    print("Starting background worker thread...")
    worker_main()

# Only start the thread if we are running as a web server (not in a separate test script)
if os.environ.get("WERKZEUG_RUN_MAIN") != "true" or os.environ.get("RENDER"):
    worker_thread = threading.Thread(target=start_worker_thread, daemon=True)
    worker_thread.start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
