import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import type { SourceDefinition } from "../../../packages/yunipals-indexer-client/src/sources.js";
import { createNativeBaseMetadataViews } from "../lib/unified/base-metadata-views.js";
import type { RegisteredRelease } from "../lib/unified/releases.js";

describe("Native Base readiness age policy", () => {
  it("emits the 120 second age bound with future, frontier and canonical block checks", async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }
    } as unknown as PoolClient;
    const source: SourceDefinition = {
      id: "metadata:base",
      feature: "base-metadata",
      chainId: 8453,
      contractName: "YunipalsBaseMetadata",
      address: "0x98433df878e8c898cb907345c3a7756e5f72240f",
      startBlock: "22224075",
      endBlock: null,
      enabled: true,
      abiHash: "fixture-abi",
      events: ["Mint", "Update"],
      receiptRequirement: "none",
      policies: [{ kind: "latest" }]
    };
    const release: RegisteredRelease = {
      id: "fixture-release",
      schema: "fixture_native",
      buildId: "fixture-build",
      manifestHash: "fixture-manifest",
      manifest: {
        version: 1,
        ponderVersion: "0.17.5",
        ordering: "multichain",
        coverage: "ponder-live-blocks-v1",
        sources: [source]
      }
    };
    await createNativeBaseMetadataViews(
      db,
      release,
      "fixture_read",
      "fixture-identity",
      source
    );
    expect(queries).toHaveLength(6);
    const frame = queries[0];
    expect(frame.match(/interval '120 seconds'/g)).toHaveLength(1);
    expect(frame).not.toContain("interval '90 seconds'");
    expect(frame).toContain("approval.checked_at>statement_timestamp()");
    expect(frame).toContain("approval.frontier IS DISTINCT FROM frontier");
    expect(frame).toContain("approval.checked_block>boundary.block_number");
    expect(frame).toContain("b.block_hash=approval.checked_hash");
    expect(frame).toContain("approval.implementation IS DISTINCT FROM");
    expect(queries[2]).toContain(".base_metadata_frame(true)");
    expect(queries[4]).toContain(".base_metadata_frame(true)");
    expect(queries[5]).toContain(".base_metadata_frame(true)");
  });
});
