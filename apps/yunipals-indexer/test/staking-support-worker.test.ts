import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setup = vi.hoisted(() => {
  const env = { OWNERSHIP_READ_MODE: "unified", DATABASE_SCHEMA: "staking_source", OWNERSHIP_READ_SCHEMA: "staking_read",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`, YUNIPALS_PROJECTION_MODE: "generation", ISLANDS_STAKING_SUPPORT_ENABLED: "true",
    ISLANDS_STAKING_READ_IDENTITY: `0x${"22".repeat(32)}`, ISLANDS_STAKING_BUILD_ID: "test-build" };
  Object.assign(process.env, env);
  return { env, verify: vi.fn(), identity: vi.fn(), create: vi.fn(), free: vi.fn() };
});
vi.mock("../lib/islands/staking-verifier.js", () => ({ verifyNativeIslandStaking: setup.verify }));
vi.mock("../lib/ownership/readiness.js", () => ({ ownershipReadIdentity: setup.identity }));
vi.mock("../lib/islands/staking-support-adapter.js", () => ({ createStakingSupportAdapter: setup.create }));

import { runStakingSupportOnce, stakingSupportConfiguration, stakingSupportPeerUrl, stakingSupportRole } from "../lib/islands/staking-support-worker.js";

describe("explicit native staking support job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup.identity.mockResolvedValue({ identity: setup.env.ISLANDS_STAKING_READ_IDENTITY });
    setup.verify.mockResolvedValue({ block: "20000000", custody: 2, verified: 2, unverified: 0, readCalls: 8,
      releaseId: setup.env.OWNERSHIP_RELEASE_ID, readIdentity: setup.env.ISLANDS_STAKING_READ_IDENTITY });
    setup.create.mockReturnValue({ chain: { contractAddress: "fixed" }, assertFreeProof: setup.free,
      statistics: () => ({ rpcCalls: 10, freeOnly: true }) });
  });
  const database = (overrides = {}, allowed = true) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ role: stakingSupportRole, actor: stakingSupportRole, build: "test-build", ready: true, ...overrides }] })
      .mockResolvedValueOnce({ rows: [{ allowed }] });
    return { pool: { query, connect: vi.fn() } as unknown as Pool, query };
  };

  it("requires explicit unified enablement, source identity and bounded settings", () => {
    expect(stakingSupportConfiguration(setup.env).limits.maxTokens).toBe(50);
    for (const change of [{ ISLANDS_STAKING_SUPPORT_ENABLED: undefined }, { OWNERSHIP_READ_MODE: "legacy" },
      { ISLANDS_STAKING_READ_IDENTITY: "bad" }, { ISLANDS_STAKING_MAX_TOKENS: "501" }, { ISLANDS_STAKING_MAX_RPC_CALLS: "2049" },
      { ISLANDS_STAKING_MAX_SECONDS: "181" }]) expect(() => stakingSupportConfiguration({ ...setup.env, ...change })).toThrow();
  });

  it("requires a clean dedicated Unix peer URL without remote hosts, password, role options or duplicate selectors", () => {
    const valid = "postgresql://yunipals_islands_staking@localhost/yunipals_backfill?host=/var/run/postgresql&port=5432";
    expect(stakingSupportPeerUrl(valid)).toBe(valid);
    for (const changed of [valid.replace("localhost", "remote.example"), valid.replace("@", ":private@"), valid + "&options=-crole=postgres",
      valid + "&host=remote.example", valid + "&user=postgres", valid.replace("5432", "15438")]) expect(() => stakingSupportPeerUrl(changed)).toThrow();
  });

  it("checks owner migration, dedicated role/build and restricted grants before constructing any RPC adapter", async () => {
    for (const [override, allowed] of [[{ ready: false }, true], [{ role: "postgres" }, true], [{ build: "other" }, true], [{}, false]] as const) {
      const { pool, query } = database(override, allowed);
      await expect(runStakingSupportOnce(pool, stakingSupportConfiguration(setup.env))).rejects.toThrow();
      expect(query.mock.calls.flat().join(" ")).not.toMatch(/\b(?:CREATE|ALTER|GRANT)\s/i);
    }
    expect(setup.create).not.toHaveBeenCalled();
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("delegates the atomic source/deposit recheck to the existing verifier with the selected identity and finite bounds", async () => {
    const { pool } = database();
    const config = stakingSupportConfiguration(setup.env);
    const result = await runStakingSupportOnce(pool, config);
    expect(setup.verify).toHaveBeenCalledWith(expect.objectContaining({ connect: expect.any(Function) }), "staking_read", { contractAddress: "fixed" }, { maxTokens: 50, maxReadCalls: 128 });
    expect(setup.free).toHaveBeenCalledTimes(2);
    expect(result.complete).toBe(true);
    expect(result.scanner).toBe(false);
    expect(result.paidFallback).toBe(false);
  });

  it("reports unconfirmed membership as incomplete instead of treating a completed scan as healthy ownership", async () => {
    setup.verify.mockResolvedValueOnce({ block: "20000000", custody: 2, verified: 1, unverified: 1, readCalls: 8,
      releaseId: setup.env.OWNERSHIP_RELEASE_ID, readIdentity: setup.env.ISLANDS_STAKING_READ_IDENTITY });
    const { pool } = database();
    const result = await runStakingSupportOnce(pool, stakingSupportConfiguration(setup.env));
    expect(result.complete).toBe(false);
    expect(result.reason).toBe("membership_unverified");
  });

  it("refuses another configured runtime or read marker before any provider request", async () => {
    const { pool } = database();
    const config = stakingSupportConfiguration(setup.env);
    await expect(runStakingSupportOnce(pool, { ...config, readSchema: "other_read" })).rejects.toThrow("binding_mismatch");
    setup.identity.mockResolvedValueOnce({ identity: `0x${"33".repeat(32)}` });
    await expect(runStakingSupportOnce(pool, config)).rejects.toThrow("read_identity_mismatch");
    expect(setup.create).not.toHaveBeenCalled();
  });

  it("stops new SQL/commit at the whole-job deadline but permits rollback of an opened transaction", async () => {
    const { pool } = database();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    vi.mocked(pool.connect).mockResolvedValue({ query, release } as never);
    let clock = 1000;
    setup.verify.mockImplementationOnce(async (guarded) => {
      const db = await guarded.connect();
      await db.query("BEGIN");
      clock += 120000;
      expect(() => db.query("COMMIT")).toThrow("deadline_or_stop");
      await db.query("ROLLBACK");
      db.release();
      throw new Error("synthetic_stopped");
    });
    await expect(runStakingSupportOnce(pool, stakingSupportConfiguration(setup.env), { now: () => clock })).rejects.toThrow("synthetic_stopped");
    expect(query.mock.calls.map((row) => row[0])).toEqual(["BEGIN", "ROLLBACK"]);
    expect(release).toHaveBeenCalledOnce();
  });
});
