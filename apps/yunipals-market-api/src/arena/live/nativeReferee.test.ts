import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import pg from "pg";
import type { Address, Hex } from "viem";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { migrateArena } from "./schema";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { NativeArenaProvider } from "./nativeProvider";
import { NativeArenaReferee } from "./nativeReferee";
import { ArenaRefereeApi, refereeRequest } from "./refereeApi";
import {
  ArenaAdjudicator,
  productionValidator,
  refereeSchema
} from "./adjudication";
import type { NativeArenaObservation } from "./nativeSource";

async function fixture(legacyContext = false) {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  assert.ok(["/arena", "/yunipals_arena_test"].includes(parsed.pathname));
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  await migrateArena(pool);
  const hash = () => `0x${randomBytes(32).toString("hex")}` as Hex;
  const address = () => `0x${randomBytes(20).toString("hex")}` as Address;
  const contract = address(),
    deployment = `8453:${contract}`,
    releaseId = hash();
  const root = resolve("../..");
  const input = JSON.parse(
    await readFile(resolve("src/arena/live/fixtures/pilot-input.json"), "utf8")
  );
  const candidate = JSON.parse(
    await readFile(
      resolve("src/arena/live/fixtures/pilot-outcome.json"),
      "utf8"
    )
  );
  const inputHash = `0x${sha256(canonicalJson(input))}` as Hex;
  const cipher = new StrategyCipher(randomBytes(32));
  let openingHash = hash(),
    freezeHash = hash(),
    unavailable = false;
  let onVerify: (() => void) | undefined, onFunding: (() => void) | undefined;
  let verificationFailure = false,
    fundingFailure = false;
  let posts = 0,
    gets = 0,
    verifies = 0,
    funding = 0,
    polls = 0;
  let responseState = "queued",
    losePost = false;
  let validateHook: (() => void) | undefined;
  const state: ArenaTournament = {
    id: "1",
    phase: "resolving",
    deadline: Math.floor(Date.now() / 1000) + 3600,
    rulesHash: hash(),
    poolHash: hash(),
    treasury: address(),
    islandId: "17",
    islandBeneficiary: address(),
    requestId: "1",
    randomWord: "42",
    ticket: 42,
    seats: Array.from({ length: 4 }, (_, seat) => ({
      seat,
      player: address(),
      nftChainId: 8453,
      collection: "0x98433df878e8c898cb907345c3a7756e5f72240f",
      tokenId: String(seat + 1)
    })),
    inputHash,
    commitments: [hash(), hash(), hash(), hash()],
    resultHash: null,
    winners: null,
    videoHash: null
  };
  const openingTx = hash(),
    freezeTx = hash();
  function observe(): NativeArenaObservation & {
    tournament: NonNullable<NativeArenaObservation["tournament"]>;
  } {
    const opened = {
      id: `${deployment}:${openingTx}:0`,
      transactionHash: openingTx,
      blockNumber: "1",
      blockHash: openingHash,
      logIndex: 0
    };
    const frozen = {
      id: `${deployment}:${freezeTx}:0`,
      transactionHash: freezeTx,
      blockNumber: "2",
      blockHash: freezeHash,
      logIndex: 0
    };
    return {
      releaseId,
      sourceId: `arena:${deployment}`,
      indexedThroughBlock: "10",
      observedThroughBlock: "10",
      tournament: {
        deployment,
        id: "1",
        state: structuredClone(state),
        opened,
        last: frozen,
        inputFrozen: frozen,
        incarnation: manifestDigest({
          deployment,
          tournamentId: "1",
          openedEventId: opened.id,
          openedBlockHash: opened.blockHash
        })
      }
    };
  }
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
    [deployment, contract]
  );
  const service = new ArenaIntake(
    pool,
    deployment,
    contract,
    "https://www.yunipals.com",
    cipher,
    { message: async () => true, strategy: async () => true },
    {
      read: async (id) => {
        if (unavailable) throw new Error("Native source unavailable.");
        return id === "0" ? { ...observe(), tournament: null } : observe();
      },
      work: async () => {
        if (unavailable) throw new Error("Native source unavailable.");
        polls++;
        return { ...observe(), ids: ["1"] };
      }
    }
  );
  async function seed(legacy = false) {
    const observed = observe();
    if (legacy) {
      await pool.query(
        `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)
        VALUES($1,1,$2,$3,$4,$5,now(),$6)`,
        [
          deployment,
          observed.tournament.incarnation,
          observed.tournament.opened.id,
          openingHash,
          releaseId,
          `${deployment}/1`
        ]
      );
    }
    const context = await transaction(pool, (db) =>
      service.tournamentContext("1", db, true)
    );
    await pool.query(
      `INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,incarnation,input_hash,ciphertext,revealed_at,revealed_event_id,revealed_block_hash)
      VALUES($1,1,$2,$3,$4,now(),$5,$6) ON CONFLICT DO NOTHING`,
      [
        deployment,
        context.incarnation,
        inputHash,
        cipher.seal(`${context.cipherContext}/input`, { input }),
        observed.tournament.inputFrozen!.id,
        freezeHash
      ]
    );
    return context;
  }
  const first = await seed(legacyContext);
  const guard = new NativeArenaProvider(
    service,
    async () => {
      verifies++;
      onVerify?.();
      onVerify = undefined;
      if (verificationFailure)
        throw new Error("Point verification unavailable.");
    },
    async () => {
      funding++;
      onFunding?.();
      onFunding = undefined;
      if (fundingFailure) throw new Error("Funding unavailable.");
    }
  );
  const fetcher = (async (_url, options) => {
    let requestId: string;
    if (options?.method === "POST") {
      posts++;
      if (losePost) throw new Error("Lost POST response.");
      requestId = `resp_${posts}`;
    } else {
      gets++;
      requestId = String(_url).split("/").at(-1)!;
    }
    return new Response(
      JSON.stringify({
        id: requestId,
        status: responseState,
        ...(responseState === "completed"
          ? {
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: JSON.stringify(candidate) }
                  ]
                }
              ]
            }
          : {})
      })
    );
  }) as typeof fetch;
  const api = new ArenaRefereeApi(pool, "test-only-not-a-key", fetcher, guard);
  const validator = productionValidator(root);
  const adjudicator = new ArenaAdjudicator(
    pool,
    cipher,
    api,
    refereeSchema(root),
    async (frozen, result) => {
      const report = await validator(frozen, result);
      validateHook?.();
      validateHook = undefined;
      return report;
    }
  );
  const worker = new NativeArenaReferee(service, api, adjudicator);
  const request = () =>
    refereeRequest(
      "Pinned rules",
      { sourceInputSha256: inputHash.slice(2) },
      { type: "object" }
    );
  const due = () =>
    pool.query(
      "UPDATE yunipals_arena.provider_task SET native_check_at=now() WHERE deployment=$1",
      [deployment]
    );
  const close = async () => {
    await pool.query(
      "DELETE FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
      [deployment]
    );
    for (const table of [
      "adjudication",
      "provider_task",
      "frozen_input",
      "tournament_identity",
      "deployment"
    ])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE ${table === "deployment" ? "id" : "deployment"}=$1`,
        [deployment]
      );
    await pool.end();
  };
  return {
    pool,
    service,
    api,
    adjudicator,
    worker,
    deployment,
    first,
    request,
    guard,
    observe,
    seed,
    due,
    close,
    hash,
    state,
    candidate,
    fork: () => {
      openingHash = hash();
    },
    reincludedFreeze: () => {
      freezeHash = hash();
    },
    get freezeHash() {
      return freezeHash;
    },
    set unavailable(value: boolean) {
      unavailable = value;
    },
    set losePost(value: boolean) {
      losePost = value;
    },
    set responseState(value: string) {
      responseState = value;
    },
    set onVerify(value: (() => void) | undefined) {
      onVerify = value;
    },
    set onFunding(value: (() => void) | undefined) {
      onFunding = value;
    },
    set validateHook(value: (() => void) | undefined) {
      validateHook = value;
    },
    set verificationFailure(value: boolean) {
      verificationFailure = value;
    },
    set fundingFailure(value: boolean) {
      fundingFailure = value;
    },
    counts: () => ({ posts, gets, verifies, funding, polls })
  };
}

test("native referee claims one paid request across workers, resumes its response and records its action proof", async () => {
  const f = await fixture();
  try {
    await f.api.reserve(
      f.deployment,
      "1",
      f.request(),
      1600000,
      f.first.incarnation
    );
    await Promise.all([
      f.api.step(f.deployment, "1", f.first.incarnation),
      f.api.step(f.deployment, "1", f.first.incarnation)
    ]);
    assert.equal(f.counts().posts, 1);
    const proof = (
      await f.pool.query(
        "SELECT evidence FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
        [f.deployment]
      )
    ).rows[0].evidence;
    assert.equal(proof.incarnation, f.first.incarnation);
    assert.equal(proof.frozenBlockHash, f.freezeHash);
    f.responseState = "completed";
    const result = await f.api.step(f.deployment, "1", f.first.incarnation);
    assert.equal(result.state, "completed");
    assert.equal(f.counts().posts, 1);
  } finally {
    await f.close();
  }
});

test("orphaned response retrieval retains spending and cannot become a replacement opening's result", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.adjudicator.step(f.deployment, "1")).state, "queued");
    f.fork();
    const second = await f.seed();
    f.responseState = "completed";
    f.unavailable = true;
    assert.equal(
      (await f.api.step(f.deployment, "1", f.first.incarnation)).state,
      "completed"
    );
    assert.equal(f.counts().gets, 1);
    await assert.rejects(
      f.adjudicator.step(f.deployment, "1", 1600000, f.first.incarnation),
      /source unavailable/
    );
    f.unavailable = false;
    await assert.rejects(
      f.adjudicator.step(f.deployment, "1", 1600000, f.first.incarnation),
      /opening changed/
    );
    assert.equal(
      (await f.adjudicator.step(f.deployment, "1", 1600000, second.incarnation))
        .state,
      "valid"
    );
    const rows = await f.pool.query(
      "SELECT incarnation FROM yunipals_arena.adjudication WHERE deployment=$1",
      [f.deployment]
    );
    assert.deepEqual(rows.rows, [{ incarnation: second.incarnation }]);
    assert.equal(
      (
        await f.pool.query(
          "SELECT sum(reserved_microusd)::text AS total FROM yunipals_arena.provider_task WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].total,
      "1400000"
    );
    assert.equal(f.counts().posts, 2);
  } finally {
    await f.close();
  }
});

test("source, funding and point-check failures block new native submissions", async () => {
  const f = await fixture();
  try {
    await f.api.reserve(
      f.deployment,
      "1",
      f.request(),
      1600000,
      f.first.incarnation
    );
    f.unavailable = true;
    await assert.rejects(
      f.api.step(f.deployment, "1", f.first.incarnation),
      /source unavailable/
    );
    f.unavailable = false;
    f.fundingFailure = true;
    await assert.rejects(
      f.api.step(f.deployment, "1", f.first.incarnation),
      /Funding unavailable/
    );
    f.fundingFailure = false;
    f.verificationFailure = true;
    await assert.rejects(
      f.api.step(f.deployment, "1", f.first.incarnation),
      /Point verification/
    );
    f.verificationFailure = false;
    f.onVerify = f.fork;
    await assert.rejects(
      f.api.step(f.deployment, "1", f.first.incarnation),
      /opening changed/
    );
    assert.equal(f.counts().posts, 0);
    assert.equal(
      (
        await f.pool.query(
          "SELECT state FROM yunipals_arena.provider_task WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].state,
      "reserved"
    );
  } finally {
    await f.close();
  }
});

test("ambiguous native POST never buys a replacement candidate", async () => {
  const f = await fixture();
  try {
    await f.api.reserve(
      f.deployment,
      "1",
      f.request(),
      1600000,
      f.first.incarnation
    );
    f.losePost = true;
    await assert.rejects(
      f.api.step(f.deployment, "1", f.first.incarnation),
      /Automatic replacement is blocked/
    );
    assert.equal(
      (await f.api.step(f.deployment, "1", f.first.incarnation)).state,
      "uncertain"
    );
    await f.worker.tick();
    assert.equal(f.counts().posts, 1);
    assert.equal(f.counts().gets, 0);
  } finally {
    await f.close();
  }
});

test("freeze re-inclusion requires fresh disclosure before a reserved task can be submitted", async () => {
  const f = await fixture();
  try {
    await f.api.reserve(
      f.deployment,
      "1",
      f.request(),
      1600000,
      f.first.incarnation
    );
    f.reincludedFreeze();
    await assert.rejects(
      f.api.step(f.deployment, "1", f.first.incarnation),
      /disclosure proof/
    );
    await f.pool.query(
      "UPDATE yunipals_arena.frozen_input SET revealed_block_hash=$2 WHERE deployment=$1",
      [f.deployment, f.freezeHash]
    );
    await f.api.step(f.deployment, "1", f.first.incarnation);
    assert.equal(f.counts().posts, 1);
    const proof = (
      await f.pool.query(
        "SELECT evidence FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
        [f.deployment]
      )
    ).rows[0].evidence;
    assert.equal(proof.frozenBlockHash, f.freezeHash);
  } finally {
    await f.close();
  }
});

test("native adjudication rechecks its origin after validation and retains the completed provider response", async () => {
  const f = await fixture();
  try {
    f.responseState = "completed";
    f.validateHook = f.fork;
    await assert.rejects(
      f.adjudicator.step(f.deployment, "1"),
      /opening changed/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.adjudication WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT state FROM yunipals_arena.provider_task WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].state,
      "completed"
    );
    assert.equal(f.counts().posts, 1);
  } finally {
    await f.close();
  }
});

test("native scheduler uses Ponder work, validates one candidate and keeps invalid candidates terminal", async () => {
  for (const invalid of [false, true]) {
    const f = await fixture();
    try {
      f.responseState = "completed";
      if (invalid) f.candidate.championId = "not-a-participant";
      const result = await f.worker.tick();
      assert.equal(result.state, invalid ? "invalid" : "valid");
      await f.worker.tick();
      assert.equal(f.counts().posts, 1);
      assert.equal(
        (
          await f.pool.query(
            "SELECT count(*)::int AS n FROM yunipals_arena.tournament WHERE deployment=$1",
            [f.deployment]
          )
        ).rows[0].n,
        0
      );
      assert.ok(f.counts().polls >= 1);
    } finally {
      await f.close();
    }
  }
});

test("referee recovery leases retrieve orphaned responses during a source outage without POST", async () => {
  const f = await fixture();
  try {
    await f.adjudicator.step(f.deployment, "1");
    f.fork();
    f.unavailable = true;
    f.responseState = "completed";
    // A known provider ID permits retrieval even if an earlier observation was
    // marked uncertain. It still never permits another POST.
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET state='uncertain' WHERE deployment=$1",
      [f.deployment]
    );
    await f.due();
    const results = await Promise.all([
      f.worker.reconcile(),
      f.worker.reconcile()
    ]);
    assert.equal(
      results.reduce((n, r) => n + r.retrieved, 0),
      1
    );
    assert.equal(f.counts().gets, 1);
    assert.equal(f.counts().posts, 1);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.adjudication WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0].n,
      0
    );
    f.unavailable = false;
    f.responseState = "queued";
    const second = await f.seed();
    await f.adjudicator.step(f.deployment, "1", 1600000, second.incarnation);
    const oldLease = "11111111-1111-4111-8111-111111111111";
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET native_check_lease=$3,native_check_at=now()+interval '1 minute' WHERE deployment=$1 AND incarnation=$2",
      [f.deployment, second.incarnation, oldLease]
    );
    assert.equal((await f.worker.reconcile()).retrieved, 0);
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET native_check_at=now()-interval '1 second' WHERE deployment=$1 AND incarnation=$2",
      [f.deployment, second.incarnation]
    );
    f.responseState = "completed";
    assert.equal((await f.worker.reconcile()).completed, 1);
    assert.equal(
      (
        await f.pool.query(
          "UPDATE yunipals_arena.provider_task SET native_check_at=now()+interval '1 day' WHERE deployment=$1 AND native_check_lease=$2 RETURNING request_id",
          [f.deployment, oldLease]
        )
      ).rowCount,
      0
    );
    assert.equal(f.counts().posts, 2);
  } finally {
    await f.close();
  }
});

test("provider requests, response IDs and completed response bodies remain immutable", async () => {
  const f = await fixture();
  try {
    f.responseState = "completed";
    await f.adjudicator.step(f.deployment, "1");
    for (const update of [
      "request='{}'",
      "reserved_microusd=1",
      "request_id='replacement'",
      "provider_id='resp_other'",
      "response='{}'",
      "state='reserved'"
    ])
      await assert.rejects(
        f.pool.query(
          `UPDATE yunipals_arena.provider_task SET ${update} WHERE deployment=$1`,
          [f.deployment]
        ),
        /history is immutable/
      );
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.provider_action_evidence SET evidence='{}' WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
        [f.deployment]
      ),
      /evidence is immutable/
    );
    await assert.rejects(
      f.pool.query(
        "DELETE FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.deployment]
      ),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23503"
    );
    const binding = (
      await f.pool.query(
        "SELECT request_id,evidence FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
        [f.deployment]
      )
    ).rows[0];
    for (const evidence of [
      {},
      { ...binding.evidence, inputHash: null },
      { ...binding.evidence, incarnation: f.hash() },
      { ...binding.evidence, resultHash: f.hash() }
    ])
      await assert.rejects(
        f.pool.query(
          "INSERT INTO yunipals_arena.provider_action_evidence(request_id,evidence) VALUES($1,$2)",
          [binding.request_id, evidence]
        ),
        /binding is invalid/
      );
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET actual_microusd=500000 WHERE deployment=$1",
      [f.deployment]
    );
  } finally {
    await f.close();
  }
});

test("native referee preserves an explicitly adopted encryption context and fences legacy clients", async () => {
  const f = await fixture(true);
  try {
    f.responseState = "completed";
    assert.equal((await f.adjudicator.step(f.deployment, "1")).state, "valid");
    const legacy = new ArenaRefereeApi(
      f.pool,
      "test-only-not-a-key",
      (async () => {
        throw new Error("Legacy provider must not run.");
      }) as typeof fetch
    );
    await assert.rejects(legacy.step(f.deployment, "1"), /source selection/);
    await assert.rejects(
      f.api.step(f.deployment, "1"),
      /explicit tournament opening/
    );
    assert.equal(f.counts().posts, 1);
  } finally {
    await f.close();
  }
});
