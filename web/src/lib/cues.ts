export type Scene = "preshow" | "intro" | "reveal" | "show" | "dark" | "ticket";
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
    kick?: number;          // drum pulses: a kick every 60/kick s from t, until the next "kick" cue (0 = stop)
    hit?: number;           // one drum pulse at t, strength 0–1
    note?: string;          // why (AI cues): ignored by the show
}

export interface LightState {
    scene: Scene;
    sceneStart: number;     // t of the cue that set the current scene
    colour: string;         // final colour after effects
    base: string;           // cue colour before brightness
    bpm?: number;
    lines: string[];
    line: string;           // the newest line in this scene ("" if none)
    lineStart: number;      // when it appeared (video seconds)
    corners: boolean;
}

async function fetchCues(url: string): Promise<Cue[]> {
    try {
        const res = await fetch(url, { cache: "no-store" });
        const cues: unknown = res.ok ? await res.json() : [];
        return Array.isArray(cues) ? (cues as Cue[]) : [];
    } catch {
        return []; // missing (the dev server answers with the HTML page) or broken
    }
}

/** How many cues the last loadCues() used from each sheet (TV debug). */
export const cueCounts = { hand: 0, ai: 0 };

/**
 * The hand-made cue sheet (`url`: intro, reveal, text, scenes) merged with the AI lighting
 * designer's ai.json next to it, if there is one. From the first AI cue on, the AI's lights
 * win: hand-made cues there lose their light fields (colour/effect/dur/bpm) but keep text,
 * scenes and the rest; cues left with nothing else are dropped.
 */
export async function loadCues(url: string): Promise<Cue[]> {
    const [hand, ai] = await Promise.all([fetchCues(url), fetchCues(url.replace(/[^/]*$/, "ai.json"))]);
    cueCounts.hand = hand.length;
    cueCounts.ai = ai.length;
    if (!ai.length) return hand.sort((a, b) => a.t - b.t);

    const aiStart = Math.min(...ai.map((c) => c.t));
    const kept = hand.flatMap((c) => {
        if (c.t < aiStart) return [c];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { colour, effect, dur, bpm, ...rest } = c;
        return Object.keys(rest).length > 1 ? [rest] : []; // more than just "t"
    });
    return [...kept, ...ai].sort((a, b) => a.t - b.t);
}

const MAX_STROBE_HZ = 3; // photosensitivity: never more than 3 flashes a second

export function stateAt(cues: Cue[], t: number): LightState {
    let scene: Scene = "preshow";
    let sceneStart = 0;
    let lines: string[] = [];
    let line = "";
    let lineStart = 0;
    let corners = false;
    let cur: Cue | undefined;
    let prev = "#000000";

    for (const c of cues) {
        if (c.t > t) break;
        if (c.scene) {
            if (c.scene !== scene) {
                lines = [];
                line = "";
                sceneStart = c.t;
            }
            scene = c.scene;
            corners = c.scene === "intro";
        }
        if (c.corners !== undefined) corners = c.corners;
        if (c.text) {
            lines = [...lines, c.text].slice(-3);
            line = c.text;
            lineStart = c.t;
        }
        if (c.colour) {
            prev = cur?.colour ?? prev;
            cur = c;
        }
    }

    if (!cur?.colour) return { scene, sceneStart, colour: "#000000", base: "#000000", lines, line, lineStart, corners };

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
    return { scene, sceneStart, colour: scale(base, brightness), base, bpm: cur.bpm, lines, line, lineStart, corners };
}

const KICK_STRENGTH = 0.8;

/** Strengths of the drum pulses ("kick" grids and "hit"s) between two playback times (from, to]. */
export function beatsBetween(cues: Cue[], from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < cues.length && cues[i].t <= to; i++) {
        const c = cues[i];
        if (c.hit !== undefined && c.t > from) out.push(Math.max(0, Math.min(1, c.hit)));
        if (!c.kick) continue;
        const end = cues.find((n, j) => j > i && n.kick !== undefined)?.t ?? Infinity;
        const period = 60 / c.kick;
        let n = from < c.t ? 0 : Math.floor((from - c.t) / period) + 1; // first kick after `from`
        for (let beat = c.t + n * period; beat <= to && beat < end; beat = c.t + ++n * period) {
            if (beat > from) out.push(KICK_STRENGTH);
        }
    }
    return out;
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