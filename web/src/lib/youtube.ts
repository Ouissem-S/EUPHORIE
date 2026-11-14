// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YTPlayer = any;

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.YT?.Player) return resolve();
        w.onYouTubeIframeAPIReady = () => resolve();
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
    });
    return apiPromise;
}

export async function createPlayer(el: HTMLElement, videoId: string, start = 0): Promise<YTPlayer> {
    await loadApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const YT = (window as any).YT;
    return new Promise((resolve) => {
        const player = new YT.Player(el, {
            videoId,
            playerVars: { start, controls: 0, rel: 0, playsinline: 1, disablekb: 1, iv_load_policy: 3, fs: 0 },
            events: { onReady: () => resolve(player) },
        });
    });
}

export const PLAYING = 1;