/**
 * Phone motion → crowd gestures: phone RAISED like a lighter, CLAP (a sharp shake),
 * JUMP (repeated vertical bounces), SWAY (tilting left/right).
 *
 * Needs a secure page (https or localhost): browsers don't send motion to plain http.
 * iPhones also need requestMotionPermission() inside a tap.
 */

// ---- tuning ----
const RAISED_BETA = [60, 110];   // ° forward tilt that counts as "held up"
const RAISED_ON_MS = 1000;       // held up this long → raised
const RAISED_OFF_MS = 500;       // out of range this long → lowered
const CLAP_ACCEL = 16;           // m/s², shake strength (gravity removed)
const CLAP_GAP_MS = 180;         // at most one clap per this
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
}

export interface MotionHandlers {
    onRaised?(isUp: boolean): void;
    onClap?(): void;
    onJump?(active: boolean): void;
    onSway?(tilt: number): void;
    onSample?(s: MotionSample): void; // every motion event (debug)
}

/** True once motion is allowed (or doesn't need asking). */
export let motionAllowed = false;

type PermissionApi = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Call inside a tap. iPhone asks; elsewhere motion is just on. Never throws. */
export async function requestMotionPermission() {
    const DM = (typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : undefined) as PermissionApi | undefined;
    const DO = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : undefined) as PermissionApi | undefined;
    if (!DM) return;
    if (!DM.requestPermission) return void (motionAllowed = true);
    try {
        const [m, o] = await Promise.all([DM.requestPermission(), DO?.requestPermission?.() ?? Promise.resolve("granted")]);
        motionAllowed = m === "granted" && o === "granted";
    } catch {
        motionAllowed = false;
    }
}

export function startMotion(h: MotionHandlers): () => void {
    let beta = 0, gamma = 0;
    let up = false, inRangeSince = -1, outRangeSince = -1;
    let lastClap = -Infinity;
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
        if (!a || a.x === null || !ag || ag.x === null) return;
        const now = performance.now();
        const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0;
        const accel = Math.hypot(ax, ay, az);
        h.onSample?.({ beta, gamma, accel });

        if (accel > CLAP_ACCEL && now - lastClap >= CLAP_GAP_MS) {
            lastClap = now;
            h.onClap?.();
        }

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
