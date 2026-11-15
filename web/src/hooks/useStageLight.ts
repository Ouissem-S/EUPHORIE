import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { CUES_URL } from "../config";
import { loadCues, stateAt } from "../lib/cues";
import { beatFollower } from "../lib/beatPulse";
import type { Cue } from "../lib/cues";
import type { YTPlayer } from "../lib/youtube";
import type { Stage } from "./useSchedule";

const PRESHOW_GLOW = "#1a0d05";

/**
 * Every frame: the light edges follow the cue sheet during the show (colour and drum
 * pulses), warm glow before it.
 */
export function useStageLight(stage: Stage, player: RefObject<YTPlayer>) {
    const cues = useRef<Cue[]>([]);
    const stageRef = useRef(stage);
    stageRef.current = stage;

    useEffect(() => {
        loadCues(CUES_URL).then((c) => (cues.current = c));
    }, []);

    useEffect(() => {
        let raf = 0;
        let last = "";
        const beats = beatFollower();
        const loop = () => {
            let colour = PRESHOW_GLOW;
            if (stageRef.current === "show") {
                const t = player.current?.getCurrentTime?.() ?? 0;
                colour = stateAt(cues.current, t).colour;
                beats(cues.current, t);
            } else beats(cues.current, null);
            // Only touch the DOM when the colour actually changes: every write restyles the page.
            if (colour !== last) {
                document.documentElement.style.setProperty("--stage", colour);
                last = colour;
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [player]);
}
