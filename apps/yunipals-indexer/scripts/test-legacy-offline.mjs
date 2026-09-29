import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import Module from "node:module";
import net from "node:net";

// Fail closed if a future legacy import starts using a removed chain SDK or
// makes a network call. Run in a separate process so these guards are local.
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  assert.doesNotMatch(
    request,
    /^(?:@ethersproject\/|@solana\/|bigint-buffer$|elliptic$|stream-json(?:\/|$))/
  );
  return originalLoad.call(this, request, ...args);
};
net.Socket.prototype.connect = function () {
  throw new Error("Legacy metadata must render without network access");
};
globalThis.fetch = async () => {
  throw new Error("Legacy metadata must render without network access");
};

const { renderLegacySnapshot } = await import(
  "../lib/metadata/render/snapshot.ts"
);
const { comparisonDocument } = await import(
  "../lib/metadata/render/compare.ts"
);
const { historicalOriginIds, renderRainbowOrigins } = await import(
  "../lib/metadata/render/origins.ts"
);
const { calculateRarity } = await import("../lib/rarity/calculate.ts");
const directory = new URL("../test/fixtures/metadata/", import.meta.url);
const names = readdirSync(directory).filter(
  (name) => name.endsWith(".json") && name !== "manifest.json"
);
assert.ok(names.length >= 5, "Expected the captured metadata families");
let scored = 0;
for (const name of names) {
  const fixture = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
  const rainbow = fixture.parents.length
    ? renderRainbowOrigins(
        historicalOriginIds(fixture.envelope),
        fixture.parents
      )
    : undefined;
  const actual = renderLegacySnapshot(fixture.envelope, {
    publicFacing: true,
    metadataUpdatedAt: fixture.metadataUpdatedAt,
    rainbow
  });
  assert.deepEqual(
    comparisonDocument(actual),
    comparisonDocument(fixture.expected),
    name
  );
  const score = calculateRarity(String(actual.id), actual);
  if (score.status === "valid") {
    assert.equal(score.rarityPoints, actual.rarity, name);
    assert.equal(score.rarityPointsCapped, actual.rarityCapped, name);
    scored++;
  }
}
assert.ok(scored > 0, "Expected scored metadata fixtures");
console.log(
  JSON.stringify({
    event: "legacy_offline_parity",
    families: names.length,
    scored
  })
);
