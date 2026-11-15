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
from datetime import datetime

from fastapi import WebSocket

from . import analyse, voice
from .bookings import get_booking
from .errors import Close, JoinError, error_msg

# Default show start (server local time); the control page's set_time overrides it.
DEFAULT_START_HOUR = 20
DEFAULT_START_MINUTE = 30

GESTURES = {"clap", "scream", "sway", "cheer"}
# Seats are memory: a home is a BYTE in a cache SECTION, each phone is one BIT of it.
SECTIONS = ["L1", "L2", "L3", "RAM", "SWAP"]
SECTION_WEIGHTS = [5, 4, 2, 1, 1]  # demo homes mostly land in the fast caches
BITS_PER_BYTE = 8  # so at most 8 tickets per home
CROWD_TICK_S = 0.2
FINAL_COUNTDOWN_MS = 10_000

# Only the person with this key can control the show:
#   EUPHORIE_KEY=my-secret uvicorn app.main:app --port 8000
CONTROL_KEY = os.environ.get("EUPHORIE_KEY", "change-me")

# Demo mode (default on): no control page needed. When a home's last ticket is scanned,
# a short waiting-room countdown starts, then the show plays. When the last phone leaves, it resets.
# Turn off with EUPHORIE_DEMO=0 to use the control page again.
DEMO_MODE = os.environ.get("EUPHORIE_DEMO", "1") == "1"
# Long enough for the TV's and phones' waiting scripts to type through once (~18 s) before the show.
DEMO_COUNTDOWN_MS = 22_000

# A home's tickets stay claimed through reloads; freed once it's been empty this long.
EMPTY_HOME_TTL_MS = 10 * 60 * 1000

KNOWN_TYPES = {"ping", "position", "gesture", "vote", "set_time", "approve", "reset", "vote_open", "vote_close", "host_say", "raised", "analyse"}

# The TVs start a host line this long after it's ready, so they all start together.
HOST_LEAD_MS = 1500

# "Lights in the air": phones held up like lighters, counted across every home.
RAISED_MIN_GAP_MS = 250  # raised_count to the TVs at most 4×/s
LIGHTS_SHARE = 0.5  # this share of all phones up (and at least LIGHTS_MIN_PHONES)…
LIGHTS_MIN_PHONES = 2
LIGHTS_LINE = "i see lights in the air."  # …and the host says this,
LIGHTS_COOLDOWN_MS = 60_000  # at most once a minute


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
    tickets: int = 4  # from bookings.json
    clients: set[Client] = field(default_factory=set)
    # Tickets: each phone id (pid) that scanned in keeps its ticket and seat until freed.
    ticket_pids: set[str] = field(default_factory=set)
    seats_by_pid: dict[str, dict] = field(default_factory=dict)
    # Everyone in a home shares one byte in one section; each phone gets the next bit.
    section: str = field(default_factory=lambda: random.choices(SECTIONS, SECTION_WEIGHTS)[0])
    byte: int = 0  # 0–255, unique among current homes (set by the hub)
    empty_since: float | None = None
    # Server time the last ticket came in: TV and phones start the waiting script from it, in sync.
    full_at: float | None = None
    last_position: dict | None = None
    pending: dict[str, int] = field(default_factory=lambda: {g: 0 for g in GESTURES})
    totals: dict[str, int] = field(default_factory=lambda: {g: 0 for g in GESTURES})

    def phones(self) -> list[Client]:
        return [c for c in self.clients if c.role == "phone"]

    def free_tickets(self) -> None:
        self.ticket_pids.clear()
        self.seats_by_pid.clear()
        self.full_at = None


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
        # Demo has no fixed time: it starts when the tickets are in.
        start = datetime.now().replace(hour=DEFAULT_START_HOUR, minute=DEFAULT_START_MINUTE, second=0, microsecond=0)
        self.starts_at: float | None = None if DEMO_MODE else start.timestamp() * 1000
        self.approved = False
        self.go_at: float | None = None
        # phones held up (ids, all homes), and when the TVs last heard about it
        self.raised: set[str] = set()
        self.raised_sent_at = 0.0
        self.raised_pending = False
        self.lights_majority = False
        self.lights_said_at = -LIGHTS_COOLDOWN_MS
        self.analysing = False  # one AI lighting analysis at a time

    # ---------- connection lifecycle ----------

    async def join(self, ws: WebSocket, home_id: str, role: str, pid: str | None = None) -> Client:
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

        self.prune_empty_homes()
        home = self.homes.get(home_id)
        if home is None:
            tickets = min(get_booking(home_id)["tickets"], BITS_PER_BYTE)
            home = self.homes[home_id] = Home(home_id, tickets=tickets, byte=self.free_byte())
        client = Client(ws=ws, role="tv" if role == "tv" else "phone", home_id=home_id)
        if client.role == "phone":
            pid = pid or uuid.uuid4().hex
            if pid not in home.ticket_pids:
                if len(home.ticket_pids) >= home.tickets:
                    raise JoinError(Close.FULL)
                # New ticket: the home's next free bit (first phone bit 0, then 1, …).
                bit = len(home.ticket_pids)
                home.seats_by_pid[pid] = {"section": home.section, "byte": home.byte, "bit": bit}
                home.ticket_pids.add(pid)
                if len(home.ticket_pids) >= home.tickets:
                    home.full_at = now_ms()
            # Same phone again (reload / reconnect): same id, ticket and seat; drop its stale socket.
            client.id = pid
            client.seat = home.seats_by_pid[pid]
            for old in [c for c in home.clients if c.role == "phone" and c.id == pid]:
                home.clients.discard(old)
                try:
                    await old.ws.close(code=Close.CONFLICT)
                except Exception:
                    pass
        home.clients.add(client)
        home.empty_since = None

        await self.send(client, {"type": "welcome", "id": client.id, "home": home_id, "seat": client.seat})
        await self.send(client, self.schedule())
        if client.role == "phone" and home.last_position:
            await self.send(client, home.last_position)
        await self.send(client, self.vote_state())
        await self.broadcast_presence()
        await self.broadcast_home_presence(home)
        if client.role == "tv":
            await self.send(client, self.raised_count())
        else:
            await self.raised_changed()  # one more phone in the crowd
        # Demo: the show starts once this home's tickets are all in.
        if DEMO_MODE and client.role == "phone" and self.go_at is None and len(home.ticket_pids) >= home.tickets:
            await self.demo_start()
        return client

    async def demo_start(self) -> None:
        """Demo: start the show shortly, as if approved on the control page."""
        self.starts_at = self.go_at = now_ms() + DEMO_COUNTDOWN_MS
        self.approved = True
        await self.broadcast_all(self.schedule())

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
            # The home (and its claimed tickets) stays, so a reload always gets back in.
            if not home.clients:
                home.empty_since = now_ms()
            # A ticket holder may just be reloading: keep its vote for when it's back.
            if client.id not in home.ticket_pids:
                self.votes.discard(client.id)
            await self.broadcast_home_presence(home)
            if client.role == "phone":
                self.raised.discard(client.id)
                await self.raised_changed()
        await self.broadcast_presence()
        # Demo: everyone's phone is gone, so get ready for the next run.
        if DEMO_MODE and client.role == "phone" and self.phone_count() == 0 and self.go_at is not None:
            self.approved, self.go_at, self.starts_at = False, None, None
            await self.broadcast_all(self.schedule())

    def free_byte(self) -> int:
        """A byte address no current home is using."""
        used = {h.byte for h in self.homes.values()}
        free = [b for b in range(256) if b not in used]
        return random.choice(free) if free else random.randrange(256)

    def prune_empty_homes(self) -> None:
        """Free the tickets of homes that have been empty for 10 minutes."""
        cutoff = now_ms() - EMPTY_HOME_TTL_MS
        for hid in [h.id for h in self.homes.values() if h.empty_since and h.empty_since < cutoff]:
            del self.homes[hid]

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

        elif kind == "raised" and client.role == "phone":
            if msg.get("up") is True:
                self.raised.add(client.id)
            else:
                self.raised.discard(client.id)
            await self.raised_changed()

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

        if kind == "host_say":
            text = str(msg.get("text", "")).strip()[:300]
            if text:
                # Speech can take a few seconds: don't hold up other messages meanwhile.
                asyncio.create_task(self.host_say(text))
            return

        if kind == "analyse":
            try:
                start, end = float(msg.get("from", 97)), float(msg.get("to", 280))
            except (TypeError, ValueError):
                start = end = -1.0
            if not 0 <= start < end <= start + 900:
                await self.send(client, {"type": "analyse_error", "message": "from/to must be seconds, from < to, at most 15 min apart."})
            elif self.analysing:
                await self.send(client, {"type": "analyse_error", "message": "An analysis is already running."})
            else:
                # Takes a minute or two: run it without holding up other messages.
                asyncio.create_task(self.run_analysis(client, start, end))
            return

        if kind == "set_time":
            self.starts_at = float(msg["starts_at"])
            self.approved, self.go_at = False, None

        elif kind == "approve":
            self.approved = True
            # Never start before the published time; always give a 10 s final countdown.
            self.go_at = max(self.starts_at or 0, now_ms() + FINAL_COUNTDOWN_MS)

        elif kind == "reset":
            self.approved, self.go_at = False, None
            if DEMO_MODE:
                self.starts_at = None  # back to the join screen until the tickets are in again
            for home in self.homes.values():
                home.free_tickets()
                await self.broadcast_home_presence(home)

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

    async def run_analysis(self, client: Client, start: float, end: float) -> None:
        """AI lighting designer: Gemini watches the video and writes web/public/cues/ai.json."""
        self.analysing = True
        try:
            cues = await analyse.analyse(analyse.video_url(), start, end)
            await self.send(client, {"type": "analyse_done", "cues": len(cues)})
        except Exception as e:  # report anything (no key, quota, bad reply) on the control page
            await self.send(client, {"type": "analyse_error", "message": str(e)[:300]})
        finally:
            self.analysing = False

    async def host_say(self, text: str) -> None:
        """Speak a line on every TV: audio + letter timings if the voice works, else just the text."""
        spoken = await voice.synthesize(text)
        msg = {
            "type": "host_line",
            "text": text,
            "audio": f"/voice/{spoken['id']}.mp3" if spoken else None,
            "letter_times": spoken["letter_times"] if spoken else None,
            "start_at": now_ms() + HOST_LEAD_MS,
        }
        for home in list(self.homes.values()):
            await self.broadcast_home(home, msg, role="tv")

    # ---------- lights in the air ----------

    def raised_count(self) -> dict:
        return {"type": "raised_count", "up": len(self.raised), "phones": self.phone_count()}

    async def raised_changed(self) -> None:
        """Phones raised/lowered/joined/left: tell the TVs (≤4×/s) and maybe cue the host."""
        up, phones = len(self.raised), self.phone_count()
        majority = phones >= LIGHTS_MIN_PHONES and up / phones >= LIGHTS_SHARE
        if majority and not self.lights_majority and now_ms() - self.lights_said_at >= LIGHTS_COOLDOWN_MS:
            self.lights_said_at = now_ms()
            asyncio.create_task(self.host_say(LIGHTS_LINE))  # like the control page's host_say
        self.lights_majority = majority

        if self.raised_pending:
            return  # a send is already on its way and will carry the latest count
        self.raised_pending = True
        wait = max(0.0, RAISED_MIN_GAP_MS - (now_ms() - self.raised_sent_at)) / 1000

        async def send_later() -> None:
            await asyncio.sleep(wait)
            self.raised_pending = False
            self.raised_sent_at = now_ms()
            msg = self.raised_count()
            for home in list(self.homes.values()):
                await self.broadcast_home(home, msg, role="tv")

        asyncio.create_task(send_later())

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

    async def broadcast_home_presence(self, home: Home) -> None:
        """This home's phones and tickets (the TV leaves the join screen when all tickets are in)."""
        await self.broadcast_home(
            home,
            {
                "type": "home_presence",
                "phones": len(home.phones()),
                "tickets_in": len(home.ticket_pids),
                "tickets": home.tickets,
                "section": home.section,
                "byte": home.byte,
                "full_at": home.full_at,
            },
        )

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