import { describe, expect, it } from "vitest";
import { parseEnv } from "node:util";
import type { Pool } from "pg";
import {
  assertRetainedIndexerSources,
  buildSharedIndexerManifest,
  createSharedIndexerDeployment,
  sharedIndexerConsumerSettings,
  validateSharedIndexerDeployment
} from "../lib/unified/shared-deployment.js";
import { buildSourceManifest } from "../lib/unified/sources.js";
import {
  runSharedIndexerObserver,
  sharedObserverEnvironment
} from "../scripts/shared-indexer-observer.js";
import {
  boosterPacksAbiE8145098 as boosterPacksAbi,
  yunipalMonstersAbiE8145098 as yunipalMonstersAbi
} from "../../../packages/yunipals-market-core/src/boosterSourceAbi.e8145098.js";
import { manifestDigest } from "../lib/unified/sources.js";
import { ownershipDepthPolicies } from "../lib/unified/sources.js";
import { ownershipReadDefinitions } from "../lib/unified/ownership-config.js";
import {
  encodeSharedConsumerSettings,
  sharedConsumerSettings
} from "../lib/unified/shared-consumers.js";

const address = (byte: string) => `0x${byte.repeat(20)}`;
const environment = {
  UNIFIED_BASE_ISLANDS_V2_ENABLED: "true",
  BOOSTER_REGISTRY: address("12"),
  BOOSTER_ENGINE: address("23"),
  BOOSTER_MONSTERS: address("34"),
  BOOSTER_WRAPPER: address("45"),
  BOOSTER_DEPLOYMENT_BLOCK: "100",
  BOOSTER_ENGINE_DEPLOYMENT_BLOCK: "105",
  MARKET_BNB_DISCOVERY_START_BLOCK: "100",
  UNIFIED_ANIME_REGISTRY: address("56"),
  UNIFIED_ANIME_REGISTRY_START_BLOCK: "200",
  UNIFIED_SHARED_ARENA: address("67"),
  UNIFIED_SHARED_ARENA_START_BLOCK: "300",
  UNIFIED_ARENA_DEPLOYMENTS: JSON.stringify([
    { address: address("78"), startBlock: 50 }
  ]),
  UNIFIED_ANIME_ARENA: address("78")
};
function specification() {
  const manifest = buildSharedIndexerManifest(environment);
  return createSharedIndexerDeployment({
    schema: "unified_shared_test",
    buildId: "actual-build-123",
    ownershipReadSchema: "shared_ownership_v5",
    manifest,
    rpcProfile: {
      version: 1,
      model: "alchemy-2026-09-08",
      scope: "shared-test",
      coordinatorId: "11111111-1111-4111-8111-111111111111",
      manifest,
      endpoints: {
        1: "http://127.0.0.1:19241/unified",
        8453: "http://127.0.0.1:19242/unified",
        137: "http://127.0.0.1:19243/unified",
        56: "http://127.0.0.1:19244/unified"
      },
      limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
    }
  });
}

describe("shared deployment", () => {
  it("generates separate validated reader, Arena and observer overlays without private settings", () => {
    const deployment = specification();
    const reader = sharedConsumerSettings(deployment, "reader");
    expect(reader.DATABASE_SCHEMA).toBe(deployment.schema);
    expect(reader.OWNERSHIP_READ_SCHEMA).toBe(deployment.ownershipReadSchema);
    expect(reader.READ_DATABASE_SCHEMA).toBe(deployment.ownershipReadSchema);
    expect(reader.OWNERSHIP_RELEASE_ID).toBe(deployment.releaseId);
    expect(reader.BASE_METADATA_INGESTION).toBe("native");
    expect(parseEnv(encodeSharedConsumerSettings(reader))).toEqual(reader);
    const arena = sharedConsumerSettings(deployment, "arena");
    expect(arena).toEqual({
      ARENA_INDEXER_MODE: "unified",
      ARENA_INDEXER_SOURCE_KIND: "unified",
      ARENA_INDEXER_RELEASE_ID: deployment.releaseId
    });
    const observer = sharedConsumerSettings(deployment, "observer", {
      deployment: "/etc/yunipals-unified/shared.json",
      profile: "/etc/yunipals-unified/shared-rpc.json"
    });
    expect(
      sharedObserverEnvironment(deployment, observer).UNIFIED_RPC_PROFILE_ID
    ).toBe(deployment.rpcProfileId);
    for (const overlay of [reader, arena, observer]) {
      expect(
        Object.keys(overlay).some((key) =>
          /DATABASE_URL|PRIVATE|SECRET|API_KEY|REPLAY_PERMIT|MEDIA_KIND/.test(
            key
          )
        )
      ).toBe(false);
    }
    expect(() => sharedConsumerSettings(deployment, "observer")).toThrow(
      "paths"
    );
    expect(() =>
      sharedConsumerSettings({ ...deployment, releaseId: "tampered" }, "reader")
    ).toThrow("identity");
    expect(() =>
      encodeSharedConsumerSettings({ PUBLIC: "one\nSECRET=value" })
    ).toThrow();
    const literal = { PUBLIC: 'path with spaces\\literal"quotes' };
    expect(parseEnv(encodeSharedConsumerSettings(literal))).toEqual(literal);
    expect(() =>
      encodeSharedConsumerSettings({ PUBLIC: "path'quote" })
    ).toThrow();
    expect(sharedConsumerSettings(deployment, "booster")).toEqual({
      BOOSTER_DATABASE_SCHEMA: deployment.schema
    });
    const publisher = sharedConsumerSettings(deployment, "publisher");
    expect(publisher.PROJECTION_ANCHOR_RPC_PROFILE_ID).toBe(
      deployment.rpcProfileId
    );
    expect(publisher.PROJECTION_ANCHOR_RPC_URL_137).toBe(
      deployment.rpcProfile.endpoints![137]
    );
    expect(
      sharedConsumerSettings(deployment, "marketplace-ownership", {
        ownershipReadSchema: "marketplace_latest"
      }).MARKET_OWNERSHIP_INDEXER_READ_SCHEMA
    ).toBe("marketplace_latest");
    expect(() =>
      sharedConsumerSettings(deployment, "marketplace-ownership")
    ).toThrow("latest BNB read policy");
    expect(
      sharedConsumerSettings(deployment, "marketplace-sales")
        .MARKET_SALE_INDEXER_RELEASE_ID
    ).toBe(deployment.releaseId);
    expect(
      sharedConsumerSettings(deployment, "marketplace-bnb-sales")
        .MARKET_BNB_SALE_INDEXER_RELEASE_ID
    ).toBe(deployment.releaseId);
    expect(
      sharedConsumerSettings(deployment, "marketplace-bnb-discovery")
        .MARKET_BNB_DISCOVERY_INDEXER_RELEASE_ID
    ).toBe(deployment.releaseId);
  });
  it("creates latest BNB marketplace views without changing existing confirmed-view definitions", () => {
    const deployment = specification();
    const release = { ...deployment, id: deployment.releaseId };
    const retained = ownershipReadDefinitions(release);
    const latest = ownershipReadDefinitions(release, { bnbPolicy: "latest" });
    expect(retained.find((item) => item.collection === "bnb")?.policy).toEqual({
      kind: "depth",
      subsequentBlocks: 20
    });
    expect(latest.find((item) => item.collection === "bnb")?.policy).toEqual({
      kind: "latest"
    });
    expect(latest.filter((item) => item.collection !== "bnb")).toEqual(
      retained.filter((item) => item.collection !== "bnb")
    );
  });
  it("preserves marketplace depth requirements only with declared manifest extensions", () => {
    const nextEnv = {
      ...environment,
      UNIFIED_OWNERSHIP_DEPTHS_JSON: '{"ethereum":[20],"polygon":[20]}'
    };
    const baseline = buildSourceManifest(environment);
    const target = buildSharedIndexerManifest(nextEnv);
    const depths = ownershipDepthPolicies(nextEnv);
    expect(() => assertRetainedIndexerSources(baseline, target)).toThrow(
      "definition changed"
    );
    expect(() =>
      assertRetainedIndexerSources(baseline, target, depths)
    ).not.toThrow();
    expect(
      target.sources.find((source) => source.id === "ownership:ethereum")!
        .policies
    ).toContainEqual({ kind: "depth", subsequentBlocks: 20 });
    expect(
      baseline.sources.find((source) => source.id === "ownership:ethereum")!
        .policies
    ).not.toContainEqual({ kind: "depth", subsequentBlocks: 20 });
    for (const invalid of [
      '{"ethereum":[0]}',
      '{"polygon":[20,20]}',
      '{"unknown":[20]}',
      "[]",
      '{"base":["20"]}'
    ])
      expect(() =>
        ownershipDepthPolicies({ UNIFIED_OWNERSHIP_DEPTHS_JSON: invalid })
      ).toThrow();
    const spec = specification();
    expect(() =>
      createSharedIndexerDeployment({ ...spec, ownershipDepthPolicies: depths })
    ).toThrow("extensions");
    const changed = structuredClone(target);
    changed.sources.find(
      (source) => source.id === "ownership:ethereum"
    )!.startBlock = "1";
    expect(() =>
      assertRetainedIndexerSources(baseline, changed, depths)
    ).toThrow("definition changed");
  });
  it("retains the production booster ABI identities despite wallet interface additions", () => {
    expect(manifestDigest(boosterPacksAbi)).toBe(
      "0x4127c2493eff266363adae3bb24fcf53038b7da4d72af5f517600e2a7920635d"
    );
    expect(manifestDigest(yunipalMonstersAbi)).toBe(
      "0x680148b00be6884d25a426041f93861ac175dfe3535224636c46cdcb3daa3a94"
    );
  });
  it("retains eleven source definitions and removes both legacy Arena selectors", () => {
    const target = buildSharedIndexerManifest(environment);
    expect(target.sources.filter((source) => source.enabled)).toHaveLength(13);
    expect(
      target.sources
        .filter((source) => source.enabled && source.feature === "arena")
        .map((source) => source.contractName)
    ).toEqual(["YunipalsArenaV2"]);
    assertRetainedIndexerSources(buildSourceManifest(environment), target);
    const changed = structuredClone(target);
    changed.sources.find(
      (source) => source.id === "boosters:boosterengine"
    )!.startBlock = "100";
    expect(() =>
      assertRetainedIndexerSources(buildSourceManifest(environment), changed)
    ).toThrow("definition changed");
    expect(() =>
      buildSharedIndexerManifest({ ...environment, BOOSTER_ENGINE: undefined })
    ).toThrow();
    expect(() =>
      buildSharedIndexerManifest({
        ...environment,
        UNIFIED_ANIME_REGISTRY: undefined
      })
    ).toThrow();
  });
  it("binds schema, build, read views, manifest and RPC routes into one validated specification", () => {
    const deployment = specification();
    expect(
      validateSharedIndexerDeployment(JSON.parse(JSON.stringify(deployment)))
    ).toEqual(deployment);
    for (const changed of [
      { schema: "changed_schema" },
      { buildId: "other-build" },
      { releaseId: `0x${"00".repeat(32)}` },
      {
        rpcProfile: {
          ...deployment.rpcProfile,
          manifest: buildSourceManifest({})
        }
      }
    ])
      expect(() =>
        validateSharedIndexerDeployment({ ...deployment, ...changed })
      ).toThrow();
    expect(() =>
      createSharedIndexerDeployment({
        ...deployment,
        ownershipReadSchema: deployment.schema
      })
    ).toThrow();
  });
  it("requires exact observer routing and prevents replay permits from leaking into ordinary observation", () => {
    const deployment = specification();
    const env = {
      ...sharedIndexerConsumerSettings(deployment),
      UNIFIED_RPC_PROFILE_FILE: "/etc/yunipals/profile.json"
    };
    expect(
      sharedObserverEnvironment(deployment, env).UNIFIED_INDEXER_RELEASE_ID
    ).toBe(deployment.releaseId);
    for (const changed of [
      { UNIFIED_RPC_FREE_ONLY: "false" },
      { PONDER_RPC_URL_8453: "http://127.0.0.1:19222/unified" },
      { UNIFIED_RPC_REPLAY_PERMIT_ID_8453: `0x${"00".repeat(32)}` },
      { UNIFIED_RPC_PROFILE_FILE: "relative.json" }
    ])
      expect(() =>
        sharedObserverEnvironment(deployment, { ...env, ...changed })
      ).toThrow();
  });
  it("observes all four chains, retains failures without private errors, and releases its singleton lease", async () => {
    const deployment = specification();
    const environment = {
      ...sharedIndexerConsumerSettings(deployment),
      UNIFIED_RPC_PROFILE_FILE: "/etc/yunipals/profile.json"
    };
    const queries: string[] = [];
    const events: Record<string, unknown>[] = [];
    let released = false;
    const lease = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ acquired: true }] };
      },
      release: () => {
        released = true;
      }
    };
    const pool = { connect: async () => lease } as unknown as Pool;
    await runSharedIndexerObserver(
      pool,
      deployment,
      "observe-once",
      environment,
      {
        log: (event) => events.push(event),
        dependencies: {
          load: async () => ({
            id: deployment.releaseId,
            schema: deployment.schema,
            buildId: deployment.buildId,
            manifestHash: deployment.manifestHash,
            manifest: deployment.manifest
          }),
          preflight: async () => null,
          rpc: (chainId) => ({
            providerId: "fixture",
            chainId: async () => chainId,
            block: async () => ({
              number: 100n,
              hash: "fixture",
              parentHash: "fixture",
              timestamp: 1n
            }),
            receipt: async () => null,
            code: async () => "0x"
          }),
          observe: async (_pool, _release, chainId) => {
            if (chainId === 56)
              throw new Error("provider-secret-must-not-appear");
            return "observed" as const;
          }
        }
      }
    );
    expect(events).toHaveLength(4);
    expect(
      events.filter(
        (event) => event.event === "shared_chain_observation_failed"
      )
    ).toEqual([{ event: "shared_chain_observation_failed", chainId: 56 }]);
    expect(JSON.stringify(events)).not.toContain("provider-secret");
    expect(
      queries.some((query) => query.includes("pg_try_advisory_lock"))
    ).toBe(true);
    expect(queries.some((query) => query.includes("pg_advisory_unlock"))).toBe(
      true
    );
    expect(released).toBe(true);
  });
});
