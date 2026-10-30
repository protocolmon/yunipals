import assert from "node:assert/strict";
import { test } from "node:test";
import { arenaArtifactPath } from "./arenaMedia";

test("native film artifacts select the exact published incarnation", () => {
  const origin = `0x${"a".repeat(64)}`;
  const publication = `0x${"b".repeat(64)}`;
  for (const name of ["film.mp4", "film.json", "SF1.png", "credits.txt"])
    assert.equal(
      arenaArtifactPath("2", name, {
        state: "ready",
        payoutsReleased: true,
        incarnation: origin,
        publication
      }),
      `/tournaments/2/artifacts/${name}?origin=${origin}&publication=${publication}`
    );
});

test("incomplete publications cannot load film artifacts", () => {
  assert.equal(arenaArtifactPath("2", "film.mp4"), null);
  assert.equal(
    arenaArtifactPath("2", "film.mp4", {
      state: "assembling",
      payoutsReleased: false
    }),
    null
  );
  for (const publication of [undefined, null, "invalid"])
    assert.equal(
      arenaArtifactPath("2", "film.mp4", {
        state: "ready",
        payoutsReleased: false,
        incarnation: `0x${"a".repeat(64)}`,
        publication
      }),
      null
    );
});

test("legacy film artifact URLs remain supported", () => {
  assert.equal(
    arenaArtifactPath("1", "film.mp4", {
      state: "ready",
      payoutsReleased: true
    }),
    "/tournaments/1/artifacts/film.mp4"
  );
});
