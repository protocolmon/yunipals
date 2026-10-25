#!/usr/bin/env python3
"""Actual SQL acceptance successor; published earlier failures stay immutable."""
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-generation-accept-binding-v2.py'
FORMAT='yunipals-ypal-ordinary-generation-accept-binding-v2'
MANIFEST=OPS/'ypal-ordinary-generation-accept-binding-v2.manifest.json'
OWNER_FILE='ypal-ordinary-generation-accept-v3.py'
OWNER_FORMAT='yunipals-ypal-ordinary-generation-accept-v3'
CANDIDATE_FORMAT='yunipals-ypal-ordinary-generation-accept-candidate-v3'
ATTEMPT_BASE='/var/backups/yunipals-ypal-ordinary-generation-accept-v3-20261025'
BUILD_BASE=Path('/var/backups/yunipals-ypal-ordinary-generation-attempt-v2-20261025')
BUILD_OWNER_SHA='4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753'
FROZEN=OPS/'ypal-ordinary-generation-binding-v1.py'
FROZEN_SHA='acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962'
TEMPLATE=OPS/'ypal-ordinary-generation-accept-binding-v1.py'
TEMPLATE_SHA='4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758'
PREVIOUS_SQL_ACCEPTOR_SHA='b6b6eb8c707290c29fbcd6eedf2e13c6c1d5dcc293a3806b0d6ab76bc9ab49fe'
_implementation=None


def protected(path,expected):
    for item in [*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_SQL_acceptance_binding_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or \
       hashlib.sha256(raw).hexdigest()!=expected or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):raise RuntimeError('exact_SQL_acceptance_binding_source_required')
    return raw


def frozen():
    raw=protected(FROZEN,FROZEN_SHA);value=types.ModuleType('actual_SQL_binding_utility');value.__file__=str(FROZEN)
    exec(compile(raw,str(FROZEN),'exec'),value.__dict__);return value,raw


def template():return protected(TEMPLATE,TEMPLATE_SHA)


def derived(utility,raw,source):
    layer=utility.derive(source,TEMPLATE_SHA,FILE,
        {'FILE':FILE,'FORMAT':FORMAT,'MANIFEST':MANIFEST,'OWNER_FILE':OWNER_FILE,'OWNER_FORMAT':OWNER_FORMAT,
         'CANDIDATE_FORMAT':CANDIDATE_FORMAT,'ATTEMPT_BASE':ATTEMPT_BASE},{'frozen':lambda:(utility,raw)})
    result=layer.composition();inherited=result.Binding
    class Binding(inherited):
        def candidate(self,candidate,config):
            value=super().candidate(candidate,config)
            result.need(candidate['previousSqlAcceptanceProducerSha256']==PREVIOUS_SQL_ACCEPTOR_SHA and
                candidate['previousSqlAcceptanceCLIPassed']is False,'actual_SQL_successor_and_previous_failed_checker_not_relabelled_required')
            return value
    result.Binding=Binding
    return result


def composition():
    global _implementation
    if _implementation is None:_implementation=derived(*frozen(),template())
    return _implementation


def build(folder):
    folder=Path(folder);raw=(folder/FROZEN.name).read_bytes();source=(folder/TEMPLATE.name).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=FROZEN_SHA:raise RuntimeError('exact_offline_SQL_binding_utility_required')
    value=types.ModuleType('offline_SQL_binding_utility');value.__file__=str(FROZEN)
    exec(compile(raw,str(FROZEN),'exec'),value.__dict__)
    return derived(value,raw,source).build(folder)


def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
