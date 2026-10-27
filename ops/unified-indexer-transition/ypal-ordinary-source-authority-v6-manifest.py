#!/usr/bin/env python3
"""Static actual source/prerequisite hashes; no runtime authority constructor."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
OWNER='ypal-ordinary-source-authority-v6.py'
FORMAT='yunipals-ypal-ordinary-source-authority-v6-source'


def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value,code):
    if not value:raise RuntimeError(code)


def build(folder=HERE):
    folder=Path(folder);raw=(folder/OWNER).read_bytes();tree=ast.parse(raw)
    values=[node for node in tree.body if isinstance(node,ast.Assign)and len(node.targets)==1 and
            isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
    need(len(values)==1,'one_literal_source_authority_prerequisite_map_required');pins=ast.literal_eval(values[0].value)
    need(type(pins)is dict and set(pins)=={'ypal-ordinary-source-authority-v5.py','ypal-old-runtime-inventory-v1.py',
         'ypal-alchemy-source-switch-v1.host.py','ypal-alchemy-ordinary-consumer-context-v1.py','ypal-alchemy-ordinary-runtime-v1.py'},
         'exact_five_upstream_source_authority_prerequisites_required')
    files={OWNER:sha(raw),**pins}
    for name,digest in files.items():
        path=folder/name
        if name=='ypal-old-runtime-inventory-v1.py'and not path.exists():path=folder.parent/'booster-launch'/name
        content=path.read_bytes();need(0<len(content)<200000 and sha(content)==digest,'actual_exact_source_authority_prerequisite_bytes_required')
    return {'format':FORMAT,'files':files}


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--build',action='store_true');args=parser.parse_args()
    print(json.dumps(build()if args.build else{'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True,indent=2))
