import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildSourceManifest } from "../../yunipals-indexer/lib/unified/sources";
import { preflightUnifiedRpc } from "../../yunipals-indexer/lib/unified/rpc-preflight";
import {
  validateUnifiedRpcProfile,
  unifiedRpcProfileId,
  unifiedRpcManifestId
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";
import { readUnifiedRpcPolicyEnvironment } from "./unifiedRpcPolicy";

const profile = {
  version: 1 as const,
  model: "alchemy-2026-09-08" as const,
  scope: "test-coordinator",
  coordinatorId: "12345678-1234-4123-8123-123456789012",
  manifest: buildSourceManifest({}),
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const endpoints = {
  1: "http://127.0.0.1:19231/unified",
  8453: "http://127.0.0.1:19232/unified",
  137: "http://127.0.0.1:19233/unified",
  56: "http://127.0.0.1:19234/unified"
};
test("candidate listeners are identity-bound and preserve legacy profiles", () => {
  const original = JSON.stringify(profile),
    id = unifiedRpcProfileId(profile);
  const candidate = validateUnifiedRpcProfile({ ...profile, endpoints });
  assert.notEqual(unifiedRpcProfileId(candidate), id);
  assert.equal(unifiedRpcManifestId(candidate), unifiedRpcManifestId(profile));
  assert.equal(JSON.stringify(profile), original);
  assert.equal(unifiedRpcProfileId(JSON.parse(original)), id);
  for (const value of [
    "https://example.com/unified",
    "http://localhost:19232/unified",
    "http://127.0.0.1:80/unified",
    "http://127.0.0.1:70000/unified",
    "http://127.0.0.1:19232/unified?key=x",
    "http://127.0.0.1:19231/unified"
  ]) {
    assert.throws(
      () =>
        validateUnifiedRpcProfile({
          ...profile,
          endpoints: { ...endpoints, 8453: value }
        }),
      /reviewed RPC endpoint/
    );
  }
});
test("startup verifies every candidate proxy identity and rejects an unreviewed route before dispatch", async () => {
  const folder = await mkdtemp("/tmp/anime-rpc-endpoints-");
  try {
    const candidate = { ...profile, endpoints },
      file = join(folder, "profile.json");
    await writeFile(file, JSON.stringify(candidate));
    const env = {
      UNIFIED_RPC_PROFILE_FILE: file,
      UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(candidate),
      ...Object.fromEntries(
        Object.entries(endpoints).map(([chain, url]) => [
          `PONDER_RPC_URL_${chain}`,
          url
        ])
      )
    };
    let requests = 0;
    await preflightUnifiedRpc(candidate.manifest, env, {
      fetch: async (input, init) => {
        const url = new URL(String(input)),
          chainId = Number(
            Object.entries(endpoints).find(
              ([, v]) => new URL(v).port === url.port
            )![0]
          );
        requests++;
        const workload = new Headers(init?.headers).get(
          "x-yunipals-rpc-workload"
        );
        return new Response(
          JSON.stringify(
            url.pathname === "/unified/preflight"
              ? {
                  profileId: unifiedRpcProfileId(candidate),
                  manifestHash: unifiedRpcManifestId(candidate),
                  chainId,
                  coordinatorId: candidate.coordinatorId,
                  scope: candidate.scope,
                  workload,
                  paid: "explicit_bounded_permit_only",
                  budget: { daily_cu: "10000", allocation_cu: "1000" },
                  replay: { mode: "free_only" }
                }
              : { jsonrpc: "2.0", id: 1, result: `0x${chainId.toString(16)}` }
          )
        );
      }
    });
    assert.equal(requests, 12);
    await assert.rejects(
      preflightUnifiedRpc(
        candidate.manifest,
        { ...env, PONDER_RPC_URL_1: "http://127.0.0.1:19201/unified" },
        {
          fetch: async () => {
            throw Error("must not dispatch");
          }
        }
      ),
      /Explicit reviewed/
    );
    const server = {
      ...env,
      MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE: file,
      MARKET_RPC_PROXY_UNIFIED_PROFILE_ID: unifiedRpcProfileId(candidate),
      MARKET_RPC_PROXY_CHAIN_ID: "8453",
      MARKET_RPC_PROXY_PORT: "19232"
    };
    assert.equal(readUnifiedRpcPolicyEnvironment(server)!.chainId, 8453);
    assert.throws(
      () =>
        readUnifiedRpcPolicyEnvironment({
          ...server,
          MARKET_RPC_PROXY_PORT: "19202"
        }),
      /listener differs/
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
