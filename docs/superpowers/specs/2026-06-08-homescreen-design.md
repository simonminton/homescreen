# Browser Homescreen — Design

**Date:** 2026-06-08
**Status:** Approved pending spec review

## Purpose

A beautifully designed, atmospheric homescreen (hosted webpage) that the user sets
as their browser homepage. It shows the current time and date, a secondary clock for
their "other" city, and rich local weather based on the user's location.

## Goals

- Immersive, alive feel — the background responds to time of day and weather.
- At-a-glance time, date, and weather without interaction.
- Robust: degrades gracefully when location or weather data is unavailable.

## Non-Goals (YAGNI)

- No accounts, settings UI, or persistence beyond what's needed.
- No build pipeline or framework.
- No multi-page navigation; this is a single screen.

## Tech Stack

- **Vanilla HTML + CSS + JavaScript**, single page, no build step.
- **Canvas API** used only for animated weather particles (rain / snow / drifting stars).
  Everything else is CSS.
- **Open-Meteo** for weather data (free, no API key).
- **Browser Geolocation API** for the user's coordinates.
- **`Intl.DateTimeFormat`** for timezone detection and per-city time rendering.
- Deployable to any static host by uploading three files (`index.html`, `style.css`, `app.js`).

## Visual Direction: Dynamic & Atmospheric

The background is the star of the screen.

### Background

A layered, subtly animated gradient driven by **two inputs**:

1. **Time of day** — phases: dawn, day, golden hour, dusk, night. Determined from the
   local clock (sunrise/sunset from Open-Meteo refine the boundaries when available).
2. **Current condition** — clear, partly cloudy, cloudy/overcast, rain, snow, fog.

Examples:
- Clear night → deep indigo with slowly drifting stars (canvas).
- Overcast afternoon → muted grey-blue, flat and soft.
- Rain → backdrop darkens, falling streaks animate on canvas.
- Snow → drifting flakes on canvas.

Transitions between states are smooth (CSS transitions on gradient layers).

### Layout (top → bottom, centered column)

1. **Hero time** — large, softly glowing **24-hour** local time (`HH:MM`, with seconds
   ticking subtly).
2. **Date** — full date beneath the time (e.g. `Monday, 8 June 2026`).
3. **Secondary clock(s)** — smaller, labeled clocks for the "other" city (see logic below).
4. **Current weather** — temperature shown in **both °C and °F**, condition label + icon,
   and **today's high / low**.
5. **UV index** — numeric value plus descriptive band (Low / Moderate / High / Very High /
   Extreme).
6. **24-hour rain timeline** — a horizontal row of hourly bars showing precipitation
   probability for the next 24 hours, so the user can see at a glance when rain is likely.
   Each bar's height encodes probability; hour labels beneath.

All foreground content sits over the scene with soft text shadow / a subtle scrim for
contrast — **no heavy cards**, preserving the immersive feel.

## Secondary Clock Logic

Detect the system IANA timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`.

- `Europe/London` → secondary clock shows **New York** time.
- `America/New_York` → secondary clock shows **London** time.
- Any other timezone → show **both** London and New York secondary clocks.

Each secondary clock is rendered with `Intl.DateTimeFormat` using the target IANA zone
(`Europe/London`, `America/New_York`), 24-hour format, and labeled with the city name.

## Data & Behavior

### Location

1. On load, request coordinates via the Geolocation API.
2. On success → use the returned lat/lon.
3. On denial / error / timeout → fall back to **London, UK** (lat 51.5074, lon -0.1278),
   and show a small, unobtrusive "Showing London" note.

### Weather (Open-Meteo)

A single request fetches:
- **Current**: temperature, weather code (→ condition + icon), and (for time-of-day
  refinement) sunrise/sunset.
- **Daily**: today's max/min temperature, max UV index, sunrise, sunset.
- **Hourly**: precipitation probability for the next 24 hours.

Temperature requested in °C; °F derived client-side (`F = C * 9/5 + 32`) so both display
without a second request.

Weather codes (WMO) are mapped to a small set of conditions + icons used by both the
display and the background selector.

### Refresh

- Clock updates every second.
- Weather refreshes every ~15 minutes.

## Error Handling

- **Geolocation fails** → silent fallback to London with a small note. Screen fully works.
- **Weather API fails** → the clock keeps running; the weather region shows a gentle
  "Weather unavailable — retrying…" message and retries on the next cycle. No broken screen.
- **Partial data** (e.g., UV missing) → hide just that element rather than erroring.

## Component Breakdown

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `clock` | Render local time, date, and secondary city clocks; tick every second | `Intl.DateTimeFormat` |
| `location` | Resolve coordinates (geolocation → London fallback) | Geolocation API |
| `weather` | Fetch + normalize Open-Meteo data into a simple model | `location`, Open-Meteo |
| `background` | Choose gradient + particle effect from time-of-day + condition | `clock`, `weather` |
| `particles` | Canvas animation for rain / snow / stars | `background` |
| `ui` | Render weather readouts, UV, and the 24h rain timeline | `weather` |

Each unit exposes a small, clear interface and can be reasoned about independently.

## Testing Approach

- **Manual visual verification** in the browser is primary (this is a visual artifact).
- **Pure logic is unit-testable** and should be factored to allow it: WMO-code→condition
  mapping, time-of-day phase selection, °C→°F conversion, secondary-clock city selection,
  and UV-index→band mapping. These take plain inputs and return plain outputs.
- Verify fallbacks by simulating geolocation denial and an Open-Meteo failure.

## Success Criteria

- Loads to a polished, atmospheric screen showing accurate local time, date, and weather.
- Background visibly reflects both time of day and current conditions.
- Weather shows °C and °F, today's high/low, UV index, and a 24h rain-probability timeline.
- Secondary clock follows the London/New York logic.
- Works (clock at minimum) even when location or weather is unavailable.
