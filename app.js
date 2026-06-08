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

// Decide which secondary city clocks to show from the system timezone.
function secondaryCities(tz) {
  if (tz === "Europe/London") return [{ city: "New York", zone: "America/New_York" }];
  if (tz === "America/New_York") return [{ city: "London", zone: "Europe/London" }];
  return [
    { city: "London", zone: "Europe/London" },
    { city: "New York", zone: "America/New_York" },
  ];
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

/* ---------------------------------------------------------------------------
   DOM references
   ------------------------------------------------------------------------- */

const el = (id) => document.getElementById(id);
const dom = {
  time: el("time"), secs: el("secs"), date: el("date"),
  locName: el("locName"), location: el("location"),
  worldClocks: el("worldClocks"),
  temp: el("temp"), tempC: el("tempC"), tempF: el("tempF"),
  condition: el("condition"), tempHi: el("tempHi"), tempLo: el("tempLo"),
  wxIcon: el("wxIcon"), uv: el("uv"), uvValue: el("uvValue"), uvBand: el("uvBand"),
  wxError: el("wxError"),
  rainBars: el("rainBars"), rainAxis: el("rainAxis"), rainPeak: el("rainPeak"),
  sky: el("sky"), orb: el("orb"), veil: el("veil"),
};

/* ---------------------------------------------------------------------------
   Clock
   ------------------------------------------------------------------------- */

const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const fmtTime = (zone) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone,
  });
const fmtSecs = new Intl.DateTimeFormat("en-GB", { second: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const cities = secondaryCities(SYSTEM_TZ);
const cityFormatters = cities.map((c) => ({ ...c, fmt: fmtTime(c.zone) }));

// Build secondary clock markup once.
dom.worldClocks.innerHTML = cityFormatters
  .map((c) => `<div class="wclock"><span class="wc-city">${c.city}</span><span class="wc-time" data-zone="${c.zone}">--:--</span></div>`)
  .join("");
const wclockNodes = [...dom.worldClocks.querySelectorAll(".wc-time")];

function tickClock() {
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  dom.time.firstChild.textContent = hhmm;
  dom.secs.textContent = fmtSecs.format(now);
  dom.date.textContent = fmtDate.format(now);
  cityFormatters.forEach((c, i) => { wclockNodes[i].textContent = c.fmt.format(now); });
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

const ORB_POS = {
  night:  { x: "78%", y: "20%" },
  dawn:   { x: "20%", y: "70%" },
  day:    { x: "72%", y: "22%" },
  golden: { x: "82%", y: "62%" },
  dusk:   { x: "26%", y: "66%" },
};

function applyBackground(phase, condition, isDay) {
  const [a, b, c] = skyPalette(phase, condition);
  const root = document.documentElement.style;
  root.setProperty("--sky-1", a);
  root.setProperty("--sky-2", b);
  root.setProperty("--sky-3", c);

  // Orb: sun by day (warm), moon by night (cool). Hidden under thick cloud.
  const pos = ORB_POS[phase] || ORB_POS.day;
  root.setProperty("--orb-x", pos.x);
  root.setProperty("--orb-y", pos.y);

  const sunish = phase === "day" || phase === "dawn" || phase === "golden";
  if (sunish) {
    const warm = phase === "day" ? "rgba(255,250,235,0.95)" : "rgba(255,214,160,0.95)";
    root.setProperty("--orb-color", warm);
    root.setProperty("--orb-glow", phase === "golden" ? "rgba(255,170,90,0.32)" : "rgba(255,230,180,0.28)");
    root.setProperty("--orb-size", "150px");
  } else {
    root.setProperty("--orb-color", "rgba(232,238,255,0.92)");
    root.setProperty("--orb-glow", "rgba(180,200,255,0.20)");
    root.setProperty("--orb-size", "110px");
  }

  const hideOrb = condition === "cloudy" || condition === "rain" || condition === "storm" || condition === "fog";
  dom.orb.style.opacity = hideOrb ? "0" : "0.95";

  // Veil for hazy / stormy moods.
  let veil = "transparent";
  if (condition === "fog") veil = "rgba(200,202,208,0.16)";
  else if (condition === "storm") veil = "rgba(10,12,22,0.22)";
  root.setProperty("--veil-color", veil);

  startParticles(phase, condition, isDay);
}

/* ---------------------------------------------------------------------------
   Canvas particles: stars (clear night), rain, snow
   ------------------------------------------------------------------------- */

const canvas = el("particles");
const ctx = canvas.getContext("2d");
let particles = [];
let particleMode = "none";
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
   Rain timeline (next 24h precipitation probability)
   ------------------------------------------------------------------------- */

function renderRain(times, probs) {
  // Find the index of the current local hour, take the next 24 entries.
  const now = new Date();
  let start = times.findIndex((t) => new Date(t) >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()));
  if (start < 0) start = 0;
  const slice = [];
  for (let i = start; i < start + 24 && i < times.length; i++)
    slice.push({ t: new Date(times[i]), p: probs[i] ?? 0 });

  dom.rainBars.innerHTML = "";
  dom.rainAxis.innerHTML = "";
  let peak = 0;

  slice.forEach((h, i) => {
    peak = Math.max(peak, h.p);
    const bar = document.createElement("div");
    bar.className = "rbar" + (i === 0 ? " now" : "") + (h.p < 5 ? " dry" : "");
    const pct = Math.max(2, h.p);
    bar.style.height = pct + "%";
    bar.style.animationDelay = 760 + i * 22 + "ms";
    bar.title = `${h.t.getHours().toString().padStart(2, "0")}:00 — ${h.p}%`;
    dom.rainBars.appendChild(bar);

    const ax = document.createElement("span");
    const hr = h.t.getHours();
    if (hr % 6 === 0) { ax.className = "tick"; ax.textContent = hr.toString().padStart(2, "0"); }
    dom.rainAxis.appendChild(ax);
  });

  dom.rainPeak.textContent = peak > 0 ? `peak ${peak}%` : "dry";
}

/* ---------------------------------------------------------------------------
   Weather fetch + render
   ------------------------------------------------------------------------- */

async function getLocation() {
  if (!navigator.geolocation) return { ...FALLBACK, fallback: true };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ name: null, lat: pos.coords.latitude, lon: pos.coords.longitude, fallback: false }),
      () => resolve({ ...FALLBACK, fallback: true }),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

// Reverse-geocode for a display name (best-effort; silent on failure).
async function resolveName(lat, lon) {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&latitude=${lat}&longitude=${lon}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.results?.[0]?.name || null;
  } catch { return null; }
}

async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset` +
    `&hourly=precipitation_probability,uv_index` +
    `&timezone=auto&forecast_days=2`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather " + r.status);
  return r.json();
}

function currentHourIndex(times) {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`;
  const i = times.indexOf(key);
  return i >= 0 ? i : 0;
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

  renderRain(data.hourly.time, data.hourly.precipitation_probability);

  // Background reflects real sky.
  const sunrise = new Date(data.daily.sunrise[0]);
  const sunset = new Date(data.daily.sunset[0]);
  const phase = timeOfDayPhase(new Date(), sunrise, sunset);
  applyBackground(phase, cond.key, isDay);
}

function showWeatherError() {
  dom.wxError.hidden = false;
  dom.wxError.textContent = "Weather unavailable — retrying…";
  // Keep an atmospheric background going from the clock alone.
  const phase = timeOfDayPhase(new Date(), null, null);
  applyBackground(phase, "clear", phase !== "night");
}

/* ---------------------------------------------------------------------------
   Orchestration
   ------------------------------------------------------------------------- */

let coords = null;

async function loadWeather() {
  if (!coords) return;
  try {
    const data = await fetchWeather(coords.lat, coords.lon);
    renderWeather(data);
  } catch (e) {
    console.error("[homescreen] weather fetch failed:", e);
    showWeatherError();
  }
}

async function init() {
  tickClock();
  setInterval(tickClock, 1000);

  // Provisional background before data arrives.
  const phase0 = timeOfDayPhase(new Date(), null, null);
  applyBackground(phase0, "clear", phase0 !== "night");

  const loc = await getLocation();
  coords = loc;

  if (loc.fallback) {
    dom.location.classList.add("fallback");
    dom.locName.textContent = "Showing " + loc.name;
  } else {
    dom.locName.textContent = "Locating…";
    const name = await resolveName(loc.lat, loc.lon);
    dom.locName.textContent = name || "Your location";
  }

  await loadWeather();
  setInterval(loadWeather, WEATHER_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", init);
