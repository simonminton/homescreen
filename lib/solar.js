// Solar position (NOAA low-precision algorithm) + day length. Pure, DOM-free.

export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

// Sun altitude in degrees (negative = below horizon) for a Date at lat/lon.
// Accurate to a fraction of a degree — plenty for driving the sky gradient.
export function sunAltitude(date, lat, lon) {
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

export const dayOfYear = (d) =>
  Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);

// Daylight length in hours for a date/latitude, from the sunrise hour angle.
// Used only for the day-length *delta* vs yesterday (today's length itself
// comes from the exact API sunrise/sunset).
export function dayLengthHours(date, lat) {
  const decl = deg2rad(-23.44 * Math.cos(deg2rad((360 / 365) * (dayOfYear(date) + 10))));
  const cosH = -Math.tan(deg2rad(lat)) * Math.tan(decl);
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  return (2 * rad2deg(Math.acos(cosH))) / 15;
}
