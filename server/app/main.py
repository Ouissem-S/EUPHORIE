"""EUPHORIE server: WebSocket hub + serves the built web app.

Run (dev, from /server):
    EUPHORIE_KEY=my-secret uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from .errors import MESSAGES, Close, JoinError, error_msg
from .hub import CONTROL_KEY, Hub

hub = Hub()
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
HOME_ID = re.compile(r"^[A-Z0-9]{3,8}$")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ticker = asyncio.create_task(hub.run_crowd_ticker())
    yield
    ticker.cancel()


app = FastAPI(title="EUPHORIE", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "homes": len(hub.homes), "phones": hub.phone_count()}


async def pump(ws: WebSocket, client) -> None:
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await hub.send(client, error_msg("bad_json", "Message is not valid JSON."))
                continue
            if not isinstance(msg, dict):
                continue
            try:
                await hub.handle(client, msg)
            except (KeyError, ValueError, TypeError):
                await hub.send(client, error_msg("bad_message", "Missing or invalid fields."))
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close(code=Close.SERVER_ERROR)
        except RuntimeError:
            pass  # already closed (e.g. replaced by a newer TV with 4409)
    finally:
        await hub.leave(client)


# Your phone only: rejected unless the key matches.
@app.websocket("/ws-control")
async def control_endpoint(ws: WebSocket, key: str = "") -> None:
    await ws.accept()
    if key != CONTROL_KEY:
        await ws.send_text(json.dumps({"type": "denied"}))
        await ws.close(code=Close.UNAUTHORISED, reason=MESSAGES[Close.UNAUTHORISED])
        return
    client = await hub.join_control(ws)
    await pump(ws, client)


@app.websocket("/ws/{home_id}")
async def ws_endpoint(ws: WebSocket, home_id: str, role: str = "phone") -> None:
    await ws.accept()
    home_id = home_id.upper()
    if not HOME_ID.match(home_id) or role not in ("tv", "phone"):
        await ws.close(code=Close.BAD_REQUEST, reason=MESSAGES[Close.BAD_REQUEST])
        return
    try:
        client = await hub.join(ws, home_id, role)
    except JoinError as e:
        await ws.close(code=e.code, reason=str(e))
        return
    await pump(ws, client)


# Serve the built React app (web/dist) from the same origin.
@app.get("/{path:path}", response_model=None)
async def spa(path: str):
    if not WEB_DIST.exists():
        return JSONResponse({"error": "Web app not built: run `npm run build` in /web"}, status_code=503)
    file = (WEB_DIST / path).resolve()
    if path and file.is_file() and WEB_DIST in file.parents:
        return FileResponse(file)
    if "." in path.rsplit("/", 1)[-1]:  # looks like a file (e.g. sounds/roar.mp3) but missing
        return JSONResponse({"error": f"Not found: /{path}"}, status_code=404)
    return FileResponse(WEB_DIST / "index.html")