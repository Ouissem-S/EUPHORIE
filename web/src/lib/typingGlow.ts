/**
 * Typed text moves the glow, on every screen, a little unevenly, like speech.
 *
 * Phones (screens with a .glow-flare): each letter flashes the flare with a Web Animation
 * on opacity. It runs on the GPU and touches nothing else, so typing stays smooth.
 *
 * TV (no flare): --type on <html> rises while letters keep coming and eases back once the
 * line is done; the CSS uses whichever of --type / --voice is higher, so they never fight.
 */

const FLARE_FADE_MS = 700; // each letter's flash fades out over this

const HOLD_MS = 140; // a gap longer than this between letters = silence

let lastLetter = -Infinity;
let target = 0;
let level = 0;
let raf = 0;

function frame(now: number) {
    if (now - lastLetter > HOLD_MS) target = 0;
    level += (target - level) * (target > level ? 0.35 : 0.05);
    const style = document.documentElement.style;
    if (target === 0 && level < 0.01) {
        style.setProperty("--type", "0");
        raf = 0;
        return;
    }
    style.setProperty("--type", level.toFixed(3));
    raf = requestAnimationFrame(frame);
}

/** Call for each letter as it appears. Spaces don't "speak", so words come out in bursts. */
export function typingGlow(ch: string | undefined) {
    if (!ch?.trim()) return;
    const peak = 0.55 + Math.random() * 0.45;

    const flares = document.querySelectorAll<HTMLElement>(".glow-flare");
    if (flares.length) {
        // Each flash replaces the last, so steady typing holds it bright and flickering.
        flares.forEach((f) => f.animate([{ opacity: peak }, { opacity: 0 }], { duration: FLARE_FADE_MS, easing: "ease-out" }));
        return;
    }

    lastLetter = performance.now();
    target = peak;
    if (!raf) raf = requestAnimationFrame(frame);
}
