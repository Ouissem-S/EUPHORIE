/** Fixed noise that bends the glow's inner edge into big, soft blobs. */
function WaveFilter({ id, seed, scale }: { id: string; seed: number; scale: number }) {
    return (
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.0025 0.0035" numOctaves="2" seed={seed} />
            <feDisplacementMap in="SourceGraphic" scale={scale} />
            <feGaussianBlur stdDeviation="2.5" />
        </filter>
    );
}

/**
 * The band's intro screen: thick orange glow with a blobby inner edge, smoky dark centre.
 * Two glow layers with different (static) bends; CSS cross-fades and drifts them, so the
 * edge morphs smoothly without re-running the SVG filter every frame.
 */
export default function GlowFrame({ waveScale = 100, reactive = false }: {
    waveScale?: number;
    /** Waves react to the voice (TV). Off on phones: an extra filtered layer makes them lag. */
    reactive?: boolean;
}) {
    return (
        <>
            <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
                <WaveFilter id="glow-wave-a" seed={7} scale={waveScale} />
                <WaveFilter id="glow-wave-b" seed={23} scale={waveScale} />
                {/* Deeper bend, faded in while the host speaks (--voice) */}
                {reactive && <WaveFilter id="glow-wave-speak" seed={41} scale={waveScale * 2} />}

                {/* Faint warm smoke texture for the dark centre */}
                <filter id="smoke">
                    <feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="4" seed="2" />
                    <feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.18  0 0 0 0 0.08  0 0 0 0.9 0" />
                </filter>
            </svg>

            <svg className="glow-smoke" aria-hidden>
                <rect width="100%" height="100%" filter="url(#smoke)" />
            </svg>
            {/* Reacts to the host voice (--voice): brighter overall, and the calm waves
                cross-fade into deeper, faster ones. Only opacity/brightness change per frame,
                so no SVG bend is recomputed. */}
            <div className="glow-voice">
                <div className="glow-calm">
                    <div className="glow-frame" />
                    <div className="glow-frame alt" />
                </div>
                {reactive && <div className="glow-frame speak" />}
                <div className="glow-rim" />
                {/* Phones: typing / kick drums fade this in (opacity only; see .glow-flare) */}
                {!reactive && <div className="glow-flare" />}
            </div>
        </>
    );
}
