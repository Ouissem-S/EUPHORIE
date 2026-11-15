export type Scene = "preshow" | "intro" | "reveal" | "show" | "dark" | "ticket";
export type Effect = "cut" | "fade" | "pulse" | "flash" | "hit" | "strobe";
export type CrowdSound = "murmur" | "cheer" | "roar" | "chant" | "silence";

export interface Cue {
    t: number;              // seconds in the video
    scene?: Scene;
    colour?: string;        // "#rrggbb"
    effect?: Effect;
    dur?: number;           // fade / flash / hit length, seconds
    bpm?: number;           // pulse speed (strobe: its rate); ignored by cut, fade, flash, hit
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
    bpm?: number;           // only while a pulse cue is playing
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
const FLASH_S = 0.6;     // flash / hit length when the cue has no "dur"
const FLASH_REST = 0.4;  // brightness a flash / hit settles at afterwards (the low point of a pulse)
const PULSE_BPM = 120;   // pulse speed when the cue has no "bpm"

const isFlash = (c: Cue) => c.effect === "flash" || c.effect === "hit";

/**
 * What a colour cue shows `since` seconds after it started. Always the cue's own colour:
 * effects only move between colours (fade) or change brightness (pulse, flash, hit, strobe).
 * `from` is what was on screen just before it (a fade starts there).
 *   cut:   the colour, at once.
 *   fade:  from → the colour over "dur".
 *   flash / hit: the colour at full brightness, easing down to FLASH_REST over "dur".
 *   pulse: the colour beating at "bpm" (the only effect that reads bpm, besides strobe's rate).
 */
function render(c: Cue, from: string, since: number): { base: string; colour: string } {
    const colour = c.colour!;
    const s = Math.max(0, since);
    switch (c.effect) {
        case "fade": {
            const d = c.dur ?? 1.5;
            const now = d > 0 && s < d ? mix(from, colour, s / d) : colour;
            return { base: now, colour: now };
        }
        case "flash":
        case "hit": {
            const d = c.dur ?? FLASH_S;
            const left = d > 0 ? Math.max(0, 1 - s / d) : 0; // 1 at the hit → 0 when it's over
            return { base: colour, colour: scale(colour, FLASH_REST + (1 - FLASH_REST) * left ** 2) };
        }
        case "pulse": {
            const phase = ((s * (c.bpm ?? PULSE_BPM)) / 60) % 1;
            return { base: colour, colour: scale(colour, 0.4 + 0.6 * (1 - phase) ** 2) };
        }
        case "strobe": {
            const hz = Math.min((c.bpm ?? 180) / 60, MAX_STROBE_HZ);
            return { base: colour, colour: scale(colour, Math.floor(s * hz * 2) % 2 === 0 ? 1 : 0.06) };
        }
        default:
            return { base: colour, colour };
    }
}

/**
 * The light at video time `t`: the newest colour cue at or before `t`, with its effect.
 * `phone` (phones only): flash/hit cues start `flashDelay` s late on this phone, so they
 * travel across the home as a wave. Everything else is the same on the TV and the phones.
 */
export function stateAt(cues: Cue[], t: number, phone?: { flashDelay: number }): LightState {
    let scene: Scene = "preshow";
    let sceneStart = 0;
    let lines: string[] = [];
    let line = "";
    let lineStart = 0;
    let corners = false;
    let cur: Cue | undefined;
    let curStart = 0; // when `cur` starts here (a phone's flash starts late)
    let from = "#000000"; // what was on screen when `cur` took over

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
            const start = phone && isFlash(c) ? c.t + phone.flashDelay : c.t;
            // Sheet order decides: once a cue has started, it replaces every cue before it
            // (so a late-starting phone flash can never hide the cue that follows it).
            if (start <= t) {
                if (cur) from = render(cur, from, start - curStart).colour;
                cur = c;
                curStart = start;
            }
        }
    }

    if (!cur?.colour) return { scene, sceneStart, colour: "#000000", base: "#000000", lines, line, lineStart, corners };

    const { base, colour } = render(cur, from, t - curStart);
    const bpm = cur.effect === "pulse" ? cur.bpm ?? PULSE_BPM : undefined;
    return { scene, sceneStart, colour, base, bpm, lines, line, lineStart, corners };
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