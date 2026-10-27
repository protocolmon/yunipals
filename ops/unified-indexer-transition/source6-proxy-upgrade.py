#!/usr/bin/env python3
"""Install one pinned source6 package or upgrade one proxy with paid mode false."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import socket

COMMON_SHA = 'c53cd5e5c34b175b7f1b6ffd026a6358bc22866f45563bcb1c4f9956543c55b2'
COMMON = Path('/opt/yunipals-unified/operations/free-replay-20261020/source6-proxy-common.py')
FORMAT = 'yunipals-source6-free-first-proxy-v1'


def modules():
    import hashlib
    import stat
    import types
    for path in [*COMMON.parents, COMMON]:
        s = path.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022: raise RuntimeError('Protected source6 operator required.')
    raw = COMMON.read_bytes()
    if hashlib.sha256(raw).hexdigest() != COMMON_SHA: raise RuntimeError('Pinned source6 operator required.')
    n = types.ModuleType('source6_proxy_common'); n.__file__ = str(COMMON)
    exec(compile(raw, str(COMMON), 'exec'), n.__dict__)
    c, v = n.modules()
    return n, c, v


def proof_directory(n, c, name, marker):
    import stat
    for path in [n.PROOFS, n.PROOFS / name]:
        path.mkdir(mode=0o700, exist_ok=True); s = path.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077: c.fail('Private exact source6 proof ancestry required.')
    directory = n.PROOFS / name / marker; directory.mkdir(mode=0o700)
    return directory


def pins(n):
    return {'sourceDigest': n.SOURCE, 'sourceRoot': str(n.ROOT), 'sourceArchiveSha256': n.SOURCE_ARCHIVE_SHA,
        'runtimeInventorySha256': n.INVENTORY_SHA, 'runtimeArchiveSha256': n.RUNTIME_ARCHIVE_SHA,
        'runtimeSha256': n.PROXY_SHA, 'sourceManifestSha256': n.SOURCE_MANIFEST_SHA, 'cleanEvidenceSha256': n.EVIDENCE_SHA}


def install_review(n, c, v, stop_sha):
    proof, binding, _ = n.stop_proof(c, v, stop_sha)
    for name in v.CHAINS: n.source5_target(c, v, proof, binding, name)
    p = n.package_module(c); manifest, inventory, _ = n.package_inputs(c, p)
    if os.path.lexists(n.ROOT) or os.path.lexists(n.RUNTIME): c.fail('Fresh source6 package destinations required; retained attempts are never overwritten.')
    if shutil.disk_usage(n.ROOT.parent).free < n.RESERVE + 2_000_000_000: c.fail('Source6 install reserve unavailable.')
    return {'format': FORMAT, 'phase': 'install', **pins(n), 'stopProofSha256': stop_sha,
        'sourceFiles': len(manifest['files']), 'runtimeEntries': len(inventory['entries']), 'commonHelperSha256': COMMON_SHA,
        'operatorSha256': c.sha(c.trusted(Path(__file__).absolute())), 'paidPrimaryEnabled': False, 'sourceStarted': False, 'profileOrCapsChanged': False}


def copy_exclusive(c, v, source, target, expected, maximum):
    # Public archives are streamed; no private input or plaintext service data.
    if source.stat().st_size > maximum or v.digest(source) != expected: c.fail('Bounded public package input changed.')
    with source.open('rb') as incoming, target.open('xb') as output:
        os.chmod(target, 0o600)
        shutil.copyfileobj(incoming, output, 1_048_576)
    if v.digest(target) != expected: c.fail('New public package copy checksum differs.')


def install(n, c, v, review, marker):
    if c.sha(c.encoded(review)) != marker: c.fail('Exact source6 package review required.')
    directory = proof_directory(n, c, 'install', marker); v.save_new(directory / 'review.json', c.encoded(review))
    phase = 'fresh_package_fence'
    def free_guard():
        if shutil.disk_usage(n.ROOT.parent).free < n.RESERVE: c.fail('Source6 host reserve breached; partial new install retained.')
    try:
        again = install_review(n, c, v, review['stopProofSha256'])
        if again != review: c.fail('Source6 install prerequisites changed.')
        p = n.package_module(c); manifest, _, _ = n.package_inputs(c, p)
        if sum(row['bytes'] for row in manifest['files']) > 100_000_000: c.fail('Bounded source6 source allocation required.')
        phase = 'new_source_copy'; p.copy_source(n.WORK / 'source', n.ROOT, manifest)
        phase = 'new_public_runtime_inputs'; n.RUNTIME.mkdir(mode=0o700)
        for source, name, expected, maximum in [
            (n.WORK / 'source.tar.gz', 'source.tar.gz', n.SOURCE_ARCHIVE_SHA, 30_000_000),
            (n.WORK / 'runtime-a/runtime-supplement.tar.gz', 'runtime-supplement.tar.gz', n.RUNTIME_ARCHIVE_SHA, 250_000_000),
            (n.WORK / 'runtime-a/runtime-supplement.inventory.json', 'runtime-supplement.inventory.json', n.INVENTORY_SHA, 40_000_000),
            (n.WORK / 'combined-source6-proof.json', 'combined-source6-proof.json', n.EVIDENCE_SHA, 5_000_000)]:
            free_guard(); copy_exclusive(c, v, source, n.RUNTIME / name, expected, maximum); free_guard()
        phase = 'exclusive_runtime_install'
        runtime_helper = n.PACKAGE_OPS / 'runtime-supplement.py'
        if c.sha(c.trusted(runtime_helper)) != n.RUNTIME_HELPER_SHA: c.fail('Frozen runtime installer changed.')
        command = ['/usr/bin/python3', '-B', str(runtime_helper), 'install', '--archive', str(n.RUNTIME / 'runtime-supplement.tar.gz'),
            '--inventory', str(n.RUNTIME / 'runtime-supplement.inventory.json'), '--archive-sha256', n.RUNTIME_ARCHIVE_SHA,
            '--inventory-sha256', n.INVENTORY_SHA, '--target', str(n.ROOT), '--node', v.NODE]
        installed = json.loads(v.run(command, timeout=180))
        if installed.get('sourceDigest') != n.SOURCE or installed.get('sourceUnchanged') is not True or installed.get('entriesVerified') != 60918 or installed.get('networkCalls') != 0: c.fail('Actual exclusive source6 runtime install proof differs.')
        free_guard(); phase = 'public_source_modes'
        # Only newly created, exact public source files and their parents.
        parents = {n.ROOT}
        for name in ['RELEASE-MANIFEST.json', 'SHA256SUMS', *[r['path'] for r in manifest['files']]]:
            target = n.ROOT / name
            if target.is_symlink() or not target.is_file(): c.fail('New public source file changed.')
            target.chmod(0o644)
            parents.update(p for p in target.parents if p == n.ROOT or p.is_relative_to(n.ROOT))
        for path in parents:
            if path.is_symlink() or not path.is_dir(): c.fail('New public source directory changed.')
            path.chmod(0o755)
        phase = 'full_installed_verification'; runtime = n.verify_installed(c, v)
        n.stop_proof(c, v, review['stopProofSha256'])
        result = {'applied': True, 'reviewHash': marker, 'review': review, **runtime, 'proofDirectory': str(directory),
            'newReleaseOnly': True, 'sourceStarted': False, 'paidPrimaryEnabled': False, 'profileOrCapsChanged': False,
            'newPermits': False, 'providerCalls': 0}
        v.save_new(directory / 'result.json', c.encoded(result))
        return {k: result[k] for k in ['applied', 'reviewHash', 'sourceDigest', 'proofDirectory', 'sourceStarted', 'paidPrimaryEnabled', 'profileOrCapsChanged', 'providerCalls']}
    except Exception as error:
        v.save_new(directory / 'failed-check.json', c.encoded({'phase': phase, 'errorClass': type(error).__name__,
            'partialNewPackageRetained': True, 'olderArtifactsModified': False, 'automaticRetryAllowed': False}))
        c.fail('Source6 package install incomplete; retained partial proof requires diagnosis.')


def content(n, v, name):
    chain, _ = v.CHAINS[name]
    return ('[Service]\nExecStart=\nExecStart=' + v.NODE + ' ' + str(n.ROOT / 'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs') +
        '\nWorkingDirectory=' + str(n.ROOT / 'apps/yunipals-market-api') +
        '\nEnvironment=MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE=' + str(v.PROFILE) +
        '\nEnvironment=MARKET_RPC_PROXY_UNIFIED_PROFILE_ID=' + v.PROFILE_ID +
        '\nEnvironment=MARKET_RPC_PROXY_CHAIN_ID=' + str(chain) + '\nEnvironmentFile=' + str(n.false_file(name)) + '\n')


def local_health(c, v, port, chain, *, source6):
    if v.request(port, '/health').get('status') != 'ready': c.fail('Local proxy health unavailable.')
    metrics = v.request(port, '/metrics')
    if any(k not in metrics for k in v.CONFIG_KEYS): c.fail('Complete existing proxy configuration required.')
    config = {k: metrics[k] for k in v.CONFIG_KEYS}
    if config['freeRouting'] is not True or config['paidFallbackOnFreeFailure'] is not False or config['sourcePaidFallbackOnFreeFailure'] is not False: c.fail('Existing free-first policy differs.')
    if source6 and metrics.get('unified', {}).get('sourceRouting') != 'free_first': c.fail('Source6 paid-primary must remain explicitly false.')
    for workload in ['unified_source', 'unified_evidence']:
        preflight = v.request(port, '/unified/preflight', headers=v.headers(workload))
        if any(preflight.get(k) != expected for k, expected in {'profileId': v.PROFILE_ID, 'chainId': chain, 'manifestHash': v.MANIFEST,
            'scope': 'yunipals-opensea', 'workload': workload, 'paid': 'explicit_bounded_permit_only'}.items()): c.fail('Existing local source policy changed.')
        for key in ['paidCalls', 'refused']:
            if metrics.get('unified', {}).get('traffic', {}).get(workload, {}).get(key) != 0: c.fail('Isolated source/evidence counters must remain zero.')
    return config


def unchanged(n, c, v, review, props, *, installed):
    definitions = v.definitions(props); private = v.private_settings(props); files = c.environment_hashes(v, props)
    if installed:
        if definitions.pop(review['overridePath'], None) != review['overrideSha256']: c.fail('Exact own source6 override required.')
        entry = str(n.false_file(review['chain'])) + ' (ignore_errors=no)'
        if not private['orderedEnvironmentFiles'] or private['orderedEnvironmentFiles'].pop() != entry: c.fail('Only the exact appended public false selector is removable.')
        expected_file = {'path': review['publicEnvironmentPath'], 'optional': False, 'exists': True, 'sha256': review['publicEnvironmentSha256']}
        if not files or files.pop() != expected_file: c.fail('Exact public false file changed.')
    if definitions != review['originalDefinitionHashes'] or private != review['privateSettings'] or files != review['environmentFileHashes']:
        c.fail('Original proxy definitions/private selector order/opaque file bytes changed.')


def peer_ids(v, name):
    return {other: v.state('yunipals-market-production-rpc@' + other + '.service')['InvocationID'] for other in v.CHAINS if other != name}


def upgrade_review(n, c, v, name, stop_sha):
    proof, binding, _ = n.stop_proof(c, v, stop_sha)
    props, inherited = n.source5_target(c, v, proof, binding, name)
    # Both installed runtimes are verified; old rollback bytes stay pinned.
    old = c.verify_runtime(v); p = n.package_module(c); n.package_inputs(c, p); runtime = n.verify_installed(c, v)
    unit = 'yunipals-market-production-rpc@' + name + '.service'; chain, port = v.CHAINS[name]
    target = v.SYSTEMD / (unit + '.d') / n.OVERRIDE
    if any(not (path.stat().st_mode & 0o001) for path in [n.OPS, *n.OPS.parents]): c.fail('Public false file requires traversable protected directory ancestry.')
    if os.path.lexists(target) or os.path.lexists(n.false_file(name)): c.fail('Fresh source6 override/public false file required.')
    definitions = v.definitions(props)
    if any(Path(path).name >= n.OVERRIDE for path in list(definitions)[1:]): c.fail('Unreviewed later proxy override exists.')
    config = local_health(c, v, port, chain, source6=False); text = content(n, v, name)
    return {'format': FORMAT, 'phase': 'upgrade', 'unit': unit, 'chain': name, 'chainId': chain, 'port': port, **runtime,
        'beforeRuntime': old, 'stopProofSha256': stop_sha, 'beforeInvocationId': props['InvocationID'],
        'originalExecStartSha256': v.sha_bytes(props['ExecStart'].encode()), 'originalDefinitionHashes': definitions,
        'privateSettings': inherited['privateSettings'], 'environmentFileHashes': inherited['environmentFileHashes'],
        'legacyConfiguration': config, 'peerProxyInvocations': peer_ids(v, name), 'overridePath': str(target), 'override': text,
        'overrideSha256': c.sha(text.encode()), 'publicEnvironmentPath': str(n.false_file(name)), 'publicEnvironment': n.false_content().decode(),
        'publicEnvironmentSha256': c.sha(n.false_content()), 'commonHelperSha256': COMMON_SHA,
        'operatorSha256': c.sha(c.trusted(Path(__file__).absolute())), 'sourceRouting': 'free_first', 'profileId': v.PROFILE_ID,
        'sourceStarted': False, 'profileOrCapsChanged': False, 'newPermits': False}


def selected_owned(n, c, v, review):
    keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'ExecStart', 'WorkingDirectory', 'FragmentPath', 'DropInPaths']
    raw = v.run(['/usr/bin/systemctl', 'show', review['unit'], *['--property=' + k for k in keys]], timeout=3); props = {}
    for line in raw.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in keys or key in props: c.fail('Unexpected source6 rollback state.')
        props[key] = value
    if (set(props) != set(keys) or props['Id'] != review['unit'] or props['LoadState'] != 'loaded' or
        props['ActiveState'] not in {'active', 'failed', 'inactive'} or not re.fullmatch(r'[a-f0-9]{32}', props['InvocationID']) or
        props['InvocationID'] == review['beforeInvocationId']): c.fail('Exact distinct owned source6 invocation required for rollback.')
    v.verify_exec_start(props, n.ROOT)
    if v.definitions(props) != {**review['originalDefinitionHashes'], review['overridePath']: review['overrideSha256']}: c.fail('Source6 rollback definitions changed.')
    selectors = [*review['privateSettings']['orderedEnvironmentFiles'], review['publicEnvironmentPath'] + ' (ignore_errors=no)']
    expected = [*review['environmentFileHashes'], {'path': review['publicEnvironmentPath'], 'optional': False, 'exists': True, 'sha256': review['publicEnvironmentSha256']}]
    if c.environment_hashes(v, {'EnvironmentFilesEntries': selectors, 'EnvironmentFiles': ''}) != expected: c.fail('Source6 rollback private/public file bytes changed.')
    return props


def upgrade(n, c, v, review, marker):
    if c.sha(c.encoded(review)) != marker: c.fail('Exact source6 proxy review required.')
    directory = proof_directory(n, c, review['chain'], marker); v.save_new(directory / 'review.json', c.encoded(review))
    target, public = Path(review['overridePath']), Path(review['publicEnvironmentPath'])
    installed = False; public_created = False; after_invocation = None; phase = 'pre_install_fence'
    try:
        n.stop_proof(c, v, review['stopProofSha256']); before = v.state(review['unit']); unchanged(n, c, v, review, before, installed=False)
        if before['InvocationID'] != review['beforeInvocationId'] or v.sha_bytes(before['ExecStart'].encode()) != review['originalExecStartSha256'] or peer_ids(v, review['chain']) != review['peerProxyInvocations']: c.fail('Source6 original invocation or peer proxy changed.')
        if v.digest(v.PROFILE) != v.PROFILE_SHA or v.digest(n.ROOT / 'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs') != n.PROXY_SHA: c.fail('Source6 profile/compiled proxy changed.')
        phase = 'new_public_false_file'; v.save_new(public, review['publicEnvironment'].encode(), 0o644); public_created = True
        phase = 'new12z_override'; v.save_new(target, review['override'].encode(), 0o644); installed = True
        phase = 'reload_restart_exact_proxy'; v.run(['/usr/bin/systemctl', 'daemon-reload']); v.run(['/usr/bin/systemctl', 'restart', review['unit']], timeout=150)
        after = v.state(review['unit']); after_invocation = after['InvocationID']; v.verify_exec_start(after, n.ROOT); unchanged(n, c, v, review, after, installed=True)
        phase = 'local_free_first_postchecks'
        if v.retry(lambda: local_health(c, v, review['port'], review['chainId'], source6=True)) != review['legacyConfiguration']: c.fail('Source6 legacy configuration changed.')
        current = v.state(review['unit']); unchanged(n, c, v, review, current, installed=True); v.verify_exec_start(current, n.ROOT)
        if current['InvocationID'] != after_invocation or after_invocation == review['beforeInvocationId'] or peer_ids(v, review['chain']) != review['peerProxyInvocations']: c.fail('Source6 owned invocation or peer proxies changed.')
        n.stop_proof(c, v, review['stopProofSha256'])
        result = {'applied': True, 'reviewHash': marker, 'review': review, 'proofDirectory': str(directory),
            **{k: review[k] for k in ['unit', 'chainId', 'sourceRoot', 'sourceDigest', 'runtimeSha256', 'runtimeInventorySha256', 'runtimeArchiveSha256', 'profileId',
                'overridePath', 'overrideSha256', 'publicEnvironmentPath', 'publicEnvironmentSha256', 'beforeInvocationId']},
            'afterInvocationId': after_invocation, 'verifyExecStart': True, 'legacyHealthPassed': True, 'legacyConfigurationPreserved': True,
            'privateSettingsChanged': False, 'sourceRouting': 'free_first', 'sourceStarted': False, 'profileOrCapsChanged': False,
            'newPermits': False, 'paidCalls': 0, 'sourceSelectionChanged': False}
        v.save_new(directory / 'result.json', c.encoded(result))
        return {k: result[k] for k in ['applied', 'reviewHash', 'unit', 'chainId', 'sourceDigest', 'beforeInvocationId', 'afterInvocationId', 'proofDirectory', 'sourceRouting', 'paidCalls', 'sourceStarted', 'profileOrCapsChanged']}
    except Exception as error:
        failed = {'phase': phase, 'errorClass': type(error).__name__, 'rollbackAttempted': False, 'rollbackSucceeded': False}
        if installed:
            try:
                own = selected_owned(n, c, v, review)
                if after_invocation is not None and own['InvocationID'] != after_invocation: c.fail('Foreign proxy invocation prevents rollback.')
                if selected_owned(n, c, v, review) != own: c.fail('Source6 rollback actor changed.')
                failed['rollbackAttempted'] = True; target.unlink(); public.unlink()
                v.run(['/usr/bin/systemctl', 'daemon-reload']); v.run(['/usr/bin/systemctl', 'restart', review['unit']], timeout=150)
                restored = v.state(review['unit']); unchanged(n, c, v, review, restored, installed=False); v.verify_exec_start(restored, c.ROOT)
                if v.retry(lambda: local_health(c, v, review['port'], review['chainId'], source6=False)) != review['legacyConfiguration']: c.fail('Source5 legacy restoration differs.')
                failed['rollbackSucceeded'] = True
            except Exception as problem: failed['rollbackErrorClass'] = type(problem).__name__
        elif public_created:
            # No override/reload/restart occurred: remove only our exact unselected file.
            try:
                before = v.state(review['unit']); unchanged(n, c, v, review, before, installed=False)
                if before['InvocationID'] != review['beforeInvocationId'] or public.is_symlink() or v.digest(public) != review['publicEnvironmentSha256']: c.fail('Unselected public file ownership changed.')
                public.unlink(); failed['unselectedPublicFileRemoved'] = True
            except Exception as problem: failed['publicFileCleanupErrorClass'] = type(problem).__name__
        v.save_new(directory / 'failed-check.json', c.encoded(failed))
        c.fail('Source6 proxy attempt incomplete; exact owned rollback outcome retained.')


def validate_applied(directory, expected_before_invocation):
    """Bounded local proof/current free-first validation; no provider RPC or lease."""
    n, c, v = modules(); directory = Path(directory)
    if directory.parent.parent != n.PROOFS or directory.parent.name not in v.CHAINS or not re.fullmatch(r'[a-f0-9]{64}', directory.name):
        c.fail('Exact source6 proxy proof directory required.')
    raw = c.trusted(directory / 'review.json', 500_000); review = json.loads(raw)
    result_raw = c.trusted(directory / 'result.json', 750_000); result = json.loads(result_raw)
    name = directory.parent.name; chain, port = v.CHAINS[name]
    expected = {'format': FORMAT, 'phase': 'upgrade', 'unit': 'yunipals-market-production-rpc@' + name + '.service',
        'chain': name, 'chainId': chain, 'port': port, 'sourceRoot': str(n.ROOT), 'sourceDigest': n.SOURCE,
        'runtimeSha256': n.PROXY_SHA, 'runtimeInventorySha256': n.INVENTORY_SHA, 'runtimeArchiveSha256': n.RUNTIME_ARCHIVE_SHA,
        'profileId': v.PROFILE_ID, 'commonHelperSha256': COMMON_SHA, 'beforeInvocationId': expected_before_invocation,
        'publicEnvironmentPath': str(n.false_file(name)), 'publicEnvironment': n.false_content().decode(),
        'publicEnvironmentSha256': c.sha(n.false_content()), 'sourceRouting': 'free_first'}
    if (c.sha(raw) != directory.name or c.sha(c.encoded(review)) != directory.name or
        any(review.get(k) != value for k, value in expected.items()) or review.get('operatorSha256') != c.sha(c.trusted(Path(__file__).absolute())) or
        result.get('review') != review or result.get('reviewHash') != directory.name or result.get('applied') is not True or
        any(result.get(k) is not True for k in ['verifyExecStart', 'legacyHealthPassed', 'legacyConfigurationPreserved']) or
        any(result.get(k) is not False for k in ['privateSettingsChanged', 'sourceStarted', 'profileOrCapsChanged', 'newPermits', 'sourceSelectionChanged']) or
        result.get('paidCalls') != 0 or result.get('sourceRouting') != 'free_first'):
        c.fail('Exact source6 free-first applied provenance differs.')
    for key in ['unit', 'chainId', 'sourceRoot', 'sourceDigest', 'runtimeSha256', 'runtimeInventorySha256', 'runtimeArchiveSha256', 'profileId',
                'overridePath', 'overrideSha256', 'publicEnvironmentPath', 'publicEnvironmentSha256', 'beforeInvocationId']:
        if result.get(key) != review.get(key): c.fail('Source6 applied result/runtime mismatch.')
    if (review['overridePath'] != str(v.SYSTEMD / (review['unit'] + '.d') / n.OVERRIDE) or review['override'] != content(n, v, name) or
        review['overrideSha256'] != c.sha(review['override'].encode()) or c.sha(c.trusted(Path(review['publicEnvironmentPath']), 2000)) != review['publicEnvironmentSha256'] or
        v.digest(n.ROOT / 'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs') != n.PROXY_SHA):
        c.fail('Source6 exact override/false-file/compiled runtime changed.')
    props = v.state(review['unit']); unchanged(n, c, v, review, props, installed=True); v.verify_exec_start(props, n.ROOT)
    if props['InvocationID'] != result.get('afterInvocationId') or props['InvocationID'] == expected_before_invocation:
        c.fail('Source6 applied current invocation differs.')
    if local_health(c, v, port, chain, source6=True) != review['legacyConfiguration']: c.fail('Source6 current free-first configuration differs.')
    return {'applied': True, 'reviewHash': directory.name, 'reviewSha256': c.sha(raw), 'resultSha256': c.sha(result_raw),
        'unit': review['unit'], 'chainId': chain, **pins(n), 'beforeInvocationId': expected_before_invocation,
        'afterInvocationId': props['InvocationID'], 'overridePath': review['overridePath'], 'overrideSha256': review['overrideSha256'],
        'publicEnvironmentPath': review['publicEnvironmentPath'], 'publicEnvironmentSha256': review['publicEnvironmentSha256'],
        'definitionsSha256': c.sha(c.encoded(v.definitions(props))), 'privateSettingsSha256': c.sha(c.encoded(v.private_settings(props))),
        'sourceRouting': 'free_first', 'paidCalls': 0, 'sourceStarted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--phase', choices=['install', 'upgrade'], required=True)
    parser.add_argument('--chain', choices=['base', 'bnb', 'ethereum', 'polygon']); parser.add_argument('--stop-proof-sha256', required=True); parser.add_argument('--apply'); args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main': raise RuntimeError('Exact production root/host required.')
    if not re.fullmatch(r'[a-f0-9]{64}', args.stop_proof_sha256) or (args.phase == 'upgrade') != (args.chain is not None): raise RuntimeError('Exact phase/chain/protected stop proof required.')
    n, c, v = modules()
    with c.source_lease():
        if args.phase == 'install':
            review = install_review(n, c, v, args.stop_proof_sha256)
            if args.apply:
                if args.apply != c.sha(c.encoded(review)): c.fail('Source6 install review changed.')
                result = install(n, c, v, review, args.apply)
            else: result = {'applied': False, 'reviewHash': c.sha(c.encoded(review)), **pins(n), 'phase': 'install', 'paidPrimaryEnabled': False, 'sourceStarted': False}
        else:
            with v.chain_lock(args.chain):
                review = upgrade_review(n, c, v, args.chain, args.stop_proof_sha256)
                if args.apply:
                    if args.apply != c.sha(c.encoded(review)): c.fail('Source6 proxy review changed.')
                    result = upgrade(n, c, v, review, args.apply)
                else: result = {'applied': False, 'reviewHash': c.sha(c.encoded(review)), 'phase': 'upgrade', 'unit': review['unit'], 'sourceDigest': n.SOURCE,
                    'beforeInvocationId': review['beforeInvocationId'], 'sourceRouting': 'free_first', 'sourceStarted': False, 'profileOrCapsChanged': False}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'completed': False, 'errorClass': type(error).__name__})); raise SystemExit(1)
