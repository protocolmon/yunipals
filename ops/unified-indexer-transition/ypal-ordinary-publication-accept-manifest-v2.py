#!/usr/bin/env python3
"""Build new manifests through the unchanged published finite builder."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types

HERE=Path(__file__).resolve().parent
TEMPLATE='ypal-ordinary-publication-accept-manifest-v1.py'
TEMPLATE_SHA='3dfb9392ae78e88b181d8c5e0177772d2a42c0ed8e65c6bcf91b55d19be0c870'


def build(folder=HERE):
    folder=Path(folder);raw=(folder/TEMPLATE).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=TEMPLATE_SHA:raise RuntimeError('exact_published_acceptance_manifest_builder_required')
    names={'ypal-ordinary-generation-accept-binding-v1.py':'ypal-ordinary-generation-accept-binding-v2.py',
           'ypal-ordinary-reader-accept-v1.py':'ypal-ordinary-reader-accept-v2.py',
           'ypal-ordinary-read-cache-accept-v1.py':'ypal-ordinary-read-cache-accept-v2.py',
           'ypal-ordinary-publication-accept-v1.py':'ypal-ordinary-publication-accept-v2.py'}
    counts=dict.fromkeys(names,0);tree=ast.parse(raw)
    for node in ast.walk(tree):
        if isinstance(node,ast.Constant)and type(node.value)is str and node.value in names:
            counts[node.value]+=1;node.value=names[node.value]
    if set(counts.values())!={1}:raise RuntimeError('exact_four_new_source_manifest_filename_seams_required')
    value=types.ModuleType('actual_SQL_acceptance_manifest_builder');value.__file__=str(folder/TEMPLATE)
    exec(compile(ast.fix_missing_locations(tree),str(folder/TEMPLATE),'exec'),value.__dict__)
    original=value.module
    def module(location,name):
        result=original(location,name)
        if name=='ypal-ordinary-generation-accept-binding-v2.py':
            # Explicit offline reading; runtime protected template checks stay.
            result.template=lambda:(folder/result.TEMPLATE.name).read_bytes()
        return result
    value.module=module
    records=value.build(folder)
    reader=records['ypal-ordinary-reader-accept-v2.manifest.json']
    for name in ['ypal-ordinary-generation-accept-binding-v1.py','ypal-ordinary-read-cache-accept-v1.py',
                 'ypal-ordinary-reader-accept-v1.py','ypal-ordinary-publication-accept-v1.py']:
        reader['dependencies'][name]=hashlib.sha256((folder/name).read_bytes()).hexdigest()
    return records


if __name__=='__main__':print(json.dumps({'staticOnly':True,'builderRequiresExplicitSourceInvocation':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
