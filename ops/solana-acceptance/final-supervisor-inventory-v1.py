#!/usr/bin/env python3
"""Fixed read-only Solana handover inputs; no worker, API or provider request."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import types
from urllib.parse import parse_qsl, unquote, urlsplit

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
OBSERVER = OPS / 'arena-config-observer-v4.py'
OBSERVER_SHA = '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba'
UNIT = 'yunipals-solana.service'
FILES = [Path('/etc/yunipals-indexer/indexer.env'), Path('/etc/yunipals-indexer/solana.env')]
TARGETS = [*FILES, Path('/etc/yunipals-unified/ponder.env'), Path('/etc/yunipals-unified/solana.env')]
SOURCE_USER = 'yunipals_unified_shadow'
PROVIDER = 'mainnet.helius-rpc.com'
NO_PASSWORD = Path('/run/yunipals-solana-final-inventory-v1-no-password')
LEGACY = Path('/opt/yunipals/releases/exomon-20261005-v1')
WORKER_SHA = '3e2b150e79c5f9e68718c4e5de9311cd0b1045cb09c07aafcfb093f91f76db6e'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
PHASE = 'initial'
SETTINGS = {
    'SOLANA_BATCH_SIZE': (1000, 1, 1000), 'SOLANA_SYNC_INTERVAL_MS': (900000, 60000, 86400000),
    'SOLANA_RPC_TIMEOUT_MS': (20000, 1000, 120000), 'SOLANA_RPC_MAX_ATTEMPTS': (3, 1, 5),
    'SOLANA_RPC_DAILY_CREDIT_LIMIT': (15000, 10, 1000000),
    'SOLANA_RPC_ROLLING_31D_CREDIT_LIMIT': (500000, 10, 10000000),
    'SOLANA_MAX_MISSING': (0, 0, 10000), 'SOLANA_RPC_MAX_SCAN_CREDITS': (500, 10, 50000),
    'SOLANA_MAX_REPAIR_CALLS_PER_SCAN': (32, 0, 256), 'SOLANA_RPC_REQUEST_GAP_MS': (1000, 500, 60000)
}


class InventoryFailure(RuntimeError): pass
def fail(code): raise InventoryFailure(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def command(argv, *, data=None, timeout=3):
    r = subprocess.run(argv, input=data, capture_output=True, env=ENV, timeout=timeout)
    if r.returncode or r.stderr or len(r.stdout) > 200000: fail('bounded_readonly_command_failed')
    return r.stdout.decode()
def metadata(s): return [s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns]
def known_public_worker_parent(path, parent, info):
    return (Path(path) == LEGACY / 'lib/solana/worker.ts' and parent == LEGACY and
        stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o775)
def read(path, maximum=65536):
    path = Path(path)
    for p in path.parents:
        s = p.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022 and not known_public_worker_parent(path, p, s): fail('protected_input_parent_required')
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 or before.st_mode & 0o022 or before.st_size > maximum:
        fail('fixed_regular_input_required')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        if metadata(os.fstat(f.fileno())) != metadata(before): fail('input_identity_changed')
        raw = f.read(maximum + 1)
        if metadata(os.fstat(f.fileno())) != metadata(before): fail('input_changed_during_read')
    if metadata(path.lstat()) != metadata(before) or len(raw) != before.st_size: fail('input_changed_during_read')
    return raw, metadata(before)
def observer():
    raw, _ = read(OBSERVER, 100000)
    if sha(raw) != OBSERVER_SHA: fail('accepted_parser_pin_changed')
    m = types.ModuleType('accepted_solana_config_parser'); m.__file__ = str(OBSERVER)
    exec(compile(raw, str(OBSERVER), 'exec'), m.__dict__)
    return m
def state():
    keys = 'Id LoadState ActiveState SubState InvocationID MainPID User Group WorkingDirectory FragmentPath DropInPaths ExecStart'.split()
    raw = command(['/usr/bin/systemctl', 'show', '--all', UNIT, *['--property=' + k for k in keys]])
    pairs = [line.split('=', 1) for line in raw.splitlines() if '=' in line]
    p = dict(pairs)
    if len(pairs) != len(p) or set(p) != set(keys) or p['Id'] != UNIT or p['LoadState'] != 'loaded' or p['ActiveState'] != 'active' or p['SubState'] != 'running' or not re.fullmatch('[0-9a-f]{32}', p['InvocationID']) or not re.fullmatch('[1-9][0-9]*', p['MainPID']):
        fail('same_active_standalone_solana_unit_required')
    expected = '/opt/node-v24.18.1/bin/node --import tsx ' + str(LEGACY / 'lib/solana/worker.ts')
    if p['WorkingDirectory'] != str(LEGACY) or p['User'] not in {'', 'root'} or p['Group'] not in {'', 'root'} or re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [expected]:
        fail('existing_solana_runtime_selector_changed')
    return p
def public_settings(env):
    values = {}
    for key, (fallback, low, high) in SETTINGS.items():
        raw = env.get(key)
        if raw is None: value = fallback
        elif re.fullmatch('[0-9]+', raw): value = int(raw)
        else: fail('noncanonical_numeric_setting_requires_explicit_review')
        if not low <= value <= high: fail('existing_solana_setting_out_of_bounds')
        values[key] = {'value': value, 'explicitlyConfigured': raw is not None}
    return values
def database_identity(value):
    try:
        u = urlsplit(value)
        role = unquote(u.username or '')
        db = unquote(u.path.removeprefix('/'))
        query = parse_qsl(u.query, keep_blank_values=True)
        if u.scheme not in {'postgres', 'postgresql'} or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}', role) or db != 'yunipals_backfill' or u.hostname not in {'127.0.0.1', 'localhost', '::1'} or u.port not in {None, 5432} or u.fragment or any(k not in {'application_name', 'sslmode', 'connect_timeout', 'statement_timeout'} for k, _ in query):
            fail('existing_local_solana_database_identity_required')
        return role
    except (ValueError, TypeError): fail('existing_local_solana_database_identity_required')
def source_readability():
    a = pwd.getpwnam(SOURCE_USER)
    if a.pw_uid <= 0 or a.pw_gid <= 0: fail('existing_nonroot_source_account_required')
    code = """import json,os
paths=PATHS;rows=[]
for p in paths:
 try:
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);os.close(fd);rows.append({'exists':True,'canOpen':True})
 except FileNotFoundError:rows.append({'exists':False,'canOpen':False})
 except PermissionError:rows.append({'exists':None,'canOpen':False})
s=dict(x.split(':',1)for x in open('/proc/self/status')if ':'in x)
assert not os.getgroups() and all(int(s[k],16)==0 for k in ['CapPrm','CapEff','CapInh','CapAmb']) and s['NoNewPrivs'].strip()=='1'
print(json.dumps(rows))
""".replace('PATHS', repr([str(p) for p in TARGETS]))
    rows = json.loads(command(['/usr/bin/setpriv', '--reuid=' + str(a.pw_uid), '--regid=' + str(a.pw_gid), '--clear-groups', '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-c', code], timeout=5))
    if not isinstance(rows, list) or len(rows) != 4 or any(set(r) != {'exists', 'canOpen'} or type(r['canOpen']) is not bool or r['exists'] is not None and type(r['exists']) is not bool for r in rows): fail('bounded_source_readability_shape_required')
    return {'uid': a.pw_uid, 'gid': a.pw_gid, 'groupsEmpty': True, 'processCapabilitiesZero': True, 'noNewPrivileges': True, 'files': dict(zip(['oldCommon', 'oldSolana', 'newPonder', 'newSolana'], rows))}
def catalog(role):
    # The configured role is used only as a quoted SQL value on stdin. No URL,
    # password, key, role settings or ownership rows leave this process.
    role_literal = "'" + role.replace("'", "''") + "'"
    sql = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s';
WITH wanted AS(SELECT oid,rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit FROM pg_roles WHERE rolname=ROLE),
required(rel,priv) AS(VALUES
('solana_indexer.manifest','SELECT,INSERT,UPDATE'),('solana_indexer.manifest_asset','SELECT,INSERT,UPDATE'),
('solana_indexer.asset_metadata','SELECT,INSERT,UPDATE'),('solana_indexer.scan_run','SELECT,INSERT,UPDATE'),
('solana_indexer.scan_stage','SELECT,INSERT,DELETE'),('solana_indexer.token','SELECT,INSERT,UPDATE,DELETE'),
('solana_indexer.observed_change','INSERT'),('solana_indexer.wallet_stats','SELECT,INSERT,DELETE'),
('solana_indexer.rpc_usage','SELECT,INSERT,UPDATE'),('solana_indexer.sync_state','SELECT,UPDATE'),
('metadata_source.archive_release','SELECT'),('metadata_source.source_record','SELECT'),('metadata_source.source_blob','SELECT')),
worker_lock AS(SELECT l.granted,a.usename FROM pg_locks l LEFT JOIN pg_stat_activity a USING(pid)
 WHERE l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND l.classid=((hashtext('solana:indexer:worker')::bigint>>32)&4294967295)::oid
 AND l.objid=(hashtext('solana:indexer:worker')::bigint&4294967295)::oid AND l.objsubid=1)
SELECT jsonb_build_object(
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'role',(SELECT row_to_json(r) FROM(SELECT rolcanlogin AS login,rolsuper AS superuser,rolinherit AS inherit,rolcreatedb AS create_database,rolcreaterole AS create_role,rolreplication AS replication,rolbypassrls AS bypass_rls,rolconnlimit AS connection_limit FROM wanted)r),
 'requiredPrivilegeChecks',(SELECT count(*) FROM required),'requiredPrivilegesPresent',(SELECT COALESCE(bool_and(w.oid IS NOT NULL AND to_regclass(r.rel) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(string_to_array(r.priv,','))p(priv) WHERE NOT has_table_privilege(w.oid,to_regclass(r.rel),p.priv))),false) FROM required r LEFT JOIN wanted w ON true),
 'sequenceUsage',(SELECT COALESCE(bool_and(has_sequence_privilege(w.oid,s.seq,'USAGE')),false) FROM wanted w CROSS JOIN(VALUES('solana_indexer.scan_run_id_seq'),('solana_indexer.rpc_usage_id_seq'))s(seq)),
 'schemaUsage',(SELECT COALESCE(has_schema_privilege(oid,'solana_indexer','USAGE') AND has_schema_privilege(oid,'metadata_source','USAGE'),false) FROM wanted),
 'configuredRoleSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename=ROLE),
 'maxConnections',current_setting('max_connections')::int,'currentClientSessions',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),
 'manifest',(SELECT jsonb_build_object('checksum',checksum,'count',asset_count) FROM solana_indexer.manifest WHERE singleton),
 'manifestAssetRows',(SELECT count(*) FROM solana_indexer.manifest_asset),
 'state',(SELECT jsonb_build_object('publishedRunId',published_run_id,'nextScanAt',next_scan_at,'lastErrorPresent',last_error IS NOT NULL) FROM solana_indexer.sync_state WHERE singleton),
 'publication',(SELECT jsonb_build_object('id',r.id,'state',r.state,'assetCount',r.asset_count,'missingCount',r.missing_count,'completedAt',r.completed_at) FROM solana_indexer.scan_run r JOIN solana_indexer.sync_state s ON s.published_run_id=r.id WHERE s.singleton),
 'runningScans',(SELECT count(*) FROM solana_indexer.scan_run WHERE state='running'),
 'stagedRows',(SELECT count(*) FROM solana_indexer.scan_stage),
 'ledger',(SELECT jsonb_build_object('rows',count(*),'credits',COALESCE(sum(credits),0)::text,'latestId',max(id)::text,
 'todayCredits',COALESCE(sum(credits) FILTER(WHERE reserved_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::text,
 'rolling31DayCredits',COALESCE(sum(credits) FILTER(WHERE reserved_at>=now()-interval '31 days'),0)::text) FROM solana_indexer.rpc_usage),
 'workerLock',jsonb_build_object('granted',(SELECT count(*) FROM worker_lock WHERE granted),'waiting',(SELECT count(*) FROM worker_lock WHERE NOT granted),'allGrantedRolesMatch',(SELECT COALESCE(bool_and(usename=ROLE),true) FROM worker_lock WHERE granted)));
ROLLBACK;
""".replace('ROLE', role_literal)
    a = pwd.getpwnam('postgres')
    if a.pw_uid <= 0 or a.pw_gid <= 0: fail('nonroot_postgres_peer_required')
    if os.path.lexists(NO_PASSWORD): fail('fixed_password_file_must_remain_absent')
    argv = ['/usr/bin/setpriv', '--reuid=' + str(a.pw_uid), '--regid=' + str(a.pw_gid), '--clear-groups', '--no-new-privs', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'PGHOST=/var/run/postgresql', 'PGPORT=5432', 'PGUSER=postgres', 'PGDATABASE=yunipals_backfill', 'PGPASSFILE=' + str(NO_PASSWORD), 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000', '/usr/bin/psql', '-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1']
    value = json.loads(command(argv, data=sql.encode(), timeout=8))
    if os.path.lexists(NO_PASSWORD): fail('fixed_password_file_must_remain_absent')
    if value['readOnly'] is not True or value['isolation'] != 'repeatable read': fail('readonly_catalog_snapshot_required')
    return value
def dns_targets():
    raw = command(['/usr/bin/getent', 'ahosts', PROVIDER], timeout=5)
    values = sorted({str(ipaddress.ip_address(line.split()[0])) for line in raw.splitlines() if line.split()})
    if not 1 <= len(values) <= 16 or any(not ipaddress.ip_address(v).is_global for v in values): fail('bounded_public_helius_dns_addresses_required')
    path = Path('/etc/resolv.conf')
    if path.is_symlink():
        target = path.resolve(strict=True)
        if target not in {Path('/run/systemd/resolve/stub-resolv.conf'), Path('/run/systemd/resolve/resolv.conf')}: fail('fixed_resolver_source_required')
        path = target
    try:
        resolver, _ = read(path, 16384)
        addresses = sorted({str(ipaddress.ip_address(line.split()[1])) for line in resolver.decode().splitlines() if line.split() and line.split()[0] == 'nameserver' and len(line.split()) >= 2})
    except (InventoryFailure, PermissionError, FileNotFoundError): addresses = None
    return {'target': PROVIDER, 'addresses': values, 'allowCidrs': [v + ('/128' if ':' in v else '/32') for v in values], 'resolverAddresses': addresses, 'resolverInputRequiresSeparateReview': addresses is None, 'providerHttpRpcCalls': 0, 'dnsResolutionOnly': True, 'futureAddressStabilityProven': False}
def observe():
    global PHASE
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_observation_required')
    PHASE = 'unit_and_parser'
    o = observer(); before = state(); typed = o.typed_properties(UNIT, run=command)
    if typed['EnvironmentFiles'] != [[str(p), False] for p in FILES] or typed['LoadCredential'] != []: fail('existing_ordered_solana_selectors_required')
    raw_worker, _ = read(LEGACY / 'lib/solana/worker.ts', 100000)
    if sha(raw_worker) != WORKER_SHA: fail('existing_worker_source_changed')
    PHASE = 'selected_existing_config'
    files = {}; env = dict(item.split('=', 1) for item in typed['Environment'])
    for p in FILES:
        raw, meta = read(p); files[str(p)] = {'sha256': sha(raw), 'metadata': meta}; env.update(o.parse_env(raw))
    if env.get('SOLANA_SYNC_ENABLED') != 'true' or not env.get('HELIUS_API_KEY'): fail('existing_enabled_solana_child_settings_required')
    role = database_identity(env.get('DATABASE_URL', '')); settings = public_settings(env)
    paths = [Path(before['FragmentPath']), *before['DropInPaths'].split()]
    if paths != [Path('/etc/systemd/system/yunipals-solana.service')]: fail('unreviewed_solana_dropin_requires_explicit_inventory')
    definitions = {}
    for p in paths:
        raw, meta = read(p, 100000)
        if re.search(rb'(?m)^\s*(?:PassEnvironment|UnsetEnvironment|SetCredential|LoadCredentialEncrypted|ImportCredential)\s*=\s*[^\r\n\s]', raw): fail('additional_environment_mechanism_requires_review')
        definitions[str(p)] = {'sha256': sha(raw), 'metadata': meta}
    PHASE = 'source_readability'; readable = source_readability()
    PHASE = 'readonly_catalog'; db = catalog(role)
    PHASE = 'fixed_dns'; dns = dns_targets()
    PHASE = 'unchanged_inputs'
    for p, expected in [*files.items(), *definitions.items()]:
        raw, meta = read(p, 100000)
        if {'sha256': sha(raw), 'metadata': meta} != expected: fail('configuration_changed_during_observation')
    if state() != before or o.typed_properties(UNIT, run=command) != typed: fail('solana_invocation_or_settings_changed')
    floor = {'manifestMatches': db.get('manifest') == {'checksum': 'f9499fc3399ae235c0d3dd1c1664e4e9933dc57c5ec653e5c6368b100c295d07', 'count': 10000},
        'publicationNotBefore1411': db.get('state', {}).get('publishedRunId', 0) >= 1411,
        'ledgerAggregateFloorsPreserved': db.get('ledger', {}).get('rows', 0) >= 13153 and int(db.get('ledger', {}).get('credits', '0')) >= 131530,
        'completeHistoryOrNoResetClaimed': False}
    return {'format': 'yunipals-solana-final-supervisor-inventory-v1', 'unit': UNIT, 'invocation': before['InvocationID'], 'sourceSettings': files, 'definitions': definitions,
        'workerSourceSha256': WORKER_SHA, 'configuredEffectivePublicSettings': settings, 'heliusKeyPresent': True,
        'configuredDatabaseRoleSha256': sha(role.encode()), 'localExpectedDatabase': True, 'runningEnvironmentRead': False,
        'configuredInputsOnlyNotRunningEnvironmentEquivalence': True, 'sourceReadability': readable, 'database': db,
        'acceptedSnapshotFloorChecks': floor, 'lockObservationIsInstantaneous': True, 'dns': dns, 'privateValuesExported': False, 'productionWrites': 0,
        'workerOrApiImported': False, 'scansTriggered': 0, 'providerHttpRpcCalls': 0, 'serviceJobs': 0, 'cutoverPerformed': False}
def main():
    os.environ.clear(); os.environ.update(ENV)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(60)
    try: print(json.dumps(observe(), sort_keys=True))
    except BaseException as error:
        allowed = isinstance(error, InventoryFailure) and re.fullmatch('[a-z0-9_]{1,100}', str(error))
        print(json.dumps({'format': 'yunipals-solana-final-supervisor-inventory-v1', 'status': 'failed', 'phase': PHASE, 'errorClass': type(error).__name__, 'fixedCode': str(error) if allowed else 'readonly_observation_failed', 'privateValuesExported': False, 'serviceJobs': 0, 'providerHttpRpcCalls': 0}))
        raise SystemExit(1)
    finally: signal.alarm(0)


if __name__ == '__main__': main()
