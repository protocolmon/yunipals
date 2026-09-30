import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectionSlugs } from '../lib/constants.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';

const args = argumentsOf({ ownership: { type: 'string' }, output: { type: 'string' },
  execute: { type: 'boolean', default: false } });
const chainIds = { ethereum: 1, base: 8453, polygon: 137 } as const;

async function main() {
  assert.ok(args.execute, 'Marking production chains ready requires --execute');
  assert.ok(typeof args.ownership === 'string' && typeof args.output === 'string');
  await assert.rejects(readFile(args.output), { code: 'ENOENT' }, 'Refuse to overwrite readiness receipt');
  const ownership = JSON.parse(await readFile(args.ownership, 'utf8'));
  assert.deepEqual(ownership.consistency.map((row: { collection: string }) => row.collection).sort(), [...collectionSlugs].sort());
  assert.ok(ownership.consistency.every((row: { missing_event: string; mismatches: string }) =>
    row.missing_event === '0' && row.mismatches === '0'), 'Retained event audit failed');
  assert.ok(ownership.samples.length >= 12 && ownership.samples.every((row: { status: string }) =>
    ['matched', 'burn_revert_confirmed'].includes(row.status)), 'RPC ownership audit failed');
  assert.ok(Date.now() - Date.parse(ownership.observedAt) < 30 * 60_000, 'Ownership audit is stale');

  const { pool, env } = await postgresFrom(String(args['env-file']));
  const client = await pool.connect();
  try {
    const physical = sqlIdentifier(env.DATABASE_SCHEMA);
    const bnb = sqlIdentifier(env.BNB_DATABASE_SCHEMA ?? 'bnb_indexer');
    await client.query('BEGIN');
    const database = String((await client.query('SELECT current_database() AS name')).rows[0].name);
    assert.ok(!database.startsWith('metadata_archive_test_'));
    assert.equal((await client.query("SELECT count(*)::int AS count FROM metadata_source.archive_release WHERE state='active'")).rows[0].count, 0,
      'Only mark chains before release activation');
    assert.ok((await client.query("SELECT to_regclass('metadata.chain_readiness') AS name")).rows[0].name,
      'Publication schema pending');
    const ponder = (await client.query(`SELECT chain_id,latest_checkpoint FROM ${physical}._ponder_checkpoint
      WHERE chain_id=ANY($1::bigint[])`, [Object.values(chainIds)])).rows;
    assert.equal(ponder.length, 3, 'Missing Ponder checkpoint');
    const checkpoints: Record<string, string> = {};
    const now = Date.now();
    for (const [collection, chainId] of Object.entries(chainIds)) {
      const checkpoint = ponder.find((row: { chain_id: string }) => Number(row.chain_id) === chainId)?.latest_checkpoint;
      assert.match(checkpoint ?? '', /^\d{75}$/);
      assert.equal(Number(checkpoint.slice(10, 26)), chainId, 'Checkpoint chain mismatch');
      const age = now - Number(checkpoint.slice(0, 10)) * 1000;
      assert.ok(age >= -60_000 && age < 10 * 60_000, `${collection} index checkpoint is stale`);
      checkpoints[collection] = BigInt(checkpoint.slice(26, 42)).toString();
    }
    const bnbState = (await client.query(`SELECT last_scanned_block,caught_up_at,last_error
      FROM ${bnb}.sync_state WHERE singleton=true`)).rows[0];
    assert.ok(bnbState && bnbState.last_scanned_block !== null && bnbState.caught_up_at && !bnbState.last_error,
      'BNB sync is not caught up');
    assert.ok(now - new Date(bnbState.caught_up_at).getTime() < 10 * 60_000, 'BNB catch-up is stale');
    checkpoints.bnb = String(bnbState.last_scanned_block);
    for (const collection of collectionSlugs) {
      await client.query(`INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,reason,updated_at,verified_at)
        VALUES($1,'ready',$2,NULL,now(),now()) ON CONFLICT(collection) DO UPDATE SET
        state='ready',checkpoint_block=EXCLUDED.checkpoint_block,reason=NULL,updated_at=now(),verified_at=now()`,
      [collection, checkpoints[collection]]);
    }
    await client.query('COMMIT');
    const receipt = { format: 'metadata-cutover-chain-readiness-v1', database,
      observedAt: new Date().toISOString(), ownershipAudit: args.ownership, checkpoints };
    await writeReport(args.output, receipt);
    console.log(JSON.stringify(receipt));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
