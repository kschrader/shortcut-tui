import { expect, test } from "bun:test";
import type { Reviews } from "../github/types.ts";
import { waitedLabel, waitedPhrase } from "./format.ts";
import { reviewSummary } from "./reviews.ts";

const now = new Date("2026-11-02T09:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

test("a waiting time fits in three columns from minutes to years", () => {
  const cases: [number, string][] = [
    [59 * MINUTE, "<1h"],
    [HOUR, "1h"],
    [23 * HOUR + 59 * MINUTE, "23h"],
    [DAY, "1d"],
    [2 * WEEK - MINUTE, "13d"],
    [2 * WEEK, "2w"],
    [100 * WEEK - MINUTE, "99w"],
    [100 * WEEK, "1y"],
  ];
  for (const [waited, label] of cases) {
    expect(waitedLabel(new Date(now.getTime() - waited), now)).toBe(label);
  }
});

test("a waiting time reads as a phrase in the detail pane", () => {
  expect(waitedPhrase(new Date(now.getTime() - 30 * MINUTE), now)).toBe("less than an hour");
  expect(waitedPhrase(new Date(now.getTime() - DAY), now)).toBe("1 day");
  expect(waitedPhrase(new Date(now.getTime() - 3 * WEEK), now)).toBe("3 weeks");
});

const asking = (...requested: Reviews["requested"]): Reviews => ({ requested, submitted: [] });

test("a request to you by login reads as you, ahead of the others", () => {
  expect(
    reviewSummary(
      asking(
        { kind: "team", slug: "frontend", reachesYou: "no" },
        { kind: "user", login: "kschrader", reachesYou: "yes" },
      ),
    ),
  ).toBe("review requested from you, frontend");
});

test("only the first request that reaches you reads as you", () => {
  expect(
    reviewSummary(
      asking(
        { kind: "team", slug: "engineering", reachesYou: "yes" },
        { kind: "team", slug: "managers", reachesYou: "yes" },
      ),
    ),
  ).toBe("review requested from you (via engineering), managers");
});

test("a team whose membership could not be read says so", () => {
  expect(reviewSummary(asking({ kind: "team", slug: "engineering", reachesYou: "unknown" }))).toBe(
    "review requested from engineering · could not tell which are for you",
  );
});
