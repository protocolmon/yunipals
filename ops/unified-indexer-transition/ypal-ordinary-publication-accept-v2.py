"""Own callback receipt domain over the actual SQL acceptance successor."""
import json
from pathlib import Path
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS / 'ypal-ordinary-publication-accept-v2.py'
FORMAT = 'yunipals-ypal-ordinary-publication-accept-v2'
HELPER = OPS / 'ypal-ordinary-generation-accept-binding-v2.py'
HELPER_SHA = 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc'
LAYER_SOURCE = OPS / 'ypal-ordinary-publication-accept-v1.py'
LAYER_SHA = '06212b568ee5298679633e3dfc30f9e47007c5624ff1a1ff441891f8128c6fcb'

def helper():
    import hashlib
    import stat
    import types
    for path in [*HELPER.parents, HELPER]:
        row = path.lstat()
        if row.st_uid != 0 or row.st_gid != 0 or stat.S_ISLNK(row.st_mode) or row.st_mode & 18:
            raise RuntimeError('protected_acceptance_binding_helper_required')
    before = HELPER.lstat()
    raw = HELPER.read_bytes()
    after = HELPER.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or (not 0 < len(raw) == before.st_size < 100000) or (hashlib.sha256(raw).hexdigest() != HELPER_SHA) or any((getattr(before, key) != getattr(after, key) for key in ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns'])):
        raise RuntimeError('exact_acceptance_binding_helper_required')
    value = types.ModuleType('acceptance_binding')
    value.__file__ = str(HELPER)
    exec(compile(raw, str(HELPER), 'exec'), value.__dict__)
    return value

def composition():
    h = helper()
    return h.derive(h.public(LAYER_SOURCE, LAYER_SHA), LAYER_SHA, FILE, {'FORMAT': 'yunipals-ypal-ordinary-publication-accept-v2', 'FILE': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-publication-accept-v2.py'), 'BASE': Path('/var/backups/yunipals-ypal-ordinary-publication-accept-v2-20261025'), 'HELPER': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-generation-accept-binding-v2.py'), 'HELPER_SHA': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'PROVIDER': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-read-cache-accept-v2.py'), 'PROVIDER_SHA': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'READER': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-reader-accept-v2.py'), 'READER_SHA': '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5'}, {'helper': helper})

def __getattr__(name):
    return getattr(composition(), name)
if __name__ == '__main__':
    import sys
    if len(sys.argv) != 1:
        raise SystemExit('SQL_acceptance_publication_requires_actual_session_and_new_timing')
    print(json.dumps({'format': FORMAT, 'staticOnly': True, 'productionTimingQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
