#!/usr/bin/env python3
"""Install the real credential-parser successor; default and import are inert."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-native-derived-support-install-v2.py'
FORMAT='yunipals-arena-native-derived-support-install-v2'
FROZEN=OPS/'arena-native-derived-support-install-v1.py'
FROZEN_SHA='94ae80f4b5bacdb3ca8f3ef831cd6abbe71f40a77deaa344f4953c63e8826ddf'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
MANIFEST=OPS/'arena-native-derived-support-v2.manifest.json'
MANIFEST_SHA='b038bff5a579d08fbd0ebcce4765029d52465f50c854b033b9191c4ecabf1443'
ARTIFACT='8b94c5c50da8adc1673e7d3971a374e8fef54c7c4f98323b8bd49ce72b542a99'
TARGET=Path('/opt/yunipals-unified/arena-recovery-support')/ARTIFACT
INPUT=Path('/mnt/HC_Volume_107222036/arena-native-derived-support-v2/artifact')
BASE=Path('/var/backups/yunipals-arena-native-derived-support-install-v2-20261025')


def public(path,expected,maximum=4000000):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_support2_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<=maximum or \
       hashlib.sha256(raw).hexdigest()!=expected or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):raise RuntimeError('exact_support2_source_required')
    return raw


def composition():
    raw=public(FACTORY,FACTORY_SHA);factory=types.ModuleType('support2_factory');factory.__file__=str(FACTORY)
    exec(compile(raw,str(FACTORY),'exec'),factory.__dict__);changed=0
    def transform(node):
        nonlocal changed
        if isinstance(node,ast.FunctionDef)and node.name=='implementation':
            for value in ast.walk(node):
                if isinstance(value,ast.Constant)and value.value=='yunipals-arena-native-derived-support-artifact-v1':
                    value.value='yunipals-arena-native-derived-support-artifact-v2';changed+=1
        return node
    wrapper=factory.namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {key:globals()[key]for key in['FILE','FORMAT','MANIFEST','MANIFEST_SHA','ARTIFACT','TARGET','INPUT','BASE']},transform=transform)
    if changed!=1:raise RuntimeError('one_actual_support2_manifest_domain_seam_required')
    return wrapper


def implementation():return composition().implementation()


def __getattr__(name):return getattr(implementation(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)==1:print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:
        try:implementation().main()
        except Exception:raise SystemExit('support_installation_refused_unknown_result_inspect_existing_exclusive_journal')
