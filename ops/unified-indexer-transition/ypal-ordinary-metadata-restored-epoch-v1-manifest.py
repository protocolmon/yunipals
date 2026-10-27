#!/usr/bin/env python3
"""Reproduce the compact restored metadata bridge manifest without evaluation."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
SOURCE='ypal-ordinary-metadata-restored-epoch-v1.py'
MANIFEST='ypal-ordinary-metadata-restored-epoch-v1.manifest.json'

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

def build():
    raw=(HERE/SOURCE).read_bytes();tree=ast.parse(raw)
    values={node.targets[0].id:ast.literal_eval(node.value)for node in tree.body if isinstance(node,ast.Assign)and
        len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in{'FORMAT','SOURCE_PINS'}}
    if set(values)!={'FORMAT','SOURCE_PINS'}or type(values['SOURCE_PINS'])is not dict:raise RuntimeError('one_actual_bridge_format_and_literal_source_map_required')
    return{MANIFEST:{'format':values['FORMAT']+'-source','files':{SOURCE:hashlib.sha256(raw).hexdigest(),**values['SOURCE_PINS']}}}

if __name__=='__main__':
    import sys
    sys.stdout.buffer.write(encoded(build()[MANIFEST]))
