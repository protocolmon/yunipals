import type { PoolClient } from "pg";
import {
  collections,
  ZERO_ADDRESS,
  type CollectionSlug
} from "../constants.js";
import { ownershipBnbSchema, ownershipPonderSchema } from "../offchain/sql.js";

export type VersionMint = {
  recipient: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
};
export type AuditedVersionMember = {
  chain: CollectionSlug;
  contractAddress: string;
  tokenId: string;
  lifecycle: number;
  mintTransactionHash: string;
  mintLogIndex: number;
  assetKey: string;
  role: "original" | "airdrop";
};
export type ArchivedMonsterIdentity = {
  tokenId: string;
  chainId: string;
  family: string;
  originType: string | null;
  minted: boolean | null;
  sourceHash: string;
};
export type InitialOwnerRow = {
  tokenId: string;
  lifecycle: number;
  burned: boolean;
  currentOwner: string;
  firstLifecycle: number | null;
  lifecycleRecipient: string | null;
  firstMints: VersionMint[];
  currentMints: VersionMint[];
  assetKeys: string[];
  archivedOriginals: ArchivedMonsterIdentity[];
  sources: (AuditedVersionMember & { mintCount: number })[];
};

/** Text keyset order uses the token primary key and never converts IDs to Number. */
export function initialOwnerPageQuery(
  release: string,
  after: string,
  limit: number
) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    (after && !/^(0|[1-9]\d{0,77})$/.test(after))
  )
    throw new Error("Invalid initial-owner page.");
  const mint = (
    lifecycle: string
  ) => `SELECT lower(e."to") AS recipient,e.transaction_hash AS "transactionHash",e.block_number::text AS "blockNumber",e.log_index AS "logIndex"
    FROM ${ownershipPonderSchema}.transfer_event e
    WHERE e.collection='base' AND e.token_id=t.token_id AND e.lifecycle=${lifecycle}
      AND e.chain_id=8453 AND lower(e.contract_address)=$4 AND e."from"=$5
    ORDER BY e.block_number,e.transaction_index,e.log_index LIMIT 2`;
  const text = `WITH page AS MATERIALIZED (
    SELECT * FROM ${ownershipPonderSchema}.token WHERE $1::text<>'' AND collection='base' AND chain_id=8453 AND lower(contract_address)=$4 AND token_id>$2
    ORDER BY token_id LIMIT $3
  ) SELECT t.token_id AS "tokenId",t.lifecycle,t.burned,lower(t.owner) AS "currentOwner",first_life.lifecycle AS "firstLifecycle",lower(first_life.minted_to) AS "lifecycleRecipient",
    COALESCE(first_events.mints,'[]'::jsonb) AS "firstMints",COALESCE(current_events.mints,'[]'::jsonb) AS "currentMints",
    '[]'::jsonb AS "assetKeys",'[]'::jsonb AS "archivedOriginals",'[]'::jsonb AS sources
    FROM page t
    LEFT JOIN LATERAL(SELECT lifecycle,minted_to FROM ${ownershipPonderSchema}.token_lifecycle l WHERE l.collection='base' AND l.token_id=t.token_id ORDER BY lifecycle LIMIT 1) first_life ON true
    LEFT JOIN LATERAL(SELECT jsonb_agg(m) AS mints FROM (${mint("first_life.lifecycle")}) m) first_events ON true
    LEFT JOIN LATERAL(SELECT jsonb_agg(m) AS mints FROM (${mint("t.lifecycle")}) m) current_events ON true
    ORDER BY t.token_id`;
  return {
    text,
    values: [release, after, limit, collections.base.address, ZERO_ADDRESS]
  };
}

export async function readInitialOwnerPage(
  db: Pick<PoolClient, "query">,
  release: string,
  after: string,
  limit: number
) {
  const page = initialOwnerPageQuery(release, after, limit);
  const rows = (await db.query<InitialOwnerRow>(page.text, page.values)).rows;
  return attachInitialOwnerSources(db, release, rows);
}

/** A short cursor amortizes chain-read guards while allowing fresh validation between chunks. */
export function initialOwnerScanQuery(
  release: string,
  after = "",
  chunkSize = 5000
) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 5000)
    throw new Error("Invalid audit chunk size.");
  const q = initialOwnerPageQuery(release, after, 500);
  q.values[2] = chunkSize;
  return q;
}

export async function attachInitialOwnerSources(
  db: Pick<PoolClient, "query">,
  release: string,
  rows: InitialOwnerRow[]
) {
  const wanted = rows
    .filter((r) => r.currentMints.length === 1)
    .map((r) => ({ tokenId: r.tokenId, ...r.currentMints[0]! }));
  if (!wanted.length) return rows;
  const bindings = (
    await db.query<{ tokenId: string; assetKey: string }>(
      `SELECT x."tokenId",b.asset_key AS "assetKey"
    FROM jsonb_to_recordset($2::jsonb) AS x("tokenId" text,"transactionHash" text,"logIndex" integer)
    JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id='8453' AND b.contract_address=$3
      AND b.token_id=x."tokenId" AND b.mint_transaction_hash=x."transactionHash" AND b.mint_log_index=x."logIndex"`,
      [release, JSON.stringify(wanted), collections.base.address]
    )
  ).rows;
  const byToken = new Map<string, string[]>();
  for (const b of bindings)
    byToken.set(b.tokenId, [...(byToken.get(b.tokenId) ?? []), b.assetKey]);
  for (const row of rows) row.assetKeys = byToken.get(row.tokenId) ?? [];
  const keys = [...new Set(bindings.map((b) => b.assetKey))];
  if (!keys.length) return rows;
  const archived = await readArchivedMonsterIdentities(db, release, keys);
  const identities = new Map<string, ArchivedMonsterIdentity[]>();
  const hints = new Map<string, { assetKey: string; tokenId: string }>();
  for (const { assetKey, ...identity } of archived) {
    identities.set(assetKey, [...(identities.get(assetKey) ?? []), identity]);
    hints.set(JSON.stringify([assetKey, identity.tokenId]), {
      assetKey,
      tokenId: identity.tokenId
    });
  }
  // EVM versions can retain the Base ID even when the archive's primary ID is
  // a Solana mint address. Both lookups still require the same canonical asset.
  for (const { tokenId, assetKey } of bindings)
    if (identities.has(assetKey))
      hints.set(JSON.stringify([assetKey, tokenId]), { assetKey, tokenId });
  for (const row of rows)
    if (row.assetKeys.length === 1)
      row.archivedOriginals = identities.get(row.assetKeys[0]!) ?? [];
  if (!hints.size) return rows;
  // The archive's chain is an observation, not the current NFT location. Search
  // every configured original contract, then require the exact shared identity
  // and canonical mint. A matching token ID alone never establishes a pair.
  const sourceBranch = (
    schema: string,
    chain: "ethereum" | "polygon" | "bnb"
  ) => `SELECT x."assetKey" AS "lookupKey",t.collection AS chain,lower(t.contract_address) AS "contractAddress",t.token_id AS "tokenId",t.lifecycle,
    b.mint_transaction_hash AS "mintTransactionHash",b.mint_log_index AS "mintLogIndex",b.asset_key AS "assetKey",'original'::text AS role,
    (SELECT count(*)::int FROM (SELECT 1 FROM ${schema}.transfer_event e WHERE e.collection=t.collection AND e.token_id=t.token_id AND e.lifecycle=t.lifecycle
      AND e.chain_id=t.chain_id AND lower(e.contract_address)=lower(t.contract_address) AND e."from"=$3
      AND e.transaction_hash=b.mint_transaction_hash AND e.log_index=b.mint_log_index AND e.block_number=l.mint_block LIMIT 2) valid_mints) AS "mintCount"
    FROM input x JOIN LATERAL(SELECT * FROM ${schema}.token t WHERE t.collection='${chain}' AND t.token_id=x."tokenId" OFFSET 0) t ON true
    JOIN LATERAL(SELECT mint_transaction_hash,mint_block FROM ${schema}.token_lifecycle l WHERE l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle OFFSET 0) l ON true
    JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id=t.chain_id::text AND b.contract_address=lower(t.contract_address)
      AND b.token_id=t.token_id AND b.asset_key=x."assetKey" AND b.mint_transaction_hash=l.mint_transaction_hash`;
  const originals = (
    await db.query<InitialOwnerRow["sources"][number] & { lookupKey: string }>(
      `WITH input AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x("assetKey" text,"tokenId" text))
    ${sourceBranch(ownershipPonderSchema, "ethereum")} UNION ALL ${sourceBranch(ownershipPonderSchema, "polygon")} UNION ALL ${sourceBranch(ownershipBnbSchema, "bnb")}`,
      [release, JSON.stringify([...hints.values()]), ZERO_ADDRESS]
    )
  ).rows;
  const sources = new Map<string, InitialOwnerRow["sources"]>();
  for (const { lookupKey, ...m } of originals)
    sources.set(lookupKey, [...(sources.get(lookupKey) ?? []), m]);
  for (const row of rows)
    if (row.assetKeys.length === 1)
      row.sources = sources.get(row.assetKeys[0]!) ?? [];
  return rows;
}

/** Includes Solana origins, whose mint addresses differ from numeric Base IDs. */
export async function readArchivedMonsterIdentities(
  db: Pick<PoolClient, "query">,
  release: string,
  keys: string[]
) {
  if (keys.length > 500) throw new Error("Invalid archive identity batch.");
  if (!keys.length) return [];
  return (
    await db.query<ArchivedMonsterIdentity & { assetKey: string }>(
      `SELECT k.asset_key AS "assetKey",h.*
    FROM unnest($2::text[]) k(asset_key) JOIN LATERAL (
      SELECT DISTINCT r.legacy_id AS "tokenId",r.chain_id AS "chainId",r.family,r.origin_type AS "originType",r.content_hash AS "sourceHash",
        CASE WHEN jsonb_typeof(b.payload->'minted')='boolean' THEN (b.payload->>'minted')::boolean ELSE NULL END AS minted
      FROM metadata_source.source_record r JOIN metadata_source.source_blob b ON b.content_hash=r.content_hash
      WHERE r.release_id=$1 AND r.asset_key=k.asset_key AND r.issue IS NULL
      ORDER BY "tokenId","chainId","sourceHash" LIMIT 3) h ON true`,
      [release, keys]
    )
  ).rows;
}

export function classifyInitialOwner(row: InitialOwnerRow) {
  const first = row.firstMints[0];
  const member = row.sources[0];
  let status:
    | "matched"
    | "missing_mint"
    | "incomplete_history"
    | "ambiguous_mint"
    | "mint_recipient_mismatch"
    | "reminted"
    | "missing_binding"
    | "original_not_indexed"
    | "ambiguous_source"
    | "unverified_source";
  if (!first || !row.currentMints.length) status = "missing_mint";
  else if (row.firstLifecycle !== 1) status = "incomplete_history";
  else if (row.firstMints.length !== 1 || row.currentMints.length !== 1)
    status = "ambiguous_mint";
  else if (first.recipient !== row.lifecycleRecipient)
    status = "mint_recipient_mismatch";
  else if (row.firstLifecycle !== row.lifecycle) status = "reminted";
  else if (row.assetKeys.length !== 1) status = "missing_binding";
  else if (!row.sources.length) status = "original_not_indexed";
  else if (row.sources.length !== 1) status = "ambiguous_source";
  else if (
    !member ||
    member.mintCount !== 1 ||
    member.contractAddress !== collections[member.chain]?.address ||
    member.assetKey !== row.assetKeys[0]
  )
    status = "unverified_source";
  else status = "matched";
  const original =
    status === "matched" && member
      ? {
          chain: member.chain,
          contractAddress: member.contractAddress,
          tokenId: member.tokenId,
          lifecycle: member.lifecycle,
          mintTransactionHash: member.mintTransactionHash,
          mintLogIndex: member.mintLogIndex,
          assetKey: member.assetKey,
          role: "original" as const
        }
      : null;
  return {
    tokenId: row.tokenId,
    lifecycle: row.lifecycle,
    burned: row.burned,
    initialOwner:
      status === "incomplete_history" ? null : (first?.recipient ?? null),
    initialMint: status === "incomplete_history" ? null : (first ?? null),
    currentOwner: row.burned ? null : row.currentOwner,
    archivedOriginals: row.archivedOriginals,
    status,
    original,
    base:
      status === "matched" && first
        ? {
            chain: "base" as const,
            contractAddress: collections.base.address,
            tokenId: row.tokenId,
            lifecycle: row.lifecycle,
            mintTransactionHash: first.transactionHash,
            mintLogIndex: first.logIndex,
            assetKey: row.assetKeys[0]!,
            role: "airdrop" as const
          }
        : null
  };
}
