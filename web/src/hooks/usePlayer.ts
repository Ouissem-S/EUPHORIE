import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { SEGMENTS, VIDEO_ID } from "../config";
import type { Live } from "../lib/live";
import { createPlayer, PLAYING } from "../lib/youtube";
import type { YTPlayer } from "../lib/youtube";

/** YouTube player (loaded and paused, ready to go) that reports its position to the server. */
export function usePlayer(el: RefObject<HTMLDivElement | null>, live: Live) {
    const player = useRef<YTPlayer>(null);

    useEffect(() => {
        if (el.current && VIDEO_ID) {
            createPlayer(el.current, VIDEO_ID, SEGMENTS[0].start).then((p) => (player.current = p));
        }
    }, [el]);

    // Tell this home's phones where playback is, 4 times a second.
    useEffect(() => {
        const id = setInterval(() => {
            const p = player.current;
            if (!p?.getCurrentTime) return;
            live.send({
                type: "position",
                video_time: p.getCurrentTime(),
                at: live.clock.serverNow(),
                playing: p.getPlayerState() === PLAYING,
            });
        }, 250);
        return () => clearInterval(id);
    }, [live]);

    return player;
}
