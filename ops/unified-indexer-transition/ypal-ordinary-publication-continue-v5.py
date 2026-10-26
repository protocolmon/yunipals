#!/usr/bin/env python3
"""Explicit identity successor of authenticated immutable CONT4 bodies."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-continue-v5.py'
FORMAT='yunipals-ypal-ordinary-publication-continue-v5'
FROZEN=OPS/'ypal-ordinary-publication-continue-v4.py'
FROZEN_SHA='c4d86df5b1228147f9677db49d76932f4d187b67ffd09172a92f553c835a4f92'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
EPOCH=OPS/'ypal-ordinary-metadata-current-effect-v1.py'
EPOCH_SHA='9d79c54f8828f36a120241c61a36e28a4c3423731a87fc8824aaecdf7c9305c7'
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-continue-v5-20261026')
MANIFEST=OPS / 'ypal-ordinary-reader-continue-v5.manifest.json'
READER=OPS / 'ypal-ordinary-reader-continue-v5.py'
PROVIDER=OPS / 'ypal-ordinary-read-cache-continue-v5.py'

_implementation=None


def public(path,expected=None,maximum=4000000):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_continuation5_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<=maximum or \
        any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])or \
        (expected is not None and hashlib.sha256(raw).hexdigest()!=expected):raise RuntimeError('same_actual_continuation5_source_required')
    return raw


def factory():
    raw=public(FACTORY,FACTORY_SHA);value=types.ModuleType('continuation5_factory');value.__file__=str(FACTORY)
    exec(compile(raw,str(FACTORY),'exec'),value.__dict__);return value


def composition():
    global _implementation
    if _implementation is None:
        replacements={'yunipals-ypal-ordinary-reader-continue-v4-source': 'yunipals-ypal-ordinary-reader-continue-v5-source'};counts=dict.fromkeys(replacements,0)
        def transform(node):
            if isinstance(node,(ast.FunctionDef,ast.ClassDef)):
                for item in ast.walk(node):
                    if isinstance(item,ast.Constant)and type(item.value)is str and item.value in replacements:
                        old=item.value;counts[old]+=1;item.value=replacements[old]
            return node
        outer=factory().namespace(public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
            {key:globals()[key]for key in['FILE', 'FORMAT', 'BASE', 'MANIFEST', 'READER', 'PROVIDER', 'EPOCH', 'EPOCH_SHA']},transform=transform)
        if counts!={'yunipals-ypal-ordinary-reader-continue-v4-source': 1}:raise RuntimeError('all_and_only_actual_continuation5_identity_literals_required')
        value=outer.composition();effect=types.ModuleType('actual_cont5_reconciliation_binding');effect.__file__=str(EPOCH)
        exec(compile(public(EPOCH,EPOCH_SHA),str(EPOCH),'exec'),effect.__dict__)
        original=value.composed
        def composed(manifest_sha,metadata_refs,inverse=False):
            if inverse is not False:raise RuntimeError('CONT5_inverse_requires_actual_separate_owned_inverse_epoch_bridge')
            reconciled=effect.reconciliation(metadata_refs);current=original(manifest_sha,metadata_refs,False)
            original_key=current.timing_key
            def timing_key(session,mode):
                return{**original_key(session,mode),'priorQualificationReconciliation':reconciled,
                    'metadataProofProducerSha256':effect.CURRENT_SHA}
            current.timing_key=timing_key;parent=current.Session
            class Session(parent):
                def cache_context(self,input_sha):
                    result=super().cache_context(input_sha)
                    self.key['priorQualificationReconciliation']=reconciled
                    self.cache.continuation_context=timing_key(self,'cache-prepared-held');return result
                def reader_context(self,source_manifest_sha,inputs):
                    result=super().reader_context(source_manifest_sha,inputs)
                    self.key['priorQualificationReconciliation']=reconciled;return result
            current.Session=Session;return current
        value.composed=composed;_implementation=value
    return _implementation


def __getattr__(name):return getattr(composition(),name)

if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('new_actual_owner3_ACK_and_context_qualification_required')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorProducerSuccessClaimed':False,'priorTimingReused':False,'historicalSelectedActorQualifiedAsCurrent':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
