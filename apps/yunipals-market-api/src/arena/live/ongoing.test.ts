import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import type { Address } from "viem";
import { migrateArena } from "./schema";
import {
  ArenaCapacity,
  validateCapacity,
  type CapacitySnapshot
} from "./capacity";
import { arenaOpenaiFundingMode } from "./funding";
import { arenaHealth } from "./health";
import { ArenaIdentityAnalysis, PreparingIdentity } from "./identityAnalysis";

const gib = 1024 ** 3;
const funded = (): CapacitySnapshot => ({
  openaiFundingMode: "ongoing",
  openaiBudgetMicrousd: 0,
  openaiBudgetExpiresAt: 0,
  runwareMicrousd: 10_000_000,
  vrfAvailableWei: "100000000000000",
  vrfQuoteWei: "1000000000000",
  vrfMaxWei: "10000000000000",
  refereeGasWei: "200000000000000",
  operatorGasWei: "100000000000000",
  diskFreeBytes: 64 * gib,
  mediaStoredBytes: gib,
  mediaQuotaBytes: 20 * gib,
  mediaReserveBytes: 6 * gib
});
async function fixture() {
  const pool = new pg.Pool({
    connectionString:
      process.env.ARENA_TEST_DATABASE_URL ??
      "postgres://postgres:arena-local-test@127.0.0.1:55441/arena",
    max: 2
  });
  await migrateArena(pool);
  const deployment = "ongoing-" + randomUUID();
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,finalized_at) VALUES($1,'0x1111111111111111111111111111111111111111',1,now())",
    [deployment]
  );
  return {
    pool,
    deployment,
    capacity: new ArenaCapacity(pool, deployment),
    async close() {
      for (const table of [
        "identity_job",
        "provider_task",
        "capacity",
        "tournament"
      ])
        await pool.query(
          `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
          [deployment]
        );
      await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
        deployment
      ]);
      await pool.end();
    }
  };
}

test("ongoing billing requires an explicit valid configuration; fresh installations retain capped mode", () => {
  assert.equal(arenaOpenaiFundingMode({}), "capped");
  assert.equal(
    arenaOpenaiFundingMode({ ARENA_OPENAI_FUNDING_MODE: "ongoing" }),
    "ongoing"
  );
  assert.throws(
    () => arenaOpenaiFundingMode({ ARENA_OPENAI_FUNDING_MODE: "unlimited" }),
    /Invalid/
  );
  assert.throws(
    () =>
      validateCapacity({
        ...funded(),
        openaiFundingMode: "typo"
      } as unknown as CapacitySnapshot),
    /Invalid/
  );
});

test("filled tournaments can open third/fourth lobbies after pilot expiry, while resource reservations and one-open-lobby rule remain enforced", async () => {
  const f = await fixture();
  try {
    const full = { phase: "strategies", seats: [{}, {}, {}, {}], deadline: 0 };
    for (const id of [1, 2])
      await f.pool.query(
        "INSERT INTO yunipals_arena.tournament VALUES($1,$2,$3,now())",
        [f.deployment, id, full]
      );
    await f.pool.query(
      "INSERT INTO yunipals_arena.tournament VALUES($1,99,$2,now())",
      [f.deployment, { phase: "expired", seats: [], deadline: 0 }]
    );
    await f.pool.query(
      "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,request,reserved_microusd) VALUES($1,99,'referee','past-spend',$2,'completed','{}',6000000)",
      [f.deployment, randomUUID()]
    );
    await f.capacity.save({
      ...funded(),
      openaiFundingMode: "capped",
      openaiBudgetMicrousd: 5_000_000
    });
    await assert.rejects(f.capacity.check(false), /allowance is renewed/);
    await f.capacity.save({
      ...funded(),
      openaiFundingMode: "capped",
      openaiBudgetMicrousd: 5_000_000,
      openaiBudgetExpiresAt: Date.now() + 60_000
    });
    await assert.rejects(f.capacity.check(true), /must progress/);
    await assert.rejects(f.capacity.check(false), /referee funds/);
    await f.capacity.save(funded());
    assert.equal((await f.capacity.check(true)).ready, true);
    assert.equal(
      (await arenaHealth(f.pool, f.deployment, true)).status,
      "healthy"
    );
    await f.pool.query(
      "INSERT INTO yunipals_arena.tournament VALUES($1,3,$2,now())",
      [f.deployment, { phase: "open", seats: [], deadline: 0 }]
    );
    await assert.rejects(f.capacity.check(true), /must progress/);
    assert.equal((await f.capacity.check(false)).ready, true);
    await f.pool.query(
      "UPDATE yunipals_arena.tournament SET state=$2 WHERE deployment=$1 AND id=3",
      [f.deployment, full]
    );
    assert.equal((await f.capacity.check(true)).ready, true);
    await f.capacity.save({ ...funded(), runwareMicrousd: 3_599_999 });
    await assert.rejects(f.capacity.check(true), /video funds/);
    await f.capacity.save({ ...funded(), mediaQuotaBytes: 12 * gib });
    await assert.rejects(f.capacity.check(true), /queued battle storage/);
    await f.capacity.save({ ...funded(), diskFreeBytes: 12 * gib });
    await assert.rejects(f.capacity.check(true), /queued battle storage/);
    await f.capacity.save({ ...funded(), refereeGasWei: "99999999999999" });
    await assert.rejects(f.capacity.check(true), /operating funds/);
    await f.capacity.save({ ...funded(), vrfAvailableWei: "0" });
    await assert.rejects(f.capacity.check(true), /island-draw funds/);
    await f.capacity.save(funded());
    await f.pool.query(
      "UPDATE yunipals_arena.capacity SET checked_at=now()-interval '7 minutes' WHERE deployment=$1",
      [f.deployment]
    );
    await assert.rejects(f.capacity.check(true), /operating capacity/);
  } finally {
    await f.close();
  }
});

test("ongoing artwork checks ignore expired pilot allowance, cache the single paid result, and recheck funding mode before POST", async () => {
  const f = await fixture();
  try {
    await f.capacity.save(funded());
    const analysis = new ArenaIdentityAnalysis(f.pool, f.deployment, "ongoing");
    const nft = {
      nftChainId: 1,
      collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d" as Address,
      tokenId: "1000000999"
    };
    const payload = (cid: string) => ({
      token: {
        chain: "ethereum",
        chain_id: 1,
        contract_address: nft.collection,
        token_id: nft.tokenId,
        image: `https://drive.polychainmonsters.com/ipfs/${cid}`,
        attributes: [
          { trait_type: "Type", value: "Unidragon" },
          { trait_type: "Color", value: "Blue" },
          { trait_type: "Horn", value: "Spiral" }
        ]
      }
    });
    const wallet = "0x1111111111111111111111111111111111111111";
    await assert.rejects(
      analysis.resolve(nft, payload("QmOngoingDragon"), wallet),
      PreparingIdentity
    );
    let posts = 0,
      switchMode = false;
    const fake = (async (url, options) => {
      if (String(url).startsWith("https://drive.polychainmonsters.com/")) {
        if (switchMode)
          await f.capacity.save({ ...funded(), openaiFundingMode: "capped" });
        return new Response(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
        );
      }
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      posts++;
      const request = JSON.parse(String(options?.body));
      assert.equal(request.max_output_tokens, 400);
      assert.deepEqual(request.tools, []);
      return new Response(
        JSON.stringify({
          id: "resp_ongoingtest",
          status: "completed",
          usage: { input_tokens: 2000, output_tokens: 70 },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    singleSubject: true,
                    wings: "absent",
                    description:
                      "Blue unicorn-like dragon with a spiral horn and curved tail."
                  })
                }
              ]
            }
          ]
        })
      );
    }) as typeof fetch;
    assert.equal(await analysis.step("test-only", 0, 0, fake), "ready");
    assert.equal(posts, 1);
    assert.equal(
      (await analysis.resolve(nft, payload("QmOngoingDragon"), wallet))
        .locomotion,
      "ground"
    );
    assert.equal(await analysis.step("test-only", 0, 0, fake), "idle");
    assert.equal(posts, 1);
    await assert.rejects(
      analysis.resolve(nft, payload("QmOngoingOtherDragon"), wallet),
      PreparingIdentity
    );
    switchMode = true;
    assert.equal(await analysis.step("test-only", 0, 0, fake), "budget");
    assert.equal(
      posts,
      1,
      "Changing back to capped mode blocks the pending paid POST"
    );
  } finally {
    await f.close();
  }
});
