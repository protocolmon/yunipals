#!/usr/bin/env python3
"""One bounded free-only successor to the acknowledged normal3 source.

Only the Base/BNB proxy entry, one read-only Ponder dependency directory
and the explicitly qualified BNB free-provider subset change. The normal3 financial executor, source inputs and original deadline
remain authoritative. No paid permit, financial write or source selector is
created. A successful successor may be rolled back once, within that deadline.
"""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import re
import select
import signal
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-selective-replay-v2-20261022')
SYSTEMD = Path('/etc/systemd/system')
FORMAT = 'yunipals-source6-selective-replay-v2'
NORMAL_SHA = 'ad4358bf2d17bf4dc04c88f480138b11778acab9aca79597d281e0cb1b803a75'
Q_SHA = '2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
PARENT = Path('/var/backups/yunipals-source6-post-renewal-ordinary-v3-20261021/runtime.json')
PARENT_SHA = '1e596858c1227c0dd77d3c029e3c546157bf6e461aac5b2c00edd4d129dae7b1'
PARENT_INVOCATION = 'ae02afb70f0e443d81f8facff98cf6d1'
PARENT_BOOT = 'd1330112-af72-4b2e-a542-25504553ff5e'
PARENT_START_US = 66072633277294
HISTORICAL = OPS / 'source6-selective-historical-v3'
HISTORICAL_SHA = '7138a40ec0e1c907eca212523344e79258aeb421bf2dbaa3101db4d0e95ea4ea'
HISTORICAL_TARGET = Path('/var/lib/yunipals-unified-shadow/20261020-008028af-a/node_modules/.pnpm/ponder@0.17.5_patch_hash=srrmuiqb5i2rcvch3r4b6lqznm_@opentelemetry+api@1.9.1_@types+node@22.1_tdbbixbrmtn4q2y4g3krukmyfy/node_modules/ponder/dist/esm/sync-historical')
HISTORICAL_FILES = {
    'index.js': 'ef63a19ec122a1eaeed6097882e8fe124bc196964d7979cb86f8b2ab658745f8',
    'yunipals-log-transactions.mjs': 'c2892a2e8b6237cef969a7e70f7d029a08746b8afdb128120a0ca430efbb14aa'
}
ORIGINAL_FILES = {
    'index.js': 'f9e84b78ba4e965ef856c4ff8f555bc871f3ca1c5528ad30d2398ce4b673372f',
    'index.js.map': '8970c672d867e4eabc2a930ce35cfd53c72f62100148816f59ec03c9f0cb96ca'
}
PROXY_BUILD = OPS / 'source6-selective-source-proxy-build-v3.py'
PROXY_OUTPUT = OPS / 'source6-selective-source-proxy-v3'
# Actual host build pins must be supplied before this operator can be reviewed.
# None is an explicit closed gate, never a deployable placeholder hash.
PROXY_BUILD_SHA = 'a090aef31f9898181cd34835d9ef3bf46e495b7e3311b95cc967348fe25fa7d5'
PROXY_RECEIPT_SHA = '607c4336a7da1500ca0427010fedb63c3ab13545cfdf236e3d77935644c969bf'
PROXY_ENTRY_SHA = '5b8ffbd5e0f58661948657f12152a76ddf8100090123c81dd59cac442c9409cb'
PROBE = OPS / 'source6-selective-provider-proof-v8.json'
PROBE_SHA = '2d02f221555e7b3e832e6c8806bb6cd5ab3b2ba66242ccd14c7942a593491923'
QUALIFIED_PRIMARY_INDICES = [0]
QUALIFIED_POOL_SHA256 = 'd75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b'
POOL_PROOF = OPS / 'source6-selective-pool-identity-v1.json'
POOL_PROOF_SHA = '76a31f7fb1af08a939ef451bcf87c4ba63341be91b18a1dc3ef2f5d379600463'
PROBED_PRIMARY_INDICES = [0, 1, 2, 3, 4]
NORMAL_PROXY_BASELINE_SHA = '5c9de2fe5b293d687ad56f6d3ab82b96a1af52c2ae4512946cd8b4790645ce97'
NAMESPACE_PROOF = OPS / 'source6-selective-namespace-proof-v3.json'
NAMESPACE_PROOF_SHA = 'c1e563e46fbbb5bdfbcca6d01a901865d7eabb7e864c5f21784b881a3fd6e02e'
OVERRIDE = 'zzzzzzzzzzzzzzzzzzzzzz-source6-selective-v2-20261022.conf'
START_HEADROOM_US = 60000000
START_COMMAND_LIMIT_US = 30000000
MINIMUM_RUNTIME_SECONDS = 30


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def monotonic_us(): return time.monotonic_ns() // 1000
def boot_id(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def required_pins():
    for value in [PROXY_BUILD_SHA, PROXY_RECEIPT_SHA, PROXY_ENTRY_SHA, PROBE_SHA,
                  HISTORICAL_SHA, NAMESPACE_PROOF_SHA, POOL_PROOF_SHA, *HISTORICAL_FILES.values()]:
        if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value) or value == '0' * 64:
            fail('actual_candidate_build_and_provider_proof_pins_required')
    qualified_route()


def qualified_route():
    indices = QUALIFIED_PRIMARY_INDICES
    if (not isinstance(indices, list) or not indices or len(indices) > 5 or
        any(type(index) is not int or not 0 <= index <= 4 for index in indices) or
        len(indices) != len(set(indices)) or
        not isinstance(QUALIFIED_POOL_SHA256, str) or
        not re.fullmatch('[0-9a-f]{64}', QUALIFIED_POOL_SHA256) or QUALIFIED_POOL_SHA256 == '0' * 64):
        fail('actual_qualified_BNB_provider_indices_and_pool_fingerprint_required')
    return {'primaryIndices': indices[:], 'poolSha256': QUALIFIED_POOL_SHA256}


def modules():
    required_pins()
    path = OPS / 'paid-capability-live-v1.py'
    for item in [*path.parents, path]:
        s = item.lstat()
        if item.is_symlink() or s.st_uid != 0 or s.st_mode & 0o022: fail('protected_loader_required')
    raw = path.read_bytes()
    if len(raw) > 300000 or sha(raw) != Q_SHA: fail('pinned_loader_required')
    q = types.ModuleType('selective_loader'); q.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), q.__dict__)
    normal = q.load(OPS / 'source6-post-renewal-ordinary-v3.py', NORMAL_SHA, 'frozen_normal3')
    d = normal.modules(); d.normal = normal
    d.selective_proxy = q.load(PROXY_BUILD, PROXY_BUILD_SHA, 'selective_public_proxy')
    return d


def read(d, path, pin=None): return d.normal.read(d, path, pin)
def journal(d): return d.live.journal_for(d.q, BASE)


def directory_files(d, directory, expected):
    st = directory.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
        fail('immutable_root_owned_dependency_directory_required')
    if {p.name for p in directory.iterdir()} != set(expected): fail('exact_dependency_directory_children_required')
    for name, pin in expected.items():
        if sha(d.q.protected(directory / name, 200000)) != pin: fail('exact_dependency_file_bytes_required')


def historical_overlay(d):
    manifest = read(d, HISTORICAL / 'manifest.json', HISTORICAL_SHA)
    directory_files(d, HISTORICAL, {**HISTORICAL_FILES, 'manifest.json': HISTORICAL_SHA})
    directory_files(d, HISTORICAL_TARGET, ORIGINAL_FILES)
    package = d.ordinary.WORKSPACE / 'apps/yunipals-indexer/node_modules/ponder/dist/esm/sync-historical'
    if package.resolve(strict=True) != HISTORICAL_TARGET: fail('exact_resolved_Ponder_dependency_target_required')
    if (manifest.get('format') != 'yunipals-source6-selective-historical-overlay-v3' or
        manifest.get('directory') != str(HISTORICAL) or manifest.get('target') != str(HISTORICAL_TARGET) or
        manifest.get('parentNativeBuildId') != d.native.NATIVE or manifest.get('sourceMapRemoved') is not True or
        {r['name']: r['sha256'] for r in manifest['files']} != HISTORICAL_FILES or
        {r['name']: r['sha256'] for r in manifest['sourceFiles']} != ORIGINAL_FILES):
        fail('exact_selective_dependency_manifest_required')
    if b'sourceMappingURL=' in d.q.protected(HISTORICAL / 'index.js', 200000):
        fail('stale_historical_source_map_forbidden')
    return {'directory': str(HISTORICAL), 'target': str(HISTORICAL_TARGET),
        'manifestSha256': HISTORICAL_SHA, 'files': HISTORICAL_FILES,
        'parentNativeBuildId': d.native.NATIVE, 'baseDependencyUnchanged': True}


def candidate_proxy(d):
    required_pins()
    receipt = d.selective_proxy.validate_saved()
    if (sha(d.q.protected(PROXY_OUTPUT / 'receipt.json', 100000)) != PROXY_RECEIPT_SHA or
        receipt.get('entry') != str(PROXY_OUTPUT / 'rpc-budget-proxy.mjs') or
        receipt.get('entrySha256') != PROXY_ENTRY_SHA or d.selective_proxy.NODE != d.build.NODE or
        d.selective_proxy.APP != d.build.APP): fail('exact_built_selective_proxy_required')
    d.renewal.candidate_access(d, receipt)
    return {'buildOperatorSha256': PROXY_BUILD_SHA, 'buildReceiptFile': str(PROXY_OUTPUT / 'receipt.json'),
        'buildReceiptSha256': PROXY_RECEIPT_SHA, 'entry': receipt['entry'], 'entrySha256': PROXY_ENTRY_SHA,
        'node': str(d.selective_proxy.NODE), 'workingDirectory': str(d.selective_proxy.APP),
        'paidPrimary': False, 'paidLogs': False}


def private_input_binding(parent):
    metadata = parent['proxies']['bnb']['metadata']
    return sha(encoded({'baseline': NORMAL_PROXY_BASELINE_SHA, 'proxyInvocation': metadata['invocation'],
        'definitions': metadata['definitions'], 'privateSettings': metadata['privateSettings'],
        'environmentFileHashes': metadata['environmentFileHashes'], 'indices': PROBED_PRIMARY_INDICES}))


def pool_identity_proof(d):
    value = read(d, POOL_PROOF, POOL_PROOF_SHA); parent = read(d, PARENT, PARENT_SHA)
    metadata = parent['proxies']['bnb']['metadata']
    hashes = value.get('primaryUrlSha256')
    if (value.get('format') != 'yunipals-source6-selective-pool-identity-v1' or value.get('chainId') != 56 or
        value.get('parentReceiptSha256') != PARENT_SHA or value.get('normalProxyBaselineSha256') != NORMAL_PROXY_BASELINE_SHA or
        value.get('sourceInvocation') != PARENT_INVOCATION or value.get('proxyInvocation') != metadata['invocation'] or
        value.get('environmentFileHashes') != metadata['environmentFileHashes'] or
        value.get('orderedEnvironmentFiles') != metadata['privateSettings']['orderedEnvironmentFiles'] or
        value.get('primaryIndices') != PROBED_PRIMARY_INDICES or value.get('primaryCount') != 5 or
        value.get('primaryPoolSha256') != qualified_route()['poolSha256'] or
        not isinstance(hashes, list) or len(hashes) != 5 or len(set(hashes)) != 5 or
        any(not isinstance(item, str) or not re.fullmatch('[0-9a-f]{64}', item) for item in hashes) or
        value.get('selectedInputsUnchanged') is not True or value.get('rawUrlsExported') is not False or
        value.get('rawPrivateValuesExported') is not False or
        any(type(value.get(key)) is not int or value[key] != 0 for key in ['providerRequests', 'databaseCalls', 'serviceJobs'])):
        fail('actual_BNB_pool_fingerprint_and_exact_private_inputs_required')
    return {'file': str(POOL_PROOF), 'sha256': POOL_PROOF_SHA, 'privateInputBaselineBindingSha256': private_input_binding(parent),
        'poolSha256': qualified_route()['poolSha256']}


def provider_proof(d):
    """Direct endpoint qualification; the candidate helper ran only offline."""
    value = read(d, PROBE, PROBE_SHA); parent = read(d, PARENT, PARENT_SHA)
    pool = read(d, POOL_PROOF, POOL_PROOF_SHA)
    metadata = parent['proxies']['bnb']['metadata']
    indices = [0]; blocks = [7579200, 14826444]
    expected_limits = {'rpcCalls': 8, 'providerHttpRequests': 6, 'totalResponseBytes': 33554432,
        'perResponseBytes': 10485760, 'deadlineMs': 60000, 'perRequestMs': 10000, 'minimumSpacingMs': 1000, 'identityCheckReserveMs': 5000,
        'redirects': 0, 'clientRetries': 0, 'maximumConcurrentRequests': 1}
    samples = value.get('samples', [])
    selected_hashes = [{'primaryIndex': index, 'urlSha256': pool['primaryUrlSha256'][index]} for index in indices]
    if (value.get('format') != 'yunipals-source6-selective-provider-proof-v8' or value.get('status') != 'qualified_samples' or
        value.get('chainId') != 56 or value.get('freeOnly') is not True or value.get('paidCalls') != 0 or
        value.get('parentReceiptSha256') != PARENT_SHA or value.get('normalProxyBaselineSha256') != NORMAL_PROXY_BASELINE_SHA or
        value.get('sourceInvocation') != PARENT_INVOCATION or value.get('proxyInvocation') != metadata['invocation'] or
        value.get('environmentFileHashes') != metadata['environmentFileHashes'] or
        value.get('orderedEnvironmentFiles') != metadata['privateSettings']['orderedEnvironmentFiles'] or
        value.get('selectedPrimaryUrlSha256') != selected_hashes or
        value.get('poolIdentityProofSha256') != POOL_PROOF_SHA or value.get('poolProofSha256') != POOL_PROOF_SHA or
        value.get('primaryPoolSha256') != qualified_route()['poolSha256'] or
        value.get('previousProofSha256') != '3a7892b7a1f9779c7631baca1cd311bd264cbcf7ee5f30b88d3fc2c6a2db17a1' or
        value.get('directProbeWorkerSha256') != 'f7fc646a01f38b12665037a8ee526e305f4ca17be22c457a46806764328c0e24' or
        value.get('helperSha256') != 'f647e679e9081246d17ed8e447ee23a23f8f90b6e28fbcb4669b3cbdfb096a1d' or
        value.get('v5ReceiptSha256') != '21f777d59cd3e454e6f5fbfaa1fe1df680958a6786dedcde1484b81f05307e56' or
        value.get('comparisonsSha256') != 'f11dd7aa6138da7f582cd26b323b91214ed2a45e19a2c17fa6d33a0957f1905e' or
        value.get('candidateHelperSha256') != HISTORICAL_FILES['yunipals-log-transactions.mjs'] or
        value.get('historicalManifestSha256') != HISTORICAL_SHA or
        any(value.get(key) is not True for key in ['diagnosticComplete', 'sourceIdentityUnchanged', 'proxyIdentityUnchanged',
            'privateInputBaselineBindingUnchanged', 'transactionRequestsSameHttpBatch', 'headerBeforeTransactionBatch',
            'fullBlockSeparateRequest', 'proposedHelperExecuted']) or
        any(value.get(key) is not False for key in ['rawResponsesExported', 'rawUrlsExported', 'rawPrivateValuesExported',
            'matchingLogsQueried', 'configurationChanged', 'fullHistoryVerified', 'throughputVerified',
            'allFutureResponsesQualified', 'proposedRouteExecuted', 'candidateProxySelected']) or
        value.get('qualificationScope') != 'two_fixed_historical_blocks_first_last_block_index_lookup' or
        value.get('transportShape') != 'full_singleton_then_header_singleton_then_first_last_block_index_batch' or
        value.get('transactionSelection') != 'first_and_last_distinct_transaction_bound_to_full_and_header' or
        value.get('lookupMethod') != 'eth_getTransactionByBlockNumberAndIndex' or
        value.get('helperExecution') != 'offline_replay_of_actual_responses' or value.get('helperNetworkRequests') != 0 or
        value.get('endpointAttribution') != 'direct_existing_free_primary_index_and_url_hash' or
        value.get('limits') != expected_limits or value.get('rpcCalls') != 8 or value.get('providerHttpRequests') != 6 or
        value.get('primaryIndices') != indices or value.get('blocks') != blocks or not isinstance(samples, list) or len(samples) != 2 or
        type(value.get('responseBytes')) is not int or not 0 < value['responseBytes'] <= 33554432 or
        type(value.get('elapsedMs')) not in {int, float} or not math.isfinite(value['elapsedMs']) or not 0 <= value['elapsedMs'] <= 60000):
        fail('bounded_actual_free_provider_qualification_required')
    for row, (index, block) in zip(samples, [(i, b) for i in indices for b in blocks]):
        if (row.get('primaryIndex') != index or row.get('blockNumber') != block or
            row.get('primaryUrlSha256') != pool['primaryUrlSha256'][index]):
            fail('exact_direct_endpoint_and_block_sample_required')
        if row.get('equivalent') is True:
            selected = row.get('selectedTransactions'); comparisons = row.get('transactionComparisons')
            if (row.get('attribution') != {'attributed': True, 'primaryIndex': index, 'reason': 'exact_configured_endpoint_direct_request'} or
                any(row.get(key) is not True for key in ['headerEquivalent', 'standardizedBlockEquivalent', 'encodedBlockEquivalent',
                    'discoveryBlockEquivalent', 'discoveryTransactionsEquivalent', 'helperEncodedBlockEquivalent',
                    'helperEncodedTransactionsEquivalent']) or
                row.get('candidateHelperOutcome') != 'passed' or row.get('offlineHelperCalls') != 3 or row.get('failure') is not None or
                row.get('offlineFallbackAttempted') is not False or row.get('selectedTransactionCount') != 2 or
                not isinstance(selected, list) or len(selected) != 2 or
                not isinstance(comparisons, list) or len(comparisons) != 2):
                fail('strict_sparse_comparison_without_fallback_required')
            for position, (transaction, comparison) in enumerate(zip(selected, comparisons)):
                if (not isinstance(transaction, dict) or set(transaction) != {'hash', 'index', 'position'} or
                    type(transaction['position']) is not int or not 0 <= transaction['position'] <= 2147483647 or
                    (transaction['position'] == 0) != (position == 0) or transaction['index'] != hex(transaction['position']) or
                    not isinstance(transaction['hash'], str) or not re.fullmatch('0x[0-9a-f]{64}', transaction['hash']) or
                    not isinstance(comparison, dict) or comparison.get('requestedHash') != transaction['hash'] or
                    comparison.get('requestedIndex') != transaction['index'] or comparison.get('isNull') is not False or
                    comparison.get('normalizationOutcome') != 'passed' or
                    any(comparison.get(key) is not True for key in ['isObject', 'hashMatchesRequested', 'indexMatchesRequested',
                        'blockHashMatchesHeader', 'blockNumberMatchesHeader', 'rawEquivalent', 'standardFieldsEquivalent', 'encodedEquivalent'])):
                    fail('strict_first_last_transaction_identity_and_encoding_required')
            if selected[0]['hash'] == selected[1]['hash']:
                fail('distinct_first_and_last_transactions_required')
    expected = []
    for index in indices:
        observations = [row for row in samples if row['primaryIndex'] == index]
        passing = [row['blockNumber'] for row in observations if row.get('equivalent') is True]
        expected.append({'primaryIndex': index, 'qualified': passing == blocks, 'passingBlocks': passing})
    qualified = [row['primaryIndex'] for row in expected if row['qualified']]
    if (value.get('endpointQualifications') != expected or value.get('qualifiedPrimaryIndices') != qualified or
        not set(qualified_route()['primaryIndices']) <= set(qualified)):
        fail('only_observed_qualified_provider_indices_may_be_selected')
    return {'file': str(PROBE), 'sha256': PROBE_SHA, 'privateInputBaselineBindingSha256': private_input_binding(parent),
        'qualifiedPrimaryIndices': qualified, 'scope': 'two_fixed_historical_blocks_first_last_block_index_lookup',
        'candidateRuntimeExecuted': False, 'helperExecution': 'offline_replay_of_actual_responses'}


def namespace_proof(d):
    value = read(d, NAMESPACE_PROOF, NAMESPACE_PROOF_SHA)
    return {'file': str(NAMESPACE_PROOF), 'sha256': NAMESPACE_PROOF_SHA,
        'actualPinnedHostProof': value}


def inherited(d):
    """Financial and immutable source checks remain in the frozen operator."""
    parent = read(d, PARENT, PARENT_SHA)
    reviewed = read(d, parent['reviewFile'], parent['reviewSha256'])
    if (parent.get('format') != d.normal.FORMAT or parent['ordinaryRuntime']['invocation'] != PARENT_INVOCATION or
        parent.get('freeOnly') is not True or parent.get('paidAuthority') is not False or parent.get('permitIds') != [] or
        reviewed.get('operatorSha256') != NORMAL_SHA): fail('exact_acknowledged_normal3_parent_required')
    spec = reviewed['terminalInput']; h = d.normal.history(d, spec)
    d.normal.profile(d, h['plan'], h['cleanup']); d.normal.financial_state(d, spec, h)
    if d.normal.validate_handoff(d, spec, h) != parent['financialHandoff']:
        fail('unchanged_normal3_financial_handoff_required')
    d.renewal.verify_inputs(d, h['binding'])
    d.ordinary.effective_environment(d.q)
    if d.q.protected(OPS / 'source6-free-runtime-v2.env', 2000) != d.ordinary.source_overlay():
        fail('retained_free_only_source_environment_required')
    return parent, reviewed


def captured_deadline(parent, properties, boot):
    definition = parent['definition']; actual = parent['ordinaryRuntime']
    if (boot != PARENT_BOOT or properties.get('InvocationID') != PARENT_INVOCATION or
        properties.get('MainPID') != str(actual['process']['pid']) or
        properties.get('ExecMainStartTimestampMonotonic') != str(PARENT_START_US) or
        type(definition.get('maximumRuntimeSeconds')) is not int or definition['maximumRuntimeSeconds'] != 28740 or
        type(definition.get('originalRuntimeExpiresMonotonicMicroseconds')) is not int):
        fail('actual_same_boot_normal3_start_required')
    deadline = min(definition['originalRuntimeExpiresMonotonicMicroseconds'],
        PARENT_START_US + definition['maximumRuntimeSeconds'] * 1000000)
    return {'bootId': boot, 'parentStartMonotonicUs': PARENT_START_US,
        'originalRuntimeExpiresMonotonicMicroseconds': deadline}


def remaining_seconds(clock, at, boot):
    if (boot != clock.get('bootId') or boot != PARENT_BOOT or type(at) is not int or
        type(clock.get('originalRuntimeExpiresMonotonicMicroseconds')) is not int):
        fail('same_boot_original_deadline_required')
    remaining = (clock['originalRuntimeExpiresMonotonicMicroseconds'] - at - START_HEADROOM_US) // 1000000
    if not MINIMUM_RUNTIME_SECONDS <= remaining <= 28740: fail('original_deadline_has_no_bounded_start_headroom')
    return remaining


def render_definition(d, parent, clock, review_hash, mode, maximum):
    if mode not in {'selective', 'rollback'}: fail('exact_selective_or_rollback_mode_required')
    if type(maximum) is not int or not 30 <= maximum <= 28740: fail('finite_remaining_source_lifetime_required')
    original = parent['definition']; properties = deepcopy(original['properties'])
    expected = str(OPS / 'source6-rpc-file-v3/rpc-preflight.ts') + ':' + str(d.ordinary.WORKSPACE / 'apps/yunipals-indexer/lib/unified/rpc-preflight.ts')
    if properties.get('BindReadOnlyPaths') != expected: fail('original_RPC_v3_mount_must_be_retained')
    properties['RuntimeMaxSec'] = str(maximum)
    properties['TimeoutStartSec'] = '15'
    if mode == 'selective': properties['BindReadOnlyPaths'] += ' ' + str(HISTORICAL) + ':' + str(HISTORICAL_TARGET)
    text = '[Unit]\nDescription=Yunipals ordinary source6 free-only ' + review_hash + '\nJobTimeoutSec=15\n[Service]\nType=exec\n'
    text += ''.join(k + '=' + v + '\n' for k, v in properties.items())
    text += 'ExecStart=' + ' '.join(d.ordinary.source_command()) + '\n'
    return {'unit': d.ordinary.UNIT, 'text': text, 'sha256': sha(text.encode()), 'properties': properties,
        'maximumRuntimeSeconds': maximum, 'reviewHash': review_hash,
        'originalRuntimeExpiresMonotonicMicroseconds': clock['originalRuntimeExpiresMonotonicMicroseconds']}


def source_definition(d, parent, clock, review_hash, mode, at=None):
    maximum = remaining_seconds(clock, monotonic_us() if at is None else at, boot_id())
    return render_definition(d, parent, clock, review_hash, mode, maximum)


def check_mounts(d, mode):
    expected = [[str(OPS / 'source6-rpc-file-v3/rpc-preflight.ts'),
        str(d.ordinary.WORKSPACE / 'apps/yunipals-indexer/lib/unified/rpc-preflight.ts'), False]]
    if mode == 'selective': expected.append([str(HISTORICAL), str(HISTORICAL_TARGET), False])
    elif mode != 'rollback': fail('exact_runtime_mode_required')
    rows = d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Service', 'BindReadOnlyPaths', 'a(ssbt)')
    if (not isinstance(rows, list) or len(rows) != len(expected) or
        any(not isinstance(row, list) or len(row) != 4 or row[:3] != wanted or
            type(row[3]) is not int or row[3] not in {0, 16384} for row, wanted in zip(rows, expected)) or
        d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Service', 'BindPaths', 'a(ssbt)') != []):
        fail('exact_readonly_RPC_and_historical_mounts_required')


def runtime(d, definition, clock, mode, saved=None):
    p = d.renewal.props(d); expected = definition['properties']; unit = d.ordinary.UNIT
    if (p['Id'] != unit or p['Type'] != 'exec' or p['ActiveState'] != 'active' or p['SubState'] != 'running' or
        not re.fullmatch('[0-9a-f]{32}', p['InvocationID']) or not p['MainPID'].isdigit() or int(p['MainPID']) <= 1 or
        p['User'] != d.native.USER or p['Group'] != d.native.USER or
        p['WorkingDirectory'] != str(d.ordinary.WORKSPACE / 'apps/yunipals-indexer') or
        p['Description'] != 'Yunipals ordinary source6 free-only ' + definition['reviewHash'] or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(d.ordinary.source_command())]):
        fail('exact_selective_source_runtime_required')
    d.q.assert_no_unit_environment(d.qe, unit); check_mounts(d, mode)
    parser = d.c.persistent()
    if (any(p[k] != value for k, value in expected.items() if k not in {'RuntimeMaxSec', 'CPUQuota', 'TimeoutStopSec', 'TimeoutStartSec', 'IPAddressDeny', 'IPAddressAllow', 'BindReadOnlyPaths'}) or
        parser.duration_us(p['RuntimeMaxUSec']) != definition['maximumRuntimeSeconds'] * 1000000 or
        parser.duration_us(p['CPUQuotaPerSecUSec']) != 1000000 or parser.duration_us(p['TimeoutStopUSec']) != 30000000 or
        parser.address_networks(p['IPAddressDeny']) != {'0.0.0.0/0', '::/0'} or
        parser.address_networks(p['IPAddressAllow']) != {'127.0.0.0/8', '::1/128'}):
        fail('unchanged_source_sandbox_and_resources_required')
    if (d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's') != str(SYSTEMD / unit) or
        d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != [] or
        sha(d.q.protected(SYSTEMD / unit, 50000)) != definition['sha256'] or
        d.qe.bus_property(unit, 'org.freedesktop.systemd1.Service', 'RuntimeMaxUSec', 't') != definition['maximumRuntimeSeconds'] * 1000000 or
        d.qe.bus_property(unit, 'org.freedesktop.systemd1.Service', 'TimeoutStartUSec', 't') != 15000000 or
        d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'JobTimeoutUSec', 't') != 15000000):
        fail('exact_selective_source_definition_required')
    reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'selective_source_identity')
    actual = {'unit': unit, 'invocation': p['InvocationID'], 'process': reader.identity(int(p['MainPID']), unit),
        'definitionSha256': definition['sha256'], 'startMonotonicUs': int(p['ExecMainStartTimestampMonotonic']),
        'bootId': boot_id(), 'sourceRole': d.native.USER}
    deadline = clock['originalRuntimeExpiresMonotonicMicroseconds']
    if (actual['bootId'] != clock['bootId'] or actual['bootId'] != PARENT_BOOT or
        actual['startMonotonicUs'] + definition['maximumRuntimeSeconds'] * 1000000 > deadline or
        definition['originalRuntimeExpiresMonotonicMicroseconds'] != deadline or monotonic_us() >= deadline):
        fail('original_normal3_deadline_must_not_extend')
    if saved is not None and actual != saved: fail('acknowledged_selective_invocation_changed')
    return actual


def proxy_files(name):
    if name not in {'base', 'bnb'}: fail('only_Base_BNB_proxy_changes_allowed')
    public = OPS / ('source6-selective-v2-' + name + '.env')
    drop = SYSTEMD / ('yunipals-market-production-rpc@' + name + '.service.d') / OVERRIDE
    body = b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=false\nMARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=false\n'
    if name == 'bnb':
        route = qualified_route()
        body += ('MARKET_RPC_PROXY_BNB_SELECTIVE_PRIMARY_INDICES=' + ','.join(map(str, route['primaryIndices'])) + '\n' +
            'MARKET_RPC_PROXY_BNB_SELECTIVE_POOL_SHA256=' + route['poolSha256'] + '\n').encode()
    text = ('[Service]\nEnvironmentFile=' + str(public) + '\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node ' +
        str(PROXY_OUTPUT / 'rpc-budget-proxy.mjs') + '\n').encode()
    return public, drop, body, text


def qualified_metrics(metrics, name):
    """Accept only the exact qualified subset; never copy endpoint URLs out."""
    if (metrics.get('freeRouting') is not True or metrics.get('paidFallbackOnFreeFailure') is not False or
        metrics.get('sourcePaidFallbackOnFreeFailure') is not False):
        fail('all_global_and_source_paid_fallbacks_must_remain_disabled')
    route = metrics.get('unified', {}).get('selective')
    if name != 'bnb':
        if route is not None: fail('qualified_provider_route_is_BNB_only')
        return None
    wanted = qualified_route()
    if not isinstance(route, dict) or set(route) != {'primaryIndices', 'poolSha256', 'preferred', 'endpoints'}:
        fail('exact_BNB_qualified_route_metrics_required')
    if (route['primaryIndices'] != wanted['primaryIndices'] or route['poolSha256'] != wanted['poolSha256'] or
        type(route['preferred']) is not int or not 0 <= route['preferred'] < len(wanted['primaryIndices']) or
        not isinstance(route['endpoints'], list) or len(route['endpoints']) != len(wanted['primaryIndices'])):
        fail('qualified_BNB_config_and_metrics_must_match')
    for row, index in zip(route['endpoints'], wanted['primaryIndices']):
        if (not isinstance(row, dict) or set(row) != {'primaryIndex', 'coolingDown', 'failures', 'successes'} or
            type(row['primaryIndex']) is not int or row['primaryIndex'] != index or type(row['coolingDown']) is not bool or
            any(type(row[key]) is not int or row[key] < 0 for key in ['failures', 'successes'])):
            fail('qualified_BNB_endpoint_metrics_must_match')
    return wanted


def selected_proxy_health(d, name, expected_config, zero=False):
    # Keep the frozen configuration, source routing and RAM-budget checks.
    result = d.renewal.proxy_health(d, name, expected_config, paid=False, zero=zero)
    _, port = d.ordinary.CHAINS[name]
    qualified_metrics(d.v.request(port, '/metrics'), name)
    return result


def compare_proxy(before, after, name):
    actual = deepcopy(after); public, drop, body, text = proxy_files(name)
    if (actual['definitions'].pop(str(drop), None) != sha(text) or
        not actual['privateSettings']['orderedEnvironmentFiles'] or
        actual['privateSettings']['orderedEnvironmentFiles'].pop() != str(public) + ' (ignore_errors=no)' or
        not actual['environmentFileHashes'] or actual['environmentFileHashes'].pop() !=
        {'path': str(public), 'optional': False, 'exists': True, 'sha256': sha(body)} or
        {k: v for k, v in actual.items() if k != 'invocation'} != {k: v for k, v in before.items() if k != 'invocation'}):
        fail('only_exact_selective_free_proxy_delta_allowed')


def proxy_metadata(d, name):
    if name not in {'base', 'bnb'}: return d.normal.normal_proxy_metadata(d, name)
    public, drop, body, text = proxy_files(name)
    unit = 'yunipals-market-production-rpc@' + name + '.service'; p = d.qe.observed(d.v, unit)
    if (p['ActiveState'] != 'active' or p['SubState'] != 'running' or not re.fullmatch('[0-9a-f]{32}', p['InvocationID']) or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [str(d.selective_proxy.NODE) + ' ' + str(PROXY_OUTPUT / 'rpc-budget-proxy.mjs')] or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', p['ExecStart']) != [str(d.selective_proxy.NODE)] or
        p['User'] != 'yunipals-market-prod-rpc' or p['Group'] != 'yunipals-market-prod-rpc' or
        p['WorkingDirectory'] != str(d.selective_proxy.APP) or d.q.protected(public, 2000) != body or
        d.q.protected(drop, 2000) != text or sha(d.q.protected(PROXY_OUTPUT / 'rpc-budget-proxy.mjs', 3000000)) != PROXY_ENTRY_SHA):
        fail('exact_selected_free_proxy_required')
    return {'invocation': p['InvocationID'], 'definitions': d.v.definitions(p),
        'privateSettings': d.v.private_settings(p), 'environmentFileHashes': d.c.environment_hashes(d.v, p)}


def proxies(d, parent, reviewed, mode, zero=False):
    if mode == 'rollback':
        for name in ['base', 'bnb']:
            if any(os.path.lexists(path) for path in proxy_files(name)[:2]): fail('selective_overlays_must_be_removed_after_rollback')
        return d.normal.check_normal_proxies(d, reviewed, zero=zero)
    result = {}
    for name, old in parent['proxies'].items():
        actual = proxy_metadata(d, name)
        if name in {'base', 'bnb'}: compare_proxy(old['metadata'], actual, name)
        elif actual != old['metadata']: fail('unowned_proxy_identity_changed')
        selected_proxy_health(d, name, old['configuration'], zero=zero)
        result[name] = {'metadata': actual, 'configuration': old['configuration']}
    return result


def fresh():
    if os.path.lexists(BASE):
        st = BASE.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o700 or any(BASE.iterdir()):
            fail('one_fresh_selective_transition_required')


def review(d):
    fresh()
    current = d.normal.validate_current(str(PARENT), PARENT_SHA)
    parent, reviewed = inherited(d)
    if current['ordinaryRuntime']['invocation'] != PARENT_INVOCATION: fail('exact_current_normal3_invocation_required')
    clock = captured_deadline(parent, d.renewal.props(d), boot_id())
    remaining_seconds(clock, monotonic_us(), boot_id())
    # Revalidate after reading the actual monotonic/boot identity. Checkpoints
    # may advance normally, so they are sealed only once the process is stopped.
    d.ordinary.runtime(d.q, d.native, parent['definition'], saved=parent['ordinaryRuntime'])
    historical = historical_overlay(d); proxy = candidate_proxy(d); proof = provider_proof(d); namespace = namespace_proof(d)
    pool_proof = pool_identity_proof(d)
    for name in ['base', 'bnb']:
        public, drop, _, _ = proxy_files(name)
        if any(os.path.lexists(path) for path in [public, drop]) or any(Path(path).name >= OVERRIDE for path in parent['proxies'][name]['metadata']['definitions']):
            fail('fresh_last_selective_proxy_overlay_required')
    return {'format': FORMAT, 'operatorSha256': sha(d.q.protected(Path(__file__).absolute(), 200000)),
        'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA, 'parentInvocation': PARENT_INVOCATION,
        'clock': clock, 'historicalOverlay': historical, 'candidateProxy': proxy, 'providerProof': proof, 'namespaceProof': namespace,
        'qualifiedRoute': qualified_route(), 'poolIdentityProof': pool_proof,
        'sourceRole': reviewed['sourceRole'], 'codePins': reviewed['codePins'], 'rpcOverlay': reviewed['rpcOverlay'],
        'financialHandoff': parent['financialHandoff'], 'proxies': parent['proxies'],
        'freeOnly': True, 'paidAuthority': False, 'permitIds': [], 'sourceSelectionChanged': False,
        'automaticRetryAllowed': False}


def seal_stopped(d, expected, source_role, name):
    journal(d).emit(name + '_stop_intent', invocation=expected['invocation'])
    terminal = stop_owned_source(d, expected)
    peer = d.ordinary.source_state(d.q, d.qe, d.native, source_role, running=False)
    value = {'terminal': terminal, 'invocation': expected['invocation'], 'process': expected['process'],
        'checkpoints': peer['checkpoints'], 'sourceRole': peer['role'], 'bootId': boot_id()}
    pin = d.q.save(BASE / (name + '-stopped.json'), value)
    journal(d).emit(name + '_stopped', receiptSha256=pin)
    return value


def stop_owned_source(d, expected):
    # JobTimeoutSec also bounds stop jobs. A job cancellation at 15s does not
    # prove that the existing 30s service shutdown failed. Wait on the SAME PID
    # and inspect terminal state; never submit a second stop or new start here.
    p = d.renewal.props(d)
    if p['InvocationID'] != expected['invocation'] or p['MainPID'] != str(expected['process']['pid']):
        fail('foreign_source_stop_refused')
    reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'owned_stop_wait')
    if reader.identity(expected['process']['pid'], d.ordinary.UNIT) != expected['process']:
        fail('owned_source_identity_changed_before_stop')
    pidfd = os.pidfd_open(expected['process']['pid'])
    try:
        try: return d.renewal.stop_source(d, expected)
        except Exception:
            poll = select.poll(); poll.register(pidfd, select.POLLIN)
            if not poll.poll(35000): fail('same_owned_source_has_not_exited_after_stop')
            keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID']
            terminal = dict(line.split('=', 1) for line in d.q.run(['/usr/bin/systemctl', 'show', '--all', d.ordinary.UNIT,
                *['--property=' + key for key in keys]], timeout=5).splitlines())
            if (set(terminal) != set(keys) or terminal['Id'] != d.ordinary.UNIT or terminal['LoadState'] != 'loaded' or
                terminal['MainPID'] != '0' or terminal['ActiveState'] not in {'inactive', 'failed'} or
                terminal['SubState'] not in {'dead', 'failed'} or terminal['InvocationID'] not in {'', expected['invocation']}):
                fail('same_owned_source_terminal_proof_required')
            return {'unit': terminal, 'cgroup': d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / d.ordinary.UNIT),
                'stopJobRaisedButOriginalProcessExited': True}
    finally: os.close(pidfd)


def same_stopped(d, reviewed, stopped):
    peer = d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=False)
    if peer['checkpoints'] != stopped['checkpoints']: fail('sealed_stopped_checkpoints_must_not_change')
    if boot_id() != stopped['bootId']: fail('same_boot_stopped_source_required')


def select_proxies(d, parent):
    for name in ['base', 'bnb']:
        before = d.normal.normal_proxy_metadata(d, name)
        if before != parent['proxies'][name]['metadata']: fail('exact_parent_proxy_before_change_required')
        public, drop, body, text = proxy_files(name)
        journal(d).emit('proxy_select_' + name + '_intent', chain=name, beforeInvocation=before['invocation'],
            paidAuthority=False, bootId=boot_id(), earliestStartMonotonicUs=monotonic_us())
        d.ordinary.public_write(d.q, public, body); d.ordinary.public_write(d.q, drop, text)
        d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
        d.q.run(['/usr/bin/systemctl', 'restart', 'yunipals-market-production-rpc@' + name + '.service'], timeout=150)
        after = proxy_metadata(d, name); compare_proxy(before, after, name)
        if after['invocation'] == before['invocation']: fail('new_selective_proxy_invocation_required')
        d.v.retry(lambda: selected_proxy_health(d, name, parent['proxies'][name]['configuration'], zero=True))
        pin = d.q.save(BASE / (name + '-selected.json'), {'before': before, 'after': after})
        journal(d).emit('proxy_selected', chain=name, receiptSha256=pin)


def restore_proxies(d, parent, parent_reviewed, current):
    for name in ['base', 'bnb']:
        before = proxy_metadata(d, name)
        if before != current[name]['metadata']: fail('exact_owned_proxy_before_rollback_required')
        public, drop, body, text = proxy_files(name)
        journal(d).emit('proxy_rollback_intent', chain=name, beforeInvocation=before['invocation'])
        for path, raw in [(drop, text), (public, body)]:
            if d.q.protected(path, 2000) != raw: fail('only_owned_exact_overlay_may_be_removed')
            path.unlink(); d.q.sync_directory(path.parent)
        d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
        d.q.run(['/usr/bin/systemctl', 'restart', 'yunipals-market-production-rpc@' + name + '.service'], timeout=150)
        after = d.normal.normal_proxy_metadata(d, name)
        if after['invocation'] == before['invocation']: fail('fresh_normal_proxy_after_rollback_required')
        original = parent['proxies'][name]['metadata']
        if {k: v for k, v in after.items() if k != 'invocation'} != {k: v for k, v in original.items() if k != 'invocation'}:
            fail('exact_original_proxy_bytes_and_private_inputs_required')
        d.v.retry(lambda: d.renewal.proxy_health(d, name, parent['proxies'][name]['configuration'], paid=False, zero=True))
        pin = d.q.save(BASE / (name + '-restored.json'), {'before': before, 'after': after})
        journal(d).emit('proxy_restored', chain=name, receiptSha256=pin)
    return proxies(d, parent, parent_reviewed, 'rollback', zero=True)


def cancel_owned_start(d, definition, mode):
    """Cancel the exact queued/activating job, including after client timeout."""
    p = d.renewal.props(d); unit = d.ordinary.UNIT
    intent = journal(d).latest(mode + '_source_start_intent')
    if (intent is None or intent.get('definitionSha256') != definition['sha256'] or intent.get('bootId') != PARENT_BOOT or
        boot_id() != PARENT_BOOT or sha(d.q.protected(SYSTEMD / unit, 50000)) != definition['sha256'] or
        p['Id'] != unit or p['User'] != d.native.USER or p['Group'] != d.native.USER or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(d.ordinary.source_command())] or
        d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's') != str(SYSTEMD / unit) or
        d.qe.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != []):
        fail('foreign_source_job_cancel_refused')
    if p['MainPID'] != '0':
        if (not p['MainPID'].isdigit() or int(p['MainPID']) <= 1 or not re.fullmatch('[0-9a-f]{32}', p.get('InvocationID', '')) or
            int(p['ExecMainStartTimestampMonotonic']) < intent['earliestStartMonotonicUs']):
            fail('foreign_source_process_cancel_refused')
        reader = d.q.load(OPS / 'source6-free-process-reader-v2.py', d.ordinary.PROCESS_SHA, 'cancel_exact_owned_source')
        reader.identity(int(p['MainPID']), unit)
    journal(d).emit(mode + '_source_cancel_intent', definitionSha256=definition['sha256'])
    try: d.q.run(['/usr/bin/systemctl', 'stop', unit], timeout=45)
    except Exception:
        deadline = time.monotonic() + 35
        while True:
            pending = d.renewal.props(d)
            if pending['MainPID'] == '0' and pending['ActiveState'] in {'inactive', 'failed'} and pending['SubState'] in {'dead', 'failed'}: break
            if time.monotonic() >= deadline: fail('same_owned_start_cancel_has_not_finished')
            time.sleep(0.2)
    terminal = d.renewal.props(d)
    if terminal['MainPID'] != '0' or terminal['ActiveState'] not in {'inactive', 'failed'} or terminal['SubState'] not in {'dead', 'failed'}:
        fail('owned_start_cancel_not_terminal')
    pending = d.q.run(['/usr/bin/systemctl', 'show', '--value', unit, '--property=Job'], timeout=5).strip()
    if pending not in {'', '0'}: fail('owned_source_job_still_pending')
    d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / unit)
    journal(d).emit(mode + '_source_start_cancelled', definitionSha256=definition['sha256'], processGone=True)


def start(d, parent, reviewed, stopped, mode, prior_definition_sha):
    inherited(d); historical_overlay(d); candidate_proxy(d)
    same_stopped(d, reviewed, stopped)
    definition = source_definition(d, parent, reviewed['clock'], sha(encoded(reviewed)), mode)
    d.q.save(BASE / (mode + '-definition.json'), definition)
    d.renewal.replace_source_definition(d, definition, prior_definition_sha)
    same_stopped(d, reviewed, stopped)
    # systemd itself limits queue time and activation to fifteen seconds each;
    # the client timeout is not treated as a bound on a queued service job.
    if monotonic_us() + START_COMMAND_LIMIT_US + definition['maximumRuntimeSeconds'] * 1000000 > reviewed['clock']['originalRuntimeExpiresMonotonicMicroseconds']:
        fail('start_headroom_consumed_no_source_start')
    journal(d).emit(mode + '_source_start_intent', definitionSha256=definition['sha256'],
        bootId=boot_id(), earliestStartMonotonicUs=monotonic_us())
    try:
        d.q.run(['/usr/bin/systemctl', 'start', d.ordinary.UNIT], timeout=35)
    except BaseException:
        cancel_owned_start(d, definition, mode)
        raise
    actual = runtime(d, definition, reviewed['clock'], mode)
    if actual['invocation'] == stopped['invocation']: fail('new_source_invocation_required')
    d.v.retry(lambda: (d.ordinary.source_health(), d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=True)))
    runtime(d, definition, reviewed['clock'], mode, saved=actual)
    return definition, actual


def save_runtime(d, reviewed, parent, parent_reviewed, mode, definition, actual, stopped, expected_proxies):
    current = proxies(d, parent, parent_reviewed, mode)
    if current != expected_proxies: fail('acknowledged_proxy_identity_changed_during_start')
    baseline = {'proxies': current, 'freeOnly': True, 'paidAuthority': False, 'permitIds': []}
    baseline_file = BASE / (mode + '-proxies.json'); baseline_sha = d.q.save(baseline_file, baseline)
    value = {'format': FORMAT, 'mode': mode, 'reviewFile': str(BASE / 'review.json'), 'reviewSha256': sha(encoded(reviewed)),
        'definition': definition, 'ordinaryRuntime': actual, 'clock': reviewed['clock'],
        'proxyBaselineFile': str(baseline_file), 'proxyBaselineSha256': baseline_sha, 'proxies': current,
        'parentRuntimeFile': str(PARENT), 'parentRuntimeSha256': PARENT_SHA,
        'effectiveRuntime': {'historicalOverlay': reviewed['historicalOverlay'] if mode == 'selective' else None,
            'proxyEntrySha256': PROXY_ENTRY_SHA if mode == 'selective' else d.normal.ADAPTIVE_ENTRY_SHA,
            'qualifiedRoute': reviewed['qualifiedRoute'] if mode == 'selective' else None},
        'stoppedCheckpointsSha256': sha(encoded(stopped['checkpoints'])),
        'sourceDigest': d.native.ACTOR, 'schema': d.native.SCHEMA, 'nativeBuild': d.native.NATIVE,
        'profile': parent['profile'], 'parentReferences': parent['parentReferences'], 'runtimeScope': d.ordinary.RUNTIME_SCOPE,
        'freeOnly': True, 'permitIds': [], 'paidAuthority': False, 'sourceSelectionChanged': False,
        'financialHandoff': parent['financialHandoff'], 'sourceAndChainLeaseReleaseRequired': True}
    path = BASE / ('runtime.json' if mode == 'selective' else 'rollback-runtime.json')
    pin = d.q.save(path, value)
    journal(d).emit(mode + '_runtime_started', receiptFile=str(path), receiptSha256=pin, invocation=actual['invocation'])
    return path, pin


def released(d, mode, path, pin):
    value = {'runtimeReceiptSha256': pin, 'sourceAndChainHandoverLeasesReleased': True}
    receipt = BASE / (mode + '-handover-released.json'); receipt_sha = d.q.save(receipt, value)
    return {'format': FORMAT, 'mode': mode, 'runtimeReceiptFile': str(path), 'runtimeReceiptSha256': pin,
        'leaseReleasedFile': str(receipt), 'leaseReleasedSha256': receipt_sha, 'sourceStarted': True,
        'paidAuthority': False, 'sourceSelectionChanged': False}


def apply(d, expected):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease())
        for name in d.ordinary.CHAINS: locks.enter_context(d.v.chain_lock(name))
        reviewed = review(d)
        if sha(encoded(reviewed)) != expected: fail('exact_fresh_selective_review_required')
        parent, parent_reviewed = inherited(d)
        BASE.mkdir(mode=0o700, exist_ok=True); d.q.sync_directory(BASE.parent)
        d.q.save(BASE / 'review.json', reviewed)
        d.q.save(BASE / 'intent.json', {'reviewHash': expected, 'automaticRetryAllowed': False})
        stage = 'stop_acknowledged_parent'
        try:
            d.normal.validate_current(str(PARENT), PARENT_SHA)
            stopped = seal_stopped(d, parent['ordinaryRuntime'], reviewed['sourceRole'], 'normal3')
            stage = 'select_free_proxy_entries'; select_proxies(d, parent)
            selected = proxies(d, parent, parent_reviewed, 'selective', zero=True)
            stage = 'start_selective_source'
            definition, actual = start(d, parent, reviewed, stopped, 'selective', parent['definition']['sha256'])
            path, pin = save_runtime(d, reviewed, parent, parent_reviewed, 'selective', definition, actual, stopped, selected)
        except BaseException as error:
            d.q.save(BASE / 'failed.json', {'stage': stage, 'failure': d.normal.failure(error),
                'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'selective', path, pin)


def validate_with(d, receipt_file, receipt_sha):
    path = Path(receipt_file)
    if path not in {BASE / 'runtime.json', BASE / 'rollback-runtime.json'}: fail('exact_selective_runtime_receipt_required')
    value = read(d, path, receipt_sha); mode = 'selective' if path.name == 'runtime.json' else 'rollback'
    reviewed = read(d, BASE / 'review.json', value['reviewSha256'])
    if (value.get('format') != FORMAT or value.get('mode') != mode or value.get('reviewFile') != str(BASE / 'review.json') or
        value.get('freeOnly') is not True or value.get('paidAuthority') is not False or value.get('permitIds') != [] or
        value.get('sourceSelectionChanged') is not False or reviewed['operatorSha256'] != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
        value.get('clock') != reviewed['clock'] or os.path.lexists(BASE / 'rollback-failed.json') or
        (mode == 'selective' and os.path.lexists(BASE / 'failed.json'))):
        fail('acknowledged_successful_selective_runtime_required')
    if mode == 'selective' and os.path.lexists(BASE / 'rollback-intent.json'): fail('selective_runtime_superseded_by_rollback')
    release = read(d, BASE / (mode + '-handover-released.json'))
    if release != {'runtimeReceiptSha256': receipt_sha, 'sourceAndChainHandoverLeasesReleased': True}:
        fail('actual_source_and_chain_lease_release_required')
    ack = journal(d).latest(mode + '_runtime_started')
    if ack is None or ack.get('receiptFile') != str(path) or ack.get('receiptSha256') != receipt_sha or ack.get('invocation') != value['ordinaryRuntime']['invocation']:
        fail('actual_selective_runtime_start_ACK_required')
    parent, parent_reviewed = inherited(d)
    if mode == 'rollback' and os.path.lexists(BASE / 'failed.json'):
        completed = read(d, BASE / 'recovery-completed.json')
        if (completed.get('runtimeReceiptSha256') != receipt_sha or completed.get('explicitRecovery') is not True or
            completed.get('failedSha256') != sha(d.q.protected(BASE / 'failed.json', 100000)) or
            completed.get('recoveryIntentSha256') != sha(d.q.protected(BASE / 'recovery-intent.json', 100000))):
            fail('exact_partial_transition_recovery_ACK_required')
    if historical_overlay(d) != reviewed['historicalOverlay'] or candidate_proxy(d) != reviewed['candidateProxy'] or provider_proof(d) != reviewed['providerProof'] or namespace_proof(d) != reviewed['namespaceProof'] or qualified_route() != reviewed['qualifiedRoute'] or pool_identity_proof(d) != reviewed['poolIdentityProof']:
        fail('reviewed_effective_runtime_artifacts_changed')
    expected_clock = captured_deadline(parent, {'InvocationID': PARENT_INVOCATION,
        'MainPID': str(parent['ordinaryRuntime']['process']['pid']), 'ExecMainStartTimestampMonotonic': str(PARENT_START_US)}, PARENT_BOOT)
    if reviewed['clock'] != expected_clock or value['definition'] != render_definition(d, parent, reviewed['clock'], value['reviewSha256'], mode, value['definition']['maximumRuntimeSeconds']):
        fail('exact_inherited_source_definition_and_deadline_required')
    expected_effective = {'historicalOverlay': reviewed['historicalOverlay'] if mode == 'selective' else None,
        'proxyEntrySha256': PROXY_ENTRY_SHA if mode == 'selective' else d.normal.ADAPTIVE_ENTRY_SHA,
        'qualifiedRoute': reviewed['qualifiedRoute'] if mode == 'selective' else None}
    if value['effectiveRuntime'] != expected_effective or value['financialHandoff'] != parent['financialHandoff']:
        fail('effective_runtime_or_financial_lineage_changed')
    actual = runtime(d, value['definition'], reviewed['clock'], mode, saved=value['ordinaryRuntime'])
    d.ordinary.source_health()
    peer = d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=True)
    baseline = read(d, value['proxyBaselineFile'], value['proxyBaselineSha256'])
    current = proxies(d, parent, parent_reviewed, mode)
    if (value['proxyBaselineFile'] != str(BASE / (mode + '-proxies.json')) or
        baseline != {'proxies': current, 'freeOnly': True, 'paidAuthority': False, 'permitIds': []} or value['proxies'] != current):
        fail('actual_selective_proxy_baseline_required')
    return {**value, 'ordinaryRuntime': {**actual, 'roleOid': peer['role']['oid']}, 'checkpoints': peer['checkpoints'],
        'leaseReleasedFile': str(BASE / (mode + '-handover-released.json')), 'leaseReleasedSha256': sha(encoded(release))}


def validate_current(receipt_file, receipt_sha): return validate_with(modules(), receipt_file, receipt_sha)


def rollback(d, expected):
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease())
        for name in d.ordinary.CHAINS: locks.enter_context(d.v.chain_lock(name))
        validate_with(d, str(BASE / 'runtime.json'), expected)
        value = read(d, BASE / 'runtime.json', expected)
        reviewed = read(d, BASE / 'review.json', value['reviewSha256']); parent, parent_reviewed = inherited(d)
        remaining_seconds(reviewed['clock'], monotonic_us(), boot_id())
        d.q.save(BASE / 'rollback-intent.json', {'runtimeReceiptSha256': expected, 'automaticRetryAllowed': False})
        stage = 'stop_acknowledged_selective_source'
        try:
            stopped = seal_stopped(d, value['ordinaryRuntime'], reviewed['sourceRole'], 'selective')
            stage = 'restore_exact_normal_proxy_entries'
            restored = restore_proxies(d, parent, parent_reviewed, value['proxies'])
            stage = 'restart_original_runtime_with_remaining_deadline'
            definition, actual = start(d, parent, reviewed, stopped, 'rollback', value['definition']['sha256'])
            path, pin = save_runtime(d, reviewed, parent, parent_reviewed, 'rollback', definition, actual, stopped, restored)
        except BaseException as error:
            d.q.save(BASE / 'rollback-failed.json', {'stage': stage, 'failure': d.normal.failure(error),
                'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'rollback', path, pin)


def recovery_proxy(d, parent, name):
    """Classify only this operator's exact old/new selector and process state."""
    public, drop, body, text = proxy_files(name)
    present = [os.path.lexists(path) for path in [public, drop]]
    for exists, path, raw in zip(present, [public, drop], [body, text]):
        if exists and d.q.protected(path, 2000) != raw: fail('foreign_proxy_overlay_blocks_recovery')
    if present[1] and not present[0]: fail('unattested_missing_public_proxy_overlay')
    intent = journal(d).latest('proxy_select_' + name + '_intent')
    if any(present) and (intent is None or intent.get('bootId') != PARENT_BOOT or
        intent.get('beforeInvocation') != parent['proxies'][name]['metadata']['invocation']):
        fail('durable_owned_proxy_change_intent_required')
    unit = 'yunipals-market-production-rpc@' + name + '.service'
    p = d.qe.observed(d.v, unit)
    entry = re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart'])
    old_command = str(d.normal_proxy.NODE) + ' ' + str(d.normal.ADAPTIVE_ENTRY)
    new_command = str(d.selective_proxy.NODE) + ' ' + str(PROXY_OUTPUT / 'rpc-budget-proxy.mjs')
    active = p['ActiveState'] == 'active' and p['SubState'] == 'running' and p['MainPID'].isdigit() and int(p['MainPID']) > 1
    terminal = p['ActiveState'] in {'inactive', 'failed'} and p['SubState'] in {'dead', 'failed'} and p['MainPID'] == '0'
    if (not (active or terminal) or p['User'] != 'yunipals-market-prod-rpc' or p['Group'] != 'yunipals-market-prod-rpc' or
        p['WorkingDirectory'] != str(d.selective_proxy.APP) or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', p['ExecStart']) != [str(d.selective_proxy.NODE)]):
        fail('owned_active_or_terminal_proxy_identity_required')
    actual = {'invocation': p['InvocationID'], 'definitions': d.v.definitions(p),
        'privateSettings': d.v.private_settings(p), 'environmentFileHashes': d.c.environment_hashes(d.v, p)}
    if terminal:
        group = d.qe.bus_property(unit, 'org.freedesktop.systemd1.Service', 'ControlGroup', 's')
        if group:
            expected_group = '/system.slice/system-yunipals\\x2dmarket\\x2dproduction\\x2drpc.slice/' + unit
            if group != expected_group:
                fail('exact_owned_proxy_cgroup_required')
            d.seal.cgroup_empty(Path('/sys/fs/cgroup') / group.removeprefix('/'))
    if entry == [old_command]:
        if sha(d.q.protected(d.normal.ADAPTIVE_ENTRY, 3000000)) != d.normal.ADAPTIVE_ENTRY_SHA:
            fail('original_proxy_entry_required_for_recovery')
        if actual != parent['proxies'][name]['metadata']: fail('foreign_old_proxy_invocation_blocks_recovery')
        kind = 'old'
    elif entry == [new_command] and all(present):
        if sha(d.q.protected(PROXY_OUTPUT / 'rpc-budget-proxy.mjs', 3000000)) != PROXY_ENTRY_SHA:
            fail('owned_proxy_entry_required_for_recovery')
        compare_proxy(parent['proxies'][name]['metadata'], actual, name)
        started = d.qe.bus_property(unit, 'org.freedesktop.systemd1.Service', 'ExecMainStartTimestampMonotonic', 't')
        if actual['invocation'] != parent['proxies'][name]['metadata']['invocation'] and (
            type(started) is not int or started < intent['earliestStartMonotonicUs']):
            fail('new_proxy_must_start_after_owned_change_intent')
        kind = 'selected'
    else: fail('unowned_proxy_runtime_blocks_recovery')
    return {'kind': kind, 'metadata': actual, 'publicPresent': present[0], 'dropPresent': present[1], 'terminal': terminal}


def recovery_source(d, parent, reviewed):
    """A running process is stopped only after exact parent/successor proof."""
    p = d.renewal.props(d); path = SYSTEMD / d.ordinary.UNIT
    current_sha = sha(d.q.protected(path, 50000)); definition = parent['definition']; mode = 'parent'
    if current_sha != definition['sha256']:
        candidate = read(d, BASE / 'selective-definition.json')
        if candidate != render_definition(d, parent, reviewed['clock'], sha(encoded(reviewed)), 'selective', candidate['maximumRuntimeSeconds']):
            fail('foreign_source_definition_blocks_recovery')
        if current_sha != candidate['sha256']: fail('only_exact_parent_or_owned_source_may_recover')
        definition = candidate; mode = 'selective'
    if p['ActiveState'] == 'active' and p['SubState'] == 'running':
        if mode == 'parent':
            actual = d.ordinary.runtime(d.q, d.native, definition, saved=parent['ordinaryRuntime'])
        else:
            intent = journal(d).latest('selective_source_start_intent')
            if intent is None or intent.get('definitionSha256') != current_sha or intent.get('bootId') != PARENT_BOOT:
                fail('owned_selective_start_intent_required_for_recovery')
            actual = runtime(d, definition, reviewed['clock'], 'selective')
            if actual['startMonotonicUs'] < intent['earliestStartMonotonicUs']:
                fail('selective_source_must_start_after_owned_intent')
        return {'running': True, 'mode': mode, 'definitionSha256': current_sha, 'actual': actual}
    if (p['Id'] != d.ordinary.UNIT or p['MainPID'] != '0' or p['ActiveState'] not in {'inactive', 'failed'} or
        p['SubState'] not in {'dead', 'failed'} or p['User'] != d.native.USER or p['Group'] != d.native.USER or
        re.findall(r'argv\[\]=(.*?)\s+;', p['ExecStart']) != [' '.join(d.ordinary.source_command())] or
        d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's') != str(path) or
        d.qe.bus_property(d.ordinary.UNIT, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as') != []):
        fail('exact_empty_owned_source_unit_required_for_recovery')
    d.q.assert_no_unit_environment(d.qe, d.ordinary.UNIT)
    d.seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice') / d.ordinary.UNIT)
    return {'running': False, 'mode': mode, 'definitionSha256': current_sha, 'invocation': p['InvocationID']}


def recover(d, failed_sha):
    """Explicit, one-attempt restoration after an interrupted apply.

    It accepts public-file creation, daemon reload, restart and source-start
    boundaries. Unknown unit bytes/processes stop recovery before any mutation.
    It retains all original failure/intent evidence and never retries apply.
    """
    with ExitStack() as locks:
        locks.enter_context(d.c.source_lease())
        for name in d.ordinary.CHAINS: locks.enter_context(d.v.chain_lock(name))
        failed = read(d, BASE / 'failed.json', failed_sha)
        intent = read(d, BASE / 'intent.json'); reviewed = read(d, BASE / 'review.json', intent['reviewHash'])
        if (failed.get('manualReconcileRequired') is not True or failed.get('automaticRetryAllowed') is not False or
            reviewed.get('operatorSha256') != sha(d.q.protected(Path(__file__).absolute(), 200000)) or
            any(os.path.lexists(BASE / name) for name in ['recovery-intent.json', 'rollback-intent.json', 'rollback-runtime.json', 'rollback-failed.json'])):
            fail('one_explicit_owned_failed_apply_recovery_required')
        parent, parent_reviewed = inherited(d)
        remaining_seconds(reviewed['clock'], monotonic_us(), boot_id())
        historical_overlay(d); candidate_proxy(d)
        source = recovery_source(d, parent, reviewed)
        observed = {name: recovery_proxy(d, parent, name) for name in ['base', 'bnb']}
        for name in set(d.ordinary.CHAINS) - {'base', 'bnb'}:
            if d.normal.normal_proxy_metadata(d, name) != parent['proxies'][name]['metadata']:
                fail('unowned_proxy_changed_before_recovery')
        recovery_intent = {'failedSha256': failed_sha, 'reviewSha256': intent['reviewHash'],
            'source': source, 'proxies': observed, 'explicitRecovery': True, 'automaticRetryAllowed': False}
        recovery_pin = d.q.save(BASE / 'recovery-intent.json', recovery_intent)
        stage = 'stop_owned_source_if_running'
        try:
            if source['running']:
                stopped = seal_stopped(d, source['actual'], reviewed['sourceRole'], 'recovery')
            else:
                peer = d.ordinary.source_state(d.q, d.qe, d.native, reviewed['sourceRole'], running=False)
                stopped = {'checkpoints': peer['checkpoints'], 'sourceRole': peer['role'],
                    'bootId': boot_id(), 'invocation': source['invocation']}
                d.q.save(BASE / 'recovery-stopped.json', stopped)
            stage = 'restore_owned_partial_proxy_selectors'
            for name in ['base', 'bnb']:
                if recovery_proxy(d, parent, name) != observed[name]: fail('owned_proxy_state_changed_before_recovery')
                public, drop, body, text = proxy_files(name)
                for exists, path, raw in [(observed[name]['dropPresent'], drop, text), (observed[name]['publicPresent'], public, body)]:
                    if exists:
                        if d.q.protected(path, 2000) != raw: fail('foreign_proxy_bytes_during_recovery')
                        path.unlink(); d.q.sync_directory(path.parent)
                if observed[name]['dropPresent'] or observed[name]['terminal']:
                    d.q.run(['/usr/bin/systemctl', 'daemon-reload'])
                    d.q.run(['/usr/bin/systemctl', 'restart', 'yunipals-market-production-rpc@' + name + '.service'], timeout=150)
                    d.v.retry(lambda: d.renewal.proxy_health(d, name, parent['proxies'][name]['configuration'], paid=False, zero=True))
            restored = proxies(d, parent, parent_reviewed, 'rollback')
            stage = 'restart_original_runtime_with_remaining_deadline'
            definition, actual = start(d, parent, reviewed, stopped, 'rollback', source['definitionSha256'])
            path, pin = save_runtime(d, reviewed, parent, parent_reviewed, 'rollback', definition, actual, stopped, restored)
            d.q.save(BASE / 'recovery-completed.json', {'failedSha256': failed_sha, 'recoveryIntentSha256': recovery_pin,
                'runtimeReceiptSha256': pin, 'explicitRecovery': True})
        except BaseException as error:
            d.q.save(BASE / 'rollback-failed.json', {'stage': stage, 'failure': d.normal.failure(error),
                'manualReconcileRequired': True, 'automaticRetryAllowed': False})
            raise
    return released(d, 'rollback', path, pin)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply'); group.add_argument('--rollback'); group.add_argument('--recover'); group.add_argument('--validate')
    args = parser.parse_args(); d = modules()
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_production_root_required')
    d.q.actual_root_capabilities(); os.umask(0o077)
    def interrupted(*_): raise InterruptedError('bounded_selective_transition_interrupted')
    for sig in [signal.SIGALRM, signal.SIGTERM, signal.SIGINT]: signal.signal(sig, interrupted)
    signal.alarm(480)
    try:
        if args.apply: result = apply(d, args.apply)
        elif args.rollback: result = rollback(d, args.rollback)
        elif args.recover: result = recover(d, args.recover)
        elif args.validate: result = validate_with(d, str(BASE / 'runtime.json'), args.validate)
        else:
            binding = review(d); result = {'reviewHash': sha(encoded(binding)), 'binding': binding}
        print(json.dumps(result, sort_keys=True))
    finally: signal.alarm(0)


if __name__ == '__main__': main()
