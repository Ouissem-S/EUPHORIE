import type { Schedule, Stage } from "../hooks/useSchedule";
import type { Msg } from "./live";

/** "join": the home's tickets aren't all in yet. "waiting": they are (or the show is near). */
export type Phase = "join" | "waiting";

/** A home's booking: a byte, each ticket one bit. From the server's "home_presence". */
export interface HomeTickets {
    in: number;
    total: number;
    byte: number;
    fullAt: number | null; // server ms the last ticket came in (the waiting script starts here)
}

export const NO_TICKETS: HomeTickets = { in: 0, total: 0, byte: 0, fullAt: null };

export function ticketsFrom(m: Msg): HomeTickets {
    return { in: m.tickets_in, total: m.tickets, byte: m.byte, fullAt: m.full_at ?? null };
}

/** The join screen gives way to the waiting room this close to the start time. */
const WAITING_FROM_MS = 5 * 60 * 1000;

export function isFull(t: HomeTickets) {
    return t.total > 0 && t.in >= t.total;
}

/** One rule for the TV and its phones, so they always show the same screen. */
export function phaseFor(tickets: HomeTickets, schedule: Schedule, stage: Stage, now: number): Phase {
    const startsSoon = schedule.starts_at !== null && schedule.starts_at - now <= WAITING_FROM_MS;
    return isFull(tickets) || startsSoon || stage === "countdown" || stage === "show" ? "waiting" : "join";
}
