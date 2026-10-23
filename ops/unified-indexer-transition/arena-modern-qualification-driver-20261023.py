"""Finite on-host driver; retain context reports locally and export public results."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

OPS = Path('/opt/yunipals-unified/operations/arena-modern-package-20261022')
ARTIFACT = Path('/var/tmp/yunipals-runtime-264a3322-20261022')
OPERATOR = OPS / 'arena-modern-runtime-preflight-v1.py'
OPERATOR_SHA = '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631'
SOURCE = '264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24'
MANIFEST = 'fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e'
PROOF = 'a2b353f788d5d6a15408c3ee9cc3e46d100a9fd6a0c4b90230fd9f53091bc01e'
ARCHIVE = '07c5ade8f3c9845bec1f0efb77a9e31a4df62360055e51d1bfb609ecfca5bb76'
INVENTORY = 'ac0d38db4bc0d31e499a07eee8d35196262495bdbca9c6e7ace57f61b17afd61'
PLAN = OPS / 'constructor-plan-20261023.json'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def read(path, maximum=200000):
    for parent in [*path.parents, path]:
        info = parent.lstat()
        assert not parent.is_symlink() and info.st_uid == 0
        assert not info.st_mode & 0o022 or parent == Path('/var/tmp') and info.st_mode & 0o1000
    raw = path.read_bytes()
    assert len(raw) <= maximum
    return raw

def save(path, raw):
    with path.open('xb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())

def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()

def main():
    assert os.geteuid() == 0 and socket.gethostname() == 'yunipals-main'
    os.umask(0o077)
    assert len(sys.argv) == 2
    mode = sys.argv[1]
    assert mode in {'stage', 'review-api', 'qualify-api', 'review-all-eight', 'qualify-all-eight'}
    assert sha(read(OPERATOR)) == OPERATOR_SHA
    if mode == 'stage':
        install_raw = read(ARTIFACT / 'install-result.json')
        install = json.loads(install_raw)
        required = {'format': 'yunipals-arena-modern-install-v1', 'installed': True,
                    'sourceDigest': SOURCE, 'manifestSha256': MANIFEST,
                    'proofSha256': PROOF, 'runtimeArchiveSha256': ARCHIVE,
                    'runtimeInventorySha256': INVENTORY, 'sourceFilesVerified': 1796,
                    'installedEntriesVerified': 60922, 'runtimeStarted': False,
                    'serviceChanges': 0, 'databaseChanges': 0, 'sourceSelectionsChanged': 0,
                    'olderArtifactsModified': False}
        assert all(install.get(k) == v for k, v in required.items())
        plan = {'format': 'yunipals-arena-modern-runtime-preflight-v1',
                'sourceDigest': SOURCE, 'sourceManifestSha256': MANIFEST,
                'packageProofFile': str(ARTIFACT / 'arena-consumer-package-proof.json'),
                'packageProofSha256': PROOF,
                'runtimeInventoryFile': str(ARTIFACT / 'runtime-supplement.inventory.json'),
                'runtimeInventorySha256': INVENTORY, 'runtimeArchiveSha256': ARCHIVE,
                'installResultFile': str(ARTIFACT / 'install-result.json'),
                'installResultSha256': sha(install_raw)}
        raw = encoded(plan)
        save(PLAN, raw)
        print(json.dumps({'staged': True, 'planSha256': sha(raw),
                          'installResultSha256': sha(install_raw), 'constructorInvocations': 0}))
        return
    scope = 'api' if mode.endswith('-api') else 'all-eight'
    plan_raw = read(PLAN)
    command = ['/usr/bin/python3', '-B', str(OPERATOR), '--plan', str(PLAN),
               '--plan-sha256', sha(plan_raw), '--scope', scope]
    if mode.startswith('qualify-'):
        reviewed = json.loads(read(OPS / ('constructor-review-' + scope + '-20261023.json')))
        assert reviewed['qualified'] is False and reviewed['scope'] == scope
        assert reviewed['constructorInvocations'] == 0
        command += ['--qualify', reviewed['reviewHash']]
    prefix = OPS / ('constructor-' + mode + '-20261023')
    save(prefix.with_suffix('.intent.json'), encoded({'mode': mode, 'planSha256': sha(plan_raw),
                                                    'operatorSha256': OPERATOR_SHA}))
    completed = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=650)
    save(prefix.with_suffix('.json'), completed.stdout)
    save(prefix.with_suffix('.stderr'), completed.stderr)
    assert len(completed.stdout) <= 200000 and len(completed.stderr) <= 200000
    value = json.loads(completed.stdout)
    if completed.returncode or completed.stderr:
        print(json.dumps({'completed': False, 'mode': mode, 'returncode': completed.returncode,
                          'fixedCode': value.get('fixedCode'), 'phase': value.get('phase'),
                          'rawValuesExported': False}))
        raise SystemExit(1)
    if mode.startswith('review-'):
        assert value['qualified'] is False and value['constructorInvocations'] == 0
        summary = {'reviewHash': value['reviewHash'], 'scope': scope,
                   'candidate': value['candidate'], 'constructorInvocations': 0,
                   'retained': {k: value['retained'][k] for k in
                                ['committedMigrationMarkers', 'sourceMode', 'sourceSelections']}}
    else:
        assert value['qualified'] is True and value['qualifiedContexts'] == (1 if scope == 'api' else 8)
        summary = {k: value[k] for k in ['reviewHash', 'scope', 'qualified', 'qualifiedContexts',
                                        'serviceJobs', 'schemaWrites', 'sourceSelectionsChanged',
                                        'privateInputsUnchanged', 'mediaQualified']}
        summary['rpcReadCalls'] = sum(row['rpcReadCalls'] for row in value['results'])
        summary['rulesHash'] = value['results'][0]['rulesHash']
        summary['poolHash'] = value['results'][0]['poolHash']
        summary['allClosed'] = all(row['closed'] for row in value['results'])
    print(json.dumps({'completed': True, 'mode': mode, 'reportSha256': sha(completed.stdout),
                      'rawValuesExported': False, **summary}, sort_keys=True))

if __name__ == '__main__':
    main()
