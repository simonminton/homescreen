// Preset cities for the secondary clocks + location carousel. Pure config.

export const LONDON = { city: "London", zone: "Europe/London", lat: 51.5074, lon: -0.1278 };
export const NEW_YORK = { city: "New York", zone: "America/New_York", lat: 40.7128, lon: -74.006 };

// Which secondary city clocks to show, given the system timezone. Each carries
// coords so clicking a clock can switch the weather location.
export function secondaryCities(tz) {
  if (tz === "Europe/London") return [NEW_YORK];
  if (tz === "America/New_York") return [LONDON];
  return [LONDON, NEW_YORK];
}
