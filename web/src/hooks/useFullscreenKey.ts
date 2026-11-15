import { useEffect, useState } from "react";

/** "f" toggles full screen. Returns whether the page is currently full screen. */
export function useFullscreenKey() {
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== "f" || e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd/Ctrl+F alone
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
            else document.exitFullscreen();
        };
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        window.addEventListener("keydown", onKey);
        document.addEventListener("fullscreenchange", onChange);
        return () => {
            window.removeEventListener("keydown", onKey);
            document.removeEventListener("fullscreenchange", onChange);
        };
    }, []);

    return isFullscreen;
}
