import { useState } from "react";

const APPEAR = 1.0; // s of pure black before the name snaps on

/**
 * The band's name out of the dark: an instant blackout, then the name cuts in at full
 * brightness (no fade). `elapsed` is seconds since the reveal cue, on the video's clock,
 * so late joiners land at the same point.
 */
export default function Reveal({ elapsed }: { elapsed: number }) {
    const [imgFailed, setImgFailed] = useState(false);

    return (
        <div className="reveal">
            {/* Always mounted (hidden until APPEAR) so the image is loaded before it's needed. */}
            <div className="reveal-name" style={{ visibility: elapsed >= APPEAR ? "visible" : "hidden" }}>
                {/* The name, then two hotter copies faded in by opacity: the pulse and the kick drum */}
                {["", "hot pulse", "hot beat"].map((extra, i) =>
                    imgFailed ? (
                        <p key={i} className={`reveal-text ${extra}`} aria-hidden={i > 0}>
                            THE NEIGHBOURHOOD
                        </p>
                    ) : (
                        <img
                            key={i}
                            className={`reveal-img ${extra}`}
                            src="/brand/reveal.png"
                            alt={i ? "" : "The Neighbourhood"}
                            onError={() => setImgFailed(true)}
                        />
                    ),
                )}
            </div>
        </div>
    );
}
