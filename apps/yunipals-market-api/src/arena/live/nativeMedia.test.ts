import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import pg from "pg";
import type { Address, Hex } from "viem";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { migrateArena } from "./schema";
import { NativeArenaProvider } from "./nativeProvider";
import type { NativeArenaObservation } from "./nativeSource";
import { ArenaMediaApi, type MediaRequest } from "./mediaApi";
import { ArenaMedia } from "./media";
import { NativeArenaMedia } from "./nativeMedia";
import { mediaFolder, mediaIncarnation } from "./mediaPaths";
import { ArenaMediaAdoption } from "./mediaAdoption";
import { arenaMediaRead } from "./mediaRead";
import {
  buildMediaPublication,
  commitMediaPublication,
  publishedMediaTypes
} from "./mediaPublication";
import { publishedPayoutFilm } from "./payout";
import { createArenaApp } from "./http";
import {
  AnimeDirectorApi,
  ANIME_DIRECTOR_RECOVERY_ASSET,
  ANIME_DIRECTOR_RECOVERY_RESERVE,
  validatedAnimeDirectorTask,
  validatedAnimeDirectorPublication
} from "./animeDirectorApi";
import { fixtureProviderDirection } from "./animeDirectionFixture";
import {
  ANIME_DIRECTOR_MODEL,
  ANIME_DIRECTOR_ASSET,
  applyAnimeProviderDirection,
  type AnimeDirectionInput,
  type AnimeProviderDirection
} from "./animeDirection";
import { exportAnimeTournament } from "./animeMedia";
import { directTournament } from "../../../../yunipals-anime-engine/src/director";
import { ArenaCapacity, type CapacitySnapshot } from "./capacity";
import { arenaOperationalPoolMax } from "./runtime";

async function fixture(legacyContext = false, poolMax = 6) {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(["/arena", "/yunipals_arena_test"].includes(parsed.pathname));
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    connectionTimeoutMillis: 500
  });
  await migrateArena(pool);
  const storage = await mkdtemp("/tmp/yunipals-native-media-");
  const hash = () => `0x${randomBytes(32).toString("hex")}` as Hex;
  const contract = `0x${randomBytes(20).toString("hex")}` as Address,
    deployment = `8453:${contract}`;
  const input = JSON.parse(
    await readFile(resolve("src/arena/live/fixtures/pilot-input.json"), "utf8")
  );
  input.tournamentId = "1";
  const candidate = JSON.parse(
    await readFile(
      resolve("src/arena/live/fixtures/pilot-outcome.json"),
      "utf8"
    )
  );
  const inputHash = `0x${sha256(canonicalJson(input))}` as Hex,
    resultHash = `0x${sha256(canonicalJson(candidate))}` as Hex;
  const cipher = new StrategyCipher(randomBytes(32));
  let opening = hash(),
    unavailable = false,
    denyFunding = false,
    denyPoint = false;
  let onVerify: (() => void) | undefined;
  const freezeHash = hash(),
    openedTx = hash(),
    freezeTx = hash(),
    releaseId = hash();
  const state: ArenaTournament = {
    id: "1",
    phase: "settled",
    deadline: Math.floor(Date.now() / 1000) + 3600,
    rulesHash: hash(),
    poolHash: hash(),
    treasury: contract,
    islandId: "1",
    islandBeneficiary: contract,
    requestId: "1",
    randomWord: "42",
    ticket: 42,
    seats: [],
    inputHash,
    commitments: [hash(), hash(), hash(), hash()],
    resultHash,
    winners: [0, 2, 0],
    videoHash: null
  };
  const observe = (): NativeArenaObservation & {
    tournament: NonNullable<NativeArenaObservation["tournament"]>;
  } => {
    const opened = {
      id: `${deployment}:${openedTx}:0`,
      transactionHash: openedTx,
      blockNumber: "1",
      blockHash: opening,
      logIndex: 0
    };
    const inputFrozen = {
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
        last: inputFrozen,
        inputFrozen,
        incarnation: manifestDigest({
          deployment,
          tournamentId: "1",
          openedEventId: opened.id,
          openedBlockHash: opening
        })
      }
    };
  };
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
      read: async () => {
        if (unavailable) throw new Error("Source unavailable.");
        return observe();
      },
      work: async () => {
        if (unavailable) throw new Error("Source unavailable.");
        return { ...observe(), ids: ["1"] };
      }
    }
  );
  async function seed() {
    if (legacyContext) {
      const t = observe().tournament;
      await pool.query(
        `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)
        VALUES($1,1,$2,$3,$4,$5,now(),$6)`,
        [
          deployment,
          t.incarnation,
          t.opened.id,
          t.opened.blockHash,
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
      VALUES($1,1,$2,$3,$4,now(),$5,$6)`,
      [
        deployment,
        context.incarnation,
        inputHash,
        cipher.seal(`${context.cipherContext}/input`, { input }),
        observe().tournament.inputFrozen!.id,
        freezeHash
      ]
    );
    await pool.query(
      `INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,incarnation,input_hash,outcome_hash,candidate,validation,state,winners)
      VALUES($1,1,$2,$3,$4,$5,'{"valid":true,"errors":[],"matches":[]}','valid','[0,2,0]')`,
      [deployment, context.incarnation, inputHash, resultHash, candidate]
    );
    await pool.query(
      legacyContext
        ? "INSERT INTO yunipals_arena.media_job(deployment,tournament_id,incarnation) VALUES($1,1,$2)"
        : "INSERT INTO yunipals_arena.media_job(deployment,tournament_id,incarnation,input_hash,outcome_hash) VALUES($1,1,$2,$3,$4)",
      legacyContext
        ? [deployment, context.incarnation]
        : [deployment, context.incarnation, inputHash, resultHash]
    );
    const folder = mediaFolder(
      storage,
      deployment,
      "1",
      mediaIncarnation(deployment, "1", context)
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "reference.png"),
      Buffer.from("89504e470d0a1a0a0000000000000000", "hex")
    );
    return context;
  }
  const first = await seed();
  const guard = new NativeArenaProvider(
    service,
    async () => {
      onVerify?.();
      onVerify = undefined;
      if (denyPoint) throw new Error("Point unavailable.");
    },
    async () => {
      if (denyFunding) throw new Error("Funding unavailable.");
    }
  );
  let posts = 0,
    gets = 0,
    downloads = 0,
    losePost = false;
  let bytes = Buffer.from("89504e470d0a1a0a0000000000000000", "hex");
  const api = new ArenaMediaApi(
    pool,
    "not-a-live-key",
    async (url, options) => {
      if (String(url) === "https://api.runware.ai/v1") {
        const [body] = JSON.parse(String(options?.body));
        if (body.taskType === "getResponse") gets++;
        else {
          posts++;
          if (losePost) throw new Error("Lost response.");
        }
        return Response.json({
          data: [
            {
              taskUUID: body.taskUUID,
              status: "success",
              imageURL: `https://im.runware.ai/${body.taskUUID}.png`,
              cost: 0.04
            }
          ]
        });
      }
      assert.ok(String(url).startsWith("https://im.runware.ai/"));
      downloads++;
      return new Response(bytes);
    },
    guard,
    storage
  );
  const request: MediaRequest = {
    kind: "image",
    prompt: "native fixture",
    references: Array.from({ length: 3 }, () => ({
      file: "reference.png",
      sha256: requireDigest(bytes)
    }))
  };
  const folder = () => api.folder(deployment, "1", first.incarnation);
  const media = new ArenaMedia(
    pool,
    cipher,
    api,
    resolve("../.."),
    storage,
    async () => {
      throw new Error("No generation expected in this test.");
    }
  );
  return {
    pool,
    storage,
    service,
    guard,
    api,
    input,
    candidate,
    first,
    state,
    request,
    folder,
    observe,
    media,
    scheduler: new NativeArenaMedia(service, api, media),
    counts: () => ({ posts, gets, downloads }),
    lost: () => {
      losePost = true;
    },
    funding: (deny: boolean) => {
      denyFunding = deny;
    },
    point: (deny: boolean) => {
      denyPoint = deny;
    },
    verifyHook: (hook: () => void) => {
      onVerify = hook;
    },
    source: (down: boolean) => {
      unavailable = down;
    },
    fork: () => {
      opening = hash();
    },
    seed,
    changeBytes: () => {
      bytes = Buffer.concat([bytes, Buffer.from([1])]);
    },
    close: async () => {
      for (const table of ["media_job", "media_publication"])
        await pool.query(
          `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
          [deployment]
        );
      await pool.query(
        "DELETE FROM yunipals_arena.provider_action_evidence WHERE request_id IN(SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1)",
        [deployment]
      );
      for (const table of [
        "provider_task",
        "adjudication",
        "frozen_input",
        "tournament_identity",
        "deployment"
      ])
        await pool.query(
          `DELETE FROM yunipals_arena.${table} WHERE ${table === "deployment" ? "id" : "deployment"}=$1`,
          [deployment]
        );
      await pool.end();
      await rm(storage, { recursive: true, force: true });
    }
  };
}
const requireDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function claudeFixture(f: Awaited<ReturnType<typeof fixture>>, pool = f.pool) {
  const tournament = exportAnimeTournament(f.input, f.candidate);
  const strategies = Object.fromEntries(
    f.input.strategies.map((s: { fighterId: string; text: string }) => [
      s.fighterId,
      s.text
    ])
  );
  const choreography = directTournament(
    tournament,
    Object.fromEntries(
      Object.keys(tournament.fighters).map((id) => [id, { attackKind: "orb" }])
    ),
    strategies
  );
  const input: AnimeDirectionInput = { tournament, strategies, choreography };
  const output: AnimeProviderDirection = fixtureProviderDirection(input);
  let posts = 0,
    gets = 0;
  const options = {
    losePost: false,
    omitCost: false,
    costAvailable: false,
    invalid: false,
    generationId: `gen-${randomUUID()}`,
    model: ANIME_DIRECTOR_MODEL as string
  };
  const api = new AnimeDirectorApi(
    pool,
    "not-a-live-key",
    f.guard,
    f.storage,
    async (url) => {
      if (String(url).includes("/generation?")) {
        gets++;
        return options.costAvailable
          ? Response.json({
              data: { id: options.generationId, total_cost: 0.0012345 }
            })
          : new Response(null, { status: 404 });
      }
      assert.equal(
        String(url),
        "https://openrouter.ai/api/v1/chat/completions"
      );
      posts++;
      if (options.losePost) throw new Error("Lost response");
      const value = structuredClone(output);
      if (options.invalid) {
        const cutins = JSON.parse(value.matches.SF1!.cutins);
        cutins[0].quotes[0].text = "Invented dialogue.";
        value.matches.SF1!.cutins = JSON.stringify(cutins);
      }
      return Response.json({
        id: options.generationId,
        model: options.model,
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify(value) } }
        ],
        usage: options.omitCost
          ? { prompt_tokens: 100 }
          : { cost: 0.0012345, prompt_tokens: 100, completion_tokens: 80 }
      });
    }
  );
  return { api, input, output, options, counts: () => ({ posts, gets }) };
}

test("Claude's captured response recovers a failed DB update without another provider request", async () => {
  const f = await fixture();
  try {
    let loseUpdate = true;
    const pool = new Proxy(f.pool, {
      get(target, key) {
        if (key === "query")
          return (sql: unknown, ...args: unknown[]) => {
            if (
              loseUpdate &&
              typeof sql === "string" &&
              sql.startsWith(
                "UPDATE yunipals_arena.provider_task SET state='accounting',provider_id="
              )
            ) {
              loseUpdate = false;
              return Promise.reject(new Error("Lost accounting write"));
            }
            return Reflect.apply(target.query, target, [sql, ...args]);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const c = claudeFixture(f, pool);
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /unconfirmed/
    );
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    const [task] = (
      await f.pool.query(
        "SELECT request_id,state FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows;
    assert.equal(task.state, "uncertain");
    const raw = JSON.parse(
      await readFile(
        join(
          await f.folder(),
          "provider-receipts",
          task.request_id + ".response"
        ),
        "utf8"
      )
    );
    assert.equal(raw.id, c.options.generationId);
    const result = await c.api.direct(await f.folder(), c.input);
    assert.equal(result.receipt.generationId, raw.id);
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
  } finally {
    await f.close();
  }
});

test("the anime media role recovers captured Claude output after its provider-ID column grant is applied", async () => {
  const f = await fixture();
  const role = `arena_director_${randomBytes(8).toString("hex")}`;
  let apiPool: pg.Pool | undefined;
  try {
    await f.pool.query(`CREATE ROLE ${role} NOLOGIN;
      GRANT USAGE ON SCHEMA yunipals_arena TO ${role};
      GRANT SELECT ON ALL TABLES IN SCHEMA yunipals_arena TO ${role};
      GRANT INSERT ON yunipals_arena.provider_task TO ${role};
      GRANT UPDATE(state,response,error_code,updated_at,actual_microusd) ON yunipals_arena.provider_task TO ${role};`);
    apiPool = new pg.Pool({
      connectionString: f.pool.options.connectionString,
      max: 3,
      options: `-c role=${role}`
    });
    const c = claudeFixture(f, apiPool);
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /unconfirmed/
    );
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    await f.pool.query(
      `GRANT UPDATE(provider_id) ON yunipals_arena.provider_task TO ${role}`
    );
    const result = await c.api.direct(await f.folder(), c.input);
    assert.equal(result.receipt.generationId, c.options.generationId);
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    const permissions = (
      await f.pool.query(
        "SELECT has_column_privilege($1,'yunipals_arena.provider_task','request','UPDATE') AS request, has_column_privilege($1,'yunipals_arena.provider_task','reserved_microusd','UPDATE') AS reservation",
        [role]
      )
    ).rows[0];
    assert.deepEqual(permissions, { request: false, reservation: false });
  } finally {
    await apiPool?.end();
    await f.pool.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
    await f.close();
  }
});

test("one explicitly staged director recovery preserves the original charge and frozen request", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    c.options.losePost = true;
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /unconfirmed/
    );
    const [original] = (
      await f.pool.query(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows;
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET state='failed',provider_id=$2,actual_microusd=1235,error_code='director_content_not_retained',response=$3 WHERE request_id=$1",
      [
        original.request_id,
        c.options.generationId,
        {
          receipt: {
            actualCostUsd: 0.0012345,
            actualMicrousd: 1235,
            generationId: c.options.generationId
          }
        }
      ]
    );
    const recovery = randomUUID();
    await f.pool.query(
      "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,incarnation,kind,asset,request_id,request,reserved_microusd) VALUES($1,1,$2,'media',$3,$4,$5,$6)",
      [
        f.service.deployment,
        original.incarnation,
        ANIME_DIRECTOR_RECOVERY_ASSET,
        recovery,
        original.request,
        ANIME_DIRECTOR_RECOVERY_RESERVE
      ]
    );
    c.options.losePost = false;
    c.options.generationId = `gen-${randomUUID()}`;
    c.options.model = "anthropic/claude-opus-5.5-20260921";
    const result = await c.api.direct(await f.folder(), c.input);
    assert.equal(result.receipt.requestId, recovery);
    assert.equal(result.receipt.resolvedModel, c.options.model);
    assert.deepEqual(await c.api.direct(await f.folder(), c.input), result);
    assert.deepEqual(c.counts(), { posts: 2, gets: 0 });
    const tasks = (
      await f.pool.query(
        "SELECT asset,request_id,request,state,actual_microusd FROM yunipals_arena.provider_task WHERE deployment=$1 ORDER BY asset",
        [f.service.deployment]
      )
    ).rows;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].request_id, original.request_id);
    assert.equal(tasks[0].state, "failed");
    assert.equal(tasks[0].actual_microusd, "1235");
    assert.equal(tasks[1].state, "completed");
    assert.deepEqual(tasks[0].request, tasks[1].request);
  } finally {
    await f.close();
  }
});

test("a staged recovery cannot replace an uncertain charge or exceed the combined cap", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    c.options.losePost = true;
    await assert.rejects(c.api.direct(await f.folder(), c.input));
    const [original] = (
      await f.pool.query(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows;
    await f.pool.query(
      "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,incarnation,kind,asset,request_id,request,reserved_microusd) VALUES($1,1,$2,'media',$3,$4,$5,$6)",
      [
        f.service.deployment,
        original.incarnation,
        ANIME_DIRECTOR_RECOVERY_ASSET,
        randomUUID(),
        original.request,
        ANIME_DIRECTOR_RECOVERY_RESERVE
      ]
    );
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /original billed receipt/
    );
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET state='failed',provider_id=$2,actual_microusd=900000,error_code='director_content_not_retained',response=$3 WHERE request_id=$1",
      [
        original.request_id,
        c.options.generationId,
        {
          receipt: {
            actualMicrousd: 900000,
            generationId: c.options.generationId
          }
        }
      ]
    );
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /budget exhausted/
    );
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
  } finally {
    await f.close();
  }
});

test("Claude resumes its reserved request with source and media locks using the production three-connection pool", async () => {
  const f = await fixture(false, 2);
  try {
    const c = claudeFixture(f);
    const job = await f.folder();
    const runLocked = async () => {
      const lock = await f.pool.connect();
      try {
        await lock.query("SELECT pg_advisory_lock(hashtext($1))", [
          `arena/media/${f.service.deployment}/1`
        ]);
        return await c.api.direct(job, c.input);
      } finally {
        await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [
          `arena/media/${f.service.deployment}/1`
        ]);
        lock.release();
      }
    };
    await assert.rejects(runLocked(), /timeout|connection/i);
    assert.deepEqual(c.counts(), { posts: 0, gets: 0 });
    const before = (
      await f.pool.query(
        "SELECT request_id,state FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows;
    assert.equal(before.length, 1);
    assert.equal(before[0].state, "reserved");
    f.pool.options.max = arenaOperationalPoolMax(2, {
      native: true,
      media: true
    });
    const result = await runLocked();
    assert.equal(result.receipt.actualMicrousd, 1235);
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    const after = (
      await f.pool.query(
        "SELECT request_id,state FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows;
    assert.equal(after[0].request_id, before[0].request_id);
    assert.equal(after[0].state, "completed");
  } finally {
    await f.close();
  }
});

test("publication revalidates exact paid direction while preserving historical validation failures and all charges", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    await c.api.direct(await f.folder(), c.input);
    const [task] = (
      await f.pool.query(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows;
    const historical = {
      ...task,
      asset: ANIME_DIRECTOR_RECOVERY_ASSET,
      state: "failed",
      error_code: "director_output_invalid"
    };
    const before = structuredClone(historical);
    const result = validatedAnimeDirectorTask(historical);
    assert.equal(result.receipt.revalidated, true);
    assert.deepEqual(historical, before);
    const original = {
      ...task,
      asset: ANIME_DIRECTOR_ASSET,
      request_id: randomUUID(),
      provider_id: "gen-original-lost",
      state: "failed",
      error_code: "director_content_not_retained",
      actual_microusd: "1000",
      response: {
        receipt: { generationId: "gen-original-lost", actualMicrousd: 1000 }
      }
    };
    const charges = validatedAnimeDirectorPublication(
      [original, historical],
      result.choreography,
      result.receipt
    );
    assert.deepEqual(charges, { totalMicrousd: 2235, activeMicrousd: 1235 });
    assert.throws(
      () =>
        validatedAnimeDirectorPublication(
          [original, historical],
          {},
          result.receipt
        ),
      /differs/
    );
    assert.throws(
      () =>
        validatedAnimeDirectorPublication(
          [original, historical],
          result.choreography,
          { ...result.receipt, generationId: "gen-foreign" }
        ),
      /differs/
    );
    assert.throws(
      () =>
        validatedAnimeDirectorPublication(
          [{ ...original, state: "uncertain" }, historical],
          result.choreography,
          result.receipt
        ),
      /auditable recovery/
    );
    const bad = structuredClone(historical);
    const output = JSON.parse(bad.response.provider.choices[0].message.content);
    const cutins = JSON.parse(output.matches.SF1.cutins);
    cutins[0].quotes[0].text = "Invented dialogue";
    output.matches.SF1.cutins = JSON.stringify(cutins);
    bad.response.provider.choices[0].message.content = JSON.stringify(output);
    assert.throws(() => validatedAnimeDirectorTask(bad));
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
  } finally {
    await f.close();
  }
});

test("Claude cut-ins persist one canonical task, actual charge and native evidence across render retries", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f),
      before = structuredClone(c.input);
    const result = await c.api.direct(await f.folder(), c.input);
    assert.equal(result.receipt.actualCostUsd, 0.0012345);
    assert.equal(result.receipt.actualMicrousd, 1235);
    assert.deepEqual(
      result.choreography,
      applyAnimeProviderDirection(c.input, c.output)
    );
    assert.deepEqual(c.input, before);
    assert.deepEqual(await c.api.direct(await f.folder(), c.input), result);
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    const tasks = await f.pool.query(
      "SELECT p.state,p.actual_microusd,e.evidence FROM yunipals_arena.provider_task p JOIN yunipals_arena.provider_action_evidence e USING(request_id) WHERE p.deployment=$1",
      [f.service.deployment]
    );
    assert.equal(tasks.rows.length, 1);
    assert.equal(tasks.rows[0].actual_microusd, "1235");
    assert.equal(tasks.rows[0].evidence.inputHash, f.first.state.inputHash);
    assert.equal(tasks.rows[0].evidence.resultHash, f.state.resultHash);
  } finally {
    await f.close();
  }
});
test("Claude accounting retrieves the saved generation after a reorg without repurchasing it", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    c.options.omitCost = true;
    await assert.rejects(c.api.direct(await f.folder(), c.input));
    f.fork();
    await f.seed();
    f.source(true);
    c.options.costAvailable = true;
    const worker = new NativeArenaMedia(f.service, f.api, f.media, (task) =>
      c.api.step(task.id, task.incarnation)
    );
    assert.equal((await worker.reconcile()).completed, 1);
    assert.deepEqual(c.counts(), { posts: 1, gets: 2 });
    const tasks = await f.pool.query(
      "SELECT state,actual_microusd FROM yunipals_arena.provider_task WHERE deployment=$1",
      [f.service.deployment]
    );
    assert.deepEqual(tasks.rows, [
      { state: "completed", actual_microusd: "1235" }
    ]);
  } finally {
    await f.close();
  }
});
test("an ambiguous Claude submission never buys an automatic replacement", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    c.options.losePost = true;
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /unconfirmed/
    );
    c.options.losePost = false;
    await assert.rejects(
      c.api.direct(await f.folder(), c.input),
      /reconciliation/
    );
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    assert.equal(
      (
        await f.pool.query(
          "SELECT state FROM yunipals_arena.provider_task WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0].state,
      "uncertain"
    );
  } finally {
    await f.close();
  }
});
test("invalid Claude dialogue retains its charge and original response without a paid reroll", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    c.options.invalid = true;
    await assert.rejects(c.api.direct(await f.folder(), c.input), /recovery/);
    await assert.rejects(c.api.direct(await f.folder(), c.input), /recovery/);
    assert.deepEqual(c.counts(), { posts: 1, gets: 0 });
    assert.equal(
      (
        await f.pool.query(
          "SELECT actual_microusd FROM yunipals_arena.provider_task WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0].actual_microusd,
      "1235"
    );
  } finally {
    await f.close();
  }
});
test("Claude requires current source, matching hashes, scoped job and funding before a paid request", async () => {
  const f = await fixture();
  try {
    const c = claudeFixture(f);
    await assert.rejects(c.api.direct("/tmp/wrong-job", c.input), /origin/);
    const changed = structuredClone(c.input);
    changed.tournament.source.inputSha256 = "a".repeat(64);
    await assert.rejects(c.api.direct(await f.folder(), changed), /canonical/);
    f.funding(true);
    await assert.rejects(c.api.direct(await f.folder(), c.input), /Funding/);
    assert.equal(c.counts().posts, 0);
    f.funding(false);
    await c.api.direct(await f.folder(), c.input);
    assert.equal(c.counts().posts, 1);
    changed.strategies[Object.keys(changed.strategies)[0]!] = "Changed";
    await assert.rejects(
      c.api.direct(await f.folder(), {
        ...changed,
        tournament: c.input.tournament
      }),
      /frozen/
    );
  } finally {
    await f.close();
  }
});

test("anime admission reserves Claude funds for every outstanding film and a new lobby", async () => {
  const f = await fixture();
  try {
    const capacity = new ArenaCapacity(
      f.pool,
      f.service.deployment,
      f.service,
      "anime"
    );
    const snapshot: CapacitySnapshot = {
      runwareMicrousd: 0,
      openaiBudgetMicrousd: 1400000,
      openaiBudgetExpiresAt: Date.now() + 86400000,
      vrfAvailableWei: "1000000000000000",
      vrfQuoteWei: "1000000000000",
      vrfMaxWei: "10000000000000",
      refereeGasWei: "1000000000000000",
      operatorGasWei: "1000000000000000",
      diskFreeBytes: 10000000000
    };
    await capacity.save(snapshot);
    await assert.rejects(capacity.check(false), /cut-in generation funds/);
    await capacity.save({ ...snapshot, openrouterMicrousd: 799999 });
    await assert.rejects(capacity.check(false), /cut-in generation funds/);
    await capacity.save({ ...snapshot, openrouterMicrousd: 800000 });
    assert.equal((await capacity.check(false)).ready, true);
    await assert.rejects(capacity.check(true), /cut-in generation funds/);
    await capacity.save({ ...snapshot, openrouterMicrousd: 1600000 });
    assert.equal((await capacity.check(true)).ready, true);
  } finally {
    await f.pool.query(
      "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
      [f.service.deployment]
    );
    await f.close();
  }
});

test("native media retrieves an orphaned UUID during source outage without buying a replacement", async () => {
  const f = await fixture();
  try {
    const dep = f.service.deployment,
      inc = f.first.incarnation;
    await f.api.reserve(dep, "1", "SF1/image", f.request, inc);
    f.lost();
    await assert.rejects(
      f.api.step(dep, "1", "SF1/image", await f.folder(), inc),
      /unconfirmed/
    );
    f.fork();
    const next = await f.seed();
    await f.api.reserve(dep, "1", "SF1/image", f.request, next.incarnation);
    const ids = (
      await f.pool.query<{ request_id: string }>(
        "SELECT request_id FROM yunipals_arena.provider_task WHERE deployment=$1",
        [dep]
      )
    ).rows;
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0]!.request_id, ids[1]!.request_id);
    f.source(true);
    const recovered = await f.scheduler.reconcile();
    assert.equal(recovered.completed, 1);
    assert.deepEqual(f.counts(), { posts: 1, gets: 1, downloads: 1 });
    assert.ok(await readFile(join(await f.folder(), "provider/SF1/image.png")));
    await assert.rejects(
      f.api.step(
        dep,
        "1",
        "SF1/image",
        await f.api.folder(dep, "1", next.incarnation),
        next.incarnation
      ),
      /Source unavailable/
    );
    assert.equal(f.counts().posts, 1);
    const rows = (
      await f.pool.query(
        "SELECT incarnation,state,actual_microusd FROM yunipals_arena.provider_task WHERE deployment=$1 ORDER BY state",
        [dep]
      )
    ).rows;
    assert.ok(
      rows.some(
        (row) =>
          row.incarnation === inc &&
          row.state === "completed" &&
          row.actual_microusd === "40000"
      )
    );
  } finally {
    await f.close();
  }
});

test("native media fences new spending on funding, point verification, and opening changes", async () => {
  const f = await fixture();
  try {
    const dep = f.service.deployment,
      inc = f.first.incarnation;
    await f.api.reserve(dep, "1", "SF1/image", f.request, inc);
    f.funding(true);
    await assert.rejects(
      f.api.step(dep, "1", "SF1/image", await f.folder(), inc),
      /Funding unavailable/
    );
    f.funding(false);
    f.point(true);
    await assert.rejects(
      f.api.step(dep, "1", "SF1/image", await f.folder(), inc),
      /Point unavailable/
    );
    f.point(false);
    f.verifyHook(f.fork);
    await assert.rejects(
      f.api.step(dep, "1", "SF1/image", await f.folder(), inc),
      /opening|origin|incarnation/i
    );
    assert.equal(f.counts().posts, 0);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.provider_action_evidence e JOIN yunipals_arena.provider_task t USING(request_id) WHERE t.deployment=$1",
          [dep]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await f.close();
  }
});

test("completed native assets recover only exact saved bytes and serialize concurrent recovery", async () => {
  const f = await fixture();
  try {
    const dep = f.service.deployment,
      inc = f.first.incarnation,
      folder = await f.folder();
    await f.api.reserve(dep, "1", "SF1/image", f.request, inc);
    const task = await f.api.step(dep, "1", "SF1/image", folder, inc);
    assert.equal(task.state, "completed");
    await rm(join(folder, task.response!.local!.file));
    await Promise.all([
      f.api.step(dep, "1", "SF1/image", folder, inc),
      f.api.step(dep, "1", "SF1/image", folder, inc)
    ]);
    assert.equal(f.counts().posts, 1);
    assert.equal(f.counts().downloads, 2);
    await rm(join(folder, task.response!.local!.file));
    f.changeBytes();
    await assert.rejects(
      f.api.step(dep, "1", "SF1/image", folder, inc),
      /differs from its immutable/
    );
    await assert.rejects(
      f.api.step(dep, "1", "SF1/image", f.storage, inc),
      /folder|storage|origin/i
    );
  } finally {
    await f.close();
  }
});

test("native publications bind every served byte and payout to the current input, result and opening", async () => {
  const f = await fixture();
  try {
    const dep = f.service.deployment,
      inc = f.first.incarnation;
    const folder = mediaFolder(join(f.storage, "published"), dep, "1", inc);
    await mkdir(folder, { recursive: true });
    for (const name of Object.keys(publishedMediaTypes))
      await writeFile(join(folder, name), `fixture ${name}`);
    const filmHash = requireDigest(await readFile(join(folder, "film.mp4")));
    await writeFile(
      join(folder, "input.json"),
      JSON.stringify({
        inputSha256: f.state.inputHash!.slice(2),
        input: f.input
      })
    );
    await writeFile(
      join(folder, "outcome.json"),
      JSON.stringify({
        inputSha256: f.state.inputHash!.slice(2),
        outcomeSha256: f.state.resultHash!.slice(2),
        outcome: f.candidate
      })
    );
    await writeFile(
      join(folder, "film.json"),
      JSON.stringify({
        sha256: filmHash,
        outcomeSha256: f.state.resultHash!.slice(2)
      })
    );
    const publication = await buildMediaPublication(folder, {
      deployment: dep,
      tournamentId: "1",
      incarnation: inc,
      inputHash: f.state.inputHash!,
      outcomeHash: f.state.resultHash!
    });
    const proof = await f.guard.check("1", "media", inc);
    await transaction(f.pool, (db) =>
      commitMediaPublication(db, f.service, publication, proof.proof)
    );
    const reader = arenaMediaRead(f.pool, dep, f.storage, f.service);
    assert.equal((await reader.status("1")).state, "ready");
    const selector = {
      incarnation: inc,
      publication: publication.publicationHash
    };
    const app = createArenaApp(f.service, {
      entriesEnabled: false,
      media: reader
    });
    const response = await app.request(
      `/tournaments/1/artifacts/film.mp4?origin=${inc}&publication=${publication.publicationHash}`,
      { headers: { Range: "bytes=0-6" } }
    );
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "fixture");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(
      (await app.request("/tournaments/1/artifacts/film.mp4?origin=bad"))
        .status,
      400
    );
    assert.equal(
      await publishedPayoutFilm(f.pool, dep, "1", f.storage, f.first),
      `0x${filmHash}`
    );
    await f.pool.query(
      "UPDATE yunipals_arena.frozen_input SET revealed_block_hash=$2 WHERE deployment=$1",
      [dep, `0x${"f".repeat(64)}`]
    );
    assert.equal((await reader.status("1")).state, "waiting");
    await assert.rejects(
      publishedPayoutFilm(f.pool, dep, "1", f.storage, f.first),
      /completed published film/
    );
    await f.pool.query(
      "UPDATE yunipals_arena.frozen_input SET revealed_block_hash=$2 WHERE deployment=$1",
      [dep, f.observe().tournament.inputFrozen!.blockHash]
    );
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.media_publication SET manifest='{}' WHERE deployment=$1",
        [dep]
      ),
      /immutable/
    );
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.media_job SET input_hash=$2 WHERE deployment=$1",
        [dep, `0x${"f".repeat(64)}`]
      ),
      /immutable/
    );
    await writeFile(join(folder, "credits.txt"), "tampered");
    await assert.rejects(reader.status("1"), /differs|checksum/);
    await assert.rejects(
      publishedPayoutFilm(f.pool, dep, "1", f.storage, f.first),
      /differs|checksum/
    );
    f.source(true);
    await assert.rejects(
      reader.artifact("1", "film.mp4", undefined, selector),
      /Source unavailable/
    );
    f.source(false);
    f.fork();
    await f.seed();
    await assert.rejects(
      reader.artifact("1", "film.mp4", undefined, selector),
      /not found/
    );
    assert.equal((await reader.status("1")).state, "preparing");
  } finally {
    await f.close();
  }
});

async function legacyPublication(
  f: Awaited<ReturnType<typeof fixture>>,
  released = true
) {
  const dep = f.service.deployment,
    inc = f.first.incarnation;
  const folder = mediaFolder(join(f.storage, "published"), dep, "1");
  const privateFolder = await f.folder();
  await mkdir(folder, { recursive: true });
  await mkdir(join(privateFolder, "public"), { recursive: true });
  const tasks = [];
  for (const match of ["SF1", "SF2", "FINAL"])
    for (const kind of ["image", "opening", "continuation"]) {
      const asset = `${match}/${kind}`,
        requestId = randomUUID(),
        image = kind === "image";
      const bytes = Buffer.from(`original ${asset}`),
        file = `provider/${asset}.${image ? "png" : "mp4"}`;
      const parent = join(privateFolder, "provider", match);
      await mkdir(parent, { recursive: true });
      await writeFile(join(privateFolder, file), bytes);
      const reserved = image ? 40000 : kind === "opening" ? 100000 : 160000;
      const request = {
        kind: image ? "image" : "video",
        prompt: `original ${asset}`,
        references: [],
        ...(!image ? { duration: kind === "opening" ? 3 : 5 } : {})
      };
      const response = {
        output: {
          ...(image
            ? { imageURL: `https://im.runware.ai/${requestId}.png` }
            : { videoURL: `https://vm.runware.ai/${requestId}.mp4` })
        },
        local: { file, sha256: requireDigest(bytes) }
      };
      await f.pool.query(
        `INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,incarnation,kind,asset,request_id,state,request,response,reserved_microusd,actual_microusd)
      VALUES($1,1,$2,'media',$3,$4,'completed',$5,$6,$7,$7)`,
        [dep, inc, asset, requestId, request, response, reserved]
      );
      tasks.push({
        asset,
        request_id: requestId,
        reserved_microusd: String(reserved),
        actual_microusd: String(reserved)
      });
    }
  const filmHash = requireDigest(Buffer.from("legacy original film"));
  const contents: Record<string, Buffer> = {};
  for (const name of Object.keys(publishedMediaTypes))
    contents[name] = Buffer.from(`original ${name}`);
  contents["film.mp4"] = Buffer.from("legacy original film");
  contents["input.json"] = Buffer.from(
    JSON.stringify({ inputSha256: f.state.inputHash!.slice(2), input: f.input })
  );
  contents["outcome.json"] = Buffer.from(
    JSON.stringify({
      inputSha256: f.state.inputHash!.slice(2),
      outcomeSha256: f.state.resultHash!.slice(2),
      outcome: f.candidate
    })
  );
  contents["film.json"] = Buffer.from(
    JSON.stringify({
      sha256: filmHash,
      outcomeSha256: f.state.resultHash!.slice(2)
    })
  );
  contents["receipts.json"] = Buffer.from(JSON.stringify(tasks));
  for (const [name, bytes] of Object.entries(contents)) {
    await writeFile(join(folder, name), bytes);
    await writeFile(join(privateFolder, "public", name), bytes);
  }
  await f.pool.query(
    "UPDATE yunipals_arena.media_job SET state='ready',film_sha256=$2 WHERE deployment=$1",
    [dep, filmHash]
  );
  await f.pool.query(
    "UPDATE yunipals_arena.frozen_input SET revealed_event_id=NULL,revealed_block_hash=NULL WHERE deployment=$1",
    [dep]
  );
  await f.pool.query(
    "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
    [dep]
  );
  if (released) f.state.videoHash = `0x${filmHash}`;
  return { folder, privateFolder, filmHash, contents, tasks };
}

const adoption = (
  f: Awaited<ReturnType<typeof fixture>>,
  verify: () => Promise<void> = async () => {}
) =>
  new ArenaMediaAdoption(
    f.pool,
    f.service.nativeSource!,
    f.service.deployment,
    f.storage,
    verify
  );
const publicationCount = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (
    await f.pool.query(
      "SELECT count(*)::int AS n FROM yunipals_arena.media_publication WHERE deployment=$1",
      [f.service.deployment]
    )
  ).rows[0].n;

test("legacy film adoption is read-only by default and preserves paid-out bytes, tasks and ciphertext when applied", async () => {
  const f = await fixture(true);
  try {
    const old = await legacyPublication(f);
    const privateBefore = (
      await f.pool.query(
        "SELECT ciphertext,revealed_at FROM yunipals_arena.frozen_input WHERE deployment=$1",
        [f.service.deployment]
      )
    ).rows[0];
    const tasksBefore = (
      await f.pool.query(
        "SELECT request_id,request,response,reserved_microusd,actual_microusd FROM yunipals_arena.provider_task WHERE deployment=$1 ORDER BY asset",
        [f.service.deployment]
      )
    ).rows;
    let points = 0;
    const command = adoption(f, async () => {
      points++;
    });
    const plan = await command.run("1", f.first.incarnation);
    assert.equal(plan.applied, false);
    assert.equal(plan.payoutsReleased, true);
    assert.equal(await publicationCount(f), 0);
    assert.deepEqual(
      (
        await f.pool.query(
          "SELECT input_hash,publication_hash FROM yunipals_arena.media_job WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0],
      { input_hash: null, publication_hash: null }
    );
    assert.equal(
      (await command.run("1", f.first.incarnation, plan.reviewHash)).applied,
      true
    );
    assert.equal(
      (await command.run("1", f.first.incarnation, plan.reviewHash))
        .publicationHash,
      plan.publicationHash
    );
    assert.equal(await publicationCount(f), 1);
    assert.equal(points, 3);
    assert.deepEqual(
      (
        await f.pool.query(
          "SELECT ciphertext,revealed_at FROM yunipals_arena.frozen_input WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0],
      privateBefore
    );
    assert.deepEqual(
      (
        await f.pool.query(
          "SELECT request_id,request,response,reserved_microusd,actual_microusd FROM yunipals_arena.provider_task WHERE deployment=$1 ORDER BY asset",
          [f.service.deployment]
        )
      ).rows,
      tasksBefore
    );
    for (const [name, bytes] of Object.entries(old.contents)) {
      assert.deepEqual(await readFile(join(old.folder, name)), bytes);
      assert.deepEqual(
        await readFile(join(old.privateFolder, "public", name)),
        bytes
      );
    }
    assert.deepEqual(f.counts(), { posts: 0, gets: 0, downloads: 0 });
    const reader = arenaMediaRead(
      f.pool,
      f.service.deployment,
      f.storage,
      f.service
    );
    await assert.rejects(reader.status("1"), /synchronization/);
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
      [f.service.deployment]
    );
    const status = await reader.status("1");
    assert.equal(status.state, "ready");
    assert.equal(status.payoutsReleased, true);
    const response = await reader.artifact("1", "film.mp4", undefined, {
      incarnation: f.first.incarnation,
      publication: plan.publicationHash
    });
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      old.contents["film.mp4"]
    );
  } finally {
    await f.close();
  }
});

test("legacy film adoption requires a fenced, previously adopted origin and the original completed assets", async () => {
  const f = await fixture(true);
  try {
    const old = await legacyPublication(f, false),
      command = adoption(f),
      dep = f.service.deployment;
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
      [dep]
    );
    await assert.rejects(
      command.run("1", f.first.incarnation),
      /halted native/
    );
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [dep]
    );
    f.source(true);
    await assert.rejects(
      command.run("1", f.first.incarnation),
      /Source unavailable/
    );
    f.source(false);
    const file = join(old.privateFolder, "provider/SF1/image.png"),
      bytes = await readFile(file);
    await rm(file);
    await assert.rejects(command.run("1", f.first.incarnation), /ENOENT/);
    await writeFile(file, bytes);
    f.state.videoHash = `0x${"f".repeat(64)}`;
    await assert.rejects(
      command.run("1", f.first.incarnation),
      /does not match/
    );
    f.state.videoHash = null;
    await f.pool.query(
      "DELETE FROM yunipals_arena.provider_task WHERE deployment=$1 AND asset='FINAL/continuation'",
      [dep]
    );
    await assert.rejects(
      command.run("1", f.first.incarnation),
      /nine completed/
    );
    assert.equal(await publicationCount(f), 0);
  } finally {
    await f.close();
  }
  const native = await fixture();
  try {
    await legacyPublication(native);
    await assert.rejects(
      adoption(native).run("1", native.first.incarnation),
      /adopted native identity/
    );
  } finally {
    await native.close();
  }
});

test("legacy film adoption rejects changed reviews, public receipts and a concurrent media worker", async () => {
  const f = await fixture(true);
  try {
    const old = await legacyPublication(f),
      command = adoption(f),
      inc = f.first.incarnation,
      dep = f.service.deployment;
    const plan = await command.run("1", inc);
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET actual_microusd=actual_microusd+1 WHERE deployment=$1 AND asset='SF1/image'",
      [dep]
    );
    await assert.rejects(
      command.run("1", inc, plan.reviewHash),
      /review changed/
    );
    const holder = await f.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext($1))", [
        `arena/media/${dep}/1`
      ]);
      await assert.rejects(command.run("1", inc), /busy/);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `arena/media/${dep}/1`
      ]);
      holder.release();
    }
    const changed = old.tasks.map((task, index) => ({
      ...task,
      request_id: index === 0 ? randomUUID() : task.request_id
    }));
    await writeFile(join(old.folder, "receipts.json"), JSON.stringify(changed));
    await writeFile(
      join(old.privateFolder, "public/receipts.json"),
      JSON.stringify(changed)
    );
    await assert.rejects(command.run("1", inc), /public receipts differ/);
    assert.equal(await publicationCount(f), 0);
  } finally {
    await f.close();
  }
});

test("legacy film adoption rechecks source, files and operational history after its chain verification", async () => {
  for (const change of ["source", "files", "history", "point"] as const) {
    const f = await fixture(true);
    try {
      const old = await legacyPublication(f),
        inc = f.first.incarnation,
        dep = f.service.deployment;
      const plan = await adoption(f).run("1", inc);
      const command = adoption(f, async () => {
        if (change === "source") f.fork();
        else if (change === "files")
          await writeFile(
            join(old.folder, "credits.txt"),
            "corrupted after point read"
          );
        else if (change === "history")
          await f.pool.query(
            "UPDATE yunipals_arena.provider_task SET actual_microusd=actual_microusd+1 WHERE deployment=$1",
            [dep]
          );
        else throw new Error("Point verification unavailable.");
      });
      await assert.rejects(
        command.run("1", inc, plan.reviewHash),
        /opening|differs|changed|Point verification/
      );
      assert.equal(await publicationCount(f), 0);
      assert.equal(
        (
          await f.pool.query(
            "SELECT publication_hash FROM yunipals_arena.media_job WHERE deployment=$1",
            [dep]
          )
        ).rows[0].publication_hash,
        null
      );
    } finally {
      await f.close();
    }
  }
});
