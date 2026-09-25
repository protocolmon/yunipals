import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import type { PublicClient } from "viem";

import {
  admissionFixture,
  fixtureNow,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";
import { observeOpenSeaReadHealth } from "@/opensea/readHealth";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";

async function healthFixture(indexedHeight = 121n, stale = false) {
  const fixture = await admissionFixture();
  let indexerHeight = indexedHeight;
  const saved: unknown[][] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("latest_checkpoint")) {
      const timestamp = stale ? fixtureTimestamp - 120n : fixtureTimestamp;
      return {
        rows: [
          {
            checkpoint: `${timestamp.toString().padStart(10, "0")}${"1".padStart(16, "0")}${indexerHeight.toString().padStart(16, "0")}${"0".repeat(33)}`,
            version: "6",
            ready: "1",
            heartbeat: String(fixtureNow)
          }
        ]
      };
    }
    if (sql.includes("INSERT INTO")) saved.push(values);
    return { rows: [] };
  };
  const pool = {
    query,
    async connect() {
      return { query, release() {} };
    }
  } as unknown as Pool;
  const client = {
    ...fixture.client,
    async getBlock(args: Parameters<PublicClient["getBlock"]>[0]) {
      const block = await fixture.client.getBlock(args);
      // The next block can arrive while the other concurrent head RPCs finish.
      // A subsequent indexer read would incorrectly appear ahead of this head.
      if (args?.blockTag === "latest") indexerHeight = 122n;
      return block;
    }
  } as PublicClient;
  const policies: Pick<OpenSeaPolicyResolver, "resolve"> = {
    async resolve() {
      return {
        collectionSlug: "yunipals",
        policy: fixture.policy
      } as Awaited<ReturnType<OpenSeaPolicyResolver["resolve"]>>;
    }
  };
  return { pool, client, policies, saved, fixture };
}

test("a block indexed while head RPCs finish does not make health fail", async () => {
  const f = await healthFixture();
  assert.equal(
    await observeOpenSeaReadHealth(
      f.pool,
      f.client,
      "ethereum",
      f.policies,
      () => fixtureNow
    ),
    true
  );
  assert.equal(f.saved.length, 2);
  assert.equal(f.saved[1]?.[0], "indexer");
  assert.equal(f.saved[1]?.[2], "121");
});

test("an indexer already ahead of the observed chain still fails closed", async () => {
  const f = await healthFixture(122n);
  assert.equal(
    await observeOpenSeaReadHealth(
      f.pool,
      f.client,
      "ethereum",
      f.policies,
      () => fixtureNow
    ),
    false
  );
  assert.equal(f.saved.length, 1);
});

test("stale indexer evidence and invalid runtime code still fail closed", async () => {
  for (const stale of [true, false]) {
    const f = await healthFixture(121n, stale);
    if (!stale) f.fixture.state.code = "0x6000";
    assert.equal(
      await observeOpenSeaReadHealth(
        f.pool,
        f.client,
        "ethereum",
        f.policies,
        () => fixtureNow
      ),
      false
    );
    assert.equal(f.saved.length, 1);
  }
});
