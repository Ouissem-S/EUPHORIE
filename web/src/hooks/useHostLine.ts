import { useEffect, useRef, useState } from "react";
import type { Live, Msg } from "../lib/live";

const LATE_MS = 500;        // arrived this late: skip it rather than start mid-line
const FALLBACK_MS = 70;     // no audio: one letter per 70 ms
const LINGER_MS = 2000;     // keep the finished line up this long

export interface HostLine {
    text: string;
    visibleChars: number;
}

/**
 * Host lines from the control page: at start_at (server time) play the voice and reveal
 * the letters exactly as they're spoken. The voice loudness drives the glow through the
 * CSS variable --voice (0–1) on <html>, set directly so it doesn't re-render React 60×/s.
 */
export function useHostLine(live: Live): HostLine | null {
    const [line, setLine] = useState<HostLine | null>(null);
    const stop = useRef<() => void>(() => {});

    useEffect(() => {
        const off = live.on((m: Msg) => {
            if (m.type !== "host_line") return;
            if (live.clock.serverNow() > m.start_at + LATE_MS) return;
            stop.current();
            stop.current = run(live, m, setLine);
        });
        return () => {
            off();
            stop.current();
        };
    }, [live]);

    return line;
}

function run(live: Live, m: Msg, setLine: (l: HostLine | null) => void) {
    const text: string = m.text;
    const times: number[] | null = m.letter_times;
    const audio = m.audio ? Object.assign(new Audio(m.audio), { preload: "auto" }) : null;
    const root = document.documentElement.style;
    let raf = 0, done = 0, level = 0, startedAt = 0, lastShown = -1;
    let playing = false; // false if the browser blocked the audio: letters follow the clock instead
    let analyser: AnalyserNode | null = null;
    let ctx: AudioContext | null = null;

    const frame = () => {
        const elapsed = (performance.now() - startedAt) / 1000;
        const t = playing && audio ? audio.currentTime : elapsed; // seconds into the line
        const shown = Math.min(
            text.length,
            times ? times.filter((x) => x <= t).length : Math.floor((elapsed * 1000) / FALLBACK_MS),
        );
        if (shown !== lastShown) {
            lastShown = shown;
            setLine({ text, visibleChars: shown }); // only when a letter appears
        }

        if (analyser) {
            const buf = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(buf);
            const rms = Math.sqrt(buf.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / buf.length);
            const target = Math.min(1, rms * 4);
            level += (target - level) * (target > level ? 0.5 : 0.06); // fast rise, slow fall
            root.setProperty("--voice", level.toFixed(3));
        }

        const finished = playing && audio ? audio.ended : shown >= text.length;
        if (finished && !done) done = window.setTimeout(end, LINGER_MS);
        raf = requestAnimationFrame(frame);
    };

    // Set up audio during the lead time, so it starts exactly at start_at on every TV.
    // Route through Web Audio for the level meter, but only if the context may play;
    // otherwise play the element directly (voice still works, glow just doesn't react).
    const ready = (async () => {
        if (!audio) return;
        try {
            ctx = new AudioContext();
            await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
            if (ctx.state === "running") {
                analyser = Object.assign(ctx.createAnalyser(), { fftSize: 512 });
                ctx.createMediaElementSource(audio).connect(analyser);
                analyser.connect(ctx.destination);
            }
        } catch {
            analyser = null;
        }
    })();

    const start = async () => {
        await ready;
        startedAt = performance.now();
        // Blocked (no click on this page yet)? The letters still follow the voice's timing.
        audio?.play().then(() => (playing = true), () => {});
        frame();
    };

    const end = () => {
        cancelAnimationFrame(raf);
        root.setProperty("--voice", "0");
        setLine(null);
    };

    const timer = window.setTimeout(start, Math.max(0, m.start_at - live.clock.serverNow()));
    return () => {
        clearTimeout(timer);
        clearTimeout(done);
        cancelAnimationFrame(raf);
        audio?.pause();
        void ctx?.close();
        root.setProperty("--voice", "0");
        setLine(null);
    };
}
