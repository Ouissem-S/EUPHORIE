import { beatsBetween, type Cue } from "./cues";

/**
 * Drum pulses from the cue sheet ("kick" / "hit" cues), on the video's clock: the TV and
 * every phone read the same cues at the same video time, so they pulse together with no
 * audio or screen capture. Each beat flashes --beat on <html>, which eases back to 0.
 */

const DECAY = 0.85;       // per frame: eases out in ~0.2 s at 60 fps
const MAX_STEP_S = 0.5;   // a bigger jump in video time is a seek: don't fire the beats skipped over

let level = 0;
let raf = 0;
const root = () => document.documentElement.style;

function decay() {
    level *= DECAY;
    if (level < 0.01) {
        level = 0;
        raf = 0;
    } else raf = requestAnimationFrame(decay);
    root().setProperty("--beat", level.toFixed(3));
}

/** Flash --beat on <html> to `strength` (0–1) and let it ease back to 0. */
export function pulseBeat(strength: number) {
    level = Math.max(level, Math.max(0, Math.min(1, strength)));
    root().setProperty("--beat", level.toFixed(3));
    if (!raf) raf = requestAnimationFrame(decay);
}

/** Call every frame with the video time: pulses for the beats since the last call. */
export function beatFollower() {
    let prev: number | null = null;
    return (cues: Cue[], t: number | null) => {
        if (t === null) return void (prev = null);
        if (prev !== null && t > prev && t - prev <= MAX_STEP_S) beatsBetween(cues, prev, t).forEach(pulseBeat);
        prev = t;
    };
}
