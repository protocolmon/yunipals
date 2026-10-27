import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  zeroAddress,
  type Hex
} from "viem";
import {
  seaportOrderHash,
  type SeaportOrderComponents
} from "@protopals/yunipals-market-core/seaport";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { encodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import type { IndexerReader } from "@protopals/yunipals-indexer-server/readers";
import { BnbRecoveryService } from "@/bnb/recovery";
import {
  readDiscoveredBnbOrderPoint,
  type DiscoveredBnbOrderPoint
} from "./bnbOrderProcessing";
import type { BnbDiscoveryQualification } from "./bnbDiscoveryRead";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const maker = `0x${"12".repeat(20)}` as const;
const collection = marketplaceChains.bnb.contractAddress;
const protocol = seaportDeployment.address.toLowerCase();
const now = 1_800_000_000_000;
const components: SeaportOrderComponents = {
  offerer: maker,
  zone: zeroAddress,
  offer: [
    {
      itemType: 2,
      token: collection,
      identifierOrCriteria: 1n,
      startAmount: 1n,
      endAmount: 1n
    }
  ],
  consideration: [
    {
      itemType: 0,
      token: zeroAddress,
      identifierOrCriteria: 0n,
      startAmount: 100n,
      endAmount: 100n,
      recipient: maker
    }
  ],
  orderType: 0,
  startTime: 1n,
  endTime: 10000n,
  zoneHash: hash(0),
  salt: 1n,
  conduitKey: hash(0),
  counter: 0n
};
const orderHash = seaportOrderHash(components);
const publicationTx = hash(10),
  publicationHash = hash(11),
  observationHash = hash(12);
function fixture() {
  const { counter: _counter, ...parameters } = components;
  const event = getAbiItem({ abi: seaportEventAbi, name: "OrderValidated" });
  const id = `56:${protocol}:${publicationTx}:0`;
  const row: DiscoveredBnbOrderPoint = {
    order_hash: orderHash,
    maker,
    contract_address: collection.toLowerCase(),
    token_id: "1",
    bound_lifecycle: 2,
    published_counter: "0",
    published_components: encodeSeaportOrder(components),
    publication_block: "100",
    publication_hash: publicationHash,
    publication_tx: publicationTx,
    publication_transaction_index: 0,
    publication_log_index: 0,
    publication_time: "1000",
    state: "cancelled",
    state_block: "250",
    state_hash: observationHash,
    state_observed_at: new Date(now - 1000),
    summary: {
      asset: {
        chain: "bnb",
        chainId: 56,
        contractAddress: collection,
        tokenId: "1"
      },
      lifecycle: 2,
      orderHash,
      protocolAddress: seaportDeployment.address,
      source: "yunipals",
      side: "listing",
      maker,
      currency: { address: zeroAddress, symbol: "BNB", decimals: 18 },
      grossAmount: "100",
      sellerProceeds: "100",
      fees: [],
      startTime: "1",
      endTime: "10000",
      status: "unavailable"
    }
  };
  const release = {
    id: hash(1),
    schema: "source_physical",
    buildId: "native-build",
    manifestHash: hash(3),
    manifest: {
      version: 1,
      sources: [
        {
          id: "ownership:bnb",
          enabled: true,
          feature: "ownership",
          chainId: 56,
          address: collection.toLowerCase(),
          abiHash: manifestDigest(collectionAbi),
          policies: [{ kind: "depth", subsequentBlocks: 20 }]
        }
      ]
    }
  };
  const source = {
    id: "marketplace:bnb:seaport",
    abiHash: manifestDigest(seaportEventAbi)
  };
  const state = {
    selected: { mode: "live", reader_mode: "unified" },
    rows: [row],
    fenceBefore: {
      registration: {
        created_at: "2026-10-21T00:00:00Z",
        generation: "7",
        configuration_hash: hash(20)
      },
      cursor: { completed: { number: "300", hash: hash(30) } }
    },
    fenceAfter: null as unknown,
    marker: {
      identity: hash(2),
      release_id: release.id,
      manifest_hash: release.manifestHash,
      definitions: [
        {
          collection: "bnb",
          sourceId: "ownership:bnb",
          policy: { kind: "depth", subsequentBlocks: 20 }
        }
      ]
    },
    ownershipStatus: [
      {
        collection: "bnb",
        source_id: "ownership:bnb",
        release_id: release.id,
        manifest_hash: release.manifestHash,
        policy: "depth:20",
        ready: true,
        block_number: "350"
      }
    ],
    tokens: [
      {
        owner: maker as string,
        lifecycle: 2,
        burned: false,
        last_transfer_block: "100",
        last_transaction_hash: hash(60),
        mint_block: "50",
        mint_timestamp: "500",
        lifecycle_mint_block: "50",
        lifecycle_mint_timestamp: "500",
        transfer_to: maker as string,
        transfer_lifecycle: 2,
        transfer_abi_hash: manifestDigest(collectionAbi),
        transfer_block_hash: hash(61) as string | null,
        mint_block_hash: hash(62) as string | null
      }
    ],
    provenanceFailure: false,
    events: [
      {
        id,
        source_id: source.id,
        chain_id: 56,
        address: protocol,
        abi_hash: source.abiHash,
        name: "OrderValidated",
        block_number: "100",
        block_hash: publicationHash,
        transaction_hash: publicationTx,
        transaction_index: 0,
        log_index: 0,
        timestamp: "1000",
        topics: JSON.stringify(
          encodeEventTopics({
            abi: seaportEventAbi,
            eventName: "OrderValidated"
          })
        ),
        data: encodeAbiParameters(event.inputs, [
          orderHash,
          { ...parameters, totalOriginalConsiderationItems: 1n }
        ])
      }
    ],
    witnesses: [{ block_hash: observationHash }],
    retained: [] as {
      block_hash: string;
      witness_hash: string;
      canonical_witness: string | null;
    }[],
    available: 400n,
    sourceReason: "catching_up",
    sourceFailure: false,
    snapshotCalls: 0,
    changedOnSecondSnapshot: false,
    native: true,
    qualified: true
  };
  const calls: { scope: string; sql: string; params?: unknown[] }[] = [];
  let marketConnection = false;
  const marketQuery = async (sql: string, params?: unknown[]) => {
    calls.push({
      scope: marketConnection ? "market-rr" : "market-fresh",
      sql,
      params
    });
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.startsWith("SELECT mode")) return { rows: [state.selected] };
    if (sql.startsWith("SELECT summary")) return { rows: state.rows };
    if (sql.includes("jsonb_build_object"))
      return {
        rows: [
          {
            value: marketConnection
              ? state.fenceBefore
              : (state.fenceAfter ?? state.fenceBefore)
          }
        ]
      };
    throw new Error("Unexpected market query");
  };
  const sourceQuery = async (sql: string, params?: unknown[]) => {
    calls.push({ scope: "source", sql, params });
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql))
      return { rows: [] };
    if (sql.includes("_unified_read_release")) return { rows: [state.marker] };
    if (sql.includes('"selected_read".source_status'))
      return { rows: state.ownershipStatus };
    if (sql.includes('FROM "selected_read".token t'))
      return { rows: state.tokens };
    if (sql.includes("canonical_event")) return { rows: state.events };
    if (sql.includes("chain_anchor")) return { rows: state.retained };
    if (sql.includes("chain_block")) return { rows: state.witnesses };
    throw new Error("Unexpected source query");
  };
  const pageCalls: unknown[][] = [];
  const reader = {
    release,
    page: async (...args: unknown[]) => {
      pageCalls.push(args);
      return {};
    },
    snapshot: async (
      _id: string,
      _policy: unknown,
      callback: (db: unknown, context: unknown) => Promise<unknown>
    ) => {
      state.snapshotCalls++;
      if (state.sourceFailure)
        throw new Error("private provider configuration");
      if (state.changedOnSecondSnapshot && state.snapshotCalls === 2)
        state.witnesses = [{ block_hash: hash(99) }];
      return callback(
        { query: sourceQuery },
        {
          release,
          status: {
            source,
            anchor: { number: "400", hash: hash(40) },
            errorCode: null,
            readiness: {
              reason: state.sourceReason,
              availableThroughBlock: state.available
            }
          }
        }
      );
    }
  } as unknown as IndexerReader;
  const qualification: BnbDiscoveryQualification = {
    reader,
    readSchema: "selected_read",
    configurationHash: hash(20),
    policyFingerprint: hash(21),
    epoch: "2026-10-21T00:00:00.000Z",
    generation: "7",
    completed: { number: "300", hash: hash(30) },
    cursor: {
      version: 1,
      releaseId: release.id,
      sourceId: source.id,
      policy: "finalized",
      completed: { number: "300", hash: hash(30) },
      target: null,
      after: null
    }
  };
  let binds = 0,
    connections = 0,
    releases = 0;
  const pool = {
    query: marketQuery,
    connect: async () => {
      connections++;
      marketConnection = true;
      return {
        query: marketQuery,
        release: () => {
          releases++;
          marketConnection = false;
        }
      } as unknown as PoolClient;
    }
  } as unknown as Pool;
  const readBinding = async () => {
    binds++;
    return {
      native: state.native,
      ready: false,
      ...(state.qualified ? { qualification } : {})
    };
  };
  const read = () =>
    readDiscoveredBnbOrderPoint(pool, orderHash, {
      now: () => now,
      readBinding,
      checkOwnershipProvenance: async () => {
        if (state.provenanceFailure)
          throw new Error("private relation missing");
      }
    });
  return {
    row,
    state,
    qualification,
    calls,
    pageCalls,
    pool,
    read,
    counters: () => ({ binds, connections, releases })
  };
}

test("qualified point proof preserves an older publication and complete cursor while later work catches up", async () => {
  const f = fixture(),
    result = await f.read(),
    p = result.processing!;
  assert.equal(p.state, "qualified");
  assert.equal(p.reason, "publication_processed");
  assert.equal(p.publication?.blockNumber, "100");
  assert.equal(p.publication?.transactionHash, publicationTx);
  assert.equal(p.completed?.number, "300");
  assert.equal(p.consumer?.generation, "7");
  assert.equal(p.consumer?.epoch, "2026-10-21T00:00:00.000Z");
  assert.equal(p.source?.readIdentity, hash(2));
  assert.equal(p.observation?.blockNumber, "250");
  assert.equal(p.order?.status, "cancelled");
  assert.equal(p.order?.bindingCurrent, true);
  assert.equal(p.observationReason, null);
  assert.deepEqual(f.counters(), { binds: 1, connections: 1, releases: 1 });
  assert.equal(
    f.calls[0]?.sql,
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
  );
  assert.equal(f.state.snapshotCalls, 2);
  assert.equal(f.pageCalls.length, 1);
  assert(
    f.calls.every(
      (call) => !/\b(INSERT|UPDATE|DELETE|GRANT|CREATE)\b/.test(call.sql)
    )
  );
  assert(!JSON.stringify(p).includes("parameters"));
});

test("legacy and preview lookups retain their existing order result without a processing claim", async () => {
  for (const selected of [
    { mode: "live", reader_mode: "legacy" },
    { mode: "preview", reader_mode: "unified" }
  ]) {
    const f = fixture();
    f.state.selected = selected;
    const result = await f.read();
    assert.equal(result.row, f.row);
    assert.equal(result.processing, undefined);
    assert.equal(f.counters().binds, 0);
    assert.equal(f.state.snapshotCalls, 0);
  }
  const f = fixture();
  f.state.selected.reader_mode = "legacy";
  const result = await new BnbRecoveryService(f.pool, () => now).accepted(
    orderHash
  );
  assert.equal(result.persisted, true);
  assert.equal(result.order.status, "cancelled");
  assert(!("processing" in result));
});

test("absent order, absent qualification and source failure never become processed", async () => {
  const absent = fixture();
  absent.state.rows = [];
  assert.equal((await absent.read()).row, null);
  const pending = fixture();
  pending.state.qualified = false;
  assert.equal((await pending.read()).processing?.state, "pending");
  const failed = fixture();
  failed.state.sourceFailure = true;
  const value = await failed.read();
  assert.equal(value.processing?.state, "unavailable");
  assert(!JSON.stringify(value.processing).includes("private provider"));
});

test("registration generation, epoch, cursor and order changes invalidate the saved point", async () => {
  for (const key of [
    "generation",
    "created_at",
    "configuration_hash",
    "cursor",
    "order"
  ]) {
    const f = fixture();
    const changed = structuredClone(f.state.fenceBefore) as Record<
      string,
      unknown
    >;
    if (
      key === "generation" ||
      key === "created_at" ||
      key === "configuration_hash"
    )
      Object.assign(changed.registration as object, {
        [key]: key === "generation" ? "8" : "changed"
      });
    else changed[key] = "changed";
    f.state.fenceAfter = changed;
    const value = await f.read();
    assert.equal(value.processing?.state, "unavailable");
    assert.equal(value.processing?.reason, "state_changed");
    assert.equal(value.processing?.completed, null);
  }
});

test("source identity, publication branch and missing publication history fail closed", async () => {
  for (const change of [
    "identity",
    "publicationHash",
    "tx",
    "index",
    "history",
    "complete",
    "source"
  ]) {
    const f = fixture();
    if (change === "identity") f.state.marker.release_id = hash(99);
    else if (change === "publicationHash")
      f.state.events[0]!.block_hash = hash(99);
    else if (change === "tx") f.state.events[0]!.transaction_hash = hash(99);
    else if (change === "index") f.state.events[0]!.log_index = 1;
    else if (change === "history") f.state.events = [];
    else if (change === "complete") f.state.available = 299n;
    else f.state.sourceReason = "halted";
    const p = (await f.read()).processing!;
    assert.equal(p.state, "unavailable");
    assert.equal(p.source, null);
  }
});

test("counter/components/summary/lifecycle must identify the exact canonical published order", async () => {
  for (const change of ["counter", "components", "summary", "lifecycle"]) {
    const f = fixture();
    if (change === "counter") f.row.published_counter = "99";
    else if (change === "components")
      f.row.published_components = { invalid: true };
    else if (change === "summary")
      f.row.summary = { ...f.row.summary, orderHash: hash(99) };
    else f.row.bound_lifecycle = 3;
    const p = (await f.read()).processing!;
    assert.equal(p.state, "unavailable");
    assert.equal(p.reason, "order_binding_invalid");
  }
});

test("cancellation observation is independently absent for stale, future, uncovered and noncanonical state", async () => {
  for (const change of [
    "stale",
    "future",
    "uncovered",
    "mismatch",
    "missing"
  ]) {
    const f = fixture();
    if (change === "stale") f.row.state_observed_at = new Date(now - 720001);
    else if (change === "future")
      f.row.state_observed_at = new Date(now + 30001);
    else if (change === "uncovered") f.row.state_block = "401";
    else if (change === "mismatch")
      f.state.witnesses = [{ block_hash: hash(99) }];
    else f.state.witnesses = [];
    const p = (await f.read()).processing!;
    assert.equal(p.state, "qualified");
    assert.equal(p.observation, null);
    assert.notEqual(p.observationReason, null);
  }
});

test("a retained observation anchor requires its current canonical witness", async () => {
  const good = fixture();
  good.state.witnesses = [];
  good.state.retained = [
    {
      block_hash: observationHash,
      witness_hash: hash(40),
      canonical_witness: hash(40)
    }
  ];
  assert.equal(
    (await good.read()).processing?.observation?.blockHash,
    observationHash
  );
  const bad = fixture();
  bad.state.witnesses = [];
  bad.state.retained = [
    {
      block_hash: observationHash,
      witness_hash: hash(40),
      canonical_witness: hash(99)
    }
  ];
  assert.equal((await bad.read()).processing?.observation, null);
});

test("fresh source recheck also checks an observation newer than the discovery completed cursor", async () => {
  const f = fixture();
  f.row.state_block = "350";
  f.state.changedOnSecondSnapshot = true;
  const value = await f.read();
  assert.equal(value.processing?.state, "qualified");
  assert.equal(value.processing?.observation, null);
  assert.equal(value.processing?.observationReason, "canonical_mismatch");
});

test("new public processing proof does not alter legacy-compatible accepted order semantics when evidence is unavailable", async () => {
  const f = fixture();
  const response = await new BnbRecoveryService(f.pool, () => now).accepted(
    orderHash
  );
  assert.equal(response.schemaVersion, 1);
  assert.equal(response.persisted, true);
  assert.equal(response.order.status, "cancelled");
  assert.equal(response.processing?.state, "unavailable");
});

test("current ownership independently rejects a superseded lifecycle, owner or burned token", async () => {
  for (const change of ["lifecycle", "owner", "burned"]) {
    const f = fixture();
    const token = f.state.tokens[0]!;
    if (change === "lifecycle") token.lifecycle = token.transfer_lifecycle = 3;
    else if (change === "owner")
      token.owner = token.transfer_to = `0x${"34".repeat(20)}`;
    else {
      token.burned = true;
      token.owner = token.transfer_to = zeroAddress;
    }
    const p = (await f.read()).processing!;
    assert.equal(p.state, "qualified");
    assert.equal(p.order?.bindingCurrent, false);
    assert.equal(p.observationReason, null);
    assert.equal(p.observation?.blockHash, observationHash);
  }
});

test("missing ownership readiness, history or provenance cannot complete validation or erase cancellation proof", async () => {
  for (const change of [
    "marker",
    "status",
    "policy",
    "release",
    "behind",
    "token",
    "transfer",
    "mint",
    "futureTransfer",
    "provenance"
  ]) {
    const f = fixture();
    if (change === "marker") f.state.marker.definitions = [];
    else if (change === "status") f.state.ownershipStatus[0]!.ready = false;
    else if (change === "policy") f.state.ownershipStatus[0]!.policy = "latest";
    else if (change === "release")
      f.state.ownershipStatus[0]!.release_id = hash(99);
    else if (change === "behind")
      f.state.ownershipStatus[0]!.block_number = "299";
    else if (change === "token") f.state.tokens = [];
    else if (change === "transfer")
      f.state.tokens[0]!.transfer_block_hash = null;
    else if (change === "mint") f.state.tokens[0]!.mint_block_hash = null;
    else if (change === "futureTransfer") {
      f.state.tokens[0]!.last_transfer_block = "401";
      f.state.ownershipStatus[0]!.block_number = "450";
    } else f.state.provenanceFailure = true;
    const p = (await f.read()).processing!;
    assert.equal(p.state, "qualified", change);
    assert.equal(p.order?.bindingCurrent, null, change);
    assert.equal(p.observationReason, null, change);
    assert.equal(p.observation?.blockHash, observationHash, change);
    if (change === "provenance")
      assert(
        f.calls.some(
          (call) =>
            call.sql === "ROLLBACK TO SAVEPOINT bnb_processing_ownership"
        )
      );
  }
});

test("a ready ownership boundary may be ahead of finality when this token's proven transfer is finalized", async () => {
  const f = fixture();
  f.state.ownershipStatus[0]!.block_number = "450";
  assert.equal((await f.read()).processing?.order?.bindingCurrent, true);
});
