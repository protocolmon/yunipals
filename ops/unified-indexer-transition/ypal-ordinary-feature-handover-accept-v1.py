#!/usr/bin/env python3
"""New acceptance ancestry; genuine feature business and event gates retained."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-feature-handover-accept-v1.py'
FORMAT='yunipals-ypal-ordinary-feature-handover-accept-v1'
CONTEXT=OPS/'ypal-ordinary-feature-context-accept-v1.py'
MANIFEST=OPS/'ypal-ordinary-feature-handover-accept-v1.manifest.json'
BASE=Path('/var/backups/yunipals-ypal-ordinary-feature-handover-accept-v1-20261025')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-feature-input-accept-v1-20261025/config.json')
def template():
    path=OPS/'ypal-ordinary-feature-handover-bound-v1.py';expected='2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f'
    for item in [*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_accept_feature_template_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or hashlib.sha256(raw).hexdigest()!=expected or any(
        getattr(before,key)!=getattr(after,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_accept_feature_template_required')
    value=types.ModuleType('accept_feature_template');value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value,raw


def helper():return template()[0].helper()


def composition():
    frozen,raw=template();h=frozen.helper();counts={'selector':0,'drop':0,'label':0}
    replacements={
        "Path('/etc/yunipals-unified/booster-ypal-feature-bound-v1.public.env')":("Path('/etc/yunipals-unified/booster-ypal-feature-accept-v1.public.env')",'selector'),
        "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-feature-bound-v1.conf') for u in (API, QUEUE)}":("{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-feature-accept-v1.conf') for u in (API, QUEUE)}",'drop'),
        'actual_bound_feature_context':('actual_accept_feature_context','label')}
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name=='composition':
            for value in ast.walk(node):
                if isinstance(value,ast.Constant)and isinstance(value.value,str)and value.value in replacements:
                    value.value,key=replacements[value.value];counts[key]+=1
        return node
    value=h.derive(raw,hashlib.sha256(raw).hexdigest(),FILE,
        {'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'INPUT':INPUT,'CONTEXT':CONTEXT,'MANIFEST':MANIFEST},
        {'helper':helper},transform)
    h.need(counts=={'selector':1,'drop':1,'label':1},'exact_three_new_accept_feature_owner_identity_seams_required')
    return value


def runtime(manifest_sha):return composition().runtime(manifest_sha)
def validate_feature_leaf(result_sha,manifest_sha,input_sha):return runtime(manifest_sha).validate_feature_leaf(result_sha,manifest_sha,input_sha)
def validate_inverse_leaf(result_sha,manifest_sha,input_sha,reader_inverse_refs=None):return runtime(manifest_sha).validate_inverse_leaf(result_sha,manifest_sha,input_sha,reader_inverse_refs)
def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)==1:print(json.dumps({'format':FORMAT,'sourceOnly':True,'eventRequiredBeforeRetirement':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:
        try:composition().main()
        except BaseException as error:
            import re
            print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_accept_feature_diagnostics_withheld','automaticRetryAllowed':False}))
            raise SystemExit(1)
