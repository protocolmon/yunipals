const response = {
  "200": {
    description:
      "Collection-qualified booster data, indexed checkpoint, and enabled/paused state. Integer token IDs, prices and timestamps are decimal strings."
  },
  "400": { description: "Invalid identity or pagination" },
  "404": { description: "Unknown token or request" },
  "503": { description: "Booster index unavailable" }
};
const pathParameter = (name: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" }
});
const ownerParameters = [
  pathParameter("address"),
  {
    name: "after",
    in: "query",
    schema: { type: "string" },
    description: "Last numeric token or request ID from the preceding page"
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
  }
];
export const boosterOpenApiPaths = {
  "/v1/boosters/metadata/{collection}/{tokenId}.json": {
    get: {
      tags: ["Boosters"],
      summary: "Read per-NFT birth metadata with approved shared artwork",
      description:
        "Uses one repeatable-read, read-only source snapshot. Birth day is the floor of elapsed seconds between this NFT's MonsterMinted event and its original NFT's MonsterMinted event, divided by86400. Originals are day0; saved batches share their actual mint day. Transfer or burn does not change birth provenance. Artwork is loaded only from configured local catalogs whose commitment and metadata base match the frozen pack. No generation, URI fetch or transaction is triggered. Responses use no-store.",
      parameters: [pathParameter("collection"), pathParameter("tokenId")],
      responses: {
        ...response,
        "200": {
          description:
            "Approved ERC721 variant document with unchanged image/holo assets; adds numeric Birth day and Born date (Unix seconds) attributes. yunipals contains birthMetadataVersion, chainId, collection, tokenId, originalTokenId, isOriginal, birthDay, bornAt/originalBornAt decimal strings and mint/originalMint event/block/hash/transaction/log witnesses."
        },
        "202": {
          description:
            "Birth provenance is available but shared artwork is missing, queued or blocked. Includes birth attributes and Retry-After:5; GET never creates artwork jobs."
        },
        "404": {
          description: "NFT is not indexed in the configured collection"
        },
        "503": {
          description:
            "Source is unavailable, mint/original provenance is missing or ambiguous, or the approved local catalog/variant binding cannot be proven. No guessed birth day is returned."
        }
      }
    }
  },
  "/v1/boosters/art/{catalog}/manifest.json": {
    get: {
      tags: ["Boosters"],
      summary: "Read frozen artwork recipe and exact OG reference commitments",
      parameters: [pathParameter("catalog")],
      responses: response
    }
  },
  "/v1/boosters/art/{catalog}/{variant}.json": {
    get: {
      tags: ["Boosters"],
      summary: "Read shared variant artwork and calibrated holo masks",
      parameters: [pathParameter("catalog"), pathParameter("variant")],
      responses: {
        ...response,
        "202": {
          description:
            "Artwork is queued, missing or awaiting review; retry after five seconds. No image generation is triggered by this GET."
        }
      }
    }
  },
  "/v1/boosters/art-assets/{asset}": {
    get: {
      tags: ["Boosters"],
      summary: "Read immutable SHA256-addressed PNG or SVG assets",
      parameters: [pathParameter("asset")],
      responses: response
    }
  },
  "/v1/boosters/types": {
    get: {
      tags: ["Boosters"],
      summary: "Read activated booster types",
      responses: response
    }
  },
  "/v1/boosters/originals/{collection}/{tokenId}": {
    get: {
      tags: ["Boosters"],
      summary: "Read original mint rights and frozen pack rules",
      parameters: [pathParameter("collection"), pathParameter("tokenId")],
      responses: response
    }
  },
  "/v1/boosters/monsters/{collection}/{tokenId}": {
    get: {
      tags: ["Boosters"],
      summary: "Read monster provenance and durable metadata URI",
      parameters: [pathParameter("collection"), pathParameter("tokenId")],
      responses: response
    }
  },
  "/v1/boosters/requests/{engine}/{requestId}": {
    get: {
      tags: ["Boosters"],
      summary: "Read VRF request and fulfillment status",
      parameters: [pathParameter("engine"), pathParameter("requestId")],
      responses: response
    }
  },
  "/v1/boosters/requests/{engine}/{requestId}/monsters": {
    get: {
      tags: ["Boosters"],
      summary: "Read the exact monster set minted by a completed request",
      description:
        "Returns one complete, numerically ordered set of at most seven monsters, scoped to the configured engine, collection and frozen pack rules. Ownership transfers and later burns do not change request provenance. No wallet filter or global token-ID inference is used. Responses are not cached.",
      parameters: [pathParameter("engine"), pathParameter("requestId")],
      responses: {
        ...response,
        "200": {
          description:
            "Booster snapshot plus requestId, completed status, quantity, exact BoosterMonster items and nextCursor:null. Every item's requestKey matches this request."
        },
        "404": { description: "Request is not indexed in this deployment" },
        "409": {
          description:
            "Request is pending or seeded (request_not_completed), or its pending mints were forfeited (request_forfeited). Includes status and empty items; no reveal may be shown."
        },
        "503": {
          description:
            "Source is not ready, or the completed request's exact quantity/monster set is not yet available. Retry without guessing token IDs."
        }
      }
    }
  },
  ...Object.fromEntries(
    ["monsters", "originals", "requests"].map((resource) => [
      `/v1/owners/{address}/booster-${resource}`,
      {
        get: {
          tags: ["Boosters"],
          summary: `Read a wallet's booster ${resource}`,
          parameters: ownerParameters,
          responses: response
        }
      }
    ])
  ),
  "/v1/owners/{address}/booster-refunds": {
    get: {
      tags: ["Boosters"],
      summary: "Read request-time ETH refunds and withdrawable credit",
      parameters: [pathParameter("address")],
      responses: response
    }
  }
};
