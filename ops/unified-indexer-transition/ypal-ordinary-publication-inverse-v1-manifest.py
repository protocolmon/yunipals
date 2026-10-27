#!/usr/bin/env python3
"""Reproduce the inverse controller source manifest without evaluating it."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
SOURCE='ypal-ordinary-publication-inverse-v1.py'
MANIFEST='ypal-ordinary-publication-inverse-v1.manifest.json'

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

def build():
    raw=(HERE/SOURCE).read_bytes();tree=ast.parse(raw)
    rows=[node for node in tree.body if isinstance(node,ast.Assign)and len(node.targets)==1 and
        isinstance(node.targets[0],ast.Name)and node.targets[0].id in{'FORMAT','SOURCE_PINS'}]
    values={node.targets[0].id:ast.literal_eval(node.value)for node in rows}
    if len(rows)!=2 or set(values)!={'FORMAT','SOURCE_PINS'}or type(values['SOURCE_PINS'])is not dict:
        raise RuntimeError('one_actual_controller_format_and_literal_source_map_required')
    return{MANIFEST:{'format':values['FORMAT']+'-source','files':{SOURCE:hashlib.sha256(raw).hexdigest(),**values['SOURCE_PINS']}}}

if __name__=='__main__':
    import sys
    sys.stdout.buffer.write(encoded(build()[MANIFEST]))
