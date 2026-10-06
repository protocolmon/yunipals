import type { Pool } from "pg";
import { collections, type CollectionSlug } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { ArchiveReader } from "./source/read.js";
import { ArchiveOwnershipReader } from "./source/bindings.js";
import { staticNamespace } from "./source/supplemental.js";
import { contentHash } from "./source/canonical.js";
import { immutableMetadata, MetadataUnavailable, metadataError, validateMetadata, type MetadataVariant } from "./publication.js";
import { assertChainReady } from "./chain-readiness.js";

export type ReaderOptions = { releaseId?: string; candidate?: boolean };
export async function selectedRelease(pool: Pool, options: ReaderOptions = {}) {
  const result = options.candidate && options.releaseId
    ? await pool.query("SELECT release_id FROM metadata_source.archive_release WHERE release_id=$1 AND state IN ('candidate','validated')", [options.releaseId])
    : await pool.query("SELECT release_id FROM metadata_source.archive_release WHERE state='active'");
  if (result.rowCount !== 1 || (options.releaseId && result.rows[0].release_id !== options.releaseId)) throw new MetadataUnavailable("archive_unavailable", "retry");
  return result.rows[0].release_id as string;
}

export async function basePublicationState(pool: Pool, tokenId: string, mintTransactionHash: string, candidate = false) {
  if (!candidate && (await pool.query("SELECT 1 FROM metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL")).rowCount) throw new MetadataUnavailable("base_replay_unavailable","retry");
  const row = (await pool.query(`SELECT s.next_block::text,s.target_block::text,s.updated_at,
    row_to_json(mint) AS mint,row_to_json(latest) AS latest
    FROM metadata_source.chain_metadata_scan s
    LEFT JOIN LATERAL(SELECT block_number,transaction_index,log_index,traits
      FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 AND token_id=$2
      AND event_name='Mint' AND transaction_hash=$3 AND block_number<s.next_block
      ORDER BY log_index DESC LIMIT 1) mint ON true
    LEFT JOIN LATERAL(SELECT event_name,transaction_hash,log_index,block_number::text AS block_number,traits
      FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 AND token_id=$2
      AND block_number<s.next_block AND (block_number,transaction_index,log_index)>=(mint.block_number,mint.transaction_index,mint.log_index)
      ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) latest ON true
    WHERE s.name='base_metadata_v1'`, [collections.base.address, tokenId, mintTransactionHash])).rows[0];
  if (!row?.mint || !row.latest) throw new MetadataUnavailable("base_events_pending", "retry");
  const eventKey = `${row.latest.transaction_hash}:${row.latest.log_index}`;
  // A no-op Update is proven safe. Changed tuples need an audited name/image converter.
  if (contentHash(row.mint.traits) !== contentHash(row.latest.traits)) throw new MetadataUnavailable("base_tuple_requires_mapping", "reconciliation_required");
  return { eventKey, asOfBlock: (BigInt(row.next_block) - 1n).toString(),
    catchingUp: BigInt(row.next_block) <= BigInt(row.target_block), traits: row.latest.traits };
}

export class LocalMetadataReader {
  readonly schema: string;
  constructor(readonly pool: Pool, readSchema: string, readonly options: ReaderOptions = {}) { this.schema = sqlIdentifier(readSchema); }
  release() { return selectedRelease(this.pool, this.options); }
  async asset(release: string, assetKey: string, variant: MetadataVariant = "public") {
    const snapshot = await new ArchiveReader(this.pool, release, this.options.candidate).snapshotByAsset(assetKey, variant === "public", variant === "legacy-factory");
    validateMetadata(snapshot.document);
    return { ...snapshot, document: immutableMetadata(snapshot.document), contentHash: contentHash(immutableMetadata(snapshot.document)) };
  }
  async token(collection: CollectionSlug, tokenId: string, variant: MetadataVariant = "public") {
    const release = await this.release();
    if(!this.options.candidate)await assertChainReady(this.pool,[collection]);
    const ownership = await new ArchiveOwnershipReader(this.pool, release, this.schema.slice(1,-1), this.options.candidate).token(collection, tokenId);
    if (!ownership) return null;
    if (!ownership.assetKey) return { release, ownership, metadata: null, status: "unavailable", reason: "binding_unavailable" };
    try {
      if (!this.options.candidate) {
        const quarantine=(await this.pool.query(`SELECT reason FROM metadata.publication_job WHERE release_id=$1 AND collection=$2 AND token_id=$3
          AND mint_transaction_hash=$4 AND mint_log_index=$5 AND reason='token_uri_changed'`,
          [release,collection,tokenId,ownership.mintTransactionHash,ownership.mintLogIndex])).rows[0];
        if (quarantine) throw new MetadataUnavailable(quarantine.reason,"reconciliation_required");
      }
      const chain = collection === "base" ? await basePublicationState(this.pool, tokenId, ownership.mintTransactionHash, this.options.candidate) : null;
      const snapshot = await this.asset(release, ownership.assetKey, variant);
      return { release, ownership, status: "published", reason: null, metadata: snapshot, chain,
        document: { ...snapshot.document, address: ownership.owner, ownerSince: ownership.ownerSince === null ? null : new Date(Number(ownership.ownerSince) * 1000).toISOString(), minted: !ownership.burned } };
    } catch (error) {
      const unavailable = metadataError(error);
      return { release, ownership, metadata: null, status: unavailable.status, reason: unavailable.reason };
    }
  }
  async byId(id: string, family?: string, variant: MetadataVariant = "public") {
    const release = await this.release(), archive = new ArchiveReader(this.pool, release, this.options.candidate);
    const source = await archive.lookup(id, family, variant !== "legacy-factory");
    if(!this.options.candidate){
      const bound=(await this.pool.query('SELECT DISTINCT chain_id FROM metadata_source.asset_binding WHERE release_id=$1 AND asset_key=$2',[release,source.assetKey])).rows;
      const affected=Object.entries(collections).filter(([,definition])=>bound.some(row=>row.chain_id===String(definition.chainId))).map(([slug])=>slug as CollectionSlug);
      await assertChainReady(this.pool,affected);
    }
    // Prefer the one currently minted binding; never choose one of multiple owners arbitrarily.
    const bindings = (await this.pool.query(`SELECT DISTINCT t.collection,t.token_id,t.burned
      FROM metadata_source.asset_binding b JOIN LATERAL(SELECT collection,token_id,burned FROM ${this.schema}.token
        WHERE collection=CASE b.chain_id WHEN '1' THEN 'ethereum' WHEN '8453' THEN 'base' WHEN '137' THEN 'polygon' WHEN '56' THEN 'bnb' END
          AND token_id=b.token_id AND chain_id::text=b.chain_id AND lower(contract_address)=b.contract_address OFFSET 0) t ON true
      WHERE b.release_id=$1 AND b.asset_key=$2 ORDER BY t.burned,t.collection,t.token_id LIMIT 10`, [release, source.assetKey])).rows;
    const live = bindings.filter(row => !row.burned);
    const solana = process.env.SOLANA_LEGACY_METADATA_ENABLED === "true"
      ? (await this.pool.query(`SELECT a.mint,t.owner,t.burnt,t.observed_at,
          r.completed_at AS published_at
          FROM solana_indexer.manifest_asset a
          LEFT JOIN solana_indexer.token t ON t.mint=a.mint
          LEFT JOIN solana_indexer.sync_state s ON s.singleton
          LEFT JOIN solana_indexer.scan_run r ON r.id=s.published_run_id AND r.state='published'
          WHERE a.release_id=$1 AND a.asset_key=$2`,[release,source.assetKey])).rows[0]
      : undefined;
    if (solana && (!solana.published_at || Date.now()-new Date(solana.published_at).getTime()>86_400_000))
      throw new MetadataUnavailable("solana_ownership_unavailable","retry");
    const liveSolana = solana && solana.owner && !solana.burnt;
    if (live.length > 1 || (live.length && liveSolana)) {
      // Legacy URLs are not chain-qualified: both current owners can be correct.
      // Preserve the NFT document, but make no arbitrary address claim.
      for (const binding of live) {
        const current=await this.token(binding.collection,binding.token_id,variant);
        if (!current?.metadata) throw new MetadataUnavailable(current?.reason??"binding_unavailable","reconciliation_required");
      }
      const snapshot=await this.asset(release,source.assetKey,variant);
      const document={...snapshot.document,address:null,ownerSince:null,minted:true};
      return {document,contentHash:contentHash(document),ownership:"chain_ambiguous",release};
    }
    if (live.length === 1) {
      const result = await this.token(live[0].collection, live[0].token_id, variant);
      if (!result?.metadata) throw new MetadataUnavailable(result?.reason ?? "binding_unavailable", "reconciliation_required");
      return { document: result.document!, contentHash: contentHash(result.document), ownership: "indexed_chain", release };
    }
    if (solana) {
      if (!solana.owner && !solana.burnt) throw new MetadataUnavailable("solana_ownership_unavailable","retry");
      if (solana.burnt) throw new MetadataUnavailable("burned");
      const snapshot=await this.asset(release,source.assetKey,variant);
      const document={...snapshot.document,address:solana.owner,ownerSince:null,minted:true};
      return {document,contentHash:contentHash(document),ownership:"solana_das",release};
    }
    if (bindings.length || source.burned) throw new MetadataUnavailable("burned");
    // Unindexed chains/off-chain assets retain their historical shape and explicit provenance.
    const snapshot = await archive.snapshotByAsset(source.assetKey, variant === "public", variant === "legacy-factory");
    validateMetadata(snapshot.document);
    return { document: snapshot.document, contentHash: contentHash(snapshot.document), ownership: "historical_source", release };
  }
  async island(type: string, id: string) {
    const release = await this.release();
    return (await this.pool.query(`SELECT b.payload->'document' AS document FROM metadata_source.source_record r
      JOIN metadata_source.source_blob b USING(content_hash) WHERE r.release_id=$1 AND r.namespace=$2 AND r.source_key=$3`,
      [release, staticNamespace, `${type}/${id}`])).rows[0]?.document ?? null;
  }
  async owned(address: string, chains: CollectionSlug[], limit = 1000) {
    await this.release();
    if(!this.options.candidate)await assertChainReady(this.pool,chains);
    const tokens = (await this.pool.query(`SELECT collection,token_id FROM ${this.schema}.token
      WHERE lower(owner)=lower($1) AND NOT burned AND collection=ANY($2::text[])
      ORDER BY collection,token_id LIMIT $3`, [address, chains, limit + 1])).rows;
    if (tokens.length > limit) throw new MetadataUnavailable("wallet_result_too_large", "reconciliation_required");
    const items: Record<string, unknown>[] = [];
    // Bounded batches prevent a large wallet from exhausting the API connection pool.
    for (let offset = 0; offset < tokens.length; offset += 8) {
      const batch = await Promise.all(tokens.slice(offset, offset + 8).map(row => this.token(row.collection, row.token_id, "internal")));
      for (const result of batch) {
        if (!result?.metadata) throw new MetadataUnavailable(result?.reason ?? "binding_unavailable", "reconciliation_required");
        items.push(result.document!);
      }
    }
    return items;
  }
}
