/**
 * Orange glow around the screen edges that slowly waves, like the band's intro screen.
 *
 * The noise filter is static: it is rasterised once and cached. The "wave" comes from
 * cheap CSS transform/opacity animations (see .glow-frame in styles.css) that run on the
 * compositor. Animating feTurbulence itself re-renders a full-screen noise + blur every
 * frame, which exhausts the GPU after a while and crashes the page to white.
 */
export default function GlowFrame() {
    return (
        <>
            <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
                <filter id="glow-wave" x="-10%" y="-10%" width="120%" height="120%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.003 0.004" numOctaves="2" seed="3" />
                    <feDisplacementMap in="SourceGraphic" scale="55" />
                </filter>
            </svg>
            <div className="glow-frame outer" />
            <div className="glow-frame inner" />
        </>
    );
}
