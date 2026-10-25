#!/usr/bin/env python3
"""Emit the observer's finite literal source map without evaluating it."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
SOURCE=HERE/'ypal-native-metadata-approval-current-observer-v1.py'


def manifest():
    raw=SOURCE.read_bytes();tree=ast.parse(raw);values={}
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in{'FORMAT','SOURCE_PINS'}:
            values[node.targets[0].id]=ast.literal_eval(node.value)
    if set(values)!={'FORMAT','SOURCE_PINS'}or type(values['SOURCE_PINS'])is not dict:raise RuntimeError('one_actual_literal_observer_map_required')
    return{'format':values['FORMAT']+'-source','files':{SOURCE.name:hashlib.sha256(raw).hexdigest(),**values['SOURCE_PINS']}}


if __name__=='__main__':print(json.dumps(manifest(),sort_keys=True,separators=(',',':')))
