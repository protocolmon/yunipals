#!/usr/bin/env python3
"""New cache producer over immutable failed8be ancestry; no default effects."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-read-cache-continue-v1.py'
FORMAT='yunipals-ypal-ordinary-read-cache-continue-v1'
BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v1-20261025')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-input-v2-20261025/input.json')
READER=OPS/'ypal-ordinary-reader-continue-v1.py'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449'
V6_SHA='46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c'
CHAIN={'8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834',
    'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a',
    '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f',V6_SHA}


def utility():
    for path in [*UTILITY.parents,UTILITY]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_cache_continuation_utility_required')
    first=UTILITY.lstat();raw=UTILITY.read_bytes();last=UTILITY.lstat()
    if not stat.S_ISREG(first.st_mode)or first.st_nlink!=1 or not 0<len(raw)==first.st_size<100000 or hashlib.sha256(raw).hexdigest()!=UTILITY_SHA or \
       any(getattr(first,key)!=getattr(last,key)for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_cache_continuation_utility_required')
    value=types.ModuleType('actual_continuation_context');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def config_checked(config):
    u=utility();return u.load(u.OLD_PROVIDER,u.OLD_PROVIDER_SHA).config_checked(config)


def common():
    u=utility();return u.load(u.OLD_PROVIDER,u.OLD_PROVIDER_SHA).common()


def namespace(config,manifest=None,source_guard=None,inverse=False):
    u=utility();u.need(type(inverse)is bool,'typed_explicit_continuation_source_direction_required')
    config=config_checked(config);authority=u.authority(manifest);base=u.helper()
    identities={'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'INPUT':INPUT,'READER':READER}
    h=u.Chain(base,FILE,identities,CHAIN)
    outer=h.derive(h.public(u.OLD_PROVIDER,u.OLD_PROVIDER_SHA),u.OLD_PROVIDER_SHA,FILE)
    entry=u.unwrap(outer,'namespace');value=entry.namespace(config,manifest,source_guard)
    original_retarget=value.retarget_V5_cache_node
    expected={'drain':4,'reconcile_stop':1,'finish':2,'inverse':2,'finish_inverse':2}
    def retarget(node):
        node=original_retarget(node);result,count=u.archive_node(node,"BASE / 'original-boot-link'")
        u.need(count==expected.get(getattr(node,'name',None),0),'exact_retained_cache_boot_archive_location_seams_required')
        return result
    value.retarget_V5_cache_node=retarget
    make_runtime=value.cache_runtime
    old=u.load(u.OLD_PROVIDER,u.OLD_PROVIDER_SHA).namespace(config,None,source_guard).cache_runtime()
    def cache_runtime():
        cache=make_runtime();cache.prior_cache=old;cache.continuation_authority=authority;cache.retained_boot_archive=u.BOOT_ARCHIVE
        cache.inverse_mode=inverse
        cache.continuation_reader={'file':READER.name,'sha256':manifest['files'][READER.name],
            'manifestFile':'ypal-ordinary-reader-continue-v1.manifest.json','manifest':manifest}
        cache._sql_child=authority.bounded_sql_parent(cache._sql_child,old._sql_child)
        cache.stopped=lambda host:authority.stopped(cache,host)
        launch=cache.sql_child
        def sql_child(host,mode,plan=None,prepared=None,generation=None,plan_json=None):
            def guarded(packet):
                result=prepared(packet)
                if mode=='apply':authority.before_literal_ack(cache,host,packet)
                return result
            return launch(host,mode,plan,guarded if prepared is not None else None,generation,plan_json)
        cache.sql_child=sql_child
        return cache
    value.cache_runtime=cache_runtime;value.continuation_authority=authority;value.prior_cache=old
    return value


def cache_runtime(config=None,manifest=None,source_guard=None,inverse=False):
    u=utility()
    if config is None:config=common().intake().document(INPUT,u.sha(u.public(INPUT)))
    return namespace(config,manifest,source_guard,inverse).cache_runtime()


def create_phase(inputs,coordinator_manifest,source_guard=None,inverse=False):
    config=config_checked(common().intake().document(INPUT,inputs['cacheInputsSha256']))
    return namespace(config,coordinator_manifest,source_guard,inverse).Phase(inputs,coordinator_manifest)


def static_read_host(refs):
    u=utility();return u.load(u.OLD_PROVIDER,u.OLD_PROVIDER_SHA).static_read_host(refs)


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('cache_continuation_requires_actual_new_owner_and_held_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'priorOwnerSuccessClaimed':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
