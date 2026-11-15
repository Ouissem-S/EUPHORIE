import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { SEGMENTS, VIDEO_ID, wsUrl } from "../config";
import { Live } from "../lib/live";
import type { Msg } from "../lib/live";
import { PLAYING } from "../lib/youtube";
import { cueCounts } from "../lib/cues";
import { useSchedule, type Stage } from "../hooks/useSchedule";
import { usePlayer } from "../hooks/usePlayer";
import { useStageLight } from "../hooks/useStageLight";
import { useFullscreenKey } from "../hooks/useFullscreenKey";
import { useHostLine } from "../hooks/useHostLine";
import Preshow from "../components/Preshow";
import { enableVoiceGlow } from "../lib/voice";
// The TV's glow reacts to the spoken script (phones skip this: too heavy for them).
enableVoiceGlow();
import { NO_TICKETS, phaseFor, ticketsFrom } from "../lib/phase";

/** How long the waiting room takes to fade into the show (matches .preshow.leaving in styles.css). */
const FADE_TO_SHOW_MS = 3000;
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
// Dev preview: /tv?test=1&t=90 plays the show straight away from 90 s, ignoring the schedule.
const TEST = new URLSearchParams(location.search).get("test") === "1";
const TEST_START_S = Math.max(0, Number(new URLSearchParams(location.search).get("t")) || 0);
const SEEK_STEP_S = 5; // ←/→

/**
 * True for FADE_TO_SHOW_MS after the show's go time (server clock), so the pre-show stays up
 * and fades out over the video. Timed from go_at, not from when this screen noticed: every TV
 * fades together, and a TV opened after the show started goes straight to the video.
 * Also remembers the last pre-show stage to keep showing while it fades.
 */
function useFadeToShow(stage: Stage, goAt: number | null, now: number) {
    const lastPre = useRef<Exclude<Stage, "show">>("holding");
    if (stage !== "show") lastPre.current = stage;
    const leaving = stage === "show" && goAt !== null && now - goAt < FADE_TO_SHOW_MS;
    return { leaving, preStage: lastPre.current };
}

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
 * Local test keys: Space play/pause · ←/→ seek 5 s · 1–3 jump to a song.
 * /tv?test=1&t=90: preview mode, plays the show from 90 s straight after the setup click.
 */
export default function Tv() {
    const home = useMemo(homeIdFromUrl, []);
    const live = useMemo(() => new Live(wsUrl(home, "tv")), [home]);
    // Synced server clock: the phones type the same letter at the same moment.
    const serverNow = useMemo(() => () => live.clock.serverNow(), [live]);
    // "localhost" in the QR would point the phone at itself: use this computer's LAN address instead.
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    const [lanIp, setLanIp] = useState(__LAN_IP__); // from dev-server startup; refreshed below
    useEffect(() => {
        if (!local) return;
        fetch("/lan-ip", { cache: "no-store" })
            .then((r) => (r.ok ? r.text() : ""))
            .then((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim()) && setLanIp(ip.trim()))
            .catch(() => {});
    }, [local]);
    const origin = local ? `${location.protocol}//${lanIp}:${location.port}` : location.origin;
    const joinUrl = `${origin}/phone?home=${home}`;

    const playerEl = useRef<HTMLDivElement>(null);
    const player = usePlayer(playerEl, live);
    const { schedule, stage: scheduledStage, now, ready } = useSchedule(live, (prev, next) => {
        if (TEST) return; // test mode: the schedule never plays, pauses or rewinds the video
        const p = player.current;
        if (next === "show") p?.playVideo?.();
        if (prev === "show") {
            // Reset from your control phone: back to the start, paused.
            p?.pauseVideo?.();
            p?.seekTo?.(SEGMENTS[0].start, true);
        }
    });
    // Test mode: always the show (no pre-show, waiting room, countdown or QR).
    const stage: Stage = TEST ? "show" : scheduledStage;
    useStageLight(stage, player); // light edges: cue-sheet colours and drum pulses

    const [qr, setQr] = useState("");
    const [presence, setPresence] = useState({ homes: 0, phones: 0 });
    const [tickets, setTickets] = useState(NO_TICKETS); // this home's byte and its bits
    const [lightsUp, setLightsUp] = useState(0); // phones held up like lighters, all homes
    const fullscreen = useFullscreenKey();
    const host = useHostLine(live); // lines spoken from the control page

    // One setup click: browsers only let the TV play sound after one.
    const [started, setStarted] = useState(false);
    const start = () => setStarted(true);

    // ?debug=1: the video time (to place "kick" cues), a dot that flashes on each beat,
    // and where the cues came from (hand-made show.json / AI lighting designer ai.json).
    const videoTime = useRef<HTMLSpanElement>(null);
    const cueSource = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!DEBUG) return;
        const id = setInterval(() => {
            const t = player.current?.getCurrentTime?.();
            if (videoTime.current && t !== undefined) videoTime.current.textContent = t.toFixed(2);
            if (cueSource.current) cueSource.current.textContent = `cues: ${cueCounts.hand} hand + ${cueCounts.ai} ai`;
        }, 100);
        return () => clearInterval(id);
    }, [player]);

    useEffect(() => {
        QRCode.toDataURL(joinUrl, { margin: 1, width: 320, color: { dark: "#ffffff", light: "#00000000" } }).then(setQr);
        return () => live.close();
    }, [joinUrl, live]);

    useEffect(() => {
        const off = live.on((m: Msg) => {
            if (m.type === "presence") setPresence({ homes: m.homes, phones: m.phones });
            if (m.type === "home_presence") setTickets(ticketsFrom(m));
            if (m.type === "raised_count") setLightsUp(Number(m.up) || 0);
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
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const dir = e.key === "ArrowLeft" ? -1 : 1;
                p.seekTo(Math.max(0, p.getCurrentTime() + dir * SEEK_STEP_S), true);
            }
            const n = Number(e.key);
            if (n >= 1 && n <= SEGMENTS.length) p.seekTo(SEGMENTS[n - 1].start, true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [player]);

    // Join screen until every ticket is scanned in, or the show is about to start / has started.
    const phase = phaseFor(tickets, schedule, stage, now);
    const fade = useFadeToShow(stage, schedule.go_at, now);
    const leaving = fade.leaving && !TEST; // test mode: no waiting room fading out over the video
    const { preStage } = fade;

    // Test mode: after the setup click, start from ?t= once the player is ready.
    useEffect(() => {
        if (!TEST || !started) return;
        const id = setInterval(() => {
            const p = player.current;
            if (!p?.seekTo) return;
            clearInterval(id);
            p.seekTo(TEST_START_S, true);
            p.playVideo();
        }, 100);
        return () => clearInterval(id);
    }, [started, player]);

    return (
        // One click on the TV when you set it up: browsers only allow sound after a click.
        <div className={`tv ${fullscreen ? "fullscreen" : ""}`}>
            {/* Laser-like light edges over the video's sides (show only) */}
            {stage === "show" && (
                <>
                    <div className="light-edge left" />
                    <div className="light-edge right" />
                </>
            )}
            <div className="tv-center">
                <div className="video-frame">
                    <div ref={playerEl} />
                    {!VIDEO_ID && <div className="video-missing">Set VIDEO_ID in src/config.ts</div>}
                </div>
                {/* Wait for the server's schedule, so a TV opened mid-show doesn't flash the pre-show */}
                {ready && (stage !== "show" || leaving) && (
                    <Preshow
                        stage={preStage}
                        leaving={leaving}
                        reactive
                        phase={phase}
                        tickets={tickets}
                        clock={serverNow}
                        host={host}
                        voice={!leaving}
                        schedule={schedule}
                        now={now}
                        homes={presence.homes}
                        qr={qr}
                    />
                )}
                <div className="hud">
                    <span>EUPHORIE · home {home}</span>
                    <span>{presence.homes} homes · {presence.phones} phones in the crowd</span>
                </div>
            </div>
            {!started && (
                <div className="tv-start">
                    <p className="intro-text">euphorie</p>
                    <button className="start-btn" onClick={start} autoFocus>
                        start the tv screen
                    </button>
                </div>
            )}
            {stage === "show" && lightsUp > 0 && (
                <div className="lights-count">
                    {lightsUp} {lightsUp === 1 ? "light" : "lights"} in the air
                </div>
            )}
            {TEST && <div className="test-badge">TEST MODE · from {TEST_START_S}s</div>}
            {DEBUG && (
                <div className="debug-overlay">
                    <span className="beat-dot" /> t <span ref={videoTime}>—</span>s
                    <br />
                    <span ref={cueSource}>cues: —</span>
                </div>
            )}
        </div>
    );
}
