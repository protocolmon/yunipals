import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';

// These are the mutable read models touched by archive publication and refresh.
const projectionTables = [
  'metadata.token_metadata', 'metadata.token_rarity', 'metadata.token_search',
  'metadata.token_trait', 'metadata.trait_facet', 'metadata.trait_facet_status',
  'metadata.projection_revision', 'metadata.derived_snapshot',
  'metadata.market_catalog_trait', 'metadata.market_catalog_trait_pending',
  'metadata.market_catalog_trait_state', 'leaderboard.wallet_stats'
] as const;
type Table = { name: string; columns: string[]; keys: string[]; rows: string };
type Report = { format: string; database: string; schema: string; createdAt: string; tables: Table[] };

const args = argumentsOf({
  mode: { type: 'string' }, schema: { type: 'string' }, report: { type: 'string' },
  execute: { type: 'boolean', default: false }
});
const schema = String(args.schema ?? '');
assert.match(schema, /^metadata_cutover_rollback_[a-z0-9_]+$/);
assert.ok(args.mode === 'snapshot' || args.mode === 'restore');
assert.ok(args.report);

function qualified(name: string) {
  const [namespace, table] = name.split('.');
  assert.ok(namespace && table && name.split('.').length === 2);
  return `${sqlIdentifier(namespace)}.${sqlIdentifier(table)}`;
}
function copyName(name: string) { return `${sqlIdentifier(schema)}.${sqlIdentifier(name.split('.')[1])}`; }

async function main() {
  const { pool } = await postgresFrom(String(args['env-file']));
  const client = await pool.connect();
  try {
    const database = String((await client.query('SELECT current_database() AS name')).rows[0].name);
    const disposable = database.startsWith('metadata_archive_test_recovery_');
    assert.ok(disposable || args.execute,
      'Production projection changes require --execute');
    if (!disposable) {
      const active = await client.query("SELECT 1 FROM metadata_source.archive_release WHERE state='active'");
      assert.equal(active.rowCount, 0, 'Stop archive publication and deactivate the release before projection rollback');
    }
    if (args.mode === 'snapshot') {
      const existingReport = await readFile(String(args.report), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      assert.equal(existingReport, null, 'Refuse to overwrite a rollback report');
      assert.equal((await client.query('SELECT to_regnamespace($1) AS schema', [schema])).rows[0].schema, null,
        'Refuse to overwrite a rollback snapshot');
      const tables: Table[] = [];
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL statement_timeout=0');
      await client.query(`CREATE SCHEMA ${sqlIdentifier(schema)}`);
      for (const name of projectionTables) {
        const source = qualified(name);
        assert.ok((await client.query('SELECT to_regclass($1) AS table', [name])).rows[0].table, `Missing ${name}`);
        const columns = (await client.query(`SELECT attname FROM pg_attribute
          WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`, [name])).rows.map(row => String(row.attname));
        const keys = (await client.query(`SELECT a.attname FROM pg_index i
          JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,position) ON true
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
          WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.position`, [name])).rows.map(row => String(row.attname));
        assert.ok(columns.length && keys.length, `Missing columns or primary key: ${name}`);
        const target = copyName(name);
        await client.query(`CREATE TABLE ${target} AS SELECT * FROM ${source} WITH NO DATA`);
        await client.query(`INSERT INTO ${target} SELECT * FROM ${source}`);
        await client.query(`ALTER TABLE ${target} ADD PRIMARY KEY (${keys.map(sqlIdentifier).join(',')})`);
        const rows = String((await client.query(`SELECT count(*)::text AS rows FROM ${target}`)).rows[0].rows);
        tables.push({ name, columns, keys, rows });
        console.log(JSON.stringify({ phase: 'snapshot', table: name, rows }));
      }
      await client.query('COMMIT');
      const report: Report = { format: 'metadata-cutover-projection-v1', database, schema,
        createdAt: new Date().toISOString(), tables };
      await writeReport(String(args.report), report);
      console.log(JSON.stringify({ complete: true, mode: 'snapshot', schema, tables: tables.length }));
      return;
    }

    const report = JSON.parse(await readFile(String(args.report), 'utf8')) as Report;
    assert.equal(report.format, 'metadata-cutover-projection-v1');
    assert.equal(report.database, database);
    assert.equal(report.schema, schema);
    assert.deepEqual(report.tables.map(table => table.name), [...projectionTables]);
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=0');
    await client.query('SET LOCAL lock_timeout=5000');
    for (const table of report.tables) {
      const target = qualified(table.name), backup = copyName(table.name);
      const keys = table.keys.map(sqlIdentifier), columns = table.columns.map(sqlIdentifier);
      const values = table.columns.filter(column => !table.keys.includes(column)).map(sqlIdentifier);
      const match = keys.map(key => `t.${key}=b.${key}`).join(' AND ');
      await client.query(`LOCK TABLE ${target} IN ACCESS EXCLUSIVE MODE`);
      const removed = await client.query(`DELETE FROM ${target} t WHERE NOT EXISTS
        (SELECT 1 FROM ${backup} b WHERE ${match})`);
      const restored = await client.query(`INSERT INTO ${target} AS t (${columns.join(',')})
        SELECT ${columns.join(',')} FROM ${backup} WHERE true
        ${values.length ? `ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${values.map(value => `${value}=EXCLUDED.${value}`).join(',')}
        WHERE ROW(${values.map(value => `t.${value}`).join(',')}) IS DISTINCT FROM
          ROW(${values.map(value => `EXCLUDED.${value}`).join(',')})` : `ON CONFLICT (${keys.join(',')}) DO NOTHING`}`);
      const mismatch = await client.query(`SELECT 1 FROM ${target} t FULL JOIN ${backup} b ON ${match}
        WHERE ${keys.map(key => `t.${key} IS NULL OR b.${key} IS NULL`).join(' OR ')}
          OR to_jsonb(t) IS DISTINCT FROM to_jsonb(b) LIMIT 1`);
      assert.equal(mismatch.rowCount, 0, `Projection restore differs: ${table.name}`);
      console.log(JSON.stringify({ phase: 'restore', table: table.name, removed: removed.rowCount,
        restored: restored.rowCount, rows: table.rows }));
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ complete: true, mode: 'restore', schema, tables: report.tables.length }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
