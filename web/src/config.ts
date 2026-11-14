export const VIDEO_ID = "Dve5nj6dlys";

// Jump points in the video (seconds). Keys 1–3 on the TV jump to these.
// TODO: real start times from the video's chapters.
export const SEGMENTS = [
    { key: "intro", label: "Intro", start: 0 },
    { key: "sweater", label: "Sweater Weather", start: 0 },
    { key: "planet", label: "Planet", start: 0 },
] as const;

export const SHOW = {
    artist: "The Neighbourhood",
    venue: "Berlin",
    tour: "THE WOURLD TOUR 2026",
};

export const COUNTDOWN_MS = 10_000;
export const CUES_URL = "/cues/show.json";

export function wsUrl(home: string, role: "tv" | "phone") {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws/${home}?role=${role}`;
}

export function segmentAt(t: number) {
    let current: (typeof SEGMENTS)[number] = SEGMENTS[0];
    for (const s of SEGMENTS) if (s.start <= t && s.start >= current.start) current = s;
    return current;
}