/**
 * Tool definitions and implementations for Lunch Uncle.
 *
 * Each tool is split in two: a fetch function that talks to the network,
 * and a pure format function that shapes the response for the model.
 * The format functions are the ones covered by tests.
 */

// CT Hub 2, 114 Lavender Street.
export const CT_HUB_2 = { latitude: 1.3115, longitude: 103.8615 };

const SEARCH_RADIUS_METRES = 800;
const MAX_PLACES = 10;
const FORECAST_AREA = "Kallang";
const TOOL_TIMEOUT_MS = 8_000;
// Same search again within this window reuses the saved answer instead of
// paying Google again.
const PLACES_CACHE_SECONDS = 600;
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FORECAST_URL =
  "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast";
const BUS_URL = "https://arrivelah2.busrouter.sg/";

// ---------------------------------------------------------------------------
// Definitions sent to the model
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "find_lunch_places",
      description:
        "Search for places to eat near CT Hub 2. Returns name, rating, distance in metres, open_now (open at this moment) and hours_today (today's opening hours).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'What to search for, e.g. "chicken rice", "japanese", "cheap lunch".',
          },
          open_now: {
            type: "boolean",
            description:
              "Only return places open at this exact moment. Do not use it when the user plans to eat later; check hours_today instead.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rain_forecast",
      description:
        "Get the two-hour weather forecast for the Kallang area, which covers CT Hub 2.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bus_arrivals",
      description:
        "Get the next bus arrivals at a Singapore bus stop, by five-digit stop code.",
      parameters: {
        type: "object",
        properties: {
          stop_code: {
            type: "string",
            description: 'Five-digit bus stop code, e.g. "07371".',
          },
        },
        required: ["stop_code"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Run one tool call requested by the model and return the result as a string.
 */
export async function executeTool(name, args, env) {
  // A tool that crashes or times out should not sink the whole reply.
  // Hand the model an error instead, so Uncle can carry on without it.
  try {
    return JSON.stringify(await runTool(name, args, env));
  } catch (err) {
    console.error(`tool ${name} failed:`, err);
    return JSON.stringify({ error: `${name} is not working right now` });
  }
}

async function runTool(name, args, env) {
  switch (name) {
    case "find_lunch_places":
      return findLunchPlaces(args, env);
    case "get_rain_forecast":
      return getRainForecast();
    case "get_bus_arrivals":
      return getBusArrivals(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// find_lunch_places
// ---------------------------------------------------------------------------

async function findLunchPlaces({ query, open_now = false }, env) {
  const centre = CT_HUB_2;

  // Check the short-lived cache first. caches only exists inside Workers.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(
    `https://places-cache.lunch-uncle.internal/?q=${encodeURIComponent(
      String(query ?? "").trim().toLowerCase(),
    )}&open=${open_now ? 1 : 0}`,
  );
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const data = await hit.json();
      return { places: formatPlaces(data.places ?? [], centre) };
    }
  }

  const body = {
    textQuery: query,
    includedType: "restaurant",
    openNow: open_now,
    pageSize: MAX_PLACES,
    // Restriction, not bias: only return places inside the walking area.
    // Text Search only accepts a rectangle here, so build one around CT Hub 2.
    locationRestriction: {
      rectangle: boundingBox(centre, SEARCH_RADIUS_METRES),
    },
  };

  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.rating,places.currentOpeningHours",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });

  if (!res.ok) {
    return { error: `Places API returned ${res.status}` };
  }

  const data = await res.json();
  if (cache) {
    // Save Google's raw answer, so hours_today is still worked out fresh.
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(data), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${PLACES_CACHE_SECONDS}`,
        },
      }),
    );
  }
  return { places: formatPlaces(data.places ?? [], centre) };
}

/**
 * Shape Places API results into the fields Uncle needs.
 *
 * hours_today is today's line from Google's weekly hours, so Uncle can tell
 * whether a place will be open at a later lunch time, not just right now.
 */
export function formatPlaces(places, origin, now = new Date()) {
  const dayIndex = singaporeWeekdayIndex(now);
  return places.map(({ displayName, rating, location, currentOpeningHours }) => ({
    name: displayName?.text ?? "Unnamed",
    rating: rating ?? null,
    distance_m: location ? Math.round(haversineMetres(origin, location)) : null,
    open_now: currentOpeningHours?.openNow ?? null,
    hours_today: currentOpeningHours?.weekdayDescriptions?.[dayIndex] ?? null,
  }));
}

/**
 * Today's position in Google's weekdayDescriptions list, which runs
 * Monday (0) to Sunday (6), using the date in Singapore.
 */
export function singaporeWeekdayIndex(now) {
  const sundayFirst = new Date(now.getTime() + SG_OFFSET_MS).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/**
 * A square of roughly `radiusMetres` on each side of `centre`, as the
 * {low, high} rectangle that Places Text Search expects.
 */
export function boundingBox(centre, radiusMetres) {
  const METRES_PER_DEG_LAT = 111_320;
  const dLat = radiusMetres / METRES_PER_DEG_LAT;
  const dLon =
    radiusMetres /
    (METRES_PER_DEG_LAT * Math.cos((centre.latitude * Math.PI) / 180));
  return {
    low: { latitude: centre.latitude - dLat, longitude: centre.longitude - dLon },
    high: { latitude: centre.latitude + dLat, longitude: centre.longitude + dLon },
  };
}

/**
 * Great-circle distance between two {latitude, longitude} points, in metres.
 */
export function haversineMetres(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// get_rain_forecast
// ---------------------------------------------------------------------------

async function getRainForecast() {
  const res = await fetch(FORECAST_URL, {
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: `Forecast API returned ${res.status}` };
  }
  return formatForecast(await res.json(), FORECAST_AREA);
}

/**
 * Pull one area's forecast out of the data.gov.sg two-hour forecast payload.
 */
export function formatForecast(payload, area) {
  const item = payload?.data?.items?.[0];
  if (!item) {
    return { error: "No forecast available" };
  }
  const entry = (item.forecasts ?? []).find((f) => f.area === area);
  return {
    area,
    forecast: entry?.forecast ?? "Unknown",
    valid_period: item.valid_period?.text ?? null,
  };
}

// ---------------------------------------------------------------------------
// get_bus_arrivals
// ---------------------------------------------------------------------------

async function getBusArrivals({ stop_code }) {
  const url = `${BUS_URL}?id=${encodeURIComponent(stop_code)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) });
  if (!res.ok) {
    return { error: `Bus API returned ${res.status}` };
  }
  return formatBusArrivals(await res.json(), stop_code);
}

/**
 * Reduce an arrivelah response to service numbers and minutes to arrival.
 */
export function formatBusArrivals(payload, stopCode) {
  const services = payload?.services ?? [];
  return {
    stop_code: stopCode,
    services: services.map((s) => ({
      service: s.no,
      next_min: minutesFromNow(s.next),
      subsequent_min: minutesFromNow(s.subsequent),
    })),
  };
}

function minutesFromNow(arrival) {
  if (!arrival || typeof arrival.duration_ms !== "number") {
    return null;
  }
  return Math.max(0, Math.round(arrival.duration_ms / 60000));
}
