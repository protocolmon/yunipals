#!/usr/bin/env python3
"""Static reader refs and immutable metadata epoch refs after actual prepare."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-continue-inputs-v2.py'
FORMAT='yunipals-ypal-ordinary-publication-continue-inputs-v2'
READER=OPS/'ypal-ordinary-reader-continue-v2.py'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v2.manifest.json'
FROZEN=OPS/'ypal-ordinary-publication-continue-inputs-v1.py'
FROZEN_SHA='9fb641bf7cd35aed3032e2d080a77e92b53f58e6692c29b9baff012f4e4e0332'
EPOCH=OPS/'ypal-ordinary-metadata-current-epoch-v1.py'
EPOCH_SHA='7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f'


def epoch_module():
    for item in[*EPOCH.parents,EPOCH]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_static_metadata_epoch_helper_required')
    before=EPOCH.lstat();raw=EPOCH.read_bytes();after=EPOCH.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or hashlib.sha256(raw).hexdigest()!=EPOCH_SHA or \
        any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_static_metadata_epoch_helper_required')
    value=types.ModuleType('static_current_metadata_epoch');value.__file__=str(EPOCH)
    exec(compile(raw,str(EPOCH),'exec'),value.__dict__);return value


def reader_inputs(prepared_sha,manifest_sha):
    current=epoch_module();u=current.consumer_utility();h=u.helper();changed=0
    replacements={'yunipals-ypal-ordinary-reader-continue-v1-source':'yunipals-ypal-ordinary-reader-continue-v2-source',
        'ypal-ordinary-read-cache-continue-v1.py':'ypal-ordinary-read-cache-continue-v2.py'}
    def transform(node):
        nonlocal changed
        if isinstance(node,ast.FunctionDef)and node.name=='reader_inputs':
            for value in ast.walk(node):
                if isinstance(value,ast.Constant)and type(value.value)is str and value.value in replacements:
                    value.value=replacements[value.value];changed+=1
        return node
    actual=h.derive(h.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'FORMAT':FORMAT,'READER':READER,'MANIFEST':MANIFEST},{'utility':lambda:u},transform)
    u.need(changed==2,'two_static_actual_metadata_epoch_reader_identity_seams_required')
    result=actual.reader_inputs(prepared_sha,manifest_sha);manifest=json.loads(u.public(MANIFEST,manifest_sha))
    provider=u.load(OPS/manifest['contexts']['phase']['file'],manifest['contexts']['phase']['sha256'])
    prepared=json.loads(u.public(provider.BASE/'prepared.json',prepared_sha))
    before=json.loads(u.public(provider.BASE/'before.json',prepared['beforeSha256']))
    recorded=before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']
    epoch=current.Epoch(recorded['refs'],manifest)
    u.need(epoch.binding()==recorded,'actual_new_prepared_metadata_epoch_immutable_ACK_ancestry_required')
    return{**result,'metadataRefs':recorded['refs'],'metadataActorCurrentQualified':False}


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepared-sha');parser.add_argument('--manifest-sha');args=parser.parse_args()
    if args.prepared_sha is args.manifest_sha is None:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'inputWrites':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:print(json.dumps(reader_inputs(args.prepared_sha,args.manifest_sha),sort_keys=True))
