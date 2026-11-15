/** What to show for each WebSocket close code from the server (stage text: lowercase). */
const CLOSE_MESSAGES: Record<number, string> = {
    4400: "invalid home code.",
    4401: "wrong control key.",
    4403: "out of memory: all seats in this home are taken.",
    4404: "no tv is running for this home.",
    4409: "this home was opened on another screen.",
};

export function closeMessage(code: number, reason?: string) {
    return CLOSE_MESSAGES[code] ?? (reason ? reason.toLowerCase() : "connection lost.");
}
