/** Wall-clock time, e.g. "20:30". */
export function fmtClock(ms: number) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Time remaining as m:ss or h:mm:ss. */
export function fmtLeft(ms: number) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
