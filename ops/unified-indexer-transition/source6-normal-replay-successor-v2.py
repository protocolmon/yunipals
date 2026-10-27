#!/usr/bin/env python3
"""Explicit normal/free-only successor of the exact bounded Base1 source runtime.

Only a new99 drop-in, boot link and root-owned receipts are written. The prior
finite runtime is recorded separately; no financial authority is renewed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import types
import urllib.error

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-normal-replay-successor-20261022')
STOP_HELPER_SHA = '762cbca355eb4d236577279079c3da6a900c3bc49b34162510615872aaae97b1'
BOUND_SHA = 'c9ab7f0a48cb973be0a616e3837f37581b0cbd00639470892b76f4b96147cfb9'
BOUND_IDENTITY = {'pid': 676577, 'startTicks': 6611554871,
                  'invocation': 'ae6089caba3049faa95442c254556b6c',
                  'startMonotonicMicroseconds': 66115548732268}
INTENT_SHA = '9097b1c4f6fe793db9e22b3943d66fd006dde0150eabab1033f5b757f89b4b44'
CANDIDATE = OPS / 'source6-normal-replay-successor.conf.example'
CANDIDATE_SHA = '339e8372d1913b0a3af0521a08e5d0f615ee93e84a17f2d428b0b87ec2414f08'
NATIVE_SHA = 'd9f3d0988229ad954cc8d4e1f34878c5882c4026b024a25885bd45dd30564b76'
PROFILE_EXPIRY = '2026-11-19T18:00:00+00:00'
INHERITABLE_CAPABILITY_SHA256 = 'f2da78b49f1566ebca881c763328012aee1f1e48070862ed835ab22d8aa1ff3e'
FORMAT = 'yunipals-source6-normal-free-successor'
EXTRA = ['RestartUSec', 'StartLimitIntervalUSec', 'StartLimitBurst', 'BindReadOnlyPaths',
         'BindPaths', 'ReadWritePaths', 'NoNewPrivileges', 'ProtectSystem', 'ProtectHome',
         'PrivateTmp', 'RestrictSUIDSGID', 'CapabilityBoundingSet', 'AmbientCapabilities',
         'WorkingDirectory', 'Environment', 'EnvironmentFiles', 'Job']


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encode(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def drop(s): return Path('/etc/systemd/system', s.UNIT + '.d', '99-normal-free-replay.conf')
def boot_link(s): return Path('/etc/systemd/system/multi-user.target.wants', s.UNIT)


def modules():
    p = OPS / 'source6-base-priority-inspect-stop.py'; raw = p.read_bytes()
    if sha(raw) != STOP_HELPER_SHA: fail('frozen_owned_source_reader_required')
    r = types.ModuleType('owned_source_reader'); r.__file__ = str(p)
    exec(compile(raw, str(p), 'exec'), r.__dict__); b, s = r.modules()
    if sha(s.protected(p)) != STOP_HELPER_SHA: fail('protected_owned_source_reader_required')
    return r, b, s


def extra(s):
    raw = s.run(['/usr/bin/systemctl', 'show', '--all', s.UNIT, *['--property=' + k for k in EXTRA]]).decode()
    result = dict(line.split('=', 1) for line in raw.splitlines())
    # systemctl omits the empty a(sb) property even with --all. Read that one
    # typed property directly, using the fixed object path rather than GetUnit.
    if set(result) not in [set(EXTRA), set(EXTRA) - {'EnvironmentFiles'}]:
        fail('complete_actual_source_properties_required')
    object_path = '/org/freedesktop/systemd1/unit/' + re.sub(
        r'[^A-Za-z0-9]', lambda item: '_' + format(ord(item[0]), '02x'), s.UNIT)
    typed = json.loads(s.run(['/usr/bin/busctl', '--json=short', 'get-property',
        'org.freedesktop.systemd1', object_path, 'org.freedesktop.systemd1.Service', 'EnvironmentFiles']))
    if typed != {'type': 'a(sb)', 'data': []}:
        fail('typed_empty_unit_environment_files_required')
    result['EnvironmentFiles'] = '[]'
    # Keep private values on host even if a future unreviewed unit injects them.
    for key in ['Environment', 'EnvironmentFiles']:
        result[key + 'Sha256'] = sha(result.pop(key).encode())
    return result


def fixed_inputs(r, b, s):
    pins = {OPS / 'source6-base-priority-inspect-stop.py': STOP_HELPER_SHA,
            OPS / 'source6-base-priority-resume.py': r.RESUME_SHA,
            b.PAUSED: b.PAUSE_SHA, b.BASE / 'prepared.json': r.PREPARED_SHA,
            b.BASE / 'resume-intent.json': INTENT_SHA, b.BASE / 'runtime.json': BOUND_SHA,
            b.AREA / 'rpc-preflight.ts': b.RPC_SHA, CANDIDATE: CANDIDATE_SHA,
            s.ORIGINAL: s.UNIT_SHA, s.DROP: sha(s.drop_bytes())}
    for path, pin in pins.items():
        if sha(s.protected(path)) != pin: fail('exact_acknowledged_successor_inputs_required')
    prepared = json.loads(s.protected(b.BASE / 'prepared.json'))
    if (prepared.get('prepared') is not True or prepared.get('sourceStarted') is not False or
            prepared.get('sameBuildProof', {}).get('buildId') != s.BUILD or
            prepared.get('sameBuildProof', {}).get('baseSourceConcurrency') != 1):
        fail('actual_same_build_base1_proof_required')
    source = s.inputs()
    return {'hashes': {str(p): pin for p, pin in pins.items()}, 'sourceDigest': source['sourceDigest']}


def financial(s):
    policy = s.financial()
    profile = s.query("SELECT jsonb_build_object('enabled',enabled,'expiresAt',expires_at,'profileId',profile_id,'scope',scope,'manifest',manifest_hash)FROM yunipals_market.unified_rpc_profile WHERE profile_id='" + s.PROFILE_ID + "'", True)
    expected = {'enabled': True, 'expiresAt': PROFILE_EXPIRY, 'profileId': s.PROFILE_ID,
                'scope': 'yunipals-opensea', 'manifest': s.MANIFEST}
    if profile != expected or datetime.now(timezone.utc) >= datetime.fromisoformat(PROFILE_EXPIRY):
        fail('unchanged_approved_normal_profile_and_expiry_required')
    return {'profile': profile, 'authority': policy, 'paidAuthority': False, 'policyChanged': False}


def native(s):
    state = s.database(True)
    catalog = s.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + s.SCHEMA + "'),'tables',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.oid::text,c.relowner::text)ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + s.SCHEMA + "'AND c.relkind IN('r','p')),'cacheTables',coalesce((SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.oid::text)ORDER BY n.nspname,c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE'ponder_sync%'AND c.relkind IN('r','p')),'[]'::jsonb))")
    if sha(encode(catalog)) != NATIVE_SHA: fail('retained_native_namespace_tables_and_cache_required')
    return {'catalogSha256': NATIVE_SHA, 'schemaOid': catalog['schemaOid'], 'checkpoints': state['checkpoints'],
            'sourceSessions': state['sourceSessions'], 'schema': s.SCHEMA, 'buildId': s.BUILD}


def preserved(before, after):
    for key in ['catalogSha256', 'schemaOid', 'schema', 'buildId']:
        if before[key] != after[key]: fail('native_namespace_or_build_changed')
    old = {p['chain']: p for p in before['checkpoints']}
    if set(old) != {p['chain'] for p in after['checkpoints']} or any(
            p[k] < old[p['chain']][k] for p in after['checkpoints'] for k in ['latest', 'safe', 'finalized']):
        fail('saved_native_checkpoint_regressed')


def prior(r, b, s):
    checked = r.inspect(b, s)
    if checked['resumeIntentSha256'] != INTENT_SHA or checked['runtimeReceiptSha256'] != BOUND_SHA:
        fail('exact_actual_bounded_runtime_required')
    bound = json.loads(s.protected(b.BASE / 'runtime.json'))
    if bound.get('runtime') != BOUND_IDENTITY: fail('exact_prior_bounded_invocation_required')
    if checked['runtime'] is not None:
        if checked['runtime'] != BOUND_IDENTITY: fail('foreign_source_invocation')
    else:
        r.stopped(s.unit(), BOUND_IDENTITY, s.job(), r.gone(BOUND_IDENTITY))
    return {'runtime': checked['runtime'], 'unit': s.unit(), 'extra': extra(s),
            'originalDeadlineMonotonicMicroseconds': r.DEADLINE,
            'actualBoundedExpiryMonotonicMicroseconds': bound['expiresMonotonicMicroseconds']}


def booster(s):
    p = s.unit('yunipals-booster-launch.service')
    if p['ActiveState'] != 'active' or p['SubState'] != 'running' or int(p['MainPID']) <= 1:
        fail('live_booster_ingestor_must_be_preserved')
    s.http(9026, '/ready')
    return {'invocation': p['InvocationID'], 'pid': p['MainPID'],
            'definitionSha256': sha(s.protected(Path(p['FragmentPath'])))}


def review(r, b, s):
    if BASE.exists() or os.path.lexists(drop(s)) or os.path.lexists(boot_link(s)):
        fail('fresh_normal_successor_operation_required')
    inputs = fixed_inputs(r, b, s); before = prior(r, b, s); db = native(s)
    if db['sourceSessions'] > 32: fail('source_role_connection_limit_exceeded')
    value = {'format': FORMAT, 'operatorSha256': sha(s.protected(Path(__file__).absolute())),
             'inputs': inputs, 'prior': before, 'native': db, 'financial': financial(s),
             'proxies': s.proxies(), 'booster': booster(s), 'resources': s.resources(),
             'normalDropSha256': CANDIDATE_SHA, 'normalOperationalRuntime': 'infinity',
             'priorOperationalCutoffExplicitlySuperseded': True, 'financialWindowRenewed': False,
             'freeOnly': True, 'paidAuthority': False, 'publicSelectionChanges': 0}
    # RAM/connection counts are checked, but not unstable review-hash inputs.
    binding = {k: v for k, v in value.items() if k != 'resources'}
    binding['native'] = {k: v for k, v in db.items() if k not in {'sourceSessions', 'checkpoints'}}
    return {**value, 'reviewHash': sha(encode(binding))}


def normal_configuration(s, before):
    p = s.unit(); current = extra(s)
    if (p['command'] != before['unit']['command'] or p['DropInPaths'].split() !=
            [*before['unit']['DropInPaths'].split(), str(drop(s))] or
            p['RuntimeMaxUSec'] != 'infinity' or p['Restart'] != 'on-failure' or
            p['MemoryMax'] != '6442450944' or p['MemorySwapMax'] != '0' or p['LimitCORE'] != '0'):
        fail('exact_loaded_infinite_base1_heap_configuration_required')
    wanted = {**before['extra'], 'RestartUSec': '15s', 'StartLimitIntervalUSec': '5min', 'StartLimitBurst': '5'}
    if current != wanted: fail('retained_source_sandbox_mounts_or_settings_changed')
    if sha(s.protected(drop(s))) != CANDIDATE_SHA: fail('exact_owned_normal_drop_required')
    return p


def write_new(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def save(s, path, value):
    pin = s.save(path, value); sync_directory(path.parent)
    return pin


def protected_directory(path):
    for parent in [*path.parents, path]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail('protected_existing_directory_required')


def link_identity(s):
    info = boot_link(s).lstat()
    if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or os.readlink(boot_link(s)) != str(s.ORIGINAL):
        fail('only_exact_owned_boot_link_may_be_removed')
    return {'file': str(boot_link(s)), 'target': str(s.ORIGINAL), 'uid': info.st_uid,
            'gid': info.st_gid, 'device': info.st_dev, 'inode': info.st_ino}


def current_identity(s, prior_identity=None):
    p = s.unit()
    if p['ActiveState'] != 'active' or p['SubState'] != 'running' or s.job() != 0:
        fail('active_normal_source_required')
    identity = s.process_identity(p)
    if identity['invocation'] == BOUND_IDENTITY['invocation'] or (prior_identity is not None and identity != prior_identity):
        fail('exact_new_normal_source_invocation_required')
    return identity


def actor_evidence(identity, unit, cgroup, proc_group, status, members):
    expected = '/system.slice/' + unit
    if (cgroup != expected or proc_group.splitlines() != ['0::' + expected] or
            identity['pid'] not in members or set(status['Uid'].split()) != {'970'} or
            set(status['Gid'].split()) != {'964'} or not set(status['Groups'].split()) <= {'964'} or
            status['NoNewPrivs'].strip() != '1' or
            sha(status['CapInh'].strip().encode()) != INHERITABLE_CAPABILITY_SHA256 or
            any(int(status[k].strip(), 16) != 0 for k in ['CapPrm', 'CapEff', 'CapAmb'])):
        fail('exact_normal_source_actor_argv_and_cgroup_required')
    return {'cgroup': expected, 'uid': 970, 'gid': 964,
            'permittedEffectiveAndAmbientCapabilitiesZero': True,
            'retainedInheritableCapabilitiesSha256': INHERITABLE_CAPABILITY_SHA256,
            'noNewPrivileges': True, 'argvVerifiedByFrozenSourceReader': True}


def actor(s, identity):
    pid = str(identity['pid']); root = Path('/proc', pid)
    status = dict(line.split(':', 1) for line in (root / 'status').read_text().splitlines() if ':' in line)
    cgroup = s.run(['/usr/bin/systemctl', 'show', s.UNIT, '--value', '--property=ControlGroup']).decode().strip()
    members = [int(value) for value in (Path('/sys/fs/cgroup') / cgroup.lstrip('/') / 'cgroup.procs').read_text().split()]
    return actor_evidence(identity, s.UNIT, cgroup, (root / 'cgroup').read_text(), status, members)


def reconcile_start(r, b, s):
    if (BASE / 'started.json').exists() or (BASE / 'runtime.json').exists():
        fail('acknowledged_start_must_use_its_exact_receipt')
    before = json.loads(s.protected(BASE / 'before.json'))
    raw = s.protected(BASE / 'start-intent.json'); intent = json.loads(raw)
    expected = {'normalDropSha256': CANDIDATE_SHA, 'priorBoundedRuntimeSha256': BOUND_SHA,
                'nativeCatalogSha256': NATIVE_SHA, 'operatorSha256': before['operatorSha256'],
                'priorStoppedIdentity': BOUND_IDENTITY, 'inheritableCapabilitiesSha256': INHERITABLE_CAPABILITY_SHA256}
    if any(intent.get(k) != v for k, v in expected.items()) or not r.gone(BOUND_IDENTITY):
        fail('exact_durable_normal_start_intent_required')
    fixed_inputs(r, b, s); normal_configuration(s, before['prior'])
    identity = current_identity(s)
    boundary = intent.get('beforeStartMonotonicMicroseconds')
    if (type(boundary) is not int or not boundary <= identity['startMonotonicMicroseconds'] <= boundary + 60_000_000 or
            s.unit()['NRestarts'] != '0'):
        fail('initial_owned_normal_start_boundary_required')
    evidence = actor(s, identity)
    if current_identity(s, identity) != identity: fail('normal_start_identity_changed_during_reconcile')
    value = {'format': FORMAT, 'reconciled': True, 'startIntentSha256': sha(raw),
             'runtime': identity, 'actor': evidence, 'normalDropSha256': CANDIDATE_SHA,
             'operatorProviderCalls': 0, 'operatorDatabaseWrites': 0, 'serviceActions': 0}
    return {**value, 'reconcileHash': sha(encode(value))}


def apply(r, b, s, pin):
    with s.lease(s.SOURCE_LEASE):
        checked = review(r, b, s)
        if checked['reviewHash'] != pin: fail('fresh_exact_normal_successor_review_required')
        BASE.mkdir(mode=0o700); sync_directory(BASE.parent); save(s, BASE / 'before.json', checked)
        prior_files = [s.ORIGINAL, s.DROP, b.drop_path(s)]
        for i, path in enumerate(prior_files): write_new(BASE / ('prior-' + str(i)), s.protected(path))
        save(s, BASE / 'intent.json', {'reviewHash': pin, 'priorBoundedRuntimeSha256': BOUND_SHA,
               'operatorSha256': checked['operatorSha256'], 'automaticRetryAllowed': False, 'at': s.now()})
        if checked['prior']['runtime'] is not None:
            if r.inspect(b, s)['runtime'] != checked['prior']['runtime']: fail('only_exact_prior_source_may_be_stopped')
            s.run(['/usr/bin/systemctl', 'stop', s.UNIT], timeout=55)
        r.stopped(s.unit(), BOUND_IDENTITY, s.job(), r.gone(BOUND_IDENTITY))
        preserved(checked['native'], native(s))
        created_directory = not drop(s).parent.exists()
        if created_directory: drop(s).parent.mkdir(mode=0o755)
        protected_directory(drop(s).parent)
        save(s, BASE / 'install-intent.json', {'dropParentCreated': created_directory, 'at': s.now()})
        write_new(drop(s), s.protected(CANDIDATE), 0o644)
        s.run(['/usr/bin/systemctl', 'daemon-reload'])
        loaded = normal_configuration(s, checked['prior'])
        if loaded['MainPID'] != '0' or s.job() != 0: fail('unlimited_configuration_must_be_loaded_before_start')
        if financial(s) != checked['financial'] or s.proxies() != checked['proxies']:
            fail('financial_policy_or_proxy_changed_before_start')
        save(s, BASE / 'start-intent.json', {'normalDropSha256': CANDIDATE_SHA,
             'priorBoundedRuntimeSha256': BOUND_SHA, 'nativeCatalogSha256': NATIVE_SHA,
             'operatorSha256': checked['operatorSha256'], 'priorStoppedIdentity': BOUND_IDENTITY,
             'inheritableCapabilitiesSha256': INHERITABLE_CAPABILITY_SHA256,
             'beforeStartMonotonicMicroseconds': time.monotonic_ns() // 1000, 'at': s.now()})
        s.run(['/usr/bin/systemctl', 'start', s.UNIT], timeout=40)
        identity = current_identity(s); save(s, BASE / 'started.json', {'runtime': identity, 'at': s.now()})
        until = time.monotonic() + 45
        while True:
            current_identity(s, identity)
            try:
                if s.http(9024, '/health') != b'': fail('normal_ponder_health_body_differs')
                break
            except (OSError, TimeoutError, urllib.error.URLError):
                if time.monotonic() >= until: fail('normal_ponder_startup_health_not_acknowledged')
                time.sleep(1)
        normal_configuration(s, checked['prior']); preserved(checked['native'], native(s)); booster(s)
        protected_directory(boot_link(s).parent)
        if os.path.lexists(boot_link(s)): fail('fresh_owned_boot_link_required')
        save(s, BASE / 'boot-intent.json', {'target': str(s.ORIGINAL), 'at': s.now()})
        os.symlink(str(s.ORIGINAL), boot_link(s)); owned_link = link_identity(s)
        sync_directory(boot_link(s).parent); save(s, BASE / 'boot-created.json', owned_link)
        s.run(['/usr/bin/systemctl', 'daemon-reload'])
        normal_configuration(s, checked['prior']); current_identity(s, identity)
        if s.run(['/usr/bin/systemctl', 'is-enabled', s.UNIT]).strip() != b'enabled': fail('actual_normal_boot_enable_required')
        value = {'format': FORMAT, 'started': True, 'readyClaimed': False, 'runtime': identity,
                 'reviewHash': pin, 'priorBoundedRuntimeSha256': BOUND_SHA,
                 'priorOperationalCutoffExplicitlySuperseded': True, 'normalOperationalRuntime': 'infinity',
                 'financialWindowRenewed': False, 'financial': checked['financial'], 'proxies': checked['proxies'],
                 'beforeNative': checked['native'], 'dropSha256': CANDIDATE_SHA,
                 'bootLinkTarget': str(s.ORIGINAL), 'bootLink': owned_link,
                 'normalDropFile': str(drop(s)), 'baseSourceConcurrency': 1, 'heapMiB': 4096,
                 'memoryMaxBytes': 6442450944, 'freeOnly': True, 'paidAuthority': False,
                 'operatorProviderCalls': 0, 'operatorDatabaseWrites': 0, 'schemaCacheAndCheckpointsReset': False,
                 'publicSelectionChanges': 0, 'boosterSourceChanged': False, 'at': s.now()}
        receipt = save(s, BASE / 'runtime.json', value)
        return {**value, 'runtimeReceiptSha256': receipt}


def validate(r, b, s, pin):
    raw = s.protected(BASE / 'runtime.json')
    if sha(raw) != pin: fail('exact_normal_runtime_receipt_required')
    value = json.loads(raw); checked = json.loads(s.protected(BASE / 'before.json'))
    normal_configuration(s, checked['prior']); current_identity(s, value['runtime'])
    fixed_inputs(r, b, s); preserved(value['beforeNative'], native(s))
    if financial(s) != value['financial'] or s.proxies() != value['proxies']:
        fail('unchanged_normal_financial_policy_and_proxies_required')
    if link_identity(s) != value['bootLink']: fail('exact_owned_boot_link_required')
    return {'format': FORMAT, 'validated': True, 'runtime': value['runtime'], 'runtimeReceiptSha256': pin,
            'normalOperationalRuntime': 'infinity', 'financialExpiresAt': PROFILE_EXPIRY,
            'financialWindowRenewed': False, 'freeOnly': True, 'paidAuthority': False,
            'operatorProviderCalls': 0, 'operatorDatabaseWrites': 0, 'at': s.now()}


def restoration_authority(s, pin):
    for name in ['runtime.json', 'started.json', 'intent.json']:
        path = BASE / name
        if path.exists():
            raw = s.protected(path)
            if sha(raw) == pin:
                saved = json.loads(raw)
                if name == 'intent.json' and (BASE / 'started.json').exists():
                    fail('use_actual_started_or_runtime_receipt_for_owned_restore')
                return saved.get('runtime'), name
    fail('exact_owned_normal_operation_receipt_required')


def restore(r, b, s, pin, reconcile_hash=None):
    with s.lease(s.SOURCE_LEASE):
        before = json.loads(s.protected(BASE / 'before.json'))
        identity, reference = restoration_authority(s, pin)
        if identity is None and s.unit()['ActiveState'] == 'active':
            reconciled = reconcile_start(r, b, s)
            if reconciled['reconcileHash'] != reconcile_hash: fail('exact_readonly_start_reconcile_hash_required')
            identity = reconciled['runtime']; reference = 'reconciled-start'
            if not (BASE / 'reconciled-start.json').exists(): save(s, BASE / 'reconciled-start.json', reconciled)
        for i, path in enumerate([s.ORIGINAL, s.DROP, b.drop_path(s)]):
            if s.protected(path) != s.protected(BASE / ('prior-' + str(i))): fail('prior_source_files_must_remain_unchanged')
        removing = BASE / 'removal-intent.json'
        if os.path.lexists(boot_link(s)):
            boot = json.loads(s.protected(BASE / 'boot-intent.json'))
            if (boot.get('target') != str(s.ORIGINAL) or not boot_link(s).is_symlink() or
                    os.readlink(boot_link(s)) != str(s.ORIGINAL)):
                fail('only_exact_owned_boot_link_may_be_removed')
            created = BASE / 'boot-created.json'
            if created.exists() and link_identity(s) != json.loads(s.protected(created)):
                fail('exact_created_boot_link_identity_required')
        if os.path.lexists(drop(s)):
            if sha(s.protected(drop(s))) != CANDIDATE_SHA: fail('exact_owned_normal_drop_required')
            expected = [*before['prior']['unit']['DropInPaths'].split(), str(drop(s))]
            if s.unit()['DropInPaths'].split() != expected: fail('no_foreign_source_drop_may_be_restored')
        elif not removing.exists() and ((BASE / 'start-intent.json').exists() or os.path.lexists(boot_link(s))):
            fail('owned_drop_or_recorded_removal_required')
        intent = BASE / 'restore-intent.json'; previously_requested = intent.exists()
        if previously_requested:
            saved = json.loads(s.protected(intent))
            if saved['runtimeReceiptSha256'] != pin: fail('exact_existing_normal_restore_required')
            if identity is None: identity = saved['runtime']
            elif saved['runtime'] != identity: fail('exact_existing_restore_identity_required')
        else:
            if identity is not None:
                normal_configuration(s, before['prior']); current_identity(s, identity)
            else:
                r.stopped(s.unit(), BOUND_IDENTITY, s.job(), r.gone(BOUND_IDENTITY))
            save(s, intent, {'runtimeReceiptSha256': pin, 'reference': reference, 'runtime': identity, 'at': s.now()})
            if identity is not None: s.run(['/usr/bin/systemctl', 'stop', s.UNIT], timeout=55)
        expected_identity = identity or BOUND_IDENTITY
        r.stopped(s.unit(), expected_identity, s.job(), r.gone(expected_identity))
        preserved(before['native'], native(s)); booster(s)
        if not removing.exists(): save(s, removing, {'runtimeReceiptSha256': pin, 'at': s.now()})
        elif json.loads(s.protected(removing))['runtimeReceiptSha256'] != pin: fail('exact_owned_removal_intent_required')
        if os.path.lexists(boot_link(s)): boot_link(s).unlink()
        if os.path.lexists(drop(s)): drop(s).unlink()
        installed = BASE / 'install-intent.json'
        if installed.exists():
            install = json.loads(s.protected(installed))
            if install['dropParentCreated'] and drop(s).parent.exists(): drop(s).parent.rmdir()
        s.run(['/usr/bin/systemctl', 'daemon-reload'])
        after = s.unit(); r.stopped(after, expected_identity, s.job(), r.gone(expected_identity))
        if after['DropInPaths'] != before['prior']['unit']['DropInPaths'] or extra(s) != before['prior']['extra']:
            fail('exact_prior_stopped_source_configuration_required')
        result = {'format': FORMAT, 'restored': True, 'sourceRemainsStopped': True,
                  'serviceActionsThisCall': 1 if not previously_requested and identity is not None else 0,
                  'priorFilesUnchanged': True, 'schemaCacheAndCheckpointsReset': False,
                  'expiredFiniteSourceRestarted': False, 'boosterSourceChanged': False,
                  'operatorProviderCalls': 0, 'operatorDatabaseWrites': 0, 'at': s.now()}
        if not (BASE / 'restored.json').exists(): save(s, BASE / 'restored.json', result)
        return result


def main():
    p = argparse.ArgumentParser(description=__doc__); group = p.add_mutually_exclusive_group()
    group.add_argument('--apply'); group.add_argument('--validate'); group.add_argument('--restore')
    group.add_argument('--reconcile-start', action='store_true'); p.add_argument('--reconcile-hash'); args = p.parse_args()
    signal.signal(signal.SIGALRM, lambda *_: fail('bounded_normal_successor_operator_expired')); signal.alarm(240)
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_root_host_required')
    r, b, s = modules()
    if Path('/proc/sys/kernel/random/boot_id').read_text().strip() != s.BOOT: fail('same_source_boot_required')
    if args.apply: value = apply(r, b, s, args.apply)
    elif args.validate: value = validate(r, b, s, args.validate)
    elif args.restore: value = restore(r, b, s, args.restore, args.reconcile_hash)
    elif args.reconcile_start: value = reconcile_start(r, b, s)
    else:
        checked = review(r, b, s)
        value = {'format': FORMAT, 'reviewHash': checked['reviewHash'], 'applied': False,
                 'priorRuntime': checked['prior']['runtime'], 'schemaOid': checked['native']['schemaOid'],
                 'buildId': s.BUILD, 'financialExpiresAt': PROFILE_EXPIRY, 'normalOperationalRuntime': 'infinity',
                 'financialWindowRenewed': False, 'providerCalls': 0, 'databaseWrites': 0, 'serviceChanges': 0}
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z_]+', str(error)) else 'private_diagnostics_withheld'
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': code,
                          'errorClass': type(error).__name__, 'automaticRetryAllowed': False})); raise SystemExit(1)
