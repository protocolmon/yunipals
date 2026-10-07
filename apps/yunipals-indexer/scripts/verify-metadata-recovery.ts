import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argumentsOf,postgresFrom,writeReport,safeFailure } from './metadata/support.js';
import { assertRecoveryDatabase,tableFingerprint } from './metadata/recovery.js';

const args=argumentsOf({input:{type:'string'},baseline:{type:'string',default:'docs/metadata-migration/step-3-acceptance.json'},report:{type:'string',default:'docs/metadata-migration/step-4-integrity.json'}});
const {pool,env}=await postgresFrom(String(args['env-file']));
try{
  const database=await assertRecoveryDatabase(pool),manifest=JSON.parse(await readFile(join(String(args.input),'manifest.json'),'utf8'));
  await pool.query('SET statement_timeout=0');
  const counts=(await pool.query(`SELECT
    (SELECT count(*)::int FROM metadata.token_publication) AS publications,
    (SELECT count(*)::int FROM metadata.token_metadata) AS documents,
    (SELECT count(*)::int FROM metadata.publication_job) AS jobs,
    (SELECT count(*)::int FROM metadata.token_publication p LEFT JOIN metadata.token_metadata m USING(collection,token_id,lifecycle)
      LEFT JOIN metadata_source.render_revision r ON r.release_id=p.release_id AND r.asset_key=p.asset_key AND r.variant='public'
        AND r.renderer_version=p.renderer_version AND r.input_hash=p.input_hash
      WHERE p.publication_status='published' AND (m.document IS NULL OR r.document IS NULL OR m.document<>r.document
        OR m.content_hash IS DISTINCT FROM r.content_hash OR p.publication_content_hash IS DISTINCT FROM r.content_hash)) AS revision_errors,
    (SELECT count(*)::int FROM metadata.token_publication p JOIN metadata.token_metadata m USING(collection,token_id,lifecycle)
      WHERE p.publication_status<>'published' AND m.document IS NOT NULL) AS unavailable_document_errors,
    (SELECT count(*)::int FROM metadata.token_metadata m JOIN recovery_http_evidence.token_metadata old USING(collection,token_id,lifecycle)
      WHERE old.name IS NULL AND old.document ? 'message' AND m.name IS NOT NULL) AS recovered_message_only_cache,
    (SELECT count(*)::int FROM metadata.token_metadata m LEFT JOIN metadata.token_rarity r USING(collection,token_id,lifecycle)
      WHERE r.token_id IS NULL OR r.metadata_content_hash IS DISTINCT FROM m.content_hash) AS rarity_provenance_errors,
    (SELECT count(*)::int FROM metadata.chain_readiness WHERE state='ready') AS ready_chains,
    (SELECT count(*)::int FROM metadata.derived_snapshot WHERE metadata_release_id=$1) AS derived_snapshots`,[manifest.release])).rows[0];
  assert.equal(counts.publications,counts.documents);assert.equal(counts.jobs,counts.publications);
  for(const key of ['revision_errors','unavailable_document_errors','rarity_provenance_errors'])assert.equal(counts[key],0,key);
  assert.equal(counts.ready_chains,4);assert.equal(counts.derived_snapshots,2);
  const immutable=[];
  for(const table of ['metadata.token_visibility','metadata.wallet_visibility_nonce','metadata.ens_identity',
    'metadata_source.asset_binding','metadata_source.lifecycle_binding','metadata_source.lookup_alias',
    'metadata_source.asset_origin','metadata_source.chain_metadata_event','metadata_source.chain_metadata_scan',
    ...Object.keys(manifest.tables).filter(table=>table.startsWith('solana_indexer.'))]){
    const expected=manifest.tables[table],actual=await tableFingerprint(env.DATABASE_URL,table,expected.keys);
    assert.equal(actual.rows,expected.rows,`${table} count`);assert.equal(actual.sha256,expected.sha256,`${table} values`);immutable.push({table,...actual});
  }
  const publication=(await pool.query('SELECT collection,publication_status,publication_error,count(*)::int AS count FROM metadata.token_publication GROUP BY 1,2,3 ORDER BY 1,2,3')).rows;
  const baseline=JSON.parse(await readFile(String(args.baseline),'utf8'));assert.equal(baseline.release,manifest.release);
  assert.equal(counts.publications,baseline.indexed.scanned,'Reviewed token census');
  assert.equal(counts.recovered_message_only_cache,baseline.indexed.counts.recovered_from_invalid_http_cache,'Recovered invalid HTTP cache census');
  for(const [collection,expected] of Object.entries(baseline.indexed.collections) as [string,any][]){
    const actual=publication.filter(row=>row.collection===collection);
    assert.equal(actual.reduce((n,row)=>n+row.count,0),expected.scanned,`${collection} token census`);
    assert.equal(actual.find(row=>row.publication_status==='published')?.count??0,expected.counts.rendered,`${collection} rendered census`);
    assert.equal(actual.find(row=>row.publication_status==='unavailable'&&row.publication_error==='binding_unavailable')?.count??0,expected.counts.binding_unavailable??0,`${collection} reviewed binding gaps`);
    assert.ok(actual.every(row=>row.publication_status==='published'||(row.publication_status==='unavailable'&&row.publication_error==='binding_unavailable')),`${collection} unexpected publication failure`);
  }
  await writeReport(String(args.report),{format:'metadata-recovery-integrity-v1',database,release:manifest.release,verifiedAt:new Date().toISOString(),complete:true,
    baseline:String(args.baseline),reviewedCoverageMatched:true,counts,publication,immutable});
  console.log(JSON.stringify({complete:true,counts}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{await pool.end();}
