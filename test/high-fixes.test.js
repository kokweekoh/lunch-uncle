import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, buildTimeNote } from "../src/prompt.js";
import { cleanSessionId } from "../src/loop.js";
import { formatPlaces, singaporeWeekdayIndex, CT_HUB_2 } from "../src/tools.js";

const WEEK = [
  "Monday: 11:00 AM – 3:00 PM",
  "Tuesday: 11:00 AM – 3:00 PM",
  "Wednesday: 11:30 AM – 2:30 PM, 5:30 – 10:00 PM",
  "Thursday: 11:00 AM – 3:00 PM",
  "Friday: 11:00 AM – 3:00 PM",
  "Saturday: Closed",
  "Sunday: Closed",
];

test("buildTimeNote gives Singapore time to the minute with the weekday", () => {
  // 02:32 UTC is 10:32 am in Singapore.
  assert.equal(
    buildTimeNote(new Date("2026-11-11T02:32:59Z")),
    "[Current time in Singapore: Wed, 11 Nov 2026, 10:32 am]",
  );
  // 16:05 UTC on Wednesday is already Thursday in Singapore.
  assert.match(buildTimeNote(new Date("2026-11-11T16:05:00Z")), /Thu, 12 Nov 2026, 12:05 am/);
});

test("buildSystemPrompt is identical every time, so it can be cached", () => {
  assert.equal(buildSystemPrompt(), buildSystemPrompt());
  assert.doesNotMatch(buildSystemPrompt(), /\d{1,2}:\d{2}/);
});

test("singaporeWeekdayIndex counts Monday as 0 using the Singapore date", () => {
  assert.equal(singaporeWeekdayIndex(new Date("2026-11-09T04:00:00Z")), 0); // Mon noon SG
  assert.equal(singaporeWeekdayIndex(new Date("2026-11-15T04:00:00Z")), 6); // Sun noon SG
  assert.equal(singaporeWeekdayIndex(new Date("2026-11-15T17:00:00Z")), 0); // Mon 1 am SG
});

test("formatPlaces includes today's opening hours", () => {
  const wednesdayNoonSg = new Date("2026-11-11T04:00:00Z");
  const [place, noHours] = formatPlaces(
    [
      {
        displayName: { text: "Izakaya" },
        location: CT_HUB_2,
        currentOpeningHours: { openNow: true, weekdayDescriptions: WEEK },
      },
      { displayName: { text: "Mystery Stall" } },
    ],
    CT_HUB_2,
    wednesdayNoonSg,
  );
  assert.equal(place.hours_today, "Wednesday: 11:30 AM – 2:30 PM, 5:30 – 10:00 PM");
  assert.equal(place.open_now, true);
  assert.equal(noHours.hours_today, null);
});

test("cleanSessionId keeps sane ids and replaces anything else", () => {
  const good = "3f2b6c1e-8a7d-4c1b-9e0f-123456789abc";
  assert.equal(cleanSessionId(good), good);
  for (const bad of [undefined, null, 42, "short", "has spaces in it", "x".repeat(65), "evil\r\nheader: 1"]) {
    const id = cleanSessionId(bad);
    assert.notEqual(id, bad);
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});
