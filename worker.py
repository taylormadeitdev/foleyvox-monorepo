"""Single-instance Supabase polling worker for manuscript and re-render jobs."""
import logging
import os
import signal
import tempfile
import time
from pathlib import Path

from supabase import create_client
from preflight import split_chapters, generate_blueprint
from deduplicate import deduplicate
from master_render import render_chapter_sync
from sfx_downloader import download_missing_sfx

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("foleyvox-worker")
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
POLL_SECONDS = int(os.getenv("WORKER_POLL_SECONDS", "8"))
RUNNING = True


def stop(*_):
    global RUNNING
    log.info("Shutdown requested; finishing current job before exit.")
    RUNNING = False


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def update_project(project_id, **values):
    supabase.table("projects").update(values).eq("id", project_id).execute()


def update_chapter(chapter_id, **values):
    supabase.table("chapters").update(values).eq("id", chapter_id).execute()


def process_project(project):
    project_id = project["id"]
    user_id = project["user_id"]
    path = project.get("manuscript_path")
    api_keys = [
        key.strip()
        for key in (
            project.get("gemini_api_key_1"),
            project.get("gemini_api_key_2"),
            project.get("gemini_api_key_3"),
        )
        if key and key.strip()
    ]
    if not path:
        raise ValueError("Project has no manuscript_path")
    log.info("Starting manuscript project %s", project_id)
    update_project(project_id, status="processing", error_message=None)

    raw = supabase.storage.from_("manuscripts").download(path)
    manuscript = raw.decode("utf-8-sig")
    chapters = split_chapters(manuscript)
    if not chapters:
        raise ValueError("No manuscript text or chapters found")

    all_cast = {}
    chapter_records = []
    for number, chapter in enumerate(chapters, start=1):
        log.info("Analyzing project %s chapter %s", project_id, number)
        blueprint = generate_blueprint(
            chapter["text"], chapter["title"], api_keys=api_keys
        )
            
        for name, voice_type in blueprint.get("cast", {}).items():
            all_cast[str(name)] = str(voice_type)
        chapter_records.append({
            "project_id": project_id,
            "chapter_number": number,
            "title": chapter["title"],
            "status": "awaiting_review",
            "json_blueprint": blueprint,
            "audio_url": None,
            "audio_path": None,
        })

    cast_clean = deduplicate(all_cast) if all_cast else {}
    
    for record in chapter_records:
        record["json_blueprint"]["canonical_cast"] = cast_clean
        supabase.table("chapters").upsert(
            record, on_conflict="project_id,chapter_number"
        ).execute()

    update_project(project_id, status="ready", error_message=None)
    log.info("Project %s analysis completed. Awaiting user review and render request.", project_id)


def render_one_chapter(chapter, user_id):
    chapter_id = chapter["id"]
    project_id = chapter["project_id"]
    number = chapter["chapter_number"]
    update_chapter(chapter_id, status="rendering", error_message=None)
    try:
        blueprint = chapter.get("json_blueprint") or {}
        
        if blueprint.get("sfx_list"):
            download_missing_sfx(blueprint["sfx_list"])
            
        with tempfile.TemporaryDirectory(prefix="foleyvox-render-") as tmp:
            output = str(Path(tmp) / f"chapter_{number:03d}.mp3")
            render_chapter_sync(blueprint, output, sfx_dir="sfx")
            duration = None
            import subprocess
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", output],
                capture_output=True, text=True, check=False,
            )
            if probe.returncode == 0:
                try:
                    duration = float(probe.stdout.strip())
                except ValueError:
                    pass
            storage_path = f"{user_id}/{project_id}/chapter_{number:03d}.mp3"
            with open(output, "rb") as audio:
                supabase.storage.from_("renders").upload(
                    storage_path, audio.read(),
                    {"content-type": "audio/mpeg", "upsert": "true"},
                )
        update_chapter(
            chapter_id, status="ready", audio_path=storage_path,
            audio_url=None, duration_seconds=duration, error_message=None,
        )
        log.info("Rendered project %s chapter %s", project_id, number)
    except Exception as exc:
        log.exception("Chapter render failed: %s", chapter_id)
        update_chapter(chapter_id, status="failed", error_message=str(exc)[:2000])
        raise


def process_pending_renders():
    pending = (supabase.table("chapters").select("*")
               .eq("status", "pending").order("chapter_number").limit(1).execute().data)
    if pending:
        chapter = pending[0]
        project = (supabase.table("projects").select("user_id,status")
                   .eq("id", chapter["project_id"]).limit(1).execute().data)
        if project:
            render_one_chapter(chapter, project[0]["user_id"])
            return True
    return False


def process_queued_project():
    queued = (supabase.table("projects").select("*")
              .eq("status", "queued").order("created_at").limit(1).execute().data)
    if queued:
        project = queued[0]
        try:
            process_project(project)
        except Exception as exc:
            error_message = str(exc).strip() or type(exc).__name__
            log.exception(
                "Project processing failed; marking %s as failed: %s",
                project["id"], error_message,
            )
            update_project(
                project["id"], status="failed", error_message=error_message[:2000]
            )
        return True
    return False


def main():
    log.info("FoleyVox worker started; polling every %ss", POLL_SECONDS)
    while RUNNING:
        try:
            did_work = process_queued_project()
            if not did_work:
                did_work = process_pending_renders()
            if not did_work:
                time.sleep(POLL_SECONDS)
        except Exception:
            log.exception("Worker loop error")
            time.sleep(max(POLL_SECONDS, 10))
    log.info("Worker stopped cleanly")


if __name__ == "__main__":
    main()
