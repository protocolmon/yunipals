#!/usr/bin/env python3
"""New caller identities require fresh complete callback timing receipts."""
import json
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-accept-v1.py'
FORMAT='yunipals-ypal-ordinary-publication-accept-v1'
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-accept-v1-20261025')
HELPER=OPS/'ypal-ordinary-generation-accept-binding-v1.py'
HELPER_SHA='4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758'
FROZEN=OPS/'ypal-ordinary-publication-bound-v1.py'
FROZEN_SHA='667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130'
PROVIDER=OPS/'ypal-ordinary-read-cache-accept-v1.py'
PROVIDER_SHA='b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a'
READER=OPS/'ypal-ordinary-reader-accept-v1.py'
READER_SHA='99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e'


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
    return h.derive(h.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'HELPER':HELPER,'HELPER_SHA':HELPER_SHA,'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,
         'PROVIDER':PROVIDER,'PROVIDER_SHA':PROVIDER_SHA,'READER':READER,'READER_SHA':READER_SHA},{'helper':helper})


def __getattr__(name):
    return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('acceptance_publication_requires_actual_session_and_new_timing')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'productionTimingQualified':False,
                     'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
