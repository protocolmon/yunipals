#!/usr/bin/env python3
"""Explicit scheduler-epoch caller; old current/timing domains stay immutable."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-continue-v2.py'
FORMAT='yunipals-ypal-ordinary-publication-continue-v2'
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-continue-v2-20261025')
READER=OPS/'ypal-ordinary-reader-continue-v2.py'
PROVIDER=OPS/'ypal-ordinary-read-cache-continue-v2.py'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v2.manifest.json'
FROZEN=OPS/'ypal-ordinary-publication-continue-v1.py'
FROZEN_SHA='6bf7e33971d3331d84ba843ca4952db3f9024ebcee56fba0ff67a5cecbab0151'
EPOCH=OPS/'ypal-ordinary-metadata-current-epoch-v1.py'
EPOCH_SHA='7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f'


def epoch_module():
    for item in[*EPOCH.parents,EPOCH]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_caller_metadata_epoch_helper_required')
    before=EPOCH.lstat();raw=EPOCH.read_bytes();after=EPOCH.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or hashlib.sha256(raw).hexdigest()!=EPOCH_SHA or \
        any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_caller_metadata_epoch_helper_required')
    value=types.ModuleType('caller_current_metadata_epoch');value.__file__=str(EPOCH)
    exec(compile(raw,str(EPOCH),'exec'),value.__dict__);return value


def composed(manifest_sha,metadata_refs,inverse=False):
    current=epoch_module();u=current.consumer_utility();refs=current.checked_refs(u,metadata_refs,inverse);h=u.helper()
    changed=0
    def transform(node):
        nonlocal changed
        if isinstance(node,ast.FunctionDef)and node.name=='composed':
            for value in ast.walk(node):
                if isinstance(value,ast.Constant)and value.value=='yunipals-ypal-ordinary-reader-continue-v1-source':
                    value.value='yunipals-ypal-ordinary-reader-continue-v2-source';changed+=1
        return node
    layer=h.derive(h.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'FILE':FILE,'FORMAT':FORMAT,'BASE':BASE,'READER':READER,'PROVIDER':PROVIDER,'MANIFEST':MANIFEST},
        {'utility':lambda:u},transform)
    u.need(changed==1,'one_actual_metadata_epoch_reader_manifest_domain_seam_required')
    value=layer.composed(manifest_sha);manifest=value.continuation_manifest
    epoch=current.Epoch(refs,manifest,inverse)
    parent_provider=value.BoundProvider
    class Provider(parent_provider):
        def namespace(self,config,coordinator_manifest=None,source_guard=None):
            selected=manifest if coordinator_manifest is None else coordinator_manifest
            u.need(selected==manifest and source_guard is None and self.source.inverse is inverse,
                'exact_owned_metadata_epoch_manifest_source_direction_and_provider_required')
            return self.entry.namespace(config,selected,self.source.current,inverse=inverse,metadata_refs=refs)
    value.BoundProvider=Provider
    parent_slot=value.PreparedMetadata
    class PreparedMetadata(parent_slot):
        def __init__(self,namespace,phase,refresh,inverse,guard):
            selected=phase.cache.metadata_epoch_namespace
            u.need(selected.metadata_epoch.refs==refs and selected.metadata_epoch.inverse is inverse,
                'same_actual_metadata_epoch_in_genuine_prepared_constructor_required')
            super().__init__(selected,phase,refresh,inverse,guard)
    value.PreparedMetadata=PreparedMetadata
    original_key=value.timing_key
    def timing_key(session,mode):
        return{**original_key(session,mode),'metadataEpoch':session.metadata_epoch.binding(),
            'metadataCurrentHelperSha256':EPOCH_SHA,'historicalMetadataTimingReused':False}
    value.timing_key=timing_key;parent=value.Session
    class Session(parent):
        def __init__(self,source_refs,inverse_arg=False):
            u.need(inverse_arg is inverse,'same_explicit_metadata_epoch_and_source_direction_required')
            self.metadata_epoch=epoch;super().__init__(source_refs,inverse_arg)
        def preflight(self):
            first=epoch.current();result=super().preflight();epoch.current()
            self.readonly_preflight={**result,'metadataEpoch':epoch.binding(),'metadataActorCurrent':first}
            return self.readonly_preflight
        def cache_context(self,input_sha):
            result=super().cache_context(input_sha)
            u.need(self.cache.metadata_epoch.binding()==epoch.binding(),'same_owned_metadata_epoch_in_cache_and_session_required')
            self.key['metadataEpoch']=epoch.binding()
            self.cache.continuation_context=timing_key(self,'cache-prepared-held');return result
        def reader_context(self,source_manifest_sha,inputs):
            result=super().reader_context(source_manifest_sha,inputs);self.key['metadataEpoch']=epoch.binding()
            if (self.root.BASE/'operation.json').exists():
                op=self.root.operation(self.proof)
                epoch.reader_operation(op['binding']['metadata']['metadataEpoch'])
            return result
        def finish(self):
            epoch.current();result=super().finish()
            return{**result,'metadataEpoch':epoch.binding(),'metadataActorCurrent':epoch.current()}
    value.Session=Session;return value


def Session(source_refs,manifest_sha,metadata_refs,inverse=False):
    value=composed(manifest_sha,metadata_refs,inverse);session=value.Session(source_refs,inverse)
    session.continuation_caller=value;return session


def prior():
    u=epoch_module().utility();return u.load(FROZEN,FROZEN_SHA)


def construct_records(session,capture_id):return prior().construct_records(session,capture_id)
def qualify_held(session,capture_id):return prior().qualify_held(session,capture_id)
def execute_cache(session,action,args,attempt_id,held_qualification=None):return prior().execute_cache(session,action,args,attempt_id,held_qualification)
def qualify_reader(session,capture_id):return prior().qualify_reader(session,capture_id)
def execute_reader(session,action,args,attempt_id,timing_receipt=None):return prior().execute_reader(session,action,args,attempt_id,timing_receipt)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('publication_epoch_requires_actual_metadata_ACK_context_and_new_held_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'historicalSelectedActorQualifiedAsCurrent':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
