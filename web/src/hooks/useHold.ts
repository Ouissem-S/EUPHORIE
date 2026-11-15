import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";

const RELEASE_MS = 700; // a full fill drains back in this (an early release: less)

/** A light tap of vibration (Android; iPhones have no web vibration, so nothing happens there). */
const buzz = (ms: number) => navigator.vibrate?.(ms);

/**
 * Press and hold anywhere for `ms`. `build` makes the fill's Web Animations (paused at 0):
 * they play forward while held and backwards on release, on the GPU, with no JS per frame.
 * `onComplete` fires once when they reach the end. Spread `handlers` on the element to hold.
 */
export function useHold(enabled: boolean, build: (ms: number) => Animation[], onComplete: () => void, ms = 2500) {
    const anims = useRef<Animation[]>([]);
    const done = useRef(false);
    const latest = useRef({ build, onComplete });
    latest.current = { build, onComplete };

    useEffect(() => {
        if (!enabled) return;
        const list = latest.current.build(ms);
        list.forEach((a) => a.pause());
        if (list[0]) {
            list[0].onfinish = () => {
                if (list[0].playbackRate < 0 || done.current) return; // drained back to 0
                done.current = true;
                buzz(40);
                latest.current.onComplete();
            };
        }
        anims.current = list;
        return () => list.forEach((a) => a.cancel());
    }, [enabled, ms]);

    const run = (rate: number) =>
        anims.current.forEach((a) => {
            a.playbackRate = rate;
            a.play();
        });
    const release = () => {
        if (!done.current) run(-ms / RELEASE_MS);
    };
    const handlers = {
        onPointerDown(e: PointerEvent) {
            if (!enabled || done.current) return;
            e.preventDefault();
            run(1);
            buzz(10);
        },
        onPointerUp: release,
        onPointerCancel: release,
        onPointerLeave: release,
        onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    };
    return { handlers };
}
