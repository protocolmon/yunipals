import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Pool } from "pg";
import {
  ownershipIslandsSchemaName,
  ownershipReadConfig,
  unifiedOwnershipReads
} from "../offchain/sql.js";
import { ownershipReadIdentity } from "../ownership/readiness.js";
import { withOwnershipRequest } from "../ownership/request-snapshot.js";
import { islandsReadiness } from "../islands/readiness.js";
import { islandsOpenApiPaths } from "./islands-openapi.js";
import { registerIslandsRoutes } from "./islands-routes.js";
import { registerCombinedIslandsRoutes } from "./islands-combined.js";
import {
  baseIslandCollection,
  baseIslandReadSchema
} from "../islands/collections.js";

export function createIslandsApp(
  apiPool: Pool,
  physicalPonderSchemaName = ownershipIslandsSchemaName
) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "OPTIONS"],
      exposeHeaders: ["X-Indexer-Release"]
    })
  );
  app.use("*", async (c, next) => {
    if (!unifiedOwnershipReads || c.req.method !== "GET") return next();
    c.header("X-Indexer-Release", ownershipReadConfig.releaseId!);
    return withOwnershipRequest(
      apiPool,
      async (db) => ({
        fingerprint: (await ownershipReadIdentity(db))!.identity
      }),
      async () => {
        await next();
      }
    );
  });
  app.onError((_error, c) =>
    c.json({ error: "islands_database_unavailable" }, 503)
  );
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/v2/collections/base-islands/*", (c) =>
    c.json(
      {
        error: "collection_superseded",
        collectionId: "base-islands",
        successor: {
          collectionId: baseIslandCollection.slug,
          contractAddress: baseIslandCollection.address
        },
        message:
          "The first Base airdrop has been replaced. Use the revealed Base Islands collection."
      },
      410
    )
  );
  app.get("/ready", async (c) => {
    const readiness = await islandsReadiness(apiPool, physicalPonderSchemaName);
    const ready = process.env.API_ISLANDS_ENABLED === "true" && readiness.ready;
    return c.json({ ...readiness, ready }, ready ? 200 : 503);
  });
  app.get("/v2/collections/ethereum-islands/openapi.json", (c) =>
    c.json({
      openapi: "3.0.3",
      info: { title: "Yunipals Ethereum Islands", version: "1.0.0" },
      servers: [{ url: "/yunipals-indexer" }],
      paths: islandsOpenApiPaths
    })
  );
  app.get("/v2/collections/base-islands-v2/openapi.json", (c) =>
    c.json({
      openapi: "3.0.3",
      info: { title: "Yunipals Base Islands", version: "1.0.0" },
      servers: [{ url: "/yunipals-indexer" }],
      paths: JSON.parse(
        JSON.stringify(islandsOpenApiPaths)
          .replaceAll("ethereum-islands", "base-islands-v2")
          .replaceAll("Ethereum", "Base")
          .replaceAll("chain is ethereum", "chain is base")
      )
    })
  );
  app.get("/v2/islands/openapi.json", (c) =>
    c.json({
      openapi: "3.0.3",
      info: { title: "Yunipals Islands", version: "2.0.0" },
      servers: [{ url: "/yunipals-indexer" }],
      paths: {
        "/v2/islands/tokens": {
          get: {
            summary: "Browse originals and Base airdrops",
            description:
              "Collections have independent readiness. complete=false and unavailableCollections identify partial coverage. Cursors bind origin, edition, holding, owner, token ID, sort and available collections. No RPC reads run during browsing.",
            parameters: [
              ...[
                "origin",
                "edition",
                "holding",
                "owner",
                "tokenId",
                "sort",
                "cursor"
              ].map((name) => ({
                name,
                in: "query",
                schema: { type: "string" }
              })),
              {
                name: "limit",
                in: "query",
                schema: { type: "integer", minimum: 1, maximum: 100 }
              }
            ],
            responses: {
              "200": {
                description:
                  "items, total, nextCursor, complete, unavailableCollections, collection readiness and staking readiness"
              },
              "400": { description: "Invalid query" },
              "409": { description: "Cursor scope changed" },
              "503": { description: "No requested collection is ready" }
            }
          }
        },
        "/v2/islands/stats": {
          get: {
            summary:
              "Collection counts; holders are distinct wallet addresses across the selected networks",
            responses: {
              "200": {
                description:
                  "Original, airdropped and total NFT counts with coverage status"
              }
            }
          }
        },
        "/v2/islands/indexing-status": {
          get: {
            summary: "Independent Ethereum and Base readiness",
            responses: {
              "200": {
                description: "Collection-specific readiness and freshness"
              }
            }
          }
        }
      }
    })
  );
  registerIslandsRoutes(app, {
    pool: apiPool,
    schemaName: physicalPonderSchemaName
  });

  registerIslandsRoutes(app, {
    pool: apiPool,
    schemaName: baseIslandReadSchema(),
    collection: baseIslandCollection,
    enabled: () => process.env.API_BASE_ISLANDS_ENABLED === "true",
    stakingEnabled: () => false
  });
  registerCombinedIslandsRoutes(app, {
    pool: apiPool,
    ethereumSchema: physicalPonderSchemaName
  });

  return app;
}
