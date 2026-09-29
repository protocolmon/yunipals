import { ponderSchema, physicalPonderSchema, bnbSchema } from "../offchain/sql.js";
import { metadataSourceMode, publicationAvailableSql } from "./publication.js";
import { collectionSlugs, type CollectionSlug } from "../constants.js";
import { projectionMode } from "./projection-mode.js";

export const projectionGenerationMode = projectionMode() === "generation";
const activeProjectionId = "(SELECT current_id FROM metadata_projection.active WHERE singleton)";

function projectionIdSql(id?: string) {
  if (id === undefined) return activeProjectionId;
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error("Invalid projection generation ID");
  return `${id}::bigint`;
}

export async function readActiveProjectionId() {
  if (!projectionGenerationMode) return null;
  const { apiPool } = await import("../offchain/db.js");
  const sourceMode = metadataSourceMode();
  const result = await apiPool.query<{ current_id: string | null }>(
    `SELECT a.current_id FROM metadata_projection.active a
      JOIN metadata_projection.generation g ON g.id=a.current_id
      WHERE a.singleton AND g.state='ready' AND g.format_version=1
        ${sourceMode === "archive" ? `AND EXISTS(SELECT 1 FROM metadata_source.archive_release r
          WHERE r.state='active' AND r.release_id=g.metadata_release_id)` : ""}`
  );
  const id = result.rows[0]?.current_id;
  if (!id) throw new Error("projection_generation_unavailable");
  return id;
}

/** Numeric lifecycle counters can be reused on reindex; always check the mint anchor.
 * Anchor fields are correlated with the token identity. CASE retains every
 * validation while avoiding independent-selectivity estimates that turn full
 * collection reads into millions of nested index probes.
 * OFFSET 0 keeps point-read existence checks bound to that token; bulk readers
 * below use physical-table joins instead.
 */
export function canonicalPublicationSql(alias = "m", schema = ponderSchema) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid SQL alias");
  return `EXISTS(SELECT 1 FROM ${schema}.token_lifecycle publication_lifecycle
    JOIN ${schema}.transfer_event publication_mint
      ON publication_mint.collection=publication_lifecycle.collection
      AND publication_mint.token_id=publication_lifecycle.token_id
      AND publication_mint.lifecycle=publication_lifecycle.lifecycle
    WHERE publication_lifecycle.collection=${alias}.collection
      AND publication_lifecycle.token_id=${alias}.token_id::text AND publication_lifecycle.lifecycle=${alias}.lifecycle
      AND publication_mint."from"='0x0000000000000000000000000000000000000000'
      AND CASE WHEN publication_mint.transaction_hash=publication_lifecycle.mint_transaction_hash
        AND publication_mint.block_number=publication_lifecycle.mint_block
        AND publication_mint.transaction_hash=${alias}.mint_transaction_hash
        AND publication_mint.log_index=${alias}.mint_log_index THEN true ELSE false END
      OFFSET 0)
    AND ${basePublicationSql(alias)}`;
}
function basePublicationSql(alias:string) {
  return `(${alias}.collection<>'base' OR (${alias}.chain_event_key=(SELECT event.transaction_hash||':'||event.log_index::text
      FROM metadata_source.chain_metadata_event event JOIN metadata_source.chain_metadata_scan scan
      ON scan.name='base_metadata_v1' AND scan.chain_id=event.chain_id AND scan.contract_address=event.contract_address
      WHERE event.token_id=${alias}.token_id::text AND event.block_number<scan.next_block
      ORDER BY event.block_number DESC,event.transaction_index DESC,event.log_index DESC LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL)))`;
}
const publicationRows=`(SELECT document_row.*,provenance.source_kind,provenance.release_id,provenance.asset_key,
      provenance.renderer_version,provenance.input_hash,provenance.publication_content_hash,provenance.publication_status,provenance.publication_error,provenance.published_at,
      provenance.mint_transaction_hash,provenance.mint_log_index,provenance.chain_event_key
      FROM metadata.token_metadata document_row JOIN metadata.token_publication provenance USING(collection,token_id,lifecycle))`;
function archiveRead(schema:string,collectionPredicate='true',includeBase=schema!==bnbSchema) {
  return `SELECT published.* FROM ${publicationRows} published
      JOIN ${schema}.token_lifecycle publication_lifecycle
        ON publication_lifecycle.collection=published.collection AND publication_lifecycle.token_id=published.token_id::text
        AND publication_lifecycle.lifecycle=published.lifecycle
      JOIN ${schema}.transfer_event publication_mint
        ON publication_mint.collection=publication_lifecycle.collection AND publication_mint.token_id=publication_lifecycle.token_id
        AND publication_mint.lifecycle=publication_lifecycle.lifecycle AND publication_mint."from"='0x0000000000000000000000000000000000000000'
      ${includeBase?`LEFT JOIN (
        SELECT DISTINCT ON(event.token_id) event.token_id,event.transaction_hash||':'||event.log_index::text AS event_key
        FROM metadata_source.chain_metadata_event event JOIN metadata_source.chain_metadata_scan scan
          ON scan.name='base_metadata_v1' AND scan.chain_id=event.chain_id AND scan.contract_address=event.contract_address
        WHERE event.block_number<scan.next_block
        ORDER BY event.token_id,event.block_number DESC,event.transaction_index DESC,event.log_index DESC
      ) base_latest ON published.collection='base' AND base_latest.token_id=published.token_id::text`:''}
      WHERE ${publicationAvailableSql("published")}
      AND ${collectionPredicate}
      AND CASE WHEN publication_mint.transaction_hash=publication_lifecycle.mint_transaction_hash
        AND publication_mint.block_number=publication_lifecycle.mint_block
        AND publication_mint.transaction_hash=published.mint_transaction_hash
        AND publication_mint.log_index=published.mint_log_index THEN true ELSE false END
      AND ${includeBase?`CASE WHEN published.collection<>'base' OR (published.chain_event_key=base_latest.event_key
        AND NOT EXISTS(SELECT 1 FROM metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL)) THEN true ELSE false END`:"published.collection<>'base'"}`;
}
// Point reads keep the canonical checks parameterized by the requested token.
export const metadataReadRelation = metadataSourceMode() === "archive"
  ? `(SELECT published.* FROM ${publicationRows} published WHERE ${publicationAvailableSql('published')}
      AND ${canonicalPublicationSql('published')})`
  : `(SELECT published.* FROM metadata.token_metadata published WHERE ${publicationAvailableSql("published")})`;
// Join within each physical chain store before combining them. Joining the two
// union views first hides key statistics and can produce very slow count plans.
export const metadataScanReadRelation = metadataSourceMode() === "archive"
  ? `(${ponderSchema===physicalPonderSchema?archiveRead(ponderSchema):
      `${archiveRead(physicalPonderSchema,"published.collection<>'bnb'")} UNION ALL ${archiveRead(bnbSchema,"published.collection='bnb'")}`})`
  : metadataReadRelation;

export function metadataReadRelationFor(schema:string,includeBase=schema!==bnbSchema,chains:readonly CollectionSlug[]=collectionSlugs) {
  if(chains.some(chain=>!collectionSlugs.includes(chain)))throw new Error('Invalid metadata collection');
  const selected=chains.filter(chain=>schema===bnbSchema?chain==='bnb':schema===physicalPonderSchema?chain!=='bnb':true);
  const predicate=selected.length?`published.collection IN (${selected.map(chain=>`'${chain}'`).join(',')})`:'false';
  return metadataSourceMode()==='archive'?`(${archiveRead(schema,predicate,includeBase&&selected.includes('base'))})`:metadataReadRelation;
}
export function metadataSearchReadRelationFor(schema:string,includeBase=schema!==bnbSchema,chains:readonly CollectionSlug[]=collectionSlugs,id?:string) {
  return searchReadRelation(metadataReadRelationFor(schema,includeBase,chains),id);
}
function searchReadRelation(publicationRelation:string,id?:string) {
  const searchTable = projectionGenerationMode ? "metadata_projection.search" : "metadata.token_search";
  const revisionTable = projectionGenerationMode ? "metadata_projection.revision" : "metadata.projection_revision";
  const generationFilter = projectionGenerationMode ? `search.generation_id=${projectionIdSql(id)} AND revision.generation_id=search.generation_id AND` : "";
  return metadataSourceMode() === "archive"
  ? `(SELECT search.* FROM ${searchTable} search JOIN ${publicationRelation} publication
      ON publication.collection=search.collection AND publication.token_id=search.token_id AND publication.lifecycle=search.lifecycle
      JOIN ${revisionTable} revision ON revision.collection=search.collection AND revision.token_id=search.token_id
      AND revision.lifecycle=search.lifecycle
      AND CASE WHEN publication.content_hash=revision.metadata_content_hash THEN true ELSE false END
      WHERE ${generationFilter} true)`
  : projectionGenerationMode ? `(SELECT * FROM metadata_projection.search search WHERE search.generation_id=${projectionIdSql(id)})` : "metadata.token_search";
}
export const metadataSearchReadRelation=searchReadRelation(metadataReadRelation);
export function metadataSearchReadRelationAt(id:string) {return searchReadRelation(metadataReadRelation,id);}
/** Ranked candidates still require a correlated validated-search proof. */
export function metadataRawSearchReadRelationAt(id?: string) {
  return projectionGenerationMode
    ? `(SELECT * FROM metadata_projection.search WHERE generation_id=${projectionIdSql(id)})`
    : "metadata.token_search";
}
function traitReadRelation(id?:string) {
  const traitTable = projectionGenerationMode ? "metadata_projection.trait" : "metadata.token_trait";
  const revisionTable = projectionGenerationMode ? "metadata_projection.revision" : "metadata.projection_revision";
  const generationFilter = projectionGenerationMode ? `trait.generation_id=${projectionIdSql(id)} AND revision.generation_id=trait.generation_id AND` : "";
  return metadataSourceMode() === "archive"
  ? `(SELECT trait.* FROM ${traitTable} trait JOIN ${metadataReadRelation} publication
      ON publication.collection=trait.collection AND publication.token_id=trait.token_id AND publication.lifecycle=trait.lifecycle
      JOIN ${revisionTable} revision ON revision.collection=trait.collection AND revision.token_id=trait.token_id
      AND revision.lifecycle=trait.lifecycle
      AND CASE WHEN publication.content_hash=revision.metadata_content_hash THEN true ELSE false END
      WHERE ${generationFilter} true)`
  : projectionGenerationMode ? `(SELECT * FROM metadata_projection.trait trait WHERE trait.generation_id=${projectionIdSql(id)})` : "metadata.token_trait";
}
export const metadataTraitReadRelation = traitReadRelation();
export function metadataTraitReadRelationAt(id:string) {return traitReadRelation(id);}
export const leaderboardReadRelation = metadataSourceMode() === "archive"
  ? `(SELECT stats.* FROM leaderboard.wallet_stats stats WHERE EXISTS(SELECT 1 FROM metadata.derived_snapshot snapshot
      JOIN metadata_source.archive_release release ON release.release_id=snapshot.metadata_release_id AND release.state='active'
      WHERE snapshot.name='leaderboard'))` : "leaderboard.wallet_stats";
