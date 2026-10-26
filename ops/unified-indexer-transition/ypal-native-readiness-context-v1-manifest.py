#!/usr/bin/env python3
"""Build the literal readiness-context source map; never import its runtime."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
NAME='ypal-native-readiness-context-v1.py'
FORMAT='yunipals-native-readiness-context-v1-source'


def build():
    raw=(HERE/NAME).read_bytes();tree=ast.parse(raw)
    values=[node.value for node in tree.body if isinstance(node,ast.Assign)and len(node.targets)==1 and
        isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
    assert len(values)==1
    pins=ast.literal_eval(values[0]);assert type(pins)is dict and 1<=len(pins)<=512
    for name,digest in pins.items():
        assert Path(name).name==name and len(digest)==64 and all(char in'0123456789abcdef'for char in digest)
        origins={'final-supervisor-inventory-v1.py':HERE.parent/'solana-acceptance'/name,
            'ypal-old-runtime-inventory-v1.py':HERE.parent/'booster-launch'/name}
        assert hashlib.sha256(origins.get(name,HERE/name).read_bytes()).hexdigest()==digest,name
    value={'format':FORMAT,'files':{NAME:hashlib.sha256(raw).hexdigest(),**pins}}
    return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--build',action='store_true');args=parser.parse_args()
    if args.build:(HERE/NAME).with_suffix('.manifest.json').write_bytes(build())
    else:print(json.dumps({'format':FORMAT+'-builder','sourceOnly':True,'databaseWrites':0,'serviceActions':0}))
