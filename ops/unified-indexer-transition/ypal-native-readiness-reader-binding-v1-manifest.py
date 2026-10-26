#!/usr/bin/env python3
"""Emit the literal reader-binding source map without an operator import."""
import ast
import hashlib
import json
from pathlib import Path

FILE=Path(__file__).resolve().parent/'ypal-native-readiness-reader-binding-v1.py'


def build():
    raw=FILE.read_bytes();values={}
    for node in ast.parse(raw).body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in{'FORMAT','SOURCE_PINS'}:
            name=node.targets[0].id
            if name in values:raise RuntimeError('one_literal_reader_binding_source_map_required')
            values[name]=ast.literal_eval(node.value)
    if set(values)!={'FORMAT','SOURCE_PINS'}:raise RuntimeError('complete_reader_binding_source_map_required')
    return{'format':values['FORMAT']+'-source','files':{FILE.name:hashlib.sha256(raw).hexdigest(),**values['SOURCE_PINS']}}


if __name__=='__main__':print(json.dumps(build(),sort_keys=True,separators=(',',':')))
