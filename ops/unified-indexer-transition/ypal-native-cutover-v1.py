#!/usr/bin/env python3
"""Explicit native publication and three-reader cutover; default is read-only.

Business SQL uses the retained yunipals snapshot identity. Root owns only
protected receipts, exact service/file transitions and the separately reviewed
two-role LOGIN boundary. No unknown SQL/start/stop is automatically repeated.
"""
import argparse
import contextlib
import copy
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import selectors
import signal
import socket
import stat
import subprocess
import time
import types
import urllib.error
import urllib.parse
import urllib.request

FORMAT = 'yunipals-ypal-native-cutover-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-native-cutover-v1-20261024')
PUBLICATION = BASE / 'publication'
MANIFEST = OPS / 'ypal-native-cutover-v1.manifest.json'
PROOF = 'ypal-native-cutover-proof-v1.py'
ENTRY = OPS / 'ypal-native-cutover-v1.mjs'
NODE = '/opt/node-v24.18.1/bin/node'
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
MAX_PREPARATION_SECONDS = 1200
MAX_CRITICAL_SECONDS = 600
SYSTEMD_ROOTS = ('/etc/systemd/system', '/run/systemd/system', '/usr/local/lib/systemd/system',
    '/usr/lib/systemd/system', '/lib/systemd/system', '/etc/systemd/system.control', '/run/systemd/system.control', '/run/systemd/transient')
# These are separate new exact producers; an old35/008 witness or temporary
# one-hour observer cannot be aliased into production eligibility.
PARITY_OWNER = 'fixed-boundary-witness-v3.mjs'
PARITY_OWNER_SHA = 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c'
OBSERVER_OWNER = 'ypal-combined-ordinary-observer-owner-v1.py'
OBSERVER_OWNER_SHA = 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6'


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def js_encoded(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def public_input(path, pin=None, cap=3000000):
    path = Path(path)
    for parent in [*path.parents, path]:
        st = parent.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_cutover_source_or_receipt_required')
    st = path.lstat(); need(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= cap, 'bounded_exact_cutover_input_required')
    raw = path.read_bytes(); after = path.lstat()
    need(all(getattr(st, k) == getattr(after, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')),
         'cutover_input_changed_during_read')
    need(pin is None or re.fullmatch('[0-9a-f]{64}', pin) and sha(raw) == pin, 'exact_cutover_input_pin_required')
    return raw


def document(path, pin=None): return json.loads(public_input(path, pin))


def load_proof(pin):
    manifest = document(MANIFEST, pin)
    need(manifest.get('format') == 'yunipals-ypal-native-cutover-source-v1' and PROOF in manifest.get('files', {}), 'explicit_exact_cutover_source_manifest_required')
    path = OPS / PROOF; raw = public_input(path, manifest['files'][PROOF], 150000)
    spec = importlib.util.spec_from_loader('ypal_native_cutover_proof', loader=None)
    module = importlib.util.module_from_spec(spec); module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    module.source_manifest(pin)
    need(manifest['files'][Path(__file__).name] == sha(public_input(Path(__file__).absolute())), 'this_exact_invoking_owner_must_be_in_manifest')
    return module


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(name, value, mode=0o600, directory=None):
    directory = BASE if directory is None else directory
    need(directory in {BASE, PUBLICATION}, 'fixed_owned_cutover_journal_directory_required')
    need(re.fullmatch('[a-z0-9_.-]+', name) and '/' not in name, 'fixed_private_cutover_record_name_required')
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(directory); return sha(raw)


def inode(path, link=False):
    path = Path(path); info = path.lstat()
    need(info.st_uid == info.st_gid == 0 and info.st_nlink == 1 and
         (stat.S_ISLNK(info.st_mode) if link else stat.S_ISREG(info.st_mode)), 'single_exact_root_owned_transition_inode_required')
    return {'dev': info.st_dev, 'ino': info.st_ino, 'mode': info.st_mode,
            **({'target': os.readlink(path)} if link else {'sha256': sha(public_input(path)), 'ctimeNs': info.st_ctime_ns})}


def reader_boot(proof, name):
    path = Path('/etc/systemd/system/multi-user.target.wants') / proof.PEERS[name]['unit']
    if not os.path.lexists(path): return {'path': str(path), 'identity': None}
    value = inode(path, True)
    need(value['target'] in {'/etc/systemd/system/' + proof.PEERS[name]['unit'], '../' + proof.PEERS[name]['unit']},
         'only_existing_fixed_multiuser_reader_boot_link_may_be_owned')
    return {'path': str(path), 'identity': value}


def boot_disabled(proof, name, op):
    entry = op['binding']['readerBootLinks'][name]; path = Path(entry['path']); parked = BASE / ('original-' + name + '-boot')
    need(not os.path.lexists(path) and (not os.path.lexists(parked) if entry['identity'] is None else inode(parked, True) == entry['identity']),
         'exact_original_reader_boot_inode_must_remain_owned_and_disabled')
    path = BASE / ('boot-' + name + '-disabled.json')
    # A crash after the rename but before its ACK is still proved by the
    # preexisting exact intent and the same parked inode; no move is repeated.
    ack = document(path if path.exists() else BASE / ('boot-' + name + '-disable-intent.json'))
    need(ack['bootId'] == boot() and ack['operationSha256'] == sha(public_input(BASE / 'operation.json')) and ack['entry'] == entry,
         'same_owned_reader_boot_disable_ack_required')


def manager(action, unit=None, deadline=None):
    need(action in {'daemon-reload', 'start', 'stop'} and (unit is None) is (action == 'daemon-reload'), 'fixed_manager_action_required')
    if unit is not None:
        need(unit in {p['unit'] for p in LOCAL_PEERS.values()} | {'yunipals-ypal-native-preview-v1-' + n + '.service' for n in LOCAL_PEERS},
             'only_three_fixed_readers_and_their_owned_previews_may_be_changed')
    timeout = 60 if deadline is None else min(60, deadline - time.monotonic())
    need(timeout > 0, 'critical_window_expired_before_manager_dispatch')
    result = subprocess.run(['/usr/bin/systemctl', action, *([unit] if unit else [])], env=CLEAN, capture_output=True, timeout=timeout)
    need(result.returncode == 0 and not result.stderr, 'manager_ACK_unknown_explicit_readonly_reconcile_required')
    return {'acknowledged': True, 'stdoutSha256': sha(result.stdout), 'stderrSha256': sha(result.stderr)}


LOCAL_PEERS = {'main': {'unit': 'yunipals-api.service'}, 'collector': {'unit': 'yunipals-collector-api.service'},
               'islands': {'unit': 'yunipals-islands-api.service'}}


def disable_reader_boots(context, op):
    for name, entry in op['binding']['readerBootLinks'].items():
        ack_path = BASE / ('boot-' + name + '-disabled.json')
        if ack_path.exists(): boot_disabled(context.proof, name, op); continue
        path, parked = Path(entry['path']), BASE / ('original-' + name + '-boot')
        intent = 'boot-' + name + '-disable-intent.json'
        if not (BASE / intent).exists():
            need(reader_boot(context.proof, name) == entry and not os.path.lexists(parked), 'same_reader_boot_before_own_disable_required')
            save(intent, {'entry': entry, 'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot()})
        saved = document(BASE / intent)
        need(saved == {'entry': entry, 'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot()}, 'exact_owned_reader_boot_disable_intent_required')
        if entry['identity'] is not None:
            if os.path.lexists(path):
                need(inode(path, True) == entry['identity'] and not os.path.lexists(parked), 'reader_boot_inode_changed_after_intent')
                os.rename(path, parked); sync(path.parent); sync(BASE)
            need(inode(parked, True) == entry['identity'] and not os.path.lexists(path), 'same_owned_disabled_reader_boot_required')
        save(ack_path.name, saved)
    if not (BASE / 'boots-disabled-reload-result.json').exists():
        need(not (BASE / 'boots-disabled-reload-intent.json').exists(), 'unknown_boot_reload_requires_explicit_reconcile')
        save('boots-disabled-reload-intent.json', {'bootId': boot()}); ack = manager('daemon-reload'); save('boots-disabled-reload-result.json', ack)
    original_readers(context, op)


def protected_directory(path, label):
    path = Path(path)
    if not path.exists():
        parent = path.parent; info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022 and not path.is_symlink(),
             'protected_existing_publication_parent_required')
        save(label + '-mkdir-intent.json', {'path': str(path)}); path.mkdir(mode=0o755); path.chmod(0o755); sync(parent)
        save(label + '-mkdir-result.json', {'path': str(path), 'dev': path.stat().st_dev, 'ino': path.stat().st_ino})
    for parent in [path, *path.parents]:
        info = parent.lstat(); need(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022,
                                   'root_owned_unwritable_real_publication_directory_required')


def publish_file(label, path, spec):
    """Exclusive hardlink publication with an owned staged inode and crash CAS."""
    path = Path(path); prepared = BASE / (label + '.staged'); intent_path = BASE / (label + '-publish-intent.json')
    ack_path = BASE / (label + '-published.json'); raw = spec['text'].encode()
    need(spec['mode'] in {0o600, 0o644}, 'only_reviewed_transition_file_modes_required')
    if ack_path.exists():
        need(inode(path) == document(ack_path) and sha(raw) == inode(path)['sha256'], 'same_acknowledged_transition_file_required'); return
    protected_directory(path.parent, label)
    if not intent_path.exists():
        need(not os.path.lexists(path) and not os.path.lexists(prepared), 'never_overwrite_foreign_transition_file')
        save(prepared.name, raw, spec['mode']); save(intent_path.name, {'path': str(path), 'identity': inode(prepared)})
    intended = document(intent_path); expected = intended['identity']
    need(intended['path'] == str(path) and expected['sha256'] == sha(raw) and stat.S_IMODE(expected['mode']) == spec['mode'], 'same_reviewed_staged_file_intent_required')
    if not os.path.lexists(path):
        need(inode(prepared) == expected, 'exact_owned_staged_file_required'); os.link(prepared, path, follow_symlinks=False); sync(path.parent)
    current = path.lstat()
    need(current.st_dev == expected['dev'] and current.st_ino == expected['ino'] and current.st_uid == current.st_gid == 0 and
         stat.S_ISREG(current.st_mode) and current.st_nlink in {1, 2} and current.st_mode == expected['mode'] and sha(path.read_bytes()) == expected['sha256'],
         'published_file_must_be_the_exact_exclusive_owned_inode')
    if os.path.lexists(prepared):
        staged = prepared.lstat(); need(staged.st_dev == current.st_dev and staged.st_ino == current.st_ino, 'only_exact_owned_staged_link_may_be_removed')
        prepared.unlink(); sync(BASE)
    save(ack_path.name, inode(path))


def reader_descriptor(op, name, preview=False):
    need(name in LOCAL_PEERS, 'fixed_reader_name_required')
    return op['binding']['readerDescriptors'][name]['preview' if preview else 'final']


def fresh_reader_paths(context, descriptors):
    paths = [path for row in descriptors.values() for descriptor in row.values() for path in descriptor['files']]
    need(len(paths) == len(set(paths)) and all(not os.path.lexists(path) for path in paths), 'all_new_reader_overlay_and_preview_paths_must_be_fresh')
    keys = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'Job', 'FragmentPath', 'DropInPaths')
    for name in context.proof.PEERS:
        unit = context.proof.preview_unit(name)
        raw = context.host.m.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in keys]])
        state = dict(row.split('=', 1) for row in raw.decode().splitlines())
        need(state == dict(zip(keys, (unit, 'not-found', 'inactive', 'dead', '0', '0', '', '', ''))),
             'only_unloaded_never_created_fixed_preview_units_may_be_installed')
        need(not context.host.m.run(['/usr/bin/ss', '-Hlnpt', 'sport = :' + str(context.proof.PEERS[name]['previewPort'])]).strip(),
             'fixed_preview_port_must_be_free')


def descriptor_files(op, name, preview=False):
    descriptor = reader_descriptor(op, name, preview)
    for index, (path, spec) in enumerate(descriptor['files'].items()):
        label = ('preview-' if preview else 'reader-') + name + '-file-' + str(index)
        yield label, path, spec


def verify_descriptor_files(op, name, preview=False):
    for label, path, spec in descriptor_files(op, name, preview):
        identity = inode(path)
        need(identity == document(BASE / (label + '-published.json')) and identity['sha256'] == sha(spec['text'].encode()) and
             stat.S_IMODE(identity['mode']) == spec['mode'], 'all_reader_overlay_inodes_and_modes_must_match_owned_publication_ACKs')
    return True


def prepare_runtime(context, op):
    original_readers(context, op); context.scope(True)
    if (BASE / 'runtime-prepared.json').exists():
        value = document(BASE / 'runtime-prepared.json')
        need(value['operationSha256'] == sha(public_input(BASE / 'operation.json')) and value['bootId'] == boot(), 'same_owned_runtime_preparation_required')
        for name in LOCAL_PEERS:
            context.loaded_descriptor(reader_descriptor(op, name, True))
            for preview in (True, False):
                for label, path, spec in descriptor_files(op, name, preview):
                    if not preview and path.endswith('.conf'): continue
                    need(inode(path) == document(BASE / (label + '-published.json')), 'same_owned_prepared_reader_publication_inode_required')
        return
    for name in LOCAL_PEERS:
        for preview in (True, False):
            for label, path, spec in descriptor_files(op, name, preview):
                if not preview and path.endswith('.conf'): continue
                publish_file(label, path, spec)
    if not (BASE / 'runtime-reload-result.json').exists():
        need(not (BASE / 'runtime-reload-intent.json').exists(), 'unknown_runtime_reload_requires_explicit_reconcile')
        save('runtime-reload-intent.json', {'bootId': boot()}); save('runtime-reload-result.json', manager('daemon-reload'))
    original_readers(context, op); context.scope(True)
    save('runtime-prepared.json', {'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot(),
         'nativeReadersStarted': False, 'originalReaderDefinitionsChanged': False})


def inputs(path, pin):
    value = document(path, pin)
    keys = {'sourceManifestSha256', 'cachePreparedSha256', 'publisherInstallSha256', 'mainInstallSha256', 'parityWitnessSha256', 'sustainedObserverSha256'}
    need(set(value) == keys and all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in value.values()), 'actual_finite_cutover_receipt_inputs_required')
    return value


def separate_witnesses(context):
    need(PARITY_OWNER is not None and PARITY_OWNER_SHA is not None and OBSERVER_OWNER is not None and OBSERVER_OWNER_SHA is not None,
         'new_six_collection_witness_and_sustained_observer_producers_not_yet_frozen')
    witness_path = Path('/var/backups/yunipals-ypal-fixed-boundary-witness-v3-20261024/result.json')
    captured = document(witness_path, context.inputs['parityWitnessSha256'])
    parity_path = Path('/var/backups/yunipals-ypal-ownership-parity-v1-20261024/parity.json')
    need(captured['binding']['plan']['output'] == str(witness_path) and
         captured['binding']['plan']['candidateReportFile'] == str(parity_path), 'fixed_actual_new_parity_and_witness_paths_required')
    parity_bytes = public_input(parity_path, captured['binding']['plan']['candidateReportSha256'])
    baseline_path = Path(captured['binding']['plan']['baselineFile'])
    baseline = public_input(baseline_path, '69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540')
    witness = child(context, 'witness', {'witness': captured, 'parityBytes': parity_bytes.decode(), 'baselineBytes': baseline.decode()})
    observer = context.proof.module(OBSERVER_OWNER, OBSERVER_OWNER_SHA)
    observing = observer.validate_current(context.inputs['sustainedObserverSha256'])
    need(witness['validated'] is True and witness['allSixCollections'] is True and witness['canonicalWitnessQualifiedAtCapture'] is True and
         witness['currentReadinessQualified'] is False and witness['sourceRelease'] == context.proof.RELEASE and witness['readIdentity'] == context.proof.IDENTITY,
         'actual_all_six_fixed_boundary_ownership_lifecycle_and_history_parity_required')
    need(observing['validated'] is True and observing['observerScopeOnly'] is True and observing['ordinarySustainedObserver'] is True and
         observing['runtimeMaximumSeconds'] is None and observing['releaseId'] == context.proof.RELEASE and
         observing['freeOnly'] is True and observing['paidAuthority'] is False, 'actual_nonexpiring_ordinary_official_observer_required')
    return {'sixCollectionWitnessSha256': context.inputs['parityWitnessSha256'], 'sustainedObserverSha256': context.inputs['sustainedObserverSha256'],
            'witnessProducerSha256': PARITY_OWNER_SHA, 'observerProducerSha256': OBSERVER_OWNER_SHA}


def review(proof, value):
    need(not os.path.lexists(BASE), 'fresh_coordinated_cutover_operation_required')
    c = proof.Context(value); c.proof = proof
    prepared = c.cache.validate_prepared_current(value['cachePreparedSha256'])
    need(prepared['nativeWorkerStarted'] is False and prepared['nativeGenerationPublished'] is False, 'prepared_inactive_cache_and_unpublished_candidate_required')
    scope = c.scope(False); metadata = c.metadata(); metadata_comparison = c.metadata_comparison(); ready = c.native_ready(); generation = c.generation_terminal(); artifacts = c.accepted_source_closure()
    witnesses = separate_witnesses(c)
    actors = {name: c.reader(name) for name in proof.PEERS}
    for name, actor in actors.items():
        need(actor['unit']['KillMode'] == 'control-group' and
             not any(actor['unit'][key] for key in ('RequiredBy', 'TriggeredBy', 'Triggers', 'PartOf', 'UpheldBy')),
             'only_known_reader_activation_paths_may_be_owned')
    readers = {name: {'preview': proof.render_reader(c, name, actor, True), 'final': proof.render_reader(c, name, actor)}
               for name, actor in actors.items()}
    boots = {name: reader_boot(proof, name) for name in proof.PEERS}
    for name, entry in boots.items():
        unit = actors[name]['unit']
        need((unit['UnitFileState'] == 'enabled' and unit['WantedBy'] == 'multi-user.target') if entry['identity'] is not None else
             (unit['UnitFileState'] in {'disabled', 'static'} and not unit['WantedBy']), 'only_exact_known_multiuser_or_disabled_reader_activation_allowed')
    fresh_reader_paths(c, readers)
    gen_module, _, _, _ = c.generation()
    actual_inline = c.host.m.service_property(gen_module.LEADER, 'Environment')
    public_inline = [item for item in actual_inline if not re.search('PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL', item.partition('=')[0]) and '://' not in item]
    need(c.business_environment() == c.business_environment(public_inline), 'recorded_public_generation_context_must_reconstruct_identical_private_configuration')
    after, delta = proof.login_postcatalog(c.sql_ack['postProof']['catalog'])
    binding = {'format': FORMAT, 'operatorSha256': sha(public_input(Path(__file__).absolute())), 'bootId': boot(),
        'sourceManifestSha256': value['sourceManifestSha256'], 'inputs': value, 'sourceScope': scope, 'metadata': metadata,
        'readiness': ready, 'generationTerminal': generation, 'witnesses': witnesses, 'originalReaders': actors, 'readerDescriptors': readers,
        'readerBootLinks': boots, 'artifacts': artifacts,
        'generationPublicInlineEnvironment': public_inline,
        'metadataFixedComparison': metadata_comparison,
        'loginDelta': delta, 'loginAuthorizationSha256': sha(encoded(delta)), 'beforeLoginCatalog': c.sql_ack['postProof']['catalog'],
        'afterLoginCatalog': after, 'recurringGenerationMayStart': False, 'maximumCriticalSeconds': MAX_CRITICAL_SECONDS}
    need({name: c.reader(name) for name in proof.PEERS} == actors and c.scope(False) == scope and c.metadata() == metadata,
         'cutover_review_source_readers_private_inputs_or_metadata_drifted')
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'serviceActions': 0,
            'globalPublicationPerformed': False, 'separateTwoRoleLOGINAuthorizationRequired': True}


def operation(proof, pin=None):
    value = document(BASE / 'operation.json', pin)
    binding = value['binding']
    need(binding['format'] == FORMAT and binding['operatorSha256'] == sha(public_input(Path(__file__).absolute())) and
         binding['bootId'] == boot() and value['reviewHash'] == sha(encoded(binding)), 'same_boot_exact_coordinated_operation_required')
    proof.source_manifest(binding['sourceManifestSha256'])
    return value


def owned_peer_session(context, actor, backend, role_oid):
    need(role_oid in {'10', '16388'}, 'only_existing_snapshot_or_bounded_root_capsule_role_allowed')
    need(type(backend['pid']) is int and backend['pid'] > 0 and backend['roleOid'] == role_oid and backend['databaseOid'] == '17584',
         'actual_expected_business_or_root_backend_required')
    pid = backend['pid']
    query = "SELECT COALESCE((SELECT jsonb_build_object('pid',pid,'backendStart',(extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text,'clientAddress',client_addr::text,'clientPort',client_port)FROM pg_stat_activity WHERE pid=" + str(pid) + " AND usesysid=" + role_oid + " AND datid=17584),'null'::jsonb)"
    row = context.query(query)
    need(row == {k: backend[k] for k in ('pid', 'backendStart', 'clientAddress', 'clientPort')}, 'same_actual_cutover_backend_start_tuple_required')
    observer = context.host.h.observer; status = context.proof.proc_status(actor['pid'])
    owner_uid, owner_gid = status['uid'][0], status['gid'][0]
    clients = observer.peer_fds([actor['pid']], owner_uid, owner_gid); server = observer.peer_fds([pid], 111, 113)
    peers = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
    tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
    owned = observer.map_owned_backends(clients, server, [row], peers, tcp)
    need(len(owned) == 1 and owned[0]['pid'] == pid and owned[0]['backendStart'] == backend['backendStart'] and context.query(query) == row,
         'positive_actual_kernel_peer_attribution_before_business_writes_required')
    return owned


def child(context, mode, plan, acknowledge=None):
    need(mode in {'inspect', 'roles', 'roles-inverse', 'publish', 'capsule-inspect', 'capsule-inverse', 'witness'}, 'fixed_cutover_SQL_child_mode_required')
    business = mode in {'inspect', 'publish'}
    env = {**CLEAN, 'NODE_OPTIONS': '--max-old-space-size=512', 'YUNIPALS_CUTOVER_PARENT': str(os.getpid()), 'OFFCHAIN_DB_POOL_MAX': '1', 'API_DB_POOL_MAX': '1'}
    if business: env.update(context.business_environment())
    else:
        sentinel = '/run/yunipals-native-cutover-no-password-file'; need(not os.path.lexists(sentinel), 'absent_root_peer_password_file_required')
        env['PGPASSFILE'] = sentinel
    # A private retained URL is passed only through the environment to a root
    # business child. It is never an argument or serialized protocol field.
    uid, gid = (0, 0) if business or mode == 'witness' else (111, 113)
    args = ['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid), '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all',
        '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL', NODE, str(ENTRY)]
    deadline = time.monotonic() + (MAX_PREPARATION_SECONDS if mode == 'publish' else 120)
    proc = subprocess.Popen(args, cwd=context.host.m.PROJECT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, start_new_session=True)
    actor = context.proof.process(proc.pid)
    try:
        if mode not in {'inspect', 'capsule-inspect', 'witness'}:
            save(mode + '-child.json', {'format': FORMAT, 'bootId': boot(), 'mode': mode, 'actor': actor, 'processGroup': proc.pid,
                 'entrySha256': context.manifest['files'][ENTRY.name]}, directory=PUBLICATION if mode == 'publish' else BASE)
        request = {'mode': mode, 'plan': plan, 'sourceManifestSha256': context.inputs['sourceManifestSha256']}
        proc.stdin.write(encoded(request)); proc.stdin.flush()
        monitor = selectors.DefaultSelector(); monitor.register(proc.stdout, selectors.EVENT_READ); pending = b''; size = 0; events = []; session = None
        while True:
            need(time.monotonic() < deadline, 'bounded_cutover_child_deadline_expired_unknown_effect_requires_reconcile')
            if not monitor.select(min(1, deadline - time.monotonic())):
                need(proc.poll() is None, 'cutover_child_exited_without_effect_acknowledgement'); continue
            chunk = os.read(proc.stdout.fileno(), 65536); need(chunk, 'cutover_child_ACK_unknown_readonly_reconcile_only')
            pending += chunk; size += len(chunk); need(size <= 10000000, 'bounded_cutover_child_protocol_required')
            while b'\n' in pending:
                raw, pending = pending.split(b'\n', 1); message = json.loads(raw); event = message.get('event'); events.append(event)
                if event == 'session-opened':
                    need(mode not in {'inspect', 'capsule-inspect', 'witness'} and events.count(event) == 1 and
                         message['mode'] == mode and message['currentUser'] == message['sessionUser'] == ('yunipals' if business else 'postgres') and
                         context.proof.process(proc.pid) == actor, 'one_exact_authenticated_child_session_before_effects_required')
                    session = message['backend']; owned = owned_peer_session(context, actor, session, '16388' if business else '10')
                    save(mode + '-session-opened.json', {'format': FORMAT, 'bootId': boot(), 'message': message, 'actor': actor, 'ownedSessions': owned},
                         directory=PUBLICATION if mode == 'publish' else BASE)
                    proc.stdin.write(encoded({'event': 'root-authorized', 'phase': event, 'messageSha256': sha(js_encoded(message))})); proc.stdin.flush()
                elif event in {'private-prepared', 'publication-prepared', 'roles-prepared', 'capsule-prepared'}:
                    need(acknowledge is not None and events.count(event) == 1 and context.proof.process(proc.pid) == actor,
                         'one_fresh_owned_child_phase_acknowledgement_required')
                    need(session is not None and all(message['backend'][key] == session[key] for key in ('pid', 'backendStart', 'clientAddress', 'clientPort', 'roleOid', 'databaseOid')),
                         'same_authenticated_owned_PG_session_through_private_and_publication_required')
                    backend = message['backend']; owned_peer_session(context, actor, backend, '16388' if business else '10')
                    if 'xid' in message:
                        need(re.fullmatch('[1-9][0-9]*', message['xid']) and int(backend['xid']) == int(message['xid']) % (1 << 32),
                             'actual_owned_cutover_transaction_XID_backend_required')
                    response = acknowledge(message)
                    need(response is True, 'root_fsynced_phase_intent_required')
                    proc.stdin.write(encoded({'event': 'root-authorized', 'phase': event, 'messageSha256': sha(js_encoded(message))})); proc.stdin.flush()
                elif event == 'result':
                    proc.stdin.close(); need(proc.wait(timeout=10) == 0 and not proc.stderr.read(1000000), 'cutover_child_terminal_zero_stderr_ACK_required')
                    return message['value']
                else: need(False, 'cutover_child_refused_private_diagnostics_withheld')
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=10)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream and not stream.closed: stream.close()


def current_context(proof, op):
    context = proof.Context(op['binding']['inputs']); context.proof = proof
    return context


def original_readers(context, op):
    return {name: original_reader(context, op, name) for name in context.proof.PEERS}


def original_reader(context, op, name):
    actual = context.reader(name); expected = copy.deepcopy(op['binding']['originalReaders'][name])
    entry = op['binding']['readerBootLinks'][name]
    if entry['identity'] is not None and not os.path.lexists(entry['path']):
        if (BASE / ('boot-' + name + '-disable-intent.json')).exists(): boot_disabled(context.proof, name, op)
        else:
            need(document(BASE / ('inverse-' + name + '-boot-disable-result.json')) == entry and
                 inode(BASE / ('original-' + name + '-boot'), True) == entry['identity'], 'same_owned_inverse_boot_move_required')
        for key in ('UnitFileState', 'WantedBy'): expected['unit'][key] = actual['unit'][key]
        need(actual['unit']['UnitFileState'] in {'disabled', 'static', op['binding']['originalReaders'][name]['unit']['UnitFileState']} and
             actual['unit']['WantedBy'] in {'', op['binding']['originalReaders'][name]['unit']['WantedBy']},
             'only_owned_boot_disable_may_change_original_reader_activation')
    need(actual == expected, 'same_original_reader_PIDs_definitions_private_inputs_and_environment_required')
    return actual


def action_preflight(context):
    context.scope(True); context.capacity('main')
    fixture = context.query(public_input(OPS / 'ypal-native-cutover-v1.action.sql').decode().strip().rstrip(';'))
    need(fixture.get('format') == 'yunipals-ypal-known-bnb-action-v1' and fixture.get('actualFixtureAvailable') is not False and
         fixture.get('nativeSchema') == context.proof.PHYSICAL and 'request' in fixture, 'actual_bounded_BNB_full_receipt_fixture_required')
    user = pwd.getpwnam(context.proof.PEERS['main']['role'])
    need(user.pw_uid > 0 and user.pw_gid > 0, 'existing_restricted_main_peer_required')
    args = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups',
        '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL', NODE,
        str(OPS / 'ypal-native-reader-probe-v1.mjs')]
    proc = subprocess.Popen(args, cwd=context.host.m.PROJECT, env={**CLEAN, 'YUNIPALS_CUTOVER_PARENT': str(os.getpid()),
        'NODE_OPTIONS': '--max-old-space-size=512'}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        raw, errors = proc.communicate(encoded({'sourceManifestSha256': context.inputs['sourceManifestSha256'], 'fixture': fixture}), timeout=45)
        need(proc.returncode == 0 and not errors and len(raw) <= 1000000, 'bounded_installed_main_peer_action_probe_refused')
        result = json.loads(raw)
        need(result['format'] == 'yunipals-ypal-native-action-preflight-v1' and result['passed'] is True and result['actualInstalledApp'] is True and
             result['listenerStarted'] is False and result['databaseReadOnly'] is True and result['actualCanonicalFullReceiptProof'] is True and
             result['sourceRelease'] == context.proof.RELEASE and result['readIdentity'] == context.proof.IDENTITY and
             result['providerAttempts'] == result['listenAttempts'] == result['databaseWrites'] == 0, 'actual_readonly_full_receipt_application_action_proof_required')
        context.scope(True)
        return {'proof': result, 'fixture': fixture, 'fixtureSha256': sha(encoded(fixture)), 'rootDatabaseWrites': 0, 'serviceActions': 0}
    finally:
        if proc.poll() is None: os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=10)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream and not stream.closed: stream.close()


def prepublication(context, op, require_original=True):
    context.scope(); context.native_ready(); context.generation_terminal(); context.metadata()
    need(context.metadata_comparison() == op['binding']['metadataFixedComparison'], 'same_actual_completed_metadata_data_comparison_required')
    leaf = context.unpublished_candidate()
    witness = separate_witnesses(context)
    need(witness == op['binding']['witnesses'], 'same_actual_all_six_witness_and_sustained_observer_required')
    if require_original: original_readers(context, op)
    context.cache.stopped(context.host)
    return leaf


def admit_readers(proof, value, expected_review, authorization):
    reviewed = review(proof, value)
    need(reviewed['reviewHash'] == expected_review and authorization == reviewed['binding']['loginAuthorizationSha256'],
         'separate_explicit_two_existing_reader_LOGIN_authorization_required')
    parent = BASE.parent.lstat(); need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and not parent.st_mode & 0o022,
         'protected_coordinated_operation_parent_required')
    BASE.mkdir(mode=0o700); sync(BASE.parent); save('operation.json', reviewed)
    op = operation(proof); c = current_context(proof, op); b = op['binding']
    prepublication(c, op)
    save('roles-intent.json', {'format': 'yunipals-ypal-native-reader-LOGIN-v1', 'reviewHash': op['reviewHash'], 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'authorizationSha256': authorization})
    def prepared(message):
        need(message['event'] == 'roles-prepared' and message['mode'] == 'roles' and message['before'] == b['beforeLoginCatalog'] and
             message['after'] == b['afterLoginCatalog'], 'exact_separate_two_reader_LOGIN_prepared_catalog_required')
        prepublication(c, op); save('roles-prepared.json', message); return True
    result = child(c, 'roles', {'mode': 'roles', 'before': b['beforeLoginCatalog'], 'after': b['afterLoginCatalog'], 'catalogSql': c.host.catalog_sql}, prepared)
    need(result['committed'] is True and result['mode'] == 'roles' and result['after'] == b['afterLoginCatalog'] and
         c.catalog() == b['afterLoginCatalog'], 'actual_exact_reader_LOGIN_commit_ack_required')
    ack = {'format': 'yunipals-ypal-native-reader-LOGIN-v1', 'committed': True, 'operatorSha256': b['operatorSha256'], 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'intentSha256': sha(public_input(BASE / 'roles-intent.json')),
        'preparedSha256': sha(public_input(BASE / 'roles-prepared.json')), 'xid': result['xid'],
        'afterCatalogSha256': sha(encoded(b['afterLoginCatalog'])), 'originalCollectorLOGINRetained': True}
    pin = save('roles-admitted.json', ack); c.scope(True)
    return {'format': FORMAT, 'readerLOGINsAdmitted': True, 'receiptSha256': pin, 'globalPublicationPerformed': False, 'serviceActions': 0}


def child_terminal(context, mode):
    path = (PUBLICATION if mode == 'publish' else BASE) / (mode + '-child.json')
    if not path.exists(): return
    record = document(path)
    need(record['format'] == FORMAT and record['bootId'] == boot() and record['mode'] == mode and
         record['entrySha256'] == context.manifest['files'][ENTRY.name] and record['processGroup'] == record['actor']['pid'],
         'exact_owned_cutover_child_record_required')
    try: now = context.proof.process(record['actor']['pid'])
    except (FileNotFoundError, ProcessLookupError): now = None
    need(now != record['actor'], 'owned_SQL_child_must_be_terminal_before_reconciliation')
    opened = (PUBLICATION if mode == 'publish' else BASE) / (mode + '-session-opened.json')
    if opened.exists():
        value = document(opened); backend = value['message']['backend']
        need(value['format'] == FORMAT and value['bootId'] == boot() and value['actor'] == record['actor'] and len(value['ownedSessions']) == 1,
             'same_owned_kernel_attributed_child_PG_session_record_required')
        row = context.query("SELECT COALESCE((SELECT jsonb_build_object('pid',pid,'backendStart',(extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text)FROM pg_stat_activity WHERE pid=" + str(backend['pid']) + "),'null'::jsonb)")
        need(row is None or row != {'pid': backend['pid'], 'backendStart': backend['backendStart']}, 'exact_owned_child_backend_must_be_gone_before_reconciliation')


def xid_status(context, xid):
    need(isinstance(xid, str) and re.fullmatch('[1-9][0-9]*', xid), 'exact_owned_publication_XID_required')
    value = context.query("SELECT COALESCE(to_json(pg_xact_status('" + xid + "'::xid8)),'null'::json)")
    need(value in {'committed', 'aborted', 'in progress', None}, 'known_actual_transaction_status_required')
    return value


def reconcile_roles(proof, intent_sha):
    op = operation(proof); c = current_context(proof, op); child_terminal(c, 'roles')
    intent = document(BASE / 'roles-intent.json', intent_sha); packet = document(BASE / 'roles-prepared.json')
    need(intent['format'] == 'yunipals-ypal-native-reader-LOGIN-v1' and intent['bootId'] == boot() and intent['reviewHash'] == op['reviewHash'] and
         intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and intent['authorizationSha256'] == op['binding']['loginAuthorizationSha256'] and
         packet['mode'] == 'roles' and packet['before'] == op['binding']['beforeLoginCatalog'] and packet['after'] == op['binding']['afterLoginCatalog'],
         'same_owned_reader_LOGIN_intent_prepared_catalog_required')
    need(xid_status(c, packet['xid']) == 'committed' and c.catalog() == packet['after'], 'reader_LOGIN_commit_not_proven_no_reexecution')
    ack = {'format': 'yunipals-ypal-native-reader-LOGIN-v1', 'committed': True, 'operatorSha256': op['binding']['operatorSha256'], 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'intentSha256': intent_sha,
        'preparedSha256': sha(public_input(BASE / 'roles-prepared.json')), 'xid': packet['xid'],
        'afterCatalogSha256': sha(encoded(packet['after'])), 'originalCollectorLOGINRetained': True, 'reconciled': True}
    save('roles-admitted.json', ack); c.scope(True)
    return {'format': FORMAT, 'readerLOGINsAdmitted': True, 'reconciled': True, 'databaseWrites': 0, 'serviceActions': 0}


def publication_review(proof):
    op = operation(proof); c = current_context(proof, op); c.scope(True); prepublication(c, op)
    need(not os.path.lexists(PUBLICATION) and not (BASE / 'inverse-intent.json').exists(), 'one_explicit_fresh_publication_attempt_required')
    _, candidate, _, _ = c.generation()
    observed = child(c, 'inspect', {'generationId': candidate['generationId']})
    need(observed['inspected'] is True and observed['databaseWrites'] == 0 and observed['observation']['pointer']['current'] == '103' and
         observed['observation']['candidate']['published'] is False, 'actual_old_pointer_and_unpublished_candidate_required')
    baseline_points = [
        {'chainId': 1, 'number': '26236452'}, {'chainId': 56, 'number': '128816538'}, {'chainId': 137, 'number': '95883932'},
        {'chainId': 8453, 'number': '52870956'}, {'chainId': 8453, 'number': '52870977'}]
    plan = {'generationId': candidate['generationId'], 'predecessorGenerationId': '103', 'metadataReleaseId': candidate['metadataReleaseId'],
        'sourceRelease': proof.RELEASE, 'readIdentity': proof.IDENTITY, 'validationSqlSha256': observed['observation']['candidate']['validationSha256'],
        'originalObservationSha256': observed['observationSha256'], 'candidateSourceSnapshot': candidate['sourceSnapshot'], 'boundaryPoints': baseline_points}
    action = action_preflight(c)
    binding = {'format': FORMAT, 'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot(),
        'rolesAdmittedSha256': sha(public_input(BASE / 'roles-admitted.json')), 'sourceManifestSha256': op['binding']['sourceManifestSha256'],
        'candidateSha256': c.prepared['config']['generationSha256'], 'cachePreparedSha256': c.inputs['cachePreparedSha256'],
        'plan': plan, 'originalObservation': observed['observation'], 'witnesses': op['binding']['witnesses'],
        'actionPreflight': {'fixture': action['fixture'], 'fixtureSha256': action['fixtureSha256'],
             'requestSha256': action['proof']['requestSha256'], 'actualCanonicalFullReceiptProof': True,
             'installedMainArtifactDigest': proof.MAIN_DIGEST, 'databaseReadOnly': True, 'providerAttempts': 0}}
    prepublication(c, op)
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'actionObservation': action['proof'], 'databaseWrites': 0, 'serviceActions': 0}


def publish(proof, expected):
    reviewed = publication_review(proof); need(reviewed['reviewHash'] == expected, 'fresh_exact_publication_review_required')
    op = operation(proof); c = current_context(proof, op)
    PUBLICATION.mkdir(mode=0o700); sync(BASE)
    save('publication-intent.json', {**reviewed, 'databaseCommitAllowedOnlyAfterPreparedRootACK': True}, directory=PUBLICATION)
    prepare_runtime(c, op)
    def acknowledge(message):
        if message['event'] == 'private-prepared':
            need(message['generationId'] == reviewed['binding']['plan']['generationId'] and message['predecessorGenerationId'] == '103' and
                 message['originalObservation'] == reviewed['binding']['originalObservation'] and
                 message['originalObservationSha256'] == reviewed['binding']['plan']['originalObservationSha256'], 'same_global_predecessor_after_private_preparation_required')
            prepublication(c, op)
            save('wallet-private-prepared.json', {'message': message, 'literalJson': js_encoded(message).decode(), 'messageSha256': sha(js_encoded(message))}, directory=PUBLICATION)
            return True
        need(message['event'] == 'publication-prepared' and message['generationId'] == reviewed['binding']['plan']['generationId'] and
             message['expectedPointer'] == {'current': reviewed['binding']['plan']['generationId'], 'previous': '103'} and
             message['privatePacketSha256'] == document(PUBLICATION / 'wallet-private-prepared.json')['messageSha256'], 'same_private_session_handle_and_owned_publication_XID_required')
        prepublication(c, op)
        c.cache.legacy_http(c.host, True)
        disable_reader_boots(c, op)
        save('publication-prepared.json', {**message, 'literalJson': js_encoded(message).decode(), 'messageSha256': sha(js_encoded(message)),
             'rootPreparedMonotonic': time.monotonic(), 'rootPreparedUnixMs': int(time.time() * 1000)}, directory=PUBLICATION)
        return True
    result = child(c, 'publish', reviewed['binding']['plan'], acknowledge)
    packet = document(PUBLICATION / 'publication-prepared.json')
    need(result['published'] is True and result['xid'] == packet['xid'] and result['preparedPacketSha256'] == packet['messageSha256'] and result['after']['pointer'] == packet['expectedPointer'] and
         result['after']['stamps'] == packet['expectedStamps'] and result['after']['walletStats'] == packet['staged']['walletStats'], 'exact_actual_atomic_publication_commit_ACK_required')
    record = {'format': FORMAT, 'published': True, 'operatorSha256': op['binding']['operatorSha256'], 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'publicationIntentSha256': sha(public_input(PUBLICATION / 'publication-intent.json')),
        'preparedSha256': sha(public_input(PUBLICATION / 'publication-prepared.json')), 'result': result, 'readerInstallationsCompleted': False,
        'recurringGenerationStarted': False, 'automaticRepublishAllowed': False}
    pin = save('published.json', record, directory=PUBLICATION)
    # The reviewed transition includes the finite reader phase immediately after
    # its own publication ACK. A failure preserves every journal and never
    # triggers an implicit inverse, restart or second publication.
    return complete_readers(proof, time.monotonic() + MAX_CRITICAL_SECONDS)


def published(proof, pin=None):
    op = operation(proof); record = document(PUBLICATION / 'published.json', pin)
    intent = document(PUBLICATION / 'publication-intent.json', record['publicationIntentSha256'])
    packet = document(PUBLICATION / 'publication-prepared.json', record['preparedSha256'])
    need(record['format'] == FORMAT and record['published'] is True and record['operatorSha256'] == op['binding']['operatorSha256'] and
         record['operationSha256'] == sha(public_input(BASE / 'operation.json')) and record['bootId'] == boot() and
         intent['reviewHash'] == sha(encoded(intent['binding'])) and intent['binding']['operationSha256'] == record['operationSha256'] and
         intent['binding']['rolesAdmittedSha256'] == sha(public_input(BASE / 'roles-admitted.json')) and
         record['result']['xid'] == packet['xid'] and record['result']['preparedPacketSha256'] == packet['messageSha256'] and
         sha(packet['literalJson'].encode()) == packet['messageSha256'], 'exact_owned_publication_intent_XID_and_receipt_chain_required')
    return op, record, packet


def current_published(context, record, packet):
    gid = record['result']['after']['candidate']['id']
    now = child(context, 'inspect', {'generationId': gid})['observation']
    expected = copy.deepcopy(packet['staged']); expected['pointer'] = packet['expectedPointer']
    expected['stamps'] = packet['expectedStamps']; expected['candidate']['published'] = True
    need(now == expected and now == record['result']['after'], 'exact_owned_published_pointer_wallets_two_stamps_and_candidate_required')
    context.generation_terminal(); return now


def reconcile_publication(proof, intent_sha):
    op = operation(proof); c = current_context(proof, op); child_terminal(c, 'publish')
    need(not (PUBLICATION / 'published.json').exists(), 'published_receipt_already_exists_no_reconciliation_overwrite')
    intent = document(PUBLICATION / 'publication-intent.json', intent_sha)
    need(intent['reviewHash'] == sha(encoded(intent['binding'])) and intent['binding']['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         intent['binding']['rolesAdmittedSha256'] == sha(public_input(BASE / 'roles-admitted.json')) and
         intent['binding']['sourceManifestSha256'] == op['binding']['sourceManifestSha256'], 'exact_owned_publication_review_intent_required')
    packet = document(PUBLICATION / 'publication-prepared.json')
    need(packet['format'] == 'yunipals-ypal-native-publication-protocol-v1' and packet['event'] == 'publication-prepared' and
         packet['generationId'] == intent['binding']['plan']['generationId'] and packet['predecessorGenerationId'] == '103' and
         sha(packet['literalJson'].encode()) == packet['messageSha256'], 'owned_preCOMMIT_XID_packet_required')
    need(xid_status(c, packet['xid']) == 'committed', 'publication_COMMIT_not_proven_no_automatic_republication')
    c.scope(True); c.generation_terminal(); original_readers(c, op)
    now = child(c, 'inspect', {'generationId': packet['generationId']})['observation']
    expected = copy.deepcopy(packet['staged']); expected['pointer'] = packet['expectedPointer']
    expected['stamps'] = packet['expectedStamps']; expected['candidate']['published'] = True
    need(now == expected, 'actual_committed_global_postcondition_must_match_owned_prepared_tuple')
    derived = child(c, 'capsule-inspect', {})['observation']
    record = {'format': FORMAT, 'published': True, 'operatorSha256': op['binding']['operatorSha256'], 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'publicationIntentSha256': intent_sha,
        'preparedSha256': sha(public_input(PUBLICATION / 'publication-prepared.json')),
        'result': {'format': 'yunipals-ypal-native-publication-protocol-v1', 'published': True, 'xid': packet['xid'], 'after': now,
            'preparedPacketSha256': packet['messageSha256'], 'ownedDerivedObservation': derived, 'commitAcknowledgedAtUnixMs': None,
            'actualCommitTimeUnknown': True, 'reconciledFromOwnCommittedXID': True},
        'readerInstallationsCompleted': False, 'recurringGenerationStarted': False, 'automaticRepublishAllowed': False}
    pin = save('published.json', record, directory=PUBLICATION)
    return {'format': FORMAT, 'published': True, 'reconciled': True, 'receiptSha256': pin, 'databaseWrites': 0, 'serviceActions': 0}


def postpublication_gate(context, record, packet, readiness=True):
    context.scope(True); context.generation_terminal()
    current_published(context, record, packet)
    if readiness:
        context.native_ready(); context.metadata()
        separate_witnesses(context)
    context.metadata_comparison()


def owned_reader(context, op, name, preview=False):
    descriptor = reader_descriptor(op, name, preview)
    verify_descriptor_files(op, name, preview)
    actual = context.reader(name, descriptor['expected'], preview)
    prefix = ('preview-' if preview else 'reader-') + name
    ack = document(BASE / (prefix + '-started.json'))
    need(ack['format'] == FORMAT and ack['bootId'] == boot() and ack['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         ack['descriptorSha256'] == sha(encoded(descriptor)) and ack['actor']['main'] == actual['main'] and
         ack['actor']['unit']['InvocationID'] == actual['unit']['InvocationID'], 'same_acknowledged_native_reader_invocation_required')
    return actual


def terminal_owned_reader(context, op, name, preview=False):
    descriptor = reader_descriptor(op, name, preview); verify_descriptor_files(op, name, preview)
    prefix = ('preview-' if preview else 'reader-') + name
    ack = document(BASE / (prefix + '-started.json')); actor = ack['actor']
    need(ack['format'] == FORMAT and ack['bootId'] == boot() and ack['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         ack['descriptorSha256'] == sha(encoded(descriptor)), 'exact_own_started_reader_before_terminal_reconciliation_required')
    state = context.loaded_descriptor(descriptor)
    need(state['InvocationID'] == actor['unit']['InvocationID'], 'failed_reader_must_retain_the_exact_acknowledged_invocation')
    context.proof.terminal(state, actor['processes'])
    sessions = context.terminal_sessions(actor, context.proof.PEERS[name]['oid'])
    need(context.loaded_descriptor(descriptor) == state, 'failed_reader_configuration_changed_during_terminal_peer_capture')
    return actor, sessions


def start_reader(context, op, name, preview=False, reconcile=False, deadline=None):
    descriptor = reader_descriptor(op, name, preview); prefix = ('preview-' if preview else 'reader-') + name
    if (BASE / (prefix + '-started.json')).exists(): return owned_reader(context, op, name, preview)
    intent_path = BASE / (prefix + '-start-intent.json')
    if not intent_path.exists():
        need(not reconcile, 'missing_owned_start_intent_cannot_be_reconciled')
        verify_descriptor_files(op, name, preview)
        state = context.loaded_descriptor(descriptor); context.proof.terminal(state)
        context.capacity(name)
        intent = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
            'descriptorSha256': sha(encoded(descriptor)), 'before': state,
            'minimumStartTicks': time.monotonic_ns() * os.sysconf('SC_CLK_TCK') // 1000000000}
        save(intent_path.name, intent)
        need(context.loaded_descriptor(descriptor) == state and verify_descriptor_files(op, name, preview), 'reader_changed_after_fsynced_start_intent')
        manager('start', descriptor['unit'], deadline)
    else:
        need(reconcile, 'unknown_reader_start_requires_explicit_readonly_reconciliation_no_resend')
        intent = document(intent_path)
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         intent['descriptorSha256'] == sha(encoded(descriptor)), 'exact_current_owned_reader_start_intent_required')
    verify_descriptor_files(op, name, preview)
    actor = context.reader(name, descriptor['expected'], preview)
    need(actor['main']['startTicks'] >= intent['minimumStartTicks'] and actor['unit']['InvocationID'] != intent['before']['InvocationID'],
         'fresh_owned_native_start_after_the_durable_intent_required')
    save(prefix + '-started.json', {'format': FORMAT, 'bootId': boot(), 'operationSha256': intent['operationSha256'],
        'descriptorSha256': intent['descriptorSha256'], 'actor': actor, 'startIntentSha256': sha(public_input(intent_path)),
        'reconciledFromActualActor': reconcile, 'managerActionRepeated': False})
    return actor


def stop_reader(context, op, name, preview=False, original=False, reconcile=False, deadline=None):
    prefix = ('preview-' if preview else 'original-' if original else 'reader-') + name
    unit = context.proof.preview_unit(name) if preview else context.proof.PEERS[name]['unit']
    intent_path, ack_path = BASE / (prefix + '-stop-intent.json'), BASE / (prefix + '-stopped.json')
    if ack_path.exists():
        ack = document(ack_path); context.drained(name, ack['actor'], ack['sessions'], preview); return ack
    if not intent_path.exists():
        need(not reconcile, 'missing_owned_stop_intent_cannot_be_reconciled')
        if not original and context.state(unit)['MainPID'] == '0':
            actor, sessions = terminal_owned_reader(context, op, name, preview)
            intent = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
                'unit': unit, 'actor': actor, 'sessions': sessions, 'alreadyTerminalNoStopDispatched': True}
            save(intent_path.name, intent)
            context.drained(name, actor, sessions, preview)
            value = {**intent, 'stopped': True, 'reconciledFromTerminalState': True, 'managerActionRepeated': False}
            save(ack_path.name, value); return value
        actor = original_reader(context, op, name) if original else owned_reader(context, op, name, preview)
        sessions = context.sessions(actor) if original else context.sessions(actor, context.proof.PEERS[name]['oid'])
        now = original_reader(context, op, name) if original else owned_reader(context, op, name, preview)
        need(now == actor, 'reader_changed_during_fresh_kernel_session_capture')
        intent = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
            'unit': unit, 'actor': actor, 'sessions': sessions}
        save(intent_path.name, intent)
        need((original_reader(context, op, name) if original else owned_reader(context, op, name, preview)) == actor,
             'reader_changed_after_fsynced_stop_intent_zero_stop_authority')
        manager('stop', unit, deadline)
    else:
        need(reconcile, 'unknown_reader_stop_requires_explicit_readonly_reconciliation_no_resend')
        intent = document(intent_path)
    need(intent['format'] == FORMAT and intent['bootId'] == boot() and intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         intent['unit'] == unit, 'same_exact_owned_reader_stop_intent_required')
    context.drained(name, intent['actor'], intent['sessions'], preview)
    value = {**intent, 'stopped': True, 'reconciledFromTerminalState': reconcile, 'managerActionRepeated': False}
    save(ack_path.name, value); return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('reader_acceptance_redirect_refused')


def request_http(port, path, deadline, body=None):
    need(port in {9011, 9012, 9015, 9101, 9112, 9115} and path.startswith('/') and not path.startswith('//') and '\n' not in path,
         'fixed_local_reader_acceptance_endpoint_required')
    remaining = deadline - time.monotonic(); need(remaining > 0, 'bounded_reader_acceptance_deadline_expired')
    raw_request = None if body is None else js_encoded(body)
    need(raw_request is None or len(raw_request) <= 8192, 'bounded_nonmutating_action_request_required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request('http://127.0.0.1:' + str(port) + path, data=raw_request,
        headers={'accept': 'application/json', **({'content-type': 'application/json'} if body is not None else {})}, method='POST' if body else 'GET')
    try: response = opener.open(request, timeout=min(5, remaining))
    except urllib.error.HTTPError as error: response = error
    with response:
        raw = response.read(1000001); need(len(raw) <= 1000000, 'bounded_reader_response_required')
        value = json.loads(raw)
        return {'status': response.code, 'bytes': len(raw), 'sha256': sha(raw), 'releaseHeader': response.headers.get('X-Indexer-Release')}, value


def positive_reader(context, op, name, descriptor, deadline, capture=None):
    old = context.proof.module('consumer-operational-preview-v6.py', context.proof.DEPENDENCIES['consumer-operational-preview-v6.py'])
    paths, labels, owner = old.routes(types.SimpleNamespace(json_sql=context.query), types.SimpleNamespace(READ_SCHEMA=context.proof.READ), name)
    rows = []; startup_deadline = min(deadline, time.monotonic() + 45)
    while True:
        need(time.monotonic() < startup_deadline, 'bounded_owned_reader_startup_health_expired')
        actor = owned_reader(context, op, name, descriptor['preview'])
        try:
            item, value = request_http(descriptor['port'], paths[0], startup_deadline)
            if item['status'] == 200:
                need(old.positive(name, paths[0], item, value, context.proof.RELEASE, owner), 'foreign_or_incorrect_reader_startup_response')
                context.listener(descriptor, actor); break
            need(item['status'] == 503, 'unexpected_reader_startup_HTTP_status')
        except (OSError, urllib.error.URLError, TimeoutError): pass
        time.sleep(min(.5, max(0, startup_deadline - time.monotonic())))
    for path, label in zip(paths, labels):
        item, value = request_http(descriptor['port'], path, deadline)
        need(old.positive(name, path, item, value, context.proof.RELEASE, owner), 'all_enabled_native_reader_features_must_serve_positive_selected_data')
        rows.append({**item, 'route': label, 'positiveShape': True})
        if capture: context.listener(descriptor, capture())
    if name == 'main':
        fixture = document(PUBLICATION / 'publication-intent.json')['binding']['actionPreflight']['fixture']
        item, selected = request_http(descriptor['port'], old.ACTION_PATH, deadline)
        need(item['status'] == 200 and item['releaseHeader'] == context.proof.RELEASE and
             old.action_selection(selected, context.proof.RELEASE, context.proof.IDENTITY, '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112', '71e2a7f3b7'),
             'same_current_action_endpoint_selection_required')
        rows.append({**item, 'route': 'action_selection', 'positiveShape': True})
        item, value = request_http(descriptor['port'], old.ACTION_PATH, deadline, fixture['request'])
        codec = types.SimpleNamespace(sha=sha, encoded=lambda v: json.dumps(v, sort_keys=True, separators=(',', ':')).encode())
        need(item['status'] == 200 and item['releaseHeader'] == context.proof.RELEASE and old.action_positive(codec, value, fixture['request'], selected),
             'actual_known_BNB_action_canonical_full_receipt_endpoint_required')
        rows.append({**item, 'route': 'known_BNB_full_receipt', 'positiveShape': True, 'applicationFinancialStateVerified': False})
    if capture: context.listener(descriptor, capture())
    return {'routes': rows, 'allEnabledFeaturesAccepted': True, 'responseRowsExported': False, 'boundedGETsAndReadOnlyActionPOSTOnly': True}


def reload_once(label, context, descriptor, deadline=None):
    ack = BASE / (label + '-reload-result.json'); intent = BASE / (label + '-reload-intent.json')
    if ack.exists(): context.loaded_descriptor(descriptor); return
    need(not intent.exists(), 'unknown_reader_reload_requires_explicit_readonly_reconciliation')
    save(intent.name, {'bootId': boot(), 'descriptorSha256': sha(encoded(descriptor))})
    result = manager('daemon-reload', deadline=deadline); context.loaded_descriptor(descriptor); save(ack.name, result)


def restore_reader_boots(context, op, inverse=False, deadline=None):
    phase = 'inverse-' if inverse else ''
    for name, entry in op['binding']['readerBootLinks'].items():
        if entry['identity'] is None: continue
        path, parked = Path(entry['path']), BASE / ('original-' + name + '-boot')
        label = phase + 'reader-' + name + '-boot-restore'
        if not (BASE / (label + '-intent.json')).exists():
            if inverse:
                need(document(BASE / ('inverse-' + name + '-boot-disable-result.json')) == entry and
                     inode(parked, True) == entry['identity'] and not os.path.lexists(path), 'same_inverse_owned_parked_boot_required')
            else: boot_disabled(context.proof, name, op)
            save(label + '-intent.json', entry)
        need(document(BASE / (label + '-intent.json')) == entry, 'same_original_reader_boot_restore_intent_required')
        if not os.path.lexists(path):
            need(inode(parked, True) == entry['identity'], 'same_parked_original_reader_boot_before_restore')
            os.rename(parked, path); sync(path.parent); sync(BASE)
        need(inode(path, True) == entry['identity'] and not os.path.lexists(parked), 'only_same_original_reader_boot_inode_may_be_restored')
        if not (BASE / (label + '-result.json')).exists(): save(label + '-result.json', entry)
    prefix = phase + 'reader-boots-restored-reload'
    if not (BASE / (prefix + '-result.json')).exists():
        need(not (BASE / (prefix + '-intent.json')).exists(), 'unknown_boot_enable_reload_requires_explicit_readonly_reconcile')
        save(prefix + '-intent.json', {'bootId': boot()}); save(prefix + '-result.json', manager('daemon-reload', deadline=deadline))


def complete_readers(proof, deadline):
    op, record, packet = published(proof); c = current_context(proof, op)
    need(not (BASE / 'inverse-intent.json').exists() and not (BASE / 'result.json').exists(), 'fresh_uninversed_reader_completion_required')
    postpublication_gate(c, record, packet)
    for name in proof.PEERS:
        need(time.monotonic() < deadline, 'critical_window_expired_explicit_continue_or_owned_inverse_required')
        preview = reader_descriptor(op, name, True); final = reader_descriptor(op, name)
        prefix = 'preview-' + name
        if not (BASE / (prefix + '-accepted.json')).exists():
            start_reader(c, op, name, True, deadline=deadline)
            positive = positive_reader(c, op, name, preview, min(deadline, time.monotonic() + 90), lambda: owned_reader(c, op, name, True))
            save(prefix + '-accepted.json', {'format': FORMAT, 'operationSha256': sha(public_input(BASE / 'operation.json')),
                'descriptorSha256': sha(encoded(preview)), 'proof': positive})
        need(time.monotonic() < deadline, 'critical_window_expired_before_preview_drain')
        if not (BASE / (prefix + '-stopped.json')).exists(): stop_reader(c, op, name, True, deadline=deadline)
        else:
            previous = document(BASE / (prefix + '-stopped.json')); c.drained(name, previous['actor'], previous['sessions'], True)
        if not (BASE / ('original-' + name + '-stopped.json')).exists():
            postpublication_gate(c, record, packet)
            need(time.monotonic() < deadline, 'critical_window_expired_before_original_reader_stop')
            stop_reader(c, op, name, original=True, deadline=deadline)
        for label, path, spec in descriptor_files(op, name):
            need(time.monotonic() < deadline, 'critical_window_expired_before_reader_overlay_publication'); publish_file(label, path, spec)
        reload_once('reader-' + name, c, final, deadline)
        start_reader(c, op, name, deadline=deadline)
        if not (BASE / ('reader-' + name + '-accepted.json')).exists():
            positive = positive_reader(c, op, name, final, min(deadline, time.monotonic() + 90), lambda: owned_reader(c, op, name))
            save('reader-' + name + '-accepted.json', {'format': FORMAT, 'operationSha256': sha(public_input(BASE / 'operation.json')),
                'descriptorSha256': sha(encoded(final)), 'proof': positive})
        owned_reader(c, op, name)
    need(time.monotonic() < deadline, 'critical_window_expired_before_boot_restore')
    restore_reader_boots(c, op, deadline=deadline)
    postpublication_gate(c, record, packet)
    health = {name: positive_reader(c, op, name, reader_descriptor(op, name), min(deadline, time.monotonic() + 90),
                                   lambda n=name: owned_reader(c, op, n)) for name in proof.PEERS}
    health_round = len(list(BASE.glob('reader-final-health-*.json'))) + 1
    need(health_round <= 8, 'bounded_final_readiness_requalification_count_exceeded')
    health_sha = save('reader-final-health-' + str(health_round) + '.json', health)
    scope = c.scope(True); metadata = c.metadata()
    actual = {name: owned_reader(c, op, name) for name in proof.PEERS}
    need(time.monotonic() < deadline, 'critical_window_expired_before_final_acceptance_requires_explicit_review')
    current_published(c, record, packet); original_inputs(c, op)
    need({name: owned_reader(c, op, name) for name in proof.PEERS} == actual, 'all_reader_private_and_actor_facts_must_remain_exact_after_final_SQL')
    commit_time = record['result']['commitAcknowledgedAtUnixMs']; health_time = int(time.time() * 1000)
    value = {'format': FORMAT, 'completed': True, 'operatorSha256': op['binding']['operatorSha256'], 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'sourceManifestSha256': op['binding']['sourceManifestSha256'],
        'publicationSha256': sha(public_input(PUBLICATION / 'published.json')), 'cachePreparedSha256': c.inputs['cachePreparedSha256'],
        'generationCandidateSha256': c.prepared['config']['generationSha256'], 'generationId': packet['generationId'],
        'sourceRelease': proof.RELEASE, 'readIdentity': proof.IDENTITY, 'readersCutOver': True, 'nativeGenerationPublished': True,
        'readerActors': actual, 'readerAcceptanceSha256': {n: sha(public_input(BASE / ('reader-' + n + '-accepted.json'))) for n in proof.PEERS},
        'readerBootLinks': {n: reader_boot(proof, n) for n in proof.PEERS}, 'scope': scope, 'metadata': metadata,
        'finalAllThreeHealthProofSha256': health_sha, 'finalAllThreeHealthProofFile': 'reader-final-health-' + str(health_round) + '.json',
        'witnesses': op['binding']['witnesses'], 'allSixCanonicalWitnessCurrentReadinessClaimed': False,
        'commitAcknowledgedAtUnixMs': commit_time, 'readerHealthAcceptedAtUnixMs': health_time,
        'commitToReaderHealthSeconds': None if commit_time is None else max(0, (health_time - commit_time) / 1000),
        'preparedToReaderHealthUpperBoundSeconds': time.monotonic() - packet['rootPreparedMonotonic'],
        'actualCommitTimeUnknown': commit_time is None, 'zeroOutageClaimed': False,
        'cacheWorkerStarted': False, 'recurringGenerationStarted': False, 'freshYPALReaderHandoverClaimed': False}
    pin = save('result.json', value)
    return {'format': FORMAT, 'completed': True, 'resultSha256': pin, 'nativeGenerationPublished': True, 'readersCutOver': True,
            'cacheWorkerStarted': False, 'commitToReaderHealthSeconds': value['commitToReaderHealthSeconds']}


def original_inputs(context, op):
    for name, original in op['binding']['originalReaders'].items():
        for path, pin in original['definitions'].items():
            need(sha(context.host.m.protected(path)) == pin, 'retained_reader_base_definition_drift')
        for path, pin in original['privateInputHashes'].items():
            need(not os.path.lexists(path) if pin is None else sha(context.host.m.protected(path)) == pin, 'retained_reader_private_input_drift')
        need(sha(encoded(context.host.m.service_property(context.proof.PEERS[name]['unit'], 'Environment'))) == original['inlineEnvironmentSha256'],
             'retained_reader_inline_environment_drift')
    return {'allOriginalDefinitionAndPrivateHashesPreserved': True}


def pending_definitions(unit, expected):
    """Reject extra on-disk drop-ins before an explicit manager reload.

    Inspect the fixed systemd search directories as well as recorded fragments;
    loaded DropInPaths alone cannot detect a newly added, not-yet-loaded file.
    Alias directories (/lib on usr-merged hosts) are compared by real path.
    """
    need(re.fullmatch('yunipals-[a-z0-9-]+\\.service', unit), 'fixed_yunipals_unit_configuration_required')
    allowed = {str(Path(path).resolve()): pin for path, pin in expected.items()}
    need(len(allowed) == len(expected), 'one_exact_path_per_recorded_definition_required')
    for path, pin in allowed.items():
        need(sha(public_input(path)) == pin, 'same_on_disk_definition_before_configuration_reload_required')
    stem = unit.removesuffix('.service')
    names = {'service.d', unit + '.d'} | {stem[:index + 1] + '.service.d' for index, char in enumerate(stem) if char == '-'}
    for root in SYSTEMD_ROOTS:
        fragment = Path(root) / unit
        if os.path.lexists(fragment):
            need(stat.S_ISREG(fragment.lstat().st_mode) and str(fragment.resolve()) in allowed and
                 sha(public_input(fragment.resolve())) == allowed[str(fragment.resolve())], 'unreviewed_pending_unit_fragment_must_not_be_loaded')
        for directory in [Path(root) / name for name in names]:
            if not os.path.lexists(directory): continue
            st = directory.lstat()
            need(stat.S_ISDIR(st.st_mode) and st.st_uid == st.st_gid == 0 and not st.st_mode & 0o022,
                 'protected_literal_unit_dropin_directory_required')
            for path in directory.glob('*.conf'):
                need(stat.S_ISREG(path.lstat().st_mode) and str(path.resolve()) in allowed and sha(public_input(path.resolve())) == allowed[str(path.resolve())],
                     'unreviewed_pending_unit_dropin_must_not_be_loaded')
    return {'pendingDefinitionFilesSha256': sha(encoded(allowed))}


def pending_readers(context, op):
    result = {}
    for name, old in op['binding']['originalReaders'].items():
        expected = dict(old['definitions'])
        for label, path, spec in descriptor_files(op, name):
            if not path.endswith('.conf') or not os.path.lexists(path): continue
            need(inode(path) == document(BASE / (label + '-published.json')), 'same_owned_pending_native_drop_required')
            expected[path] = sha(spec['text'].encode())
        result[name] = pending_definitions(context.proof.PEERS[name]['unit'], expected)
        preview = reader_descriptor(op, name, True)
        installed = {path: sha(spec['text'].encode()) for path, spec in preview['files'].items() if path.endswith('.service') and os.path.lexists(path)}
        if installed:
            verify_descriptor_files(op, name, True)
            result['preview-' + name] = pending_definitions(preview['unit'], installed)
    return result


def services_frame(context, op):
    original_inputs(context, op); frame = {}
    for name in context.proof.PEERS:
        row = {}
        for preview in (True, False):
            prefix = ('preview-' if preview else 'reader-') + name
            started, stopped = BASE / (prefix + '-started.json'), BASE / (prefix + '-stopped.json')
            if stopped.exists():
                ack = document(stopped); context.drained(name, ack['actor'], ack['sessions'], preview)
                row[prefix] = {'terminal': True, 'stoppedSha256': sha(public_input(stopped))}
            elif started.exists():
                actor = owned_reader(context, op, name, preview)
                row[prefix] = {'actor': actor, 'startedSha256': sha(public_input(started))}
            elif (BASE / (prefix + '-start-intent.json')).exists():
                need(False, 'unknown_start_ACK_requires_explicit_service_reconciliation_before_continue')
            elif not preview:
                old_stop = BASE / ('original-' + name + '-stopped.json')
                if old_stop.exists():
                    ack = document(old_stop); context.drained(name, ack['actor'], ack['sessions'])
                    row['original'] = {'stoppedSha256': sha(public_input(old_stop)), 'terminal': True}
                else: row['original'] = original_reader(context, op, name)
            else:
                state = context.loaded_descriptor(reader_descriptor(op, name, True)); context.proof.terminal(state)
                row[prefix] = {'neverStartedByOwner': True, 'loadedState': state}
        frame[name] = row
    return frame


def continue_review(proof):
    op, record, packet = published(proof); c = current_context(proof, op)
    need(not (BASE / 'inverse-intent.json').exists() and not (BASE / 'result.json').exists(), 'uncompleted_uninversed_forward_phase_required')
    postpublication_gate(c, record, packet)
    value = {'format': FORMAT, 'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot(),
        'publicationSha256': sha(public_input(PUBLICATION / 'published.json')), 'sourceManifestSha256': op['binding']['sourceManifestSha256'],
        'readers': services_frame(c, op), 'scope': c.scope(True), 'metadata': c.metadata(),
        'privateInputs': original_inputs(c, op), 'oneExplicitNewBoundedWindowSeconds': MAX_CRITICAL_SECONDS,
        'publicationMayRepeat': False, 'unknownServiceActionMayRepeat': False}
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'databaseWrites': 0, 'serviceActions': 0}


def continue_readers(proof, expected):
    checked = continue_review(proof); need(checked['reviewHash'] == expected, 'exact_fresh_owned_forward_continuation_review_required')
    number = sum(1 for p in BASE.glob('continue-*-intent.json')) + 1
    need(1 <= number <= 8, 'bounded_explicit_forward_continuation_count_exceeded')
    save('continue-' + str(number) + '-intent.json', checked)
    return complete_readers(proof, time.monotonic() + MAX_CRITICAL_SECONDS)


def reconcile_service_review(proof, name, phase):
    op, record, packet = published(proof); c = current_context(proof, op)
    need(name in proof.PEERS and phase in {'preview-start', 'preview-stop', 'original-stop', 'reader-start', 'reader-reload'},
         'one_fixed_owned_service_ACK_phase_required')
    c.scope(True); original_inputs(c, op); current_published(c, record, packet)
    preview = phase.startswith('preview'); prefix = phase.replace('-start', '').replace('-stop', '').replace('-reload', '') + '-' + name
    path = BASE / (prefix + ('-reload-intent.json' if phase.endswith('reload') else '-start-intent.json' if phase.endswith('start') else '-stop-intent.json'))
    intent = document(path)
    if phase.endswith('start'):
        actor = c.reader(name, reader_descriptor(op, name, preview)['expected'], preview)
        need(actor['main']['startTicks'] >= intent['minimumStartTicks'] and actor['unit']['InvocationID'] != intent['before']['InvocationID'],
             'same_owned_fresh_actual_actor_required_to_reconcile_start')
        actual = actor
    elif phase.endswith('stop'):
        actual = c.drained(name, intent['actor'], intent['sessions'], preview)
    else: actual = c.loaded_descriptor(reader_descriptor(op, name))
    value = {'format': FORMAT, 'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot(),
        'phase': phase, 'name': name, 'intentSha256': sha(public_input(path)), 'actual': actual}
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'databaseWrites': 0, 'serviceActions': 0}


def reconcile_service(proof, name, phase, expected):
    checked = reconcile_service_review(proof, name, phase)
    need(checked['reviewHash'] == expected, 'fresh_exact_readonly_service_ACK_review_required')
    op = operation(proof); c = current_context(proof, op)
    if phase.endswith('start'): start_reader(c, op, name, phase.startswith('preview'), True)
    elif phase.endswith('stop'): stop_reader(c, op, name, phase.startswith('preview'), phase.startswith('original'), True)
    else:
        descriptor = reader_descriptor(op, name); intent = document(BASE / ('reader-' + name + '-reload-intent.json'))
        need(intent['bootId'] == boot() and intent['descriptorSha256'] == sha(encoded(descriptor)), 'exact_reader_reload_intent_required')
        c.loaded_descriptor(descriptor); save('reader-' + name + '-reload-result.json', {'reconciled': True, 'serviceActions': 0})
    return {'format': FORMAT, 'reconciled': True, 'phase': phase, 'serviceActions': 0, 'databaseWrites': 0}


def validate_current(result_sha, source_manifest_sha):
    need(all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in (result_sha, source_manifest_sha)),
         'actual_explicit_cutover_result_and_source_manifest_pins_required')
    proof = load_proof(source_manifest_sha); op, record, packet = published(proof)
    result = document(BASE / 'result.json', result_sha)
    need(result['format'] == FORMAT and result['completed'] is True and result['operatorSha256'] == op['binding']['operatorSha256'] and
         result['bootId'] == boot() and result['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         result['publicationSha256'] == sha(public_input(PUBLICATION / 'published.json')) and
         result['sourceManifestSha256'] == source_manifest_sha and not (BASE / 'inverse-intent.json').exists(), 'exact_uninversed_completed_three_reader_ACK_required')
    c = current_context(proof, op); postpublication_gate(c, record, packet); original_inputs(c, op)
    actual = {name: owned_reader(c, op, name) for name in proof.PEERS}
    need(actual == result['readerActors'] and {n: reader_boot(proof, n) for n in proof.PEERS} == result['readerBootLinks'],
         'all_three_exact_acknowledged_live_reader_actors_and_boot_inodes_required')
    return {'format': FORMAT, 'validated': True, 'receiptSha256': result_sha, 'sourceManifestSha256': source_manifest_sha,
        'operationSha256': result['operationSha256'], 'publicationSha256': result['publicationSha256'], 'generationId': packet['generationId'],
        'cachePreparedSha256': result['cachePreparedSha256'], 'generationCandidateSha256': result['generationCandidateSha256'],
        'sourceRelease': proof.RELEASE, 'readIdentity': proof.IDENTITY, 'nativeGenerationPublished': True, 'readersCutOver': True,
        'readerActorHashes': {name: sha(encoded(actor)) for name, actor in actual.items()},
        'databaseWrites': 0, 'serviceActions': 0, 'recurringGenerationStarted': False, 'freshYPALReaderHandoverQualified': False}


def reader_leaf_context(proof, op, feature_refs=None):
    # Explicitly different authority from the forward CLI. It validates only
    # owned reader/metadata facts; its caller supplies current managed-source,
    # observer, financial and full global ACL authority independently.
    class ReaderLeafContext(proof.Context):
        def scope(self, enabled=None):
            need(enabled is None or enabled is True, 'leaf_requires_the_completed_owned_reader_LOGIN_phase')
            return self.leaf_scope(feature_refs)
        def business_environment(self):
            return super().business_environment(op['binding']['generationPublicInlineEnvironment'])
    value = ReaderLeafContext(op['binding']['inputs']); value.proof = proof
    return value


def validate_reader_leaf(result_sha, source_manifest_sha, feature_refs=None):
    need(all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in (result_sha, source_manifest_sha)),
         'actual_explicit_reader_leaf_result_and_source_manifest_pins_required')
    proof = load_proof(source_manifest_sha); op, publication, prepared = published(proof)
    result = document(BASE / 'result.json', result_sha)
    need(result['format'] == FORMAT and result['completed'] is True and result['readersCutOver'] is True and
         result['operatorSha256'] == op['binding']['operatorSha256'] and result['bootId'] == boot() and
         result['operationSha256'] == sha(public_input(BASE / 'operation.json')) and result['sourceManifestSha256'] == source_manifest_sha and
         result['publicationSha256'] == sha(public_input(PUBLICATION / 'published.json')) and
         not (BASE / 'inverse-intent.json').exists(), 'exact_uninversed_completed_three_reader_leaf_receipt_required')
    c = reader_leaf_context(proof, op, feature_refs)
    # No c96 bootstrap, old standalone-source/API identity, f81 observer or
    # all-chain readiness qualifier is called anywhere in this leaf.
    roles = c.scope(True); c.accepted_source_closure(); current_published(c, publication, prepared)
    need(c.metadata_comparison() == op['binding']['metadataFixedComparison'], 'same_immutable_completed_metadata_data_only_capture_required')
    metadata = c.metadata()
    actors = {name: owned_reader(c, op, name) for name in proof.PEERS}
    need(actors == result['readerActors'] and {name: reader_boot(proof, name) for name in proof.PEERS} == result['readerBootLinks'],
         'all_exact_owned_reader_private_inode_actor_and_boot_facts_required')
    sessions = {name: c.sessions(actor, proof.PEERS[name]['oid']) for name, actor in actors.items()}
    original_inputs(c, op); roles_after = c.scope(True)
    need(roles_after == roles and {name: owned_reader(c, op, name) for name in proof.PEERS} == actors,
         'reader_or_role_facts_changed_during_phase_leaf_capture')
    cache_post = c.cache.BASE / 'sql-committed.json'; login_post = BASE / 'roles-prepared.json'
    return {'format': 'yunipals-ypal-native-reader-phase-leaf-v1', 'validated': True, 'receiptSha256': result_sha,
        'operatorSha256': op['binding']['operatorSha256'], 'sourceManifestSha256': source_manifest_sha,
        'operationSha256': result['operationSha256'], 'publicationSha256': result['publicationSha256'],
        'generationId': result['generationId'], 'sourceRelease': proof.RELEASE, 'readIdentity': proof.IDENTITY,
        'readerActors': actors, 'readerSessions': sessions, 'readerActorHashes': {name: sha(encoded(actor)) for name, actor in actors.items()},
        'roleSlice': roles, 'metadataLeaf': metadata, 'metadataSourceRelease': proof.RELEASE, 'metadataReadIdentity': proof.IDENTITY,
        'recordedRead143AndCache4Catalog': {'file': str(cache_post), 'sha256': sha(public_input(cache_post)), 'jsonPointer': '/postProof/catalog'},
        'recordedRead143Cache4AndTwoLOGINCatalog': {'file': str(login_post), 'sha256': sha(public_input(login_post)), 'jsonPointer': '/after'},
        'recordedAfterLOGINCatalogSha256': sha(encoded(op['binding']['afterLoginCatalog'])),
        'cachePreparedSha256': c.inputs['cachePreparedSha256'], 'nativeGenerationPublished': True, 'readersCutOver': True,
        'sourceActorQualified': False, 'sourceReadinessQualified': False, 'observerAuthorityQualified': False,
        'financialAuthorityQualified': False, 'fullGlobalRoleGraphQualified': False, 'cacheActorQualified': False,
        'originalWholeValidatorsPassed': False, 'recurringGenerationStarted': False,
        'laterGenerationLineageOr24HourRefreshQualified': False, 'databaseWrites': 0, 'serviceActions': 0}


def publication_inverse_state(context):
    if (PUBLICATION / 'published.json').exists():
        _, record, packet = published(context.proof); current_published(context, record, packet)
        return {'published': True, 'publicationSha256': sha(public_input(PUBLICATION / 'published.json')), 'xid': packet['xid']}
    child_terminal(context, 'publish')
    if (PUBLICATION / 'publication-prepared.json').exists():
        packet = document(PUBLICATION / 'publication-prepared.json')
        need(xid_status(context, packet['xid']) == 'aborted', 'unknown_or_committed_publication_requires_explicit_reconcile_before_inverse')
    _, candidate, _, _ = context.generation()
    observed = child(context, 'inspect', {'generationId': candidate['generationId']})
    if (PUBLICATION / 'publication-intent.json').exists():
        need(observed['observation'] == document(PUBLICATION / 'publication-intent.json')['binding']['originalObservation'],
             'actual_aborted_publication_must_leave_original_global_observation_exact')
    else: context.unpublished_candidate()
    return {'published': False, 'global103Unchanged': True, 'observationSha256': observed['observationSha256']}


def bound_context(proof, op, supplied=None):
    value = current_context(proof, op) if supplied is None else supplied
    need(value.inputs == op['binding']['inputs'] and value.manifest == proof.source_manifest(op['binding']['sourceManifestSha256']),
         'any_explicit_later_owner_context_must_bind_the_same_exact_operation_and_source_manifest')
    return value


def inverse_review(proof, context=None):
    op = operation(proof); c = bound_context(proof, op, context)
    need(not (BASE / 'inverse-intent.json').exists(), 'existing_inverse_requires_its_owned_explicit_completion_not_new_review')
    if (BASE / 'roles-intent.json').exists() and not (BASE / 'roles-admitted.json').exists():
        child_terminal(c, 'roles')
        if (BASE / 'roles-prepared.json').exists():
            need(xid_status(c, document(BASE / 'roles-prepared.json')['xid']) == 'aborted', 'owned_LOGIN_COMMIT_unknown_or_committed_reconcile_first')
    source = c.inverse_scope(True); original_inputs(c, op); c.generation_terminal()
    publication = publication_inverse_state(c); units = {}
    for name in proof.PEERS:
        for preview in (False, True):
            unit = proof.preview_unit(name) if preview else proof.PEERS[name]['unit']
            prefix = ('preview-' if preview else 'reader-') + name; started = BASE / (prefix + '-started.json')
            if started.exists() and not (BASE / (prefix + '-stopped.json')).exists():
                if c.state(unit)['MainPID'] == '0':
                    actor, sessions = terminal_owned_reader(c, op, name, preview)
                    units[prefix] = {'terminal': True, 'actor': actor, 'sessions': sessions, 'noStopRequired': True}
                else: units[prefix] = owned_reader(c, op, name, preview)
            elif not preview and not (BASE / ('original-' + name + '-stopped.json')).exists():
                units[prefix] = original_reader(c, op, name)
            elif (BASE / (prefix + '-start-intent.json')).exists() and not started.exists():
                need(False, 'unknown_native_start_ACK_requires_explicit_ownership_reconciliation_before_inverse')
            elif preview and not (BASE / 'runtime-prepared.json').exists():
                continue
            else:
                state = c.state(unit); proof.terminal(state); units[prefix] = {'terminal': True, 'unit': unit}
    value = {'format': FORMAT, 'operationSha256': sha(public_input(BASE / 'operation.json')), 'bootId': boot(),
        'sourceManifestSha256': c.inputs['sourceManifestSha256'], 'inverseSourceScope': source, 'publication': publication,
        'readers': units, 'privateInputs': original_inputs(c, op), 'wholeServingInverseRequired': True,
        'metadataRecoveryBeforeLegacyServing': True, 'unknownEffectMayBeRepeated': False}
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'databaseWrites': 0, 'serviceActions': 0}


def inverse_operation(proof):
    op = operation(proof); saved = document(BASE / 'inverse-intent.json')
    need(saved['binding']['format'] == FORMAT and saved['binding']['bootId'] == boot() and
         saved['binding']['operationSha256'] == sha(public_input(BASE / 'operation.json')) and saved['reviewHash'] == sha(encoded(saved['binding'])),
         'same_exact_owned_coordinated_inverse_intent_required')
    return op, saved


def inverse_disable_boots(context, op):
    for name, entry in op['binding']['readerBootLinks'].items():
        if entry['identity'] is None: continue
        path, parked = Path(entry['path']), BASE / ('original-' + name + '-boot')
        prefix = 'inverse-' + name + '-boot-disable'
        if not (BASE / (prefix + '-intent.json')).exists(): save(prefix + '-intent.json', entry)
        need(document(BASE / (prefix + '-intent.json')) == entry, 'same_owned_inverse_boot_intent_required')
        if os.path.lexists(path):
            need(inode(path, True) == entry['identity'] and not os.path.lexists(parked), 'only_same_owned_reader_boot_can_be_disabled_for_inverse')
            os.rename(path, parked); sync(path.parent); sync(BASE)
        need(inode(parked, True) == entry['identity'] and not os.path.lexists(path), 'same_parked_reader_boot_inode_for_inverse_required')
        if not (BASE / (prefix + '-result.json')).exists(): save(prefix + '-result.json', entry)
    if not (BASE / 'inverse-boots-reload-result.json').exists():
        need(not (BASE / 'inverse-boots-reload-intent.json').exists(), 'unknown_inverse_boot_reload_requires_explicit_reconcile')
        save('inverse-boots-reload-intent.json', {'bootId': boot()}); save('inverse-boots-reload-result.json', manager('daemon-reload'))


def unlink_owned_file(label, path):
    path = Path(path); published_path = BASE / (label + '-published.json')
    if not published_path.exists():
        # Only complete the owned exclusive publication protocol; never adopt a
        # same-hash foreign inode when an ACK was lost between link/unlink.
        need(not os.path.lexists(path), 'unacknowledged_published_file_requires_explicit_inode_reconciliation'); return
    expected = document(published_path); intent = BASE / (label + '-unlink-intent.json')
    if not intent.exists():
        need(inode(path) == expected, 'exact_owned_file_before_inverse_unlink_required'); save(intent.name, {'path': str(path), 'identity': expected})
    need(document(intent) == {'path': str(path), 'identity': expected}, 'same_owned_inverse_unlink_intent_required')
    if os.path.lexists(path):
        need(inode(path) == expected, 'foreign_or_changed_inode_must_never_be_removed'); path.unlink(); sync(path.parent)
    if not (BASE / (label + '-unlinked.json')).exists(): save(label + '-unlinked.json', {'removed': True, 'identity': expected})


def original_loaded(context, op, name):
    old = op['binding']['originalReaders'][name]; state = context.state(context.proof.PEERS[name]['unit'])
    need({path: sha(context.host.m.protected(path)) for path in [state['FragmentPath'], *state['DropInPaths'].split()]} == old['definitions'] and
         all(state[k] == old['unit'][k] for k in ('ExecStart', 'WorkingDirectory', 'User', 'Group', 'EnvironmentFiles', 'KillMode',
             'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload')) and state['Restart'] == old['unit']['Restart'] and
         state['Job'] == '' and state['ControlPID'] == '0', 'original_reader_definition_selector_and_runtime_must_be_restored_before_start')
    original_inputs(context, op); return state


def all_readers_terminal(context, op):
    original_inputs(context, op)
    initial = document(BASE / 'inverse-intent.json')
    never_published = initial['binding']['publication']['published'] is False
    for name in context.proof.PEERS:
        state = context.state(context.proof.PEERS[name]['unit'])
        if never_published and not (BASE / ('original-' + name + '-stopped.json')).exists():
            original_reader(context, op, name)
        else: context.proof.terminal(state)
        for prefix, preview in [('reader-', False), ('original-', False), ('preview-', True)]:
            path = BASE / (prefix + name + '-stopped.json')
            if path.exists():
                stopped = document(path)
                # After preview definition removal, its last owned stop and
                # empty cgroup remain enough; no process can be implicitly run.
                if preview:
                    group = Path('/sys/fs/cgroup/system.slice') / context.proof.preview_unit(name) / 'cgroup.procs'
                    need(not group.exists() or not group.read_text().split(), 'owned_preview_cgroup_must_remain_empty')
                    for actor in stopped['actor']['processes']:
                        try: now = context.proof.process(actor['pid'])
                        except (FileNotFoundError, ProcessLookupError): continue
                        need(now['startTicks'] != actor['startTicks'], 'owned_preview_process_still_alive')
                else: context.drained(name, stopped['actor'], stopped['sessions'])
    return True


def inverse_role_bits(context, op):
    if not (BASE / 'roles-admitted.json').exists() or (BASE / 'roles-restored.json').exists():
        need(context.logins_enabled() is False, 'same_owned_reader_LOGIN_inverse_required'); return
    context.inverse_scope(True)
    need(not (BASE / 'roles-inverse-intent.json').exists(), 'unknown_reader_LOGIN_inverse_requires_XID_reconciliation')
    before = op['binding']['afterLoginCatalog']; after = op['binding']['beforeLoginCatalog']
    save('roles-inverse-intent.json', {'format': 'yunipals-ypal-native-reader-LOGIN-inverse-v1', 'bootId': boot(),
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'admissionSha256': sha(public_input(BASE / 'roles-admitted.json')),
        'inverseIntentSha256': sha(public_input(BASE / 'inverse-intent.json'))})
    def prepared(value):
        need(value['mode'] == 'roles-inverse' and value['before'] == before and value['after'] == after, 'exact_two_owned_LOGIN_inverse_bits_required')
        all_readers_terminal(context, op); context.inverse_scope(True); save('roles-inverse-prepared.json', value); return True
    result = child(context, 'roles-inverse', {'mode': 'roles-inverse', 'before': before, 'after': after, 'catalogSql': context.host.catalog_sql}, prepared)
    need(result['committed'] is True and result['after'] == after and context.catalog() == after, 'actual_owned_LOGIN_inverse_COMMIT_ACK_required')
    return inverse_role_ack(context, op, result['xid'])


def inverse_role_ack(context, op, xid, reconciled=False):
    ack = document(BASE / 'roles-admitted.json')
    save('roles-restored.json', {'format': 'yunipals-ypal-native-reader-LOGIN-inverse-v1', 'restored': True,
        'operatorSha256': op['binding']['operatorSha256'], 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
        'admissionSha256': sha(public_input(BASE / 'roles-admitted.json')), 'intentSha256': sha(public_input(BASE / 'roles-inverse-intent.json')),
        'preparedSha256': sha(public_input(BASE / 'roles-inverse-prepared.json')), 'xid': xid,
        'beforeCatalogSha256': ack['afterCatalogSha256'], 'afterCatalogSha256': sha(encoded(op['binding']['beforeLoginCatalog'])),
        'reconciled': reconciled, 'collectorLOGINChanged': False})
    context.inverse_scope(True)


def inverse_cache_catalog(context, op):
    path = BASE / 'cache-inverse-catalog.json'
    if path.exists():
        context.inverse_scope(False); return document(path)
    context.inverse_scope(True); all_readers_terminal(context, op); context.cache.stopped(context.host)
    need(not (BASE / 'cache-inverse-intent.json').exists(), 'unknown_cache_catalog_inverse_requires_explicit_XID_reconcile')
    committed = context.sql_ack
    save('cache-inverse-intent.json', {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
        'cacheCommitSha256': sha(public_input(context.cache.BASE / 'sql-committed.json')), 'inverseIntentSha256': sha(public_input(BASE / 'inverse-intent.json'))})
    def prepared(value):
        need(value['mode'] == 'inverse' and value['planSha256'] == sha(committed['resultJson'].encode()) and
             context.host.read.acl_catalog(value['postProof']['catalog']) == context.host.read.acl_catalog(context.host.read_rehearsal['after']),
             'inverse_must_restore_exact_full_143_graph_with_all_foreign_and_column_ACLs')
        context.inverse_scope(True); all_readers_terminal(context, op); context.cache.stopped(context.host)
        save('cache-inverse-prepared.json', value)
    result = context.cache.sql_child(context.host, 'inverse', committed['result'], prepared, plan_json=committed['resultJson'])
    return inverse_cache_ack(context, op, result, False)


def inverse_cache_ack(context, op, result, reconciled):
    context.inverse_scope(False); context.cache.stopped(context.host)
    value = {'format': 'yunipals-ypal-native-cutover-cache-inverse-v1', 'restored': True, 'bootId': boot(),
        'operatorSha256': op['binding']['operatorSha256'], 'operationSha256': sha(public_input(BASE / 'operation.json')),
        'inverseIntentSha256': sha(public_input(BASE / 'inverse-intent.json')), 'intentSha256': sha(public_input(BASE / 'cache-inverse-intent.json')),
        'preparedSha256': sha(public_input(BASE / 'cache-inverse-prepared.json')), 'cachePreparedSha256': context.inputs['cachePreparedSha256'],
        'cacheOriginalProducerSha256': context.proof.CACHE_SHA, 'generationCandidateSha256': context.prepared['config']['generationSha256'],
        'readAdmissionSha256': context.prepared['config']['readAdmissionSha256'], 'result': result, 'reconciled': reconciled,
        'cacheInactive': True, 'cacheBootDisabled': True, 'fourOwnedReadsRemoved': True,
        'frozenCacheOwnerInverseReceiptFabricated': False, 'legacyWorkerMayStartBeforeCapsuleRestore': False}
    save('cache-inverse-catalog.json', value); return value


def inverse_global(context, op, initial):
    if (BASE / 'inverse-global-restored.json').exists(): return document(BASE / 'inverse-global-restored.json')
    context.inverse_scope(False); all_readers_terminal(context, op); context.cache.stopped(context.host); context.generation_terminal()
    _, candidate, _, capsule = context.generation()
    if not initial['binding']['publication']['published']:
        context.unpublished_candidate()
        value = {'format': FORMAT, 'globalRestored': True, 'publicationNeverCommitted': True,
            'currentGeneration': capsule['currentGeneration'], 'previousGeneration': capsule['previousGeneration'],
            'ownedGenerationRetained': candidate['generationId'], 'capsuleSQLPerformed': False}
    else:
        _, record, packet = published(context.proof)
        need(not (BASE / 'capsule-inverse-intent.json').exists(), 'unknown_capsule_inverse_requires_own_XID_reconcile_not_restore_retry')
        current_published(context, record, packet)
        save('capsule-inverse-intent.json', {'format': FORMAT, 'bootId': boot(), 'publicationSha256': sha(public_input(PUBLICATION / 'published.json')),
            'capsuleResultSha256': candidate['capsuleResultSha256'], 'cacheInverseSha256': sha(public_input(BASE / 'cache-inverse-catalog.json')),
            'inverseIntentSha256': sha(public_input(BASE / 'inverse-intent.json'))})
        def prepared(message):
            context.inverse_scope(False); all_readers_terminal(context, op); context.cache.stopped(context.host); context.generation_terminal()
            save('capsule-inverse-prepared.json', message); return True
        result = child(context, 'capsule-inverse', {'capsule': capsule, 'ownedGenerationId': candidate['generationId'],
            'externalBinding': capsule['externalBinding'], 'ownedDerivedObservation': record['result']['ownedDerivedObservation']}, prepared)
        need(result['restored'] is True and result['allDerivedIdentityColumnsRestored'] is True and
             result['ownedGenerationRetained'] == candidate['generationId'], 'actual_capsule_inverse_COMMIT_ack_required')
        value = {'format': FORMAT, 'globalRestored': True, 'publicationNeverCommitted': False, 'capsuleSQLPerformed': True,
            'currentGeneration': result['currentGeneration'], 'previousGeneration': result['previousGeneration'],
            'ownedGenerationRetained': result['ownedGenerationRetained'], 'result': result,
            'intentSha256': sha(public_input(BASE / 'capsule-inverse-intent.json')), 'preparedSha256': sha(public_input(BASE / 'capsule-inverse-prepared.json'))}
    need(value['currentGeneration'] == '103', 'exact_original103_global_context_required_before_metadata_recovery')
    save('inverse-global-restored.json', value); return value


def validate_metadata_restored(context):
    owner, h, operation = context.metadata_inverse_context()
    result = document(owner.BASE / 'inverse-result.json')
    need(result['restored'] is True and result['journalOrProvenanceRowsDeleted'] == 0 and result['sourceSelectionChanged'] is False and
         result['readGrantsChanged'] is False and not os.path.lexists(owner.DROP) and owner.link(owner.BOOT) == operation['oldBoot'],
         'actual_metadata_RPC_recovery_and_original_boot_before_legacy_serving_required')
    old, _ = h.m.snapshot(owner.UNIT)
    need(old == result['oldWriter'] and old['definitions'] == operation['oldWriter']['definitions'] and
         old['environmentFileHashes'] == operation['oldWriter']['environmentFileHashes'] and
         old['configuredEnvironmentSha256'] == operation['oldWriter']['configuredEnvironmentSha256'], 'same_acknowledged_restored_metadata_writer_and_private_inputs_required')
    db = h.database(); scan = db['scan']; start = document(owner.BASE / 'old-start-intent.json')
    frozen = start['scan']
    fixed = lambda row: {k: v for k, v in owner.stable_scan(row).items() if k not in {'next_block', 'target_block', 'target_hash', 'last_scanned_hash'}}
    need(scan['ingestion_mode'] == frozen['ingestion_mode'] == 'rpc' and fixed(scan) == fixed(frozen) and int(scan['next_block']) >= int(frozen['next_block']) and
         start['bootId'] == boot() and int(owner.state(h.m)['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'],
         'restored_metadata_may_advance_only_under_its_owned_original_start')
    approval = db['approval']
    need(approval and approval['read_identity'] == h.meta.IDENTITY and approval['state'] == 'blocked' and approval['error_code'] == 'owned_metadata_inverse',
         'actual_owned_metadata_inverse_approval_block_required')
    h.refresh(); need(h.m.snapshot(owner.UNIT)[0] == old, 'restored_metadata_actor_changed_during_inverse_acceptance')
    return {'format': 'yunipals-ypal-native-cutover-metadata-inverse-v1', 'metadataProducerSha256': context.cache.META_OWNER_SHA,
        'metadataOperationSha256': context.generation()[1]['metadataOperationSha256'],
        'metadataInverseSha256': sha(public_input(owner.BASE / 'inverse-result.json')), 'oldWriterSha256': sha(encoded(old)),
        'actualRPCModeAndOwnedOriginalWriter': True, 'monotonicCursorPreserved': True, 'originalSourceReadinessClaimed': False}


def recover_metadata(context, op):
    need((BASE / 'inverse-global-restored.json').exists(), 'capsule103_global_restore_must_precede_metadata_recovery')
    if (BASE / 'metadata-restored.json').exists():
        current = validate_metadata_restored(context)
        need(document(BASE / 'metadata-restored.json') == current, 'same_owned_already_restored_advancing_metadata_context_required')
        return current
    context.inverse_scope(False); context.cache.stopped(context.host); all_readers_terminal(context, op)
    owner, h, metadata_op = context.metadata_inverse_context()
    if not (BASE / 'metadata-inverse-intent.json').exists():
        selection = document(context.cache.META / 'selected.json', context.prepared['config']['metadataSelectionSha256'])
        if not (owner.BASE / 'inverse-result.json').exists():
            native = h.actor(metadata_op, True, pristine=False)
            if native != selection['nativeActor']:
                start = document(owner.BASE / 'native-start-intent.json')
                need(int(native['unit']['NRestarts']) > 0 and start['bootId'] == boot() and
                     int(native['unit']['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'] and
                     not any(owner.identity_alive(h.m, p) for p in selection['nativeActor']['processes']),
                     'only_exact_owned_auto_restarted_metadata_may_replace_selected_actor_for_inverse')
            h.private(metadata_op['oldWriter'])
        save('metadata-inverse-intent.json', {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
            'metadataOperationSha256': context.generation()[1]['metadataOperationSha256'],
            'metadataProducerSha256': context.cache.META_OWNER_SHA, 'cacheInverseSha256': sha(public_input(BASE / 'cache-inverse-catalog.json')),
            'globalInverseSha256': sha(public_input(BASE / 'inverse-global-restored.json')), 'newExplicitInverseContext': True})
    intent = document(BASE / 'metadata-inverse-intent.json')
    need(intent['bootId'] == boot() and intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
         intent['metadataOperationSha256'] == context.generation()[1]['metadataOperationSha256'] and
         intent['metadataProducerSha256'] == context.cache.META_OWNER_SHA and
         intent['globalInverseSha256'] == sha(public_input(BASE / 'inverse-global-restored.json')), 'same_metadata_inverse_delegation_intent_required')
    with owner.lock():
        if not (owner.BASE / 'inverse-result.json').exists():
            # Unchanged772 leaves retain their SQL/session/actor/boot CAS and
            # unknown-ACK handling. Only this context's admission proof is new.
            owner.inverse(h, metadata_op, finish=(owner.BASE / 'inverse-intent.json').exists())
        actual = validate_metadata_restored(context)
    if not (BASE / 'metadata-restored.json').exists(): save('metadata-restored.json', actual)
    else: need(document(BASE / 'metadata-restored.json') == actual, 'same_acknowledged_metadata_recovery_required')
    return actual


def restored_reader(context, op, name):
    value = context.reader(name); old = op['binding']['originalReaders'][name]
    need(value['definitions'] == old['definitions'] and value['privateInputHashes'] == old['privateInputHashes'] and
         all(value[k] == old[k] for k in ('inlineEnvironmentSha256', 'effectiveEnvironmentSha256', 'argv', 'argvSha256')) and
         all(value['unit'][k] == old['unit'][k] for k in ('User', 'Group', 'WorkingDirectory', 'ExecStart', 'EnvironmentFiles', 'Restart', 'KillMode')),
         'exact_original_reader_definition_private_inputs_environment_and_command_required')
    original_main = next(p for p in old['processes'] if p['pid'] == old['main']['pid'])
    current_main = next(p for p in value['processes'] if p['pid'] == value['main']['pid'])
    fields = ('uid', 'gid', 'groups', 'capabilities', 'noNewPrivileges', 'commandSha256', 'executable')
    need(all(current_main[k] == original_main[k] for k in fields), 'same_original_reader_privileges_and_executable_required')
    signatures = [{k: p[k] for k in fields} for p in old['processes'] if p['pid'] != old['main']['pid']]
    for actor in value['processes']:
        if actor['pid'] != value['main']['pid']:
            need(actor['parentPid'] == value['main']['pid'] and {k: actor[k] for k in fields} in signatures,
                 'only_the_original_known_reader_compiler_child_may_be_restored')
    return value


def restore_legacy_readers(context, op):
    validate_metadata_restored(context); context.inverse_scope(False)
    actors = {}
    for name in context.proof.PEERS:
        old = op['binding']['originalReaders'][name]; state = original_loaded(context, op, name)
        path = BASE / ('legacy-' + name + '-start-intent.json')
        if state['MainPID'] == '0':
            need(not path.exists(), 'unknown_old_reader_start_cannot_be_repeated')
            context.proof.terminal(state)
            context.inverse_scope(False); validate_metadata_restored(context)
            save(path.name, {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
                'before': state, 'minimumStartTicks': time.monotonic_ns() * os.sysconf('SC_CLK_TCK') // 1000000000})
            need(original_loaded(context, op, name) == state, 'old_reader_changed_after_fsynced_restore_start_intent')
            manager('start', context.proof.PEERS[name]['unit'])
        actual = restored_reader(context, op, name)
        if path.exists():
            intent = document(path)
            need(intent['bootId'] == boot() and intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
                 actual['main']['startTicks'] >= intent['minimumStartTicks'] and actual['unit']['InvocationID'] != intent['before']['InvocationID'] and
                 actual['unit']['NRestarts'] == '0', 'actual_owned_original_reader_resume_after_its_start_intent_required')
        else: need(actual['main'] == old['main'] and actual['unit']['InvocationID'] == old['unit']['InvocationID'], 'only_same_never_stopped_original_reader_may_be_retained')
        ack = BASE / ('legacy-' + name + '-restored.json')
        if ack.exists():
            saved = document(ack); need(saved['actor']['main'] == actual['main'] and saved['actor']['unit']['InvocationID'] == actual['unit']['InvocationID'],
                                      'same_owned_restored_legacy_reader_invocation_required')
        else: save(ack.name, {'format': FORMAT, 'bootId': boot(), 'actor': actual, 'sameOldPIDClaimed': False, 'originalPrivateInputsPreserved': True})
        actors[name] = actual
    restore_reader_boots(context, op, True)
    return actors


def legacy_serving(context, op):
    # These are the exact accepted prepublication legacy103 routes and direct
    # fallback semantics; no native release header is inferred from them.
    proof = context.cache.legacy_http(context.host, False)
    old = context.proof.module('consumer-operational-preview-v6.py', context.proof.DEPENDENCIES['consumer-operational-preview-v6.py'])
    deadline = time.monotonic() + 90; requests = []
    _, sample = request_http(9011, '/v1/tokens?chain=base&limit=24&metadata=all&sort=token-id-asc', deadline)
    candidates = []
    for row in sample.get('items', []):
        attributes = row.get('attributes')
        for attribute in attributes if isinstance(attributes, list) else []:
            if attribute.get('trait_type') == 'Color' and isinstance(attribute.get('value'), str):
                candidates.append((row.get('owner'), attribute['value']))
    candidates = [(address.lower(), color) for address, color in candidates if isinstance(address, str) and
                  re.fullmatch('0x[0-9a-fA-F]{40}', address) and address != '0x' + '0' * 40 and 1 <= len(color) <= 80]
    need(candidates, 'actual_restored_legacy_owner_Color_fixture_required')
    address, color = candidates[0]
    # Raw retained native ownership is only a bounded fixture selector here.
    # The actual legacy HTTP response, not a source-ready assertion, qualifies it.
    fixtures = context.query("SELECT jsonb_build_object('alias',(SELECT alias FROM metadata_source.lookup_alias WHERE namespace='legacy-meta'AND alias~'^[0-9]{1,78}$'LIMIT 1),'ens',(SELECT e.name FROM metadata.ens_identity e JOIN " + context.proof.PHYSICAL + ".token t ON t.owner=e.address AND t.collection='ethereum'AND NOT t.burned WHERE e.verified AND e.chain_id=1 AND e.name~'^[a-z0-9.-]{1,255}$'LIMIT 1))")
    need(isinstance(fixtures['alias'], str) and re.fullmatch('[0-9]{1,78}', fixtures['alias']) and isinstance(fixtures['ens'], str) and
         re.fullmatch('[a-z0-9.-]{1,255}', fixtures['ens']), 'actual_restored_legacy_alias_and_verified_ENS_fixture_required')
    routes = [('main', '/v1/traits?chain=base'), ('main', '/v1/leaderboards/total-rarity?chain=base&limit=1'),
        ('main', '/v1/tokens?chain=solana&limit=1&metadata=all'), ('main', '/legacy-meta/meta?id=' + fixtures['alias']),
        ('main', '/v1/owners/' + fixtures['ens'] + '/tokens?chain=ethereum&limit=1'),
        ('collector', '/ready?chain=base'), ('collector', '/v2/owners/' + address + '/tokens?chain=base&limit=1'),
        ('collector', '/v2/owners/' + address + '/tokens?chain=base&limit=1&' + urllib.parse.urlencode({'t.Color': color})),
        ('islands', '/ready'), ('islands', '/v2/collections/base-islands-v2/tokens?limit=1'),
        ('islands', '/v2/collections/ethereum-islands/staking-status')]
    for name, path in routes:
        item, value = request_http(context.proof.PEERS[name]['port'], path, deadline)
        need(old.positive(name, path, item, value, None, address if name == 'collector' else None), 'all_retained_legacy_features_must_serve_before_inverse_acceptance')
        requests.append({**item, 'service': name, 'routeNumber': len(requests), 'positiveShape': True})
    item, indexer = request_http(9011, '/v1/indexer/status', deadline)
    need(item['status'] == 200 and indexer.get('solana', {}).get('available') is True and indexer['solana'].get('enabled') is True,
         'retained_Solana_ledger_status_must_remain_available')
    actors = {name: restored_reader(context, op, name) for name in context.proof.PEERS}
    validate_metadata_restored(context); context.inverse_scope(False)
    return {'legacy103HTTP': proof, 'readerActors': actors, 'realServingAccepted': True, 'allRetainedFeatureGETs': requests,
        'solanaLedgerAvailable': True, 'evmDiagnosticAvailableAtCapture': indexer.get('evm', {}).get('available') is True,
        'combinedSourceRollbackPerformed': False, 'nativeDiagnosticReadinessClaimed': False}


def cache_finish_module(context):
    return context.proof.module('ypal-cache-finish-v2.py', context.manifest['files']['ypal-cache-finish-v2.py'])


def inverse(proof, expected=None, finish=False, context=None):
    if finish:
        op, initial = inverse_operation(proof)
        need(expected == initial['reviewHash'], 'same_explicit_inverse_review_hash_required_for_completion')
    else:
        initial = inverse_review(proof, context); need(initial['reviewHash'] == expected, 'exact_fresh_three_reader_inverse_review_required')
        save('inverse-intent.json', initial); op = operation(proof)
    c = bound_context(proof, op, context)
    if not (BASE / 'inverse-global-restored.json').exists():
        c.inverse_scope(not (BASE / 'cache-inverse-catalog.json').exists())
        inverse_disable_boots(c, op)
        cache_finish_module(c).drain_for_inverse(c)
        for name in proof.PEERS:
            for preview in (True, False):
                prefix = ('preview-' if preview else 'reader-') + name
                if (BASE / (prefix + '-started.json')).exists() and not (BASE / (prefix + '-stopped.json')).exists():
                    stop_reader(c, op, name, preview, reconcile=(BASE / (prefix + '-stop-intent.json')).exists())
            if initial['binding']['publication']['published'] and not (BASE / ('original-' + name + '-stopped.json')).exists():
                stop_reader(c, op, name, original=True, reconcile=(BASE / ('original-' + name + '-stop-intent.json')).exists())
            for preview in (True, False):
                for label, path, spec in descriptor_files(op, name, preview):
                    if path.endswith('.conf') or path.endswith('.service'): unlink_owned_file(label, path)
        if not (BASE / 'inverse-reader-load-result.json').exists():
            need(not (BASE / 'inverse-reader-load-intent.json').exists(), 'unknown_original_definition_reload_requires_explicit_reconcile')
            save('inverse-reader-load-intent.json', {'bootId': boot()}); manager('daemon-reload')
            for name in proof.PEERS: original_loaded(c, op, name)
            save('inverse-reader-load-result.json', {'allOriginalDefinitionsLoaded': True})
        all_readers_terminal(c, op)
        inverse_role_bits(c, op); inverse_cache_catalog(c, op); inverse_global(c, op, initial)
    recover_metadata(c, op)
    restore_legacy_readers(c, op)
    # Imported immutable code owns only the cache service and its exact inodes;
    # it cannot start generation or source processes.
    primitives = types.SimpleNamespace(BASE=BASE, save=save, document=document, public_input=public_input)
    cache_finish_module(c).restore_old(c, primitives, op)
    serving = legacy_serving(c, op)
    for name in proof.PEERS:
        for preview in (True, False):
            for label, path, spec in descriptor_files(op, name, preview):
                if not path.endswith(('.conf', '.service')): unlink_owned_file(label, path)
    value = {'format': FORMAT, 'restored': True, 'bootId': boot(), 'operatorSha256': op['binding']['operatorSha256'],
        'operationSha256': sha(public_input(BASE / 'operation.json')), 'inverseIntentSha256': sha(public_input(BASE / 'inverse-intent.json')),
        'globalInverseSha256': sha(public_input(BASE / 'inverse-global-restored.json')), 'metadataInverseSha256': sha(public_input(BASE / 'metadata-restored.json')),
        'cacheInverseSha256': sha(public_input(BASE / 'cache-inverse-catalog.json')), 'serving': serving, 'globalGeneration': '103',
        'allOwnedCacheFourReadsAndTwoLOGINChangesReversed': True, 'originalPIDReturnedClaimed': False, 'fullLegacyServingAccepted': True,
        'recurringGenerationKeptStoppedUntilSupervisedLineagePolicy': True, 'sourceActions': 0, 'financialActions': 0,
        'frozenPriorAcknowledgementsRewritten': False}
    pin = save('inverse-result.json', value)
    return {'format': FORMAT, 'restored': True, 'receiptSha256': pin, 'fullLegacyServingAccepted': True, 'globalGeneration': '103'}


def reconcile_inverse(proof, phase, intent_sha):
    op, initial = inverse_operation(proof); c = current_context(proof, op)
    need(phase in {'roles', 'cache', 'capsule'}, 'one_fixed_inverse_SQL_boundary_required')
    name = {'roles': 'roles-inverse', 'cache': 'cache-inverse', 'capsule': 'capsule-inverse'}[phase]
    intent = document(BASE / (name + '-intent.json'), intent_sha)
    need(intent['bootId'] == boot() and intent['inverseIntentSha256'] == sha(public_input(BASE / 'inverse-intent.json')), 'same_owned_inverse_SQL_intent_chain_required')
    if phase == 'cache':
        c.cache.child_gone(c.host, 'inverse-sql-child.json')
    else: child_terminal(c, 'roles-inverse' if phase == 'roles' else 'capsule-inverse')
    packet = document(BASE / (name + '-prepared.json'))
    need(xid_status(c, packet['xid']) == 'committed', 'inverse_SQL_COMMIT_not_proven_no_reexecution_allowed')
    original_inputs(c, op); all_readers_terminal(c, op)
    if phase == 'roles':
        need(intent['format'] == 'yunipals-ypal-native-reader-LOGIN-inverse-v1' and
             intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
             intent['admissionSha256'] == sha(public_input(BASE / 'roles-admitted.json')) and
             packet['mode'] == 'roles-inverse' and packet['before'] == op['binding']['afterLoginCatalog'] and
             packet['after'] == op['binding']['beforeLoginCatalog'] and c.catalog() == packet['after'], 'exact_owned_two_LOGIN_inverse_postcatalog_required')
        need(not (BASE / 'roles-restored.json').exists(), 'reader_LOGIN_inverse_already_acknowledged')
        inverse_role_ack(c, op, packet['xid'], True)
    elif phase == 'cache':
        need(intent['format'] == FORMAT and intent['operationSha256'] == sha(public_input(BASE / 'operation.json')) and
             intent['cacheCommitSha256'] == sha(public_input(c.cache.BASE / 'sql-committed.json')) and packet['mode'] == 'inverse' and
             packet['planSha256'] == sha(c.sql_ack['resultJson'].encode()), 'exact_owned_cache_inverse_plan_XID_required')
        now = c.cache.sql_child(c.host, 'inspect')
        need(now['catalogSha256'] == packet['afterCatalogSha256'] and
             c.host.read.acl_catalog(now['postProof']['catalog']) == c.host.read.acl_catalog(packet['postProof']['catalog']),
             'actual_complete_cache_inverse_graph_and_catalog_postcondition_required')
        need(not (BASE / 'cache-inverse-catalog.json').exists(), 'cache_inverse_already_acknowledged')
        inverse_cache_ack(c, op, {'mode': 'inverse', 'xid': packet['xid'], 'acknowledged': False, 'current': now, 'reconciledFromOwnCommittedXID': True}, True)
    else:
        _, candidate, _, capsule = c.generation()
        need(intent['format'] == FORMAT and intent['publicationSha256'] == sha(public_input(PUBLICATION / 'published.json')) and
             intent['capsuleResultSha256'] == candidate['capsuleResultSha256'] and intent['cacheInverseSha256'] == sha(public_input(BASE / 'cache-inverse-catalog.json')) and
             packet['format'] == 'yunipals-ypal-native-publication-protocol-v1' and packet['event'] == 'capsule-prepared',
             'same_owned_capsule_inverse_and_prepared_XID_required')
        c.inverse_scope(False); c.cache.stopped(c.host); c.generation_terminal()
        now = child(c, 'capsule-inspect', {})['observation']
        need(now == candidate['originalGlobalObservation'] and now == packet['result'], 'actual_original_pointer_wallets_stamps_and_generation_binding_required')
        value = {'format': FORMAT, 'globalRestored': True, 'publicationNeverCommitted': False, 'capsuleSQLPerformed': True,
            'currentGeneration': capsule['currentGeneration'], 'previousGeneration': capsule['previousGeneration'],
            'ownedGenerationRetained': candidate['generationId'], 'reconciledFromOwnCommittedXID': True, 'xid': packet['xid'],
            'originalSQLACKPresent': False, 'intentSha256': intent_sha, 'preparedSha256': sha(public_input(BASE / 'capsule-inverse-prepared.json'))}
        need(not (BASE / 'inverse-global-restored.json').exists(), 'capsule_inverse_already_acknowledged')
        save('inverse-global-restored.json', value)
    return {'format': FORMAT, 'inverseSQLReconciled': True, 'phase': phase, 'databaseWrites': 0, 'serviceActions': 0}


def archive_publication_review(proof):
    op = operation(proof); c = current_context(proof, op)
    need(PUBLICATION.is_dir() and not (BASE / 'inverse-intent.json').exists() and not (PUBLICATION / 'published.json').exists() and
         not any(BASE.glob('*-start-intent.json')) and not any(BASE.glob('*-stop-intent.json')), 'only_unstarted_aborted_publication_may_be_archived')
    state = publication_inverse_state(c); need(state['published'] is False, 'publication_COMMIT_must_be_proven_absent')
    prepublication(c, op); c.cache.legacy_http(c.host, True)
    files = {}
    for path in PUBLICATION.iterdir():
        need(path.name.endswith('.json'), 'only_known_private_publication_journals_may_be_archived')
        files[path.name] = inode(path)
    info = PUBLICATION.lstat(); need(stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == info.st_gid == 0, 'owned_private_publication_directory_required')
    count = sum(p.is_dir() for p in BASE.glob('publication-aborted-*')) + 1
    need(count <= 8, 'bounded_aborted_publication_archive_count_exceeded')
    target = BASE / ('publication-aborted-' + str(count))
    need(not os.path.lexists(target) and target.parent.stat().st_dev == info.st_dev, 'fresh_same_filesystem_publication_archive_required')
    binding = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')),
        'sourceDirectory': {'dev': info.st_dev, 'ino': info.st_ino, 'mode': info.st_mode}, 'files': files,
        'target': str(target), 'globalState': state, 'readerActors': original_readers(c, op), 'sourceScope': c.scope(True)}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'serviceActions': 0}


def archive_publication(proof, expected):
    reviewed = archive_publication_review(proof); need(reviewed['reviewHash'] == expected, 'exact_fresh_aborted_publication_archive_review_required')
    b = reviewed['binding']; name = Path(b['target']).name
    save(name + '-intent.json', reviewed)
    need(archive_publication_review(proof)['reviewHash'] == expected, 'publication_or_source_changed_after_archive_intent')
    libc = ctypes.CDLL(None, use_errno=True)
    result = libc.renameat2(-100, os.fsencode(PUBLICATION), -100, os.fsencode(b['target']), 1)
    need(result == 0, 'exclusive_publication_archive_rename_refused_no_implicit_retry'); sync(BASE)
    after = Path(b['target']).lstat()
    need((after.st_dev, after.st_ino, after.st_mode) == tuple(b['sourceDirectory'][k] for k in ('dev', 'ino', 'mode')) and
         {p.name: inode(p) for p in Path(b['target']).iterdir()} == b['files'], 'archive_must_preserve_all_private_bytes_and_inodes')
    save(name + '-result.json', {'archived': True, 'reviewHash': expected, 'sameBytesAndInodes': True, 'automaticRetry': False})
    return {'format': FORMAT, 'archived': True, 'automaticRetry': False, 'databaseWrites': 0, 'serviceActions': 0}


RELOAD_PHASES = ('runtime', 'boots-disabled', 'reader-main', 'reader-collector', 'reader-islands', 'reader-boots-restored',
    'inverse-boots', 'inverse-reader-load', 'inverse-reader-boots-restored', 'cache-old-load', 'cache-old-enable',
    'metadata-disable', 'metadata-drop', 'metadata-enable')


def reload_target(proof, phase, supplied=None):
    """Only configuration reload, never a SQL/start/stop retry.

    Actual files/inodes and actors are qualified before an explicit new reload
    intent; an already loaded postcondition can instead be acknowledged read-only.
    """
    need(phase in RELOAD_PHASES, 'one_fixed_configuration_recovery_phase_required')
    op = operation(proof); c = bound_context(proof, op, supplied); original_inputs(c, op)
    c.inverse_scope(not (BASE / 'cache-inverse-catalog.json').exists())
    metadata = None; final_check = None
    if phase == 'runtime':
        original_readers(c, op)
        for name in proof.PEERS:
            verify_descriptor_files(op, name, True)
            for label, path, spec in descriptor_files(op, name):
                if not path.endswith('.conf'): need(inode(path) == document(BASE / (label + '-published.json')), 'same_owned_runtime_overlay_before_reload')
        final_check = lambda: [c.loaded_descriptor(reader_descriptor(op, name, True)) for name in proof.PEERS]
        label = 'runtime-reload'
    elif phase in {'boots-disabled', 'inverse-boots', 'reader-boots-restored', 'inverse-reader-boots-restored'}:
        enabled = phase.endswith('restored')
        for name, entry in op['binding']['readerBootLinks'].items():
            if entry['identity'] is None: continue
            need(inode(entry['path'], True) == entry['identity'] if enabled else
                 (not os.path.lexists(entry['path']) and inode(BASE / ('original-' + name + '-boot'), True) == entry['identity']),
                 'same_owned_reader_activation_inode_before_reload_recovery')
        def loaded_boots():
            for name, entry in op['binding']['readerBootLinks'].items():
                state = c.state(proof.PEERS[name]['unit'])
                need(state['Job'] == '' and state['ControlPID'] == '0' and state['UnitFileState'] ==
                     ('enabled' if enabled and entry['identity'] is not None else 'disabled' if entry['identity'] is not None else op['binding']['originalReaders'][name]['unit']['UnitFileState']) and
                     state['WantedBy'] == ('multi-user.target' if enabled and entry['identity'] is not None else ''),
                     'actual_reader_activation_configuration_must_be_loaded')
        final_check = loaded_boots
        label = {'boots-disabled': 'boots-disabled-reload', 'inverse-boots': 'inverse-boots-reload',
                 'reader-boots-restored': 'reader-boots-restored-reload', 'inverse-reader-boots-restored': 'inverse-reader-boots-restored-reload'}[phase]
    elif phase in {'reader-main', 'reader-collector', 'reader-islands'}:
        name = phase.removeprefix('reader-'); verify_descriptor_files(op, name)
        old_stop = document(BASE / ('original-' + name + '-stopped.json'))
        state = c.state(proof.PEERS[name]['unit'])
        if state['MainPID'] == '0': c.drained(name, old_stop['actor'], old_stop['sessions'])
        else: owned_reader(c, op, name)
        final_check = lambda: c.loaded_descriptor(reader_descriptor(op, name)); label = phase + '-reload'
    elif phase == 'inverse-reader-load':
        inverse_operation(proof)
        for name in proof.PEERS:
            drop = next(path for _, path, _ in descriptor_files(op, name) if path.endswith('.conf'))
            need(not os.path.lexists(drop), 'all_owned_native_reader_drops_must_be_removed_before_inverse_reload')
        final_check = lambda: [original_loaded(c, op, name) for name in proof.PEERS]; label = 'inverse-reader-load'
    elif phase.startswith('metadata-'):
        inverse_operation(proof); owner, h, metadata_op = c.metadata_inverse_context(); h.private(metadata_op['oldWriter']); h.refresh()
        mapping = {'metadata-disable': ('inverse-disable-reload', os.path.lexists(owner.DROP), False),
                   'metadata-drop': ('inverse-drop-reload', False, False), 'metadata-enable': ('inverse-enable-reload', False, True)}
        original, native, enabled = mapping[phase]
        need((owner.BASE / (original + '-intent.json')).exists(), 'actual_owned_metadata_reload_intent_required')
        if native:
            need(owner.file_identity(owner.DROP) == document(owner.BASE / 'native-drop-created.json') and
                 sha(public_input(owner.DROP)) == metadata_op['candidateDropSha256'], 'same_owned_metadata_overlay_before_reload')
        else: need(not os.path.lexists(owner.DROP), 'native_metadata_overlay_must_be_absent_before_old_reload')
        need(owner.link(owner.BOOT if enabled else owner.BASE / 'original-boot-link') == metadata_op['oldBoot'], 'same_metadata_boot_inode_before_reload')
        need(owner.state(h.m)['Job'] == '' and owner.state(h.m)['ControlPID'] == '0', 'no_metadata_manager_job_before_reload_recovery')
        def metadata_loaded(): need(owner.loaded(h, metadata_op, native, enabled), 'actual_metadata_inverse_configuration_must_be_loaded')
        final_check = metadata_loaded; metadata = (owner, h); label = phase + '-configuration'
    else:
        inverse_operation(proof); c.host.private()
        need(not os.path.lexists(c.cache.DROP), 'native_cache_drop_must_be_absent_before_original_reload')
        enabled = phase == 'cache-old-enable'
        if enabled:
            actor = c.host.actor(False, False); start = document(BASE / 'cache-old-start-intent.json')
            need(actor['main']['startTicks'] >= start['minimumStartTicks'] and actor['unit']['InvocationID'] != start['before']['InvocationID'], 'same_owned_original_cache_start_for_reload')
            need(c.cache.inode(c.cache.BOOT, True) == c.cache.document(c.cache.BASE / 'before.json')['binding']['boot'], 'same_restored_cache_boot_before_reload')
        else: c.cache.stopped(c.host)
        def cache_loaded():
            state = c.cache.loaded(c.host, False)
            need(state['UnitFileState'] == ('enabled' if enabled else 'disabled') and state['WantedBy'] == ('multi-user.target' if enabled else ''),
                 'actual_original_cache_activation_configuration_must_be_loaded')
        final_check = cache_loaded; label = 'cache-old-enable' if enabled else 'cache-old-load'
    intent = BASE / (label + '-intent.json')
    if not phase.startswith('metadata-'): need(intent.exists(), 'actual_owned_configuration_reload_intent_required')
    pending = pending_readers(c, op)
    if metadata:
        definitions = dict(metadata_op['oldWriter']['definitions'])
        if native: definitions[str(owner.DROP)] = metadata_op['candidateDropSha256']
        pending['metadata'] = pending_definitions(owner.UNIT, definitions)
    elif phase.startswith('cache-'):
        pending['cache'] = pending_definitions(c.cache.UNIT, c.cache.document(c.cache.BASE / 'before.json')['binding']['originalActor']['definitions'])
    states = {name: c.state(peer['unit']) for name, peer in proof.PEERS.items()}
    binding = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(public_input(BASE / 'operation.json')), 'phase': phase,
        'originalIntentSha256': sha(public_input(intent)) if intent.exists() else None, 'readers': states,
        'metadataState': metadata[0].state(metadata[1].m) if metadata else None, 'pendingDefinitions': pending,
        'allOriginalPrivateInputs': original_inputs(c, op),
        'configurationOnlyNoStartStopOrSQL': True}
    return c, op, label, final_check, metadata, {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'serviceActions': 0}


def reload_review(proof, phase, context=None): return reload_target(proof, phase, context)[-1]


def recover_reload(proof, phase, expected, execute=False, context=None):
    c, op, label, postcondition, metadata, checked = reload_target(proof, phase, context)
    need(checked['reviewHash'] == expected, 'fresh_exact_configuration_recovery_review_required')
    if execute:
        number = sum(1 for p in BASE.glob('configuration-recovery-' + phase + '-*-intent.json')) + 1
        need(number <= 3, 'bounded_explicit_configuration_recovery_count_exceeded')
        save('configuration-recovery-' + phase + '-' + str(number) + '-intent.json', checked)
        need(reload_review(proof, phase, context) == checked, 'configuration_or_actor_changed_after_reload_recovery_intent')
        if metadata: metadata[0].manager(metadata[1].m, 'daemon-reload')
        elif phase.startswith('cache-'): c.cache.manager('daemon-reload')
        else: manager('daemon-reload')
    postcondition(); original_inputs(c, op)
    if not phase.startswith('metadata-') and not (BASE / (label + '-result.json')).exists():
        save(label + '-result.json', {'reconciledFromActualLoadedConfiguration': True, 'explicitAdditionalReload': execute,
             'reviewHash': expected, 'serviceStartOrStopActions': 0, 'databaseWrites': 0})
    return {'format': FORMAT, 'configurationRecovered': True, 'phase': phase, 'serviceStartOrStopActions': 0, 'databaseWrites': 0,
            'metadataInverseNeedsExplicitFinish': metadata is not None}


@contextlib.contextmanager
def transition_lock():
    path = Path('/run/lock/yunipals-ypal-combined-transition.lock')
    parent = path.parent.lstat()
    need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and
         (not parent.st_mode & 0o022 or stat.S_IMODE(parent.st_mode) == 0o1777), 'protected_shared_transition_lock_parent_required')
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd); need(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and info.st_nlink == 1 and
                                 stat.S_IMODE(info.st_mode) == 0o600, 'exact_shared_transition_lock_file_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = path.lstat(); need((now.st_dev, now.st_ino, now.st_mode, now.st_uid, now.st_gid, now.st_nlink) ==
            (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink), 'shared_transition_lock_replaced_during_acquire')
        yield
    finally: os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--source-manifest-sha', required=True)
    parser.add_argument('--inputs'); parser.add_argument('--inputs-sha'); parser.add_argument('--authorization-sha')
    parser.add_argument('--service', choices=list(LOCAL_PEERS)); parser.add_argument('--service-phase', choices=['preview-start', 'preview-stop', 'original-stop', 'reader-start', 'reader-reload'])
    parser.add_argument('--inverse-phase', choices=['roles', 'cache', 'capsule']); parser.add_argument('--intent-sha')
    parser.add_argument('--reload-phase', choices=RELOAD_PHASES)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--admit-readers'); actions.add_argument('--publish'); actions.add_argument('--publication-review', action='store_true')
    actions.add_argument('--continue-readers'); actions.add_argument('--continue-review', action='store_true')
    actions.add_argument('--reconcile-roles'); actions.add_argument('--reconcile-publication')
    actions.add_argument('--reconcile-service'); actions.add_argument('--service-reconcile-review', action='store_true')
    actions.add_argument('--inverse-review', action='store_true'); actions.add_argument('--inverse'); actions.add_argument('--finish-inverse')
    actions.add_argument('--reconcile-inverse', action='store_true'); actions.add_argument('--archive-publication-review', action='store_true'); actions.add_argument('--archive-publication')
    actions.add_argument('--reload-review', action='store_true'); actions.add_argument('--reconcile-reload'); actions.add_argument('--reload-config')
    actions.add_argument('--inspect', action='store_true'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_main_cutover_host_required')
    os.umask(0o077); proof = load_proof(args.source_manifest_sha)
    generation_owner = proof.module('ypal-native-generation-v1.py', proof.DEPENDENCIES['ypal-native-generation-v1.py'])
    with transition_lock(), generation_owner.lock():
        if args.admit_readers:
            value = inputs(args.inputs, args.inputs_sha); need(value['sourceManifestSha256'] == args.source_manifest_sha, 'same_input_manifest_required')
            result = admit_readers(proof, value, args.admit_readers, args.authorization_sha)
        elif args.publish: result = publish(proof, args.publish)
        elif args.publication_review: result = publication_review(proof)
        elif args.continue_readers: result = continue_readers(proof, args.continue_readers)
        elif args.continue_review: result = continue_review(proof)
        elif args.reconcile_roles: result = reconcile_roles(proof, args.reconcile_roles)
        elif args.reconcile_publication: result = reconcile_publication(proof, args.reconcile_publication)
        elif args.reconcile_service: result = reconcile_service(proof, args.service, args.service_phase, args.reconcile_service)
        elif args.service_reconcile_review: result = reconcile_service_review(proof, args.service, args.service_phase)
        elif args.inverse_review: result = inverse_review(proof)
        elif args.inverse: result = inverse(proof, args.inverse)
        elif args.finish_inverse: result = inverse(proof, args.finish_inverse, True)
        elif args.reconcile_inverse: result = reconcile_inverse(proof, args.inverse_phase, args.intent_sha)
        elif args.reload_review: result = reload_review(proof, args.reload_phase)
        elif args.reconcile_reload: result = recover_reload(proof, args.reload_phase, args.reconcile_reload)
        elif args.reload_config: result = recover_reload(proof, args.reload_phase, args.reload_config, True)
        elif args.archive_publication_review: result = archive_publication_review(proof)
        elif args.archive_publication: result = archive_publication(proof, args.archive_publication)
        elif args.inspect:
            op = operation(proof); c = current_context(proof, op)
            result = {'format': FORMAT, 'phaseFiles': sorted(p.name for p in BASE.glob('*.json')), 'publicationFiles': sorted(p.name for p in PUBLICATION.glob('*.json')),
                'unitStates': {name: c.state(peer['unit']) for name, peer in proof.PEERS.items()}, 'automaticRetryAllowed': False,
                'databaseWrites': 0, 'serviceActions': 0}
        else:
            value = inputs(args.inputs, args.inputs_sha); need(value['sourceManifestSha256'] == args.source_manifest_sha, 'same_input_manifest_required')
            result = review(proof, value)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_cutover_owner_deadline_unknown_effect_reconcile_only')); signal.alarm(1800)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld',
            'automaticRetryAllowed': False}))
        raise SystemExit(1)
    finally: signal.alarm(0)
