import { useState } from "react";

/**
 * The e-ticket, after "hold your screen to keep your ticket": black, the band's logo glowing
 * softly, the lines, the seat, the show and the date. It fades in and stays: only the small
 * "save again" does anything (in case the automatic download was blocked).
 */
export default function Ticket({ seat, show, date, onSave }: { seat?: string; show: string; date: string; onSave?: () => void }) {
    const [logoFailed, setLogoFailed] = useState(false);
    return (
        <div className="ticket-page">
            {!logoFailed && (
                <img className="ticket-logo" src="/brand/reveal.png" alt="The Neighbourhood" onError={() => setLogoFailed(true)} />
            )}
            <h1 className="ticket-heading">Here is your ticket</h1>
            <p className="ticket-sub">Your e-souvenir of the night. Hope you enjoyed the show.</p>
            <div className="ticket-details">
                {seat && <p className="ticket-seat">{seat}</p>}
                <p>{show}</p>
                <p>{date}</p>
            </div>
            {onSave && (
                <button className="ticket-again" onClick={onSave}>
                    save again
                </button>
            )}
        </div>
    );
}
