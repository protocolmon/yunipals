#!/usr/bin/env python3
"""An actual metadata epoch needs a new cache authority/timing namespace."""
import ast
import json
from pathlib import Path
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-cache-continuation-authority-v2.py'
FORMAT='yunipals-ypal-ordinary-cache-continuation-authority-v2'
MANIFEST=OPS/'ypal-ordinary-cache-continuation-authority-v2.manifest.json'
BASE=Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v2-20261025')
FROZEN=OPS/'ypal-ordinary-cache-continuation-authority-v1.py'
FROZEN_SHA='c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7'
SOURCE_PINS={'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9'}
_implementation=None


def utility():
    path=OPS/'ypal-ordinary-metadata-current-epoch-v1.py'
    import hashlib,stat
    for item in[*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_metadata_epoch_authority_utility_required')
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=SOURCE_PINS[path.name]:raise RuntimeError('exact_metadata_epoch_authority_utility_required')
    helper=types.ModuleType('metadata_epoch_authority_utility');helper.__file__=str(path);exec(compile(raw,str(path),'exec'),helper.__dict__)
    return helper.utility()


def composition():
    global _implementation
    if _implementation is None:
        u=utility();h=u.helper();counts={key:0 for key in [
            'ypal-ordinary-publication-continue-v1.py','ypal-ordinary-reader-continue-v1.py',
            'ypal-ordinary-reader-continue-v1.manifest.json','yunipals-ypal-ordinary-reader-continue-v1',
            'yunipals-ypal-ordinary-reader-continue-v1-source',
            '/var/backups/yunipals-ypal-ordinary-reader-continue-v1-20261025']}
        def transform(node):
            if isinstance(node,ast.FunctionDef):
                for value in ast.walk(node):
                    if isinstance(value,ast.Constant)and type(value.value)is str and value.value in counts:
                        original=value.value;counts[original]+=1;value.value=original.replace('continue-v1','continue-v2')
            return node
        value=h.derive(h.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
            {'FORMAT':FORMAT,'FILE':FILE,'MANIFEST':MANIFEST,'BASE':BASE,'SOURCE_PINS':SOURCE_PINS,
             'NEW':OPS/'ypal-ordinary-read-cache-continue-v2.py','NEW_FORMAT':'yunipals-ypal-ordinary-read-cache-continue-v2',
             'NEW_BASE':Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v2-20261025')},transform=transform)
        u.need(counts=={'ypal-ordinary-publication-continue-v1.py':1,'ypal-ordinary-reader-continue-v1.py':2,
            'ypal-ordinary-reader-continue-v1.manifest.json':1,'yunipals-ypal-ordinary-reader-continue-v1':1,
            'yunipals-ypal-ordinary-reader-continue-v1-source':1,
            '/var/backups/yunipals-ypal-ordinary-reader-continue-v1-20261025':1},
            'exact_actual_metadata_epoch_authority_identity_only_seams_required')
        parent=value.new_identity
        def identity(cache,host):
            observed=parent(cache,host);epoch=getattr(cache,'metadata_epoch',None)
            u.need(epoch is not None and epoch.refs['mode']==('restored'if host.inverse_mode else'current'),
                'actual_owned_metadata_epoch_direction_before_cache_authority_required')
            return{**observed,'metadataEpoch':epoch.binding()}
        value.new_identity=identity
        _implementation=value
    return _implementation


def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('metadata_epoch_authority_requires_actual_new_source_manifest_and_held_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorTimingReused':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
