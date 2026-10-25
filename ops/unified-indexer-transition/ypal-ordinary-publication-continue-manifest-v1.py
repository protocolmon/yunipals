#!/usr/bin/env python3
"""Offline finite actual-byte reader closure; no candidate/input/receipt output."""
import ast
import copy
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
OLD='ypal-ordinary-reader-accept-v2.manifest.json'
OLD_SHA='688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666'
READER='ypal-ordinary-reader-continue-v1.py'
PROVIDER='ypal-ordinary-read-cache-continue-v1.py'
UTILITY='ypal-ordinary-cache-continuation-context-v1.py'
AUTHORITY='ypal-ordinary-cache-continuation-authority-v1.py'
AUTHORITY_MANIFEST='ypal-ordinary-cache-continuation-authority-v1.manifest.json'
KERNEL_STAGE='ypal-ordinary-publication-kernel-v1.stage.json'
KERNEL_STAGE_SHA='d527d90edfebd43fae93e6200e58dad1a0f1cc965a31a0f7c39d21ddd3887e5e'


def build(folder=HERE):
    folder=Path(folder)
    def source(name):
        path=folder/name
        if name=='ypal-old-runtime-inventory-v1.py'and not path.exists():path=folder.parent/'booster-launch'/name
        return path
    def digest(name):return hashlib.sha256(source(name).read_bytes()).hexdigest()
    if digest(OLD)!=OLD_SHA:raise RuntimeError('exact_published_prior_reader_manifest_required')
    previous=json.loads((folder/OLD).read_bytes());value=copy.deepcopy(previous)
    value['format']='yunipals-ypal-ordinary-reader-continue-v1-source'
    value['dependencies']={**previous['dependencies'],**previous['files'],OLD:OLD_SHA}
    if digest(KERNEL_STAGE)!=KERNEL_STAGE_SHA:raise RuntimeError('actual_frozen_kernel_guard_public_closure_required')
    kernel=json.loads((folder/KERNEL_STAGE).read_bytes())
    value['dependencies'].update(kernel['publicFiles']);value['dependencies'][KERNEL_STAGE]=KERNEL_STAGE_SHA
    value['files'].pop('ypal-ordinary-reader-accept-v2.py');value['files'][READER]=digest(READER)
    value['dependencies'].update({PROVIDER:digest(PROVIDER),UTILITY:digest(UTILITY)})
    authority=json.loads((folder/AUTHORITY_MANIFEST).read_bytes())
    nodes=[node for node in ast.parse((folder/AUTHORITY).read_bytes()).body if isinstance(node,ast.Assign)and len(node.targets)==1 and
        isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
    if len(nodes)!=1:raise RuntimeError('one_literal_actual_continuation_source_closure_required')
    pins=ast.literal_eval(nodes[0].value)
    if authority!={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v1-source','files':{AUTHORITY:digest(AUTHORITY),**pins}}:
        raise RuntimeError('exact_actual_continuation_authority_source_manifest_required')
    value['dependencies'].update(authority['files']);value['dependencies'][AUTHORITY_MANIFEST]=digest(AUTHORITY_MANIFEST)
    value['contexts']['phase']={'file':PROVIDER,'sha256':digest(PROVIDER)}
    value['acknowledgementRoute']={'file':READER,'sha256':digest(READER),'method':'acknowledgement'}
    value['externalFeatureContract']={
        'ownerFile':'ypal-ordinary-feature-handover-continue-v1.py','contextFile':'ypal-ordinary-feature-context-continue-v1.py',
        'inputRefs':['resultSha256','manifestSha256','inputSha256','producerSha256','contextSha256'],
        'actualRecordedReaderAncestryRequired':True,'acknowledgementFile':READER,'acknowledgementMethod':'acknowledgement'}
    for name in value['files']:value['dependencies'].pop(name,None)
    for name,expected in {**value['dependencies'],**value['files']}.items():
        if Path(name).name!=name or digest(name)!=expected:raise RuntimeError('all_current_finite_continuation_source_bytes_required')
    return {'ypal-ordinary-reader-continue-v1.manifest.json':value}


if __name__=='__main__':print(json.dumps({'staticOnly':True,'sourceBuilderRequiresExplicitInvocation':True,
    'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
