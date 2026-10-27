#!/usr/bin/env python3
"""Explicit identity successor of authenticated immutable CONT2 bodies."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-metadata-current-epoch-v2.py'
FORMAT='yunipals-ypal-ordinary-metadata-current-epoch-v2'
FROZEN=OPS/'ypal-ordinary-metadata-current-epoch-v1.py'
FROZEN_SHA='7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
SOURCE_PINS={'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'}
SOURCE_MANIFEST=OPS/'ypal-ordinary-metadata-current-epoch-v2.manifest.json'
OWNER='ypal-native-metadata-approval-epoch-v3.py'
OWNER_MANIFEST='ypal-native-metadata-approval-epoch-v3.manifest.json'
OWNER_FORMAT='yunipals-native-metadata-approval-epoch-v3'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449' 
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


def utility():
    raw=public(UTILITY,UTILITY_SHA);value=types.ModuleType('metadata_epoch2_utility');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def composition():
    global _implementation
    if _implementation is None:
        expected={'format':FORMAT+'-source','files':{FILE.name:hashlib.sha256(public(FILE)).hexdigest(),**SOURCE_PINS}}
        raw=json.dumps(expected,sort_keys=True,indent=2).encode()+b'\n'
        if json.loads(public(SOURCE_MANIFEST,hashlib.sha256(raw).hexdigest()))!=expected:raise RuntimeError('exact_actual_metadata_epoch2_source_manifest_required')
        for name,digest in expected['files'].items():public(OPS/name,digest)
        counts={'ypal-ordinary-cache-continuation-authority-v2.py':0,
            'ypal-ordinary-cache-continuation-authority-v2.manifest.json':0,
            'yunipals-ypal-ordinary-cache-continuation-authority-v2-source':0}
        def transform(node):
            if isinstance(node,ast.FunctionDef)and node.name=='consumer_utility':
                for value in ast.walk(node):
                    if isinstance(value,ast.Constant)and type(value.value)is str and value.value in counts:
                        old=value.value;counts[old]+=1;value.value=old.replace('authority-v2','authority-v3')
            return node
        _implementation=factory().namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
            {key:globals()[key]for key in['FILE','FORMAT','OWNER','OWNER_MANIFEST','OWNER_FORMAT','SOURCE_PINS']},transform=transform)
        if counts!=dict.fromkeys(counts,1):raise RuntimeError('exact_three_new_authority_identity_literals_required')
    return _implementation


def __getattr__(name):return getattr(composition(),name)

if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('new_actual_owner3_ACK_and_context_qualification_required')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorProducerSuccessClaimed':False,'priorTimingReused':False,'historicalSelectedActorQualifiedAsCurrent':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
