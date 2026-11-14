import { useEffect, useMemo, useState } from "react";
import { Live, type Msg } from "../lib/live";

interface Schedule {
    starts_at: number | null;
    approved: boolean;
    go_at: number | null;
}

function controlUrl(key: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws-control?key=${encodeURIComponent(key)}`;
}

function fmtClock(ms: number) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Your control panel: /control?key=YOUR-SECRET. Every command is checked by the server. */
export default function Control() {
    const key = useMemo(() => new URLSearchParams(location.search).get("key") ?? "", []);
    const live = useMemo(() => (key ? new Live(controlUrl(key)) : null), [key]);

    const [denied, setDenied] = useState(!key);
    const [schedule, setSchedule] = useState<Schedule>({ starts_at: null, approved: false, go_at: null });
    const [presence, setPresence] = useState({ homes: 0, phones: 0 });
    const [timeInput, setTimeInput] = useState("20:30");
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!live) return;
        const off = live.on((m: Msg) => {
            if (m.type === "denied") {
                setDenied(true);
                live.close();
            }
            if (m.type === "schedule") setSchedule({ starts_at: m.starts_at, approved: m.approved, go_at: m.go_at });
            if (m.type === "presence") setPresence({ homes: m.homes, phones: m.phones });
        });
        const id = setInterval(() => setNow(live.clock.serverNow()), 250);
        return () => {
            off();
            clearInterval(id);
            live.close();
        };
    }, [live]);

    if (denied) return <main className="control center">Access denied.</main>;
    if (!live) return null;

    // Times are sent in server time, using the synced clock offset.
    const setStartAt = (localMs: number) => live.send({ type: "set_time", starts_at: localMs + live.clock.offset });
    const setInMinutes = (min: number) => setStartAt(Date.now() + min * 60_000);
    const setAtClock = () => {
        const [h, m] = timeInput.split(":").map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);
        setStartAt(d.getTime());
    };

    const status = schedule.go_at
        ? now >= schedule.go_at
            ? "Show is live"
            : `Starting at ${fmtClock(schedule.go_at)}`
        : schedule.starts_at && now < schedule.starts_at
            ? "Doors open, waiting for start time"
            : schedule.starts_at
                ? "Holding: waiting for your approval"
                : "No start time set";

    return (
        <main className="control">
            <h1>Control</h1>

            <section className="control-card">
                <p className="control-status">{status}</p>
                <p className="muted">
                    Start time: {schedule.starts_at ? fmtClock(schedule.starts_at) : "not set"}
                </p>
                <p className="muted">
                    {presence.homes} homes · {presence.phones} phones waiting
                </p>
            </section>

            <section className="control-card">
                <p className="control-label">Set start time</p>
                <div className="control-row">
                    <input type="time" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} />
                    <button className="btn" onClick={setAtClock}>Set</button>
                </div>
                <div className="control-row">
                    <button className="btn" onClick={() => setInMinutes(2)}>In 2 min</button>
                    <button className="btn" onClick={() => setInMinutes(5)}>In 5 min</button>
                </div>
            </section>

            <button className="btn big approve" onClick={() => live.send({ type: "approve" })}>
                Approve start
            </button>
            <button className="btn danger" onClick={() => live.send({ type: "reset" })}>
                Reset
            </button>
        </main>
    );
}