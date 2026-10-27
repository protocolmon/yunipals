#!/usr/bin/env python3
"""Reproduce the finite current-projector source map without owner evaluation."""
import ast
import hashlib
import json
from pathlib import Path
import re

OWNER='arena-native-derived-projector-current-v2.py'

def build(folder=Path(__file__).resolve().parent):
    folder=Path(folder);raw=(folder/OWNER).read_bytes();tree=ast.parse(raw)
    def literal(name):
        rows=[n for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id==name]
        if len(rows)!=1:raise RuntimeError('one_literal_current_projector_source_map_required')
        return ast.literal_eval(rows[0].value)
    pins=literal('SOURCE_PINS');external=literal('EXTERNAL_PROGRAMS')
    if len(pins)!=173 or OWNER in pins or len(external)!=6:raise RuntimeError('exact_finite_current_projector_source_closure_required')
    files={OWNER:hashlib.sha256(raw).hexdigest(),**pins}
    for name,digest in files.items():
        if not re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)',name)or not re.fullmatch('[a-f0-9]{64}',digest):raise RuntimeError('fixed_actual_source_basename_required')
        target=folder/name
        if not target.exists():
            found=[p for p in folder.parent.rglob(name)if p.is_file()and hashlib.sha256(p.read_bytes()).hexdigest()==digest]
            if len(found)!=1:raise RuntimeError('one_actual_source_origin_required')
            target=found[0]
        if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise RuntimeError('actual_current_projector_source_bytes_required')
    for name,digest in external.items():
        target=folder.parent/'arena-public-rollback-target-20261023'/Path(name).name
        if Path(name).parent!=Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023')or hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
            raise RuntimeError('actual_six_original_public_target_sources_required')
    return{'format':'yunipals-arena-native-derived-projector-current-v2-source','files':files,'externalPrograms':external}

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--build',action='store_true');args=p.parse_args()
    print(json.dumps(build()if args.build else{'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True,separators=(',',':')))
