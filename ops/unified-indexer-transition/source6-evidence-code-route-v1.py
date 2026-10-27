#!/usr/bin/env python3
"""Replace only diagnosed non-BNB evidence proxies; preserve source and workers."""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import signal
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-evidence-code-route-v1-20261022')
FORMAT = 'yunipals-source6-evidence-code-route-v1'
PARENT_HELPER = OPS / 'source6-bnb-native-recovery-v4.py'
PARENT_HELPER_SHA = 'a5c47a2335364735b9a134da7162127286ec0261d19a9d19fd23f1e7a87cb33e'
PARENT = Path('/var/backups/yunipals-source6-bnb-native-recovery-v4-20261022/runtime.json')
PARENT_SHA = '3cd3a36ffad6fd31569835682fd02f6b0100d4d8d5a7b63ee86e1f8eeeede7b8'
PARENT_INVOCATION = '2bfcf40e5b054e9c943dd54dca8fc824'
BUILD = OPS / 'source6-selective-source-proxy-build-v6.py'
OUTPUT = OPS / 'source6-selective-source-proxy-v6'
BUILD_SHA = '97302630690246693ad5958ccf6543215c5a1b08ee8c8bf17985af5e36a277c8'
RECEIPT_SHA = '59602189ef97f1c18d2256ee2a128270bb4ee3a4cfec7cf9763256db5aba002c'
ENTRY_SHA = 'd8e58d18f7f88bb8b13d4f2d85d562ddd71f7ffc2c96b913410d5a656202f5c8'
# Fixed after diagnosis; no CLI-provided chain/target or guessed artifact pins.
CHAINS = ('base', 'ethereum', 'polygon')
DIAGNOSIS = {'base': '8614aa9f4464b633f22eff0cc6efbb3384a72b61472e37e5ac36554779fa117e',
             'ethereum': '69bdfa4358123f983da84a2a85821cb4d8ed33fb3240ea1e083803722886288a',
             'polygon': '8614aa9f4464b633f22eff0cc6efbb3384a72b61472e37e5ac36554779fa117e'}
SUPPORT_HELPER = OPS / 'support-source6-normal-reconcile-v1.py'
SUPPORT_HELPER_SHA = '9a1acc96df94e0eccf78b51a53813141cd5d9447ac050d23bd84a54a99327dbb'
SUPPORT_RECEIPT = Path('/var/backups/yunipals-source6-normal-support-v1-20261022/reconcile-result.json')
SUPPORT_RECEIPT_SHA = '1710b0df36231900f0e61a0cb3135ad16187fdb39ce384c5554864ddd99ad37d'
DBUS = ['/usr/bin/busctl', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager']
DROP_NAME = 'zzzzzzzzzzzzzzzzzzzzzzzzz-evidence-code-v1-20261022.conf'


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def hash_ok(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64


def required_pins():
    if not all(hash_ok(pin) for pin in [BUILD_SHA, RECEIPT_SHA, ENTRY_SHA]): fail('actual_evidence_proxy_build_pins_required')
    if not hash_ok(PARENT_SHA) or not isinstance(PARENT_INVOCATION,str) or not re.fullmatch('[0-9a-f]{32}',PARENT_INVOCATION):
        fail('actual_recovered_source_receipt_and_invocation_required')
    if (type(CHAINS) is not tuple or not CHAINS or tuple(sorted(set(CHAINS))) != CHAINS or
        not set(CHAINS) <= {'base', 'ethereum', 'polygon'}): fail('fixed_diagnosed_non_BNB_chain_set_required')
    if not isinstance(DIAGNOSIS, dict) or set(DIAGNOSIS) != set(CHAINS) or any(not hash_ok(v) for v in DIAGNOSIS.values()):
        fail('actual_diagnosis_receipt_pins_required')


def modules():
    required_pins()
    for path in [*PARENT_HELPER.parents, PARENT_HELPER]:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: fail('protected_parent_operator_required')
    raw = PARENT_HELPER.read_bytes()
    if len(raw) > 200000 or sha(raw) != PARENT_HELPER_SHA: fail('exact_parent_operator_required')
    m = types.ModuleType('frozen_recovery'); m.__file__ = str(PARENT_HELPER)
    exec(compile(raw, str(PARENT_HELPER), 'exec'), m.__dict__)
    d = m.modules(); d.recovery = m
    d.evidence_build = d.q.load(BUILD, BUILD_SHA, 'evidence_proxy_build')
    d.support_reconcile = d.q.load(SUPPORT_HELPER, SUPPORT_HELPER_SHA, 'same_support_identity')
    return d


def read(d, path, pin=None): return d.selective.read(d, path, pin)
def journal(d): return d.live.journal_for(d.q, BASE)


def capture_parent(d):
    """Full frozen parent validation runs only before any proxy replacement."""
    checked=d.recovery.validate_current(str(PARENT),PARENT_SHA)
    parent=read(d,PARENT,PARENT_SHA)
    if (parent.get('ordinaryRuntime',{}).get('invocation')!=PARENT_INVOCATION or
        any(checked.get(k)!=v for k,v in parent.items())):
        fail('exact_acknowledged_recovered_parent_required')
    return parent,{'ordinaryRuntime':checked['ordinaryRuntime'],'checkpoints':checked['checkpoints'],'sourceRole':parent['sourceRole']}


def captured_source(d,reviewed):
    """Revalidate source/BNB/authority without requiring replaced old proxies.

    The captured parent was fully verified before transition and is bound by its
    exact original receipt hash plus this operation's durable review. We still
    re-read immutable inputs, financial state, recovery ACK and the live source;
    no old non-BNB process check is bypassed by pretending it remains selected.
    """
    parent=read(d,PARENT,PARENT_SHA)
    if (parent!=reviewed.get('capturedParent') or reviewed.get('parentRuntimeSha256')!=PARENT_SHA or
        reviewed.get('parentRuntimeFile')!=str(PARENT) or reviewed.get('parentHelperSha256')!=PARENT_HELPER_SHA or
        parent.get('ordinaryRuntime',{}).get('invocation')!=PARENT_INVOCATION or
        parent.get('freeOnly') is not True or parent.get('paidAuthority') is not False or parent.get('permitIds')!=[] or
        parent.get('sourceSelectionChanged') is not False):
        fail('exact_preverified_parent_capture_required')
    ancestor,_=d.selective.inherited(d)
    if (parent['financialHandoff']!=ancestor['financialHandoff'] or
        d.selective.historical_overlay(d)!=reviewed['historicalOverlay'] or
        parent['definition']!=d.selective.render_definition(d,ancestor,parent['clock'],parent['repairReceiptSha256'],
            'selective',parent['definition']['maximumRuntimeSeconds'])):
        fail('unchanged_source_inputs_finance_deadline_and_definition_required')
    # Revalidate durable native recovery files without calling ancestry(), whose
    # pre-transition non-BNB proxy identities are now intentionally superseded.
    d.recovery.repair_receipt(d,parent['repairReceiptSha256'])
    definition=read(d,d.recovery.BASE/'recovery-definition.json')
    intent=read(d,d.recovery.BASE/'start-intent.json')
    ack=d.recovery.journal(d).latest('recovered_source_runtime_acknowledged')
    if (definition!=parent['definition'] or intent.get('definitionSha256')!=definition['sha256'] or
        intent.get('repairReceiptSha256')!=parent['repairReceiptSha256'] or
        read(d,d.recovery.BASE/'handover-released.json')!={'runtimeReceiptSha256':PARENT_SHA,'sourceAndChainHandoverLeasesReleased':True} or
        ack is None or ack.get('receiptFile')!=str(PARENT) or ack.get('receiptSha256')!=PARENT_SHA or
        ack.get('invocation')!=PARENT_INVOCATION or os.path.lexists(d.recovery.BASE/'start-failed.json')):
        fail('unchanged_acknowledged_recovery_required')
    actual=d.selective.runtime(d,definition,parent['clock'],'selective',saved=parent['ordinaryRuntime'])
    if d.recovery.source_job(d):fail('no_source_job_during_proxy_only_transition')
    d.ordinary.source_health()
    peer=d.recovery.source_state(d.q,d.qe,d.native,parent['sourceRole'],running=True)
    # Header proxy's comparison expects its exact transaction-route predecessor,
    # not the already overlaid captured metadata. Both receipts are hash-pinned.
    transaction_parent=read(d,d.header.PARENT,d.header.PARENT_SHA)
    bnb=d.header.proxy(d,transaction_parent,True)
    d.header.metrics(d,transaction_parent,True)
    if bnb!=parent['proxies']['bnb']['metadata'] or d.header.job(d):fail('unchanged_BNB_proxy_required')
    return parent,{'ordinaryRuntime':actual,'checkpoints':peer['checkpoints'],'sourceRole':peer['role']}


def support_identity(d):
    return d.recovery.support_identity(d)


def support_unchanged(d,expected):
    if not d.recovery.support_matches(support_identity(d),expected):
        fail('support_identity_changed_during_proxy_transition')


def unit(name):
    if name not in CHAINS: fail('only_diagnosed_proxy_units_allowed')
    return 'yunipals-market-production-rpc@' + name + '.service'


def files(name):
    public = OPS / ('source6-evidence-code-v1-' + name + '.env')
    drop = Path('/etc/systemd/system') / (unit(name) + '.d') / DROP_NAME
    body = (b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=false\n'
            b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=false\n')
    text = ('[Service]\nEnvironmentFile=' + str(public) + '\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node ' +
            str(OUTPUT / 'rpc-budget-proxy.mjs') + '\n').encode()
    return public, drop, body, text


def original_entry(d, name):
    if name == 'base':
        return d.selective.PROXY_OUTPUT / 'rpc-budget-proxy.mjs', d.selective.PROXY_ENTRY_SHA, d.selective_proxy.APP
    return d.n.ROOT / 'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs', d.n.PROXY_SHA, d.n.ROOT / 'apps/yunipals-market-api'


def compare_metadata(parent, actual, name, selected):
    value = deepcopy(actual); expected = deepcopy(parent['proxies'][name]['metadata'])
    value.pop('invocation'); expected.pop('invocation')
    if selected:
        public, drop, body, text = files(name)
        if (value['definitions'].pop(str(drop), None) != sha(text) or
            not value['privateSettings']['orderedEnvironmentFiles'] or value['privateSettings']['orderedEnvironmentFiles'].pop() != str(public) + ' (ignore_errors=no)' or
            not value['environmentFileHashes'] or value['environmentFileHashes'].pop() != {'path': str(public), 'optional': False, 'exists': True, 'sha256': sha(body)}):
            fail('only_exact_evidence_code_overlay_allowed')
    if value != expected: fail('original_proxy_private_files_order_and_properties_must_not_change')


def job(d, name):
    value = d.qe.bus_property(unit(name), 'org.freedesktop.systemd1.Unit', 'Job', '(uo)')
    if (not isinstance(value, list) or len(value) != 2 or type(value[0]) is not int or value[0] < 0 or
        value[1] != ('/org/freedesktop/systemd1/job/' + str(value[0]) if value[0] else '/')):
        fail('bounded_exact_proxy_job_identity_required')
    return value[0]


def proxy(d, parent, name, selected, terminal=False, unloaded_overlay=False):
    p = d.qe.observed(d.v, unit(name)); public, drop, body, text = files(name)
    old_entry, old_pin, cwd = original_entry(d, name)
    if selected:
        if d.q.protected(public, 2000) != body or d.q.protected(drop, 2000) != text: fail('exact_owned_proxy_overlay_required')
        entry, pin = OUTPUT / 'rpc-budget-proxy.mjs', ENTRY_SHA
    else:
        if os.path.lexists(drop) and not unloaded_overlay: fail('old_proxy_selector_required')
        entry, pin = old_entry, old_pin
    active = p['ActiveState'] == 'active' and p['SubState'] == 'running' and p['MainPID'].isdigit() and int(p['MainPID']) > 1
    stopped = terminal and p['ActiveState'] in {'inactive', 'failed'} and p['SubState'] in {'dead', 'failed'} and p['MainPID'] == '0'
    if (not (active or stopped) or p['User'] != 'yunipals-market-prod-rpc' or p['Group'] != 'yunipals-market-prod-rpc' or
        p['WorkingDirectory'] != str(cwd) or not (re.fullmatch('[0-9a-f]{32}', p['InvocationID']) or stopped and p['InvocationID'] == '') or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [str(d.selective_proxy.NODE) + ' ' + str(entry)] or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', p['ExecStart']) != [str(d.selective_proxy.NODE)] or
        sha(d.q.protected(entry, 3000000)) != pin): fail('exact_owned_proxy_process_or_terminal_required')
    actual = {'invocation': p['InvocationID'], 'definitions': d.v.definitions(p),
        'privateSettings': d.v.private_settings(p), 'environmentFileHashes': d.c.environment_hashes(d.v, p)}
    compare_metadata(parent, actual, name, selected)
    if stopped:
        group = d.qe.bus_property(unit(name), 'org.freedesktop.systemd1.Service', 'ControlGroup', 's')
        expected = '/system.slice/system-yunipals\\x2dmarket\\x2dproduction\\x2drpc.slice/' + unit(name)
        if group and group != expected: fail('exact_proxy_cgroup_required')
        if group: d.seal.cgroup_empty(Path('/sys/fs/cgroup') / group.removeprefix('/'))
    return actual


def metrics(d, parent, name):
    # No provider dispatch. Existing preflight/metrics validate profile, pool,
    # free route and RAM-budget state while traffic counters may advance.
    d.selective.selected_proxy_health(d, name, parent['proxies'][name]['configuration'], zero=False)
    _, port = d.ordinary.CHAINS[name]
    value = d.v.request(port, '/metrics'); unified = value.get('unified', {})
    if (value.get('freeRouting') is not True or value.get('paidFallbackOnFreeFailure') is not False or
        value.get('sourcePaidFallbackOnFreeFailure') is not False or unified.get('sourceRouting') != 'free_first'):
        fail('free_only_proxy_routes_required')
    for workload in ['unified_source', 'unified_evidence']:
        count = unified.get('traffic', {}).get(workload, {}).get('paidCalls')
        if type(count) is not int or count != 0: fail('zero_source_and_evidence_paid_calls_required')
    if unified.get('selectiveTransactions') is not None or unified.get('selective') is not None or value.get('bnbSelectiveHeaderMinimumIntervalMs') is not None:
        fail('non_BNB_proxy_must_not_gain_BNB_routing')


def restart(d, name):
    if job(d, name): fail('no_preexisting_proxy_job_allowed')
    result = d.q.run([*DBUS, 'RestartUnit', 'ss', unit(name), 'fail'], timeout=5)
    match = re.fullmatch(r'o "(/org/freedesktop/systemd1/job/([1-9][0-9]*))"\s*', result)
    if not match: fail('exact_owned_restart_job_response_required')
    owned = int(match[2]); journal(d).emit('proxy_restart_job_created', chain=name, jobId=owned)
    try:
        end = time.monotonic() + 45
        while time.monotonic() < end:
            current = job(d, name)
            if current == 0: return
            if current != owned: fail('foreign_proxy_job_blocks_transition')
            time.sleep(0.2)
        fail('bounded_proxy_restart_expired')
    except BaseException:
        if job(d, name) == owned:
            journal(d).emit('proxy_restart_job_cancel_intent', chain=name, jobId=owned)
            try: d.q.run([*DBUS, 'CancelJob', 'u', str(owned)], timeout=5)
            except Exception:
                if job(d, name) == owned: fail('owned_proxy_job_cancellation_failed')
        raise


def candidate(d):
    receipt = d.evidence_build.validate_saved()
    if (sha(d.q.protected(OUTPUT / 'receipt.json', 100000)) != RECEIPT_SHA or receipt.get('entry') != str(OUTPUT / 'rpc-budget-proxy.mjs') or
        receipt.get('entrySha256') != ENTRY_SHA or d.evidence_build.NODE != d.selective_proxy.NODE or d.evidence_build.APP != d.selective_proxy.APP):
        fail('actual_proxy_only_candidate_required')
    d.renewal.candidate_access(d, receipt)
    return {'buildOperatorSha256': BUILD_SHA, 'buildReceiptSha256': RECEIPT_SHA, 'entrySha256': ENTRY_SHA}


def fresh():
    if os.path.lexists(BASE):
        value = BASE.lstat()
        if not stat.S_ISDIR(value.st_mode) or value.st_uid != 0 or stat.S_IMODE(value.st_mode) != 0o700 or any(BASE.iterdir()):
            fail('one_fresh_evidence_proxy_transition_required')


def review(d):
    required_pins(); fresh()
    parent, source = capture_parent(d)
    if parent['clock']['originalRuntimeExpiresMonotonicMicroseconds'] - d.selective.monotonic_us() < 600000000:
        fail('original_source_deadline_transition_headroom_required')
    for name in CHAINS:
        public, drop, _, _ = files(name)
        if any(os.path.lexists(path) for path in [public, drop]) or any(Path(path).name >= drop.name for path in parent['proxies'][name]['metadata']['definitions']):
            fail('fresh_last_diagnosed_proxy_overlay_required')
        if job(d, name) or proxy(d, parent, name, False) != parent['proxies'][name]['metadata']:
            fail('unchanged_parent_proxy_before_review_required')
        metrics(d, parent, name)
    return {'format': FORMAT, 'operatorSha256': sha(d.q.protected(Path(__file__).absolute(), 200000)),
        'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA, 'parentHelperSha256': PARENT_HELPER_SHA,
        'capturedParent': parent, 'historicalOverlay': d.selective.historical_overlay(d),
        'sourceIdentity': source['ordinaryRuntime'], 'sourceDefinitionSha256': parent['definition']['sha256'], 'clock': parent['clock'],
        'financialHandoff': parent['financialHandoff'], 'proxies': parent['proxies'], 'candidate': candidate(d),
        'changedChains': list(CHAINS), 'diagnosisReceiptSha256': DIAGNOSIS, 'supportAtTransition': support_identity(d),
        'freeOnly': True, 'paidAuthority': False, 'permitIds': [], 'sourceSelectionChanged': False,
        'sourceRestartAllowed': False, 'supportRestartAllowed': False, 'automaticRetryAllowed': False}


def classify(d, parent, name):
    public, drop, body, text = files(name); present = [os.path.lexists(public), os.path.lexists(drop)]
    for exists, path, raw in zip(present, [public, drop], [body, text]):
        if exists and d.q.protected(path, 2000) != raw: fail('foreign_overlay_blocks_proxy_recovery')
    if present[1] and not present[0]: fail('incomplete_unowned_proxy_selector')
    intent = read(d, BASE / 'intent.json')
    if intent.get('parentRuntimeSha256') != PARENT_SHA or intent.get('sourceInvocation') != PARENT_INVOCATION or job(d, name):
        fail('owned_transition_without_pending_job_required')
    if intent.get('bootId') != d.selective.boot_id() or type(intent.get('earliestStartMonotonicUs')) is not int:
        fail('same_boot_owned_proxy_intent_required')
    selected = present[1]
    try: actual = proxy(d, parent, name, selected, terminal=True)
    except RuntimeError:
        if not selected: raise
        actual = proxy(d, parent, name, False, terminal=True, unloaded_overlay=True); selected = False
    if actual['invocation'] not in {'', parent['proxies'][name]['metadata']['invocation']}:
        started = d.qe.bus_property(unit(name), 'org.freedesktop.systemd1.Service', 'ExecMainStartTimestampMonotonic', 't')
        if type(started) is not int or started < intent['earliestStartMonotonicUs']: fail('unowned_proxy_invocation_blocks_recovery')
    state = d.qe.observed(d.v, unit(name))
    terminal = state['MainPID'] == '0' and state['ActiveState'] in {'inactive', 'failed'}
    return selected, actual, present, terminal


def current_proxies(d, parent, selected):
    values = deepcopy(parent['proxies'])
    for name in CHAINS:
        if job(d, name): fail('no_pending_proxy_job_before_ACK')
        values[name]['metadata'] = proxy(d, parent, name, selected)
        metrics(d, parent, name)
    return values


def check_support(d, reviewed, support_check=None):
    # Only a separately reviewed, fixed owner adapter may pass a guard for an
    # acknowledged later support invocation. No CLI accepts code or a hook.
    if support_check is None:
        support_unchanged(d, reviewed['supportAtTransition'])
    elif callable(support_check):
        support_check()
    else:
        fail('fixed_support_validation_callback_required')


def save_runtime(d, reviewed, parent, source, proxies, mode, support_check=None):
    if current_proxies(d, parent, mode == 'evidence-code') != proxies: fail('stable_proxy_identities_before_ACK_required')
    d.selective.runtime(d, parent['definition'], parent['clock'], 'selective', saved=source['ordinaryRuntime'])
    check_support(d, reviewed, support_check)
    value = {'format': FORMAT, 'mode': mode, 'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA,
        'reviewFile': str(BASE / 'review.json'), 'reviewSha256': sha(encoded(reviewed)), 'ordinaryRuntime': source['ordinaryRuntime'],
        'sourceDefinitionSha256': parent['definition']['sha256'], 'clock': parent['clock'], 'financialHandoff': parent['financialHandoff'],
        'effectiveRuntime': {'sourceRuntime': parent['effectiveRuntime'], 'evidenceProxyEntries': {
            name: ENTRY_SHA if mode == 'evidence-code' else original_entry(d, name)[1] for name in CHAINS}},
        'proxies': proxies, 'changedChains': list(CHAINS), 'supportAtTransition': reviewed['supportAtTransition'],
        'freeOnly': True, 'paidAuthority': False, 'permitIds': [], 'sourceSelectionChanged': False, 'sourceRestarted': False,
        'sourceDigest': parent['sourceDigest'], 'schema': parent['schema'], 'nativeBuild': parent['nativeBuild'], 'profile': parent['profile'],
        'parentReferences': parent['parentReferences'], 'runtimeScope': parent['runtimeScope'], 'checkpointsAtAcknowledgment': source['checkpoints']}
    path = BASE / ('runtime.json' if mode == 'evidence-code' else 'rollback-runtime.json'); pin = d.q.save(path, value)
    journal(d).emit(mode + '_runtime_acknowledged', receiptFile=str(path), receiptSha256=pin)
    return path, pin


def released(d, mode, path, pin):
    release = BASE / (mode + '-handover-released.json')
    release_sha = d.q.save(release, {'runtimeReceiptSha256': pin, 'sourceAndProxyHandoverLeasesReleased': True})
    return {'format': FORMAT, 'mode': mode, 'runtimeReceiptFile': str(path), 'runtimeReceiptSha256': pin,
        'leaseReleasedFile': str(release), 'leaseReleasedSha256': release_sha, 'sourceStarted': False, 'sourceRestarted': False,
        'paidAuthority': False, 'sourceSelectionChanged': False}


def apply(d, expected):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease())
        for name in CHAINS: locks.enter_context(d.v.chain_lock(name))
        reviewed = review(d)
        if sha(encoded(reviewed)) != expected: fail('exact_fresh_evidence_proxy_review_required')
        parent, before = captured_source(d,reviewed)
        BASE.mkdir(mode=0o700, exist_ok=True); d.q.sync_directory(BASE.parent)
        d.q.save(BASE / 'review.json', reviewed)
        d.q.save(BASE / 'intent.json', {'reviewHash': expected, 'parentRuntimeSha256': PARENT_SHA, 'sourceInvocation': PARENT_INVOCATION,
            'earliestStartMonotonicUs': d.selective.monotonic_us(), 'bootId': d.selective.boot_id(), 'automaticRetryAllowed': False})
        try:
            captured_source(d,reviewed)
            support_unchanged(d,reviewed['supportAtTransition'])
            for name in CHAINS:
                public, drop, body, text = files(name)
                d.ordinary.public_write(d.q, public, body); d.ordinary.public_write(d.q, drop, text)
                d.q.run(['/usr/bin/systemctl', 'daemon-reload']); restart(d, name)
                actual = proxy(d, parent, name, True)
                if actual['invocation'] == parent['proxies'][name]['metadata']['invocation']: fail('new_proxy_invocation_required')
                d.v.retry(lambda: metrics(d, parent, name))
                captured_source(d,reviewed)
                support_unchanged(d,reviewed['supportAtTransition'])
                journal(d).emit('evidence_proxy_changed', chain=name, invocation=actual['invocation'])
            parent, after = captured_source(d,reviewed)
            if before['ordinaryRuntime'] != after['ordinaryRuntime']: fail('source_process_must_not_restart')
            path, pin = save_runtime(d, reviewed, parent, after, current_proxies(d, parent, True), 'evidence-code')
        except BaseException as error:
            d.q.save(BASE / 'failed.json', {'failure': d.normal.failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'evidence-code', path, pin)


def validate_with(d, receipt_file, receipt_sha):
    path = Path(receipt_file); mode = 'evidence-code' if path == BASE / 'runtime.json' else 'rollback'
    if path not in {BASE / 'runtime.json', BASE / 'rollback-runtime.json'}: fail('exact_successor_receipt_path_required')
    value = read(d, path, receipt_sha); reviewed = read(d, BASE / 'review.json', value['reviewSha256'])
    if (value.get('format') != FORMAT or value.get('mode') != mode or reviewed['operatorSha256'] != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
        value.get('parentRuntimeSha256') != PARENT_SHA or value.get('parentRuntimeFile') != str(PARENT) or value.get('reviewFile') != str(BASE / 'review.json') or
        value.get('freeOnly') is not True or value.get('paidAuthority') is not False or value.get('permitIds') != [] or
        value.get('sourceRestarted') is not False or value.get('sourceSelectionChanged') is not False or
        os.path.lexists(BASE / 'rollback-failed.json') or (mode == 'evidence-code' and any(os.path.lexists(BASE / name) for name in ['failed.json', 'rollback-intent.json']))):
        fail('successful_unsuperseded_evidence_successor_required')
    release = read(d, BASE / (mode + '-handover-released.json'))
    if release != {'runtimeReceiptSha256': receipt_sha, 'sourceAndProxyHandoverLeasesReleased': True}: fail('actual_evidence_successor_lease_release_required')
    ack = journal(d).latest(mode + '_runtime_acknowledged')
    if ack is None or ack.get('receiptFile') != str(path) or ack.get('receiptSha256') != receipt_sha: fail('actual_successor_ACK_required')
    if mode == 'rollback' and os.path.lexists(BASE / 'failed.json'):
        recovered = read(d, BASE / 'recovery-completed.json')
        if recovered != {'failedSha256': sha(d.q.protected(BASE / 'failed.json', 100000)), 'runtimeReceiptSha256': receipt_sha}: fail('actual_recovery_ACK_required')
    parent, source = captured_source(d,reviewed); selected = mode == 'evidence-code'
    actual = current_proxies(d, parent, selected)
    if (any(value.get(k) != parent[k] for k in ['sourceDigest', 'schema', 'nativeBuild', 'profile', 'parentReferences', 'runtimeScope']) or
        reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or reviewed.get('clock') != parent['clock'] or
        reviewed.get('parentRuntimeSha256') != PARENT_SHA or reviewed.get('parentHelperSha256') != PARENT_HELPER_SHA or
        value['ordinaryRuntime'] != source['ordinaryRuntime'] or value['clock'] != parent['clock'] or
        value['sourceDefinitionSha256'] != parent['definition']['sha256'] or value['financialHandoff'] != parent['financialHandoff'] or
        value['effectiveRuntime'] != {'sourceRuntime': parent['effectiveRuntime'], 'evidenceProxyEntries': {
            name: ENTRY_SHA if selected else original_entry(d, name)[1] for name in CHAINS}} or value['proxies'] != actual or
        reviewed['candidate'] != candidate(d) or reviewed['changedChains'] != list(CHAINS) or value['changedChains'] != list(CHAINS) or
        reviewed['diagnosisReceiptSha256'] != DIAGNOSIS or value['supportAtTransition'] != reviewed['supportAtTransition']):
        fail('unchanged_source_and_acknowledged_evidence_runtime_required')
    # The source/proxy validator records support at transition; a later reviewed
    # duration-only support change need not invalidate unchanged source routing.
    return {**value, 'checkpoints': source['checkpoints'], 'leaseReleasedFile': str(BASE / (mode + '-handover-released.json')), 'leaseReleasedSha256': sha(encoded(release))}


def validate_current(receipt_file, receipt_sha): return validate_with(modules(), receipt_file, receipt_sha)


def restore(d, expected, recovery, support_check=None):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease())
        for name in CHAINS: locks.enter_context(d.v.chain_lock(name))
        if any(os.path.lexists(BASE / name) for name in ['rollback-intent.json', 'rollback-runtime.json', 'rollback-failed.json']): fail('one_proxy_restoration_only')
        if recovery:
            failure = read(d, BASE / 'failed.json', expected)
            if failure.get('manualReconcileRequired') is not True or failure.get('automaticRetryAllowed') is not False: fail('exact_failed_transition_required')
        else: validate_with(d, str(BASE / 'runtime.json'), expected)
        intent = read(d, BASE / 'intent.json')
        reviewed = read(d, BASE / 'review.json', intent['reviewHash'])
        parent, source = captured_source(d,reviewed)
        if (reviewed.get('operatorSha256') != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
            reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or reviewed.get('clock') != parent['clock'] or
            reviewed.get('candidate') != candidate(d) or reviewed.get('changedChains') != list(CHAINS) or
            reviewed.get('diagnosisReceiptSha256') != DIAGNOSIS):
            fail('exact_owned_restoration_review_required')
        check_support(d, reviewed, support_check)
        before = {name: classify(d, parent, name) for name in CHAINS}
        d.q.save(BASE / 'rollback-intent.json', {'inputSha256': expected, 'recovery': recovery, 'before': before})
        try:
            for name in reversed(CHAINS):
                check_support(d, reviewed, support_check)
                if classify(d, parent, name) != before[name]: fail('proxy_state_changed_before_restoration')
                selected, _, present, terminal = before[name]
                public, drop, body, text = files(name)
                for exists, path, raw in [(present[1], drop, text), (present[0], public, body)]:
                    if exists:
                        if d.q.protected(path, 2000) != raw: fail('foreign_proxy_restore_bytes')
                        path.unlink(); d.q.sync_directory(path.parent)
                d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
                if selected or terminal: restart(d, name)
                proxy(d, parent, name, False); d.v.retry(lambda: metrics(d, parent, name))
                check_support(d, reviewed, support_check)
            parent, after = captured_source(d,reviewed)
            if source['ordinaryRuntime'] != after['ordinaryRuntime']: fail('source_process_must_not_restart')
            path, pin = save_runtime(d, reviewed, parent, after, current_proxies(d, parent, False), 'rollback', support_check)
            if recovery: d.q.save(BASE / 'recovery-completed.json', {'failedSha256': expected, 'runtimeReceiptSha256': pin})
        except BaseException as error:
            d.q.save(BASE / 'rollback-failed.json', {'failure': d.normal.failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'rollback', path, pin)


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    for name in ['apply', 'rollback', 'recover', 'validate']: group.add_argument('--' + name)
    args = parser.parse_args(); d = modules()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_required')
    d.q.actual_root_capabilities(); os.umask(0o077)
    def interrupted(*_): raise InterruptedError('bounded_proxy_transition_interrupted')
    for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]: signal.signal(sig, interrupted)
    signal.alarm(480)
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
