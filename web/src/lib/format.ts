/** Wall-clock time, always 24-hour, e.g. "20:30". */
export function fmtClock(ms: number) {
    // hourCycle "h23" is hour12: false without Chrome's "24:05" quirk just after midnight.
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Time remaining as m:ss or h:mm:ss. */
export function fmtLeft(ms: number) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A phone's seat: its home is a byte in a cache section, the phone is one bit of it. */
export interface Seat {
    section: string; // "L1" | "L2" | "L3" | "RAM" | "SWAP"
    byte: number; // 0–255
    bit: number; // 0–7
}

/** 42 → "0x2A" */
export function fmtByte(n: number) {
    return "0x" + n.toString(16).toUpperCase().padStart(2, "0");
}

/** e.g. "L1 · byte 0x2A · bit 3" */
export function fmtSeat(seat: Seat) {
    return `${seat.section} · byte ${fmtByte(seat.byte)} · bit ${seat.bit}`;
}
