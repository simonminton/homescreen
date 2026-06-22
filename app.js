"use strict";

/* =========================================================================
   Homescreen — atmospheric clock + weather
   Vanilla JS, no build step. Logic helpers are pure & isolated for testing.
   ========================================================================= */

const FALLBACK = { name: "London", lat: 51.5074, lon: -0.1278 };
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------------------------
   Pure logic helpers
   ------------------------------------------------------------------------- */

const cToF = (c) => (c * 9) / 5 + 32;
const round = (n) => Math.round(n);

// WMO weather code -> normalized condition + readable label.
function wmoToCondition(code) {
  if (code === 0) return { key: "clear", label: "Clear" };
  if (code === 1) return { key: "clear", label: "Mainly clear" };
  if (code === 2) return { key: "partly", label: "Partly cloudy" };
  if (code === 3) return { key: "cloudy", label: "Overcast" };
  if (code === 45 || code === 48) return { key: "fog", label: "Fog" };
  if (code >= 51 && code <= 57) return { key: "rain", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { key: "rain", label: "Rain" };
  if (code >= 80 && code <= 82) return { key: "rain", label: "Rain showers" };
  if (code >= 71 && code <= 77) return { key: "snow", label: "Snow" };
  if (code === 85 || code === 86) return { key: "snow", label: "Snow showers" };
  if (code === 95) return { key: "storm", label: "Thunderstorm" };
  if (code === 96 || code === 99) return { key: "storm", label: "Thunderstorm, hail" };
  return { key: "cloudy", label: "Cloudy" };
}

// UV index -> descriptive band.
function uvBand(uv) {
  if (uv == null || isNaN(uv)) return { label: "—", color: "rgba(255,255,255,0.1)" };
  if (uv < 3) return { label: "Low", color: "rgba(120,200,140,0.32)" };
  if (uv < 6) return { label: "Moderate", color: "rgba(232,200,90,0.34)" };
  if (uv < 8) return { label: "High", color: "rgba(232,150,70,0.38)" };
  if (uv < 11) return { label: "Very high", color: "rgba(225,90,80,0.4)" };
  return { label: "Extreme", color: "rgba(180,100,200,0.42)" };
}

// US AQI -> descriptive band + chip colour (matches the UV badge styling).
function aqiBand(aqi) {
  if (aqi == null || isNaN(aqi)) return { label: "—", color: "rgba(255,255,255,0.1)" };
  if (aqi <= 50)  return { label: "Good", color: "rgba(120,200,140,0.34)" };
  if (aqi <= 100) return { label: "Moderate", color: "rgba(232,200,90,0.34)" };
  if (aqi <= 150) return { label: "Unhealthy*", color: "rgba(232,150,70,0.38)" };
  if (aqi <= 200) return { label: "Unhealthy", color: "rgba(225,90,80,0.4)" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "rgba(180,100,200,0.42)" };
  return { label: "Hazardous", color: "rgba(160,60,70,0.46)" };
}

// Peak pollen across types (grains/m³) -> band. Rough, type-agnostic scale.
function pollenBand(grains) {
  if (grains == null || isNaN(grains)) return { label: "—", color: "rgba(255,255,255,0.1)" };
  if (grains < 10)  return { label: "Low", color: "rgba(120,200,140,0.34)" };
  if (grains < 50)  return { label: "Moderate", color: "rgba(232,200,90,0.34)" };
  if (grains < 100) return { label: "High", color: "rgba(232,150,70,0.38)" };
  return { label: "Very high", color: "rgba(225,90,80,0.4)" };
}

// Compass point from a bearing in degrees (meteorological: direction wind FROM).
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => COMPASS[Math.round((deg % 360) / 45) % 8];

// Decide which secondary city clocks to show from the system timezone.
// Each carries coords so clicking a clock can switch the weather location.
const LONDON = { city: "London", zone: "Europe/London", lat: 51.5074, lon: -0.1278 };
const NEW_YORK = { city: "New York", zone: "America/New_York", lat: 40.7128, lon: -74.006 };
function secondaryCities(tz) {
  if (tz === "Europe/London") return [NEW_YORK];
  if (tz === "America/New_York") return [LONDON];
  return [LONDON, NEW_YORK];
}

// Moon phase as a fraction of the synodic month: 0 = new, 0.5 = full.
const SYNODIC = 29.53058867;
function moonPhaseFrac(date) {
  const ref = Date.UTC(2000, 0, 6, 18, 14); // known new moon
  const days = (date.getTime() - ref) / 86400000;
  const p = (days % SYNODIC) / SYNODIC;
  return p < 0 ? p + 1 : p;
}

function moonInfo(p) {
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * p)) / 2) * 100);
  const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
                 "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  return { name: names[Math.round(p * 8) % 8], illum };
}

// Phase-accurate moon as inline SVG: lit shape bounded by the limb and the
// terminator ellipse (rx = R·|cos 2πp|), plus earthshine disc and craters.
// uid keeps gradient/clip ids unique when the SVG appears twice on the page.
function moonSVG(p, uid) {
  const C = 50, R = 46;
  const t = Math.cos(2 * Math.PI * p);
  const rx = (Math.abs(t) * R).toFixed(2);
  let litPath = "";
  if (Math.min(p, 1 - p) < 0.015) litPath = ""; // new — earthshine only
  else if (Math.abs(p - 0.5) < 0.015)
    litPath = `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C} ${C + R} A ${R} ${R} 0 1 1 ${C} ${C - R} Z`;
  else if (p < 0.5) // waxing: lit on the right
    litPath = `M ${C} ${C - R} A ${R} ${R} 0 0 1 ${C} ${C + R} A ${rx} ${R} 0 0 ${t > 0 ? 0 : 1} ${C} ${C - R} Z`;
  else // waning: lit on the left
    litPath = `M ${C} ${C - R} A ${R} ${R} 0 0 0 ${C} ${C + R} A ${rx} ${R} 0 0 ${t > 0 ? 1 : 0} ${C} ${C - R} Z`;

  const lit = litPath ? `<path d="${litPath}" fill="url(#mlit-${uid})"/>` : "";
  const craters = litPath
    ? `<defs><clipPath id="mclip-${uid}"><path d="${litPath}"/></clipPath></defs>
       <g clip-path="url(#mclip-${uid})" fill="rgba(125,140,175,0.28)">
         <circle cx="36" cy="40" r="7"/><circle cx="58" cy="60" r="5"/>
         <circle cx="52" cy="28" r="3.5"/><circle cx="42" cy="64" r="4.5"/>
         <circle cx="66" cy="40" r="3"/><circle cx="30" cy="55" r="3.5"/>
       </g>`
    : "";
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="mlit-${uid}" cx="42%" cy="38%" r="78%">
        <stop offset="0%" stop-color="#f6f8ff"/>
        <stop offset="55%" stop-color="#dde6f8"/>
        <stop offset="100%" stop-color="#bfcce8"/>
      </radialGradient>
    </defs>
    <circle cx="${C}" cy="${C}" r="${R}" fill="rgba(175,190,220,0.12)"/>
    ${lit}
    ${craters}
  </svg>`;
}

// Time-of-day phase from current time relative to sunrise/sunset Date objects.
// Returns one of: night | dawn | day | golden | dusk.
function timeOfDayPhase(now, sunrise, sunset) {
  if (!sunrise || !sunset) {
    const h = now.getHours();
    if (h < 6 || h >= 21) return "night";
    if (h < 8) return "dawn";
    if (h < 17) return "day";
    if (h < 19) return "golden";
    return "dusk";
  }
  const m = 60 * 1000;
  const dawnStart = sunrise.getTime() - 60 * m;
  const dawnEnd = sunrise.getTime() + 40 * m;
  const goldenStart = sunset.getTime() - 60 * m;
  const sunsetT = sunset.getTime();
  const duskEnd = sunset.getTime() + 50 * m;
  const t = now.getTime();
  if (t < dawnStart || t > duskEnd) return "night";
  if (t < dawnEnd) return "dawn";
  if (t < goldenStart) return "day";
  if (t < sunsetT) return "golden";
  return "dusk";
}

// Base sky palettes (clear skies) per phase: [top, mid, bottom].
const BASE_PALETTES = {
  night:  ["#080a1f", "#101633", "#1a1430"],
  dawn:   ["#243a6b", "#9d6585", "#f0a878"],
  day:    ["#2f6fc7", "#5fa0df", "#a9d0ee"],
  golden: ["#1d335c", "#d4733f", "#f2bd6e"],
  dusk:   ["#15152f", "#473867", "#9c5570"],
};

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgbToCss = ([r, g, b]) => `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Pull a clear-sky palette toward a target tint by amount t.
function tintPalette(palette, target, t) {
  return palette.map((hex) => rgbToCss(mix(hexToRgb(hex), target, t)));
}

// Final sky palette from phase + condition.
function skyPalette(phase, condition) {
  const base = BASE_PALETTES[phase] || BASE_PALETTES.day;
  switch (condition) {
    case "cloudy":
      return tintPalette(base, [86, 92, 104], 0.55);
    case "partly":
      return tintPalette(base, [110, 120, 135], 0.25);
    case "rain":
      return tintPalette(base, [44, 52, 66], 0.62);
    case "storm":
      return tintPalette(base, [26, 30, 42], 0.72);
    case "snow":
      return tintPalette(base, [150, 158, 172], 0.5);
    case "fog":
      return tintPalette(base, [150, 152, 158], 0.6);
    default:
      return base.map((hex) => rgbToCss(hexToRgb(hex)));
  }
}

// Condition tint amounts, as [target rgb, strength], for the altitude-driven
// palette (mirrors the discrete skyPalette switch above).
const CONDITION_TINT = {
  cloudy: [[86, 92, 104], 0.55], partly: [[110, 120, 135], 0.25],
  rain: [[44, 52, 66], 0.62], storm: [[26, 30, 42], 0.72],
  snow: [[150, 158, 172], 0.5], fog: [[150, 152, 158], 0.6],
};

// Clear-sky palettes as rgb triples, for continuous interpolation by altitude.
const PHASE_RGB = {};
for (const k in BASE_PALETTES) PHASE_RGB[k] = BASE_PALETTES[k].map(hexToRgb);

// Continuous sky palette from the sun's true altitude (degrees). Blends between
// night / twilight / golden / day anchors; twilight leans dawn or dusk.
function skyPaletteByAltitude(alt, rising, condition) {
  const twi = rising ? "dawn" : "dusk";
  const stops = [[-90, "night"], [-10, "night"], [-5, twi], [-1, "golden"], [7, "golden"], [18, "day"], [90, "day"]];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (alt >= stops[i][0] && alt <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi[0] - lo[0];
  const t = span === 0 ? 0 : (alt - lo[0]) / span;
  const pa = PHASE_RGB[lo[1]], pb = PHASE_RGB[hi[1]];
  let pal = [0, 1, 2].map((j) => mix(pa[j], pb[j], t));
  const tint = CONDITION_TINT[condition];
  if (tint) pal = pal.map((rgb) => mix(rgb, tint[0], tint[1]));
  return pal.map(rgbToCss);
}

/* ---------------------------------------------------------------------------
   Solar position (NOAA low-precision algorithm)
   ------------------------------------------------------------------------- */

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

// Sun altitude in degrees (negative = below horizon) for a Date at lat/lon.
// Accurate to a fraction of a degree — plenty for driving the sky gradient.
function sunAltitude(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;     // Julian date
  const n = jd - 2451545.0;                              // days since J2000
  const L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;
  const g = deg2rad(((357.528 + 0.9856003 * n) % 360 + 360) % 360);
  const lambda = deg2rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = deg2rad(23.439 - 0.0000004 * n);
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360;
  const H = deg2rad(((gmst + lon) % 360 + 360) % 360) - ra;
  const latR = deg2rad(lat);
  const alt = Math.asin(
    Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(H)
  );
  return rad2deg(alt);
}

const dayOfYear = (d) =>
  Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);

// Daylight length in hours for a date/latitude, from the sunrise hour angle.
// Used only for the day-length *delta* vs yesterday (today's length itself
// comes from the exact API sunrise/sunset).
function dayLengthHours(date, lat) {
  const decl = deg2rad(-23.44 * Math.cos(deg2rad((360 / 365) * (dayOfYear(date) + 10))));
  const cosH = -Math.tan(deg2rad(lat)) * Math.tan(decl);
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  return (2 * rad2deg(Math.acos(cosH))) / 15;
}

/* ---------------------------------------------------------------------------
   DOM references
   ------------------------------------------------------------------------- */

const el = (id) => document.getElementById(id);
const dom = {
  time: el("time"), date: el("date"),
  locName: el("locName"), location: el("location"), preciseBtn: el("preciseBtn"),
  locPrev: el("locPrev"), locNext: el("locNext"), locTime: el("locTime"),
  worldClocks: el("worldClocks"),
  temp: el("temp"), tempC: el("tempC"), tempF: el("tempF"),
  condition: el("condition"), tempHi: el("tempHi"), tempLo: el("tempLo"),
  wxIcon: el("wxIcon"), uv: el("uv"), uvValue: el("uvValue"), uvBand: el("uvBand"),
  moonStat: el("moonStat"), moonIcon: el("moonIcon"), moonName: el("moonName"), moonIllum: el("moonIllum"),
  aqiStat: el("aqiStat"), aqiValue: el("aqiValue"), aqiBandEl: el("aqiBandEl"),
  pollenStat: el("pollenStat"), pollenBandEl: el("pollenBandEl"),
  nowcast: el("nowcast"), wxDetails: el("wxDetails"),
  sunPanel: el("sunPanel"), sunNextLabel: el("sunNextLabel"), sunNextVal: el("sunNextVal"),
  sunriseVal: el("sunriseVal"), sunsetVal: el("sunsetVal"),
  dayLenVal: el("dayLenVal"), dayDeltaVal: el("dayDeltaVal"), goldenVal: el("goldenVal"),
  sunLayer: el("sunLayer"), moonLayer: el("moonLayer"), clouds: el("clouds"),
  wxError: el("wxError"),
  rainBars: el("rainBars"), rainAxis: el("rainAxis"), rainPeak: el("rainPeak"),
  uvBars: el("uvBars"), uvAxis: el("uvAxis"), uvPeak: el("uvPeak"),
  weekPanel: el("weekPanel"), scrollHint: el("scrollHint"),
  sky: el("sky"), orb: el("orb"), veil: el("veil"), lightning: el("lightning"),
};

/* ---------------------------------------------------------------------------
   Clock
   ------------------------------------------------------------------------- */

const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const fmtTime = (zone) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone,
  });
const fmtDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const cities = secondaryCities(SYSTEM_TZ);
const cityFormatters = cities.map((c) => ({ ...c, fmt: fmtTime(c.zone) }));

// Build secondary clock markup once.
dom.worldClocks.innerHTML = cityFormatters
  .map((c) => `<button type="button" class="wclock" data-lat="${c.lat}" data-lon="${c.lon}" data-name="${c.city}" title="Show weather for ${c.city}"><span class="wc-city">${c.city}</span><span class="wc-time" data-zone="${c.zone}">--:--</span></button>`)
  .join("");
const wclockNodes = [...dom.worldClocks.querySelectorAll(".wc-time")];

function tickClock() {
  const now = new Date();
  const t = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  dom.time.textContent = t;
  dom.date.textContent = fmtDate.format(now);
  document.title = t + " — Homescreen";
  cityFormatters.forEach((c, i) => { wclockNodes[i].textContent = c.fmt.format(now); });
  updateLocTime();
}

/* ---------------------------------------------------------------------------
   Weather icons (inline SVG, stroke = currentColor)
   ------------------------------------------------------------------------- */

const S = 'stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const CLOUD = `<path d="M7 18h9a3.2 3.2 0 0 0 .3-6.4A4.8 4.8 0 0 0 7 11a3.5 3.5 0 0 0 0 7Z" ${S}/>`;
const ICONS = {
  clearDay: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" ${S}/><g ${S}><path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3"/></g></svg>`,
  clearNight: `<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.4 6.4 0 0 0 10.5 10.5Z" ${S}/></svg>`,
  partlyDay: `<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3" ${S}/><g ${S}><path d="M8 2.6v1.6M8 11.8v1.6M13.4 8h-1.6M4.2 8H2.6M11.5 4.5 10.4 5.6M5.6 10.4 4.5 11.5M11.5 11.5 10.4 10.4M5.6 5.6 4.5 4.5"/></g>${CLOUD}</svg>`,
  partlyNight: `<svg viewBox="0 0 24 24"><path d="M13 3.2A5 5 0 0 0 18.8 9 4.6 4.6 0 0 1 13 3.2Z" ${S}/>${CLOUD}</svg>`,
  cloudy: `<svg viewBox="0 0 24 24">${CLOUD}</svg>`,
  fog: `<svg viewBox="0 0 24 24">${CLOUD}<g ${S}><path d="M5 21h11M7 18.5"/></g></svg>`,
  rain: `<svg viewBox="0 0 24 24">${CLOUD}<g ${S}><path d="M9 19l-1 2.5M13 19l-1 2.5M16.5 19l-1 2.5"/></g></svg>`,
  snow: `<svg viewBox="0 0 24 24">${CLOUD}<g ${S}><path d="M9 20h.01M12.5 21h.01M15.5 20h.01"/></g></svg>`,
  storm: `<svg viewBox="0 0 24 24">${CLOUD}<path d="M12 18l-2 3.5h3L11 25" ${S}/></svg>`,
};

function pickIcon(condition, isDay) {
  switch (condition) {
    case "clear": return isDay ? ICONS.clearDay : ICONS.clearNight;
    case "partly": return isDay ? ICONS.partlyDay : ICONS.partlyNight;
    case "cloudy": return ICONS.cloudy;
    case "fog": return ICONS.fog;
    case "rain": return ICONS.rain;
    case "snow": return ICONS.snow;
    case "storm": return ICONS.storm;
    default: return ICONS.cloudy;
  }
}

/* ---------------------------------------------------------------------------
   Background engine (sky palette + orb + condition veil + particles)
   ------------------------------------------------------------------------- */

// Continuous orb position along an east->west arc.
// Daytime: progress runs sunrise(0) -> sunset(1). Night: sunset -> next sunrise.
// Returns x/y as viewport percentages, altitude (0 horizon .. 1 peak), and isDay.
function orbArc(now, sunrise, sunset, sunriseNext) {
  // Fall back to nominal 06:30 / 20:30 when sun times are unknown.
  if (!sunrise || !sunset) {
    const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    sunrise = new Date(y, mo, d, 6, 30);
    sunset = new Date(y, mo, d, 20, 30);
    sunriseNext = new Date(y, mo, d + 1, 6, 30);
  }
  const t = now.getTime();
  const sr = sunrise.getTime(), ss = sunset.getTime();
  let prog, isDay;

  if (t >= sr && t <= ss) {
    prog = (t - sr) / (ss - sr);
    isDay = true;
  } else {
    isDay = false;
    let start, end;
    if (t > ss) {
      // Evening into night.
      start = ss;
      end = sriseTime(sunriseNext, ss);
    } else {
      // Pre-dawn: approximate the previous sunset as ~one day before today's.
      start = ss - 24 * 3600 * 1000;
      end = sr;
    }
    prog = (t - start) / (end - start);
  }

  prog = Math.max(0, Math.min(1, prog));
  const x = 8 + prog * 84;                       // left horizon -> right horizon
  const alt = Math.sin(prog * Math.PI);          // 0 at horizon, 1 at peak
  const y = 82 - alt * 70;                        // lower %% = higher on screen
  return { x, y, alt, isDay };
}
const sriseTime = (next, fallbackSunset) =>
  next ? next.getTime() : fallbackSunset + 10 * 3600 * 1000;

// Mutable sky inputs, refreshed by the weather fetch and re-read every minute.
const skyState = { condition: "clear", sunrise: null, sunset: null, sunriseNext: null };

function updateSky(now = new Date()) {
  const { condition, sunrise, sunset, sunriseNext } = skyState;
  const phase = timeOfDayPhase(now, sunrise, sunset);

  // Prefer a continuous gradient driven by the sun's real altitude when we know
  // where we are; otherwise fall back to the discrete time-of-day palette.
  let a, b, c;
  if (coords && coords.lat != null) {
    const alt = sunAltitude(now, coords.lat, coords.lon);
    const rising = sunAltitude(new Date(now.getTime() + 6e5), coords.lat, coords.lon) > alt;
    [a, b, c] = skyPaletteByAltitude(alt, rising, condition);
  } else {
    [a, b, c] = skyPalette(phase, condition);
  }
  const root = document.documentElement.style;
  root.setProperty("--sky-1", a);
  root.setProperty("--sky-2", b);
  root.setProperty("--sky-3", c);

  // Orb traces a live arc; sun by day (warm, hotter near the horizon), moon by night.
  const arc = orbArc(now, sunrise, sunset, sunriseNext);
  root.setProperty("--orb-x", arc.x.toFixed(2) + "%");
  root.setProperty("--orb-y", arc.y.toFixed(2) + "%");

  if (arc.isDay) {
    dom.sunLayer.style.opacity = "1";
    dom.moonLayer.style.opacity = "0";
    root.setProperty("--orb-size", "170px");
    // Hotter and whiter at altitude; orange and dimmer at the horizon.
    const w = mix([255, 150, 80], [255, 242, 214], Math.min(1, arc.alt * 1.7));
    root.setProperty("--sun-warm", `rgba(${w[0] | 0},${w[1] | 0},${w[2] | 0},0.92)`);
    const g = mix([255, 140, 70], [255, 226, 170], Math.min(1, arc.alt * 1.7));
    root.setProperty("--orb-glow", `rgba(${g[0] | 0},${g[1] | 0},${g[2] | 0},${(0.36 - arc.alt * 0.1).toFixed(2)})`);
  } else {
    dom.sunLayer.style.opacity = "0";
    dom.moonLayer.style.opacity = "1";
    root.setProperty("--orb-size", "120px");
    root.setProperty("--orb-glow", "rgba(185,205,255,0.18)");
    const p = moonPhaseFrac(now);
    const key = Math.round(p * 200); // redraw only when the phase visibly moves
    if (key !== moonKeys.sky) { moonKeys.sky = key; dom.moonLayer.innerHTML = moonSVG(p, "sky"); }
  }

  // The MOON stat replaces the UV stat after dark (UV is always 0 at night).
  dom.uv.hidden = !arc.isDay;
  dom.moonStat.hidden = arc.isDay;
  if (!arc.isDay) {
    const p = moonPhaseFrac(now);
    const info = moonInfo(p);
    dom.moonName.textContent = info.name;
    dom.moonIllum.textContent = info.illum + "%";
    const key = Math.round(p * 200);
    if (key !== moonKeys.mini) { moonKeys.mini = key; dom.moonIcon.innerHTML = moonSVG(p, "mini"); }
  }

  const hideOrb = condition === "cloudy" || condition === "rain" || condition === "storm" || condition === "fog";
  dom.orb.style.opacity = hideOrb ? "0" : "0.95";

  // Drifting clouds, tinted and weighted by condition.
  const look = CLOUD_LOOKS[condition];
  dom.clouds.style.opacity = look ? look.opacity : "0";
  if (look) root.setProperty("--cloud-tint", look.tint);

  // Veil for hazy / stormy moods.
  let veil = "transparent";
  if (condition === "fog") veil = "rgba(200,202,208,0.16)";
  else if (condition === "storm") veil = "rgba(10,12,22,0.22)";
  root.setProperty("--veil-color", veil);

  setLightning(condition === "storm");
  startParticles(phase, condition, arc.isDay);
}

const moonKeys = { sky: -1, mini: -1 };

// Occasional lightning flashes while a thunderstorm is the active condition.
// Respects reduced-motion. A flash is a quick double-blink of a white overlay.
let lightningTimer = null;
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function setLightning(on) {
  if (on && !lightningTimer && !reduceMotion) {
    const blink = (ms) => { dom.lightning.classList.add("flash"); setTimeout(() => dom.lightning.classList.remove("flash"), ms); };
    const strike = () => { blink(180); if (Math.random() < 0.45) setTimeout(() => blink(120), 230); };
    lightningTimer = setInterval(() => { if (Math.random() < 0.5) strike(); }, 3800);
  } else if (!on && lightningTimer) {
    clearInterval(lightningTimer);
    lightningTimer = null;
    dom.lightning.classList.remove("flash");
  }
}

const CLOUD_LOOKS = {
  partly: { tint: "rgba(255,255,255,0.55)", opacity: "0.55" },
  cloudy: { tint: "rgba(222,226,234,0.68)", opacity: "0.9" },
  rain:   { tint: "rgba(148,156,170,0.62)", opacity: "0.85" },
  storm:  { tint: "rgba(92,98,114,0.68)",  opacity: "0.9" },
  snow:   { tint: "rgba(232,236,244,0.6)", opacity: "0.75" },
};

/* ---------------------------------------------------------------------------
   Canvas particles: stars (clear night), rain, snow
   ------------------------------------------------------------------------- */

const canvas = el("particles");
const ctx = canvas.getContext("2d");
let particles = [];
let particleMode = "none";
let meteor = null;
let rafId = null;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function sizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeCanvas();

const rand = (a, b) => a + Math.random() * (b - a);

function buildParticles(mode) {
  particles = [];
  const W = innerWidth, H = innerHeight;
  if (mode === "stars") {
    const n = Math.round((W * H) / 7000);
    for (let i = 0; i < n; i++)
      particles.push({ x: rand(0, W), y: rand(0, H * 0.85), r: rand(0.4, 1.5), tw: rand(0, Math.PI * 2), sp: rand(0.6, 1.8) });
  } else if (mode === "rain") {
    const n = Math.round((W * H) / 4200);
    for (let i = 0; i < n; i++)
      particles.push({ x: rand(0, W), y: rand(0, H), len: rand(10, 22), sp: rand(9, 15), w: rand(0.6, 1.2) });
  } else if (mode === "snow") {
    const n = Math.round((W * H) / 9000);
    for (let i = 0; i < n; i++)
      particles.push({ x: rand(0, W), y: rand(0, H), r: rand(1, 2.8), sp: rand(0.6, 1.6), drift: rand(-0.5, 0.5), ph: rand(0, Math.PI * 2) });
  }
}

let frame = 0;
function drawParticles() {
  const W = innerWidth, H = innerHeight;
  ctx.clearRect(0, 0, W, H);
  frame++;

  if (particleMode === "stars") {
    for (const p of particles) {
      const a = 0.35 + 0.45 * Math.sin(p.tw + frame * 0.02 * p.sp);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, a)})`;
      ctx.fill();
    }
    // The occasional shooting star (~every 15-30s)
    if (!meteor && Math.random() < 0.0012)
      meteor = { x: rand(W * 0.1, W * 0.7), y: rand(H * 0.05, H * 0.3), vx: rand(7, 11), vy: rand(2.5, 4.5), life: 1 };
    if (meteor) {
      const m = meteor;
      const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 10, m.y - m.vy * 10);
      grad.addColorStop(0, `rgba(255,255,255,${(0.85 * m.life).toFixed(2)})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 10, m.y - m.vy * 10);
      ctx.stroke();
      m.x += m.vx; m.y += m.vy; m.life -= 0.018;
      if (m.life <= 0 || m.x > W + 80) meteor = null;
    }
  } else if (particleMode === "rain") {
    ctx.strokeStyle = "rgba(174,206,240,0.5)";
    for (const p of particles) {
      ctx.lineWidth = p.w;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 1.5, p.y + p.len);
      ctx.stroke();
      p.y += p.sp;
      p.x -= 0.6;
      if (p.y > H) { p.y = -p.len; p.x = rand(0, W); }
    }
  } else if (particleMode === "snow") {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      p.y += p.sp;
      p.x += p.drift + Math.sin((frame * 0.01) + p.ph) * 0.4;
      if (p.y > H) { p.y = -4; p.x = rand(0, W); }
    }
  }
  rafId = requestAnimationFrame(drawParticles);
}

function startParticles(phase, condition, isDay) {
  let mode = "none";
  if (condition === "rain" || condition === "storm") mode = "rain";
  else if (condition === "snow") mode = "snow";
  else if (!isDay && phase === "night" && (condition === "clear" || condition === "partly")) mode = "stars";

  if (mode === particleMode) return;
  particleMode = mode;
  meteor = null;
  if (rafId) cancelAnimationFrame(rafId);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (mode === "none") { rafId = null; return; }
  buildParticles(mode);
  rafId = requestAnimationFrame(drawParticles);
}

addEventListener("resize", () => {
  sizeCanvas();
  if (particleMode !== "none") buildParticles(particleMode);
});

/* ---------------------------------------------------------------------------
   24h timeline charts (rain probability + UV index)
   ------------------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, "0");
const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The 24 hourly entries for one calendar day ("YYYY-MM-DD"), each flagged
// with now / past when that day is today.
function daySlice(times, values, dateStr) {
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

// Build one hourly chart (bars + axis + peak legend) as HTML strings.
// kind: "rain" (percent) | "uv" (index, band-coloured).
function chartHTML(slice, kind, delayBase = 0) {
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

function renderRain(times, probs) {
  const c = chartHTML(daySlice(times, probs, localDateStr(new Date())), "rain", 760);
  dom.rainBars.innerHTML = c.bars;
  dom.rainAxis.innerHTML = c.axis;
  dom.rainPeak.textContent = c.peakLabel;
}

// Vivid band colour for UV bars (distinct from the translucent badge tints).
function uvBarColor(uv) {
  if (uv < 3) return "linear-gradient(180deg, #7fd29a, rgba(127,210,154,0.4))";
  if (uv < 6) return "linear-gradient(180deg, #f2d24a, rgba(242,210,74,0.4))";
  if (uv < 8) return "linear-gradient(180deg, #f0a04b, rgba(240,160,75,0.4))";
  if (uv < 11) return "linear-gradient(180deg, #e8615a, rgba(232,97,90,0.4))";
  return "linear-gradient(180deg, #c06fd0, rgba(192,111,208,0.4))";
}

function renderUV(times, uvs) {
  if (!uvs) { dom.uvBars.innerHTML = ""; dom.uvAxis.innerHTML = ""; dom.uvPeak.textContent = "—"; return; }
  const c = chartHTML(daySlice(times, uvs, localDateStr(new Date())), "uv", 760);
  dom.uvBars.innerHTML = c.bars;
  dom.uvAxis.innerHTML = c.axis;
  dom.uvPeak.textContent = c.peakLabel;
}

/* ---------------------------------------------------------------------------
   7-day forecast (glassmorphic panel)
   ------------------------------------------------------------------------- */

const fmtWeekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const fmtDayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

let weekData = null;  // last fetched { daily, hourly }, for building day drawers
let openDay = null;   // index of the expanded forecast day, if any

// Expanded detail for one forecast day: sun times, temps in C and F, and
// hourly UV + rain charts for that day.
function drawerHTML(i) {
  const d = weekData.daily, h = weekData.hourly;
  const dateStr = d.time[i];
  const uv = chartHTML(daySlice(h.time, h.uv_index || [], dateStr), "uv");
  const rn = chartHTML(daySlice(h.time, h.precipitation_probability || [], dateStr), "rain");
  // Sun times are the location's local wall-time strings ("…T04:44"); show the
  // HH:MM directly rather than reparsing in the viewer's timezone.
  const hhmmOf = (s) => (s && s.length >= 16 ? s.slice(11, 16) : "—");
  const hi = d.temperature_2m_max[i], lo = d.temperature_2m_min[i];
  return `
    <div class="drawer-meta">
      <span>SUNRISE <b>${hhmmOf(d.sunrise[i])}</b></span>
      <span>SUNSET <b>${hhmmOf(d.sunset[i])}</b></span>
      <span>HIGH <b>${round(hi)}°C / ${round(cToF(hi))}°F</b></span>
      <span>LOW <b>${round(lo)}°C / ${round(cToF(lo))}°F</b></span>
    </div>
    <div class="drawer-charts">
      <div class="chart">
        <div class="chart-head"><span class="chart-title">UV INDEX</span><span class="chart-legend">${uv.peakLabel}</span></div>
        <div class="chart-bars">${uv.bars}</div>
        <div class="chart-axis">${uv.axis}</div>
      </div>
      <div class="chart">
        <div class="chart-head"><span class="chart-title">RAIN</span><span class="chart-legend">${rn.peakLabel}</span></div>
        <div class="chart-bars">${rn.bars}</div>
        <div class="chart-axis">${rn.axis}</div>
      </div>
    </div>`;
}

function renderWeek(daily) {
  const panel = dom.weekPanel;
  const n = daily.time.length;

  // Week-wide temperature range, so each day's bar is positioned within it.
  let wkMin = Infinity, wkMax = -Infinity;
  for (let i = 0; i < n; i++) {
    wkMin = Math.min(wkMin, daily.temperature_2m_min[i]);
    wkMax = Math.max(wkMax, daily.temperature_2m_max[i]);
  }
  const span = Math.max(1, wkMax - wkMin);

  let html = "";
  for (let i = 0; i < n; i++) {
    const date = new Date(daily.time[i] + "T00:00");
    const cond = wmoToCondition(daily.weather_code[i]);
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    const uv = daily.uv_index_max?.[i];
    const band = uvBand(uv);
    const rain = daily.precipitation_probability_max?.[i] ?? 0;
    const left = ((lo - wkMin) / span) * 100;
    const width = ((hi - lo) / span) * 100;
    const dayName = i === 0 ? "Today" : fmtWeekday.format(date);

    html += `<div class="day-wrap${openDay === i ? " open" : ""}" data-day="${i}">
      <button class="day${i === 0 ? " today" : ""}" aria-expanded="${openDay === i}">
        <div class="d-name"><span class="d-day">${dayName}</span><span class="d-date">${fmtDayMonth.format(date)}</span></div>
        <div class="d-icon">${pickIcon(cond.key, true)}</div>
        <div class="d-cond">${cond.label}</div>
        <div class="d-rain">${rain > 0 ? `<span class="rdrop">♦</span>${rain}%` : '<span class="muted">—</span>'}</div>
        <div class="d-uv"><span class="uv-chip" style="background:${band.color}">${uv == null ? "—" : Math.round(uv)}</span><span class="d-uvlabel">${band.label}</span></div>
        <div class="d-range" title="${round(cToF(lo))}°F – ${round(cToF(hi))}°F">
          <span class="t-lo">${round(lo)}°</span>
          <span class="range-track"><span class="range-fill" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></span>
          <span class="t-hi">${round(hi)}°</span>
        </div>
        <span class="d-chev" aria-hidden="true">›</span>
      </button>
      <div class="drawer"><div class="drawer-inner" data-built="0"></div></div>
    </div>`;
  }
  panel.innerHTML = html;

  // Re-fill the open drawer after a refresh so it survives re-renders.
  if (openDay != null && openDay < n) {
    const inner = panel.querySelector(`.day-wrap[data-day="${openDay}"] .drawer-inner`);
    if (inner) { inner.innerHTML = drawerHTML(openDay); inner.dataset.built = "1"; }
  }
}

/* ---------------------------------------------------------------------------
   Weather fetch + render
   ------------------------------------------------------------------------- */

// Approximate location from IP — no permission prompt. Tries two keyless,
// HTTPS, CORS-friendly providers in turn.
async function ipLocate() {
  const providers = [
    { url: "https://ipwho.is/", pick: (j) => (j.success === false ? null : { lat: +j.latitude, lon: +j.longitude, name: j.city }) },
    { url: "https://get.geojs.io/v1/ip/geo.json", pick: (j) => ({ lat: +j.latitude, lon: +j.longitude, name: j.city }) },
  ];
  for (const p of providers) {
    try {
      const r = await fetch(p.url);
      if (!r.ok) continue;
      const loc = p.pick(await r.json());
      if (loc && !isNaN(loc.lat) && !isNaN(loc.lon)) return loc;
    } catch (e) { /* try next */ }
  }
  return null;
}

// Precise GPS — only ever called from an explicit user click, so the browser
// permission prompt happens on demand rather than on load.
function preciseLocate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: null }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: true }
    );
  });
}

const LOC_KEY = "hs:loc";
const saveLoc = (loc) => { try { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch (e) {} };
const loadLoc = () => { try { return JSON.parse(localStorage.getItem(LOC_KEY)); } catch (e) { return null; } };

// Reverse-geocode coords → a place name (best-effort; silent on failure).
// BigDataCloud's client endpoint is keyless and CORS-friendly. Open-Meteo's
// geocoding API only does forward (name → coords) search, so it can't help here.
async function resolveName(lat, lon) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.city || j.locality || j.principalSubdivision || j.countryName || null;
  } catch { return null; }
}

async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,surface_pressure` +
    `&minutely_15=precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max,sunrise,sunset` +
    `&hourly=precipitation_probability,uv_index` +
    `&timezone=auto&forecast_days=7`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather " + r.status);
  return r.json();
}

// Air quality + pollen (separate keyless Open-Meteo host). Pollen fields are
// only populated over Europe; elsewhere they come back null and the UI hides
// that block. Best-effort: a failure just means no air panel.
async function fetchAir(lat, lon) {
  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,european_aqi,pm2_5,` +
      `alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen` +
      `&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function currentHourIndex(times) {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`;
  const i = times.indexOf(key);
  return i >= 0 ? i : 0;
}

/* --- Small time/duration formatters for the conditions + sun panels --- */
function durHuman(ms) {            // "4h 12m" / "12m" / "5m"
  const m = Math.max(0, Math.round(ms / 60000));
  if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; }
  return `${m}m`;
}
const durHM = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
const durMS = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m}m ${s}s` : `${s}s`; };
const niceMins = (m) => (m >= 60 ? durHuman(m * 60000) : `${Math.max(5, Math.round(m / 5) * 5)} min`);

// Open-Meteo (timezone=auto) returns local wall-time strings with no offset,
// e.g. "2026-06-22T21:22". Parse to a true absolute instant using the
// response's utc_offset_seconds; without this a different city's sun times
// would be read in the viewer's own timezone (breaking countdowns).
function apiTime(str, offsetSec) {
  if (!str) return null;
  const ms = Date.parse(str + "Z");
  return isNaN(ms) ? null : new Date(ms - (offsetSec || 0) * 1000);
}

// Format an absolute Date as a wall clock in the given IANA timezone.
function zoneHHMM(d, zone) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone || undefined,
  }).format(d);
}

// Extra current conditions: feels-like, wind (+direction), humidity, pressure.
function renderDetails(cur) {
  const parts = [];
  if (cur.apparent_temperature != null)
    parts.push(`<span class="wd"><span class="wd-l">Feels</span> ${round(cur.apparent_temperature)}°</span>`);
  if (cur.wind_speed_10m != null) {
    const dir = cur.wind_direction_10m ?? 0;
    parts.push(`<span class="wd"><span class="wd-l">Wind</span> ${round(cur.wind_speed_10m)} km/h ` +
      `<span class="wd-arrow" style="transform:rotate(${(dir + 180) % 360}deg)">↑</span> ${compass(dir)}</span>`);
  }
  if (cur.relative_humidity_2m != null)
    parts.push(`<span class="wd"><span class="wd-l">Humidity</span> ${round(cur.relative_humidity_2m)}%</span>`);
  if (cur.surface_pressure != null)
    parts.push(`<span class="wd"><span class="wd-l">Pressure</span> ${round(cur.surface_pressure)} hPa</span>`);
  dom.wxDetails.innerHTML = parts.join("");
  dom.wxDetails.hidden = parts.length === 0;
}

// Short-term rain nowcast from the 15-minute precipitation cast.
function renderNowcast(minutely) {
  const node = dom.nowcast;
  if (!minutely || !minutely.time || !minutely.precipitation) { node.hidden = true; return; }
  const now = Date.now();
  const times = minutely.time, vals = minutely.precipitation;
  let i = 0;
  while (i < times.length && new Date(times[i]).getTime() < now) i++;
  if (i >= times.length) { node.hidden = true; return; }
  const WET = 0.1;                       // mm in a 15-min slot = "raining"
  const horizon = Math.min(times.length, i + 8);   // look ~2h ahead
  const rainingNow = (vals[i] ?? 0) >= WET || (i > 0 && (vals[i - 1] ?? 0) >= WET);
  let msg = "", j = i;
  if (rainingNow) {
    while (j < horizon && (vals[j] ?? 0) >= WET) j++;
    if (j < horizon) {
      const mins = Math.round((new Date(times[j]).getTime() - now) / 60000);
      msg = mins <= 5 ? "Rain easing soon" : `Rain easing in ~${niceMins(mins)}`;
    }
  } else {
    while (j < horizon && (vals[j] ?? 0) < WET) j++;
    if (j < horizon) {
      const mins = Math.round((new Date(times[j]).getTime() - now) / 60000);
      msg = mins <= 5 ? "Rain starting soon" : `Rain starting in ~${niceMins(mins)}`;
    }
  }
  node.textContent = msg;
  node.hidden = !msg;
}

// Air quality (US AQI) + pollen chips. Pollen hides itself outside Europe.
function renderAir(air) {
  const c = air && air.current;
  if (!c) { dom.aqiStat.hidden = true; dom.pollenStat.hidden = true; return; }

  const aqi = c.us_aqi ?? c.european_aqi;
  if (aqi != null) {
    const b = aqiBand(aqi);
    dom.aqiValue.textContent = Math.round(aqi);
    dom.aqiBandEl.textContent = b.label;
    dom.aqiBandEl.style.background = b.color;
    dom.aqiStat.hidden = false;
  } else dom.aqiStat.hidden = true;

  const grains = ["alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen"]
    .map((k) => c[k]).filter((v) => v != null && !isNaN(v));
  if (grains.length) {
    const b = pollenBand(Math.max(...grains));
    dom.pollenBandEl.textContent = b.label;
    dom.pollenBandEl.style.background = b.color;
    dom.pollenStat.hidden = false;
  } else dom.pollenStat.hidden = true;
}

// Sun panel: next event, sunrise/sunset, day length (+ delta), golden hour.
// Times are true instants (offset-aware) so countdowns are correct for any
// city; displayed clock values are formatted in the location's own timezone.
function renderSun(daily, lat, offsetSec, zone) {
  if (!daily || !daily.sunrise || !daily.sunrise[0]) { dom.sunPanel.hidden = true; return; }
  const sr = apiTime(daily.sunrise[0], offsetSec);
  const ss = apiTime(daily.sunset[0], offsetSec);
  const srNext = apiTime(daily.sunrise[1], offsetSec);
  const now = new Date();

  dom.sunriseVal.textContent = zoneHHMM(sr, zone);
  dom.sunsetVal.textContent = zoneHHMM(ss, zone);

  let label = "SUNRISE IN", when = sr;
  if (now >= sr && now < ss) { label = "SUNSET IN"; when = ss; }
  else if (now >= ss) { label = "SUNRISE IN"; when = srNext; }
  dom.sunNextLabel.textContent = label;
  dom.sunNextVal.textContent = when ? durHuman(when - now) : "—";

  dom.dayLenVal.textContent = durHM(ss - sr);
  if (lat != null) {
    const delta = Math.round((dayLengthHours(now, lat) - dayLengthHours(new Date(now - 86400000), lat)) * 3600);
    dom.dayDeltaVal.textContent = `${delta >= 0 ? "+" : "−"}${durMS(Math.abs(delta))} vs yesterday`;
  } else dom.dayDeltaVal.textContent = "";

  // Golden hour: ~50 min before sunset (evening) or after sunrise (overnight).
  const gh = now >= sr && now < ss
    ? [new Date(ss.getTime() - 50 * 60000), ss]
    : [sr, new Date(sr.getTime() + 50 * 60000)];
  dom.goldenVal.textContent = `${zoneHHMM(gh[0], zone)}–${zoneHHMM(gh[1], zone)}`;
  dom.sunPanel.hidden = false;
}

// The active location's own clock, shown only when it differs from system time.
let locZone = null, locOffsetSec = null;
function updateLocTime() {
  const sysOffset = -new Date().getTimezoneOffset() * 60;
  if (!locZone || locOffsetSec == null || locOffsetSec === sysOffset) {
    dom.locTime.hidden = true;
    return;
  }
  try {
    const t = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: locZone,
    }).format(new Date());
    dom.locTime.textContent = `${t} local`;
    dom.locTime.hidden = false;
  } catch { dom.locTime.hidden = true; }
}

function renderWeather(data) {
  dom.wxError.hidden = true;
  const cur = data.current;
  const cond = wmoToCondition(cur.weather_code);
  const isDay = cur.is_day === 1;

  const tc = cur.temperature_2m;
  dom.temp.textContent = round(tc) + "°";
  dom.tempC.textContent = round(tc) + "°C";
  dom.tempF.textContent = round(cToF(tc)) + "°F";
  dom.condition.textContent = cond.label;
  dom.wxIcon.innerHTML = pickIcon(cond.key, isDay);

  const hi = data.daily.temperature_2m_max[0];
  const lo = data.daily.temperature_2m_min[0];
  dom.tempHi.textContent = `${round(hi)}° / ${round(cToF(hi))}°`;
  dom.tempLo.textContent = `${round(lo)}° / ${round(cToF(lo))}°`;

  // Current UV from hourly (falls back to daily max).
  let uv = data.daily.uv_index_max?.[0];
  const hi24 = currentHourIndex(data.hourly.time);
  if (data.hourly.uv_index && data.hourly.uv_index[hi24] != null) uv = data.hourly.uv_index[hi24];
  const band = uvBand(uv);
  dom.uvValue.textContent = uv == null ? "—" : Math.round(uv * 10) / 10;
  dom.uvBand.textContent = band.label;
  dom.uvBand.style.background = band.color;

  // The location's timezone — used to interpret the API's local-time strings
  // (sunrise/sunset) and to drive the secondary "local" clock.
  locZone = data.timezone || null;
  locOffsetSec = data.utc_offset_seconds ?? null;

  renderDetails(cur);
  renderNowcast(data.minutely_15);
  renderSun(data.daily, coords && coords.lat, locOffsetSec, locZone);
  updateLocTime();

  renderRain(data.hourly.time, data.hourly.precipitation_probability);
  renderUV(data.hourly.time, data.hourly.uv_index);
  weekData = { daily: data.daily, hourly: data.hourly };
  renderWeek(data.daily);

  // Background reflects the real sky; the orb arc reads sunrise/sunset as true
  // instants so the arc/phase track the chosen location, not the viewer's tz.
  skyState.condition = cond.key;
  skyState.sunrise = apiTime(data.daily.sunrise[0], locOffsetSec);
  skyState.sunset = apiTime(data.daily.sunset[0], locOffsetSec);
  skyState.sunriseNext = apiTime(data.daily.sunrise[1], locOffsetSec);
  updateSky();
}

function showWeatherError() {
  dom.wxError.hidden = false;
  dom.wxError.textContent = "Weather unavailable — retrying…";
  // Keep an atmospheric background going from the clock alone.
  skyState.condition = "clear";
  skyState.sunrise = skyState.sunset = skyState.sunriseNext = null;
  updateSky();
}

/* ---------------------------------------------------------------------------
   Orchestration
   ------------------------------------------------------------------------- */

let coords = null;
let lastWeatherAt = 0;

async function loadWeather() {
  if (!coords) return;
  try {
    // Air quality is best-effort (resolves to null on failure) so it never
    // blocks the core weather render.
    const [data, air] = await Promise.all([
      fetchWeather(coords.lat, coords.lon),
      fetchAir(coords.lat, coords.lon),
    ]);
    renderWeather(data);
    renderAir(air);
    lastWeatherAt = Date.now();
  } catch (e) {
    console.error("[homescreen] weather fetch failed:", e);
    showWeatherError();
  }
}

// Saved-location carousel: a fixed set of "Here" (detected/GPS) plus the two
// preset cities. "Here" gains coords once IP/GPS resolves.
const carousel = {
  entries: [
    { id: "here", name: null, lat: null, lon: null, source: "ip" },
    { id: "london", name: LONDON.city, lat: LONDON.lat, lon: LONDON.lon },
    { id: "newyork", name: NEW_YORK.city, lat: NEW_YORK.lat, lon: NEW_YORK.lon },
  ],
  active: 0,
};

// Step to the next/previous entry that has known coords, and show it.
function carouselGo(dir) {
  const n = carousel.entries.length;
  let i = carousel.active;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    const e = carousel.entries[i];
    if (e.lat != null) {
      setLocation({ lat: e.lat, lon: e.lon, name: e.name }, e.id === "here" ? (e.source || "ip") : "city");
      return;
    }
  }
}

// Apply a resolved location: update coords + label, persist, and fetch weather.
// source: "precise" | "city" | "ip" | "fallback"
async function setLocation(loc, source) {
  coords = { lat: loc.lat, lon: loc.lon };
  dom.location.classList.toggle("fallback", source === "fallback");
  // The button always stays available so the user can re-detect their location.
  dom.preciseBtn.hidden = false;
  dom.preciseBtn.textContent = "update location";

  // Sync the carousel: an explicit city selects its entry; anything else
  // ("here") refreshes the first entry to the detected position.
  if (source === "city") {
    const i = carousel.entries.findIndex((e) => e.id !== "here" && e.name === loc.name);
    if (i >= 0) carousel.active = i;
  } else {
    const h = carousel.entries[0];
    h.lat = loc.lat; h.lon = loc.lon; h.source = source;
    if (loc.name) h.name = loc.name;
    carousel.active = 0;
  }

  if (source === "fallback") dom.locName.textContent = "Showing " + loc.name;
  else dom.locName.textContent = loc.name || "Your location";

  saveLoc({ lat: loc.lat, lon: loc.lon, name: loc.name || null, source });
  await loadWeather();

  // Fixes that carry no name (GPS) — fill it in afterwards, best-effort.
  if (!loc.name) {
    const n = await resolveName(loc.lat, loc.lon);
    if (n) {
      dom.locName.textContent = n;
      if (carousel.active === 0) carousel.entries[0].name = n;
      saveLoc({ lat: loc.lat, lon: loc.lon, name: n, source });
    }
  }
}

async function init() {
  tickClock();
  setInterval(tickClock, 1000);

  // Provisional background before data arrives, then keep the orb moving.
  updateSky();
  setInterval(() => updateSky(), 60 * 1000);

  // Always open at the top (the clock), not wherever the page was last left.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // When the tab wakes from the background, snap the clock/sky forward and
  // refetch weather if it has gone stale.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    tickClock();
    updateSky();
    if (Date.now() - lastWeatherAt > 10 * 60 * 1000) loadWeather();
  });

  // Scroll hint glides to the forecast without leaving a #hash in the URL.
  dom.scrollHint.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("forecast").scrollIntoView({ behavior: "smooth" });
  });

  // Fade the scroll hint away once the user starts scrolling.
  addEventListener("scroll", () => {
    dom.scrollHint.classList.toggle("gone", window.scrollY > 40);
  }, { passive: true });

  // Forecast day rows toggle a detail drawer (one open at a time).
  dom.weekPanel.addEventListener("click", (e) => {
    const wrap = e.target.closest(".day-wrap");
    if (!wrap || !weekData) return;
    const i = +wrap.dataset.day;
    const wasOpen = wrap.classList.contains("open");
    dom.weekPanel.querySelectorAll(".day-wrap.open").forEach((w) => {
      w.classList.remove("open");
      w.querySelector(".day").setAttribute("aria-expanded", "false");
    });
    openDay = null;
    if (!wasOpen) {
      const inner = wrap.querySelector(".drawer-inner");
      if (inner.dataset.built !== "1") { inner.innerHTML = drawerHTML(i); inner.dataset.built = "1"; }
      wrap.classList.add("open");
      wrap.querySelector(".day").setAttribute("aria-expanded", "true");
      openDay = i;
    }
  });

  // Update-location button: re-detects the user's position via GPS (the
  // permission prompt only appears on this explicit click).
  dom.preciseBtn.addEventListener("click", async () => {
    dom.preciseBtn.textContent = "locating…";
    const loc = await preciseLocate();
    if (loc) await setLocation(loc, "precise");
    else dom.preciseBtn.textContent = "location blocked";
  });

  // Click a secondary clock (London / New York) to show its weather.
  dom.worldClocks.addEventListener("click", (e) => {
    const btn = e.target.closest(".wclock");
    if (!btn) return;
    setLocation(
      { lat: +btn.dataset.lat, lon: +btn.dataset.lon, name: btn.dataset.name },
      "city"
    );
  });

  // Carousel arrows (and ←/→ keys) cycle through the saved locations.
  dom.locPrev.hidden = false;
  dom.locNext.hidden = false;
  dom.locPrev.addEventListener("click", () => carouselGo(-1));
  dom.locNext.addEventListener("click", () => carouselGo(1));
  addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") carouselGo(-1);
    else if (e.key === "ArrowRight") carouselGo(1);
  });

  // 1. Instant render from the last known location, if any.
  const cached = loadLoc();
  if (cached && cached.lat != null) await setLocation(cached, cached.source || "ip");

  // 2. Learn "here" from IP for the carousel, and switch to it unless the user
  //    has an explicit choice (GPS fix or hand-picked city) that should stick.
  const explicit = cached && (cached.source === "precise" || cached.source === "city");
  if (carousel.entries[0].lat == null || !explicit) {
    const ip = await ipLocate();
    if (ip) {
      const h = carousel.entries[0];
      if (h.lat == null) { h.lat = ip.lat; h.lon = ip.lon; h.name = ip.name || h.name; h.source = "ip"; }
      if (!explicit) await setLocation(ip, "ip");
    } else if (!cached) {
      await setLocation(FALLBACK, "fallback");
    }
  }

  setInterval(loadWeather, WEATHER_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", init);
