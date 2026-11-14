export type Scene = "preshow" | "intro" | "show" | "dark" | "ticket";
export type Effect = "cut" | "fade" | "pulse" | "flash" | "strobe";
export type CrowdSound = "murmur" | "cheer" | "roar" | "chant" | "silence";

export interface Cue {
    t: number;              // seconds in the video
    scene?: Scene;
    colour?: string;        // "#rrggbb"
    effect?: Effect;
    dur?: number;           // fade / flash length, seconds
    bpm?: number;           // pulse or strobe speed
    text?: string;          // a line on the phone during the intro
    corners?: boolean;      // orange frame on/off
    crowd?: CrowdSound;     // crowd sound on the phones
}

export interface LightState {
    scene: Scene;
    colour: string;         // final colour after effects
    base: string;           // cue colour before brightness
    bpm?: number;
    lines: string[];
    corners: boolean;
}

export async function loadCues(url: string): Promise<Cue[]> {
    try {
        const res = await fetch(url, { cache: "no-store" });
        const cues = (await res.json()) as Cue[];
        return cues.sort((a, b) => a.t - b.t);
    } catch {
        return [];
    }
}

const MAX_STROBE_HZ = 3; // photosensitivity: never more than 3 flashes a second

export function stateAt(cues: Cue[], t: number): LightState {
    let scene: Scene = "preshow";
    let lines: string[] = [];
    let corners = false;
    let cur: Cue | undefined;
    let prev = "#000000";

    for (const c of cues) {
        if (c.t > t) break;
        if (c.scene) {
            if (c.scene !== scene) lines = [];
            scene = c.scene;
            corners = c.scene === "intro";
        }
        if (c.corners !== undefined) corners = c.corners;
        if (c.text) lines = [...lines, c.text].slice(-3);
        if (c.colour) {
            prev = cur?.colour ?? prev;
            cur = c;
        }
    }

    if (!cur?.colour) return { scene, colour: "#000000", base: "#000000", lines, corners };

    const since = t - cur.t;
    let base = cur.colour;
    let brightness = 1;
    switch (cur.effect) {
        case "fade": {
            const d = cur.dur ?? 1.5;
            if (since < d) base = mix(prev, cur.colour, since / d);
            break;
        }
        case "flash": {
            const hold = 0.18;
            const d = cur.dur ?? 0.8;
            if (since < hold) base = "#ffffff";
            else if (since < hold + d) base = mix("#ffffff", cur.colour, (since - hold) / d);
            break;
        }
        case "pulse": {
            const phase = ((since * (cur.bpm ?? 120)) / 60) % 1;
            brightness = 0.4 + 0.6 * (1 - phase) ** 2;
            break;
        }
        case "strobe": {
            const hz = Math.min((cur.bpm ?? 180) / 60, MAX_STROBE_HZ);
            brightness = Math.floor(since * hz * 2) % 2 === 0 ? 1 : 0.06;
            break;
        }
    }
    return { scene, colour: scale(base, brightness), base, bpm: cur.bpm, lines, corners };
}

/** Crowd-sound cues crossed between two playback times (from, to]. */
export function crowdCuesBetween(cues: Cue[], from: number, to: number): Cue[] {
    return cues.filter((c) => c.crowd && c.t > from && c.t <= to);
}

// ---- colour helpers ----
function rgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]: number[]) {
    return "#" + [r, g, b]
        .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
        .join("");
}
export function mix(a: string, b: string, k: number) {
    const x = rgb(a), y = rgb(b), t = Math.max(0, Math.min(1, k));
    return hex(x.map((v, i) => v + (y[i] - v) * t));
}
export function scale(c: string, k: number) {
    return hex(rgb(c).map((v) => v * k));
}