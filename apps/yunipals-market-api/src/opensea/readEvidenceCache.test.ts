import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicClient,
  custom,
  zeroAddress,
  type Hex,
  type PublicClient
} from "viem";
import { OpenSeaReadEvidenceCache } from "@/opensea/readEvidenceCache";
import {
  assertOpenSeaObservationCurrent,
  inspectOpenSeaAdmission
} from "@/opensea/chain";
import { admissionFixture } from "@/opensea/fixtures/admission";

const hashA = `0x${"aa".repeat(32)}` as Hex;
const hashB = `0x${"bb".repeat(32)}` as Hex;

test("cached state is pinned by block hash and never replaces fresh canonical or chain checks", async () => {
  let canonical = hashA;
  let chainId = "0x1";
  let stateReads = 0;
  let headerReads = 0;
  let fail = false;
  const pins: unknown[] = [];
  const client = createPublicClient({
    cacheTime: 0,
    transport: custom(
      {
        async request(args: { method: string; params?: unknown[] }) {
          if (args.method === "eth_chainId") return chainId;
          if (args.method === "eth_getBlockByNumber") {
            headerReads++;
            return {
              hash: canonical,
              number: "0x7b",
              timestamp: "0x3e8",
              transactions: [],
              gasLimit: "0x0",
              gasUsed: "0x0",
              size: "0x0",
              difficulty: "0x0"
            };
          }
          assert.equal(args.method, "eth_getCode");
          pins.push(args.params?.[1]);
          stateReads++;
          if (fail) throw new Error("RPC failure");
          const pin = args.params?.[1] as {
            blockHash: Hex;
            requireCanonical: boolean;
          };
          assert.equal(pin.requireCanonical, true);
          return pin.blockHash === hashA ? "0x6001" : "0x6002";
        }
      },
      { retryCount: 0 }
    )
  });
  const cache = new OpenSeaReadEvidenceCache(client);
  const observation = {
    number: 123n,
    hash: hashA,
    timestamp: 1000n,
    chainId: 1,
    checkedAt: 1000000
  };
  const first = cache.at(client, observation);
  assert.deepEqual(
    await Promise.all([
      first.getCode({ address: zeroAddress, blockNumber: 123n }),
      first.getCode({ address: zeroAddress, blockNumber: 123n })
    ]),
    ["0x6001", "0x6001"]
  );
  assert.equal(stateReads, 1);
  await assertOpenSeaObservationCurrent(first, observation, () => 1000000);
  canonical = hashB;
  assert.equal(
    await first.getCode({ address: zeroAddress, blockNumber: 123n }),
    "0x6001"
  );
  await assert.rejects(
    assertOpenSeaObservationCurrent(first, observation, () => 1000000),
    { code: "observation_expired" }
  );
  const second = cache.at(client, { number: 123n, hash: hashB });
  fail = true;
  await assert.rejects(
    second.getCode({ address: zeroAddress, blockNumber: 123n })
  );
  fail = false;
  assert.equal(
    await second.getCode({ address: zeroAddress, blockNumber: 123n }),
    "0x6002"
  );
  assert.equal(stateReads, 3, "Failed state queries are not cached");
  canonical = hashA;
  chainId = "0x89";
  await assert.rejects(
    assertOpenSeaObservationCurrent(first, observation, () => 1000000),
    { code: "observation_expired" }
  );
  assert.equal(headerReads, 3);
  assert.deepEqual(pins[0], { blockHash: hashA, requireCanonical: true });
  assert.throws(() => cache.at({ ...client }, observation), /client mismatch/);
  assert.equal(JSON.stringify(cache.snapshot()).includes(hashA), false);
});

test("receipt cache is bounded, expires, isolates mutations and evicts invalidated receipts", async () => {
  const item = await admissionFixture();
  let reads = 0;
  let clock = 0;
  const client = {
    ...item.client,
    async getTransactionReceipt(args: { hash: Hex }) {
      reads++;
      return item.client.getTransactionReceipt(args);
    }
  } as PublicClient;
  const cache = new OpenSeaReadEvidenceCache(
    client,
    { entries: 1, bytes: 100000, entryBytes: 100000, ttlMs: 100 },
    () => clock
  );
  const mint = item.indexed.mint.transactionHash;
  const first = await cache.receipt(client, mint);
  first.blockHash = hashB;
  assert.notEqual((await cache.receipt(client, mint)).blockHash, hashB);
  assert.equal(reads, 1);
  clock = 101;
  await cache.receipt(client, mint);
  assert.equal(reads, 2);
  await cache.receipt(client, item.indexed.lastTransfer.transactionHash);
  await cache.receipt(client, mint);
  assert.equal(reads, 4);
  cache.forgetReceipt(mint);
  await cache.receipt(client, mint);
  assert.equal(reads, 5);
  assert.equal(cache.snapshot().entries, 1);
  const tiny = new OpenSeaReadEvidenceCache(client, {
    entries: 1,
    bytes: 10,
    entryBytes: 10,
    ttlMs: 100
  });
  await tiny.receipt(client, mint);
  assert.equal(tiny.snapshot().entries, 0);
});

test("reused lifecycle receipts still fail fresh canonical-header and ownership validation", async () => {
  const item = await admissionFixture();
  let receipts = 0;
  let orphaned = false;
  const client = {
    ...item.client,
    async getTransactionReceipt(args: { hash: Hex }) {
      receipts++;
      return item.client.getTransactionReceipt(args);
    },
    async getBlock(args: { blockNumber?: bigint }) {
      const block = await item.client.getBlock(args);
      return orphaned && args.blockNumber === item.indexed.mint.blockNumber
        ? { ...block, hash: hashB }
        : block;
    }
  } as PublicClient;
  // Isolate receipt caching through the complete admission validator. The first
  // test separately exercises the real viem block-hash state-read transport.
  class Receipts extends OpenSeaReadEvidenceCache {
    override at(client: PublicClient) {
      return client;
    }
  }
  const evidence = new Receipts(client);
  const options = { ...item.options, evidence };
  await inspectOpenSeaAdmission(client, item.input, item.indexed, options);
  await inspectOpenSeaAdmission(client, item.input, item.indexed, options);
  assert.equal(receipts, 2);
  orphaned = true;
  await assert.rejects(
    inspectOpenSeaAdmission(client, item.input, item.indexed, options),
    { code: "indexer_event_not_canonical" }
  );
  orphaned = false;
  await inspectOpenSeaAdmission(client, item.input, item.indexed, options);
  assert.equal(
    receipts,
    3,
    "The mismatched receipt was discarded and fetched again"
  );
  evidence.forgetReceipt(item.indexed.lastTransfer.transactionHash);
  const recipient = item.state.transferRecipient;
  item.state.transferRecipient = zeroAddress;
  await assert.rejects(
    inspectOpenSeaAdmission(client, item.input, item.indexed, options),
    { code: "indexer_event_mismatch" }
  );
  item.state.transferRecipient = recipient;
  await inspectOpenSeaAdmission(client, item.input, item.indexed, options);
  assert.equal(
    receipts,
    6,
    "Mismatched event evidence is discarded instead of cached through recovery"
  );
  item.state.owner = zeroAddress;
  await assert.rejects(
    inspectOpenSeaAdmission(client, item.input, item.indexed, options),
    { code: "asset_still_syncing" }
  );
});
