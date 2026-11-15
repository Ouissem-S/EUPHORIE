"""AI lighting designer: Gemini watches the concert video (picture + sound) and writes cues.

Config (server/.env): GEMINI_API_KEY, optional GEMINI_MODEL. Output: web/public/cues/ai.json
(merged over the hand-made show.json by the web app); raw reply in app/analysis_raw.json.
CLI: python -m app.analyse --from 97 --to 280
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
OUT = ROOT / "web" / "public" / "cues" / "ai.json"
RAW = Path(__file__).resolve().parent / "analysis_raw.json"
EFFECTS = {"cut", "fade", "pulse", "flash", "strobe"}
MAX_STROBE_BPM = 180  # 3 flashes a second (photosensitivity)
FPS = 2  # frames Gemini looks at per second: enough to catch light changes
TIMEOUT_S = 6 * 60  # give up on Gemini after this long


def video_url() -> str:
    """The show's YouTube video, from VIDEO_ID in web/src/config.ts."""
    m = re.search(r'VIDEO_ID\s*=\s*"([\w-]+)"', (ROOT / "web" / "src" / "config.ts").read_text())
    if not m:
        raise RuntimeError("VIDEO_ID not found in web/src/config.ts")
    return f"https://www.youtube.com/watch?v={m.group(1)}"


def mmss(s: float) -> str:
    return f"{int(s) // 60:02d}:{int(s) % 60:02d}"


PROMPT = """You are a concert lighting designer. Watch this concert video from {start} to {end}, using both picture and sound.
Return ONLY JSON: an array of cues, each {{ "t": seconds from the START OF THE FULL VIDEO, not the clip
(the clip starts at {start_s:g} s) (number, 0.5 s precision),
"colour": "#rrggbb" — the dominant colour of the STAGE LIGHTS (not the crowd), saturated,
"effect": "cut" | "fade" | "pulse" | "flash" | "strobe",
"bpm": tempo of the music at that point (number, only when effect is pulse),
"crowd": optional "cheer" | "roar" when the crowd audibly reacts,
"note": very short reason }}.
Add a cue at every visible lighting change, at every big musical moment (drop, chorus start, big hit) use "flash",
during steady sections use "pulse" with the song's bpm. Blackouts: colour #000000 with "fade".
Between 15 and 60 cues. Times must be inside the range."""


def clean(raw: list, start_s: float, end_s: float) -> list[dict]:
    """Keep only valid cues; fix times given relative to the clip instead of the video."""
    items = [c for c in raw if isinstance(c, dict) and isinstance(c.get("t"), (int, float))]
    if items and all(c["t"] < end_s - start_s for c in items):  # answered in clip time
        for c in items:
            c["t"] += start_s
    cues: dict[float, dict] = {}
    for c in items:
        t = round(float(c["t"]) * 2) / 2
        colour = str(c.get("colour", "")).lower()
        if not (start_s <= t <= end_s and re.fullmatch(r"#[0-9a-f]{6}", colour)):
            continue
        effect = c.get("effect") if c.get("effect") in EFFECTS else "cut"
        cue: dict = {"t": t, "colour": colour, "effect": effect}
        bpm = c.get("bpm")
        if isinstance(bpm, (int, float)) and not isinstance(bpm, bool):
            if effect == "pulse" and 40 <= bpm <= 240:
                cue["bpm"] = float(bpm)
            elif effect == "strobe" and bpm > 0:
                cue["bpm"] = min(float(bpm), MAX_STROBE_BPM)  # never more than 3 flashes a second
        if c.get("crowd") in ("cheer", "roar"):
            cue["crowd"] = c["crowd"]
        if c.get("note"):
            cue["note"] = str(c["note"])[:80]
        cues[t] = cue  # one cue per time: the last one wins
    return sorted(cues.values(), key=lambda c: c["t"])


async def analyse(video: str, start_s: float, end_s: float) -> list[dict]:
    if not API_KEY:
        raise RuntimeError("Set GEMINI_API_KEY in server/.env")
    from google import genai  # imported here so the server starts without the SDK
    from google.genai import types

    client = genai.Client(api_key=API_KEY)
    clip = types.Part(
        file_data=types.FileData(file_uri=video),
        video_metadata=types.VideoMetadata(start_offset=f"{start_s:g}s", end_offset=f"{end_s:g}s", fps=FPS),
    )
    label = f"{int(start_s) // 60}:{int(start_s) % 60:02d}–{int(end_s) // 60}:{int(end_s) % 60:02d}"
    print(f"Sending to Gemini (clip {label})…", end="", flush=True)

    async def dots() -> None:
        while True:
            await asyncio.sleep(10)
            print(".", end="", flush=True)

    ticker = asyncio.create_task(dots())
    began = time.monotonic()
    try:
        reply = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=MODEL,
                contents=[clip, PROMPT.format(start=mmss(start_s), end=mmss(end_s), start_s=start_s)],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            ),
            timeout=TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        msg = f"Gemini did not answer within {TIMEOUT_S // 60} min — gave up. Try a shorter range."
        print(f"\n{msg}", flush=True)
        raise RuntimeError(msg) from None
    finally:
        ticker.cancel()
    print(f"\nDone in {time.monotonic() - began:.0f} s", flush=True)
    text = reply.text or "[]"
    RAW.write_text(text)
    data = json.loads(text)
    cues = clean(data if isinstance(data, list) else data.get("cues", []), start_s, end_s)
    if not cues:
        raise RuntimeError("Gemini returned no usable cues (see app/analysis_raw.json)")
    OUT.write_text(json.dumps(cues, indent=1) + "\n")
    return cues


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Generate stage-light cues from the concert video with Gemini.")
    ap.add_argument("--from", dest="start", type=float, default=97)
    ap.add_argument("--to", dest="end", type=float, default=280)
    args = ap.parse_args()
    result = asyncio.run(analyse(video_url(), args.start, args.end))
    print(f"{len(result)} cues → {OUT.relative_to(ROOT)}")
