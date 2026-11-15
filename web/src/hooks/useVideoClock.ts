import { useCallback, useEffect, useRef } from "react";
import type { Live, Msg } from "../lib/live";

interface Position {
    video_time: number; // seconds into the video
    at: number; // server ms when the TV read it
    playing: boolean;
}

/**
 * Where the TV's video is right now, from its "position" messages (4 a second), carried
 * forward on the synced server clock. Until the first one arrives it uses `fallback`
 * (e.g. worked out from the show's start time); null if there's neither.
 */
export function useVideoClock(live: Live, fallback?: () => number | null) {
    const fb = useRef(fallback);
    fb.current = fallback;

    const pos = useRef<Position | null>(null);

    useEffect(() => {
        const off = live.on((m: Msg) => {
            if (m.type === "position") pos.current = { video_time: m.video_time, at: m.at, playing: m.playing };
        });
        return () => void off();
    }, [live]);

    return useCallback(() => {
        const p = pos.current;
        if (!p) return fb.current?.() ?? null;
        return p.playing ? p.video_time + (live.clock.serverNow() - p.at) / 1000 : p.video_time;
    }, [live]);
}
