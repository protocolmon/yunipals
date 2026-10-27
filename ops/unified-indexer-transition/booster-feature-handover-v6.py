#!/usr/bin/env python3
"""Finite eight-read admission, owned feature switch and witnessed retirement.

Separate phases never infer a reader switch from parity or source retirement
from a stopped PID alone. No phase calls a chain RPC or an image provider.
"""
import argparse
import copy
import datetime
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import socket
import subprocess
import time
import types
import urllib.request

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-booster-feature-handover-v6-20261023')
ENV = Path('/etc/yunipals-unified/booster-api.env')
LOCK = Path('/run/lock/yunipals-unified-consumer-api-preview.lock')
OLD = 'yunipals_boosters_launch_v1'
TARGET = 'unified_shadow_20261020_7e7375b0'
TARGET_OID = '73004622'
OWNER_OID = '73004621'
ROLE = 'yunipals_unified_collector'
ROLE_OID = '73187672'
API = 'yunipals-booster-api.service'
QUEUE = 'yunipals-booster-artwork-queue.service'
TIMER = 'yunipals-booster-artwork-queue.timer'
SOURCE = 'yunipals-booster-launch.service'
SHARED = 'yunipals-indexer.service'
COMBINED = 'yunipals-unified-source6-free-v2.service'
PUBLIC = 'https://api.yunipals.com/yunipals-indexer'
ENV_SHA = '0c055ac01166d9b4218f498f795d16e2f895d17b60c8b96dd82890415306d400'
SOURCE_SHA = '3d0dc54eabbeb806363305926c45b6a18cdae0eea84a4faa0f059f2eb3c8fcb0'
ESBUILD = '/var/lib/yunipals-unified-shadow/20261020-008028af-a/node_modules/.pnpm/@esbuild+linux-x64@0.25.12/node_modules/@esbuild/linux-x64/bin/esbuild'
ESBUILD_SHA = 'bab29b2ca7a9e89b67cf720b77b2d743f9f31f5cf0d5bd74ee8c8de30ced7014'
ESBUILD_ARGV_SHA = 'a38a748520fd6061e87e09bc1e78cf63f8ab08a73d9b8d24f468f24a083d6ac6'
SOURCE_CAPINH_SHA = 'f2da78b49f1566ebca881c763328012aee1f1e48070862ed835ab22d8aa1ff3e'
SOURCE_CAPBND_SHA = hashlib.sha256(b'000001ffffffffff').hexdigest()
PEER_PROC_CODE = r'''import json,os,pathlib,sys
pid=int(sys.argv[1]);assert 0<pid<2**31 and os.geteuid()==970 and os.getegid()==964
p=pathlib.Path('/proc')/str(pid)
def identity():
 s=(p/'stat').read_text();return int(s[s.rindex(')')+2:].split()[19])
before=identity();status=dict(x.split(':',1)for x in(p/'status').read_text().splitlines()if':'in x)
assert all(int(x)==970 for x in status['Uid'].split())and all(int(x)==964 for x in status['Gid'].split())
exe=os.readlink(p/'exe');assert identity()==before
print(json.dumps({'startTicks':before,'nodeExecutable':exe=='/opt/node-v24.18.1/bin/node',
 'esbuildExecutable':exe=='/var/lib/yunipals-unified-shadow/20261020-008028af-a/node_modules/.pnpm/@esbuild+linux-x64@0.25.12/node_modules/@esbuild/linux-x64/bin/esbuild'}))
'''
TARGET_OIDS = {'_ponder_meta': '73032449', '_ponder_checkpoint': '73032456',
    'booster_type': '73032539', 'booster_original': '73032554', 'booster_request': '73032569',
    'booster_monster': '73032584', 'booster_refund': '73032599', 'booster_engine_state': '73032614',
    'booster_checkpoint': '73032644', 'booster_event': '73032629'}
ADDITIONS = tuple(sorted(name for name in TARGET_OIDS if not name.startswith('_ponder_')))
DEPS = {'booster-api-binding-v2.py': '4ce2f6216ee3774ad89ca5ed53bae9db606d292354715497c0eb00df74f3e909', 'consumer-owned-booster-policy-v2.py': '235c1a65309f92440335faf881d592371b10c3df824c50a1aa55ef68092ab720', 'consumer-owned-booster-runtime-v3.py': '5f42dccc1e632848594c763ff2490d56fbb063f32e0e022a72f88e07fe9b7811', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'booster-source-parity-v2.py': '0daf6d004107d1cfea362c538384ff74b23a61e3daf2536e4574aed9084def2f', 'consumer-operational-install-v7.py': '9a59728a3dbdac9c039d1bd1e0c35557a15ece2ec018c5b6bee25bcfcae7d078', 'consumer-operational-live-booster-v1.py': '7fc0f645067be01406c4643abf4a4473a936fdbea54bfce68943a739e3a25f1b', 'booster-current-api-checks-v1.py': '591c117583e9d0568340dfe6f0390c8ddb7bcd984efbcb41afea35b645ab13bf', 'consumer-accepted-marketplace-acl-v2.py': '4fa510efd86714404655403617d46cd597fb099b6ed3d9a003cf293269c34a36'}


def fail(code):
    raise RuntimeError(code)


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def replace_schema(raw):
    before = ('BOOSTER_DATABASE_SCHEMA=' + OLD + '\n').encode()
    if sha(raw) != ENV_SHA or raw.count(before) != 1:
        fail('exact_original_public_feature_environment_required')
    return raw.replace(before, ('BOOSTER_DATABASE_SCHEMA=' + TARGET + '\n').encode())


def protected(path, cap=4000000):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        fail('absolute_protected_owner_input_required')
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not (stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX)):
            fail('protected_owner_ancestry_required')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > cap:
        fail('bounded_regular_owner_input_required')
    raw = path.read_bytes()
    after = path.stat()
    if (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail('owner_input_changed_while_reading')
    return raw


def document(path, pin=None):
    raw = protected(path)
    if pin is not None and sha(raw) != pin:
        fail('exact_protected_receipt_required')
    return json.loads(raw)


def load(name):
    raw = protected(OPS / name)
    if sha(raw) != DEPS.get(name):
        fail('frozen_handover_dependency_required')
    module = types.ModuleType(name.replace('-', '_'))
    module.__file__ = str(OPS / name)
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    return module


def snapshot_sql():
    # Full direct ACLs on both namespaces make the eight additions the only
    # observable mutation. No domain rows or credentials are read here.
    return """SELECT jsonb_build_object('identity',jsonb_build_object('database',current_database(),'socket',inet_server_addr()IS NULL),
      'role',(SELECT jsonb_build_object('oid',r.oid::text,'name',r.rolname,'login',r.rolcanlogin,'inherit',r.rolinherit,
        'super',r.rolsuper,'createRole',r.rolcreaterole,'createDatabase',r.rolcreatedb,'replication',r.rolreplication,
        'bypassRls',r.rolbypassrls,'limit',r.rolconnlimit,'passwordConfigured',r.rolpassword IS NOT NULL,
        'memberships',(SELECT count(*)FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid))
        FROM pg_authid r WHERE rolname='yunipals_unified_collector'),
      'schemas',(SELECT jsonb_agg(jsonb_build_object('name',n.nspname,'oid',n.oid::text,'owner',n.nspowner::text,
        'usage',has_schema_privilege('yunipals_unified_collector',n.oid,'USAGE'),
        'create',has_schema_privilege('yunipals_unified_collector',n.oid,'CREATE'),'acl',n.nspacl::text)ORDER BY n.nspname)
        FROM pg_namespace n WHERE n.nspname IN('yunipals_boosters_launch_v1','unified_shadow_20261020_7e7375b0')),
      'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'oid',c.oid::text,
        'owner',c.relowner::text,'kind',c.relkind,'select',has_table_privilege('yunipals_unified_collector',c.oid,'SELECT'),
        'writes',has_table_privilege('yunipals_unified_collector',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
        'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor::text,'grantee',a.grantee::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
          ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable)FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a))ORDER BY n.nspname,c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('yunipals_boosters_launch_v1','unified_shadow_20261020_7e7375b0')AND c.relkind IN('r','p','v','m','f')))
    """


def validate_snapshot(value, old_graph, admitted):
    expected_role = {'oid': ROLE_OID, 'name': ROLE, 'login': True, 'inherit': False, 'super': False,
        'createRole': False, 'createDatabase': False, 'replication': False, 'bypassRls': False,
        'limit': 6, 'passwordConfigured': False, 'memberships': 0}
    if value.get('identity') != {'database': 'yunipals_backfill', 'socket': True} or value.get('role') != expected_role:
        fail('unchanged_live_passwordless_six_slot_collector_required')
    schemas = {row['name']: row for row in value.get('schemas') or []}
    for name, oid in ((OLD, str(old_graph['schemaOid'])), (TARGET, TARGET_OID)):
        row = schemas.get(name) or {}
        if row.get('oid') != oid or row.get('owner') != OWNER_OID or row.get('usage') is not True or row.get('create') is not False:
            fail('exact_existing_schema_usage_and_ownership_required')
    if set(schemas) != {OLD, TARGET}:
        fail('exact_source_pair_required')
    rows = value.get('tables') or []
    old = [row for row in rows if row['schema'] == OLD]
    if {row['name']: (row['oid'], row['owner']) for row in old} != {row['name']: (row['oid'], row['owner']) for row in old_graph['tables']}:
        fail('old_source_native_table_OIDs_must_be_preserved')
    if any(row['kind'] != 'r' or row['select'] is not (row['name'] in TARGET_OIDS) for row in old):
        fail('exact_old_ten_reads_must_be_preserved')
    target = {row['name']: row for row in rows if row['schema'] == TARGET}
    for name, oid in TARGET_OIDS.items():
        row = target.get(name) or {}
        if row.get('oid') != oid or row.get('owner') != OWNER_OID or row.get('kind') != 'r' or row.get('select') is not (admitted or name not in ADDITIONS):
            fail('exact_two_prior_and_eight_new_target_reads_required')
    for row in rows:
        if row['writes'] or any(a['grantee'] == ROLE_OID and a['grantable'] for a in row['acl'] or []):
            fail('no_feature_writes_or_grant_options_allowed')
    return value


def after_eight_reads(before, remove=False):
    value = copy.deepcopy(before)
    for name in ADDITIONS:
        row = next(row for row in value['tables'] if row['schema'] == TARGET and row['name'] == name)
        entry = {'grantor': OWNER_OID, 'grantee': ROLE_OID, 'privilege': 'SELECT', 'grantable': False}
        acl = row['acl'] or []
        if remove:
            if entry not in acl or row['select'] is not True:
                fail('only_owned_eight_read_inverse_allowed')
            acl.remove(entry)
        elif entry in acl or row['select'] is not False:
            fail('preexisting_read_may_not_be_adopted')
        else:
            acl.append(entry)
        row['acl'] = sorted(acl, key=lambda a: (int(a['grantor']), int(a['grantee']), a['privilege'], a['grantable'])) or None
        row['select'] = not remove
    return value


def grant_sql(before, after, commit=False, remove=False):
    query = snapshot_sql()
    body = 'IF (' + query + ')IS DISTINCT FROM ' + quote(json.dumps(before, sort_keys=True, separators=(',', ':'))) + "::jsonb THEN RAISE EXCEPTION 'feature_read_before_graph_changed';END IF;\n"
    for name in ADDITIONS:
        body += ('REVOKE SELECT ON TABLE ' + TARGET + '.' + name + ' FROM ' + ROLE + ';\n' if remove else
                 'GRANT SELECT ON TABLE ' + TARGET + '.' + name + ' TO ' + ROLE + ';\n')
    body += 'IF (' + query + ')IS DISTINCT FROM ' + quote(json.dumps(after, sort_keys=True, separators=(',', ':'))) + "::jsonb THEN RAISE EXCEPTION 'only_eight_feature_reads_may_change';END IF;"
    tag = '$feature_' + sha(body.encode())[:16] + '$'
    if tag in body:
        fail('inert_feature_SQL_required')
    return "BEGIN;SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='1500ms';SELECT pg_advisory_xact_lock(178858,9062);DO " + tag + ' BEGIN\n' + body + '\nEND ' + tag + ';' + ('COMMIT;' if commit else 'ROLLBACK;')



def eight_read_review(review):
    binding = review['binding']
    before, after = binding['before'], binding['after']
    if (binding.get('format') != 'yunipals-booster-eight-read-admission-v2'
            or binding.get('operatorSha256') != sha(protected(__file__))
            or review.get('actualRollbackRehearsed') is not True
            or review.get('reviewHash') != sha(encode(binding))
            or binding.get('additions') != list(ADDITIONS)
            or binding.get('loginChanged') is not False or binding.get('writesGranted') is not False
            or after != after_eight_reads(before)
            or binding.get('rehearsalSqlSha256') != sha(grant_sql(before, after).encode())):
        fail('exact_owned_eight_read_review_required')
    return binding


def eight_read_inputs(review, artifact_file, artifact_sha, consumers, boot_id):
    binding = eight_read_review(review)
    roles = {'yunipals_unified_api', ROLE, 'yunipals_unified_read_cache', 'yunipals_unified_islands_api'}
    if (not re.fullmatch('[0-9a-f]{64}', str(artifact_sha))
            or sha(protected(artifact_file)) != artifact_sha
            or not re.fullmatch('[0-9a-f-]{36}', str(boot_id))
            or len(consumers) != 4 or {row.get('role') for row in consumers} != roles
            or any(set(row) != {'role', 'resultSha256', 'invocation'}
                or not re.fullmatch('[0-9a-f]{64}', str(row.get('resultSha256')))
                or not re.fullmatch('[0-9a-f]{32}', str(row.get('invocation'))) for row in consumers)):
        fail('exact_artifact_and_four_admitted_consumer_receipts_required')
    return {'format': 'yunipals-booster-eight-read-inputs-v1',
        'operatorSha256': binding['operatorSha256'], 'reviewHash': review['reviewHash'],
        'reviewFileSha256': sha(encode(review)), 'artifactFile': str(artifact_file), 'artifactSha256': artifact_sha,
        'consumerAdmissions': consumers, 'bootId': boot_id,
        'beforeSha256': sha(encode(binding['before'])), 'afterSha256': sha(encode(binding['after'])),
        'transactionSha256': sha(grant_sql(binding['before'], binding['after'], True).encode())}


def stopped_owned(state, prior, expected_sha, observed_sha):
    # systemd GC may clear PID/invocation/start metadata after an owned stop.
    if (observed_sha != expected_sha or state.get('Id') != prior['Id'] or state.get('FragmentPath') != prior['FragmentPath']
            or state.get('DropInPaths') or state.get('User') != prior['User'] or state.get('Group') != prior['Group']
            or state.get('ActiveState') not in {'inactive', 'failed'} or state.get('MainPID') != '0'
            or state.get('Job') not in {'', '0'} or state.get('InvocationID') not in {'', prior['InvocationID']}):
        fail('exact_owned_terminal_actor_required')
    return True


def queue_completion(rows, start_us, boundary):
    valid = []
    for row in rows:
        if (row.get('_SYSTEMD_UNIT') != QUEUE or row.get('_UID') != '967' or row.get('_GID') != '961'
                or row.get('_EXE') != '/opt/node-v24.18.1/bin/node'
                or not start_us <= int(row.get('__MONOTONIC_TIMESTAMP', '0'))):
            continue
        try:
            event = json.loads(row.get('MESSAGE', ''))
        except (ValueError, TypeError):
            continue
        if (event.get('event') == 'booster_artwork_queue_sync' and event.get('skipped') is False
                and type(event.get('queued')) is int and event['queued'] >= 0
                and re.fullmatch('[0-9a-f]{32}', row.get('_SYSTEMD_INVOCATION_ID', ''))
                and str(event.get('indexedBlock', '')).isdigit() and int(event['indexedBlock']) >= boundary):
            valid.append({'invocation': row['_SYSTEMD_INVOCATION_ID'], 'queued': event['queued'],
                          'indexedBlock': int(event['indexedBlock']), 'monotonicUs': int(row['__MONOTONIC_TIMESTAMP'])})
    if not valid:
        fail('new_owned_successful_queue_event_required_even_after_GC')
    return valid[-1]


def validate_esbuild_child(executable, raw_binary, argv, parent, main_pid):
    if executable != ESBUILD or sha(raw_binary) != ESBUILD_SHA or argv != [ESBUILD, '--service=0.25.12', '--ping'] or sha(encode(argv)) != ESBUILD_ARGV_SHA or parent != main_pid:
        fail('only_exact_pinned_direct_esbuild_child_allowed')
    return {'executableSha256': ESBUILD_SHA, 'argvSha256': ESBUILD_ARGV_SHA, 'parentPid': main_pid}


def validate_source_status(status):
    if (any(int(v) != 970 for v in status['Uid'].split()) or any(int(v) != 964 for v in status['Gid'].split())
            or status['NoNewPrivs'].strip() != '1'
            or sha(status['CapInh'].strip().encode()) != SOURCE_CAPINH_SHA
            or sha(status['CapBnd'].strip().encode()) != SOURCE_CAPBND_SHA
            or any(int(status[key], 16) for key in ('CapPrm', 'CapEff', 'CapAmb'))):
        fail('exact_observed_locked_source_capability_policy_required')
    return {'inheritableSha256': SOURCE_CAPINH_SHA, 'boundingSha256': SOURCE_CAPBND_SHA,
            'permittedZero': True, 'effectiveZero': True, 'ambientZero': True, 'noNewPrivileges': True}


class Host:
    def __init__(self):
        self.admission = load('booster-api-binding-v2.py')
        self.policy = load('consumer-owned-booster-policy-v2.py')
        self.runtime = load('consumer-owned-booster-runtime-v3.py')
        self.parity = load('booster-source-parity-v2.py')
        self.graph = document(OPS / 'consumer-owned-booster-graph-v1.json', DEPS['consumer-owned-booster-graph-v1.json'])

    def run(self, argv, timeout=30, data=None):
        result = subprocess.run(argv, input=data, text=True, capture_output=True, timeout=timeout,
            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'})
        if result.returncode or len(result.stdout) > 4000000:
            fail('bounded_fixed_handover_command_failed')
        return result.stdout

    def sql(self, text):
        return self.admission.sql(text).decode()

    def query(self, text):
        return json.loads(self.sql('BEGIN READ ONLY;SET LOCAL statement_timeout=\'10s\';' + text + ';ROLLBACK;'))

    def snapshot(self, admitted):
        return validate_snapshot(self.query(snapshot_sql()), self.graph, admitted)

    def state(self, unit):
        if unit not in {API, QUEUE, TIMER, SOURCE, SHARED, COMBINED}:
            fail('fixed_feature_unit_required')
        keys = 'Id,LoadState,ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestampMonotonic,InactiveEnterTimestampMonotonic,User,Group,FragmentPath,DropInPaths,ControlGroup,Job,Result,UnitFileState,WantedBy,RequiredBy,UpheldBy,TriggeredBy,Triggers,ExecStart,WorkingDirectory'
        return dict(line.split('=', 1) for line in self.run(['/usr/bin/systemctl', 'show', unit, '--property=' + keys], 5).splitlines() if '=' in line)

    def command(self, action, unit, expected_identity=None):
        if action not in {'start', 'stop', 'enable', 'disable'} or unit not in {API, QUEUE, TIMER, SOURCE}:
            fail('fixed_owned_service_action_required')
        self.command_inputs(action, unit)
        if expected_identity is not None:
            latest = self.state(unit)
            if (action != 'stop' or latest.get('ActiveState') not in {'active', 'activating'}
                    or latest.get('Job') not in {'', '0'}
                    or any(latest.get(key) != expected_identity.get(key) for key in
                           ('Id', 'InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic'))):
                fail('owned_stop_identity_changed_at_command_boundary')
        return self.run(['/usr/bin/systemctl', '--quiet', action, unit], 40)

    def command_inputs(self, action, unit):
        # Review is not authority to act on a later replacement definition.
        # These static guards run immediately before every fixed command.
        state = self.state(unit)
        path = '/etc/systemd/system/' + unit
        if (state.get('Id') != unit or state.get('FragmentPath') != path
                or state.get('DropInPaths') or state.get('Job') not in {'', '0'}):
            fail('fresh_owned_static_inputs_required_before_service_command')
        if unit == SOURCE:
            self.source(True)
            binding = document(BASE / 'switch-review.json')['binding']
            if self.source_inputs() != binding['sourceInputs']:
                fail('original_source_inputs_required_before_service_command')
        else:
            env = protected(ENV)
            canonical = env.replace(('BOOSTER_DATABASE_SCHEMA=' + TARGET + '\n').encode(),
                                    ('BOOSTER_DATABASE_SCHEMA=' + OLD + '\n').encode())
            if sha(canonical) != ENV_SHA:
                fail('exact_owned_feature_environment_required_before_command')
            for name, pin in self.policy.QUEUE_INPUTS.items():
                if name != str(ENV) and sha(protected(name)) != pin:
                    fail('fixed_queue_inputs_required_before_service_command')
            if unit == API:
                receipt = document(self.runtime.RECEIPT, self.policy.RECEIPT_SHA)
                if sha(protected(path)) != receipt['unitSha256'] or sha(protected(self.admission.BUNDLE)) != self.admission.BUNDLE_SHA:
                    fail('fixed_API_inputs_required_before_service_command')
            if unit in {API, QUEUE} and (state.get('User') != ROLE or state.get('Group') != ROLE):
                fail('fixed_feature_peer_identity_required_before_command')
            if unit == TIMER and state.get('Triggers') != QUEUE:
                fail('fixed_timer_trigger_required_before_command')
        latest = self.state(unit)
        if any(latest.get(key) != state.get(key) for key in ('Id', 'FragmentPath', 'DropInPaths', 'User', 'Group')) or latest.get('Job') not in {'', '0'}:
            fail('static_service_binding_changed_before_command')
        if action == 'start' and (latest.get('ActiveState') not in {'inactive', 'failed'} or latest.get('MainPID') != '0'):
            fail('fresh_service_start_refuses_already_active_replacement')

    def mono(self):
        return time.monotonic_ns() // 1000

    def feature(self, expected_env):
        actual_env = protected(ENV)
        if actual_env != expected_env:
            fail('exact_owned_feature_environment_required')
        raw = protected(self.runtime.RECEIPT)
        receipt = json.loads(raw)
        api = self.admission.api_binding()
        queue = {name: sha(protected(name)) for name in self.policy.QUEUE_INPUTS}
        self.policy.validate_owned_feature(raw, self.admission.capture(), api, queue, self.admission)
        state = self.state(API)
        if any(state.get(key) != api.get(key) for key in ('InvocationID', 'MainPID', 'ControlGroup', 'ExecMainStartTimestampMonotonic')):
            fail('fresh_owned_API_process_binding_required')
        self.actor(API)
        queue_state = self.state(QUEUE)
        if queue_state.get('MainPID') not in {'', '0'}:
            self.actor(QUEUE)
        if self.admission.api_binding() != api:
            fail('API_binding_changed_during_feature_observation')
        return {'api': api, 'queueInputs': queue, 'timer': self.state(TIMER), 'queue': self.state(QUEUE),
                'admissionReceiptSha256': sha(raw)}

    def actor(self, unit):
        state = self.state(unit)
        if state.get('MainPID') == '0':
            return state
        if state.get('ControlGroup') != '/system.slice/' + unit or state.get('User') != ROLE or state.get('Group') != ROLE or state.get('DropInPaths'):
            fail('fixed_locked_feature_cgroup_required')
        ids = {int(v) for v in Path('/sys/fs/cgroup' + state['ControlGroup'] + '/cgroup.procs').read_text().split()}
        if int(state['MainPID']) not in ids or len(ids) > 64:
            fail('bounded_owned_feature_processes_required')
        for pid in ids:
            status = dict(line.split(':', 1) for line in (Path('/proc') / str(pid) / 'status').read_text().splitlines() if ':' in line)
            self.runtime.validate_process_status(status)
        return state

    def source(self, terminal=False):
        state = self.state(SOURCE)
        if sha(protected('/etc/systemd/system/' + SOURCE)) != SOURCE_SHA or state.get('FragmentPath') != '/etc/systemd/system/' + SOURCE or state.get('DropInPaths') or state.get('User') != 'yunipals_unified_shadow' or state.get('Group') != 'yunipals_unified_shadow':
            fail('unchanged_owned_temporary_source_required')
        if not terminal and (state.get('ActiveState') != 'active' or state.get('SubState') != 'running' or not re.fullmatch('[0-9a-f]{32}', state.get('InvocationID', '')) or not state.get('MainPID', '').isdigit() or int(state['MainPID']) < 1):
            fail('old_source_must_stay_live_until_new_event_proof')
        return state

    def parity_proof(self, path, pin):
        report = document(path, pin)
        if report.get('format') != 'yunipals-booster-common-boundary-parity-v2' or report.get('passed') is not True or self.parity.assess(report['snapshot'], report['canonicalHeader']) != report:
            fail('actual_complete_booster_parity_report_required')
        header = self.parity.header_witness(report['canonicalHeader'])
        if not 0 <= time.time() - header['observedAtUnix'] <= 180:
            fail('fresh_external_parity_header_required')
        # Recompute current state/tails at the same witnessed boundary. No RPC.
        current = self.parity.assess(self.parity.query(self.parity.snapshot_sql(boundary=header['number'])), report['canonicalHeader'])
        if current.get('passed') is not True:
            fail('current_same_boundary_booster_parity_required')
        return {'reportSha256': pin, 'boundary': header['number'], 'headerHash': header['hash']}

    def acknowledge_eight_reads(self, a, installer, artifact_file, artifact_sha, resume_grants_ack=None):
        # The original Guard and every other graph/process check stay intact.
        # Only this freshly loaded instance may recognize our exact eight reads.
        result_exists = os.path.lexists(BASE / 'grants-result.json')
        if not result_exists and resume_grants_ack is None:
            return None
        review = document(BASE / 'grants-review.json'); binding = eight_read_review(review)
        validate_snapshot(binding['before'], self.graph, False)
        validate_snapshot(binding['after'], self.graph, True)
        if protected(BASE / 'grants-rehearsal.sql') != grant_sql(binding['before'], binding['after']).encode():
            fail('owned_eight_read_rehearsal_bytes_changed')
        inputs = document(BASE / 'grants-inputs.json')
        if inputs != eight_read_inputs(review, artifact_file, artifact_sha, inputs['consumerAdmissions'], inputs['bootId']):
            fail('owned_eight_read_inputs_or_artifact_changed')
        if inputs['reviewFileSha256'] != sha(protected(BASE / 'grants-review.json')):
            fail('exact_protected_eight_read_review_file_required')
        for proof in inputs['consumerAdmissions']:
            if sha(protected(installer.BASE / proof['role'] / 'result.json')) != proof['resultSha256']:
                fail('same_four_protected_consumer_receipts_required')
        inputs_sha = sha(protected(BASE / 'grants-inputs.json'))
        intent = document(BASE / 'grants-intent.json'); ack = document(BASE / 'grants-ack.json')
        ack_sha = sha(protected(BASE / 'grants-ack.json'))
        if (intent.get('action') != 'grants' or intent.get('bootId') != inputs['bootId']
                or intent.get('grantsInputSha256') != inputs_sha
                or ack.get('completed') is not True or type(ack.get('reconciled')) is not bool
                or ack.get('intentSha256') != sha(protected(BASE / 'grants-intent.json'))
                or ack.get('result') != {'snapshotSha256': inputs['afterSha256']}):
            fail('exact_owned_committed_grants_step_required')
        if result_exists:
            result = document(BASE / 'grants-result.json')
            expected = {key: inputs[key] for key in ('operatorSha256', 'reviewHash', 'reviewFileSha256',
                'beforeSha256', 'afterSha256', 'transactionSha256', 'artifactFile', 'artifactSha256', 'consumerAdmissions')}
            expected.update(format=binding['format'], committed=True, inputsSha256=inputs_sha,
                grantsAckSha256=ack_sha, reconciled=ack['reconciled'], eightSelectsOnly=True,
                loginChanged=False, oldTenReadsPreserved=True)
            if result != expected or resume_grants_ack is not None:
                fail('exact_own_committed_eight_read_result_required')
        elif (resume_grants_ack != ack_sha
                or inputs['bootId'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip()):
            fail('explicit_same_boot_owned_grants_ack_required_before_resume')
        if self.snapshot(True) != binding['after']:
            fail('current_exact_owned_eight_read_after_graph_required')
        additions = {TARGET + '.' + name for name in ADDITIONS}
        guard = a.owned_booster
        if type(guard.allowed_relations) is not set or guard.allowed_relations & additions:
            fail('fresh_original_owned_guard_instance_required')
        guard.allowed_relations = guard.allowed_relations | additions
        return inputs['consumerAdmissions']

    def consumers(self, artifact_file, artifact_sha, resume_grants_ack=None):
        installer = load('consumer-operational-live-booster-v1.py').core('install')
        a, p, old, owner, helper, frozen, scope = installer.modules(artifact_file, artifact_sha)
        admitted = self.acknowledge_eight_reads(a, installer, artifact_file, artifact_sha, resume_grants_ack)
        proofs = []
        for kind, unit in installer.SERVICES.items():
            role = next(row['role'] for row in scope['units'] if row['unit'] == unit)
            proof = installer.installed_other(a, helper, unit, role, a.ROLES[role])
            if not proof.get('resultSha256'):
                fail('all_four_actual_final_consumer_admissions_required')
            result_path = installer.BASE / role / 'result.json'
            result = a.document(result_path, proof['resultSha256'])
            reviewed = a.document(result_path.parent / 'review.json', result['reviewFileSha256'])
            installer.verify_installed(a, helper, old, owner, reviewed['binding'], result['invocation'])
            proofs.append(proof)
        if admitted is not None and proofs != admitted:
            fail('same_four_consumer_admissions_required_after_eight_reads')
        return proofs

    def request(self, path, public=False, binary=False):
        if not path.startswith('/v1/') and path != '/readyz':
            fail('fixed_readonly_feature_route_required')
        url = (PUBLIC if public else 'http://127.0.0.1:9030') + path
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs): fail('feature_probe_redirect_forbidden')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' if binary else 'application/json', 'Origin': 'https://app.yunipals.com', 'Referer': 'https://app.yunipals.com/'})
        with opener.open(req, timeout=12) as response:
            raw = response.read(16000001 if binary else 1000001)
            if response.status != 200 or len(raw) > (16000000 if binary else 1000000):
                fail('bounded_positive_feature_response_required')
            proof = {'path': path, 'public': public, 'status': 200, 'sha256': sha(raw), 'cacheControl': response.headers.get('Cache-Control'), 'cors': response.headers.get('Access-Control-Allow-Origin')}
            return proof, raw if binary else json.loads(raw)

    def availability(self, boundary, build):
        deadline=time.monotonic()+20
        while True:
            try:
                return load('booster-current-api-checks-v1.py').availability(self.request,boundary,build)
            except (OSError,RuntimeError):
                if time.monotonic()>=deadline:raise
                time.sleep(0.25)

    def queue_proof(self, start_us, boundary):
        raw = self.run(['/usr/bin/journalctl', '--unit=' + QUEUE, '--boot=0', '--no-pager', '--output=json', '--since=-3min'], 10)
        rows = [json.loads(line) for line in raw.splitlines() if line]
        if self.state(QUEUE).get('Result') != 'success':
            fail('queue_success_required')
        return queue_completion(rows, start_us, boundary)

    def queue_live(self):
        self.runtime.validate_timer_state(self.state(TIMER))
        return True

    def activation_paths(self):
        result = []
        for directory in ('/etc/systemd/system', '/run/systemd/system'):
            for path in Path(directory).glob('*/*'):
                if path.name == SOURCE or (path.is_symlink() and path.resolve(strict=False) == Path('/etc/systemd/system') / SOURCE):
                    result.append(str(path))
        return sorted(result)

    def fresh_event(self, event, boundary):
        if set(event) != {'blockNumber', 'blockHash', 'transactionHash', 'logIndex'} or type(event['blockNumber']) is not int or event['blockNumber'] <= boundary or type(event['logIndex']) is not int or event['logIndex'] < 0 or any(not re.fullmatch('0x[0-9a-f]{64}', str(event[key])) for key in ('blockHash', 'transactionHash')):
            fail('genuine_post_switch_event_identity_required')
        where = 'block_number=' + str(event['blockNumber']) + ' AND block_hash=' + quote(event['blockHash']) + ' AND transaction_hash=' + quote(event['transactionHash']) + ' AND log_index=' + str(event['logIndex'])
        result = self.query("SELECT jsonb_build_object('left',(SELECT count(*)FROM " + OLD + '.booster_event WHERE ' + where + "),'right',(SELECT count(*)FROM " + TARGET + '.booster_event WHERE ' + where + "),'header',(SELECT block_hash FROM " + TARGET + '.chain_block WHERE chain_id=8453 AND block_number=' + str(event['blockNumber']) + "),'checkpoint',(SELECT latest_checkpoint FROM " + TARGET + '._ponder_checkpoint WHERE chain_id=8453))')
        if result['left'] != 1 or result['right'] != 1 or result['header'] != event['blockHash'] or (self.parity.complete_block(result['checkpoint']) or -1) < event['blockNumber']:
            fail('actual_unique_post_switch_event_and_native_header_required')
        return event

    def native_ready(self, schema, build, boundary):
        if schema not in {OLD, TARGET}:
            fail('fixed_native_source_required')
        value = self.query("SELECT jsonb_build_object('app',(SELECT value FROM " + schema + "._ponder_meta WHERE key='app'),'checkpoint',(SELECT latest_checkpoint FROM " + schema + '._ponder_checkpoint WHERE chain_id=8453))')
        app, checkpoint = value.get('app') or {}, value.get('checkpoint')
        if (app.get('build_id') != build or str(app.get('is_ready')) != '1' or str(app.get('is_locked')) != '1'
                or str(app.get('is_dev')) != '0' or str(app.get('version')) != '6'
                or not 0 <= time.time() - int(app.get('heartbeat_at', 0)) / 1000 <= 180
                or (self.parity.complete_block(checkpoint) or -1) < boundary
                or not 0 <= time.time() - int(checkpoint[:10]) <= 180):
            fail('fresh_complete_native_source_required')
        return {'buildId': build, 'completeBlock': self.parity.complete_block(checkpoint)}

    def source_inputs(self):
        state = self.source(True)
        command = re.findall(r'argv\[\]=(.*?)\s+;', state.get('ExecStart', ''))
        if len(command) != 1:
            fail('exact_source_argv_required')
        argv = command[0].split()
        # Preceding source paths come only from the exact original unit SHA.
        if argv[:3] != ['/usr/bin/env', '-i', '/opt/node-v24.18.1/bin/node'] or argv[-6:] != ['--schema', OLD, '--hostname', '127.0.0.1', '--port', '9026']:
            fail('exact_original_source_command_required')
        envs = [arg[len('--env-file='):] for arg in argv if arg.startswith('--env-file=')]
        if len(envs) != 2:
            fail('two_exact_original_source_env_files_required')
        return {'argvSha256': sha(encode(argv[2:])), 'environmentFiles': {path: sha(protected(path)) for path in envs},
                'nodeSha256': sha(protected(argv[2], 150000000)), 'workingDirectory': state['WorkingDirectory']}

    def source_runtime(self, expected_inputs, boundary):
        state = self.source()
        if state.get('UnitFileState') != 'enabled' or self.source_inputs() != expected_inputs:
            fail('restored_original_source_inputs_and_enablement_required')
        if expected_inputs['nodeSha256'] != 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a':
            fail('pinned_original_Node_binary_required')
        group = '/system.slice/' + SOURCE
        if state.get('ControlGroup') != group:
            fail('exact_restored_source_cgroup_required')
        ids = {int(v) for v in Path('/sys/fs/cgroup' + group + '/cgroup.procs').read_text().split()}
        if int(state['MainPID']) not in ids or not 1 <= len(ids) <= 2:
            fail('one_source_Node_and_at_most_one_pinned_esbuild_required')
        actual = set(); node_ids = set(); children = []; peer_proofs = {}
        for directory in Path('/proc').iterdir():
            if not directory.name.isdigit(): continue
            try:
                status = dict(line.split(':', 1) for line in (directory / 'status').read_text().splitlines() if ':' in line)
                if int(status['Uid'].split()[0]) != 970: continue
                pid = int(directory.name); actual.add(pid)
                if pid not in ids:
                    fail('only_owned_locked_source_UID_processes_allowed')
                validate_source_status(status)
                peer = self.peer_process_properties(pid); peer_proofs[pid] = peer
                if peer['nodeExecutable']: node_ids.add(pid)
                elif peer['esbuildExecutable']:
                    child_argv = [arg.decode() for arg in (directory / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')]
                    child = validate_esbuild_child(ESBUILD, protected(ESBUILD, 150000000), child_argv,
                        int(status['PPid']), int(state['MainPID']))
                    children.append({'pid': pid, **child})
                else:
                    fail('only_pinned_source_Node_or_esbuild_executable_required')
            except (FileNotFoundError, ProcessLookupError):
                if int(directory.name) in ids:
                    fail('source_inventory_changed_during_observation')
        pid = int(state['MainPID'])
        if actual != ids or node_ids != {pid}:
            fail('complete_UID970_inventory_with_exactly_one_owned_Node_required')
        if not peer_proofs[pid]['nodeExecutable']:
            fail('actual_source_executable_must_be_pinned_Node')
        argv = (Path('/proc') / str(pid) / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
        if sha(encode([arg.decode() for arg in argv])) != expected_inputs['argvSha256']:
            fail('actual_restored_source_argv_changed')
        native = self.native_ready(OLD, '6d581272ce', boundary)
        sessions = self.query("SELECT jsonb_build_object('n',count(*))FROM pg_stat_activity WHERE usename='yunipals_unified_shadow'")['n']
        if type(sessions) is not int or not 0 <= sessions <= 5:
            fail('bounded_restored_source_role_sessions_required')
        if self.source()['InvocationID'] != state['InvocationID']:
            fail('source_process_changed_during_inverse_validation')
        for actor_pid, proof in peer_proofs.items():
            if self.peer_process_properties(actor_pid) != proof:
                fail('source_peer_identity_changed_during_inverse_validation')
        return {'unit': SOURCE, 'invocation': state['InvocationID'], 'pid': pid, 'uid': 970, 'gid': 964,
                'cgroup': group, 'actorPids': sorted(actual), 'completeUidInventory': True,
                'allowedChildProofs': children,
                'peerProcessProofs': [{'pid': actor_pid, **proof} for actor_pid, proof in sorted(peer_proofs.items())],
                'capabilityPolicy': {'inheritableSha256': SOURCE_CAPINH_SHA, 'boundingSha256': SOURCE_CAPBND_SHA,
                                     'permittedZero': True, 'effectiveZero': True, 'ambientZero': True, 'noNewPrivileges': True},
                'schema': OLD, 'buildId': native['buildId'], 'nativeLocked': True, 'nativeReady': True,
                'completeBlock': native['completeBlock'], 'sourceRoleSessions': sessions, 'inputs': expected_inputs}

    def peer_process_properties(self, pid):
        if type(pid) is not int or not 0 < pid < 2 ** 31:
            fail('fixed_source_peer_pid_required')
        value = json.loads(self.run(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--no-new-privs',
            '--inh-caps=-all', '--ambient-caps=-all', '/usr/bin/python3', '-I', '-B', '-c', PEER_PROC_CODE, str(pid)], 5))
        if (set(value) != {'startTicks', 'nodeExecutable', 'esbuildExecutable'}
                or type(value['startTicks']) is not int or value['startTicks'] <= 0
                or any(type(value[key]) is not bool for key in ('nodeExecutable', 'esbuildExecutable'))
                or value['nodeExecutable'] == value['esbuildExecutable']):
            fail('fixed_executable_only_peer_properties_required')
        return value

    def shared_quiet(self):
        states = {}
        for unit in (SHARED, COMBINED):
            state = self.state(unit)
            if state.get('ActiveState') not in {'inactive', 'failed'} or state.get('MainPID') != '0' or state.get('Job') not in {'', '0'}:
                fail('coordinated_shared_and_combined_quiesce_required_before_feature_inverse')
            group = '/system.slice/' + unit
            if state.get('ControlGroup') not in {'', group}:
                fail('foreign_quiet_source_cgroup')
            path = Path('/sys/fs/cgroup' + group + '/cgroup.procs')
            if path.exists() and path.read_text().strip():
                fail('shared_and_combined_cgroups_must_be_empty')
            states[unit] = {'terminal': True, 'pid': 0}
        app = self.query('SELECT value FROM ' + TARGET + "._ponder_meta WHERE key='app'")
        if str((app or {}).get('is_locked')) != '0':
            fail('combined_native_app_must_be_unlocked_before_booster_revival')
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            connection.settimeout(0.3)
            if connection.connect_ex(('127.0.0.1', 9024)) != errno.ECONNREFUSED:
                fail('combined_port_9024_must_be_closed')
        return {'states': states, 'combinedUnlocked': True, 'port9024Closed': True}


class Owner:
    """Small persistent action journal. A lost acknowledgement never starts twice."""
    def __init__(self, host, base=None):
        self.h, self.base = host, Path(BASE if base is None else base)

    def initialize(self):
        if not self.base.exists():
            self.base.mkdir(mode=0o700)
        info = self.base.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            fail('private_owned_handover_directory_required')

    def read(self, name):
        return document(self.base / name)

    def put(self, name, value):
        raw = value if isinstance(value, bytes) else encode(value)
        with (self.base / name).open('xb') as output:
            os.fchmod(output.fileno(), 0o600); output.write(raw); output.flush(); os.fsync(output.fileno())
        descriptor = os.open(self.base, os.O_RDONLY | os.O_DIRECTORY)
        os.fsync(descriptor); os.close(descriptor)
        return sha(raw)

    def exists(self, name):
        return os.path.lexists(self.base / name)

    def step(self, name, operation, observe, resume=False, grants_input_sha=None):
        intent_name, ack_name = name + '-intent.json', name + '-ack.json'
        if grants_input_sha is not None and (name != 'grants' or not re.fullmatch('[0-9a-f]{64}', grants_input_sha)):
            fail('fixed_owned_grants_input_binding_required')
        if self.exists(intent_name) and grants_input_sha is not None and self.read(intent_name).get('grantsInputSha256') != grants_input_sha:
            fail('exact_pre_sql_grants_input_binding_required')
        if self.exists(intent_name) and self.read(intent_name)['bootId'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
            fail('cross_boot_partial_action_requires_fresh_owned_reconciliation')
        if self.exists(ack_name):
            return self.read(ack_name)
        if self.exists(intent_name):
            if not resume:
                fail('partial_ack_requires_explicit_reconcile_then_resume')
            intent = self.read(intent_name)
            # Observation must prove completion. Do not repeat a possibly
            # successful service command or SQL transaction after lost ACK.
            result = observe(intent)
            ack = {'completed': True, 'reconciled': True, 'intentSha256': sha(protected(self.base / intent_name)), 'result': result}
        else:
            intent = {'action': name, 'monotonicUs': self.h.mono(), 'atUnix': time.time(),
                      'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
            if grants_input_sha is not None: intent['grantsInputSha256'] = grants_input_sha
            self.put(intent_name, intent)
            operation()
            result = observe(intent)
            ack = {'completed': True, 'reconciled': False, 'intentSha256': sha(protected(self.base / intent_name)), 'result': result}
        self.put(ack_name, ack)
        return ack

    def grant_rehearsal(self):
        self.initialize()
        if self.exists('grants-review.json') or self.exists('grants-intent.json'):
            fail('reconcile_existing_grant_attempt_before_rehearsal')
        before = self.h.snapshot(False)
        self.h.feature(protected(ENV))
        if sha(protected(ENV)) != ENV_SHA:
            fail('original_feature_environment_required_for_rehearsal')
        after = after_eight_reads(before)
        text = grant_sql(before, after)
        self.put('grants-rehearsal.sql', text.encode())
        self.h.sql(text)
        if self.h.snapshot(False) != before:
            fail('eight_read_rehearsal_must_restore_exact_before_graph')
        binding = {'format': 'yunipals-booster-eight-read-admission-v2', 'operatorSha256': sha(protected(__file__)),
                   'before': before, 'after': after, 'rehearsalSqlSha256': sha(text.encode()),
                   'additions': list(ADDITIONS), 'loginChanged': False, 'writesGranted': False}
        value = {'binding': binding, 'reviewHash': sha(encode(binding)), 'actualRollbackRehearsed': True}
        pin = self.put('grants-review.json', value)
        return {'reviewHash': value['reviewHash'], 'reviewFileSha256': pin, 'actualRollbackRehearsed': True, 'eightSelectsOnly': True}

    def grant_commit(self, expected, artifact_file, artifact_sha, resume=False):
        review = self.read('grants-review.json'); binding = eight_read_review(review)
        self.h.native_ready(TARGET, 'bf4939b3ff', 52848542)
        if expected != review['reviewHash']:
            fail('exact_actual_rollback_review_required_before_eight_grants')
        if self.exists('grants-result.json'):
            fail('eight_grant_result_already_recorded')
        before, after = binding['before'], binding['after']
        text = grant_sql(before, after, True)
        if self.exists('grants-intent.json'):
            if not resume:
                fail('explicit_owned_grants_resume_required')
            inputs = self.read('grants-inputs.json')
            if inputs != eight_read_inputs(review, artifact_file, artifact_sha,
                    inputs['consumerAdmissions'], Path('/proc/sys/kernel/random/boot_id').read_text().strip()):
                fail('exact_same_boot_pre_sql_grants_inputs_required')
            inputs_sha = sha(protected(self.base / 'grants-inputs.json'))
            # Existing step.observe confirms the exact after graph. It never
            # reissues SQL when a same-boot intent already exists.
            ack = self.step('grants', lambda: fail('existing_grants_intent_may_not_reissue_SQL'),
                lambda intent: self._exact_snapshot(after, True), True, inputs_sha)
            self._exact_snapshot(after, True)
            consumers = self.h.consumers(artifact_file, artifact_sha,
                resume_grants_ack=sha(protected(self.base / 'grants-ack.json')))
            if consumers != inputs['consumerAdmissions']:
                fail('same_four_admissions_required_for_grants_resume')
        else:
            consumers = self.h.consumers(artifact_file, artifact_sha)
            if len(consumers) != 4 or any(not proof.get('resultSha256') for proof in consumers):
                fail('all_four_final_admissions_must_precede_eight_read_commit')
            if self.h.snapshot(False) != before:
                fail('reviewed_before_graph_changed')
            inputs = eight_read_inputs(review, artifact_file, artifact_sha, consumers,
                Path('/proc/sys/kernel/random/boot_id').read_text().strip())
            if self.exists('grants-inputs.json'):
                if not resume or self.read('grants-inputs.json') != inputs:
                    fail('exact_owned_pre_sql_inputs_resume_required')
            else:
                self.put('grants-inputs.json', inputs)
            inputs_sha = sha(protected(self.base / 'grants-inputs.json'))
            ack = self.step('grants', lambda: self.h.sql(text),
                lambda intent: self._exact_snapshot(after, True), resume, inputs_sha)
        value = {key: inputs[key] for key in ('operatorSha256', 'reviewHash', 'reviewFileSha256',
            'beforeSha256', 'afterSha256', 'transactionSha256', 'artifactFile', 'artifactSha256', 'consumerAdmissions')}
        value.update(format=binding['format'], committed=True, inputsSha256=inputs_sha,
            grantsAckSha256=sha(protected(self.base / 'grants-ack.json')), reconciled=ack['reconciled'],
            eightSelectsOnly=True, loginChanged=False, oldTenReadsPreserved=True)
        pin = self.put('grants-result.json', value)
        return {**value, 'receiptSha256': pin}

    def _exact_snapshot(self, expected, admitted):
        current = self.h.snapshot(admitted)
        if current != expected:
            fail('only_exact_owned_read_delta_allowed')
        return {'snapshotSha256': sha(encode(current))}

    def envs(self):
        old = protected(self.base / 'original-feature.env')
        return old, replace_schema(old)

    def grants(self):
        result = self.read('grants-result.json'); review = self.read('grants-review.json')
        if result.get('committed') is not True or result.get('reviewHash') != review['reviewHash'] or sha(encode(review['binding'])) != review['reviewHash'] or result.get('afterSha256') != sha(encode(review['binding']['after'])):
            fail('owned_committed_eight_read_receipt_required')
        self._exact_snapshot(review['binding']['after'], True)
        return sha(protected(self.base / 'grants-result.json'))

    def switch_review(self, parity_file, parity_sha, artifact_file, artifact_sha):
        grant_sha = self.grants()
        env = protected(ENV); target = replace_schema(env)
        feature = self.h.feature(env); source = self.h.source()
        timer = feature['timer']
        if timer.get('ActiveState') != 'active' or timer.get('UnitFileState') != 'enabled':
            fail('existing_queue_schedule_must_be_preserved')
        self.h.queue_live()
        parity = self.h.parity_proof(parity_file, parity_sha)
        consumers = self.h.consumers(artifact_file, artifact_sha)
        self.h.availability(parity['boundary'], '6d581272ce')
        binding = {'format': 'yunipals-booster-reader-handover-v1', 'operatorSha256': sha(protected(__file__)),
                   'parity': parity, 'parityFile': str(parity_file), 'artifactFile': str(artifact_file), 'artifactSha256': artifact_sha,
                   'consumerAdmissions': consumers, 'grantsReceiptSha256': grant_sha, 'beforeApi': feature['api'],
                   'queueInputs': feature['queueInputs'], 'source': source, 'beforeEnvironmentSha256': sha(env), 'currentFeature': load('consumer-operational-live-booster-v1.py').proof(),
                   'sourceInputs': self.h.source_inputs(),
                   'afterEnvironmentSha256': sha(target), 'schema': TARGET, 'switchBoundary': parity['boundary']}
        return {'binding': binding, 'reviewHash': sha(encode(binding))}

    def atomic_env(self, expected, replacement):
        if protected(ENV) != expected:
            fail('exact_environment_CAS_required')
        temporary = ENV.with_name('booster-api.env.handover-' + sha(replacement)[:16])
        with temporary.open('xb') as output:
            os.fchmod(output.fileno(), 0o600); output.write(replacement); output.flush(); os.fsync(output.fileno())
        if protected(ENV) != expected:
            fail('environment_changed_before_atomic_replace')
        os.replace(temporary, ENV)
        descriptor = os.open(ENV.parent, os.O_RDONLY | os.O_DIRECTORY)
        os.fsync(descriptor); os.close(descriptor)

    def stop_actor(self, name, unit, prior, pin, resume):
        marker = name + '-command-issued.json'
        def operation():
            current = self.h.state(unit)
            if sha(protected('/etc/systemd/system/' + unit)) != pin or any(current.get(key) != prior.get(key) for key in ('Id', 'User', 'Group', 'FragmentPath')) or current.get('DropInPaths'):
                fail('fresh_owned_static_unit_required_before_stop')
            if current.get('ActiveState') in {'inactive', 'failed'}:
                if unit != QUEUE:
                    fail('unattempted_stop_of_terminal_actor_requires_reconcile')
                natural = self.h.queue_proof(int(prior.get('ExecMainStartTimestampMonotonic') or 0), 0)
                if prior.get('InvocationID') and natural['invocation'] != prior['InvocationID']:
                    fail('natural_queue_completion_must_match_recorded_invocation')
                self.put(marker, {'naturalQueueCompletion': natural, 'prior': prior, 'unitSha256': pin})
                return
            identity = ('InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic')
            if current.get('ActiveState') not in {'active', 'activating'} or any(current.get(key) != prior.get(key) for key in identity) or current.get('Job') not in {'', '0'}:
                fail('fresh_exact_process_identity_required_before_stop')
            if unit in {API, QUEUE}: self.h.actor(unit)
            latest = self.h.state(unit)
            if any(latest.get(key) != current.get(key) for key in (*identity, 'ActiveState', 'Job')):
                fail('owned_actor_changed_immediately_before_stop')
            self.put(marker, {'prior': current, 'unitSha256': pin, 'command': 'stop'})
            self.h.command('stop', unit, current)
        def observe(intent):
            if not self.exists(marker):
                # A queue can finish naturally between the two pre-stop reads.
                # No command was issued; adopt only that exact trusted run.
                if unit != QUEUE:
                    fail('unattempted_stop_cannot_be_adopted_from_empty_invocation')
                self._stopped(unit, prior, pin)
                natural = self.h.queue_proof(max(intent['monotonicUs'], int(prior.get('ExecMainStartTimestampMonotonic') or 0)), 0)
                if prior.get('InvocationID') and natural['invocation'] != prior['InvocationID']:
                    fail('natural_queue_completion_must_match_recorded_invocation')
                self.put(marker, {'naturalQueueCompletion': natural, 'prior': prior, 'unitSha256': pin})
            issued = self.read(marker)
            if issued['unitSha256'] != pin or any(issued['prior'].get(key) != prior.get(key) for key in ('Id', 'InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic')):
                fail('owned_stop_command_marker_changed')
            return self._stopped(unit, prior, pin)
        return self.step(name, operation, observe, resume)

    def _stopped(self, unit, prior, pin):
        state = self.h.state(unit)
        stopped_owned(state, prior, pin, sha(protected('/etc/systemd/system/' + unit)))
        group = state.get('ControlGroup')
        if group:
            if group != '/system.slice/' + unit:
                fail('foreign_stopped_cgroup')
            path = Path('/sys/fs/cgroup' + group + '/cgroup.procs')
            if path.exists() and path.read_text().strip():
                fail('owned_actor_cgroup_must_be_empty')
        if unit in {API, QUEUE}:
            application = 'yunipals_booster_api' if unit == API else 'yunipals_booster_artwork_queue'
            sessions = self.h.query("SELECT jsonb_build_object('n',count(*))FROM pg_stat_activity WHERE usename=" + quote(ROLE) + ' AND datname=current_database() AND application_name=' + quote(application))
            if sessions.get('n') != 0:
                fail('only_owned_feature_pool_must_finish_draining')
        return {'unit': unit, 'terminal': True, 'pid': 0}

    def start_api(self, name, prior, expected_env, resume):
        def observe(intent):
            api = self.h.feature(expected_env)['api']
            if api['InvocationID'] == prior['InvocationID'] or int(api['ExecMainStartTimestampMonotonic']) < intent['monotonicUs']:
                fail('new_API_process_must_follow_owned_start_intent')
            return api
        return self.step(name, lambda: self.h.command('start', API), observe, resume)

    def run_queue(self, name, boundary, resume):
        return self.step(name, lambda: self.h.command('start', QUEUE), lambda intent: self.h.queue_proof(intent['monotonicUs'], boundary), resume)

    def timer(self, name, enabled, resume):
        def observe(intent):
            state = self.h.state(TIMER)
            if (state.get('UnitFileState') == 'enabled') is not enabled:
                fail('owned_queue_timer_enabled_state_required')
            return {'enabled': enabled}
        return self.step(name, lambda: self.h.command('enable' if enabled else 'disable', TIMER), observe, resume)

    def timer_running(self, name, running, resume):
        def observe(intent):
            state = self.h.state(TIMER)
            if (state.get('ActiveState') == 'active') is not running or state.get('Job') not in {'', '0'}:
                fail('owned_queue_timer_running_state_required')
            return {'active': running}
        return self.step(name, lambda: self.h.command('start' if running else 'stop', TIMER), observe, resume)

    def switch(self, review, expected, resume=False):
        if review['reviewHash'] != expected or sha(encode(review['binding'])) != expected:
            fail('exact_fresh_switch_review_required')
        binding = review['binding']; self.initialize()
        if not self.exists('switch-review.json'):
            self.put('switch-review.json', review)
            self.put('original-feature.env', protected(ENV))
        elif self.read('switch-review.json') != review or not resume:
            fail('owned_partial_switch_requires_explicit_resume')
        if not self.exists('original-feature.env'):
            if any(self.base.glob('switch-*-intent.json')) or sha(protected(ENV)) != binding['beforeEnvironmentSha256']:
                fail('missing_original_environment_requires_reconcile')
            self.put('original-feature.env', protected(ENV))
        old, target = self.envs()
        self.grants()
        # Freshness authorizes the first service action. Later same-boot
        # reconciliation uses the owned action journal, rather than requiring
        # an expired initial witness after a successful but unacknowledged stop.
        if not self.exists('switch-timer-stop-intent.json'):
            current_parity = self.h.parity_proof(binding['parityFile'], binding['parity']['reportSha256'])
            if current_parity != binding['parity']:
                fail('same_fresh_pre_action_parity_required')
            if not self.exists('switch-pre-action-parity.json'):
                self.put('switch-pre-action-parity.json', {'reviewHash': expected, 'parity': current_parity})
        if self.read('switch-pre-action-parity.json') != {'reviewHash': expected, 'parity': binding['parity']}:
            fail('actual_owned_pre_action_parity_required')
        self.h.source()
        self.timer_running('switch-timer-stop', False, resume)
        queue_prior = {**binding['beforeApi'], **self.h.state(QUEUE)}
        self.stop_actor('switch-queue-stop', QUEUE, queue_prior, self.h.policy.QUEUE_INPUTS['/etc/systemd/system/' + QUEUE], resume)
        self.stop_actor('switch-api-stop', API, binding['beforeApi'], binding['beforeApi']['definitionSha256'], resume)
        self.step('switch-environment', lambda: self.atomic_env(old, target),
            lambda intent: {'sha256': self._environment(target)}, resume)
        started = self.start_api('switch-api-start', binding['beforeApi'], target, resume)['result']
        proof = self.h.availability(binding['switchBoundary'], 'bf4939b3ff')
        queue = self.run_queue('switch-queue-start', binding['switchBoundary'], resume)['result']
        self.timer('switch-timer-enable', True, resume)
        self.timer_running('switch-timer-start', True, resume)
        self.h.queue_live()
        self.h.source()  # deliberately retained until a genuinely newer event
        final_feature = self.h.feature(target)
        result = {'format': binding['format'], 'switched': True, 'reviewHash': expected,
                  'schema': TARGET, 'switchBoundary': binding['switchBoundary'], 'parity': binding['parity'],
                  'apiInvocation': final_feature['api']['InvocationID'], 'queueEnabled': True, 'publicReady': True,
                  'availability': proof, 'queueProof': queue, 'oldSourceRetired': False,
                  'oldSchemaAndTenReadsPreserved': True, 'nativeReadDelta': 8, 'currentFeature': binding['currentFeature'], 'environmentSha256': sha(target),
                  'consumerAdmissions': binding['consumerAdmissions'], 'grantsReceiptSha256': binding['grantsReceiptSha256']}
        pin = self.put('switch-result.json', result)
        return {**result, 'receiptSha256': pin}

    def _environment(self, expected):
        if protected(ENV) != expected:
            fail('owned_environment_replacement_not_acknowledged')
        return sha(expected)

    def retirement_review(self, parity_file, parity_sha, event):
        switched = self.read('switch-result.json')
        if switched.get('switched') is not True or switched.get('schema') != TARGET:
            fail('actual_owned_reader_handover_required')
        _, target = self.envs(); feature = self.h.feature(target); source = self.h.source()
        if self.h.source_inputs() != self.read('switch-review.json')['binding']['sourceInputs']:
            fail('temporary_source_inputs_changed_since_owned_switch')
        parity = self.h.parity_proof(parity_file, parity_sha)
        fresh = self.h.fresh_event(event, switched['switchBoundary'])
        if parity['boundary'] < fresh['blockNumber']:
            fail('post_event_complete_state_parity_required')
        self.grants()
        binding = {'parity': parity, 'parityFile': str(parity_file), 'freshEvent': fresh,
                   'readerHandoverSha256': sha(protected(self.base / 'switch-result.json')),
                   'readerHandover': switched, 'api': feature['api'], 'source': source,
                   'activationPaths': self.h.activation_paths(), 'operatorSha256': sha(protected(__file__))}
        # Do not stop other activation actors. Only the original boot enablement
        # may exist; disable removes every symlink of this exact owned service.
        if source.get('TriggeredBy') or source.get('RequiredBy') or source.get('UpheldBy') or source.get('WantedBy') not in {'', 'multi-user.target'}:
            fail('unexpected_source_activation_path_requires_separate_review')
        return {'binding': binding, 'reviewHash': sha(encode(binding))}

    def retire(self, review, expected, resume=False):
        if review['reviewHash'] != expected or sha(encode(review['binding'])) != expected:
            fail('exact_fresh_retirement_review_required')
        binding = review['binding']
        if not self.exists('retirement-review.json'):
            self.put('retirement-review.json', review)
        elif self.read('retirement-review.json') != review or not resume:
            fail('partial_retirement_requires_explicit_reconcile_then_resume')
        _, target = self.envs()
        current_api = self.h.feature(target)['api']
        if current_api != binding['api']:
            fail('reviewed_target_API_identity_changed')
        self.h.fresh_event(binding['freshEvent'], binding['readerHandover']['switchBoundary'])
        if not self.exists('retirement-source-stop-intent.json'):
            self.h.parity_proof(binding['parityFile'], binding['parity']['reportSha256'])
            if self.h.source() != binding['source']:
                fail('reviewed_source_invocation_changed')
        self.stop_actor('retirement-source-stop', SOURCE, binding['source'], SOURCE_SHA, resume)

        def disabled(intent):
            state = self.h.source(True)
            if state.get('UnitFileState') != 'disabled' or state.get('ActiveState') not in {'inactive', 'failed'} or state.get('MainPID') != '0' or any(state.get(key) for key in ('WantedBy', 'RequiredBy', 'UpheldBy', 'TriggeredBy')) or self.h.activation_paths():
                fail('all_temporary_source_activation_paths_must_be_absent')
            return {'disabled': True, 'terminal': True, 'pid': 0, 'activationPathsAbsent': True}
        self.step('retirement-source-disable', lambda: self.h.command('disable', SOURCE), disabled, resume)
        self.grants()
        availability = self.h.availability(binding['freshEvent']['blockNumber'], 'bf4939b3ff')
        feature = self.h.feature(target)
        timer = feature['timer']
        if timer.get('UnitFileState') != 'enabled' or timer.get('ActiveState') != 'active':
            fail('live_queue_schedule_required_after_retirement')
        self.h.queue_live()
        # A scheduled queue completion after the genuine new event is required.
        queue = self.h.queue_proof(self.read('switch-queue-start-intent.json')['monotonicUs'], binding['freshEvent']['blockNumber'])
        result = {'format': 'yunipals-booster-source-retirement-v1', 'parity': binding['readerHandover']['parity'],
            'postSwitchParity': binding['parity'],
            'readerHandover': {'receiptSha256': binding['readerHandoverSha256'], 'schema': TARGET,
                'apiInvocation': feature['api']['InvocationID'], 'queueEnabled': True, 'publicReady': True,
                'switchBoundary': binding['readerHandover']['switchBoundary']},
            'freshEvent': binding['freshEvent'], 'source': {'unit': SOURCE,
                'priorInvocation': binding['source']['InvocationID'], 'terminal': True, 'pid': 0, 'enabled': False},
            'activationPathsAbsent': True, 'oldSchemaPreserved': True, 'oldTenReadsPreserved': True,
            'availability': availability, 'queueProof': queue, 'reviewHash': expected,
            'operatorSha256': sha(protected(__file__)), 'atUnix': time.time()}
        pin = self.put('retirement-result.json', result)
        return {**result, 'receiptSha256': pin}

    def reconcile(self):
        # Pure observation. A phase with intent but no ACK is never repeated.
        return {'format': 'yunipals-booster-handover-reconcile-v1',
            'phases': [{'name': path.name[:-12], 'intentSha256': sha(protected(path)),
                        'ackPresent': self.exists(path.name.replace('-intent.json', '-ack.json'))}
                       for path in sorted(self.base.glob('*-intent.json'))],
            'states': {unit: self.h.state(unit) for unit in (API, QUEUE, TIMER, SOURCE)},
            'environmentSha256': sha(protected(ENV)), 'activationPaths': self.h.activation_paths(),
            'automaticRetry': False, 'serviceActions': 0, 'databaseWrites': 0}

    def inverse_review(self):
        review = self.read('switch-review.json'); binding = review['binding']
        old, target = self.envs(); current_env = protected(ENV)
        if current_env not in (old, target):
            fail('inverse_refuses_foreign_feature_environment')
        self.grants()
        state = self.h.state(API)
        if state.get('ActiveState') == 'active':
            api = self.h.feature(current_env)['api']
        else:
            # A failed/GC'd API can be reversed only after this operator's
            # recorded stop/start intent, with unchanged static unit and env.
            if not self.exists('switch-api-stop-intent.json'):
                fail('unowned_stopped_API_cannot_be_reversed')
            api = copy.deepcopy(binding['beforeApi'])
            if self.exists('switch-api-start-ack.json'):
                api = self.read('switch-api-start-ack.json')['result']
            elif state.get('InvocationID') and state.get('InvocationID') != api['InvocationID']:
                intent = self.read('switch-api-start-intent.json')
                if int(state.get('ExecMainStartTimestampMonotonic') or 0) < intent['monotonicUs']:
                    fail('unacknowledged_API_process_not_owned_by_start_intent')
                api.update({key: state[key] for key in ('InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic')})
            self._stopped(API, api, binding['beforeApi']['definitionSha256'])
        value = {'format': 'yunipals-booster-feature-inverse-review-v1',
                 'operatorSha256': sha(protected(__file__)), 'api': api, 'source': self.h.source(True),
                 'environmentSha256': sha(current_env), 'switchReviewSha256': sha(protected(self.base / 'switch-review.json')),
                 'readerHandoverReceiptSha256': sha(protected(self.base / 'switch-result.json')) if self.exists('switch-result.json') else None,
                 'retirementReceiptSha256': sha(protected(self.base / 'retirement-result.json')) if self.exists('retirement-result.json') else None}
        return {'binding': value, 'reviewHash': sha(encode(value))}

    def inverse(self, review, expected, resume=False):
        if review['reviewHash'] != expected or sha(encode(review['binding'])) != expected:
            fail('exact_fresh_feature_inverse_review_required')
        binding = review['binding']; old, target = self.envs()
        self.h.shared_quiet()  # read-only fence; this owner never stops those units
        switched = self.read('switch-review.json')['binding']
        if self.h.source_inputs() != switched['sourceInputs']:
            fail('exact_original_source_inputs_required_before_inverse_service_actions')
        if not self.exists('inverse-review.json'):
            if self.inverse_review() != review:
                fail('feature_inverse_state_changed_after_review')
            self.put('inverse-review.json', review)
        elif self.read('inverse-review.json') != review or not resume:
            fail('partial_feature_inverse_requires_explicit_reconcile_then_resume')
        source_before = binding['source']
        if source_before.get('ActiveState') != 'active':
            retired = self.read('retirement-review.json')['binding']['source']
            if not self.exists('inverse-source-start-intent.json'):
                self._stopped(SOURCE, retired, SOURCE_SHA)

            def source_enabled(intent):
                if self.h.source(True).get('UnitFileState') != 'enabled':
                    fail('original_source_boot_enablement_must_be_restored')
                return {'enabled': True}
            self.step('inverse-source-enable', lambda: self.h.command('enable', SOURCE), source_enabled, resume)

            def source_started(intent):
                source = self.h.source()
                if source['InvocationID'] == retired['InvocationID'] or int(source.get('ExecMainStartTimestampMonotonic') or 0) < intent['monotonicUs']:
                    fail('owned_new_inverse_source_start_required')
                return source
            self.step('inverse-source-start', lambda: self.h.command('start', SOURCE), source_started, resume)
        # Restore the source and prove native catch-up before moving the API.
        minimum = switched['switchBoundary']
        if self.exists('retirement-result.json'):
            minimum = max(minimum, self.read('retirement-result.json')['freshEvent']['blockNumber'])
        for attempt in range(60):
            try:
                self.h.native_ready(OLD, '6d581272ce', minimum); break
            except RuntimeError:
                if attempt == 59: raise
                time.sleep(0.5)
        self.timer_running('inverse-timer-stop', False, resume)
        queue_prior = {**binding['api'], **self.h.state(QUEUE)}
        self.stop_actor('inverse-queue-stop', QUEUE, queue_prior, self.h.policy.QUEUE_INPUTS['/etc/systemd/system/' + QUEUE], resume)
        self.stop_actor('inverse-api-stop', API, binding['api'], switched['beforeApi']['definitionSha256'], resume)
        self.step('inverse-environment', lambda: self.atomic_env(target, old) if protected(ENV) == target else self._environment(old),
                  lambda intent: {'sha256': self._environment(old)}, resume)
        self.start_api('inverse-api-start', binding['api'], old, resume)
        availability = self.h.availability(minimum, '6d581272ce')
        grants_before = self.read('grants-review.json')['binding']
        text = grant_sql(grants_before['after'], grants_before['before'], True, True)
        self.step('inverse-eight-reads', lambda: self.h.sql(text),
                  lambda intent: self._exact_snapshot(grants_before['before'], False), resume)
        queue = self.run_queue('inverse-queue-start', minimum, resume)['result']
        self.timer('inverse-timer-enable', True, resume)
        self.timer_running('inverse-timer-start', True, resume)
        feature = self.h.feature(old); source = self.h.source()
        if source.get('UnitFileState') != 'enabled' or feature['timer'].get('UnitFileState') != 'enabled' or feature['timer'].get('ActiveState') != 'active':
            fail('restored_source_and_queue_enablement_required')
        self.h.queue_live()
        source_proof = self.h.source_runtime(switched['sourceInputs'], minimum)
        result = {'format': 'yunipals-booster-feature-inverse-v1',
            'readerHandoverReceiptSha256': binding['readerHandoverReceiptSha256'],
            'retirementReceiptSha256': binding['retirementReceiptSha256'],
            'restoredSchema': OLD, 'environmentSha256': sha(old),
            'api': {'unit': API, 'invocation': feature['api']['InvocationID'], 'pid': int(feature['api']['MainPID']),
                    'definitionSha256': feature['api']['definitionSha256'], 'environmentSha256': sha(old),
                    'bundleSha256': feature['api']['bundleSha256'], 'uid': 967, 'gid': 961},
            'queue': {'serviceUnit': QUEUE, 'timerUnit': TIMER, 'enabled': True, 'active': True,
                      'serviceSha256': self.h.policy.QUEUE_INPUTS['/etc/systemd/system/' + QUEUE],
                      'timerSha256': self.h.policy.QUEUE_INPUTS['/etc/systemd/system/' + TIMER],
                      'bundleSha256': next(pin for name, pin in self.h.policy.QUEUE_INPUTS.items() if name.endswith('booster-artwork-sync.mjs')),
                      'lastSuccess': queue},
            'source': {'unit': SOURCE, 'invocation': source['InvocationID'], 'pid': int(source['MainPID']),
                       'enabled': True, 'definitionSha256': SOURCE_SHA, 'inputs': switched['sourceInputs'], 'runtimeProof': source_proof},
            'eightReadInverse': {'restoredBeforeSha256': sha(encode(grants_before['before'])),
                                'priorTwoTargetReadsPreserved': True, 'oldTenReadsPreserved': True, 'loginPreserved': True},
            'publicReady': True, 'availability': availability, 'reviewHash': expected, 'operatorSha256': sha(protected(__file__))}
        pin = self.put('inverse-result.json', result)
        return {**result, 'receiptSha256': pin}


def validate_inverse(path, pin):
    """Read-only authoritative inverse proof for the coordinated final inverse.

    It does not relax combined/shared quietness; that remains the final owner's
    separate guard. No unit action, write, provider call or response row export.
    """
    path = Path(path)
    if path != BASE / 'inverse-result.json':
        fail('fixed_owned_feature_inverse_receipt_path_required')
    receipt = document(path, pin)
    if receipt.get('format') != 'yunipals-booster-feature-inverse-v1' or receipt.get('operatorSha256') != sha(protected(__file__)) or receipt.get('restoredSchema') != OLD or receipt.get('environmentSha256') != ENV_SHA or receipt.get('publicReady') is not True:
        fail('actual_feature_inverse_receipt_required')
    for key, name in (('readerHandoverReceiptSha256', 'switch-result.json'), ('retirementReceiptSha256', 'retirement-result.json')):
        if receipt.get(key) != sha(protected(BASE / name)):
            fail('actual_feature_handover_and_retirement_ancestry_required')
    host = Host(); owner = Owner(host)
    quiet = host.shared_quiet()
    old, _ = owner.envs()
    feature = host.feature(old)
    grant_before = owner.read('grants-review.json')['binding']['before']
    owner._exact_snapshot(grant_before, False)
    if receipt['eightReadInverse'] != {'restoredBeforeSha256': sha(encode(grant_before)), 'priorTwoTargetReadsPreserved': True, 'oldTenReadsPreserved': True, 'loginPreserved': True}:
        fail('exact_eight_read_inverse_receipt_required')
    if feature['timer'].get('UnitFileState') != 'enabled' or feature['timer'].get('ActiveState') != 'active':
        fail('restored_owned_queue_schedule_required')
    host.queue_live()
    minimum = int(receipt['queue']['lastSuccess']['indexedBlock'])
    source = host.source_runtime(receipt['source']['inputs'], minimum)
    host.queue_proof(0, minimum)
    return {'format': 'yunipals-booster-feature-inverse-validation-v1', 'validated': True,
        'operatorSha256': sha(protected(__file__)), 'inverseReceiptSha256': pin,
        'apiInvocation': feature['api']['InvocationID'], 'apiIdentity': {key: feature['api'][key] for key in ('InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic', 'ControlGroup')},
        'restoredEnvironmentSha256': sha(old), 'source': source,
        'oldTenReadsPreserved': True, 'priorTwoTargetReadsPreserved': True,
        'sharedCombinedQuiet': quiet,
        'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['rehearse-grants', 'commit-grants', 'switch', 'retire', 'inverse', 'reconcile'])
    parser.add_argument('--apply'); parser.add_argument('--resume', action='store_true')
    parser.add_argument('--parity-file', type=Path); parser.add_argument('--parity-sha')
    parser.add_argument('--artifact-file'); parser.add_argument('--artifact-sha')
    parser.add_argument('--event-file', type=Path); parser.add_argument('--event-sha')
    args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main':
        fail('root_on_exact_production_host_required')
    host = Host(); owner = Owner(host)
    descriptor = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        info = os.fstat(lock.fileno())
        if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            fail('private_consumer_coordination_lock_required')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase == 'reconcile': result = owner.reconcile()
        elif args.phase == 'rehearse-grants': result = owner.grant_rehearsal()
        elif args.phase == 'commit-grants':
            if not args.apply or not args.artifact_file or not args.artifact_sha: fail('exact_grant_review_and_final_consumer_artifact_required')
            result = owner.grant_commit(args.apply, args.artifact_file, args.artifact_sha, args.resume)
        else:
            if args.resume:
                if not args.apply: fail('explicit_owned_resume_hash_required')
                review = owner.read({'switch': 'switch-review.json', 'retire': 'retirement-review.json', 'inverse': 'inverse-review.json'}[args.phase])
            elif args.phase == 'switch':
                if not all((args.parity_file, args.parity_sha, args.artifact_file, args.artifact_sha)):
                    fail('actual_parity_and_final_consumer_artifact_required')
                review = owner.switch_review(args.parity_file, args.parity_sha, args.artifact_file, args.artifact_sha)
            elif args.phase == 'retire':
                if not all((args.parity_file, args.parity_sha, args.event_file, args.event_sha)):
                    fail('actual_post_switch_event_and_parity_required')
                review = owner.retirement_review(args.parity_file, args.parity_sha, document(args.event_file, args.event_sha))
            else: review = owner.inverse_review()
            if args.apply:
                result = getattr(owner, args.phase)(review, args.apply, args.resume)
            else: result = {'reviewHash': review['reviewHash'], 'binding': review['binding'], 'applied': False}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld',
            'automaticRetry': False}))
        raise SystemExit(1)
