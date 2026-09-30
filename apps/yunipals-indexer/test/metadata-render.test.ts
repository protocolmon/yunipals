import { describe, expect, it } from "vitest";
import { decodeSource } from "../lib/metadata/source/ejson.js";
import { renderLegacySnapshot } from "../lib/metadata/render/snapshot.js";
import { readFileSync, readdirSync } from "node:fs";
import { historicalOriginIds, renderRainbowOrigins } from "../lib/metadata/render/origins.js";
import { comparisonDocument } from "../lib/metadata/render/compare.js";

const envelope = { chain: { id: "1", type: "EVM" }, chainOrigin: { id: "56", type: "EVM" },
  origin: { type: "GEN1_BOOSTER" }, minted: true, bridged: true, ownerAddress: "0x0000000000000000000000000000000000000001",
  nft: { id: "123", name: "Unisheep", type: "unisheep", description: "Historical metadata", code: "T01C00H00B00G00",
    imageUrl: "https://assets.example/images/Unimons_T01C00H00B00G00.jpg", randomNumber: "not-in-public-projection",
    attributes: { type: { value: "Unisheep" }, horn: { value: "Basic" }, color: { value: "Red" },
      background: { value: "Grassland" }, glitter: { value: "None" } } } };

describe("offline legacy metadata rendering", () => {
  it("is deterministic and requires no remote source or current clock", () => {
    const options = { publicFacing: true, metadataUpdatedAt: 1700000000 };
    const first = renderLegacySnapshot(envelope, options);
    expect(first).toEqual(renderLegacySnapshot(envelope, options));
    expect(first).toMatchObject({ id: "123", originChain: "bsc", chain: "eth", rarity: 1.0528, rarityCapped: 1.0528 });
    expect(first.attributes).toContainEqual({ trait_type: "Last metadata update", value: 1700000000, display_type: "date" });
    expect(first).not.toHaveProperty("randomNumber");
  });

  it("does not mutate archived input while producing public or internal responses", () => {
    const source = structuredClone(envelope);
    renderLegacySnapshot(source, { publicFacing: true, metadataUpdatedAt: 1700000000 });
    const internal = renderLegacySnapshot(source, { publicFacing: false, metadataUpdatedAt: 1700000000 });
    expect(source).toEqual(envelope);
    expect((internal.attributes as { trait_type: string }[]).some(trait => trait.trait_type === "Last metadata update")).toBe(false);
  });

  it("decodes rendering inputs without losing large integer or decimal precision", () => {
    expect(decodeSource({ id: { $numberLong: "9007199254740993" }, fraction: { $numberDecimal: "1.234567890123456789" },
      date: { $date: { $numberLong: "1700000000000" } }, rarity: { $numberDouble: "1.0528" } })).toEqual({
      id: "9007199254740993", fraction: "1.234567890123456789", date: "2023-11-14T22:13:20.000Z", rarity: 1.0528
    });
    expect(() => decodeSource({ $numberDouble: "Infinity" })).toThrow();
  });
});

describe("captured legacy metadata responses", () => {
  const directory = new URL("./fixtures/metadata/", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".json") && name !== "manifest.json")) {
    it(`preserves ${name} response data`, () => {
      const fixture = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
      const rainbow = fixture.parents.length ? renderRainbowOrigins(historicalOriginIds(fixture.envelope), fixture.parents) : undefined;
      const actual = renderLegacySnapshot(fixture.envelope, { publicFacing: true, metadataUpdatedAt: fixture.metadataUpdatedAt, rainbow });
      expect(comparisonDocument(actual)).toEqual(comparisonDocument(fixture.expected));
      // JSONB can reorder object keys; that must not change any trait values.
      const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key,reorder(value[key])])) : value;
      expect(comparisonDocument(renderLegacySnapshot(reorder(fixture.envelope), {
        publicFacing: true, metadataUpdatedAt: fixture.metadataUpdatedAt, rainbow
      }))).toEqual(comparisonDocument(fixture.expected));
    });
  }

  it("rejects missing, mismatched or conflicting rainbow parents", () => {
    const fixture = JSON.parse(readFileSync(new URL("gen1_rainbow_fusion.json", directory), "utf8"));
    expect(() => renderLegacySnapshot(fixture.envelope, { publicFacing: true, metadataUpdatedAt: 1700000000 })).toThrow(/origins/);
    const ids = historicalOriginIds(fixture.envelope);
    expect(() => renderRainbowOrigins(ids, fixture.parents.slice(1))).toThrow();
    expect(() => renderRainbowOrigins(ids, [...fixture.parents].reverse())).toThrow(/order/);
    expect(() => historicalOriginIds({ ...fixture.envelope, origin: { originIds: ["different"] } })).toThrow(/Conflicting/);
  });
});
