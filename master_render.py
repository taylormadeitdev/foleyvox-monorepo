"""Generate chapter dialogue audio with edge-tts and mix locally available SFX."""
import asyncio
import os
import re
import subprocess
import tempfile
from pathlib import Path

import edge_tts

DEFAULT_VOICE = os.getenv("DEFAULT_TTS_VOICE", "en-GB-RyanNeural")
VOICE_MAP_DEFAULT = {
    "Narrator": DEFAULT_VOICE,
    "Female": "en-US-AriaNeural",
    "Male": "en-GB-RyanNeural",
    "Child": "en-US-AnaNeural",
}


def _safe_sfx_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")


def _run_ffmpeg(args: list[str]) -> None:
    subprocess.run(args, check=True, capture_output=True, text=True)


async def render_chapter(data: dict, output_mp3_path: str, sfx_dir: str = "sfx") -> str:
    script = data.get("script", [])
    voice_map = data.get("voice_map", {})
    char_voices = data.get("character_voices", {})
    canonical_cast = data.get("canonical_cast", {})
    if not script:
        raise ValueError("Chapter blueprint contains no script lines")

    output = Path(output_mp3_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="foleyvox-") as temp_dir:
        clips = []
        for index, line in enumerate(script):
            text = str(line.get("text") or "").strip()
            if not text:
                continue
            speaker = str(line.get("speaker") or "Narrator")
            voice = char_voices.get(speaker)
            if not voice and speaker in canonical_cast:
                voice = canonical_cast[speaker].get("voice_id")
            voice = voice or voice_map.get(speaker) or VOICE_MAP_DEFAULT.get(speaker) or DEFAULT_VOICE
            voice_path = os.path.join(temp_dir, f"voice_{index:04d}.mp3")
            await edge_tts.Communicate(text, voice, rate="-5%").save(voice_path)

            sound = str(line.get("sound") or "none")
            sfx_file = os.path.join(sfx_dir, _safe_sfx_name(sound) + ".mp3")
            if sound.lower() != "none" and os.path.isfile(sfx_file):
                mixed_path = os.path.join(temp_dir, f"mix_{index:04d}.mp3")
                _run_ffmpeg([
                    "ffmpeg", "-y", "-i", voice_path, "-i", sfx_file,
                    "-filter_complex",
                    "[0:a]loudnorm[voice];[1:a]volume=0.20[sfx];"
                    "[voice][sfx]amix=inputs=2:duration=first:dropout_transition=2[out]",
                    "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "4",
                    mixed_path, "-loglevel", "error",
                ])
                clips.append(mixed_path)
            else:
                clips.append(voice_path)

        if not clips:
            raise ValueError("No non-empty dialogue lines were rendered")

        concat_file = os.path.join(temp_dir, "concat.txt")
        with open(concat_file, "w", encoding="utf-8") as handle:
            for clip in clips:
                escaped = clip.replace("'", "'\\''")
                handle.write(f"file '{escaped}'\n")

        _run_ffmpeg([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_file, "-c:a", "libmp3lame", "-q:a", "4",
            str(output), "-loglevel", "error",
        ])
    return str(output)


def render_chapter_sync(data: dict, output_mp3_path: str, sfx_dir: str = "sfx") -> str:
    return asyncio.run(render_chapter(data, output_mp3_path, sfx_dir))
