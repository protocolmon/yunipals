import { getAddress, zeroAddress } from "viem";
import { isAbsolute, resolve } from "node:path";
import type { Address } from "viem";
import type { MarketplaceChain } from "@protopals/yunipals-market-core/registry";

import {
  ownerTradeActionAuthorized,
  ownerTradeActions,
  readOwnerTradeAuthorization,
  type VerifiedOwnerTradeAuthorization
} from "@/ownerTradeAuthorization";
import {
  isProductionRpcBudgetProxyUrl,
  isRpcBudgetProxyUrl
} from "@/rpcBudgetProxyRegistry";

export type Environment = ReturnType<typeof readEnvironment>;

function liveRpcUrls(
  primary: string | undefined,
  failover: string | undefined,
  production: boolean,
  label: string,
  chain: MarketplaceChain
) {
  const values = [primary, failover].filter(
    (value): value is string => value !== undefined
  );
  try {
    if (!primary) throw new Error();
    const urls = values.map((value) => new URL(value));
    const delegatedProxy =
      values.length === 1 &&
      (production
        ? isProductionRpcBudgetProxyUrl(values[0]!, chain)
        : isRpcBudgetProxyUrl(values[0]!, chain) &&
          !isProductionRpcBudgetProxyUrl(values[0]!, chain));
    if (
      (production && !delegatedProxy && !failover) ||
      (!delegatedProxy &&
        urls.some(
          (url) =>
            url.protocol !== "https:" ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.hash
        )) ||
      (urls.length === 2 && urls[0]!.hostname === urls[1]!.hostname)
    )
      throw new Error();
  } catch {
    throw new Error(
      `Configure ${label} with ${production ? "the production RPC proxy or HTTPS primary and provider-independent failover URLs" : "HTTPS"}.`
    );
  }
  return values as [string, ...string[]];
}

export function readSaleReplayEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const chain = input.MARKET_SALE_CHAIN;
  if (chain !== "ethereum" && chain !== "base" && chain !== "polygon")
    throw new Error("Set MARKET_SALE_CHAIN to ethereum, base or polygon.");
  const mode = input.MARKET_SALE_MODE;
  if (mode !== "live" && mode !== "fork")
    throw new Error("Set MARKET_SALE_MODE explicitly to live or fork.");
  if (mode === "fork" && input.MARKET_DEPLOYMENT !== "staging")
    throw new Error("Sale replay forks require staging.");
  const continuous = input.MARKET_SALE_CONTINUOUS === "1";
  if (
    (input.MARKET_SALE_CONTINUOUS !== undefined && !continuous) ||
    (continuous &&
      (mode !== "live" || input.MARKET_SALE_MAX_SECONDS !== undefined))
  )
    throw new Error("Configure either bounded or continuous live sale replay.");
  if (
    Object.keys(input).some(
      (key) =>
        key.startsWith("MARKET_OPENSEA_VALIDATION_") ||
        key.startsWith("MARKET_BNB_VALIDATION_")
    )
  )
    throw new Error("Sale replay uses separate configuration.");
  const rpcUrl = input.MARKET_SALE_RPC;
  const rpcFailover = input.MARKET_SALE_RPC_FAILOVER;
  let rpcUrls: [string, ...string[]];
  try {
    const url = new URL(rpcUrl ?? "");
    if (mode === "live") {
      rpcUrls = liveRpcUrls(
        rpcUrl,
        rpcFailover,
        input.MARKET_DEPLOYMENT === "production",
        "live sale replay RPC",
        chain
      );
    } else if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      !!url.search ||
      rpcFailover !== undefined
    )
      throw new Error();
    else rpcUrls = [rpcUrl!];
  } catch {
    throw new Error(
      "Configure HTTPS for live sale replay or a loopback HTTP fork."
    );
  }
  const policy = input.MARKET_SALE_POLICY;
  if (!policy || !/^[a-z][a-z0-9_-]{0,127}$/.test(policy))
    throw new Error("Set the exact operator-configured MARKET_SALE_POLICY.");
  return {
    chain,
    mode,
    rpcUrl: rpcUrl!,
    rpcUrls: rpcUrls!,
    finality:
      input.MARKET_DEPLOYMENT === "production"
        ? ("finalized" as const)
        : ("confirmations" as const),
    policy,
    maxSeconds: continuous
      ? undefined
      : positiveInteger(input.MARKET_SALE_MAX_SECONDS, 900, 86400)
  } as const;
}

export function readOpenSeaBudgetEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const databaseUrl = input.MARKET_OPENSEA_BUDGET_DATABASE_URL;
  const scope = input.MARKET_OPENSEA_BUDGET_SCOPE;
  const coordinatorId = input.MARKET_OPENSEA_BUDGET_COORDINATOR_ID;
  if (!databaseUrl || !scope)
    throw new Error(
      "Configure the shared OpenSea budget database and account scope."
    );
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid OpenSea budget database URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2
  )
    throw new Error("Invalid OpenSea budget database URL.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope))
    throw new Error("Invalid OpenSea budget scope.");
  if (
    coordinatorId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      coordinatorId
    )
  )
    throw new Error("Invalid OpenSea budget coordinator identity.");
  if (input.MARKET_DEPLOYMENT === "production" && !coordinatorId)
    throw new Error(
      "Configure the production OpenSea budget coordinator identity."
    );
  return { databaseUrl, scope, coordinatorId: coordinatorId?.toLowerCase() };
}

// Separate read-only probe configuration: it cannot enable API admission or
// provider publication. Keep the credential out of returned probe reports.
export function readOpenSeaProbeEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const apiKey = input.MARKET_OPENSEA_API_KEY;
  if (!apiKey || !/^[\x21-\x7e]{1,512}$/.test(apiKey))
    throw new Error("Set a valid server-side MARKET_OPENSEA_API_KEY.");
  const maxDurationSeconds = positiveInteger(
    input.MARKET_OPENSEA_MAX_DURATION_SECONDS,
    30 * 86400,
    180 * 86400
  );
  if (maxDurationSeconds < 3600)
    throw new Error("Invalid OpenSea maximum order duration.");
  return { apiKey, maxDurationSeconds };
}

export function readOpenSeaStreamEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const apiKey = input.MARKET_OPENSEA_API_KEY;
  if (!apiKey || !/^[\x21-\x7e]{1,512}$/.test(apiKey))
    throw new Error("Set a valid server-side MARKET_OPENSEA_API_KEY.");
  if (
    input.MARKET_OPENSEA_STREAM_URL !== undefined ||
    input.MARKET_OPENSEA_STREAM_TOPICS !== undefined ||
    Object.keys(input).some(
      (key) =>
        key.startsWith("MARKET_OPENSEA_VALIDATION_") ||
        key.startsWith("MARKET_BNB_VALIDATION_")
    )
  )
    throw new Error("The OpenSea stream uses fixed scopes and no trading RPC.");
  return {
    apiKey,
    maxSeconds:
      input.MARKET_OPENSEA_STREAM_MAX_SECONDS === undefined
        ? undefined
        : positiveInteger(input.MARKET_OPENSEA_STREAM_MAX_SECONDS, 1, 86400)
  };
}

export function readOpenSeaDiscoveryEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const chain = input.MARKET_DISCOVERY_CHAIN;
  if (chain !== "ethereum" && chain !== "base" && chain !== "polygon")
    throw new Error("Set MARKET_DISCOVERY_CHAIN to ethereum, base or polygon.");
  const scanIntervalMs = positiveInteger(
    input.MARKET_DISCOVERY_INTERVAL_MS,
    240000,
    240000
  );
  if (scanIntervalMs < 60000)
    throw new Error("Discovery interval must be between one and four minutes.");
  return {
    chain,
    scanIntervalMs,
    maxPages: positiveInteger(input.MARKET_DISCOVERY_MAX_PAGES, 100, 10000)
  } as const;
}

export function readOpenSeaReadEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const chain = input.MARKET_OPENSEA_READ_CHAIN;
  if (chain !== "ethereum" && chain !== "base" && chain !== "polygon")
    throw new Error(
      "Set MARKET_OPENSEA_READ_CHAIN to ethereum, base or polygon."
    );
  if (
    Object.keys(input).some(
      (key) =>
        key.startsWith("MARKET_OPENSEA_VALIDATION_") ||
        key.startsWith("MARKET_BNB_VALIDATION_")
    )
  )
    throw new Error("Live read workers cannot use validation configuration.");
  const rpcUrl = input.MARKET_OPENSEA_READ_RPC;
  const rpcUrls = liveRpcUrls(
    rpcUrl,
    input.MARKET_OPENSEA_READ_RPC_FAILOVER,
    input.MARKET_DEPLOYMENT === "production",
    "OpenSea read RPC",
    chain
  );
  if (!input.MARKET_OPENSEA_READ_CONFIRMATIONS)
    throw new Error(
      "Set the OpenSea read confirmation requirement explicitly."
    );
  return {
    chain,
    rpcUrl: rpcUrl!,
    rpcUrls,
    confirmations: BigInt(
      positiveInteger(input.MARKET_OPENSEA_READ_CONFIRMATIONS, 1, 10000)
    ),
    finality:
      input.MARKET_DEPLOYMENT === "production"
        ? ("finalized" as const)
        : ("confirmations" as const),
    concurrency: positiveInteger(input.MARKET_OPENSEA_READ_CONCURRENCY, 1, 8),
    maxSeconds:
      input.MARKET_OPENSEA_READ_MAX_SECONDS === undefined
        ? undefined
        : positiveInteger(input.MARKET_OPENSEA_READ_MAX_SECONDS, 1, 86400),
    indexerMaxAgeMs: 60000,
    providerMaxAgeMs: 300000
  } as const;
}

export function readOpenSeaSignatureEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const read = readOpenSeaReadEnvironment({
    ...input,
    MARKET_OPENSEA_READ_CHAIN: input.MARKET_OPENSEA_SIGNATURE_CHAIN,
    MARKET_OPENSEA_READ_RPC: input.MARKET_OPENSEA_SIGNATURE_RPC,
    MARKET_OPENSEA_READ_RPC_FAILOVER:
      input.MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER,
    MARKET_OPENSEA_READ_CONFIRMATIONS:
      input.MARKET_OPENSEA_SIGNATURE_CONFIRMATIONS,
    MARKET_OPENSEA_READ_MAX_SECONDS: input.MARKET_OPENSEA_SIGNATURE_MAX_SECONDS,
    MARKET_OPENSEA_READ_CONCURRENCY: "1"
  });
  let listingActor;
  try {
    listingActor = getAddress(
      input.MARKET_OPENSEA_SIGNATURE_LISTING_ACTOR ?? ""
    );
    if (listingActor === zeroAddress) throw new Error();
  } catch {
    throw new Error("Configure a nonzero signature simulation actor address.");
  }
  if (
    !input.MARKET_OPENSEA_SIGNATURE_HOURLY_HEADROOM ||
    !input.MARKET_OPENSEA_SIGNATURE_FULFILLMENT_HEADROOM
  )
    throw new Error(
      "Configure positive hourly and fulfillment foreground headroom explicitly."
    );
  return {
    ...read,
    listingActor,
    headroom: {
      allPerHour: positiveInteger(
        input.MARKET_OPENSEA_SIGNATURE_HOURLY_HEADROOM,
        1,
        1000000
      ),
      fulfillmentPerMinute: positiveInteger(
        input.MARKET_OPENSEA_SIGNATURE_FULFILLMENT_HEADROOM,
        1,
        100000
      )
    }
  };
}

export function readOpenSeaSignatureFleetEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const directory = input.MARKET_OPENSEA_SIGNATURE_STATE_DIRECTORY;
  if (
    input.MARKET_OPENSEA_SIGNATURE_CHAIN ||
    input.MARKET_OPENSEA_SIGNATURE_RPC ||
    !directory ||
    !isAbsolute(directory) ||
    resolve(directory) !== directory ||
    /[\r\n\0]/.test(directory)
  )
    throw new Error(
      "Configure a dedicated signature fleet and absolute state directory."
    );
  const chain = (name: "ethereum" | "base" | "polygon") =>
    readOpenSeaSignatureEnvironment({
      ...input,
      MARKET_OPENSEA_SIGNATURE_CHAIN: name,
      MARKET_OPENSEA_SIGNATURE_RPC:
        input[`MARKET_OPENSEA_SIGNATURE_RPC_${name.toUpperCase()}`],
      MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER:
        input[`MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER_${name.toUpperCase()}`]
    });
  return {
    directory,
    chains: {
      ethereum: chain("ethereum"),
      base: chain("base"),
      polygon: chain("polygon")
    }
  };
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  max: number
) {
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw))
    throw new Error("Invalid numeric configuration.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max)
    throw new Error("Numeric configuration is out of range.");
  return value;
}

export const marketCapabilityActions = [
  "read",
  "buy",
  "createListing",
  "createOffer",
  "acceptOffer",
  "cancel"
] as const;
export type MarketCapabilityAction = (typeof marketCapabilityActions)[number];
export type MarketCapabilitySet = Record<MarketCapabilityAction, boolean>;
export type MarketCapabilities = Record<MarketplaceChain, MarketCapabilitySet>;

const marketChains = ["ethereum", "base", "polygon", "bnb"] as const;
const openSeaChains = ["ethereum", "base", "polygon"] as const;

function disabledCapabilities(): MarketCapabilitySet {
  return {
    read: false,
    buy: false,
    createListing: false,
    createOffer: false,
    acceptOffer: false,
    cancel: false
  };
}

function capabilitySet(raw: string | undefined): MarketCapabilitySet {
  const result = disabledCapabilities();
  if (raw === undefined) return result;
  const values = raw.split(",");
  if (
    !raw ||
    values.some(
      (value, index) =>
        !marketCapabilityActions.includes(value as MarketCapabilityAction) ||
        values.indexOf(value) !== index
    )
  )
    throw new Error("Invalid marketplace capability configuration.");
  for (const value of values) result[value as MarketCapabilityAction] = true;
  return result;
}

function readProductionCapabilities(
  input: NodeJS.ProcessEnv,
  deployment: "staging" | "production",
  bnbValidationTrading: boolean
): MarketCapabilities {
  const allowed = new Set(
    marketChains.map((chain) => `MARKET_CAPABILITIES_${chain.toUpperCase()}`)
  );
  if (
    Object.keys(input).some(
      (key) => key.startsWith("MARKET_CAPABILITIES_") && !allowed.has(key)
    )
  )
    throw new Error("Unknown marketplace capability chain.");
  const configured = Object.fromEntries(
    marketChains.map((chain) => [
      chain,
      capabilitySet(input[`MARKET_CAPABILITIES_${chain.toUpperCase()}`])
    ])
  ) as MarketCapabilities;
  if (
    deployment !== "production" &&
    marketChains.some(
      (chain) =>
        input[`MARKET_CAPABILITIES_${chain.toUpperCase()}`] !== undefined
    )
  )
    throw new Error("Live marketplace capabilities require production.");
  if (bnbValidationTrading)
    for (const action of marketCapabilityActions) configured.bnb[action] = true;
  return configured;
}

function optionalLiveRpcUrls(
  input: NodeJS.ProcessEnv,
  chain: MarketplaceChain,
  deployment: "staging" | "production"
) {
  const name = chain.toUpperCase();
  const primary = input[`MARKET_TRADING_RPC_${name}`];
  const failover = input[`MARKET_TRADING_RPC_FAILOVER_${name}`];
  if (primary === undefined && failover === undefined) return undefined;
  if (deployment !== "production")
    throw new Error("Live trading RPC configuration requires production.");
  return liveRpcUrls(primary, failover, true, `${chain} trading RPC`, chain);
}

function productionBnbPolicy(input: NodeJS.ProcessEnv) {
  const version = input.MARKET_BNB_POLICY_VERSION;
  if (!version || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(version))
    throw new Error("Configure the exact BNB policy version.");
  if (!input.MARKET_BNB_MAX_DURATION_SECONDS)
    throw new Error("Configure the exact BNB maximum order duration.");
  const maxDurationSeconds = BigInt(
    positiveInteger(input.MARKET_BNB_MAX_DURATION_SECONDS, 86400, 365 * 86400)
  );
  if (maxDurationSeconds < 3600n)
    throw new Error("BNB maximum order duration is too short.");
  let fees: { recipient: Address; basisPoints: number }[];
  try {
    const value: unknown = JSON.parse(input.MARKET_BNB_POLICY_FEES ?? "");
    if (!Array.isArray(value) || value.length > 31) throw new Error();
    fees = value.map((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        Array.isArray(item) ||
        Object.keys(item).sort().join(",") !== "basisPoints,recipient"
      )
        throw new Error();
      const row = item as Record<string, unknown>;
      if (
        !Number.isSafeInteger(row.basisPoints) ||
        (row.basisPoints as number) < 1 ||
        (row.basisPoints as number) > 10000
      )
        throw new Error();
      return {
        recipient: getAddress(String(row.recipient)),
        basisPoints: row.basisPoints as number
      };
    });
    if (
      new Set(fees.map((fee) => fee.recipient.toLowerCase())).size !==
        fees.length ||
      fees.some((fee) => fee.recipient === zeroAddress) ||
      fees.reduce((sum, fee) => sum + fee.basisPoints, 0) >= 10000
    )
      throw new Error();
  } catch {
    throw new Error("Configure the exact BNB creator fee policy JSON.");
  }
  return { version, maxDurationSeconds, fees };
}

export function readEnvironment(input: NodeJS.ProcessEnv = process.env) {
  const deployment = input.MARKET_DEPLOYMENT;
  if (deployment !== "staging" && deployment !== "production")
    throw new Error("Set MARKET_DEPLOYMENT to staging or production.");
  const databaseUrl = input.MARKET_DATABASE_URL;
  if (!databaseUrl) throw new Error("MARKET_DATABASE_URL is required.");
  const indexerDatabaseUrl = input.MARKET_INDEXER_DATABASE_URL;
  if (indexerDatabaseUrl !== undefined) {
    try {
      const url = new URL(indexerDatabaseUrl);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname ||
        url.pathname.length < 2
      )
        throw new Error();
    } catch {
      throw new Error("Invalid catalog indexer database URL.");
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid marketplace database URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2
  )
    throw new Error("Invalid marketplace database URL.");
  const host = input.MARKET_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host))
    throw new Error(
      "Bind the marketplace API to loopback behind its reverse proxy."
    );
  const origins = (input.MARKET_ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error("Invalid allowed origin.");
      }
      const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if (
        url.username ||
        url.password ||
        url.origin !== value ||
        (url.protocol !== "https:" &&
          !(deployment === "staging" && local && url.protocol === "http:"))
      )
        throw new Error("Invalid allowed origin.");
      return value;
    });
  const bnbValidationRpc = input.MARKET_BNB_VALIDATION_RPC;
  if (bnbValidationRpc !== undefined) {
    const url = new URL(bnbValidationRpc);
    if (
      deployment !== "staging" ||
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "BNB validation requires staging and a loopback HTTP fork URL."
      );
  }
  const trading = input.MARKET_BNB_VALIDATION_TRADING;
  if (trading !== undefined && trading !== "0" && trading !== "1")
    throw new Error("BNB validation trading must be explicitly 0 or 1.");
  const bnbValidationTrading = trading === "1";
  if (bnbValidationTrading && (deployment !== "staging" || !bnbValidationRpc))
    throw new Error(
      "BNB validation trading requires an explicit staging fork RPC."
    );
  const capabilities = readProductionCapabilities(
    input,
    deployment,
    bnbValidationTrading
  );
  const openSeaValues = [
    input.MARKET_OPENSEA_VALIDATION_CHAIN,
    input.MARKET_OPENSEA_VALIDATION_RPC,
    input.MARKET_OPENSEA_VALIDATION_PROVIDER
  ];
  let openseaValidation:
    | {
        chain: "ethereum" | "base" | "polygon";
        rpcUrl: string;
        providerOrigin: string;
      }
    | undefined;
  if (openSeaValues.some((value) => value !== undefined)) {
    const [chain, rpcUrl, providerOrigin] = openSeaValues;
    if (
      deployment !== "staging" ||
      !chain ||
      !["ethereum", "base", "polygon"].includes(chain) ||
      !rpcUrl ||
      !providerOrigin
    )
      throw new Error(
        "OpenSea validation requires staging, a registered chain, local fork RPC and fixture provider."
      );
    for (const raw of [rpcUrl, providerOrigin]) {
      const url = new URL(raw);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (raw === providerOrigin && url.origin !== raw)
      )
        throw new Error(
          "OpenSea validation requires loopback HTTP endpoints without credentials."
        );
    }
    openseaValidation = {
      chain: chain as "ethereum" | "base" | "polygon",
      rpcUrl,
      providerOrigin
    };
  }
  const rpcByChain = Object.fromEntries(
    marketChains.map((chain) => [
      chain,
      optionalLiveRpcUrls(input, chain, deployment)
    ])
  ) as Record<MarketplaceChain, [string, ...string[]] | undefined>;
  const bnbDiscoveryStart = input.MARKET_BNB_DISCOVERY_START_BLOCK;
  const bnbDiscoveryStartBlock = bnbDiscoveryStart
    ? BigInt(positiveInteger(bnbDiscoveryStart, 1, Number.MAX_SAFE_INTEGER))
    : undefined;
  if (bnbDiscoveryStartBlock && !rpcByChain.bnb && !bnbValidationRpc)
    throw new Error("BNB discovery requires a configured BNB RPC.");
  const pauseBnbActions = input.MARKET_BNB_ACTIONS_PAUSED;
  if (pauseBnbActions !== undefined && !["0", "1"].includes(pauseBnbActions))
    throw new Error("BNB action pause must be 0 or 1.");
  const allowedTradingRpcKeys = new Set(
    marketChains.flatMap((chain) => [
      `MARKET_TRADING_RPC_${chain.toUpperCase()}`,
      `MARKET_TRADING_RPC_FAILOVER_${chain.toUpperCase()}`
    ])
  );
  if (
    Object.keys(input).some(
      (key) =>
        key.startsWith("MARKET_TRADING_RPC_") && !allowedTradingRpcKeys.has(key)
    )
  )
    throw new Error("Unknown marketplace trading RPC chain.");
  const openSeaConfigured = openSeaChains.filter(
    (chain) => rpcByChain[chain] !== undefined
  );
  const requestedExecutable = marketChains.some((chain) =>
    ownerTradeActions.some((action) => capabilities[chain][action])
  );
  let ownerTradeAuthorization: VerifiedOwnerTradeAuthorization | undefined;
  const ownerSchedule = input.MARKET_OWNER_TRADE_SCHEDULE_BASE64;
  const ownerScheduleDigest = input.MARKET_OWNER_TRADE_SCHEDULE_SHA256;
  if (requestedExecutable && deployment === "production") {
    if (!ownerSchedule || !ownerScheduleDigest)
      throw new Error(
        "Executable production capabilities require an exact owner trade schedule."
      );
    ownerTradeAuthorization = readOwnerTradeAuthorization(
      ownerSchedule,
      ownerScheduleDigest
    );
    for (const chain of marketChains)
      for (const action of ownerTradeActions)
        capabilities[chain][action] =
          capabilities[chain][action] &&
          ownerTradeActionAuthorized(ownerTradeAuthorization, chain, action);
    if (
      !marketChains.some((chain) =>
        ownerTradeActions.some((action) => capabilities[chain][action])
      )
    )
      throw new Error(
        "The owner trade schedule authorizes none of the requested capabilities."
      );
  } else if (ownerSchedule !== undefined || ownerScheduleDigest !== undefined) {
    throw new Error(
      "Owner trade authorization requires an executable production capability."
    );
  }
  const openSeaNeedsRuntime = openSeaChains.filter((chain) =>
    ownerTradeActions.some((action) => capabilities[chain][action])
  );
  const bnbNeedsRuntime = ownerTradeActions.some(
    (action) => capabilities.bnb[action]
  );
  const bnbAuthorization = input.MARKET_BNB_TRADING_AUTHORIZATION;
  if (
    (deployment === "production" &&
      ((bnbNeedsRuntime &&
        (!bnbAuthorization ||
          bnbAuthorization !== ownerTradeAuthorization?.digest)) ||
        (!bnbNeedsRuntime && bnbAuthorization !== undefined))) ||
    (deployment !== "production" && bnbAuthorization !== undefined)
  )
    throw new Error(
      "BNB order admission requires an exact owner authorization digest."
    );
  if (
    openSeaNeedsRuntime.some((chain) => rpcByChain[chain] === undefined) ||
    (bnbNeedsRuntime && !bnbValidationRpc && rpcByChain.bnb === undefined)
  )
    throw new Error(
      "Executable capabilities require a complete chain runtime."
    );
  const publicationValues = [
    input.MARKET_OPENSEA_WORKER_CHAIN,
    input.MARKET_OPENSEA_PUBLICATION_ENABLED,
    input.MARKET_OPENSEA_PUBLICATION_AUTHORIZATION
  ];
  let publication:
    | {
        chain: "ethereum" | "base" | "polygon";
        authorization: string;
      }
    | undefined;
  if (publicationValues.some((value) => value !== undefined)) {
    const chain = input.MARKET_OPENSEA_WORKER_CHAIN;
    const authorization = input.MARKET_OPENSEA_PUBLICATION_AUTHORIZATION;
    if (
      deployment !== "production" ||
      input.MARKET_OPENSEA_PUBLICATION_ENABLED !== "1" ||
      !chain ||
      !openSeaChains.includes(chain as (typeof openSeaChains)[number]) ||
      rpcByChain[chain as (typeof openSeaChains)[number]] === undefined ||
      !authorization ||
      authorization !== ownerTradeAuthorization?.digest ||
      (!capabilities[chain as (typeof openSeaChains)[number]].createListing &&
        !capabilities[chain as (typeof openSeaChains)[number]].createOffer)
    )
      throw new Error(
        "OpenSea publication requires an enabled, owner-authorized production chain scope."
      );
    publication = {
      chain: chain as (typeof openSeaChains)[number],
      authorization
    };
  }
  let productionTrading:
    | {
        openSea?: {
          apiKey: string;
          maxDurationSeconds: number;
          rpcUrls: Partial<
            Record<"ethereum" | "base" | "polygon", [string, ...string[]]>
          >;
          publication?: {
            chain: "ethereum" | "base" | "polygon";
            authorization: string;
          };
        };
        bnb?: {
          rpcUrls: [string, ...string[]];
          policy: ReturnType<typeof productionBnbPolicy>;
          authorization?: string;
        };
      }
    | undefined;
  if (openSeaConfigured.length || rpcByChain.bnb) {
    if (openSeaConfigured.length && !input.MARKET_OPENSEA_MAX_DURATION_SECONDS)
      throw new Error("Configure the exact OpenSea maximum order duration.");
    const openSea = openSeaConfigured.length
      ? {
          ...readOpenSeaProbeEnvironment(input),
          rpcUrls: Object.fromEntries(
            openSeaConfigured.map((chain) => [chain, rpcByChain[chain]!])
          ),
          publication
        }
      : undefined;
    productionTrading = {
      openSea,
      bnb: rpcByChain.bnb
        ? {
            rpcUrls: rpcByChain.bnb,
            policy: productionBnbPolicy(input),
            authorization: bnbAuthorization
          }
        : undefined
    };
  }
  return {
    deployment: deployment as "staging" | "production",
    databaseUrl,
    indexerDatabaseUrl,
    host,
    port: positiveInteger(input.MARKET_PORT, 9012, 65535),
    poolMax: positiveInteger(input.MARKET_DB_POOL_MAX, 8, 32),
    workerConcurrency: positiveInteger(input.MARKET_WORKER_CONCURRENCY, 2, 8),
    statementTimeoutMs: positiveInteger(
      input.MARKET_DB_TIMEOUT_MS,
      8000,
      12000
    ),
    origins,
    bnbValidationRpc,
    bnbDiscoveryStartBlock,
    bnbActionsPaused: pauseBnbActions === "1",
    bnbValidationTrading,
    openseaValidation,
    capabilities,
    productionTrading,
    ownerTradeAuthorization
  };
}
