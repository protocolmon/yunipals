import { expect, it } from "vitest";
import { RebuildGrace } from "../lib/api/rebuild-grace.js";

const fresh = { fresh: true, usable: true };
const changed = { fresh: false, usable: true };
const invalid = { fresh: false, usable: false };

it("allows a changed read set until the grace period ends", () => {
  const grace = new RebuildGrace(1000);
  expect(grace.allows("bnb", changed, 5000)).toBe(true);
  expect(grace.allows("bnb", changed, 5999)).toBe(true);
  expect(grace.allows("bnb", changed, 6000)).toBe(false);
  // Without a rebuild the period does not start again.
  expect(grace.allows("bnb", changed, 90_000)).toBe(false);
});

it("starts a new period after a rebuild", () => {
  const grace = new RebuildGrace(1000);
  expect(grace.allows("bnb", changed, 5000)).toBe(true);
  expect(grace.allows("bnb", fresh, 5500)).toBe(false);
  expect(grace.allows("bnb", changed, 9000)).toBe(true);
});

it("never allows a read set that is invalid for another reason", () => {
  const grace = new RebuildGrace(1000);
  expect(grace.allows("bnb", invalid, 5000)).toBe(false);
});

it("tracks each selection of chains on its own", () => {
  const grace = new RebuildGrace(1000);
  expect(grace.allows("bnb", changed, 5000)).toBe(true);
  expect(grace.allows("base", changed, 5900)).toBe(true);
  expect(grace.allows("bnb", changed, 6100)).toBe(false);
  expect(grace.allows("base", changed, 6100)).toBe(true);
});

it("is off with a period of 0 and rejects a period out of bounds", () => {
  expect(new RebuildGrace(0).allows("bnb", changed, 5000)).toBe(false);
  expect(() => new RebuildGrace(-1)).toThrow("rebuild_grace_out_of_bounds");
  expect(() => new RebuildGrace(Number.NaN)).toThrow(
    "rebuild_grace_out_of_bounds"
  );
});
