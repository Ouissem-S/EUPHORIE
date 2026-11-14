import { Clock } from "./clock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { type: string;[k: string]: any };
type Handler = (msg: Msg) => void;

/** WebSocket connection with auto-reconnect and built-in clock sync. */
export class Live {
    readonly clock = new Clock();
    private ws?: WebSocket;
    private handlers = new Set<Handler>();
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
            this.handlers.forEach((h) => h(msg));
        };
        ws.onclose = (e) => {
            // 4409: replaced by another screen; 4401: wrong key. Reconnecting would just
            // kick the other screen back out (endless ping-pong) or retry a bad key forever.
            if (e.code === 4409 || e.code === 4401) this.closed = true;
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

    send(msg: Msg) {
        const s = JSON.stringify(msg);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
        // Position updates are stale by the time we reconnect, and arrive 4×/s: never queue them,
        // or the queue grows without bound while the server is unreachable.
        else if (msg.type !== "position" && this.queue.length < 100) this.queue.push(s);
    }

    on(h: Handler) {
        this.handlers.add(h);
        return () => this.handlers.delete(h);
    }

    close() {
        this.closed = true;
        clearInterval(this.resync);
        this.ws?.close();
    }
}