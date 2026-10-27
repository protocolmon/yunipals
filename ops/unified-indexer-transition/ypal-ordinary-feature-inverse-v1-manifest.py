#!/usr/bin/env python3
"""Reproduce finite feature inverse manifests without runtime constructors."""
import ast
import hashlib
import json
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
ROUTES={'source':('ypal-ordinary-feature-inverse-source-v1.py','yunipals-ordinary-feature-inverse-source-v1-source',247),
        'caller':('ypal-ordinary-feature-inverse-call-v1.py','yunipals-ordinary-feature-inverse-call-v1-source',249)}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()


def build(route,folder=HERE):
    need(route in ROUTES,'one_fixed_feature_inverse_manifest_route_required')
    owner,format_name,count=ROUTES[route];folder=Path(folder);raw=(folder/owner).read_bytes()
    nodes=[node for node in ast.parse(raw).body if isinstance(node,ast.Assign)and len(node.targets)==1 and
           isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
    need(len(nodes)==1,'one_literal_feature_inverse_source_map_required');pins=ast.literal_eval(nodes[0].value)
    need(type(pins)is dict and owner not in pins and len(pins)+1==count and all(type(name)is str and
         re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)',name)and type(digest)is str and
         re.fullmatch('[a-f0-9]{64}',digest)and digest!='0'*64 for name,digest in pins.items()),
         'exact_finite_actual_feature_inverse_source_closure_required')
    files={owner:sha(raw),**pins}
    for name,digest in files.items():
        path=folder/name
        if name=='final-supervisor-inventory-v1.py'and not path.exists():path=folder.parent/'solana-acceptance'/name
        content=path.read_bytes();need(0<len(content)<=4000000 and sha(content)==digest,'actual_existing_feature_inverse_source_bytes_required')
    return{'format':format_name,'files':files}


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--build',choices=sorted(ROUTES));args=parser.parse_args()
    value=build(args.build)if args.build else{'format':'yunipals-ordinary-feature-inverse-v1-manifest-builder','staticOnly':True,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    print(json.dumps(value,sort_keys=True,separators=(',',':')))
