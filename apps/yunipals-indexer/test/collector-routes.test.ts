import { Hono } from "hono";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { registerCollectorRoutes } from "../lib/api/collector-routes.js";

const owner = "0x0000000000000000000000000000000000000001" as const;
function fixture(
  enabled = true,
  nameSearchEnabled = true,
  fail = false,
  ready = true,
  rarityRangeEnabled = true,
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("WITH") && fail) throw new Error("timeout");
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: "database_unavailable" }, 503));
  registerCollectorRoutes(app, {
    pool: { connect } as unknown as Pick<Pool, "connect">,
    resolveOwner: async () => ({
      input: owner,
      normalizedName: null,
      addresses: { base: owner },
    }),
    checkReadiness: async () => ({ ready }),
    enabled: () => enabled,
    nameSearchEnabled: () => nameSearchEnabled,
    rarityRangeEnabled: () => rarityRangeEnabled,
  });
  return { app, query, release, connect };
}

describe("collector API routes", () => {
  it("blocks collector reads while ownership is rebuilding", async () => {
    const { app, connect } = fixture(true, true, false, false);
    const result = await app.request(`/v2/owners/${owner}/tokens`);
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ error: "ownership_rebuilding" });
    expect(connect).not.toHaveBeenCalled();
  });
  it("keeps new reads gated until the operator enables them", async () => {
    const { app, connect } = fixture(false);
    expect(
      await (await app.request("/v1/collector-capabilities")).json(),
    ).toEqual({ version: 0, namePrefixSearch: false, rarityRange: false });
    expect((await app.request(`/v2/owners/${owner}/tokens`)).status).toBe(503);
    expect(connect).not.toHaveBeenCalled();
  });
  it("can enable rarity and traits independently of name search", async () => {
    const { app, connect } = fixture(true, false);
    expect(
      await (await app.request("/v1/collector-capabilities")).json(),
    ).toEqual({ version: 1, namePrefixSearch: false, rarityRange: true });
    expect(
      (await app.request(`/v2/owners/${owner}/tokens?q=water`)).status,
    ).toBe(400);
    expect(connect).not.toHaveBeenCalled();
    expect((await app.request(`/v2/owners/${owner}/tokens?q=32`)).status).toBe(
      200,
    );
  });
  it("gates rarity ranges independently and rejects them before the database", async () => {
    const { app, connect } = fixture(true, true, false, true, false);
    expect(
      await (await app.request("/v1/collector-capabilities")).json(),
    ).toEqual({ version: 1, namePrefixSearch: true, rarityRange: false });
    expect(
      (
        await app.request(
          `/v2/owners/${owner}/tokens?rarityMin=10&rarityMax=20`,
        )
      ).status,
    ).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it("bounds DB work with a read-only transaction and a server-side deadline", async () => {
    const { app, query, release } = fixture();
    const result = await app.request(
      `/v2/owners/${owner}/tokens?chain=base&t.Type=Water`,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      version: 1,
      items: [],
      previousCursor: null,
      nextCursor: null,
      resolvedAddresses: { base: owner },
      visibility: "visible",
    });
    expect(query.mock.calls[0]![0]).toBe("BEGIN READ ONLY");
    expect(query.mock.calls[1]![0]).toContain("statement_timeout = '1000ms'");
    expect(query.mock.calls.some(([sql]) => sql === "SET LOCAL jit = off")).toBe(true);
    expect(query.mock.calls.at(-1)![0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
  it("rolls back and releases its pool connection after a query failure", async () => {
    const { app, query, release } = fixture(true, true, true);
    expect((await app.request(`/v2/owners/${owner}/tokens`)).status).toBe(503);
    expect(query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
  it("rejects invalid requests before acquiring a database connection", async () => {
    const { app, connect } = fixture();
    expect(
      (await app.request(`/v2/owners/${owner}/tokens?cursor=invalid`)).status,
    ).toBe(409);
    expect(
      (await app.request(`/v2/owners/${owner}/tokens?limit=9999`)).status,
    ).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
});
