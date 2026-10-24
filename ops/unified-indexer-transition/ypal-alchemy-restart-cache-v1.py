#!/usr/bin/env python3
"""Read-only actual Ponder fragment-prefix restart proof; no connections/actions."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

FORMAT = 'yunipals-alchemy-restart-cache-v1'
FILTERS = Path(__file__).with_name('ypal-alchemy-restart-cache-v1.filters.json')
FILTERS_SHA = '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675'
SCHEMA = 'unified_ypal_20261023_v1'
BUILD = '71e2a7f3b7'
PROFILE = '0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'
MINIMUMS = {1: 12134519, 8453: 22224075, 137: 21814218, 56: 7579197}
RUNTIME = Path('/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer/node_modules/ponder')


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return sha((json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode())


def filters():
    raw = FILTERS.read_bytes()
    need(sha(raw) == FILTERS_SHA, 'exact_genuine71e_official_filter_derivation_required')
    value = json.loads(raw)
    need(value['buildId'] == BUILD and value['filterCount'] == value['fragmentCount'] == 84 and
         value['logFilters'] == 80 and value['blockFilters'] == 4 and
         value['providerCalls'] == value['databaseConnections'] == value['socketAttempts'] == 0,
         'actual_offline71e_filter_artifact_required')
    rows = []
    for index, row in enumerate(value['filters']):
        f = row['filter']
        need(f['chainId'] in MINIMUMS and len(row['fragments']) == 1 and f['type'] in {'log', 'block'},
             'finite_actual_log_or_latest_block_source_required')
        if f['type'] == 'block':
            need(f['fromBlock'] == 'latest' and f['interval'] == 1, 'unchanged_dynamic_latest_block_filter_required')
            continue
        need(type(f['fromBlock']) is int and f['fromBlock'] >= MINIMUMS[f['chainId']] and 'toBlock' not in f,
             'actual_open_ended_configured_source_start_required')
        ids = row['fragments'][0]['adjacentIds']
        need(1 <= len(ids) <= 128 and len(set(ids)) == len(ids) and
             all(re.fullmatch('[a-zA-Z0-9_:.-]{1,1000}', item) for item in ids),
             'exact_official_adjacent_fragment_identifiers_required')
        rows.append({'key': str(index), 'callback': row['callback'], 'chainId': f['chainId'],
                     'sourceId': f['sourceId'], 'fromBlock': f['fromBlock'], 'adjacentIds': ids})
    need(len(rows) == 80 and {chain: min(r['fromBlock'] for r in rows if r['chainId'] == chain)
                             for chain in MINIMUMS} == MINIMUMS, 'all_eighty_actual_log_filters_and_minimums_required')
    return rows


def validate_runtime():
    """Hash only the14 fixed public Ponder semantics files, never import them."""
    raw = FILTERS.read_bytes()
    need(sha(raw) == FILTERS_SHA, 'exact_genuine71e_official_filter_derivation_required')
    pins = json.loads(raw)['runtimeFiles']
    need(len(pins) == 14, 'finite_exact_Ponder_semantics_files_required')
    root = RUNTIME.resolve(strict=True)
    identities = {}
    for relative, expected in pins.items():
        need(not Path(relative).is_absolute() and '..' not in Path(relative).parts,
             'literal_public_Ponder_semantics_path_required')
        path = root / relative
        before = path.lstat()
        need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 964 and
             stat.S_IMODE(before.st_mode) == 0o640 and before.st_nlink == 1 and before.st_size <= 2000000,
             'root_owned_accepted_Ponder_semantics_file_required')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            data = os.read(fd, 2000001)
            fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_mode', 'st_uid', 'st_gid', 'st_nlink')
            need(len(data) == before.st_size and sha(data) == expected and
                 all(getattr(before, k) == getattr(os.fstat(fd), k) == getattr(path.lstat(), k) for k in fields),
                 'actual_installed_Ponder_semantics_bytes_must_match')
            identities[relative] = {k: getattr(before, k) for k in fields}
        finally:
            os.close(fd)
    return {'runtimeFilesSha256': digest(pins), 'runtimeIdentitySha256': digest(identities), 'publicFiles': len(pins)}


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def capture_sql():
    rows = filters()
    wanted = ','.join('(' + ','.join([literal(row['key']), str(row['chainId']),
        'ARRAY[' + ','.join(literal(v) for v in row['adjacentIds']) + ']::text[]']) + ')' for row in rows)
    # This is the actual getIntervals source contract: union every adjacent-ID
    # multirange before testing coverage. Ponder uses numrange(start,end+1,'[]')
    # and subtracts one from upper on read; both bounds are intentionally closed.
    return "WITH wanted(key,chain_id,ids)AS(VALUES " + wanted + ")SELECT jsonb_build_object(" + \
        "'identity',jsonb_build_object('databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'port',current_setting('port'),'readOnly',current_setting('transaction_read_only')='on','socket',inet_client_addr()IS NULL)," + \
        "'clock',floor(extract(epoch FROM clock_timestamp())*1000)::bigint," + \
        "'schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + SCHEMA + "')," + \
        "'app',(SELECT value FROM " + SCHEMA + "._ponder_meta WHERE key='app')," + \
        "'tables',(SELECT jsonb_object_agg(c.relname,jsonb_build_object('oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + SCHEMA + "'AND c.relkind='r')," + \
        "'checkpoints',(SELECT jsonb_object_agg(chain_id::text,jsonb_build_object('latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint))FROM " + SCHEMA + "._ponder_checkpoint)," + \
        "'cache',jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='ponder_sync'),'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind)ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync'AND c.relkind IN('r','p','v','m','S')))," + \
        "'matrix',(SELECT jsonb_object_agg(w.key,(SELECT coalesce(jsonb_agg(jsonb_build_array(lower(r)::text,upper(r)::text,lower_inc(r),upper_inc(r))ORDER BY lower(r)),'[]'::jsonb)FROM(SELECT unnest(range_agg(part))r FROM ponder_sync.intervals i CROSS JOIN LATERAL unnest(i.blocks)part WHERE i.chain_id=w.chain_id AND i.fragment_id=ANY(w.ids))merged))FROM wanted w))"


def block(checkpoint, chain):
    need(isinstance(checkpoint, str) and re.fullmatch('[0-9]{75}', checkpoint) and checkpoint != '0' * 75 and
         int(checkpoint[10:26]) == chain, 'actual_same_chain_nonzero_native_checkpoint_required')
    return int(checkpoint[26:42])


def prefix(from_block, ranges):
    """Equivalent to official one-fragment getCachedBlock for the actual filters.

    SQL already did genuine adjacent-ID range_agg union. A maximum endpoint alone
    never proves coverage; the first uncovered point stops the continuous prefix.
    """
    need(isinstance(ranges, list) and len(ranges) <= 4096, 'bounded_actual_multirange_required')
    cursor = from_block
    previous = -1
    parsed = []
    for row in ranges:
        need(isinstance(row, list) and len(row) == 4 and row[2] is row[3] is True and
             all(isinstance(v, str) and re.fullmatch('0|[1-9][0-9]{0,14}', v) for v in row[:2]),
             'actual_integer_closed_Ponder_multirange_bounds_required')
        lower, upper = map(int, row[:2])
        need(lower <= upper and lower >= previous, 'ordered_normalized_actual_cache_multirange_required')
        previous = lower
        parsed.append((lower, upper))
    for lower, upper in parsed:
        if upper <= cursor:
            continue
        if lower > cursor:
            break
        cursor = upper  # official upper-1 is the final cached block
    return cursor - 1


def validate_capture(capture, plan, native):
    rows = filters()
    need(capture['identity'] == {'databaseOid': '17584', 'port': '5432', 'readOnly': True, 'socket': True},
         'actual_source_database_readonly_Unix_capture_required')
    need(capture['schemaOid'] == native['schemaOid'] == '75963410' and
         capture['tables'] == native['tables'] and len(capture['tables']) == 44 and
         capture['cache'] == native['cache'] and capture['cache']['schemaOid'] and
         capture['app'] == native['app'] and capture['app']['build_id'] == BUILD and
         capture['checkpoints'] == native['checkpoints'] and
         set(capture['checkpoints']) == {str(c) for c in MINIMUMS},
         'same_actual71e_native44_cache_identity_and_restart_cursors_required')
    app = capture['app']
    need(type(app['is_locked']) is int and app['is_locked'] in {0, 1} and type(capture['clock']) is int and
         (app['is_locked'] == 0 or type(app['heartbeat_at']) is int and
          app['heartbeat_at'] + 25000 <= capture['clock']),
         'official_Ponder_unlocked_or_25s_expired_heartbeat_restart_required')
    need(plan['format'] == 'yunipals-ypal-alchemy-catchup-financial-v1-plan' and plan['profileId'] == PROFILE and
         len(plan['permits']) == 4 and {row['chainId'] for row in plan['permits']} == set(MINIMUMS),
         'actual_four_chain_scoped_financial_plan_required')
    permits = {row['chainId']: row for row in plan['permits']}
    need(set(capture['matrix']) == {row['key'] for row in rows}, 'all_eighty_official_fragment_rows_required')
    matrix, chains = [], {}
    for chain, minimum in MINIMUMS.items():
        p = permits[chain]
        need(p['profileId'] == PROFILE and p['enabled'] is True and
             p['fromBlock'] == str(minimum) and re.fullmatch('[1-9][0-9]{0,14}', p['throughBlock']),
             'actual_diagnostic_header_and_lifetime_minimum_permission_required')
        safe = block(capture['checkpoints'][str(chain)]['safe'], chain)
        latest = block(capture['checkpoints'][str(chain)]['latest'], chain)
        block(capture['checkpoints'][str(chain)]['finalized'], chain)
        need(minimum <= safe <= latest <= int(p['throughBlock']), 'actual_safe_latest_within_owned_permit_required')
        points = []
        for row in rows:
            if row['chainId'] != chain:
                continue
            end = prefix(row['fromBlock'], capture['matrix'][row['key']])
            need(end >= safe, 'older_cache_hole_or_unfetched_fragment_before_native_safe_refused')
            points.append(end)
            matrix.append({'callback': row['callback'], 'sourceId': row['sourceId'], 'chainId': chain,
                           'fromBlock': row['fromBlock'], 'continuousThrough': end})
        cached = min(points)
        need(cached <= int(p['throughBlock']), 'actual_cached_diagnostic_point_must_fit_owned_permit')
        chains[str(chain)] = {'safeResumeBlock': safe, 'logCachedThrough': cached,
            'earliestUncachedLogBlock': cached + 1, 'configuredDiagnosticHeader': minimum,
            'dynamicLatestBlockCallback': True, 'dynamicLatestOlderThanSafeAllowed': False}
    return {'format': FORMAT, 'validated': True, 'cacheCoverageQualified': True,
        'planSha256': digest(plan), 'filterArtifactSha256': FILTERS_SHA, 'captureSha256': digest(capture),
        'nativeIdentitySha256': digest({k: native[k] for k in ('schemaOid', 'tables', 'cache')}),
        'matrixSha256': digest(matrix), 'logFilterRows': len(matrix), 'dynamicLatestBlockFilters': 4, 'chains': chains,
        'sourceActorQualified': False, 'currentWriterQualified': False, 'canonicalReadinessQualified': False,
        'financialAuthorityQualified': False, 'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0}


def validate_restart_capture(query, plan, native):
    """Caller supplies the existing scoped READ ONLY source-DB query function.

    Call after owned source drain and official25s unlock/expiry, immediately before paid source start.
    Caller separately owns current source/actor/kernel/session/financial/canonical
    and dynamic latest head checks. This helper imports no runtime/app or client.
    """
    before = validate_runtime()
    result = validate_capture(query(capture_sql()), plan, native)
    need(validate_runtime() == before, 'installed_Ponder_semantics_changed_during_restart_capture')
    return {**result, 'installedPonder': before}


if __name__ == '__main__':
    print(json.dumps({'format': FORMAT, 'sourceOnly': True, 'hostQualified': False, 'cacheCoverageQualified': False,
                      'databaseWrites': 0, 'providerCalls': 0, 'serviceActions': 0}))
