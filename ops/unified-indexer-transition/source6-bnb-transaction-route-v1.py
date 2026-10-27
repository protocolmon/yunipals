#!/usr/bin/env python3
"""One BNB proxy-only successor; the acknowledged source process never restarts."""
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
BASE = Path('/var/backups/yunipals-source6-bnb-transaction-route-v1-20261022')
FORMAT = 'yunipals-source6-bnb-transaction-route-v1'
PARENT_HELPER = OPS / 'source6-selective-replay-v2.py'
PARENT_HELPER_SHA = 'd2913b2e778bbe9e861fe2e8813e261e5df7d4efd2cdbb58b369cd49d38c1dbc'
PARENT = Path('/var/backups/yunipals-source6-selective-replay-v2-20261022/runtime.json')
PARENT_SHA = '6cf619daf6049f4ddb772420bebe1c333ac7ee821fd6855296c95e24bd481f12'
PARENT_RELEASE_SHA = 'dbfdf99a856cb2422c20ab5125a66e5a7a6c0cf52f8bd37ecdb3c6b98318149f'
PARENT_INVOCATION = 'dab6fcd2704c461a9af2123168aec8f0'
UNIT = 'yunipals-market-production-rpc@bnb.service'
PUBLIC = OPS / 'source6-bnb-transaction-route-v1.env'
DROP = Path('/etc/systemd/system') / (UNIT + '.d') / 'zzzzzzzzzzzzzzzzzzzzzzz-bnb-transactions-v1-20261022.conf'
BUILD = OPS / 'source6-selective-source-proxy-build-v4.py'
OUTPUT = OPS / 'source6-selective-source-proxy-v4'
PROOF = OPS / 'source6-selective-provider-proof-v9.json'
# Actual host build/qualification gates. No guessed artifact is deployable.
BUILD_SHA = '27242140023a92f7e3e23d796233e7a23f9d6ed9a3385d786562c1e5988dc6ab'
RECEIPT_SHA = '869cc156665ea69294ca65e609a8d1e3dcb70d510a74154c369c67e9c38292b5'
ENTRY_SHA = '6581ecddd74f3058e17354f7ca311c574014c0977be5bf279d85395a90d2e61c'
PROOF_SHA = '974f88a37fe939c5df936a051f62ff7c40c9551badae1faaedf5cc1347a8e129'
PROOF_WORKER_SHA = '1398b327c95379c6e8054978faf8db470d9d4d05ab0946a9e9287c20a11dd022'
PROOF_WRAPPER_SHA = '3916bb470ed20ddb472e260f3fc711640cb063e93aa7de3a7e9354b009440849'
TRANSACTION_INDICES = [1, 2, 3]
POOL_SHA = 'd75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b'
DBUS = ['/usr/bin/busctl', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager']


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def hash_ok(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64


def route():
    if (not isinstance(TRANSACTION_INDICES, list) or not TRANSACTION_INDICES or
        any(type(index) is not int or index not in [1, 2, 3] for index in TRANSACTION_INDICES) or
        TRANSACTION_INDICES != sorted(set(TRANSACTION_INDICES))): fail('actual_transaction_provider_subset_required')
    return {'primaryIndices': TRANSACTION_INDICES[:], 'poolSha256': POOL_SHA}


def required_pins():
    if not all(hash_ok(pin) for pin in [BUILD_SHA, RECEIPT_SHA, ENTRY_SHA, PROOF_SHA, PROOF_WORKER_SHA, PROOF_WRAPPER_SHA]):
        fail('actual_build_and_transaction_qualification_pins_required')
    route()


def modules():
    required_pins()
    for path in [*PARENT_HELPER.parents, PARENT_HELPER]:
        s = path.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022: fail('protected_parent_operator_required')
    raw = PARENT_HELPER.read_bytes()
    if len(raw) > 200000 or sha(raw) != PARENT_HELPER_SHA: fail('exact_parent_operator_required')
    m = types.ModuleType('frozen_selective'); m.__file__ = str(PARENT_HELPER)
    exec(compile(raw, str(PARENT_HELPER), 'exec'), m.__dict__)
    d = m.modules(); d.selective = m
    d.route_build = d.q.load(BUILD, BUILD_SHA, 'transaction_proxy_build')
    return d


def read(d, path, pin=None): return d.selective.read(d, path, pin)
def journal(d): return d.live.journal_for(d.q, BASE)


def source_parent(d):
    """Frozen source/artifact/financial checks, without old live BNB validation."""
    m = d.selective; value = read(d, PARENT, PARENT_SHA)
    reviewed = read(d, m.BASE / 'review.json', value['reviewSha256'])
    if (value.get('format') != m.FORMAT or value.get('mode') != 'selective' or
        value.get('reviewFile') != str(m.BASE / 'review.json') or value.get('freeOnly') is not True or
        value.get('paidAuthority') is not False or value.get('permitIds') != [] or value.get('sourceSelectionChanged') is not False or
        reviewed.get('operatorSha256') != PARENT_HELPER_SHA or value.get('clock') != reviewed.get('clock') or
        value.get('ordinaryRuntime', {}).get('invocation') != PARENT_INVOCATION or
        any(os.path.lexists(m.BASE / name) for name in ['failed.json', 'rollback-intent.json', 'rollback-failed.json'])):
        fail('successful_unsuperseded_selective_parent_required')
    release = read(d, m.BASE / 'selective-handover-released.json', PARENT_RELEASE_SHA)
    if release != {'runtimeReceiptSha256': PARENT_SHA, 'sourceAndChainHandoverLeasesReleased': True}:
        fail('actual_parent_release_required')
    ack = m.journal(d).latest('selective_runtime_started')
    if ack is None or ack.get('receiptFile') != str(PARENT) or ack.get('receiptSha256') != PARENT_SHA or ack.get('invocation') != PARENT_INVOCATION:
        fail('actual_parent_start_ACK_required')
    ancestor, ancestor_review = m.inherited(d)
    if (m.historical_overlay(d) != reviewed['historicalOverlay'] or m.candidate_proxy(d) != reviewed['candidateProxy'] or
        m.provider_proof(d) != reviewed['providerProof'] or m.namespace_proof(d) != reviewed['namespaceProof'] or
        m.qualified_route() != reviewed['qualifiedRoute'] or m.pool_identity_proof(d) != reviewed['poolIdentityProof']):
        fail('unchanged_parent_runtime_artifacts_required')
    clock = m.captured_deadline(ancestor, {'InvocationID': m.PARENT_INVOCATION,
        'MainPID': str(ancestor['ordinaryRuntime']['process']['pid']), 'ExecMainStartTimestampMonotonic': str(m.PARENT_START_US)}, m.PARENT_BOOT)
    if (value['clock'] != clock or value['definition'] != m.render_definition(d, ancestor, clock, value['reviewSha256'], 'selective', value['definition']['maximumRuntimeSeconds']) or
        value['effectiveRuntime'] != {'historicalOverlay': reviewed['historicalOverlay'], 'proxyEntrySha256': m.PROXY_ENTRY_SHA, 'qualifiedRoute': reviewed['qualifiedRoute']} or
        value['financialHandoff'] != ancestor['financialHandoff']): fail('unchanged_source_definition_deadline_and_finance_required')
    actual = m.runtime(d, value['definition'], value['clock'], 'selective', saved=value['ordinaryRuntime'])
    d.ordinary.source_health()
    peer = d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=True)
    baseline = read(d, value['proxyBaselineFile'], value['proxyBaselineSha256'])
    if (value['proxyBaselineFile'] != str(m.BASE / 'selective-proxies.json') or
        baseline != {'proxies': value['proxies'], 'freeOnly': True, 'paidAuthority': False, 'permitIds': []}):
        fail('exact_parent_proxy_baseline_required')
    for name in ['base', 'ethereum', 'polygon']:
        if m.proxy_metadata(d, name) != value['proxies'][name]['metadata']: fail('other_proxy_identity_must_not_change')
        m.selected_proxy_health(d, name, value['proxies'][name]['configuration'])
    return value, reviewed, {'ordinaryRuntime': actual, 'checkpoints': peer['checkpoints'], 'sourceRole': peer['role']}


def files():
    body = ('MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=false\nMARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=false\n'
        'MARKET_RPC_PROXY_BNB_SELECTIVE_TRANSACTION_PRIMARY_INDICES=' + ','.join(map(str, route()['primaryIndices'])) + '\n').encode()
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
            fail('only_exact_BNB_public_transaction_overlay_allowed')
    if value != expected: fail('original_BNB_private_files_order_and_properties_must_not_change')


def metrics(d, parent, selected):
    # Source remains live: free counters/cache can be populated immediately.
    d.selective.selected_proxy_health(d, 'bnb', parent['proxies']['bnb']['configuration'], zero=False)
    value = d.v.request(19204, '/metrics'); actual = value.get('unified', {}).get('selectiveTransactions')
    if not selected:
        if actual is not None: fail('transaction_pool_must_be_absent_after_rollback')
        return
    desired = route()
    if (not isinstance(actual, dict) or set(actual) != {'primaryIndices', 'poolSha256', 'preferred', 'endpoints'} or
        actual['primaryIndices'] != desired['primaryIndices'] or actual['poolSha256'] != POOL_SHA or
        type(actual['preferred']) is not int or not 0 <= actual['preferred'] < len(desired['primaryIndices']) or
        not isinstance(actual['endpoints'], list) or len(actual['endpoints']) != len(desired['primaryIndices'])):
        fail('exact_qualified_transaction_route_metrics_required')
    for row, index in zip(actual['endpoints'], desired['primaryIndices']):
        if (set(row) != {'primaryIndex', 'coolingDown', 'failures', 'successes'} or row['primaryIndex'] != index or
            type(row['coolingDown']) is not bool or any(type(row[k]) is not int or row[k] < 0 for k in ['failures', 'successes'])):
            fail('exact_transaction_endpoint_metrics_required')


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
        entry, pin = d.selective.PROXY_OUTPUT / 'rpc-budget-proxy.mjs', d.selective.PROXY_ENTRY_SHA
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
    receipt = d.route_build.validate_saved()
    if (sha(d.q.protected(OUTPUT / 'receipt.json', 100000)) != RECEIPT_SHA or receipt.get('entry') != str(OUTPUT / 'rpc-budget-proxy.mjs') or
        receipt.get('entrySha256') != ENTRY_SHA or d.route_build.NODE != d.selective_proxy.NODE or d.route_build.APP != d.selective_proxy.APP):
        fail('actual_proxy_only_candidate_required')
    d.renewal.candidate_access(d, receipt)
    return {'buildOperatorSha256': BUILD_SHA, 'buildReceiptSha256': RECEIPT_SHA, 'entrySha256': ENTRY_SHA}


def qualification(d, parent):
    value = read(d, PROOF, PROOF_SHA); pool = read(d, d.selective.POOL_PROOF, d.selective.POOL_PROOF_SHA)
    baseline = parent['proxies']['bnb']['metadata']; blocks = [7579200, 14826444]
    limits = {'rpcCalls': 16, 'providerHttpRequests': 10, 'totalResponseBytes': 33554432, 'perResponseBytes': 10485760,
        'deadlineMs': 60000, 'perRequestMs': 10000, 'minimumSpacingMs': 1000, 'maximumConcurrentRequests': 1,
        'identityCheckReserveMs': 5000, 'redirects': 0, 'clientRetries': 0}
    if (value.get('format') != 'yunipals-source6-selective-provider-proof-v9' or value.get('status') != 'qualified_transaction_samples' or
        value.get('currentRuntimeReceiptSha256') != PARENT_SHA or value.get('currentSelectiveOperatorSha256') != PARENT_HELPER_SHA or
        value.get('currentProxyBaselineSha256') != parent['proxyBaselineSha256'] or value.get('sourceInvocation') != PARENT_INVOCATION or
        value.get('proxyInvocation') != baseline['invocation'] or value.get('environmentFileHashes') != baseline['environmentFileHashes'] or
        value.get('orderedEnvironmentFiles') != baseline['privateSettings']['orderedEnvironmentFiles'] or
        value.get('directProbeWorkerSha256') != PROOF_WORKER_SHA or value.get('helperSha256') != PROOF_WRAPPER_SHA or
        value.get('previousProofSha256') != d.selective.PROBE_SHA or value.get('poolIdentityProofSha256') != d.selective.POOL_PROOF_SHA or
        value.get('candidateHelperSha256') != d.selective.HISTORICAL_FILES['yunipals-log-transactions.mjs'] or
        value.get('historicalManifestSha256') != d.selective.HISTORICAL_SHA or value.get('primaryPoolSha256') != POOL_SHA or
        value.get('selectedPrimaryUrlSha256') != [{'primaryIndex': i, 'urlSha256': pool['primaryUrlSha256'][i]} for i in [0, 1, 2, 3]] or
        any(value.get(k) is not True for k in ['freeOnly', 'diagnosticComplete', 'sourceIdentityUnchanged', 'proxyIdentityUnchanged', 'privateInputBaselineBindingUnchanged',
            'transactionRequestsSameHttpBatch', 'headerBeforeTransactionBatch', 'fullBlockSeparateRequest', 'proposedHelperExecuted']) or
        any(value.get(k) is not False for k in ['proposedRouteExecuted', 'proposedSplitRouteExecuted', 'headersOnTransactionProvidersTested',
            'transactionProvidersQualifiedForHeaders', 'configurationChanged', 'rawResponsesExported', 'rawUrlsExported', 'rawPrivateValuesExported',
            'matchingLogsQueried', 'fullHistoryVerified', 'throughputVerified', 'allFutureResponsesQualified']) or
        value.get('primaryIndices') != [0, 1, 2, 3] or value.get('transactionPrimaryIndices') != [1, 2, 3] or value.get('blocks') != blocks or
        value.get('baselinePrimaryIndex') != 0 or value.get('chainId') != 56 or
        value.get('transportShape') != 'provider0_full_and_header_singletons_then_other_provider_first_last_index_batches' or
        value.get('transactionSelection') != 'first_and_last_distinct_transaction_bound_to_provider0_full_and_header' or
        value.get('qualificationScope') != 'transaction_lookup_only_two_fixed_blocks_against_provider0_full_and_header' or
        value.get('lookupMethod') != 'eth_getTransactionByBlockNumberAndIndex' or value.get('helperExecution') != 'offline_replay_of_actual_responses' or
        value.get('helperNetworkRequests') != 0 or value.get('paidCalls') != 0 or value.get('limits') != limits or value.get('rpcCalls') != 16 or value.get('providerHttpRequests') != 10 or
        type(value.get('responseBytes')) is not int or not 0 < value['responseBytes'] <= 33554432 or
        type(value.get('elapsedMs')) not in {int, float} or not math.isfinite(value['elapsedMs']) or not 0 <= value['elapsedMs'] <= 60000):
        fail('actual_bounded_transaction_only_qualification_required')
    samples = value.get('samples'); expected = []; passing = {i: [] for i in [1, 2, 3]}
    if not isinstance(samples, list) or len(samples) != 6: fail('six_attributed_transaction_samples_required')
    for row, (block, index) in zip(samples, [(b, i) for b in blocks for i in [1, 2, 3]]):
        if (row.get('blockNumber') != block or row.get('primaryIndex') != index or row.get('transactionPrimaryIndex') != index or
            any(row.get(k) != 0 for k in ['baselinePrimaryIndex', 'headerPrimaryIndex', 'fullBlockPrimaryIndex']) or
            row.get('primaryUrlSha256') != pool['primaryUrlSha256'][index] or row.get('baselinePrimaryUrlSha256') != pool['primaryUrlSha256'][0] or
            row.get('transactionProviderHeaderQualified') is not False or
            row.get('headerAndFullAttribution') != {'primaryIndex': 0, 'reason': 'exact_configured_endpoint_direct_request'} or
            row.get('transactionAttribution') != {'primaryIndex': index, 'reason': 'exact_configured_endpoint_direct_request'}): fail('exact_split_provider_attribution_required')
        if row.get('equivalent') is True:
            if (any(row.get(k) is not True for k in ['headerEquivalent', 'standardizedBlockEquivalent', 'encodedBlockEquivalent', 'discoveryBlockEquivalent',
                'discoveryTransactionsEquivalent', 'helperEncodedBlockEquivalent', 'helperEncodedTransactionsEquivalent']) or
                row.get('offlineFallbackAttempted') is not False or row.get('offlineHelperCalls') != 3 or row.get('candidateHelperOutcome') != 'passed' or
                row.get('selectedTransactionCount') != 2 or len(row.get('selectedTransactions', [])) != 2 or len(row.get('transactionComparisons', [])) != 2):
                fail('strict_transaction_helper_comparison_required')
            for position, (selected, compared) in enumerate(zip(row['selectedTransactions'], row['transactionComparisons'])):
                if (type(selected.get('position')) is not int or not 0 <= selected['position'] <= 2147483647 or
                    (selected['position'] == 0) != (position == 0) or selected.get('index') != hex(selected['position']) or
                    not isinstance(selected.get('hash'), str) or not re.fullmatch('0x[0-9a-f]{64}', selected['hash']) or
                    compared.get('requestedHash') != selected.get('hash') or compared.get('requestedIndex') != selected.get('index') or
                    compared.get('isNull') is not False or compared.get('normalizationOutcome') != 'passed' or
                    any(compared.get(k) is not True for k in ['isObject', 'hashMatchesRequested', 'indexMatchesRequested', 'blockHashMatchesHeader',
                        'blockNumberMatchesHeader', 'rawEquivalent', 'standardFieldsEquivalent', 'encodedEquivalent'])):
                    fail('strict_raw_standard_encoded_transaction_identity_required')
            if row['selectedTransactions'][0]['hash'] == row['selectedTransactions'][1]['hash']: fail('distinct_first_last_transactions_required')
            passing[index].append(block)
    for index in [1, 2, 3]: expected.append({'primaryIndex': index, 'transactionLookupQualified': passing[index] == blocks, 'headerQualified': False, 'passingBlocks': passing[index]})
    qualified = [row['primaryIndex'] for row in expected if row['transactionLookupQualified']]
    if value.get('endpointQualifications') != expected or value.get('qualifiedTransactionPrimaryIndices') != qualified or not set(route()['primaryIndices']) <= set(qualified):
        fail('only_actually_qualified_transaction_endpoints_allowed')
    return {'file': str(PROOF), 'sha256': PROOF_SHA, 'qualifiedTransactionPrimaryIndices': qualified, 'headersRemainOnPrimaryIndices': [0], 'candidateRouteExecuted': False}


def fresh():
    if os.path.lexists(BASE):
        s = BASE.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or any(BASE.iterdir()): fail('one_fresh_BNB_only_transition_required')


def review(d):
    fresh(); d.selective.validate_current(str(PARENT), PARENT_SHA)
    parent, _, source = source_parent(d)
    if parent['clock']['originalRuntimeExpiresMonotonicMicroseconds'] - d.selective.monotonic_us() < 600000000:
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
        'sourceRestartAllowed': False, 'automaticRetryAllowed': False}


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
    if job(d) or proxy(d, parent, mode == 'transaction-route') != metadata:
        fail('BNB_identity_must_remain_stable_before_ACK')
    d.selective.runtime(d, parent['definition'], parent['clock'], 'selective', saved=source['ordinaryRuntime'])
    value = {'format': FORMAT, 'mode': mode, 'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA,
        'reviewFile': str(BASE / 'review.json'), 'reviewSha256': sha(encoded(reviewed)), 'ordinaryRuntime': source['ordinaryRuntime'],
        'sourceDefinitionSha256': parent['definition']['sha256'], 'clock': parent['clock'], 'financialHandoff': parent['financialHandoff'],
        'effectiveRuntime': {'sourceRuntime': parent['effectiveRuntime'], 'bnbProxyEntrySha256': ENTRY_SHA if mode == 'transaction-route' else d.selective.PROXY_ENTRY_SHA,
            'transactionRoute': route() if mode == 'transaction-route' else None},
        'proxies': {**parent['proxies'], 'bnb': {'metadata': metadata, 'configuration': parent['proxies']['bnb']['configuration']}},
        'freeOnly': True, 'paidAuthority': False, 'permitIds': [], 'sourceSelectionChanged': False, 'sourceRestarted': False,
        'sourceDigest': parent['sourceDigest'], 'schema': parent['schema'], 'nativeBuild': parent['nativeBuild'], 'profile': parent['profile'],
        'parentReferences': parent['parentReferences'], 'runtimeScope': parent['runtimeScope'], 'checkpointsAtAcknowledgment': source['checkpoints']}
    path = BASE / ('runtime.json' if mode == 'transaction-route' else 'rollback-runtime.json'); pin = d.q.save(path, value)
    journal(d).emit(mode + '_runtime_acknowledged', receiptFile=str(path), receiptSha256=pin)
    return path, pin


def released(d, mode, path, pin):
    release = BASE / (mode + '-handover-released.json')
    release_sha = d.q.save(release, {'runtimeReceiptSha256': pin, 'sourceAndBnbHandoverLeasesReleased': True})
    return {'format': FORMAT, 'mode': mode, 'runtimeReceiptFile': str(path), 'runtimeReceiptSha256': pin,
        'leaseReleasedFile': str(release), 'leaseReleasedSha256': release_sha, 'sourceStarted': False, 'sourceRestarted': False,
        'paidAuthority': False, 'sourceSelectionChanged': False}


def apply(d, expected):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease()); locks.enter_context(d.v.chain_lock('bnb'))
        reviewed = review(d)
        if sha(encoded(reviewed)) != expected: fail('exact_fresh_BNB_only_review_required')
        parent, _, before = source_parent(d)
        BASE.mkdir(mode=0o700, exist_ok=True); d.q.sync_directory(BASE.parent)
        d.q.save(BASE / 'review.json', reviewed)
        d.q.save(BASE / 'intent.json', {'reviewHash': expected, 'parentRuntimeSha256': PARENT_SHA, 'sourceInvocation': PARENT_INVOCATION,
            'earliestStartMonotonicUs': d.selective.monotonic_us(), 'bootId': d.selective.boot_id(), 'automaticRetryAllowed': False})
        try:
            d.selective.validate_current(str(PARENT), PARENT_SHA)
            body, text = files(); d.ordinary.public_write(d.q, PUBLIC, body); d.ordinary.public_write(d.q, DROP, text)
            d.q.run(['/usr/bin/systemctl', 'daemon-reload']); restart(d)
            actual = proxy(d, parent, True)
            if actual['invocation'] == parent['proxies']['bnb']['metadata']['invocation']: fail('new_BNB_invocation_required')
            d.v.retry(lambda: metrics(d, parent, True))
            parent, _, after = source_parent(d)
            if before['ordinaryRuntime'] != after['ordinaryRuntime']: fail('source_process_must_not_restart')
            path, pin = save_runtime(d, reviewed, parent, after, actual, 'transaction-route')
        except BaseException as error:
            d.q.save(BASE / 'failed.json', {'failure': d.normal.failure(error), 'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'transaction-route', path, pin)


def validate_with(d, receipt_file, receipt_sha):
    path = Path(receipt_file); mode = 'transaction-route' if path == BASE / 'runtime.json' else 'rollback'
    if path not in {BASE / 'runtime.json', BASE / 'rollback-runtime.json'}: fail('exact_successor_receipt_path_required')
    value = read(d, path, receipt_sha); reviewed = read(d, BASE / 'review.json', value['reviewSha256'])
    if (value.get('format') != FORMAT or value.get('mode') != mode or reviewed['operatorSha256'] != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
        value.get('parentRuntimeSha256') != PARENT_SHA or value.get('parentRuntimeFile') != str(PARENT) or value.get('reviewFile') != str(BASE / 'review.json') or
        value.get('freeOnly') is not True or value.get('paidAuthority') is not False or value.get('permitIds') != [] or
        value.get('sourceRestarted') is not False or value.get('sourceSelectionChanged') is not False or
        os.path.lexists(BASE / 'rollback-failed.json') or (mode == 'transaction-route' and any(os.path.lexists(BASE / name) for name in ['failed.json', 'rollback-intent.json']))):
        fail('successful_unsuperseded_BNB_successor_required')
    release = read(d, BASE / (mode + '-handover-released.json'))
    if release != {'runtimeReceiptSha256': receipt_sha, 'sourceAndBnbHandoverLeasesReleased': True}: fail('actual_BNB_successor_lease_release_required')
    ack = journal(d).latest(mode + '_runtime_acknowledged')
    if ack is None or ack.get('receiptFile') != str(path) or ack.get('receiptSha256') != receipt_sha: fail('actual_successor_ACK_required')
    if mode == 'rollback' and os.path.lexists(BASE / 'failed.json'):
        recovered = read(d, BASE / 'recovery-completed.json')
        if recovered != {'failedSha256': sha(d.q.protected(BASE / 'failed.json', 100000)), 'runtimeReceiptSha256': receipt_sha}: fail('actual_recovery_ACK_required')
    parent, _, source = source_parent(d); selected = mode == 'transaction-route'
    actual = proxy(d, parent, selected); metrics(d, parent, selected)
    if (job(d) or any(value.get(k) != parent[k] for k in ['sourceDigest', 'schema', 'nativeBuild', 'profile', 'parentReferences', 'runtimeScope']) or
        reviewed.get('sourceIdentity') != source['ordinaryRuntime'] or reviewed.get('clock') != parent['clock'] or
        reviewed.get('parentRuntimeSha256') != PARENT_SHA or reviewed.get('parentHelperSha256') != PARENT_HELPER_SHA or
        value['ordinaryRuntime'] != source['ordinaryRuntime'] or value['clock'] != parent['clock'] or
        value['sourceDefinitionSha256'] != parent['definition']['sha256'] or value['financialHandoff'] != parent['financialHandoff'] or
        value['effectiveRuntime'] != {'sourceRuntime': parent['effectiveRuntime'], 'bnbProxyEntrySha256': ENTRY_SHA if selected else d.selective.PROXY_ENTRY_SHA,
            'transactionRoute': route() if selected else None} or value['proxies'] != {**parent['proxies'], 'bnb': {'metadata': actual, 'configuration': parent['proxies']['bnb']['configuration']}} or
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


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    for name in ['apply', 'rollback', 'recover', 'validate']: group.add_argument('--' + name)
    args = parser.parse_args(); d = modules()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_required')
    d.q.actual_root_capabilities(); os.umask(0o077)
    def interrupted(*_): raise InterruptedError('bounded_BNB_transition_interrupted')
    for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]: signal.signal(sig, interrupted)
    signal.alarm(360)
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
