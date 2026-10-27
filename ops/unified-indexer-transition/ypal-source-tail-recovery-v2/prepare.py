#!/usr/bin/env python3
"""Finite pool8 runtime proposal. Never edit the installed pool5 files."""
import argparse
import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
OLD = HERE.parent / 'ypal-combined-source-v1'
BASE_SHA = 'c4ff1ec83c766aa90286b5d73fd22b457135baa6e5880b4b52c4f8d06eca53a4'
CANDIDATE_SHA = '35a6ba332f858790d3f476ef0e3aaa7c04c0e4284ec015ffe48a5dfbf82d81fb'
BUILD = '71e2a7f3b7'
OPS = '/opt/yunipals-unified/operations/free-replay-20261020'
PROJECT = '/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer'
TARGET = OPS + '/ypal-source-tail-recovery-v2'
UNIT = 'yunipals-ypal-combined-source.service'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def dropin():
    pairs = [(TARGET + '/pool8.ponder.config.ts', PROJECT + '/ponder.config.ts'),
             (OPS + '/ypal-combined-source-v1-stage/booster-config.ts', PROJECT + '/lib/boosters/config.ts'),
             (OPS + '/ypal-combined-source-v1-stage/rpc-preflight.ts', PROJECT + '/lib/unified/rpc-preflight.ts')]
    return ('[Service]\n# Exact database-pool-only overlay; source/build/native identity unchanged.\n'
            'BindReadOnlyPaths=\nBindReadOnlyPaths=' + ' '.join(a + ':' + b for a, b in pairs) + '\n').encode()


def proposal():
    old = (OLD / 'payload/ponder.config.ts').read_bytes()
    new = (HERE / 'pool8.ponder.config.ts').read_bytes()
    if sha(old) != BASE_SHA or sha(new) != CANDIDATE_SHA:
        raise RuntimeError('exact_old_and_reviewed_pool8_source_required')
    result = {'format': 'yunipals-source-tail-pool8-proposal-v2', 'sourceOnly': True,
              'unit': UNIT, 'schema': 'unified_ypal_20261023_v1', 'schemaOid': '75963410',
              'buildId': BUILD, 'baseConfigSha256': BASE_SHA, 'candidateConfigSha256': CANDIDATE_SHA,
              'oldDeclaredPoolMaximum': 5, 'newDeclaredPoolMaximum': 8,
              'oldInternalUserReadonlySync': [2, 1, 1, 1], 'newInternalUserReadonlySync': [2, 2, 2, 2],
              'writerRoleOid': '73004621', 'requiredExistingRoleLimit': 32,
              'sourceProfilesChanged': False, 'budgetsRenewed': False, 'paidAuthorityAdded': False,
              'nativeCheckpointCopied': False, 'nativeLatestMonotonicityClaimedAcrossRecovery': False,
              'officialRecoveryUsesRecordedSafeCheckpoint': True, 'officialHeartbeatTimeoutMs': 25000,
              'expectedConfigHash': '0f394941a10f8ad3407029be841ea82a20633b3323f03d95dcfff613c063377d',
              'expectedSchemaHash': 'f4522b6a4b90a56ed63468a70b9a03941d184d3f22f592afdb672952d22957f6',
              'expectedIndexingHash': '8fdfce8c688a96a995023887e62ae028128c0db59d78f93025d2de63938e5af3'}
    files = {'pool8.ponder.config.ts': new, 'offline-build.mjs': (HERE / 'offline-build.mjs').read_bytes(),
             'pool8-dropin.conf': dropin()}
    result['files'] = {name: sha(raw) for name, raw in files.items()}
    return files, result


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--write-new', type=Path); args = p.parse_args()
    files, value = proposal()
    if args.write_new:
        args.write_new.mkdir(mode=0o755, exist_ok=False)
        for name, raw in files.items():
            fd = os.open(args.write_new / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            with os.fdopen(fd, 'wb') as f: f.write(raw); f.flush(); os.fsync(f.fileno())
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__': main()
