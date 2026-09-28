import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { collectionSlugs, type CollectionSlug } from "../constants.js";
import { LocalMetadataReader } from "../metadata/resolve.js";
import { MetadataUnavailable, metadataError } from "../metadata/publication.js";

export const retiredMetadataPaths = ["/v1/all-islands-by-address", "/v1/rainbow/preview", "/v1/rainbow/prepare",
  "/v1/rainbow/prepareStaking", "/v1/rainbow/portals", "/v1/getHatchingInfo", "/v1/crystalHatch/prepare",
  "/v1/cursedIngredientsFusion/prepare", "/landingpagestats", "/get-circulating", "/v1/postSwappedIdsByAddress",
  "/functions/all-meta-by-address", "/functions/meta-get-by-address", "/v1/all-meta-for-user", "/getIdsByType", "/v1/getMetasByType",
  "/functions/meta-get-by-tx", "/v1/get-metas-by-tx-hash", "/functions/meta-get-booster-openings-by-address",
  "/functions/get-booster-opening-amount-by-address", "/v1/get-booster-openings-by-period", "/functions/ids-get-changes-trough-transactions"];
export function validLegacyId(value: unknown): value is string {
  return typeof value === "string" && (/^\d{1,78}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));
}
export function legacyMetadataRouter(reader: LocalMetadataReader) {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowMethods: ["GET","HEAD","POST","OPTIONS"], allowHeaders: ["Content-Type","If-None-Match"],
    exposeHeaders: ["ETag","X-Metadata-Release","X-Metadata-Ownership"] }));
  app.use("*", bodyLimit({ maxSize: 65536, onError: c => c.json({ error: "body_too_large" }, 413) }));
  app.onError((error,c) => {
    const unavailable = metadataError(error);
    return c.json({ error: unavailable.reason }, unavailable.status === "unavailable" ? 404 : 503);
  });
  app.get("/meta", async c => {
    c.header("Cache-Control", "public, max-age=0, must-revalidate");
    const ids = c.req.queries("id");
    if (!ids?.length || !ids[0]) return c.json({ message: "Missing id" });
    if (ids.length !== 1 || !validLegacyId(ids[0])) return c.json({ message: "Invalid id" });
    try {
      const result = await reader.byId(ids[0]);
      c.header("X-Metadata-Release", result.release); c.header("X-Metadata-Ownership", result.ownership);
      c.header("Cache-Control", "public, max-age=0, must-revalidate");
      const etag = `"${result.contentHash}"`; c.header("ETag", etag);
      if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
      return c.json(result.document);
    } catch (error) {
      const unavailable = metadataError(error);
      if (unavailable.reason === "burned") return c.json({ message: "NFT is burned" });
      if (unavailable.reason === "source_missing") return c.json({ status: 404, message: "No polkamon found" }, 404);
      if (unavailable.reason === "source_invalid" || unavailable.reason === "invalid_metadata_document") return c.json({ message: "An error occurred" }, 500);
      throw unavailable;
    }
  });
  app.post("/v1/getMetasById", async c => {
    let body: { ids?: unknown; genIdType?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
    if (!body || !Array.isArray(body.ids) || !body.ids.length) return c.json({ message: "Missing ids" }, 400);
    if (body.ids.length > 100) return c.json({ error: "too_many_ids", maximum: 100 }, 413);
    const ids=body.ids.map(id=>typeof id==='number'&&Number.isSafeInteger(id)&&id>=0?String(id):id);
    if (ids.some(id => !validLegacyId(id))) return c.json({ message: "At least one Ids is invalid. Check your request!" }, 400);
    if (body.genIdType !== undefined && (typeof body.genIdType !== "string" || !/^[A-Z0-9_]{1,64}$/.test(body.genIdType))) return c.json({ error: "invalid_family" }, 400);
    const documents: Record<string,unknown>[] = [];
    try {
      for (let i=0;i<ids.length;i+=8) {
        const batch = await Promise.all((ids as string[]).slice(i,i+8).map(id => reader.byId(id, body.genIdType as string | undefined, "legacy-factory")));
        documents.push(...batch.map(result => result.document));
      }
      return c.json(documents);
    } catch(error) {
      const unavailable = metadataError(error);
      if (unavailable.reason === "burned") return c.text("Something went wrong while fetch Metadata. Reason: Error: NFT is burned", 500);
      if (unavailable.reason === "source_missing") return c.text("Something went wrong while fetch Metadata. Reason: Error: No polkamon found", 500);
      throw unavailable;
    }
  });
  app.get("/v1/island-meta/:type/:id", async c => {
    const {type,id} = c.req.param();
    if (type !== "grassland") return c.json({message:"No metadata found for the id & type"},404);
    const document = await reader.island(type,id);
    return document ? c.json(document) : c.json({message:"No metadata found for the id"},404);
  });
  app.get("/v1/all-meta-by-address", async c => {
    const address = c.req.query("address");
    if (!address) return c.json({message:"Missing id"});
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({error:"invalid_address"},400);
    if (c.req.query("expandAddress") === "true") return c.json({error:"linked_wallet_expansion_retired", message:"Supply an explicit wallet with expandAddress=false"},410);
    if (c.req.query("filter")) return c.json({error:"legacy_filter_unsupported",message:"Use /v1/tokens for collection filtering"},400);
    const aliases: Record<string,CollectionSlug> = {eth:"ethereum",ETHEREUM:"ethereum",bsc:"bnb",BSC:"bnb",POLYGON:"polygon",BASE:"base"};
    const rawChains = c.req.queries("chains[]") ?? c.req.queries("chains");
    const chains = rawChains ? rawChains.map(value => aliases[value] ?? value) : collectionSlugs;
    if (!chains.length || chains.some(value => !collectionSlugs.includes(value as CollectionSlug))) return c.json({error:"unsupported_ownership_chain",supported:collectionSlugs},400);
    let documents = await reader.owned(address, chains as CollectionSlug[]);
    const fields = c.req.query("fields");
    if (fields) {
      try { const value = JSON.parse(fields); const names = Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value) : null;
        if (names?.every((name: unknown) => typeof name === "string")) documents = documents.map(doc => Object.fromEntries(Object.entries(doc).filter(([key]) => names.includes(key))));
      } catch { /* Legacy handler ignores malformed fields. */ }
    }
    c.header("X-Metadata-Ownership","indexed_chain");
    return c.json({wallets:[{address,chainType:"EVM"}],errors:[],resultCount:documents.length,metaData:documents,info:[]});
  });
  for (const path of retiredMetadataPaths) app.on(["GET","POST"],path,c => c.json({error:"retired_endpoint"},410));
  return app;
}
