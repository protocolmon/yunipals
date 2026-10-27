#!/usr/bin/env python3
"""Pure finite native-return source inventory; never constructs a runtime."""
import ast
import hashlib
import json
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
OWNER='arena-ypal-native-return-v4.py'
FORMAT='yunipals-arena-ypal-native-return-v4-source'
TARGET='/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py'
TARGET_SHA='c0b36e15808e6ec60e0386f8d7535748b56b0964369841321840000eac44acec'

def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value,code):
    if not value:raise RuntimeError(code)

def build(folder=HERE):
    folder=Path(folder);raw=(folder/OWNER).read_bytes();tree=ast.parse(raw);literal={}
    for name in ['SOURCE_PINS','EXTERNAL_PROGRAMS']:
        nodes=[node for node in tree.body if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id==name]
        need(len(nodes)==1,'one_literal_native_return_source_assignment_required');literal[name]=ast.literal_eval(nodes[0].value)
    pins=literal['SOURCE_PINS'];external=literal['EXTERNAL_PROGRAMS']
    need(type(pins)is dict and 1<=len(pins)<=511 and OWNER not in pins and all(type(name)is str and re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)',name)and
        type(digest)is str and re.fullmatch('[a-f0-9]{64}',digest)and digest!='0'*64 for name,digest in pins.items()),'finite_actual_native_return_source_map_required')
    need(external=={TARGET:TARGET_SHA},'exact_existing_native_return_target_helper_required')
    files={OWNER:sha(raw),**pins}
    for name,digest in files.items():
        path=folder/name
        if not path.exists()and name=='final-supervisor-inventory-v1.py':path=folder.parent/'solana-acceptance'/name
        if not path.exists()and name=='ypal-old-runtime-inventory-v1.py':path=folder.parent/'booster-launch'/name
        need(sha(path.read_bytes())==digest,'same_actual_native_return_source_bytes_required')
    need(sha((folder.parent/'arena-public-rollback-target-20261023/admit-target.py').read_bytes())==TARGET_SHA,'same_actual_target_helper_required')
    return{'format':FORMAT,'files':files,'externalPrograms':external}

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--build',action='store_true');args=parser.parse_args()
    print(json.dumps(build()if args.build else{'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True,indent=2))
