import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogLeaseQueue } from "@/reads/catalogLease";

test("catalog transactions lease exclusively and release idempotently", async () => {
  const queue = new CatalogLeaseQueue();
  const release = await queue.acquire();
  let acquired = false;
  const next = queue.acquire().then((releaseNext) => {
    acquired = true;
    return releaseNext;
  });
  await Promise.resolve();
  assert.equal(acquired, false);
  release();
  release();
  const releaseNext = await next;
  assert.equal(queue.active, true);
  releaseNext();
  assert.equal(queue.active, false);
});

test("catalog queue bounds both pending requests and wait time without losing its active lease", async () => {
  const queue = new CatalogLeaseQueue(10, 1);
  const release = await queue.acquire();
  const waiting = assert.rejects(queue.acquire(), /catalog_busy/);
  await assert.rejects(queue.acquire(), /catalog_busy/);
  await waiting;
  assert.equal(queue.active, true);
  release();
  (await queue.acquire())();
});

test("retirement rejects queued and future reads but preserves the active lease until it settles", async () => {
  const queue = new CatalogLeaseQueue();
  const release = await queue.acquire();
  const waiting = assert.rejects(queue.acquire(), /expired/);
  queue.close(new Error("expired"));
  await waiting;
  await assert.rejects(queue.acquire(), /expired/);
  assert.equal(queue.active, true);
  release();
  assert.equal(queue.active, false);
});
