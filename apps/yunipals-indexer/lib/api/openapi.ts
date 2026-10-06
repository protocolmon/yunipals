import { islandsOpenApiPaths } from "./islands-openapi.js";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Yunipals Multi-chain Indexer API",
    version: "1.0.0",
    description: "Ownership and metadata API for Yunipals on Ethereum, Base, Polygon, BNB and Exomon on Solana. Unfiltered requests cover EVM chains. Solana requires chain=solana alone, after SOLANA_API_ENABLED is activated. Solana ownership is periodically observed; complete transfer history and signed visibility are not available."
  },
  servers: [
    { url: "https://api.yunipals.com/yunipals-indexer", description: "Production" },
    { url: "http://127.0.0.1:9011", description: "Server-local" }
  ],
  tags: [
    { name: "Tokens" },
    { name: "Owners" },
    { name: "Collection" },
    { name: "Visibility" },
    { name: "Operations" },
    { name: "Legacy metadata" },
    { name: "Leaderboards" }
  ],
  paths: {
    ...islandsOpenApiPaths,
    "/v1/indexing-status": {
      get:{tags:["Operations"],summary:"Read explicit chain recovery readiness",
        description:"Use chain=solana for the Exomon snapshot, unknown-owner count, and metered RPC credit usage. Without that filter, reports EVM rebuilding/failed chains and verified recovery checkpoints.",
        parameters:[{name:"chain",in:"query",schema:{type:"string",enum:["solana"]},description:"Optional Solana snapshot status selector."}],
        responses:{"200":{description:"Recovery readiness and per-chain state"}}}
    },
    "/legacy-meta/meta": {
      get: { tags:["Legacy metadata"],summary:"Read archived NFT metadata by legacy ID",
        description:"Available in archive mode after activation. Current ownership is overlaid only when one live EVM or Solana binding exists. Multiple live bindings return a null address and X-Metadata-Ownership: chain_ambiguous; use the chain-qualified token API for each owner. Unknown Solana ownership returns 503. Historical unindexed assets are labeled historical_source. The legacy burned-token response remains HTTP 200 with a message and is not valid published metadata.",
        parameters:[{name:"id",in:"query",required:true,schema:{type:"string"}}],
        responses:{"200":{description:"NFT document or legacy message-only response"},"304":{description:"Unchanged response"},"404":{description:"Unknown NFT"},"503":{description:"Archive unavailable, ownership rebuilding, or binding/chain update requires reconciliation"}} }
    },
    "/legacy-meta/v1/getMetasById": {
      post:{tags:["Legacy metadata"],summary:"Read ordered family-qualified legacy metadata",
        requestBody:{required:true,content:{"application/json":{schema:{type:"object",required:["ids"],properties:{ids:{type:"array",minItems:1,maxItems:100,items:{type:"string"}},genIdType:{type:"string"}}}}}},
        responses:{"200":{description:"Ordered metadata array, retaining duplicate IDs"},"400":{description:"Invalid request"},"413":{description:"Bulk or body limit exceeded"},"500":{description:"Legacy bulk failure, including a burned NFT"},"503":{description:"Metadata unavailable"}}}
    },
    "/legacy-meta/v1/all-meta-by-address": {
      get:{tags:["Legacy metadata"],summary:"Read one explicitly supplied wallet's indexed collection",
        description:"Returns wallets, errors, resultCount, metaData and info. Supported ownership chains are Ethereum, Base, Polygon and BNB. Linked-account expansion is retired; expandAddress=true returns 410. Queries are bounded to 1000 tokens; larger wallets should use the paginated native owner API. Unavailable metadata is explicit rather than silently dropping owned tokens.",
        parameters:[{name:"address",in:"query",required:true,schema:{type:"string"}},{name:"expandAddress",in:"query",schema:{type:"boolean",default:false}},
          {name:"chains",in:"query",schema:{type:"array",items:{type:"string",enum:["ethereum","base","polygon","bnb"]}},style:"form",explode:true}],
        responses:{"200":{description:"Wallet collection"},"400":{description:"Unsupported ownership scope/filter"},"410":{description:"Linked-account expansion retired"},"503":{description:"Incomplete collection or result limit exceeded"}}}
    },
    "/legacy-meta/v1/island-meta/{type}/{id}": {
      get:{tags:["Legacy metadata"],summary:"Read preserved static island NFT metadata",
        parameters:[{name:"type",in:"path",required:true,schema:{type:"string",enum:["grassland"]}},{name:"id",in:"path",required:true,schema:{type:"string",enum:["10000000","20000000"]}}],
        responses:{"200":{description:"Static NFT document"},"404":{description:"Unknown static document"},"503":{description:"No active archive"}}}
    },
    "/v1/tokens": {
      get: {
        tags: ["Tokens"], summary: "List and filter tokens",
        description: "Repeated traitType/traitValue pairs are positional. Values within the same trait type use OR; different trait types use AND. Pass nextCursor unchanged with the same filters and sort.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "cursor", in: "query", description: "Opaque pagination cursor. Pass nextCursor unchanged.", schema: { type: "string" } },
          { name: "chain", in: "query", description: "Repeat for EVM chains; use chain=solana alone for Exomon. Omit for all EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true },
          { name: "owner", in: "query", description: "Wallet address or ENS name. Names resolve independently for each selected chain.", schema: { type: "string" } },
          { name: "burned", in: "query", schema: { type: "boolean" } },
          { name: "traitType", in: "query", description: "Repeat alongside traitValue", schema: { type: "array", items: { type: "string" } }, style: "form", explode: true, example: ["Type", "Type", "Glitter"] },
          { name: "traitValue", in: "query", description: "Positional value for each traitType", schema: { type: "array", items: { type: "string" } }, style: "form", explode: true, example: ["Unisheep", "Unidragon", "Gold"] },
          { name: "rarityMin", in: "query", description: "Minimum indexed Rarity Points", schema: { type: "number" } },
          { name: "rarityMax", in: "query", description: "Maximum indexed Rarity Points", schema: { type: "number" } },
          { name: "rarityCappedMin", in: "query", description: "Minimum capped rarity used for comparable scoring", schema: { type: "number" } },
          { name: "rarityCappedMax", in: "query", description: "Maximum capped rarity used for comparable scoring", schema: { type: "number" } },
          { name: "metadata", in: "query", schema: { type: "string", enum: ["all", "available", "missing"], default: "all" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["token-id-asc", "token-id-desc", "rarity-desc", "rarity-asc", "rarity-capped-desc", "rarity-capped-asc"], default: "token-id-asc" } }
        ],
        responses: { "200": { description: "Token page", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenPage" } } } } }
      }
    },
    "/v1/traits": {
      get: {
        tags: ["Tokens"], summary: "Discover active collection trait facets",
        description: "Discovers trait categories dynamically. Categorical traits include collection-wide active-token counts; fully numeric traits include min/max ranges. Burned NFTs are excluded.",
        parameters: [{ name: "chain", in: "query", description: "Use chain=solana alone for Exomon; omit for EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true }],
        responses: { "200": { description: "Trait facets, metadata coverage, and snapshot time", content: { "application/json": { schema: { $ref: "#/components/schemas/TraitFacets" } } } } }
      }
    },
    "/v1/tokens/{tokenId}": {
      get: {
        tags: ["Tokens"], summary: "Get one token with all transfers and lifecycles",
        parameters: [{ name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" }, example: "1000168114" }],
        responses: {
          "200": { description: "Token detail", content: { "application/json": { schema: { type: "object", properties: { token: { $ref: "#/components/schemas/TokenDetail" }, transfers: { type: "array", items: { $ref: "#/components/schemas/Transfer" } }, lifecycles: { type: "array", items: { type: "object", additionalProperties: true } } } } } } },
          "404": { description: "Token not found" }
        }
      }
    },
    "/v1/tokens/{chain}/{tokenId}": {
      get: {
        tags: ["Tokens"], summary: "Get one token from a specific chain",
        parameters: [
          { name: "chain", in: "path", required: true, schema: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } },
          { name: "tokenId", in: "path", required: true, schema: { type: "string", description: "Decimal on EVM; base58 mint on Solana" } }
        ],
        responses: { "200": { description: "Token detail, transfers, and lifecycles" }, "404": { description: "Token not found" } }
      }
    },
    "/v1/tokens/{chain}/{tokenId}/visibility/signing-data": {
      get: {
        tags: ["Visibility"], summary: "Build typed data for hiding or unhiding an NFT",
        description: "Returns five-minute EIP-712 SetTokenVisibility typed data anchored to the token's current indexed ownership event. Only externally owned accounts are supported.",
        parameters: [
          { name: "chain", in: "path", required: true, schema: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } },
          { name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" } },
          { name: "hidden", in: "query", required: true, schema: { type: "boolean" } }
        ],
        responses: {
          "200": { description: "Typed data to pass unchanged to an EIP-712 wallet signer", content: { "application/json": { schema: { type: "object", properties: { typedData: { type: "object", additionalProperties: true } } } } } },
          "400": { description: "Invalid chain, token ID, or hidden value" },
          "404": { description: "Token not found" },
          "409": { description: "Token is burned or otherwise inactive" }
        }
      }
    },
    "/v1/tokens/{chain}/{tokenId}/visibility": {
      put: {
        tags: ["Visibility"], summary: "Apply a signed NFT visibility preference",
        description: "Verifies the exact typed-data message returned by the signing-data endpoint, current ownership, expiry, and the wallet's one-time nonce. Hiding affects token list views only and never affects scoring.",
        parameters: [
          { name: "chain", in: "path", required: true, schema: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } },
          { name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" } }
        ],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VisibilityRequest" } } } },
        responses: {
          "200": { description: "Visibility updated", content: { "application/json": { schema: { $ref: "#/components/schemas/VisibilityResult" } } } },
          "400": { description: "Malformed request, mismatched token, or invalid deadline" },
          "401": { description: "Invalid EOA signature" },
          "404": { description: "Token not found" },
          "409": { description: "Nonce conflict, inactive token, or changed ownership" },
          "410": { description: "Signature expired" }
        }
      }
    },
    "/v1/collections": {
      get: { tags: ["Collection"], summary: "List indexed Yunipals and Exomon collections", responses: { "200": { description: "Chain, contract or network, and supply details" } } }
    },
    "/v1/collector-capabilities": { get: { tags: ["Owners"], summary: "Collector read rollout capabilities", responses: { "200": { description: "version: 1 enables paginated collector filters; namePrefixSearch and rarityRange advertise independently gated support." } } } },
    "/v2/owners/{address}/tokens": {
      get: {
        tags: ["Owners"], summary: "Filter and sort one owner's complete collection using bounded keyset pages",
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string" } },
          { name: "chain", in: "query", style: "form", explode: true, schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } } },
          { name: "t.Type", in: "query", style: "form", explode: true, schema: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } } },
          { name: "t.Color", in: "query", style: "form", explode: true, schema: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } } },
          { name: "rarityMin", in: "query", description: "Inclusive minimum effective rarity score (capped score with raw fallback).", schema: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$" } },
          { name: "rarityMax", in: "query", description: "Inclusive maximum effective rarity score (capped score with raw fallback).", schema: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$" } },
          { name: "q", in: "query", description: "Exact numeric token ID (optional # prefix), or case-insensitive name prefix of at least two characters when enabled.", schema: { type: "string", maxLength: 80 } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["rarity-capped-desc", "rarity-capped-asc"], default: "rarity-capped-desc" } },
          { name: "visibility", in: "query", schema: { type: "string", enum: ["visible", "hidden"], default: "visible" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 48, default: 24 } },
          { name: "cursor", in: "query", description: "Use nextCursor or previousCursor unchanged. Bound to owner, filters, page size and sort; expires after 15 minutes.", schema: { type: "string", maxLength: 2048 } }
        ],
        responses: { "200": { description: "version=1, canonical query, owner resolution, visibility, token items, nextCursor and previousCursor; no total count." }, "400": { description: "Invalid or unsupported filters" }, "409": { description: "Restart from page one: cursor invalid, expired or incompatible" }, "503": { description: "Feature disabled or database unavailable" } }
      }
    },
    "/v1/owners/{address}/tokens": {
      get: {
        tags: ["Owners"], summary: "List active tokens owned by an address or ENS name",
        parameters: [
          { name: "address", in: "path", required: true, description: "Wallet address or ENS name", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "chain", in: "query", description: "Use chain=solana alone with a Solana wallet; omit for EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true },
          { name: "visibility", in: "query", description: "Show normal collection items, hidden items, or both. This is public curation data.", schema: { type: "string", enum: ["visible", "hidden", "all"], default: "visible" } },
          { name: "cursor", in: "query", description: "Opaque cursor bound to the chain and visibility filters.", schema: { type: "string" } }
        ],
        responses: { "200": { description: "Owner token page" } }
      }
    },
    "/v1/leaderboards": { get: { tags: ["Leaderboards"], summary: "List leaderboard definitions and snapshot status", parameters: [{ name: "chain", in: "query", description: "Use chain=solana alone for Exomon; omit for EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true }], responses: { "200": { description: "Available rankings and collector-score formula" } } } },
    "/v1/leaderboards/{metric}": {
      get: {
        tags: ["Leaderboards"], summary: "Get a wallet leaderboard",
        description: "Ranks current holders only. Equal metric values share a dense rank. Use nextCursor unchanged for the next page.",
        parameters: [
          { name: "metric", in: "path", required: true, schema: { type: "string", enum: ["total-rarity", "monster-count", "unique-types", "special-count", "glitter-count", "collector-score"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "chain", in: "query", description: "Use chain=solana alone for Exomon; omit for EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true },
          { name: "cursor", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "Ranked wallet page", content: { "application/json": { schema: { $ref: "#/components/schemas/LeaderboardPage" } } } }, "400": { description: "Invalid cursor" }, "404": { description: "Unknown leaderboard" } }
      }
    },
    "/v1/owners/{address}/leaderboard": {
      get: {
        tags: ["Leaderboards", "Owners"], summary: "Get one wallet's metrics and ranks",
        parameters: [{ name: "address", in: "path", required: true, description: "Wallet address or ENS name", schema: { type: "string" } }, { name: "chain", in: "query", description: "Use chain=solana alone for a Solana wallet; omit for EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true }],
        responses: { "200": { description: "Wallet metrics and ranks" }, "404": { description: "Wallet owns no active Yunipals" } }
      }
    },
    "/v1/collection": { get: { tags: ["Collection"], summary: "Get collection supply counts", parameters: [{ name: "chain", in: "query", description: "Use chain=solana alone for Exomon; omit for EVM chains.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] } }, style: "form", explode: true }], responses: { "200": { description: "Collection totals" } } } },
    "/v1/status": { get: { tags: ["Operations"], summary: "Get metadata ingestion status", responses: { "200": { description: "Worker status" } } } },
    "/health": { get: { tags: ["Operations"], summary: "Process liveness", responses: { "200": { description: "Process is running" } } } },
    "/ready": { get: { tags: ["Operations"], summary: "Database readiness", responses: { "200": { description: "API and database are ready" }, "503": { description: "Database unavailable" } } } }
  },
  components: {
    schemas: {
      Attribute: { type: "object", required: ["trait_type", "value"], properties: { trait_type: { type: "string" }, value: {}, display_type: { type: "string" } }, additionalProperties: true },
      TokenSummary: { type: "object", properties: { chain: { type: "string", enum: ["ethereum", "base", "polygon", "bnb", "solana"] }, chainId: { type: ["integer", "null"] }, contractAddress: { type: ["string", "null"] }, tokenId: { type: "string" }, legacyAlias: { type: "string" }, ownershipObservedAt: { type: "string", format: "date-time" }, owner: { type: ["string", "null"] }, burned: { type: "boolean" }, lifecycle: { type: "integer" }, mintBlock: { type: "string" }, lastTransferBlock: { type: "string" }, name: { type: ["string", "null"] }, image: { type: ["string", "null"], format: "uri" }, attributes: { type: ["array", "null"], items: { $ref: "#/components/schemas/Attribute" } }, tokenUri: { type: ["string", "null"], format: "uri" }, rarityPoints: { type: ["string", "null"], description: "Uncapped upstream rarity score." }, rarityPointsCapped: { type: ["string", "null"], description: "Capped rarity used by leaderboard scoring; falls back to raw rarity when the upstream document has no cap." } } },
      TokenPage: { type: "object", required: ["items", "nextCursor", "total"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/TokenSummary" } }, nextCursor: { type: ["string", "null"], description: "Opaque pagination cursor. Pass unchanged as cursor to retrieve the next page." }, total: { type: "integer" } } },
      TraitFacets: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { oneOf: [
              { type: "object", properties: { traitType: { type: "string" }, kind: { const: "categorical" }, values: { type: "array", items: { type: "object", properties: { value: { type: "string" }, count: { type: "integer" } } } } } },
              { type: "object", properties: { traitType: { type: "string" }, kind: { const: "numeric" }, min: { type: "string" }, max: { type: "string" } } }
            ] }
          },
          metadata: { type: "object", properties: { available: { type: "integer" }, missing: { type: "integer" } } },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      TokenDetail: { type: "object", description: "Current on-chain token state joined with cached metadata. The document field contains the complete upstream metadata JSON.", additionalProperties: true },
      VisibilityMessage: {
        type: "object", required: ["owner", "tokenId", "lifecycle", "ownershipTransactionHash", "ownershipLogIndex", "hidden", "nonce", "deadline"],
        properties: {
          owner: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          tokenId: { type: "string", pattern: "^[0-9]+$" },
          lifecycle: { type: "integer", minimum: 1 },
          ownershipTransactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
          ownershipLogIndex: { type: "integer", minimum: 0 }, hidden: { type: "boolean" },
          nonce: { type: "string", pattern: "^[0-9]+$" }, deadline: { type: "integer", description: "Unix timestamp in seconds" }
        }
      },
      VisibilityRequest: { type: "object", required: ["message", "signature"], properties: { message: { $ref: "#/components/schemas/VisibilityMessage" }, signature: { type: "string" } } },
      VisibilityResult: { type: "object", required: ["chain", "tokenId", "owner", "hidden"], properties: { chain: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] }, tokenId: { type: "string" }, owner: { type: "string" }, hidden: { type: "boolean" } } },
      LeaderboardEntry: { type: "object", properties: { rank: { type: "integer" }, owner: { type: "string" }, ensName: { type: ["string", "null"], description: "Verified primary ENS name when available from daily enrichment." }, score: { type: "string" }, monsterCount: { type: "integer" }, totalRarity: { type: "string" }, uniqueTypes: { type: "integer" }, specialCount: { type: "integer" }, glitterCount: { type: "integer" }, collectorScore: { type: "string" }, updatedAt: { type: "string", format: "date-time" } } },
      LeaderboardPage: { type: "object", properties: { metric: { type: "string" }, label: { type: "string" }, scoreVersion: { type: ["string", "null"] }, items: { type: "array", items: { $ref: "#/components/schemas/LeaderboardEntry" } }, nextCursor: { type: ["string", "null"] }, updatedAt: { type: ["string", "null"], format: "date-time" } } },
      Transfer: { type: "object", properties: { id: { type: "string" }, token_id: { type: "string" }, lifecycle: { type: "integer" }, from: { type: "string" }, to: { type: "string" }, block_number: { type: "string" }, block_timestamp: { type: "string" }, transaction_hash: { type: "string" }, transaction_index: { type: "integer" }, log_index: { type: "integer" } } }
    }
  }
} as const;

export const docsHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yunipals Indexer API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:"./openapi.json",dom_id:"#swagger-ui",deepLinking:true,displayRequestDuration:true});</script></body></html>`;
