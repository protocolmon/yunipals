import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrations } from '../lib/offchain/migrations.js';
import { collectionSlugs } from '../lib/constants.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';

const args = argumentsOf({
  release: { type: 'string' },
  review: { type: 'string' },
  backup: { type: 'string' },
  projection: { type: 'string' },
  ownership: { type: 'string' },
  output: { type: 'string' },
  execute: { type: 'boolean', default: false }
});

async function json(path: unknown) {
  assert.ok(typeof path === 'string' && path.length, 'Evidence path required');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  assert.ok(args.execute, 'Production activation requires --execute');
  assert.ok(typeof args.release === 'string' && args.release.length, 'Release required');
  assert.ok(typeof args.output === 'string' && args.output.length, 'Output required');
  await assert.rejects(readFile(args.output), { code: 'ENOENT' }, 'Refuse to overwrite activation receipt');
  const [review, backup, projection, ownership, step4] = await Promise.all([
    json(args.review), json(args.backup), json(args.projection), json(args.ownership),
    json('docs/metadata-migration/step-4-acceptance.json')
  ]);
  assert.equal(step4.readyForStep5, true, 'Recovery acceptance');
  assert.equal(step4.release, args.release);
  assert.equal(review.release, args.release);
  assert.equal(review.accepted, true, 'Frozen source review');
  assert.match(review.consistency, /six inventoried GraphQL\/NFT\/account writer units are required inactive/);
  assert.equal(backup.release, args.release);
  assert.equal(backup.format, 'metadata-recovery-bundle-v1');
  assert.equal(backup.archiveState, 'candidate');
  assert.equal(Object.keys(backup.tables).length, 32, 'Recovery bundle table coverage');
  assert.ok(Date.parse(backup.createdAt) >= Date.parse(review.scanStartedAt), 'Backup predates writer pause');
  assert.equal(projection.format, 'metadata-cutover-projection-v1');
  assert.equal(projection.tables.length, 12);
  assert.ok(Date.parse(projection.createdAt) >= Date.parse(backup.createdAt), 'Projection snapshot predates backup');
  assert.equal(ownership.release, args.release);
  assert.deepEqual(ownership.consistency.map((row: { collection: string }) => row.collection).sort(), [...collectionSlugs].sort());
  for (const row of ownership.consistency) {
    assert.equal(row.missing_event, '0');
    assert.equal(row.mismatches, '0');
  }
  assert.ok(ownership.samples.length >= 12 && ownership.samples.every((row: { status: string }) =>
    ['matched', 'burn_revert_confirmed'].includes(row.status)), 'Current ownerOf samples');
  assert.ok(Date.now() - Date.parse(ownership.observedAt) < 30 * 60_000, 'Ownership audit is stale');

  const { pool, env } = await postgresFrom(String(args['env-file']));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('metadata_release_activation'))");
    const database = String((await client.query('SELECT current_database() AS name')).rows[0].name);
    assert.ok(!database.startsWith('metadata_archive_test_'), 'Refuse disposable database');
    assert.equal(projection.database, database, 'Evidence database mismatch');
    const version = Number((await client.query('SELECT COALESCE(max(version),0)::int AS version FROM metadata.schema_migration')).rows[0].version);
    assert.equal(version, migrations.length, 'Publication migrations pending');
    const release = (await client.query('SELECT state,validation_report FROM metadata_source.archive_release WHERE release_id=$1 FOR UPDATE', [args.release])).rows[0];
    assert.equal(release?.state, 'candidate', 'Release already changed or missing');
    assert.ok(release.validation_report, 'Release validation report missing');
    assert.equal((await client.query("SELECT count(*)::int AS count FROM metadata_source.archive_release WHERE state='active'")).rows[0].count, 0);
    const runs = (await client.query(`SELECT namespace,state FROM metadata_source.import_run WHERE release_id=$1
      AND namespace IN ('nfts.pmonCollection','nfts.pmonCollectionBurned')`, [args.release])).rows;
    assert.equal(runs.length, 2);
    assert.ok(runs.every((row: { state: string }) => row.state === 'reconciled'), 'Source import state');
    const readiness = (await client.query(`SELECT collection,state,checkpoint_block::text,verified_at
      FROM metadata.chain_readiness WHERE collection=ANY($1::text[]) FOR UPDATE`, [collectionSlugs])).rows;
    assert.equal(readiness.length, collectionSlugs.length, 'Missing chain readiness');
    for (const row of readiness) {
      assert.equal(row.state, 'ready', `${row.collection} is not ready`);
      assert.ok(row.checkpoint_block !== null && row.verified_at !== null, `${row.collection} has no verified checkpoint`);
      assert.ok(Date.now() - new Date(row.verified_at).getTime() < 30 * 60_000, `${row.collection} checkpoint is stale`);
      assert.ok(new Date(row.verified_at).getTime() >= Date.parse(ownership.observedAt), `${row.collection} predates ownership audit`);
    }
    const readSchema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA);
    const maxTransfer = (await client.query(`SELECT collection,max(last_transfer_block::numeric)::text AS block
      FROM ${readSchema}.token WHERE collection=ANY($1::text[]) GROUP BY collection`, [collectionSlugs])).rows;
    for (const row of readiness) {
      const indexed = maxTransfer.find((item: { collection: string }) => item.collection === row.collection);
      assert.ok(indexed?.block && BigInt(row.checkpoint_block) >= BigInt(indexed.block), `${row.collection} checkpoint predates indexed transfer`);
    }
    const updated = await client.query(`UPDATE metadata_source.archive_release SET state='active',
      validated_at=now(),activated_at=now() WHERE release_id=$1 AND state='candidate'
      RETURNING release_id,state,validated_at,activated_at`, [args.release]);
    assert.equal(updated.rowCount, 1);
    await client.query('COMMIT');
    const receipt = { format: 'metadata-cutover-activation-v1', database, release: updated.rows[0],
      migrationVersion: version, readiness, evidence: {
        sourceReview: args.review, backup: args.backup, projection: args.projection, ownership: args.ownership
      }, activated: true };
    await writeReport(args.output, receipt);
    console.log(JSON.stringify({ activated: true, release: args.release, at: updated.rows[0].activated_at }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
