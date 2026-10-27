#!/usr/bin/env python3
"""One bounded header-pacing trial; the acknowledged source process never restarts."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import re
import signal
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-bnb-header-trial-v1-20261022')
FORMAT = 'yunipals-source6-bnb-header-trial-v1'
PARENT_HELPER = OPS / 'source6-bnb-transaction-route-v1.py'
PARENT_HELPER_SHA = '4d8228e8c1c88321dd5199be6a4e75631aaeedf77b8b9d09bc6f431ec7c6b13a'
PARENT = Path('/var/backups/yunipals-source6-bnb-transaction-route-v1-20261022/runtime.json')
PARENT_SHA = '60ebedb5c1361218315bfb14e9eb6d611fa0c342e56aa49a6ec4bf7658708414'
PARENT_INVOCATION = 'dab6fcd2704c461a9af2123168aec8f0'
UNIT = 'yunipals-market-production-rpc@bnb.service'
PUBLIC = OPS / 'source6-bnb-header-trial-v1.env'
DROP = Path('/etc/systemd/system') / (UNIT + '.d') / 'zzzzzzzzzzzzzzzzzzzzzzzz-bnb-header-trial-v1-20261022.conf'
BUILD = OPS / 'source6-selective-source-proxy-build-v5.py'
OUTPUT = OPS / 'source6-selective-source-proxy-v5'
BUILD_SHA = '4290ffd2001a8503bbd294cd63affa905af66852f1727399de48d73022e7d107'
RECEIPT_SHA = '2c2d841415cc36f9a1d6b3f21cc2d6c70a08fe93e7542082aae1dccabda3176b'
ENTRY_SHA = '10665db20d03b12f0a70bc36cdfec39f32cea7fec442912b47b9f52d07889495'
OBSERVER = OPS / 'source6-selective-phase-observer-v2.py'
OBSERVER_SHA = 'aea29545488f40c8106815daa646b9b7f7d05b5a9eaa598baaceeadaf365abad'
BASELINE_SECONDS = 60
TRIAL_SECONDS = 300
SAMPLE_SECONDS = 15
POOL_SHA = 'd75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b'
DBUS = ['/usr/bin/busctl', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager']


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def hash_ok(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64


def route():
    return {'primaryIndices': [1, 2, 3], 'poolSha256': POOL_SHA}


def required_pins():
    if not all(hash_ok(pin) for pin in [BUILD_SHA, RECEIPT_SHA, ENTRY_SHA, OBSERVER_SHA]):
        fail('actual_header_trial_artifact_pins_required')


def modules():
    required_pins()
    for path in [*PARENT_HELPER.parents, PARENT_HELPER]:
        s = path.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022: fail('protected_parent_operator_required')
    raw = PARENT_HELPER.read_bytes()
    if len(raw) > 200000 or sha(raw) != PARENT_HELPER_SHA: fail('exact_parent_operator_required')
    m = types.ModuleType('frozen_transaction_route'); m.__file__ = str(PARENT_HELPER)
    exec(compile(raw, str(PARENT_HELPER), 'exec'), m.__dict__)
    d = m.modules(); d.parent = m
    d.header_build = d.q.load(BUILD, BUILD_SHA, 'header_proxy_build')
    d.observer = d.q.load(OBSERVER, OBSERVER_SHA, 'scalar_observer')
    return d


def read(d, path, pin=None): return d.selective.read(d, path, pin)
def journal(d): return d.live.journal_for(d.q, BASE)


def source_parent(d):
    # Reuse the frozen source/artifact/deadline/financial proof. The predecessor
    # checks all three other proxies; only BNB is owned by this successor.
    ancestor, _, source = d.parent.source_parent(d)
    value = read(d, PARENT, PARENT_SHA)
    reviewed = read(d, d.parent.BASE / 'review.json', value['reviewSha256'])
    release = read(d, d.parent.BASE / 'transaction-route-handover-released.json')
    ack = d.parent.journal(d).latest('transaction-route_runtime_acknowledged')
    expected_effective = {'sourceRuntime': ancestor['effectiveRuntime'],
        'bnbProxyEntrySha256': d.parent.ENTRY_SHA, 'transactionRoute': route()}
    if (value.get('format') != d.parent.FORMAT or value.get('mode') != 'transaction-route' or
        value.get('reviewFile') != str(d.parent.BASE / 'review.json') or
        reviewed.get('operatorSha256') != PARENT_HELPER_SHA or
        value.get('parentRuntimeFile') != str(d.parent.PARENT) or value.get('parentRuntimeSha256') != d.parent.PARENT_SHA or
        value.get('freeOnly') is not True or value.get('paidAuthority') is not False or value.get('permitIds') != [] or
        value.get('sourceRestarted') is not False or value.get('sourceSelectionChanged') is not False or
        value.get('ordinaryRuntime') != source['ordinaryRuntime'] or value.get('clock') != ancestor['clock'] or
        value.get('financialHandoff') != ancestor['financialHandoff'] or value.get('effectiveRuntime') != expected_effective or
        value.get('sourceDefinitionSha256') != ancestor['definition']['sha256'] or
        reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or reviewed.get('clock') != ancestor['clock'] or
        reviewed.get('candidate') != d.parent.candidate(d) or
        reviewed.get('qualification') != d.parent.qualification(d, ancestor) or reviewed.get('transactionRoute') != route() or
        release != {'runtimeReceiptSha256': PARENT_SHA, 'sourceAndBnbHandoverLeasesReleased': True} or
        ack is None or ack.get('receiptFile') != str(PARENT) or ack.get('receiptSha256') != PARENT_SHA or
        any(os.path.lexists(d.parent.BASE / name) for name in ['failed.json', 'rollback-intent.json', 'rollback-failed.json'])):
        fail('exact_successful_transaction_parent_required')
    for key in ['sourceDigest', 'schema', 'nativeBuild', 'profile', 'parentReferences', 'runtimeScope']:
        if value.get(key) != ancestor[key]: fail('unchanged_source_lineage_required')
    for name in ['base', 'ethereum', 'polygon']:
        if value['proxies'][name] != ancestor['proxies'][name]: fail('unchanged_other_proxy_lineage_required')
    # The original source definition is inherited unchanged, not a new manifest.
    return {**value, 'definition': ancestor['definition']}, reviewed, source


def files():
    body = b'MARKET_RPC_PROXY_BNB_SELECTIVE_HEADER_MINIMUM_INTERVAL_MS=200\n'
    text = ('[Service]\nEnvironmentFile=' + str(PUBLIC) + '\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node ' + str(OUTPUT / 'rpc-budget-proxy.mjs') + '\n').encode()
    return body, text


def compare_metadata(parent, actual, selected):
    value = deepcopy(actual); expected = deepcopy(parent['proxies']['bnb']['metadata'])
    value.pop('invocation'); expected.pop('invocation')
    if selected:
        body, text = files()
        if (value['definitions'].pop(str(DROP), None) != sha(text) or
            not value['privateSettings']['orderedEnvironmentFiles'] or value['privateSettings']['orderedEnvironmentFiles'].pop() != str(PUBLIC) + ' (ignore_errors=no)' or
            not value['environmentFileHashes'] or value['environmentFileHashes'].pop() != {'path': str(PUBLIC), 'optional': False, 'exists': True, 'sha256': sha(body)}):
            fail('only_exact_BNB_public_header_overlay_allowed')
    if value != expected: fail('original_BNB_private_files_order_and_properties_must_not_change')


def metrics(d, parent, selected):
    d.parent.metrics(d, parent, True)  # The qualified transaction pool stays.
    value = d.v.request(19204, '/metrics')
    if value.get('bnbSelectiveHeaderMinimumIntervalMs') != (200 if selected else None):
        fail('exact_header_pacing_metric_required')
    scalars = d.observer.proxy_scalars(value)
    if scalars['load']['freeSourceMinimumIntervalMs'] != 400:
        fail('ordinary_source_pacing_must_remain_400')
    return scalars


def job(d):
    value = d.qe.bus_property(UNIT, 'org.freedesktop.systemd1.Unit', 'Job', '(uo)')
    if (not isinstance(value, list) or len(value) != 2 or type(value[0]) is not int or value[0] < 0 or
        value[1] != ('/org/freedesktop/systemd1/job/' + str(value[0]) if value[0] else '/')):
        fail('bounded_exact_BNB_job_identity_required')
    return value[0]


def proxy(d, parent, selected, terminal=False, unloaded_overlay=False):
    p = d.qe.observed(d.v, UNIT); body, text = files()
    if selected:
        if d.q.protected(PUBLIC, 2000) != body or d.q.protected(DROP, 2000) != text: fail('exact_owned_BNB_overlay_required')
        entry, pin = OUTPUT / 'rpc-budget-proxy.mjs', ENTRY_SHA
    else:
        if os.path.lexists(DROP) and not unloaded_overlay: fail('old_BNB_selector_required')
        entry, pin = d.parent.OUTPUT / 'rpc-budget-proxy.mjs', d.parent.ENTRY_SHA
    active = p['ActiveState'] == 'active' and p['SubState'] == 'running' and p['MainPID'].isdigit() and int(p['MainPID']) > 1
    stopped = terminal and p['ActiveState'] in {'inactive', 'failed'} and p['SubState'] in {'dead', 'failed'} and p['MainPID'] == '0'
    if (not (active or stopped) or p['User'] != 'yunipals-market-prod-rpc' or p['Group'] != 'yunipals-market-prod-rpc' or
        p['WorkingDirectory'] != str(d.selective_proxy.APP) or not (re.fullmatch('[0-9a-f]{32}', p['InvocationID']) or stopped and p['InvocationID'] == '') or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [str(d.selective_proxy.NODE) + ' ' + str(entry)] or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', p['ExecStart']) != [str(d.selective_proxy.NODE)] or
        sha(d.q.protected(entry, 3000000)) != pin): fail('exact_owned_BNB_process_or_terminal_required')
    actual = {'invocation': p['InvocationID'], 'definitions': d.v.definitions(p),
        'privateSettings': d.v.private_settings(p), 'environmentFileHashes': d.c.environment_hashes(d.v, p)}
    compare_metadata(parent, actual, selected)
    if stopped:
        group = d.qe.bus_property(UNIT, 'org.freedesktop.systemd1.Service', 'ControlGroup', 's')
        expected = '/system.slice/system-yunipals\\x2dmarket\\x2dproduction\\x2drpc.slice/' + UNIT
        if group and group != expected: fail('exact_BNB_cgroup_required')
        if group: d.seal.cgroup_empty(Path('/sys/fs/cgroup') / group.removeprefix('/'))
    return actual


def restart(d):
    if job(d): fail('no_preexisting_BNB_job_allowed')
    # A timeout before the returned job ID is captured is intentionally manual:
    # never guess ownership or cancel a job solely because it is on this unit.
    result = d.q.run([*DBUS, 'RestartUnit', 'ss', UNIT, 'fail'], timeout=5)
    match = re.fullmatch(r'o "(/org/freedesktop/systemd1/job/([1-9][0-9]*))"\s*', result)
    if not match: fail('exact_owned_restart_job_response_required')
    owned = int(match[2]); journal(d).emit('BNB_restart_job_created', jobId=owned)
    try:
        end = time.monotonic() + 45
        while time.monotonic() < end:
            current = job(d)
            if current == 0: return
            if current != owned: fail('foreign_BNB_job_blocks_transition')
            time.sleep(0.2)
        fail('bounded_BNB_restart_expired')
    except BaseException:
        if job(d) == owned:
            journal(d).emit('BNB_restart_job_cancel_intent', jobId=owned)
            try: d.q.run([*DBUS, 'CancelJob', 'u', str(owned)], timeout=5)
            except Exception:
                if job(d) == owned: fail('owned_BNB_job_cancellation_failed')
        raise


def candidate(d):
    receipt = d.header_build.validate_saved()
    if (sha(d.q.protected(OUTPUT / 'receipt.json', 100000)) != RECEIPT_SHA or receipt.get('entry') != str(OUTPUT / 'rpc-budget-proxy.mjs') or
        receipt.get('entrySha256') != ENTRY_SHA or d.header_build.NODE != d.selective_proxy.NODE or d.header_build.APP != d.selective_proxy.APP):
        fail('actual_proxy_only_candidate_required')
    d.renewal.candidate_access(d, receipt)
    return {'buildOperatorSha256': BUILD_SHA, 'buildReceiptSha256': RECEIPT_SHA, 'entrySha256': ENTRY_SHA}


def qualification(d, parent):
    _, reviewed, _ = source_parent(d)
    return reviewed['qualification']


def fresh():
    if os.path.lexists(BASE):
        s = BASE.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or any(BASE.iterdir()): fail('one_fresh_BNB_only_transition_required')


def review(d):
    fresh(); d.parent.validate_with(d, str(PARENT), PARENT_SHA)
    parent, _, source = source_parent(d)
    if parent['clock']['originalRuntimeExpiresMonotonicMicroseconds'] - d.selective.monotonic_us() < 900000000:
        fail('original_source_deadline_transition_headroom_required')
    if any(os.path.lexists(path) for path in [PUBLIC, DROP]) or any(Path(path).name >= DROP.name for path in parent['proxies']['bnb']['metadata']['definitions']):
        fail('fresh_last_BNB_only_overlay_required')
    if job(d): fail('no_preexisting_BNB_job_allowed')
    metrics(d, parent, False)
    return {'format': FORMAT, 'operatorSha256': sha(d.q.protected(Path(__file__).absolute(), 200000)),
        'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA, 'parentHelperSha256': PARENT_HELPER_SHA,
        'sourceIdentity': source['ordinaryRuntime'], 'sourceDefinitionSha256': parent['definition']['sha256'], 'clock': parent['clock'],
        'financialHandoff': parent['financialHandoff'], 'proxies': parent['proxies'], 'candidate': candidate(d),
        'qualification': qualification(d, parent), 'transactionRoute': route(),
        'freeOnly': True, 'paidAuthority': False, 'permitIds': [], 'sourceSelectionChanged': False,
        'sourceRestartAllowed': False, 'automaticRetryAllowed': False,
        'trial': {'baselineSeconds': BASELINE_SECONDS, 'maximumTrialSeconds': TRIAL_SECONDS, 'sampleSeconds': SAMPLE_SECONDS,
            'oldMinimumIntervalMs': 400, 'trialMinimumIntervalMs': 200, 'requireBlockInsertRateImprovement': True,
            'rollbackOnQualifiedHeaderFailureOrCooldown': True, 'scalarObserverSha256': OBSERVER_SHA}}


def classify(d, parent):
    body, text = files(); present = [os.path.lexists(PUBLIC), os.path.lexists(DROP)]
    for exists, path, raw in zip(present, [PUBLIC, DROP], [body, text]):
        if exists and d.q.protected(path, 2000) != raw: fail('foreign_overlay_blocks_BNB_recovery')
    if present[1] and not present[0]: fail('incomplete_unowned_BNB_selector')
    intent = read(d, BASE / 'intent.json')
    if intent.get('parentRuntimeSha256') != PARENT_SHA or intent.get('sourceInvocation') != PARENT_INVOCATION or job(d):
        fail('owned_transition_without_pending_job_required')
    if intent.get('bootId') != d.selective.boot_id() or type(intent.get('earliestStartMonotonicUs')) is not int:
        fail('same_boot_owned_BNB_intent_required')
    selected = present[1]
    try: actual = proxy(d, parent, selected, terminal=True)
    except RuntimeError:
        if not selected: raise
        # Exact public files may exist before daemon-reload; accept the full old
        # loaded definition only, while retaining/removing those owned files.
        actual = proxy(d, parent, False, terminal=True, unloaded_overlay=True)
        selected = False
    if actual['invocation'] not in {'', parent['proxies']['bnb']['metadata']['invocation']}:
        started = d.qe.bus_property(UNIT, 'org.freedesktop.systemd1.Service', 'ExecMainStartTimestampMonotonic', 't')
        if type(started) is not int or started < intent['earliestStartMonotonicUs']: fail('unowned_BNB_invocation_blocks_recovery')
    observed = d.qe.observed(d.v, UNIT)
    terminal = observed['MainPID'] == '0' and observed['ActiveState'] in {'inactive', 'failed'}
    return selected, actual, present, terminal


def save_runtime(d, reviewed, parent, source, metadata, mode):
    if job(d) or proxy(d, parent, mode == 'header-trial') != metadata:
        fail('BNB_identity_must_remain_stable_before_ACK')
    d.selective.runtime(d, parent['definition'], parent['clock'], 'selective', saved=source['ordinaryRuntime'])
    value = {'format': FORMAT, 'mode': mode, 'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA,
        'reviewFile': str(BASE / 'review.json'), 'reviewSha256': sha(encoded(reviewed)), 'ordinaryRuntime': source['ordinaryRuntime'],
        'sourceDefinitionSha256': parent['definition']['sha256'], 'clock': parent['clock'], 'financialHandoff': parent['financialHandoff'],
        'effectiveRuntime': {'sourceRuntime': parent['effectiveRuntime'], 'bnbProxyEntrySha256': ENTRY_SHA if mode == 'header-trial' else d.parent.ENTRY_SHA,
            'transactionRoute': route(), 'headerMinimumIntervalMs': 200 if mode == 'header-trial' else 400},
        'proxies': {**parent['proxies'], 'bnb': {'metadata': metadata, 'configuration': parent['proxies']['bnb']['configuration']}},
        'freeOnly': True, 'paidAuthority': False, 'permitIds': [], 'sourceSelectionChanged': False, 'sourceRestarted': False,
        'sourceDigest': parent['sourceDigest'], 'schema': parent['schema'], 'nativeBuild': parent['nativeBuild'], 'profile': parent['profile'],
        'parentReferences': parent['parentReferences'], 'runtimeScope': parent['runtimeScope'], 'checkpointsAtAcknowledgment': source['checkpoints']}
    path = BASE / ('runtime.json' if mode == 'header-trial' else 'rollback-runtime.json'); pin = d.q.save(path, value)
    journal(d).emit(mode + '_runtime_acknowledged', receiptFile=str(path), receiptSha256=pin)
    return path, pin


def released(d, mode, path, pin):
    release = BASE / (mode + '-handover-released.json')
    release_sha = d.q.save(release, {'runtimeReceiptSha256': pin, 'sourceAndBnbHandoverLeasesReleased': True})
    return {'format': FORMAT, 'mode': mode, 'runtimeReceiptFile': str(path), 'runtimeReceiptSha256': pin,
        'leaseReleasedFile': str(release), 'leaseReleasedSha256': release_sha, 'sourceStarted': False, 'sourceRestarted': False,
        'paidAuthority': False, 'sourceSelectionChanged': False}


def activate(d, expected, baseline):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease()); locks.enter_context(d.v.chain_lock('bnb'))
        reviewed = review(d)
        if sha(encoded(reviewed)) != expected: fail('exact_fresh_BNB_only_review_required')
        parent, _, before = source_parent(d)
        BASE.mkdir(mode=0o700, exist_ok=True); d.q.sync_directory(BASE.parent)
        d.q.save(BASE / 'review.json', reviewed)
        d.q.save(BASE / 'baseline.json', baseline)
        d.q.save(BASE / 'intent.json', {'reviewHash': expected, 'parentRuntimeSha256': PARENT_SHA, 'sourceInvocation': PARENT_INVOCATION,
            'earliestStartMonotonicUs': d.selective.monotonic_us(), 'bootId': d.selective.boot_id(), 'automaticRetryAllowed': False})
        try:
            d.parent.validate_with(d, str(PARENT), PARENT_SHA)
            body, text = files(); d.ordinary.public_write(d.q, PUBLIC, body); d.ordinary.public_write(d.q, DROP, text)
            d.q.run(['/usr/bin/systemctl', 'daemon-reload']); restart(d)
            actual = proxy(d, parent, True)
            if actual['invocation'] == parent['proxies']['bnb']['metadata']['invocation']: fail('new_BNB_invocation_required')
            d.v.retry(lambda: metrics(d, parent, True))
            parent, _, after = source_parent(d)
            if before['ordinaryRuntime'] != after['ordinaryRuntime']: fail('source_process_must_not_restart')
            path, pin = save_runtime(d, reviewed, parent, after, actual, 'header-trial')
        except BaseException as error:
            d.q.save(BASE / 'failed.json', {'failure': d.normal.failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'header-trial', path, pin)


def validate_with(d, receipt_file, receipt_sha):
    path = Path(receipt_file); mode = 'header-trial' if path == BASE / 'runtime.json' else 'rollback'
    if path not in {BASE / 'runtime.json', BASE / 'rollback-runtime.json'}: fail('exact_successor_receipt_path_required')
    value = read(d, path, receipt_sha); reviewed = read(d, BASE / 'review.json', value['reviewSha256'])
    if (value.get('format') != FORMAT or value.get('mode') != mode or reviewed['operatorSha256'] != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
        value.get('parentRuntimeSha256') != PARENT_SHA or value.get('parentRuntimeFile') != str(PARENT) or value.get('reviewFile') != str(BASE / 'review.json') or
        value.get('freeOnly') is not True or value.get('paidAuthority') is not False or value.get('permitIds') != [] or
        value.get('sourceRestarted') is not False or value.get('sourceSelectionChanged') is not False or
        os.path.lexists(BASE / 'rollback-failed.json') or (mode == 'header-trial' and any(os.path.lexists(BASE / name) for name in ['failed.json', 'rollback-intent.json']))):
        fail('successful_unsuperseded_BNB_successor_required')
    release = read(d, BASE / (mode + '-handover-released.json'))
    if release != {'runtimeReceiptSha256': receipt_sha, 'sourceAndBnbHandoverLeasesReleased': True}: fail('actual_BNB_successor_lease_release_required')
    ack = journal(d).latest(mode + '_runtime_acknowledged')
    if ack is None or ack.get('receiptFile') != str(path) or ack.get('receiptSha256') != receipt_sha: fail('actual_successor_ACK_required')
    if mode == 'rollback' and os.path.lexists(BASE / 'failed.json'):
        recovered = read(d, BASE / 'recovery-completed.json')
        if recovered != {'failedSha256': sha(d.q.protected(BASE / 'failed.json', 100000)), 'runtimeReceiptSha256': receipt_sha}: fail('actual_recovery_ACK_required')
    parent, _, source = source_parent(d); selected = mode == 'header-trial'
    actual = proxy(d, parent, selected); metrics(d, parent, selected)
    if (job(d) or any(value.get(k) != parent[k] for k in ['sourceDigest', 'schema', 'nativeBuild', 'profile', 'parentReferences', 'runtimeScope']) or
        reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or reviewed.get('clock') != parent['clock'] or
        reviewed.get('parentRuntimeSha256') != PARENT_SHA or reviewed.get('parentHelperSha256') != PARENT_HELPER_SHA or
        value['ordinaryRuntime'] != source['ordinaryRuntime'] or value['clock'] != parent['clock'] or
        value['sourceDefinitionSha256'] != parent['definition']['sha256'] or value['financialHandoff'] != parent['financialHandoff'] or
        value['effectiveRuntime'] != {'sourceRuntime': parent['effectiveRuntime'], 'bnbProxyEntrySha256': ENTRY_SHA if selected else d.parent.ENTRY_SHA,
            'transactionRoute': route(), 'headerMinimumIntervalMs': 200 if selected else 400} or value['proxies'] != {**parent['proxies'], 'bnb': {'metadata': actual, 'configuration': parent['proxies']['bnb']['configuration']}} or
        reviewed['candidate'] != candidate(d) or reviewed['qualification'] != qualification(d, parent) or reviewed['transactionRoute'] != route()):
        fail('unchanged_source_and_acknowledged_BNB_runtime_required')
    return {**value, 'checkpoints': source['checkpoints'], 'leaseReleasedFile': str(BASE / (mode + '-handover-released.json')), 'leaseReleasedSha256': sha(encoded(release))}


def validate_current(receipt_file, receipt_sha): return validate_with(modules(), receipt_file, receipt_sha)


def restore(d, expected, recovery):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease()); locks.enter_context(d.v.chain_lock('bnb'))
        if any(os.path.lexists(BASE / name) for name in ['rollback-intent.json', 'rollback-runtime.json', 'rollback-failed.json']): fail('one_BNB_restoration_only')
        if recovery:
            failure = read(d, BASE / 'failed.json', expected)
            if failure.get('manualReconcileRequired') is not True or failure.get('automaticRetryAllowed') is not False: fail('exact_failed_transition_required')
        else: validate_with(d, str(BASE / 'runtime.json'), expected)
        parent, _, source = source_parent(d); intent = read(d, BASE / 'intent.json')
        reviewed = read(d, BASE / 'review.json', intent['reviewHash'])
        if (reviewed.get('operatorSha256') != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
            reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or reviewed.get('clock') != parent['clock'] or
            reviewed.get('candidate') != candidate(d) or reviewed.get('qualification') != qualification(d, parent) or
            reviewed.get('transactionRoute') != route()): fail('exact_owned_restoration_review_required')
        selected, before, present, terminal = classify(d, parent)
        d.q.save(BASE / 'rollback-intent.json', {'inputSha256': expected, 'recovery': recovery, 'before': before})
        try:
            if classify(d, parent) != (selected, before, present, terminal): fail('BNB_state_changed_before_restoration')
            body, text = files()
            for exists, path, raw in [(present[1], DROP, text), (present[0], PUBLIC, body)]:
                if exists:
                    if d.q.protected(path, 2000) != raw: fail('foreign_BNB_restore_bytes')
                    path.unlink(); d.q.sync_directory(path.parent)
            d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
            if selected or terminal: restart(d)
            actual = proxy(d, parent, False); d.v.retry(lambda: metrics(d, parent, False))
            parent, _, after = source_parent(d)
            if source['ordinaryRuntime'] != after['ordinaryRuntime']: fail('source_process_must_not_restart')
            path, pin = save_runtime(d, reviewed, parent, after, actual, 'rollback')
            if recovery: d.q.save(BASE / 'recovery-completed.json', {'failedSha256': expected, 'runtimeReceiptSha256': pin})
        except BaseException as error:
            d.q.save(BASE / 'rollback-failed.json', {'failure': d.normal.failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'rollback', path, pin)


def sample(d, parent, selected, expected_invocation):
    d.selective.runtime(d, parent['definition'], parent['clock'], 'selective', saved=parent['ordinaryRuntime'])
    before = proxy(d, parent, selected)
    if job(d) or before['invocation'] != expected_invocation: fail('same_acknowledged_BNB_invocation_required')
    scalar = metrics(d, parent, selected)
    rows = [row for row in d.observer.metrics() if row['name'] == 'ponder_database_method_duration_count' and row['labels'] == {'method': 'insert_blocks'}]
    if len(rows) != 1 or type(rows[0]['value']) not in {int, float} or not math.isfinite(rows[0]['value']) or rows[0]['value'] < 0:
        fail('one_finite_source_block_insert_counter_required')
    if proxy(d, parent, selected) != before or job(d): fail('stable_BNB_sample_identity_required')
    return {'monotonicSeconds': time.monotonic(), 'blockInsertCount': rows[0]['value'],
        'qualifiedHeader': scalar['qualifiedEndpoint'], 'sourcePaidCalls': scalar['unifiedSource']['paidCalls'],
        'sourcePacingTimeouts': scalar['traffic']['sourcePacingTimeouts'], 'proxyInvocation': expected_invocation}


def rate(first, last):
    elapsed = last['monotonicSeconds'] - first['monotonicSeconds']
    delta = last['blockInsertCount'] - first['blockInsertCount']
    if not math.isfinite(elapsed) or elapsed <= 0 or not math.isfinite(delta) or delta < 0:
        fail('monotonic_progress_samples_required')
    return {'seconds': elapsed, 'blockInserts': delta, 'blockInsertsPerSecond': delta / elapsed}


def assess(baseline, samples, interrupted=False):
    previous = rate(baseline[0], baseline[-1])
    current = rate(samples[0], samples[-1]) if len(samples) > 1 else None
    faulty = any(row['qualifiedHeader']['failures'] > 0 or row['qualifiedHeader']['coolingDown'] or row['sourcePaidCalls'] != 0 for row in samples)
    complete = current is not None and current['seconds'] >= TRIAL_SECONDS
    improved = complete and previous['blockInsertsPerSecond'] > 0 and current['blockInsertsPerSecond'] > previous['blockInsertsPerSecond']
    keep = improved and not faulty and not interrupted
    return {'baseline': previous, 'trial': current, 'sampleCount': len(samples), 'completeFiveMinuteObservation': complete,
        'qualifiedHeaderFailureOrCooldown': faulty, 'observationFailed': interrupted, 'improved': bool(improved),
        'decision': 'retain_200ms' if keep else 'restore_previous_400ms',
        'counterScope': 'source_sync_store_insert_blocks_all_chains', 'whole_history_eta_proven': False}


def apply(d, expected):
    # No selectors are touched until the finite baseline and fresh review pass.
    reviewed = review(d)
    if sha(encoded(reviewed)) != expected: fail('exact_fresh_BNB_only_review_required')
    parent, _, _ = source_parent(d)
    old_invocation = parent['proxies']['bnb']['metadata']['invocation']
    first = sample(d, parent, False, old_invocation)
    time.sleep(BASELINE_SECONDS)
    last = sample(d, parent, False, old_invocation)
    baseline = [first, last]
    if rate(first, last)['blockInserts'] <= 0: fail('active_replay_baseline_required')
    activated = activate(d, expected, baseline)
    try:
        # This point is reached only after a durable startup AND lease-release ACK.
        value = validate_with(d, activated['runtimeReceiptFile'], activated['runtimeReceiptSha256'])
        invocation = value['proxies']['bnb']['metadata']['invocation']
        samples = []; interrupted = False; failure_code = None
        try:
            samples.append(sample(d, parent, True, invocation))
            until = samples[0]['monotonicSeconds'] + TRIAL_SECONDS
            while time.monotonic() < until:
                if samples[-1]['qualifiedHeader']['failures'] or samples[-1]['qualifiedHeader']['coolingDown']: break
                time.sleep(min(SAMPLE_SECONDS, max(0, until - time.monotonic())))
                samples.append(sample(d, parent, True, invocation))
        except Exception as error:
            interrupted = True; failure_code = d.normal.failure(error)
        decision = assess(baseline, samples, interrupted)
        assessment = {'format': FORMAT, 'runtimeReceiptSha256': activated['runtimeReceiptSha256'],
            'samples': samples, 'failure': failure_code, **decision}
        assessment_sha = d.q.save(BASE / 'assessment.json', assessment)
        if decision['decision'] == 'restore_previous_400ms':
            # An explicit, once-only reversal of this acknowledged transition. The
            # same source/owned-file/job guards still run; ambiguity never retries.
            result = restore(d, activated['runtimeReceiptSha256'], False)
        else:
            validate_with(d, activated['runtimeReceiptFile'], activated['runtimeReceiptSha256'])
            result = activated
        return {**result, 'assessmentFile': str(BASE / 'assessment.json'), 'assessmentSha256': assessment_sha,
            'trialDecision': decision['decision'], 'baseline': decision['baseline'], 'trial': decision['trial']}
    except BaseException as error:
        if not any(os.path.lexists(BASE / name) for name in ['failed.json', 'rollback-intent.json', 'rollback-failed.json']):
            d.q.save(BASE / 'failed.json', {'failure': d.normal.failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
        raise



def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    for name in ['apply', 'rollback', 'recover', 'validate']: group.add_argument('--' + name)
    args = parser.parse_args(); d = modules()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_required')
    d.q.actual_root_capabilities(); os.umask(0o077)
    def interrupted(*_): raise InterruptedError('bounded_BNB_transition_interrupted')
    for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]: signal.signal(sig, interrupted)
    signal.alarm(650)
    try:
        if args.apply: result = apply(d, args.apply)
        elif args.rollback: result = restore(d, args.rollback, False)
        elif args.recover: result = restore(d, args.recover, True)
        elif args.validate: result = validate_with(d, str(BASE / 'runtime.json'), args.validate)
        else:
            binding = review(d); result = {'reviewHash': sha(encoded(binding)), 'binding': binding}
        print(json.dumps(result, sort_keys=True))
    finally: signal.alarm(0)


if __name__ == '__main__': main()
