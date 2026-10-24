#!/usr/bin/env python3
"""Owned cache drain/catalog transition/worker selection. Default is read-only."""
import argparse
import copy
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import subprocess
import time
import types
import urllib.request

FORMAT = 'yunipals-ypal-cache-guard-owner-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-cache-guard-owner-v1-20261024')
UNIT = 'yunipals-read-cache.service'
DROP = Path('/etc/systemd/system') / (UNIT + '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-read-cache.conf')
BOOT = Path('/etc/systemd/system/multi-user.target.wants') / UNIT
CANDIDATES = Path('/var/backups/yunipals-ypal-generation-cache-candidates-v1-20261024')
CANDIDATE_SHA = '53826e1e87e4d72301992b267223b4d759298478ca95daedee0723b777f33b72'
CANDIDATE_OWNER_SHA = '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3'
READ = OPS / 'ypal-combined-read-admission-v2.py'
READ_SHA = 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'
META_OWNER = OPS / 'ypal-native-metadata-handover-v1.py'
META_OWNER_SHA = '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1'
META = Path('/var/backups/yunipals-ypal-native-metadata-handover-v1-20261024')
GENERATION_OWNER = OPS / 'ypal-native-generation-v1.py'
# Accepted candidate/database leaf only; it confers no source or reader readiness.
GENERATION_OWNER_SHA = '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6'
GENERATION = Path('/var/backups/yunipals-ypal-native-generation-v1-20261024/candidate-result.json')
# Root owns the separate coordinated publication/reader switch, not this owner.
COORDINATED_OWNER = None
COORDINATED_OWNER_SHA = None
ENTRY = OPS / 'ypal-cache-guard-owner-v1.mjs'
ENTRY_SHA = 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551'
COMPONENT = OPS / 'ypal-cache-guard-transition-v1.mjs'
COMPONENT_SHA = '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2'
RETAINED = OPS / 'retained-workers-stage-v1.py'
RETAINED_SHA = '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
IDENTITY = '0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'
PROJECT = Path('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer')
TSX = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6/apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs')
NODE = '/opt/node-v24.18.1/bin/node'
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
COLLECTOR = 'yunipals_unified_collector'
COLLECTOR_OID = '73187672'
CACHE_TABLES = tuple('metadata_projection.' + n for n in ['read_epoch', 'read_guard', 'read_set', 'read_member'])
PROPS = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'InvocationID', 'ControlGroup',
         'ExecStart', 'NRestarts', 'User', 'Group', 'FragmentPath', 'DropInPaths', 'WorkingDirectory',
         'EnvironmentFiles', 'Job', 'Restart', 'UnitFileState', 'WantedBy', 'RequiredBy', 'TriggeredBy', 'Triggers', 'PartOf', 'UpheldBy')


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def js_encoded(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def protected(path, cap=3000000):
    path = Path(path)
    for item in [path, *path.parents]:
        st = item.lstat()
        need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_cache_owner_input_required')
    before = path.stat(); need(stat.S_ISREG(before.st_mode) and before.st_size <= cap, 'bounded_cache_owner_input_required')
    raw = path.read_bytes(); after = path.stat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'cache_input_changed_during_read')
    return raw


def document(path, pin=None):
    raw = protected(path); need(pin is None or sha(raw) == pin, 'exact_cache_owned_record_required'); return json.loads(raw)


def module(path, pin):
    need(isinstance(pin, str) and re.fullmatch('[0-9a-f]{64}', pin), 'cache_dependency_not_yet_frozen')
    raw = protected(path); need(sha(raw) == pin, 'exact_cache_owner_dependency_required')
    value = types.ModuleType('cache_' + Path(path).stem.replace('-', '_')); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(name, value):
    path = BASE / name; raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), 0o600); f.write(raw); f.flush(); os.fsync(f.fileno())
    sync(BASE); return sha(raw)


def inode(path, symlink=False):
    st = path.lstat()
    need(st.st_uid == st.st_gid == 0 and st.st_nlink == 1 and (stat.S_ISLNK(st.st_mode) if symlink else stat.S_ISREG(st.st_mode)), 'exact_owned_cache_file_type_required')
    return {'dev': st.st_dev, 'ino': st.st_ino, 'mode': st.st_mode, 'uid': st.st_uid, 'gid': st.st_gid,
            **({'target': os.readlink(path)} if symlink else {'sha256': sha(protected(path))})}


def exact_four(plan):
    delta = plan['addedSelects']
    need(len(delta) == 4 and {v['name'] for v in delta} == set(CACHE_TABLES), 'exact_four_cache_SELECTs_required')
    for row in delta:
        need(row['role'] == COLLECTOR and row['grantee'] == COLLECTOR_OID and row['privilege'] == 'SELECT' and
             row['grantable'] is False and re.fullmatch('[1-9][0-9]*', row['grantor']), 'only_fixed_collector_SELECT_additions_allowed')
        need(not any(v['name'] == row['name'] and v['grantee'] == row['grantee'] and v['privilege'] == 'SELECT' for v in plan['before']['acl']), 'cache_SELECT_must_be_new_owned_edge')
    return delta


def read_extension(before, after, plan, acknowledged_after):
    """Compare the complete READ catalogue; only four proven cache reads differ."""
    exact_four(plan)
    def cache_relations(value):
        rows = [v for v in value['relations'] if v['schema'] + '.' + v['name'] in CACHE_TABLES]
        need(len(rows) == 4 and {v['schema'] + '.' + v['name'] for v in rows} == set(CACHE_TABLES),
             'complete_four_cache_relation_catalogue_required')
        return {v['schema'] + '.' + v['name']: v for v in rows}
    # Managed direct/effective edges cannot see an unrelated grantee. Keep each
    # complete relation ACL (all grantees/grantors) bound to the acknowledged
    # postcatalog rather than normalizing a newly observed foreign grant.
    need(cache_relations(after) == cache_relations(acknowledged_after),
         'exact_acknowledged_cache_relation_ACLs_required')
    a, b = copy.deepcopy(before), copy.deepcopy(after)
    # Source/adoption selectors are owned by their independent owners.
    for v in (a, b):
        v.pop('activeRelease', None); v.pop('nativeMetadataAdoptions', None)
    expected = set()
    for grant in plan['addedSelects']:
        table = next(v for v in plan['after']['tables'] if v['name'] == grant['name'])
        expected.add(('relation', table['oid'], grant['name'], grant['grantee'], grant['grantor'], 'SELECT', False, None))
    def edge(v): return tuple(v.get(k) for k in ('kind', 'object', 'object_name', 'grantee', 'grantor', 'privilege', 'grantable', 'column_number'))
    prior, actual = {edge(v) for v in a.pop('directRoleEdges')}, {edge(v) for v in b.pop('directRoleEdges')}
    need(prior <= actual and actual - prior == expected, 'only_four_acknowledged_direct_READ_edges_required')
    for old, now in zip(a['relations'], b['relations']):
        if old['schema'] + '.' + old['name'] in CACHE_TABLES:
            old['acl'] = now['acl']
    for old, now in zip(a['effective'], b['effective']):
        if old['role'] == COLLECTOR:
            for table in CACHE_TABLES:
                need(old['relations'][table]['select'] is False and now['relations'][table]['select'] is True and
                     old['relations'][table]['writes'] == now['relations'][table]['writes'], 'only_effective_cache_SELECT_change_allowed')
                old['relations'][table]['select'] = True
    need(a == b, 'all_other_roles_READs_catalogues_and_column_ACLs_must_remain_exact')


def extended_plan(read_plan, cache_plan):
    """A separate explicit proof scope; never mutate or relabel the 143 plan."""
    exact_four(cache_plan); value = copy.deepcopy(read_plan)
    value['missingPermissions'] += [
        {'role': COLLECTOR, 'kind': 'relation', 'object': next(t['oid'] for t in cache_plan['after']['tables'] if t['name'] == v['name']),
         'grantor': v['grantor'], 'privilege': 'SELECT', 'grantee': COLLECTOR_OID, 'name': v['name']}
        for v in cache_plan['addedSelects']]
    value['format'] = 'yunipals-cache-read-preservation-proof-v1'
    value['missingCount'] = len(value['missingPermissions'])
    value['original143PlanSha256'] = sha(encoded(read_plan))
    value['separateCacheReadDeltaSha256'] = sha(encoded(cache_plan['addedSelects']))
    value['readGrantAuthorityClaimed'] = False
    return value


def sql_child(host, mode, plan=None, prepared=None, generation=None, plan_json=None):
    need(mode in {'inspect', 'freshness', 'rehearse', 'apply', 'inverse'}, 'fixed_cache_sql_mode_required')
    sentinel = '/run/yunipals-cache-owner-no-password-file'
    need(not os.path.lexists(sentinel), 'absent_cache_peer_password_file_required')
    env = {**CLEAN, 'TSX_DISABLE_CACHE': '1', 'NODE_OPTIONS': '--max-old-space-size=384',
           'PGPASSFILE': sentinel,
           'YUNIPALS_CACHE_OWNER_PID': str(os.getpid()), 'DATABASE_SCHEMA': 'unified_ypal_20261023_v1',
           'READ_DATABASE_SCHEMA': 'yunipals_ownership_4e77f52b_v4', 'OWNERSHIP_READ_MODE': 'unified',
           'OWNERSHIP_READ_SCHEMA': 'yunipals_ownership_4e77f52b_v4', 'OWNERSHIP_RELEASE_ID': RELEASE,
           'BASE_METADATA_INGESTION': 'native', 'METADATA_SOURCE_MODE': 'archive', 'YUNIPALS_PROJECTION_MODE': 'generation'}
    args = ['/usr/bin/setpriv', '--reuid=111', '--regid=113', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all',
            '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL', '/usr/bin/env', '-i',
            *[k + '=' + v for k, v in env.items()], NODE, '--import', str(TSX), str(ENTRY)]
    if mode in {'apply', 'inverse'}:
        need(isinstance(plan_json, str) and json.loads(plan_json) == plan, 'exact_original_JS_plan_serialization_required')
    request = {'mode': mode, 'planJson': plan_json, 'catalogSql': protected(host.read.SQL).decode(), 'readerSql': host.reader_sql, 'generationId': generation}
    deadline = time.monotonic() + 100
    proc = subprocess.Popen(args, cwd=PROJECT, env=CLEAN, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, start_new_session=True)
    events = []; byte_count = 0; started = None
    try:
        if mode in {'rehearse', 'apply', 'inverse'}:
            started = {'actor': host.m.process(str(proc.pid)), 'processGroup': proc.pid,
                 'bootId': boot(), 'mode': mode, 'rootParentPid': os.getpid(), 'entrySha256': ENTRY_SHA, 'componentSha256': COMPONENT_SHA}
            save(mode + '-sql-child.json', started)
        proc.stdin.write(encoded(request)); proc.stdin.flush()
        monitor = selectors.DefaultSelector(); monitor.register(proc.stdout, selectors.EVENT_READ); pending = b''
        while True:
            need(time.monotonic() < deadline, 'cache_sql_child_deadline_expired')
            ready = monitor.select(min(1, deadline - time.monotonic()))
            if not ready:
                need(proc.poll() is None, 'cache_sql_terminal_without_result'); continue
            chunk = os.read(proc.stdout.fileno(), 65536); need(chunk, 'cache_sql_ACK_unknown_reconcile_only')
            byte_count += len(chunk); need(byte_count <= 6000000, 'bounded_cache_sql_protocol_required'); pending += chunk
            while b'\n' in pending:
                row, pending = pending.split(b'\n', 1); value = json.loads(row); events.append(value)
                if value.get('event') == 'transaction-opened':
                    need(value['format'] == 'yunipals-ypal-cache-guard-sql-v1' and value['mode'] == mode and
                         re.fullmatch('[1-9][0-9]*', value['xid']) and started is not None and
                         host.m.process(str(proc.pid)) == started['actor'] and
                         sum(e.get('event') == 'transaction-opened' for e in events) == 1, 'one_owned_cache_SQL_transaction_required')
                    sessions = host.sql_session(started['actor'], value['backend'], value['xid'])
                    save(mode + '-sql-opened.json', {'message': value, 'sessions': sessions, 'childFileSha256': sha(protected(BASE / (mode + '-sql-child.json')))})
                    proc.stdin.write(encoded({'event': 'transaction-opened-recorded', 'xid': value['xid'], 'openedSha256': sha(js_encoded(value))})); proc.stdin.flush()
                elif value.get('event') == 'commit-prepared':
                    need(prepared is not None and sum(e.get('event') == 'commit-prepared' for e in events) == 1,
                         'single_durable_cache_commit_authority_required')
                    prepared(value)
                    proc.stdin.write(encoded({'event': 'commit-authorized', 'xid': value['xid'], 'preparedSha256': sha(js_encoded(value))})); proc.stdin.flush()
                elif value.get('event') == 'result':
                    proc.stdin.close(); need(proc.wait(timeout=5) == 0 and not proc.stderr.read(1000000), 'cache_sql_terminal_ACK_required')
                    result = value['value']; need(result['format'] == 'yunipals-ypal-cache-guard-sql-v1', 'exact_cache_SQL_result_producer_required')
                    if mode in {'apply', 'inverse', 'rehearse'}:
                        need((BASE / (mode + '-sql-opened.json')).exists() and result['acknowledged'] is True and result['mode'] == mode and re.fullmatch('[1-9][0-9]*', result['xid']) and
                             json.loads(result['resultJson']) == result['result'], 'same_cache_SQL_phase_and_literal_result_required')
                    else: need(result['inspected'] is True and result['databaseWrites'] == 0, 'readonly_cache_SQL_result_required')
                    return result
                else: need(False, 'cache_sql_child_refused_preserve_intent')
    finally:
        if proc.poll() is None: os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=5)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream and not stream.closed: stream.close()


class Host:
    def __init__(self, config):
        self.config = config; self.read = module(READ, READ_SHA)
        self.context = self.read.load(); self.view, self.r, self.s, self.h, self.source_op, self.source_ack, self.plan, self.catalog_sql = self.context
        self.m = module(RETAINED, RETAINED_SHA)
        self.m.artifact()
        self.candidate_owner = module(OPS / 'ypal-generation-cache-candidates-v1.py', CANDIDATE_OWNER_SHA)
        self.candidate = document(CANDIDATES / 'result.json', CANDIDATE_SHA)
        need(self.candidate['staged'] is True and self.candidate['selected'] is False and self.candidate['sourceRelease'] == RELEASE and
             self.candidate['readIdentity'] == IDENTITY, 'same_unselected_cache_candidate_required')
        self.read_receipt, self.read_before, self.read_rehearsal = self.read.admitted(self.s, config['readAdmissionSha256'])
        _, self.reader_sql = self.read.reader_catalog(self.h)
    def query(self, query): return self.h.query(query)
    def state(self):
        raw = self.m.run(['/usr/bin/systemctl', 'show', '--all', UNIT, *['--property=' + k for k in PROPS]])
        value = {}
        for line in raw.decode().splitlines():
            key, sep, val = line.partition('='); need(sep and key in PROPS, 'fixed_cache_manager_state_required')
            if key == 'EnvironmentFiles': value.setdefault(key, []).append(val)
            else: need(key not in value, 'unique_cache_manager_properties_required'); value[key] = val
        need(set(value) == set(PROPS) and value['Id'] == UNIT and value['LoadState'] == 'loaded', 'complete_fixed_cache_unit_required')
        need(value['ControlGroup'] in {'', '/system.slice/' + UNIT}, 'fixed_cache_cgroup_required')
        return value
    def private(self):
        before = self.candidate['originalCacheWriter']
        for p, pin in before['inputHashes'].items(): need(sha(protected(p)) == pin, 'original_cache_private_file_or_definition_changed')
        for name, pin in before['managerEnvironmentHashes'].items():
            need(sha(encoded(self.m.service_property(UNIT, name))) == pin, 'original_cache_inline_environment_changed')
        need(inode(BOOT, True) == document(BASE / 'before.json')['binding']['boot'] if os.path.lexists(BOOT) and (BASE / 'before.json').exists() else True,
             'same_cache_activation_inode_required')
    def actor(self, native=False, original=True):
        self.private(); value = self.state()
        need(value['ActiveState'] == 'active' and value['SubState'] == 'running' and value['Job'] == '' and
             value['ControlPID'] == '0' and re.fullmatch('[1-9][0-9]*', value['MainPID']), 'running_exact_cache_actor_required')
        old = self.candidate['originalCacheWriter']; pid = int(value['MainPID']); main = self.m.process(str(pid))
        definitions = {p: sha(protected(p)) for p in [value['FragmentPath'], *value['DropInPaths'].split()]}
        expected = {p: pin for p, pin in old['inputHashes'].items() if p.endswith('.service')}
        need(value['User'] == old['state']['User'] and value['Group'] == old['state']['Group'] and
             value['Restart'] == old['state']['Restart'], 'same_original_cache_OS_identity_and_restart_policy_required')
        if native:
            expected[str(DROP)] = self.candidate['files'][UNIT + '.drop-in.candidate']
            need(inode(DROP) == document(BASE / 'drop-published.json'), 'owned_cache_overlay_inode_required')
            need(value['WorkingDirectory'] == str(PROJECT) and value['NRestarts'] == '0', 'fresh_owned_cache_worker_required')
            names = self.m.ordered_files(value['EnvironmentFiles'])
            need(names == [('/etc/yunipals-indexer/read-cache.env', False), (str(CANDIDATES / 'yunipals-read-cache.ownership.env'), False)], 'exact_cache_private_then_public_selector_order_required')
            env = {}
            for p, _ in names: env.update(self.m.parse_env(protected(p)))
            actual = self.m.process_env(str(pid))
            need(all(actual.get(k) == env.get(k) for k in set(env) | set(self.m.RECOVERY_KEYS)), 'configured_cache_environment_must_match_actual_process')
            command = [NODE, '--import', 'tsx', str(PROJECT / 'lib/metadata/read-cache-worker.ts')]
            need(Path('/proc/' + str(pid) + '/cmdline').read_bytes() == b'\0'.join(v.encode() for v in command) + b'\0', 'exact_official_cache_worker_command_required')
        else:
            need(value['WorkingDirectory'] == old['state']['WorkingDirectory'] and
                 sha(Path('/proc/' + str(pid) + '/cmdline').read_bytes()) == old['argvSha256'], 'exact_original_cache_command_required')
            if original: need(main == old['process'] and value['InvocationID'] == old['state']['InvocationID'], 'same_original_cache_invocation_required')
            else: need(value['NRestarts'] == '0', 'acknowledged_restored_cache_must_not_auto_restart')
            need(self.m.ordered_files(value['EnvironmentFiles']) == [('/etc/yunipals-indexer/read-cache.env', False)], 'same_original_cache_environment_file_order_required')
            expected_env = self.m.parse_env(protected('/etc/yunipals-indexer/read-cache.env')); live_env = self.m.process_env(str(pid))
            need(all(live_env.get(k) == expected_env.get(k) for k in set(expected_env) | set(self.m.RECOVERY_KEYS)), 'actual_original_cache_environment_must_match_preserved_private_file')
        need(definitions == expected, 'same_cache_base_and_only_owned_overlay_required')
        group = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
        pids = sorted(int(v) for v in group.read_text().split()); need(pid in pids and 1 <= len(pids) <= 8, 'bounded_cache_cgroup_required')
        actors = []
        for member in pids:
            status = Path('/proc/' + str(member) + '/status').read_text()
            need(re.search(r'^Uid:\s+111\s+111\s+111\s+111$', status, re.M) and
                 re.search(r'^Gid:\s+113\s+113\s+113\s+113$', status, re.M), 'same_postgres_cache_cgroup_identity_required')
            actors.append(self.m.process(str(member)))
        need(self.state() == value and self.m.process(str(pid)) == main, 'cache_actor_changed_during_capture')
        return {'unit': value, 'main': main, 'processes': actors, 'definitions': definitions}
    def sessions(self, actor):
        sql = "SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=(SELECT oid FROM pg_roles WHERE rolname='postgres')AND datid=17584 AND pid<>pg_backend_pid()"
        rows = self.query(sql); need(len(rows) <= 128, 'bounded_shared_postgres_peer_inventory_required')
        observer = self.h.observer
        backend = observer.peer_fds([r['pid'] for r in rows], 111, 113)
        peers = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
        tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
        owned = observer.map_owned_backends(observer.peer_fds([p['pid'] for p in actor['processes']], 111, 113), backend, rows, peers, tcp)
        need(self.query(sql) == rows, 'cache_session_churn_requires_new_readonly_observation')
        return {'owned': owned, 'kernelPeerAttribution': True, 'globalRoleZeroRequired': False}
    def sql_session(self, actor, backend, xid):
        need(backend['roleOid'] == '10' and backend['databaseOid'] == '17584' and int(backend['xid']) == int(xid) % (1 << 32), 'actual_cache_owner_XID_backend_required')
        pid = backend['pid']; need(type(pid) is int and pid > 0, 'actual_cache_SQL_backend_PID_required')
        sql = "SELECT COALESCE((SELECT jsonb_build_object('pid',pid,'backendStart',(extract(epoch from backend_start)*1000000)::numeric(30,0)::text,'clientAddress',client_addr::text,'clientPort',client_port)FROM pg_stat_activity WHERE pid=" + str(pid) + " AND usesysid=10 AND datid=17584),'null'::jsonb)"
        row = self.query(sql)
        need(row == {k: backend[k] for k in ['pid', 'backendStart', 'clientAddress', 'clientPort']}, 'same_actual_cache_SQL_backend_identity_required')
        observer = self.h.observer; server = observer.peer_fds([pid], 111, 113)
        clients = observer.peer_fds([actor['pid']], 111, 113); peers = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
        tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
        owned = observer.map_owned_backends(clients, server, [row], peers, tcp)
        need(len(owned) == 1 and owned[0]['pid'] == pid and owned[0]['backendStart'] == backend['backendStart'] and self.query(sql) == row,
             'kernel_owned_cache_SQL_backend_required_before_mutation')
        return owned
    def terminal(self, actor, sessions):
        value = self.state()
        need(value['ActiveState'] in {'inactive', 'failed'} and value['MainPID'] == value['ControlPID'] == '0' and value['Job'] == '', 'terminal_cache_manager_state_required')
        group = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
        need(not group.exists() or not group.read_text().split(), 'empty_cache_cgroup_required')
        for item in actor['processes']:
            try: now = self.m.process(str(item['pid']))
            except (FileNotFoundError, ProcessLookupError): continue
            need(now != item, 'owned_cache_process_must_be_gone')
        rows = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND pid<>pg_backend_pid()")
        need(not any(v['pid'] == old['pid'] and v['backendStart'] == old['backendStart'] for v in rows for old in sessions['owned']), 'exact_owned_cache_PG_subset_must_be_drained')
        self.private(); return value
    def refresh(self):
        for name, pin in self.candidate['files'].items(): need(sha(protected(CANDIDATES / name)) == pin, 'exact_dormant_cache_candidate_files_required')
        closure = self.candidate['officialSourceClosure']
        need(len(closure) == len(self.candidate_owner.CLOSURE) and {row['path'] for row in closure} == set(self.candidate_owner.CLOSURE),
             'same_finite_official_generation_cache_source_closure_required')
        for row in closure:
            raw = protected(PROJECT / row['path'])
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'unchanged_accepted_official_cache_worker_sources_required')
        if (BASE / 'sql-committed.json').exists() and not (BASE / 'sql-inversed.json').exists(): return validate_reads(self)
        return self.read.validate_current(self.config['readAdmissionSha256'])
    def metadata_current(self, generation, selection):
        owner = module(META_OWNER, META_OWNER_SHA); cache = self
        # A new, explicit proof context. The frozen metadata owner and its
        # original admission validator are never modified or reported passed.
        class CacheReadMetadataContext(owner.Host):
            def __init__(self):
                self.meta = module(owner.META_FILE, owner.META_SHA)
                self.s, self.h, self.m, self.installer, self.reader, self.source_op, self.source, self.created = self.meta.load(self.meta.READ_RESULT_SHA)
                self.admission_pin = cache.config['readAdmissionSha256']
                self.candidate = document(owner.CANDIDATES / 'result.json', owner.CANDIDATE_SHA)
                need(self.candidate['staged'] is True and self.candidate['selected'] is False and self.candidate['adopted'] is False and
                     self.candidate['readviewResultSha256'] == self.meta.READ_RESULT_SHA, 'same_owned_native_metadata_candidate_required')
            def refresh(self):
                proof = cache.refresh()
                for name, expected in self.candidate['files'].items():
                    need(sha(protected(owner.CANDIDATES / name)) == expected, 'same_staged_metadata_candidate_files_required')
                return proof
        context = CacheReadMetadataContext()
        op = owner.operation(context, generation['metadataOperationSha256'])
        first = context.actor(op, True)
        need(first == selection['nativeActor'] and owner.link(owner.BOOT) == selection['boot'], 'same_selected_native_metadata_actor_and_activation_required')
        db = context.database(); publication = context.publication_proof()
        need(db['probe'] is True and db['scan']['ingestion_mode'] == 'native' and db['remainingPublished'] == 0 and
             publication['allPublishedCanonical'] is True, 'current_native_metadata_and_all_published_provenance_required')
        context.refresh()
        need(context.actor(op, True) == first and owner.link(owner.BOOT) == selection['boot'], 'native_metadata_actor_changed_during_cache_qualification')
        return {'metadataOperationSha256': generation['metadataOperationSha256'], 'actorSha256': sha(encoded(first)),
                'bootSha256': sha(encoded(selection['boot'])), 'currentNativeMetadataQualified': True,
                'publicationSqlSha256': publication['officialSqlSha256'], 'allPublishedCanonical': True,
                'original143WholeValidatorPassed': False}
    def prerequisites(self, published=False, coordinated_sha=None):
        module(META_OWNER, META_OWNER_SHA); generation_owner = module(GENERATION_OWNER, GENERATION_OWNER_SHA)
        selection = document(META / 'selected.json', self.config['metadataSelectionSha256'])
        provenance = document(META / self.config['metadataProvenanceFile'], self.config['metadataProvenanceSha256'])
        generation = document(GENERATION, self.config['generationSha256'])
        need(selection['selected'] is True and provenance['completeForCurrentPublishedArchiveBase'] is True and
             provenance['remainingPublished'] == 0 and provenance['publicationProof']['allPublishedCanonical'] is True,
             'accepted_current_native_metadata_provenance_required')
        need(generation['format'] == 'yunipals-ypal-native-generation-candidate-v1' and generation['completed'] is True and
             generation['built'] is True and generation['validated'] is True and generation['published'] is False and
             generation['sourceRelease'] == RELEASE and generation['readIdentity'] == IDENTITY and
             generation['readAdmissionSha256'] == self.config['readAdmissionSha256'] and
             generation['metadataSelectedSha256'] == self.config['metadataSelectionSha256'] and
             generation['metadataProvenanceSha256'] == self.config['metadataProvenanceSha256'] and generation['candidateSelectorsSha256'] == CANDIDATE_SHA and
             generation['predecessorGenerationId'] == '103' and generation['generationId'] != '103' and
             re.fullmatch('[1-9][0-9]*', generation['generationId']), 'actual_built_unpublished_native_candidate_required')
        if published:
            need(COORDINATED_OWNER is not None and COORDINATED_OWNER_SHA is not None, 'coordinated_publication_reader_producer_not_yet_frozen')
            coordinator = module(COORDINATED_OWNER, COORDINATED_OWNER_SHA)
            proof = coordinator.validate_cache_ready(coordinated_sha, sha(protected(BASE / 'prepared.json')), self.config['generationSha256'])
            need(proof['validated'] is True and proof['nativeGenerationPublished'] is True and proof['readersCutOver'] is True and
                 proof['generationId'] == generation['generationId'], 'actual_coordinated_publication_and_reader_cutover_ACK_required')
        else:
            proof = generation_owner.validate_candidate_database_current(self.config['generationSha256'])
            need(proof['validated'] is True and proof['operatorSha256'] == GENERATION_OWNER_SHA and proof['receiptSha256'] == self.config['generationSha256'] and
                 proof['generationId'] == generation['generationId'] and proof['sourceRelease'] == RELEASE and proof['readIdentity'] == IDENTITY and
                 proof['published'] is False and proof['globalContextUnchanged'] is True and proof['sourceReadinessQualified'] is False and
                 proof['metadataCurrentReadinessQualified'] is False and proof['readAdmissionGraphQualified'] is False,
                 'actual_unpublished_candidate_and_unchanged_legacy_global_state_required')
        current = self.query("SELECT jsonb_build_object('current',(SELECT current_id::text FROM metadata_projection.active WHERE singleton),'id',g.id::text,'state',g.state,'published',g.published_at IS NOT NULL,'release',g.ownership_release_id,'identity',g.ownership_read_identity,'baseFrame',EXISTS(SELECT 1 FROM yunipals_ownership_4e77f52b_v4.base_metadata_frame(true)))FROM metadata_projection.generation g WHERE g.id=" + generation['generationId'])
        need(current == {'current': generation['generationId'] if published else '103', 'id': generation['generationId'], 'state': 'ready',
             'published': published, 'release': RELEASE, 'identity': IDENTITY, 'baseFrame': True}, 'actual_generation_candidate_or_coordinated_pointer_required')
        metadata = self.metadata_current(generation, selection)
        return {'generationId': generation['generationId'], 'generationReceiptSha256': self.config['generationSha256'], 'metadataCurrentProof': metadata,
                'metadataSelectionSha256': self.config['metadataSelectionSha256'], 'metadataProvenanceSha256': self.config['metadataProvenanceSha256']}


def validate_reads(host):
    saved = document(BASE / 'sql-committed.json'); plan = saved['result']; exact_four(plan)
    before, _ = owned(host)
    need(saved['operatorSha256'] == before['binding']['operatorSha256'] and saved['bootId'] == boot() and
         saved['reviewHash'] == before['reviewHash'] and saved['commitIntentSha256'] == sha(protected(BASE / 'sql-intent.json')) and
         saved['preparedSha256'] == sha(protected(BASE / 'sql-prepared.json')) and saved['xid'] == document(BASE / 'sql-prepared.json')['xid'],
         'exact_owned_four_READ_SQL_acknowledgement_chain_required')
    need(saved['readAdmissionSha256'] == host.config['readAdmissionSha256'], 'cache_and_143_READ_ACKs_must_be_distinct_exact_chain')
    current = host.view.query(host.h, host.catalog_sql)[0]
    read_extension(host.read_rehearsal['after'], current, plan, saved['postProof']['catalog'])
    combined = extended_plan(host.plan, plan)
    derived = {**host.read_rehearsal, 'readerAfter': saved['postProof']['reader']}
    binding, preservation = host.read.acknowledged_source_binding(host.r, host.s, host.h, host.source_op, host.source_ack,
        combined, host.read_before, derived)
    need(binding == host.read_before['sourceBinding'], 'same_source_after_explicit_four_cache_reads_required')
    return {'validated': True, 'readAdmissionSha256': host.config['readAdmissionSha256'], 'additionalReadCount': 4,
            'cacheReadAcknowledgementSha256': sha(protected(BASE / 'sql-committed.json')),
            'original143WholeValidatorPassed': False, 'preservation': preservation}


def configuration(args):
    keys = ('readAdmissionSha256', 'metadataSelectionSha256', 'metadataProvenanceFile', 'metadataProvenanceSha256', 'generationSha256')
    value = document(args.inputs, args.inputs_sha)
    need(set(value) == set(keys), 'finite_explicit_cache_receipt_inputs_required')
    match = re.fullmatch('provenance-(0|[1-9][0-9]*)-observed.json', value['metadataProvenanceFile'])
    need(match and int(match[1]) < 128, 'fixed_metadata_provenance_record_required')
    need(all(re.fullmatch('[a-f0-9]{64}', value[k]) for k in keys if k != 'metadataProvenanceFile'), 'actual_receipt_pins_not_placeholders_required')
    return value


def inputs():
    need(isinstance(ENTRY_SHA, str) and sha(protected(ENTRY)) == ENTRY_SHA and sha(protected(COMPONENT)) == COMPONENT_SHA,
         'reviewed_cache_SQL_driver_and_unchanged_transition_required')
    need(sha(protected(TSX.resolve())) == '17e2a92c5f1f70065b01c65d5ee9ac260839d4fc0ea78fdbb4db7b1155ccd32f', 'same_existing_public_tsx_loader_required')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_): raise RuntimeError('cache_HTTP_redirect_refused')


def public_get(path):
    paths = ['/ready'] + ['/v1/tokens?chain=' + chain + '&limit=2&metadata=all&sort=' + sort
        for chain in ['ethereum', 'base', 'polygon', 'bnb'] for sort in ['token-id-asc', 'rarity-capped-desc']]
    need(path in paths, 'only_fixed_legacy_API_GETs_allowed')
    request = urllib.request.Request('http://127.0.0.1:9011' + path, headers={'accept': 'application/json'}, method='GET')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=4) as response:
        raw = response.read(1000001); need(response.status == 200 and len(raw) <= 1000000, 'bounded_successful_legacy_API_response_required')
        body = json.loads(raw)
    if path == '/ready':
        need(body.get('status') == 'ready', 'actual_legacy_API_readiness_required')
        return {'path': path, 'status': 200, 'ready': True, 'bodySha256': sha(raw)}
    items = body.get('items'); need(isinstance(items, list) and 1 <= len(items) <= 2, 'actual_nonempty_legacy_collection_required')
    values = []
    ranked = 'sort=rarity-capped-desc' in path
    for row in items:
        need('rarityPointsCapped' in row, 'actual_collection_rarity_field_required')
        value = row.get('rarityPointsCapped')
        # metadata=all includes legitimate unscored NFTs. The ranking request
        # separately proves usable numeric rarity instead of hiding those rows.
        if value is None and not ranked: continue
        need(type(value) in {str, int, float} and (type(value) is not str or re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?', value)), 'actual_collection_rarity_values_required')
        number = float(value); need(math.isfinite(number), 'finite_collection_rarity_required'); values.append(number)
    if ranked: need(values == sorted(values, reverse=True), 'actual_capped_rarity_sort_required')
    return {'path': path, 'status': 200, 'items': len(items), 'nonempty': True, 'rarityPresent': len(values) == len(items),
            'rarityDescending': ranked, 'bodySha256': sha(raw)}


def legacy_http(host, require_fallback=False):
    frame = host.read.consumer_frame(host.h)
    main = frame['yunipals-api.service']['state']
    need(main['ActiveState'] == 'active' and re.fullmatch('[1-9][0-9]*', main['MainPID']), 'actual_legacy_main_API_actor_required')
    actual = host.m.process_env(main['MainPID'])
    need(actual.get('YUNIPALS_PROJECTION_MODE') == 'generation' and actual.get('METADATA_SOURCE_MODE') == 'archive' and
         actual.get('RARITY_READ_SOURCE') == 'local' and actual.get('YUNIPALS_READ_CACHE') == '1' and
         actual.get('OWNERSHIP_READ_MODE', 'legacy') == 'legacy', 'actual_running_legacy_generation_and_cache_modes_required')
    def pointer(): return host.query("SELECT jsonb_build_object('id',g.id::text,'state',g.state,'release',g.ownership_release_id,'identity',g.ownership_read_identity,'freshSets',(SELECT count(*)FROM metadata_projection.read_set s JOIN metadata_projection.read_epoch e USING(collection)WHERE s.generation_id=g.id AND s.revision=e.revision))FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.current_id WHERE a.singleton")
    first = pointer(); need(first['id'] == '103' and first['state'] == 'ready' and first['release'] is None and first['identity'] is None,
                            'unchanged_unlabelled_legacy103_public_pointer_required')
    if require_fallback: need(first['freshSets'] == 0, 'all_legacy_cache_sets_invalidated_and_direct_fallback_required')
    samples = [public_get('/ready')]
    for chain in ['ethereum', 'base', 'polygon', 'bnb']:
        for sort in ['token-id-asc', 'rarity-capped-desc']:
            samples.append(public_get('/v1/tokens?chain=' + chain + '&limit=2&metadata=all&sort=' + sort))
    last = pointer()
    need(host.read.consumer_frame(host.h) == frame and all(first[k] == last[k] for k in ['id', 'state', 'release', 'identity']) and
         (not require_fallback or last['freshSets'] == 0), 'legacy_reader_or_generation_changed_during_actual_HTTP_proof')
    return {'generationId': '103', 'nativeIdentityClaimed': False, 'actualHTTPAccepted': True, 'samples': samples,
            'directFallbackProven': require_fallback, 'actualLegacyModesVerified': True,
            'consumerFrameSha256': sha(encoded(frame)), 'rawOwnershipRowsExported': False}


def review(host):
    host.refresh(); prerequisites = host.prerequisites(); old = host.actor(); boot_link = inode(BOOT, True)
    need(boot_link['target'] == '/etc/systemd/system/' + UNIT and old['unit']['UnitFileState'] == 'enabled', 'same_original_cache_boot_required')
    snapshot = sql_child(host, 'inspect')
    need(snapshot['inspected'] is True and snapshot['databaseWrites'] == 0 and snapshot['transaction'] ==
         {'database': 'yunipals_backfill', 'role': 'postgres', 'session_user': 'postgres', 'unix': True, 'database_oid': '17584'},
         'same_readonly_cache_catalog_peer_required')
    consumer_frame = host.read.consumer_frame(host.h); http = legacy_http(host)
    value = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(),
             'config': host.config, 'candidateReceiptSha256': CANDIDATE_SHA, 'sqlDriverSha256': ENTRY_SHA,
             'componentSha256': COMPONENT_SHA, 'originalActor': old, 'boot': boot_link, 'prerequisites': prerequisites,
             'catalogSha256': snapshot['catalogSha256'], 'readCatalogSha256': sha(encoded(host.read.acl_catalog(snapshot['postProof']['catalog']))),
             'additionalReadAuthorizationRequired': True, 'additionalReadCount': 4, 'consumerFrame': consumer_frame,
             'original143PlanModified': False, 'originalGeneration103Relabelled': False}
    host.refresh(); need(host.actor() == old and inode(BOOT, True) == boot_link and host.prerequisites() == prerequisites, 'cache_review_inputs_changed')
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'catalog': snapshot, 'legacyHTTP': http}


def rehearsal(host, expected):
    need(not os.path.lexists(BASE), 'fresh_cache_owner_operation_required')
    before = review(host); need(before['reviewHash'] == expected, 'fresh_exact_cache_review_required')
    BASE.mkdir(mode=0o700); sync(BASE.parent); save('before.json', before)
    save('rehearsal-intent.json', {'format': FORMAT, 'reviewHash': expected, 'bootId': boot(), 'databaseCommitAllowed': False})
    result = sql_child(host, 'rehearse'); plan = result['result']; exact_four(plan)
    need(plan['beforeCatalogSha256'] == before['catalog']['catalogSha256'], 'same_reviewed_catalog_inside_cache_rehearsal_required')
    read_extension(before['catalog']['postProof']['catalog'], result['postProof']['catalog'], plan, result['postProof']['catalog'])
    host.refresh(); need(host.actor() == before['binding']['originalActor'] and host.prerequisites() == before['binding']['prerequisites'], 'cache_actor_or_generation_changed_during_rehearsal')
    after = sql_child(host, 'inspect')
    need(after['catalogSha256'] == before['catalog']['catalogSha256'] and
         host.read.acl_catalog(after['postProof']['catalog']) == host.read.acl_catalog(before['catalog']['postProof']['catalog']), 'exact_ROLLBACK_and_all_old_READs_preserved_required')
    record = {'format': FORMAT, 'rehearsed': True, 'committed': False, 'reviewHash': expected,
              'sql': result, 'additionalReads': plan['addedSelects'], 'additionalReadDeltaSha256': sha(encoded(plan['addedSelects'])),
              'beforeFileSha256': sha(protected(BASE / 'before.json')), 'sourceReadinessClaimed': False}
    save('rehearsed.json', record); return record


def owned(host):
    before = document(BASE / 'before.json'); b = before['binding']; rehearsal = document(BASE / 'rehearsed.json')
    need(before['reviewHash'] == sha(encoded(b)) and b['format'] == FORMAT and b['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         b['bootId'] == boot() and b['config'] == host.config and rehearsal['format'] == FORMAT and rehearsal['rehearsed'] is True and
         rehearsal['committed'] is False and rehearsal['reviewHash'] == before['reviewHash'] and
         rehearsal['beforeFileSha256'] == sha(protected(BASE / 'before.json')), 'exact_same_boot_cache_operation_and_rehearsal_required')
    exact_four(rehearsal['sql']['result']); host.private(); return before, rehearsal


def manager(action):
    need(action in {'stop', 'start', 'daemon-reload'}, 'fixed_cache_manager_action_required')
    result = subprocess.run(['/usr/bin/systemctl', action, *([] if action == 'daemon-reload' else [UNIT])],
                            env=CLEAN, capture_output=True, timeout=45)
    need(result.returncode == 0 and not result.stderr, 'cache_manager_ACK_unknown_inspect_only')
    return {'returncode': result.returncode, 'stdoutSha256': sha(result.stdout), 'stderrSha256': sha(result.stderr)}


def drain(host, expected, additional_reads):
    before, rehearsed = owned(host); b = before['binding']
    need(before['reviewHash'] == expected and additional_reads == rehearsed['additionalReadDeltaSha256'], 'separate_explicit_four_READ_authorization_required')
    need(not (BASE / 'stop-intent.json').exists(), 'no_repeated_unknown_cache_stop')
    host.refresh(); need(host.prerequisites() == b['prerequisites'] and host.actor() == b['originalActor'] and inode(BOOT, True) == b['boot'], 'exact_cache_actor_boot_generation_before_drain_required')
    save('authorization.json', {'format': FORMAT, 'reviewHash': expected, 'readAdmissionSha256': host.config['readAdmissionSha256'],
         'additionalReadDeltaSha256': additional_reads, 'additionalReadCount': 4, 'original143PlanModified': False})
    save('boot-disable-intent.json', b['boot']); need(inode(BOOT, True) == b['boot'] and not os.path.lexists(BASE / 'original-boot-link'), 'same_boot_inode_before_owned_disable')
    os.rename(BOOT, BASE / 'original-boot-link'); sync(BOOT.parent); sync(BASE)
    save('boot-disabled.json', inode(BASE / 'original-boot-link', True))
    save('disable-reload-intent.json', {'bootId': boot(), 'reviewHash': expected}); save('disable-reload-result.json', manager('daemon-reload'))
    actor = host.actor(); need(actor['main'] == b['originalActor']['main'], 'same_cache_process_after_boot_disable')
    sessions = host.sessions(actor); need(host.actor() == actor, 'cache_actor_changed_during_final_kernel_session_capture')
    save('stop-intent.json', {'format': FORMAT, 'actor': actor, 'sessions': sessions, 'bootId': boot(), 'reviewHash': expected})
    need(host.actor() == actor and inode(BASE / 'original-boot-link', True) == b['boot'] and not os.path.lexists(BOOT), 'cache_actor_changed_after_fsynced_stop_intent')
    ack = manager('stop'); host.terminal(actor, sessions)
    save('stopped.json', {'format': FORMAT, 'actor': actor, 'sessions': sessions, 'managerAck': ack, 'reconciled': False}); return {'stopped': True, 'databaseWrites': 0}


def reconcile_stop(host):
    before, _ = owned(host); intent = document(BASE / 'stop-intent.json')
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['reviewHash'] == before['reviewHash'], 'exact_owned_cache_stop_intent_required')
    host.refresh(); host.terminal(intent['actor'], intent['sessions'])
    need(not (BASE / 'stopped.json').exists() and not os.path.lexists(BOOT) and inode(BASE / 'original-boot-link', True) == before['binding']['boot'], 'same_owned_terminal_cache_stop_required')
    save('stopped.json', {**intent, 'reconciled': True, 'managerAckUnknown': True, 'serviceActions': 0}); return {'stopped': True, 'reconciled': True, 'serviceActions': 0}


def stopped(host):
    before, rehearsal = owned(host); value = document(BASE / 'stopped.json')
    need(value['actor']['main'] == before['binding']['originalActor']['main'], 'same_original_cache_stop_ACK_required')
    host.terminal(value['actor'], value['sessions']); return before, rehearsal, value


def commit(host):
    before, rehearsal, _ = stopped(host)
    need(not (BASE / 'sql-intent.json').exists() and not (BASE / 'sql-committed.json').exists(), 'single_cache_catalog_commit_attempt_required')
    host.refresh(); need(host.prerequisites() == before['binding']['prerequisites'], 'same_metadata_generation_before_cache_commit')
    save('sql-intent.json', {'format': FORMAT, 'bootId': boot(), 'reviewHash': before['reviewHash'],
         'rehearsalSha256': sha(protected(BASE / 'rehearsed.json')), 'authorizationSha256': sha(protected(BASE / 'authorization.json'))})
    def prepared(value):
        need(value['mode'] == 'apply' and value['planSha256'] == sha(rehearsal['sql']['resultJson'].encode()), 'same_cache_rehearsal_at_commit_boundary_required')
        read_extension(before['catalog']['postProof']['catalog'], value['postProof']['catalog'], rehearsal['sql']['result'], value['postProof']['catalog'])
        stopped(host); host.refresh(); need(host.prerequisites() == before['binding']['prerequisites'], 'source_or_generation_changed_before_cache_COMMIT')
        save('sql-prepared.json', value)
    result = sql_child(host, 'apply', rehearsal['sql']['result'], prepared, plan_json=rehearsal['sql']['resultJson'])
    save('sql-committed.json', {**result, 'operatorSha256': before['binding']['operatorSha256'], 'bootId': boot(), 'reviewHash': before['reviewHash'],
         'commitIntentSha256': sha(protected(BASE / 'sql-intent.json')), 'preparedSha256': sha(protected(BASE / 'sql-prepared.json')),
         'readAdmissionSha256': host.config['readAdmissionSha256'],
         'additionalReadAuthorizationSha256': sha(protected(BASE / 'authorization.json')), 'reconciledAfterUnknownAck': False})
    validate_reads(host); return prepare_ack(host)


def reconcile_commit(host):
    child_gone(host, 'apply-sql-child.json')
    before, rehearsal, _ = stopped(host); intent = document(BASE / 'sql-intent.json'); prepared = document(BASE / 'sql-prepared.json')
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['reviewHash'] == before['reviewHash'] and
         intent['rehearsalSha256'] == sha(protected(BASE / 'rehearsed.json')) and
         intent['authorizationSha256'] == sha(protected(BASE / 'authorization.json')) and prepared['mode'] == 'apply' and
         prepared['planSha256'] == sha(rehearsal['sql']['resultJson'].encode()), 'same_owned_SQL_intent_and_prepared_transaction_required')
    need(prepared['format'] == 'yunipals-ypal-cache-guard-sql-v1' and prepared['event'] == 'commit-prepared' and
         re.fullmatch('[1-9][0-9]*', prepared['xid']), 'exact_owned_cache_transaction_id_required')
    status = xact_status(host, prepared['xid'])
    need(status == 'committed', 'cache_COMMIT_not_proven_no_automatic_reexecution')
    now = sql_child(host, 'inspect')
    need(now['catalogSha256'] == prepared['afterCatalogSha256'] and
         host.read.acl_catalog(now['postProof']['catalog']) == host.read.acl_catalog(prepared['postProof']['catalog']), 'exact_committed_cache_catalog_required')
    read_extension(before['catalog']['postProof']['catalog'], now['postProof']['catalog'], rehearsal['sql']['result'], prepared['postProof']['catalog'])
    receipt = {**json.loads(rehearsal['sql']['resultJson']), 'before': json.loads(prepared['beforeJson']),
               'after': json.loads(prepared['afterJson']), 'committed': True, 'epochPolicy': 'increment_current_once', 'cacheRowsWritten': 0}
    save('sql-committed.json', {'format': 'yunipals-ypal-cache-guard-sql-v1', 'mode': 'apply', 'xid': prepared['xid'], 'acknowledged': False,
         'result': receipt, 'resultJson': js_encoded(receipt).decode(), 'postProof': prepared['postProof'], 'readAdmissionSha256': host.config['readAdmissionSha256'],
         'operatorSha256': before['binding']['operatorSha256'], 'bootId': boot(), 'reviewHash': before['reviewHash'],
         'commitIntentSha256': sha(protected(BASE / 'sql-intent.json')), 'preparedSha256': sha(protected(BASE / 'sql-prepared.json')),
         'reconciledAfterUnknownAck': True, 'additionalReadAuthorizationSha256': sha(protected(BASE / 'authorization.json'))})
    validate_reads(host); return {'catalogCommitted': True, 'reconciled': True, 'databaseWrites': 0, 'serviceActions': 0,
        'explicitPrepareAcknowledgementStillRequired': True}


def prepare_ack(host):
    before, _, _ = stopped(host); proof = validate_reads(host)
    need(host.prerequisites() == before['binding']['prerequisites'] and host.read.consumer_frame(host.h) == before['binding']['consumerFrame'],
         'unpublished_candidate_and_original_legacy_readers_required_after_guard_install')
    http = legacy_http(host, True)
    need(host.read.consumer_frame(host.h) == before['binding']['consumerFrame'], 'same_legacy_API_private_configuration_after_actual_HTTP')
    value = {'format': FORMAT, 'prepared': True, 'operatorSha256': before['binding']['operatorSha256'], 'bootId': boot(),
             'config': host.config, 'beforeSha256': sha(protected(BASE / 'before.json')), 'reviewHash': before['reviewHash'],
             'readAdmissionSha256': host.config['readAdmissionSha256'], 'additionalReadCount': 4,
             'additionalReadAcknowledgementSha256': sha(protected(BASE / 'sql-committed.json')), 'original143WholeValidatorPassed': False,
             'nativeWorkerStarted': False, 'nativeGenerationPublished': False, 'legacy103ServingAccepted': True,
             'legacyHTTP': http, 'preservation': proof['preservation'], 'cacheBootDisabled': True,
             'coordinatedPublicationAndReaderSwitchStillRequired': True}
    save('prepared.json', value); return value


def validate_prepared_current(pin):
    value = document(BASE / 'prepared.json', pin)
    need(value['format'] == FORMAT and value['prepared'] is True and value['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         value['bootId'] == boot() and not (BASE / 'native-start-intent.json').exists() and not (BASE / 'sql-inverse-intent.json').exists(),
         'same_owned_prepared_cache_guard_ack_required')
    host = Host(value['config']); before, _, _ = stopped(host); proof = validate_reads(host)
    need(host.prerequisites() == before['binding']['prerequisites'] and host.read.consumer_frame(host.h) == before['binding']['consumerFrame'],
         'same_unpublished_candidate_legacy_readers_and_terminal_cache_required')
    return {**proof, 'format': FORMAT, 'preparedReceiptSha256': pin, 'generationId': before['binding']['prerequisites']['generationId'],
            'legacyHTTP': legacy_http(host, True), 'nativeWorkerStarted': False, 'nativeGenerationPublished': False,
            'databaseWrites': 0, 'serviceActions': 0}


def loaded(host, native):
    host.private(); value = host.state(); old = host.candidate['originalCacheWriter']
    expected = {p: pin for p, pin in old['inputHashes'].items() if p.endswith('.service')}
    if native: expected[str(DROP)] = host.candidate['files'][UNIT + '.drop-in.candidate']
    actual = {p: sha(protected(p)) for p in [value['FragmentPath'], *value['DropInPaths'].split()]}
    need(actual == expected and value['WorkingDirectory'] == (str(PROJECT) if native else old['state']['WorkingDirectory']) and value['Job'] == '',
         'exact_cache_manager_loaded_definition_required')
    if native:
        need(host.m.ordered_files(value['EnvironmentFiles']) == [('/etc/yunipals-indexer/read-cache.env', False),
             (str(CANDIDATES / 'yunipals-read-cache.ownership.env'), False)], 'exact_loaded_cache_selector_files_required')
        expected_command = NODE + ' --import tsx ' + str(PROJECT / 'lib/metadata/read-cache-worker.ts')
        need(re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) == [expected_command], 'same_official_cache_ExecStart_required')
    return value


def publish_drop(host):
    if (BASE / 'drop-published.json').exists():
        need(inode(DROP) == document(BASE / 'drop-published.json'), 'same_owned_cache_overlay_required'); return
    parent = DROP.parent
    if not parent.exists():
        save('drop-directory-intent.json', {'path': str(parent)}); parent.mkdir(mode=0o755); parent.chmod(0o755); sync(parent.parent)
        st = parent.lstat(); save('drop-directory-created.json', {'dev': st.st_dev, 'ino': st.st_ino})
    st = parent.lstat(); need(stat.S_ISDIR(st.st_mode) and st.st_uid == st.st_gid == 0 and not st.st_mode & 0o022, 'protected_cache_overlay_directory_required')
    staged = BASE / 'worker-drop.staged'
    if not (BASE / 'drop-publish-intent.json').exists():
        need(not os.path.lexists(DROP) and not staged.exists(), 'fresh_cache_overlay_publication_required')
        raw = protected(CANDIDATES / (UNIT + '.drop-in.candidate'))
        need(sha(raw) == host.candidate['files'][UNIT + '.drop-in.candidate'], 'same_reviewed_cache_overlay_bytes_before_publication')
        save(staged.name, raw); staged.chmod(0o644); sync(BASE)
        save('drop-publish-intent.json', inode(staged))
    expected = document(BASE / 'drop-publish-intent.json')
    if not os.path.lexists(DROP):
        need(inode(staged) == expected, 'same_owned_cache_staged_inode_required'); os.link(staged, DROP); sync(parent)
    st = DROP.lstat()
    need(st.st_dev == expected['dev'] and st.st_ino == expected['ino'] and st.st_uid == st.st_gid == 0 and
         stat.S_ISREG(st.st_mode) and sha(DROP.read_bytes()) == expected['sha256'] and st.st_nlink in {1, 2}, 'same_exclusive_owned_cache_publication_required')
    if staged.exists():
        need(staged.stat().st_ino == st.st_ino and staged.stat().st_dev == st.st_dev, 'exact_owned_staged_hardlink_required'); staged.unlink(); sync(BASE)
    save('drop-published.json', inode(DROP))


def same_activation(actual, expected, intent_name):
    if actual == expected: return True
    intent = document(BASE / intent_name)
    need(os.path.lexists(BOOT) and inode(BOOT, True) == intent and actual['unit']['UnitFileState'] == 'enabled' and
         actual['unit']['WantedBy'] == 'multi-user.target', 'only_recorded_cache_boot_activation_may_change')
    a, b = copy.deepcopy(actual), copy.deepcopy(expected)
    for item in (a, b):
        item['unit'].pop('UnitFileState'); item['unit'].pop('WantedBy')
    return a == b


def finish(host, coordinated_sha):
    before, _ = owned(host); old_stop = document(BASE / 'stopped.json'); host.refresh()
    if not (BASE / 'native-start-intent.json').exists(): host.terminal(old_stop['actor'], old_stop['sessions'])
    need((BASE / 'sql-committed.json').exists() and not (BASE / 'sql-inverse-intent.json').exists(), 'acknowledged_cache_catalog_before_worker_selection_required')
    need(host.prerequisites(True, coordinated_sha) == before['binding']['prerequisites'], 'same_accepted_generation_before_cache_forward_completion')
    publish_drop(host)
    if not (BASE / 'load-result.json').exists():
        if (BASE / 'load-intent.json').exists(): loaded(host, True); save('load-result.json', {'reconciled': True, 'serviceActions': 0})
        else:
            save('load-intent.json', {'bootId': boot(), 'dropIdentity': inode(DROP)}); manager('daemon-reload'); loaded(host, True)
            save('load-result.json', {'acknowledged': True})
    if not (BASE / 'native-started.json').exists():
        if (BASE / 'native-start-intent.json').exists():
            intent = document(BASE / 'native-start-intent.json'); actor = host.actor(True)
            need(intent['bootId'] == boot() and actor['unit']['InvocationID'] != intent['previousInvocation'] and
                 actor['main']['startTicks'] * 1000000 // os.sysconf('SC_CLK_TCK') >= intent['monotonicUs'], 'owned_started_cache_after_lost_ACK_required')
            save('native-started.json', actor)
        else:
            value = loaded(host, True); host.terminal(old_stop['actor'], old_stop['sessions']); host.refresh(); host.prerequisites(True, coordinated_sha)
            save('native-start-intent.json', {'bootId': boot(), 'previousInvocation': value['InvocationID'], 'monotonicUs': time.monotonic_ns() // 1000,
                 'beforeState': value, 'dropIdentity': inode(DROP)})
            need(loaded(host, True) == value, 'cache_unit_changed_after_fsynced_start_intent'); manager('start')
            save('native-started.json', host.actor(True))
    actor = document(BASE / 'native-started.json')
    need(same_activation(host.actor(True), actor, 'boot-publish-intent.json') and host.prerequisites(True, coordinated_sha) == before['binding']['prerequisites'], 'same_owned_cache_actor_and_generation_required')
    actual = sql_child(host, 'freshness', generation=before['binding']['prerequisites']['generationId'])
    need(actual['collections'] == [{'collection': c, 'fresh': True} for c in ['ethereum', 'base', 'polygon', 'bnb']], 'all_four_actual_official_cache_freshness_proofs_required')
    host.refresh(); host.private(); need(same_activation(host.actor(True), actor, 'boot-publish-intent.json'), 'cache_actor_changed_after_actual_functional_proof')
    if not os.path.lexists(BOOT):
        need(inode(BASE / 'original-boot-link', True) == before['binding']['boot'], 'same_preserved_cache_boot_inode_required')
        if not (BASE / 'boot-publish-intent.json').exists(): save('boot-publish-intent.json', before['binding']['boot'])
        os.rename(BASE / 'original-boot-link', BOOT); sync(BOOT.parent); sync(BASE)
    need(inode(BOOT, True) == before['binding']['boot'], 'exact_cache_boot_restored_for_owned_worker')
    if not (BASE / 'enable-reload-result.json').exists():
        if (BASE / 'enable-reload-intent.json').exists(): need(host.state()['UnitFileState'] == 'enabled', 'unknown_cache_enable_reload_requires_readonly_inspection')
        else: save('enable-reload-intent.json', before['binding']['boot']); manager('daemon-reload')
        save('enable-reload-result.json', {'bootIdentity': inode(BOOT, True)})
    selected = host.actor(True)
    need(same_activation(selected, actor, 'boot-publish-intent.json'), 'same_owned_cache_worker_after_boot_publication')
    result = {'format': FORMAT, 'completed': True, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(),
              'readAdmissionSha256': host.config['readAdmissionSha256'], 'additionalReadCount': 4,
              'additionalReadAcknowledgementSha256': sha(protected(BASE / 'sql-committed.json')), 'original143WholeValidatorPassed': False,
              'config': host.config, 'reviewHash': before['reviewHash'], 'generationId': actual['generationId'], 'coordinatedCutoverSha256': coordinated_sha,
              'cacheActor': selected, 'cacheBoot': inode(BOOT, True), 'freshness': actual, 'sourceReadinessClaimed': False,
              'sourceRowsWritten': 0, 'existingOfficialWorkerPreserved': True}
    save('result.json', result); return result


def inspect(host):
    if not (BASE / 'rehearsed.json').exists():
        before = document(BASE / 'before.json')
        need(before['binding']['operatorSha256'] == sha(protected(Path(__file__).absolute())) and before['binding']['bootId'] == boot() and
             before['reviewHash'] == sha(encoded(before['binding'])), 'same_owned_partial_rehearsal_record_required')
        return {'format': FORMAT, 'inspected': True, 'rehearsalAcknowledged': False, 'reviewHash': before['reviewHash'],
                'currentUnit': host.state(), 'currentCatalog': sql_child(host, 'inspect'), 'databaseWrites': 0, 'serviceActions': 0,
                'automaticRetryAllowed': False, 'archiveRequiresExplicitAbortedRehearsalReview': True}
    before, rehearsal = owned(host)
    records = {name: sha(protected(BASE / name)) for name in ['stop-intent.json', 'stopped.json', 'sql-intent.json', 'sql-prepared.json',
        'sql-committed.json', 'drop-published.json', 'native-start-intent.json', 'native-started.json', 'result.json', 'sql-inverse-intent.json',
        'sql-inverse-prepared.json', 'sql-inversed.json', 'inverse-result.json'] if (BASE / name).exists()}
    return {'format': FORMAT, 'inspected': True, 'reviewHash': before['reviewHash'], 'records': records, 'currentUnit': host.state(),
            'currentCatalog': sql_child(host, 'inspect'), 'databaseWrites': 0, 'serviceActions': 0,
            'successInferredFromCatalogAlone': False, 'automaticRetryAllowed': False}


def epoch_progress(before, current):
    names = {'ethereum', 'base', 'polygon', 'bnb'}
    need(len(before) == len(current) == 4 and {v['collection'] for v in before} == {v['collection'] for v in current} == names,
         'exact_four_archive_epoch_collections_required')
    original = {v['collection']: v['revision'] for v in before}; actual = {v['collection']: v['revision'] for v in current}
    need(all(isinstance(v, str) and re.fullmatch('[0-9]+', v) for v in [*original.values(), *actual.values()]) and
         all(int(actual[name]) >= int(original[name]) for name in names), 'archive_epochs_may_only_advance_monotonically')
    return {'beforeEpochs': before, 'archiveEpochs': current, 'epochPolicy': 'preserve_actual_monotonic_invalidations'}


def archive_review(host):
    allowed = {'before.json', 'rehearsal-intent.json', 'rehearse-sql-child.json', 'rehearse-sql-opened.json', 'archive-intent.json'}
    need(BASE.is_dir() and {p.name for p in BASE.iterdir()} <= allowed and not os.path.lexists(DROP),
         'only_unacknowledged_rehearsal_no_mutation_start_stop_or_worker_files_may_archive')
    before = document(BASE / 'before.json'); binding = before['binding']; intent = document(BASE / 'rehearsal-intent.json')
    need(binding['format'] == FORMAT and binding['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         binding['bootId'] == boot() and binding['config'] == host.config and before['reviewHash'] == sha(encoded(binding)) and
         intent == {'format': FORMAT, 'reviewHash': before['reviewHash'], 'bootId': boot(), 'databaseCommitAllowed': False},
         'exact_same_boot_rehearse_only_cache_operation_required')
    child = document(BASE / 'rehearse-sql-child.json'); opened = document(BASE / 'rehearse-sql-opened.json'); message = opened['message']
    need(child['bootId'] == boot() and child['mode'] == 'rehearse' and child['entrySha256'] == ENTRY_SHA and child['componentSha256'] == COMPONENT_SHA and
         child['processGroup'] == child['actor']['pid'] and opened['childFileSha256'] == sha(protected(BASE / 'rehearse-sql-child.json')) and
         message['format'] == 'yunipals-ypal-cache-guard-sql-v1' and message['event'] == 'transaction-opened' and message['mode'] == 'rehearse' and
         re.fullmatch('[1-9][0-9]*', message['xid']) and len(opened['sessions']) == 1 and
         opened['sessions'][0]['pid'] == message['backend']['pid'] and opened['sessions'][0]['backendStart'] == message['backend']['backendStart'],
         'pinned_rehearse_only_child_and_kernel_owned_transaction_required')
    child_gone(host, 'rehearse-sql-child.json')
    need(xact_status(host, message['xid']) == 'aborted', 'rehearsal_XID_must_be_aborted_not_unknown')
    peer = opened['sessions'][0]
    need(type(peer['pid']) is int and peer['pid'] > 0, 'actual_rehearsal_peer_PID_required')
    live = host.query("SELECT COALESCE((SELECT jsonb_build_object('pid',pid,'backendStart',(extract(epoch from backend_start)*1000000)::numeric(30,0)::text)FROM pg_stat_activity WHERE pid=" + str(peer['pid']) + "),'null'::jsonb)")
    need(live is None or live['pid'] != peer['pid'] or live['backendStart'] != peer['backendStart'], 'owned_rehearsal_PG_session_must_be_terminal')
    host.refresh(); need(host.actor() == binding['originalActor'] and inode(BOOT, True) == binding['boot'] and
         host.read.consumer_frame(host.h) == binding['consumerFrame'], 'old_actor_boot_private_inputs_and_consumers_unchanged_before_archive')
    current = sql_child(host, 'inspect')
    need(current['catalogSha256'] == binding['catalogSha256'] and current['postProof']['catalog'] == before['catalog']['postProof']['catalog'] and
         current['postProof']['reader'] == before['catalog']['postProof']['reader'], 'complete_unchanged_semantic_catalog_roles_and_column_ACLs_before_archive')
    epochs = epoch_progress(before['catalog']['state']['epochs'], current['state']['epochs'])
    source = BASE.lstat(); parent = BASE.parent.lstat()
    need(source.st_uid == source.st_gid == parent.st_uid == parent.st_gid == 0 and stat.S_IMODE(source.st_mode) == 0o700 and
         stat.S_ISDIR(source.st_mode) and source.st_dev == parent.st_dev and not stat.S_ISLNK(source.st_mode), 'same_filesystem_owned_private_archive_source_required')
    target = None
    if (BASE / 'archive-intent.json').exists():
        old = document(BASE / 'archive-intent.json'); target = Path(old['target'])
        need(target in [BASE.with_name(BASE.name + '.aborted-rehearsal-' + str(i)) for i in range(1, 4)] and
             old['sourceDirectory'] == {'dev': source.st_dev, 'ino': source.st_ino}, 'same_owned_archive_target_intent_required')
    else:
        target = next((BASE.with_name(BASE.name + '.aborted-rehearsal-' + str(i)) for i in range(1, 4)
                       if not os.path.lexists(BASE.with_name(BASE.name + '.aborted-rehearsal-' + str(i)))), None)
    need(target is not None and not os.path.lexists(target), 'fresh_bounded_private_archive_sibling_required')
    files = {p.name: inode(p) for p in BASE.iterdir() if p.name != 'archive-intent.json'}
    value = {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'bootId': boot(), 'source': str(BASE), 'target': str(target),
             'sourceDirectory': {'dev': source.st_dev, 'ino': source.st_ino}, 'beforeSha256': sha(protected(BASE / 'before.json')),
             'rehearsalXid': message['xid'], 'transactionStatus': 'aborted', 'files': files, 'catalogSha256': current['catalogSha256'],
             'originalActor': binding['originalActor'], 'boot': binding['boot'], 'databaseWrites': 0, 'serviceActions': 0,
             'automaticArchiveOrRetryAllowed': False}
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'observedEpochs': epochs}


def rename_exclusive(source, target):
    library = ctypes.CDLL(None, use_errno=True); function = library.renameat2
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]; function.restype = ctypes.c_int
    if function(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        error = ctypes.get_errno(); raise OSError(error, os.strerror(error))


def archive_aborted(host, expected):
    reviewed = archive_review(host); need(reviewed['reviewHash'] == expected, 'fresh_exact_aborted_rehearsal_archive_review_required')
    if not (BASE / 'archive-intent.json').exists(): save('archive-intent.json', {**reviewed['binding'], 'archiveReviewHash': expected})
    intent = document(BASE / 'archive-intent.json')
    need(intent['archiveReviewHash'] == expected and {k: v for k, v in intent.items() if k != 'archiveReviewHash'} == reviewed['binding'], 'same_durable_private_archive_intent_required')
    again = archive_review(host); need(again['binding'] == reviewed['binding'], 'cache_archive_inputs_changed_after_fsynced_intent')
    target = Path(intent['target']); rename_exclusive(BASE, target); sync(target.parent)
    for name, identity in intent['files'].items(): need(inode(target / name) == identity, 'archive_must_preserve_every_original_file_byte_and_inode')
    result = {'format': FORMAT, 'archived': True, 'archiveReviewHash': expected, 'target': str(target),
              'sourceDirectory': intent['sourceDirectory'], 'originalFileIdentities': intent['files'], 'actualEpochs': again['observedEpochs'],
              'originalFilesUnmodified': True, 'databaseByteEqualityClaimed': False, 'databaseWrites': 0, 'serviceActions': 0, 'automaticRerunAllowed': False}
    fd = os.open(target / 'archive-result.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), 0o600); f.write(encoded(result)); f.flush(); os.fsync(f.fileno())
    sync(target); sync(target.parent); return result


def validate_current(pin):
    result = document(BASE / 'result.json', pin)
    need(result['format'] == FORMAT and result['completed'] is True and result['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         result['bootId'] == boot() and not (BASE / 'sql-inverse-intent.json').exists(), 'same_uninversed_cache_owner_receipt_required')
    host = Host(result['config']); proof = validate_reads(host)
    need(host.actor(True) == result['cacheActor'] and inode(BOOT, True) == result['cacheBoot'] and
         host.prerequisites(True, result['coordinatedCutoverSha256'])['generationId'] == result['generationId'], 'same_acknowledged_cache_worker_generation_and_boot_required')
    return {**proof, 'format': FORMAT, 'receiptSha256': pin, 'cacheActor': result['cacheActor'], 'generationId': result['generationId'],
            'sourceReadinessClaimed': False, 'databaseWrites': 0, 'serviceActions': 0}


def child_gone(host, name):
    if (BASE / name).exists():
        child = document(BASE / name); need(child['bootId'] == boot(), 'same_boot_SQL_child_record_required')
        try: current = host.m.process(str(child['actor']['pid']))
        except (FileNotFoundError, ProcessLookupError): current = None
        need(current != child['actor'], 'owned_SQL_child_must_be_terminal')
    need(host.query("SELECT count(*)FROM pg_stat_activity WHERE datid=17584 AND application_name='ypal_cache_guard_owner_v1'AND pid<>pg_backend_pid()") == 0,
         'no_unresolved_cache_owner_SQL_session_before_recovery')


def xact_status(host, xid):
    need(isinstance(xid, str) and re.fullmatch('[1-9][0-9]*', xid), 'exact_numeric_cache_XID_required')
    # The frozen source_query uses json.loads(psql stdout), including scalars.
    value = host.query("SELECT COALESCE(to_json(pg_xact_status('" + xid + "'::xid8)),'null'::json)")
    need(value in {'committed', 'aborted', 'in progress', None}, 'known_actual_cache_XID_status_required')
    return value


def inverse_review(host):
    before, _ = owned(host); child_gone(host, 'apply-sql-child.json')
    if (BASE / 'sql-intent.json').exists() and not (BASE / 'sql-committed.json').exists():
        if (BASE / 'sql-prepared.json').exists():
            prepared = document(BASE / 'sql-prepared.json'); need(re.fullmatch('[1-9][0-9]*', prepared['xid']), 'owned_cache_XID_required')
            need(xact_status(host, prepared['xid']) == 'aborted',
                 'unknown_or_committed_cache_transaction_requires_explicit_readonly_reconcile')
        # Without a durable prepared record root never authorized this COMMIT.
    host.refresh(); current = sql_child(host, 'inspect')
    state = host.state(); actor = None
    if state['MainPID'] != '0': actor = host.actor(native=(BASE / 'native-start-intent.json').exists())
    else:
        stop = document(BASE / 'stopped.json'); host.terminal(stop['actor'], stop['sessions'])
    value = {'format': FORMAT, 'operationSha256': sha(protected(BASE / 'before.json')), 'bootId': boot(),
             'actor': actor, 'catalogSha256': current['catalogSha256'],
             'readCatalogSha256': sha(encoded(host.read.acl_catalog(current['postProof']['catalog']))),
             'catalogCommitted': (BASE / 'sql-committed.json').exists(), 'oldWorkerRestartDeferredUntilGenerationRestored': True}
    return {'binding': value, 'reviewHash': sha(encoded(value))}


def inverse_catalog_ack(host, before):
    host.read.validate_current(host.config['readAdmissionSha256'])
    current = sql_child(host, 'inspect'); value = host.state()
    need(value['ActiveState'] in {'inactive', 'failed'} and value['MainPID'] == value['ControlPID'] == '0' and value['Job'] == '' and
         not os.path.lexists(BOOT), 'cache_must_remain_inactive_until_generation_inverse')
    loaded(host, False)
    result = {'format': FORMAT, 'operatorSha256': before['binding']['operatorSha256'], 'bootId': boot(),
              'cacheInactive': True, 'originalDefinitionsRestored': True, 'bootDisabled': True, 'fourCacheReadsRemoved': True,
              'readAdmissionSha256': host.config['readAdmissionSha256'], 'config': host.config,
              'beforeSha256': sha(protected(BASE / 'before.json')), 'cacheOperationSha256': sha(protected(BASE / 'before.json')),
              'catalogInverseSha256': sha(protected(BASE / 'sql-inversed.json')) if (BASE / 'sql-inversed.json').exists() else None,
              'cacheUnit': UNIT, 'unitDefinitionHashes': {before['binding']['originalActor']['unit']['FragmentPath']:
                  host.candidate['originalCacheWriter']['inputHashes'][before['binding']['originalActor']['unit']['FragmentPath']]},
              'privateInputHashes': host.candidate['originalCacheWriter']['inputHashes'], 'currentCatalogSha256': current['catalogSha256'],
              'generationInverseStillRequired': True, 'serviceActionsAfterThisACK': 0}
    save('inverse-catalog-result.json', result); return result


def inverse(host, expected):
    before, _ = owned(host)
    if not (BASE / 'inverse-intent.json').exists():
        reviewed = inverse_review(host); need(reviewed['reviewHash'] == expected, 'fresh_exact_cache_inverse_review_required')
        actor = reviewed['binding']['actor']; native = (BASE / 'native-start-intent.json').exists()
        sessions = host.sessions(actor) if actor and native else None
        save('inverse-intent.json', {**reviewed, 'native': native, 'sessions': sessions})
    intent = document(BASE / 'inverse-intent.json')
    need(intent['reviewHash'] == expected and intent['binding']['operationSha256'] == sha(protected(BASE / 'before.json')) and
         intent['binding']['bootId'] == boot() and intent['reviewHash'] == sha(encoded(intent['binding'])), 'same_owned_cache_inverse_intent_required')
    if os.path.lexists(BOOT):
        need(inode(BOOT, True) == before['binding']['boot'] and not os.path.lexists(BASE / 'original-boot-link'), 'only_owned_cache_boot_may_be_disabled')
        save('inverse-disable-boot-intent.json', before['binding']['boot']); os.rename(BOOT, BASE / 'original-boot-link'); sync(BOOT.parent); sync(BASE)
        save('inverse-disable-reload-intent.json', {'bootId': boot()}); manager('daemon-reload'); save('inverse-disable-reload-result.json', {'acknowledged': True})
    actor = intent['binding']['actor']
    if actor is not None:
        if intent['native']:
            if not (BASE / 'inverse-stop-intent.json').exists():
                now = host.actor(True); need(now['main'] == actor['main'], 'same_owned_native_cache_before_inverse_stop')
                save('inverse-stop-intent.json', {'actor': now, 'sessions': intent['sessions']})
                need(host.actor(True) == now, 'native_cache_changed_after_inverse_stop_intent'); manager('stop')
            host.terminal(actor, intent['sessions'])
        else:
            need(False, 'original_cache_still_running_no_inverse_stop_authority')
    if (BASE / 'sql-committed.json').exists() and not (BASE / 'sql-inversed.json').exists():
        committed = document(BASE / 'sql-committed.json'); validate_reads(host)
        need(not (BASE / 'sql-inverse-intent.json').exists(), 'unknown_cache_inverse_COMMIT_requires_readonly_reconcile')
        save('sql-inverse-intent.json', {'format': FORMAT, 'bootId': boot(), 'inverseReviewHash': expected,
             'committedSha256': sha(protected(BASE / 'sql-committed.json')), 'operationSha256': sha(protected(BASE / 'before.json'))})
        def prepared(value):
            need(value['mode'] == 'inverse' and value['planSha256'] == sha(committed['resultJson'].encode()) and
                 host.read.acl_catalog(value['postProof']['catalog']) == host.read.acl_catalog(host.read_rehearsal['after']),
                 'inverse_must_restore_exact_143_graph_and_original_guard_catalog')
            validate_reads(host); host.private(); save('sql-inverse-prepared.json', value)
        result = sql_child(host, 'inverse', committed['result'], prepared, plan_json=committed['resultJson'])
        save('sql-inversed.json', {'format': FORMAT, 'restored': True, 'sql': result, 'commitIntentSha256': sha(protected(BASE / 'sql-inverse-intent.json')),
             'preparedSha256': sha(protected(BASE / 'sql-inverse-prepared.json')), 'original143GraphRestored': True})
    return restore_definition(host, before)


def restore_definition(host, before):
    host.read.validate_current(host.config['readAdmissionSha256'])
    if os.path.lexists(DROP):
        expected = document(BASE / 'drop-published.json')
        if not (BASE / 'drop-unlink-intent.json').exists(): save('drop-unlink-intent.json', expected)
        need(document(BASE / 'drop-unlink-intent.json') == expected and inode(DROP) == expected, 'only_exact_owned_cache_overlay_can_be_removed')
        DROP.unlink(); sync(DROP.parent)
    if (BASE / 'drop-directory-created.json').exists() and DROP.parent.exists():
        expected = document(BASE / 'drop-directory-created.json'); current = DROP.parent.lstat()
        need((current.st_dev, current.st_ino) == (expected['dev'], expected['ino']) and current.st_uid == current.st_gid == 0 and
             not any(DROP.parent.iterdir()), 'only_empty_exact_owned_cache_overlay_directory_may_be_removed')
        DROP.parent.rmdir(); sync(DROP.parent.parent)
    if not (BASE / 'inverse-load-result.json').exists():
        if (BASE / 'inverse-load-intent.json').exists(): loaded(host, False)
        else:
            save('inverse-load-intent.json', {'bootId': boot()}); manager('daemon-reload'); loaded(host, False)
        save('inverse-load-result.json', {'originalDefinitionLoaded': True})
    return inverse_catalog_ack(host, before)


def reconcile_inverse(host):
    child_gone(host, 'inverse-sql-child.json')
    before, _ = owned(host); intent = document(BASE / 'sql-inverse-intent.json'); prepared = document(BASE / 'sql-inverse-prepared.json')
    inverse_intent = document(BASE / 'inverse-intent.json')
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['operationSha256'] == sha(protected(BASE / 'before.json')) and
         intent['inverseReviewHash'] == inverse_intent['reviewHash'] == sha(encoded(inverse_intent['binding'])) and
         inverse_intent['binding']['operationSha256'] == intent['operationSha256'] and inverse_intent['binding']['bootId'] == boot() and
         intent['committedSha256'] == sha(protected(BASE / 'sql-committed.json')) and prepared['mode'] == 'inverse' and
         prepared['format'] == 'yunipals-ypal-cache-guard-sql-v1' and prepared['event'] == 'commit-prepared' and
         prepared['planSha256'] == sha(document(BASE / 'sql-committed.json')['resultJson'].encode()) and
         re.fullmatch('[1-9][0-9]*', prepared['xid']), 'exact_owned_cache_inverse_prepared_XID_required')
    need(xact_status(host, prepared['xid']) == 'committed', 'inverse_COMMIT_unknown_no_reexecution')
    current = sql_child(host, 'inspect')
    need(current['catalogSha256'] == prepared['afterCatalogSha256'] and
         host.read.acl_catalog(current['postProof']['catalog']) == host.read.acl_catalog(prepared['postProof']['catalog']), 'exact_current_inverse_postgraph_required')
    save('sql-inversed.json', {'format': FORMAT, 'restored': True, 'reconciled': True, 'xid': prepared['xid'],
         'commitIntentSha256': sha(protected(BASE / 'sql-inverse-intent.json')), 'preparedSha256': sha(protected(BASE / 'sql-inverse-prepared.json')),
         'original143GraphRestored': True, 'databaseWrites': 0, 'serviceActions': 0})
    host.read.validate_current(host.config['readAdmissionSha256']); return {'catalogInverseCommitted': True, 'reconciled': True, 'serviceActions': 0}


def validate_inverse_catalog_current(pin):
    receipt = document(BASE / 'inverse-catalog-result.json', pin)
    need(receipt['format'] == FORMAT and receipt['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         receipt['bootId'] == boot() and receipt['cacheInactive'] is True and receipt['fourCacheReadsRemoved'] is True,
         'same_owned_inactive_cache_inverse_ack_required')
    host = Host(receipt['config']); host.read.validate_current(host.config['readAdmissionSha256']); host.private(); loaded(host, False)
    value = host.state(); group = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
    need(value['MainPID'] == value['ControlPID'] == '0' and value['ActiveState'] in {'inactive', 'failed'} and value['Job'] == '' and
         (not group.exists() or not group.read_text().split()) and not os.path.lexists(BOOT), 'cache_still_terminal_before_generation_inverse')
    return {'format': FORMAT, 'validated': True, 'inverseCatalogReceiptSha256': pin, 'cacheInactive': True,
            'readAdmissionSha256': host.config['readAdmissionSha256'], 'generationSha256': host.config['generationSha256'],
            'databaseWrites': 0, 'serviceActions': 0, 'sourceReadinessClaimed': False}


def finish_inverse(host, generation_inverse_sha=None):
    before, _ = owned(host)
    if not (BASE / 'old-start-intent.json').exists(): validate_inverse_catalog_current(sha(protected(BASE / 'inverse-catalog-result.json')))
    if generation_inverse_sha is None:
        # Preparation kept103 selected. No generation inverse is needed or invented.
        generation_owner = module(GENERATION_OWNER, GENERATION_OWNER_SHA)
        proof = generation_owner.validate_candidate_database_current(host.config['generationSha256'])
        need(proof['validated'] is True and proof['operatorSha256'] == GENERATION_OWNER_SHA and proof['receiptSha256'] == host.config['generationSha256'] and
             proof['globalContextUnchanged'] is True and proof['published'] is False,
             'unchanged_legacy103_and_global_derived_state_before_cache_restore')
    else:
        restored = document(GENERATION.parent / 'restore-derived-result.json', generation_inverse_sha)
        capsule = document(GENERATION.parent / 'capsule-result.json')
        need(restored['format'] == 'yunipals-generation-recovery-inverse-v1' and restored['restored'] is True and
             restored['allDerivedIdentityColumnsRestored'] is True and restored['ownedGenerationRetained'] == before['binding']['prerequisites']['generationId'] and
             restored['currentGeneration'] == capsule['currentGeneration'] and restored['previousGeneration'] == capsule['previousGeneration'],
             'exact_generation_capsule_inverse_before_legacy_cache_restart_required')
        pointer = host.query("SELECT jsonb_build_object('current',current_id::text,'previous',previous_id::text)FROM metadata_projection.active WHERE singleton")
        need(pointer == {'current': restored['currentGeneration'], 'previous': restored['previousGeneration']}, 'actual_restored_generation_pointer_required')
    if not (BASE / 'original-restarted.json').exists():
        if (BASE / 'old-start-intent.json').exists():
            actor = host.actor(False, False); intent = document(BASE / 'old-start-intent.json')
            need(actor['main']['startTicks'] * 1000000 // os.sysconf('SC_CLK_TCK') >= intent['monotonicUs'] and
                 actor['unit']['InvocationID'] != intent['previousInvocation'], 'exact_owned_restored_cache_start_after_lost_ACK_required')
        else:
            value = host.state(); need(value['MainPID'] == '0' and value['Job'] == '', 'old_cache_terminal_before_owned_restart')
            save('old-start-intent.json', {'bootId': boot(), 'previousInvocation': value['InvocationID'], 'monotonicUs': time.monotonic_ns() // 1000,
                 'generationInverseSha256': generation_inverse_sha})
            need(host.state() == value, 'cache_unit_changed_after_old_restart_intent'); manager('start'); actor = host.actor(False, False)
        save('original-restarted.json', actor)
    actor = document(BASE / 'original-restarted.json'); current = host.actor(False, False)
    need(same_activation(current, actor, 'inverse-boot-publish-intent.json'), 'same_owned_restored_cache_invocation_required')
    if not os.path.lexists(BOOT):
        need(inode(BASE / 'original-boot-link', True) == before['binding']['boot'], 'original_cache_boot_inode_before_inverse_enable')
        if not (BASE / 'inverse-boot-publish-intent.json').exists(): save('inverse-boot-publish-intent.json', before['binding']['boot'])
        os.rename(BASE / 'original-boot-link', BOOT); sync(BOOT.parent); sync(BASE)
    need(inode(BOOT, True) == before['binding']['boot'], 'same_original_cache_boot_restored')
    if not (BASE / 'inverse-enable-reload-result.json').exists():
        if (BASE / 'inverse-enable-reload-intent.json').exists(): need(host.state()['UnitFileState'] == 'enabled', 'unknown_inverse_enable_requires_readonly_confirmation')
        else: save('inverse-enable-reload-intent.json', before['binding']['boot']); manager('daemon-reload')
        save('inverse-enable-reload-result.json', {'bootIdentity': inode(BOOT, True)})
    result = {'format': FORMAT, 'restored': True, 'bootId': boot(), 'cacheActor': host.actor(False, False), 'cacheBoot': inode(BOOT, True),
              'generationInverseSha256': generation_inverse_sha, 'original143GraphPreserved': True, 'oldPidRestoredClaimed': False,
              'oldDefinitionAndPrivateConfigurationPreserved': True}
    save('inverse-result.json', result); return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--inputs', required=True); parser.add_argument('--inputs-sha', required=True)
    parser.add_argument('--additional-reads'); action = parser.add_mutually_exclusive_group()
    for name in ['rehearse', 'drain', 'commit', 'reconcile-commit', 'reconcile-inverse', 'inverse', 'finish', 'archive-aborted-rehearsal']: action.add_argument('--' + name)
    for name in ['inspect', 'reconcile-stop', 'acknowledge-prepared', 'inverse-review', 'archive-review']: action.add_argument('--' + name, action='store_true')
    action.add_argument('--finish-inverse', nargs='?', const='unchanged-103'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_cache_owner_host_required')
    os.umask(0o077); inputs(); host = Host(configuration(args))
    with host.s.transition_lock():
        if args.archive_review: result = archive_review(host)
        elif args.archive_aborted_rehearsal: result = archive_aborted(host, args.archive_aborted_rehearsal)
        elif args.rehearse: result = rehearsal(host, args.rehearse)
        elif args.drain: result = drain(host, args.drain, args.additional_reads)
        elif args.commit:
            before, rehearsed = owned(host)
            need(args.commit == before['reviewHash'] and args.additional_reads == rehearsed['additionalReadDeltaSha256'], 'explicit_cache_COMMIT_and_four_SELECT_authorization_required')
            result = commit(host)
        elif args.reconcile_commit:
            need(args.reconcile_commit == sha(protected(BASE / 'sql-intent.json')), 'exact_cache_SQL_intent_pin_required'); result = reconcile_commit(host)
        elif args.reconcile_inverse:
            need(args.reconcile_inverse == sha(protected(BASE / 'sql-inverse-intent.json')), 'exact_cache_inverse_SQL_intent_pin_required'); result = reconcile_inverse(host)
        elif args.reconcile_stop: result = reconcile_stop(host)
        elif args.acknowledge_prepared: result = prepare_ack(host)
        elif args.inverse_review: result = inverse_review(host)
        elif args.inverse: result = inverse(host, args.inverse)
        elif args.finish: result = finish(host, args.finish)
        elif args.finish_inverse: result = finish_inverse(host, None if args.finish_inverse == 'unchanged-103' else args.finish_inverse)
        elif args.inspect: result = inspect(host)
        else: result = review(host)
        print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_cache_owner_deadline_expired')); signal.alarm(300)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'cache_private_diagnostics_withheld',
            'automaticRetryAllowed': False, 'needsExplicitReadOnlyReconciliation': True})); raise SystemExit(1)
    finally: signal.alarm(0)
