// Weather-code and index → human-readable bands. Pure, DOM-free.

// WMO weather code -> normalized condition + readable label.
export function wmoToCondition(code) {
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
export function uvBand(uv) {
  if (uv == null || isNaN(uv)) return { label: "—", color: "rgba(255,255,255,0.1)" };
  if (uv < 3) return { label: "Low", color: "rgba(120,200,140,0.32)" };
  if (uv < 6) return { label: "Moderate", color: "rgba(232,200,90,0.34)" };
  if (uv < 8) return { label: "High", color: "rgba(232,150,70,0.38)" };
  if (uv < 11) return { label: "Very high", color: "rgba(225,90,80,0.4)" };
  return { label: "Extreme", color: "rgba(180,100,200,0.42)" };
}

// US AQI -> descriptive band + chip colour (matches the UV badge styling).
export function aqiBand(aqi) {
  if (aqi == null || isNaN(aqi)) return { label: "—", color: "rgba(255,255,255,0.1)" };
  if (aqi <= 50)  return { label: "Good", color: "rgba(120,200,140,0.34)" };
  if (aqi <= 100) return { label: "Moderate", color: "rgba(232,200,90,0.34)" };
  if (aqi <= 150) return { label: "Unhealthy*", color: "rgba(232,150,70,0.38)" };
  if (aqi <= 200) return { label: "Unhealthy", color: "rgba(225,90,80,0.4)" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "rgba(180,100,200,0.42)" };
  return { label: "Hazardous", color: "rgba(160,60,70,0.46)" };
}

// Peak pollen across types (grains/m³) -> band. Rough, type-agnostic scale.
export function pollenBand(grains) {
  if (grains == null || isNaN(grains)) return { label: "—", color: "rgba(255,255,255,0.1)" };
  if (grains < 10)  return { label: "Low", color: "rgba(120,200,140,0.34)" };
  if (grains < 50)  return { label: "Moderate", color: "rgba(232,200,90,0.34)" };
  if (grains < 100) return { label: "High", color: "rgba(232,150,70,0.38)" };
  return { label: "Very high", color: "rgba(225,90,80,0.4)" };
}
