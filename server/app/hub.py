"""Shared state for every connected home, plus the show schedule.

A home is one TV/laptop plus the phones in that room. Each home has its own
playback position, but the crowd (presence, cheers, encore vote) and the
show schedule are shared by everyone.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import time
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket

from .errors import Close, JoinError, error_msg

GESTURES = {"clap", "scream", "sway"}
BLOCS = ["A", "B", "C", "D", "E"]
CROWD_TICK_S = 0.2
FINAL_COUNTDOWN_MS = 10_000

# Only the person with this key can control the show:
#   EUPHORIE_KEY=my-secret uvicorn app.main:app --port 8000
CONTROL_KEY = os.environ.get("EUPHORIE_KEY", "change-me")

KNOWN_TYPES = {"ping", "position", "gesture", "vote", "set_time", "approve", "reset", "vote_open", "vote_close"}


def now_ms() -> float:
    return time.time() * 1000


@dataclass(eq=False)
class Client:
    ws: WebSocket
    role: str  # "tv" | "phone" | "control"
    home_id: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    seat: dict | None = None


@dataclass
class Home:
    id: str
    clients: set[Client] = field(default_factory=set)
    last_position: dict | None = None
    pending: dict[str, int] = field(default_factory=lambda: {g: 0 for g in GESTURES})
    totals: dict[str, int] = field(default_factory=lambda: {g: 0 for g in GESTURES})

    def phones(self) -> list[Client]:
        return [c for c in self.clients if c.role == "phone"]


class Hub:
    def __init__(self, vote_threshold: float = 0.6) -> None:
        self.homes: dict[str, Home] = {}
        self.controls: set[Client] = set()
        # encore vote
        self.vote_threshold = vote_threshold
        self.vote_open = False
        self.votes: set[str] = set()
        self.unlocked = False
        # show schedule (server time, ms)
        self.starts_at: float | None = None
        self.approved = False
        self.go_at: float | None = None

    # ---------- connection lifecycle ----------

    async def join(self, ws: WebSocket, home_id: str, role: str) -> Client:
        existing = self.homes.get(home_id)
        has_tv = existing is not None and any(c.role == "tv" for c in existing.clients)

        # A phone can only join a home whose TV is running (stale QR code otherwise).
        if role != "tv" and not has_tv:
            raise JoinError(Close.HOME_NOT_FOUND)

        # A new TV for the same home replaces the old one (e.g. opened on another screen).
        if role == "tv" and existing:
            for old in [c for c in existing.clients if c.role == "tv"]:
                existing.clients.discard(old)
                try:
                    await old.ws.close(code=Close.CONFLICT)
                except Exception:
                    pass

        home = self.homes.setdefault(home_id, Home(home_id))
        client = Client(ws=ws, role="tv" if role == "tv" else "phone", home_id=home_id)
        if client.role == "phone":
            client.seat = {
                "bloc": random.choice(BLOCS),
                "rang": random.randint(1, 30),
                "place": random.randint(1, 40),
            }
        home.clients.add(client)

        await self.send(client, {"type": "welcome", "id": client.id, "home": home_id, "seat": client.seat})
        await self.send(client, self.schedule())
        if client.role == "phone" and home.last_position:
            await self.send(client, home.last_position)
        await self.send(client, self.vote_state())
        await self.broadcast_presence()
        return client

    async def join_control(self, ws: WebSocket) -> Client:
        client = Client(ws=ws, role="control", home_id="")
        self.controls.add(client)
        await self.send(client, self.schedule())
        await self.send(client, self.presence())
        await self.send(client, self.vote_state())
        return client

    async def leave(self, client: Client) -> None:
        if client.role == "control":
            self.controls.discard(client)
            return
        home = self.homes.get(client.home_id)
        if home:
            home.clients.discard(client)
            if not home.clients:
                self.homes.pop(client.home_id, None)
        self.votes.discard(client.id)
        await self.broadcast_presence()

    # ---------- messages from TVs and phones ----------

    async def handle(self, client: Client, msg: dict) -> None:
        kind = msg.get("type")

        if kind not in KNOWN_TYPES:
            await self.send(client, error_msg("unknown_type", f"Unknown message type: {kind}"))
            return

        if kind == "ping":
            await self.send(client, {"type": "pong", "t0": msg.get("t0"), "ts": now_ms()})
            return

        if client.role == "control":
            await self.handle_control(client, msg)
            return

        home = self.homes.get(client.home_id)
        if home is None:
            return

        if kind == "position" and client.role == "tv":
            out = {
                "type": "position",
                "video_time": float(msg.get("video_time", 0)),
                "at": float(msg.get("at", now_ms())),
                "playing": bool(msg.get("playing", False)),
            }
            home.last_position = out
            await self.broadcast_home(home, out, role="phone")

        elif kind == "gesture" and client.role == "phone":
            g = msg.get("kind")
            if g in GESTURES:
                home.pending[g] += 1
                home.totals[g] += 1

        elif kind == "vote" and client.role == "phone" and self.vote_open:
            self.votes.add(client.id)
            if len(self.votes) >= self.votes_needed():
                self.unlocked, self.vote_open = True, False
            await self.broadcast_all(self.vote_state())

    # ---------- messages from your control phone only ----------

    async def handle_control(self, client: Client, msg: dict) -> None:
        kind = msg.get("type")

        if kind == "set_time":
            self.starts_at = float(msg["starts_at"])
            self.approved, self.go_at = False, None

        elif kind == "approve":
            self.approved = True
            # Never start before the published time; always give a 10 s final countdown.
            self.go_at = max(self.starts_at or 0, now_ms() + FINAL_COUNTDOWN_MS)

        elif kind == "reset":
            self.approved, self.go_at = False, None

        elif kind == "vote_open":
            self.vote_open, self.votes, self.unlocked = True, set(), False
            await self.broadcast_all(self.vote_state())
            return

        elif kind == "vote_close":
            self.vote_open = False
            await self.broadcast_all(self.vote_state())
            return

        else:
            return

        await self.broadcast_all(self.schedule())

    # ---------- crowd relay ----------

    async def crowd_tick(self) -> None:
        """Send each home the gestures made in other homes since the last tick."""
        homes = list(self.homes.values())
        everyone = {g: sum(h.pending[g] for h in homes) for g in GESTURES}
        if any(everyone.values()):
            for home in homes:
                others = {g: everyone[g] - home.pending[g] for g in GESTURES}
                await self.broadcast_home(
                    home, {"type": "crowd", "others": others, "own": dict(home.pending), "totals": dict(home.totals)}
                )
        for home in homes:
            home.pending = {g: 0 for g in GESTURES}

    async def run_crowd_ticker(self) -> None:
        while True:
            await asyncio.sleep(CROWD_TICK_S)
            try:
                await self.crowd_tick()
            except Exception:  # never let the ticker die mid-show
                pass

    # ---------- state messages ----------

    def schedule(self) -> dict:
        return {"type": "schedule", "starts_at": self.starts_at, "approved": self.approved, "go_at": self.go_at}

    def presence(self) -> dict:
        homes = sum(1 for h in self.homes.values() if h.clients)
        return {"type": "presence", "homes": homes, "phones": self.phone_count()}

    def phone_count(self) -> int:
        return sum(len(h.phones()) for h in self.homes.values())

    def votes_needed(self) -> int:
        return max(1, round(self.phone_count() * self.vote_threshold))

    def vote_state(self) -> dict:
        return {
            "type": "vote_state",
            "open": self.vote_open,
            "yes": len(self.votes),
            "needed": self.votes_needed(),
            "unlocked": self.unlocked,
        }

    # ---------- sending ----------

    async def broadcast_presence(self) -> None:
        await self.broadcast_all(self.presence())

    async def send(self, client: Client, msg: dict) -> None:
        try:
            await client.ws.send_text(json.dumps(msg))
        except Exception:
            pass  # disconnected; leave() cleans up

    async def broadcast_home(self, home: Home, msg: dict, role: str | None = None) -> None:
        for c in list(home.clients):
            if role is None or c.role == role:
                await self.send(c, msg)

    async def broadcast_all(self, msg: dict) -> None:
        for home in list(self.homes.values()):
            await self.broadcast_home(home, msg)
        for c in list(self.controls):
            await self.send(c, msg)