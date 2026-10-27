import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  validateUnifiedRpcProfile,
  unifiedRpcManifestId,
  unifiedRpcProfileId
} from "../../packages/yunipals-indexer-server/src/rpc-policy.ts";
import {
  getLogFilterFragments,
  encodeFragment
} from "../../apps/yunipals-indexer/node_modules/ponder/dist/esm/runtime/fragments.js";
const root = new URL("../../", import.meta.url),
  dir = new URL("./", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, dir)));
const old = read("normal-rpc-profile-v1.json"),
  next = read("ypal-combined-rpc-profile-v1.json"),
  approval = read("ypal-combined-rpc-approval-v1.json"),
  proposal = read("ypal-combined-source-proposal-v1.json");
const confirmed = JSON.parse(
  readFileSync(
    new URL(
      "docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json",
      root
    )
  )
);
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
function differences(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object")
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      differences(a[k], b[k], path + "/" + k)
    );
  return [path];
}
test("actual retained manifest and canonical deployment bindings", () => {
  assert.equal(
    hash(readFileSync(new URL("normal-rpc-profile-v1.json", dir))),
    "0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e"
  );
  assert.equal(
    unifiedRpcManifestId(validateUnifiedRpcProfile(old)),
    proposal.original.manifestHash
  );
  assert.equal(
    hash(
      readFileSync(
        new URL(
          "docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json",
          root
        )
      )
    ),
    "3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c"
  );
});
test("exactly three address/start replacements, with every other byte-equivalent JSON field retained", () => {
  assert.equal(next.manifest.sources.length, 12);
  const expected = [];
  for (let i = 0; i < old.manifest.sources.length; i++) {
    const a = old.manifest.sources[i],
      b = next.manifest.sources[i];
    assert.equal(a.id, b.id);
    if (a.feature === "boosters")
      expected.push(
        "/sources/" + i + "/address",
        "/sources/" + i + "/startBlock"
      );
    else assert.deepEqual(b, a);
  }
  assert.deepEqual(
    differences(old.manifest, next.manifest).sort(),
    expected.sort()
  );
  assert.deepEqual(
    read("ypal-combined-source-manifest-v1.json"),
    next.manifest
  );
});
test("all fresh address/start pairs are proven by the exact individual successful CREATE receipts", () => {
  const names = {
    BoosterRegistry: "registry",
    BoosterMonsters: "monsters",
    BoosterEngine: "engine"
  };
  for (const row of next.manifest.sources.filter(
    (x) => x.feature === "boosters"
  )) {
    const key = names[row.contractName],
      r = confirmed.receipts[key];
    assert.equal(row.address, confirmed[key].toLowerCase());
    assert.equal(row.startBlock, r.blockNumber);
    assert.equal(r.contractAddress, row.address);
    assert.equal(r.status, "success");
    assert.equal(
      row.abiHash,
      old.manifest.sources.find((x) => x.id === row.id).abiHash
    );
  }
});
test("same coordinator/limits/expiry and no permits or paid authority", () => {
  const a = { ...old },
    b = { ...next };
  delete a.reviewId;
  delete b.reviewId;
  delete a.manifest;
  delete b.manifest;
  assert.deepEqual(a, b);
  assert.notEqual(old.reviewId, next.reviewId);
  assert.deepEqual(approval, {
    profile: next,
    expiresAt: "2026-11-19T18:00:00.000Z",
    permits: []
  });
  validateUnifiedRpcProfile(next);
  assert.equal(unifiedRpcProfileId(next), proposal.future.profileId);
  assert.equal(unifiedRpcManifestId(next), proposal.future.manifestHash);
  assert.equal(proposal.financial.paidAuthority, false);
});
test("actual Ponder filter keys reuse unchanged BNB scope and distinguish old/new monster addresses", () => {
  const topic0 =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const fragments = (s) =>
    getLogFilterFragments({
      chainId: s.chainId,
      address: s.address,
      topic0,
      hasTransactionReceipt: s.receiptRequirement === "full"
    });
  const bnb = old.manifest.sources.find((x) => x.id === "ownership:bnb");
  assert.deepEqual(
    fragments(bnb),
    fragments(next.manifest.sources.find((x) => x.id === bnb.id))
  );
  const before = old.manifest.sources.find(
      (x) => x.id === "boosters:boostermonsters"
    ),
    after = next.manifest.sources.find((x) => x.id === before.id);
  const prior = fragments(before),
    future = fragments(after);
  assert.notEqual(
    encodeFragment(prior[0].fragment),
    encodeFragment(future[0].fragment)
  );
  assert.equal(
    future[0].adjacentIds.includes(encodeFragment(prior[0].fragment)),
    false
  );
});
test("Solana descriptor and ledger contract stay separate and future authority/coverage is not invented", () => {
  const sol = proposal.solanaPreservedSeparately;
  assert.deepEqual(sol.manifest, {
    checksum:
      "f9499fc3399ae235c0d3dd1c1664e4e9933dc57c5ec653e5c6368b100c295d07",
    count: 10000
  });
  for (const key of [
    "retainedPublicSourceManifest",
    "retainedSupervisorStateSql"
  ])
    assert.equal(
      hash(readFileSync(new URL(sol[key].file, root))),
      sol[key].sha256
    );
  assert.equal(sol.evmRpcProfileIncludesSolana, false);
  assert.equal(sol.resetBudgetLedgerOrPublication, false);
  assert.equal(proposal.future.buildId, null);
  assert.equal(proposal.future.sourceDigest, null);
  assert.equal(proposal.future.profileAdmitted, false);
  assert.equal(
    proposal.cacheReuse.nativeDerivedStateAndCheckpointsTransferable,
    false
  );
  assert.equal(proposal.cacheReuse.newNamespaceHandlerReplayRequired, true);
  assert.equal(proposal.productionEffects.sourceOrProxyRestarted, false);
});
