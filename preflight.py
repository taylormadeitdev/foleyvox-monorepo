"""Manuscript parsing and Gemini chapter blueprint generation."""
import json
import os
import re
import time
from typing import Any
import requests

# THE KEY ROTATOR SETUP
GEMINI_API_KEYS = [
    os.environ.get("GEMINI_API_KEY_1"),
    os.environ.get("GEMINI_API_KEY_2"),
    os.environ.get("GEMINI_API_KEY_3")
]
GEMINI_API_KEYS = [k for k in GEMINI_API_KEYS if k] # Remove empty ones

# The valid models for new Google Cloud accounts
VALID_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite"
]

MAX_CHAPTER_CHARS = int(os.environ.get("MAX_CHAPTER_CHARS", "15000"))

def split_chapters(text: str) -> list[dict[str, str]]:
    """Split Markdown/plain text by headings like '# Chapter 1: ...'."""
    pattern = re.compile(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:\[?\s*)"
        r"(?:chapter|prologue|epilogue)\b[^\r\n]*"
    )
    matches = list(pattern.finditer(text))
    if not matches:
        return [{"title": "Chapter 1", "text": text.strip()}] if text.strip() else []

    chapters = []
    if text[:matches[0].start()].strip():
        chapters.append({"title": "Introduction", "text": text[:matches[0].start()].strip()})
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        chunk = text[match.start():end].strip()
        title = match.group(0).strip().lstrip("#").strip()
        if chunk:
            chapters.append({"title": title[:180], "text": chunk})
    return chapters

def _extract_json(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
    raw = re.sub(r"\s*```$", "", raw)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Gemini did not return a JSON object")
    result = json.loads(raw[start:end + 1])
    if not isinstance(result, dict):
        raise ValueError("Blueprint must be a JSON object")
    return result

def _gemini(prompt: str, api_key: str | None = None) -> str:
    """The Key Rotator: Tries every model/key combination until one works."""
    project_api_key = api_key.strip() if api_key else ""
    keys = [project_api_key] if project_api_key else [
        os.getenv("GEMINI_API_KEY"), *GEMINI_API_KEYS
    ]
    keys = [key for key in keys if key]
    if not keys:
        raise RuntimeError("No Gemini API keys configured")

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }

    for model in VALID_MODELS:
        for key in keys:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            try:
                print(f" [API] Trying {model} with key ending in {key[-4:]}")
                response = requests.post(url, json=payload, timeout=45)
                
                if response.status_code in [404, 429, 503]:
                    print(f"    [API] Failed: {response.status_code}. Trying next...")
                    time.sleep(2)
                    continue
                    
                response.raise_for_status()
                result = response.json()
                return result["candidates"][0]["content"]["parts"][0]["text"]

            except Exception as e:
                safe_error = str(e).replace(key, "[REDACTED]")
                print(f" [API] Timeout or error: {safe_error}")
                time.sleep(2)
                
    raise RuntimeError("All API keys and models failed.")

def generate_blueprint(
    chapter_text: str, chapter_title: str, api_key: str | None = None
) -> dict[str, Any]:
    safe_text = chapter_text[:MAX_CHAPTER_CHARS]
    prompt = f"""
You are an expert audio-drama director. Convert the supplied chapter into a
production blueprint. Return JSON only, with exactly these keys:
"cast" (object mapping every speaking character to a concise voice type:
Male, Female, Child, or Disembodied; use Narrator for narration).
CRITICAL INSTRUCTION: You must deduce the gender of every character based on their name, pronouns used in the text, or dialogue context. If a character is male (e.g., Elias), you MUST assign 'Male'. If female (e.g., Mara), you MUST assign 'Female'. Do not guess randomly. If unclear, assign 'Disembodied'.
"sfx_list" (array of concise, unique sound-effect descriptions),
"script" (ordered array of objects with speaker, text, sound, tone).
Every script line must have all four fields. Use sound="none" when no effect
is needed. Preserve the story and dialogue; do not invent plot. Include
narration for descriptive passages. Do not invent dialogue for silent
characters. Empty arrays are acceptable only when genuinely appropriate.
Chapter title: {chapter_title}
CHAPTER:
{safe_text}
"""
    data = _extract_json(_gemini(prompt, api_key))
    data.setdefault("cast", {})
    data.setdefault("sfx_list", [])
    data.setdefault("script", [])
    if not isinstance(data["cast"], dict) or not isinstance(data["sfx_list"], list) or not isinstance(data["script"], list):
        raise ValueError("Gemini blueprint has invalid cast/sfx_list/script types")
    normalized = []
    for item in data["script"]:
        if not isinstance(item, dict):
            continue
        normalized.append({
            "speaker": str(item.get("speaker") or "Narrator")[:120],
            "text": str(item.get("text") or ""),
            "sound": str(item.get("sound") or "none")[:180],
            "tone": str(item.get("tone") or "neutral")[:120],
        })
    data["script"] = normalized
    return data

def process_book(filepath: str) -> list[dict[str, Any]]:
    """Local helper retained for testing; cloud worker persists results itself."""
    with open(filepath, "r", encoding="utf-8") as handle:
        text = handle.read()
    results = []
    for number, chapter in enumerate(split_chapters(text), start=1):
        blueprint = generate_blueprint(chapter["text"], chapter["title"])
        results.append({
            "chapter_number": number,
            "title": chapter["title"],
            "json_blueprint": blueprint,
        })
    return results
