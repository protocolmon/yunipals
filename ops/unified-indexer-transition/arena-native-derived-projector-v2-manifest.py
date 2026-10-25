#!/usr/bin/env python3
"""Static finite source manifest; no runtime constructor or external effects."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
FILE=HERE/'arena-native-derived-projector-v2.py'


def build():
    tree=ast.parse(FILE.read_bytes())
    def literal(name):
        return ast.literal_eval(next(row.value for row in tree.body if isinstance(row,ast.Assign)and
            len(row.targets)==1 and isinstance(row.targets[0],ast.Name)and row.targets[0].id==name))
    files={FILE.name:hashlib.sha256(FILE.read_bytes()).hexdigest(),**literal('SOURCE_PINS')}
    for name,digest in files.items():
        if Path(name).name!=name:raise RuntimeError('finite_source_basename_required')
        path=HERE/name
        if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise RuntimeError('actual_source_bytes_required')
    external=literal('EXTERNAL_PROGRAMS')
    for name,digest in external.items():
        path=HERE.parent/'arena-public-rollback-target-20261023'/Path(name).name
        if Path(name).parent!=Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023')or \
            hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise RuntimeError('fixed_actual_external_target_bytes_required')
    return {'format':literal('FORMAT')+'-source','files':files,'externalPrograms':external}


if __name__=='__main__':
    import sys
    if sys.argv[1:]==['--build']:print(json.dumps(build(),sort_keys=True,separators=(',',':')))
    elif len(sys.argv)==1:print(json.dumps({'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:raise SystemExit('one_explicit_static_build_required')
