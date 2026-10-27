#!/usr/bin/env python3
"""Offline actual metadata epoch and continuation3 finite source manifests."""
import ast
import copy
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
OLD='ypal-ordinary-reader-continue-v2.manifest.json'
OLD_SHA='8c08dd3285dca10b36012e84807ea932ebfafc119c926989a048e66ff1fed743'
READER='ypal-ordinary-reader-continue-v3.py'
PROVIDER='ypal-ordinary-read-cache-continue-v3.py'
CURRENT='ypal-ordinary-metadata-current-epoch-v2.py'
AUTHORITY='ypal-ordinary-cache-continuation-authority-v3.py'
OWNER='ypal-native-metadata-approval-epoch-v3.py'


def encoded(value):return(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()


def build(folder=HERE):
    folder=Path(folder)
    def source(name):
        path=folder/name
        if name=='ypal-old-runtime-inventory-v1.py'and not path.exists():path=folder.parent/'booster-launch'/name
        if name=='final-supervisor-inventory-v1.py'and not path.exists():path=folder.parent/'solana-acceptance'/name
        return path
    def digest(name):return hashlib.sha256(source(name).read_bytes()).hexdigest()
    def closure(name,format):
        nodes=[node for node in ast.parse(source(name).read_bytes()).body if isinstance(node,ast.Assign)and len(node.targets)==1 and
            isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
        if len(nodes)!=1:raise RuntimeError('one_actual_literal_metadata_epoch_source_closure_required')
        pins=ast.literal_eval(nodes[0].value)
        if type(pins)is not dict or not 1<=len(pins)<=512:raise RuntimeError('finite_metadata_epoch_source_closure_required')
        result={'format':format+'-source','files':{name:digest(name),**pins}}
        for path,expected in result['files'].items():
            if Path(path).name!=path or digest(path)!=expected:raise RuntimeError('actual_metadata_epoch_source_bytes_required')
        return result
    if digest(OLD)!=OLD_SHA:raise RuntimeError('immutable_prior_continuation_manifest_required')
    current=closure(CURRENT,'yunipals-ypal-ordinary-metadata-current-epoch-v2')
    authority=closure(AUTHORITY,'yunipals-ypal-ordinary-cache-continuation-authority-v3')
    owner=closure(OWNER,'yunipals-native-metadata-approval-epoch-v3')
    owner_name=OWNER.removesuffix('.py')+'.manifest.json'
    if json.loads(source(owner_name).read_bytes())!=owner:raise RuntimeError('actual_final_metadata_lifecycle_source_manifest_required')
    outputs={CURRENT.removesuffix('.py')+'.manifest.json':current,AUTHORITY.removesuffix('.py')+'.manifest.json':authority}
    previous=json.loads(source(OLD).read_bytes());value=copy.deepcopy(previous)
    value['format']='yunipals-ypal-ordinary-reader-continue-v3-source'
    value['dependencies']={**previous['dependencies'],**previous['files'],OLD:OLD_SHA}
    value['files'].pop('ypal-ordinary-reader-continue-v2.py');value['files'][READER]=digest(READER)
    value['dependencies'][PROVIDER]=digest(PROVIDER)
    for entry in[current,authority,owner]:value['dependencies'].update(entry['files'])
    for name,entry in outputs.items():value['dependencies'][name]=hashlib.sha256(encoded(entry)).hexdigest()
    value['dependencies'][owner_name]=digest(owner_name)
    value['contexts']['phase']={'file':PROVIDER,'sha256':digest(PROVIDER)}
    value['acknowledgementRoute']={'file':READER,'sha256':digest(READER),'method':'acknowledgement'}
    value['externalFeatureContract']={
        'ownerFile':'ypal-ordinary-feature-handover-continue-v3.py','contextFile':'ypal-ordinary-feature-context-continue-v3.py',
        'inputRefs':['resultSha256','manifestSha256','inputSha256','producerSha256','contextSha256'],
        'actualRecordedReaderAncestryRequired':True,'acknowledgementFile':READER,'acknowledgementMethod':'acknowledgement'}
    for name in value['files']:value['dependencies'].pop(name,None)
    for name,expected in{**value['dependencies'],**value['files']}.items():
        if name in outputs:
            actual=hashlib.sha256(encoded(outputs[name])).hexdigest()
        else:actual=digest(name)
        if Path(name).name!=name or actual!=expected:raise RuntimeError('all_actual_continuation3_source_bytes_required')
    outputs['ypal-ordinary-reader-continue-v3.manifest.json']=value;return outputs


if __name__=='__main__':print(json.dumps({'staticOnly':True,'sourceBuilderRequiresExplicitInvocation':True,
    'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
