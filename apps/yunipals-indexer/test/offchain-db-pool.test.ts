import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

let opened: Pool[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://unused@127.0.0.1:1/pool_options_test"
  );
  vi.stubEnv("OFFCHAIN_DB_POOL_MAX", undefined);
  vi.stubEnv("API_DB_POOL_MAX", undefined);
  vi.stubEnv("OWNERSHIP_READ_MODE", "legacy");
});
afterEach(async () => {
  await Promise.all(opened.map((pool) => pool.end()));
  opened = [];
  vi.unstubAllEnvs();
});

async function pools() {
  const result = await import("../lib/offchain/db.js");
  opened.push(result.pool, result.apiPool);
  expect(result.pool.totalCount).toBe(0);
  expect(result.apiPool.totalCount).toBe(0);
  return result;
}

describe("offchain worker pool capacity", () => {
  it("constructs real lazy pg pools with the preserved twelve-slot defaults", async () => {
    const { pool, apiPool } = await pools();
    expect(pool.options.max).toBe(12);
    expect(apiPool.options.max).toBe(12);
  });

  it("applies two worker slots independently of the API pool setting", async () => {
    vi.stubEnv("OFFCHAIN_DB_POOL_MAX", "2");
    vi.stubEnv("API_DB_POOL_MAX", "3");
    const { pool, apiPool } = await pools();
    expect(pool.options.max).toBe(2);
    expect(apiPool.options.max).toBe(3);
  });

  it("bounds a two-plus-two preview without using a database role limit as backpressure", async () => {
    vi.stubEnv("OFFCHAIN_DB_POOL_MAX", "2");
    vi.stubEnv("API_DB_POOL_MAX", "2");
    const { pool, apiPool } = await pools();
    expect(pool.options.max! + apiPool.options.max!).toBe(4);
  });

  it.each(["0", "-1", "1.5", "13", "NaN", "Infinity", ""])(
    "refuses invalid explicit worker limit %j during module startup",
    async (value) => {
      vi.stubEnv("OFFCHAIN_DB_POOL_MAX", value);
      await expect(import("../lib/offchain/db.js")).rejects.toThrow(
        "OFFCHAIN_DB_POOL_MAX must be a positive integer at most 12"
      );
    }
  );
});
