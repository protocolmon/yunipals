import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isAddress, type Address, type Hex } from "viem";
import {
  ARENA_ENTRY_FEE,
  ARENA_STRATEGY_LIMIT,
  ARENA_USDC
} from "@protopals/yunipals-market-core/arena";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { digest } from "./crypto";
import type { AdmissionRequest } from "./admission";
import {
  ArenaClientTransactions,
  transactionAction
} from "./clientTransactions";

const cookie = "__Host-yunipals-arena";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ArenaRequestError(400, "Expected a JSON object.");
  return value as Record<string, unknown>;
}
function hex(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{2,8192}$/.test(value) ||
    value.length % 2 !== 0
  )
    throw new ArenaRequestError(400, "Invalid signature or salt.");
  return value as Hex;
}
function id(value: string) {
  if (!/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n)
    throw new ArenaRequestError(400, "Invalid tournament ID.");
  return value;
}

export function createArenaApp(
  service: ArenaIntake,
  options: {
    entriesEnabled: boolean;
    admit?: (
      id: string,
      wallet: Address,
      input: AdmissionRequest
    ) => Promise<unknown>;
    context?: (id: string) => Promise<unknown>;
    strategyReady?: (id: string) => Promise<boolean>;
    media?: {
      status: (id: string) => Promise<unknown>;
      artifact: (
        id: string,
        name: string,
        range?: string,
        selector?: { incarnation?: string; publication?: string }
      ) => Promise<Response>;
    };
  }
) {
  const app = new Hono();
  const transactions = new ArenaClientTransactions(service);
  app.use(
    "*",
    bodyLimit({
      maxSize: 16_384,
      onError: (c) => c.json({ error: "Request is too large." }, 413)
    })
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Origin");
    c.header("X-Content-Type-Options", "nosniff");
    const origin = c.req.header("Origin");
    if (origin && origin !== service.origin)
      return c.json({ error: "Origin is not allowed." }, 403);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      origin !== service.origin
    )
      return c.json({ error: "Origin is required." }, 403);
    if (origin === service.origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
    }
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      return c.body(null, 204);
    }
    if (
      c.req.method === "POST" &&
      !c.req.header("Content-Type")?.startsWith("application/json")
    )
      return c.json({ error: "Use application/json." }, 415);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ArenaRequestError)
      return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return c.json({ error: "Invalid JSON." }, 400);
    // Never serialize request bodies, signatures, credentials or upstream errors.
    return c.json({ error: "Arena service is temporarily unavailable." }, 503);
  });
  app.get("/health", async (c) => {
    await service.ready();
    return c.json({
      ok: true,
      indexerMode: service.indexerMode,
      sourceKind: service.sourceSelection?.kind ?? service.indexerMode,
      sourceEpoch: service.sourceSelection?.epoch ?? null,
      sourceId: service.sourceSelection?.sourceId ?? null
    });
  });
  app.get("/config", (c) =>
    c.json({
      chainId: 8453,
      contract: service.contract,
      paymentToken: ARENA_USDC,
      entryFee: ARENA_ENTRY_FEE.toString(),
      strategyMaxLength: ARENA_STRATEGY_LIMIT,
      entriesEnabled: options.entriesEnabled,
      indexerMode: service.indexerMode,
      sourceKind: service.sourceSelection?.kind ?? service.indexerMode,
      sourceEpoch: service.sourceSelection?.epoch ?? null,
      confirmationPolicy:
        service.indexerMode === "unified" ? "latest" : "finalized"
    })
  );
  app.post("/auth/challenge", async (c) => {
    const body = object(await c.req.json());
    if (typeof body.wallet !== "string" || !isAddress(body.wallet))
      throw new ArenaRequestError(400, "Invalid wallet address.");
    return c.json(await service.challenge(body.wallet));
  });
  app.post("/auth/verify", async (c) => {
    const body = object(await c.req.json());
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id))
      throw new ArenaRequestError(400, "Invalid challenge.");
    const result = await service.authenticate(body.id, hex(body.signature));
    setCookie(c, cookie, result.token, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 86400
    });
    return c.json({ wallet: result.wallet });
  });
  app.post("/auth/logout", async (c) => {
    const token = getCookie(c, cookie);
    if (token)
      await service.pool.query(
        "DELETE FROM yunipals_arena.session WHERE token_hash=$1 AND deployment=$2",
        [digest(token), service.deployment]
      );
    deleteCookie(c, cookie, { secure: true, path: "/" });
    return c.json({ ok: true });
  });
  app.get("/me", async (c) => {
    const wallet = await service.wallet(getCookie(c, cookie));
    const credit = await service.balance(wallet);
    return c.json({ wallet, claimable: credit });
  });
  app.post("/transactions", async (c) => {
    const wallet = await service.wallet(getCookie(c, cookie));
    const body = object(await c.req.json());
    if (typeof body.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(body.hash))
      throw new ArenaRequestError(400, "Invalid transaction hash.");
    return c.json(
      await transactions.register(
        wallet,
        body.hash as Hex,
        transactionAction(body.action)
      )
    );
  });
  app.get("/transactions/:hash", async (c) => {
    const wallet = await service.wallet(getCookie(c, cookie));
    const hash = c.req.param("hash");
    if (!/^0x[0-9a-f]{64}$/i.test(hash))
      throw new ArenaRequestError(400, "Invalid transaction hash.");
    return c.json(await transactions.read(wallet, hash as Hex));
  });
  app.get("/tournaments", async (c) => {
    const wallet = c.req.query("wallet");
    if (wallet && !isAddress(wallet))
      throw new ArenaRequestError(400, "Invalid wallet address.");
    const ids = await service.listIds(wallet);
    return c.json({
      items: await Promise.all(ids.map((id) => service.publicView(id)))
    });
  });
  app.get("/tournaments/:id", async (c) =>
    c.json(await service.publicView(id(c.req.param("id"))))
  );
  app.get("/tournaments/:id/context", async (c) => {
    if (!options.context)
      throw new ArenaRequestError(503, "Arena details are still loading.");
    return c.json(await options.context(id(c.req.param("id"))));
  });
  app.get("/tournaments/:id/media", async (c) =>
    c.json(
      options.media
        ? await options.media.status(id(c.req.param("id")))
        : { state: "waiting", filmSha256: null }
    )
  );
  app.get("/tournaments/:id/artifacts/:name", async (c) => {
    if (!options.media)
      throw new ArenaRequestError(404, "Published video artifact not found.");
    const incarnation = c.req.query("origin"),
      publication = c.req.query("publication");
    if (
      [incarnation, publication].some(
        (value) => value !== undefined && !/^0x[0-9a-f]{64}$/.test(value)
      )
    )
      throw new ArenaRequestError(400, "Invalid Arena video selection.");
    return options.media.artifact(
      id(c.req.param("id")),
      c.req.param("name"),
      c.req.header("Range"),
      { incarnation, publication }
    );
  });
  app.get("/tournaments/:id/result", async (c) => {
    const selectedId = id(c.req.param("id")),
      context = await service.tournamentContext(selectedId);
    const row = (
      await service.pool.query<{
        candidate: unknown;
        outcome_hash: string;
        input_hash: string;
      }>(
        `SELECT a.candidate,a.outcome_hash,a.input_hash FROM yunipals_arena.adjudication a
       WHERE a.deployment=$1 AND a.tournament_id=$2 AND a.incarnation=$3 AND $4='settled'
         AND a.state='valid' AND a.outcome_hash=$5 AND a.input_hash=$6`,
        [
          service.deployment,
          selectedId,
          context.incarnation,
          context.state.phase,
          context.state.resultHash,
          context.state.inputHash
        ]
      )
    ).rows[0];
    if (!row)
      throw new ArenaRequestError(404, "The result has not been settled yet.");
    return c.json({
      incarnation: context.incarnation,
      outcome: row.candidate,
      outcomeHash: row.outcome_hash,
      inputHash: row.input_hash
    });
  });
  app.post("/tournaments/:id/admission", async (c) => {
    if (!options.entriesEnabled || !options.admit)
      throw new ArenaRequestError(503, "Paid entry is not open yet.");
    const wallet = await service.wallet(getCookie(c, cookie));
    const body = object(await c.req.json());
    if (
      typeof body.nftChainId !== "number" ||
      typeof body.collection !== "string" ||
      !isAddress(body.collection) ||
      typeof body.tokenId !== "string"
    )
      throw new ArenaRequestError(400, "Invalid NFT details.");
    return c.json(
      await options.admit(id(c.req.param("id")), wallet, {
        nftChainId: body.nftChainId,
        collection: body.collection,
        tokenId: body.tokenId,
        ...(typeof body.incarnation === "string"
          ? { incarnation: body.incarnation }
          : {})
      })
    );
  });
  app.post("/tournaments/:id/strategies", async (c) => {
    const wallet = await service.wallet(getCookie(c, cookie));
    const body = object(await c.req.json());
    if (
      options.strategyReady &&
      !(await options.strategyReady(id(c.req.param("id"))))
    )
      throw new ArenaRequestError(
        503,
        "The arena and fighter snapshots are still loading. Your strategy has not been submitted."
      );
    if (
      typeof body.seat !== "number" ||
      !Number.isInteger(body.seat) ||
      body.seat < 0 ||
      body.seat > 3 ||
      typeof body.text !== "string"
    )
      throw new ArenaRequestError(400, "Invalid strategy submission.");
    return c.json(
      await service.submit(id(c.req.param("id")), wallet, {
        seat: body.seat,
        text: body.text,
        salt: hex(body.salt),
        signature: hex(body.signature),
        ...(typeof body.incarnation === "string"
          ? { incarnation: body.incarnation }
          : {})
      })
    );
  });
  return app;
}
