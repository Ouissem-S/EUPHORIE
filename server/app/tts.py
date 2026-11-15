"""Spoken stage text: ElevenLabs text-to-speech, generated once per line and cached on disk.

Setup (server/.env, never committed):
    ELEVENLABS_API_KEY=...
    ELEVENLABS_VOICE_ID=...   # the voice made in ElevenLabs Voice Design

The key stays on the server; phones only ever get the finished mp3.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "")
MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")

CACHE_DIR = Path(__file__).resolve().parents[1] / "tts_cache"
MAX_CHARS = 120  # stage lines are short; refuse anything else
MAX_NEW_PER_RUN = 300  # cap on paid generations per server run, against abuse of the open endpoint


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


# How the voice sounds. Change these in server/.env, then restart the server.
# Defaults: calm, measured "PA system" delivery, steady with little emotional swing.
VOICE_SETTINGS = {
    "speed": _num("VOICE_SPEED", 0.9),  # 0.7 (slowest) – 1.2 (fastest)
    "stability": _num("VOICE_STABILITY", 0.8),  # 0–1: higher = steadier, lower = more expressive
    "similarity_boost": _num("VOICE_SIMILARITY", 0.75),  # 0–1: how closely it sticks to the original voice
    "style": _num("VOICE_STYLE", 0.0),  # 0–1: more = more dramatic (and slower to generate)
    "use_speaker_boost": True,
}
# Part of every cached file's name, so changing a setting makes fresh audio instead of replaying old files.
SETTINGS_TAG = ",".join(f"{k}={v}" for k, v in sorted(VOICE_SETTINGS.items()))

_locks: dict[str, asyncio.Lock] = {}
_generated = 0


class TtsError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    return bool(API_KEY and VOICE_ID)


def _cache_path(text: str) -> Path:
    key = hashlib.sha1(f"{VOICE_ID}|{MODEL_ID}|{SETTINGS_TAG}|{text}".encode()).hexdigest()
    return CACHE_DIR / f"{key}.mp3"


async def speech_file(text: str) -> Path:
    """The mp3 for this line, generating it on first request."""
    global _generated
    text = text.strip()
    if not enabled():
        raise TtsError(503, "Voice not configured: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in server/.env")
    if not text or len(text) > MAX_CHARS:
        raise TtsError(400, f"Text must be 1–{MAX_CHARS} characters.")

    path = _cache_path(text)
    if path.exists():
        return path

    # Many phones ask for the same new line at once: generate it only once.
    lock = _locks.setdefault(path.name, asyncio.Lock())
    async with lock:
        if path.exists():
            return path
        if _generated >= MAX_NEW_PER_RUN:
            raise TtsError(429, "Voice generation limit reached for this run.")
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
                params={"output_format": "mp3_44100_128"},
                headers={"xi-api-key": API_KEY},
                json={"text": text, "model_id": MODEL_ID, "voice_settings": VOICE_SETTINGS},
            )
        if r.status_code != 200:
            raise TtsError(502, f"ElevenLabs error {r.status_code}: {r.text[:200]}")
        _generated += 1
        CACHE_DIR.mkdir(exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)  # atomic: never serve a half-written file
        return path
