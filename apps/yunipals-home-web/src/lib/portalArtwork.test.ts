import assert from "node:assert/strict";
import { test } from "node:test";
import { portalArtworkUri, rainbowPortalArtwork } from "./portalArtwork";

test("existing Rainbow Portal tokens use the upgraded app art regardless of URI", () => {
  for (const imageURI of [
    "ipfs://original-art",
    "https://example.com/old.webp",
    ""
  ]) {
    assert.equal(
      portalArtworkUri({ kindId: "1", name: "Rainbow Portal", imageURI }),
      rainbowPortalArtwork
    );
  }
});

test("legacy upcoming summaries resolve Rainbow artwork without kindId", () => {
  assert.equal(
    portalArtworkUri({
      name: "Rainbow Portal",
      imageURI: "ipfs://original-art"
    }),
    rainbowPortalArtwork
  );
});

test("other kinds and unknown names retain their artwork", () => {
  for (const portal of [
    { kindId: "2", name: "Rainbow Portal", imageURI: "ipfs://other-kind" },
    { name: "Moon Portal", imageURI: "/images/moon.webp" },
    { name: "Rainbow Portal preview", imageURI: "/images/preview.webp" }
  ]) {
    assert.equal(portalArtworkUri(portal), portal.imageURI);
  }
});
