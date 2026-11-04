import { describe, expect, test } from "bun:test";
import type { StorySummary } from "../shortcut/types.ts";
import { doing, finished, inState, ownedBy, summary } from "./fixtures.ts";
import { orderFor, ownerGroupLabel } from "./order.ts";

const ids = (stories: readonly StorySummary[]) => stories.map((story) => story.id);

const byOwner = (stories: readonly StorySummary[]) => stories.toSorted(orderFor("owner"));

const movedOn = (story: StorySummary, day: number): StorySummary => ({
  ...story,
  movedAt: new Date(Date.UTC(2026, 9, day)),
});

describe("owner order", () => {
  test("single owners sort by name, ignoring case", () => {
    const stories = [
      ownedBy(summary(1), "bob"),
      ownedBy(summary(2), "Carol"),
      ownedBy(summary(3), "alice"),
    ];
    expect(byOwner(stories).map(ownerGroupLabel)).toEqual(["alice", "bob", "Carol"]);
  });

  test("a shared story joins its owners by name and sorts right after its first owner", () => {
    const stories = [
      ownedBy(summary(1), "Jennifer Scroggins"),
      ownedBy(summary(2), "Jennifer Scroggins", "Daniel Gregoire"),
      ownedBy(summary(3), "Zed"),
      ownedBy(summary(4), "Daniel Gregoire"),
    ];
    expect(byOwner(stories).map(ownerGroupLabel)).toEqual([
      "Daniel Gregoire",
      "Daniel Gregoire + Jennifer Scroggins",
      "Jennifer Scroggins",
      "Zed",
    ]);
  });

  test("stories with no owner come last", () => {
    const stories = [ownedBy(summary(1)), ownedBy(summary(2), "Zed"), ownedBy(summary(3), "Ann")];
    expect(byOwner(stories).map(ownerGroupLabel)).toEqual(["Ann", "Zed", "No owner"]);
  });

  test("within one owner the story that has waited longest in its state comes first", () => {
    const annRecent = movedOn(ownedBy(summary(1), "Ann"), 30);
    const boOldest = movedOn(ownedBy(summary(2), "Bo"), 1);
    const annOldest = movedOn(ownedBy(summary(3), "Ann"), 10);
    const annMiddle = movedOn(ownedBy(inState(summary(4), finished), "Ann"), 20);
    expect(ids(byOwner([annRecent, boOldest, annOldest, annMiddle]))).toEqual(
      ids([annOldest, annMiddle, annRecent, boOldest]),
    );
  });

  test("within one owner, stories that moved at the same time put the furthest along first", () => {
    const annToDo = ownedBy(summary(1), "Ann");
    const boDone = ownedBy(inState(summary(2), finished), "Bo");
    const annDoing = ownedBy(inState(summary(3), doing), "Ann");
    const annDone = ownedBy(inState(summary(4), finished), "Ann");
    expect(ids(byOwner([annToDo, boDone, annDoing, annDone]))).toEqual(
      ids([annDone, annDoing, annToDo, boDone]),
    );
  });
});

describe("state order", () => {
  test("ignores owners and puts the furthest-along story first", () => {
    const annToDo = ownedBy(summary(1), "Ann");
    const zedDone = ownedBy(inState(summary(2), finished), "Zed");
    const annDoing = ownedBy(inState(summary(3), doing), "Ann");
    expect(ids([annToDo, zedDone, annDoing].toSorted(orderFor("state")))).toEqual(
      ids([zedDone, annDoing, annToDo]),
    );
  });

  test("ignores how long a story has waited", () => {
    const longWaiting = movedOn(summary(1), 1);
    const doingRecent = movedOn(inState(summary(2), doing), 30);
    expect(ids([longWaiting, doingRecent].toSorted(orderFor("state")))).toEqual(
      ids([doingRecent, longWaiting]),
    );
  });
});
