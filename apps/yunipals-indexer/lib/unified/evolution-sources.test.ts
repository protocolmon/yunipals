import { describe, expect, it } from "vitest";
import {
  adventureAbi,
  evolutionAbi
} from "../../../../packages/yunipals-market-core/src/evolutionAbi.js";
import {
  adventureSourceAbiV1,
  evolutionSourceAbiV1
} from "../../../../packages/yunipals-market-core/src/evolutionSourceAbi.v1.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";
import { evolutionEventAbis, evolutionPonderContracts } from "./evolution-sources";

describe("Evolution ingestion ABI compatibility", () => {
  it("preserves the original complete configuration ABI identity", () => {
    const contracts = evolutionPonderContracts({});
    expect(manifestDigest(contracts.YunipalAdventures.abi)).toBe(
      "0x2b28313406dab1a915756e096be75210f1f367ed545a0a96c8b67ac7e8ca21cd"
    );
    expect(manifestDigest(contracts.YunipalEvolution.abi)).toBe(
      "0x40e0e7b1602c8df181a157a3069a20c31f286161bd9ab5dcfaa1ea6399c6189b"
    );
  });

  it("keeps every current ingested event while excluding wallet ABI changes", () => {
    expect(evolutionEventAbis.adventures).toEqual(
      adventureAbi.filter((entry) => entry.type === "event")
    );
    expect(evolutionEventAbis.evolution).toEqual(
      evolutionAbi.filter((entry) => entry.type === "event")
    );
    expect(evolutionPonderContracts({}).YunipalAdventures.abi).toBe(
      adventureSourceAbiV1
    );
    expect(evolutionPonderContracts({}).YunipalEvolution.abi).toBe(
      evolutionSourceAbiV1
    );
  });

  it("retains the current seven-argument wallet fusion call independently", () => {
    const current = evolutionAbi.find(
      (entry) => entry.type === "function" && entry.name === "fuse"
    );
    const ingestion = evolutionSourceAbiV1.find(
      (entry) => entry.type === "function" && entry.name === "fuse"
    );
    expect(current?.inputs).toHaveLength(7);
    expect(ingestion?.inputs).toHaveLength(6);
  });
});
