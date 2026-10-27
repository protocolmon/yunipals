import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.hoisted(() =>
  Object.assign(process.env, {
    DATABASE_SCHEMA: "projection_anchor_source",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: "projection_anchor_read",
    READ_DATABASE_SCHEMA: "projection_anchor_read",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`,
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native",
    YUNIPALS_PROJECTION_MODE: "generation"
  })
);
import { retainProjectionAnchors } from "../lib/metadata/projection-anchors.js";
import type { ProjectionSourceSnapshot } from "../lib/metadata/projection-snapshot.js";

const db = new PGlite();
const oldHash = `0x${"22".repeat(32)}`;
const witnessHash = `0x${"33".repeat(32)}`;
const changedHash = `0x${"44".repeat(32)}`;
const release = `0x${"11".repeat(32)}`;
const snapshot = (): ProjectionSourceSnapshot => ({
  version: 1,
  capturedAt: "2026-10-27T00:00:00.000Z",
  releaseId: release,
  manifestHash: `0x${"55".repeat(32)}`,
  readIdentity: `0x${"66".repeat(32)}`,
  physicalSchema: "projection_anchor_source",
  metadataReleaseId: "archive",
  predecessor: "107",
  baseMetadataFrontier: "frontier",
  anchors: [
    ["ethereum", 1],
    ["base", 8453],
    ["polygon", 137],
    ["bnb", 56]
  ].map(([collection, chain_id]) => ({
    collection: String(collection),
    chain_id: Number(chain_id),
    block_number: "100",
    block_hash: oldHash
  }))
});
const query = async (sql: string, params?: unknown[]) => {
  const result = await db.query(sql, params);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const client = { query } as unknown as Pick<PoolClient, "query">;
const env = {
  PONDER_RPC_URL_56: "http://127.0.0.1:19204/unified",
  UNIFIED_RPC_PROFILE_ID: `0x${"77".repeat(32)}`
};

function rpcFixture(
  options: {
    result?: (method: string, params: unknown[], sequence: number) => unknown;
    beforeResponse?: (
      method: string,
      params: unknown[],
      sequence: number
    ) => Promise<void>;
  } = {}
) {
  const calls: Array<{
    url: string;
    method: string;
    params: unknown[];
    headers: Headers;
  }> = [];
  const request = (async (input, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({
      url: String(input),
      method: body.method,
      params: body.params,
      headers: new Headers(init?.headers)
    });
    await options.beforeResponse?.(body.method, body.params, calls.length);
    const result =
      options.result?.(body.method, body.params, calls.length) ??
      (body.method === "eth_chainId"
        ? "0x38"
        : {
            number: body.params[0],
            hash: body.params[0] === "0x64" ? oldHash : witnessHash
          });
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  }) as typeof fetch;
  return { calls, fetch: request };
}

beforeAll(async () => {
  await db.exec(`CREATE SCHEMA projection_anchor_source; CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE projection_anchor_source.chain_block(chain_id integer,block_number bigint,block_hash text,
      PRIMARY KEY(chain_id,block_number,block_hash));
    CREATE TABLE yunipals_indexer_control.chain_status(release_id text,chain_id integer,
      witness_number bigint,witness_hash text,halted boolean DEFAULT false,error_code text,
      PRIMARY KEY(release_id,chain_id));
    CREATE TABLE yunipals_indexer_control.chain_anchor(release_id text,chain_id integer,
      block_number bigint,block_hash text,witness_number bigint,witness_hash text,
      PRIMARY KEY(release_id,chain_id,block_number));`);
});
beforeEach(async () => {
  await db.exec(`TRUNCATE projection_anchor_source.chain_block,
    yunipals_indexer_control.chain_status,yunipals_indexer_control.chain_anchor`);
  for (const anchor of snapshot().anchors) {
    if (anchor.chain_id !== 56)
      await query(
        "INSERT INTO projection_anchor_source.chain_block VALUES($1,100,$2)",
        [anchor.chain_id, oldHash]
      );
    await query(
      "INSERT INTO projection_anchor_source.chain_block VALUES($1,110,$2)",
      [anchor.chain_id, witnessHash]
    );
    await query(
      "INSERT INTO yunipals_indexer_control.chain_status(release_id,chain_id,witness_number,witness_hash) VALUES($1,$2,110,$3)",
      [release, anchor.chain_id, witnessHash]
    );
  }
});
afterAll(async () => db.close());

describe("projection canonical anchor retention", () => {
  it("leaves physical canonical anchors alone without RPC or writes", async () => {
    await query(
      "INSERT INTO projection_anchor_source.chain_block VALUES(56,100,$1)",
      [oldHash]
    );
    const rpc = rpcFixture();
    expect(
      await retainProjectionAnchors(client, snapshot(), {
        env: {},
        fetch: rpc.fetch
      })
    ).toEqual({ anchors: 4, physical: 4, retained: 0, rpcCalls: 0 });
    expect(rpc.calls).toHaveLength(0);
    expect(
      (await query("SELECT * FROM yunipals_indexer_control.chain_anchor")).rows
    ).toHaveLength(0);
  });

  it("verifies old and current witness headers on the exact chain, then inserts real guarded evidence", async () => {
    const proof = snapshot();
    const original = structuredClone(proof);
    const rpc = rpcFixture();
    expect(
      await retainProjectionAnchors(client, proof, { env, fetch: rpc.fetch })
    ).toEqual({ anchors: 4, physical: 3, retained: 1, rpcCalls: 3 });
    expect(proof).toEqual(original);
    expect(rpc.calls.map(({ method, params }) => [method, params])).toEqual([
      ["eth_chainId", []],
      ["eth_getBlockByNumber", ["0x64", false]],
      ["eth_getBlockByNumber", ["0x6e", false]]
    ]);
    for (const call of rpc.calls) {
      expect(call.url).toBe(env.PONDER_RPC_URL_56);
      expect(call.headers.get("x-yunipals-unified-rpc-profile")).toBe(
        env.UNIFIED_RPC_PROFILE_ID
      );
      expect(call.headers.get("x-yunipals-rpc-workload")).toBe("unified_evidence");
    }
    expect(
      (
        await query(
          "SELECT release_id,chain_id,block_number::text,block_hash,witness_number::text,witness_hash FROM yunipals_indexer_control.chain_anchor"
        )
      ).rows
    ).toEqual([
      {
        release_id: release,
        chain_id: 56,
        block_number: "100",
        block_hash: oldHash,
        witness_number: "110",
        witness_hash: witnessHash
      }
    ]);
    expect(
      (
        await query(
          "SELECT * FROM projection_anchor_source.chain_block WHERE chain_id=56 AND block_number=100"
        )
      ).rows
    ).toHaveLength(0);
  });

  it("renews the existing same-hash evidence rather than changing the anchor", async () => {
    await query(
      "INSERT INTO yunipals_indexer_control.chain_anchor VALUES($1,56,100,$2,90,$3)",
      [release, oldHash, changedHash]
    );
    const rpc = rpcFixture();
    await retainProjectionAnchors(client, snapshot(), {
      env,
      fetch: rpc.fetch
    });
    expect(
      (
        await query(
          "SELECT block_hash,witness_number::text,witness_hash FROM yunipals_indexer_control.chain_anchor"
        )
      ).rows[0]
    ).toEqual({
      block_hash: oldHash,
      witness_number: "110",
      witness_hash: witnessHash
    });
    expect(rpc.calls).toHaveLength(3);
  });

  it("never overrides a changed physical hash, including an exact plus conflicting physical row", async () => {
    await query(
      "INSERT INTO projection_anchor_source.chain_block VALUES(56,100,$1)",
      [changedHash]
    );
    await query(
      "INSERT INTO projection_anchor_source.chain_block VALUES(56,100,$1)",
      [oldHash]
    );
    await query(
      "INSERT INTO yunipals_indexer_control.chain_anchor VALUES($1,56,100,$2,110,$3)",
      [release, oldHash, witnessHash]
    );
    const rpc = rpcFixture();
    await expect(
      retainProjectionAnchors(client, snapshot(), { env, fetch: rpc.fetch })
    ).rejects.toThrow("physical_changed");
    expect(rpc.calls).toHaveLength(0);
  });

  it("rejects wrong chain, header number, old hash and witness hash without an insert", async () => {
    for (const result of [
      (method: string) => (method === "eth_chainId" ? "0x1" : undefined),
      (method: string) =>
        method === "eth_getBlockByNumber"
          ? { number: "0x65", hash: oldHash }
          : undefined,
      (_method: string, _params: unknown[], sequence: number) =>
        sequence === 2 ? { number: "0x64", hash: changedHash } : undefined,
      (_method: string, _params: unknown[], sequence: number) =>
        sequence === 3 ? { number: "0x6e", hash: changedHash } : undefined
    ]) {
      const rpc = rpcFixture({ result });
      await expect(
        retainProjectionAnchors(client, snapshot(), { env, fetch: rpc.fetch })
      ).rejects.toThrow(/chain_changed|header_changed/);
      expect(rpc.calls.length).toBeLessThanOrEqual(3);
      expect(
        (await query("SELECT * FROM yunipals_indexer_control.chain_anchor"))
          .rows
      ).toHaveLength(0);
    }
  });

  it("rejects remote, HTTPS, credential, query, fragment and wrong-path RPC configuration", async () => {
    for (const url of [
      "https://127.0.0.1:19204/unified",
      "http://provider.example/unified",
      "http://u:p@127.0.0.1/unified",
      "http://127.0.0.1/unified?key=secret",
      "http://127.0.0.1/unified#x",
      "http://127.0.0.1/"
    ]) {
      const rpc = rpcFixture();
      await expect(
        retainProjectionAnchors(client, snapshot(), {
          env: { PONDER_RPC_URL_56: url },
          fetch: rpc.fetch
        })
      ).rejects.toThrow("loopback_proxy_required");
      expect(rpc.calls).toHaveLength(0);
    }
    await expect(
      retainProjectionAnchors(client, snapshot(), { env: {} })
    ).rejects.toThrow("proxy_required");
  });

  it("prefers the dedicated header proxy while leaving the Ponder and ENS route untouched", async () => {
    const settings = {
      PROJECTION_ANCHOR_RPC_PROFILE_ID: env.UNIFIED_RPC_PROFILE_ID,
      PROJECTION_ANCHOR_RPC_URL_56: "http://127.0.0.1:19204/unified",
      PONDER_RPC_URL_56: "http://127.0.0.1:19204/"
    };
    const original = { ...settings };
    const rpc = rpcFixture();
    expect(
      await retainProjectionAnchors(client, snapshot(), {
        env: settings,
        fetch: rpc.fetch
      })
    ).toEqual({ anchors: 4, physical: 3, retained: 1, rpcCalls: 3 });
    expect(rpc.calls.map((call) => call.url)).toEqual(
      Array(3).fill(settings.PROJECTION_ANCHOR_RPC_URL_56)
    );
    expect(settings).toEqual(original);
  });

  it("requires a valid reviewed profile before sending RPC requests", async () => {
    for (const profile of [undefined, "wrong-profile"]) {
      const rpc = rpcFixture();
      await expect(
        retainProjectionAnchors(client, snapshot(), {
          env: { ...env, UNIFIED_RPC_PROFILE_ID: profile },
          fetch: rpc.fetch
        })
      ).rejects.toThrow("rpc_profile_required");
      expect(rpc.calls).toHaveLength(0);
    }
    expect(
      (await query("SELECT * FROM yunipals_indexer_control.chain_anchor")).rows
    ).toHaveLength(0);
  });

  it("rejects an external dedicated URL instead of falling back to an allowed Ponder proxy", async () => {
    const rpc = rpcFixture();
    await expect(
      retainProjectionAnchors(client, snapshot(), {
        env: {
          ...env,
          PROJECTION_ANCHOR_RPC_URL_56: "https://provider.example/unified"
        },
        fetch: rpc.fetch
      })
    ).rejects.toThrow("loopback_proxy_required");
    expect(rpc.calls).toHaveLength(0);
    expect(
      (await query("SELECT * FROM yunipals_indexer_control.chain_anchor")).rows
    ).toHaveLength(0);
  });

  it("requires a live unhalted canonical Ponder witness before RPC", async () => {
    await query(
      "DELETE FROM projection_anchor_source.chain_block WHERE chain_id=56 AND block_number=110"
    );
    const rpc = rpcFixture();
    await expect(
      retainProjectionAnchors(client, snapshot(), { env, fetch: rpc.fetch })
    ).rejects.toThrow("witness_unavailable");
    expect(rpc.calls).toHaveLength(0);
  });

  it("rejects a witness change between RPC and INSERT in the actual SQL guard", async () => {
    const rpc = rpcFixture({
      beforeResponse: async (_method, _params, sequence) => {
        if (sequence === 3)
          await query(
            "UPDATE yunipals_indexer_control.chain_status SET witness_hash=$1 WHERE chain_id=56",
            [changedHash]
          );
      }
    });
    await expect(
      retainProjectionAnchors(client, snapshot(), { env, fetch: rpc.fetch })
    ).rejects.toThrow("witness_changed");
    expect(
      (await query("SELECT * FROM yunipals_indexer_control.chain_anchor")).rows
    ).toHaveLength(0);
  });

  it("rejects a physical reorg appearing after RPC and preserves any conflicting retained hash", async () => {
    const rpc = rpcFixture({
      beforeResponse: async (_method, _params, sequence) => {
        if (sequence === 3)
          await query(
            "INSERT INTO projection_anchor_source.chain_block VALUES(56,100,$1)",
            [changedHash]
          );
      }
    });
    await expect(
      retainProjectionAnchors(client, snapshot(), { env, fetch: rpc.fetch })
    ).rejects.toThrow("witness_changed");
    expect(
      (await query("SELECT * FROM yunipals_indexer_control.chain_anchor")).rows
    ).toHaveLength(0);
    await query(
      "DELETE FROM projection_anchor_source.chain_block WHERE chain_id=56 AND block_number=100"
    );
    await query(
      "INSERT INTO yunipals_indexer_control.chain_anchor VALUES($1,56,100,$2,90,$3)",
      [release, changedHash, changedHash]
    );
    await expect(
      retainProjectionAnchors(client, snapshot(), {
        env,
        fetch: rpcFixture().fetch
      })
    ).rejects.toThrow("witness_changed");
    expect(
      (
        await query(
          "SELECT block_hash,witness_number::text FROM yunipals_indexer_control.chain_anchor"
        )
      ).rows[0]
    ).toEqual({ block_hash: changedHash, witness_number: "90" });
  });

  it("bounds RPC bodies and preserves transport failures without retry", async () => {
    for (const request of [
      async () => new Response("x".repeat(262145)),
      async () => Response.json({ jsonrpc: "2.0", id: 999, result: "0x38" }),
      async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -1 } }),
      async () => {
        throw new Error("private provider error");
      }
    ]) {
      let calls = 0;
      const fetch = (async () => {
        calls++;
        return request();
      }) as typeof globalThis.fetch;
      await expect(
        retainProjectionAnchors(client, snapshot(), { env, fetch })
      ).rejects.toThrow("rpc_unavailable");
      expect(calls).toBe(1);
    }
  });

  it("validates snapshot identity, exact chain mapping and bigint bounds before any query", async () => {
    for (const change of [
      { releaseId: changedHash },
      { physicalSchema: "another_source" },
      { anchors: snapshot().anchors.map((a) => ({ ...a, chain_id: 1 })) },
      {
        anchors: snapshot().anchors.map((a) => ({
          ...a,
          block_number: "9223372036854775808"
        }))
      }
    ]) {
      const query = vi.fn();
      await expect(
        retainProjectionAnchors(
          { query } as unknown as Pick<PoolClient, "query">,
          { ...snapshot(), ...change },
          { env }
        )
      ).rejects.toThrow("snapshot_invalid");
      expect(query).not.toHaveBeenCalled();
    }
  });
});
