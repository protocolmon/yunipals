#!/usr/bin/env python3
"""Thin actual acceptance SQL-successor namespace; frozen bodies are retained."""
import json
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-reader-accept-v2.py'
FORMAT='yunipals-ypal-ordinary-reader-accept-v2'
HELPER=OPS/'ypal-ordinary-generation-accept-binding-v2.py'
HELPER_SHA='e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc'
LAYER_SOURCE=OPS/'ypal-ordinary-reader-accept-v1.py'
LAYER_SHA='99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e'


def helper():
    # Bootstrap is itself the same reviewed protected loader as the provider.
    import hashlib
    import stat
    import types
    for path in [*HELPER.parents,HELPER]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_acceptance_binding_helper_required')
    before=HELPER.lstat();raw=HELPER.read_bytes();after=HELPER.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or \
       hashlib.sha256(raw).hexdigest()!=HELPER_SHA or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_acceptance_binding_helper_required')
    value=types.ModuleType('acceptance_binding');value.__file__=str(HELPER)
    exec(compile(raw,str(HELPER),'exec'),value.__dict__);return value



def composition():
    h=helper()
    return h.derive(h.public(LAYER_SOURCE,LAYER_SHA),LAYER_SHA,FILE,
        {'FORMAT':'yunipals-ypal-ordinary-reader-accept-v2','BASE':Path('/var/backups/yunipals-ypal-ordinary-reader-accept-v2-20261025'),'MANIFEST':Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-reader-accept-v2.manifest.json'),'PROVIDER':'ypal-ordinary-read-cache-accept-v2.py','CACHE_FORMAT':'yunipals-ypal-ordinary-cache-finish-accept-v2','CACHE_BASE':Path('/var/backups/yunipals-ypal-ordinary-cache-finish-accept-v2-20261025'),'FILE':Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-reader-accept-v2.py'),'HELPER':Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-generation-accept-binding-v2.py'),'HELPER_SHA':'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc'},{'helper':helper})


def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('SQL_acceptance_successor_requires_actual_caller_and_new_timing')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
