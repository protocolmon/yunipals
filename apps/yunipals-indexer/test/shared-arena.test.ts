import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import { arenaV2Abi } from "../../../packages/yunipals-market-core/src/arenaV2Abi.js";
import {
  arenaDeploymentId,
  arenaEventKind
} from "../../../packages/yunipals-market-core/src/arenaProtocol.js";
import {
  readArenaBrowse,
  readArenaCredit,
  readArenaTournamentIds,
  readArenaTransaction
} from "../../../packages/yunipals-indexer-server/src/arena.js";
import type { IndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.js";
import { applyArenaEvent } from "../lib/arena/state.js";

// Runtime binding/readiness already has its own integration suite. This fixture
// exercises the real mode-scoped SQL and event evidence in one canonical stream.
vi.mock("../../../packages/yunipals-indexer-server/src/releases.js", () => ({
  readBoundRuntime: async () => ({
    chains: [{ chainId: 8453, completeThroughBlock: 100n }]
  })
}));

it("keeps shared mode balances, work lists and transaction evidence isolated", async () => {
  const database = new PGlite();
  const contract = `0x${"12".repeat(20)}`,
    wallet = `0x${"34".repeat(20)}`;
  const hash = `0x${"ab".repeat(32)}`,
    abiHash = `0x${"cd".repeat(32)}`;
  const source = {
    id: `arena:8453:${contract}`,
    feature: "arena",
    chainId: 8453,
    address: contract,
    startBlock: "1",
    abiHash,
    enabled: true,
    contractName: "YunipalsArenaV2",
    events: arenaV2Abi.filter((i) => i.type === "event").map((i) => i.name)
  };
  const db = {
    query: async (text: string, values?: unknown[]) => {
      const result = await database.query(text, values);
      return {
        ...result,
        rowCount: Math.max(result.affectedRows ?? 0, result.rows.length)
      };
    }
  } as unknown as PoolClient;
  const reader = {
    release: { id: hash, schema: "mode_test", manifest: { sources: [source] } },
    snapshot: async (
      _source: unknown,
      _policy: unknown,
      read: (db: PoolClient, context: unknown) => Promise<unknown>
    ) =>
      read(db, {
        status: {
          readiness: { reason: "ready" },
          anchor: { number: "100", hash },
          snapshot: { finalized: null }
        }
      })
  } as unknown as IndexerReader;
  const definition = (mediaKind: "video" | "anime") => ({
    contract,
    contractVersion: 2 as const,
    mediaKind,
    startBlock: "1",
    abiHash
  });
  try {
    await database.exec(`CREATE SCHEMA mode_test;
      CREATE TABLE mode_test.canonical_event(id text PRIMARY KEY,source_id text,chain_id integer,address text,abi_hash text,name text,args text,block_number bigint,block_hash text,transaction_hash text,log_index integer);
      CREATE TABLE mode_test.arena_credit(deployment text,wallet text,amount numeric,last_event_id text,block_number bigint,block_hash text);
      CREATE TABLE mode_test.arena_tournament(deployment text,tournament_id text,state jsonb,block_number bigint,opened_event_id text,opened_block_hash text,last_event_id text,block_hash text);
      CREATE TABLE mode_test.chain_block(chain_id integer,block_number bigint,block_hash text);`);
    await db.query("INSERT INTO mode_test.chain_block VALUES(8453,100,$1)", [
      hash
    ]);
    let log = 0;
    for (const kind of ["video", "anime"] as const) {
      const mode = kind === "video" ? 0 : 1,
        id = String(mode + 1),
        deployment = arenaDeploymentId(contract, kind, 2);
      const openingId = `8453:${contract}:${hash}:${log}`;
      await db.query(
        "INSERT INTO mode_test.canonical_event VALUES($1,$2,8453,$3,$4,'TournamentOpened',$5,100,$6,$6,$7)",
        [
          openingId,
          source.id,
          contract,
          abiHash,
          JSON.stringify({ id, mode }),
          hash,
          log++
        ]
      );
      let state = applyArenaEvent(
        null,
        "TournamentOpened",
        { id, mode, deadline: 100, rulesHash: hash, poolHash: hash },
        kind
      ).state;
      state = applyArenaEvent(
        state,
        "Entered",
        {
          id,
          seat: 0,
          player: wallet,
          nftChainId: 8453,
          collection: contract,
          tokenId: "1"
        },
        kind
      ).state;
      const expired = applyArenaEvent(state, "TournamentExpired", { id }, kind);
      expect(expired.credits[0]!.amount).toBe(
        kind === "video" ? 2000000n : 1000000n
      );
      const eventId = `8453:${contract}:${hash}:${log}`;
      await db.query(
        "INSERT INTO mode_test.canonical_event VALUES($1,$2,8453,$3,$4,'TournamentExpired',$5,100,$6,$6,$7)",
        [
          eventId,
          source.id,
          contract,
          abiHash,
          JSON.stringify({ id }),
          hash,
          log++
        ]
      );
      await db.query(
        "INSERT INTO mode_test.arena_credit VALUES($1,$2,$3,$4,100,$5)",
        [deployment, wallet, String(expired.credits[0]!.amount), eventId, hash]
      );
      await db.query(
        "INSERT INTO mode_test.arena_tournament VALUES($1,$2,$3,100,$4,$5,$6,$5)",
        [
          deployment,
          id,
          JSON.stringify(expired.state),
          openingId,
          hash,
          eventId
        ]
      );
    }
    for (const kind of ["video", "anime"] as const) {
      const credit = await readArenaCredit(reader, definition(kind), wallet);
      expect(credit.amount).toBe(kind === "video" ? "2000000" : "1000000");
      const list = await readArenaTournamentIds(reader, definition(kind));
      expect(list.ids).toEqual([kind === "video" ? "1" : "2"]);
      const proof = await readArenaTransaction(reader, definition(kind), hash);
      expect(proof.events).toHaveLength(2);
      expect(proof.events[0]!.args.id).toBe(kind === "video" ? "1" : "2");
      expect(proof.events[0]!.id).not.toContain(`:${kind}:`);
      const totals = await readArenaBrowse(reader, definition(kind), {
        kind: "wallet",
        wallet
      });
      expect(totals.totals!.refunds).toBe(
        kind === "video" ? "2000000" : "1000000"
      );
    }
    for (const kind of ["video", "anime"] as const) {
      const mode = kind === "video" ? 0 : 1,
        claimed = mode === 0 ? "100" : "200";
      await db.query(
        "INSERT INTO mode_test.canonical_event VALUES($1,$2,8453,$3,$4,'Claimed',$5,100,$6,$6,$7)",
        [
          `8453:${contract}:${hash}:${log}`,
          source.id,
          contract,
          abiHash,
          JSON.stringify({
            mode,
            player: wallet,
            recipient: wallet,
            amount: claimed
          }),
          hash,
          log++
        ]
      );
    }
    expect(
      (
        await readArenaBrowse(reader, definition("video"), {
          kind: "wallet",
          wallet
        })
      ).withdrawals
    ).toBe("100");
    expect(
      (
        await readArenaBrowse(reader, definition("anime"), {
          kind: "wallet",
          wallet
        })
      ).withdrawals
    ).toBe("200");
    const rewards = await readArenaBrowse(reader, definition("anime"), {
      kind: "rewards",
      wallet
    });
    expect(
      rewards.events.filter((e) => e.event_name === "Claimed")
    ).toHaveLength(1);
    expect(
      rewards.events.find((e) => e.event_name === "Claimed")!.args.mode
    ).toBe(1);
    // A row carrying the other mode's credit evidence cannot be used as a claim.
    await db.query(
      "UPDATE mode_test.arena_credit SET last_event_id=$1 WHERE deployment=$2",
      [`8453:${contract}:${hash}:1`, arenaDeploymentId(contract, "anime", 2)]
    );
    await expect(
      readArenaCredit(reader, definition("anime"), wallet)
    ).rejects.toThrow(/tournament|mode/);
    await db.query(
      "UPDATE mode_test.canonical_event SET args=$1 WHERE log_index=0",
      [JSON.stringify({ id: "1", mode: 1 })]
    );
    await expect(
      readArenaTransaction(reader, definition("anime"), hash)
    ).rejects.toThrow(/mode/);
    expect(() => arenaEventKind({ id: 2n, mode: 0 })).toThrow(/inconsistent/);
  } finally {
    await database.close();
  }
});
