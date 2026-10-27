#!/usr/bin/env python3
"""Offline literal-source manifest for the new acceptance managed owner."""
import ast
import hashlib
import json
from pathlib import Path
import types
HERE=Path(__file__).resolve().parent
FORMAT='yunipals-ordinary-managed-source-binding-accept-v1'
OWNER='ypal-ordinary-managed-handover-accept-v1.py'
MANIFEST='ypal-ordinary-managed-handover-accept-v1.manifest.json'

def composition():
    path=HERE/'ypal-ordinary-managed-source-binding-v1.py';raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!='1ae5464ea195c4145af8a0ac1b7d9a5515e1aa0539174d205a5ce59b3b271719':raise RuntimeError('exact_frozen_managed_source_builder_required')
    tree=ast.parse(raw);found=set()
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in {'FORMAT','OWNER','MANIFEST'}:
            key=node.targets[0].id;node.value=ast.Constant(globals()[key]);found.add(key)
    if found!={'FORMAT','OWNER','MANIFEST'}:raise RuntimeError('exact_three_accept_source_builder_identity_seams_required')
    value=types.ModuleType('accept_managed_source_builder');value.__file__=str(HERE/'ypal-ordinary-managed-source-binding-accept-v1.py')
    exec(compile(ast.fix_missing_locations(tree),value.__file__,'exec'),value.__dict__);return value

def build(folder=HERE):return composition().build(folder)
def __getattr__(name):return getattr(composition(),name)
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--build',action='store_true');args=parser.parse_args()
    print(json.dumps(build()if args.build else {'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True,indent=2))
