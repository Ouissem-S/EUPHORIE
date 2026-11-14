import { useEffect, useRef, useState } from "react";
import type { Live, Msg } from "../lib/live";

export type Stage = "doors" | "holding" | "countdown" | "show";
export interface Schedule {
    starts_at: number | null; // server ms
    approved: boolean;
    go_at: number | null; // server ms
}

const FINAL_COUNTDOWN_MS = 10_000;

function stageFor(s: Schedule, now: number): Stage {
    if (s.go_at && now >= s.go_at) return "show";
    if (s.go_at && now >= s.go_at - FINAL_COUNTDOWN_MS) return "countdown";
    if (s.starts_at && now < s.starts_at) return "doors";
    return "holding";
}

/** Tracks the server schedule and works out the stage on the synced clock. */
export function useSchedule(live: Live, onStageChange: (prev: Stage, next: Stage) => void) {
    const [schedule, setSchedule] = useState<Schedule>({ starts_at: null, approved: false, go_at: null });
    const [stage, setStage] = useState<Stage>("holding");
    const [now, setNow] = useState(0);
    const stageRef = useRef<Stage>("holding");

    // Latest callback in a ref, so a new closure each render doesn't restart the interval.
    const onChange = useRef(onStageChange);
    onChange.current = onStageChange;

    useEffect(() => {
        const off = live.on((m: Msg) => {
            if (m.type === "schedule") setSchedule({ starts_at: m.starts_at, approved: m.approved, go_at: m.go_at });
        });
        return () => void off();
    }, [live]);

    useEffect(() => {
        const id = setInterval(() => {
            const t = live.clock.serverNow();
            setNow(t);
            const next = stageFor(schedule, t);
            const prev = stageRef.current;
            if (next === prev) return;
            stageRef.current = next;
            setStage(next);
            onChange.current(prev, next);
        }, 100);
        return () => clearInterval(id);
    }, [schedule, live]);

    return { schedule, stage, now };
}
