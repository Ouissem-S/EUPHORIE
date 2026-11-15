import { useEffect, useRef, useState } from "react";
import { preloadLine, speakLine } from "../lib/voice";
import { typingGlow } from "../lib/typingGlow";

const TYPE_MS = 45;     // average time per letter
const PAUSE_MS = 220;   // extra beat after punctuation
const HOLD_MS = 1800;   // how long a finished line stays
const GAP_MS = 600;     // fade-out before the next line (matches .typewriter.out transition)

const NONE: string[] = [];

/**
 * Script markup: text in {braces} is shown AND spoken by the AI voice (braces hidden);
 * everything else is only shown. A line without braces stays silent.
 *   "the show begins {at 21:45}."  → shows "the show begins at 21:45.", says "at 21:45"
 */
export function parseLine(raw: string) {
    const spoken = [...raw.matchAll(/\{([^}]*)\}/g)].map((m) => m[1].trim()).filter(Boolean).join(" ");
    return { shown: raw.replace(/[{}]/g, ""), spoken };
}

/**
 * Deterministic "human" jitter (0–1) per letter: the same on every device, so a TV
 * and its phones type the same letter at the same moment.
 */
function jitter(i: number) {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
}

/** When each letter appears (ms from the line's start). */
function letterTimes(text: string) {
    const out: number[] = [];
    let t = 0;
    for (let i = 0; i < text.length; i++) {
        t += TYPE_MS * (0.55 + jitter(i) * 0.9) + (/[.,:!?]/.test(text[i - 1] ?? "") ? PAUSE_MS : 0);
        out.push(t);
    }
    return out;
}

/**
 * How long a line takes to type. Measured with every number as "00", so "9 homes" and
 * "10 homes" take the same time and a changing count never shifts the timeline.
 */
function typeDuration(text: string) {
    const times = letterTimes(text.replace(/\d+/g, "00"));
    return times[times.length - 1] ?? 0;
}

interface Frame {
    line: number; // index into intro + lines
    chars: number; // letters shown
    visible: boolean; // false while fading out
}

/** What's on screen `elapsed` ms after the script started. */
function frameAt(all: string[], introCount: number, loop: boolean, elapsed: number): Frame {
    if (elapsed < 0 || all.length === 0) return { line: 0, chars: 0, visible: true };
    const slot = (i: number) => typeDuration(all[i]) + HOLD_MS + GAP_MS;

    let t = elapsed;
    let i = 0;
    for (; ;) {
        const isLast = i === all.length - 1;
        if (isLast && !loop) break; // final line stays on screen
        const s = slot(i);
        if (t < s) break;
        t -= s;
        if (isLast) {
            // Loop back past the intro; skip whole loops at once.
            const first = Math.min(introCount, all.length - 1);
            let loopLen = 0;
            for (let k = first; k < all.length; k++) loopLen += slot(k);
            if (loopLen > 0) t %= loopLen;
            i = first;
        } else i++;
    }

    const text = all[i];
    const typed = typeDuration(text);
    if (t < typed) {
        // Spread this text's own letter rhythm over the (number-proof) duration.
        const times = letterTimes(text);
        const scale = typed / (times[times.length - 1] || 1);
        let chars = 0;
        while (chars < times.length && times[chars] * scale <= t) chars++;
        return { line: i, chars, visible: true };
    }
    const fading = !(i === all.length - 1 && !loop) && t >= typed + HOLD_MS;
    return { line: i, chars: text.length, visible: !fading };
}

/**
 * Types each line letter by letter, holds it, fades it, then moves to the next.
 * Driven by a clock rather than timers: give every screen the same `clock` (synced
 * server time) and `startAt`, and they all show exactly the same text at the same time.
 * Without a startAt, it starts when it appears.
 * With restartOnReturn, leaving the page (another tab/app) and coming back starts the script
 * again from its first line; from then on this screen runs its own time, not the shared one.
 */
export default function Typewriter({
    lines: loopLines,
    intro = NONE,
    loop = true,
    startAt,
    clock = Date.now,
    voice = false,
    restartOnReturn = false,
}: {
    lines: string[];
    /** Typed once before the looping lines (skipped when the script comes round again). */
    intro?: string[];
    loop?: boolean;
    /** When the script started, on `clock`'s timeline. Shared = in sync. */
    startAt?: number;
    /** Time source; pass the synced server clock so screens line up. */
    clock?: () => number;
    /** Speak each line with the AI voice as it starts typing (phone only). */
    voice?: boolean;
    /** Start again from the first line when the page comes back into view (pre-show join script). */
    restartOnReturn?: boolean;
}) {
    const raw = intro.length ? [...intro, ...loopLines] : loopLines;
    const parsed = raw.map(parseLine);
    const lines = parsed.map((l) => l.shown); // what's typed on screen
    const mountedAt = useRef(clock());
    const resumedAt = useRef<number | null>(null); // set when the page came back into view
    const anchor = resumedAt.current ?? startAt ?? mountedAt.current;

    // Newest inputs for the animation loop, without restarting it.
    const latest = useRef({ lines, introCount: intro.length, loop, anchor, clock });
    latest.current = { lines, introCount: intro.length, loop, anchor, clock };

    const [frame, setFrame] = useState<Frame>(() => frameAt(lines, intro.length, loop, clock() - anchor));
    // The line already being typed when this appears stays silent (it'd start mid-sentence),
    // unless the script is just starting: then its first line is spoken too.
    const spokenLine = useRef(frame.line === 0 && frame.chars === 0 ? -1 : frame.line);

    // Back from another tab/app (or the browser's back/forward cache): start over from the top.
    useEffect(() => {
        if (!restartOnReturn) return;
        let wasHidden = document.visibilityState === "hidden";
        const restart = () => {
            resumedAt.current = latest.current.clock();
            latest.current.anchor = resumedAt.current;
            spokenLine.current = -1; // so the first line is spoken again
        };
        const onVisibility = () => {
            if (document.visibilityState === "hidden") wasHidden = true;
            else if (wasHidden) {
                wasHidden = false;
                restart();
            }
        };
        const onPageShow = (e: PageTransitionEvent) => e.persisted && restart();
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pageshow", onPageShow);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("pageshow", onPageShow);
        };
    }, [restartOnReturn]);

    useEffect(() => {
        let raf = 0;
        const step = () => {
            const l = latest.current;
            const next = frameAt(l.lines, l.introCount, l.loop, l.clock() - l.anchor);
            setFrame((f) => (f.line === next.line && f.chars === next.chars && f.visible === next.visible ? f : next));
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, []);

    const text = lines[frame.line] ?? "";
    const typing = frame.chars < text.length;

    // New script: fetch the audio for its {spoken} parts now, so each starts with its line.
    const toSay = parsed.map((l) => l.spoken);
    const sayKey = toSay.join("\n");
    useEffect(() => {
        if (voice) sayKey.split("\n").filter(Boolean).forEach(preloadLine);
    }, [voice, sayKey]);

    // Each new line (not the one already half-typed when the screen appeared): say its {part}.
    const say = toSay[frame.line] ?? "";
    useEffect(() => {
        if (frame.line === spokenLine.current) return;
        spokenLine.current = frame.line;
        if (voice && say) void speakLine(say);
    }, [voice, frame.line, say]);

    // Each new letter moves the glow.
    const shown = useRef(frame.chars);
    useEffect(() => {
        if (frame.chars > shown.current) typingGlow(text[frame.chars - 1]);
        shown.current = frame.chars;
    }, [frame.chars, text]);

    return (
        <p
            className={`intro-text typewriter ${frame.visible ? "" : "out"} ${typing ? "typing" : ""}`}
            aria-label={text}
        >
            {/* Typed letters: each one fades in from a soft blur */}
            {Array.from(text.slice(0, frame.chars)).map((ch, i) => (
                <span key={`${frame.line}-${i}`} className="tw-char" aria-hidden>
                    {ch}
                </span>
            ))}
            {/* Zero-width anchor so the caret never pushes the text around */}
            <span className="caret-anchor" aria-hidden>
                <span className="caret" />
            </span>
            {/* Untyped rest, invisible: reserves the final width so centred text doesn't drift */}
            <span className="tw-ghost" aria-hidden>
                {text.slice(frame.chars)}
            </span>
        </p>
    );
}
