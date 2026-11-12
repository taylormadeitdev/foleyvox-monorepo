"""Merge duplicate character names across chapter-level cast dictionaries."""
import json
from typing import Any
from preflight import _gemini, _extract_json


def deduplicate(characters_dict: dict[str, Any]) -> dict[str, Any]:
    if not characters_dict:
        return {}
    prompt = f"""
You are a careful audiobook casting editor. Merge only clearly identical
characters (for example, "Dev" and "Dev Malik"). Do not merge different
people who share a first name. Standardize each character's canonical name.
Return ONLY valid JSON object mapping canonical character names to objects
with keys "gender" (Male, Female, Disembodied, or Unknown) and "aliases"
(array of names/aliases). Do not infer gender from name alone; use textual
evidence and choose Unknown when unclear.
Characters to reconcile:
{json.dumps(characters_dict, ensure_ascii=False)}
"""
    result = _extract_json(_gemini(prompt))
    cleaned = {}
    for name, value in result.items():
        if isinstance(value, str):
            value = {"gender": value, "aliases": []}
        if not isinstance(value, dict):
            continue
        cleaned[str(name)] = {
            "gender": str(value.get("gender", "Unknown")),
            "aliases": value.get("aliases", []) if isinstance(value.get("aliases", []), list) else [],
        }
    return cleaned
