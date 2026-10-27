#!/usr/bin/env python3
"""One owned ordinary sustained observer activation; default review is read-only.

Initial actual143 qualification is mandatory. Later validation is explicitly
observer-scoped, never a claim that an obsolete whole reader graph still holds.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT = 'yunipals-combined-ordinary-observer-owner-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-combined-ordinary-observer-owner-v1-20261024')
READ = OPS / 'ypal-combined-read-admission-v2.py'
READ_SHA = 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'
INSTALLER = OPS / 'ypal-combined-ordinary-observer-install-v1.py'
INSTALLER_SHA = 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738'
TEMPLATE = OPS / 'ypal-combined-ordinary-observer-serving-v1.service.example'
TEMPLATE_SHA = '8ab59f3420ee81673eac6e2bea57cfd9b0971b3d862af04d5ebb4fe962746428'
UNIT = 'yunipals-combined-ordinary-observer.service'
UNIT_FILE = Path('/etc/systemd/system') / UNIT
BOOT = UNIT_FILE.parent / 'multi-user.target.wants' / UNIT
ROLE = 'yunipals_unified_support'
ROLE_OID = '73036832'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
NATIVE = 'unified_ypal_20261023_v1'
NATIVE_TABLES = ('_ponder_meta', '_ponder_checkpoint', 'indexer_source', 'chain_checkpoint', 'chain_block')
CONTROL = 'yunipals_indexer_control'
NODE = '/opt/node-v24.18.1/bin/node'
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
PROPS = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'InvocationID',
         'ExecMainStartTimestampMonotonic', 'NRestarts', 'FragmentPath', 'DropInPaths', 'Job',
         'User', 'Group', 'ControlGroup', 'ExecStart', 'Environment', 'EnvironmentFiles',
         'WorkingDirectory', 'UnitFileState', 'WantedBy', 'RequiredBy', 'TriggeredBy', 'Triggers',
         'UpheldBy', 'PartOf', 'BindsTo', 'Restart', 'RuntimeMaxUSec', 'MemoryMax', 'CPUQuotaPerSecUSec',
         'NoNewPrivileges', 'CapabilityBoundingSet', 'AmbientCapabilities', 'ProtectSystem', 'ProtectHome',
         'PrivateTmp', 'RestrictSUIDSGID', 'RestrictAddressFamilies', 'KillMode', 'TimeoutStopUSec')


def need(ok, code):
    if not ok: raise RuntimeError(code)
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): need(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value), 'actual_receipt_sha256_required'); return value
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def mono(): return time.monotonic_ns() // 1000

def protected(path, limit=4000000):
    path = Path(path)
    for p in [path, *path.parents]:
        s = p.lstat(); need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_observer_input_required')
    a = path.stat(); need(stat.S_ISREG(a.st_mode) and a.st_nlink == 1 and a.st_size <= limit, 'bounded_regular_observer_input_required')
    raw = path.read_bytes(); b = path.stat()
    need((a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) == (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns), 'observer_input_changed_during_read')
    return raw

def document(path, expected=None):
    raw = protected(path); need(expected is None or sha(raw) == pin(expected), 'exact_observer_record_required'); return json.loads(raw)

def module(path, expected):
    raw = protected(path); need(sha(raw) == pin(expected), 'exact_observer_producer_required')
    m = types.ModuleType('observer_' + Path(path).stem); m.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), m.__dict__); return m

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def save(name, value):
    path = BASE / name; raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(raw); f.flush(); os.fsync(f.fileno())
    sync(BASE); return sha(raw)

def identity(path):
    s = Path(path).lstat(); return {k: getattr(s, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink')}

def command():
    raw = protected(TEMPLATE); need(sha(raw) == TEMPLATE_SHA, 'exact_observer_template_required')
    rows = [v.split('=', 1)[1] for v in raw.decode().splitlines() if v.startswith('ExecStart=')]
    need(len(rows) == 1, 'one_fixed_observer_entry_required'); args = shlex.split(rows[0])
    need(args[:2] == ['/usr/bin/env', '-i'] and args[-1] == 'worker' and args[-3] == NODE, 'fixed_clean_observer_command_required')
    env = dict(v.split('=', 1) for v in args[2:-3]); return args, env


def role_sql():
    # All effective privileges for THIS role are retained, including its existing
    # control duties. Other consumers' legitimate LOGIN/READ changes are outside
    # this observer-scoped snapshot. Required native tables remain SELECT-only.
    return """SELECT jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'inherit',rolinherit,
        'super',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit,'configuration',rolconfig)
        FROM pg_roles WHERE oid=73036832 AND rolname='yunipals_unified_support'),
      'roleDatabaseSettings',COALESCE((SELECT jsonb_agg(to_jsonb(s)ORDER BY setdatabase,setrole)FROM pg_db_role_setting s WHERE setrole=73036832),'[]'::jsonb),
      'memberships',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY roleid,member) FROM pg_auth_members a WHERE roleid=73036832 OR member=73036832),'[]'::jsonb),
      'schemas',COALESCE((SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',nspname,'usage',has_schema_privilege(73036832,oid,'USAGE'),'create',has_schema_privilege(73036832,oid,'CREATE'))ORDER BY nspname)
        FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND (has_schema_privilege(73036832,oid,'USAGE') OR has_schema_privilege(73036832,oid,'CREATE'))),'[]'::jsonb),
      'tables',COALESCE((SELECT jsonb_agg(jsonb_build_object('oid',c.oid::text,'name',n.nspname||'.'||c.relname,'owner',c.relowner::text,
        'privileges',(SELECT jsonb_agg(p ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])p WHERE has_table_privilege(73036832,c.oid,p)))ORDER BY n.nspname,c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','f')
        AND (c.relowner=73036832 OR has_table_privilege(73036832,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))),'[]'::jsonb),
      'nativeWriteAuthority',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='unified_ypal_20261023_v1' AND c.relkind IN('r','p','v','m','f') AND
          (has_table_privilege(73036832,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(73036832,c.oid,'INSERT,UPDATE,REFERENCES'))),
      'columnAcl',COALESCE((SELECT jsonb_agg(jsonb_build_object('relationOid',c.oid::text,'column',a.attname,'grantor',x.grantor::text,'grantee',x.grantee::text,'privilege',x.privilege_type,'grantable',x.is_grantable)ORDER BY c.oid,a.attnum,x.grantor,x.grantee,x.privilege_type)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        CROSS JOIN LATERAL aclexplode(a.attacl)x WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND has_schema_privilege(73036832,n.oid,'USAGE')
        AND (x.grantee IN(0,73036832) OR CASE WHEN x.grantee=0 THEN false ELSE pg_has_role(73036832,x.grantee,'USAGE') END)),'[]'::jsonb),
      'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('oid',p.oid::text,'name',n.nspname||'.'||p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',p.proowner::text,'securityDefiner',p.prosecdef)ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND has_schema_privilege(73036832,n.oid,'USAGE') AND has_function_privilege(73036832,p.oid,'EXECUTE')),'[]'::jsonb),
      'connect',has_database_privilege(73036832,current_database(),'CONNECT'))"""


def validate_role(row):
    r = row['role']; need(r and r['oid'] == ROLE_OID and r['name'] == ROLE and r['login'] is True and
        not any(r[k] for k in ['super', 'createRole', 'createDb', 'replication', 'bypassRls']) and row['connect'] is True,
        'existing_unprivileged_support_role_required')
    need(row['nativeWriteAuthority'] is False, 'native_table_and_column_writes_must_remain_absent')
    tables = {v['name']: v for v in row['tables']}; schemas = {v['name']: v for v in row['schemas']}
    need(all(schemas.get(n, {}).get('usage') is True for n in [NATIVE, CONTROL]) and
         not schemas[NATIVE]['create'], 'observer_schema_usage_without_native_create_required')
    for name in NATIVE_TABLES:
        t = tables.get(NATIVE + '.' + name, {}); need(t.get('privileges') == ['SELECT'] and t.get('owner') != ROLE_OID, 'native_observer_select_only_required')
    for name, permissions in {'release': {'SELECT'}, 'chain_status': {'SELECT', 'INSERT', 'UPDATE'}, 'chain_anchor': {'SELECT', 'INSERT', 'UPDATE', 'DELETE'}}.items():
        need(permissions <= set(tables.get(CONTROL + '.' + name, {}).get('privileges', [])), 'existing_observer_control_permissions_required')
    need(not any(t['owner'] == ROLE_OID for t in row['tables']), 'observer_must_not_own_source_or_control_tables')
    return row


class Host:
    def __init__(self, read_ack, install_ack):
        self.read_ack, self.install_ack = pin(read_ack), pin(install_ack)
        self.read = module(READ, READ_SHA)
        self.view, self.registration, self.source, self.h, self.op, self.source_ack, _, _ = self.read.load()
        self.installer = module(INSTALLER, INSTALLER_SHA); self.shared = self.installer.shared()
        self.m = self.h.m; self.a = self.m.route_owner
    def query(self, sql): return self.h.query(sql)
    def account(self):
        row = pwd.getpwnam(ROLE)
        need(row.pw_uid == 969 and row.pw_gid == 963 and row.pw_shell == '/usr/sbin/nologin' and set(os.getgrouplist(ROLE, 963)) == {963}, 'same_existing_support_unix_identity_required')
        return row
    def inputs(self):
        installed = self.installer.installed(self.shared, self.install_ack); args, env = command()
        need(args[-2] == str(self.installer.TARGET / 'dist/unified-observer.mjs'), 'exact_installed_observer_entry_required')
        self.account()
        return {'installerSha256': INSTALLER_SHA, 'installationReceiptSha256': self.install_ack,
                'installed': installed, 'templateSha256': TEMPLATE_SHA, 'command': args, 'environment': env,
                'account': {'uid': 969, 'gid': 963, 'name': ROLE}}
    def direct_source(self):
        s, h, op, ack = self.source, self.h, self.op, self.source_ack
        need(not (s.BASE / 'inverse-intent.json').exists(), 'source_inverse_must_not_have_started')
        s.static_inputs(h); s.old_private_inputs(op)
        need(s.base_code() == op['sourceCode'] and h.role() == op['sourceRole'], 'unchanged_observer_source_code_private_inputs_role_required')
        h.old_terminal(op); h.preserved_old_native(op)
        actor, native = s.bootstrap(h, op)
        need(actor == ack['source'] and native['schemaOid'] == '75963410' and native['tables'] == ack['native']['tables'], 'same_acknowledged_source_actor_build_oids_required')
        s.exact_link(s.NEW_LINK, ack['newBoot'])
        registered = self.query("SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash,'manifest',manifest) FROM yunipals_indexer_control.release WHERE id='" + RELEASE + "'")
        profile = document(OPS / 'ypal-combined-rpc-v1/profile.json', 'c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b')
        need(registered == {'id': RELEASE, 'schema': NATIVE, 'build': '71e2a7f3b7', 'manifestHash': MANIFEST, 'manifest': profile['manifest']}, 'same_registered_release_manifest_required')
        return {'actor': actor, 'sourceReceiptSha256': self.registration.SOURCE_ACK_SHA,
                'sourceOperationSha256': self.registration.SOURCE_OPERATION, 'schemaOid': native['schemaOid'],
                'tableIdentitiesSha256': sha(encoded(native['tables'])), 'registeredRelease': registered,
                'nativeSourceFiles': op['sourceCode'], 'sourceBoot': ack['newBoot']}
    def direct_routes(self):
        h, m, a = self.h, self.m, self.a
        before = m.load('before.json'); b = before['binding']
        need(b['operatorSha256'] == sha(protected(a.__file__)) and b['bootId'] == boot() and
             b['inputs'] == h.rpc.inputs(m, a) and before['reviewHash'] == sha(encoded({'binding': b, 'catalog': before['catalog']})), 'same_owned_route_review_inputs_required')
        need({c: a.plan(m, c)[0] for c in a.CHAINS} == b['plans'], 'same_owned_four_proxy_plans_required')
        receipt = document(a.BASE / 'result.json', self.source_ack['rpcResultSha256'])
        need(receipt['completed'] is True and receipt['bootId'] == boot() and receipt['freeOnly'] is True and
             receipt['paidAuthority'] is False and receipt['emptyPermits'] is True and not (a.BASE / 'restore-intent.json').exists(), 'unreversed_free_route_receipt_required')
        a.exact_catalog(m, a.catalog(m), before['catalog'], True)
        current = {c: a.owned(m, c, before) for c in a.CHAINS}
        need(current == receipt['routes'], 'same_current_free_proxy_invocations_required')
        for c in a.CHAINS: m.check_published(c + '-boot')
        return {'receiptSha256': self.source_ack['rpcResultSha256'], 'routes': current,
                'profileId': receipt['profileId'], 'manifestHash': receipt['manifestHash'], 'endpoints': receipt['endpoints'],
                'freeOnly': True, 'paidAuthority': False, 'emptyPermits': True}
    def preserved(self):
        return {'inputs': self.inputs(), 'source': self.direct_source(), 'routes': self.direct_routes(),
                'supportRole': validate_role(self.query(role_sql()))}
    def peer_inspect(self):
        args, _ = command(); command_args = ['/usr/bin/setpriv', '--reuid=969', '--regid=963', '--clear-groups',
            '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL', *args[:-1], 'inspect']
        cp = subprocess.run(command_args, env=CLEAN, cwd=str(self.installer.TARGET), capture_output=True, timeout=25)
        need(cp.returncode == 0 and not cp.stderr and len(cp.stdout) <= 4000, 'actual_zero_effect_observer_inspect_required')
        value = json.loads(cp.stdout); need(value.get('event') == 'combined_observer_inspected' and value.get('releaseId') == RELEASE and
            value.get('buildId') == '71e2a7f3b7' and value.get('running') is True and value.get('providerCalls') == value.get('writes') == 0,
            'actual_registered_native_observer_binding_required')
        return value
    def capacity(self):
        row = self.query("SELECT jsonb_build_object('roleSessions',(SELECT count(*) FROM pg_stat_activity WHERE usesysid=73036832),'roleLimit',(SELECT rolconnlimit FROM pg_roles WHERE oid=73036832),'clients',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),'maximum',current_setting('max_connections')::int,'reserved',current_setting('superuser_reserved_connections')::int+COALESCE(NULLIF(current_setting('reserved_connections',true),''),'0')::int)")
        need((row['roleLimit'] == -1 or row['roleSessions'] + 2 <= row['roleLimit']) and row['clients'] + 4 <= row['maximum'] - row['reserved'], 'existing_observer_pool_two_headroom_required')
        return row
    def control(self):
        return self.query("SELECT COALESCE(jsonb_agg(jsonb_build_object('chainId',chain_id,'revision',revision::text,'error',error_code,'finalityError',finality_error_code,'halted',halted,'ageMs',floor(extract(epoch FROM statement_timestamp()-checked_at)*1000)::bigint)ORDER BY chain_id),'[]'::jsonb) FROM yunipals_indexer_control.chain_status WHERE release_id='" + RELEASE + "' AND chain_id IN(1,56,137,8453)")
    def state(self):
        raw = self.m.run(['/usr/bin/systemctl', 'show', '--all', UNIT, *['--property=' + k for k in PROPS]], timeout=8)
        row = dict(v.split('=', 1) for v in raw.decode().splitlines())
        if row.get('LoadState') == 'not-found' and 'ExecStart' not in row:
            need(row.get('MainPID') == '0' and row.get('ControlPID') == '0' and row.get('ActiveState') == 'inactive' and row.get('FragmentPath') == row.get('DropInPaths') == '', 'verified_absent_observer_unit_required'); row['ExecStart'] = ''
        if 'EnvironmentFiles' not in row:
            path = '/org/freedesktop/systemd1/unit/' + re.sub(r'[^A-Za-z0-9]', lambda x: '_' + format(ord(x[0]), '02x'), UNIT)
            typed = json.loads(self.m.run(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1', path, 'org.freedesktop.systemd1.Service', 'EnvironmentFiles'], timeout=8)) if row.get('LoadState') != 'not-found' else {'type': 'a(sb)', 'data': []}
            need(typed == {'type': 'a(sb)', 'data': []}, 'typed_empty_observer_environment_files_required'); row['EnvironmentFiles'] = ''
        need(set(row) == set(PROPS) and row['Id'] == UNIT, 'complete_observer_manager_properties_required')
        return row
    def manager(self, action):
        need(action in {'start', 'stop', 'daemon-reload'}, 'observer_only_manager_operation_required')
        cp = subprocess.run(['/usr/bin/systemctl', action, *([] if action == 'daemon-reload' else [UNIT])], env=CLEAN, cwd='/', capture_output=True, timeout=135)
        need(cp.returncode == 0 and not cp.stdout and not cp.stderr, 'observer_manager_ack_unknown_inspect_never_retry')


def absent(h):
    row = h.state()
    need(row['LoadState'] == 'not-found' and row['MainPID'] == row['ControlPID'] == '0' and row['Job'] in {'', '0'} and
         not os.path.lexists(UNIT_FILE) and not os.path.lexists(BOOT), 'fresh_unactivated_observer_unit_required')
    need(not os.path.lexists(UNIT_FILE.parent / (UNIT + '.d')), 'no_observer_dropin_directory_required')
    return row


def no_competing_observer(h):
    # Prevent using the new session lock as a substitute for qualifying legacy
    # support actors that predate it. No query text or private environment output.
    rows = h.query("SELECT COALESCE(jsonb_agg(jsonb_build_object('pid',pid,'application',application_name)ORDER BY pid),'[]'::jsonb) FROM pg_stat_activity WHERE usesysid=73036832")
    need(not rows, 'existing_support_sessions_must_be_drained_before_observer_admission')
    for name in ['yunipals-unified-support-source6-v2.service']:
        raw = h.m.run(['/usr/bin/systemctl', 'show', '--all', name, '--property=MainPID', '--property=ControlPID', '--property=ActiveState', '--property=Job'], timeout=8)
        value = dict(v.split('=', 1) for v in raw.decode().splitlines())
        need(value.get('MainPID') == value.get('ControlPID') == '0' and value.get('ActiveState') in {'inactive', 'failed'} and value.get('Job') in {'', '0'}, 'older_support_worker_must_be_terminal')


def review(h):
    need(not os.path.lexists(BASE), 'one_observer_admission_attempt_only')
    absent(h)
    admitted = h.read.validate_current(h.read_ack)
    need(admitted['validated'] is True and admitted['operatorSha256'] == READ_SHA and admitted['receiptSha256'] == h.read_ack and
         admitted['sourceBinding']['releaseId'] == RELEASE and admitted['sourceBinding']['schema'] == NATIVE,
         'actual_current_initial_143_read_admission_required')
    first = h.preserved(); no_competing_observer(h); capacity = h.capacity(); inspected = h.peer_inspect()
    rows = h.control(); need(all(v['halted'] is False for v in rows), 'halted_source_requires_separate_resolution_before_observer_start')
    control_before = {str(v['chainId']): v['revision'] for v in rows}
    need(h.preserved() == first, 'observer_inputs_changed_during_initial_review')
    absent(h)
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(),
               'readAdmissionSha256': h.read_ack, 'initial143QualificationSha256': sha(encoded(admitted)),
               'installationReceiptSha256': h.install_ack, 'preserved': first,
               'runtimeMaximumSeconds': None, 'automaticRestart': False, 'bootEnablement': True, 'ordinarySustainedObserver': True,
               'poolMaximum': 2, 'wholeReaderGraphRequiredAfterStart': False, 'controlRevisionsBefore': control_before}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'capacity': capacity,
            'inspect': inspected, 'providerRequests': 0, 'databaseWrites': 0, 'serviceActions': 0}


def before():
    value = document(BASE / 'before.json'); b = value['binding']
    need(value['reviewHash'] == sha(encoded(b)) and b['format'] == FORMAT and b['bootId'] == boot() and
         b['operatorSha256'] == sha(protected(Path(__file__).absolute())), 'same_boot_exact_owned_observer_review_required')
    return value


def acknowledged_inputs(h, value):
    b = value['binding']
    need(h.read_ack == b['readAdmissionSha256'] and h.install_ack == b['installationReceiptSha256'], 'same_observer_admission_receipt_inputs_required')
    # Authenticate the original admission without claiming its whole graph is
    # still current. Its scope may have been legitimately extended downstream.
    h.read.admitted(h.source, h.read_ack)
    need(h.preserved() == b['preserved'], 'same_observer_scoped_source_inputs_role_and_routes_required')


def installed_unit(value):
    record = document(BASE / 'unit-installed.json')
    need(record['reviewHash'] == value['reviewHash'] and record['sha256'] == TEMPLATE_SHA and
         identity(UNIT_FILE) == record['identity'] and sha(protected(UNIT_FILE)) == TEMPLATE_SHA and
         not os.path.lexists(UNIT_FILE.parent / (UNIT + '.d')),
         'same_owned_observer_unit_required')
    return record


def check_boot(value):
    record = document(BASE / 'boot-installed.json')
    need(record['reviewHash'] == value['reviewHash'] and record['bootId'] == boot() and record['path'] == str(BOOT) and record['target'] == str(UNIT_FILE) and
         stat.S_ISLNK(BOOT.lstat().st_mode) and BOOT.lstat().st_uid == BOOT.lstat().st_gid == 0 and
         identity(BOOT) == record['identity'] and os.readlink(BOOT) == str(UNIT_FILE), 'same_owned_observer_boot_link_required')
    return record


def unit_definition(h, value, removing=False):
    installed_unit(value)
    if not removing: check_boot(value)
    row = h.state()
    required = {'LoadState': 'loaded', 'FragmentPath': str(UNIT_FILE), 'DropInPaths': '', 'User': ROLE, 'Group': ROLE,
                'Environment': '', 'EnvironmentFiles': '', 'NRestarts': '0', 'Restart': 'no',
                'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target', 'RequiredBy': '', 'TriggeredBy': '', 'Triggers': '', 'UpheldBy': '',
                'PartOf': 'yunipals-ypal-combined-source.service', 'BindsTo': 'yunipals-ypal-combined-source.service'}
    required['WorkingDirectory'] = value['binding']['preserved']['inputs']['installed']['dependencies']['target'].removesuffix('/node_modules')
    if removing:
        need((BASE / 'remove-boot-intent.json').exists(), 'owned_boot_removal_intent_required')
        required.pop('UnitFileState'); required.pop('WantedBy')
        need(row['UnitFileState'] in {'enabled', 'static', 'disabled'} and row['WantedBy'] in {'', 'multi-user.target'}, 'terminal_owned_boot_removal_state_required')
    for key, expected in required.items(): need(row[key] == expected, 'exact_loaded_observer_definition_required')
    need(row['RuntimeMaxUSec'] == 'infinity' and row['MemoryMax'] == '805306368' and
         row['CPUQuotaPerSecUSec'] in {'500ms', '500000'} and row['TimeoutStopUSec'] in {'45s', '45000000'} and
         row['NoNewPrivileges'] == 'yes' and row['CapabilityBoundingSet'] == row['AmbientCapabilities'] == '' and
         row['ProtectSystem'] == 'strict' and row['ProtectHome'] in {'yes', 'true'} and row['PrivateTmp'] in {'yes', 'true'} and
         row['RestrictSUIDSGID'] == 'yes' and set(row['RestrictAddressFamilies'].split()) == {'AF_UNIX', 'AF_INET', 'AF_INET6'} and
         row['KillMode'] == 'control-group', 'same_observer_hardening_and_finite_clock_required')
    return row


def start_intent(value, expected=None):
    intent = document(BASE / 'start-intent.json', expected)
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['reviewHash'] == value['reviewHash'] and
         intent['operatorSha256'] == value['binding']['operatorSha256'] and intent['unitSha256'] == TEMPLATE_SHA and
         intent['unitInstalledSha256'] == sha(protected(BASE / 'unit-installed.json')) and intent['bootInstalledSha256'] == sha(protected(BASE / 'boot-installed.json')) and
         type(intent['earliestMonotonicUs']) is int and intent['latestStartMonotonicUs'] == intent['earliestMonotonicUs'] + 135000000,
         'same_owned_one_shot_start_intent_required')
    return intent


def live(h, value):
    row = unit_definition(h, value); intent = start_intent(value)
    need(row['ActiveState'] == 'active' and row['SubState'] == 'running' and row['Job'] in {'', '0'} and row['ControlPID'] == '0' and
         re.fullmatch('[1-9][0-9]*', row['MainPID']) and re.fullmatch('[a-f0-9]{32}', row['InvocationID']) and
         row['ControlGroup'] == '/system.slice/' + UNIT, 'one_live_owned_observer_required')
    started = int(row['ExecMainStartTimestampMonotonic'])
    need(intent['earliestMonotonicUs'] <= started <= intent['latestStartMonotonicUs'] and started <= mono(),
         'owned_ordinary_start_window_required')
    cg = Path('/sys/fs/cgroup' + row['ControlGroup']) / 'cgroup.procs'
    need(cg.read_text().split() == [row['MainPID']], 'single_observer_process_required')
    _, env = command()
    process = h.a.peer_actor(h.m, int(row['MainPID']), h.account(), row['ControlGroup'], env)
    priv = process['privileges']
    need(set(priv['Uid'].split()) == {'969'} and set(priv['Gid'].split()) == {'963'} and set(priv['Groups'].split()) <= {'963'} and
         priv['NoNewPrivs'] == '1' and all(int(priv[k], 16) == 0 for k in ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']),
         'zero_capability_owned_support_process_required')
    need(process['commandSha256'] == sha(('\0'.join(command()[0][-3:]) + '\0').encode()) and
         process['executableSha256'] == sha(NODE.encode()) and not process['environmentFileHashes'] and
         h.state() == row and cg.read_text().split() == [row['MainPID']], 'same_exact_observer_process_argv_environment_required')
    return {'unit': UNIT, 'pid': int(row['MainPID']), 'invocation': row['InvocationID'], 'startMonotonicUs': started,
            'expiresMonotonicUs': None, 'process': process, 'unitIdentity': identity(UNIT_FILE)}


def first_cycle_complete(rows, previous):
    return (len(rows) == 4 and [v['chainId'] for v in rows] == [1, 56, 137, 8453] and
            all(re.fullmatch('[0-9]+', str(v['revision'])) and int(v['revision']) > int(previous.get(str(v['chainId']), '0')) and
                type(v['ageMs']) is int and 0 <= v['ageMs'] <= 180000 for v in rows))


def acknowledge(h, value, reconciled=False):
    acknowledged_inputs(h, value); actor = live(h, value); inspected = h.peer_inspect()
    deadline = time.monotonic() + 90
    while True:
        control = h.control()
        if first_cycle_complete(control, value['binding']['controlRevisionsBefore']): break
        need(time.monotonic() < deadline, 'observer_first_cycle_not_yet_acknowledged_inspect_no_retry')
        need(live(h, value) == actor, 'observer_changed_before_first_cycle')
        time.sleep(1)
    acknowledged_inputs(h, value)
    need(live(h, value) == actor, 'observer_changed_during_acknowledgment')
    result = {'format': FORMAT, 'completed': True, 'operatorSha256': value['binding']['operatorSha256'],
              'bootId': boot(), 'reviewHash': value['reviewHash'], 'startIntentSha256': sha(protected(BASE / 'start-intent.json')),
              'readAdmissionSha256': h.read_ack, 'installationReceiptSha256': h.install_ack, 'actor': actor,
              'observerScopeOnly': True, 'original143CurrentWholeValidatorPassed': False,
              'readerSelectionsQualified': False, 'sourceCoverageAccepted': False, 'freeOnly': True, 'paidAuthority': False,
              'receiptHistoryEnabled': False, 'sourceOrConsumerMutations': 0, 'bootEnabled': True, 'ordinarySustainedObserver': True,
              'reconciledStart': reconciled, 'actualReadOnlyInspect': inspected, 'observationLoopEntered': True, 'firstCycleControl': control}
    save('result.json', result); return result


def start(h, expected):
    value = review(h); need(value['reviewHash'] == pin(expected), 'fresh_observer_review_hash_required')
    BASE.mkdir(mode=0o700); sync(BASE.parent); save('before.json', value)
    save('install-intent.json', {'reviewHash': expected, 'bootId': boot(), 'templateSha256': TEMPLATE_SHA})
    need(not os.path.lexists(UNIT_FILE), 'fresh_observer_unit_path_required')
    fd = os.open(UNIT_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), 0o644); f.write(protected(TEMPLATE)); f.flush(); os.fsync(f.fileno())
    sync(UNIT_FILE.parent); save('unit-installed.json', {'reviewHash': expected, 'sha256': TEMPLATE_SHA, 'identity': identity(UNIT_FILE)})
    save('boot-intent.json', {'reviewHash': expected, 'bootId': boot(), 'path': str(BOOT), 'target': str(UNIT_FILE)})
    need(not os.path.lexists(BOOT), 'fresh_observer_boot_path_required')
    BOOT.symlink_to(UNIT_FILE); sync(BOOT.parent)
    save('boot-installed.json', {'reviewHash': expected, 'bootId': boot(), 'path': str(BOOT), 'target': str(UNIT_FILE), 'identity': identity(BOOT)})
    h.manager('daemon-reload'); acknowledged_inputs(h, value); no_competing_observer(h); h.capacity()
    row = unit_definition(h, value)
    need(row['ActiveState'] == 'inactive' and row['MainPID'] == row['ControlPID'] == '0' and row['Job'] in {'', '0'}, 'owned_observer_inactive_before_start_required')
    earliest = mono(); save('start-intent.json', {'format': FORMAT, 'bootId': boot(), 'reviewHash': expected,
        'operatorSha256': value['binding']['operatorSha256'], 'unitSha256': TEMPLATE_SHA,
        'unitInstalledSha256': sha(protected(BASE / 'unit-installed.json')), 'bootInstalledSha256': sha(protected(BASE / 'boot-installed.json')),
        'earliestMonotonicUs': earliest, 'latestStartMonotonicUs': earliest + 135000000, 'automaticRetryAllowed': False})
    need(h.state() == row and identity(UNIT_FILE) == document(BASE / 'unit-installed.json')['identity'], 'observer_unit_changed_after_start_intent')
    h.manager('start')
    return acknowledge(h, value)


def reconcile(h, expected):
    value = before(); start_intent(value, pin(expected))
    need(not (BASE / 'result.json').exists() and not (BASE / 'stop-intent.json').exists(), 'only_unknown_unstopped_start_can_reconcile')
    # No manager call, provider call or re-dispatch. A terminal/unfinished job is
    # left for explicit inspection/stop; it cannot become a successful ACK.
    return acknowledge(h, value, True)


def owned_result(expected):
    value = before(); result = document(BASE / 'result.json', pin(expected)); intent = start_intent(value)
    need(result['format'] == FORMAT and result['completed'] is True and result['bootId'] == boot() and
         result['operatorSha256'] == value['binding']['operatorSha256'] and result['reviewHash'] == value['reviewHash'] and
         result['startIntentSha256'] == sha(encoded(intent)) and result['readAdmissionSha256'] == value['binding']['readAdmissionSha256'] and
         result['installationReceiptSha256'] == value['binding']['installationReceiptSha256'], 'owned_observer_result_chain_required')
    return value, result


def validate_current(expected):
    value, result = owned_result(expected)
    need(not (BASE / 'stop-intent.json').exists(), 'observer_stop_has_not_started')
    h = Host(result['readAdmissionSha256'], result['installationReceiptSha256'])
    acknowledged_inputs(h, value); actor = live(h, value)
    need(actor == result['actor'], 'same_acknowledged_observer_invocation_required')
    inspected = h.peer_inspect(); acknowledged_inputs(h, value)
    need(live(h, value) == actor, 'observer_changed_during_scoped_validation')
    return {'format': FORMAT, 'validated': True, 'receiptSha256': expected, 'actor': actor,
            'releaseId': RELEASE, 'freeOnly': True, 'paidAuthority': False, 'observerScopeOnly': True,
            'original143CurrentWholeValidatorPassed': False, 'readerSelectionsQualified': False,
            'sourceCoverageAccepted': False, 'ordinarySustainedObserver': True, 'runtimeMaximumSeconds': None,
            'bootLink': document(BASE / 'boot-installed.json'), 'readOnlyInspect': inspected, 'serviceActions': 0, 'providerRequests': 0}


def terminal(h, value, actor=None):
    row = unit_definition(h, value, (BASE / 'remove-boot-intent.json').exists() and not os.path.lexists(BOOT))
    need(row['ActiveState'] in {'inactive', 'failed'} and row['MainPID'] == row['ControlPID'] == '0' and row['Job'] in {'', '0'}, 'owned_observer_terminal_without_job_required')
    cg = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
    need(not cg.exists() or not cg.read_text().split(), 'observer_cgroup_must_be_empty')
    if actor:
        need(row['InvocationID'] == actor['invocation'] and int(row['ExecMainStartTimestampMonotonic']) == actor['startMonotonicUs'] and
             not Path('/proc/' + str(actor['pid'])).exists(), 'same_owned_terminal_observer_required')
    return row


def finish_stop(h, expected):
    value = before(); intent = document(BASE / 'stop-intent.json', pin(expected))
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['reviewHash'] == value['reviewHash'] and
         intent['operatorSha256'] == value['binding']['operatorSha256'], 'same_owned_stop_intent_required')
    need(not (BASE / 'stopped.json').exists(), 'one_owned_stop_completion_only')
    # Never repeats StopUnit. If the first stop is still running/unknown, this
    # phase refuses until authoritative terminal state is observable.
    if os.path.lexists(UNIT_FILE):
        terminal(h, value, intent['actor'])
        if os.path.lexists(BOOT):
            boot_record = check_boot(value)
            if not (BASE / 'remove-boot-intent.json').exists(): save('remove-boot-intent.json', {'stopIntentSha256': expected, 'boot': boot_record, 'bootId': boot()})
            need(document(BASE / 'remove-boot-intent.json') == {'stopIntentSha256': expected, 'boot': boot_record, 'bootId': boot()}, 'exact_owned_boot_removal_intent_required')
            terminal(h, value, intent['actor']); check_boot(value); BOOT.unlink(); sync(BOOT.parent)
        else:
            removal_boot = document(BASE / 'remove-boot-intent.json')
            need(removal_boot['stopIntentSha256'] == expected and removal_boot['bootId'] == boot(), 'owned_boot_removal_required')
        record = installed_unit(value)
        if not (BASE / 'remove-unit-intent.json').exists():
            save('remove-unit-intent.json', {'stopIntentSha256': expected, 'unitIdentity': record['identity'], 'bootId': boot()})
        removal = document(BASE / 'remove-unit-intent.json')
        need(removal == {'stopIntentSha256': expected, 'unitIdentity': record['identity'], 'bootId': boot()}, 'exact_owned_removal_intent_required')
        terminal(h, value, intent['actor']); need(identity(UNIT_FILE) == record['identity'], 'owned_unit_changed_immediately_before_remove')
        UNIT_FILE.unlink(); sync(UNIT_FILE.parent)
    else:
        removal = document(BASE / 'remove-unit-intent.json')
        need(removal['stopIntentSha256'] == expected and removal['bootId'] == boot() and not os.path.lexists(BOOT), 'owned_unit_removal_must_be_acknowledged')
    row = h.state(); need(row['MainPID'] == row['ControlPID'] == '0' and row['Job'] in {'', '0'} and row['ActiveState'] in {'inactive', 'failed'}, 'terminal_observer_before_removal_reload_required')
    cg = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
    need(not cg.exists() or not cg.read_text().split(), 'no_observer_process_after_unit_removal')
    h.manager('daemon-reload'); absent(h)
    result = {'format': FORMAT, 'stopped': True, 'stopIntentSha256': expected, 'actor': intent['actor'],
              'bootId': boot(), 'unitRemoved': True, 'ownedBootRemoved': True,
              'sourceAndControlDataPreserved': True, 'databaseWrites': 0, 'providerRequests': 0}
    save('stopped.json', result); return result


def stop(h, expected, unknown=False):
    value = before()
    if unknown: start_intent(value, pin(expected)); actor = None
    else: value, result = owned_result(expected); actor = result['actor']
    need(not (BASE / 'stop-intent.json').exists(), 'one_owned_stop_attempt_only')
    row = unit_definition(h, value)
    active = row['ActiveState'] == 'active'
    if active:
        current = live(h, value); need(actor is None or current == actor, 'same_owned_actor_before_stop'); actor = current
    else: terminal(h, value, actor)
    # Stopping our exact actor needs no healthy upstream, unchanged consumer
    # graph, source heartbeat or database. Unit/process ownership remains exact.
    stop_sha = save('stop-intent.json', {'format': FORMAT, 'bootId': boot(), 'reviewHash': value['reviewHash'],
        'operatorSha256': value['binding']['operatorSha256'], 'actor': actor, 'sourceReceiptSha256': expected,
        'unknownStart': unknown, 'monotonicUs': mono(), 'automaticRetryAllowed': False})
    if active:
        need(live(h, value) == actor, 'observer_actor_changed_after_stop_intent')
        h.manager('stop')
    return finish_stop(h, stop_sha)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    phase = parser.add_mutually_exclusive_group()
    phase.add_argument('--start', action='store_true'); phase.add_argument('--reconcile', action='store_true')
    phase.add_argument('--validate', action='store_true'); phase.add_argument('--stop', action='store_true')
    phase.add_argument('--stop-unknown', action='store_true'); phase.add_argument('--finish-stop', action='store_true')
    parser.add_argument('--read-ack'); parser.add_argument('--install-ack'); parser.add_argument('--expected')
    args = parser.parse_args(); need(os.geteuid() == 0 and socket.gethostname() == 'yunipals-main', 'root_on_exact_host_required')
    os.umask(0o077)
    if args.validate:
        print(json.dumps(validate_current(pin(args.expected)), sort_keys=True)); return
    if args.reconcile or args.stop or args.stop_unknown or args.finish_stop:
        b = before()['binding']; h = Host(b['readAdmissionSha256'], b['installationReceiptSha256'])
    else: h = Host(pin(args.read_ack), pin(args.install_ack))
    with h.source.transition_lock():
        if args.start: result = start(h, args.expected)
        elif args.reconcile: result = reconcile(h, args.expected)
        elif args.stop: result = stop(h, args.expected)
        elif args.stop_unknown: result = stop(h, args.expected, True)
        elif args.finish_stop: result = finish_stop(h, args.expected)
        else: result = review(h)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    def expired(*_): raise RuntimeError('observer_owner_deadline_expired_inspect_no_retry')
    signal.signal(signal.SIGALRM, expired); signal.alarm(420)
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'bounded_observer_owner_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code, 'automaticRetryAllowed': False}))
        raise SystemExit(1)
