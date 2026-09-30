import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { hex, record } from "@protopals/yunipals-market-core/validation";

import type { Environment } from "@/environment";
import type { BnbAdmissionService } from "@/bnb/admission";
import type { BnbFulfillmentService } from "@/bnb/fulfillment";
import { BnbOrderError, type BnbPolicy } from "@/bnb/orders";
import { bnbOrderIdentity, type BnbRecoveryService } from "@/bnb/recovery";
import { createWorkGate } from "@/http/gate";
import { databaseErrorCode, databaseUnavailable } from "@/db/failure";
import {
  createReadDiagnostics,
  readDiagnostics,
  readFailureContext
} from "@/reads/diagnostics";
import { readAssetIdentity, type OrderReadService } from "@/reads/orders";
import type { CatalogService } from "@/reads/catalog";
import type { ActivityReadService } from "@/reads/activity";
import type { OpenSeaRecoveryService } from "@/opensea/recovery";
import type { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import type { OpenSeaAdmissionService } from "@/opensea/admission";
import { OpenSeaOrderError, parseOpenSeaOrderRequest } from "@/opensea/orders";
import type { CapabilityHealthService } from "@/capabilityHealth";
import type { BnbDiscoveryReadService } from "@/reads/bnbDiscovery";

type AppEnvironment = { Bindings: Partial<HttpBindings> };
const defaultOperationTimeoutMs = 12000;
const tradingOperationTimeoutMs = 45000;
export type MarketServices = {
  bnbDiscovery?: Pick<BnbDiscoveryReadService, "list"> &
    Partial<Pick<BnbDiscoveryReadService, "status">>;
  capabilityHealth?: Pick<CapabilityHealthService, "current">;
  openseaFulfillment?: Pick<OpenSeaFulfillmentService, "preflight" | "quote"> &
    Partial<Pick<OpenSeaFulfillmentService, "prepare">>;
  openseaRecovery?: Pick<OpenSeaRecoveryService, "accepted" | "cancellation">;
  openseaValidation?: Pick<
    OpenSeaAdmissionService,
    "prepare" | "submit" | "policy"
  >;
  activity?: Pick<ActivityReadService, "wallet" | "asset">;
  catalog?: Pick<CatalogService, "tokens"> &
    Partial<Pick<CatalogService, "tokensV2">>;
  reads?: Pick<OrderReadService, "wallet" | "asset"> &
    Partial<Pick<OrderReadService, "assetV2">>;
  recovery?: Pick<BnbRecoveryService, "accepted" | "cancellation">;
  bnbValidation?: {
    admission?: Pick<BnbAdmissionService, "prepare" | "submit">;
    policy: BnbPolicy;
    fulfillment?: Pick<BnbFulfillmentService, "preflight" | "quote">;
  };
};

function isOpenSeaName(value: string): value is OpenSeaChain {
  return value === "ethereum" || value === "base" || value === "polygon";
}

export function createApp(
  environment: Environment,
  ready: () => Promise<void>,
  services: MarketServices = {}
) {
  const productionOpenSea = (chain: OpenSeaChain) =>
    environment.deployment === "production" &&
    environment.productionTrading?.openSea?.rpcUrls[chain] !== undefined;
  const productionBnb =
    environment.deployment === "production" &&
    environment.productionTrading?.bnb !== undefined;
  if (
    (services.openseaValidation || services.openseaFulfillment) &&
    !(
      (environment.deployment === "staging" && environment.openseaValidation) ||
      (environment.deployment === "production" &&
        environment.productionTrading?.openSea)
    )
  )
    throw new Error(
      "OpenSea admission and fulfillment require explicit validation or a production runtime."
    );
  if (
    services.bnbValidation &&
    !(
      (environment.deployment === "staging" && environment.bnbValidationRpc) ||
      productionBnb
    )
  )
    throw new Error("BNB admission requires an explicit validated runtime.");
  if (
    environment.bnbValidationTrading &&
    (!services.bnbValidation?.fulfillment ||
      !services.reads ||
      !services.recovery)
  )
    throw new Error(
      "BNB validation trading requires the complete trading and recovery services."
    );
  const serviceCapabilities = Object.fromEntries(
    Object.entries(environment.capabilities).map(([chain, requested]) => {
      const openSea = isOpenSeaName(chain);
      const runtime = openSea
        ? productionOpenSea(chain)
        : chain === "bnb" &&
          (productionBnb ||
            (environment.deployment === "staging" &&
              !!environment.bnbValidationRpc));
      const admission = openSea
        ? runtime && !!services.openseaValidation
        : runtime &&
          !!services.bnbValidation &&
          (productionBnb || !!services.bnbValidation.admission);
      const fulfillment = openSea
        ? runtime && !!services.openseaFulfillment
        : runtime && !!services.bnbValidation?.fulfillment;
      const recovery = openSea
        ? !!services.openseaRecovery
        : !!services.recovery;
      return [
        chain,
        {
          read: requested.read && !!services.reads,
          buy:
            requested.buy &&
            fulfillment &&
            (chain !== "bnb" || !environment.bnbActionsPaused),
          createListing:
            requested.createListing &&
            admission &&
            (chain !== "bnb" || !environment.bnbActionsPaused),
          createOffer:
            requested.createOffer &&
            admission &&
            (chain !== "bnb" || !environment.bnbActionsPaused),
          acceptOffer:
            requested.acceptOffer &&
            fulfillment &&
            (chain !== "bnb" || !environment.bnbActionsPaused),
          cancel: requested.cancel && recovery
        }
      ];
    })
  ) as Environment["capabilities"];
  async function assertProductionRuntimeHealthy(
    chain: "ethereum" | "base" | "polygon" | "bnb",
    publication = false
  ) {
    if (environment.deployment !== "production") return;
    let health: Awaited<ReturnType<CapabilityHealthService["current"]>>;
    try {
      if (!services.capabilityHealth) throw new Error();
      health = await services.capabilityHealth.current();
    } catch {
      throw chain === "bnb"
        ? new BnbOrderError("market_unavailable", 503)
        : new OpenSeaOrderError("market_unavailable", 503);
    }
    let available =
      chain === "bnb"
        ? health.bnbWorker
        : health.openSeaRead[chain] &&
          (!publication || health.openSeaPublication[chain]);
    if (chain === "bnb" && services.bnbDiscovery) {
      try {
        const discovery = await (services.bnbDiscovery.status?.() ??
          services.bnbDiscovery.list(new URLSearchParams({ limit: "1" })));
        if (discovery.mode === "live")
          available = discovery.coverage === "complete";
      } catch {
        available = false;
      }
    }
    if (!available)
      throw chain === "bnb"
        ? new BnbOrderError("market_unavailable", 503)
        : new OpenSeaOrderError("market_unavailable", 503);
  }
  const app = new Hono<AppEnvironment>();
  app.use("*", async (context, next) => {
    const diagnostics = createReadDiagnostics(context.req.path);
    context.header("X-Request-Id", diagnostics.requestId);
    await readDiagnostics.run(diagnostics, next);
  });
  const admissionGate = createWorkGate({
    burst: 30,
    perSecond: 0.5,
    concurrent: 4
  });
  const recoveryGate = createWorkGate({
    burst: 120,
    perSecond: 3,
    concurrent: 8
  });
  const readGate = createWorkGate({ burst: 60, perSecond: 2, concurrent: 4 });
  const catalogGate = createWorkGate({
    burst: 20,
    perSecond: 1,
    concurrent: 4
  });
  async function bounded<T>(
    context: Context<AppEnvironment>,
    gate: typeof admissionGate,
    operation: () => Promise<T>,
    timeoutMs = defaultOperationTimeoutMs
  ) {
    const release = gate.acquire(
      context.env?.incoming?.socket.remoteAddress ?? "unknown"
    );
    if (!release) {
      console.warn(
        JSON.stringify({
          event: "market_capacity_rejected",
          ...readFailureContext(),
          code: "rate_limited",
          capacityReason: gate.rejection,
          status: 429
        })
      );
      context.header("Retry-After", "2");
      context.header("X-Capacity-Reason", gate.rejection ?? "rate");
      return context.json({ error: { code: "rate_limited" } }, 429);
    }
    let deadline: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(
        () => reject(new BnbOrderError("request_timeout", 503)),
        timeoutMs
      );
    });
    // A lost HTTP response cannot undo a commit. Keep its work slot until the
    // underlying bounded DB/RPC operation settles; exact-hash lookup resolves retries.
    const task = Promise.resolve()
      .then(operation)
      .finally(() => {
        clearTimeout(deadline);
        release();
      });
    return context.json(await Promise.race([task, timeout]));
  }
  async function jsonBody(context: Context<AppEnvironment>): Promise<unknown> {
    if (
      context.req
        .header("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      throw new BnbOrderError("json_content_type_required", 400);
    try {
      return await context.req.json();
    } catch {
      throw new BnbOrderError("invalid_json", 400);
    }
  }
  // A fixed-size global admission budget bounds work before a database checkout.
  // The reverse proxy will supply per-client limits; forwarded headers are untrusted here.
  let tokens = 240;
  let lastRefill = performance.now();
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    const now = performance.now();
    tokens = Math.min(240, tokens + (now - lastRefill) * 0.12);
    lastRefill = now;
    if (tokens < 1) {
      console.warn(
        JSON.stringify({
          event: "market_capacity_rejected",
          ...readFailureContext(),
          code: "rate_limited",
          capacityReason: "global_rate",
          status: 429
        })
      );
      context.header("Retry-After", "1");
      context.header("X-Capacity-Reason", "global_rate");
      return context.json({ error: { code: "rate_limited" } }, 429);
    }
    tokens--;
    const origin = context.req.header("Origin");
    if (origin && !environment.origins.includes(origin))
      return context.json({ error: { code: "origin_denied" } }, 403);
    await next();
  });
  app.use(
    "*",
    cors({
      origin: environment.origins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      credentials: false,
      maxAge: 600
    })
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 131072,
      onError: (context) =>
        context.json({ error: { code: "body_too_large" } }, 413)
    })
  );
  app.get("/health/live", (context) => context.json({ status: "alive" }));
  app.get("/health/ready", async (context) => {
    try {
      await ready();
      return context.json({ status: "ready" });
    } catch {
      return context.json({ status: "unavailable" }, 503);
    }
  });
  app.get("/v1/market/capabilities", async (context) => {
    const chains = structuredClone(serviceCapabilities);
    if (environment.deployment === "production") {
      let health: Awaited<ReturnType<CapabilityHealthService["current"]>>;
      try {
        if (!services.capabilityHealth) throw new Error();
        health = await services.capabilityHealth.current();
      } catch {
        for (const chain of Object.values(chains))
          for (const action of [
            "buy",
            "createListing",
            "createOffer",
            "acceptOffer"
          ] as const)
            chain[action] = false;
        return context.json({ schemaVersion: 1, bnbDiscovery: true, chains });
      }
      for (const chain of ["ethereum", "base", "polygon"] as const) {
        if (!health.openSeaRead[chain]) {
          chains[chain].buy = false;
          chains[chain].createListing = false;
          chains[chain].createOffer = false;
          chains[chain].acceptOffer = false;
        } else if (!health.openSeaPublication[chain]) {
          chains[chain].createListing = false;
          chains[chain].createOffer = false;
        }
      }
      let bnbReady = health.bnbWorker;
      if (services.bnbDiscovery) {
        try {
          const discovery = await (services.bnbDiscovery.status?.() ??
            services.bnbDiscovery.list(new URLSearchParams({ limit: "1" })));
          if (discovery.mode === "live")
            bnbReady = discovery.coverage === "complete";
        } catch {
          bnbReady = false;
        }
      }
      if (!bnbReady) {
        chains.bnb.buy = false;
        chains.bnb.createListing = false;
        chains.bnb.createOffer = false;
        chains.bnb.acceptOffer = false;
      }
    }
    return context.json({ schemaVersion: 1, bnbDiscovery: true, chains });
  });
  app.get("/v1/market/policies/bnb", (context) => {
    if (!services.bnbValidation)
      throw new BnbOrderError("market_unavailable", 503);
    const { rules } = services.bnbValidation.policy;
    return context.json({
      schemaVersion: 1,
      collection: rules.collection,
      offerCurrency: rules.offerCurrency,
      maxDurationSeconds: rules.maxDurationSeconds.toString(),
      fees: rules.fees
    });
  });
  app.get("/v1/market/policies/:chain", (context) => {
    const chain = context.req.param("chain");
    if (
      !isOpenSeaName(chain) ||
      !services.openseaValidation ||
      !(
        environment.openseaValidation?.chain === chain ||
        productionOpenSea(chain)
      )
    )
      throw new OpenSeaOrderError("market_unavailable", 503);
    return bounded(context, readGate, () =>
      services.openseaValidation!.policy(chain)
    );
  });
  app.get("/v1/market/wallets/:address/orders", (context) => {
    if (!services.reads) throw new BnbOrderError("market_unavailable", 503);
    return bounded(context, readGate, () =>
      services.reads!.wallet(
        context.req.param("address"),
        new URL(context.req.url).searchParams
      )
    );
  });
  app.get("/v1/market/bnb/discovered-orders", (context) => {
    if (!services.bnbDiscovery)
      throw new BnbOrderError("market_unavailable", 503);
    return bounded(context, readGate, () =>
      services.bnbDiscovery!.list(new URL(context.req.url).searchParams)
    );
  });
  app.get("/v1/market/tokens", (context) => {
    if (!services.catalog) throw new BnbOrderError("market_unavailable", 503);
    return bounded(context, catalogGate, () =>
      services.catalog!.tokens(new URL(context.req.url).searchParams)
    );
  });
  app.get("/v2/market/tokens", (context) => {
    const catalog = services.catalog;
    if (!catalog?.tokensV2) throw new BnbOrderError("market_unavailable", 503);
    return bounded(context, catalogGate, () =>
      catalog.tokensV2!(new URL(context.req.url).searchParams)
    );
  });
  app.get("/v1/market/wallets/:address/activity", (context) => {
    if (!services.activity) throw new BnbOrderError("market_unavailable", 503);
    return bounded(context, readGate, () =>
      services.activity!.wallet(
        context.req.param("address"),
        new URL(context.req.url).searchParams
      )
    );
  });
  app.get("/v1/market/assets/:chain/:contract/:tokenId/activity", (context) => {
    if (!services.activity) throw new BnbOrderError("market_unavailable", 503);
    const asset = readAssetIdentity(
      context.req.param("chain"),
      context.req.param("contract"),
      context.req.param("tokenId")
    );
    return bounded(context, readGate, () =>
      services.activity!.asset(asset, new URL(context.req.url).searchParams)
    );
  });
  app.get("/v1/market/assets/:chain/:contract/:tokenId", (context) => {
    if (!services.reads) throw new BnbOrderError("market_unavailable", 503);
    const asset = readAssetIdentity(
      context.req.param("chain"),
      context.req.param("contract"),
      context.req.param("tokenId")
    );
    return bounded(context, readGate, () => services.reads!.asset(asset));
  });
  app.get("/v2/market/assets/:chain/:contract/:tokenId", (context) => {
    const reads = services.reads;
    if (!reads?.assetV2) throw new BnbOrderError("market_unavailable", 503);
    const asset = readAssetIdentity(
      context.req.param("chain"),
      context.req.param("contract"),
      context.req.param("tokenId")
    );
    return bounded(context, readGate, () => reads.assetV2!(asset));
  });
  app.post("/v1/market/orders/prepare", (context) => {
    if (!services.bnbValidation && !services.openseaValidation)
      throw new BnbOrderError("market_unavailable", 503);
    return bounded(
      context,
      admissionGate,
      async () => {
        const body = await jsonBody(context);
        return (await admissionFor(body)).prepare(body);
      },
      tradingOperationTimeoutMs
    );
  });
  app.post("/v1/market/orders", (context) => {
    if (!services.bnbValidation && !services.openseaValidation)
      throw new BnbOrderError("market_unavailable", 503);
    return bounded(
      context,
      admissionGate,
      async () => {
        const body = await jsonBody(context);
        return (await admissionFor(body, true)).submit(body);
      },
      tradingOperationTimeoutMs
    );
  });
  async function admissionFor(body: unknown, submission = false) {
    let chain: unknown;
    try {
      chain = record(record(body).asset).chain;
    } catch {
      throw new BnbOrderError("invalid_order_request", 400);
    }
    if (chain === "bnb" && services.bnbValidation) {
      // BNB production orders are published with Seaport.validate by the maker.
      // The API must never admit a private signed order, even if a fresh
      // database still has its discovery cursor in preview mode.
      if (productionBnb)
        throw new BnbOrderError("signed_bnb_publication_disabled", 503);
      if (environment.bnbActionsPaused)
        throw new BnbOrderError("bnb_actions_paused", 503);
      if (services.bnbDiscovery) {
        const discovery = await services.bnbDiscovery.list(
          new URLSearchParams({ limit: "1" })
        );
        if (discovery.mode === "live")
          throw new BnbOrderError("signed_bnb_publication_disabled", 503);
      }
      if (!services.bnbValidation.admission)
        throw new BnbOrderError("market_unavailable", 503);
      return services.bnbValidation.admission;
    }
    if (
      typeof chain === "string" &&
      isOpenSeaName(chain) &&
      services.openseaValidation &&
      (environment.openseaValidation?.chain === chain ||
        productionOpenSea(chain))
    ) {
      if (environment.deployment === "production") {
        const input = parseOpenSeaOrderRequest(body, submission);
        const action =
          input.order.offer[0]?.itemType === 2
            ? "createListing"
            : "createOffer";
        if (!serviceCapabilities[chain][action])
          throw new OpenSeaOrderError("market_unavailable", 503);
        await assertProductionRuntimeHealthy(chain, true);
      }
      return services.openseaValidation;
    }
    throw new BnbOrderError("market_unavailable", 503);
  }
  function openSeaHash(context: Context<AppEnvironment>) {
    if (
      context.req.param("protocol")?.toLowerCase() !==
      seaportDeployment.address.toLowerCase()
    )
      throw new OpenSeaOrderError("invalid_order_identity", 400);
    try {
      return hex(context.req.param("hash"), 32);
    } catch {
      throw new OpenSeaOrderError("invalid_order_identity", 400);
    }
  }
  for (const action of ["preflight", "fulfillment", "prepare"] as const) {
    app.post(
      `/v1/market/orders/:chain/:protocol/:hash/${action}`,
      (context) => {
        const chain = context.req.param("chain");
        if (isOpenSeaName(chain)) {
          const service = services.openseaFulfillment;
          if (
            !service ||
            !(
              environment.openseaValidation?.chain === chain ||
              productionOpenSea(chain)
            ) ||
            (environment.deployment === "production" &&
              !serviceCapabilities[chain].buy &&
              !serviceCapabilities[chain].acceptOffer)
          )
            throw new OpenSeaOrderError("market_unavailable", 503);
          const hash = openSeaHash(context);
          return bounded(
            context,
            admissionGate,
            async () => {
              await assertProductionRuntimeHealthy(chain);
              const body = await jsonBody(context);
              if (action === "prepare") {
                if (!service.prepare)
                  throw new OpenSeaOrderError("market_unavailable", 503);
                return service.prepare(chain, hash, body);
              }
              return action === "preflight"
                ? service.preflight(chain, hash, body)
                : service.quote(chain, hash, body);
            },
            action === "prepare"
              ? defaultOperationTimeoutMs
              : tradingOperationTimeoutMs
          );
        }
        if (action === "prepare")
          throw new BnbOrderError("market_unavailable", 503);
        if (environment.bnbActionsPaused)
          throw new BnbOrderError("bnb_actions_paused", 503);
        const service = services.bnbValidation?.fulfillment;
        if (
          !service ||
          (environment.deployment === "production" &&
            !serviceCapabilities.bnb.buy &&
            !serviceCapabilities.bnb.acceptOffer)
        )
          throw new BnbOrderError("market_unavailable", 503);
        const hash = bnbOrderIdentity(
          context.req.param("chain"),
          context.req.param("protocol"),
          context.req.param("hash")
        );
        return bounded(
          context,
          admissionGate,
          async () => {
            await assertProductionRuntimeHealthy("bnb");
            const body = await jsonBody(context);
            return action === "preflight"
              ? service.preflight(hash, body)
              : service.quote(hash, body);
          },
          tradingOperationTimeoutMs
        );
      }
    );
  }
  app.get("/v1/market/orders/:chain/:protocol/:hash", (context) => {
    const chain = context.req.param("chain");
    if (isOpenSeaName(chain) && services.openseaRecovery) {
      const hash = openSeaHash(context);
      return bounded(context, recoveryGate, () =>
        services.openseaRecovery!.accepted(chain, hash)
      );
    }
    if (!services.recovery) throw new BnbOrderError("market_unavailable", 503);
    const hash = bnbOrderIdentity(
      context.req.param("chain"),
      context.req.param("protocol"),
      context.req.param("hash")
    );
    return bounded(context, recoveryGate, () =>
      services.recovery!.accepted(hash)
    );
  });
  app.post(
    "/v1/market/orders/:chain/:protocol/:hash/cancellation",
    (context) => {
      const chain = context.req.param("chain");
      if (isOpenSeaName(chain) && services.openseaRecovery) {
        const hash = openSeaHash(context);
        return bounded(context, recoveryGate, async () =>
          services.openseaRecovery!.cancellation(
            chain,
            hash,
            await jsonBody(context)
          )
        );
      }
      if (!services.recovery)
        throw new BnbOrderError("market_unavailable", 503);
      const hash = bnbOrderIdentity(
        context.req.param("chain"),
        context.req.param("protocol"),
        context.req.param("hash")
      );
      return bounded(context, recoveryGate, async () =>
        services.recovery!.cancellation(hash, await jsonBody(context))
      );
    }
  );
  app.all("/v1/market/*", (context) =>
    context.json({ error: { code: "market_unavailable" } }, 503)
  );
  app.notFound((context) =>
    context.json({ error: { code: "not_found" } }, 404)
  );
  app.onError((error, context) => {
    if (error instanceof BnbOrderError || error instanceof OpenSeaOrderError) {
      if (error.status === 429) {
        context.header("Retry-After", "2");
        context.header(
          "X-Capacity-Reason",
          readDiagnostics.getStore()?.capacityReason ?? error.code
        );
        console.warn(
          JSON.stringify({
            event: "market_capacity_rejected",
            ...readFailureContext(),
            code: error.code,
            status: 429
          })
        );
      }
      if (error.status >= 500)
        console.error(
          JSON.stringify({
            event: "market_request_failed",
            ...readFailureContext(),
            code: error.code,
            status: error.status
          })
        );
      return context.json({ error: { code: error.code } }, error.status);
    }
    const unavailable = databaseUnavailable(error);
    console.error(
      JSON.stringify({
        event: "market_request_failed",
        ...readFailureContext(),
        databaseCode: databaseErrorCode(error),
        status: unavailable ? 503 : 500,
        errorType: error.name
      })
    );
    if (unavailable)
      return context.json({ error: { code: "market_unavailable" } }, 503);
    return context.json({ error: { code: "internal_error" } }, 500);
  });
  return app;
}
