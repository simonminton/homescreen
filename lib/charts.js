// 24h timeline chart builders (bars + axis + peak legend). Pure — returns
// HTML strings; the DOM wiring lives in app.js.

import { pad, localDateStr } from "./format.js";

// The 24 hourly entries for one calendar day ("YYYY-MM-DD"), each flagged
// with now / past when that day is today.
export function daySlice(times, values, dateStr) {
  const now = new Date();
  const isToday = dateStr === localDateStr(now);
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(dateStr)) continue;
    const t = new Date(times[i]);
    out.push({
      t, v: values[i] ?? 0,
      now: isToday && t.getHours() === now.getHours(),
      past: isToday && t.getHours() < now.getHours(),
    });
  }
  return out;
}

// Vivid band colour for UV bars (distinct from the translucent badge tints).
export function uvBarColor(uv) {
  if (uv < 3) return "linear-gradient(180deg, #7fd29a, rgba(127,210,154,0.4))";
  if (uv < 6) return "linear-gradient(180deg, #f2d24a, rgba(242,210,74,0.4))";
  if (uv < 8) return "linear-gradient(180deg, #f0a04b, rgba(240,160,75,0.4))";
  if (uv < 11) return "linear-gradient(180deg, #e8615a, rgba(232,97,90,0.4))";
  return "linear-gradient(180deg, #c06fd0, rgba(192,111,208,0.4))";
}

// A minimal temperature line for one day's hourly slice. Pure: returns an SVG
// string (area + line, drawn with a non-scaling stroke so it stays crisp when
// stretched to full width) plus min/max and the "now" position as percentages
// so the caller can place a crisp DOM marker over it.
export function tempChartSVG(slice) {
  if (!slice.length) return { svg: "", min: null, max: null, now: null };
  const W = 1000, H = 120, padY = 20;
  const temps = slice.map((h) => h.v);
  let min = Math.min(...temps), max = Math.max(...temps);
  if (max - min < 1) { max += 1; min -= 1; }            // avoid a dead-flat line
  const span = max - min;
  const n = slice.length;
  const px = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const py = (v) => H - padY - ((v - min) / span) * (H - 2 * padY);
  const pts = slice.map((h, i) => [px(i), py(h.v)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const nowI = slice.findIndex((h) => h.now);
  const now = nowI >= 0
    ? { x: (pts[nowI][0] / W) * 100, y: (pts[nowI][1] / H) * 100, v: slice[nowI].v }
    : null;
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    `<path class="tc-area" d="${area}"/><path class="tc-line" d="${line}"/></svg>`;
  return { svg, min, max, now };
}

// Build one hourly chart (bars + axis + peak legend) as HTML strings.
// kind: "rain" (percent) | "uv" (index, band-coloured).
export function chartHTML(slice, kind, delayBase = 0) {
  const UV_SCALE = 11;
  let bars = "", axis = "", peak = 0;
  slice.forEach((h, i) => {
    let cls = "bar", style = "", title = "";
    if (kind === "rain") {
      peak = Math.max(peak, h.v);
      cls += " rbar" + (h.v < 5 ? " dry" : "");
      style = `height:${Math.max(2, h.v)}%`;
      title = `${pad(h.t.getHours())}:00 — ${h.v}%`;
    } else {
      const uv = Math.max(0, h.v);
      peak = Math.max(peak, uv);
      cls += " uvbar" + (uv < 0.5 ? " zero" : "");
      style = `height:${Math.max(2, Math.min(100, (uv / UV_SCALE) * 100))}%`;
      if (uv >= 0.5) style += `;background:${uvBarColor(uv)}`;
      title = `${pad(h.t.getHours())}:00 — UV ${Math.round(uv * 10) / 10}`;
    }
    if (h.now) cls += " now";
    if (h.past) cls += " past";
    style += `;animation-delay:${delayBase + i * 14}ms`;
    bars += `<div class="${cls}" style="${style}" title="${title}"></div>`;
    const hr = h.t.getHours();
    axis += h.now ? `<span class="tick now">now</span>`
      : hr % 6 === 0 ? `<span class="tick">${pad(hr)}</span>` : "<span></span>";
  });
  const peakLabel = kind === "rain"
    ? (peak > 0 ? `peak ${peak}%` : "dry")
    : (peak > 0 ? `peak ${Math.round(peak * 10) / 10}` : "none");
  return { bars, axis, peakLabel };
}
