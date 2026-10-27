#!/usr/bin/env python3
"""Offline finite source manifests for the actual acceptance producer."""
import hashlib
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent


def module(folder,name):
    spec=importlib.util.spec_from_file_location(name,Path(folder)/name)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def encoded(value):
    return (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()


def build(folder=HERE):
    folder=Path(folder)
    h=module(folder,'ypal-ordinary-generation-accept-binding-v1.py')
    raw=(folder/h.FROZEN.name).read_bytes()
    original=module(folder,h.FROZEN.name)
    h.frozen=lambda:(original,raw)
    implementation=h.composition()
    def public(path,expected=None,maximum=200000):
        name=Path(path).name;data=(folder/name).read_bytes()
        implementation.need(0<len(data)<=maximum and (expected is None or implementation.sha(data)==expected),
                            'actual_local_acceptance_manifest_source_required')
        return data
    implementation.public=public
    r=module(folder,'ypal-ordinary-reader-accept-v1.py');r.helper=lambda:h
    binding=h.build(folder);binding_sha=h.sha(encoded(binding))
    previous=json.loads(public(r.FROZEN_MANIFEST,r.FROZEN_MANIFEST_SHA))
    value=json.loads(json.dumps(previous))
    for name in ['ypal-ordinary-reader-cutover-v6.py','ypal-ordinary-reader-proof-v6.py',
                 'ypal-ordinary-reader-sql-v6.mjs','ypal-ordinary-reader-probe-v6.mjs']:
        value['dependencies'][name]=value['files'].pop(name)
    value['files'][r.FILE.name]=h.sha(public(r.FILE))
    value['files'].update({r.SQL:h.sha(public(r.SQL)),r.PROBE:h.sha(public(r.PROBE))})
    value['dependencies'].update(binding['files'])
    names=[h.FROZEN.name,h.FILE.name,r.FROZEN.name,r.FROZEN_MANIFEST.name,r.WIRE,r.TRANSPORT,
           'ypal-ordinary-read-cache-bound-v1.py','ypal-ordinary-publication-bound-v1.py',
           'ypal-ordinary-read-cache-accept-v1.py','ypal-ordinary-publication-accept-v1.py',
           'ypal-ordinary-publication-caller-v6.py']
    for name in names:value['dependencies'][name]=h.sha(public(name,maximum=4000000))
    value['dependencies'][h.MANIFEST.name]=binding_sha
    value['contexts']['phase']={'file':r.PROVIDER,'sha256':h.sha(public(r.PROVIDER))}
    value['contexts']['generation']={'file':h.OWNER_FILE,'sha256':binding['owner']['sha256']}
    value['format']=r.FORMAT+'-source';value['wireManifestSha256']=r.WIRE_SHA
    value['transportQualification'].update(newProducerSha256=r.TRANSPORT_SHA,newQualificationFile=str(r.QUALIFICATION))
    value['externalFeatureContract']=r.external_feature_contract()
    value['generationBinding']={'file':h.MANIFEST.name,'sha256':binding_sha}
    value['acknowledgementRoute']={'file':r.FILE.name,'sha256':value['files'][r.FILE.name],'method':'acknowledgement'}
    for name in value['files']:value['dependencies'].pop(name,None)
    h.need(set(value['files'])==r.CODE and not set(value['files'])&set(value['dependencies']),
           'finite_acceptance_reader_source_roles_required')
    for name,digest in {**value['files'],**value['dependencies']}.items():
        if name!=h.MANIFEST.name:public(name,digest,4000000)
    return {h.MANIFEST.name:binding,r.MANIFEST.name:value}


if __name__=='__main__':
    print(json.dumps({'staticOnly':True,'builderRequiresExplicitSourceInvocation':True,
                     'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
