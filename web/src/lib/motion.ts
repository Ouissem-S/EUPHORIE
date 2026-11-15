/**
 * Phone motion → crowd gestures: phone RAISED like a lighter, CLAP (a sharp shake),
 * JUMP (repeated vertical bounces), SWAY (tilting left/right).
 *
 * Needs a secure page (https or localhost): browsers don't send motion to plain http.
 * iPhones also need requestMotionPermission() inside a tap.
 */

// ---- tuning ----
const SHAKE_THRESHOLD = 9;       // m/s² on the dominant axis (gravity removed); was 16
const SHAKE_REVERSE_MS = 300;    // the opposite swing must follow within this: back-and-forth, not a bump
const SHAKE_SETTLE_MS = 1000;    // readings ignored this long after permission / start (sensors settling)
const PEAK_WINDOW_MS = 1000;     // debug "peak": strongest reading over this window
const RAISED_BETA = [60, 110];   // ° forward tilt that counts as "held up"
const RAISED_ON_MS = 1000;       // held up this long → raised
const RAISED_OFF_MS = 500;       // out of range this long → lowered
const CLAP_GAP_MS = 180;         // at most one clap (shake) per this
export const HIT_THRESHOLD = 12; // m/s² (gravity removed): a sharp jolt = a drum hit (tune with ?test=1)
const HIT_FULL = 30;             // m/s² that counts as a full-strength hit
const HIT_GAP_MS = 150;          // one hit counts once
const GRAVITY_EASE = 0.1;        // low-pass for the gravity estimate when only accelerationIncludingGravity exists
const JUMP_PEAK = 6;             // m/s² along gravity
const JUMP_SPACING_MS = [300, 900]; // time between bounces of a real jump
const JUMP_ON_PEAKS = 2;         // this many bounces in a row → jumping
const JUMP_OFF_MS = 1200;        // no bounce this long → stopped
const JUMP_AFTER_CLAP_MS = 300;  // shakes aren't jumps
const SWAY_FULL_DEG = 35;        // |gamma| of full sway
const SWAY_EASE = 0.1;

export interface MotionSample {
    beta: number;
    gamma: number;
    accel: number; // |acceleration| without gravity
    peak: number;  // strongest dominant-axis reading in the last second (tune SHAKE_THRESHOLD with it)
}

export interface MotionHandlers {
    onRaised?(isUp: boolean): void;
    onClap?(): void;
    onHit?(strength: number): void; // 0–1: a sharp jolt, like hitting a drum in the air
    onJump?(active: boolean): void;
    onSway?(tilt: number): void;
    onSample?(s: MotionSample): void; // every motion event (debug)
}

/** Live facts for the ?test=1 panel (MotionPanel); the show itself never reads them. */
export const motionStats = {
    permission: "not asked yet", // granted / denied / not needed / unsupported
    events: 0,                   // devicemotion events received
    source: "—",                 // which reading the magnitude comes from
    accel: 0,                    // live magnitude, m/s², gravity removed
    hits: 0,                     // threshold crossings
    lastHitAt: 0,                // performance.now() of the last one
    sent: 0,                     // hit messages sent to the server
};

/** True once motion is allowed (or doesn't need asking). */
export let motionAllowed = false;
let permittedAt = 0; // performance.now() when motion was allowed

const allow = (ok: boolean) => {
    motionAllowed = ok;
    if (ok) permittedAt = performance.now();
};

type PermissionApi = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Call inside a tap. iPhone asks; elsewhere motion is just on. Never throws. */
export async function requestMotionPermission() {
    const DM = (typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : undefined) as PermissionApi | undefined;
    const DO = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : undefined) as PermissionApi | undefined;
    if (!DM) return void (motionStats.permission = "unsupported (no motion sensor API)");
    if (!DM.requestPermission) {
        motionStats.permission = "not needed";
        return allow(true);
    }
    try {
        // Both calls start here, before any await: still inside the tap, as iPhones require.
        const [m, o] = await Promise.all([DM.requestPermission(), DO?.requestPermission?.() ?? Promise.resolve("granted")]);
        allow(m === "granted" && o === "granted");
        motionStats.permission = motionAllowed ? "granted" : "denied";
    } catch (e) {
        allow(false);
        motionStats.permission = `denied (${e instanceof Error ? e.message : e})`;
    }
}

export function startMotion(h: MotionHandlers): () => void {
    let beta = 0, gamma = 0;
    let up = false, inRangeSince = -1, outRangeSince = -1;
    let lastClap = -Infinity;
    let lastHit = -Infinity;
    const startedAt = performance.now();
    let grav: [number, number, number] | null = null; // gravity estimate (fallback path only)
    let swing: { axis: number; sign: number; at: number } | null = null; // last over-threshold swing
    const recent: { at: number; v: number }[] = []; // dominant-axis readings, for the debug peak
    let lastPeak = -Infinity, chain = 0, aboveJump = false, jumping = false;
    let sway = 0;

    const onOrientation = (e: DeviceOrientationEvent) => {
        beta = e.beta ?? 0;
        gamma = e.gamma ?? 0;
        const now = performance.now();

        const inRange = beta >= RAISED_BETA[0] && beta <= RAISED_BETA[1];
        if (inRange) {
            outRangeSince = -1;
            if (inRangeSince < 0) inRangeSince = now;
            if (!up && now - inRangeSince >= RAISED_ON_MS) h.onRaised?.((up = true));
        } else {
            inRangeSince = -1;
            if (outRangeSince < 0) outRangeSince = now;
            if (up && now - outRangeSince >= RAISED_OFF_MS) h.onRaised?.((up = false));
        }

        const target = Math.min(1, Math.abs(gamma) / SWAY_FULL_DEG);
        sway += (target - sway) * SWAY_EASE;
        h.onSway?.(sway);
    };

    const onMotion = (e: DeviceMotionEvent) => {
        const a = e.acceleration, ag = e.accelerationIncludingGravity;
        const hasA = !!a && a.x !== null, hasAg = !!ag && ag.x !== null;
        motionStats.events++;
        motionStats.source = hasA ? "acceleration" : hasAg ? "includingGravity − gravity" : "none (empty events)";
        if (!hasA && !hasAg) return;
        const now = performance.now();
        if (now < Math.max(startedAt, permittedAt) + SHAKE_SETTLE_MS) return; // sensors settling
        const ax = a?.x ?? 0, ay = a?.y ?? 0, az = a?.z ?? 0;

        // Signed acceleration without gravity, per axis. Fallback: take off a slow gravity estimate.
        let lin: number[];
        if (hasA) lin = [ax, ay, az];
        else {
            const raw = [ag!.x ?? 0, ag!.y ?? 0, ag!.z ?? 0] as [number, number, number];
            grav = grav ? (grav.map((g, i) => g + (raw[i] - g) * GRAVITY_EASE) as typeof grav) : raw;
            lin = raw.map((v, i) => v - grav![i]);
        }
        const accel = Math.hypot(lin[0], lin[1], lin[2]);

        // Dominant axis and its signed value.
        const axis = [0, 1, 2].reduce((m, i) => (Math.abs(lin[i]) > Math.abs(lin[m]) ? i : m), 0);
        const v = lin[axis];

        recent.push({ at: now, v: Math.abs(v) });
        while (recent.length && now - recent[0].at > PEAK_WINDOW_MS) recent.shift();
        const peak = recent.reduce((m, r) => Math.max(m, r.v), 0);
        h.onSample?.({ beta, gamma, accel, peak });
        motionStats.accel = accel;

        // A drum hit: one sharp jolt, any direction.
        if (accel > HIT_THRESHOLD && now - lastHit >= HIT_GAP_MS) {
            lastHit = now;
            motionStats.hits++;
            motionStats.lastHitAt = now;
            h.onHit?.(Math.min(1, 0.3 + (0.7 * (accel - HIT_THRESHOLD)) / (HIT_FULL - HIT_THRESHOLD)));
        }

        // A shake: over the threshold one way, then the opposite way on the same axis within 300 ms.
        if (Math.abs(v) > SHAKE_THRESHOLD) {
            const sign = Math.sign(v);
            const reversed = swing && swing.axis === axis && swing.sign === -sign && now - swing.at <= SHAKE_REVERSE_MS;
            if (reversed && now - lastClap >= CLAP_GAP_MS) {
                lastClap = now;
                swing = null; // the next shake needs a fresh back-and-forth
                h.onClap?.();
            } else swing = { axis, sign, at: now };
        }
        if (!hasA || !hasAg) return; // jumps need both readings

        // Vertical bounce: acceleration along the gravity direction.
        const gx = (ag.x ?? 0) - ax, gy = (ag.y ?? 0) - ay, gz = (ag.z ?? 0) - az;
        const g = Math.hypot(gx, gy, gz) || 1;
        const vertical = Math.abs((ax * gx + ay * gy + az * gz) / g);
        const recentClap = now - lastClap < JUMP_AFTER_CLAP_MS;
        if (vertical > JUMP_PEAK && !aboveJump && !recentClap) {
            const dt = now - lastPeak;
            if (dt >= JUMP_SPACING_MS[0]) {
                chain = dt <= JUMP_SPACING_MS[1] ? chain + 1 : 1;
                lastPeak = now;
                if (!jumping && chain >= JUMP_ON_PEAKS) h.onJump?.((jumping = true));
            }
        }
        aboveJump = vertical > JUMP_PEAK;
        if (jumping && now - lastPeak > JUMP_OFF_MS) {
            chain = 0;
            h.onJump?.((jumping = false));
        }
    };

    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    return () => {
        window.removeEventListener("deviceorientation", onOrientation);
        window.removeEventListener("devicemotion", onMotion);
    };
}
