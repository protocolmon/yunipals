#!/usr/bin/env python3
"""Finite source008 support; receipt-only work can precede live callback witnesses."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import types

FORMAT = 'yunipals-restricted-support-probe-source6-v11'
OPERATIONS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/lib/yunipals-unified-shadow/support-probes-source6-v11')
LOCK = Path('/run/lock/yunipals-unified-support-probe.lock')
ROLE = 'yunipals_unified_support'
SOURCE = '008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
NODE = '/opt/node-v24.18.1/bin/node'
RELEASE = '0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
SCHEMA = 'unified_shadow_20261020_7e7375b0'
BUILD = 'bf4939b3ff'
PROXY_SOURCE = '6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6'
PROXY_SHA = 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965'
SUPPORT_SHA = '08598217e42d8058b1839ae5162ede44b648f3b9c523c15f1c4eb8f7691bb9c7'
RUNTIME_HELPER_SHA = 'b25f8aa1fe621cded35374208220f7a7f3390825103a73c34cb77ede4bc61cdd'
RUNNER_SHA = '6b4770a328b21127237a0808d094784cc1233bfdaa19781f4ec885316e768350'
OVERLAY_BUILDER = OPERATIONS / 'source008-receipt-support-build-v1.py'
OVERLAY_BUILDER_SHA = '572173c231c5e3b824563744ccbaf9d9fc48ff39f1bb99931f624d3f776c1f84'
PROFILE = '0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728'
PROFILE_FILE = OPERATIONS / 'normal-rpc-profile-v1.json'
PROFILE_SHA = '0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e'
RUNTIME_RECEIPT = Path('/var/backups/yunipals-source6-bnb-header-trial-v1-20261022/runtime.json')
RUNTIME_MODE = 'header-trial'
COORDINATOR = 'faf1bb8c-4306-4c43-b55e-6ac5fa038567'
CHAINS = {1: ('ethereum', 19201), 56: ('bnb', 19204), 137: ('polygon', 19203), 8453: ('base', 19202)}
PLAN_KEYS = {'format', 'runId', 'proxyHelper', 'supportPreparationHelper', 'runtimeHelper', 'runtimeReceiptFile', 'runtimeReceiptSha256', 'runnerFile', 'chains', 'task', 'bounds'}
BOUNDS = {'queueLimit': (1, 8), 'receiptLimit': (1, 2), 'maxRpcCalls': (1, 64), 'maxSeconds': (1, 180), 'maxResponseBytes': (1024, 2097152)}
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
STOP = False


def fail(code):
    raise RuntimeError(code)


def failure(error):
    text = str(error)
    return text if re.fullmatch('[a-z0-9_]{1,100}', text) else type(error).__name__


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def trusted(path, maximum=2_000_000):
    path = Path(path)
    if not path.is_absolute():
        fail('absolute_protected_input_required')
    for item in [*path.parents, path]:
        info = item.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or (info.st_mode & 0o022 and not (stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX)):
            fail('protected_input_ancestry_required')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        fail('bounded_regular_public_input_required')
    return path.read_bytes()


def load_module(path, checksum):
    if not re.fullmatch('[0-9a-f]{64}', checksum):
        fail('reviewed_dependency_not_yet_frozen')
    raw = trusted(path)
    if sha(raw) != checksum:
        fail('exact_reviewed_dependency_required')
    module = types.ModuleType('pinned_source6_support_dependency')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def validate_plan(plan):
    if (set(plan) != PLAN_KEYS or plan['format'] != FORMAT or not re.fullmatch('20261022-support11-[a-z0-9]{1,16}', plan['runId']) or
            not isinstance(plan['chains'], list) or not plan['chains'] or len(plan['chains']) > 4 or
            any(type(chain) is not int or chain not in CHAINS for chain in plan['chains']) or plan['chains'] != sorted(set(plan['chains'])) or
            plan['task'] not in ['observe-once', 'receipts-once', 'worker'] or set(plan['bounds']) != set(BOUNDS)):
        fail('exact_finite_support_plan_required')
    for key, (minimum, maximum) in BOUNDS.items():
        if type(plan['bounds'][key]) is not int or not minimum <= plan['bounds'][key] <= maximum:
            fail('support_bound_exceeded')
    for key, name in [('proxyHelper', 'proxy-upgrade.py'), ('supportPreparationHelper', 'prepare-shadow-support.py'),
                      ('runtimeHelper', 'source6-bnb-header-trial-v1.py'), ('runnerFile', 'support-probe-runner-v5.mjs')]:
        if plan[key] != str(OPERATIONS / name):
            fail('exact_reviewed_dependency_path_required')
    if plan['runtimeReceiptFile'] != str(RUNTIME_RECEIPT) or not re.fullmatch('[0-9a-f]{64}', plan['runtimeReceiptSha256']) or plan['runtimeReceiptSha256'] == '0' * 64:
        fail('protected_actual_ordinary_runtime_receipt_required')


def runtime_state(runtime, plan):
    # The pinned BNB-only validator checks the live source, inherited cleanup,
    # unchanged financial duty, qualified free proxies and released handover leases.
    value = runtime.validate_current(plan['runtimeReceiptFile'], plan['runtimeReceiptSha256'])
    profile = value.get('profile', {})
    if (value.get('format') != 'yunipals-source6-bnb-header-trial-v1' or value.get('mode') != RUNTIME_MODE or
            value.get('sourceSelectionChanged') is not False or value.get('sourceRestarted') is not False or
            value.get('parentRuntimeFile') != '/var/backups/yunipals-source6-bnb-transaction-route-v1-20261022/runtime.json' or
            value.get('parentRuntimeSha256') != '60ebedb5c1361218315bfb14e9eb6d611fa0c342e56aa49a6ec4bf7658708414' or
            any(value.get(key) != expected for key, expected in {'sourceDigest': SOURCE, 'schema': SCHEMA, 'nativeBuild': BUILD}.items()) or
            value.get('runtimeScope') != 'temporary_pre_cutover_ordinary_source' or value.get('freeOnly') is not True or
            value.get('paidAuthority') is not False or value.get('permitIds') != [] or
            profile.get('profileId') != PROFILE or profile.get('profileFile') != str(PROFILE_FILE) or
            profile.get('profileSha256') != PROFILE_SHA or profile.get('permits') != [] or profile.get('coordinatorId') != COORDINATOR or
            profile.get('manifestHash') != '0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029' or
            profile.get('activePaidPermits') != 0 or profile.get('historicalPermitRowsRetained') != 2 or
            not re.fullmatch('[0-9a-f]{64}', profile.get('disabledPermitStateSha256', '')) or
            set(value.get('proxies', {})) != {'ethereum', 'base', 'polygon', 'bnb'}):
        fail('actual_selective_free_runtime_required')
    # The successor intentionally does not duplicate financialCurrent in its API.
    # Read it freshly through the same frozen normal3 lineage, never validate the
    # old parent as live or infer today's allowance from yesterday's receipt.
    d = runtime.modules(); parent, parent_reviewed = d.selective.inherited(d)
    spec = parent_reviewed['terminalInput']; history = d.normal.history(d, spec)
    financial = d.normal.financial_state(d, spec, history)
    cleanup = value.get('parentReferences', {}).get('cleanup', {})
    if value.get('financialHandoff') != parent.get('financialHandoff'):
        fail('retained_selective_financial_handoff_required')
    wire_booked = financial.get('bookedMigrationCu')
    booked = int(wire_booked) if isinstance(wire_booked, str) and re.fullmatch('0|[1-9][0-9]*', wire_booked) else -1
    policy = financial.get('policy', {}); cleanup_path = Path(str(cleanup.get('file', '')))
    if (not 713000 <= booked <= 20000000 or not re.fullmatch('[0-9a-f]{64}', cleanup.get('sha256', '')) or
            cleanup.get('sha256') != financial.get('cleanupSha256') or cleanup.get('file') != financial.get('cleanupFile') or
            cleanup_path.parent.parent != Path('/var/backups') or cleanup_path.name not in {'cleanup-day1.json', 'cleanup-day2.json'} or
            cleanup_path.parent.name not in {'yunipals-paid-replay-renewal-v' + v + '-20261021' for v in ['7']} or
            set(policy) != {'globalDailyCu', 'unifiedSourceDailyCu', 'foregroundReserveCu'} or
            any(not isinstance(policy.get(k), str) or re.fullmatch('0|[1-9][0-9]*', policy[k]) is None for k in policy) or
            policy.get('foregroundReserveCu') != '200000'):
        fail('actual_same_window_cleanup_and_financial_duty_required')
    # UTC may leave less current-day migration allowance than cumulative M.
    # Consume the actual policy; never create a new-day cumulative allowance.
    today = int(policy['globalDailyCu']) - 1000000
    if not 0 <= today <= booked or int(policy['unifiedSourceDailyCu']) != 25000 + today:
        fail('actual_normal_foreground_reserve_and_day_policy_required')
    effective = value.get('effectiveRuntime', {})
    transaction_effective = effective.get('sourceRuntime', {})
    source_effective = transaction_effective.get('sourceRuntime', {})
    overlay = source_effective.get('historicalOverlay', {})
    if (effective.get('bnbProxyEntrySha256') != ('10665db20d03b12f0a70bc36cdfec39f32cea7fec442912b47b9f52d07889495' if RUNTIME_MODE == 'header-trial' else '6581ecddd74f3058e17354f7ca311c574014c0977be5bf279d85395a90d2e61c') or
            effective.get('headerMinimumIntervalMs') != (200 if RUNTIME_MODE == 'header-trial' else 400) or
            transaction_effective.get('bnbProxyEntrySha256') != '6581ecddd74f3058e17354f7ca311c574014c0977be5bf279d85395a90d2e61c' or
            transaction_effective.get('transactionRoute') != effective.get('transactionRoute') or
            effective.get('transactionRoute') != {'primaryIndices': [1, 2, 3], 'poolSha256': 'd75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b'} or
            source_effective.get('proxyEntrySha256') != '5b8ffbd5e0f58661948657f12152a76ddf8100090123c81dd59cac442c9409cb' or
            source_effective.get('qualifiedRoute') != {'primaryIndices': [0], 'poolSha256': 'd75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b'} or
            overlay.get('manifestSha256') != '7138a40ec0e1c907eca212523344e79258aeb421bf2dbaa3101db4d0e95ea4ea' or
            overlay.get('baseDependencyUnchanged') is not True or
            value.get('ordinaryRuntime', {}).get('invocation') != 'dab6fcd2704c461a9af2123168aec8f0' or
            value.get('leaseReleasedFile') != str(RUNTIME_RECEIPT.parent / (RUNTIME_MODE + '-handover-released.json')) or
            not re.fullmatch('[0-9a-f]{64}', value.get('leaseReleasedSha256', ''))):
        fail('actual_qualified_selective_proxy_and_released_baseline_required')
    # Each fresh validation checks advancing checkpoints; compare only stable
    # acknowledged fields. The frozen source_state still binds RELEASE.
    return {'sourceDigest': value['sourceDigest'], 'releaseId': RELEASE, 'schema': value['schema'], 'nativeBuild': value['nativeBuild'],
        'runtimeScope': value['runtimeScope'], 'freeOnly': True, 'paidAuthority': False, 'permitIds': [],
        'ordinaryRuntime': value['ordinaryRuntime'], 'profile': profile,
        'proxies': {str(chain): value['proxies'][name] for chain, (name, _) in CHAINS.items()},
        'postRenewalCleanup': {**financial, 'bookedCu': wire_booked}, 'parentReferences': value['parentReferences'],
        'financialHandoff': value['financialHandoff'], 'effectiveRuntime': effective,
        'acknowledgedRuntimeFile': str(RUNTIME_RECEIPT), 'acknowledgedRuntimeSha256': plan['runtimeReceiptSha256'],
        'leaseReleasedFile': value['leaseReleasedFile'], 'leaseReleasedSha256': value['leaseReleasedSha256']}


def controls(support):
    value = json.loads(support.sql("""BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT jsonb_build_object(
      'active',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'release',release_id,'epoch',epoch) ORDER BY name),'[]'::jsonb)
        FROM yunipals_indexer_control.active_release),
      'sourceOwner',(SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname='unified_shadow_20261020_7e7375b0')); ROLLBACK;"""))
    if value != {'active': [], 'sourceOwner': 'yunipals_unified_shadow'}:
        fail('retained_pre_cutover_source_selection_required')
    return value


def proxy_state(proxy, runtime_value, chains):
    result = {}
    for chain in chains:
        _, port = CHAINS[chain]
        row = runtime_value['proxies'][str(chain)]
        metrics = proxy.request(port, '/metrics')
        unified = metrics.get('unified', {})
        configuration = {key: metrics.get(key) for key in proxy.CONFIG_KEYS}
        traffic = unified.get('traffic', {}).get('unified_evidence', {})
        if (unified.get('profileId') != PROFILE or unified.get('chainId') != chain or unified.get('sourceRouting') != 'free_first' or
                configuration != row['configuration'] or configuration['freeRouting'] is not True or
                configuration['paidFallbackOnFreeFailure'] is not False or configuration['sourcePaidFallbackOnFreeFailure'] is not False or
                any(type(traffic.get(key)) is not int or traffic[key] != 0 for key in ['paidCalls', 'refused'])):
            fail('unchanged_free_evidence_proxy_required')
        result[str(chain)] = {**row, 'counters': {key: traffic[key] for key in ['paidCalls', 'refused']}}
    return result


def peer_command(account):
    env = ['PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC', 'NODE_OPTIONS=--max-old-space-size=384',
           'YUNIPALS_SUPPORT_UID=' + str(account.pw_uid), 'YUNIPALS_SUPPORT_GID=' + str(account.pw_gid),
           'UNIFIED_RPC_POLICY_REQUIRED=true', 'UNIFIED_RPC_FREE_ONLY=true', 'UNIFIED_RPC_PROFILE_FILE=' + str(PROFILE_FILE), 'UNIFIED_RPC_PROFILE_ID=' + PROFILE]
    env += ['PONDER_RPC_URL_' + str(chain) + '=http://127.0.0.1:' + str(port) + '/unified' for chain, (_, port) in CHAINS.items()]
    return ['/usr/bin/setpriv', '--reuid=' + str(account.pw_uid), '--regid=' + str(account.pw_gid), '--clear-groups',
            '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', *env,
            NODE, '--import', 'tsx', '--input-type=module', '-', 'yunipals-support-probe-v2']


def run_peer(account, runner, config, mode):
    process = subprocess.Popen([*peer_command(account), mode, encoded(config).decode()], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=ROOT / 'apps/yunipals-indexer', env=CLEAN, start_new_session=True)
    try:
        output, errors = process.communicate(runner, timeout=config['maxSeconds'] + 60)
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)
        fail('owned_finite_support_child_stopped')
    if len(output) > 1_000_000 or len(errors) > 1_000_000:
        fail('support_metadata_output_exceeded')
    try:
        result = json.loads(output)
    except (ValueError, UnicodeError):
        fail('invalid_support_metadata_output')
    return {'returnCode': process.returncode, 'result': result, 'stderrBytes': len(errors), 'stderrSha256': sha(errors)}


def config(plan):
    return {'chains': plan['chains'], 'task': plan['task'], 'profileId': PROFILE, **plan['bounds']}


def receipt_overlay():
    builder = load_module(OVERLAY_BUILDER, OVERLAY_BUILDER_SHA)
    value = builder.validate_saved()
    directory = ROOT / 'apps/yunipals-indexer/node_modules'
    info = directory.lstat()
    if (value.get('dependencyDirectory') != str(directory) or not stat.S_ISDIR(info.st_mode) or
            stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022):
        fail('unchanged_real_source_dependency_directory_required')
    return value


def inspect(plan):
    validate_plan(plan)
    runtime = load_module(plan['runtimeHelper'], RUNTIME_HELPER_SHA)
    proxy = load_module(plan['proxyHelper'], PROXY_SHA)
    support = load_module(plan['supportPreparationHelper'], SUPPORT_SHA)
    overlay = receipt_overlay()
    runner = trusted(plan['runnerFile'])
    if sha(runner) != RUNNER_SHA:
        fail('exact_bounded_support_runner_required')
    if os.path.lexists(BASE / plan['runId']):
        fail('retained_support_attempt_must_not_be_overwritten')
    account = pwd.getpwnam(ROLE)
    if account.pw_shell != '/usr/sbin/nologin' or account.pw_uid == 0:
        fail('retained_restricted_os_peer_required')
    rights = json.loads(support.sql("BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; " + support.privilege_query() + '; ROLLBACK;'))
    if rights != support.desired_privileges():
        fail('retained_support_grants_changed')
    selected = controls(support)
    actual = runtime_state(runtime, plan)
    proxies = proxy_state(proxy, actual, plan['chains'])
    observation = run_peer(account, runner, config(plan), 'inspect')
    if (observation['returnCode'] or observation['result'].get('releaseId') != RELEASE or observation['result'].get('writes') is not False or
            observation['result'].get('before', {}).get('running') is not True):
        fail('actual_restricted_peer_running_source_inspection_failed')
    if actual != runtime_state(runtime, plan):
        fail('ordinary_runtime_changed_during_support_inspection')
    binding = {'format': FORMAT, 'plan': plan, 'helperSha256': sha(trusted(Path(__file__).absolute())), 'runnerSha256': RUNNER_SHA,
               'receiptOverlay': overlay, 'receiptOverlayBuilderSha256': OVERLAY_BUILDER_SHA,
               'runtimeVerifierSha256': RUNTIME_HELPER_SHA, 'proxyVerifierSha256': PROXY_SHA, 'supportAclVerifierSha256': SUPPORT_SHA,
               'ordinary': actual, 'releaseId': RELEASE, 'role': ROLE, 'osUid': account.pw_uid, 'osGid': account.pw_gid,
               'privileges': rights, 'sourceSelection': selected, 'proxies': proxies, 'freeOnly': True, 'replayPermitIds': [],
               'newScanner': False, 'registrationOrGrantChanges': False, 'proxySourceDigest': PROXY_SOURCE}
    return {'reviewHash': sha(encoded(binding)), 'binding': binding, 'observation': observation['result'], 'executed': False}, runtime, proxy, support, runner, account


def save(path, value):
    with path.open('xb') as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(encoded(value) + b'\n')
        handle.flush()
        os.fsync(handle.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def apply(plan, expected):
    reviewed, runtime, proxy, support, runner, account = inspect(plan)
    if reviewed['reviewHash'] != expected:
        fail('exact_fresh_support_review_required')
    BASE.mkdir(mode=0o700, exist_ok=True)
    info = BASE.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        fail('private_support_proof_parent_required')
    sync_directory(BASE.parent)
    directory = BASE / plan['runId']
    directory.mkdir(mode=0o700)
    sync_directory(BASE)
    save(directory / 'review.json', reviewed)
    output = {'format': FORMAT, 'applied': False, 'reviewHash': expected, 'proofDirectory': str(directory)}
    try:
        before = runtime_state(runtime, plan)
        if before != reviewed['binding']['ordinary'] or proxy_state(proxy, before, plan['chains']) != reviewed['binding']['proxies'] or STOP:
            fail('support_runtime_changed_before_launch')
        if receipt_overlay() != reviewed['binding']['receiptOverlay']:
            fail('receipt_overlay_changed_before_launch')
        output['probe'] = run_peer(account, runner, config(plan), 'apply')
        if receipt_overlay() != reviewed['binding']['receiptOverlay']:
            fail('receipt_overlay_changed_during_support')
        after = runtime_state(runtime, plan)
        if after != before or proxy_state(proxy, after, plan['chains']) != reviewed['binding']['proxies'] or controls(support) != reviewed['binding']['sourceSelection']:
            fail('free_runtime_or_proxies_changed_during_support')
        observed = output['probe']
        if observed['returnCode'] or observed['result'].get('executed') is not True or observed['result'].get('successful') is not True:
            fail('finite_official_support_task_failed')
        output.update({'applied': True, 'sourceSelectionChanged': False, 'budgetOrPermitChanged': False, 'newScanner': False,
                       'paidDispatches': 0, 'workerIterationOnly': plan['task'] == 'worker', 'receiptHistoryCompleteClaimed': False})
        return output
    except Exception as error:
        output.update({'failure': failure(error), 'automaticRetryAllowed': False})
        raise
    finally:
        save(directory / 'result.json', output)


def public(value):
    binding = value.get('binding', {})
    plan = binding.get('plan', {})
    observed = value.get('probe', {}).get('result', {})
    return {'format': FORMAT, 'reviewHash': value['reviewHash'], 'applied': value.get('applied') is True,
            'sourceDigest': SOURCE, 'proxySourceDigest': PROXY_SOURCE, 'releaseId': RELEASE,
            'chains': plan.get('chains'), 'task': plan.get('task', observed.get('task')), 'freeOnly': True,
            'executed': observed.get('executed') is True, 'successful': observed.get('successful') is True,
            'requests': observed.get('requests', {}), 'workerIterationOnly': observed.get('workerIterationOnly') is True,
            'receiptValidationPerformed': observed.get('receiptValidationPerformed') is True, 'newScanner': False,
            'receiptHistoryCompleteClaimed': False, 'sourceAcceptanceClaimed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--apply')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('exact_production_root_required')
    plan = json.loads(trusted(args.plan))
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            fail('private_support_lease_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def stop(*_args):
            global STOP
            STOP = True
            raise InterruptedError('owned_support_operator_stopped')
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        print(json.dumps(public(apply(plan, args.apply) if args.apply else inspect(plan)[0])))
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'completed': False, 'errorClass': type(error).__name__, 'failureCode': failure(error), 'automaticRetryAllowed': False}))
        raise SystemExit(1)
