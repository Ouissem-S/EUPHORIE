import { useEffect, useRef } from "react";
import { typingGlow } from "../lib/typingGlow";
import { fmtByte, fmtLeft, fmtSeat, type Seat } from "../lib/format";
import { BYTE_FULL_INTRO, HOLDING_SCRIPT, JOIN_SCRIPT, waitingScript } from "../lib/scripts";
import { isFull, type HomeTickets, type Phase } from "../lib/phase";
import type { Schedule, Stage } from "../hooks/useSchedule";
import GlowFrame from "./GlowFrame";
import Typewriter from "./Typewriter";
import type { HostLine } from "../hooks/useHostLine";

/** The waiting room only shows the time left once the start is this close. */
const COUNTDOWN_FROM_MS = 10 * 60 * 1000;

export type { Phase };

interface Props {
    stage: Exclude<Stage, "show">;
    phase: Phase;
    schedule: Schedule;
    now: number;
    homes: number;
    qr: string;
    /** This home's booking (a byte; each ticket is a bit). */
    tickets?: HomeTickets;
    /** The phone's own seat, as a quiet line under the shared script. */
    seat?: Seat;
    /** Synced server clock: the TV and its phones type the same letter at the same moment. */
    clock?: () => number;
    /** A live host line (TV): shown instead of the script, typed in time with the voice. */
    host?: HostLine | null;
    /** Glow wave strength: TV default 100, phone 40. */
    waveScale?: number;
    /** Glow waves react to the voice (TV only; too heavy for phones). */
    reactive?: boolean;
    /** The show just started: fade out over the video (TV). */
    leaving?: boolean;
    /** Speak the {marked} lines with the AI voice. */
    voice?: boolean;
}

/** The host's line, revealed letter by letter as the voice speaks it (same look as the script). */
function HostText({ line }: { line: HostLine }) {
    const typing = line.visibleChars < line.text.length;
    const shown = useRef(line.visibleChars);
    useEffect(() => {
        if (line.visibleChars > shown.current) typingGlow(line.text[line.visibleChars - 1]);
        shown.current = line.visibleChars;
    }, [line.visibleChars, line.text]);
    return (
        <p className={`intro-text typewriter ${typing ? "typing" : ""}`} aria-label={line.text}>
            {Array.from(line.text.slice(0, line.visibleChars)).map((ch, i) => (
                <span key={i} className="tw-char" aria-hidden>
                    {ch}
                </span>
            ))}
            <span className="caret-anchor" aria-hidden>
                <span className="caret" />
            </span>
            <span className="tw-ghost" aria-hidden>
                {line.text.slice(line.visibleChars)}
            </span>
        </p>
    );
}

/** QR inside the outer silhouette of the band's upside-down house (body, roof, chimney). */
function QrLogo({ qr }: { qr: string }) {
    return (
        <div className="qr-logo">
            <svg viewBox="72 73 495 492" aria-hidden>
                <path d="M143 83 H500 V310 H557 L465 405 V528 H378 V495 L320 555 L82 310 H143 Z" />
            </svg>
            <img className="qr" src={qr} alt="Scan to join" />
        </div>
    );
}

/**
 * Join / waiting room / holding / countdown screen shown over the video before the show.
 * The TV and its phones render this with the same inputs, so they show the same text:
 * looping scripts run on the shared clock from time 0, the waiting script from the
 * moment the home's byte filled.
 */
export default function Preshow({ stage, phase, schedule, now, homes, qr, tickets, seat, clock, host, waveScale, voice, leaving, reactive }: Props) {
    const type = { clock, voice };
    const ticketLine = tickets && tickets.total > 0 && (
        <p className="quiet-line">
            byte {fmtByte(tickets.byte)} · {tickets.in} of {tickets.total} bits in
        </p>
    );

    // Final countdown for a home with nobody joined: just the number, no QR.
    // (A home with phones in stays in the waiting room and counts down there.)
    if (stage === "countdown" && phase === "join") {
        return (
            <div className="preshow">
                <GlowFrame waveScale={waveScale} reactive={reactive} />
                <div className="preshow-left">
                    {schedule.go_at && (
                        <p className="countdown">{Math.max(0, Math.ceil((schedule.go_at - now) / 1000))}</p>
                    )}
                </div>
            </div>
        );
    }

    // Tickets still coming in: text left, QR right (phones: the same text, centred, no QR).
    if (phase === "join") {
        if (!qr) {
            return (
                <div className="preshow centred">
                    <GlowFrame waveScale={waveScale} reactive={reactive} />
                    <div className="preshow-left">
                        {host ? <HostText line={host} /> : <Typewriter lines={JOIN_SCRIPT} restartOnReturn {...type} />}
                        {ticketLine}
                        {seat && <p className="quiet-line">{fmtSeat(seat)}</p>}
                    </div>
                </div>
            );
        }
        return (
            <div className="preshow">
                <GlowFrame waveScale={waveScale} reactive={reactive} />
                <div className="preshow-left">
                    {host ? <HostText line={host} /> : <Typewriter lines={JOIN_SCRIPT} restartOnReturn {...type} />}
                    {ticketLine}
                </div>
                <div className="preshow-right">
                    {qr && <QrLogo qr={qr} />}
                    <div className="qr-notes">
                        <p className="muted qr-caption">Scan to join · get your lights ready</p>
                    </div>
                </div>
            </div>
        );
    }

    // Waiting room: one centred column, no QR. Time left only in the last 10 minutes.
    // Counts down to the go time once approved (demo: shortly after the byte fills).
    const target = stage === "countdown" ? schedule.go_at : stage === "doors" ? schedule.starts_at : null;
    const left = target ? target - now : Infinity;
    const full = tickets ? isFull(tickets) : false;
    return (
        <div className={`preshow centred ${leaving ? "leaving" : ""}`}>
            <GlowFrame waveScale={waveScale} reactive={reactive} />
            <div className="preshow-left">
                {host ? (
                    <HostText line={host} />
                ) : (
                    <Typewriter
                        lines={target ? waitingScript(homes, target) : HOLDING_SCRIPT}
                        intro={target && full ? BYTE_FULL_INTRO : undefined}
                        // From the moment the byte filled (same instant on every screen), else time 0.
                        startAt={target && full && tickets?.fullAt ? tickets.fullAt : 0}
                        // Final stretch before the show: type the script through once and hold
                        // the last line, so TV and phones finish together as the show starts.
                        loop={stage !== "countdown"}
                        {...type}
                    />
                )}
                {left <= COUNTDOWN_FROM_MS && <p className="time-left">{fmtLeft(left)}</p>}
                {seat && <p className="quiet-line">{fmtSeat(seat)}</p>}
            </div>
        </div>
    );
}
