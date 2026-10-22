#!/usr/bin/env python3
"""Source6 package/stop proof checks. No import-time operations or paid requests."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PACKAGE_OPS = Path('/opt/yunipals-unified/operations/source6-package-20261021')
COMMON_SHA = '25a595d23d8584977df4d02438fc5fe021ef5b077569585cf6a42a853b3bab3c'
PACKAGE_SHA = '76cca2956355de69f6e6e2d60af3ea8f7de2a4bb34807b6dbc06aebc84ef3551'
RUNTIME_HELPER_SHA = '49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4'
SOURCE = '6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6'
SOURCE_ARCHIVE_SHA = '3139077155f9f770dec3cea164333a1c11007531e836ff19a4cb5600c02f37ab'
SOURCE_MANIFEST_SHA = '905d69f1fddc893e882c1c7695288bed85257e2fe7450b3bdc68db099cb55e38'
RUNTIME_ARCHIVE_SHA = '6820ab4c3b1cf9dca3a9f7f407d5cae1c7fadec7f44d4a4ad2c1823362b1544f'
INVENTORY_SHA = 'dbc145f11d13c61ce45b2bcf3c557bd90431bda7ce4a6dbe62136a24db84ab58'
PROXY_SHA = 'aba79fc98d904ccbcab48127721139ef7120fa5c65b752d86c4b507b719b20e2'
EVIDENCE_SHA = 'aa5ed307f93833222ff3ac6238cdb6b27daca2133f29e18263da8229e046200d'
WORK = Path('/tmp/yunipals-unified-release-Source6A')
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
RUNTIME = Path('/var/tmp/yunipals-runtime-6e112a0c-20261021')
PROOFS = Path('/var/backups/yunipals-unified-source6-free-first-20261021')
OVERRIDE = 'zzzzzzzzzzzz-unified-source6-free-first-20261021.conf'
FLAG = 'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY'
STOP_FILE = OPS / 'long2-source6-stop-proof.json'
LONG2 = Path('/var/lib/yunipals-unified-shadow/source5-resumes/20261020-008028af-long2')
NATIVE_UNIT = 'yunipals-unified-persistent-20261020-008028af-long2.service'
CONTROLLER_UNIT = 'yunipals-unified-source5-controller-20261021-long2.service'
NATIVE_INVOCATION = 'debba27f90b44416bd9399305e3392f7'
CONTROLLER_INVOCATION = '96f4790c1de04b1e9b2e324e722bc185'
LONG2_REVIEW_HASH = '54e4b170af9e688ddc77757fe0a241bd783ce7afa508774be09bcd319c00ff8e'
RESUME_SHA = '3756ad3a2eb27f21fe9f1f7005847ff42952838f220cced1db53d8a6759a539b'
RESERVE = 25_000_000_000
STOP_KEYS = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'Result', 'ExecMainStatus', 'MainPID']


def modules():
    import hashlib
    import stat
    path = OPS / 'source5-epoch-common.py'
    for item in [*path.parents, path]:
        s = item.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise RuntimeError('Protected source6 primitive required.')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != COMMON_SHA:
        raise RuntimeError('Exact frozen source5 primitive required.')
    c = types.ModuleType('source6_frozen_source5'); c.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), c.__dict__)
    return c, c.primitives()


def package_module(c):
    return c.load(PACKAGE_OPS / 'source6-package-v3.py', PACKAGE_SHA, 'source6_package_validator')


def package_inputs(c, p):
    """New dependency-clone format is explicitly validated, never relabelled."""
    p.checked_file_hash(Path(p.NODE), p.NODE_SHA, 150_000_000)
    evidence = c.pinned_json(WORK / 'combined-source6-proof.json', EVIDENCE_SHA)
    inventory = c.pinned_json(WORK / 'runtime-a/runtime-supplement.inventory.json', INVENTORY_SHA)
    manifest = c.pinned_json(WORK / 'source/RELEASE-MANIFEST.json', SOURCE_MANIFEST_SHA)
    old_manifest = c.pinned_json(c.ROOT / 'RELEASE-MANIFEST.json', c.SOURCE_MANIFEST_SHA)
    old_inventory = c.pinned_json(c.INVENTORY, c.INVENTORY_SHA)
    patches = {name: p.pinned(WORK / 'source' / name, value, 5_000_000) for name, value in p.PATCHES.items()}
    if p.candidate_manifest(old_manifest, patches) != manifest:
        c.fail('Only the three reviewed paid-option source paths may change.')
    if (manifest.get('sourceDigest') != SOURCE or
        evidence.get('format') != 'yunipals-source6-dependency-clone-package-v3' or
        evidence.get('status') != 'passed_verified_dependency_clone_offline_rebuild' or
        evidence.get('sourceDigest') != SOURCE or evidence.get('nativeBuildId') != c.NATIVE or evidence.get('manifestHash') != c.MANIFEST or
        evidence.get('composition') != {'baseSourceDigest': c.SOURCE, 'exactPatchedSources': p.PATCHES, 'workspaceWideRecapture': False, 'nativeSourceChanged': False}):
        c.fail('Exact source6 dependency-clone provenance required.')
    source, runtime, verify = (evidence[key] for key in ['source', 'runtime', 'verification'])
    if (source.get('archive') != str(WORK / 'source.tar.gz') or source.get('archiveSha256') != SOURCE_ARCHIVE_SHA or
        source.get('sourceManifestSha256') != SOURCE_MANIFEST_SHA or source.get('byteIdenticalSecondCapture') is not True or
        source.get('files') != len(manifest['files']) or inventory.get('sourceDigest') != SOURCE or
        inventory.get('sourceManifestSha256') != SOURCE_MANIFEST_SHA or inventory.get('lockfileSha256') != source.get('lockfileSha256') or
        inventory.get('archiveSha256') != RUNTIME_ARCHIVE_SHA or len(inventory.get('entries', [])) != 60918 or
        runtime.get('archive') != str(WORK / 'runtime-a/runtime-supplement.tar.gz') or
        runtime.get('inventory') != str(WORK / 'runtime-a/runtime-supplement.inventory.json') or
        runtime.get('archiveSha256') != RUNTIME_ARCHIVE_SHA or runtime.get('inventorySha256') != INVENTORY_SHA or
        runtime.get('proxyBundleSha256') != PROXY_SHA or runtime.get('helperSha256') != RUNTIME_HELPER_SHA or
        runtime.get('buildRoot') != str(WORK / 'unpacked') or runtime.get('byteIdenticalSecondCapture') is not True or
        runtime.get('exactRuntimeDelta') != p.runtime_delta(old_inventory, inventory)):
        c.fail('Source6 source/runtime/clone delta identity differs.')
    native = verify.get('nativeBuild', {}); relocated = verify.get('cleanRelocationInstall', {})
    if (verify.get('node') != '24.18.1' or verify.get('dependencyMethod') != 'verified_source5_closure_clone_offline_rebuild' or
        verify.get('packageManagerInstallPerformed') is not False or verify.get('offlineInstall') != {'performed': False, 'packages': 330, 'downloads': 0} or
        any(verify.get(k) is not True for k in ['indexerTypecheck', 'marketTypecheck', 'marketBuild', 'sourceReverified']) or
        verify.get('marketEntrypoints') != 34 or native.get('buildId') != c.NATIVE or native.get('manifestHash') != c.MANIFEST or
        native.get('mockedPreflightIdentityResponses') != 12 or native.get('realProviderCalls') != 0 or native.get('databaseConnections') != 0 or
        verify.get('catalogSmoke', {}).get('islands') != 898 or verify.get('catalogSmoke', {}).get('identityProfiles') != 4 or
        relocated.get('sourceDigest') != SOURCE or relocated.get('sourceUnchanged') is not True or relocated.get('entriesVerified') != 60918 or relocated.get('networkCalls') != 0 or
        inventory.get('bundleProof', {}).get('allSourceContentsMatch') is not True or len(inventory.get('bundleProof', {}).get('bundles', [])) != 34):
        c.fail('Actual source6 offline build/native/relocation proof differs.')
    for path, expected, limit in [(WORK / 'source.tar.gz', SOURCE_ARCHIVE_SHA, 30_000_000),
                                  (WORK / 'runtime-a/runtime-supplement.tar.gz', RUNTIME_ARCHIVE_SHA, 250_000_000)]:
        p.checked_file_hash(path, expected, limit)
    return manifest, inventory, evidence


def verify_installed(c, v):
    import stat
    for name, expected, maximum in [('source.tar.gz', SOURCE_ARCHIVE_SHA, 30_000_000), ('runtime-supplement.tar.gz', RUNTIME_ARCHIVE_SHA, 250_000_000)]:
        if v.digest(v.safe_file(RUNTIME / name, maximum)) != expected:
            c.fail('Installed source6 retained archive checksum differs.')
    inventory = c.pinned_json(RUNTIME / 'runtime-supplement.inventory.json', INVENTORY_SHA)
    for row in inventory['entries']:
        info = (ROOT / row['path']).lstat()
        if stat.S_IMODE(info.st_mode) != row['mode']:
            c.fail('Installed source6 exact runtime mode differs.')
    if (c.sha(c.trusted(RUNTIME / 'combined-source6-proof.json')) != EVIDENCE_SHA or
        c.sha(c.trusted(ROOT / 'RELEASE-MANIFEST.json')) != SOURCE_MANIFEST_SHA):
        c.fail('Installed source6 public proof/manifest changed.')
    return v._verify_runtime(RUNTIME / 'runtime-supplement.inventory.json', root=ROOT, source=SOURCE,
        source_archive_sha=SOURCE_ARCHIVE_SHA, inventory_sha=INVENTORY_SHA, archive_sha=RUNTIME_ARCHIVE_SHA, proxy_sha=PROXY_SHA)


def stopped_value(c, value, unit, invocation, *, allow_gc):
    if set(value) != set(STOP_KEYS) or value['Id'] != unit:
        c.fail('Exact stopped source6 prerequisite fields required.')
    if allow_gc and value == {**{k: '' for k in STOP_KEYS}, 'Id': unit, 'LoadState': 'not-found', 'ActiveState': 'inactive', 'SubState': 'dead', 'Result': 'success', 'ExecMainStatus': '0', 'MainPID': '0'}:
        return
    if (value['LoadState'] != 'loaded' or value['InvocationID'] != invocation or value['ActiveState'] not in {'inactive', 'failed'} or
        value['SubState'] not in {'dead', 'failed'} or value['MainPID'] != '0' or value['Result'] not in {'success', 'signal', 'timeout', 'exit-code'} or
        not re.fullmatch(r'[0-9]{1,3}', value['ExecMainStatus']) or value['ExecMainStatus'] == '75'):
        c.fail('Original long2/controller must be stopped, never replaced or adopted.')


def current_stopped(c, v, unit, invocation):
    import subprocess
    completed = subprocess.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in STOP_KEYS]],
        capture_output=True, text=True, timeout=3, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'})
    if completed.returncode not in {0, 1, 3, 4} or len(completed.stdout.encode()) > 16_000:
        c.fail('Bounded stopped unit observation failed.')
    raw = completed.stdout
    value = {}
    for line in raw.splitlines():
        key, sep, item = line.partition('=')
        if not sep or key not in STOP_KEYS or key in value: c.fail('Unexpected stopped unit metadata.')
        value[key] = item
    stopped_value(c, value, unit, invocation, allow_gc=True)
    return value


def stop_proof(c, v, expected):
    proof = c.pinned_json(STOP_FILE, expected, 100_000)
    keys = {'format', 'reviewSha256', 'monitorSha256', 'terminalWitnessFile', 'terminalWitnessSha256',
        'nativeUnit', 'nativeInvocation', 'controllerUnit', 'controllerInvocation', 'runtimeSha256', 'checkpointsSha256',
        'retainedWorkspace', 'sourceDigest', 'nativeBuild', 'originalCacheBytes', 'proxyStates', 'diagnosis'}
    if (set(proof) != keys or proof['format'] != 'yunipals-long2-source6-stopped-v1' or
        proof['nativeUnit'] != NATIVE_UNIT or proof['nativeInvocation'] != NATIVE_INVOCATION or
        proof['controllerUnit'] != CONTROLLER_UNIT or proof['controllerInvocation'] != CONTROLLER_INVOCATION or
        proof['sourceDigest'] != c.ACTOR or proof['nativeBuild'] != c.NATIVE or proof['originalCacheBytes'] != 531472384 or
        proof['diagnosis'] != 'manual_stop_for_explicitly_approved_one_time_paid_capability_epoch'):
        c.fail('Exact explicitly diagnosed long2 stop receipt required.')
    review = c.pinned_json(LONG2 / 'review.json', proof['reviewSha256'], 2_000_000)
    raw = c.trusted(LONG2 / 'monitor.jsonl', 40_000_000)
    if c.sha(raw) != proof['monitorSha256']: c.fail('Completed long2 monitor checksum differs.')
    rows = [json.loads(line) for line in raw.splitlines()]
    if not 3 <= len(rows) <= 10000: c.fail('Bounded completed long2 monitor required.')
    binding = review.get('binding', {}); first, last = rows[0], rows[-1]
    if (review.get('reviewHash') != LONG2_REVIEW_HASH or c.sha(c.encoded(binding)) != LONG2_REVIEW_HASH or
        binding.get('helperSha256') != RESUME_SHA or binding.get('format') != 'yunipals-persistent-source5-manual-resume-v1' or
        binding.get('sourceDigest') != c.ACTOR or binding.get('nativeBuild') != c.NATIVE or binding.get('freeOnly') is not True or
        binding.get('originalCacheBytes') != 531472384 or binding.get('retainedWorkspace') != proof['retainedWorkspace'] or
        binding.get('sourceOrCacheReset') is not False or binding.get('newWorkspaceCopy') is not False or binding.get('launchGrantIds') != [] or
        binding.get('plan', {}).get('runId') != '20261020-008028af-long2' or first.get('event') != 'started' or
        first.get('reviewHash') != LONG2_REVIEW_HASH or first.get('source5ResumeBinding') != binding or
        first.get('unit') != NATIVE_UNIT or first.get('invocation') != NATIVE_INVOCATION or
        last.get('event') != 'stopped' or last.get('reason') != 'operator_interrupt' or last.get('quarantined') is not True or
        last.get('stopError') is not None or last.get('automaticRetryAllowed') is not False or
        last.get('measuredEightHourCompletion') is not None or last.get('after', {}).get('activeSelector') != []):
        c.fail('Only a completed sealed manual long2 stop can precede source6.')
    after = last['after']; metrics = after['metrics']
    checkpoints = metrics.get('checkpoints', [])
    if (not isinstance(checkpoints, list) or len(checkpoints) != 4 or set(row.get('chain') for row in checkpoints) != {1, 56, 137, 8453} or
        any(not isinstance(row.get(k), str) or not re.fullmatch(r'[0-9]{75}', row[k]) for row in checkpoints for k in ['safe', 'latest', 'finalized'])):
        c.fail('Actual four-chain retained physical checkpoints required.')
    if (metrics.get('runtime', {}).get('buildId') != c.NATIVE or c.sha(c.encoded(metrics['runtime'])) != proof['runtimeSha256'] or
        c.sha(c.encoded(metrics['checkpoints'])) != proof['checkpointsSha256'] or any(c.counters(after['proxies']).values()) or
        set(proof['proxyStates']) != set(c.CHAINS)):
        c.fail('Final retained native/checkpoint/zero-paid/refused proof differs.')
    for sample in [r for r in rows if r.get('event') == 'sample']:
        if sample.get('own', {}).get('InvocationID') != NATIVE_INVOCATION or sample.get('activeSelector') != [] or any(c.counters(sample['proxies']).values()):
            c.fail('Long2 monitor contains a foreign invocation/selector/paid/refusal.')
    witness_path = Path(proof['terminalWitnessFile'])
    if witness_path.parent != OPS or witness_path.name != 'long2-source6-terminal-witness.json': c.fail('Fixed protected terminal witness required.')
    terminal = c.pinned_json(witness_path, proof['terminalWitnessSha256'], 16_000)
    if (set(terminal) != {'format', 'monitorSha256', 'native', 'controller'} or terminal['format'] != 'yunipals-long2-source6-terminal-v1' or terminal['monitorSha256'] != proof['monitorSha256']):
        c.fail('Completed monitor-bound terminal witness required.')
    for key, unit, invocation in [('native', NATIVE_UNIT, NATIVE_INVOCATION), ('controller', CONTROLLER_UNIT, CONTROLLER_INVOCATION)]:
        stopped_value(c, terminal[key], unit, invocation, allow_gc=False)
        current_stopped(c, v, unit, invocation)
    owned = last.get('ownedTerminalState', {})
    if any(owned.get(k) != terminal['native'].get(k) for k in ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'Result', 'ExecMainStatus']):
        c.fail('Monitor actual owned stopped native state must match terminal witness.')
    return proof, binding, last


def source5_target(c, v, proof, binding, name):
    chain, _ = v.CHAINS[name]; row = proof['proxyStates'][str(chain)]
    props = v.state('yunipals-market-production-rpc@' + name + '.service')
    summaries = binding['liveEpoch']['proxies']['proofs']
    summary = next((r for r in summaries if r['chainId'] == chain), None)
    if summary is None or set(row) != {'invocation', 'definitions', 'privateSettings', 'environmentFileHashes'}:
        c.fail('Exact stopped-epoch source5 proxy observation required.')
    directory = Path(binding['plan']['proxyProofDirectories'][str(chain)])
    if directory.parent != Path('/var/backups/yunipals-unified-range-hints-v5-20261021') / name or directory.name != summary['reviewSha256']:
        c.fail('Original source5 applied-proof selector differs.')
    original = c.pinned_json(directory / 'review.json', summary['reviewSha256'], 500_000)
    applied = c.pinned_json(directory / 'result.json', summary['resultSha256'], 750_000)
    if (original.get('format') != 'yunipals-proxy-range-hints-upgrade-v5' or original.get('sourceDigest') != c.SOURCE or original.get('runtimeSha256') != c.PROXY_SHA or
        c.sha(c.encoded(original)) != directory.name or applied.get('review') != original or applied.get('applied') is not True or
        applied.get('afterInvocationId') != row['invocation'] or original.get('environmentFileHashes') != row['environmentFileHashes'] or
        original.get('privateSettings') != row['privateSettings'] or
        {**original.get('originalDefinitionHashes', {}), original.get('overridePath'): original.get('overrideSha256')} != row['definitions']):
        c.fail('Sealed source5 private files/definitions must match original applied receipt.')
    if (row['invocation'] != summary['invocation'] or c.sha(c.encoded(row['definitions'])) != summary['definitionsSha256'] or
        c.sha(c.encoded(row['privateSettings'])) != summary['privateSettingsSha256'] or props['InvocationID'] != row['invocation'] or
        v.definitions(props) != row['definitions'] or v.private_settings(props) != row['privateSettings'] or c.environment_hashes(v, props) != row['environmentFileHashes']):
        c.fail('Current source5 invocation/definitions/private file bytes differ from sealed long2.')
    v.verify_exec_start(props, c.ROOT)
    return props, row


def false_file(name): return OPS / ('source6-proxy-free-first-' + name + '.env')
def false_content(): return (FLAG + '=false\n').encode()
