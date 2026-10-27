#!/usr/bin/env python3
"""Fresh YPAL ten-read admission and fixed HTTP/queue overlays. Review first.

No source/indexer/proxy/credential/role-attribute operations. The frozen source-start
producer and an actual acknowledged ready source receipt are both required. Unknown command/SQL acknowledgements are inspected, never retried.
"""
import argparse
import hashlib
import json
import os
import pwd
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import time
import types
import urllib.error
import urllib.request

FORMAT = 'yunipals-ypal-reader-cutover-v1'
BASE = Path('/var/backups/yunipals-ypal-reader-cutover-v1-20261023')
INPUT = Path('/var/backups/yunipals-ypal-backend-input-v1-20261023')
SOURCE_START_FILE = INPUT / 'ypal-source-start-v1.py'
SOURCE_START_SHA = 'eef6040deb5240c2f0ea43229882ca01921981f2c1a9224ef4b55da350a87b05'  # Frozen producer, actual result SHA remains required.
SOURCE_RESULT = Path('/var/backups/yunipals-ypal-source-start-v1-20261023/result.json')
PREPARED = Path('/var/backups/yunipals-ypal-backend-owner-v1-20261023')
SCHEMA = 'yunipals_boosters_ypal_v1'
OLD_SCHEMA = 'yunipals_boosters_launch_v1'
BUILD = '8e88ea2e00'
ROLE = 'yunipals_unified_collector'
ROLE_OID = '73187672'
DATABASE_OID = '17584'
WRITER_OID = '73004621'
API = 'yunipals-booster-api.service'
QUEUE = 'yunipals-booster-artwork-queue.service'
TIMER = 'yunipals-booster-artwork-queue.timer'
API_SHA = '41fe9b9cb87edaa5689ed611cd2c99b299215be7c8fb6262b560660854657c73'
API_UNIT_SHA = '5ae76b4b54b359dc63cd9b990b227a32e4c984255308e1cd90982fa7de146414'
QUEUE_SHA = 'e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33'
UNIT_PINS = {API: API_UNIT_SHA, QUEUE: '98af81f91cac104665cb21f514be4b5ec59945a64c9b5c720f4cdf645f702d4e', TIMER: 'a5aa3752a7781bddf970908229699a87a1d9d319242f0b422d0852e8e5d96211'}
PUBLIC_ENV = Path('/etc/yunipals-unified/booster-ypal.public.env')
DROPS = {u: Path('/etc/systemd/system') / (u + '.d') / '95-ypal.conf' for u in (API, QUEUE)}
TABLES = sorted(['_ponder_meta', '_ponder_checkpoint', 'booster_type', 'booster_original', 'booster_request', 'booster_monster', 'booster_refund', 'booster_engine_state', 'booster_checkpoint', 'booster_event'])
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def quote(text): return "'" + str(text).replace("'", "''") + "'"
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def protected(path, cap=4_000_000):
    path = Path(path)
    for p in [path, *path.parents]:
        st = p.lstat(); need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_reader_input_required')
    st = path.stat(); need(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= cap, 'bounded_regular_reader_input_required')
    raw = path.read_bytes(); need(identity(st) == identity(path.stat()), 'reader_input_changed_during_read'); return raw


def identity(st): return {k: getattr(st, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns')}
def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(path, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as f:
        os.fchmod(f.fileno(), mode); f.write(raw); f.flush(); os.fsync(f.fileno())
    sync(Path(path).parent); return sha(raw)


def document(path, pin=None):
    raw = protected(path); need(pin is None or sha(raw) == pin, 'exact_reader_receipt_hash_required'); return json.loads(raw)


def source_module():
    need(isinstance(SOURCE_START_SHA, str) and re.fullmatch('[0-9a-f]{64}', SOURCE_START_SHA), 'actual_frozen_source_start_producer_not_yet_bound')
    raw = protected(SOURCE_START_FILE); need(sha(raw) == SOURCE_START_SHA, 'exact_source_start_producer_required')
    m = types.ModuleType('owned_ypal_source'); m.__file__ = str(SOURCE_START_FILE); exec(compile(raw, str(SOURCE_START_FILE), 'exec'), m.__dict__); return m


def catalog_sql():
    names = ','.join(quote(n) for n in TABLES)
    # Complete direct collector graph is retained, including grantors/object OIDs.
    return """SELECT jsonb_build_object(
 'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'role',(SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'limit',rolconnlimit,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDatabase',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'validUntil',rolvaliduntil::text,'passwordConfigured',(SELECT rolpassword IS NOT NULL FROM pg_authid WHERE oid=r.oid),'memberships',(SELECT coalesce(jsonb_agg(roleid::text ORDER BY roleid),'[]'::jsonb)FROM pg_auth_members WHERE member=r.oid))FROM pg_roles r WHERE rolname='""" + ROLE + """'),
 'schemas',(SELECT jsonb_object_agg(nspname,jsonb_build_object('oid',oid::text,'owner',nspowner::text,'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner)))a),'usage',has_schema_privilege('""" + ROLE + """',oid,'USAGE'),'create',has_schema_privilege('""" + ROLE + """',oid,'CREATE')))FROM pg_namespace WHERE nspname IN('""" + SCHEMA + "','" + OLD_SCHEMA + """')),
 'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a),'kind',c.relkind,'select',has_table_privilege('""" + ROLE + """',c.oid,'SELECT'),'writes',has_table_privilege('""" + ROLE + """',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))ORDER BY n.nspname,c.relname),'[]'::jsonb)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('""" + SCHEMA + "','" + OLD_SCHEMA + "')AND c.relname=ANY(ARRAY[" + names + "])),\n 'edges',(SELECT coalesce(jsonb_agg(to_jsonb(e)ORDER BY kind,object,grantor,privilege,grantable),'[]'::jsonb)FROM(\n" + " UNION ALL ".join(
        "SELECT " + quote(kind) + " AS kind,o.oid::text AS object,a.grantor::text AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM " + table + " o CROSS JOIN LATERAL aclexplode(o." + acl + ")a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=" + quote(ROLE) + ")"
        for kind, table, acl in [('schema', 'pg_namespace', 'nspacl'), ('relation', 'pg_class', 'relacl'), ('function', 'pg_proc', 'proacl'), ('database', 'pg_database', 'datacl'), ('default', 'pg_default_acl', 'defaclacl')]) + ")e))"


def validate_catalog(c, admitted):
    need(c['databaseOid'] == DATABASE_OID, 'fixed_source_database_required')
    role = c['role']; need(role['oid'] == ROLE_OID and role['name'] == ROLE and role['login'] is True and role['limit'] == 6 and role['memberships'] == [] and role['validUntil'] is None and role['passwordConfigured'] is False and all(role[k] is False for k in ('super', 'inherit', 'createRole', 'createDatabase', 'replication', 'bypassRls')), 'unchanged_existing_collector_role_required')
    need(set(c['schemas']) == {SCHEMA, OLD_SCHEMA}, 'both_actual_booster_namespaces_required')
    for schema in c['schemas'].values(): need(re.fullmatch('[1-9][0-9]*', schema['oid']) and schema['create'] is False and schema['owner'] == WRITER_OID and isinstance(schema.get('acl'), list), 'actual_no_create_schema_required')
    need(c['schemas'][OLD_SCHEMA]['usage'] is True and (not admitted or c['schemas'][SCHEMA]['usage'] is True), 'required_readonly_schema_usage')
    need(len(c['tables']) == 20 and {(r['schema'], r['name'])for r in c['tables']} == {(s, n)for s in (SCHEMA, OLD_SCHEMA)for n in TABLES}, 'exact_old_and_fresh_ten_relations_required')
    for row in c['tables']:
        need(row['owner'] == WRITER_OID and isinstance(row.get('acl'), list) and row['kind'] == 'r' and re.fullmatch('[1-9][0-9]*', row['oid']) and row['writes'] is False and row['select'] is (True if row['schema'] == OLD_SCHEMA else admitted), 'exact_ten_selects_without_writes_required')
    return c


def validate_delta(before, after):
    validate_catalog(before, False); validate_catalog(after, True)
    b, a = json.loads(json.dumps(before)), json.loads(json.dumps(after))
    for row in a['tables']:
        if row['schema'] == SCHEMA:
            row['select'] = False
            row['acl'] = [e for e in row['acl'] if not(e['grantee'] == ROLE_OID and e['privilege'] == 'SELECT')]
    a['schemas'][SCHEMA]['usage'] = b['schemas'][SCHEMA]['usage']
    if not b['schemas'][SCHEMA]['usage']: a['schemas'][SCHEMA]['acl'] = [e for e in a['schemas'][SCHEMA]['acl'] if not(e['grantee'] == ROLE_OID and e['privilege'] == 'USAGE')]
    prior = {tuple(sorted(e.items())) for e in b.pop('edges')}; following = {tuple(sorted(e.items())) for e in a.pop('edges')}
    need(a == b and prior <= following, 'only_own_read_delta_preserving_baseline_required')
    expected = {('relation', row['oid'], 'SELECT')for row in after['tables']if row['schema'] == SCHEMA}
    if not before['schemas'][SCHEMA]['usage']: expected.add(('schema', after['schemas'][SCHEMA]['oid'], 'USAGE'))
    actual = [dict(e)for e in following - prior]
    need(len(actual) == len(expected) and {(e['kind'], e['object'], e['privilege'])for e in actual} == expected and all(not e['grantable'] for e in actual), 'only_exact_ten_selects_and_needed_usage_required')
    return True


def grant_sql(before, after=None, commit=False, inverse=False):
    validate_catalog(before, inverse)
    statements = []
    if inverse:
        statements = ['REVOKE SELECT ON TABLE ' + SCHEMA + '.' + n + ' FROM ' + ROLE + ';' for n in TABLES]
        if after is not None and not after['schemas'][SCHEMA]['usage']: statements += ['REVOKE USAGE ON SCHEMA ' + SCHEMA + ' FROM ' + ROLE + ';']
    else:
        if not before['schemas'][SCHEMA]['usage']: statements += ['GRANT USAGE ON SCHEMA ' + SCHEMA + ' TO ' + ROLE + ';']
        statements += ['GRANT SELECT ON TABLE ' + SCHEMA + '.' + n + ' TO ' + ROLE + ';' for n in TABLES]
    check = lambda value: "DO $ypal$ BEGIN IF (" + catalog_sql() + ") IS DISTINCT FROM " + quote(json.dumps(value)) + "::jsonb THEN RAISE EXCEPTION 'exact_reader_catalog_CAS_required'; END IF; END $ypal$;\n"
    return "BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';SELECT pg_advisory_xact_lock(17927800, 2310);\n" + check(before) + '\n'.join(statements) + '\n' + (check(after) if after is not None else '') + catalog_sql() + ';\n' + ('COMMIT;' if commit else 'ROLLBACK;')


PEER = r'''import hashlib,json,os,pathlib,sys
pid=int(sys.argv[1]);expected=json.loads(sys.argv[2]);p=pathlib.Path('/proc')/str(pid)
def ticks():
 s=(p/'stat').read_text();return int(s[s.rindex(')')+2:].split()[19])
b=ticks();assert os.geteuid()==967 and os.getegid()==961;assert os.path.realpath(p/'exe')=='/opt/node-v24.18.1/bin/node'
e=dict(x.split(b'=',1)for x in(p/'environ').read_bytes().split(b'\0')if b'='in x)
assert all(e.get(k.encode())==v.encode()for k,v in expected.items());assert ticks()==b
print(json.dumps({'pid':pid,'startTicks':b,'nodeExecutable':True,'publicEnvironmentMatched':True}))
'''


def inverse_source_proof(owner, pin):
    """Reader inverse only: prove the accepted writer, never claim readiness.

    Uses the frozen source owner's same actor/unit/boot/catalog/session guards.
    This breaks the ordering cycle if that exact running writer lost readiness.
    It neither stops the source nor authorizes any forward reader action.
    """
    source_m = owner.prepare_module(); source_host = owner.Host(source_m)
    raw = source_m.protected(owner.BASE / 'result.json'); result = json.loads(raw)
    need(sha(raw) == pin and result['format'] == owner.FORMAT and result['operatorSha256'] == owner.self_sha(source_m) == SOURCE_START_SHA and result['bootId'] == source_m.boot() and result['ready'] is True and not (owner.BASE / 'inverse-intent.json').exists(), 'exact_accepted_source_receipt_for_reader_inverse')
    controller = owner.SourceStart(source_host); binding = controller.load(result['operationSha256'])
    state = source_host.unit(binding)
    if state['MainPID'] == '0': return owner.validate_owned(pin, terminal_ok=True)
    intent, acknowledged = controller.owned_start(); actor = source_host.fresh_actor(binding, intent)
    need(actor == acknowledged and owner.actor_identity(actor) == owner.actor_identity(result['source']), 'only_exact_accepted_active_source_for_reader_inverse')
    owner.check_link(source_m, owner.BOOT_FILE, source_m.load(owner.BASE / 'boot-created.json'))
    need(state['UnitFileState'] == 'enabled' and owner.activation(source_m, owner.SOURCE)['WantedBy'] == 'multi-user.target', 'same_owned_source_boot_authority_for_inverse')
    old = controller.old_terminal(binding); sessions = owner.wait_for(lambda: source_host.sessions(binding, actor), 'owned_source_sessions_pending_for_reader_inverse')
    need(sessions.get('complete') is True, 'complete_owned_source_sessions_for_inverse')
    catalog = source_host.h.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + SCHEMA + "'),'owner',(SELECT nspowner::text FROM pg_namespace WHERE nspname='" + SCHEMA + "'),'app',(SELECT value FROM " + SCHEMA + "._ponder_meta WHERE key='app'),'tables',(SELECT jsonb_object_agg(c.relname,c.oid::text)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + SCHEMA + "'AND c.relowner=73004621 AND c.relkind='r'AND c.relname=ANY(ARRAY[" + ','.join(quote(n)for n in TABLES) + "])))")
    need(catalog['schemaOid'] == result['schemaOid'] and catalog['owner'] == WRITER_OID and catalog['tables'] == result['readTableOids'] and catalog['app']['build_id'] == BUILD == binding['buildId'] and str(catalog['app']['version']) == '6' and str(catalog['app']['is_dev']) == '0', 'same_owned_active_source_catalog_for_reader_inverse')
    need(source_host.unit(binding) == state and source_host.fresh_actor(binding, intent) == actor, 'owned_source_changed_during_reader_inverse_qualification')
    return {'validated': True, 'receiptSha256': pin, 'preparedResultSha256': binding['preparedResultSha256'], 'source': actor, 'oldSource': old, 'schema': SCHEMA, 'schemaOid': catalog['schemaOid'], 'readTableOids': catalog['tables'], 'buildId': BUILD, 'readerInverseOnly': True, 'activeOwnedUnreadyAllowed': True, 'ready': False, 'nativeReadinessClaimed': False, 'sessionProof': sessions, 'sourceChanges': 0}


def unix_account():
    account = pwd.getpwnam(ROLE)
    need((account.pw_uid, account.pw_gid, account.pw_shell) == (967, 961, '/usr/sbin/nologin'), 'same_locked_collector_Unix_account_required')


class Host:
    def __init__(self, source_pin):
        unix_account(); self.source_owner = source_module(); self.m = self.source_owner.prepare_module(); self.h = self.m.Host(); self.core = self.h.core; self.core_module = self.h.observer.load('booster-feature-handover-v7.py'); self.source_pin = source_pin; self.inverse_mode = False

    def source(self):
        need(SOURCE_RESULT.is_file(), 'actual_acknowledged_ready_source_receipt_required')
        p = inverse_source_proof(self.source_owner, self.source_pin) if self.inverse_mode else self.source_owner.validate_current(self.source_pin)
        need(p.get('validated') is True and p.get('receiptSha256') == self.source_pin and p.get('schema') == SCHEMA and p.get('buildId') == BUILD and ((p.get('oldSource', {}).get('terminal') is True and p.get('oldSource', {}).get('enabled') is False and p.get('native', {}).get('ready') is True) or (self.inverse_mode and (p.get('sourceTerminal') is True or p.get('activeOwnedUnreadyAllowed') is True) and p.get('readerInverseOnly') is True and p.get('ready') is False)), 'actual_fresh_source_and_old_drain_required')
        need(sha(protected(SOURCE_RESULT)) == self.source_pin, 'actual_protected_source_receipt_required')
        return p

    def query(self, text): return self.core.query(text)
    def sql(self, text): return self.core.sql(text)
    def catalog(self): return self.query(catalog_sql())
    def independent(self): return self.h.observer.independent()
    def state(self, unit):
        need(unit in {API, QUEUE, TIMER}, 'fixed_reader_unit_only'); return self.core.state(unit)

    def inputs(self):
        p = document(PREPARED / 'result.json'); source = self.source()
        need(sha(protected(PREPARED / 'result.json')) == source['preparedResultSha256'] and p['operatorSha256'] == self.source_owner.PREPARE_SHA and p['preparation']['build']['buildId'] == BUILD, 'actual_prepared_reader_candidates_required')
        op = document(PREPARED / 'operation.json', p['operationSha256'])
        env = protected(PREPARED / 'reader.public.env.candidate'); drop = protected(PREPARED / 'reader-dropin.candidate')
        need(sha(env) == op['readerEnvironmentSha256'] and sha(drop) == op['readerDropinSha256'], 'exact_prepared_public_reader_bytes_required')
        values = dict(line.split('=', 1)for line in env.decode().splitlines())
        need(values['BOOSTER_DATABASE_SCHEMA'] == SCHEMA and values['BOOSTER_ARTWORK_CATALOGS'] == 'base-mainnet-standard-v1' and drop == ('[Service]\nEnvironmentFile=' + str(PUBLIC_ENV) + '\nEnvironment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-standard-v1\n').encode(), 'only_fixed_fresh_public_reader_overlay_required')
        deployment = document(INPUT / 'confirmed.json'); need(sha(protected(INPUT / 'confirmed.json')) == '3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c', 'actual_confirmed_manifest_required')
        for key, field in [('BOOSTER_REGISTRY', 'registry'), ('BOOSTER_ENGINE', 'engine'), ('BOOSTER_MONSTERS', 'monsters'), ('BOOSTER_WRAPPER', 'vrfWrapper')]: need(values[key] == deployment[field].lower(), 'fresh_reader_address_identity_required')
        return {'sourceReceiptSha256': self.source_pin, 'preparedResultSha256': source['preparedResultSha256'], 'environmentSha256': sha(env), 'dropinSha256': sha(drop), 'values': values, 'deployment': deployment}, env, drop

    def definitions(self, overlay=False):
        result = {}
        for unit, pin in UNIT_PINS.items():
            s = self.state(unit); path = Path('/etc/systemd/system') / unit
            need(s['FragmentPath'] == str(path) and sha(protected(path)) == pin and s['Job'] in {'', '0'}, 'same_reader_base_definitions_required')
            expected = str(DROPS[unit]) if overlay and unit in DROPS else ''
            need(s['DropInPaths'] == expected and (unit == TIMER or s['User'] == s['Group'] == ROLE), 'only_owned_reader_dropins_required')
            if unit != TIMER:
                declared = [shlex.split(line.split('=', 1)[1]) for line in protected(path).decode().splitlines() if line.startswith('ExecStart=')]
                observed = [shlex.split(v) for v in re.findall(r'argv\[\]=(.*?)\s+;', s['ExecStart'])]
                need(len(declared) == 1 and declared == observed, 'exact_base_unit_exec_required')
            result[unit] = {'definitionSha256': pin, 'argv': re.findall(r'argv\[\]=(.*?)\s+;', s['ExecStart']) if unit != TIMER else [], 'workingDirectory': s['WorkingDirectory'] if unit != TIMER else ''}
        need(sha(protected(Path('/opt/yunipals-unified/booster-api-releases') / API_SHA / 'booster-api.mjs')) == API_SHA, 'same_41fe_API_program_required')
        need(sha(protected(Path('/opt/yunipals-unified/booster-api-releases') / QUEUE_SHA / 'booster-artwork-sync.mjs')) == QUEUE_SHA, 'same_e2b_queue_program_required')
        original = document(PREPARED / 'operation.json')['snapshot']; paths = original['privateInputHashes']
        for path, pin in paths.items(): need(self.h.observer.file_pin(path) == pin, 'unchanged_original_private_inputs_required')
        result['privateInputHashes'] = paths
        return result

    def actor(self, unit, expected_values=None):
        need(unit in {API, QUEUE}, 'fixed_reader_actor_only'); state = self.state(unit)
        need(state['ActiveState'] == 'active' and state['SubState'] == 'running' and state['Job'] in {'', '0'} and re.fullmatch('[a-f0-9]{32}', state['InvocationID']), 'running_reader_actor_required')
        pid = int(state['MainPID']); p = Path('/proc') / str(pid); raw = (p / 'stat').read_text(); ticks = int(raw[raw.rfind(')') + 2:].split()[19])
        group = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'; need(group.read_text().split() == [str(pid)], 'one_exact_reader_Node_required')
        status = dict(x.split(':', 1)for x in (p / 'status').read_text().splitlines()if ':' in x); self.core.runtime.validate_process_status(status)
        args = re.findall(r'argv\[\]=(.*?)\s+;', state['ExecStart']); need(len(args) == 1 and (p / 'cmdline').read_bytes().rstrip(b'\0').decode().split('\0') == shlex.split(args[0]), 'exact_loaded_reader_command_required')
        if expected_values is not None:
            result = subprocess.run(['/usr/bin/setpriv', '--reuid=967', '--regid=961', '--clear-groups', '--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all', '/usr/bin/python3', '-I', '-B', '-c', PEER, str(pid), json.dumps(expected_values)], env=CLEAN, capture_output=True, timeout=8)
            need(result.returncode == 0 and not result.stderr and json.loads(result.stdout)['startTicks'] == ticks, 'actual_reader_public_environment_required')
        need(self.state(unit) == state, 'reader_identity_changed'); return {k: state[k]for k in ('Id', 'MainPID', 'InvocationID', 'ExecMainStartTimestampMonotonic')} | {'startTicks': ticks}

    def quiet(self, unit):
        s = self.state(unit); need(s['ActiveState'] in {'inactive', 'failed'} and s['MainPID'] == '0' and s['Job'] in {'', '0'}, 'terminal_reader_required')
        path = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'; need(not path.exists() or not path.read_text().split(), 'empty_reader_cgroup_required'); return s

    def manager(self, action, unit=None, expected=None):
        need((action == 'daemon-reload' and unit is None) or (action in {'start', 'stop'} and unit in {API, QUEUE, TIMER}), 'only_fixed_reader_manager_actions_allowed')
        unix_account(); self.inputs()
        prior = document(PREPARED / 'operation.json')['snapshot']['privateInputHashes']
        for path, pin in prior.items(): need(self.h.observer.file_pin(path) == pin, 'private_reader_input_changed_at_command_boundary')
        need(self.catalog() == document(BASE / 'admission.json')['after'], 'admitted_reader_graph_changed_at_command_boundary')
        for bundle, name in [(API_SHA, 'booster-api.mjs'), (QUEUE_SHA, 'booster-artwork-sync.mjs')]: need(sha(protected(Path('/opt/yunipals-unified/booster-api-releases') / bundle / name)) == bundle, 'same_program_at_command_boundary')
        for fixed, pin in UNIT_PINS.items():
            path = Path('/etc/systemd/system') / fixed
            need(sha(protected(path)) == pin, 'same_base_definition_at_command_boundary')
            current = self.state(fixed)
            need(current['FragmentPath'] == str(path) and current['DropInPaths'] in {'', str(DROPS[fixed]) if fixed in DROPS else ''}, 'no_foreign_loaded_reader_definition')
            if fixed != TIMER:
                need(current['User'] == current['Group'] == ROLE, 'fixed_locked_reader_account_required')
                declared = [shlex.split(line.split('=', 1)[1])for line in protected(path).decode().splitlines()if line.startswith('ExecStart=')]
                observed = [shlex.split(v)for v in re.findall(r'argv\[\]=(.*?)\s+;', current['ExecStart'])]
                need(declared == observed and len(declared) == 1, 'same_loaded_reader_command_at_boundary')
        for record in publications(): owned_overlay(record)
        if action == 'start': self.definitions(all(path.exists() for path in [PUBLIC_ENV, *DROPS.values()]))
        if expected is not None:
            current = self.actor(unit); need(current == expected, 'reader_stop_PID_invocation_CAS_required')
        if action == 'start' and unit != TIMER: self.quiet(unit)
        r = subprocess.run(['/usr/bin/systemctl', '--quiet', action] + ([unit] if unit else []), env=CLEAN, capture_output=True, timeout=45)
        need(r.returncode == 0 and not r.stdout and not r.stderr, 'reader_manager_ACK_unknown_inspect_not_retry')

    def ready(self):
        row = self.query("SELECT jsonb_build_object('app',(SELECT value FROM " + SCHEMA + "._ponder_meta WHERE key='app'),'checkpoint',(SELECT latest_checkpoint FROM " + SCHEMA + "._ponder_checkpoint WHERE chain_id=8453))")
        app = row['app']; checkpoint = row['checkpoint']; block = self.core.parity.complete_block(checkpoint)
        need(app['build_id'] == BUILD and str(app['version']) == '6' and str(app['is_dev']) == '0' and str(app['is_ready']) == str(app['is_locked']) == '1' and 0 <= time.time() - int(app['heartbeat_at']) / 1000 <= 180 and block is not None and 0 <= time.time() - int(checkpoint[:10]) <= 180, 'actual_current_complete_YPAL_source_required')
        return {'buildId': BUILD, 'completeBlock': block}

    def request(self, path, public=False):
        need(path == '/readyz' or path.startswith('/v1/boosters/'), 'fixed_readonly_booster_probe_only')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs): raise RuntimeError('reader_probe_redirect_forbidden')
        url = ('https://api.yunipals.com/yunipals-indexer' if public else 'http://127.0.0.1:9030') + path
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.yunipals.com', 'Referer': 'https://www.yunipals.com/'})
        try: response = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=8)
        except urllib.error.HTTPError as error: response = error
        with response:
            raw = response.read(1000001); need(len(raw) <= 1000000, 'bounded_reader_probe_required'); return response.status, json.loads(raw)

    def availability(self, deployment, old=False):
        ready_status, ready = self.request('/readyz')
        expected = {'collection': deployment['monsters'].lower(), 'engine': deployment['engine'].lower()}
        need(all(ready.get(k) == v for k, v in expected.items()) and (ready_status in {200, 503} if old else ready_status == 200 and ready.get('ready') is True and ready.get('buildId') == BUILD), 'actual_configured_reader_identity_required')
        if old: return {'oldTargetIdentity': True, 'status': ready_status, 'readyMayBeFalseUntilSourceInverse': True}
        for public in (False, True):
            for path in ('/v1/boosters/types', '/v1/boosters/monsters?limit=24', '/v1/boosters/recent-openings?limit=12'):
                status, body = self.request(path, public); need(status == 200 and body['engine'] == expected['engine'] and body['collection'] == expected['collection'] and body['enabled'] is True, 'actual_fresh_public_reader_pages_required')
                if path.endswith('/types'):
                    need(len(body['items']) == 1 and body['items'][0]['packTypeId'] == '1' and body['items'][0]['paymentToken'] == deployment['ypal'].lower() and body['items'][0]['price'] == '1000000000000000000' and body['items'][0]['catalogHash'] == deployment['catalogHash'], 'actual_one_YPAL_type1_required')
            status, art = self.request('/v1/boosters/art/base-mainnet-standard-v1/81.json', public); need(status == 200 and isinstance(art.get('image'), str) and art.get('yunipals', {}).get('status') == 'ready', 'preserved_approved_standard_art_required')
        return {'localAndPublicReady': True, 'typesGlobalRecentAndArtwork200': True}


def old_target(host):
    status, value = host.request('/readyz')
    need(status in {200, 503} and value.get('collection') == '0x105319be2182018c31fb10b1be198c3cf238a146' and value.get('engine') == '0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609', 'actual_original_API_configuration_required')
    return {'monsters': value['collection'], 'engine': value['engine']}


def current_inputs(host, source_pin):
    inputs, env, drop = host.inputs(); source = host.source(); c = validate_catalog(host.catalog(), False)
    need(c['schemas'][SCHEMA]['oid'] == str(source['schemaOid']) and {r['name']: r['oid']for r in c['tables']if r['schema'] == SCHEMA} == {k: str(v)for k, v in source['readTableOids'].items()}, 'actual_source_owned_ten_OIDs_required')
    for path in [PUBLIC_ENV, *DROPS.values()]: need(not os.path.lexists(path), 'fresh_reader_overlay_paths_required')
    return {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(), 'sourceReceiptSha256': source_pin, 'inputs': inputs, 'before': c, 'definitions': host.definitions(), 'API': host.actor(API), 'oldTarget': old_target(host), 'independent': host.independent()}, env, drop


def check_binding(host, binding, admitted):
    need(binding['operatorSha256'] == sha(protected(Path(__file__).absolute())) and binding['bootId'] == boot() and host.source()['receiptSha256'] == binding['sourceReceiptSha256'], 'same_owned_reader_operation_required')
    need(host.independent() == binding['independent'], 'unchanged_OG_shared_BNB_and_proxies_required')
    host.inputs(); current = host.catalog(); need(current == binding['after' if admitted else 'before'], 'exact_current_reader_role_graph_required'); return current


def rehearsal(host, pin, expected):
    binding, _, _ = current_inputs(host, pin); need(sha(encoded(binding)) == expected and not BASE.exists(), 'fresh_exact_reader_rehearsal_review_required')
    BASE.mkdir(mode=0o700); save(BASE / 'review.json', binding)
    sql = grant_sql(binding['before']); save(BASE / 'rollback.sql', sql.encode())
    after = json.loads(host.sql(sql)); validate_delta(binding['before'], after)
    need(host.catalog() == binding['before'], 'rollback_must_restore_exact_catalog')
    binding['after'] = after
    result = {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'reviewSha256': sha(protected(BASE / 'review.json')), 'reviewHash': expected, 'before': binding['before'], 'after': after, 'transactionSha256': sha(sql.encode()), 'rollbackPassed': True, 'tenSelectsOnly': True, 'schemaUsageAdded': not binding['before']['schemas'][SCHEMA]['usage'], 'loginChanged': False, 'rowWrites': 0}
    save(BASE / 'rehearsal.json', result); return result


def admit(host, pin):
    r = document(BASE / 'rehearsal.json', pin); binding = document(BASE / 'review.json', r['reviewSha256']); binding['after'] = r['after']; check_binding(host, binding, False)
    need(host.definitions() == binding['definitions'] and host.actor(API) == binding['API'], 'same_reviewed_original_readers_required')
    sql = grant_sql(binding['before'], binding['after'], True); save(BASE / 'commit.sql', sql.encode()); save(BASE / 'commit-intent.json', {'bootId': boot(), 'sourceReceiptSha256': binding['sourceReceiptSha256'], 'sqlSha256': sha(sql.encode()), 'rehearsalSha256': pin, 'automaticRetryAllowed': False})
    result = json.loads(host.sql(sql)); need(result == binding['after'] and host.catalog() == result, 'explicit_commit_ack_and_exact_after_required')
    receipt = {'format': FORMAT, 'admitted': True, 'rehearsalSha256': pin, 'before': binding['before'], 'after': result, 'operatorSha256': binding['operatorSha256'], 'sourceReceiptSha256': binding['sourceReceiptSha256'], 'loginChanged': False, 'rowWrites': 0, 'oldTenReadsPreserved': True}
    save(BASE / 'admission.json', receipt); return receipt


def switch_review(host):
    a = document(BASE / 'admission.json'); r = document(BASE / 'review.json'); r['after'] = a['after']; check_binding(host, r, True)
    need(host.definitions() == r['definitions'] and host.actor(API) == r['API'], 'same_original_readers_before_switch_required')
    ready = host.ready(); return {'format': FORMAT, 'operatorSha256': r['operatorSha256'], 'bootId': boot(), 'sourceReceiptSha256': r['sourceReceiptSha256'], 'admissionSha256': sha(protected(BASE / 'admission.json')), 'API': r['API'], 'definitions': r['definitions'], 'independent': r['independent'], 'inputs': r['inputs']}, ready


def create_overlay(path, raw):
    path.parent.mkdir(mode=0o755, exist_ok=True)
    for p in [path.parent, *path.parent.parents]:
        st = p.lstat(); need(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_overlay_directory_required')
    need(not os.path.lexists(path), 'fresh_overlay_destination_required')
    key = sha(str(path).encode())[:8]; temporary = path.with_name('.ypal-stage-' + path.name + '.tmp')
    save(temporary, raw, 0o644)
    record = {'path': str(path), 'temporary': str(temporary), 'sha256': sha(raw), 'identity': identity(temporary.stat())}
    # Durable inode identity precedes the exclusive publication, including a
    # lost link/unlink acknowledgement. No existing destination is replaced.
    save(BASE / ('file-intent-' + key + '.json'), record)
    os.link(temporary, path, follow_symlinks=False); temporary.unlink(); sync(path.parent)
    owned_overlay(record); save(BASE / ('published-' + key + '.json'), record); return record


def owned_overlay(record):
    path = Path(record['path']); need(path in {PUBLIC_ENV, *DROPS.values()} and identity(path.lstat()) == record['identity'] and sha(protected(path)) == record['sha256'], 'only_exact_owned_overlay_inode_may_change')


def publications(reconcile=False):
    result = []
    for path in [PUBLIC_ENV, *DROPS.values()]:
        intent = BASE / ('file-intent-' + sha(str(path).encode())[:8] + '.json')
        if not intent.exists():
            need(not os.path.lexists(path), 'unowned_overlay_without_intent'); continue
        record = document(intent); need(record['path'] == str(path) and record['temporary'] == str(path.with_name('.ypal-stage-' + path.name + '.tmp')), 'fixed_owned_publication_required')
        temporary = Path(record['temporary'])
        # A completed exclusive link can have lost its acknowledgement before
        # unlinking the temporary hard link. Remove only that exact known peer.
        if temporary.exists():
            need(reconcile, 'unfinished_publication_requires_explicit_owned_inverse')
            st = temporary.lstat(); need(identity(st) == record['identity'] and stat.S_ISREG(st.st_mode) and st.st_uid == 0 and sha(temporary.read_bytes()) == record['sha256'], 'exact_owned_staging_inode_required')
            if path.exists(): need(identity(path.lstat()) == record['identity'], 'foreign_published_overlay_refused')
            temporary.unlink(); sync(temporary.parent)
        if path.exists(): owned_overlay(record); result.append(record)
    return result


def wait_readonly(effect, code, seconds=20):
    deadline = time.monotonic() + seconds
    while True:
        try: return effect()
        except (OSError, ValueError, RuntimeError):
            if time.monotonic() >= deadline: raise RuntimeError(code)
            time.sleep(0.2)


def step(name, effect):
    save(BASE / (name + '-intent.json'), {'bootId': boot(), 'monotonicUs': time.monotonic_ns() // 1000, 'automaticRetryAllowed': False})
    result = effect(); save(BASE / (name + '-result.json'), result if result is not None else {'completed': True}); return result


def stop_readers(host):
    host.manager('stop', TIMER)
    end = time.monotonic() + 15
    while host.state(QUEUE)['MainPID'] != '0' and time.monotonic() < end: time.sleep(0.2)
    if host.state(QUEUE)['MainPID'] != '0': host.manager('stop', QUEUE, host.actor(QUEUE))
    host.quiet(QUEUE); host.manager('stop', API, host.actor(API)); host.quiet(API)


def switch(host, expected):
    binding, _ = switch_review(host); need(sha(encoded(binding)) == expected, 'exact_reader_switch_review_required')
    save(BASE / 'switch-review.json', binding); save(BASE / 'original-readyz.json', document(BASE / 'review.json')['oldTarget']); host.inputs(); host.ready()
    need(host.definitions() == binding['definitions'] and host.actor(API) == binding['API'], 'same_original_process_immediately_before_stop')
    step('stop-original-readers', lambda: stop_readers(host))
    _, env, drop = host.inputs(); published = [create_overlay(PUBLIC_ENV, env), *[create_overlay(path, drop)for path in DROPS.values()]]
    step('load-overlays', lambda: host.manager('daemon-reload')); need(host.definitions(True) == binding['definitions'], 'same_programs_private_inputs_and_working_directories_required')
    step('start-fresh-api', lambda: host.manager('start', API)); actor = wait_readonly(lambda: host.actor(API, binding['inputs']['values']), 'fresh_API_process_not_stable')
    availability = wait_readonly(lambda: host.availability(binding['inputs']['deployment']), 'fresh_local_and_public_API_not_ready'); boundary = host.ready()['completeBlock']; start_us = time.monotonic_ns() // 1000
    step('fresh-queue-once', lambda: host.manager('start', QUEUE)); host.quiet(QUEUE)
    rows = [json.loads(line)for line in host.core.run(['/usr/bin/journalctl', '--unit=' + QUEUE, '--boot=0', '--no-pager', '--output=json', '--since=-2min'], 10).splitlines()if line]
    queue = host.core_module.queue_completion(rows, start_us, boundary)
    step('resume-original-queue-schedule', lambda: host.manager('start', TIMER))
    need(host.state(TIMER)['ActiveState'] == 'active' and host.state(TIMER)['UnitFileState'] == 'enabled', 'restored_enabled_queue_schedule_required')
    host.definitions(True); host.inputs(); host.source(); need(host.independent() == binding['independent'], 'independent_actors_unchanged_after_reader_switch')
    result = {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'sourceReceiptSha256': binding['sourceReceiptSha256'], 'admissionSha256': binding['admissionSha256'], 'API': actor, 'queue': queue, 'availability': availability, 'published': published, 'completed': True, 'schema': SCHEMA, 'oldTenReadsPreserved': True, 'sourceChanges': 0, 'roleAttributesChanged': False}
    save(BASE / 'result.json', result); return result


def inverse_admission(host, pin):
    a = document(BASE / 'admission.json', pin); binding = document(BASE / 'review.json'); binding['after'] = a['after']
    check_binding(host, binding, True)
    need(host.definitions() == binding['definitions'] and host.actor(API) == binding['API'], 'unchanged_old_readers_for_admission_only_inverse')
    for path in [PUBLIC_ENV, *DROPS.values()]: need(not os.path.lexists(path), 'no_reader_overlay_for_admission_only_inverse')
    sql = grant_sql(a['after'], a['before'], True, True)
    save(BASE / 'inverse-intent.json', {'admissionSha256': pin, 'transactionSha256': sha(sql.encode()), 'automaticRetryAllowed': False})
    restored = json.loads(host.sql(sql)); need(restored == a['before'] and host.catalog() == restored, 'exact_admission_only_inverse_required')
    value = {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'inverse': True, 'admissionOnly': True, 'originalRoleGraphRestored': True, 'sourceReceiptSha256': host.source_pin, 'sourceChanges': 0, 'readerChanges': 0}; save(BASE / 'inverse-result.json', value); return value


def inverse(host, pin):
    host.inverse_mode = True
    if not (BASE / 'switch-review.json').exists(): return inverse_admission(host, pin)
    binding = document(BASE / 'switch-review.json')
    receipt = BASE / 'result.json'
    if receipt.exists():
        result = document(receipt, pin)
        need(result['operatorSha256'] == binding['operatorSha256'], 'owned_completed_reader_result_required')
    else:
        need(sha(protected(BASE / 'switch-review.json')) == pin, 'explicit_partial_switch_review_reference_required')
    need(binding['operatorSha256'] == sha(protected(Path(__file__).absolute())) and binding['sourceReceiptSha256'] == host.source_pin and binding['bootId'] == boot(), 'exact_owned_same_boot_reader_inverse_required')
    host.source(); host.inputs(); need(host.independent() == binding['independent'], 'independent_actors_required_before_inverse')
    admission = document(BASE / 'admission.json', binding['admissionSha256']); need(host.catalog() == admission['after'], 'exact_owned_grant_after_graph_required_before_inverse')
    # An incomplete prefix is never retried. The explicit inverse may reconcile
    # only its prewritten publication inodes and its exact bounded start intent.
    save(BASE / 'inverse-intent.json', {'switchReviewSha256': sha(protected(BASE / 'switch-review.json')), 'bootId': boot(), 'automaticRetryAllowed': False})
    published = publications(True)
    host.manager('stop', TIMER)
    end = time.monotonic() + 45
    while host.state(QUEUE)['MainPID'] != '0' and time.monotonic() < end: time.sleep(0.2)
    host.quiet(QUEUE)
    state = host.state(API)
    if state['MainPID'] != '0':
        fresh_intent = BASE / 'start-fresh-api-intent.json'
        if fresh_intent.exists():
            intent = document(fresh_intent); actor = host.actor(API, binding['inputs']['values'])
            need(intent['bootId'] == boot() and int(actor['ExecMainStartTimestampMonotonic']) >= intent['monotonicUs'], 'only_owned_new_API_start_may_be_reconciled')
            host.manager('stop', API, actor); host.quiet(API)
        else:
            need(not published and host.actor(API) == binding['API'], 'foreign_or_unacknowledged_API_refuses_inverse')
    for record in published:
        owned_overlay(record); Path(record['path']).unlink(); sync(Path(record['path']).parent)
    step('load-original-readers', lambda: host.manager('daemon-reload')); need(host.definitions() == binding['definitions'], 'exact_original_reader_definitions_required')
    if host.state(API)['MainPID'] == '0': step('restore-original-api', lambda: host.manager('start', API))
    restored_actor = host.actor(API)
    availability = wait_readonly(lambda: host.availability(document(BASE / 'original-readyz.json'), True), 'original_API_identity_not_restored')
    step('restore-original-queue-schedule', lambda: host.manager('start', TIMER))
    sql = grant_sql(admission['after'], admission['before'], True, True); save(BASE / 'inverse-grants.sql', sql.encode())
    save(BASE / 'inverse-grants-intent.json', {'transactionSha256': sha(sql.encode()), 'automaticRetryAllowed': False})
    restored = json.loads(host.sql(sql)); need(restored == admission['before'] and host.catalog() == restored, 'exact_original_collector_graph_restored')
    value = {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'inverse': True, 'sourceReceiptSha256': host.source_pin, 'originalReaderDefinitionsRestored': True, 'originalRoleGraphRestored': True, 'API': restored_actor, 'oldTarget': availability, 'sourceChanges': 0, 'databaseRowWrites': 0}; save(BASE / 'inverse-result.json', value); return value


def inspect(host):
    binding = document(BASE / 'review.json'); need(binding['operatorSha256'] == sha(protected(Path(__file__).absolute())) and binding['bootId'] == boot(), 'same_owned_reader_inspection_required')
    host.source(); host.inputs(); need(host.independent() == binding['independent'], 'independent_actors_required_during_inspection')
    return {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'sourceReceiptSha256': host.source_pin, 'catalog': host.catalog(), 'states': {u: host.state(u)for u in (API, QUEUE, TIMER)}, 'acknowledgements': {name: sha(protected(BASE / name))for name in ('rehearsal.json', 'admission.json', 'switch-review.json', 'result.json', 'inverse-result.json')if (BASE / name).exists()}, 'automaticRetryAllowed': False, 'writes': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--source-start-sha', required=True)
    modes = p.add_mutually_exclusive_group(); modes.add_argument('--rehearse'); modes.add_argument('--admit'); modes.add_argument('--review-switch', action='store_true'); modes.add_argument('--switch'); modes.add_argument('--inverse'); modes.add_argument('--inspect', action='store_true')
    args = p.parse_args(); need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_host_only'); os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError())); signal.alarm(600)
    host = Host(args.source_start_sha)
    if args.rehearse: value = rehearsal(host, args.source_start_sha, args.rehearse)
    elif args.admit: value = admit(host, args.admit)
    elif args.switch: value = switch(host, args.switch)
    elif args.inverse: value = inverse(host, args.inverse)
    elif args.inspect: value = inspect(host)
    elif args.review_switch:
        binding, readiness = switch_review(host); value = {'binding': binding, 'reviewHash': sha(encoded(binding)), 'readiness': readiness}
    else:
        binding, _, _ = current_inputs(host, args.source_start_sha); value = {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'sourceChanges': 0, 'sourceProducerBound': True, 'requiresActualReadySourceReceipt': True}
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as e:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(e).__name__, 'fixedCode': str(e)if type(e) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(e))else 'private_diagnostics_withheld', 'automaticRetryAllowed': False})); raise SystemExit(1)
