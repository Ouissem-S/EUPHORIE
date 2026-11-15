import { useEffect, useState } from "react";
import type { Live } from "../lib/live";
import { HIT_THRESHOLD, motionStats, requestMotionPermission } from "../lib/motion";

const HIT_LABEL_MS = 500; // "HIT" stays up this long

/**
 * /phone?test=1: each step of a drum hit, live, to see where the chain breaks:
 * secure page → permission → motion events → magnitude → hit → sent to the server.
 */
export default function MotionPanel({ live }: { live: Live }) {
    const [, redraw] = useState(0);
    const [rate, setRate] = useState(0); // devicemotion events per second

    useEffect(() => {
        let last = motionStats.events;
        const draw = setInterval(() => redraw((n) => n + 1), 100);
        const count = setInterval(() => {
            setRate(motionStats.events - last);
            last = motionStats.events;
        }, 1000);
        return () => (clearInterval(draw), clearInterval(count));
    }, []);

    const s = motionStats;
    const secure = window.isSecureContext;
    const ok = s.permission === "granted" || s.permission === "not needed";
    const hitNow = performance.now() - s.lastHitAt < HIT_LABEL_MS && s.hits > 0;
    const mark = (good: boolean) => (good ? "good" : "bad");
    return (
        <div className="debug-overlay motion-panel">
            <div className={mark(secure)}>1 secure page: {String(secure)}</div>
            <div className={mark(ok)}>2 permission: {s.permission}</div>
            <div className={mark(rate > 0)}>3 events: {rate}/s</div>
            <div>4 magnitude: {s.accel.toFixed(1)} m/s² ({s.source})</div>
            <div className={hitNow ? "good" : ""}>
                5 hit at {HIT_THRESHOLD}: {hitNow ? "HIT" : "—"} · detected {s.hits}
            </div>
            <div className={mark(live.open)}>
                6 sent: {s.sent} · socket {live.open ? "open" : "closed"}
            </div>
            {/* iPhone only asks from a real tap: this button is one, whatever happened before */}
            {!ok && <button onClick={() => void requestMotionPermission()}>Enable motion</button>}
            {/* A plain "denied" with no prompt = the iPhone remembered an earlier "Don't Allow" */}
            {s.permission === "denied" && (
                <div className="bad">
                    iPhone remembered "Don't Allow":
                    <br />
                    close Safari completely, reopen,
                    <br />
                    scan again and tap Allow.
                </div>
            )}
        </div>
    );
}
