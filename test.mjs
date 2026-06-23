// Unit tests for the pure logic modules. Run with `npm test` (node --test).
// No DOM, no network — these guard the maths/formatting that powers the UI.

import { test } from "node:test";
import assert from "node:assert/strict";

import { cToF, round, pad, localDateStr, durHuman, durHM, durMS, niceMins, apiTime, zoneHHMM, compass } from "./lib/format.js";
import { wmoToCondition, uvBand, aqiBand, pollenBand } from "./lib/weather.js";
import { sunAltitude, dayLengthHours } from "./lib/solar.js";
import { moonPhaseFrac, moonInfo, moonSVG } from "./lib/moon.js";
import { mix, skyPalette, skyPaletteByAltitude, timeOfDayPhase, orbArc } from "./lib/sky.js";
import { daySlice, chartHTML, uvBarColor, tempChartSVG } from "./lib/charts.js";
import { secondaryCities, LONDON, NEW_YORK } from "./lib/cities.js";

/* ---- format ---- */

test("cToF / round", () => {
  assert.equal(cToF(0), 32);
  assert.equal(cToF(100), 212);
  assert.equal(round(2.4), 2);
  assert.equal(round(2.5), 3);
});

test("pad / localDateStr", () => {
  assert.equal(pad(3), "03");
  assert.equal(pad(12), "12");
  assert.equal(localDateStr(new Date(2026, 0, 5)), "2026-01-05");
});

test("duration formatters", () => {
  assert.equal(durHuman(0), "0m");
  assert.equal(durHuman(12 * 60000), "12m");
  assert.equal(durHuman(60 * 60000), "1h");
  assert.equal(durHuman((4 * 60 + 12) * 60000), "4h 12m");
  assert.equal(durHM((16 * 60 + 38) * 60000), "16h 38m");
  assert.equal(durMS(74), "1m 14s");
  assert.equal(durMS(6), "6s");
  assert.equal(niceMins(7), "5 min");   // rounds to nearest 5
  assert.equal(niceMins(33), "35 min");
  assert.equal(niceMins(90), "1h 30m");
});

test("apiTime: offset-aware parse (the timezone regression)", () => {
  // London BST sunset "21:22" is 20:22 UTC.
  assert.equal(apiTime("2026-06-22T21:22", 3600).toISOString(), "2026-06-22T20:22:00.000Z");
  // No offset -> string read as UTC.
  assert.equal(apiTime("2026-06-22T21:22", 0).toISOString(), "2026-06-22T21:22:00.000Z");
  // NYC EDT offset -4h.
  assert.equal(apiTime("2026-06-22T16:22", -4 * 3600).toISOString(), "2026-06-22T20:22:00.000Z");
  assert.equal(apiTime(null, 3600), null);
  assert.equal(apiTime("", 0), null);
});

test("zoneHHMM formats an instant in a named zone", () => {
  const d = new Date("2026-06-22T20:22:00.000Z");
  assert.equal(zoneHHMM(d, "Europe/London"), "21:22");   // BST = UTC+1
  assert.equal(zoneHHMM(d, "America/New_York"), "16:22"); // EDT = UTC-4
  assert.equal(zoneHHMM(null, "Europe/London"), "—");
});

test("compass", () => {
  assert.equal(compass(0), "N");
  assert.equal(compass(90), "E");
  assert.equal(compass(180), "S");
  assert.equal(compass(270), "W");
  assert.equal(compass(45), "NE");
  assert.equal(compass(360), "N");
});

/* ---- weather ---- */

test("wmoToCondition maps representative codes", () => {
  assert.equal(wmoToCondition(0).key, "clear");
  assert.equal(wmoToCondition(2).key, "partly");
  assert.equal(wmoToCondition(3).key, "cloudy");
  assert.equal(wmoToCondition(48).key, "fog");
  assert.equal(wmoToCondition(63).key, "rain");
  assert.equal(wmoToCondition(75).key, "snow");
  assert.equal(wmoToCondition(95).key, "storm");
  assert.equal(wmoToCondition(99).label, "Thunderstorm, hail");
});

test("uvBand / aqiBand / pollenBand boundaries", () => {
  assert.equal(uvBand(null).label, "—");
  assert.equal(uvBand(2).label, "Low");
  assert.equal(uvBand(5).label, "Moderate");
  assert.equal(uvBand(11).label, "Extreme");

  assert.equal(aqiBand(50).label, "Good");
  assert.equal(aqiBand(51).label, "Moderate");
  assert.equal(aqiBand(301).label, "Hazardous");
  assert.equal(aqiBand(undefined).label, "—");

  assert.equal(pollenBand(0).label, "Low");
  assert.equal(pollenBand(60).label, "High");
  assert.equal(pollenBand(200).label, "Very high");
});

/* ---- solar ---- */

test("sunAltitude: high at local noon, below horizon at night", () => {
  // Equator, prime meridian, ~solar noon at summer solstice.
  const noon = sunAltitude(new Date("2026-06-21T12:00:00Z"), 0, 0);
  assert.ok(noon > 55 && noon < 75, `expected ~66, got ${noon}`);
  // Same place at midnight UTC -> sun well below horizon.
  const midnight = sunAltitude(new Date("2026-06-21T00:00:00Z"), 0, 0);
  assert.ok(midnight < -40, `expected deep negative, got ${midnight}`);
});

test("dayLengthHours: ~12h at equator, asymmetric at high latitude", () => {
  const eqSummer = dayLengthHours(new Date(2026, 5, 21), 0);
  assert.ok(Math.abs(eqSummer - 12) < 0.5, `equator ~12h, got ${eqSummer}`);
  const londonSummer = dayLengthHours(new Date(2026, 5, 21), 51.5);
  assert.ok(londonSummer > 16, `London midsummer >16h, got ${londonSummer}`);
  const londonWinter = dayLengthHours(new Date(2026, 11, 21), 51.5);
  assert.ok(londonWinter < 8.5, `London midwinter <8.5h, got ${londonWinter}`);
});

/* ---- moon ---- */

test("moonPhaseFrac stays in [0,1); moonInfo names + illumination", () => {
  for (const d of [new Date("2024-01-01"), new Date("2026-06-23"), new Date("2030-12-31")]) {
    const p = moonPhaseFrac(d);
    assert.ok(p >= 0 && p < 1, `phase out of range: ${p}`);
  }
  assert.equal(moonInfo(0).name, "New Moon");
  assert.equal(moonInfo(0.5).name, "Full Moon");
  assert.equal(moonInfo(0.5).illum, 100);
  assert.equal(moonInfo(0).illum, 0);
});

test("moonSVG returns an <svg> with unique ids", () => {
  const svg = moonSVG(0.25, "test");
  assert.match(svg, /^<svg/);
  assert.match(svg, /mlit-test/);
});

/* ---- sky ---- */

test("mix interpolates componentwise", () => {
  assert.deepEqual(mix([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
  assert.deepEqual(mix([0, 0, 0], [10, 20, 30], 0), [0, 0, 0]);
});

test("skyPalette / skyPaletteByAltitude return three CSS colours", () => {
  const p = skyPalette("day", "clear");
  assert.equal(p.length, 3);
  assert.match(p[0], /^rgb\(/);
  const alt = skyPaletteByAltitude(40, true, "clear");
  assert.equal(alt.length, 3);
  assert.match(alt[2], /^rgb\(/);
});

test("timeOfDayPhase around sunrise/sunset", () => {
  const sunrise = new Date("2026-06-22T05:00:00");
  const sunset = new Date("2026-06-22T21:00:00");
  assert.equal(timeOfDayPhase(new Date("2026-06-22T02:00:00"), sunrise, sunset), "night");
  assert.equal(timeOfDayPhase(new Date("2026-06-22T13:00:00"), sunrise, sunset), "day");
  assert.equal(timeOfDayPhase(new Date("2026-06-22T20:45:00"), sunrise, sunset), "golden");
});

test("orbArc: day vs night and clamped position", () => {
  const sr = new Date("2026-06-22T05:00:00");
  const ss = new Date("2026-06-22T21:00:00");
  const srNext = new Date("2026-06-23T05:00:00");
  const noon = orbArc(new Date("2026-06-22T13:00:00"), sr, ss, srNext);
  assert.equal(noon.isDay, true);
  assert.ok(noon.alt > 0.8, `near peak at midday, got ${noon.alt}`);
  const night = orbArc(new Date("2026-06-22T23:00:00"), sr, ss, srNext);
  assert.equal(night.isDay, false);
  assert.ok(noon.x >= 8 && noon.x <= 92);
});

/* ---- charts ---- */

test("daySlice filters to one date and flags now/past", () => {
  const today = localDateStr(new Date());
  const times = [`${today}T00:00`, `${today}T01:00`, "2099-01-01T00:00"];
  const vals = [10, 20, 30];
  const slice = daySlice(times, vals, today);
  assert.equal(slice.length, 2);
  assert.equal(slice[0].v, 10);
});

test("chartHTML produces bars, axis and a peak label", () => {
  const slice = [
    { t: new Date("2026-06-22T12:00"), v: 40, now: true, past: false },
    { t: new Date("2026-06-22T13:00"), v: 10, now: false, past: false },
  ];
  const rain = chartHTML(slice, "rain");
  assert.match(rain.bars, /class="bar rbar/);
  assert.equal(rain.peakLabel, "peak 40%");
  const uv = chartHTML(slice, "uv");
  assert.match(uv.peakLabel, /^peak /);
  assert.match(uvBarColor(2), /^linear-gradient/);
});

test("tempChartSVG: svg + min/max + now marker", () => {
  const slice = [
    { t: new Date("2026-06-22T00:00"), v: 18, now: false, past: true },
    { t: new Date("2026-06-22T12:00"), v: 34, now: true, past: false },
    { t: new Date("2026-06-22T23:00"), v: 20, now: false, past: false },
  ];
  const { svg, min, max, now } = tempChartSVG(slice);
  assert.match(svg, /<svg/);
  assert.match(svg, /tc-line/);
  assert.equal(min, 18);
  assert.equal(max, 34);
  assert.ok(now && Math.abs(now.x - 50) < 0.01, `now.x ~50, got ${now && now.x}`);
  assert.equal(now.v, 34);
  // Empty slice is handled.
  assert.equal(tempChartSVG([]).svg, "");
});

/* ---- cities ---- */

test("secondaryCities depends on system timezone", () => {
  assert.deepEqual(secondaryCities("Europe/London"), [NEW_YORK]);
  assert.deepEqual(secondaryCities("America/New_York"), [LONDON]);
  assert.equal(secondaryCities("Asia/Tokyo").length, 2);
});
