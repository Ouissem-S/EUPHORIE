import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Schedule } from "./useSchedule";
import type { YTPlayer } from "../lib/youtube";

export const OVERLAY_MS = 2600; // "fast forwarding to the finale" (matches .skip-overlay in styles.css)
const DRIFT_S = 4; // live show: seek when the TV's video is further than this from the show

/**
 * The jump from the end of song 1 to the finale, on the TV. The server moves go_at when the
 * show reaches skip.from; this sees go_at change mid-show and seeks the video to the new live
 * position (the phones follow the TV's position). In test mode (no schedule) it does the
 * same jump locally when the video crosses skip.from.
 * `overlay` is true for OVERLAY_MS around a jump; `done` says whether it has happened.
 */
export function useFinaleSkip(player: RefObject<YTPlayer | null>, schedule: Schedule, serverNow: () => number, test: boolean) {
    const [overlay, setOverlay] = useState(false);
    const [testDone, setTestDone] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const showOverlay = () => {
        setOverlay(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setOverlay(false), OVERLAY_MS);
    };
    useEffect(() => () => clearTimeout(hideTimer.current), []);

    // Live show: go_at moved while the show was running → seek to where the show is now.
    const prevGoAt = useRef<number | null>(null);
    const { go_at: goAt, skip } = schedule;
    useEffect(() => {
        const prev = prevGoAt.current;
        prevGoAt.current = goAt;
        if (test || !skip || prev === null || goAt === null || goAt === prev) return;
        const now = serverNow();
        if (now < goAt) return; // a new start time, not a jump mid-show
        const p = player.current;
        p?.seekTo?.(skip.show_start + (now - goAt) / 1000, true);
        p?.playVideo?.();
        showOverlay();
    }, [goAt, skip, test, player, serverNow]);

    // Live show: keep the video where the show is (go_at), whenever this TV is off by more
    // than DRIFT_S: a TV opened or reloaded mid-show (also after the jump), or one that
    // missed the go_at change, catches up instead of playing on from where it was.
    useEffect(() => {
        if (test || !skip || goAt === null) return;
        const id = setInterval(() => {
            const p = player.current;
            const now = serverNow();
            if (!p?.getCurrentTime || now < goAt) return;
            const live = skip.show_start + (now - goAt) / 1000;
            if (Math.abs(p.getCurrentTime() - live) > DRIFT_S) {
                p.seekTo(live, true);
                p.playVideo?.();
            }
        }, 1000);
        return () => clearInterval(id);
    }, [goAt, skip, test, player, serverNow]);

    // Test mode: jump locally when playback crosses skip.from.
    useEffect(() => {
        if (!test || !skip) return;
        let last = -1;
        const id = setInterval(() => {
            const t = player.current?.getCurrentTime?.();
            if (t === undefined) return;
            if (last >= 0 && last < skip.from && t >= skip.from && t < skip.to) {
                player.current?.seekTo?.(skip.to, true);
                setTestDone(true);
                showOverlay();
            }
            last = t;
        }, 200);
        return () => clearInterval(id);
    }, [test, skip, player]);

    return { overlay, done: test ? testDone : schedule.skipped };
}
