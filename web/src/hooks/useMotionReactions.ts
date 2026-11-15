import { useEffect, useRef, useState } from "react";
import type { Live, Msg } from "../lib/live";
import { startMotion } from "../lib/motion";
import { crowdLoop, playOnce, preloadCrowdSound, swell } from "../lib/crowdAudio";

const CLAP = "/sounds/clap.mp3";
const CHEER = "/sounds/cheer.mp3";
const CHEER_SEND_MS = 1000;   // "cheer" gesture this often while jumping
const OTHERS_CLAP_MAX = 6;    // claps from other homes played at once
const OTHERS_VOLUME = 0.25;

/**
 * The phone's motion during the show: clap (sound + white flash), jump (cheer loop +
 * brighter light), sway (light dims as you tilt; --sway on <html>), raised (light goes
 * white like a flashlight). Gestures go to the server; other homes' claps and cheers
 * come back through the crowd relay and play quietly.
 * `debug` (a span) gets live sensor values and the last event when given.
 */
export function useMotionReactions(live: Live, debug?: React.RefObject<HTMLSpanElement | null>) {
    const [flash, setFlash] = useState(0); // bump to replay the white flash
    const [jumping, setJumping] = useState(false);
    const [raised, setRaised] = useState(false);
    const lastEvent = useRef("—");

    useEffect(() => {
        preloadCrowdSound(CLAP);
        preloadCrowdSound(CHEER);
        const cheer = crowdLoop(CHEER);
        const root = document.documentElement.style;
        let cheerTimer = 0;
        let sway = -1;
        let swaying = false;
        let shownAt = 0;

        const stop = startMotion({
            onClap() {
                lastEvent.current = "CLAP";
                void playOnce(CLAP);
                setFlash((n) => n + 1);
                live.send({ type: "gesture", kind: "clap" });
            },
            onJump(active) {
                lastEvent.current = active ? "JUMP" : "JUMP end";
                setJumping(active);
                void cheer.to(active ? 1 : 0, active ? 1 : 1.5);
                clearInterval(cheerTimer);
                if (active) {
                    live.send({ type: "gesture", kind: "cheer" });
                    cheerTimer = window.setInterval(() => live.send({ type: "gesture", kind: "cheer" }), CHEER_SEND_MS);
                }
            },
            onRaised(up) {
                lastEvent.current = up ? "UP" : "DOWN";
                setRaised(up);
                live.send({ type: "raised", up });
            },
            onSway(tilt) {
                const q = Math.round(tilt * 50) / 50; // only restyle on visible steps
                if (q !== sway) root.setProperty("--sway", String((sway = q)));
                if (!swaying && tilt > 0.3) lastEvent.current = "SWAY";
                swaying = tilt > 0.3;
            },
            onSample({ beta, gamma, accel }) {
                const el = debug?.current;
                const now = performance.now();
                if (!el || now - shownAt < 100) return;
                shownAt = now;
                el.textContent = `β ${beta.toFixed(0)}° γ ${gamma.toFixed(0)}° a ${accel.toFixed(1)} · ${lastEvent.current}`;
            },
        });

        // Other homes' claps and cheers (the crowd relay), quietly.
        const off = live.on((m: Msg) => {
            if (m.type !== "crowd" || !m.others) return;
            const claps = Math.min(OTHERS_CLAP_MAX, Number(m.others.clap) || 0);
            for (let i = 0; i < claps; i++) void playOnce(CLAP, OTHERS_VOLUME, Math.random() * 0.15);
            if (Number(m.others.cheer) > 0) void swell(CHEER, OTHERS_VOLUME);
        });

        return () => {
            stop();
            off();
            clearInterval(cheerTimer);
            void cheer.to(0, 0.3);
            root.removeProperty("--sway");
            live.send({ type: "raised", up: false }); // leaving the show: not holding it up any more
        };
    }, [live, debug]);

    return { flash, jumping, raised };
}
