import type { PoolClient } from "pg";
import { physicalPonderSchema } from "../offchain/sql.js";
import {
  projectionSourceSnapshot,
  type ProjectionSourceSnapshot
} from "./projection-snapshot.js";

const hash = /^0x[0-9a-f]{64}$/;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const decimal = /^(0|[1-9][0-9]{0,18})$/;
const maximumBlock = 9223372036854775807n;
const maximumResponseBytes = 262144;

function proxyUrl(chainId: number, env: NodeJS.ProcessEnv) {
  const value =
    env[`PROJECTION_ANCHOR_RPC_URL_${chainId}`] ??
    env[`PONDER_RPC_URL_${chainId}`];
  if (!value) throw new Error("projection_anchor_proxy_required");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/unified" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("projection_anchor_loopback_proxy_required");
  return url.href;
}

/** Refresh durable old-header evidence using the existing canonical-witness
 * table. A physical header always wins, including a physical reorg mismatch.
 * RPC observations alone never authorize publication: the INSERT also checks
 * the current Ponder witness in its own database statement snapshot.
 */
export async function retainProjectionAnchors(
  db: Pick<PoolClient, "query">,
  snapshot: ProjectionSourceSnapshot,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}
) {
  const proof = projectionSourceSnapshot(structuredClone(snapshot));
  const env = options.env ?? process.env;
  const request = options.fetch ?? fetch;
  const deadline = performance.now() + 60000;
  let rpcCalls = 0;
  let physical = 0;
  let retained = 0;
  const rpc = async (url: string, method: string, params: unknown[]) => {
    const profileId =
      env.PROJECTION_ANCHOR_RPC_PROFILE_ID ?? env.UNIFIED_RPC_PROFILE_ID;
    if (!profileId || !hash.test(profileId))
      throw new Error("projection_anchor_rpc_profile_required");
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0 || rpcCalls >= proof.anchors.length * 3)
      throw new Error("projection_anchor_rpc_bound");
    const id = ++rpcCalls;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await request(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-yunipals-unified-rpc-profile": profileId,
          "x-yunipals-rpc-workload": "unified_evidence"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(Math.min(10000, remaining))
      });
      if (!response.ok || response.redirected || !response.body)
        throw new Error("response");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maximumResponseBytes) throw new Error("response");
        chunks.push(part.value);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("response");
      const result = value as Record<string, unknown>;
      if (
        result.jsonrpc !== "2.0" ||
        result.id !== id ||
        result.error ||
        !("result" in result)
      )
        throw new Error("response");
      return result.result;
    } catch {
      throw new Error("projection_anchor_rpc_unavailable");
    } finally {
      await reader?.cancel().catch(() => undefined);
    }
  };
  const header = async (url: string, number: string, expectedHash: string) => {
    const result = await rpc(url, "eth_getBlockByNumber", [
      `0x${BigInt(number).toString(16)}`,
      false
    ]);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("projection_anchor_header_invalid");
    const value = result as Record<string, unknown>;
    if (
      typeof value.number !== "string" ||
      !quantity.test(value.number) ||
      BigInt(value.number) !== BigInt(number) ||
      typeof value.hash !== "string" ||
      !hash.test(value.hash) ||
      value.hash !== expectedHash
    )
      throw new Error("projection_anchor_header_changed");
  };
  for (const anchor of proof.anchors) {
    const direct = await db.query<{ block_hash: string }>(
      `SELECT block_hash FROM ${physicalPonderSchema}.chain_block
       WHERE chain_id=$1 AND block_number=$2::bigint`,
      [anchor.chain_id, anchor.block_number]
    );
    if (direct.rows.length) {
      if (direct.rows.some((row) => row.block_hash !== anchor.block_hash))
        throw new Error("projection_anchor_physical_changed");
      physical++;
      continue;
    }
    const witness = (
      await db.query<{ witness_number: string; witness_hash: string }>(
        `SELECT s.witness_number::text,s.witness_hash
       FROM yunipals_indexer_control.chain_status s
       JOIN ${physicalPonderSchema}.chain_block b ON b.chain_id=s.chain_id
         AND b.block_number=s.witness_number AND b.block_hash=s.witness_hash
       WHERE s.release_id=$1 AND s.chain_id=$2 AND NOT s.halted AND s.error_code IS NULL
         AND NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block conflicting
           WHERE conflicting.chain_id=s.chain_id AND conflicting.block_number=s.witness_number
             AND conflicting.block_hash<>s.witness_hash)`,
        [proof.releaseId, anchor.chain_id]
      )
    ).rows;
    const current = witness[0];
    if (
      witness.length !== 1 ||
      !current ||
      !decimal.test(current.witness_number) ||
      BigInt(current.witness_number) > maximumBlock ||
      BigInt(current.witness_number) < BigInt(anchor.block_number) ||
      !hash.test(current.witness_hash)
    )
      throw new Error("projection_anchor_witness_unavailable");
    const url = proxyUrl(anchor.chain_id, env);
    if (
      (await rpc(url, "eth_chainId", [])) !==
      `0x${anchor.chain_id.toString(16)}`
    )
      throw new Error("projection_anchor_chain_changed");
    await header(url, anchor.block_number, anchor.block_hash);
    await header(url, current.witness_number, current.witness_hash);
    const saved = await db.query(
      `INSERT INTO yunipals_indexer_control.chain_anchor
       (release_id,chain_id,block_number,block_hash,witness_number,witness_hash)
       SELECT $1,$2,$3::bigint,$4,$5::bigint,$6
       WHERE NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block old
         WHERE old.chain_id=$2 AND old.block_number=$3::bigint)
         AND EXISTS(SELECT 1 FROM yunipals_indexer_control.chain_status s
           JOIN ${physicalPonderSchema}.chain_block b ON b.chain_id=s.chain_id
             AND b.block_number=s.witness_number AND b.block_hash=s.witness_hash
           WHERE s.release_id=$1 AND s.chain_id=$2 AND s.witness_number=$5::bigint
             AND s.witness_hash=$6 AND NOT s.halted AND s.error_code IS NULL)
         AND NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block conflicting
           WHERE conflicting.chain_id=$2 AND conflicting.block_number=$5::bigint
             AND conflicting.block_hash<>$6)
       ON CONFLICT(release_id,chain_id,block_number) DO UPDATE
         SET witness_number=EXCLUDED.witness_number,witness_hash=EXCLUDED.witness_hash
         WHERE chain_anchor.block_hash=EXCLUDED.block_hash
       RETURNING block_number`,
      [
        proof.releaseId,
        anchor.chain_id,
        anchor.block_number,
        anchor.block_hash,
        current.witness_number,
        current.witness_hash
      ]
    );
    if (saved.rowCount !== 1)
      throw new Error("projection_anchor_witness_changed");
    retained++;
  }
  return { anchors: proof.anchors.length, physical, retained, rpcCalls };
}
