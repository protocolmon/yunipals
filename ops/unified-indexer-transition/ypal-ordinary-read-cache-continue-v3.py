#!/usr/bin/env python3
"""Explicit identity successor of authenticated immutable CONT2 bodies."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-read-cache-continue-v3.py'
FORMAT='yunipals-ypal-ordinary-read-cache-continue-v3'
FROZEN=OPS/'ypal-ordinary-read-cache-continue-v2.py'
FROZEN_SHA='6155280da8f53e6e3448c024bc3e142a5f69a8d3e1a6a39ae3faa8c1d44d1a34'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
EPOCH=OPS/'ypal-ordinary-metadata-current-epoch-v2.py'
EPOCH_SHA='3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b'
BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v3-20261025')
READER=OPS / 'ypal-ordinary-reader-continue-v3.py'

_implementation=None


def public(path,expected=None,maximum=4000000):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_continuation3_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<=maximum or \
        any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])or \
        (expected is not None and hashlib.sha256(raw).hexdigest()!=expected):raise RuntimeError('same_actual_continuation3_source_required')
    return raw


def factory():
    raw=public(FACTORY,FACTORY_SHA);value=types.ModuleType('continuation3_factory');value.__file__=str(FACTORY)
    exec(compile(raw,str(FACTORY),'exec'),value.__dict__);return value


def composition():
    global _implementation
    if _implementation is None:
        replacements={'ypal-ordinary-reader-continue-v2.manifest.json': 'ypal-ordinary-reader-continue-v3.manifest.json'};counts=dict.fromkeys(replacements,0)
        def transform(node):
            if isinstance(node,(ast.FunctionDef,ast.ClassDef)):
                for value in ast.walk(node):
                    if isinstance(value,ast.Constant)and type(value.value)is str and value.value in replacements:
                        old=value.value;counts[old]+=1;value.value=replacements[old]
            return node
        _implementation=factory().namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
            {key:globals()[key]for key in['FILE', 'FORMAT', 'BASE', 'READER', 'EPOCH', 'EPOCH_SHA']},transform=transform)
        if counts!={'ypal-ordinary-reader-continue-v2.manifest.json': 1}:raise RuntimeError('all_and_only_actual_continuation3_identity_literals_required')
    return _implementation


def __getattr__(name):return getattr(composition(),name)

if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('new_actual_owner3_ACK_and_context_qualification_required')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorProducerSuccessClaimed':False,'priorTimingReused':False,'historicalSelectedActorQualifiedAsCurrent':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
