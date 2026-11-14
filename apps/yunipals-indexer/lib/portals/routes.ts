import { registerPortalMintRoutes } from "./mint-routes.js";
import { portalReadiness } from "./readiness.js";
import { portalHealth } from "./health.js";
import { publicPortalCard, publishedPortalArtifact } from "./publication.js";
import { registerPortalEvidenceRoutes } from "./action-evidence.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  BaseError,
  ContractFunctionRevertedError,
  isAddress,
  type Address,
  type Hex
} from "viem";
import {
  portalColorNames,
  portalTypeNames,
  portalSpellCommitment,
  portalSpellSigningData,
  portalAuthorLinkSigningData
} from "@protopals/yunipals-market-core/portals";
import { portalJson, portalCardAbi } from "./chain.js";
import { PortalSourceError, PortalUserError } from "./errors.js";
import { createPortalRuntime, type PortalRuntime } from "./runtime.js";
import { registerPortalOwnerRoutes } from "./owner-routes.js";
import { readCompetition, readCompetitionBatch } from "./competition.js";
import { portalCompetitionAbi } from "@protopals/yunipals-market-core/portalAbi";

const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine((s) => BigInt(s) < 2n ** 256n);
const uint64 = uint.refine((s) => BigInt(s) < 2n ** 64n);
const address = z.string().refine((s) => isAddress(s));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const signature = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .max(16384);
const upload = z
  .object({
    submitter: address,
    tokenId: uint,
    artVersion: uint64,
    nonce: uint,
    spell: z
      .string()
      .min(1)
      .max(6000)
      .refine((s) => s.trim().length > 0),
    salt: hash,
    expiresAt: uint64,
    signature,
    requestId: uint.optional(),
    admissionHash: hash.optional()
  })
  .strict();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(portalJson(value)), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

export function registerPortalRoutes(
  app: Hono,
  options: {
    runtime?: () => Promise<PortalRuntime>;
    enabled?: () => boolean;
  } = {}
) {
  const router = new Hono();
  router.onError((error, c) => {
    if (error instanceof PortalUserError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json({ error: "Invalid portal request." }, 400);
    const code =
      error instanceof PortalSourceError
        ? error.code
        : "dependency_unavailable";
    // Never log RPC URLs, SQL parameters, provider responses or private spells.
    console.error(
      JSON.stringify({
        event: "portal_read_unavailable",
        code,
        method: c.req.method,
        path: c.req.path
      })
    );
    const response = json(
      { error: "Portals are temporarily unavailable. Please try again.", code },
      503
    );
    response.headers.set("Retry-After", "5");
    response.headers.set("Access-Control-Expose-Headers", "Retry-After");
    return response;
  });
  let runtime: Promise<PortalRuntime> | undefined;
  const enabled =
    options.enabled ?? (() => process.env.PORTALS_ENABLED === "true");
  const get = () =>
    (runtime ??= (options.runtime ?? createPortalRuntime)().catch((error) => {
      runtime = undefined;
      throw error;
    }));
  router.use(
    "/v1/portals/*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: "Spell upload is too large." }, 413)
    })
  );
  router.use("/v1/portals/*", async (c, next) => {
    if (c.req.method === "GET" && c.req.path === "/v1/portals") return next();
    if (!enabled())
      return c.json({ error: "Portals are being prepared." }, 503);
    if (c.req.method === "GET" && c.req.path === "/v1/portals/health")
      return next();
    // Private intake remains available while shared indexing catches up.
    if (
      c.req.method === "POST" &&
      ["/v1/portals/spells", "/v1/portals/authors/link"].includes(c.req.path)
    )
      return next();
    const value = await get();
    await value.ledger.snapshot(next);
  });
  registerPortalOwnerRoutes(router, get);
  registerPortalMintRoutes(router, get);
  registerPortalEvidenceRoutes(router, get);
  router.get("/v1/portals/health", async () => {
    const health = await portalHealth(await get());
    return json(health, health.ready ? 200 : 503);
  });
  async function competitionSnapshot() {
    const runtime = await get();
    const cursor = await runtime.ledger.cursor();
    if (!cursor || (await runtime.ledger.requiresReplay()))
      throw new PortalUserError(
        "Competition data is being indexed. You can still resolve prizes using the competition number.",
        503
      );
    const block = await runtime.chain.client.getBlock({
      blockNumber: BigInt(cursor.block)
    });
    if (block.hash !== cursor.hash)
      throw new PortalUserError(
        "Competition history is being refreshed after a chain change.",
        503
      );
    const unchanged = async () => {
      const current = await runtime.ledger.cursor();
      if (
        current?.generation !== cursor.generation ||
        (await runtime.chain.client.getBlock({ blockNumber: block.number }))
          .hash !== cursor.hash
      )
        throw new PortalUserError(
          "Competition history changed. Please refresh.",
          503
        );
    };
    return { ...runtime, block, unchanged };
  }
  router.get("/v1/portals/competitions", async (c) => {
    const { chain, block, unchanged } = await competitionSnapshot();
    const competition = await readCompetition(
      chain.client,
      chain.deployment.grading,
      block.number
    );
    if (!competition)
      return json({
        competition: null,
        batches: [],
        asOfBlock: block.number,
        asOfBlockHash: block.hash
      });
    const before = c.req.query("before")
      ? BigInt(uint.parse(c.req.query("before")))
      : competition.batchCount + 1n;
    if (before === 0n)
      throw new PortalUserError("Invalid competition page.", 400);
    const end =
      before <= competition.batchCount ? before - 1n : competition.batchCount;
    const count = Math.min(6, Number(end > 6n ? 6n : end));
    const batches = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        readCompetitionBatch(
          chain.client,
          competition.address,
          end - BigInt(i),
          block.number
        )
      )
    );
    await unchanged();
    return json({
      competition,
      batches,
      nextBefore: end > BigInt(count) ? end - BigInt(count) + 1n : null,
      asOfBlock: block.number,
      asOfBlockHash: block.hash
    });
  });
  router.get("/v1/portals/competitions/:id", async (c) => {
    const { chain, block, unchanged } = await competitionSnapshot();
    const competition = await readCompetition(
      chain.client,
      chain.deployment.grading,
      block.number
    );
    const id = BigInt(uint.parse(c.req.param("id")));
    if (!competition || id === 0n || id > competition.batchCount)
      throw new PortalUserError("Competition not found.", 404);
    const batch = await readCompetitionBatch(
      chain.client,
      competition.address,
      id,
      block.number
    );
    await unchanged();
    return json({
      competition,
      batch,
      asOfBlock: block.number,
      asOfBlockHash: block.hash
    });
  });
  router.get("/v1/portals", async () => {
    if (!enabled()) return json({ enabled: false });
    try {
      const runtime = await get();
      const status = await runtime.chain.active();
      return json({
        enabled: true,
        ...status,
        ...(await portalReadiness(runtime, status))
      });
    } catch {
      return json(
        { error: "Portals are temporarily unavailable. Please try again." },
        503
      );
    }
  });
  router.get("/v1/portals/quote", async (c) => {
    const tokenId = uint.parse(c.req.query("tokenId"));
    const owner = address.parse(c.req.query("owner"));
    const runtime = await get();
    const quote = await runtime.chain.quote(BigInt(tokenId), owner as Address);
    const readiness = await portalReadiness(runtime, quote);
    if (readiness.indexing)
      throw new PortalUserError(
        "Portal updates are being indexed. Please wait before reviewing a new spell.",
        503
      );
    return json({ ...quote, ...readiness });
  });
  router.post("/v1/portals/spells", async (c) => {
    const data = upload.parse(await c.req.json());
    const { chain, store, intake } = await get();
    if (data.admissionHash && (data.requestId || !intake))
      throw new PortalUserError(
        "Private spell acknowledgements are unavailable. Please try again later.",
        503
      );
    const now = Number((await chain.client.getBlock()).timestamp);
    const expires = Number(data.expiresAt);
    if (expires <= now || expires > now + 900)
      throw new PortalUserError(
        "The spell signature expired. Please sign again."
      );
    const input = {
      chainId: chain.deployment.chainId,
      grading: chain.deployment.grading,
      submitter: data.submitter as Address,
      tokenId: BigInt(data.tokenId),
      artVersion: BigInt(data.artVersion),
      nonce: BigInt(data.nonce),
      spell: data.spell,
      salt: data.salt as Hex
    };
    const commitment = portalSpellCommitment(input);
    const signed = portalSpellSigningData(input, BigInt(data.expiresAt));
    if (
      !(await chain.client.verifyTypedData({
        address: input.submitter,
        ...signed,
        signature: data.signature as Hex
      }))
    )
      throw new PortalUserError("Invalid spell signature.");
    if (data.requestId) {
      const request = await chain.request(BigInt(data.requestId));
      if (
        request.submitter.toLowerCase() !== data.submitter.toLowerCase() ||
        request.spellCommitment !== commitment
      )
        throw new PortalUserError(
          "The spell does not match the accepted request."
        );
    } else {
      const [owner, nonce] = await Promise.all([
        chain.owner(input.tokenId),
        chain.nonce(input.submitter)
      ]);
      if (
        owner.toLowerCase() !== data.submitter.toLowerCase() ||
        nonce !== input.nonce
      )
        throw new PortalUserError(
          "Card ownership or spell nonce changed. Please prepare the spell again."
        );
    }
    await store.saveSpell({
      commitment,
      submitter: data.submitter.toLowerCase(),
      tokenId: data.tokenId,
      artVersion: data.artVersion,
      nonce: data.nonce,
      spell: data.spell,
      salt: data.salt
    });
    const receipt = data.admissionHash
      ? await intake!.issue(chain, store, {
          ...input,
          commitment,
          expiresAt: BigInt(data.expiresAt),
          admissionHash: data.admissionHash as Hex
        })
      : undefined;
    return json({ commitment, ...(receipt ? { receipt } : {}) });
  });
  router.post("/v1/portals/authors/link", async (c) => {
    const data = z
      .object({
        left: address,
        right: address,
        leftSignature: signature,
        rightSignature: signature
      })
      .strict()
      .parse(await c.req.json());
    const { chain, store } = await get();
    const signed = portalAuthorLinkSigningData(
      chain.deployment.chainId,
      chain.deployment.grading,
      data.left as Address,
      data.right as Address
    );
    if (signed.message.left === signed.message.right)
      throw new PortalUserError("Choose two different wallets.");
    const ordered =
      data.left.toLowerCase() === signed.message.left.toLowerCase();
    const leftSignature = ordered ? data.leftSignature : data.rightSignature;
    const rightSignature = ordered ? data.rightSignature : data.leftSignature;
    const valid = await Promise.all([
      chain.client.verifyTypedData({
        address: signed.message.left,
        ...signed,
        signature: leftSignature as Hex
      }),
      chain.client.verifyTypedData({
        address: signed.message.right,
        ...signed,
        signature: rightSignature as Hex
      })
    ]);
    if (valid.some((v) => !v))
      throw new PortalUserError("Both wallets must sign the author link.");
    await store.linkAuthors(
      signed.message.left,
      signed.message.right,
      leftSignature,
      rightSignature
    );
    return json({ linked: true });
  });
  router.get("/v1/portals/cards/:file", async (c) => {
    const file = c.req.param("file");
    const match = /^(0|[1-9][0-9]{0,77})(\.json)?$/.exec(file);
    if (!match) throw new PortalUserError("Invalid card ID.");
    const runtime = await get();
    const { chain } = runtime;
    const token = BigInt(uint.parse(match[1]));
    const before = c.req.query("before");
    const card = await chain.card(
      token,
      before ? BigInt(uint.parse(before)) : undefined,
      match[2] ? 1 : 10
    );
    const published = await publicPortalCard(runtime, card);
    if (!match[2]) return json(published);
    try {
      await chain.owner(token, card.asOfBlock);
    } catch (error) {
      const reverted =
        error instanceof BaseError
          ? error.walk(
              (cause) => cause instanceof ContractFunctionRevertedError
            )
          : null;
      if (
        reverted instanceof ContractFunctionRevertedError &&
        reverted.data?.errorName === "ERC721NonexistentToken"
      )
        throw new PortalUserError(
          "This card no longer exists. Its grading history remains available.",
          404
        );
      throw error;
    }
    const [sequence, mintedAt, known] = card.facts;
    if (!known)
      throw new PortalUserError("Card metadata is being prepared.", 503);
    const [packId, originalId, variantId, traits, original] = card.provenance;
    const origin = await chain.client.readContract({
      address: chain.deployment.cards,
      abi: portalCardAbi,
      functionName: "cardFacts",
      args: [originalId],
      blockNumber: card.asOfBlock
    });
    if (!origin[2])
      throw new PortalUserError(
        "Original card metadata is being prepared.",
        503
      );
    const [artwork, version] = await chain.input(token, card.asOfBlock);
    const latest = card.history[card.history.length - 1];
    const display = published.publication.find(
      (row) => row.requestId === latest?.id.toString()
    );
    if (
      version > 0n &&
      (!display || display.result.slab.version !== version.toString())
    )
      throw new PortalUserError(
        "The graded card is being indexed and published. Please try again shortly.",
        503
      );
    return json({
      name: `${portalTypeNames[traits.monsterType - 1] ?? "Yunipal"} #${token}`,
      description:
        "A Yunipals TCG card with onchain traits and artwork history.",
      image: display?.result.slab.uri ?? artwork.uri,
      attributes: [
        { trait_type: "Type", value: portalTypeNames[traits.monsterType - 1] },
        { trait_type: "Color", value: portalColorNames[traits.color - 1] },
        { trait_type: "Horn", value: traits.horn === 2 ? "Diamond" : "Spiral" },
        { trait_type: "Glitter", value: traits.glitter === 1 ? "Yes" : "No" },
        { trait_type: "Original", value: original ? "Yes" : "No" },
        { trait_type: "Sequence", display_type: "number", value: sequence },
        { trait_type: "Born", display_type: "date", value: Number(mintedAt) },
        {
          trait_type: "Birth day",
          display_type: "number",
          value: Number((mintedAt - origin[1]) / 86400n)
        },
        ...(latest
          ? ["Creativity", "Harmony", "Craft", "Impact"].map((label, i) => ({
              trait_type: label,
              display_type: "number",
              value: latest.result.scores[i]
            }))
          : [])
      ],
      yunipals: {
        packTypeId: packId,
        originalId,
        variantId,
        version,
        pendingRequest: card.pending,
        artworkHash: artwork.hash,
        rawArtworkURI: artwork.uri,
        slab: display?.result.slab ?? null,
        historyCount: card.historyCount,
        latestRequest: latest?.id ?? null,
        grader: latest?.grader ?? null,
        reportURI: latest?.result.reportURI ?? null,
        reportHash: latest?.result.reportHash ?? null,
        copied: latest?.result.copied ?? false
      }
    });
  });
  router.get("/v1/portals/assets/:file", async (c) => {
    const match = /^([0-9a-f]{64})\.(png|json)$/.exec(c.req.param("file"));
    if (!match) throw new PortalUserError("Invalid asset reference.", 404);
    const runtime = await get();
    const { store, assets, chain } = runtime;
    let published = await publishedPortalArtifact(runtime, match[1]);
    if (!published && match[2] === "json") {
      const rows = await store.db.query<{ pool: Address; batch: string }>(
        "SELECT pool,batch_id::text AS batch FROM portal_v4_theme_job WHERE deployment=$1 AND progress->'artifact'->>'hash'=$2 LIMIT 1",
        [store.deployment, `0x${match[1]}`]
      );
      const row = rows.rows[0];
      if (row) {
        const head = await chain.client.getBlockNumber();
        const confirmations = BigInt(process.env.PORTALS_CONFIRMATIONS ?? "12");
        const cursor = await runtime.ledger.cursor();
        if (
          cursor &&
          head >= confirmations &&
          (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
            .hash === cursor.hash
        ) {
          const safe =
            head - confirmations < BigInt(cursor.block)
              ? head - confirmations
              : BigInt(cursor.block);
          const theme = await chain.client.readContract({
            address: row.pool,
            abi: portalCompetitionAbi,
            functionName: "getTheme",
            args: [BigInt(row.batch)],
            blockNumber: safe
          });
          const indexed = await runtime.ledger.db.query(
            "SELECT 1 FROM portal_v5_state WHERE deployment=$1 AND source=$2 AND component='theme' AND entity_id=$3 AND value->>'themeHash'=$4 AND block_number<=$5",
            [
              runtime.ledger.deployment,
              row.pool.toLowerCase(),
              row.batch,
              theme.hash,
              safe.toString()
            ]
          );
          published =
            theme.artifactHash === `0x${match[1]}` &&
            indexed.rows.length === 1 &&
            (await runtime.ledger.cursor())?.generation === cursor.generation &&
            (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
              .hash === cursor.hash;
        }
      }
    }
    if (!published) throw new PortalUserError("Asset not found.", 404);
    const bytes = await assets.read(match[1], match[2] as "png" | "json");
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": match[2] === "png" ? "image/png" : "application/json",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      }
    });
  });
  app.route("/", router);
}
