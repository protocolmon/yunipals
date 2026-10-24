#!/usr/bin/env python3
"""Synthetic rows in genuine native Ponder DDL; disposable local PG16 only."""
import datetime
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('ypal_parity', HERE / 'ypal-booster-source-parity-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
CONTAINER = 'yunipals-unified-indexer-test-20261020'
DATABASE = 'ypal_booster_parity_' + secrets.token_hex(5)
DOCKER = ['docker', '--host=unix:///var/run/docker.sock', 'exec', '-i', CONTAINER]
NOW = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
BOUNDARY = m.FLOOR
HASH = '0x' + 'ab' * 32
PARENT = '0x' + 'cd' * 32
OWNER = '0x' + '11' * 20
OTHER = '0x' + '22' * 20
checks = []


def sql(value, database=DATABASE, expected_error=None):
    command = DOCKER + ['psql', '-XwqAt', '--set=ON_ERROR_STOP=1', '--username=unified_test', '--dbname=' + database]
    # Ponder's real live-query triggers require this table for fixture writes.
    data = 'CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY);\n' + value
    result = subprocess.run(command, input=data, text=True, capture_output=True, timeout=60)
    if expected_error:
        assert result.returncode and expected_error in result.stderr, (result.returncode, result.stderr)
        return None
    assert result.returncode == 0 and not result.stderr, result.stderr
    return result.stdout.strip()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def point(block, full=True):
    return f'{NOW - 7200:010d}{8453:016d}{block:016d}' + ('9' if full else '0') * 33


def unguarded():
    # Exact production queries with genuine local catalog identities. Never a
    # production-format receipt: the production peer/OID gate must refuse this DB.
    rows = [json.loads(row) for row in sql(m.prefix() + m.context_sql(BOUNDARY) + ';\n' +
        m.comparisons_sql() + ';\n' + m.unexpected_sql() + ';ROLLBACK;').splitlines()]
    assert len(rows) == 3
    return rows


def fixture_guarded_sql():
    # Retarget only literal peer/database/OID expectations in a PRIVATE TEST COPY
    # of the complete production SQL. No bypass parameter exists in the producer.
    oids = json.loads(sql("SELECT jsonb_object_agg(nspname,oid::text)FROM pg_namespace WHERE nspname IN("
        + ','.join(literal(n) for n in [m.LEFT, m.RIGHT, m.READ_SCHEMA]) + ')'))
    db_oid = sql("SELECT oid::text FROM pg_database WHERE datname=current_database()")
    text = m.snapshot_sql(BOUNDARY)
    text = text.replace("f->>'database'='17584'", "f->>'database'=" + literal(db_oid))
    text = text.replace("f->>'databaseName'='yunipals_backfill'", "f->>'databaseName'=" + literal(DATABASE))
    text = text.replace("f->>'role'='postgres'", "f->>'role'='unified_test'").replace("f->>'sessionRole'='postgres'", "f->>'sessionRole'='unified_test'")
    for schema, old in [(m.LEFT, m.SCHEMAS[m.LEFT]['oid']), (m.RIGHT, m.SCHEMAS[m.RIGHT]['oid']), (m.READ_SCHEMA, m.READ_OID)]:
        text = text.replace(old, oids[schema])
    return text


def equal(rows):
    frame, tables, unknown = rows
    assert len(tables) == 8 and {t['table'] for t in tables} == set(m.TABLES)
    assert all(t['differences'] == 0 and t['leftCount'] == t['rightCount'] and t['leftSha256'] == t['rightSha256'] for t in tables)
    assert unknown == {'left': 0, 'right': 0}
    for source in frame['sources']:
        assert len(source['relations']) == 8
        for table in source['relations']:
            assert table['relkind'] == 'r' and table['columns'] == m.columns(table['name'])
    assert frame['readOnly'] == 'on' and frame['isolation'] == 'repeatable read'
    return True


created = False
try:
    assert sql('SHOW server_version_num', 'postgres') == '160015'
    sql('CREATE DATABASE ' + DATABASE + ' OWNER unified_test', 'postgres'); created = True
    dump = subprocess.run(DOCKER + ['pg_dump', '--username=unified_test', '--dbname=yunipals_ponder_dependency_test',
        '--schema-only', '--no-owner', '--no-privileges', '--schema=dependency_check'], capture_output=True, text=True, timeout=20, check=True).stdout
    dump = '\n'.join(line for line in dump.splitlines() if not line.startswith(('\\restrict', '\\unrestrict')))
    assert 'booster_original' in dump and '_ponder_checkpoint' in dump
    for name in (m.LEFT, m.RIGHT):
        sql(dump.replace('dependency_check', name))
        app = {'version': '6', 'build_id': m.SCHEMAS[name]['build'], 'is_dev': 0,
            'is_locked': 1, 'is_ready': int(name == m.LEFT), 'heartbeat_at': NOW * 1000}
        sql(f"""
        INSERT INTO {name}._ponder_meta(key,value)VALUES('app',{literal(json.dumps(app))});
        INSERT INTO {name}._ponder_checkpoint(chain_id,chain_name,latest_checkpoint,safe_checkpoint,finalized_checkpoint)
          VALUES(8453,'base','{point(BOUNDARY + 10)}','{point(BOUNDARY + 10)}','{point(BOUNDARY + 10)}');
        INSERT INTO {name}.booster_type VALUES('type','1','{m.REGISTRY}','{m.ENGINE}','{m.YPAL}','1000000000000000000',86400,1,264,7,'{HASH}','{HASH}','https://example.test/manifest','https://example.test/variants/',false,1);
        INSERT INTO {name}.booster_original VALUES('original','{m.MONSTERS}','1','type','{m.ENGINE}','{OWNER}',{NOW-7200},3,1,263,'request',false);
        INSERT INTO {name}.booster_request VALUES('request','{m.ENGINE}','{m.WRAPPER}','1','original','{OWNER}',3,false,'1','{HASH}',2200000,'pending',NULL,{NOW-7200},NULL,'{HASH}',NULL);
        INSERT INTO {name}.booster_monster VALUES('monster','{m.MONSTERS}','1','original','request','type','{OWNER}','{OWNER}',171,7,2,1,1,true,false,{BOUNDARY});
        INSERT INTO {name}.booster_refund VALUES('refund','{m.ENGINE}','{OWNER}',20,7,3);
        INSERT INTO {name}.booster_engine_state VALUES('{m.ENGINE}',false);
        INSERT INTO {name}.booster_checkpoint VALUES('8453',{BOUNDARY},'{HASH}',{NOW-7200});
        INSERT INTO {name}.booster_event VALUES('event','{m.ENGINE}','RequestCreated','{{"first":1,"second":2}}',{BOUNDARY},'{HASH}',{NOW-7200},'{HASH}',1);
        """)
    sql(f"INSERT INTO {m.RIGHT}.chain_block VALUES('8453:{BOUNDARY}',8453,{BOUNDARY},'{HASH}','{PARENT}',{NOW-7200})")
    sql(f"CREATE SCHEMA yunipals_indexer_control;CREATE TABLE yunipals_indexer_control.release(id text,physical_schema text,build_id text,manifest_hash text);"
        f"INSERT INTO yunipals_indexer_control.release VALUES('{m.RELEASE}','{m.RIGHT}','{m.SCHEMAS[m.RIGHT]['build']}','{m.MANIFEST}');"
        f"CREATE SCHEMA {m.READ_SCHEMA};CREATE TABLE {m.READ_SCHEMA}._unified_read_release(singleton boolean,release_id text,identity text,manifest_hash text);"
        f"INSERT INTO {m.READ_SCHEMA}._unified_read_release VALUES(true,'{m.RELEASE}','{m.READ_ID}','{m.MANIFEST}')")
    for definition in m.SOURCE_DEFINITIONS:
        sql(f"INSERT INTO {m.RIGHT}.indexer_source VALUES({literal(definition['id'])},8453,'{m.MANIFEST}',{literal(json.dumps(definition))})")
    rows = unguarded(); assert equal(rows)
    assert 'exact_postgres_peer_database_required' in m.source_checks(rows[0], BOUNDARY)
    sql(m.snapshot_sql(BOUNDARY), expected_error='exact_ypal_source_peer_context_required')
    checks.append('exact_eight_native_DDL_shapes_and_all_field_queries_local_production_identity_refused')
    adapted = fixture_guarded_sql(); assert equal([json.loads(r) for r in sql(adapted).splitlines()])
    checks.append('full_guarded_SQL_in_one_RR_test_only_peer_OID_retarget_combined_ready0_old_checkpoint_timestamp')
    sql(f"UPDATE {m.RIGHT}.booster_event SET args='{{\"second\":2,\"first\":1}}'")
    assert equal(unguarded()); checks.append('original_semantic_JSON_key_order_normalization_retained')
    mutations = [
        ('booster_original', 'remaining=262', 'remaining=263'),
        ('booster_original', f"owner='{OTHER}'", f"owner='{OWNER}'"),
        ('booster_request', "status='seeded'", "status='pending'"),
        ('booster_refund', 'withdrawn=4', 'withdrawn=3'),
        ('booster_monster', 'burned=true', 'burned=false'),
        ('booster_event', "block_hash='0x" + 'dd' * 32 + "'", f"block_hash='{HASH}'")]
    for table, change, restore in mutations:
        sql(f'UPDATE {m.RIGHT}.{table} SET {change}')
        changed = unguarded()[1]; row = next(r for r in changed if r['table'] == table)
        assert row['differences'] == 2 and row['leftCount'] == row['rightCount'] and row['leftSha256'] != row['rightSha256'], table
        sql(f'UPDATE {m.RIGHT}.{table} SET {restore}')
    checks.append('same_count_rights_transfer_pending_refund_burn_and_journal_hash_changes_refused')
    sql(f'DELETE FROM {m.RIGHT}.booster_refund')
    row = next(r for r in unguarded()[1] if r['table'] == 'booster_refund')
    assert row['differences'] == 1 and row['leftCount'] == 1 and row['rightCount'] == 0
    sql(f"INSERT INTO {m.RIGHT}.booster_refund VALUES('refund','{m.ENGINE}','{OWNER}',20,7,3)")
    checks.append('both_direction_missing_row_counts_and_payload_digests_detected')
    for schema in (m.LEFT, m.RIGHT):
        sql(f"INSERT INTO {schema}.booster_event SELECT 'future',address,name,args,{BOUNDARY+1},block_hash,timestamp,transaction_hash,2 FROM {schema}.booster_event LIMIT 1")
    sql(adapted, expected_error='no_future_feature_tail_and_known_mint_required')
    for schema in (m.LEFT, m.RIGHT):
        sql(f"DELETE FROM {schema}.booster_event WHERE id='future'")
    checks.append('equal_future_feature_tails_refuse_before_comparison')
    sql(f"UPDATE {m.RIGHT}._ponder_checkpoint SET latest_checkpoint='{point(BOUNDARY, False)}'")
    sql(adapted, expected_error='complete_Base_boundary_required')
    sql(f"UPDATE {m.RIGHT}._ponder_checkpoint SET latest_checkpoint='{point(BOUNDARY + 10)}'")
    checks.append('partial_native_tail_is_not_complete_block')
    sql(f"UPDATE {m.RIGHT}.booster_event SET address='0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609'")
    assert unguarded()[2] == {'left': 0, 'right': 1}
    sql(f"UPDATE {m.RIGHT}.booster_event SET address='{m.ENGINE}'")
    checks.append('old_PROTO_address_never_accepted_as_fresh_YPAL')
    sql(f'ALTER TABLE {m.RIGHT}.booster_original ADD COLUMN unexpected text')
    sql(adapted, expected_error='exact_native_booster_columns_required')
    sql(f'ALTER TABLE {m.RIGHT}.booster_original DROP COLUMN unexpected')
    checks.append('native_extra_column_refuses_before_comparison')
    sql(f"UPDATE {m.RIGHT}.chain_block SET block_hash='0x" + 'dd' * 32 + "'")
    assert unguarded()[0]['nativeBoundaryHeaders'][0]['hash'] != HASH
    checks.append('actual_native_boundary_header_difference_observed_without_fabrication')
    print(json.dumps({'passed': True, 'groups': len(checks), 'checks': checks, 'actualNativePonderDDL': True,
        'allRowsSynthetic': True, 'productionFormatReceiptProduced': False, 'providerCalls': 0,
        'productionCalls': 0, 'disposableDatabaseRemovedOnExit': True}, indent=2))
finally:
    if created:
        sql('DROP DATABASE ' + DATABASE + ' WITH(FORCE)', 'postgres')
