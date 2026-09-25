import { zeroAddress, type Address } from "viem";
import {
  parseMarketOrder,
  type MarketOrder
} from "@protopals/yunipals-market-core/marketOrder";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { address, record } from "@protopals/yunipals-market-core/validation";

import {
  snapshotOpenSeaPublication,
  verifyOpenSeaAcknowledgment,
  type OpenSeaAcknowledgment,
  type OpenSeaPublication
} from "@/opensea/orders";
import {
  OpenSeaBudgetError,
  type OpenSeaEndpointClass,
  type OpenSeaRequestBudget,
  type OpenSeaRequestKind
} from "@/opensea/requestBudget";

type FailureCode =
  | "provider_busy"
  | "provider_timeout"
  | "provider_network"
  | "provider_auth"
  | "provider_rate_limited"
  | "provider_not_found"
  | "provider_http_error"
  | "provider_invalid_response"
  | "provider_response_too_large"
  | "publication_disabled"
  | "publication_not_authorized";

export class OpenSeaError extends Error {
  constructor(
    readonly code: FailureCode,
    readonly httpStatus?: number,
    readonly retryAfterMs?: number
  ) {
    super(code);
    this.name = "OpenSeaError";
  }
}

type ResponseMetadata = { httpStatus: number; retryAfterMs?: number };
export type OpenSeaPublicationResult =
  | { state: "acknowledged"; acknowledgment: OpenSeaAcknowledgment }
  | ({
      state: "rejected" | "indeterminate" | "not_sent";
      code: FailureCode;
    } & Partial<ResponseMetadata>);

type ClientOptions = {
  apiKey: string;
  requestBudget?: OpenSeaRequestBudget;
  // Normal callers cannot configure arbitrary production origins. Fixtures are
  // strictly loopback and require a fixed non-secret key.
  fixtureOrigin?: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  maxResponseBytes?: number;
  // Absent in ordinary staging/read-only operation. The admission coordinator
  // supplies this only after durable retention, current checks, backup readiness
  // and the deployment's exact owner-authorized publication scope are established.
  authorizePublication?: (publication: OpenSeaPublication) => Promise<void>;
};

function limit(value: number | undefined, fallback: number, maximum: number) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum)
    throw new Error("Invalid OpenSea client limit.");
  return n;
}

function chainName(chain: OpenSeaChain) {
  if (!isOpenSeaChain(chain)) throw new Error("Unsupported OpenSea chain.");
  return chain; // Current API uses polygon, not the historical matic alias.
}

function slugPath(slug: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(slug))
    throw new Error("Invalid OpenSea collection slug.");
  return `/api/v2/collections/${slug}`;
}

function retryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = /^[0-9]{1,10}$/.test(value) ? Number(value) : undefined;
  const ms =
    seconds !== undefined ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 3600000) : undefined;
}

function requestClassification(
  method: "GET" | "POST",
  path: string
): { kind: OpenSeaRequestKind; endpointClass: OpenSeaEndpointClass } {
  if (method === "POST" && path.endsWith("/fulfillment_data"))
    return { kind: "fulfillment", endpointClass: "fulfillment" };
  if (method === "POST")
    return { kind: "publication", endpointClass: "publication" };
  if (/^\/api\/v2\/collections\//.test(path))
    return { kind: "read", endpointClass: "collection_policy" };
  if (/^\/api\/v2\/chain\/[^/]+\/contract\//.test(path))
    return { kind: "read", endpointClass: "contract" };
  if (/^\/api\/v2\/listings\/collection\//.test(path))
    return { kind: "read", endpointClass: "listings" };
  if (/^\/api\/v2\/offers\/collection\//.test(path))
    return { kind: "read", endpointClass: "offers" };
  if (/^\/api\/v2\/orders\/chain\//.test(path))
    return { kind: "read", endpointClass: "order_lookup" };
  return { kind: "read", endpointClass: "unknown" };
}

export class OpenSeaClient {
  private readonly origin: string;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly maxResponseBytes: number;
  private readonly authorizePublication?: ClientOptions["authorizePublication"];
  private readonly requestBudget?: OpenSeaRequestBudget;
  private inFlight = 0;

  constructor(options: ClientOptions) {
    if (!/^[\x21-\x7e]{1,512}$/.test(options.apiKey))
      throw new Error("Invalid OpenSea API credential.");
    this.key = options.apiKey;
    this.origin = "https://api.opensea.io";
    if (options.fixtureOrigin !== undefined) {
      const url = new URL(options.fixtureOrigin);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.origin !== options.fixtureOrigin ||
        url.username ||
        url.password ||
        options.apiKey !== "yunipals-fixture-only"
      )
        throw new Error(
          "OpenSea fixtures require loopback and a non-secret key."
        );
      this.origin = url.origin;
    }
    if (!options.fixtureOrigin && !options.requestBudget)
      throw new Error("Live OpenSea requests require a shared request budget.");
    this.requestBudget = options.requestBudget;
    this.timeoutMs = limit(options.timeoutMs, 8000, 10000);
    this.maxConcurrent = limit(options.maxConcurrent, 4, 8);
    this.maxResponseBytes = limit(options.maxResponseBytes, 2097152, 4194304);
    this.authorizePublication = options.authorizePublication;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ) {
    if (signal?.aborted) throw new OpenSeaError("provider_timeout");
    if (this.inFlight >= this.maxConcurrent)
      throw new OpenSeaError("provider_busy");
    this.inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | undefined;
    let reservation: string | undefined;
    let observed = false;
    try {
      if (this.requestBudget) {
        try {
          const classification = requestClassification(method, path);
          reservation = await this.requestBudget.reserve(
            classification.kind,
            classification.endpointClass
          );
        } catch (error) {
          // No HTTP request has been dispatched. A quota/DB failure must not
          // create submission uncertainty or be mistaken for provider rejection.
          throw new OpenSeaError(
            "provider_busy",
            undefined,
            error instanceof OpenSeaBudgetError ? error.retryAfterMs : 1000
          );
        }
      }
      if (controller.signal.aborted)
        throw new OpenSeaError("provider_timeout", undefined, 1000);
      // Preserve the existing public classification for caller cancellation
      // before dispatch. The durable reservation is still recorded internally
      // as aborted by the catch block below.
      if (signal?.aborted)
        throw new OpenSeaError("provider_busy", undefined, 1000);
      response = await fetch(`${this.origin}${path}`, {
        method,
        headers: {
          "x-api-key": this.key,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Never send the credential or a signature to a redirect destination.
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([controller.signal, signal])
          : controller.signal
      });
      if (reservation && this.requestBudget) {
        await this.requestBudget.observe(reservation, response);
        observed = true;
      }
      const status = response.status;
      const reset = response.headers.get("x-ratelimit-reset");
      const resetMs =
        status === 429 && reset && /^[0-9]{1,12}$/.test(reset)
          ? Math.max(0, Number(reset) * 1000 - Date.now())
          : 0;
      const retry = retryAfter(response.headers.get("retry-after"));
      const delay =
        retry !== undefined || resetMs > 0
          ? Math.min(3600000, Math.max(retry ?? 0, resetMs))
          : undefined;
      if (status !== 200) {
        await response.body?.cancel();
        const code =
          status === 401 || status === 403
            ? "provider_auth"
            : status === 429
              ? "provider_rate_limited"
              : status === 404
                ? "provider_not_found"
                : "provider_http_error";
        throw new OpenSeaError(code, status, delay);
      }
      const declared = response.headers.get("content-length");
      if (declared && Number(declared) > this.maxResponseBytes) {
        await response.body?.cancel();
        throw new OpenSeaError("provider_response_too_large", status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new OpenSeaError("provider_invalid_response", status);
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > this.maxResponseBytes) {
            await reader.cancel();
            throw new OpenSeaError("provider_response_too_large", status);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks)
          )
        ) as unknown;
      } catch {
        throw new OpenSeaError("provider_invalid_response", status);
      }
    } catch (error) {
      if (reservation && !observed && this.requestBudget?.fail) {
        const outcome = signal?.aborted
          ? "aborted"
          : controller.signal.aborted
            ? "timeout"
            : "network_error";
        await this.requestBudget
          .fail(
            reservation,
            outcome,
            error instanceof OpenSeaError ? (error.retryAfterMs ?? 0) : 0
          )
          .catch(() => {});
      }
      if (error instanceof OpenSeaError) throw error;
      // No raw exception/cause/body/URL can leak the provider credential.
      throw new OpenSeaError(
        controller.signal.aborted || signal?.aborted
          ? "provider_timeout"
          : "provider_network",
        response?.status
      );
    } finally {
      // Also release an unread body if recording response metadata failed.
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => {});
      clearTimeout(timer);
      this.inFlight--;
    }
  }

  async getRegisteredContract(chain: OpenSeaChain, signal?: AbortSignal) {
    return this.request(
      "GET",
      `/api/v2/chain/${chainName(chain)}/contract/${marketplaceChains[chain].contractAddress}`,
      undefined,
      signal
    );
  }

  async getCollection(slug: string, signal?: AbortSignal) {
    return this.request("GET", slugPath(slug), undefined, signal);
  }

  async listCollectionOrders(input: {
    slug: string;
    side: "listing" | "offer";
    limit?: number;
    cursor?: string | null;
    signal?: AbortSignal;
  }) {
    slugPath(input.slug);
    if (!["listing", "offer"].includes(input.side))
      throw new Error("Invalid OpenSea discovery side.");
    const pageSize = limit(input.limit, 50, 50);
    const cursor = input.cursor;
    if (
      cursor !== undefined &&
      cursor !== null &&
      (typeof cursor !== "string" ||
        !cursor.length ||
        cursor.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(cursor))
    )
      throw new Error("Invalid OpenSea discovery cursor.");
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) params.set("next", cursor);
    const kind = input.side === "listing" ? "listings" : "offers";
    const raw = await this.request(
      "GET",
      `/api/v2/${kind}/collection/${input.slug}/all?${params}`,
      undefined,
      input.signal
    );
    try {
      const data = record(raw);
      if (
        !Array.isArray(data[kind]) ||
        data[kind].length > pageSize ||
        !(
          data.next === null ||
          data.next === undefined ||
          (typeof data.next === "string" &&
            data.next.length > 0 &&
            data.next.length <= 4096 &&
            !/[\x00-\x1f\x7f]/.test(data.next))
        )
      )
        throw new Error();
      return {
        orders: data[kind] as unknown[],
        next: (data.next ?? null) as string | null
      };
    } catch {
      throw new OpenSeaError("provider_invalid_response", 200);
    }
  }

  async lookup(expected: MarketOrder) {
    const reviewed = parseMarketOrder(expected);
    if (!isOpenSeaChain(reviewed.asset.chain))
      throw new Error("Unsupported OpenSea chain.");
    let raw: unknown;
    try {
      raw = await this.request(
        "GET",
        `/api/v2/orders/chain/${chainName(reviewed.asset.chain)}/protocol/${reviewed.protocolAddress}/${reviewed.orderHash}`
      );
    } catch (error) {
      // A lookup miss is not proof that an earlier POST was never accepted.
      if (error instanceof OpenSeaError && error.httpStatus === 404)
        return null;
      throw error;
    }
    try {
      return verifyOpenSeaAcknowledgment(
        record(raw).order,
        reviewed,
        new Date()
      );
    } catch {
      throw new OpenSeaError("provider_invalid_response", 200);
    }
  }

  async publish(input: OpenSeaPublication): Promise<OpenSeaPublicationResult> {
    if (!this.authorizePublication)
      return { state: "not_sent", code: "publication_disabled" };
    const publication = snapshotOpenSeaPublication(input);
    try {
      // Give the authorizer a separate copy, retaining the exact transmitted bytes.
      await this.authorizePublication(structuredClone(publication));
    } catch {
      return { state: "not_sent", code: "publication_not_authorized" };
    }
    try {
      const raw = await this.request(
        "POST",
        `/api/v2/orders/${chainName(publication.chain)}/seaport/${publication.summary.side === "listing" ? "listings" : "offers"}`,
        publication.body
      );
      return {
        state: "acknowledged",
        acknowledgment: verifyOpenSeaAcknowledgment(
          raw,
          publication.summary,
          new Date()
        )
      };
    } catch (error) {
      const failure =
        error instanceof OpenSeaError
          ? error
          : new OpenSeaError("provider_invalid_response", 200);
      // Rejection applies to THIS attempt only. Prior uncertainty must still be
      // reconciled; neither a retry's 400 nor a lookup 404 erases that evidence.
      const state =
        failure.code === "provider_busy"
          ? "not_sent"
          : [400, 401, 403, 404, 422, 429].includes(failure.httpStatus ?? 0)
            ? "rejected"
            : "indeterminate";
      return {
        state,
        code: failure.code,
        httpStatus: failure.httpStatus,
        retryAfterMs: failure.retryAfterMs
      };
    }
  }

  // Returns untrusted provider data. The quote service must bind/encode it with
  // the shared fulfillment validator and simulate for this actor before response.
  async fulfillment(expected: MarketOrder, fulfiller: Address) {
    const reviewed = parseMarketOrder(expected);
    if (!isOpenSeaChain(reviewed.asset.chain))
      throw new Error("Unsupported OpenSea chain.");
    const actor = address(fulfiller);
    if (actor === zeroAddress || actor === reviewed.maker)
      throw new Error("Invalid fulfiller.");
    const listing = reviewed.side === "listing";
    return this.request(
      "POST",
      `/api/v2/${listing ? "listings" : "offers"}/fulfillment_data`,
      {
        [listing ? "listing" : "offer"]: {
          hash: reviewed.orderHash,
          chain: chainName(reviewed.asset.chain),
          protocol_address: reviewed.protocolAddress
        },
        fulfiller: { address: actor },
        units_to_fill: "1",
        include_optional_creator_fees: false,
        ...(listing
          ? { recipient: actor }
          : {
              consideration: {
                asset_contract_address: reviewed.asset.contractAddress,
                token_id: reviewed.asset.tokenId
              }
            })
      }
    );
  }
}
