/**
 * Crowd sounds on the phone (claps, cheers), through Web Audio: overlapping one-shots,
 * loops and volume ramps that also work on iPhone (where <audio>.volume is ignored).
 * Silent until unlockCrowdAudio() runs inside a tap, or if a sound file is missing.
 */

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Call inside a tap: browsers only start audio after one. */
export function unlockCrowdAudio() {
    if (typeof AudioContext === "undefined") return;
    ctx ??= new AudioContext();
    void ctx.resume().catch(() => {});
}

function load(url: string) {
    let b = buffers.get(url);
    if (!b && ctx) {
        const c = ctx;
        b = fetch(url)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
            .then((data) => c.decodeAudioData(data))
            .catch(() => null);
        buffers.set(url, b);
    }
    return b ?? Promise.resolve(null);
}

/** Fetch ahead, so the first clap isn't late. */
export function preloadCrowdSound(url: string) {
    void load(url);
}

function voice(buffer: AudioBuffer, loop: boolean) {
    const src = ctx!.createBufferSource();
    const gain = ctx!.createGain();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(gain).connect(ctx!.destination);
    return { src, gain };
}

/** One-shot at `volume` (0–1), `delay` seconds from now. */
export async function playOnce(url: string, volume = 1, delay = 0) {
    const buffer = await load(url);
    if (!buffer || !ctx || ctx.state !== "running") return;
    const { src, gain } = voice(buffer, false);
    gain.gain.value = volume;
    src.start(ctx.currentTime + delay);
}

/** Rises to `peak` over `rise` s, then fades over `fall` s (a short crowd swell). */
export async function swell(url: string, peak: number, rise = 0.4, fall = 1.2) {
    const buffer = await load(url);
    if (!buffer || !ctx || ctx.state !== "running") return;
    const { src, gain } = voice(buffer, true);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + rise);
    gain.gain.linearRampToValueAtTime(0, t + rise + fall);
    src.start(t);
    src.stop(t + rise + fall + 0.05);
}

/** A loop whose volume you ramp; it stops itself once faded to 0. */
export function crowdLoop(url: string) {
    let cur: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
    let stopAt = 0;
    return {
        /** Ramp to `volume` over `seconds`. */
        async to(volume: number, seconds: number) {
            if (!ctx || ctx.state !== "running") return;
            if (!cur && volume > 0) {
                const buffer = await load(url);
                if (!buffer || !ctx) return;
                cur = voice(buffer, true);
                cur.gain.gain.value = 0;
                cur.src.start();
            }
            if (!cur) return;
            const t = ctx.currentTime, g = cur.gain.gain;
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            g.linearRampToValueAtTime(volume, t + seconds);
            if (volume === 0) {
                const done = cur;
                const id = ++stopAt;
                setTimeout(() => {
                    if (id !== stopAt) return; // raised again meanwhile
                    done.src.stop();
                    if (cur === done) cur = null;
                }, seconds * 1000 + 50);
            } else stopAt++;
        },
    };
}
