#!/usr/bin/env python3
"""New source-authority binding; published data/protocol owners stay unchanged."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-kernel-v1.py'
FORMAT='yunipals-ypal-ordinary-publication-kernel-v1'
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-kernel-v1-20261025')
HELPER=OPS/'ypal-ordinary-generation-accept-binding-v2.py'
HELPER_SHA='e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc'
LAYER_SOURCE=OPS/'ypal-ordinary-publication-accept-v2.py'
LAYER_SHA='7c518d97f1c4f425dce8dee8a4ad3f6f06a37454b0346de177c4cd60b32e56d0'
GUARD=OPS/'ypal-ordinary-source-authority-v6.py'
GUARD_SHA='36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82'
GUARD_MANIFEST=OPS/'ypal-ordinary-source-authority-v6.manifest.json'
GUARD_MANIFEST_SHA='80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452'


def helper():
    for path in [*HELPER.parents,HELPER]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_kernel_caller_helper_required')
    before=HELPER.lstat();raw=HELPER.read_bytes();after=HELPER.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or \
       hashlib.sha256(raw).hexdigest()!=HELPER_SHA or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):raise RuntimeError('exact_kernel_caller_helper_required')
    value=types.ModuleType('kernel_caller_binding');value.__file__=str(HELPER)
    exec(compile(raw,str(HELPER),'exec'),value.__dict__);return value


def guard_module():
    h=helper();raw=h.public(GUARD,GUARD_SHA)
    nodes=[node for node in ast.parse(raw).body if isinstance(node,ast.Assign)and len(node.targets)==1 and
           isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
    h.need(len(nodes)==1,'one_finite_actual_guard_prerequisite_map_required')
    pins=ast.literal_eval(nodes[0].value)
    h.need(type(pins)is dict and len(pins)==5 and all(type(name)is str and '/'not in name and '\\'not in name and h.pin(digest)
        for name,digest in pins.items()),'five_fixed_guard_prerequisites_required')
    expected={'format':'yunipals-ypal-ordinary-source-authority-v6-source','files':{GUARD.name:GUARD_SHA,**pins}}
    h.need(json.loads(h.public(GUARD_MANIFEST,GUARD_MANIFEST_SHA))==expected,'actual_new_guard_source_manifest_required')
    for name,digest in expected['files'].items():h.public(OPS/name,digest)
    value=types.ModuleType('actual_kernel_source_guard');value.__file__=str(GUARD)
    exec(compile(raw,str(GUARD),'exec'),value.__dict__);return value


def inverse_refused(*args,**kwargs):raise RuntimeError('inverse_requires_separate_actual_prefix_source_and_callback_qualification')


def composed():
    h=helper()
    counts=dict.fromkeys(['FORMAT','FILE','BASE'],0)
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name=='composition':
            for row in ast.walk(node):
                if isinstance(row,ast.Dict):
                    for index,key in enumerate(row.keys):
                        if isinstance(key,ast.Constant)and key.value in counts:
                            name=key.value;counts[name]+=1
                            expression='Path('+repr(str(BASE))+')'if name=='BASE'else name
                            row.values[index]=ast.parse(expression,mode='eval').body
        return node
    module=h.derive(h.public(LAYER_SOURCE,LAYER_SHA),LAYER_SHA,FILE,{'FORMAT':FORMAT,'FILE':FILE},{'helper':helper},transform)
    h.need(set(counts.values())=={1},'exact_three_nested_actual_caller_identity_seams_required')
    while 'composed'not in module.__dict__:
        h.need('composition'in module.__dict__,'finite_reviewed_caller_namespace_layers_required')
        module=module.composition()
    result=module.composed()
    h.need(result.GUARD_SHA=='052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0'and
        result.PROVIDER.name=='ypal-ordinary-read-cache-accept-v2.py'and result.READER.name=='ypal-ordinary-reader-accept-v2.py',
        'unchanged_published_data_owners_before_new_guard_binding_required')
    result.GUARD,result.GUARD_SHA=GUARD,GUARD_SHA
    result.guard_module=guard_module
    result.inverse_active_authority=inverse_refused
    return result


def __getattr__(name):return getattr(composed(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('kernel_caller_requires_explicit_actual_forward_session')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'oldSourceQualificationClaimed':False,'callbackTimingQualified':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
