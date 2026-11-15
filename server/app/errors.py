"""Every error the server can send, in one place."""

from enum import IntEnum


class Close(IntEnum):
    """WebSocket close codes. 44xx mirrors the matching HTTP code."""

    BAD_REQUEST = 4400
    UNAUTHORISED = 4401
    HOME_NOT_FOUND = 4404
    FULL = 4403
    CONFLICT = 4409
    SERVER_ERROR = 1011


MESSAGES = {
    Close.BAD_REQUEST: "Invalid home code or role.",
    Close.UNAUTHORISED: "Wrong control key.",
    Close.HOME_NOT_FOUND: "No TV is running for this home.",
    Close.FULL: "All tickets for this home are in use.",
    Close.CONFLICT: "This home was opened on another screen.",
    Close.SERVER_ERROR: "Server error.",
}


class JoinError(Exception):
    def __init__(self, code: Close) -> None:
        super().__init__(MESSAGES[code])
        self.code = code


def error_msg(code: str, message: str) -> dict:
    """A message-level error: the connection stays open."""
    return {"type": "error", "code": code, "message": message}