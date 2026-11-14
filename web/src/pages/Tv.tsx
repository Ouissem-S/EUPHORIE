import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { SEGMENTS, VIDEO_ID, wsUrl } from "../config";
import { Live } from "../lib/live";
import type { Msg } from "../lib/live";
import { PLAYING } from "../lib/youtube";
import { useSchedule } from "../hooks/useSchedule";
import { usePlayer } from "../hooks/usePlayer";
import { useStageLight } from "../hooks/useStageLight";
import Preshow from "../components/Preshow";

function homeIdFromUrl() {
    const q = new URLSearchParams(location.search).get("home");
    if (q) return q.toUpperCase();
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const id = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
    history.replaceState(null, "", `/tv?home=${id}`);
    return id;
}

/**
 * The TV / laptop. The start is controlled from your control phone only.
 * Local test keys: Space play/pause · 1–3 jump to a song.
 */
export default function Tv() {
    const home = useMemo(homeIdFromUrl, []);
    const live = useMemo(() => new Live(wsUrl(home, "tv")), [home]);
    const joinUrl = `${location.origin}/phone?home=${home}`;

    const playerEl = useRef<HTMLDivElement>(null);
    const player = usePlayer(playerEl, live);
    const { schedule, stage, now } = useSchedule(live, (prev, next) => {
        const p = player.current;
        if (next === "show") p?.playVideo?.();
        if (prev === "show") {
            // Reset from your control phone: back to the start, paused.
            p?.pauseVideo?.();
            p?.seekTo?.(SEGMENTS[0].start, true);
        }
    });
    useStageLight(stage, player);

    const [qr, setQr] = useState("");
    const [presence, setPresence] = useState({ homes: 0, phones: 0 });
    const [soundOn, setSoundOn] = useState(false);

    useEffect(() => {
        QRCode.toDataURL(joinUrl, { margin: 1, width: 320, color: { dark: "#ffffff", light: "#00000000" } }).then(setQr);
        return () => live.close();
    }, [joinUrl, live]);

    useEffect(() => {
        const off = live.on((m: Msg) => {
            if (m.type === "presence") setPresence({ homes: m.homes, phones: m.phones });
        });
        return () => void off();
    }, [live]);

    // Local test keys only (the real start comes from your control phone).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const p = player.current;
            if (!p) return;
            if (e.key === " ") {
                e.preventDefault();
                p.getPlayerState() === PLAYING ? p.pauseVideo() : p.playVideo();
            }
            const n = Number(e.key);
            if (n >= 1 && n <= SEGMENTS.length) p.seekTo(SEGMENTS[n - 1].start, true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [player]);

    return (
        // One click on the TV when you set it up: browsers only allow sound after a click.
        <div className="tv" onClick={() => setSoundOn(true)}>
            <div className="sidebar" />
            <div className="tv-center">
                <div className="video-frame">
                    <div ref={playerEl} />
                    {!VIDEO_ID && <div className="video-missing">Set VIDEO_ID in src/config.ts</div>}
                </div>
                {stage !== "show" && <Preshow stage={stage} schedule={schedule} now={now} qr={qr} soundOn={soundOn} />}
                <div className="hud">
                    <span>EUPHORIE · home {home}</span>
                    <span>{presence.homes} homes · {presence.phones} phones in the crowd</span>
                </div>
            </div>
            <div className="sidebar" />
        </div>
    );
}
