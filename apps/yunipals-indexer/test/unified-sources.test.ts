import { describe, expect, it } from "vitest";
import {
  buildSourceManifest,
  arenaSourceDeployments,
  arenaContractSources,
  sourceManifestHash
} from "../lib/unified/sources.js";
import { validateSourceManifest } from "../../../packages/yunipals-indexer-client/src/sources.js";
import {
  completePonderBlock,
  decodePonderCheckpoint
} from "../../../packages/yunipals-indexer-client/src/ponder.js";

const address = `0x${"12".repeat(20)}`;
const other = `0x${"34".repeat(20)}`;

it("starts anime logs at their own deployment without changing video history", () => {
  const env = {
    UNIFIED_ARENA_DEPLOYMENTS: JSON.stringify([
      { address, startBlock: 50 },
      { address: other, startBlock: 100 }
    ]),
    UNIFIED_ANIME_ARENA: other,
    UNIFIED_ANIME_REGISTRY: `0x${"56".repeat(20)}`,
    UNIFIED_ANIME_REGISTRY_START_BLOCK: "99"
  };
  expect(arenaContractSources(env)).toEqual({
    video: [{ address, startBlock: 50 }],
    anime: { address: other, startBlock: 100 }
  });
  expect(() =>
    arenaContractSources({
      ...env,
      UNIFIED_ANIME_ARENA: `0x${"78".repeat(20)}`
    })
  ).toThrow("reviewed");
  expect(() =>
    arenaContractSources({
      ...env,
      UNIFIED_ANIME_REGISTRY: undefined,
      UNIFIED_ANIME_REGISTRY_START_BLOCK: undefined
    })
  ).toThrow("registry");
  expect(
    arenaContractSources({ ...env, UNIFIED_ANIME_ARENA: undefined }).video
  ).toHaveLength(2);
});

describe("unified source manifest", () => {
  it("includes all ownership chains and explicitly disables unconfigured optional contracts", () => {
    const manifest = buildSourceManifest({});
    expect(
      manifest.sources
        .filter((source) => source.feature === "ownership")
        .map((source) => source.chainId)
        .sort()
    ).toEqual([1, 137, 56, 8453]);
    expect(
      manifest.sources.find((source) => source.id === "ownership:bnb")
        ?.startBlock
    ).toBe("7579197");
    for (const source of manifest.sources.filter((source) => !source.enabled)) {
      expect(source.address).toBeNull();
      expect(source.startBlock).toBeNull();
    }
    expect(
      manifest.sources.find((source) => source.id === "metadata:base")?.policies
    ).toEqual([{ kind: "latest" }, { kind: "finalized" }]);
  });
  it("hashes configuration deterministically and changes the digest when rights to history change", () => {
    const manifest = buildSourceManifest({});
    expect(sourceManifestHash(manifest)).toBe(
      sourceManifestHash({
        ...manifest,
        sources: [...manifest.sources].reverse()
      })
    );
    expect(sourceManifestHash(manifest)).not.toBe(
      sourceManifestHash(buildSourceManifest({ BNB_CONFIRMATIONS: "21" }))
    );
    const arena = buildSourceManifest({
      ARENA_CONTRACT: address,
      ARENA_DEPLOYMENT_BLOCK: "50"
    });
    expect(sourceManifestHash(manifest)).not.toBe(sourceManifestHash(arena));
    expect(
      arena.sources.find((source) => source.feature === "arena")?.policies
    ).toEqual([{ kind: "latest" }, { kind: "depth", subsequentBlocks: 5 }]);
  });
  it("binds optional receipt history without narrowing event/ownership history", () => {
    const baseline = buildSourceManifest({});
    expect(baseline.sources.every((row) => !("receiptStartBlock" in row))).toBe(
      true
    );
    const manifest = buildSourceManifest({
      UNIFIED_RECEIPT_HISTORY_JSON: JSON.stringify({
        "ownership:bnb": 122090342
      })
    });
    const source = manifest.sources.find((row) => row.id === "ownership:bnb")!;
    expect(source.startBlock).toBe("7579197");
    expect(source.receiptStartBlock).toBe("122090342");
    expect(sourceManifestHash(manifest)).not.toBe(sourceManifestHash(baseline));
    expect(
      sourceManifestHash(
        buildSourceManifest({ UNIFIED_RECEIPT_HISTORY_JSON: "{}" })
      )
    ).toBe(sourceManifestHash(baseline));
    for (const value of [
      "{",
      "null",
      "[]",
      "1",
      '{"ownership:bnb":"122090342"}',
      '{"ownership:bnb":7579196}',
      '{"ownership:bnb":-1}',
      '{"ownership:bnb":1.5}',
      '{"ownership:bnb":9007199254740992}',
      '{"ownership:bnb":null}',
      '{"ownership:unknown":122090342}',
      '{"metadata:base":122090342}',
      '{"marketplace:bnb:seaport":122090342}'
    ])
      expect(() =>
        buildSourceManifest({ UNIFIED_RECEIPT_HISTORY_JSON: value })
      ).toThrow();
    for (const invalid of [
      { ...source, receiptStartBlock: "7579196" },
      { ...source, receiptStartBlock: "9007199254740992" },
      { ...source, receiptRequirement: "none" as const },
      { ...source, enabled: false },
      { ...source, endBlock: "122090341" }
    ])
      expect(() =>
        validateSourceManifest({ ...manifest, sources: [invalid] })
      ).toThrow(/receipt history/);
    const discovery = buildSourceManifest({
      MARKET_BNB_DISCOVERY_START_BLOCK: "100",
      UNIFIED_RECEIPT_HISTORY_JSON: '{"marketplace:bnb:seaport":101}'
    }).sources.find((row) => row.id === "marketplace:bnb:seaport")!;
    expect(discovery.startBlock).toBe("100");
    expect(discovery.receiptStartBlock).toBe("101");
  });
  it("registers the verified Base Islands replacement separately from Ethereum Islands", () => {
    const disabled = buildSourceManifest({}).sources.find(
      (source) => source.id === "islands:base:v2"
    )!;
    expect(disabled.enabled).toBe(false);
    const enabled = buildSourceManifest({
      UNIFIED_BASE_ISLANDS_V2_ENABLED: "true"
    });
    const source = enabled.sources.find(
      (source) => source.id === "islands:base:v2"
    )!;
    expect(source).toMatchObject({
      enabled: true,
      chainId: 8453,
      address: "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168",
      startBlock: "52587956"
    });
    expect(source.events).toEqual([
      "AirdropFinalized",
      "OwnershipTransferred",
      "Transfer"
    ]);
    expect(source.policies).toContainEqual({
      kind: "depth",
      subsequentBlocks: 3
    });
    expect(sourceManifestHash(enabled)).not.toBe(
      sourceManifestHash(buildSourceManifest({}))
    );
    expect(() =>
      buildSourceManifest({ UNIFIED_BASE_ISLANDS_V2_ENABLED: "1" })
    ).toThrow();
  });
  it("rejects partial configuration, invalid addresses/bounds, duplicate IDs/subscriptions and unsupported policies", () => {
    for (const env of [
      { BOOSTER_REGISTRY: address },
      { ARENA_CONTRACT: address },
      {
        ARENA_CONTRACT: "0x0000000000000000000000000000000000000000",
        ARENA_DEPLOYMENT_BLOCK: "50"
      },
      { MARKET_BNB_DISCOVERY_START_BLOCK: "NaN" },
      { BNB_CONFIRMATIONS: "0" }
    ])
      expect(() => buildSourceManifest(env)).toThrow();
    const manifest = buildSourceManifest({});
    const source = manifest.sources.find((row) => row.enabled)!;
    expect(() =>
      validateSourceManifest({
        ...manifest,
        sources: [...manifest.sources, source]
      })
    ).toThrow(/duplicate source ID/);
    expect(() =>
      validateSourceManifest({
        ...manifest,
        sources: [
          ...manifest.sources,
          { ...source, id: "duplicate:subscription" }
        ]
      })
    ).toThrow(/Duplicate source subscription/);
    expect(() =>
      validateSourceManifest({
        ...manifest,
        sources: [
          ...manifest.sources,
          {
            ...source,
            id: "overlapping:subscription",
            events: [source.events[0]!]
          }
        ]
      })
    ).toThrow(/Duplicate source subscription/);
    expect(() =>
      validateSourceManifest({
        ...manifest,
        sources: [{ ...source, endBlock: "0" }]
      })
    ).toThrow(/bounds/);
    expect(() =>
      validateSourceManifest({
        ...manifest,
        sources: [{ ...source, startBlock: "9007199254740992" }]
      })
    ).toThrow(/block/);
  });
  it("supports multiple read-only Arena deployments without loading a signer or private strategy configuration", () => {
    const env = {
      UNIFIED_ARENA_DEPLOYMENTS: JSON.stringify([
        { address: other, startBlock: 70 },
        { address, startBlock: 50 }
      ])
    };
    expect(arenaSourceDeployments(env)).toEqual([
      { address, startBlock: 50 },
      { address: other, startBlock: 70 }
    ]);
    expect(
      buildSourceManifest(env).sources.filter((row) => row.feature === "arena")
    ).toHaveLength(2);
    for (const value of [
      "{",
      "{}",
      "null",
      JSON.stringify([{ address, startBlock: 0 }]),
      JSON.stringify([{ address, startBlock: 50, privateKey: "unused" }]),
      JSON.stringify([
        { address, startBlock: 50 },
        { address, startBlock: 60 }
      ])
    ]) {
      expect(() =>
        arenaSourceDeployments({ UNIFIED_ARENA_DEPLOYMENTS: value })
      ).toThrow();
    }
  });
});

describe("pinned Ponder coverage", () => {
  const checkpoint = (suffix: string) =>
    `0000000100${"8453".padStart(16, "0")}${"100".padStart(16, "0")}${suffix}`;
  it("counts quiet full blocks and excludes incomplete blocks", () => {
    expect(
      completePonderBlock(checkpoint("999999999999999999999999999999999"), 8453)
    ).toBe(100n);
    expect(
      completePonderBlock(checkpoint("000000000000000050000000000000002"), 8453)
    ).toBe(99n);
    expect(completePonderBlock("0".repeat(75), 8453)).toBeNull();
  });
  it("rejects unknown encodings and cross-chain checkpoints", () => {
    expect(() => decodePonderCheckpoint("0".repeat(74))).toThrow();
    expect(() => decodePonderCheckpoint("x".repeat(75))).toThrow();
    expect(() =>
      completePonderBlock(checkpoint("999999999999999999999999999999999"), 56)
    ).toThrow(/chain mismatch/);
  });
});

it("adds the registry and second arena in one source manifest without changing video identity", () => {
  const old = buildSourceManifest({
    UNIFIED_ARENA_DEPLOYMENTS: JSON.stringify([{ address, startBlock: 10 }])
  });
  const next = buildSourceManifest({
    UNIFIED_ARENA_DEPLOYMENTS: JSON.stringify([
      { address, startBlock: 10 },
      { address: other, startBlock: 100 }
    ]),
    UNIFIED_ANIME_REGISTRY: `0x${"56".repeat(20)}`,
    UNIFIED_ANIME_REGISTRY_START_BLOCK: "99"
  });
  validateSourceManifest(next);
  expect(next.sources.find((s) => s.id === `arena:8453:${address}`)).toEqual(
    old.sources.find((s) => s.id === `arena:8453:${address}`)
  );
  const registry = next.sources.find((s) => s.id === "anime-registry:8453")!;
  expect(registry.receiptRequirement).toBe("none");
  expect(registry.startBlock).toBe("99");
  expect(registry.policies).toEqual([
    { kind: "latest" },
    { kind: "depth", subsequentBlocks: 5 }
  ]);
  expect(
    next.sources.filter((s) => s.feature === "arena" && s.enabled)
  ).toHaveLength(2);
  expect(() =>
    buildSourceManifest({ UNIFIED_ANIME_REGISTRY: address })
  ).toThrow(/registry source/);
});
