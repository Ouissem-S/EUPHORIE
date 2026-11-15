/**
 * Speaks stage lines with the AI voice (mp3s from the server's /api/tts).
 *
 * Phone browsers block sound until the page has been touched once. We try to play
 * straight away; if that's blocked, the first touch anywhere (no prompt shown)
 * unlocks it and the current line plays. One shared <audio> element, because iOS
 * only lets an element that was unlocked by a touch keep playing later.
 *
 * On the TV (enableVoiceGlow), its loudness drives --voice (0–1) on <html>, like the host
 * lines do, so the glow's waves react to the spoken script too. Off on phones: redrawing
 * the glow every frame makes them lag, and the audio plays directly there.
 */

const audio = typeof Audio !== "undefined" ? new Audio() : null;
const urls = new Map<string, Promise<string | null>>(); // text → blob URL (null if unavailable)
let pending: string | null = null; // line waiting for the first touch
// Loudness meter (see connectMeter below)
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let level = 0;
let raf = 0;

function load(text: string) {
    let url = urls.get(text);
    if (!url) {
        // Always re-check with the server: the audio changes when the voice settings do,
        // and older copies were cached by the browser for a year.
        url = fetch(`/api/tts?text=${encodeURIComponent(text)}`, { cache: "no-cache" })
            .then((r) => (r.ok ? r.blob() : null))
            .then((b) => (b ? URL.createObjectURL(b) : null))
            .catch(() => null)
            .then((u) => {
                if (!u) urls.delete(text); // failed: try again next time instead of staying silent
                return u;
            });
        urls.set(text, url);
    }
    return url;
}

/** Fetch a line's audio ahead of time so it starts with the typing. */
export function preloadLine(text: string) {
    void load(text);
}

/** Speak a line now (cuts off the previous one). Silent if the voice isn't set up. */
export async function speakLine(text: string) {
    if (!audio) return;
    pending = text;
    const url = await load(text);
    if (!url || pending !== text) return; // no audio, or a newer line already started
    audio.src = url;
    // Routed through the loudness meter: a paused audio engine would play silence.
    if (ctx && ctx.state !== "running") await ctx.resume().catch(() => {});
    try {
        await audio.play();
        pending = null;
    } catch {
        // Blocked until the first touch: unlock() will play it.
    }
}

// ---- Loudness meter → --voice --------------------------------------------------------

/**
 * Route the audio through an analyser once sound is allowed. Only connected while the
 * context is running: a suspended context would silence the element.
 */
let meterOn = false;

/** TV only: let the spoken script drive the glow (--voice). */
export function enableVoiceGlow() {
    meterOn = true;
}

function connectMeter() {
    if (!meterOn || !audio || analyser || typeof AudioContext === "undefined") return;
    try {
        ctx ??= new AudioContext();
    } catch {
        return;
    }
    ctx.resume()
        .then(() => {
            if (!ctx || ctx.state !== "running" || analyser) return;
            analyser = Object.assign(ctx.createAnalyser(), { fftSize: 512 });
            ctx.createMediaElementSource(audio).connect(analyser);
            analyser.connect(ctx.destination);
        })
        .catch(() => {});
}

function meter() {
    const root = document.documentElement.style;
    let target = 0;
    if (analyser && audio && !audio.paused) {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        target = Math.min(1, Math.sqrt(buf.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / buf.length) * 4);
    }
    level += (target - level) * (target > level ? 0.5 : 0.06); // fast rise, slow fall
    if (audio?.paused && level < 0.01) {
        root.setProperty("--voice", "0");
        raf = 0;
        return;
    }
    root.setProperty("--voice", level.toFixed(3));
    raf = requestAnimationFrame(meter);
}

audio?.addEventListener("play", () => {
    if (!meterOn) return;
    connectMeter();
    if (!raf) raf = requestAnimationFrame(meter);
});

function unlock() {
    connectMeter(); // a touch/click: the audio context may start now
    if (!audio || !pending) return;
    const text = pending;
    void load(text).then((url) => {
        if (!url || pending !== text) return;
        if (audio.src !== url) audio.src = url;
        audio.play().then(() => (pending = null), () => {});
    });
}

// Any of these counts as "the page was touched" for the browser's sound rules.
for (const ev of ["pointerup", "touchend", "click", "keydown"]) {
    window.addEventListener(ev, unlock, { passive: true });
}
