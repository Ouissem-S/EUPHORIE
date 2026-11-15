import { useEffect, useMemo, useRef, useState } from "react";
import { CUES_URL, SEGMENTS, wsUrl } from "../config";
import { Live, type Msg } from "../lib/live";
import { clearSession, loadSession, saveJoined } from "../lib/phoneSession";
import { closeMessage } from "../lib/errors";
import type { Seat } from "../lib/format";
import { NO_TICKETS, phaseFor, ticketsFrom, type HomeTickets } from "../lib/phase";
import { useSchedule } from "../hooks/useSchedule";
import { useFirstTap } from "../hooks/useFirstTap";
import { useVideoClock } from "../hooks/useVideoClock";
import { beatFollower } from "../lib/beatPulse";
import { useMotionReactions } from "../hooks/useMotionReactions";
import { requestMotionPermission } from "../lib/motion";
import { unlockCrowdAudio } from "../lib/crowdAudio";
import { cueCounts, loadCues, stateAt, type Cue, type Scene } from "../lib/cues";
import { typingGlow } from "../lib/typingGlow";
import GlowFrame from "../components/GlowFrame";
import Reveal from "../components/Reveal";
import Preshow from "../components/Preshow";
import Typewriter from "../components/Typewriter";

const WAVE = 40; // gentler glow waves on the small screen
const LETTERS_PER_S = 28; // intro lines type at this speed, on the video's clock
const REVEAL_SETTLED = 1.2; // s into the reveal: logo is on, only the CSS pulse moves after this
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

/**
 * Every phone state in the waiting-room look: glow + typed lines, or a still message
 * (no typing), dimmed for errors.
 */
function Screen({ lines, loop = true, still, error }: { lines?: string[]; loop?: boolean; still?: string; error?: string }) {
    const message = error ?? still;
    return (
        <div className={`phone ${error ? "dim" : ""}`}>
            <div className="preshow centred">
                <GlowFrame waveScale={WAVE} />
                <div className="preshow-left">
                    {message ? <p className="intro-text">{message}</p> : <Typewriter lines={lines!} loop={loop} />}
                </div>
            </div>
        </div>
    );
}

/**
 * Opened by scanning the TV's QR code (/phone?home=ABCD), or reopened/reloaded later:
 * a saved join for the same home goes straight back in, same phone id, same seat,
 * and lands on whatever stage the TV is at now.
 */
export default function Phone() {
    const session = useMemo(() => {
        const urlHome = (new URLSearchParams(location.search).get("home") ?? "").toUpperCase();
        return loadSession(urlHome);
    }, []);
    const live = useMemo(
        () => (session ? new Live(wsUrl(session.home, "phone", session.phoneId)) : null),
        [session],
    );

    const [joined, setJoined] = useState(false);
    const [homes, setHomes] = useState(0);
    const [tickets, setTickets] = useState<HomeTickets>(NO_TICKETS);
    const [seat, setSeat] = useState<Seat>();
    const [error, setError] = useState("");
    // The first tap keeps the screen awake, and (inside that tap, as iPhones require) asks for
    // motion access and unlocks the crowd sounds. Denied or unsupported: everything else works.
    useFirstTap(() => {
        void requestMotionPermission();
        unlockCrowdAudio();
    });

    useEffect(() => {
        if (!live || !session) return;
        const off = live.on((m: Msg) => {
            if (m.type === "welcome") {
                setJoined(true);
                saveJoined(session);
                if (m.seat) setSeat(m.seat);
            }
            if (m.type === "presence") setHomes(m.homes);
            if (m.type === "home_presence") setTickets(ticketsFrom(m));
            if (m.type === "closed") {
                // This home's TV is gone or the code is bad: don't auto-rejoin it next time.
                if (m.code === 4404 || m.code === 4400) clearSession();
                setError(closeMessage(m.code, m.reason));
            }
        });
        return () => {
            off();
            live.close();
        };
    }, [live, session]);

    if (!live) return <Screen error="scan the qr code on your tv to join." />;
    if (error) return <Screen error={error} />;
    return (
        <>
            <PhoneStage live={live} joined={joined} homes={homes} seat={seat} tickets={tickets} />
        </>
    );
}

/** Split out so the schedule hook always has a live connection. */
function PhoneStage({
    live,
    joined,
    homes,
    seat,
    tickets,
}: {
    live: Live;
    joined: boolean;
    homes: number;
    seat?: Seat;
    tickets: HomeTickets;
}) {
    const { schedule, stage, now, ready } = useSchedule(live, () => {});
    const serverNow = useMemo(() => () => live.clock.serverNow(), [live]);

    // Wait for the real stage and tickets, so a late joiner never flashes the wrong screen.
    if (!joined || !ready || tickets.total === 0) return <Screen lines={["allocating your seat…"]} loop={false} />;
    if (stage === "show") return <PhoneShow live={live} goAt={schedule.go_at} />;
    return (
        <div className="phone">
            {/* Same inputs and clock as the TV: the same screen and text at the same moment. */}
            <Preshow
                stage={stage}
                phase={phaseFor(tickets, schedule, stage, now)}
                schedule={schedule}
                now={now}
                homes={homes}
                tickets={tickets}
                seat={seat}
                clock={serverNow}
                qr=""
                waveScale={WAVE}
            />
        </div>
    );
}

/** What the phone shows during the show; re-rendered only when one of these changes. */
type ShowView =
    | { kind: "sync" }
    | { kind: "intro"; text: string }
    | { kind: "reveal"; elapsed: number }
    | { kind: "light"; colour: string };

interface DebugInfo {
    t: string; // video time, 1 decimal
    scene: Scene | "—";
    offset: number; // clock offset, ms
    colour: string; // stage light shown ("" outside the light scenes)
}

const sameView = (a: ShowView, b: ShowView) =>
    a.kind === b.kind &&
    (a.kind !== "intro" || a.text === (b as typeof a).text) &&
    (a.kind !== "reveal" || a.elapsed === (b as typeof a).elapsed) &&
    (a.kind !== "light" || a.colour === (b as typeof a).colour);

/**
 * The show on the phone, on the TV's video clock: the intro's lines typed in the orange
 * frame, then the stage light filling the screen in the cue sheet's colours. Until the
 * time is known it's just the glow, no text.
 */
function PhoneShow({ live, goAt }: { live: Live; goAt: number | null }) {
    // No position from the TV yet: the video started at its first segment when the show began.
    const videoTimeNow = useVideoClock(live, () =>
        goAt === null ? null : SEGMENTS[0].start + Math.max(0, live.clock.serverNow() - goAt) / 1000,
    );
    const [view, setView] = useState<ShowView>({ kind: "sync" });
    const [debug, setDebug] = useState<DebugInfo>({ t: "—", scene: "—", offset: 0, colour: "" });
    const motionDebug = useRef<HTMLSpanElement>(null);
    const motion = useMotionReactions(live, DEBUG ? motionDebug : undefined); // clap / jump / sway / raised
    const cues = useRef<Cue[] | null>(null);

    useEffect(() => {
        loadCues(CUES_URL).then((c) => (cues.current = c));
    }, []);

    useEffect(() => {
        let raf = 0;
        let shown: ShowView = { kind: "sync" };
        let typed = { start: -1, chars: 0 }; // letters already typed in this line (each new one moves the glow)
        let dbg = "";
        const beats = beatFollower(); // drum pulses from the cue sheet, on the video's clock

        const loop = () => {
            const t = videoTimeNow();
            let next: ShowView = { kind: "sync" };
            let scene: Scene | "—" = "—";

            if (cues.current) beats(cues.current, t);
            if (t !== null && cues.current) {
                const s = stateAt(cues.current, t);
                scene = s.scene;
                if (s.scene === "reveal") {
                    // Video-time based (late joiners in sync); 1/50 s steps, frozen once settled.
                    const e = Math.min(REVEAL_SETTLED, Math.max(0, t - s.sceneStart));
                    next = { kind: "reveal", elapsed: Math.round(e * 50) / 50 };
                } else if (s.scene === "intro") {
                    const visible = Math.max(0, Math.min(s.line.length, Math.floor((t - s.lineStart) * LETTERS_PER_S)));
                    next = { kind: "intro", text: s.line.slice(0, visible) };

                    if (s.lineStart !== typed.start) typed = { start: s.lineStart, chars: visible };
                    else if (visible > typed.chars) {
                        typingGlow(s.line[visible - 1]); // the glow moves as if the line is spoken
                        typed.chars = visible;
                    }
                } else next = { kind: "light", colour: s.colour };
            }

            if (!sameView(shown, next)) {
                shown = next;
                setView(next);
            }
            if (DEBUG) {
                const colour = next.kind === "light" ? next.colour : "";
                const info = { t: t === null ? "—" : t.toFixed(1), scene, offset: Math.round(live.clock.offset), colour };
                const key = `${info.t}|${info.scene}|${info.offset}|${colour}`;
                if (key !== dbg) {
                    dbg = key;
                    setDebug(info);
                }
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [live, videoTimeNow]);

    const overlay = DEBUG && (
        <div className="debug-overlay">
            t {debug.t}s · {debug.scene} · offset {debug.offset}ms
            {debug.colour && (
                <>
                    <br />
                    <span className="colour-swatch" style={{ background: debug.colour }} /> {debug.colour}
                </>
            )}
            <br />
            cues: {cueCounts.hand} hand + {cueCounts.ai} ai
            <br />
            <span ref={motionDebug}>motion: waiting for sensors</span>
        </div>
    );
    // Clap: a 120 ms white flash, replayed by remounting (new key).
    const flashEl = motion.flash > 0 && <div key={motion.flash} className="flash" />;

    if (view.kind === "reveal") {
        return (
            <div className="phone">
                <Reveal elapsed={view.elapsed} />
                {flashEl}
                {overlay}
            </div>
        );
    }
    if (view.kind === "light") {
        return (
            <div className="phone">
                <div
                    className="phone-light"
                    style={{ background: view.colour }}
                >
                    {/* Tilting dims it (--sway); jumping brightens it; held up, it goes white like a flashlight */}
                    <div className="light-sway" />
                    <div className={`light-lift ${motion.raised ? "up" : motion.jumping ? "jump" : ""}`} />
                </div>
                {flashEl}
                {overlay}
            </div>
        );
    }
    return (
        <div className="phone">
            <div className="preshow centred">
                <GlowFrame waveScale={WAVE} />
                <div className="preshow-left">
                    {view.kind === "intro" && (
                        <p className="intro-text typewriter" aria-label={view.text}>
                            {view.text}
                        </p>
                    )}
                </div>
            </div>
            {flashEl}
            {overlay}
        </div>
    );
}
