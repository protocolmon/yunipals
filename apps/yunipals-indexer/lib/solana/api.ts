import { createHash } from "node:crypto";
import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { isSolanaAddress } from "./das.js";

export const solanaApiEnabled = () => process.env.SOLANA_API_ENABLED === "true";
const selection = (url: string) => new URL(url).searchParams.getAll("chain");
const wantsSolana = (url: string) => selection(url).includes("solana");
const solanaOnly = (url: string) => {
  const values = selection(url);
  return values.length > 0 && values.every(value => value === "solana");
};
const chainJson = { chain:"solana",chains:["solana"] };
const sorts = ["token-id-asc","token-id-desc","rarity-desc","rarity-asc","rarity-capped-desc","rarity-capped-asc"] as const;
const metrics = {
  "total-rarity": { column:"total_rarity", label:"Total rarity" },
  "monster-count": { column:"monster_count", label:"Monster count" },
  "unique-types": { column:"unique_types", label:"Unique types" },
  "special-count": { column:"special_count", label:"Special count" },
  "glitter-count": { column:"glitter_count", label:"Glitter count" },
  "collector-score": { column:"collector_score", label:"Collector score" }
} as const;
const limitOf = (raw?: string): number | null => {
  if (raw === undefined) return 50;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0,20);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string | undefined): { v: 1; run: number; offset: number; config: string } | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value,"base64url").toString());
    return parsed?.v===1 && Number.isSafeInteger(parsed.run) && Number.isSafeInteger(parsed.offset)
      && parsed.offset>=0 && parsed.offset<=100_000 && typeof parsed.config==="string" ? parsed : null;
  } catch { return null; }
};

type Published = { runId: number; completedAt: Date; manifestCount: number; missingCount: number };
async function published(client: Pick<PoolClient,"query">): Promise<Published | null> {
  const row = (await client.query<{ runId: string; completedAt: Date; manifestCount: number; missingCount: number }>(
    `SELECT r.id::text AS "runId",r.completed_at AS "completedAt",
      r.asset_count AS "manifestCount",r.missing_count AS "missingCount"
      FROM solana_indexer.sync_state s JOIN solana_indexer.scan_run r ON r.id=s.published_run_id
      WHERE s.singleton AND r.state='published'`
  )).rows[0];
  return row ? { ...row,runId:Number(row.runId) } : null;
}
const isFresh = (run: Published | null): run is Published =>
  !!run && Date.now()-new Date(run.completedAt).getTime() <= 86_400_000;

export async function solanaStatus(pool: Pool) {
  const [run, state, usage, tokens] = await Promise.all([
    published(pool),
    pool.query(`SELECT next_scan_at AS "nextScanAt",last_error AS "lastError",updated_at AS "updatedAt"
      FROM solana_indexer.sync_state WHERE singleton`),
    pool.query(`SELECT COALESCE(sum(credits) FILTER (WHERE reserved_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int AS "todayCredits",
      COALESCE(sum(credits),0)::int AS "rolling31DayCredits"
      FROM solana_indexer.rpc_usage WHERE reserved_at>=now()-interval '31 days'`),
    pool.query(`SELECT count(*)::int AS "indexedTokens",
      count(*) FILTER (WHERE NOT burnt)::int AS "activeSupply",
      count(*) FILTER (WHERE burnt)::int AS "burnedTokens" FROM solana_indexer.token`)
  ]);
  const ageMs = run ? Date.now()-new Date(run.completedAt).getTime() : null;
  return { enabled:solanaApiEnabled(),ready:!!run && ageMs!==null && ageMs<86_400_000,
    freshness:ageMs===null?"unavailable":ageMs>1_800_000?"stale":"fresh",
    publishedRunId:run?.runId??null,publishedAt:run?.completedAt??null,
    manifestCount:run?.manifestCount??null,missingCount:run?.missingCount??null,
    ...tokens.rows[0],...state.rows[0],rpc:usage.rows[0] };
}

function tokenColumns() { return `t.mint AS "tokenId",'solana'::text AS chain,'exomon'::text AS collection,
  'mainnet-beta'::text AS network,NULL::integer AS "chainId",NULL::text AS "contractAddress",
  t.owner,t.burnt AS burned,t.delegated,t.delegate,t.observed_at AS "ownershipObservedAt",
  t.metadata_uri AS "tokenUri",t.metadata_slot AS "metadataIndexedSlot",
  a.legacy_alias AS "legacyAlias",m.name,m.image,m.attributes,
  true AS "metadataAvailable",m.rarity_points::text AS "rarityPoints",
  m.rarity_points_capped::text AS "rarityPointsCapped"`; }

async function tokenPage(pool: Pool,url: string,ownerOverride?: string) {
  const query = new URL(url).searchParams;
  const owner = ownerOverride ?? query.get("owner");
  if (owner && !isSolanaAddress(owner)) return { error:"invalid_solana_owner",status:400 as const };
  const limit = limitOf(query.get("limit") ?? undefined);
  if (limit === null) return {error:"invalid_limit",status:400 as const};
  const sort = query.get("sort") ?? "token-id-asc";
  if (!sorts.includes(sort as typeof sorts[number])) return { error:"invalid_sort",status:400 as const };
  const burned = query.get("burned");
  if (burned!==null && burned!=="true" && burned!=="false") return { error:"invalid_burned",status:400 as const };
  const metadata = query.get("metadata") ?? "all";
  if (!["all","available","missing"].includes(metadata)) return { error:"invalid_metadata_filter",status:400 as const };
  const traitTypes = query.getAll("traitType"), traitValues=query.getAll("traitValue");
  if (traitTypes.length!==traitValues.length || traitTypes.some(v=>!v) || traitValues.some(v=>!v))
    return { error:"invalid_trait_filter",status:400 as const };
  const rarityKeys = ["rarityMin","rarityMax","rarityCappedMin","rarityCappedMax"] as const;
  for (const key of rarityKeys) if (query.has(key) && !/^-?\d+(\.\d+)?$/.test(query.get(key)!))
    return { error:`invalid_${key}`,status:400 as const };
  if (query.has("rarityMin") && query.has("rarityMax") && Number(query.get("rarityMin"))>Number(query.get("rarityMax")))
    return { error:"invalid_rarity_range",status:400 as const };
  if (query.has("rarityCappedMin") && query.has("rarityCappedMax") && Number(query.get("rarityCappedMin"))>Number(query.get("rarityCappedMax")))
    return { error:"invalid_rarity_range",status:400 as const };
  const traitGroups = new Map<string,string[]>();
  for (let i=0;i<traitTypes.length;i++) traitGroups.set(traitTypes[i]!,[
    ...new Set([...(traitGroups.get(traitTypes[i]!)??[]),traitValues[i]!])
  ]);
  const normalizedTraits = [...traitGroups].sort(([a],[b])=>a.localeCompare(b))
    .map(([type,values])=>[type,values.sort()]);
  const config = hash({ owner,burned,metadata,sort,traits:normalizedTraits,
    rarityKeys:rarityKeys.map(key=>query.get(key)) });
  const rawCursor=query.get("cursor")??undefined, cursor=decode(rawCursor);
  if (rawCursor && (!cursor || cursor.config!==config)) return { error:"invalid_cursor",status:400 as const };
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const run = await published(client);
    if (!isFresh(run)) {
      await client.query("COMMIT"); return { error:"solana_ownership_unavailable",status:503 as const };
    }
    if (cursor && cursor.run!==run.runId) {
      await client.query("COMMIT"); return { error:"cursor_expired",status:409 as const };
    }
    const params: unknown[]=[];
    const where=["true"];
    if (owner) { params.push(owner);where.push(`t.owner=$${params.length}`); }
    if (ownerOverride) where.push("NOT t.burnt");
    if (burned!==null) { params.push(burned==="true");where.push(`t.burnt=$${params.length}`); }
    if (metadata==="missing") where.push("false");
    for (const [type,values] of normalizedTraits) {
      params.push(type,values);
      where.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(m.attributes) f
        WHERE f->>'trait_type'=$${params.length-1} AND f->>'value'=ANY($${params.length}::text[]))`);
    }
    for (const [key,column,op] of [
      ["rarityMin","m.rarity_points",">="],["rarityMax","m.rarity_points","<="],
      ["rarityCappedMin","m.rarity_points_capped",">="],["rarityCappedMax","m.rarity_points_capped","<="]
    ] as const) if(query.has(key)){params.push(query.get(key));where.push(`${column}${op}$${params.length}::numeric`);}
    const source=`FROM solana_indexer.token t JOIN solana_indexer.manifest_asset a USING(mint)
      JOIN solana_indexer.asset_metadata m USING(mint) WHERE ${where.join(" AND ")}`;
    const total=Number((await client.query<{ count: string }>(`SELECT count(*)::text AS count ${source}`,params)).rows[0]!.count);
    const order=sort==="token-id-desc"?`t.mint COLLATE "C" DESC`
      :sort==="token-id-asc"?`t.mint COLLATE "C" ASC`
        :`m.${sort.startsWith("rarity-capped")?"rarity_points_capped":"rarity_points"}
          ${sort.endsWith("desc")?"DESC":"ASC"} NULLS LAST,t.mint COLLATE "C" ASC`;
    params.push(limit+1,cursor?.offset??0);
    const rows=(await client.query(`SELECT ${tokenColumns()} ${source}
      ORDER BY ${order} LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
    await client.query("COMMIT");
    const items=rows.slice(0,limit),hasMore=rows.length>limit;
    return { ...chainJson,items,total,
      nextCursor:hasMore?encode({v:1,run:run.runId,offset:(cursor?.offset??0)+limit,config}):null,
      ownershipObservedAt:run.completedAt,historyMode:"observed_changes" };
  } catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}

export function mountSolanaApi(app: Hono, pool: Pool) {
  const scopeError=(url:string)=>!solanaOnly(url);
  const disabled=()=>!solanaApiEnabled();
  app.get("/v1/tokens",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    const response=await tokenPage(pool,c.req.url);
    return "error" in response?c.json({error:response.error},response.status):c.json(response);
  });
  app.get("/v1/tokens/solana/:mint",async c=>{
    if(disabled())return c.json({error:"solana_disabled"},503);
    const mint=c.req.param("mint");
    if(!isSolanaAddress(mint))return c.json({error:"invalid_solana_mint"},400);
    const run=await published(pool);
    if(!isFresh(run))
      return c.json({error:"solana_ownership_unavailable"},503);
    const [token,changes]=await Promise.all([
      pool.query(`SELECT ${tokenColumns()},m.document,m.content_hash AS "metadataContentHash"
        FROM solana_indexer.token t JOIN solana_indexer.manifest_asset a USING(mint)
        JOIN solana_indexer.asset_metadata m USING(mint) WHERE t.mint=$1`,[mint]),
      pool.query(`SELECT previous_owner AS "previousOwner",owner,previous_burnt AS "previousBurnt",
        burnt,observed_at AS "observedAt" FROM solana_indexer.observed_change
        WHERE mint=$1 ORDER BY run_id DESC LIMIT 100`,[mint])
    ]);
    const row=token.rows[0];
    if(!row){
      const known=await pool.query(`SELECT 1 FROM solana_indexer.manifest_asset WHERE mint=$1`,[mint]);
      return known.rowCount?c.json({error:"solana_ownership_unavailable"},503):c.json({error:"Token not found"},404);
    }
    row.document={...row.document,address:row.burned?null:row.owner,minted:!row.burned,
      ownerSince:null,ownershipObservedAt:row.ownershipObservedAt};
    return c.json({token:row,transfers:[],lifecycles:[],observedChanges:changes.rows,
      historyMode:"observed_changes",...chainJson});
  });
  app.get("/v1/tokens/solana/:mint/visibility/signing-data",c=>c.json({error:"solana_visibility_unsupported"},501));
  app.put("/v1/tokens/solana/:mint/visibility",c=>c.json({error:"solana_visibility_unsupported"},501));
  app.get("/v1/owners/:address/tokens",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    const visibility=c.req.query("visibility")??"visible";
    if(visibility!=="visible" && visibility!=="all")return c.json({error:"solana_visibility_unsupported"},501);
    const response=await tokenPage(pool,c.req.url,c.req.param("address"));
    return "error" in response?c.json({error:response.error},response.status)
      :c.json({...response,owner:c.req.param("address"),visibility});
  });
  app.get("/v1/traits",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    const run=await published(pool);
    if(!isFresh(run))return c.json({error:"solana_ownership_unavailable"},503);
    const values=await pool.query(`WITH counted AS (
      SELECT f->>'trait_type' AS trait_type,f->>'value' AS value,
        count(*)::int AS count
      FROM solana_indexer.token t JOIN solana_indexer.asset_metadata m USING(mint)
      CROSS JOIN LATERAL jsonb_array_elements(m.attributes) f
      WHERE NOT t.burnt AND f ? 'trait_type' AND f ? 'value'
      GROUP BY f->>'trait_type',f->>'value')
      SELECT trait_type AS "traitType",jsonb_agg(jsonb_build_object('value',value,'count',count)
        ORDER BY count DESC,value) AS values FROM counted GROUP BY trait_type ORDER BY trait_type`);
    return c.json({...chainJson,items:values.rows.map(row=>({...row,kind:"categorical"})),
      metadata:{available:run.manifestCount,missing:0},
      ownershipMissing:run.missingCount,updatedAt:run.completedAt});
  });
  app.get("/v1/collection",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    const status=await solanaStatus(pool);
    if(!status.ready)return c.json({error:"solana_ownership_unavailable"},503);
    return c.json({...chainJson,collection:"exomon",network:"mainnet-beta",
      knownTokens:status.manifestCount??0,indexedTokens:status.indexedTokens,
      activeSupply:status.activeSupply,burnedTokens:status.burnedTokens,
      missingCount:status.missingCount,lifecycles:null,ownershipObservedAt:status.publishedAt});
  });
  app.get("/v1/leaderboards",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    if(!isFresh(await published(pool)))return c.json({error:"solana_ownership_unavailable"},503);
    const result=await pool.query(`SELECT count(*)::int AS wallets,max(updated_at) AS "updatedAt"
      FROM solana_indexer.wallet_stats`);
    return c.json({...chainJson,items:Object.entries(metrics).map(([slug,definition])=>({slug,label:definition.label})),
      collectorScore:{version:"collector-score-v1",formula:"1000*ln(1+totalRarity) + 50*monsterCount + 500*uniqueTypes + 750*specialCount + 250*glitterCount"},
      ...result.rows[0]});
  });
  app.get("/v1/leaderboards/:metric",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    const slug=c.req.param("metric") as keyof typeof metrics,definition=metrics[slug];
    if(!definition)return c.json({error:"Unknown leaderboard",available:Object.keys(metrics)},404);
    const run=await published(pool);
    if(!isFresh(run))return c.json({error:"solana_ownership_unavailable"},503);
    const raw=c.req.query("cursor"),cursor=decode(raw);
    if(raw && (!cursor || cursor.run!==run.runId || cursor.config!==hash(slug)))
      return c.json({error:"invalid_or_expired_cursor"},409);
    const limit=limitOf(c.req.query("limit"));
    if(limit===null)return c.json({error:"invalid_limit"},400);
    const result=await pool.query(`WITH ranked AS (
      SELECT *,dense_rank() OVER (ORDER BY ${definition.column} DESC) AS rank
      FROM solana_indexer.wallet_stats WHERE ${definition.column}>0)
      SELECT rank::int,owner,${definition.column}::text AS score,
        monster_count AS "monsterCount",total_rarity::text AS "totalRarity",
        unique_types AS "uniqueTypes",special_count AS "specialCount",
        glitter_count AS "glitterCount",collector_score::text AS "collectorScore",
        updated_at AS "updatedAt",NULL::text AS "ensName" FROM ranked
      ORDER BY ${definition.column} DESC,monster_count DESC,owner COLLATE "C"
      LIMIT $1 OFFSET $2`,[limit+1,cursor?.offset??0]);
    return c.json({...chainJson,metric:slug,label:definition.label,
      scoreVersion:slug==="collector-score"?"collector-score-v1":null,
      items:result.rows.slice(0,limit),nextCursor:result.rows.length>limit
        ?encode({v:1,run:run.runId,offset:(cursor?.offset??0)+limit,config:hash(slug)}):null,
      updatedAt:result.rows[0]?.updatedAt??null});
  });
  app.get("/v1/owners/:address/leaderboard",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    if(scopeError(c.req.url))return c.json({error:"mixed_solana_scope_unavailable"},400);
    const owner=c.req.param("address");
    if(!isSolanaAddress(owner))return c.json({error:"invalid_solana_owner"},400);
    if(!isFresh(await published(pool)))return c.json({error:"solana_ownership_unavailable"},503);
    const result=await pool.query(`WITH ranked AS (
      SELECT *,dense_rank() OVER (ORDER BY total_rarity DESC) AS total_rarity_rank,
        dense_rank() OVER (ORDER BY monster_count DESC) AS monster_count_rank,
        dense_rank() OVER (ORDER BY unique_types DESC) AS unique_types_rank,
        dense_rank() OVER (ORDER BY special_count DESC) AS special_count_rank,
        dense_rank() OVER (ORDER BY glitter_count DESC) AS glitter_count_rank,
        dense_rank() OVER (ORDER BY collector_score DESC) AS collector_score_rank
      FROM solana_indexer.wallet_stats)
      SELECT owner,monster_count AS "monsterCount",total_rarity::text AS "totalRarity",
        unique_types AS "uniqueTypes",special_count AS "specialCount",
        glitter_count AS "glitterCount",collector_score::text AS "collectorScore",
        total_rarity_rank::int AS "totalRarityRank",monster_count_rank::int AS "monsterCountRank",
        unique_types_rank::int AS "uniqueTypesRank",special_count_rank::int AS "specialCountRank",
        glitter_count_rank::int AS "glitterCountRank",collector_score_rank::int AS "collectorScoreRank",
        NULL::text AS "ensName",updated_at AS "updatedAt" FROM ranked WHERE owner=$1`,[owner]);
    if(!result.rows[0])return c.json({error:"Wallet has no active Exomon"},404);
    return c.json({...result.rows[0],...chainJson,ownerInput:owner,ownerName:null,resolvedAddresses:{solana:owner}});
  });
  app.get("/v1/indexing-status",async(c,next)=>{
    if(!wantsSolana(c.req.url))return next();
    if(disabled())return c.json({error:"solana_disabled"},503);
    return c.json(await solanaStatus(pool));
  });
}
