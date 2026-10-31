import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMonsterVersionInfo,
  monsterAssetKey
} from "@protopals/yunipals-market-core/monsterVersions";
import {
  parseMonsterGroupPage,
  applyVersionSettlements
} from "@/lib/monsterVersions";
import type { ConfirmedSettlement } from "@/lib/marketplace/confirmedSettlements";
import { versionFixture } from "../../scripts/fixtures/monsterVersions";
import type { YunipalToken } from "@/lib/yunipalsIndexer";
import {
  fixtureSolanaTokens,
  fixtureSolanaOwners
} from "../../scripts/fixtures/solana";
import { parseMonsterAsset } from "@protopals/yunipals-market-core/monsterVersions";

const owner = "0x0000000000000000000000000000000000000001";
const tokens: YunipalToken[] = (["ethereum", "base"] as const).map((chain) => ({
  chain,
  chainId: chain === "base" ? 8453 : 1,
  contractAddress:
    chain === "base"
      ? "0x98433df878e8c898cb907345c3a7756e5f72240f"
      : "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
  tokenId: "1",
  owner,
  lifecycle: 1,
  burned: false,
  hidden: false,
  mintBlock: "1",
  lastTransferBlock: "1",
  name: "Yuni",
  image: null,
  attributes: [],
  tokenUri: null,
  rarityPoints: "10",
  rarityPointsCapped: null,
  metadataAvailable: true
}));
const params = new URLSearchParams("chain=ethereum&chain=base");
const response = () =>
  structuredClone(
    versionFixture(
      new URL(
        `http://localhost/__fixtures/indexer/v1/monster-groups?${params}`
      ),
      tokens
    )!.body
  ) as {
    groups: { id: string; members: YunipalToken[] }[];
    revision: string;
    query: string;
    groupTotal: number;
    nftTotal: number;
  };

test("validates version identity, role, revision, and complete asset keys", () => {
  const raw = response();
  const info = raw.groups[0]!.members[0]!.versionInfo!;
  assert.equal(
    parseMonsterVersionInfo(info, raw.groups[0]!.members[0]!)!.versions.length,
    2
  );
  assert.notEqual(monsterAssetKey(tokens[0]!), monsterAssetKey(tokens[1]!));
  assert.throws(() =>
    parseMonsterVersionInfo({ ...info, role: "other" }, tokens[0]!)
  );
  assert.throws(() =>
    parseMonsterVersionInfo(
      { ...info, versions: [info.versions[0], info.versions[0]] },
      tokens[0]!
    )
  );
  assert.throws(() =>
    parseMonsterVersionInfo(info, { ...tokens[0]!, lifecycle: 2 })
  );
});
test("accepts verified groups and rejects stale, mismatched, duplicate and hidden results", () => {
  assert.equal(parseMonsterGroupPage(response(), params).groups.length, 1);
  assert.equal(parseMonsterGroupPage(response(), params).nftTotal, 2);
  const hidden = response();
  hidden.groups[0]!.members[0]!.hidden = true;
  assert.throws(() => parseMonsterGroupPage(hidden, params));
  const wrongFilters = response();
  wrongFilters.query = "chain=base";
  assert.throws(() => parseMonsterGroupPage(wrongFilters, params));
  const stale = response();
  stale.revision = "f".repeat(64);
  assert.throws(() => parseMonsterGroupPage(stale, params));
  const duplicates = response();
  duplicates.groups.push(duplicates.groups[0]!);
  assert.throws(() => parseMonsterGroupPage(duplicates, params));
  const wrongGroup = response();
  wrongGroup.groups[0]!.id = "e".repeat(64);
  assert.throws(() => parseMonsterGroupPage(wrongGroup, params));
  const wrongCounts = response();
  wrongCounts.nftTotal = 0;
  assert.throws(() => parseMonsterGroupPage(wrongCounts, params));
});

test("a confirmed sale removes only the sold version while indexing catches up", () => {
  const group = { id: "group", members: tokens };
  const change: ConfirmedSettlement = {
    id: "sale",
    asset: tokens[1]!,
    from: owner,
    to: "0x0000000000000000000000000000000000000002",
    orderHash: "0xorder",
    blockNumber: "2",
    blockHash: "0xblock",
    confirmedAt: 1,
    synced: false
  };
  assert.deepEqual(
    applyVersionSettlements(group, [change])?.members.map((m) => m.chain),
    ["ethereum"]
  );
  assert.equal(group.members.length, 2);
  assert.equal(
    applyVersionSettlements({ ...group, members: [tokens[1]!] }, [change]),
    null
  );
  assert.equal(
    applyVersionSettlements(group, [{ ...change, synced: true }])?.members
      .length,
    2
  );
  assert.equal(
    applyVersionSettlements(
      { ...group, members: [{ ...tokens[1]!, lastTransferBlock: "3" }] },
      [change]
    )?.members.length,
    1
  );
});

test("parses a Solana, Polygon, and Base lineage with different IDs and independent owners", () => {
  const base = { ...tokens[1]!, tokenId: "7" };
  const polygon: YunipalToken = {
    ...base,
    chain: "polygon",
    chainId: 137,
    contractAddress: tokens[0]!.contractAddress
  };
  const params = new URLSearchParams();
  const raw = versionFixture(
    new URL("http://localhost/__fixtures/indexer/v1/monster-groups"),
    [base, polygon]
  )!.body;
  const page = parseMonsterGroupPage(raw, params);
  assert.equal(page.groupTotal, 36);
  assert.equal(page.nftTotal, 38);
  const group = page.groups.find((g) => g.members.length === 3)!;
  assert.deepEqual(group.members.map((m) => m.chain).sort(), [
    "base",
    "polygon",
    "solana"
  ]);
  const solana = group.members.find((m) => m.chain === "solana")!;
  assert.equal(solana.tokenId, fixtureSolanaTokens[0]!.tokenId);
  assert.equal(solana.versionInfo?.role, "original");
  assert.equal(
    group.members.find((m) => m.chain === "polygon")!.versionInfo?.role,
    "version"
  );
  assert.equal(monsterAssetKey(solana), `solana:${solana.tokenId}`);
  assert.throws(() =>
    parseMonsterAsset({
      chain: "solana",
      contractAddress: null,
      tokenId: solana.tokenId,
      lifecycle: 2
    })
  );
  const bad = structuredClone(raw) as {
    groups: { members: Record<string, unknown>[] }[];
  };
  const member = bad.groups
    .flatMap((g) => g.members)
    .find((m) => m.chain === "solana")!;
  member.hidden = true;
  assert.throws(() => parseMonsterGroupPage(bad, params));
  member.hidden = false;
  member.owner = "0x0000000000000000000000000000000000000001";
  assert.throws(() => parseMonsterGroupPage(bad, params));
});

test("Solana collector checks preserve wallet case and count only matching holdings", () => {
  const owner = fixtureSolanaOwners[0];
  const params = new URLSearchParams({ chain: "solana", owner });
  const raw = versionFixture(
    new URL(`http://localhost/__fixtures/indexer/v1/monster-groups?${params}`),
    [{ ...tokens[1]!, tokenId: "7" }]
  )!.body;
  const page = parseMonsterGroupPage(raw, params);
  assert.equal(page.nftTotal, 18);
  assert(
    page.groups.every((g) =>
      g.members.every((m) => m.chain === "solana" && m.owner === owner)
    )
  );
  const bad = structuredClone(raw) as {
    resolvedAddresses: Record<string, string>;
  };
  bad.resolvedAddresses.solana = owner.toLowerCase();
  assert.throws(() => parseMonsterGroupPage(bad, params));
});
