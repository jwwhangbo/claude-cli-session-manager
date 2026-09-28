import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

export function relTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** Truncate/pad to an exact display width, counting wide (CJK/emoji) chars as 2 columns. */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  text = text.replace(/\s+/g, " ");
  const total = stringWidth(text);
  if (total <= width) return text + " ".repeat(width - total);
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = stringWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…" + " ".repeat(width - w - 1);
}

export function wrap(text: string, width: number): string[] {
  return wrapAnsi(text, Math.max(10, width), { hard: true, trim: false }).split("\n");
}
