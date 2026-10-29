import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  getContractAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import {
  animeDeploymentPackageSha256,
  animeLaunchAction,
  readAnimeDeploymentPackage,
  readAnimeLaunch,
  type AnimeDeploymentPackage
} from "./animeDeployment";

const bytes = await readFile(
  new URL("../../public/arena/anime-deployment-v1.json", import.meta.url)
);
const bundle = JSON.parse(bytes.toString()) as AnimeDeploymentPackage;
const owner = `0x${"2".repeat(40)}` as Address;
const hashes = {
  registry: `0x${"a".repeat(64)}` as Hex,
  arena: `0x${"b".repeat(64)}` as Hex
};
const addresses = [0n, 1n].map((nonce) =>
  getContractAddress({ from: owner, nonce })
);

async function fixture() {
  const actions = [
    await animeLaunchAction(bundle, "registry", owner),
    await animeLaunchAction(bundle, "arena", owner, addresses[0])
  ];
  const blockHash = `0x${"c".repeat(64)}` as Hex;
  const receipts = new Map(
    Object.values(hashes).map((hash, i) => [
      hash,
      {
        transactionHash: hash,
        status: "success",
        contractAddress: addresses[i],
        blockNumber: BigInt(10 + i),
        blockHash
      }
    ])
  );
  const transactions = new Map(
    Object.values(hashes).map((hash, i) => [
      hash,
      { from: owner, to: null, value: 0n, input: actions[i]!.data, nonce: i }
    ])
  );
  const reader = {
    getChainId: async () => 8453,
    getTransactionReceipt: async ({ hash }: { hash: Hex }) =>
      receipts.get(hash),
    getTransaction: async ({ hash }: { hash: Hex }) => transactions.get(hash),
    getBlock: async () => ({ hash: blockHash }),
    getCode: async ({ address }: { address: Address }) =>
      address === addresses[0] ? bundle.registry.runtime : bundle.arena.runtime,
    readContract: async ({
      functionName,
      blockNumber
    }: {
      functionName: string;
      blockNumber: bigint;
    }) => {
      assert.ok(blockNumber >= 10n);
      return functionName === "entriesPaused";
    }
  };
  return {
    client: reader as unknown as PublicClient,
    reader,
    receipts,
    transactions,
    actions
  };
}

test("browser package is pinned and rejects changed public bytes", async () => {
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    animeDeploymentPackageSha256
  );
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(bytes);
    assert.deepEqual(await readAnimeDeploymentPackage(), bundle);
    globalThis.fetch = async () =>
      new Response(Buffer.concat([bytes, Buffer.from(" ")]));
    await assert.rejects(
      readAnimeDeploymentPackage(),
      /differs from the reviewed/
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("two verified creations resume in order and bind the rules to the actual registry", async () => {
  const f = await fixture();
  assert.equal(
    (await readAnimeLaunch(f.client, bundle, owner, {})).next,
    "registry"
  );
  assert.equal(
    (
      await readAnimeLaunch(f.client, bundle, owner, {
        registry: hashes.registry
      })
    ).next,
    "arena"
  );
  const done = await readAnimeLaunch(f.client, bundle, owner, hashes);
  assert.equal(done.next, null);
  assert.equal(done.verified.arena?.address, addresses[1]);
  const expected = createHash("sha256")
    .update(
      JSON.stringify(
        sort({
          ...bundle.rulesTemplate,
          eligibilityRegistry: addresses[0]!.toLowerCase()
        })
      )
    )
    .digest("hex");
  assert.equal(f.actions[1]!.rulesHash, `0x${expected}`);
  await assert.rejects(
    animeLaunchAction(bundle, "arena", owner),
    /registry deployment first/
  );
});
function sort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sort(x)])
    );
  return v;
}

test("foreign wallets, modified creation data, orphaned receipts and changed runtime cannot unlock the next step", async () => {
  for (const change of [
    { from: `0x${"3".repeat(40)}` },
    { value: 1n },
    { to: owner },
    { input: "0x1234" }
  ]) {
    const f = await fixture();
    Object.assign(f.transactions.get(hashes.registry)!, change);
    await assert.rejects(
      readAnimeLaunch(f.client, bundle, owner, { registry: hashes.registry }),
      /differs from this wallet/
    );
  }
  const f = await fixture();
  f.reader.getBlock = async () => ({ hash: `0x${"d".repeat(64)}` });
  await assert.rejects(
    readAnimeLaunch(f.client, bundle, owner, hashes),
    /no longer canonical/
  );
  const g = await fixture();
  g.reader.getCode = async () => "0x1234";
  await assert.rejects(
    readAnimeLaunch(g.client, bundle, owner, hashes),
    /differs from the reviewed/
  );
});

test("pending and reverted receipts retain their hash and cannot buy another deployment", async () => {
  const f = await fixture();
  f.reader.getTransactionReceipt = async () => {
    throw Object.assign(new Error("pending"), {
      name: "TransactionReceiptNotFoundError"
    });
  };
  const pending = await readAnimeLaunch(f.client, bundle, owner, hashes);
  assert.equal(pending.pending, "registry");
  assert.equal(pending.next, null);
  const g = await fixture();
  g.receipts.get(hashes.registry)!.status = "reverted";
  const reverted = await readAnimeLaunch(g.client, bundle, owner, hashes);
  assert.equal(reverted.failed, "registry");
  assert.equal(reverted.next, null);
});
