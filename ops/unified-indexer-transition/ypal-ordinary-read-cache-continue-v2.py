#!/usr/bin/env python3
"""Thin cache continuation with an actual owned current metadata epoch."""
import copy
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-read-cache-continue-v2.py'
FORMAT='yunipals-ypal-ordinary-read-cache-continue-v2'
BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v2-20261025')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-input-v2-20261025/input.json')
READER=OPS/'ypal-ordinary-reader-continue-v2.py'
FROZEN=OPS/'ypal-ordinary-read-cache-continue-v1.py'
FROZEN_SHA='e4b0a18fc1358a04da6a6a47c8363d193836d23493a28f6c09a1780e3dadc06e'
METADATA_SHA='9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
EPOCH=OPS/'ypal-ordinary-metadata-current-epoch-v1.py'
EPOCH_SHA='7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f'


def epoch_module():
    for item in[*EPOCH.parents,EPOCH]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_cache_metadata_epoch_helper_required')
    before=EPOCH.lstat();raw=EPOCH.read_bytes();after=EPOCH.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or \
        hashlib.sha256(raw).hexdigest()!=EPOCH_SHA or any(getattr(before,key)!=getattr(after,key)for key in
        ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_cache_metadata_epoch_helper_required')
    value=types.ModuleType('cache_current_metadata_epoch');value.__file__=str(EPOCH)
    exec(compile(raw,str(EPOCH),'exec'),value.__dict__);return value


def config_checked(config):
    u=epoch_module().utility();return u.load(FROZEN,FROZEN_SHA).config_checked(config)


def common():
    u=epoch_module().utility();return u.load(FROZEN,FROZEN_SHA).common()


def namespace(config,manifest=None,source_guard=None,inverse=False,metadata_refs=None):
    current=epoch_module();u=current.consumer_utility();refs=current.checked_refs(u,metadata_refs,inverse)
    config=config_checked(config);metadata=current.namespace(config['metadataInputSha256'],refs,manifest,inverse)
    original=u.helper();identities={'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'INPUT':INPUT,'READER':READER}
    chain=u.Chain(original,FILE,identities,{FROZEN_SHA,
        '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834',
        'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a',
        '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f',
        '46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c'})
    u.helper=lambda:chain
    wrapper=chain.derive(original.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,overrides={'utility':lambda:u})
    value=wrapper.namespace(config,manifest,source_guard,inverse)
    value.metadata_current=lambda host,generation,selection:metadata.metadata(host,generation,selection,lambda:value.refresh(host))
    make=value.cache_runtime
    def cache_runtime():
        cache=make();cache.metadata_epoch=metadata.metadata_epoch;cache.metadata_epoch_namespace=metadata
        cache.continuation_reader={'file':READER.name,'sha256':manifest['files'][READER.name],
            'manifestFile':'ypal-ordinary-reader-continue-v2.manifest.json','manifest':manifest}
        cache.metadata_refs=copy.deepcopy(refs);return cache
    value.cache_runtime=cache_runtime;parent=value.Phase
    class Phase(parent):
        def metadata(self,refresh_callback=None):
            _,candidate,_,_=self.generation();r=self.host.new_read
            selection=r.document(self.cache.META/'selected.json',self.host.config['metadataSelectionSha256'])
            return metadata.metadata(self,candidate,selection,refresh_callback or(lambda:self.scope()))
        def metadata_inverse_context(self,refresh_callback=None):
            _,candidate,_,_=self.generation()
            return metadata.metadata_inverse_context(self,candidate,refresh_callback or(lambda:self.inverse_scope(False)))
    value.Phase=Phase;value.metadata_current_namespace=metadata
    return value


def cache_runtime(config=None,manifest=None,source_guard=None,inverse=False,metadata_refs=None):
    if config is None:config=common().intake().document(INPUT,epoch_module().utility().sha(epoch_module().utility().public(INPUT)))
    return namespace(config,manifest,source_guard,inverse,metadata_refs).cache_runtime()


def create_phase(inputs,coordinator_manifest,source_guard=None,inverse=False,metadata_refs=None):
    config=config_checked(common().intake().document(INPUT,inputs['cacheInputsSha256']))
    return namespace(config,coordinator_manifest,source_guard,inverse,metadata_refs).Phase(inputs,coordinator_manifest)


def static_read_host(refs):
    u=epoch_module().utility();return u.load(FROZEN,FROZEN_SHA).static_read_host(refs)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('cache_metadata_epoch_requires_actual_owned_epoch_refs_and_held_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'historicalSelectedActorQualifiedAsCurrent':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
