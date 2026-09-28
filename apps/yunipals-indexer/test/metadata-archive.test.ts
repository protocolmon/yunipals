import { describe, expect, it } from "vitest";
import { archiveReleaseId, assetKey, canonicalJson, contentHash } from "../lib/metadata/source/canonical.js";
import { sourceIdentity } from "../lib/metadata/source/identity.js";

describe("durable metadata identity and serialization", () => {
  it("preserves BSON integer precision and dates without depending on a Mongo driver", () => {
    const payload = { big: { $numberLong: "9007199254740993" }, date: { $date: { $numberLong: "1627378433000" } } };
    expect(JSON.parse(canonicalJson(payload))).toEqual(payload);
    expect(contentHash(payload)).toBe(contentHash({ date: payload.date, big: payload.big }));
    expect(() => canonicalJson({ big: 9007199254740993 })).toThrow(/imprecise/);
    expect(() => canonicalJson({ score: NaN })).toThrow();
  });

  it("distinguishes ordered parents while ignoring object property order", () => {
    expect(contentHash({ parents: ["1", "2"] })).not.toBe(contentHash({ parents: ["2", "1"] }));
    expect(contentHash({ a: null, b: false })).toBe(contentHash({ b: false, a: null }));
    expect(() => canonicalJson({ missing: undefined })).toThrow();
  });

  it("keeps one GEN1 identity when ownership or chain changes", () => {
    const nft = { genId: { type: "GEN1", id: "123" }, nft: { id: "123" }, chain: { id: "1" } };
    expect(sourceIdentity(nft).assetKey).toBe(sourceIdentity({ ...nft, chain: { id: "56" }, ownerAddress: "new" }).assetKey);
  });

  it("does not merge identical public token IDs from distinct NFB chains", () => {
    const nft = { genId: { type: "GEN1_ORIGIN_S001E001", id: "1_42" }, nft: { id: "42" } };
    const other = { ...nft, genId: { ...nft.genId, id: "56_42" } };
    expect(sourceIdentity(nft).issue).toBeNull();
    expect(sourceIdentity(nft).assetKey).not.toBe(sourceIdentity(other).assetKey);
    expect(sourceIdentity(nft).legacyId).toBe("42");
  });

  it("retains unsupported/malformed records as unresolved, without inventing identities", () => {
    expect(sourceIdentity({ nft: { id: "10" } })).toMatchObject({ assetKey: null, legacyId: "10", issue: "missing_asset_identity" });
    expect(sourceIdentity({ genId: { type: "GEN1", id: "11" }, nft: { id: "10" } }).issue).toBe("identity_disagreement");
  });

  it("keeps case-sensitive string IDs and rejects unsafe release selectors", () => {
    expect(assetKey("GEN1", "abc")).not.toBe(assetKey("GEN1", "Abc"));
    expect(assetKey("GEN1", "12")).not.toBe(assetKey("ISLAND", "12"));
    expect(() => archiveReleaseId("../live")).toThrow();
    expect(archiveReleaseId("metadata-20260921-v1")).toBe("metadata-20260921-v1");
  });
});
