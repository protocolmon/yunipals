import { describe, expect, it } from "vitest";
import { exomonAliasRecords, islandDocumentRecord } from "../lib/metadata/source/supplemental.js";

const mint = "9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
describe("historical supplemental inputs", () => {
  it("preserves case-sensitive Exomon targets without turning aliases into NFT envelopes", () => {
    const [record] = exomonAliasRecords({ "1000002005569": mint });
    expect(record.payload).toEqual({ alias: "1000002005569", targetId: mint, family: "GEN1" });
    expect(record.assetKey).toBeNull();
    expect(record.legacyId).toBeNull();
    expect(record.issue).toBeNull();
  });
  it("rejects damaged aliases, non-mint targets and duplicate mappings", () => {
    expect(() => exomonAliasRecords({ bad: mint })).toThrow();
    expect(() => exomonAliasRecords({ "1": "0x123" })).toThrow();
    expect(() => exomonAliasRecords({ "1": mint, "2": mint })).toThrow();
  });
  it("accepts only the two known static documents and requires a complete response", () => {
    const body = { name: "Grassland Island", description: "Historical description", image: "https://example.com/image" };
    expect(islandDocumentRecord("20000000",body).payload).toEqual({ type: "grassland", id: "20000000", status: 200, document: body });
    expect(() => islandDocumentRecord("9",body)).toThrow();
    expect(() => islandDocumentRecord("20000000",{ message: "Missing metadata" })).toThrow();
  });
});
