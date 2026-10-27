#!/usr/bin/env python3
"""Fresh V2 monitor identity; frozen supervision bodies in explicit new globals."""
import hashlib
import json
from pathlib import Path
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS/'ypal-ordinary-generation-attempt-watch-v2.py'
FACTORY = OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA = '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
FROZEN = OPS/'ypal-ordinary-generation-attempt-watch-v1.py'
FROZEN_SHA = '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41'
FORMAT = 'yunipals-ypal-ordinary-generation-attempt-watch-v2'
UNIT = 'yunipals-ypal-ordinary-generation-attempt-v2.service'
WORK = Path('/run/yunipals-ypal-ordinary-generation-attempt-v2-20261025')
APP = 'yunipals_ypal_ordinary_generation_attempt_v2_20261025'
INPUT = Path('/var/backups/yunipals-ypal-ordinary-generation-attempt-input-v2-20261025/input.json')
INPUT_FORMAT = 'yunipals-ypal-ordinary-generation-attempt-v2-input'
ARTIFACT = Path('/opt/yunipals-unified/nonmarket-consumer-releases/a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a')
ENV_FILES = (
    str(OPS/'consumer-generation-v4-inline.env'), '/etc/yunipals-indexer/indexer.env',
    '/etc/yunipals-marketplace/production/indexer-rpc.env', '/etc/yunipals-metadata-cutover.env',
    '/opt/yunipals-ops/query-capacity.env',
    '/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025/yunipals-leaderboard.selectors.env',
    str(OPS/'consumer-generation-v4-capacity.env'),
    '/var/backups/yunipals-ypal-ordinary-generation-attempt-v2-20261025/generation.public.env'
)


def public(path, digest, maximum=200000):
    path = Path(path)
    for item in [*path.parents, path]:
        row = item.lstat()
        if row.st_uid != 0 or row.st_gid != 0 or stat.S_ISLNK(row.st_mode) or row.st_mode&0o022:
            raise RuntimeError('protected_V2_monitor_source_required')
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < len(raw) == before.st_size <= maximum or \
       hashlib.sha256(raw).hexdigest() != digest or any(getattr(before, key) != getattr(after, key) for key in
           ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']):
        raise RuntimeError('exact_V2_monitor_source_required')
    return raw


def factory():
    raw = public(FACTORY, FACTORY_SHA)
    value = types.ModuleType('V2_monitor_namespace_factory'); value.__file__ = str(FACTORY)
    exec(compile(raw, value.__file__, 'exec'), value.__dict__)
    return value


def composition():
    return factory().namespace(public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE,
        {'FORMAT': FORMAT, 'UNIT': UNIT, 'WORK': WORK, 'APP': APP, 'INPUT': INPUT,
         'INPUT_FORMAT': INPUT_FORMAT, 'ENV_FILES': ENV_FILES})


def available(): return composition().available()
def no_overlap_window(seconds): return composition().no_overlap_window(seconds)
def protected_inputs(): return composition().protected_inputs()
def node_args(app): return composition().node_args(app)


def main():
    import sys
    if len(sys.argv) == 1:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'generationStarted': False,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    composition().main()


if __name__ == '__main__': main()
