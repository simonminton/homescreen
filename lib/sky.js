// Sky palette + orb-arc geometry. Pure colour/maths, DOM-free.

// Time-of-day phase from current time relative to sunrise/sunset Date objects.
// Returns one of: night | dawn | day | golden | dusk.
export function timeOfDayPhase(now, sunrise, sunset) {
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
export const BASE_PALETTES = {
  night:  ["#080a1f", "#101633", "#1a1430"],
  dawn:   ["#243a6b", "#9d6585", "#f0a878"],
  day:    ["#2f6fc7", "#5fa0df", "#a9d0ee"],
  golden: ["#1d335c", "#d4733f", "#f2bd6e"],
  dusk:   ["#15152f", "#473867", "#9c5570"],
};

export const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const rgbToCss = ([r, g, b]) => `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Pull a clear-sky palette toward a target tint by amount t.
export function tintPalette(palette, target, t) {
  return palette.map((hex) => rgbToCss(mix(hexToRgb(hex), target, t)));
}

// Final sky palette from phase + condition.
export function skyPalette(phase, condition) {
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
export const CONDITION_TINT = {
  cloudy: [[86, 92, 104], 0.55], partly: [[110, 120, 135], 0.25],
  rain: [[44, 52, 66], 0.62], storm: [[26, 30, 42], 0.72],
  snow: [[150, 158, 172], 0.5], fog: [[150, 152, 158], 0.6],
};

// Clear-sky palettes as rgb triples, for continuous interpolation by altitude.
export const PHASE_RGB = {};
for (const k in BASE_PALETTES) PHASE_RGB[k] = BASE_PALETTES[k].map(hexToRgb);

// Continuous sky palette from the sun's true altitude (degrees). Blends between
// night / twilight / golden / day anchors; twilight leans dawn or dusk.
export function skyPaletteByAltitude(alt, rising, condition) {
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

const sriseTime = (next, fallbackSunset) =>
  next ? next.getTime() : fallbackSunset + 10 * 3600 * 1000;

// Continuous orb position along an east->west arc.
// Daytime: progress runs sunrise(0) -> sunset(1). Night: sunset -> next sunrise.
// Returns x/y as viewport percentages, altitude (0 horizon .. 1 peak), and isDay.
export function orbArc(now, sunrise, sunset, sunriseNext) {
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
