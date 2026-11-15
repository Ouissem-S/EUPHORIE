/**
 * The phone remembers which home it joined, so a reload (or reopening /phone later)
 * goes straight back in with the same phone id, and so the same seat.
 */

const KEY = "euphorie-phone";
const PID_KEY = "euphorie-pid"; // this phone's id: made once, kept for good

export interface PhoneSession {
    home: string;
    phoneId: string;
    joinedAt: number | null; // set on the first successful join
}

function read(): PhoneSession | null {
    try {
        const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
        return s && typeof s.home === "string" && typeof s.phoneId === "string" ? s : null;
    } catch {
        return null;
    }
}

function write(s: PhoneSession) {
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
        /* private mode: just no rejoin */
    }
}

/** crypto.randomUUID only exists on https; the LAN demo runs on plain http. */
function newId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** This phone's stable id (its ticket follows it through reloads). */
function phoneId() {
    try {
        const saved = localStorage.getItem(PID_KEY);
        if (saved) return saved;
        const id = newId();
        localStorage.setItem(PID_KEY, id);
        return id;
    } catch {
        return newId(); // private mode: works, but a reload counts as a new phone
    }
}

/**
 * The session for this page load. Same home as saved (or no home in the URL):
 * reuse it. A different ?home=: start fresh (same phone id, new home).
 */
export function loadSession(urlHome: string): PhoneSession | null {
    const saved = read();
    if (saved && (!urlHome || saved.home === urlHome)) return { ...saved, phoneId: phoneId() };
    if (!urlHome) return null;
    const fresh = { home: urlHome, phoneId: phoneId(), joinedAt: null };
    write(fresh);
    return fresh;
}

/** Mark the join as successful (keeps the first join time). */
export function saveJoined(s: PhoneSession) {
    write({ ...s, joinedAt: s.joinedAt ?? Date.now() });
}

/** Forget the saved join (show over, or this home's TV is gone). */
export function clearSession() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        /* ignore */
    }
}
