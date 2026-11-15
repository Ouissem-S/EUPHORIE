import { fmtClock } from "./format";

/** Before anyone in this home has joined: invite them to scan. */
export const JOIN_SCRIPT = ["{hello.}", "{euphorie presents}", "{the neighbourhood. live from berlin.}", "{scan to join.}"];

/** Start time has passed, waiting for the go from the control phone. */
export const HOLDING_SCRIPT = ["{not long now.}", "{the band is getting ready.}", "{stay with us.}"];

/** TV, typed once when the home's last ticket (bit) is in. */
export const BYTE_FULL_INTRO = ["{byte full. welcome in.}"];

/** Waiting room (TV and phones): the home's tickets are in, or the show is about to start. */
export function waitingScript(homes: number, startsAt: number): string[] {
    return [
        "{welcome.}",
        "{you're in.}",
        `{${homes} ${homes === 1 ? "home is" : "homes are"} with us tonight.}`,
        `{the show begins at ${fmtClock(startsAt)}.}`,
        "{get your lights ready.}",
    ];
}
