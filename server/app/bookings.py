"""Ticket bookings per home code (app/bookings.json), loaded once at startup."""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_TICKETS = 1

try:
    _BOOKINGS: dict[str, dict] = json.loads((Path(__file__).with_name("bookings.json")).read_text())
except (OSError, json.JSONDecodeError):
    _BOOKINGS = {}


def get_booking(code: str) -> dict:
    """{name, tickets} for a home code; unknown codes get a default booking so testing never breaks."""
    b = _BOOKINGS.get(code.upper())
    if not b:
        return {"name": code, "tickets": DEFAULT_TICKETS}
    return {"name": str(b.get("name", code)), "tickets": int(b.get("tickets", DEFAULT_TICKETS))}
