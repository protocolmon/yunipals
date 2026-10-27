#!/usr/bin/env python3
"""Place existing derived collection relations on the attached project volume.

Plan uses read-only SQL. Apply changes physical placement only, never rows,
ownership, ACLs, source schemas, publication pointers or service traffic.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess

VOLUME = Path('/mnt/HC_Volume_107222036')
DESTINATION = VOLUME / 'yunipals-derived-postgresql'
TABLESPACE = 'yunipals_derived'
RESERVE = 25_000_000_000
BACKUP = 35_000_000_000
TABLES = {
    'metadata': ('token_search', 'token_trait', 'projection_revision'),
    'metadata_projection': ('active', 'facet', 'facet_status', 'generation',
                            'read_epoch', 'read_guard', 'read_member',
                            'read_set', 'revision', 'search', 'trait')
}
READERS = ('yunipals-api.service', 'yunipals-collector-api.service',
           'yunipals-islands-api.service', 'yunipals-read-cache.service',
           'yunipals-leaderboard.service')
DROPIN = Path('/etc/systemd/system/postgresql@16-main.service.d/90-yunipals-derived-volume.conf')
DROPIN_BYTES = ('[Unit]\nRequiresMountsFor=' + str(VOLUME) + '\n').encode()


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def save(path, value):
    with path.open('x', encoding='utf-8') as f:
        os.chmod(path, 0o600)
        json.dump(value, f, sort_keys=True)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())


def sql(text, timeout=30):
    result = subprocess.run([
        '/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-X', '-qAt',
        '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql', '-p', '5432',
        '-d', 'yunipals_backfill'
    ], input=text, text=True, capture_output=True, timeout=timeout)
    require(result.returncode == 0, 'derived_storage_sql_failed_inspect_catalog_before_retry')
    return json.loads(result.stdout) if result.stdout.strip() else None


def identifier(value):
    require(re.fullmatch('[a-z_][a-z0-9_]{0,62}', value), 'fixed_identifier_required')
    return '"' + value + '"'


def filesystem(path):
    value = os.statvfs(path)
    return {'device': path.stat().st_dev,
            'freeBytes': value.f_bavail * value.f_frsize}


def mount():
    result = subprocess.run(['findmnt', '-J', '-T', str(VOLUME), '-o',
                             'TARGET,SOURCE,FSTYPE,UUID'], text=True,
                            capture_output=True, check=True)
    value = json.loads(result.stdout)['filesystems']
    require(len(value) == 1 and value[0]['target'] == str(VOLUME)
            and value[0]['fstype'] == 'ext4' and value[0]['uuid'],
            'persistent_project_volume_required')
    entries = [line.split() for line in Path('/etc/fstab').read_text().splitlines()
               if line.strip() and not line.lstrip().startswith('#')]
    require(any(len(row) > 1 and row[1] == str(VOLUME) for row in entries),
            'persistent_mount_configuration_required')
    require(not VOLUME.is_symlink() and VOLUME.is_mount()
            and VOLUME.stat().st_uid == 0
            and not VOLUME.stat().st_mode & 0o022
            and VOLUME.stat().st_dev != Path('/').stat().st_dev,
            'separate_protected_project_volume_required')
    return value[0]


def catalog():
    wanted = ','.join("('" + schema + "','" + name + "')"
                      for schema, names in TABLES.items() for name in names)
    return sql("""BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
WITH wanted(nspname,relname)AS(VALUES """ + wanted + """),
tables AS(SELECT c.* FROM wanted w JOIN pg_namespace n ON n.nspname=w.nspname
  JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=w.relname),
relations AS(SELECT oid FROM tables UNION SELECT i.indexrelid FROM pg_index i JOIN tables t ON i.indrelid=t.oid)
SELECT jsonb_build_object(
 'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'cluster',current_setting('cluster_name'),'port',current_setting('port'),
 'tableCount',(SELECT count(*) FROM tables),
 'relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid::text,'schema',n.nspname,
   'name',c.relname,'kind',c.relkind,'owner',c.relowner::text,'acl',c.relacl::text,
   'file',c.relfilenode::text,'tablespace',c.reltablespace::text,
   'bytes',CASE WHEN c.relkind='r' THEN pg_table_size(c.oid) ELSE pg_total_relation_size(c.oid) END::text)
   ORDER BY c.oid) FROM relations r JOIN pg_class c ON c.oid=r.oid JOIN pg_namespace n ON n.oid=c.relnamespace),
 'generationState',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM metadata_projection.generation g WHERE id IN(103,105,107)),
 'pointer',(SELECT to_jsonb(a) FROM metadata_projection.active a WHERE singleton),
 'sourceLayout',(SELECT encode(sha256(convert_to(string_agg(c.oid||':'||c.relfilenode||':'||c.reltablespace||':'||c.relowner,',' ORDER BY c.oid),'UTF8')),'hex')
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('unified_ypal_20261023_v1','yunipals_ownership_4e77f52b_v5')),
 'nextGenerationBytes',(SELECT greatest(8000000000,ceil(sum(pg_total_relation_size(r))*1.5))::text
   FROM unnest(ARRAY['metadata.token_search','metadata.token_trait','metadata.projection_revision']::regclass[])r),
 'snapshotInputBytes',ceil((pg_table_size('metadata.token_metadata')+pg_table_size('unified_ypal_20261023_v1.token')*2)*1.5)::text,
 'existingTablespace',(SELECT jsonb_build_object('oid',oid::text,'path',pg_tablespace_location(oid)) FROM pg_tablespace WHERE spcname='yunipals_derived'));
ROLLBACK;""")


def validate_catalog(value, original=True):
    require(value['databaseOid'] == '17584' and value['port'] == '5432'
            and value['cluster'] == '16/main', 'fixed_main_project_database_required')
    require(value['tableCount'] == sum(len(x) for x in TABLES.values()),
            'all_fourteen_existing_tables_required')
    tables = {(r['schema'], r['name']) for r in value['relations'] if r['kind'] == 'r'}
    require(tables == {(s, n) for s, names in TABLES.items() for n in names},
            'exact_derived_table_scope_required')
    require(all(r['kind'] in ('r', 'i') and r['schema'] in TABLES
                and r['oid'].isdigit() and r['file'].isdigit()
                and (not original or r['tablespace'] == '0')
                for r in value['relations']), 'existing_default_derived_relations_required')
    require(value['pointer']['current_id'] == 103
            and {r['id'] for r in value['generationState']} == {103, 105, 107}
            and all(r['state'] == 'ready' for r in value['generationState']),
            'unchanged_unpublished_collection_boundary_required')


def layout(value):
    return [{k: r[k] for k in ('oid', 'schema', 'name', 'kind', 'owner', 'acl', 'file', 'tablespace')}
            for r in value['relations']]


def plan():
    observed = catalog()
    validate_catalog(observed)
    require(observed['existingTablespace'] is None and not DESTINATION.exists()
            and not DROPIN.exists(), 'fresh_derived_tablespace_required')
    root, volume = filesystem(Path('/')), filesystem(VOLUME)
    total = sum(int(r['bytes']) for r in observed['relations'])
    growth = int(observed['nextGenerationBytes']) + int(observed['snapshotInputBytes'])
    require(root['freeBytes'] + total >= RESERVE + BACKUP + growth,
            'root_must_cover_unchanged_regular_refresh_reserves_after_move')
    require(volume['freeBytes'] >= total + RESERVE + growth,
            'volume_must_cover_copy_and_next_refresh_without_borrowing_reserve')
    require(root['freeBytes'] >= RESERVE + 2 * max(int(r['bytes']) for r in observed['relations']),
            'root_wal_copy_headroom_required')
    return {'format': 'yunipals-derived-storage-v1', 'observed': observed,
            'layoutSha256': digest(layout(observed)), 'mount': mount(),
            'root': root, 'volume': volume, 'moveBytes': total,
            'postMoveRootFreeEstimate': root['freeBytes'] + total,
            'postMoveVolumeFreeEstimate': volume['freeBytes'] - total,
            'regularRefreshRequiredBytes': RESERVE + BACKUP + growth,
            'reserveBytesPerFilesystem': RESERVE}


def apply(value, journal):
    require(value['format'] == 'yunipals-derived-storage-v1', 'exact_storage_plan_required')
    current = plan()
    require(current['layoutSha256'] == value['layoutSha256']
            and current['mount'] == value['mount']
            and current['observed']['generationState'] == value['observed']['generationState']
            and current['observed']['pointer'] == value['observed']['pointer']
            and current['observed']['sourceLayout'] == value['observed']['sourceLayout'],
            'same_catalog_and_immutable_publication_boundary_required')
    for unit in READERS:
        state = subprocess.run(['systemctl', 'is-active', unit], text=True,
                               capture_output=True).stdout.strip()
        require(state == 'inactive', 'collection_readers_must_remain_stopped')
    save(journal / 'before.json', current)
    account = pwd.getpwnam('postgres')
    DESTINATION.mkdir(mode=0o700)
    os.chown(DESTINATION, account.pw_uid, account.pw_gid)
    DROPIN.parent.mkdir(parents=True, exist_ok=True)
    DROPIN.write_bytes(DROPIN_BYTES)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    sql("CREATE TABLESPACE yunipals_derived OWNER postgres LOCATION '" + str(DESTINATION) + "';")
    # Each move commits separately. Any failure stops; never replay ambiguous DDL.
    rows = sorted(current['observed']['relations'], key=lambda r: int(r['bytes']))
    for number, row in enumerate(rows, 1):
        require(filesystem(Path('/'))['freeBytes'] >= RESERVE + 2 * int(row['bytes'])
                and filesystem(VOLUME)['freeBytes'] >= RESERVE + int(row['bytes']),
                'per_move_filesystem_reserve_required')
        require(mount() == current['mount'], 'same_project_volume_required')
        name = identifier(row['schema']) + '.' + identifier(row['name'])
        kind = 'TABLE' if row['kind'] == 'r' else 'INDEX'
        save(journal / (str(number) + '-intent.json'), row)
        sql("BEGIN; SET LOCAL lock_timeout='500ms'; SET LOCAL statement_timeout='300s';\n"
            "DO $guard$ BEGIN IF current_database()<>'yunipals_backfill' OR "
            "(SELECT oid FROM pg_database WHERE datname=current_database())<>17584 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid="
            + row['oid'] + " AND relfilenode=" + row['file'] + " AND reltablespace=0 AND relowner="
            + row['owner'] + ") THEN RAISE EXCEPTION 'same_existing_derived_relation_required'; END IF; END $guard$;\n"
            + 'ALTER ' + kind + ' ' + name + ' SET TABLESPACE yunipals_derived;\nCOMMIT;', timeout=310)
        if int(row['bytes']) >= 1_000_000_000:
            sql("SET statement_timeout='120s'; CHECKPOINT;", timeout=130)
        save(journal / (str(number) + '-completed.json'),
             {'oid': row['oid'], 'root': filesystem(Path('/')), 'volume': filesystem(VOLUME)})
        print(json.dumps({'moved': number, 'total': len(rows), 'relation': name}), flush=True)
    after = catalog()
    validate_catalog(after, original=False)
    require(after['generationState'] == current['observed']['generationState']
            and after['pointer'] == current['observed']['pointer']
            and after['sourceLayout'] == current['observed']['sourceLayout'],
            'publication_rows_and_source_layout_must_remain_unchanged')
    old_acl = [(r['oid'], r['owner'], r['acl']) for r in current['observed']['relations']]
    require([(r['oid'], r['owner'], r['acl']) for r in after['relations']] == old_acl,
            'relation_ownership_and_acl_must_remain_unchanged')
    require(after['existingTablespace']['path'] == str(DESTINATION)
            and all(r['tablespace'] == after['existingTablespace']['oid'] for r in after['relations']),
            'every_selected_relation_must_use_the_project_volume')
    result = {'completed': True, 'relations': len(rows), 'tables': 14,
              'root': filesystem(Path('/')), 'volume': filesystem(VOLUME),
              'publicationUnchanged': True, 'sourceLayoutUnchanged': True,
              'relationPermissionsUnchanged': True, 'servicesRestarted': False,
              'tablespacePath': str(DESTINATION)}
    save(journal / 'after.json', after)
    save(journal / 'result.json', result)
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--apply', type=Path)
    parser.add_argument('--journal', type=Path, required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_host_required')
    args.journal.mkdir(mode=0o700)
    if args.plan:
        value = plan()
        save(args.journal / 'plan.json', value)
        print(json.dumps({k: v for k, v in value.items() if k != 'observed'}))
    else:
        row = args.apply.lstat()
        require(stat.S_ISREG(row.st_mode) and row.st_uid == 0 and row.st_nlink == 1
                and stat.S_IMODE(row.st_mode) == 0o600, 'protected_exact_plan_required')
        apply(json.loads(args.apply.read_text()), args.journal)


if __name__ == '__main__':
    main()
