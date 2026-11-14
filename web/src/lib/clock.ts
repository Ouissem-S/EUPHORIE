export class Clock {
    offset = 0;
    bestRtt = Infinity;
    synced = false;

    localNow(): number {
        return performance.timeOrigin + performance.now();
    }

    serverNow(): number {
        return this.localNow() + this.offset;
    }

    relax() {
        this.bestRtt *= 2;
    }

    sample(t0: number, ts: number) {
        const t1 = this.localNow();
        const rtt = t1 - t0;
        if (rtt < 0 || rtt > 2000) return;
        if (rtt <= this.bestRtt) {
            this.bestRtt = rtt;
            this.offset = ts - (t0 + t1) / 2;
            this.synced = true;
        }
    }
}