#!/usr/bin/env python3
"""Explicit new continuation caller and complete-held qualification domain."""
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-continue-v1.py'
FORMAT='yunipals-ypal-ordinary-publication-continue-v1'
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-continue-v1-20261025')
READER=OPS/'ypal-ordinary-reader-continue-v1.py'
PROVIDER=OPS/'ypal-ordinary-read-cache-continue-v1.py'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v1.manifest.json'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449'
KERNEL=OPS/'ypal-ordinary-publication-kernel-v1.py'
KERNEL_SHA='6b261303f659ab2f8b9152733b5eeb6f3cb02be1c09f1ab38380dc41d3795e3a'


def utility():
    for path in [*UTILITY.parents,UTILITY]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_publication_continuation_utility_required')
    first=UTILITY.lstat();raw=UTILITY.read_bytes();last=UTILITY.lstat()
    if not stat.S_ISREG(first.st_mode)or first.st_nlink!=1 or not 0<len(raw)==first.st_size<100000 or hashlib.sha256(raw).hexdigest()!=UTILITY_SHA or \
       any(getattr(first,key)!=getattr(last,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_publication_continuation_utility_required')
    value=types.ModuleType('actual_continuation_context');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def composed(manifest_sha):
    u=utility();u.need(u.pin(manifest_sha),'actual_continuation_reader_source_manifest_ref_required')
    manifest=json.loads(u.public(MANIFEST,manifest_sha))
    u.need(manifest['format']=='yunipals-ypal-ordinary-reader-continue-v1-source'and
        manifest['contexts']['phase']=={'file':PROVIDER.name,'sha256':manifest['dependencies'].get(PROVIDER.name)}and
        manifest['acknowledgementRoute']=={'file':READER.name,'sha256':manifest['files'].get(READER.name),'method':'acknowledgement'}and
        manifest['dependencies'].get(UTILITY.name)==UTILITY_SHA,'actual_new_continuation_reader_provider_and_utility_required')
    for name,digest in {**manifest['dependencies'],**manifest['files']}.items():
        u.need(type(name)is str and name not in {'','.','..'}and '/'not in name and '\\'not in name and u.pin(digest),
            'finite_actual_continuation_caller_source_closure_required');u.public(OPS/name,digest)
    authority=u.authority(manifest);h=u.helper()
    kernel=h.derive(h.public(KERNEL,KERNEL_SHA),KERNEL_SHA,FILE,{'FORMAT':FORMAT,'BASE':BASE,'FILE':FILE})
    value=kernel.composed()
    value.PROVIDER,value.PROVIDER_SHA=PROVIDER,manifest['dependencies'][PROVIDER.name]
    value.READER=value.PROOF=READER;value.READER_SHA=value.PROOF_SHA=manifest['files'][READER.name]
    original=value.timing_key
    def timing_key(session,mode):
        return {**original(session,mode),'continuationReaderManifestSha256':manifest_sha,
            'continuationAuthoritySha256':manifest['dependencies'][u.AUTHORITY],
            'priorProviderSha256':u.OLD_PROVIDER_SHA,'priorReaderSha256':u.OLD_READER_SHA,
            'priorOwnerTimingReused':False}
    value.timing_key=timing_key
    parent_provider=value.BoundProvider
    class Provider(parent_provider):
        def namespace(self,config,coordinator_manifest=None,source_guard=None):
            selected=manifest if coordinator_manifest is None else coordinator_manifest
            u.need(selected==manifest,'same_actual_new_reader_manifest_in_cache_and_reader_contexts_required')
            u.need(source_guard is None and type(self.source.inverse)is bool,'actual_caller_owned_typed_source_direction_required')
            return self.entry.namespace(config,selected,self.source.current,inverse=self.source.inverse)
    value.BoundProvider=Provider
    parent=value.Session
    class Session(parent):
        def cache_context(self,input_sha):
            result=super().cache_context(input_sha)
            self.cache.continuation_context=timing_key(self,'cache-prepared-held')
            self.continuation_manifest_sha=manifest_sha;return result
        def reader_context(self,source_manifest_sha,inputs):
            u.need(source_manifest_sha==manifest_sha,'same_authenticated_new_reader_source_manifest_required')
            return super().reader_context(source_manifest_sha,inputs)
    value.Session=Session;value.continuation_authority=authority;value.continuation_manifest=manifest
    return value


def Session(source_refs,manifest_sha,inverse=False):
    value=composed(manifest_sha);result=value.Session(source_refs,inverse)
    result.continuation_caller=value;return result


def construct_records(session,capture_id):
    value=session.continuation_caller
    value.need(session.cache is not None and not session.source.inverse,'actual_forward_continuation_cache_context_required')
    session.source.current()
    with session.host.read_host.primitives['sdk'].lock():
        result=session.cache.continuation_authority.construct_records(session.cache,session.host,capture_id)
    return {**result,'fullSourcePostflight':session.finish()}


def qualify_held(session,capture_id):
    value=session.continuation_caller
    value.need(session.cache is not None and not session.source.inverse,'actual_forward_continuation_cache_context_required')
    session.source.current()
    with session.host.read_host.primitives['sdk'].lock():
        result=session.cache.continuation_authority.qualify_held(session.cache,session.host,capture_id)
    return {**result,'fullSourcePostflight':session.finish()}


def execute_cache(session,action,args,attempt_id,held_qualification=None):
    value=session.continuation_caller;cache,host=session.cache,session.host
    value.need(not session.source.inverse and type(args)is list and action in {'commit','inspect','reconcile-commit','prepare-ack'},
        'continuation_only_actual_commit_or_readonly_reconciliation_actions_allowed')
    if action=='commit':
        cache.continuation_authority.require_qualification(cache,host,held_qualification)
        cache.continuation_qualification_ref=held_qualification
    elif action=='prepare-ack':value.need(not(cache.BASE/'prepared.json').exists(),'successful_commit_already_returns_prepared_ACK')
    functions={'commit':cache.commit,'inspect':cache.inspect,'reconcile-commit':cache.reconcile_commit,'prepare-ack':cache.prepare_ack}
    def run():
        with host.read_host.primitives['sdk'].lock():return functions[action](host,*args)
    return value.attempt(session,attempt_id,action,run)


def qualify_reader(session,capture_id):return session.continuation_caller.qualify(session,capture_id)


def execute_reader(session,action,args,attempt_id,timing_receipt=None):
    return session.continuation_caller.execute_reader(session,action,args,attempt_id,timing_receipt)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('continuation_requires_new_actual_manifest_context_and_complete_held_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorAttemptSuccessClaimed':False,'priorTimingReused':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
