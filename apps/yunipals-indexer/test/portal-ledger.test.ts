import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { encodeEventTopics, parseAbi, type PublicClient } from "viem";
import {
  PortalLedgerStore,
  type PortalLedgerEvent
} from "../lib/portals/ledger-store.js";
import { PortalLedger } from "../lib/portals/ledger.js";
import { PortalChain } from "../lib/portals/chain.js";
import { registerPortalRoutes } from "../lib/portals/routes.js";
import type { PortalRuntime } from "../lib/portals/runtime.js";

const db = new PGlite();
const alice = `0x${"1".repeat(40)}` as const;
const bob = `0x${"2".repeat(40)}` as const;
const grading = `0x${"3".repeat(40)}` as const;
const collection = `0x${"4".repeat(40)}` as const;
const zero = `0x${"0".repeat(40)}` as const;
const hash = `0x${"a".repeat(64)}` as const;
const otherHash = `0x${"b".repeat(64)}` as const;
const store = new PortalLedgerStore(db as never, "ledger-test");
beforeAll(() => store.migrate());
beforeEach(() =>
  db.exec(
    "TRUNCATE portal_v2_ledger_event,portal_v2_ledger_cursor,portal_v2_token,portal_v3_competition_entry,portal_v3_competition_batch,portal_v3_competition_prize,portal_v5_request,portal_v5_mint,portal_v5_state"
  )
);
afterAll(() => db.close());

describe("competition initialization discovery", () => {
  function discovery(initialHead: bigint) {
    let head = initialHead;
    const client = {
      getBlockNumber: async () => head,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        number: blockNumber,
        hash
      }),
      getCode: async ({ blockNumber }: { blockNumber: bigint }) =>
        blockNumber < 20n ? undefined : "0x1234",
      readContract: vi.fn(
        async ({
          functionName,
          blockNumber
        }: {
          functionName: string;
          blockNumber: bigint;
        }) => {
          if (functionName === "competition")
            return blockNumber >= 30n ? alice : zero;
          expect(blockNumber).toBeGreaterThanOrEqual(20n);
          if (functionName === "BATCH_SIZE") return 111n;
          if (functionName === "CONTRIBUTION") return 500000n;
          throw new Error("Unexpected contract read");
        }
      ),
      getLogs: async ({
        address,
        fromBlock,
        toBlock
      }: {
        address: string[];
        fromBlock: bigint;
        toBlock: bigint;
      }) =>
        address.includes(alice) && fromBlock <= 20n && toBlock >= 20n
          ? [
              {
                address: alice,
                topics: encodeEventTopics({
                  abi: parseAbi([
                    "event ThemePublished(uint256 indexed batchId, bytes32 indexed themeHash, bytes32 sourcesHash)"
                  ]),
                  eventName: "ThemePublished",
                  args: { batchId: 1n, themeHash: hash }
                }),
                data: `0x${"0".repeat(64)}`,
                blockNumber: 20n,
                blockHash: hash,
                transactionHash: otherHash,
                transactionIndex: 0,
                logIndex: 0
              }
            ]
          : []
    };
    const chain = new PortalChain(client as unknown as PublicClient, {
      chainId: 8453,
      collection,
      grading,
      registry: grading,
      cards: grading,
      usdc: grading
    });
    return {
      chain,
      head: (value: bigint) => {
        head = value;
      }
    };
  }

  it("indexes the opening theme before its binding and skips reads before deployment", async () => {
    const { chain } = discovery(35n);
    const ledger = new PortalLedger(chain, store, 10n, 0n, 10n);
    await ledger.tick();
    expect((await store.cursor())?.block).toBe("19");
    await ledger.tick();
    const themes = await db.query<{
      value: { batchId: string; themeHash: string };
    }>("SELECT value FROM portal_v5_state WHERE component='theme'");
    expect(themes.rows).toEqual([
      {
        value: {
          batchId: "1",
          themeHash: hash,
          sourcesHash: `0x${"0".repeat(64)}`
        }
      }
    ]);
    expect(await store.requiresReplay()).toBe(false);
  });

  it("replays once when a late binding reveals earlier events and survives a restart", async () => {
    const fixture = discovery(24n);
    const ledger = new PortalLedger(fixture.chain, store, 10n, 0n, 10n);
    await ledger.tick();
    await ledger.tick();
    const before = (await store.cursor())!;
    expect(before.block).toBe("24");
    fixture.head(35n);
    await ledger.tick();
    const replay = (await store.cursor())!;
    expect(replay.block).toBe("19");
    expect(replay.competition).toBe(alice);
    expect(replay.generation).not.toBe(before.generation);
    const restarted = new PortalLedger(fixture.chain, store, 10n, 0n, 10n);
    await restarted.tick();
    await restarted.tick();
    expect(await store.cursor()).toMatchObject({
      block: "35",
      generation: replay.generation,
      competition: alice
    });
    expect(
      (
        await db.query(
          "SELECT * FROM portal_v2_ledger_event WHERE event_type='ThemePublished'"
        )
      ).rows
    ).toHaveLength(1);
  });

  it("requires replay for old cursors without a recorded competition source", async () => {
    await store.apply([], "24", hash, null);
    await db.exec("UPDATE portal_v2_ledger_cursor SET competition=NULL");
    expect(await store.requiresReplay()).toBe(true);
    const { chain } = discovery(35n);
    await new PortalLedger(chain, store, 10n, 0n, 10n).tick();
    expect(await store.cursor()).toMatchObject({
      block: "19",
      competition: alice
    });
    expect(await store.requiresReplay()).toBe(false);
  });
});

function event(
  type: string,
  args: Record<string, string>,
  index: number,
  tokenId = "1"
): PortalLedgerEvent {
  return {
    type,
    args,
    tokenId,
    block: "10",
    blockHash: hash,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: index,
    source: collection
  };
}
const mint = (id = "1", index = 0) =>
  event("Transfer", { from: zero, to: alice }, index, id);

describe("portal public ownership and backed balances", () => {
  it("replays mint, credit, transfer and atomic burn/claim without double-counting", async () => {
    const logs = [
      mint(),
      event("PortalMinted", { kindId: "1" }, 1),
      event(
        "PortalFeeAccrued",
        { requestId: "1", amount: "245000", newBalance: "245000" },
        2
      ),
      event("Transfer", { from: alice, to: bob }, 3)
    ];
    await store.apply(logs, "10", hash, null);
    expect(await store.totals("1")).toMatchObject({
      earned: "245000",
      claimed: "0"
    });
    expect(await store.holdings(alice, "10", "0", 25)).toEqual([]);
    expect(await store.holdings(bob, "10", "0", 25)).toEqual([
      { tokenId: "1" }
    ]);
    const cursor = await store.cursor();
    const burn = [
      event("Transfer", { from: bob, to: zero }, 4),
      event("PortalRetired", { kindId: "1", owner: bob, revision: "2" }, 5),
      event("PortalClaimed", { owner: bob, amount: "245000" }, 6)
    ];
    await store.apply(burn, "10", hash, cursor);
    expect(await store.totals("1")).toEqual({
      earned: "245000",
      claimed: "245000",
      claimant: bob
    });
    await store.apply([...logs, ...burn], "10", hash, await store.cursor());
    expect(await store.totals("1")).toEqual({
      earned: "245000",
      claimed: "245000",
      claimant: bob
    });
    expect(await store.holdings(bob, "10", "0", 25)).toEqual([]);
  });

  it("rolls back event/projection/cursor together on an unfunded or duplicate request credit", async () => {
    await expect(
      store.apply(
        [
          mint(),
          event(
            "PortalFeeAccrued",
            { requestId: "1", amount: "1", newBalance: "2" },
            1
          )
        ],
        "10",
        hash,
        null
      )
    ).rejects.toThrow("reconcile");
    expect(await store.cursor()).toBeNull();
    expect(await store.totals("1")).toBeNull();
    await store.apply(
      [
        mint(),
        event(
          "PortalFeeAccrued",
          { requestId: "1", amount: "1", newBalance: "1" },
          1
        )
      ],
      "10",
      hash,
      null
    );
    const cursor = await store.cursor();
    await expect(
      store.apply(
        [
          event(
            "PortalFeeAccrued",
            { requestId: "1", amount: "1", newBalance: "2" },
            2
          )
        ],
        "11",
        hash,
        cursor
      )
    ).rejects.toThrow();
    expect(await store.cursor()).toEqual(cursor);
    expect((await store.totals("1"))?.earned).toBe("1");
  });

  it("invalidates orphaned ownership/claims and page generation on reset", async () => {
    await store.apply(
      [
        mint(),
        event("Transfer", { from: alice, to: zero }, 1),
        event("PortalClaimed", { owner: alice, amount: "0" }, 2)
      ],
      "10",
      hash,
      null
    );
    const previous = (await store.cursor())!;
    await store.apply([], "9", otherHash, previous, true);
    expect(await store.totals("1")).toBeNull();
    expect((await store.cursor())?.generation).not.toBe(previous.generation);
    await store.apply([mint()], "10", otherHash, await store.cursor());
    expect(await store.holdings(alice, "10", "0", 25)).toHaveLength(1);
    await expect(store.apply([], "11", hash, previous)).rejects.toThrow(
      "cursor changed"
    );
  });

  it("keeps historical ownership pages stable after later transfers", async () => {
    await store.apply(
      [mint("1", 0), mint("2", 1), mint("3", 2)],
      "10",
      hash,
      null
    );
    const transfer = {
      ...event("Transfer", { from: alice, to: bob }, 0, "2"),
      block: "11",
      transactionHash: otherHash
    };
    await store.apply([transfer], "11", hash, await store.cursor());
    expect(await store.holdings(alice, "10", "1", 2)).toEqual([
      { tokenId: "2" },
      { tokenId: "3" }
    ]);
    expect(await store.holdings(alice, "11", "1", 2)).toEqual([
      { tokenId: "3" }
    ]);
  });
});

describe("portal ledger ingestion and API", () => {
  function chain() {
    const abi = parseAbi([
      "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"
    ]);
    const topics = encodeEventTopics({
      abi,
      eventName: "Transfer",
      args: { from: zero, to: alice, tokenId: 1n }
    });
    const client = {
      readContract: vi.fn().mockResolvedValue(zero),
      getBlockNumber: vi.fn().mockResolvedValue(10n),
      getBlock: vi
        .fn()
        .mockImplementation(
          async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
            number: blockNumber ?? 10n,
            hash,
            timestamp: 1000n
          })
        ),
      getLogs: vi.fn().mockResolvedValue([
        {
          address: collection,
          topics,
          data: "0x",
          blockNumber: 10n,
          blockHash: hash,
          transactionHash: hash,
          transactionIndex: 0,
          logIndex: 0
        }
      ])
    };
    const value = new PortalChain(client as unknown as PublicClient, {
      chainId: 8453,
      collection,
      grading,
      registry: grading,
      cards: grading,
      usdc: grading
    });
    vi.spyOn(value, "portalToken").mockImplementation(async (id) => ({
      id,
      kindId: 1n,
      name: "Rainbow Portal",
      imageURI: "ipfs://card",
      gates: {
        sequenceStart: 0,
        sequenceLength: 100,
        colorGate: 0,
        typeGate: 0,
        originalOnly: false,
        glitterGate: false,
        diamondGate: false
      },
      owner: alice,
      retired: false,
      claimable: 0n,
      active: false,
      slotEndsAt: 0n,
      asOfBlock: 10n,
      asOfBlockHash: hash
    }));
    return { value, client };
  }

  it("ingests canonical ERC721 events without AI dependencies and replays after a reorg", async () => {
    const { value, client } = chain();
    const ledger = new PortalLedger(value, store, 1n, 0n);
    await ledger.tick();
    expect(await store.holdings(alice, "10", "0", 25)).toHaveLength(1);
    const before = (await store.cursor())!;
    client.getBlock.mockResolvedValue({
      number: 10n,
      hash: otherHash,
      timestamp: 1000n
    });
    client.getLogs.mockResolvedValue([]);
    await ledger.tick();
    expect((await store.cursor())?.generation).not.toBe(before.generation);
    expect(await store.holdings(alice, "10", "0", 25)).toEqual([]);
  });

  it("rejects an orphaned log before publishing any ownership", async () => {
    const { value, client } = chain();
    client.getBlock.mockResolvedValue({
      number: 10n,
      hash: otherHash,
      timestamp: 1000n
    });
    await expect(new PortalLedger(value, store, 1n, 0n).tick()).rejects.toThrow(
      "changed during read"
    );
    expect(await store.cursor()).toBeNull();
  });

  it("serves paginated holdings and rejects cross-wallet/stale cursors and disabled routes", async () => {
    await store.apply([mint("1", 0), mint("2", 1)], "10", hash, null);
    const { value } = chain();
    const runtime = {
      chain: value,
      ledger: store,
      store: {},
      assets: {},
      close: async () => {}
    } as unknown as PortalRuntime;
    const app = new Hono();
    registerPortalRoutes(app, {
      enabled: () => true,
      runtime: async () => runtime
    });
    const first = await app.request(`/v1/portals/owners/${alice}?limit=1`);
    expect(first.status).toBe(200);
    const data = await first.json();
    expect(data.tokens.map((t: { id: string }) => t.id)).toEqual(["1"]);
    expect(data.nextCursor).toBeTruthy();
    expect(
      (
        await (
          await app.request(
            `/v1/portals/owners/${alice}?limit=1&cursor=${data.nextCursor}`
          )
        ).json()
      ).tokens[0].id
    ).toBe("2");
    expect(
      (await app.request(`/v1/portals/owners/${bob}?cursor=${data.nextCursor}`))
        .status
    ).toBe(409);
    await store.apply([], "9", hash, await store.cursor(), true);
    expect(
      (
        await app.request(
          `/v1/portals/owners/${alice}?cursor=${data.nextCursor}`
        )
      ).status
    ).toBe(409);
    const disabled = new Hono();
    registerPortalRoutes(disabled, {
      enabled: () => false,
      runtime: async () => runtime
    });
    expect((await disabled.request(`/v1/portals/owners/${alice}`)).status).toBe(
      503
    );
  });
});

describe("competition accounting replay", () => {
  function competitionEvents() {
    const events: PortalLedgerEvent[] = [];
    const add = (type: string, args: Record<string, string>) =>
      events.push(event(type, args, events.length, "0"));
    for (let id = 1; id <= 111; id++) {
      add("CompetitionEntered", {
        batchId: "1",
        entryId: String(id),
        requestId: String(id),
        submitter: alice,
        amount: "500000"
      });
    }
    for (let id = 111; id >= 1; id--) {
      add("CompetitionResult", {
        batchId: "1",
        entryId: String(id),
        requestId: String(id),
        score: "300"
      });
    }
    add("CompetitionReady", { batchId: "1" });
    add("CompetitionSettled", {
      batchId: "1",
      first: "1",
      second: "2",
      third: "3"
    });
    add("CompetitionPrizePaid", {
      batchId: "1",
      rank: "0",
      winner: alice,
      amount: "27750000"
    });
    return events;
  }
  it("rebuilds the pool, admission-order tiebreak and payouts atomically and idempotently", async () => {
    const logs = competitionEvents();
    await store.apply(logs, "10", hash, null);
    await store.apply(logs, "10", hash, await store.cursor());
    const batch = await db.query(
      "SELECT funded,completed,pool::text,winners FROM portal_v3_competition_batch"
    );
    expect(batch.rows).toEqual([
      {
        funded: 111,
        completed: 111,
        pool: "55500000",
        winners: ["1", "2", "3"]
      }
    ]);
    expect(
      (await db.query("SELECT amount::text FROM portal_v3_competition_prize"))
        .rows
    ).toEqual([{ amount: "27750000" }]);
    await store.apply([], "9", otherHash, await store.cursor(), true);
    expect(
      (await db.query("SELECT * FROM portal_v3_competition_batch")).rows
    ).toEqual([]);
    await store.apply(logs, "10", hash, await store.cursor());
    expect(
      (await db.query("SELECT * FROM portal_v3_competition_entry")).rows
    ).toHaveLength(111);
  });
  it("rejects incorrect winners and rolls back the whole indexed range", async () => {
    const logs = competitionEvents();
    logs.find((log) => log.type === "CompetitionSettled")!.args.first = "111";
    await expect(store.apply(logs, "10", hash, null)).rejects.toThrow(
      "winners"
    );
    expect(await store.cursor()).toBeNull();
    expect(
      (await db.query("SELECT * FROM portal_v3_competition_entry")).rows
    ).toEqual([]);
  });
  it("rejects payouts that differ from the recorded winner or exact share", async () => {
    const logs = competitionEvents();
    logs.at(-1)!.args.amount = "1";
    await expect(store.apply(logs, "10", hash, null)).rejects.toThrow("payout");
    expect(await store.cursor()).toBeNull();
  });
  it("reconciles an isolated eleven-entry challenge and allocates entry twelve to the next batch", async () => {
    const logs: PortalLedgerEvent[] = [];
    const add = (type: string, args: Record<string, string>) =>
      logs.push(event(type, args, logs.length, "0"));
    for (let id = 1; id <= 12; id++) {
      add("CompetitionEntered", {
        batchId: id <= 11 ? "1" : "2",
        entryId: String(id),
        requestId: String(id),
        submitter: alice,
        amount: "500000"
      });
    }
    for (let id = 12; id >= 1; id--) {
      add("CompetitionResult", {
        batchId: id <= 11 ? "1" : "2",
        entryId: String(id),
        requestId: String(id),
        score: "300"
      });
    }
    add("CompetitionReady", { batchId: "1" });
    add("CompetitionSettled", {
      batchId: "1",
      first: "1",
      second: "2",
      third: "3"
    });
    for (const [rank, amount] of ["2750000", "1650000", "1100000"].entries()) {
      add("CompetitionPrizePaid", {
        batchId: "1",
        rank: String(rank),
        winner: alice,
        amount
      });
    }
    const rules = { batchSize: 11n, contribution: 500000n };
    await store.apply(logs, "10", hash, null, false, rules);
    await store.apply(logs, "10", hash, await store.cursor(), false, rules);
    expect(
      (
        await db.query(
          "SELECT batch_id::text,funded,completed,pool::text,ready,winners FROM portal_v3_competition_batch ORDER BY batch_id"
        )
      ).rows
    ).toEqual([
      {
        batch_id: "1",
        funded: 11,
        completed: 11,
        pool: "5500000",
        ready: true,
        winners: ["1", "2", "3"]
      },
      {
        batch_id: "2",
        funded: 1,
        completed: 1,
        pool: "500000",
        ready: false,
        winners: null
      }
    ]);
    expect(
      (
        await db.query(
          "SELECT amount::text FROM portal_v3_competition_prize ORDER BY rank"
        )
      ).rows
    ).toEqual([
      { amount: "2750000" },
      { amount: "1650000" },
      { amount: "1100000" }
    ]);
    await store.apply([], "9", otherHash, await store.cursor(), true, rules);
    await expect(
      store.apply(logs, "10", hash, await store.cursor())
    ).rejects.toThrow("allocation");
  });
});
