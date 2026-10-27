#!/usr/bin/env python3
"""Explicit owned metadata drain/adopt/select/provenance/inverse phases.

Default reviews only. No implicit phase continuation or retry after an unknown
service/CLI acknowledgement. Original journals and publication proofs remain.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time

FORMAT = 'yunipals-ypal-restored-metadata-handover-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-restored-metadata-handover-v1-20261024')
CANDIDATES = Path('/var/backups/yunipals-ypal-native-metadata-candidates-v1-20261023')
CANDIDATE_SHA = '21cb9989c4054c83bc77af2b9dfb8ac2ee0aa204747ba6005fa6ed7c2f1a5cb3'
META_FILE = OPS / 'ypal-native-metadata-candidates-v1.py'
META_SHA = '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525'
ADMISSION_FILE = OPS / 'ypal-restored-read-admission-v1.py'
ADMISSION_RESULT = Path('/var/backups/yunipals-ypal-restored-read-admission-v1-20261024/result.json')
INPUT = Path('/var/backups/yunipals-ypal-restored-metadata-input-v1-20261024/input.json')
SOURCES = OPS / 'ypal-restored-metadata-handover-v1.sources.json'
PROVIDER = OPS / 'ypal-restored-read-cache-provider-v1.py'
CONTEXT = OPS / 'ypal-restored-metadata-context-v1.py'
CONTEXT_SHA = 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
TEMPLATE = OPS / 'ypal-native-metadata-handover-v1.py'
TEMPLATE_SHA = '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1'
UNIT = 'yunipals-metadata.service'
DROP = Path('/etc/systemd/system') / (UNIT + '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-restored-native-metadata.conf')
BOOT = Path('/etc/systemd/system/multi-user.target.wants') / UNIT
LOCK = Path('/run/lock/yunipals-ypal-native-metadata-transition.lock')
PROPS = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'InvocationID', 'ControlGroup',
    'ExecStart', 'ExecMainStartTimestampMonotonic', 'NRestarts', 'User', 'Group', 'FragmentPath', 'DropInPaths',
    'EnvironmentFiles', 'WorkingDirectory', 'Job', 'Restart', 'UnitFileState', 'WantedBy', 'RequiredBy',
    'TriggeredBy', 'Triggers', 'PartOf', 'UpheldBy', 'KillMode')
PHASES = ('drain', 'adopt', 'select', 'provenance', 'inverse', 'finish-inverse')


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def link(path):
    info = path.lstat(); need(stat.S_ISLNK(info.st_mode) and info.st_uid == info.st_gid == 0, 'owned_metadata_boot_symlink_required')
    return {'target': os.readlink(path), 'device': info.st_dev, 'inode': info.st_ino, 'mode': info.st_mode, 'uid': info.st_uid, 'gid': info.st_gid}


def file_identity(path):
    info = path.lstat(); need(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and info.st_nlink == 1, 'owned_regular_metadata_drop_required')
    return {'device': info.st_dev, 'inode': info.st_ino, 'mode': info.st_mode, 'uid': info.st_uid, 'gid': info.st_gid}


@contextlib.contextmanager
def lock():
    parent = LOCK.parent.lstat()
    need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and
         (not parent.st_mode & 0o022 or stat.S_IMODE(parent.st_mode) == 0o1777), 'protected_metadata_lock_parent_required')
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd); current = LOCK.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and info.st_nlink == 1 and
             stat.S_IMODE(info.st_mode) == 0o600 and (info.st_dev, info.st_ino) == (current.st_dev, current.st_ino), 'owned_metadata_lock_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); yield
    finally: os.close(fd)


def state(m):
    raw = m.run(['/usr/bin/systemctl', 'show', '--all', UNIT, *['--property=' + k for k in PROPS]])
    value = {}
    for line in raw.decode().splitlines():
        key, sep, val = line.partition('='); need(sep and key in PROPS, 'exact_metadata_manager_keys_required')
        if key == 'EnvironmentFiles': value.setdefault(key, []).append(val)
        else:
            need(key not in value, 'unique_metadata_manager_keys_required'); value[key] = val
    need(set(value) == set(PROPS) and value['Id'] == UNIT and value['KillMode'] == 'control-group', 'complete_metadata_unit_state_required')
    return value


def manager(m, action):
    need(action in {'stop', 'start', 'daemon-reload'}, 'only_metadata_manager_actions_allowed')
    args = ['/usr/bin/systemctl', action] + ([] if action == 'daemon-reload' else [UNIT])
    r = subprocess.run(args, capture_output=True, timeout=90, env=m.CLEAN, cwd='/')
    need(r.returncode == 0 and not r.stdout and not r.stderr, 'metadata_manager_ack_unknown_do_not_repeat')


def identity_alive(m, actor):
    try: return m.process(str(actor['pid'])) == actor
    except FileNotFoundError: return False


class Host:
    def __init__(self, config, refresh_callback, inverse=False, primitives=None, admission_ref=None):
        initialize(self, config, refresh_callback, inverse, primitives, admission_ref)
    def refresh(self):
        value = self.refresh_callback()
        need(value['validated'] is True and value['readAdmissionSha256'] == self.read_config['admissionSha256'] and
             value['readPlanSha256'] == self.read_config['readPlanSha256'] and
             value['readContextInputSha256'] == self.read_config['readContextInputSha256'] and
             value['originalWholeValidatorPassed'] is False and
             value['databaseWrites'] == value['serviceActions'] == value['providerCalls'] == 0,
             'explicit_current_phase_READ_proof_with_exact_new_refs_required')
        for name, expected in self.candidate['files'].items():
            need(sha(self.m.protected(CANDIDATES / name)) == expected, 'staged_metadata_candidate_changed')
        return value
    def query(self, sql): return self.h.query(sql)
    def files(self, value): return {p: sha(self.m.protected(p)) for p in [value['FragmentPath'], *value['DropInPaths'].split()] if p}
    def private(self, old):
        need(all(sha(self.m.protected(p)) == expected for p, expected in old['environmentFileHashes'].items()), 'original_metadata_private_input_changed')
        need(all(sha(self.m.protected(p)) == expected for p, expected in old['definitions'].items()), 'original_metadata_definition_changed')
    def actor(self, op=None, native=False, pristine=True):
        value = state(self.m); need(value['ActiveState'] == 'active' and value['SubState'] == 'running' and value['Job'] == '' and
            value['ControlGroup'] == '/system.slice/' + UNIT and re.fullmatch('[1-9][0-9]*', value['MainPID']), 'running_owned_metadata_actor_required')
        pid = value['MainPID']; main = self.m.process(pid)
        if native:
            self.private(op['oldWriter'])
            need(file_identity(DROP) == self.s.document(BASE / 'native-drop-created.json'), 'exact_owned_native_drop_inode_required')
            expected_files = {**op['oldWriter']['definitions'], str(DROP): self.candidate['files']['yunipals-metadata.service.drop-in.candidate']}
            need(self.files(value) == expected_files and value['User'] == op['oldUnit']['User'] and value['Group'] == op['oldUnit']['Group'], 'owned_native_metadata_definition_and_identity_required')
            expected = self.m.NODE + ' ' + str(self.installer.TARGET / 'dist/metadata-worker.mjs')
            need(re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) == [expected] and value['NRestarts'].isdecimal() and (not pristine or value['NRestarts'] == '0'), 'exact_native_metadata_command_and_pristine_actor_required')
            merged = {}
            inline = self.m.service_property(UNIT, 'Environment')
            need(sha(encoded(inline)) == op['oldWriter']['inlineEnvironmentSha256'] and
                 not any(self.m.service_property(UNIT, key) for key in ['PassEnvironment', 'UnsetEnvironment']), 'unchanged_inline_metadata_configuration_required')
            for item in inline:
                key, sep, val = item.partition('='); need(sep, 'explicit_metadata_environment_required'); merged[key] = val
            names = self.m.ordered_files(value['EnvironmentFiles'])
            need(names == [(p, False) for p in self.m.ENV_FILES[UNIT]] + [(str(CANDIDATES / 'yunipals-metadata.selectors.env'), False)], 'exact_native_metadata_private_selector_order_required')
            for p, _ in names: merged.update(self.m.parse_env(self.m.protected(p)))
            actual = self.m.process_env(pid)
            need(all(actual.get(k) == merged.get(k) for k in set(merged) | set(self.m.RECOVERY_KEYS)), 'native_metadata_configured_values_must_match_process')
        cgroup = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
        pids = [int(p) for p in cgroup.read_text().split()]; need(int(pid) in pids and 1 <= len(pids) <= 8, 'bounded_owned_metadata_cgroup_required')
        actors = [self.m.process(str(p)) for p in sorted(pids)]
        need(state(self.m) == value and self.m.process(pid) == main, 'metadata_actor_changed_during_capture')
        return {'unit': value, 'main': main, 'processes': actors, 'commandSha256': sha((Path('/proc') / pid / 'cmdline').read_bytes())}
    def sessions(self, actor):
        sql = "SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584"
        rows = self.query(sql)
        need(len(rows) <= 64, 'bounded_shared_metadata_role_sessions_required')
        o = self.h.observer; backend = o.peer_fds([r['pid'] for r in rows], 111, 113)
        peers = o.unix_peers(o.run(['/usr/bin/ss', '-xHn']))
        tcp = {**o.tcp_clients(Path('/proc/net/tcp').read_bytes()), **o.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
        mapped = o.map_owned_backends(o.peer_fds([p['pid'] for p in actor['processes']], 0, 0), backend, rows, peers, tcp)
        need(self.query(sql) == rows, 'metadata_backend_churn_retry_readonly_observation_only')
        owned = {r['pid'] for r in mapped}
        return {'owned': mapped, 'otherPeers': [{'pid': r['pid'], 'backendStart': r['backendStart']} for r in rows if r['pid'] not in owned]}
    def terminal(self, op, actor, sessions=None):
        value = state(self.m); need(value['MainPID'] == value['ControlPID'] == '0' and value['Job'] == '' and value['ActiveState'] in {'inactive', 'failed'}, 'metadata_unit_must_be_terminal')
        cg = Path('/sys/fs/cgroup/system.slice') / UNIT / 'cgroup.procs'
        need(not cg.exists() or not cg.read_text().split(), 'metadata_cgroup_must_be_empty')
        need(not any(identity_alive(self.m, p) for p in actor['processes']), 'owned_metadata_processes_must_be_gone')
        sessions = (self.s.document(BASE / 'drain-session-proof.json')['sessions'] if (BASE / 'drain-session-proof.json').exists() else op['oldSessions']) if sessions is None else sessions
        rows = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)), '[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584")
        need(not any(any(r['pid'] == old['pid'] and r['backendStart'] == old['backendStart'] for old in sessions['owned']) for r in rows), 'owned_metadata_backend_sessions_must_be_gone')
        need(all(r in sessions['otherPeers'] for r in rows), 'new_unattributed_shared_role_backend_requires_readonly_reconciliation')
        return value
    def database(self):
        r = self.meta.READ
        return self.query(f"SELECT jsonb_build_object('at',clock_timestamp(),'scan',(SELECT to_jsonb(s) FROM metadata_source.chain_metadata_scan s WHERE name='base_metadata_v1'),'frame',CASE WHEN coalesce(({r}.source_probe('base')->>'ready')::boolean,false)THEN(SELECT to_jsonb(f)FROM {r}.base_metadata_frame(false)f)END,'probe',{r}.base_metadata_probe(),'approval',(SELECT to_jsonb(a)FROM metadata_source.native_base_metadata_state a WHERE release_id='{self.meta.RELEASE}'),'remainingPublished',(SELECT count(*)FROM metadata.token_publication p WHERE p.collection='base' AND p.source_kind='archive' AND p.publication_status='published' AND p.chain_event_block_hash IS NULL AND EXISTS(SELECT 1 FROM metadata_source.archive_release a WHERE a.release_id=p.release_id AND a.state='active')),'publication',(SELECT to_jsonb(p)FROM metadata.publication_runtime p WHERE singleton))")
    def publication_proof(self):
        path = self.m.PROJECT / 'lib/metadata/read-source.ts'
        need(sha(self.m.protected(path)) == '1c80f8ca18c609c8a47e164730aa5409ea2a9a65c2697bac4498c2ab1ba63208', 'exact_official_publication_sql_compiler_required')
        js = 'import{metadataReadRelationFor}from' + json.dumps(str(path)) + ';console.log(JSON.stringify({sql:metadataReadRelationFor(' + json.dumps('"' + self.meta.READ + '"') + ',true,["base"])}));process.exit(0);'
        r = subprocess.run(['/usr/bin/env', '-i', *[k + '=' + v for k, v in self.m.CLEAN.items()], self.m.NODE,
            '--env-file=' + str(CANDIDATES / 'native-recovery.env'), '--import', 'tsx', '--input-type=module', '-e', js], capture_output=True, timeout=20, env=self.m.CLEAN, cwd=str(self.m.PROJECT))
        need(r.returncode == 0 and not r.stderr and len(r.stdout) < 100000, 'official_native_publication_sql_compilation_failed')
        sql = json.loads(r.stdout)['sql']; need(isinstance(sql, str) and self.meta.READ in sql and self.meta.OLD_READ not in sql and 'base_metadata_event' in sql and 'chain_event_block_hash' in sql, 'fresh_native_publication_sql_required')
        result = self.query("SELECT jsonb_build_object('canonicalRows',(SELECT count(*)FROM " + sql + " p WHERE p.collection='base'),'publishedRows',(SELECT count(*)FROM metadata.token_publication p WHERE p.collection='base' AND p.source_kind='archive' AND p.publication_status='published' AND EXISTS(SELECT 1 FROM metadata_source.archive_release a WHERE a.release_id=p.release_id AND a.state='active')),'probe'," + self.meta.READ + '.base_metadata_probe())')
        return {**result, 'officialSqlSha256': sha(sql.encode()), 'allPublishedCanonical': result['canonicalRows'] == result['publishedRows'] and result['publishedRows'] > 0 and result['probe'] is True}
    def official(self, name, command):
        need(command in {'native-adopt', 'native-provenance', 'native-refresh'}, 'only_three_official_metadata_commands_allowed')
        self.refresh(); no_live_cli(self)
        intent = {'command': command, 'bootId': self.s.boot(), 'startedAt': self.query("SELECT to_jsonb(clock_timestamp())"), 'automaticRetryAllowed': False}
        self.s.save(BASE / (name + '-intent.json'), intent)
        with (BASE / (name + '.stdout.private')).open('xb') as out, (BASE / (name + '.stderr.private')).open('xb') as err:
            child = subprocess.Popen([str(CANDIDATES / 'native-recovery.sh'), command], stdout=out, stderr=err, env=self.m.CLEAN, cwd='/', start_new_session=True)
            actor = self.m.process(str(child.pid)); self.s.save(BASE / (name + '-child.json'), actor)
            try: status = child.wait(timeout=660)
            except subprocess.TimeoutExpired: raise RuntimeError('official_metadata_child_still_live_unknown_outcome_do_not_retry') from None
        raw = self.m.protected(BASE / (name + '.stdout.private'), 100000)
        lines = [line for line in raw.splitlines() if line.startswith(b'{')]
        need(status == 0 and len(lines) == 1 and (BASE / (name + '.stderr.private')).stat().st_size == 0, 'official_metadata_command_ack_unknown_inspect_do_not_repeat')
        result = json.loads(lines[0]); need(result.get('event') == 'base_metadata_' + command, 'wrong_official_metadata_result')
        self.s.save(BASE / (name + '-result.json'), result); self.refresh(); return result


def covered(db):
    scan, frame = db['scan'], db['frame']
    return bool(frame and scan and str(scan['chain_id']) == '8453' and
        scan['contract_address'] == '0x98433df878e8c898cb907345c3a7756e5f72240f' and
        int(scan['deployment_block']) == 22224075 and int(frame['block_number']) >= int(scan['next_block']) - 1)


def boot_disabled_actor(actor):
    # Only the owned removal/reload changes these two expected manager fields.
    return {**actor, 'unit': {**actor['unit'], 'UnitFileState': 'disabled', 'WantedBy': ''}}


def review(h):
    execution = execution_context(h, h.execution_context)
    h.refresh(); old, _ = h.m.snapshot(UNIT); actor = h.actor(); value = actor['unit']
    need(value['Restart'] == 'on-failure' and value['UnitFileState'] == 'enabled' and value['WantedBy'] == 'multi-user.target' and
         all(value[k] == '' for k in ['RequiredBy', 'TriggeredBy', 'Triggers', 'PartOf', 'UpheldBy']), 'sole_original_metadata_activation_required')
    boot = link(BOOT); need(boot['target'] == '/etc/systemd/system/' + UNIT and not os.path.lexists(DROP), 'exact_original_metadata_boot_and_absent_owned_drop_required')
    db = h.database(); need(db['scan']['ingestion_mode'] == 'rpc' and db['approval'] is None, 'fresh_native_metadata_adoption_required')
    binding = {'format': FORMAT, 'operatorSha256': sha(h.s.protected(Path(__file__).absolute())), 'bootId': h.s.boot(),
        'admissionSha256': h.admission_pin, 'admissionOperatorSha256': h.admission_ref['producerSha256'], 'candidateSha256': CANDIDATE_SHA,
        'readConfig': h.read_config, 'admissionRef': h.admission_ref, 'executionContext': execution, 'historicalMetadataProducerSha256': TEMPLATE_SHA,
        'sourceRestoreReceiptSha256': '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1',
        'oldWriter': old, 'oldActor': actor, 'oldUnit': value, 'oldBoot': boot, 'oldSessions': h.sessions(actor),
        'candidateDropSha256': h.candidate['files']['yunipals-metadata.service.drop-in.candidate']}
    need(h.m.snapshot(UNIT)[0] == old and h.actor() == actor, 'old_metadata_writer_changed_during_review')
    h.refresh(); return binding, db


def operation(h, pin):
    value = h.s.document(BASE / 'operation.json', pin)
    need(value['format'] == FORMAT and value['operatorSha256'] == sha(h.s.protected(Path(__file__).absolute())) and value['bootId'] == h.s.boot() and
         value['admissionSha256'] == h.admission_pin and value['candidateSha256'] == CANDIDATE_SHA and
         value['readConfig'] == h.read_config and value['admissionRef'] == h.admission_ref and
         value['admissionOperatorSha256'] == h.admission_ref['producerSha256'] and value['historicalMetadataProducerSha256'] == TEMPLATE_SHA, 'same_owned_metadata_operation_required')
    execution_context(h, value['executionContext']); h.refresh(); return value


def drained(h, op):
    need(not os.path.lexists(BOOT) and link(BASE / 'original-boot-link') == op['oldBoot'], 'owned_disabled_metadata_boot_required')
    fresh = h.s.document(BASE / 'drain-session-proof.json')
    h.private(op['oldWriter']); h.terminal(op, op['oldActor'], fresh['sessions'])


def drain(h, binding):
    need(not os.path.lexists(BASE), 'fresh_metadata_operation_required')
    db = h.database(); need(covered(db), 'real_native_base_coverage_of_current_legacy_cursor_required')
    BASE.mkdir(mode=0o700); h.s.sync(BASE.parent); pin = h.s.save(BASE / 'operation.json', binding)
    h.s.save(BASE / 'boot-remove-intent.json', op_boot := binding['oldBoot'])
    need(link(BOOT) == op_boot, 'original_metadata_boot_changed'); os.rename(BOOT, BASE / 'original-boot-link'); h.s.sync(BOOT.parent); h.s.sync(BASE)
    h.s.save(BASE / 'boot-remove-result.json', {'removed': True}); manager(h.m, 'daemon-reload')
    old = boot_disabled_actor(binding['oldActor']); need(h.actor() == old, 'same_metadata_actor_before_fresh_session_capture')
    fresh_sessions = h.sessions(old); need(h.actor() == old, 'same_metadata_actor_after_fresh_session_capture')
    h.s.save(BASE / 'drain-session-proof.json', {'actor': old, 'sessions': fresh_sessions})
    h.s.save(BASE / 'stop-old-intent.json', {'actor': binding['oldActor'], 'monotonicUs': time.monotonic_ns() // 1000})
    need(h.actor() == boot_disabled_actor(binding['oldActor']), 'old_metadata_actor_changed_after_stop_intent'); manager(h.m, 'stop')
    drained(h, binding); db = h.database(); need(covered(db) and db['scan']['ingestion_mode'] == 'rpc', 'drained_cursor_must_be_covered_before_adoption')
    h.s.save(BASE / 'drained.json', {'operationSha256': pin, 'scan': db['scan'], 'frame': db['frame'], 'stopped': True}); return pin


def adopt(h, op):
    drained(h, op); before = h.s.document(BASE / 'drained.json'); db = h.database()
    need(db['scan'] == before['scan'] and covered(db) and db['approval'] is None, 'unchanged_drained_rpc_cursor_and_no_approval_required')
    result = h.official('adopt', 'native-adopt')
    need(result.get('adopted') is True and result.get('releaseId') == h.meta.RELEASE and result.get('readIdentity') == h.meta.IDENTITY and
         str(result.get('legacyNextBlock')) == str(before['scan']['next_block']), 'official_exact_native_adoption_result_required')
    after = h.database(); need(after['scan']['ingestion_mode'] == 'native' and str(after['scan']['next_block']) == str(before['scan']['next_block']) and
        after['approval']['read_identity'] == h.meta.IDENTITY and after['approval']['state'] == 'ready', 'actual_native_adoption_state_required')
    h.s.save(BASE / 'adopted.json', {'result': result, 'after': after, 'officialAcknowledgementPresent': True}); return after


def start_intent_actor(h, op):
    start = h.s.document(BASE / 'native-start-intent.json'); actor = h.actor(op, True)
    need(int(actor['unit']['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'] and
         h.s.boot() == start['bootId'], 'native_metadata_start_must_follow_owned_intent')
    return actor


def select(h, op):
    drained(h, op); need((BASE / 'adopted.json').exists(), 'acknowledged_native_adoption_required_before_selection')
    db = h.database(); need(db['scan']['ingestion_mode'] == 'native' and db['approval']['read_identity'] == h.meta.IDENTITY, 'still_adopted_metadata_state_required')
    raw = h.m.protected(CANDIDATES / 'yunipals-metadata.service.drop-in.candidate')
    h.s.save(BASE / 'native-drop-intent.json', {'path': str(DROP), 'sha256': sha(raw)})
    h.s.save(DROP, raw); h.s.save(BASE / 'native-drop-created.json', file_identity(DROP)); manager(h.m, 'daemon-reload')
    h.s.save(BASE / 'native-start-intent.json', {'bootId': h.s.boot(), 'monotonicUs': time.monotonic_ns() // 1000})
    h.refresh(); h.private(op['oldWriter']); h.terminal(op, op['oldActor']); manager(h.m, 'start')
    actor = start_intent_actor(h, op); h.s.save(BASE / 'native-started.json', actor)
    accept_native(h, op, actor)
    h.s.save(BASE / 'boot-publish-intent.json', op['oldBoot']); need(not os.path.lexists(BOOT) and link(BASE / 'original-boot-link') == op['oldBoot'], 'same_preserved_boot_inode_required')
    os.rename(BASE / 'original-boot-link', BOOT); h.s.sync(BOOT.parent); h.s.sync(BASE); manager(h.m, 'daemon-reload')
    selected_actor = h.actor(op, True)
    need(selected_actor == {**actor, 'unit': {**actor['unit'], 'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target'}}, 'only_owned_boot_activation_changed')
    return h.s.save(BASE / 'selected.json', {'nativeActor': selected_actor, 'boot': link(BOOT), 'selected': True, 'provenanceComplete': False})


def accept_native(h, op, actor):
    samples = []
    for index in range(3):
        if index: time.sleep(10)
        h.refresh(); need(h.actor(op, True) == actor, 'same_native_metadata_actor_during_acceptance')
        db = h.database(); need(db['scan']['ingestion_mode'] == 'native' and db['probe'] is True and
             db['approval']['read_identity'] == h.meta.IDENTITY and db['approval']['state'] == 'ready', 'native_metadata_approval_and_probe_required')
        samples.append(db)
    h.s.save(BASE / 'native-observed.json', {'samples': samples, 'elapsedSeconds': 20, 'nativeWorkerFunctional': True})


def provenance(h, op, index):
    need(type(index) is int and 0 <= index < 128 and (BASE / 'selected.json').exists(), 'bounded_owned_provenance_phase_required')
    actor = h.s.document(BASE / 'selected.json')['nativeActor']; need(h.actor(op, True) == actor, 'same_native_worker_before_provenance')
    need(all((BASE / ('provenance-' + str(i) + '-observed.json')).exists() for i in range(index)), 'all_prior_provenance_attempts_need_acknowledgement')
    result = h.official('provenance-' + str(index), 'native-provenance')
    if result.get('busy') is True:
        h.s.save(BASE / ('provenance-' + str(index) + '-observed.json'), {'officialResult': result, 'busy': True, 'completeForCurrentPublishedArchiveBase': False})
        return {'busy': True, 'complete': False, 'automaticRetryAllowed': False}
    need(type(result.get('stamped')) is int and 0 <= result['stamped'] <= 5000, 'bounded_actual_official_provenance_result_required')
    db = h.database(); proof = h.publication_proof() if db['remainingPublished'] == 0 and db['probe'] is True else None
    complete = bool(proof and proof['allPublishedCanonical'])
    h.s.save(BASE / ('provenance-' + str(index) + '-observed.json'), {'officialResult': result, 'remainingPublished': db['remainingPublished'],
        'publicationProof': proof, 'completeForCurrentPublishedArchiveBase': complete, 'unmatchedRowsNotDeletedOrManufactured': True}); return {'stamped': result['stamped'], 'remainingPublished': db['remainingPublished'], 'complete': complete}


INVERSE_JS = r"""
import{createRequire}from'node:module';const require=createRequire(process.cwd()+'/package.json');const{Client}=require('pg');
let input='';for await(const chunk of process.stdin)input+=chunk;const v=JSON.parse(input),db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:10000});
const stable=x=>{const y={...x};delete y.updated_at;delete y.ingestion_mode;return JSON.stringify(Object.keys(y).sort().map(k=>[k,y[k]]));};
try{await db.connect();const who=(await db.query("SELECT current_user AS role,current_database()AS database")).rows[0];if(who.role!=='yunipals'||who.database!=='yunipals_backfill')throw Error('wrong_actor');
await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='3s'");
if(!(await db.query("SELECT pg_try_advisory_xact_lock(hashtext('metadata:base-replay'))AS acquired")).rows[0].acquired)throw Error('writer_busy');
const scan=(await db.query("SELECT to_jsonb(s)AS value FROM metadata_source.chain_metadata_scan s WHERE name='base_metadata_v1' FOR UPDATE")).rows[0].value;
if(stable(scan)!==stable(v.scan)||scan.ingestion_mode!=='native')throw Error('cursor_or_mode_changed');
const approval=(await db.query('SELECT * FROM metadata_source.native_base_metadata_state WHERE release_id=$1 FOR UPDATE',[v.release])).rows[0];if(approval?.read_identity!==v.identity)throw Error('approval_changed');
await db.query("UPDATE metadata_source.chain_metadata_scan SET ingestion_mode='rpc',updated_at=clock_timestamp()WHERE name='base_metadata_v1'");
await db.query("UPDATE metadata_source.native_base_metadata_state SET state='blocked',error_code='owned_metadata_inverse'WHERE release_id=$1 AND read_identity=$2",[v.release,v.identity]);
await db.query('COMMIT');console.log(JSON.stringify({modeRestored:'rpc',approvalBlocked:true,journalOrProvenanceRowsDeleted:0}));
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({failed:true,commitOutcomeMayBeUnknown:true}));process.exitCode=1;}finally{await db.end().catch(()=>{});}
"""


def stable_scan(scan): return {key: value for key, value in scan.items() if key not in {'updated_at', 'ingestion_mode'}}


def inverse_sql(h, scan):
    h.s.save(BASE / 'inverse-sql-intent.json', {'scan': scan, 'release': h.meta.RELEASE, 'identity': h.meta.IDENTITY})
    args = ['/usr/bin/env', '-i', *[k + '=' + v for k, v in h.m.CLEAN.items()], 'PGAPPNAME=yunipals_native_metadata_inverse', h.m.NODE,
        '--env-file=' + str(CANDIDATES / 'native-recovery.env'), '--input-type=module', '-e', INVERSE_JS]
    r = subprocess.run(args, input=encoded({'scan': scan, 'release': h.meta.RELEASE, 'identity': h.meta.IDENTITY}), capture_output=True,
        timeout=20, env=h.m.CLEAN, cwd=str(h.m.PROJECT))
    need(r.returncode == 0 and not r.stderr and len(r.stdout) < 2000, 'metadata_inverse_sql_ack_unknown_do_not_repeat')
    result = json.loads(r.stdout); need(result == {'modeRestored': 'rpc', 'approvalBlocked': True, 'journalOrProvenanceRowsDeleted': 0}, 'actual_metadata_inverse_sql_ack_required')
    h.s.save(BASE / 'inverse-sql-result.json', result)


def remember(h, name, value, finish):
    path = BASE / name
    if path.exists(): need(finish and h.s.document(path) == value, 'only_equal_owned_inverse_record_can_be_reused')
    else: h.s.save(path, value)


def loaded(h, op, native, enabled):
    value = state(h.m); expected = h.m.NODE + ' ' + str(h.installer.TARGET / 'dist/metadata-worker.mjs') if native else re.findall(r'argv\[\]=(.*?)\s+;', op['oldUnit']['ExecStart'])[0]
    try: files = h.files(value)
    except FileNotFoundError:
        need(not os.path.lexists(DROP) and str(DROP) in value['DropInPaths'].split(), 'missing_unowned_metadata_definition'); return False
    return (files == {**op['oldWriter']['definitions'], **({str(DROP): op['candidateDropSha256']} if native else {})} and
        re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) == [expected] and value['UnitFileState'] == ('enabled' if enabled else 'disabled') and
        value['WantedBy'] == ('multi-user.target' if enabled else '') and value['User'] == op['oldUnit']['User'] and value['Group'] == op['oldUnit']['Group'])


def reload_inverse(h, op, name, native, enabled, finish):
    path = BASE / (name + '-intent.json'); wanted = {'native': native, 'enabled': enabled}
    if loaded(h, op, native, enabled):
        remember(h, name + '-observed.json', wanted, finish); return
    need(not path.exists(), 'unknown_reload_not_repeated_until_loaded_state_proven')
    remember(h, name + '-intent.json', wanted, finish); manager(h.m, 'daemon-reload')
    need(loaded(h, op, native, enabled), 'owned_metadata_reload_postcondition_required')
    remember(h, name + '-observed.json', wanted, finish)


def inverse(h, op, finish=False):
    need(not (BASE / 'inverse-result.json').exists(), 'completed_metadata_inverse_cannot_be_repeated')
    h.refresh(); h.private(op['oldWriter']); no_live_cli(h); value = state(h.m)
    if finish:
        intent = h.s.document(BASE / 'inverse-intent.json'); native, sessions, old_live = intent['nativeActor'], intent['nativeSessions'], intent['oldStillRunning']
        if (BASE / 'old-start-intent.json').exists() and value['MainPID'] != '0':
            return finish_original_resume(h, op, intent)
    else:
        native = h.actor(op, True, pristine=False) if value['MainPID'] != '0' and os.path.lexists(DROP) else None
        old_actor = h.actor() if value['MainPID'] != '0' and native is None else None
        if old_actor: need(old_actor in [op['oldActor'], boot_disabled_actor(op['oldActor'])], 'only_original_old_actor_may_survive_pre_adoption_prefix')
        old_live = old_actor is not None; sessions = h.sessions(native) if native else None
        h.s.save(BASE / 'inverse-intent.json', {'nativeActor': native, 'nativeSessions': sessions, 'oldStillRunning': old_live})
    published = (BASE / 'inverse-boot-publish-intent.json').exists()
    if not published:
        if os.path.lexists(BOOT):
            need(link(BOOT) == op['oldBoot'] and not os.path.lexists(BASE / 'original-boot-link'), 'only_same_owned_boot_link_can_be_disabled')
            remember(h, 'inverse-boot-remove-intent.json', op['oldBoot'], finish); need(link(BOOT) == op['oldBoot'], 'boot_changed_after_inverse_intent')
            os.rename(BOOT, BASE / 'original-boot-link'); h.s.sync(BOOT.parent); h.s.sync(BASE)
        need(link(BASE / 'original-boot-link') == op['oldBoot'], 'original_boot_inode_preserved_for_inverse')
        reload_inverse(h, op, 'inverse-disable-reload', os.path.lexists(DROP), False, finish)
    if native and not (BASE / 'inverse-native-terminal.json').exists():
        path = BASE / 'inverse-stop-native-intent.json'
        if state(h.m)['MainPID'] != '0':
            need(not path.exists(), 'unknown_native_stop_not_repeated'); current = boot_disabled_actor(native)
            remember(h, path.name, {'actor': native, 'sessions': sessions}, finish)
            need(h.actor(op, True, pristine=False) == current, 'native_metadata_actor_changed_after_inverse_stop_intent'); manager(h.m, 'stop')
        h.terminal(op, native, sessions); remember(h, 'inverse-native-terminal.json', {'stopped': True}, finish)
    elif not native and not old_live and not published: h.terminal(op, op['oldActor'])
    db = h.database(); frozen = h.s.document(BASE / 'drained.json')['scan'] if (BASE / 'drained.json').exists() else db['scan']
    need(stable_scan(db['scan']) == stable_scan(frozen), 'metadata_cursor_cannot_be_reset_by_inverse')
    if db['scan']['ingestion_mode'] == 'native':
        need(not old_live and not (BASE / 'inverse-sql-intent.json').exists(), 'unknown_inverse_sql_not_repeated'); inverse_sql(h, frozen)
    else:
        a = db['approval']; inverse_seen = (BASE / 'inverse-sql-intent.json').exists()
        need(db['scan']['ingestion_mode'] == 'rpc' and (a is None or (inverse_seen and a['read_identity'] == h.meta.IDENTITY and a['state'] == 'blocked' and a['error_code'] == 'owned_metadata_inverse')), 'only_owned_rpc_inverse_or_unchanged_pre_adoption_prefix_allowed')
        if inverse_seen and not (BASE / 'inverse-sql-result.json').exists(): remember(h, 'inverse-sql-reconciled.json', {'rpcModeAndOwnedBlockedApprovalObserved': True, 'originalSqlAcknowledgementPresent': False}, finish)
    if os.path.lexists(DROP):
        need(sha(h.s.protected(DROP)) == op['candidateDropSha256'], 'only_owned_native_drop_can_be_removed')
        owned = h.s.document(BASE / 'native-drop-created.json'); need(file_identity(DROP) == owned, 'same_owned_native_drop_before_inverse')
        remember(h, 'inverse-drop-remove-intent.json', {'sha256': op['candidateDropSha256'], 'identity': owned}, finish)
        need(file_identity(DROP) == owned and sha(h.s.protected(DROP)) == op['candidateDropSha256'], 'owned_drop_changed_after_inverse_intent'); DROP.unlink(); h.s.sync(DROP.parent)
    reload_inverse(h, op, 'inverse-drop-reload', False, os.path.lexists(BOOT), finish)
    h.private(op['oldWriter'])
    if not os.path.lexists(BOOT):
        need(link(BASE / 'original-boot-link') == op['oldBoot'], 'same_preserved_boot_inode_before_inverse_publish')
        remember(h, 'inverse-boot-publish-intent.json', op['oldBoot'], finish); os.rename(BASE / 'original-boot-link', BOOT); h.s.sync(BOOT.parent); h.s.sync(BASE)
    need(link(BOOT) == op['oldBoot'], 'exact_original_boot_inode_restored'); reload_inverse(h, op, 'inverse-enable-reload', False, True, finish)
    if not old_live:
        start = BASE / 'old-start-intent.json'
        if not start.exists():
            resume_scan = h.database()['scan']; need(resume_scan['ingestion_mode'] == 'rpc' and stable_scan(resume_scan) == stable_scan(frozen), 'same_frozen_rpc_cursor_before_original_start')
            h.s.save(start, {'bootId': h.s.boot(), 'monotonicUs': time.monotonic_ns() // 1000, 'scan': resume_scan})
            h.refresh(); h.private(op['oldWriter']); h.terminal(op, native or op['oldActor'], sessions); manager(h.m, 'start')
        else: need(state(h.m)['MainPID'] != '0', 'unknown_original_start_not_repeated')
        need(int(state(h.m)['ExecMainStartTimestampMonotonic']) >= h.s.document(start)['monotonicUs'], 'original_resume_follows_owned_start_intent')
    old, _ = h.m.snapshot(UNIT)
    need(old['definitions'] == op['oldWriter']['definitions'] and old['environmentFileHashes'] == op['oldWriter']['environmentFileHashes'] and
        old['configuredEnvironmentSha256'] == op['oldWriter']['configuredEnvironmentSha256'], 'original_runtime_private_configuration_restored')
    return h.s.save(BASE / 'inverse-result.json', {'restored': True, 'oldWriter': old, 'journalOrProvenanceRowsDeleted': 0,
        'sourceSelectionChanged': False, 'readGrantsChanged': False})


def finish_original_resume(h, op, intent):
    # After an owned original start, only observe its ordinary monotonic replay.
    # Do not apply the pre-start frozen-cursor CAS to a functioning RPC writer.
    need(not os.path.lexists(DROP) and link(BOOT) == op['oldBoot'] and (BASE / 'inverse-boot-publish-intent.json').exists(), 'exact_restored_boot_and_absent_native_drop_required')
    start = h.s.document(BASE / 'old-start-intent.json'); old, _ = h.m.snapshot(UNIT)
    need(start['bootId'] == h.s.boot() and int(state(h.m)['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'] and
         old['definitions'] == op['oldWriter']['definitions'] and old['environmentFileHashes'] == op['oldWriter']['environmentFileHashes'] and
         old['configuredEnvironmentSha256'] == op['oldWriter']['configuredEnvironmentSha256'], 'same_owned_original_resume_and_private_configuration_required')
    if intent['nativeActor']:
        need((BASE / 'inverse-native-terminal.json').exists() and not any(identity_alive(h.m, p) for p in intent['nativeActor']['processes']), 'prior_native_actor_must_remain_terminal_after_original_resume')
    db = h.database(); frozen = start['scan']; current = db['scan']
    need(frozen['ingestion_mode'] == 'rpc', 'original_start_intent_requires_rpc_cursor')
    if (BASE / 'drained.json').exists(): need(stable_scan(frozen) == stable_scan(h.s.document(BASE / 'drained.json')['scan']), 'original_start_cursor_must_match_owned_drain')
    fixed = lambda scan: {k: v for k, v in stable_scan(scan).items() if k not in {'next_block', 'target_block', 'target_hash', 'last_scanned_hash'}}
    need(current['ingestion_mode'] == 'rpc' and fixed(current) == fixed(frozen) and int(current['next_block']) >= int(frozen['next_block']), 'owned_rpc_resume_must_preserve_identity_and_monotonic_cursor')
    approval = db['approval']; sql_attempted = (BASE / 'inverse-sql-intent.json').exists()
    need((not sql_attempted and approval is None) or (sql_attempted and approval and approval['read_identity'] == h.meta.IDENTITY and
         approval['state'] == 'blocked' and approval['error_code'] == 'owned_metadata_inverse'), 'original_resume_requires_owned_rpc_inverse_state')
    need(h.m.snapshot(UNIT)[0] == old and link(BOOT) == op['oldBoot'] and not os.path.lexists(DROP), 'original_resume_changed_during_finish_reconciliation')
    return h.s.save(BASE / 'inverse-result.json', {'restored': True, 'oldWriter': old, 'completedByOwnedResumeReconciliation': True,
        'originalCursor': frozen['next_block'], 'resumedCursor': current['next_block'], 'managerActionsThisCall': 0, 'sqlReissued': False,
        'journalOrProvenanceRowsDeleted': 0, 'sourceSelectionChanged': False, 'readGrantsChanged': False})


def no_live_cli(h, require_known=True):
    children = []
    for path in [BASE / 'adopt-intent.json', *BASE.glob('provenance-*-intent.json')]:
        child = path.with_name(path.name.replace('-intent.json', '-child.json'))
        if path.exists() and not child.exists():
            need(not require_known, 'official_metadata_command_child_identity_unknown_manual_reconciliation_required')
            children.append({'receipt': child.name, 'stillAlive': None, 'identityUnknown': True})
    for path in BASE.glob('*-child.json'):
        actor = h.s.document(path); children.append({'receipt': path.name, 'stillAlive': identity_alive(h.m, actor)})
    need(not any(row['stillAlive'] is True for row in children), 'owned_metadata_cli_still_running_no_reconciliation')
    return children


def reconcile(h, op):
    db = h.database(); children = []
    children = no_live_cli(h, require_known=False)
    out = {'format': FORMAT, 'database': db, 'unit': state(h.m), 'childStates': children, 'serviceActions': 0, 'databaseWrites': 0,
           'officialCliAcknowledgementFabricated': False, 'automaticRetryAllowed': False}
    if (BASE / 'adopt-intent.json').exists() and not (BASE / 'adopt-result.json').exists():
        before = h.s.document(BASE / 'drained.json')['scan']
        out['adoption'] = 'native_semantic_postcondition_observed_ack_missing' if ((BASE / 'adopt-child.json').exists() and db['scan']['ingestion_mode'] == 'native' and
            stable_scan(db['scan']) == stable_scan(before) and db['approval'] and db['approval']['read_identity'] == h.meta.IDENTITY) else 'unknown_or_not_committed'
        out['adoptionMayBeRepeated'] = False
    if (BASE / 'native-start-intent.json').exists() and not (BASE / 'native-started.json').exists() and state(h.m)['MainPID'] != '0':
        out['reconciledNativeActor'] = start_intent_actor(h, op)
    if (BASE / 'inverse-sql-intent.json').exists() and not (BASE / 'inverse-sql-result.json').exists():
        out['inverseMode'] = 'rpc_semantic_postcondition_observed_ack_missing' if db['scan']['ingestion_mode'] == 'rpc' and db['approval'] and db['approval']['error_code'] == 'owned_metadata_inverse' else 'unknown'
    if (BASE / 'old-start-intent.json').exists() and state(h.m)['MainPID'] != '0' and not os.path.lexists(DROP):
        old, _ = h.m.snapshot(UNIT); start = h.s.document(BASE / 'old-start-intent.json')
        need(old['definitions'] == op['oldWriter']['definitions'] and old['configuredEnvironmentSha256'] == op['oldWriter']['configuredEnvironmentSha256'] and
             int(state(h.m)['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'] and link(BOOT) == op['oldBoot'], 'owned_old_resume_state_must_match_original')
        out['reconciledOriginalWriter'] = old
    return out


def inspect(h, op):
    return {'format': FORMAT, 'unit': state(h.m), 'database': h.database(), 'phaseFiles': sorted(p.name for p in BASE.glob('*.json')),
        'automaticRetryAllowed': False, 'serviceActions': 0, 'databaseWrites': 0}


def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def static_context():
    import types
    import stat
    for path in [*CONTEXT.parents, CONTEXT]:
        st = path.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
                              'protected_new_metadata_static_context_required')
    raw = CONTEXT.read_bytes(); need(len(raw) < 200000 and sha(raw) == CONTEXT_SHA, 'exact_new_static_metadata_context_required')
    value = types.ModuleType('new_restored_metadata_static_context'); value.__file__ = str(CONTEXT)
    exec(compile(raw, str(CONTEXT), 'exec'), value.__dict__)
    value.read_context().source().protected(CONTEXT, CONTEXT_SHA); return value


def validate_config(config):
    need(type(config) is dict and set(config) == {'admissionSha256', 'readPlanSha256', 'readContextInputSha256'} and
         all(pin(v) for v in config.values()), 'actual_three_new_READ_refs_required')
    return dict(config)


def authenticate_admission(h, reference):
    keys = {'producerFile', 'producerSha256', 'resultFile', 'receiptSha256', 'planSha256', 'contextInputSha256'}
    need(type(reference) is dict and set(reference) == keys and reference['producerFile'] == str(ADMISSION_FILE) and
         reference['resultFile'] == str(ADMISSION_RESULT) and pin(reference['producerSha256']) and
         reference['receiptSha256'] == h.read_config['admissionSha256'] and reference['planSha256'] == h.read_config['readPlanSha256'] and
         reference['contextInputSha256'] == h.read_config['readContextInputSha256'], 'fixed_new_READ_producer_and_receipt_reference_required')
    need(sha(h.s.protected(ADMISSION_FILE)) == reference['producerSha256'], 'exact_actual_new_READ_source_required')
    value = h.s.document(ADMISSION_RESULT, reference['receiptSha256'])
    need(value['format'] == 'yunipals-ypal-restored-read-admission-v1' and value['admitted'] is True and
         value['operatorSha256'] == reference['producerSha256'] and value['bootId'] == h.s.boot() and
         value['planSha256'] == reference['planSha256'] and value['contextInputSha256'] == reference['contextInputSha256'] and
         value['readEdgeCount'] == 143 and value['loginChanges'] == value['newDml'] == value['serviceActions'] == 0 and
         value['originalWholeValidatorPassed'] is value['sourceReadinessQualified'] is False and
         value['commitOutcome'] in {'commit_confirmed', 'postgraph_reconciled_after_unknown_ACK'},
         'actual_new143_admission_not_historical_c9_required')
    # Authenticate the actual reviewed/rehearsed/commit record chain, never an old plan alias.
    for name, key in [('before.json', 'beforeSha256'), ('rehearsed.json', 'rehearsalSha256'), ('commit-intent.json', 'commitIntentSha256')]:
        record = h.s.document(ADMISSION_RESULT.parent / name, value[key])
        need(record['format'] == value['format'] and record['operatorSha256'] == reference['producerSha256'] and
             record['reviewHash'] == value['reviewHash'], 'same_new_READ_operation_record_chain_required')
    return dict(reference)


def initialize(h, config, refresh_callback, inverse=False, primitives=None, admission_ref=None):
    need(callable(refresh_callback) and type(inverse) is bool, 'explicit_phase_refresh_callback_required')
    context = static_context(); p = context.metadata_primitives() if primitives is None else primitives
    required = {'meta', 's', 'h', 'm', 'installer', 'reader', 'source_op', 'source', 'created'}
    need(type(p) is dict and required <= set(p) and p.get('sourceAuthorityQualified') is False,
         'explicit_source_independent_metadata_primitives_required')
    for name in required: setattr(h, name, p[name])
    need(sha(h.s.protected(TEMPLATE)) == TEMPLATE_SHA, 'unchanged_historical772_source_required')
    need(sha(h.s.protected(META_FILE)) == META_SHA and str(h.meta.__file__) == str(META_FILE), 'same_immutable_metadata_candidate_producer_required')
    need(h.created['readSchema'] == h.meta.READ and h.created['readIdentity'] == h.meta.IDENTITY and
         h.created['target']['schemaOid'] == '75994954' and h.created['sourceReceiptSha256'] == h.meta.SOURCE_RESULT_SHA,
         'same_actual_created_readview_ancestry_required')
    h.read_config = validate_config(config); h.admission_pin = h.read_config['admissionSha256']
    h.admission_ref = authenticate_admission(h, admission_ref)
    h.refresh_callback, h.inverse_mode = refresh_callback, inverse
    h.candidate = h.s.document(CANDIDATES / 'result.json', CANDIDATE_SHA)
    need(h.candidate['staged'] is True and h.candidate['selected'] is False and h.candidate['adopted'] is False and
         h.candidate['readviewResultSha256'] == h.meta.READ_RESULT_SHA, 'same_unselected_staged_metadata_candidate_required')
    h.refresh()


def construct_context(config, refresh_callback, inverse=False, primitives=None, admission_ref=None):
    return Host(config, refresh_callback, inverse, primitives, admission_ref)


def metadata(phase, candidate, selection, refresh):
    p = phase.metadata_primitives(); h = construct_context(p['readConfig'], refresh, primitives=p, admission_ref=p['admission_ref'])
    op = operation(h, candidate['metadataOperationSha256'])
    need(candidate['readAdmissionSha256'] == h.admission_pin and h.s.document(BASE / 'selected.json') == selection and
         selection['selected'] is True, 'same_new_metadata_operation_and_selection_required')
    first = h.actor(op, True)
    need(first == selection['nativeActor'] and link(BOOT) == selection['boot'], 'same_selected_native_metadata_actor_and_boot_required')
    db = h.database(); publication = h.publication_proof()
    need(db['probe'] is True and db['scan']['ingestion_mode'] == 'native' and db['remainingPublished'] == 0 and
         publication['allPublishedCanonical'] is True, 'current_native_metadata_and_full_published_provenance_required')
    h.refresh(); need(h.actor(op, True) == first and link(BOOT) == selection['boot'], 'metadata_changed_during_current_phase_qualification')
    return {'metadataOperationSha256': candidate['metadataOperationSha256'], 'metadataOperatorSha256': sha(h.s.protected(Path(__file__).absolute())),
            'actorSha256': sha(encoded(first)), 'bootSha256': sha(encoded(selection['boot'])), 'currentNativeMetadataQualified': True,
            'publicationSqlSha256': publication['officialSqlSha256'], 'allPublishedCanonical': True,
            'original143WholeValidatorPassed': False, 'historical772OperationClaimed': False, 'sourceAuthorityQualified': False}


def metadata_inverse_context(phase, candidate, refresh):
    p = phase.metadata_primitives(); h = construct_context(p['readConfig'], refresh, True, p, p['admission_ref'])
    need(candidate['readAdmissionSha256'] == h.admission_pin, 'same_new_metadata_admission_for_inverse_required')
    op = operation(h, candidate['metadataOperationSha256'])
    import sys
    # Normal imports need not register this module in sys.modules.
    owner = sys.modules.get(__name__)
    if owner is None:
        import types
        owner = types.SimpleNamespace(**globals())
    return owner, h, op


def execution_context(h, refs):
    need(type(refs) is dict and set(refs) == {'inputSha256', 'sourcesSha256'} and all(pin(v) for v in refs.values()),
         'same_reviewed_metadata_execution_input_required')
    config = h.s.document(INPUT, refs['inputSha256']); manifest = h.s.document(SOURCES, refs['sourcesSha256'])
    need(config == {'format': FORMAT + '-input', 'sourcesSha256': refs['sourcesSha256'], 'readConfig': h.read_config} and
         manifest['format'] == FORMAT + '-sources' and manifest['provider']['file'] == PROVIDER.name and
         manifest['readAdmission'] == {'file': ADMISSION_FILE.name, 'sha256': h.admission_ref['producerSha256']} and
         pin(manifest['provider']['sha256']) and sha(h.s.protected(PROVIDER)) == manifest['provider']['sha256'],
         'same_initial_metadata_provider_source_and_READ_input_required')
    return dict(refs)


def cli_context(input_sha, inverse=False):
    context = static_context(); read = context.read_context(); source = read.source()
    config = source.document(INPUT, input_sha)
    need(set(config) == {'format', 'sourcesSha256', 'readConfig'} and config['format'] == FORMAT + '-input' and pin(config['sourcesSha256']),
         'new_explicit_metadata_input_required')
    manifest = source.document(SOURCES, config['sourcesSha256'])
    need(set(manifest) == {'format', 'provider', 'readAdmission'} and manifest['format'] == FORMAT + '-sources' and
         manifest['provider']['file'] == PROVIDER.name and manifest['readAdmission']['file'] == ADMISSION_FILE.name and
         pin(manifest['provider']['sha256']) and pin(manifest['readAdmission']['sha256']), 'reviewed_finite_metadata_sources_required')
    provider = read.module(PROVIDER, manifest['provider']['sha256'])
    checked = validate_config(config['readConfig'])
    reference = {'producerFile': str(ADMISSION_FILE), 'producerSha256': manifest['readAdmission']['sha256'], 'resultFile': str(ADMISSION_RESULT),
                 'receiptSha256': checked['admissionSha256'], 'planSha256': checked['readPlanSha256'], 'contextInputSha256': checked['readContextInputSha256']}
    host = construct_context(checked, provider.metadata_refresh(checked, inverse=inverse), inverse, admission_ref=reference)
    host.execution_context = {'inputSha256': input_sha, 'sourcesSha256': config['sourcesSha256']}
    execution_context(host, host.execution_context); return host


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--input-sha')
    p.add_argument('--phase', choices=PHASES, default='drain'); p.add_argument('--operation-sha'); p.add_argument('--apply'); p.add_argument('--inspect', action='store_true'); p.add_argument('--batch-index', type=int, default=0); p.add_argument('--reconcile', action='store_true')
    a = p.parse_args()
    if a.input_sha is None:
        need(not a.apply and not a.operation_sha and not a.inspect and not a.reconcile, 'actual_input_required_for_any_phase_observation')
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'operationCreated': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_metadata_host_required'); os.umask(0o077)
    with lock():
        h = cli_context(a.input_sha, a.phase in {'inverse', 'finish-inverse'})
        if a.operation_sha:
            op = operation(h, a.operation_sha)
            if a.inspect or a.reconcile: print(json.dumps(reconcile(h, op) if a.reconcile else inspect(h, op), sort_keys=True)); return
            before = h.database(); binding = {'operationSha256': a.operation_sha, 'phase': a.phase, 'batchIndex': a.batch_index,
                'phaseFiles': sorted(p.name for p in BASE.glob('*.json'))}
        else:
            need(a.phase == 'drain' and not a.inspect, 'owned_operation_required_after_initial_review'); binding, before = review(h); op = binding
        review_sha = sha(encoded(binding))
        if not a.apply:
            print(json.dumps({'format': FORMAT, 'reviewHash': review_sha, 'phase': a.phase, 'binding': binding, 'observation': before,
                'eligibleCoverage': covered(before), 'effects': False}, sort_keys=True)); return
        need(a.apply == review_sha, 'exact_metadata_phase_review_required')
        result = drain(h, binding) if a.phase == 'drain' else adopt(h, op) if a.phase == 'adopt' else select(h, op) if a.phase == 'select' else inverse(h, op, a.phase == 'finish-inverse') if a.phase in {'inverse', 'finish-inverse'} else provenance(h, op, a.batch_index)
        print(json.dumps({'format': FORMAT, 'phase': a.phase, 'acknowledged': True, 'result': result}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_metadata_phase_deadline')); signal.alarm(720)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'private_diagnostics_withheld', 'automaticRetryAllowed': False}))
        raise SystemExit(1)
    finally: signal.alarm(0)
