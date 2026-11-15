/**
 * The phone's real flashlight, blinked on shakes. Android Chrome only: iPhones/Safari
 * can't drive the torch from a web page, so it's skipped there. Never throws.
 */

export const TORCH_POSSIBLE = !/iPhone|iPad/.test(navigator.userAgent) && !!navigator.mediaDevices?.getUserMedia;
const MAX_PER_S = 3;

export type TorchState = "off" | "on" | "unsupported";
export let torchState: TorchState = TORCH_POSSIBLE ? "off" : "unsupported";

let track: MediaStreamTrack | null = null;
let asked = false;
const recent: number[] = []; // flash times in the last second

/** Call from a tap: asks for the back camera once and keeps its track if it has a torch. */
export async function enableTorch() {
    if (!TORCH_POSSIBLE || asked) return;
    asked = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const t = stream.getVideoTracks()[0];
        const caps = t?.getCapabilities?.() as { torch?: boolean } | undefined;
        if (t && caps?.torch) track = t;
        else {
            stream.getTracks().forEach((s) => s.stop());
            torchState = "unsupported";
        }
    } catch {
        torchState = "unsupported"; // denied or no camera
    }
}

const set = (on: boolean) =>
    track!
        .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
        .then(() => void (torchState = on ? "on" : "off"), () => {});

/** Blink the torch for `ms`; dropped if it already blinked 3 times this second. */
export function flashTorch(ms = 120) {
    if (!track || track.readyState !== "live") return;
    const now = performance.now();
    while (recent.length && now - recent[0] >= 1000) recent.shift();
    if (recent.length >= MAX_PER_S) return;
    recent.push(now);
    void set(true).then(() => setTimeout(() => void set(false), ms));
}
