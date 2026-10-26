#!/usr/bin/env python3
"""Render finite consumer-prefix manifests without evaluating runtime owners."""
import ast
import hashlib
import json
from pathlib import Path
import re

ROUTES={'actors':('ypal-ordinary-consumer-inverse-prefix-v3.py','yunipals-ypal-ordinary-consumer-inverse-prefix-v3',335),
    'source':('ypal-ordinary-consumer-prefix-source-v3.py','yunipals-ordinary-consumer-prefix-source-v3',403)}


def need(value,code):
    if not value:raise RuntimeError(code)


def build(route,folder=Path(__file__).resolve().parent):
    need(route in ROUTES,'one_fixed_consumer_prefix_manifest_route_required')
    owner,format_name,count=ROUTES[route];folder=Path(folder);raw=(folder/owner).read_bytes()
    rows=[n for n in ast.parse(raw).body if isinstance(n,ast.Assign)and len(n.targets)==1 and
        isinstance(n.targets[0],ast.Name)and n.targets[0].id=='SOURCE_PINS']
    need(len(rows)==1,'one_literal_consumer_prefix_source_map_required');pins=ast.literal_eval(rows[0].value)
    need(type(pins)is dict and owner not in pins and len(pins)+1==count and all(type(name)is str and
        re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)',name)and type(digest)is str and
        re.fullmatch('[a-f0-9]{64}',digest)and digest!='0'*64 for name,digest in pins.items()),
        'exact_finite_consumer_prefix_source_map_required')
    files={owner:hashlib.sha256(raw).hexdigest(),**pins}
    for name,digest in files.items():
        path=folder/name
        if name=='final-supervisor-inventory-v1.py'and not path.exists():path=folder.parent/'solana-acceptance'/name
        if name=='ypal-old-runtime-inventory-v1.py'and not path.exists():path=folder.parent/'booster-launch'/name
        content=path.read_bytes();need(0<len(content)<=4000000 and hashlib.sha256(content).hexdigest()==digest,
            'actual_existing_consumer_prefix_source_bytes_required')
    return{'format':format_name+'-source','files':files}


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--build',choices=sorted(ROUTES));args=parser.parse_args()
    print(json.dumps(build(args.build)if args.build else{'format':'yunipals-ordinary-consumer-prefix-v3-manifest-builder',
        'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True,separators=(',',':')))
