import { Clock } from "./clock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { type: string;[k: string]: any };
type Handler = (msg: Msg) => void;

/**
 * Messages that describe the current state (not one-off events). The newest of each is kept
 * and replayed to handlers added later: the server sends welcome / tickets / schedule once,
 * right after connecting, often before React has attached its handlers (always on iPhone),
 * and a missed one left the phone on "allocating your seat…" for good.
 */
const STATE_TYPES = new Set(["welcome", "schedule", "presence", "home_presence", "vote_state", "position", "raised_count", "closed"]);

/** WebSocket connection with auto-reconnect and built-in clock sync. */
export class Live {
    readonly clock = new Clock();
    private ws?: WebSocket;
    private handlers = new Set<Handler>();
    private latest = new Map<string, Msg>(); // newest message of each STATE_TYPES type
    private queue: string[] = [];
    private closed = false;
    private resync: number;

    constructor(private url: string) {
        this.connect();
        this.resync = window.setInterval(() => this.syncClock(), 15_000);
    }

    private connect() {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onopen = () => {
            this.queue.forEach((m) => ws.send(m));
            this.queue = [];
            this.syncClock();
        };
        ws.onmessage = (e) => {
            let msg: Msg;
            try {
                msg = JSON.parse(e.data) as Msg;
            } catch {
                return;
            }
            if (msg.type === "pong") this.clock.sample(msg.t0, msg.ts);
            this.emit(msg);
        };
        ws.onclose = (e) => {
            // 4409: replaced by another screen; 4401: wrong key; 4404: no TV for this home;
            // 4400: bad home code. Reconnecting would ping-pong or retry a dead end forever.
            const fatal = [4400, 4401, 4404, 4409].includes(e.code);
            if (fatal && !this.closed) {
                this.closed = true;
                this.emit({ type: "closed", code: e.code, reason: e.reason });
            }
            if (!this.closed) setTimeout(() => this.connect(), 1000);
        };
    }

    /** Eight pings, 120 ms apart; the fastest round trip wins. */
    syncClock() {
        this.clock.relax();
        for (let i = 0; i < 8; i++) {
            setTimeout(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: "ping", t0: this.clock.localNow() }));
                }
            }, i * 120);
        }
    }

    /** Is the socket connected right now? (test panel) */
    get open() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    send(msg: Msg) {
        const s = JSON.stringify(msg);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
        // Position updates are stale by the time we reconnect, and arrive 4×/s: never queue them,
        // or the queue grows without bound while the server is unreachable.
        else if (msg.type !== "position" && this.queue.length < 100) this.queue.push(s);
    }

    private emit(msg: Msg) {
        if (STATE_TYPES.has(msg.type)) this.latest.set(msg.type, msg);
        this.handlers.forEach((h) => h(msg));
    }

    /** Listen for messages; first catches up on the current state received so far. */
    on(h: Handler) {
        this.handlers.add(h);
        this.latest.forEach((m) => h(m));
        return () => this.handlers.delete(h);
    }

    close() {
        this.closed = true;
        clearInterval(this.resync);
        this.ws?.close();
    }
}