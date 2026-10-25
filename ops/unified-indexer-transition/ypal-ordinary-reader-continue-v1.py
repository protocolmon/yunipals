#!/usr/bin/env python3
"""Actual cache-continuation reader namespace; prior973 remains immutable."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-reader-continue-v1.py'
FORMAT='yunipals-ypal-ordinary-reader-continue-v1'
BASE=Path('/var/backups/yunipals-ypal-ordinary-reader-continue-v1-20261025')
MANIFEST=OPS/'ypal-ordinary-reader-continue-v1.manifest.json'
PROVIDER='ypal-ordinary-read-cache-continue-v1.py'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449'
CHAIN={'973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5',
    '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e',
    '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17',
    '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0'}


def utility():
    for path in [*UTILITY.parents,UTILITY]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_reader_continuation_utility_required')
    first=UTILITY.lstat();raw=UTILITY.read_bytes();last=UTILITY.lstat()
    if not stat.S_ISREG(first.st_mode)or first.st_nlink!=1 or not 0<len(raw)==first.st_size<100000 or hashlib.sha256(raw).hexdigest()!=UTILITY_SHA or \
       any(getattr(first,key)!=getattr(last,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_reader_continuation_utility_required')
    value=types.ModuleType('actual_continuation_context');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def composition():
    u=utility();base=u.helper()
    identities={'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'MANIFEST':MANIFEST,'PROVIDER':PROVIDER,
        'CACHE_FORMAT':'yunipals-ypal-ordinary-cache-finish-continue-v1',
        'CACHE_BASE':Path('/var/backups/yunipals-ypal-ordinary-cache-finish-continue-v1-20261025'),
        'FEATURE':'ypal-ordinary-feature-handover-continue-v1.py','FEATURE_CONTEXT':'ypal-ordinary-feature-context-continue-v1.py',
        'FEATURE_FORMAT':'yunipals-ypal-ordinary-feature-handover-continue-v1',
        'FEATURE_MANIFEST':OPS/'ypal-ordinary-feature-handover-continue-v1.manifest.json'}
    h=u.Chain(base,FILE,identities,CHAIN)
    outer=h.derive(h.public(u.OLD_READER,u.OLD_READER_SHA),u.OLD_READER_SHA,FILE)
    module=u.unwrap(outer,'Proof');parent=module.Proof
    class Proof(parent):
        def cache_finish_module(self,controller,context):
            value=super().cache_finish_module(controller,context)
            name='ypal-cache-finish-v2.py';digest='8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa'
            expected={'accept':1,'drain_for_inverse':1,'restore_old':1,'reload_review':1};seen={}
            tree=ast.parse(h.public(OPS/name,digest))
            for node in tree.body:
                if isinstance(node,ast.FunctionDef)and node.name in expected:
                    changed,count=u.archive_node(node,"c.cache.BASE / 'original-boot-link'")
                    u.need(count==expected[node.name],'exact_actual_retained_cache_finish_boot_archive_seam_required');seen[node.name]=count
                    exec(compile(ast.fix_missing_locations(ast.Module(body=[changed],type_ignores=[])),str(FILE),'exec'),value.__dict__)
            u.need(seen==expected,'four_retained_boot_archive_functions_required');return value
    module.Proof=Proof
    return module


def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('continued_reader_requires_new_actual_cache_ACK_and_caller_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorReaderSuccessClaimed':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
