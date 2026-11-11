import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatForecast,
  formatBusArrivals,
  formatPlaces,
  haversineMetres,
  CT_HUB_2,
} from "../src/tools.js";

test("formatForecast picks the requested area", () => {
  const payload = {
    data: {
      items: [
        {
          valid_period: { text: "12 pm to 2 pm" },
          forecasts: [
            { area: "Geylang", forecast: "Fair" },
            { area: "Kallang", forecast: "Light Rain" },
          ],
        },
      ],
    },
  };

  assert.deepEqual(formatForecast(payload, "Kallang"), {
    area: "Kallang",
    forecast: "Light Rain",
    valid_period: "12 pm to 2 pm",
  });
});

test("formatBusArrivals converts durations to whole minutes", () => {
  const payload = {
    services: [
      {
        no: "13",
        next: { duration_ms: 100_798 },
        subsequent: { duration_ms: 1_210_000 },
      },
      { no: "107M", next: { duration_ms: 30_000 }, subsequent: null },
    ],
  };

  assert.deepEqual(formatBusArrivals(payload, "07371"), {
    stop_code: "07371",
    services: [
      { service: "13", next_min: 2, subsequent_min: 20 },
      { service: "107M", next_min: 1, subsequent_min: null },
    ],
  });
});

test("haversineMetres measures CT Hub 2 to Lavender MRT at under 600 m", () => {
  const ctHub2 = { latitude: 1.3115, longitude: 103.8615 };
  const lavenderMrt = { latitude: 1.3073, longitude: 103.8631 };
  const distance = haversineMetres(ctHub2, lavenderMrt);
  assert.ok(distance > 400 && distance < 550, `got ${distance}`);
});

test("formatPlaces measures from CT Hub 2 and keeps open-now status", () => {
  const places = [
    {
      displayName: { text: "Lavender Food Square" },
      rating: 4.1,
      location: { latitude: 1.3073, longitude: 103.8631 },
      currentOpeningHours: { openNow: false },
    },
    { displayName: { text: "No Location Stall" } },
  ];
  const [near, noLoc] = formatPlaces(places, CT_HUB_2);
  assert.equal(near.name, "Lavender Food Square");
  assert.equal(near.open_now, false);
  assert.ok(near.distance_m > 400 && near.distance_m < 550);
  assert.deepEqual(noLoc, {
    name: "No Location Stall",
    rating: null,
    distance_m: null,
    open_now: null,
  });
});
