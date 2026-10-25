"""New static renderer over the actual SQL-acceptance lineage."""
import json
from pathlib import Path
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS / 'ypal-ordinary-publication-input-render-accept-v2.py'
FORMAT = 'yunipals-ypal-ordinary-publication-input-render-accept-v2'
HELPER = OPS / 'ypal-ordinary-generation-accept-binding-v2.py'
HELPER_SHA = 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc'
LAYER_SOURCE = OPS / 'ypal-ordinary-publication-input-render-accept-v1.py'
LAYER_SHA = 'f934344ffa62c336d5dd4a057d05f6a8568139b52452080af02c33849e092705'

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
    return h.derive(h.public(LAYER_SOURCE, LAYER_SHA), LAYER_SHA, FILE, {'FORMAT': 'yunipals-ypal-ordinary-publication-input-render-accept-v2', 'FILE': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-publication-input-render-accept-v2.py'), 'HELPER': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-generation-accept-binding-v2.py'), 'HELPER_SHA': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'BINDING_SHA': '0f5bcd31ead0971f6d3fba26f238f8d7eefbc20f39d2db8a51ca9a356f6aac27', 'READER_MANIFEST': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-reader-accept-v2.manifest.json'), 'READER_MANIFEST_SHA': '688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666', 'PROVIDER': Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-read-cache-accept-v2.py'), 'PROVIDER_SHA': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834'}, {'helper': helper})

def __getattr__(name):
    return getattr(composition(), name)
if __name__ == '__main__':
    import sys
    if len(sys.argv) == 1:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'inputWrites': 0, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
    else:
        try:
            composition().main()
        except Exception:
            raise SystemExit('SQL_acceptance_renderer_refused_no_input_written')
