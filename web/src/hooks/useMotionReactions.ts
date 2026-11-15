import { useEffect, useRef, useState } from "react";
import type { Live, Msg } from "../lib/live";
import { motionStats, startMotion } from "../lib/motion";
import { crowdLoop, playOnce, preloadCrowdSound, swell } from "../lib/crowdAudio";
import { flashTorch, torchState } from "../lib/torch";

const CLAP = "/sounds/clap.mp3";
const CHEER = "/sounds/cheer.mp3";
const CHEER_SEND_MS = 1000;   // "cheer" gesture this often while jumping
const OTHERS_CLAP_MAX = 6;    // claps from other homes played at once
const OTHERS_VOLUME = 0.25;
const SHAKE_PALETTE = ["#0033ff", "#ffffff", "#7b00ff", "#00e5ff", "#ff0066", "#ffaa00"];
const SHAKE_COLOUR_MS = 1500; // a shake's colour holds this long, then back to the cue colour

/**
 * The phone's motion during the show: clap (sound + white flash), jump (cheer loop +
 * brighter light), sway (light dims as you tilt; --sway on <html>), raised (light goes
 * white like a flashlight). Gestures go to the server; other homes' claps and cheers
 * come back through the crowd relay and play quietly.
 * A shake (clap) only counts while `canShake()` is true (the "show" scene): it flashes
 * white, then the light takes the next SHAKE_PALETTE colour for 1.5 s, and blinks the
 * real torch on Android when enabled.
 * `debug` (a span) gets live sensor values, shakes and the torch state when given.
 */
export function useMotionReactions(
    live: Live,
    canShake: () => boolean,
    debug?: React.RefObject<HTMLSpanElement | null>,
) {
    const [flash, setFlash] = useState(0); // bump to replay the white flash
    const [shakeColour, setShakeColour] = useState<string | null>(null);
    const canShakeRef = useRef(canShake);
    canShakeRef.current = canShake;
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
        let shakes = 0;
        let hits = 0;
        let palette = 0;
        let colourTimer = 0;

        const stop = startMotion({
            onClap() {
                lastEvent.current = `shake ×${++shakes}`;
                if (!canShakeRef.current()) return;
                void playOnce(CLAP); // silent if the file is missing
                setFlash((n) => n + 1);
                flashTorch(120);
                live.send({ type: "gesture", kind: "clap" });
                // White flash first, then the next palette colour for 1.5 s.
                const colour = SHAKE_PALETTE[palette++ % SHAKE_PALETTE.length];
                clearTimeout(colourTimer);
                colourTimer = window.setTimeout(() => {
                    setShakeColour(colour);
                    colourTimer = window.setTimeout(() => setShakeColour(null), SHAKE_COLOUR_MS);
                }, 120);
            },
            onHit(strength) {
                if (!canShakeRef.current()) return;
                hits++;
                lastEvent.current = `HIT ${strength.toFixed(2)} (×${hits})`;
                live.send({ type: "gesture", kind: "hit", strength });
                motionStats.sent++;
                setFlash((n) => n + 1); // the short white flash
                navigator.vibrate?.(15);
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
            onSample({ beta, gamma, accel, peak }) {
                const el = debug?.current;
                const now = performance.now();
                if (!el || now - shownAt < 100) return;
                shownAt = now;
                el.textContent = `β ${beta.toFixed(0)}° γ ${gamma.toFixed(0)}° a ${accel.toFixed(1)} peak ${peak.toFixed(1)} · ${lastEvent.current} · torch: ${torchState}`;
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
            clearTimeout(colourTimer);
            void cheer.to(0, 0.3);
            root.removeProperty("--sway");
            live.send({ type: "raised", up: false }); // leaving the show: not holding it up any more
        };
    }, [live, debug]);

    return { flash, shakeColour, jumping, raised };
}
