import { useEffect, useMemo, useRef, useState } from "react";
import { CUES_URL, SEGMENTS, TICKET_T, wsUrl } from "../config";
import { Live, type Msg } from "../lib/live";
import { clearSession, loadSession, saveJoined } from "../lib/phoneSession";
import { closeMessage } from "../lib/errors";
import { fmtSeat, type Seat } from "../lib/format";
import { NO_TICKETS, phaseFor, ticketsFrom, type HomeTickets } from "../lib/phase";
import { useSchedule } from "../hooks/useSchedule";
import { useFirstTap } from "../hooks/useFirstTap";
import { useVideoClock } from "../hooks/useVideoClock";
import { beatFollower } from "../lib/beatPulse";
import { useMotionReactions } from "../hooks/useMotionReactions";
import { requestMotionPermission } from "../lib/motion";
import MotionPanel from "../components/MotionPanel";
import { unlockCrowdAudio } from "../lib/crowdAudio";
import { cueCounts, loadCues, stateAt, type Cue, type Scene } from "../lib/cues";
import { typingGlow } from "../lib/typingGlow";
import { enableTorch, TORCH_POSSIBLE } from "../lib/torch";
import GlowFrame from "../components/GlowFrame";
import Reveal from "../components/Reveal";
import TicketHold from "../components/TicketHold";
import Preshow from "../components/Preshow";
import Typewriter from "../components/Typewriter";

const WAVE = 40; // gentler glow waves on the small screen
const LETTERS_PER_S = 28; // intro lines type at this speed, on the video's clock
const REVEAL_SETTLED = 1.2; // s into the reveal: logo is on, only the CSS pulse moves after this
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
const WAVE_ON = new URLSearchParams(location.search).get("wave") !== "0"; // ?wave=0: flashes all at once
const WAVE_STEP = 0.09; // s per seat bit: bit 0 flashes first, bit 7 last
const BIT_SHOW_MS = 3000; // waiting room: the seat bit, big, this long after joining
// Dev: /phone?home=ABCD&test=1 follows a /tv?test=1 TV into the show (no schedule needed).
const TEST = new URLSearchParams(location.search).get("test") === "1";
// Dev: /phone?preview=ticket: just the end of the show, "hold to keep your ticket" (no TV, no join).
const PREVIEW = new URLSearchParams(location.search).get("preview");

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

    if (PREVIEW === "ticket") return <TicketPreview />;
    if (PREVIEW === "lights") return <LightsPreview />;
    if (!live) return <Screen error="scan the qr code on your tv to join." />;
    if (error) return <Screen error={error} />;
    return (
        <>
            <PhoneStage live={live} joined={joined} homes={homes} seat={seat} tickets={tickets} />
        </>
    );
}

/**
 * /phone?preview=lights&t=95: the song's lights on this phone alone, on its own clock from
 * ?t= (no TV, no video, no sound). Same cue sheet and engine as the show. Tap to pause.
 */
function LightsPreview() {
    const start = Math.max(0, Number(new URLSearchParams(location.search).get("t")) || 95);
    const cues = useRef<Cue[] | null>(null);
    const [shown, setShown] = useState({ t: start, colour: "#000000", scene: "—" as Scene | "—" });
    const paused = useRef(false);

    useEffect(() => {
        loadCues(CUES_URL).then((c) => (cues.current = c));
        let raf = 0;
        let t = start;
        let last = performance.now();
        const loop = (now: number) => {
            if (!paused.current) t += (now - last) / 1000;
            last = now;
            if (cues.current) {
                const s = stateAt(cues.current, t, { flashDelay: 0 });
                setShown({ t, colour: s.colour, scene: s.scene });
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [start]);

    return (
        <div className="phone" onPointerUp={() => (paused.current = !paused.current)}>
            <div className="phone-light" style={{ background: shown.colour }} />
            <div className="debug-overlay">
                t {shown.t.toFixed(1)}s · {shown.scene}
                <br />
                <span className="colour-swatch" style={{ background: shown.colour }} /> {shown.colour}
                <br />
                tap to pause / play
            </div>
        </div>
    );
}

/**
 * /phone?preview=ticket: the end of the show over a blue stage light, with a made-up seat.
 * A tap first: phones only play the voice after one (in the real show it's the join tap).
 */
function TicketPreview() {
    const [go, setGo] = useState(false);
    if (!go) {
        return (
            <div className="phone" onPointerUp={() => setGo(true)}>
                <Screen still="tap to preview the ending" />
            </div>
        );
    }
    return (
        <div className="phone">
            {/* the stage light it fades from */}
            <div className="phone-light" style={{ background: "#2c03fc" }} />
            <TicketHold enabled seat="L1 · byte 0x2A · bit 3" waveScale={WAVE} />
        </div>
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
    const [torchAsked, setTorchAsked] = useState(false);
    // Just joined: show the seat bit big, so people can line phones up (bit 0 on the left).
    const [bitShown, setBitShown] = useState(false);
    const inWaitingRoom = joined && ready && tickets.total > 0 && stage !== "show" && seat !== undefined;
    useEffect(() => {
        if (!inWaitingRoom || bitShown) return;
        const id = setTimeout(() => setBitShown(true), BIT_SHOW_MS);
        return () => clearTimeout(id);
    }, [inWaitingRoom, bitShown]);

    // Wait for the real stage and tickets, so a late joiner never flashes the wrong screen.
    if (!joined || !ready || tickets.total === 0) return <Screen lines={["allocating your seat…"]} loop={false} />;
    if (stage === "show" || TEST) return <PhoneShow live={live} goAt={schedule.go_at} seat={seat} />;
    if (inWaitingRoom && !bitShown) {
        return (
            <div className="phone">
                <p className="seat-bit">bit {seat!.bit}</p>
            </div>
        );
    }
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
            {/* Android only: the camera prompt has to come from a tap. */}
            {TORCH_POSSIBLE && !torchAsked && (
                <button
                    className="torch-button"
                    onClick={() => {
                        setTorchAsked(true);
                        void enableTorch();
                    }}
                >
                    turn on flashlight effects
                </button>
            )}
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
function PhoneShow({ live, goAt, seat }: { live: Live; goAt: number | null; seat?: Seat }) {
    const bit = seat?.bit;
    const flashDelay = WAVE_ON && bit !== undefined ? bit * WAVE_STEP : 0; // this phone's place in the wave
    // No position from the TV yet: the video started at its first segment when the show began.
    const videoTimeNow = useVideoClock(live, () =>
        goAt === null ? null : SEGMENTS[0].start + Math.max(0, live.clock.serverNow() - goAt) / 1000,
    );
    const [view, setView] = useState<ShowView>({ kind: "sync" });
    const [endNear, setEndNear] = useState(false); // video time ≥ TICKET_T
    const [debug, setDebug] = useState<DebugInfo>({ t: "—", scene: "—", offset: 0, colour: "" });
    const motionDebug = useRef<HTMLSpanElement>(null);
    const scene = useRef<Scene | "—">("—");
    // clap (shake) / jump / sway / raised; shakes only count in the "show" scene
    // Test mode: motion counts any time (the MotionPanel shows each step of a hit).
    const motion = useMotionReactions(live, () => TEST || scene.current === "show", DEBUG ? motionDebug : undefined);
    const cues = useRef<Cue[] | null>(null);

    useEffect(() => {
        loadCues(CUES_URL).then((c) => (cues.current = c));
    }, []);

    useEffect(() => {
        let raf = 0;
        let shown: ShowView = { kind: "sync" };
        let typed = { start: -1, chars: 0 }; // letters already typed in this line (each new one moves the glow)
        let dbg = "";
        let nearShown = false;
        const beats = beatFollower(); // drum pulses from the cue sheet, on the video's clock

        const loop = () => {
            const t = videoTimeNow();
            let next: ShowView = { kind: "sync" };
            let sceneNow: Scene | "—" = "—";

            if (cues.current) beats(cues.current, t);
            if (t !== null && cues.current) {
                const s = stateAt(cues.current, t, { flashDelay });
                sceneNow = s.scene;
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
            scene.current = sceneNow;
            // The end of the show: "hold to keep your ticket". Test mode too (else it covers
            // everything you're testing); /phone?preview=ticket shows the ending on its own.
            const near = t !== null && t >= TICKET_T;
            if (near !== nearShown) {
                nearShown = near;
                setEndNear(near);
            }

            if (!sameView(shown, next)) {
                shown = next;
                setView(next);
            }
            if (DEBUG) {
                const colour = next.kind === "light" ? next.colour : "";
                const info = { t: t === null ? "—" : t.toFixed(1), scene: sceneNow, offset: Math.round(live.clock.offset), colour };
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
    }, [live, videoTimeNow, flashDelay]);

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
            wave delay: {Math.round(flashDelay * 1000)} ms
            <br />
            <span ref={motionDebug}>motion: waiting for sensors</span>
        </div>
    );
    // ?test=1 (without ?debug=1): every step of the drum hit, live (to find where it breaks).
    const hitMeter = TEST && !DEBUG && <MotionPanel live={live} />;
    // Clap: a 120 ms white flash, replayed by remounting (new key).
    const flashEl = motion.flash > 0 && <div key={motion.flash} className="flash" />;

    // One TicketHold after the screen, so its state (holding / the ticket) survives screen changes.
    const screen = (() => {
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
                        style={{ background: motion.shakeColour ?? view.colour }}
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
    })();
    return (
        <>
            {screen}
            {hitMeter}
            <TicketHold enabled={endNear} seat={seat && fmtSeat(seat)} waveScale={WAVE} />
        </>
    );
}
