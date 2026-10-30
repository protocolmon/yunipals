import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import type { ArenaTransactionAction } from "@protopals/yunipals-market-core/arena";
import { ArenaIntake } from "./intake";
import {
  ArenaClientTransactions,
  transactionAction
} from "./clientTransactions";
import { StrategyCipher } from "./crypto";
import type { NativeArenaSource } from "./nativeSource";
import { migrateArena } from "./schema";
import { adoptLegacyClientTransactions } from "./nativeClientAdoption";
import { createArenaApp } from "./http";

async function fixture() {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  assert.ok(["/arena", "/yunipals_arena_test"].includes(parsed.pathname));
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await migrateArena(pool);
  const hash = () => `0x${randomBytes(32).toString("hex")}` as Hex;
  const address = () => `0x${randomBytes(20).toString("hex")}` as Address;
  const contract = address(),
    wallet = address(),
    currency = address();
  const deployment = `8453:${contract}`,
    incarnation = hash(),
    txhash = hash();
  const collection = "0x98433df878e8c898cb907345c3a7756e5f72240f" as Address;
  const opening = {
    id: `${deployment}:${hash()}:0`,
    transactionHash: hash(),
    blockHash: hash(),
    blockNumber: "1",
    logIndex: 0
  };
  let proof: Awaited<ReturnType<NativeArenaSource["transaction"]>> = {
    releaseId: hash(),
    sourceId: `arena:${deployment}`,
    indexedThroughBlock: "10",
    observedThroughBlock: "10",
    finalizedThroughBlock: null,
    origin: { incarnation, opened: opening },
    inclusion: null,
    events: []
  };
  let unavailable = false,
    missing = false,
    pointHash: Hex | undefined;
  let receipt: TransactionReceipt;
  let receiptReads = 0,
    headers = 0,
    finalizedCalls = 0;
  let afterProof: (() => void) | undefined;
  const service = new ArenaIntake(
    pool,
    deployment,
    contract,
    "https://www.yunipals.com",
    new StrategyCipher(randomBytes(32)),
    { message: async () => true, strategy: async () => true },
    {
      read: async () => {
        if (unavailable) throw new Error("Source unavailable.");
        return { ...proof, tournament: null };
      },
      credit: async () => {
        if (unavailable) throw new Error("Source unavailable.");
        return { ...proof, amount: "0", last: null };
      },
      transaction: async (_hash, options) => {
        if (unavailable) throw new Error("Source unavailable.");
        const result = structuredClone(proof);
        result.inclusion = options?.blockHash
          ? (proof.inclusion ?? "canonical")
          : null;
        afterProof?.();
        return result;
      }
    }
  );
  const tracker = new ArenaClientTransactions(service, currency);
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
    [deployment, contract]
  );
  async function permit(origin = incarnation, legacy = false) {
    await pool.query(
      `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)
      VALUES($1,1,$2,$3,$4,$5,now(),$6) ON CONFLICT DO NOTHING`,
      [
        deployment,
        origin,
        `${deployment}:${origin}:0`,
        hash(),
        proof.releaseId,
        legacy ? `${deployment}/1` : `${deployment}/1/${origin}`
      ]
    );
    await pool.query(
      `INSERT INTO yunipals_arena.admission(deployment,tournament_id,incarnation,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature)
      VALUES($1,1,$2,$3,8453,$4,1,1,$5,9999999999,'0x12') ON CONFLICT DO NOTHING`,
      [deployment, origin, wallet, collection, hash()]
    );
  }
  await permit();
  const entry: ArenaTransactionAction = {
    kind: "entry",
    tournamentId: "1",
    incarnation,
    nftChainId: 8453,
    collection,
    tokenId: "1"
  };
  function mined(kind: "entry" | "approval" | "claim", blockHash = hash()) {
    const name =
      kind === "entry"
        ? "Entered"
        : kind === "approval"
          ? "Approval"
          : "Claimed";
    const args =
      kind === "entry"
        ? {
            id: "1",
            seat: 0,
            player: wallet,
            nftChainId: "8453",
            collection,
            tokenId: "1"
          }
        : kind === "claim"
          ? { player: wallet, recipient: wallet, amount: "123" }
          : {};
    const topics =
      kind === "entry"
        ? encodeEventTopics({
            abi: arenaAbi,
            eventName: "Entered",
            args: { id: 1n, seat: 0, player: wallet }
          })
        : kind === "approval"
          ? encodeEventTopics({
              abi: erc20Abi,
              eventName: "Approval",
              args: { owner: wallet, spender: contract }
            })
          : encodeEventTopics({
              abi: arenaAbi,
              eventName: "Claimed",
              args: { player: wallet, recipient: wallet }
            });
    const data =
      kind === "entry"
        ? encodeAbiParameters(
            [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
            [8453n, collection, 1n]
          )
        : encodeAbiParameters(
            [{ type: "uint256" }],
            [kind === "claim" ? 123n : 2_000_000n]
          );
    const log = {
      address: kind === "approval" ? currency : contract,
      blockNumber: 10n,
      blockHash,
      transactionHash: txhash,
      transactionIndex: 0,
      logIndex: 1,
      removed: false,
      topics,
      data
    };
    receipt = {
      transactionHash: txhash,
      blockNumber: 10n,
      blockHash,
      transactionIndex: 0,
      status: "success",
      from: address(),
      to: address(),
      logs: [log]
    } as TransactionReceipt;
    proof.events =
      kind === "approval"
        ? []
        : [
            {
              id: `${deployment}:${txhash}:1`,
              name,
              args,
              blockNumber: "10",
              blockHash,
              transactionHash: txhash,
              logIndex: 1
            }
          ];
    proof.inclusion = "canonical";
    pointHash = undefined;
    missing = false;
  }
  const client = {
    getChainId: async () => 8453,
    getBlock: async (options: { blockTag?: string; blockNumber?: bigint }) => {
      if (options.blockTag) {
        finalizedCalls++;
        throw new Error("No finality-tag wait.");
      }
      headers++;
      return { number: 10n, hash: pointHash ?? receipt.blockHash };
    },
    getTransactionReceipt: async () => {
      receiptReads++;
      if (missing) throw new TransactionReceiptNotFoundError({ hash: txhash });
      return receipt;
    }
  } as unknown as PublicClient;
  const due = () =>
    pool.query(
      "UPDATE yunipals_arena.client_transaction SET next_check_at=now() WHERE deployment=$1",
      [deployment]
    );
  async function tick() {
    await due();
    await tracker.reconcileBatch(client);
  }
  async function close() {
    for (const table of [
      "session",
      "challenge",
      "client_receipt_history",
      "client_transaction",
      "admission",
      "tournament_identity",
      "deployment"
    ])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE ${table === "deployment" ? "id" : "deployment"}=$1`,
        [deployment]
      );
    await pool.end();
  }
  return {
    pool,
    service,
    deployment,
    wallet,
    contract,
    txhash,
    incarnation,
    entry,
    tracker,
    client,
    hash,
    permit,
    mined,
    tick,
    close,
    get proof(): Awaited<ReturnType<NativeArenaSource["transaction"]>> {
      return proof;
    },
    get receipt() {
      return receipt;
    },
    set unavailable(value: boolean) {
      unavailable = value;
    },
    set missing(value: boolean) {
      missing = value;
    },
    set pointHash(value: Hex) {
      pointHash = value;
    },
    set afterProof(value: (() => void) | undefined) {
      afterProof = value;
    },
    counts: () => ({ receiptReads, headers, finalizedCalls })
  };
}

test("native entry succeeds at latest, retracts stale proof immediately and recovers the same hash", async () => {
  const f = await fixture();
  try {
    f.mined("entry");
    await f.tracker.register(f.wallet, f.txhash, f.entry);
    await f.tick();
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).state, "indexed");
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).finalized, false);
    f.proof.inclusion = "changed";
    const stale = await f.tracker.read(f.wallet, f.txhash);
    assert.equal(stale.state, "reorged");
    assert.equal(stale.result, null);
    f.missing = true;
    await f.tick();
    f.mined("entry");
    await f.tick();
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).state, "indexed");
    const history = await f.pool.query(
      "SELECT canonical FROM yunipals_arena.client_receipt_history WHERE deployment=$1 ORDER BY first_seen_at",
      [f.deployment]
    );
    assert.deepEqual(history.rows, [{ canonical: false }, { canonical: true }]);
    const settledReads = f.counts().receiptReads;
    await f.tick();
    assert.equal(
      f.counts().receiptReads,
      settledReads,
      "Canonical accepted receipts use database-only audits"
    );
    f.proof.finalizedThroughBlock = "10";
    await f.tick();
    assert.equal(f.counts().receiptReads, settledReads);
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).finalized, true);
    const reads = f.counts().receiptReads;
    await f.tick();
    assert.equal(f.counts().receiptReads, reads);
    assert.equal(f.counts().finalizedCalls, 0);
    f.proof.inclusion = "changed";
    await assert.rejects(
      f.tracker.read(f.wallet, f.txhash),
      /needs reconciliation/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT halted FROM yunipals_arena.deployment WHERE id=$1",
          [f.deployment]
        )
      ).rows[0].halted,
      true
    );
  } finally {
    await f.close();
  }
});

test("native registration requires an unambiguous permit origin; approval survives replacement openings", async () => {
  const f = await fixture();
  try {
    await f.permit(f.hash());
    await assert.rejects(
      f.tracker.register(f.wallet, f.txhash, {
        kind: "approval",
        tournamentId: "1"
      }),
      /specific tournament opening/
    );
    f.mined("approval");
    await f.tracker.register(f.wallet, f.txhash, {
      kind: "approval",
      tournamentId: "1",
      incarnation: f.incarnation
    });
    f.proof.origin = null;
    await f.tick();
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).state, "indexed");
    await assert.rejects(
      f.tracker.register(f.wallet, f.txhash, {
        ...f.entry,
        incarnation: f.hash()
      }),
      /different action/
    );
    assert.equal(f.counts().finalizedCalls, 0);
  } finally {
    await f.close();
  }
});

test("native claim registration works after the claim drained its balance and never reads operational credit", async () => {
  const f = await fixture();
  try {
    f.mined("claim");
    await f.tracker.register(f.wallet, f.txhash, { kind: "claim" });
    await f.tick();
    assert.equal(
      (await f.tracker.read(f.wallet, f.txhash)).result?.amount,
      "123"
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.credit WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await f.close();
  }
});

test("pending native claims advance after two seconds without bypassing indexed evidence", async () => {
  const f = await fixture();
  const delay = async () =>
    Number(
      (
        await f.pool.query(
          `SELECT extract(epoch FROM next_check_at-clock_timestamp()) AS seconds
          FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2`,
          [f.deployment, f.txhash]
        )
      ).rows[0].seconds
    );
  try {
    f.mined("claim");
    await f.tracker.register(f.wallet, f.txhash, { kind: "claim" });
    f.proof.inclusion = "not_indexed";
    await f.tracker.reconcileBatch(f.client);
    const pending = await f.tracker.read(f.wallet, f.txhash);
    assert.equal(pending.state, "indexing");
    assert.equal(pending.result, null);
    assert.ok((await delay()) > 0 && (await delay()) <= 2);
    const reads = f.counts().receiptReads;
    await f.tracker.reconcileBatch(f.client);
    assert.equal(f.counts().receiptReads, reads, "No retry before it is due");

    f.proof.inclusion = "canonical";
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await f.tracker.reconcileBatch(f.client);
    const confirmed = await f.tracker.read(f.wallet, f.txhash);
    assert.equal(confirmed.state, "indexed");
    assert.equal(confirmed.result?.amount, "123");
    assert.equal(confirmed.finalized, false);
    assert.ok((await delay()) > 28 && (await delay()) <= 30);
    const acceptedReads = f.counts().receiptReads;
    await f.tick();
    assert.equal(f.counts().receiptReads, acceptedReads);
  } finally {
    await f.close();
  }
});

test("missing native receipts retry quickly, but RPC failures retain durable backoff", async () => {
  const f = await fixture();
  try {
    f.mined("entry");
    await f.tracker.register(f.wallet, f.txhash, f.entry);
    f.missing = true;
    await f.tick();
    assert.equal(
      (await f.tracker.read(f.wallet, f.txhash)).state,
      "confirming"
    );
    const seconds = async () =>
      Number(
        (
          await f.pool.query(
            `SELECT extract(epoch FROM next_check_at-clock_timestamp()) AS seconds
            FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2`,
            [f.deployment, f.txhash]
          )
        ).rows[0].seconds
      );
    assert.ok((await seconds()) > 0 && (await seconds()) <= 2);
    await f.pool.query(
      "UPDATE yunipals_arena.client_transaction SET next_check_at=now() WHERE deployment=$1",
      [f.deployment]
    );
    const failing = {
      ...f.client,
      getTransactionReceipt: async () => {
        throw new Error("RPC temporarily unavailable");
      }
    } as unknown as PublicClient;
    await assert.rejects(
      f.tracker.reconcileBatch(failing),
      /RPC temporarily unavailable/
    );
    assert.ok((await seconds()) > 28 && (await seconds()) <= 30);
    await f.tracker.reconcileBatch(failing);
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).result, null);
  } finally {
    await f.close();
  }
});

test("older pending native transactions slow down without changing their saved identity", async () => {
  const f = await fixture();
  try {
    f.mined("entry");
    await f.pool.query(
      `INSERT INTO yunipals_arena.client_transaction
      (deployment,hash,wallet,action,reader_mode,tournament_id,incarnation,created_at)
      VALUES($1,$2,$3,$4,'unified',1,$5,now()-interval '2 minutes')`,
      [f.deployment, f.txhash, f.wallet, f.entry, f.incarnation]
    );
    f.proof.inclusion = "not_indexed";
    await f.tracker.reconcileBatch(f.client);
    const row = (
      await f.pool.query(
        `SELECT state,hash,action,extract(epoch FROM next_check_at-clock_timestamp()) AS seconds
        FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2`,
        [f.deployment, f.txhash]
      )
    ).rows[0];
    assert.equal(row.state, "indexing");
    assert.equal(row.hash, f.txhash);
    assert.deepEqual(row.action, f.entry);
    assert.ok(Number(row.seconds) > 8 && Number(row.seconds) <= 10);
  } finally {
    await f.close();
  }
});

test("native tracker withholds partial coverage, malformed receipts, stale entries and unavailable sources", async () => {
  const f = await fixture();
  try {
    f.mined("entry");
    await f.tracker.register(f.wallet, f.txhash, f.entry);
    f.proof.inclusion = "not_indexed";
    await f.tick();
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).state, "indexing");
    f.proof.inclusion = "canonical";
    f.receipt.logs[0]!.blockHash = f.hash();
    await assert.rejects(f.tick(), /log identity/);
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).result, null);
    f.mined("entry");
    f.proof.origin!.incarnation = f.hash();
    await f.tick();
    assert.equal((await f.tracker.read(f.wallet, f.txhash)).state, "reorged");
    f.unavailable = true;
    const reads = f.counts().receiptReads;
    await assert.rejects(f.tick(), /Source unavailable/);
    await assert.rejects(
      f.tracker.read(f.wallet, f.txhash),
      /Source unavailable/
    );
    assert.equal(f.counts().receiptReads, reads);
  } finally {
    await f.close();
  }
});

test("native tracking rejects source changes during acceptance and canonical receipt payload changes", async () => {
  const f = await fixture();
  try {
    f.mined("entry");
    await f.tracker.register(f.wallet, f.txhash, f.entry);
    let observations = 0;
    f.afterProof = () => {
      if (++observations === 2) f.proof.inclusion = "changed";
    };
    await assert.rejects(f.tick(), /changed during verification/);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.client_receipt_history WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
    f.afterProof = undefined;
    f.proof.inclusion = "canonical";
    await f.tick();
    f.proof.inclusion = "expired";
    f.receipt.from = f.contract;
    await assert.rejects(f.tick(), /payload changed/);
  } finally {
    await f.close();
  }
});

test("transaction action parser retains validated opening identity", () => {
  const incarnation = `0x${"a".repeat(64)}`;
  assert.equal(
    (
      transactionAction({
        kind: "approval",
        tournamentId: "1",
        incarnation
      }) as { incarnation: string }
    ).incarnation,
    incarnation
  );
  assert.throws(
    () =>
      transactionAction({
        kind: "approval",
        tournamentId: "1",
        incarnation: "latest"
      }),
    /Invalid tournament opening/
  );
});

test("legacy client adoption binds only the explicitly adopted parent and retains unresolved hashes", async () => {
  const f = await fixture();
  try {
    const adoptedOrigin = f.hash();
    await f.permit(adoptedOrigin, true);
    const { incarnation: _origin, ...entry } = f.entry as Extract<
      ArenaTransactionAction,
      { kind: "entry" }
    >;
    const claimHash = f.hash(),
      unresolvedHash = f.hash();
    for (const [hash, action] of [
      [f.txhash, entry],
      [claimHash, { kind: "claim" }],
      [unresolvedHash, { ...entry, tournamentId: "2" }]
    ])
      await f.pool.query(
        "INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action,state) VALUES($1,$2,$3,$4,'indexed')",
        [f.deployment, hash, f.wallet, action]
      );
    await assert.rejects(
      adoptLegacyClientTransactions(f.pool, f.deployment),
      /halted native/
    );
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [f.deployment]
    );
    assert.deepEqual(
      await adoptLegacyClientTransactions(f.pool, f.deployment),
      { adopted: 2, unresolved: 1 }
    );
    const rows = (
      await f.pool.query(
        "SELECT hash,incarnation,reader_mode,state FROM yunipals_arena.client_transaction WHERE deployment=$1",
        [f.deployment]
      )
    ).rows;
    assert.deepEqual(
      rows.find((row) => row.hash === f.txhash),
      {
        hash: f.txhash,
        incarnation: adoptedOrigin,
        reader_mode: "unified",
        state: "submitted"
      }
    );
    assert.equal(
      rows.find((row) => row.hash === unresolvedHash).reader_mode,
      "legacy"
    );
    assert.deepEqual(
      await adoptLegacyClientTransactions(f.pool, f.deployment),
      { adopted: 0, unresolved: 1 }
    );
  } finally {
    await f.close();
  }
});

test("native transaction HTTP authenticates the wallet and withdraws stale success without RPC", async () => {
  const f = await fixture();
  try {
    f.mined("entry");
    const app = createArenaApp(f.service, { entriesEnabled: false });
    assert.equal((await app.request(`/transactions/${f.txhash}`)).status, 401);
    const challenge = await f.service.challenge(f.wallet);
    const auth = await f.service.authenticate(challenge.id, "0x12");
    const headers = {
      cookie: `__Host-yunipals-arena=${auth.token}`,
      origin: f.service.origin,
      "content-type": "application/json"
    };
    const registered = await app.request("/transactions", {
      method: "POST",
      headers,
      body: JSON.stringify({ hash: f.txhash, action: f.entry })
    });
    assert.equal(registered.status, 200);
    await f.tick();
    const reads = f.counts().receiptReads;
    const indexed = await app.request(`/transactions/${f.txhash}`, { headers });
    assert.equal(indexed.headers.get("cache-control"), "no-store");
    assert.equal(
      ((await indexed.json()) as { state: string }).state,
      "indexed"
    );
    f.proof.inclusion = "changed";
    const reorged = await app.request(`/transactions/${f.txhash}`, { headers });
    const body = (await reorged.json()) as { state: string; result: unknown };
    assert.equal(body.state, "reorged");
    assert.equal(body.result, null);
    assert.equal(f.counts().receiptReads, reads);
    f.unavailable = true;
    assert.equal(
      (await app.request(`/transactions/${f.txhash}`, { headers })).status,
      503
    );
  } finally {
    await f.close();
  }
});
