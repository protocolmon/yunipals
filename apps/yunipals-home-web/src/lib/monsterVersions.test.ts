import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMonsterVersionInfo,
  monsterAssetKey
} from "@protopals/yunipals-market-core/monsterVersions";
import { versionFixture } from "../../scripts/fixtures/monsterVersions";
import type { YunipalToken } from "@/lib/yunipalsIndexer";
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

test("validates original references and rejects invalid identity, role and lifecycle", () => {
  const token = tokens[1]!;
  const response = versionFixture(
    new URL(
      `http://localhost/__fixtures/indexer/v1/monster-versions?asset=${monsterAssetKey(token)}:1`
    ),
    tokens
  )!.body as { items: Record<string, unknown> };
  const info = parseMonsterVersionInfo(
    response.items[monsterAssetKey(token)],
    token
  )!;
  assert.equal(info.role, "airdrop");
  assert.equal(
    info.versions.find((v) => v.role === "original")?.chain,
    "ethereum"
  );
  assert.notEqual(monsterAssetKey(tokens[0]!), monsterAssetKey(token));
  assert.throws(() =>
    parseMonsterVersionInfo({ ...info, role: "other" }, token)
  );
  assert.throws(() =>
    parseMonsterVersionInfo(
      { ...info, versions: [info.versions[0], info.versions[0]] },
      token
    )
  );
  assert.throws(() =>
    parseMonsterVersionInfo(info, { ...token, lifecycle: 2 })
  );
});
