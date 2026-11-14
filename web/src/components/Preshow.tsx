import { SHOW } from "../config";
import { fmtClock, fmtLeft } from "../lib/format";
import type { Schedule, Stage } from "../hooks/useSchedule";
import GlowFrame from "./GlowFrame";
import RotatingLine from "./RotatingLine";

interface Props {
    stage: Exclude<Stage, "show">;
    schedule: Schedule;
    now: number;
    qr: string;
    soundOn: boolean;
}

/** Doors / holding / countdown screen shown over the video before the show. */
export default function Preshow({ stage, schedule, now, qr, soundOn }: Props) {
    return (
        <div className={`preshow ${stage === "holding" ? "breathing" : ""}`}>
            <GlowFrame />

            <h1>EUPHORIE</h1>
            <p className="intro-text">
                {SHOW.artist} · {SHOW.venue}
            </p>

            {stage === "doors" && schedule.starts_at && (
                <>
                    <p className="muted">Show starts at {fmtClock(schedule.starts_at)}</p>
                    <p className="doors-left">{fmtLeft(schedule.starts_at - now)}</p>
                </>
            )}

            {stage === "holding" && <RotatingLine />}

            {stage === "countdown" && schedule.go_at && (
                <p className="countdown">{Math.max(0, Math.ceil((schedule.go_at - now) / 1000))}</p>
            )}

            {stage !== "countdown" && (
                <>
                    {qr && <img className="qr" src={qr} alt="Scan to join" />}
                    <p className="muted">Scan to join · get your lights ready</p>
                </>
            )}

            {!soundOn && <p className="muted small">Click anywhere once to enable sound</p>}
        </div>
    );
}