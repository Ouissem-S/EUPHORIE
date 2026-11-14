import { useEffect, useState } from "react";

const LINES = [
    "Thank you for joining us.",
    "Get comfortable.",
    "Get your lights ready.",
    "The concert will begin shortly.",
];

/** One line of text in the middle, fading to the next every few seconds. */
export default function RotatingLine({ lines = LINES, everyMs = 6000 }: { lines?: string[]; everyMs?: number }) {
    const [i, setI] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setI((n) => (n + 1) % lines.length), everyMs);
        return () => clearInterval(id);
    }, [lines.length, everyMs]);

    // key={i} restarts the fade-in animation for each new line
    return <p key={i} className="intro-text fade-line">{lines[i]}</p>;
}