"use strict";

/* =========================================================================
   Homescreen — atmospheric clock + weather
   No build step. Pure logic lives in ./lib/* ES modules (unit-tested);
   this file is the DOM + orchestration layer.
   ========================================================================= */

import { cToF, round, pad, localDateStr, durHuman, durHM, durMS, niceMins, apiTime, zoneHHMM, compass } from "./lib/format.js";
import { wmoToCondition, uvBand, aqiBand, pollenBand } from "./lib/weather.js";
import { sunAltitude, dayLengthHours } from "./lib/solar.js";
import { moonPhaseFrac, moonInfo, moonSVG } from "./lib/moon.js";
import { mix, skyPalette, skyPaletteByAltitude, timeOfDayPhase, orbArc } from "./lib/sky.js";
import { daySlice, chartHTML, uvBarColor, tempChartSVG } from "./lib/charts.js";
import { LONDON, NEW_YORK, secondaryCities } from "./lib/cities.js";

const FALLBACK = { name: "London", lat: 51.5074, lon: -0.1278 };
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

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
  tempChart: el("tempChart"), tempRange: el("tempRange"), tempCurve: el("tempCurve"),
  tcNowLine: el("tcNowLine"), tcDot: el("tcDot"), tcLabel: el("tcLabel"),
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

function renderRain(times, probs) {
  const c = chartHTML(daySlice(times, probs, localDateStr(new Date())), "rain", 760);
  dom.rainBars.innerHTML = c.bars;
  dom.rainAxis.innerHTML = c.axis;
  dom.rainPeak.textContent = c.peakLabel;
}

function renderUV(times, uvs) {
  if (!uvs) { dom.uvBars.innerHTML = ""; dom.uvAxis.innerHTML = ""; dom.uvPeak.textContent = "—"; return; }
  const c = chartHTML(daySlice(times, uvs, localDateStr(new Date())), "uv", 760);
  dom.uvBars.innerHTML = c.bars;
  dom.uvAxis.innerHTML = c.axis;
  dom.uvPeak.textContent = c.peakLabel;
}

function renderTempChart(times, temps) {
  if (!temps) { dom.tempChart.hidden = true; return; }
  const { svg, min, max, now } = tempChartSVG(daySlice(times, temps, localDateStr(new Date())));
  if (!svg) { dom.tempChart.hidden = true; return; }
  // Keep the marker nodes; only replace the <svg>.
  const old = dom.tempCurve.querySelector("svg");
  if (old) old.remove();
  dom.tempCurve.insertAdjacentHTML("afterbegin", svg);
  dom.tempRange.textContent = `${round(min)}° – ${round(max)}°`;

  if (now) {
    dom.tcNowLine.style.left = now.x.toFixed(1) + "%";
    dom.tcDot.style.left = now.x.toFixed(1) + "%";
    dom.tcDot.style.top = now.y.toFixed(1) + "%";
    dom.tcLabel.style.left = now.x.toFixed(1) + "%";
    dom.tcLabel.style.top = now.y.toFixed(1) + "%";
    dom.tcLabel.textContent = round(now.v) + "°";
    dom.tcNowLine.hidden = dom.tcDot.hidden = dom.tcLabel.hidden = false;
  } else {
    dom.tcNowLine.hidden = dom.tcDot.hidden = dom.tcLabel.hidden = true;
  }
  dom.tempChart.hidden = false;
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
    `&hourly=precipitation_probability,uv_index,temperature_2m` +
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
  renderTempChart(data.hourly.time, data.hourly.temperature_2m);
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
