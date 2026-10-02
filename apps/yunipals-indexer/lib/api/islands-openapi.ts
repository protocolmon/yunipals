const collectionRoot = "/v2/collections/ethereum-islands";
const limitParameter = {
  name: "limit",
  in: "query",
  schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
};
const cursorParameter = {
  name: "cursor",
  in: "query",
  schema: { type: "string" },
  description: "Pass nextCursor unchanged with the same filters."
};
const tokenParameter = {
  name: "tokenId",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }
};
const gatedResponses = {
  "200": {
    description:
      "Collection-scoped response. Token IDs and blocks are strings; chain is ethereum and collectionId is ethereum-islands. Metadata is normalized from immutable archived JSON and includes URI/block/hash provenance. Edition is derived from the contract's genesis boundary. Rarity is unscored (null)."
  },
  "400": { description: "Invalid filter, owner, or token ID" },
  "409": { description: "Invalid cursor or cursor from different filters" },
  "503": {
    description:
      "Reads disabled, ownership replay/verification pending, or database unavailable"
  }
};

export const islandsOpenApiPaths = {
  [collectionRoot]: {
    get: {
      tags: ["Collection"],
      summary: "Describe the Ethereum Islands collection",
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/indexing-status`]: {
    get: {
      tags: ["Operations"],
      summary: "Read Islands activation and indexing readiness",
      description:
        "Available while Islands reads are disabled or rebuilding. This collection has independent readiness; existing Yunipals chain scopes are unchanged.",
      responses: {
        "200": {
          description: "Collection identity, enabled flag, and readiness"
        },
        "503": { description: "Database unavailable" }
      }
    }
  },
  [`${collectionRoot}/stats`]: {
    get: {
      tags: ["Collection"],
      summary: "Read Islands supply, edition, holder and metadata counts",
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/tokens`]: {
    get: {
      tags: ["Tokens"],
      summary: "List Ethereum Islands",
      parameters: [
        limitParameter,
        cursorParameter,
        {
          name: "sort",
          in: "query",
          schema: {
            type: "string",
            enum: ["token-id-asc", "token-id-desc"],
            default: "token-id-asc"
          }
        },
        {
          name: "owner",
          in: "query",
          description: "Ethereum wallet address",
          schema: { type: "string" }
        },
        {
          name: "edition",
          in: "query",
          schema: { type: "string", enum: ["Genesis", "Personal"] }
        },
        {
          name: "burned",
          in: "query",
          schema: {
            type: "string",
            enum: ["false", "true", "all"],
            default: "false"
          }
        }
      ],
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/owners/{address}/tokens`]: {
    get: {
      tags: ["Owners"],
      summary: "List one wallet's active Islands",
      parameters: [
        {
          name: "address",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }
        },
        limitParameter,
        cursorParameter,
        {
          name: "sort",
          in: "query",
          schema: { type: "string", enum: ["token-id-asc", "token-id-desc"] }
        },
        {
          name: "edition",
          in: "query",
          schema: { type: "string", enum: ["Genesis", "Personal"] }
        }
      ],
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/tokens/{tokenId}`]: {
    get: {
      tags: ["Tokens"],
      summary: "Read an Island and its mint/burn lifecycle",
      parameters: [tokenParameter],
      responses: { ...gatedResponses, "404": { description: "Unknown Island" } }
    }
  },
  [`${collectionRoot}/tokens/{tokenId}/transfers`]: {
    get: {
      tags: ["Tokens"],
      summary: "Read paginated Island transfer history",
      description:
        "Events are ordered by block, transaction index, and log index. The cursor is tied to the collection and token.",
      parameters: [tokenParameter, limitParameter, cursorParameter],
      responses: gatedResponses
    }
  }
};
