import { useEffect, useMemo, useRef, useState } from "react";
import GlowFrame from "./GlowFrame";
import Ticket from "./Ticket";
import { useHold } from "../hooks/useHold";
import { preloadLine, speakLine } from "../lib/voice";
import { typingGlow } from "../lib/typingGlow";
import { downloadTicket, loadLogo, renderTicket } from "../lib/ticketImage";
import { SHOW } from "../config";

// Timeline (ms from the start of the ending)
const FADE_MS = 3000; // the stage light slowly darkens to black…
const GLOW_AT = 2600; // …and the orange waves come in
const VOICE_AT = 1500; // spoken only (never typed), while the light is still darkening
const TYPE_AT = 4200;
const TYPE_MS = 70; // per letter
const LINE_GAP_MS = 700;
const PROMPT = "hold your screen to keep your ticket";
const VOICE_LINE = "thanks for using euphorie. we hope you enjoyed the show.";
const FLOOD_MS = 600; // full glow → black, then the ticket

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * Phone, end of the show (once `enabled`, it runs to the end). The light fades to black, the
 * orange waves come in, "euphorie" / the show and date / the seat type in, then "hold your
 * screen to keep your ticket". Holding fills the screen with the glow like a tide; at full it
 * fades to black, the ticket image (with the band's logo) downloads, and the ticket stays.
 */
export default function TicketHold({ enabled, seat, waveScale }: { enabled: boolean; seat?: string; waveScale?: number }) {
    const [started, setStarted] = useState(false);
    if (enabled && !started) setStarted(true);
    // Fetch the voice line during the show, so it's ready the moment the ending starts.
    useEffect(() => preloadLine(VOICE_LINE), []);
    return started ? <Ending seat={seat} waveScale={waveScale} /> : null;
}

function Ending({ seat, waveScale }: { seat?: string; waveScale?: number }) {
    const date = useMemo(today, []);
    const show = `${SHOW.artist} · ${SHOW.venue}`;
    const lines = useMemo(() => ["Euphorie", `${show} · ${date}`, ...(seat ? [seat] : []), PROMPT], [show, date, seat]);
    const starts = useMemo(() => lines.map((_, i) => TYPE_AT + lines.slice(0, i).reduce((t, l) => t + l.length * TYPE_MS + LINE_GAP_MS, 0)), [lines]);
    const typedAll = starts[starts.length - 1] + PROMPT.length * TYPE_MS;

    const t0 = useRef(performance.now());
    const [now, setNow] = useState(0);
    const [stage, setStage] = useState<"intro" | "flood" | "ticket">("intro");
    const ready = stage === "intro" && now >= typedAll; // the prompt is up: holding works
    const png = useRef<Blob | null>(null);
    const [logoFailed, setLogoFailed] = useState(false);

    // Typing clock (stops once everything is typed); each new letter flickers the glow.
    useEffect(() => {
        let raf = 0, letters = 0;
        const tick = () => {
            const t = performance.now() - t0.current;
            setNow(t);
            const n = lines.reduce((sum, l, i) => sum + Math.max(0, Math.min(l.length, Math.floor((t - starts[i]) / TYPE_MS))), 0);
            if (n > letters) typingGlow("x");
            letters = n;
            if (t < typedAll) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [lines, starts, typedAll]);

    // The voice, and the ticket image made ahead (so the download is instant at the end).
    useEffect(() => {
        preloadLine(VOICE_LINE);
        const id = setTimeout(() => void speakLine(VOICE_LINE), VOICE_AT);
        void loadLogo().then((logo) => renderTicket(["Euphorie", show, date, ...(seat ? [seat] : [])], logo)).then((b) => (png.current = b));
        return () => clearTimeout(id);
    }, [show, date, seat]);

    // The tide: the orange fades up early, the dark centre shrinks to nothing (eased).
    const tide = useRef<HTMLDivElement>(null);
    const hole = useRef<HTMLDivElement>(null);
    const build = (ms: number) =>
        tide.current && hole.current
            ? [
                tide.current.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], { duration: ms, fill: "both" }),
                hole.current.animate([{ transform: "scale(1.15)" }, { transform: "scale(0)" }], {
                    duration: ms,
                    fill: "both",
                    easing: "cubic-bezier(0.45, 0, 0.25, 1)",
                }),
            ]
            : [];
    const { handlers } = useHold(ready, build, () => {
        setStage("flood");
        setTimeout(() => {
            setStage("ticket");
            if (png.current) downloadTicket(png.current);
        }, FLOOD_MS);
    });

    if (stage === "ticket") return <Ticket seat={seat} show={show} date={date} onSave={() => png.current && downloadTicket(png.current)} />;
    return (
        <div className="ticket-hold" {...handlers}>
            <div className="ticket-dark" style={{ animationDuration: `${FADE_MS}ms` }} />
            <div className="preshow centred ticket-glow" style={{ animationDelay: `${GLOW_AT}ms` }}>
                <GlowFrame waveScale={waveScale} />
                <div className="preshow-left ticket-lines">
                    {!logoFailed && (
                        <img className="ticket-end-logo" src="/brand/reveal.png" alt="The Neighbourhood" onError={() => setLogoFailed(true)} />
                    )}
                    {lines.map((l, i) => {
                        const n = Math.min(l.length, Math.floor((now - starts[i]) / TYPE_MS));
                        if (n < 0) return null;
                        const cls = i === 0 ? "ticket-title" : i === lines.length - 1 ? "ticket-prompt" : l === seat ? "ticket-line seat" : "ticket-line";
                        return (
                            <p key={i} className={`intro-text ${cls} ${i === lines.length - 1 && ready ? "pulsing" : ""}`} aria-label={l}>
                                {l.slice(0, n)}
                            </p>
                        );
                    })}
                </div>
            </div>
            {/* The tide: orange everywhere but a dark centre that shrinks as you hold. Two soft,
                uneven blobs swaying out of step make its edge move like water. */}
            <div className="ticket-tide" ref={tide}>
                <div className="ticket-tide-hole" ref={hole}>
                    <div className="ticket-blob a" />
                    <div className="ticket-blob b" />
                </div>
            </div>
            {stage === "flood" && <div className="ticket-flood" />}
        </div>
    );
}
