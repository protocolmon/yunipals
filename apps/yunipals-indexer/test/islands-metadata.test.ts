import { describe, expect, it } from "vitest";
import {
  collections,
  collectionSlugs,
  islandCollection
} from "../lib/constants.js";
import { chainSelection } from "../lib/api/chains.js";
import {
  islandEdition,
  islandMetadataUri,
  islandRevision,
  normalizeIslandMetadata
} from "../lib/islands/metadata.js";
import { transferEventId, transferState } from "../lib/ownership/transfer.js";
import { ZERO_ADDRESS } from "../lib/constants.js";
import { ethereumCheckpointBlock } from "../lib/islands/readiness.js";

const owner = "0x0000000000000000000000000000000000000001";
const recipient = "0x0000000000000000000000000000000000000002";
const hash = `0x${"11".repeat(32)}`;
const uri =
  "https://meta.polychainmonsters.com/v1/island-meta/grassland/10000000";
const raw = {
  name: "Grassland Genesis Island",
  image: "ipfs://example",
  description: "An island"
};

describe("Islands collection identity and metadata", () => {
  it("shares Ethereum while keeping legacy API chain selections unchanged", () => {
    expect(islandCollection).toMatchObject({
      chainId: 1,
      deploymentBlock: 14_570_451
    });
    expect(collections.ethereum.address).not.toBe(islandCollection.address);
    expect(chainSelection("https://example.test/v1/tokens")?.chains).toEqual(
      collectionSlugs
    );
    expect(
      chainSelection("https://example.test/v1/tokens?chain=ethereum-islands")
    ).toBeUndefined();
    expect(transferEventId("ethereum", hash, 1)).not.toBe(
      transferEventId("ethereum-islands", hash, 1)
    );
  });
  it("reconstructs mint, transfer, burn, and a later lifecycle without changing the original mint", () => {
    const mint = transferState(null, ZERO_ADDRESS, owner, {
      number: 1n,
      timestamp: 10n
    });
    const transfer = transferState(mint, owner, recipient, {
      number: 2n,
      timestamp: 20n
    });
    expect(transfer).toMatchObject({
      owner: recipient,
      lifecycle: 1,
      mintBlock: 1n,
      burned: false
    });
    const burn = transferState(transfer, recipient, ZERO_ADDRESS, {
      number: 3n,
      timestamp: 30n
    });
    expect(burn).toMatchObject({
      burned: true,
      lifecycle: 1,
      mintTimestamp: 10n
    });
    expect(
      transferState(burn, ZERO_ADDRESS, owner, { number: 4n, timestamp: 40n })
    ).toMatchObject({ lifecycle: 2, mintBlock: 4n, burned: false });
    expect(() =>
      transferState(null, owner, recipient, { number: 1n, timestamp: 1n })
    ).toThrow("before mint");
  });
  it("normalizes shared fallback documents separately for each token and preserves raw attributes", () => {
    expect(normalizeIslandMetadata(raw, "1")).toMatchObject({
      id: "1",
      name: raw.name,
      attributes: []
    });
    expect(normalizeIslandMetadata(raw, "2")).toMatchObject({ id: "2" });
    const custom = {
      ...raw,
      id: "10000000",
      attributes: [{ trait_type: "Resource", value: "Wood" }],
      owner: owner
    };
    expect(normalizeIslandMetadata(custom, "7")).toMatchObject({
      id: "7",
      attributes: custom.attributes
    });
    expect(normalizeIslandMetadata(custom, "7")).not.toHaveProperty("owner");
    expect(raw).not.toHaveProperty("id");
    expect(islandEdition("1000")).toBe("Genesis");
    expect(islandEdition("1001")).toBe("Personal");
    expect(() => normalizeIslandMetadata(raw, "01")).toThrow();
    expect(() =>
      normalizeIslandMetadata(raw, (2n ** 256n).toString())
    ).toThrow();
  });
  it("bounds metadata URLs to the collection's HTTPS endpoint", () => {
    expect(islandMetadataUri(uri)).toBe(uri);
    for (const invalid of [
      uri.replace("https:", "http:"),
      uri.replace("meta.polychainmonsters.com", "localhost"),
      uri + "?id=1",
      uri + "#fragment",
      uri.replace("10000000", "01"),
      uri.replace("grassland", "unknown"),
      uri.replace("https://", "https://user:password@")
    ])
      expect(() => islandMetadataUri(invalid)).toThrow();
  });
  it("makes revisions stable across rechecks and different across metadata, URI, or mint changes", () => {
    const job = {
      tokenId: "1",
      lifecycle: 1,
      mintTransactionHash: hash,
      mintLogIndex: 1,
      attempts: 0
    };
    const evidence = {
      uri,
      blockNumber: 26_091_208n,
      blockHash: hash,
      genesisLimit: 1_000n,
      metadataStorage: owner
    };
    const first = islandRevision(job, evidence, raw);
    expect(
      islandRevision(
        job,
        { ...evidence, blockNumber: evidence.blockNumber + 1n },
        raw
      ).revisionHash
    ).toBe(first.revisionHash);
    expect(
      islandRevision(job, evidence, { ...raw, name: "Updated" }).revisionHash
    ).not.toBe(first.revisionHash);
    expect(
      islandRevision({ ...job, mintLogIndex: 2 }, evidence, raw).revisionHash
    ).not.toBe(first.revisionHash);
    expect(
      islandRevision(
        job,
        { ...evidence, uri: uri.replace("10000000", "1") },
        raw
      ).revisionHash
    ).not.toBe(first.revisionHash);
  });
  it("rejects malformed or wrong-chain Ponder checkpoints", () => {
    const checkpoint =
      "1790782295" +
      "1".padStart(16, "0") +
      "26091208".padStart(16, "0") +
      "0".repeat(33);
    expect(ethereumCheckpointBlock(checkpoint)).toBe(26_091_208n);
    expect(
      ethereumCheckpointBlock(
        checkpoint.replace("0000000000000001", "0000000000008453")
      )
    ).toBeNull();
    expect(ethereumCheckpointBlock("0")).toBeNull();
  });
});
