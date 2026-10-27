#!/usr/bin/env python3
"""Named acceptance lineage over exact reviewed forward bodies; default inert."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-ypal-ordinary-accept-v1.py'
FORMAT='yunipals-arena-ypal-ordinary-accept-v1'
INSTALL_ACK='ad024517f4ae8e348382cea0f589b4c432eaf4261797048cba5c66b676dabe84'
BASE=Path('/var/backups/yunipals-arena-ypal-ordinary-accept-v1-20261025')
MANIFEST=OPS/'arena-ypal-ordinary-accept-v1.manifest.json'
OBSERVATIONS=Path('/var/backups/yunipals-arena-ypal-ordinary-accept-review-v1-20261025')
SOURCE_CONTINUATION=Path('/var/backups/yunipals-arena-source-continuation-accept-v1-20261025/input.json')
PINS={'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-ordinary-bound-v1.py': '1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-downstream-refs-accept-v1.py': '2d2e8b1550332e215564cbeefb12a2fbea42f87ba1d978aab2aa337f212e3ce6', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f'}
def utility():
    path=OPS/'ypal-ordinary-feature-handover-bound-v1.py';digest='2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f'
    for item in [*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_accept_forward_utility_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or hashlib.sha256(raw).hexdigest()!=digest or any(
        getattr(before,key)!=getattr(after,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):raise RuntimeError('exact_accept_forward_utility_required')
    value=types.ModuleType('frozen_accept_forward_utility');value.__file__=str(path);exec(compile(raw,str(path),'exec'),value.__dict__)
    return value.helper()


def composed():
    h=utility();name='arena-ypal-ordinary-bound-v1.py';digest='1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523';counts={'refs':0,'leaf':0}
    def transform(node):
        if not isinstance(node,ast.FunctionDef):return node
        for row in ast.walk(node):
            if isinstance(row,ast.Constant)and row.value=='ypal-ordinary-downstream-refs-v1.py':row.value='ypal-ordinary-downstream-refs-accept-v1.py';counts['refs']+=1
            elif isinstance(row,ast.Constant)and row.value=='yunipals-arena-ypal-ordinary-bound-phase-leaf-v1':row.value='yunipals-arena-ypal-ordinary-accept-phase-leaf-v1';counts['leaf']+=1
        return node
    value=h.derive(h.public(OPS/name,digest),digest,FILE,
        {'FILE':FILE,'FORMAT':FORMAT,'BASE':BASE,'MANIFEST':MANIFEST,'OBSERVATIONS':OBSERVATIONS,'SOURCE_CONTINUATION':SOURCE_CONTINUATION,'PINS':PINS},transform=transform)
    h.need(counts=={'refs':4,'leaf':1},'exact_accept_Arena_reference_and_leaf_identity_seams_required');return value


def composition(source_continuation=None):return composed().composition(source_continuation)
def namespace(source_continuation=None):return composition(source_continuation).namespace()
def code_manifest():return composition().code_manifest()
def validate_phase_leaf(result_sha,manifest_sha,continuation=None):return composition().validate_phase_leaf(result_sha,manifest_sha,continuation)
def main():
    import sys
    if len(sys.argv)==1:print(json.dumps({'format':FORMAT,'staticOnly':True,'migrationInvocations':0,'serviceJobs':0,'databaseWrites':0}))
    else:composed().main()
if __name__=='__main__':main()
