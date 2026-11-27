import { Hono } from "hono";
import { z } from "zod";
import { isAddress, encodeFunctionData, type Address } from "viem";
import {
  adventureAbi,
  evolutionAbi,
  evolutionGradingAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
import {
  adventureOdds,
  crewAdventureOdds,
  crewEligibility,
  crewRulesHash,
  serumCatalogue,
  cardFinishes,
  finishOdds,
  serumPresences,
  serumFee,
  sponsoredSerumLimit,
  sponsoredFusionLimit,
  singularityCompatible,
  fusionCompatible
} from "@protopals/yunipals-market-core/serums";
import { createEvolutionRuntime, type EvolutionRuntime } from "./runtime.js";
import { portalJson } from "../portals/chain.js";
import { PortalUserError } from "../portals/errors.js";
import type { EvolutionReadContext } from "../../../../packages/yunipals-indexer-server/src/evolution.js";
import type { PoolClient } from "pg";
import { isUnsupportedEvolutionCard } from "./chain.js";
import {
  createEvolutionAssetRuntime,
  readPublishedEvolutionAsset,
  type EvolutionAssetRuntime
} from "./assets.js";

const uint = z
  .string()
  .regex(/^[1-9][0-9]{0,77}$/)
  .refine((v) => BigInt(v) < 2n ** 256n);
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(portalJson(value)), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
const pageSchema = z.object({
  id: uint,
  block: z.string().regex(/^\d{1,20}$/),
  hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  release: z.string().min(1).max(100),
  scope: z.string().max(250)
});
async function readPage(
  raw: string | undefined,
  scope: string,
  r: EvolutionRuntime,
  ctx: EvolutionReadContext
) {
  if (!raw) return "0";
  if (raw.length > 1000)
    throw new PortalUserError("Invalid collection page.", 400);
  let page: z.infer<typeof pageSchema>;
  try {
    page = pageSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    );
  } catch {
    throw new PortalUserError("Invalid collection page.", 400);
  }
  if (
    page.scope !== scope ||
    page.release !== ctx.release.id ||
    BigInt(page.block) > ctx.block
  )
    throw new PortalUserError("Collection changed. Refresh the list.", 409);
  const block = await r.chain.client.getBlock({
    blockNumber: BigInt(page.block)
  });
  if (block.hash !== page.hash)
    throw new PortalUserError("Collection changed. Refresh the list.", 409);
  ctx.block = block.number;
  ctx.hash = block.hash;
  ctx.timestamp = Number(block.timestamp);
  return page.id;
}
function nextPage(id: string, scope: string, ctx: EvolutionReadContext) {
  return Buffer.from(
    JSON.stringify({
      id,
      scope,
      release: ctx.release.id,
      block: ctx.block.toString(),
      hash: ctx.hash
    })
  ).toString("base64url");
}
export function registerEvolutionRoutes(
  app: Hono,
  options: {
    runtime?: () => Promise<EvolutionRuntime>;
    enabled?: () => boolean;
    assetRuntime?: () => EvolutionAssetRuntime;
  } = {}
) {
  const router = new Hono();
  let runtime: Promise<EvolutionRuntime> | undefined;
  let assetRuntime: EvolutionAssetRuntime | undefined;
  const getAssets = () =>
    (assetRuntime ??= (options.assetRuntime ?? createEvolutionAssetRuntime)());
  const get = () =>
    (runtime ??= (options.runtime ?? createEvolutionRuntime)().catch(
      (error) => {
        runtime = undefined;
        throw error;
      }
    ));
  router.onError((error) =>
    error instanceof z.ZodError
      ? reply({ error: "Invalid evolution request." }, 400)
      : error instanceof PortalUserError
        ? reply({ error: error.message }, error.status)
        : reply(
            {
              error:
                "Evolution is waiting for confirmed chain and indexer data. Please retry."
            },
            503
          )
  );
  router.use("/v1/evolution/*", async (c, next) => {
    if (/^\/v1\/evolution\/(assets|layers)\//.test(c.req.path)) return next();
    if (!(options.enabled?.() ?? process.env.EVOLUTION_ENABLED === "true"))
      return reply(
        { enabled: false, error: "Adventures and fusion are being prepared." },
        503
      );
    await next();
  });
  async function snapshot<T>(
    read: (
      runtime: EvolutionRuntime,
      db: PoolClient,
      context: EvolutionReadContext
    ) => Promise<T>
  ) {
    const runtime = await get();
    return runtime.reader.snapshot(async (db, context) => {
      if (
        context.deployment !== runtime.store.deployment ||
        (await runtime.chain.client.getBlock({ blockNumber: context.block }))
          .hash !== context.hash
      )
        throw new Error("Evolution branch changed.");
      const value = await read(runtime, db, context);
      if (
        (await runtime.chain.client.getBlock({ blockNumber: context.block }))
          .hash !== context.hash
      )
        throw new Error("Evolution branch changed.");
      return value;
    });
  }
  router.get("/v1/evolution/config", async () =>
    reply(
      await snapshot(async (r, _db, ctx) => ({
        enabled: true,
        chainId: r.portal.chain.deployment.chainId,
        cards: ctx.cards,
        adventures: ctx.adventures,
        evolution: ctx.evolution,
        grading: r.chain.grading,
        usdc: r.portal.chain.deployment.usdc,
        fee: serumFee,
        sponsoredSerumLimit,
        sponsoredFusionLimit,
        catalogue: serumCatalogue,
        presences: serumPresences,
        finishes: cardFinishes,
        finishOdds,
        block: ctx.block,
        hash: ctx.hash
      }))
    )
  );
  router.get("/v1/evolution/sponsorship", async (c) => {
    const kind = z
      .enum(["serum", "fusion"])
      .parse(c.req.query("kind") ?? "serum");
    const limit =
      kind === "fusion" ? sponsoredFusionLimit : sponsoredSerumLimit;
    return reply(
      await snapshot(async (r, _db, ctx) => {
        const used = await r.chain.client.readContract({
          address: ctx.evolution as Address,
          abi: evolutionAbi,
          functionName:
            kind === "fusion" ? "sponsoredFusionsUsed" : "sponsoredSerumsUsed",
          blockNumber: ctx.block
        });
        if (used > BigInt(limit)) throw new Error("Invalid sponsorship count.");
        return {
          limit,
          used: Number(used),
          remaining: limit - Number(used),
          block: ctx.block,
          hash: ctx.hash
        };
      })
    );
  });
  router.get("/v1/evolution/cards/:id", async (c) => {
    const id = BigInt(uint.parse(c.req.param("id")));
    return reply(
      await snapshot(async (r, _db, ctx) => ({
        card: await r.chain.card(id, ctx.block),
        block: ctx.block,
        hash: ctx.hash,
        timestamp: ctx.timestamp
      }))
    );
  });
  router.get("/v1/evolution/jobs/:id", async (c) => {
    const id = uint.parse(c.req.param("id"));
    return reply(await (await get()).reader.projection("job", id));
  });
  router.get("/v1/evolution/adventures/:id", async (c) => {
    const id = uint.parse(c.req.param("id"));
    return reply(await (await get()).reader.projection("adventure", id));
  });
  router.get("/v1/evolution/owners/:owner", async (c) => {
    const owner = c.req.param("owner").toLowerCase();
    if (!isAddress(owner)) throw new PortalUserError("Invalid owner.", 400);
    const rawPage = c.req.query("after");
    const portalId = c.req.query("portalId")
      ? BigInt(uint.parse(c.req.query("portalId")))
      : null;
    const partner = c.req.query("compatibleWith")
      ? BigInt(uint.parse(c.req.query("compatibleWith")))
      : null;
    return reply(
      await snapshot(async (r, db, ctx) => {
        const scope = `owner:${owner}:partner:${partner ?? ""}:portal:${portalId ?? ""}`;
        const after = await readPage(rawPage, scope, r, ctx);
        const rows = (
          await db.query<{ token: string }>(
            `SELECT token FROM (
        SELECT DISTINCT ON(args::jsonb->>'tokenId') args::jsonb->>'tokenId' AS token,lower(args::jsonb->>'to') AS owner
        FROM ${ctx.schema}.canonical_event WHERE chain_id=8453 AND address=$1 AND name='Transfer' AND block_number<=$2
        ORDER BY args::jsonb->>'tokenId',block_number DESC,transaction_index DESC,log_index DESC
      ) t WHERE owner=$3 AND token::numeric>$4 ORDER BY token::numeric LIMIT 13`,
            [ctx.cards, ctx.block.toString(), owner, after]
          )
        ).rows;
        const candidates = await Promise.all(
          rows.slice(0, 12).map(async (row) => {
            try {
              return await r.chain.card(BigInt(row.token), ctx.block);
            } catch (error) {
              // Skip known ineligible cards, never transport/branch failures.
              if (isUnsupportedEvolutionCard(error)) return null;
              throw error;
            }
          })
        );
        const cards = candidates.filter((card) => card !== null);
        const a = partner ? await r.chain.card(partner, ctx.block) : null;
        const singularityEnabled =
          a && cards.some((b) => singularityCompatible(a, b))
            ? await r.chain.supportsSingularity(ctx.block)
            : false;
        const matches = portalId
          ? await Promise.all(
              cards.map(async (card) => ({
                ...card,
                portalWitness: (
                  await r.chain.client.readContract({
                    address: r.chain.grading,
                    abi: evolutionGradingAbi,
                    functionName: "matchingSource",
                    args: [portalId, BigInt(card.tokenId)],
                    blockNumber: ctx.block
                  })
                ).toString()
              }))
            )
          : null;
        return {
          cards: matches
            ? matches.filter(
                (card) =>
                  !card.graded && !card.reservedBy && card.portalWitness !== "0"
              )
            : a
              ? cards.filter(
                  (b) =>
                    !b.graded &&
                    !b.reservedBy &&
                    fusionCompatible(a, b) &&
                    (singularityEnabled || !singularityCompatible(a, b))
                )
              : cards,
          nextAfter:
            rows.length > 12 ? nextPage(rows[11].token, scope, ctx) : null,
          block: ctx.block,
          hash: ctx.hash
        };
      })
    );
  });
  router.get("/v1/evolution/collection", async (c) => {
    const rawPage = c.req.query("after");
    const owner = c.req.query("owner")?.toLowerCase() ?? null;
    if (owner && !isAddress(owner))
      throw new PortalUserError("Invalid owner.", 400);
    const scope = `collection:${owner ?? "all"}`;
    return reply(
      await snapshot(async (r, db, ctx) => {
        const after = await readPage(rawPage, scope, r, ctx);
        const rows = (
          await db.query<{ value: Record<string, unknown> }>(
            `SELECT value FROM (
        SELECT DISTINCT ON(entity) value FROM ${ctx.schema}.evolution_projection_version
        WHERE deployment=$1 AND domain='card' AND block_number<=$2
        ORDER BY entity,block_number DESC,transaction_index DESC,log_index DESC
      ) c WHERE (value->>'level')::integer>0 AND value->>'burned'='false' AND (value->>'tokenId')::numeric>$3 AND ($4::text IS NULL OR lower(value->>'owner')=$4)
      ORDER BY (value->>'tokenId')::numeric LIMIT 13`,
            [ctx.deployment, ctx.block.toString(), after, owner]
          )
        ).rows;
        return {
          cards: await Promise.all(
            rows
              .slice(0, 12)
              .map((row) =>
                r.chain.card(BigInt(String(row.value.tokenId)), ctx.block)
              )
          ),
          nextAfter:
            rows.length > 12
              ? nextPage(String(rows[11].value.tokenId), scope, ctx)
              : null
        };
      })
    );
  });
  router.get("/v1/evolution/crew", async () =>
    reply(
      await snapshot(async (r, _db, ctx) => {
        const head = await r.chain.client.getBlock();
        const day = Number(head.timestamp / 86400n);
        const [enabled, rule] = await Promise.all([
          r.chain.client.readContract({
            address: ctx.adventures as Address,
            abi: adventureAbi,
            functionName: "crewMode",
            blockNumber: head.number
          }),
          r.chain.client.readContract({
            address: ctx.adventures as Address,
            abi: adventureAbi,
            functionName: "dailyCrew",
            args: [BigInt(day)],
            blockNumber: head.number
          })
        ]);
        return {
          enabled,
          day,
          timestamp: Number(head.timestamp),
          requestId: rule[0].toString(),
          color: rule[1],
          monsterType: rule[2],
          ready: rule[3]
        };
      })
    )
  );
  router.get("/v1/evolution/quote", async (c) => {
    const id = BigInt(uint.parse(c.req.query("tokenId")));
    const kind = z
      .enum(["adventure", "serum", "fusion"])
      .parse(c.req.query("kind"));
    const owner = c.req.query("owner");
    if (!owner || !isAddress(owner))
      throw new PortalUserError("Connect the card owner's wallet.", 400);
    const partnerId =
      kind === "fusion" ? BigInt(uint.parse(c.req.query("partnerId"))) : null;
    const crew =
      kind === "adventure"
        ? z.array(uint).length(3).parse(c.req.query("crew")?.split(","))
        : null;
    const crewDay =
      kind === "adventure"
        ? z.coerce.number().int().positive().parse(c.req.query("day"))
        : null;
    return reply(
      await snapshot(async (r, _db, ctx) => {
        // Quotes use live state, while the global indexer must be healthy at a canonical boundary.
        const head = await r.chain.client.getBlock();
        const cards = await Promise.all(
          (crew
            ? crew.map(BigInt)
            : [id, ...(partnerId ? [partnerId] : [])].sort((a, b) =>
                a < b ? -1 : 1
              )
          ).map((v) => r.chain.card(v, head.number))
        );
        for (const card of cards) {
          if (card.owner.toLowerCase() !== owner.toLowerCase())
            throw new PortalUserError(
              "You must own every crew or input card.",
              409
            );
          if (card.graded)
            throw new PortalUserError(
              "Graded cards cannot adventure, drink serums or fuse.",
              409
            );
          if (card.reservedBy || card.pendingGrade)
            throw new PortalUserError(
              "This card already has a pending action.",
              409
            );
        }
        const a =
          kind === "adventure"
            ? cards.find((card) => card.tokenId === id.toString())
            : cards[0];
        const b = cards[1];
        if (!a)
          throw new PortalUserError("Choose a survivor from your crew.", 400);
        let crewRules;
        if (crew) {
          if (crewDay !== Number(head.timestamp / 86400n))
            throw new PortalUserError(
              "The daily requirements changed. Review a new crew.",
              409
            );
          const [enabled, rule] = await Promise.all([
            r.chain.client.readContract({
              address: ctx.adventures as Address,
              abi: adventureAbi,
              functionName: "crewMode",
              blockNumber: head.number
            }),
            r.chain.client.readContract({
              address: ctx.adventures as Address,
              abi: adventureAbi,
              functionName: "dailyCrew",
              args: [BigInt(crewDay!)],
              blockNumber: head.number
            })
          ]);
          if (!enabled || !rule[3])
            throw new PortalUserError(
              "Today's crew requirements are not ready.",
              409
            );
          crewRules = { day: crewDay!, color: rule[1], monsterType: rule[2] };
          const error = crewEligibility(cards, crewRules);
          if (error) throw new PortalUserError(error, 409);
          if (
            cards.some((card) => card.nextAdventureAt > Number(head.timestamp))
          )
            throw new PortalUserError(
              "A crew member is still on its 24-hour cooldown.",
              409
            );
        }
        if (kind === "adventure" && a.nextAdventureAt > Number(head.timestamp))
          throw new PortalUserError(
            "This card's 24-hour cooldown has not ended.",
            409
          );
        if (kind === "serum" && (!a.unused || a.localDoses >= 11))
          throw new PortalUserError(
            "A serum and an available dose slot are required.",
            409
          );
        if (kind === "fusion" && !fusionCompatible(a, b))
          throw new PortalUserError("These cards cannot fuse.", 409);
        if (kind === "fusion")
          await r.chain.fusionLevel(
            BigInt(a.tokenId),
            BigInt(b.tokenId),
            head.number
          );
        const target = (
          kind === "adventure" ? ctx.adventures : ctx.evolution
        ) as Address;
        const fees = await r.chain.client.estimateFeesPerGas({
          chain: r.chain.client.chain,
          type: "eip1559"
        });
        const needsVrf =
          kind === "adventure" ||
          kind === "fusion" ||
          (kind === "serum" && a.finish === 0);
        const vrf = needsVrf
          ? await r.chain.client.readContract({
              address: target,
              abi: adventureAbi,
              functionName: "quoteRandomness",
              args: [fees.maxFeePerGas]
            })
          : 0n;
        const maximum = (vrf * 125n + 99n) / 100n;
        const deadline =
          crewDay === null
            ? head.timestamp + 300n
            : head.timestamp + 300n < BigInt(crewDay + 1) * 86400n
              ? head.timestamp + 300n
              : BigInt(crewDay + 1) * 86400n - 1n;
        const expected = (card: typeof a) => ({
          artVersion: BigInt(card.artVersion),
          historyHash: card.historyHash
        });
        const fee =
          kind === "adventure"
            ? 0n
            : await r.chain.client.readContract({
                address: target,
                abi: evolutionAbi,
                functionName:
                  kind === "serum" ? "serumApplicationFee" : "fusionFee",
                blockNumber: head.number
              });
        let data;
        if (kind === "adventure") {
          data = encodeFunctionData({
            abi: adventureAbi,
            functionName: "crewAdventure",
            args: [
              crew!.map(BigInt) as [bigint, bigint, bigint],
              id,
              BigInt(crewDay!),
              crewRulesHash,
              maximum,
              deadline
            ]
          });
        } else if (kind === "serum")
          data = encodeFunctionData({
            abi: evolutionAbi,
            functionName: "consumeSerum",
            args: [id, expected(a), a.unused!, fee, maximum, deadline]
          });
        else
          data = encodeFunctionData({
            abi: evolutionAbi,
            functionName: "fuse",
            args: [
              BigInt(a.tokenId),
              BigInt(b.tokenId),
              expected(a),
              expected(b),
              fee,
              maximum,
              deadline
            ]
          });
        // Fee approval may still be needed; the wallet simulates the full call after approval.
        return {
          kind,
          cards,
          to: target,
          data,
          value: maximum,
          fee,
          fees: {
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas
          },
          deadline,
          chainId: r.portal.chain.deployment.chainId,
          usdc: r.portal.chain.deployment.usdc,
          crew: crewRules,
          odds:
            kind === "adventure"
              ? crewAdventureOdds(a.effectiveSequence)
              : adventureOdds(a.effectiveSequence),
          block: head.number,
          confirmedBlock: ctx.block
        };
      })
    );
  });
  const assetResponse = async (file: string, artwork?: string) => {
    const asset = await readPublishedEvolutionAsset(getAssets(), file, artwork);
    return new Response(Uint8Array.from(asset.bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*"
      }
    });
  };
  router.get("/v1/evolution/assets/:file", (c) =>
    assetResponse(c.req.param("file"))
  );
  router.get("/v1/evolution/layers/:artwork/:file", (c) =>
    assetResponse(c.req.param("file"), c.req.param("artwork"))
  );
  app.route("/", router);
}
