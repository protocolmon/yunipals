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
