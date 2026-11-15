// The saved e-ticket: a 1080×1350 PNG (4:5, fits a phone's photo grid).
const W = 1080, H = 1350;
const FONT = '"Space Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif'; // as on screen

/** The band's logo, loaded ahead (null if it fails: the ticket just has no logo). */
export function loadLogo(): Promise<HTMLImageElement | null> {
    return new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = "/brand/reveal.png";
    });
}

/** Black, the orange glow round the edges, the logo, then the lines (the first one big). */
export async function renderTicket(lines: string[], logo: HTMLImageElement | null): Promise<Blob | null> {
    // The canvas only uses a web font once it's loaded (offline: Helvetica).
    await Promise.all(["500 96px", "400 34px"].map((f) => document.fonts.load(`${f} "Space Grotesk"`).catch(() => [])));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    // Glow: thick strokes just outside the edges, their blur bleeding inwards (red → amber).
    for (const [colour, blur, width] of [["#d8200a", 220, 200], ["#ff4a12", 120, 120], ["#ffc567", 50, 70]] as const) {
        g.shadowColor = colour;
        g.shadowBlur = blur;
        g.strokeStyle = colour;
        g.lineWidth = width;
        g.strokeRect(-width / 2, -width / 2, W + width, H + width);
    }
    let y = 300;
    if (logo) {
        const w = 340, h = (logo.height / logo.width) * w;
        g.shadowColor = "rgba(255, 255, 255, 0.5)";
        g.shadowBlur = 24;
        g.drawImage(logo, (W - w) / 2, y, w, h);
        y += h + 90;
    }
    g.shadowBlur = 0;
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "top";
    lines.forEach((l, i) => {
        // Title big and tight; the rest small, spaced capitals (like the screen)
        const title = i === 0;
        const size = title ? 110 : 30;
        g.font = `${title ? 500 : 400} ${size}px ${FONT}`;
        g.letterSpacing = title ? "-4px" : "5px";
        g.globalAlpha = title ? 1 : 0.75;
        const seat = /0x[0-9a-f]+/i.test(l); // "L1 · byte 0x2A · bit 3" keeps its case
        g.fillText(title || seat ? l : l.toUpperCase(), W / 2, y, W - 200);
        y += title ? size * 1.5 : size * 2;
    });
    return new Promise((res) => c.toBlob(res, "image/png"));
}

/** Save the PNG: a download (iPhone shows its "download / open in Photos" sheet). */
export function downloadTicket(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "euphorie-ticket.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
