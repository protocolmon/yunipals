import type { Hono } from "hono";
import { z } from "zod";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";
import type { PortalRuntime } from "./runtime.js";
import { PortalUserError } from "./errors.js";

const idSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,77}$/)
  .refine((value) => BigInt(value) < 2n ** 256n);
export function registerPortalMintRoutes(
  router: Hono,
  get: () => Promise<PortalRuntime>
) {
  async function summary(runtime: PortalRuntime, id: string) {
    const { chain, ledger } = runtime;
    const cursor = await ledger.cursor();
    if (
      !cursor ||
      (await ledger.requiresReplay()) ||
      (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
        .hash !== cursor.hash
    )
      throw new PortalUserError("Portal deliveries are being indexed.", 503);
    const row = (
      await ledger.db.query<{
        kind: string;
        quantity: number;
        delivered: number;
      }>(
        "SELECT kind_id::text AS kind,quantity,delivered FROM portal_v5_mint WHERE deployment=$1 AND source=$2 AND request_id=$3",
        [ledger.deployment, chain.deployment.collection.toLowerCase(), id]
      )
    ).rows[0];
    if (!row)
      throw new PortalUserError("This mint request is not indexed yet.", 404);
    const block = await chain.client.getBlock();
    const [request, random, received] = await Promise.all([
      chain.client.readContract({
        address: chain.deployment.collection,
        abi: portalCollectionAbi,
        functionName: "getMintRequest",
        args: [BigInt(id)],
        blockNumber: block.number
      }),
      chain.client.readContract({
        address: chain.deployment.collection,
        abi: portalCollectionAbi,
        functionName: "randomRequests",
        args: [BigInt(id)],
        blockNumber: block.number
      }),
      ledger.db.query(
        "SELECT 1 FROM portal_v5_state WHERE deployment=$1 AND source=$2 AND component='randomness_result' AND entity_id=$3",
        [ledger.deployment, chain.deployment.collection.toLowerCase(), id]
      )
    ]);
    if (
      (await ledger.cursor())?.generation !== cursor.generation ||
      (await chain.client.getBlock({ blockNumber: block.number })).hash !==
        block.hash ||
      (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
        .hash !== cursor.hash
    )
      throw new PortalUserError("Mint history changed. Please refresh.", 503);
    const indexed =
      request.processed === row.delivered &&
      request.recipients.length === row.quantity &&
      request.kindId.toString() === row.kind;
    return {
      requestId: id,
      kindId: row.kind,
      quantity: row.quantity,
      delivered: row.delivered,
      ready: indexed && random[2] && received.rows.length === 1,
      complete: indexed && row.delivered === row.quantity,
      indexing: !indexed || (random[2] && received.rows.length === 0),
      indexedThroughBlock: cursor.block
    };
  }
  router.get("/v1/portals/mint-requests/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(
      await summary(await get(), idSchema.parse(c.req.param("id")))
    );
  });
  router.get("/v1/portals/mint-requests", async (c) => {
    const owner = z
      .string()
      .regex(/^0x[\da-f]{40}$/i)
      .parse(c.req.query("owner"));
    const runtime = await get();
    const rows = await runtime.ledger.db.query<{ id: string }>(
      `SELECT m.request_id::text AS id FROM portal_v5_mint m JOIN portal_v2_ledger_event e ON e.deployment=m.deployment AND e.source=m.source AND e.event_type='RandomnessRequested' AND e.args->>'requestId'=m.request_id::text
      WHERE m.deployment=$1 AND m.source=$2 AND lower(e.args->>'payer')=$3 ORDER BY m.request_id DESC LIMIT 20`,
      [
        runtime.ledger.deployment,
        runtime.chain.deployment.collection.toLowerCase(),
        owner.toLowerCase()
      ]
    );
    const requests = [];
    for (const row of rows.rows) requests.push(await summary(runtime, row.id));
    c.header("Cache-Control", "no-store");
    return c.json({ requests });
  });
}
