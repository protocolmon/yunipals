import type { Pool } from "pg";
import { collections, ZERO_ADDRESS, type CollectionSlug } from "../../constants.js";
import { sqlIdentifier } from "../../offchain/sql.js";
import { lockCandidate } from "./archive.js";
import { ArchiveReader } from "./read.js";
import { baseMetadataState } from "./base-events.js";
export function metadataLookupId(uri: string) {
    const url = new URL(uri);
    if (url.protocol !== "https:" || !["meta.polkamon.com", "meta.yunipals.com", "meta.polychainmonsters.com"].includes(url.hostname)
        || url.port || url.username || url.password || url.pathname !== "/meta" || url.hash || url.searchParams.getAll("id").length !== 1
        || [...url.searchParams.keys()].some(key => key !== "id"))
        throw new Error("unsupported_metadata_uri");
    const id = url.searchParams.get("id")!;
    if (!/^[a-zA-Z0-9]{1,100}$/.test(id))
        throw new Error("unsupported_metadata_id");
    return id;
}
export type BindingInput = {
    collection: CollectionSlug;
    chainId: number;
    contractAddress: string;
    tokenId: string;
    lifecycle: number;
    burned: boolean;
    tokenUri: string;
    uriProvenance: string;
    documentId: string | null;
    documentName: string | null;
    mintTransactionHash: string;
    mintLogIndex: number;
    assetKey: string;
    sourceHash: string;
    sourceLegacyId: string;
    family: string;
};
export function verifyBinding(input: BindingInput) {
    const config = collections[input.collection];
    if (!config || input.chainId !== config.chainId || input.contractAddress.toLowerCase() !== config.address)
        throw new Error("collection_mismatch");
    if (!/^(0|[1-9]\d*)$/.test(input.tokenId) || BigInt(input.tokenId) > 2n ** 256n - 1n)
        throw new Error("invalid_token_id");
    if (!Number.isSafeInteger(input.lifecycle) || input.lifecycle < 1 || !/^0x[0-9a-f]{64}$/.test(input.mintTransactionHash)
        || !Number.isSafeInteger(input.mintLogIndex) || input.mintLogIndex < 0)
        throw new Error("invalid_mint_anchor");
    if (!/^[0-9a-f]{64}$/.test(input.assetKey) || !input.family || !/^[0-9a-f]{64}$/.test(input.sourceHash))
        throw new Error("invalid_source_evidence");
    const lookupId = metadataLookupId(input.tokenUri);
    if (!["current_token_uri_call", "current_token_uri_call_host_fallback", "current_base_formula", "historical_formula_fallback"].includes(input.uriProvenance))
        throw new Error("unverified_uri_provenance");
    if (input.uriProvenance === "historical_formula_fallback" && !input.burned)
        throw new Error("live_token_requires_uri_evidence");
    if (input.uriProvenance === "current_base_formula" && input.collection !== "base")
        throw new Error("formula_collection_mismatch");
    if (["current_base_formula", "historical_formula_fallback"].includes(input.uriProvenance) && lookupId !== input.tokenId)
        throw new Error("formula_identity_mismatch");
    if (input.documentName && input.documentId !== input.sourceLegacyId)
        throw new Error("cached_document_identity_mismatch");
    return { lookupId, uri: input.tokenUri, uriProvenance: input.uriProvenance, sourceHash: input.sourceHash,
        family: input.family, documentId: input.documentId, rule: "configured contract + observed token URI + archived lookup + canonical mint event", version: 1 };
}
export async function storeBindings(pool: Pool, release: string, inputs: BindingInput[]) {
    return storeVerifiedBindings(pool, release, inputs, false);
}
/** Runtime may append derived evidence, but can never edit an archived source. */
export async function storeRuntimeBindings(pool: Pool, release: string, inputs: BindingInput[]) {
    return storeVerifiedBindings(pool, release, inputs, true);
}
async function storeVerifiedBindings(pool: Pool, release: string, inputs: BindingInput[], runtime: boolean) {
    const rows = inputs.map(input => ({ ...input, chainId: String(input.chainId), contractAddress: input.contractAddress.toLowerCase(), evidence: verifyBinding(input) }));
    const identities = new Map<string, string>();
    for (const row of rows) {
        const key = JSON.stringify([row.chainId, row.contractAddress, row.tokenId]);
        if (identities.has(key) && identities.get(key) !== row.assetKey)
            throw new Error("conflicting_batch_binding");
        identities.set(key, row.assetKey);
    }
    const encoded = JSON.stringify(rows), client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (runtime) {
            const active = await client.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE", [release]);
            if (!active.rowCount) throw new Error("archive_unavailable");
            for (const row of rows) {
                const source = await client.query(`SELECT 1 FROM metadata_source.source_record WHERE release_id=$1
                  AND asset_key=$2 AND content_hash=$3 AND issue IS NULL LIMIT 1`, [release,row.assetKey,row.sourceHash]);
                if (!source.rowCount) throw new Error("unverified_source");
            }
        } else await lockCandidate(client, release);
        const conflict = await client.query(`SELECT 1 FROM metadata_source.asset_binding b
   JOIN jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"assetKey" text)
    ON b.chain_id=x."chainId" AND b.contract_address=x."contractAddress" AND b.token_id=x."tokenId"
   WHERE b.release_id=$1 AND b.network='eip155' AND b.asset_key<>x."assetKey" LIMIT 1`, [release, encoded]);
        if (conflict.rowCount)
            throw new Error("existing_asset_binding_conflict");
        await client.query(`INSERT INTO metadata_source.asset_binding(release_id,network,chain_id,contract_address,token_id,asset_key,evidence)
   SELECT $1,'eip155',"chainId","contractAddress","tokenId","assetKey",evidence
   FROM jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"assetKey" text,evidence jsonb)
   ON CONFLICT DO NOTHING`, [release, encoded]);
        const lifecycleConflict = await client.query(`SELECT 1 FROM metadata_source.lifecycle_binding b
   JOIN jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"mintTransactionHash" text,"mintLogIndex" integer,"assetKey" text)
    ON b.chain_id=x."chainId" AND b.contract_address=x."contractAddress" AND b.token_id=x."tokenId"
    AND b.mint_transaction_hash=x."mintTransactionHash" AND b.mint_log_index=x."mintLogIndex"
   WHERE b.release_id=$1 AND b.asset_key<>x."assetKey" LIMIT 1`, [release, encoded]);
        if (lifecycleConflict.rowCount)
            throw new Error("existing_lifecycle_binding_conflict");
        await client.query(`INSERT INTO metadata_source.lifecycle_binding(release_id,chain_id,contract_address,token_id,mint_transaction_hash,mint_log_index,asset_key,input_hash)
   SELECT $1,"chainId","contractAddress","tokenId","mintTransactionHash","mintLogIndex","assetKey","sourceHash"
   FROM jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"mintTransactionHash" text,"mintLogIndex" integer,"assetKey" text,"sourceHash" text)
   ON CONFLICT DO NOTHING`, [release, encoded]);
        await client.query("COMMIT");
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
/** Ownership is read from canonical chain tables each time, never the archive. */
export class ArchiveOwnershipReader {
    private readonly schema: string;
    constructor(private readonly pool: Pool, private readonly release: string, readSchema: string, private readonly candidate = false) { this.schema = sqlIdentifier(readSchema); }
    async token(collection: CollectionSlug, tokenId: string) {
        if (!collections[collection] || !/^(0|[1-9]\d*)$/.test(tokenId))
            throw new Error("invalid_token_identity");
        const result = await this.pool.query(`SELECT t.collection,t.chain_id AS "chainId",t.contract_address AS "contractAddress",t.token_id AS "tokenId",
   CASE WHEN t.burned THEN NULL ELSE t.owner END AS owner,t.burned,t.lifecycle,
   t.last_transfer_block::text AS "ownerAtBlock",t.last_transfer_timestamp::text AS "ownerSince",t.last_transaction_hash AS "ownerTransactionHash",
   e.transaction_hash AS "mintTransactionHash",e.log_index AS "mintLogIndex",b.asset_key AS "assetKey",b.input_hash AS "sourceHash",r.release_id IS NOT NULL AS "archiveAvailable"
   FROM ${this.schema}.token t
   LEFT JOIN ${this.schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
   LEFT JOIN ${this.schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle
     AND e.transaction_hash=l.mint_transaction_hash AND e.block_number=l.mint_block AND e."from"=$4
   LEFT JOIN metadata_source.archive_release r ON r.release_id=$1 AND (r.state='active' OR ($7 AND r.state IN ('candidate','validated','superseded')))
   LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=r.release_id AND b.chain_id=t.chain_id::text
     AND b.contract_address=lower(t.contract_address) AND b.token_id=t.token_id AND b.mint_transaction_hash=e.transaction_hash AND b.mint_log_index=e.log_index
   WHERE t.collection=$2 AND t.token_id=$3 AND t.chain_id=$5 AND lower(t.contract_address)=$6`, [this.release, collection, tokenId, ZERO_ADDRESS, collections[collection].chainId, collections[collection].address, this.candidate]);
        if (!result.rowCount)
            return null;
        if (result.rows.length !== 1)
            throw new Error("ambiguous_mint_anchor");
        const row = result.rows[0];
        return { ...row, metadataStatus: !row.archiveAvailable ? "archive_unavailable" : row.assetKey ? "bound" : "binding_unavailable", ownershipSource: "indexed_chain" };
    }
    /** A bound snapshot with chain ownership, including explicit metadata gaps. */
    async snapshot(collection: CollectionSlug, tokenId: string) {
        const ownership = await this.token(collection, tokenId);
        if (!ownership)
            return null;
        const chainMetadata = collection === 'base' ? await baseMetadataState(this.pool, tokenId) : null;
        if (!ownership.assetKey)
            return { ownership, metadata: null, chainMetadata };
        const snapshot = await new ArchiveReader(this.pool, this.release, this.candidate).snapshotByAsset(ownership.assetKey);
        return { ownership, chainMetadata, metadata: { ...snapshot, document: { ...snapshot.document, address: ownership.owner,
                    ownerSince: ownership.ownerSince === null ? null : new Date(Number(ownership.ownerSince) * 1000).toISOString(), minted: !ownership.burned },
                provenance: { traits: "archived_source", ownership: "indexed_chain", legacyChainFields: "historical_source" } } };
    }
}
