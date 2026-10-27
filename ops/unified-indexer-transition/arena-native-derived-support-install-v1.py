#!/usr/bin/env python3
"""Exclusive support-file installation; no database, unit or provider actions."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-native-derived-support-install-v1.py'
FORMAT='yunipals-arena-native-derived-support-install-v1'
FROZEN=OPS/'arena-ordinary-runtime-v1.py'
FROZEN_SHA='7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
MANIFEST=OPS/'arena-native-derived-support-v1.manifest.json'
MANIFEST_SHA='19a9a5737c153192c0723aa73c3d3f4e119f2492cb775ac617a63b0b57bbaf5e'
ARTIFACT='a330c3f1ba2701ba287f0675b0c6c11ca010e85d504d5e8798df574625972f67'
TARGET=Path('/opt/yunipals-unified/arena-recovery-support')/ARTIFACT
INPUT=Path('/mnt/HC_Volume_107222036/arena-native-derived-support-v1/artifact')
BASE=Path('/var/backups/yunipals-arena-native-derived-support-install-v1-20261025')


def public(path,expected,maximum=4000000):
    for item in [*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_derived_support_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<=maximum or \
       hashlib.sha256(raw).hexdigest()!=expected or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):raise RuntimeError('exact_derived_support_source_required')
    return raw


def implementation():
    factory=types.ModuleType('support_install_factory');factory.__file__=str(FACTORY)
    exec(compile(public(FACTORY,FACTORY_SHA),str(FACTORY),'exec'),factory.__dict__)
    raw=public(MANIFEST,MANIFEST_SHA);value=json.loads(raw)
    if value['format']!='yunipals-arena-native-derived-support-artifact-v1' or value['artifactDigest']!=ARTIFACT or len(value['files'])!=3 or \
       value['sourceOrigin']!='accepted_native_canonical_event_latest_complete' or value['officialReducerBodyChanged']is not False or \
       value['historicalDepth3ScannerSuccessClaimed']is not False:raise RuntimeError('actual_built_native_support_manifest_required')
    changed=0
    def transform(node):
        nonlocal changed
        if isinstance(node,ast.FunctionDef)and node.name=='main':
            for row in ast.walk(node):
                if isinstance(row,ast.Constant)and type(row.value)is int and row.value==16:row.value=3;changed+=1
        return node
    result=factory.namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'FORMAT':FORMAT,'MANIFEST':MANIFEST,'MANIFEST_SHA':MANIFEST_SHA,'ARTIFACT':ARTIFACT,'TARGET':TARGET,'INPUT':INPUT,'BASE':BASE},
        {'manifest':lambda:(public(MANIFEST,MANIFEST_SHA),value)},transform)
    if changed!=2:raise RuntimeError('exact_two_installer_public_file_count_identity_seams_required')
    return result


def __getattr__(name):return getattr(implementation(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)==1:print(json.dumps({'format':FORMAT,'sourceOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:
        try:implementation().main()
        except Exception:raise SystemExit('support_installation_refused_unknown_result_inspect_existing_exclusive_journal')
