import { describe, expect, it } from "vitest";
import {
  isSolanaAddress,
  parseDasAsset,
  parseDasBatch
} from "../lib/solana/das.js";

const mint = "9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
const second = "11111111111111111111111111111111";
const owner = "4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue";
const asset = (id = mint) => ({
  id,
  burnt: false,
  ownership: { owner, delegated: false, delegate: null },
  content: {
    json_uri: "https://example.invalid/metadata",
    last_indexed_slot: 123
  }
});

describe("Solana ownership evidence", () => {
  it("validates 32-byte base58 identities and preserves their case", () => {
    expect(isSolanaAddress(mint)).toBe(true);
    expect(isSolanaAddress(second)).toBe(true);
    expect(isSolanaAddress("1".repeat(31))).toBe(false);
    expect(isSolanaAddress("0".repeat(32))).toBe(false);
    expect(() =>
      parseDasAsset({ ...asset(), id: mint.toLowerCase() }, mint)
    ).toThrow("identity_mismatch");
    expect(parseDasAsset(asset(), mint).owner).toBe(owner);
  });
  it("matches reordered batches and keeps missing/empty-owner evidence unknown", () => {
    const values = parseDasBatch([asset(second), asset()], [mint, second]);
    expect(values.map((value) => value?.mint)).toEqual([mint, second]);
    expect(
      parseDasBatch([{ ...asset(), ownership: { owner: "" } }], [mint])
    ).toEqual([null]);
    expect(parseDasBatch([], [mint])).toEqual([null]);
    expect(() => parseDasBatch([asset(), asset()], [mint])).toThrow(
      "duplicate"
    );
    expect(() => parseDasBatch([asset(second)], [mint])).toThrow("unexpected");
  });
  it("requires explicit burn/delegation state and bounded metadata slots", () => {
    expect(() => parseDasAsset({ ...asset(), burnt: undefined }, mint)).toThrow(
      "burn_state"
    );
    expect(() =>
      parseDasAsset(
        { ...asset(), ownership: { owner, delegated: "yes" } },
        mint
      )
    ).toThrow("delegate_invalid");
    expect(() =>
      parseDasAsset(
        {
          ...asset(),
          content: { last_indexed_slot: Number.MAX_SAFE_INTEGER + 1 }
        },
        mint
      )
    ).toThrow("metadata_slot");
    expect(
      parseDasAsset(
        { ...asset(), burnt: true, ownership: { owner: null } },
        mint
      )
    ).toMatchObject({ owner: null, burnt: true });
  });
});
