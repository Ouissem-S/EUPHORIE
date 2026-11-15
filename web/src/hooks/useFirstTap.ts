import { useEffect, useRef, useState } from "react";

/**
 * Phones only allow sound and keeping the screen on after a touch.
 * Returns false until the first tap anywhere; that tap requests the screen wake lock
 * (re-requested whenever the page comes back to the front). Sound is unlocked by the
 * same tap in lib/voice.ts.
 */
export function useFirstTap(onFirstTap?: () => void) {
    const [tapped, setTapped] = useState(false);
    const callback = useRef(onFirstTap);
    callback.current = onFirstTap;

    useEffect(() => {
        let lock: { release(): Promise<void> } | null = null;
        // Wake lock needs https; on the plain-http LAN demo it's simply unavailable.
        const wake = () => {
            const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<typeof lock> } }).wakeLock;
            wl?.request("screen").then((l) => (lock = l), () => {});
        };
        const onTap = () => {
            window.removeEventListener("pointerup", onTap);
            window.removeEventListener("touchend", onTap);
            setTapped(true);
            wake();
            callback.current?.(); // still inside the tap: permission prompts are allowed here
        };
        const onVisible = () => document.visibilityState === "visible" && lock !== null && wake();

        window.addEventListener("pointerup", onTap);
        window.addEventListener("touchend", onTap); // iPhone's motion prompt is surest from a touchend
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.removeEventListener("pointerup", onTap);
            window.removeEventListener("touchend", onTap);
            document.removeEventListener("visibilitychange", onVisible);
            void lock?.release();
        };
    }, []);

    return tapped;
}
