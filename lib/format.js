// Units, number + time/duration formatting, and timezone-aware parsing.
// Pure helpers — no DOM, safe to import in Node for tests.

export const cToF = (c) => (c * 9) / 5 + 32;
export const round = (n) => Math.round(n);
export const pad = (n) => String(n).padStart(2, "0");
export const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "4h 12m" / "12m" / "5m"
export function durHuman(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; }
  return `${m}m`;
}
export const durHM = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
export const durMS = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m}m ${s}s` : `${s}s`; };
export const niceMins = (m) => (m >= 60 ? durHuman(m * 60000) : `${Math.max(5, Math.round(m / 5) * 5)} min`);

// Open-Meteo (timezone=auto) returns local wall-time strings with no offset,
// e.g. "2026-06-22T21:22". Parse to a true absolute instant using the
// response's utc_offset_seconds; without this a different city's sun times
// would be read in the viewer's own timezone (breaking countdowns).
export function apiTime(str, offsetSec) {
  if (!str) return null;
  const ms = Date.parse(str + "Z");
  return isNaN(ms) ? null : new Date(ms - (offsetSec || 0) * 1000);
}

// Format an absolute Date as a wall clock in the given IANA timezone.
// 24h by default; pass hour12=true for am/pm.
export function zoneHHMM(d, zone, hour12 = false) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit",
    ...(hour12 ? { hour12: true } : { hourCycle: "h23" }),
    timeZone: zone || undefined,
  }).format(d);
}

// Compass point from a bearing in degrees (meteorological: direction wind FROM).
export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg) => COMPASS[Math.round((deg % 360) / 45) % 8];
