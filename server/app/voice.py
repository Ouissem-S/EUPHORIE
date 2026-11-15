"""Host voice: ElevenLabs speech WITH per-letter timings, so the TV can type in sync with it.

Config (env vars, or server/.env): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, optional
ELEVENLABS_MODEL_ID. Voice settings (VOICE_SPEED etc.) are shared with tts.py. The key never leaves the server; browsers only get the cached mp3.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

# One set of voice settings for every spoken line (VOICE_* in server/.env), see tts.py.
from .tts import SETTINGS_TAG, VOICE_SETTINGS

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "")
MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID", "")



CACHE_DIR = Path(__file__).resolve().parent / "voice_cache"
URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps"


def cache_key(text: str) -> str:
    return hashlib.sha1(f"{VOICE_ID}|{MODEL_ID}|{SETTINGS_TAG}|{text}".encode()).hexdigest()


def audio_path(voice_id: str) -> Path:
    return CACHE_DIR / f"{voice_id}.mp3"


def _result(key: str, text: str, alignment: dict) -> dict:
    ends = alignment.get("character_end_times_seconds") or [0]
    return {
        "id": key,
        "text": text,
        "letter_times": alignment.get("character_start_times_seconds") or [],
        "duration": ends[-1],
    }


async def synthesize(text: str) -> dict | None:
    """Speech + letter timings for `text` (cached on disk). None if not configured or on any error."""
    text = text.strip()
    if not (API_KEY and VOICE_ID and text):
        return None
    key = cache_key(text)
    mp3, meta = audio_path(key), CACHE_DIR / f"{key}.json"
    if mp3.exists() and meta.exists():
        return _result(key, text, json.loads(meta.read_text()))

    body: dict = {"text": text, "voice_settings": VOICE_SETTINGS}
    if MODEL_ID:
        body["model_id"] = MODEL_ID
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            post = lambda b: client.post(  # noqa: E731
                URL.format(voice=VOICE_ID),
                headers={"xi-api-key": API_KEY, "Content-Type": "application/json"},
                json=b,
            )
            r = await post(body)
            if r.status_code in (400, 422):
                # Some models reject "speed": try once without it.
                settings = {k: v for k, v in VOICE_SETTINGS.items() if k != "speed"}
                r = await post({**body, "voice_settings": settings})
        r.raise_for_status()
        data = r.json()
        audio = base64.b64decode(data["audio_base64"])
        alignment = data.get("alignment") or {}
    except Exception:
        return None

    CACHE_DIR.mkdir(exist_ok=True)
    mp3.write_bytes(audio)
    meta.write_text(json.dumps(alignment))
    return _result(key, text, alignment)
