#!/usr/bin/env python3
"""Emit the actual inverse2 source map without evaluating an owner."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
FILE=HERE/'ypal-native-metadata-approval-inverse-v2.py'


def build():
    raw=FILE.read_bytes();values={}
    for node in ast.parse(raw).body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in{'FORMAT','SOURCE_PINS'}:
            values[node.targets[0].id]=ast.literal_eval(node.value)
    if set(values)!={'FORMAT','SOURCE_PINS'}or type(values['SOURCE_PINS'])is not dict:raise RuntimeError('one_literal_metadata_inverse2_source_map_required')
    return{'format':values['FORMAT']+'-source','files':{FILE.name:hashlib.sha256(raw).hexdigest(),**values['SOURCE_PINS']}}


if __name__=='__main__':print(json.dumps(build(),sort_keys=True,separators=(',',':')))
