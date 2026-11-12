import type { Hono, Context } from "hono";
import { isAddress, type Address } from "viem";
import { z } from "zod";
import { portalJson } from "./chain.js";
import { PortalUserError } from "./errors.js";
import type { PortalRuntime } from "./runtime.js";

const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine((s) => BigInt(s) < 2n ** 256n);
const page = z.object({
  block: z.string().regex(/^\d{1,20}$/),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  generation: z.string().uuid(),
  after: z.string().max(110),
  scope: z.string().max(160)
});
const reply = (value: unknown) =>
  new Response(JSON.stringify(portalJson(value)), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
const encode = (value: z.infer<typeof page>) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function registerPortalOwnerRoutes(
  router: Hono,
  get: () => Promise<PortalRuntime>
) {
  async function snapshot(c: Context, scope: string) {
    const runtime = await get();
    const cursor = await runtime.ledger.cursor();
    if (!cursor)
      throw new PortalUserError(
        "Portal ownership is still being indexed. Try again shortly.",
        503
      );
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(c.req.query("limit") ?? "24");
    let selected = { ...cursor, scope, after: "0" };
    const raw = c.req.query("cursor");
    if (raw) {
      if (raw.length > 700)
        throw new PortalUserError("Invalid portal page.", 400);
      try {
        selected = page.parse(
          JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
        );
      } catch {
        throw new PortalUserError("Invalid portal page.", 400);
      }
      if (
        selected.generation !== cursor.generation ||
        selected.scope !== scope ||
        BigInt(selected.block) > BigInt(cursor.block)
      )
        throw new PortalUserError(
          "Portal history changed. Refresh this list.",
          409
        );
    }
    const canonical = await runtime.chain.client.getBlock({
      blockNumber: BigInt(selected.block)
    });
    const current = await runtime.chain.client.getBlock({
      blockNumber: BigInt(cursor.block)
    });
    if (canonical.hash !== selected.hash || current.hash !== cursor.hash)
      throw new PortalUserError(
        "Portal history is being refreshed after a chain change.",
        409
      );
    return { runtime, selected, limit, indexedThroughBlock: cursor.block };
  }

  async function unchanged(
    runtime: PortalRuntime,
    selected: z.infer<typeof page>
  ) {
    const cursor = await runtime.ledger.cursor();
    if (
      cursor?.generation !== selected.generation ||
      (
        await runtime.chain.client.getBlock({
          blockNumber: BigInt(selected.block)
        })
      ).hash !== selected.hash
    )
      throw new PortalUserError(
        "Portal history changed. Refresh this list.",
        409
      );
  }

  router.get("/v1/portals/owners/:address", async (c) => {
    const owner = c.req.param("address");
    if (!isAddress(owner))
      throw new PortalUserError("Invalid owner wallet.", 400);
    const { runtime, selected, limit, indexedThroughBlock } = await snapshot(
      c,
      `owner:${owner.toLowerCase()}`
    );
    uint.parse(selected.after);
    const rows = await runtime.ledger.holdings(
      owner,
      selected.block,
      selected.after,
      limit + 1
    );
    const block = await runtime.chain.client.getBlock();
    const tokens = await Promise.all(
      rows
        .slice(0, limit)
        .map((row) =>
          runtime.chain.portalToken(BigInt(row.tokenId), block.number)
        )
    );
    await unchanged(runtime, selected);
    return reply({
      tokens: tokens.filter(
        (token) =>
          token.owner.toLowerCase() === owner.toLowerCase() && !token.retired
      ),
      nextCursor:
        rows.length > limit
          ? encode({ ...selected, after: rows[limit - 1].tokenId })
          : null,
      indexedThroughBlock,
      snapshotBlock: selected.block,
      asOfBlock: block.number,
      catchingUp: BigInt(indexedThroughBlock) < block.number
    });
  });

  router.get("/v1/portals/tokens/:portalId", async (c) => {
    const tokenId = uint.parse(c.req.param("portalId"));
    const { chain, ledger } = await get();
    const token = await chain.portalToken(BigInt(tokenId));
    const [totals, cursor] = await Promise.all([
      ledger.totals(tokenId),
      ledger.cursor()
    ]);
    const canonical = cursor
      ? (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
          .hash === cursor.hash
      : false;
    return reply({
      token,
      totals: canonical ? totals : null,
      indexedThroughBlock: canonical ? (cursor?.block ?? null) : null
    });
  });

  async function activity(c: Context, owner?: Address) {
    const tokenId = owner ? undefined : uint.parse(c.req.param("portalId"));
    const { runtime, selected, limit, indexedThroughBlock } = await snapshot(
      c,
      owner ? `claims:${owner.toLowerCase()}` : `activity:${tokenId}`
    );
    if (tokenId) await runtime.chain.portalToken(BigInt(tokenId));
    const parts =
      selected.after === "0"
        ? [selected.block, "2147483647"]
        : selected.after.split(":");
    if (
      parts.length !== 2 ||
      !/^\d{1,20}$/.test(parts[0]) ||
      !/^\d{1,10}$/.test(parts[1]) ||
      Number(parts[1]) > 2147483647
    )
      throw new PortalUserError("Invalid activity page.", 400);
    const rows = await runtime.ledger.activity({
      tokenId,
      owner,
      block: selected.block,
      beforeBlock: parts[0],
      beforeLog: Number(parts[1]),
      limit: limit + 1
    });
    await unchanged(runtime, selected);
    const last = rows[limit - 1];
    return reply({
      events: rows.slice(0, limit),
      nextCursor:
        rows.length > limit
          ? encode({ ...selected, after: `${last.block}:${last.logIndex}` })
          : null,
      indexedThroughBlock,
      snapshotBlock: selected.block
    });
  }
  router.get("/v1/portals/tokens/:portalId/activity", (c) => activity(c));
  router.get("/v1/portals/owners/:address/claims", (c) => {
    const owner = c.req.param("address");
    if (!isAddress(owner))
      throw new PortalUserError("Invalid owner wallet.", 400);
    return activity(c, owner);
  });
}
