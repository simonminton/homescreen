// Moon phase maths + phase-accurate SVG renderer. Pure, DOM-free.

// Moon phase as a fraction of the synodic month: 0 = new, 0.5 = full.
export const SYNODIC = 29.53058867;
export function moonPhaseFrac(date) {
  const ref = Date.UTC(2000, 0, 6, 18, 14); // known new moon
  const days = (date.getTime() - ref) / 86400000;
  const p = (days % SYNODIC) / SYNODIC;
  return p < 0 ? p + 1 : p;
}

export function moonInfo(p) {
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * p)) / 2) * 100);
  const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
                 "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  return { name: names[Math.round(p * 8) % 8], illum };
}

// Phase-accurate moon as inline SVG: lit shape bounded by the limb and the
// terminator ellipse (rx = R·|cos 2πp|), plus earthshine disc and craters.
// uid keeps gradient/clip ids unique when the SVG appears twice on the page.
export function moonSVG(p, uid) {
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
