#!/usr/bin/env python3
"""Reader successor for the authenticated metadata scheduler epoch."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-reader-continue-v2.py'
FORMAT='yunipals-ypal-ordinary-reader-continue-v2'
BASE=Path('/var/backups/yunipals-ypal-ordinary-reader-continue-v2-20261025')
MANIFEST=OPS/'ypal-ordinary-reader-continue-v2.manifest.json'
PROVIDER='ypal-ordinary-read-cache-continue-v2.py'
FROZEN=OPS/'ypal-ordinary-reader-continue-v1.py'
FROZEN_SHA='5858b50e59ddc1d5ee04e0f8443143d0d6aee78fd927fee4f6d9fbe9b62a747d'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449'


def utility():
    for item in[*UTILITY.parents,UTILITY]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:raise RuntimeError('protected_reader_epoch_utility_required')
    before=UTILITY.lstat();raw=UTILITY.read_bytes();after=UTILITY.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or hashlib.sha256(raw).hexdigest()!=UTILITY_SHA or \
        any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_reader_epoch_utility_required')
    value=types.ModuleType('reader_epoch_utility');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def composition():
    u=utility();base=u.helper()
    identities={'FORMAT':FORMAT,'FILE':FILE,'BASE':BASE,'MANIFEST':MANIFEST,'PROVIDER':PROVIDER,
        'CACHE_FORMAT':'yunipals-ypal-ordinary-cache-finish-continue-v2',
        'CACHE_BASE':Path('/var/backups/yunipals-ypal-ordinary-cache-finish-continue-v2-20261025'),
        'FEATURE':'ypal-ordinary-feature-handover-continue-v2.py','FEATURE_CONTEXT':'ypal-ordinary-feature-context-continue-v2.py',
        'FEATURE_FORMAT':'yunipals-ypal-ordinary-feature-handover-continue-v2',
        'FEATURE_MANIFEST':OPS/'ypal-ordinary-feature-handover-continue-v2.manifest.json'}
    chain=u.Chain(base,FILE,identities,{FROZEN_SHA,
        '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5',
        '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e',
        '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17',
        '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0'})
    u.helper=lambda:chain
    outer=chain.derive(base.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,overrides={'utility':lambda:u})
    module=outer.composition();parent=module.Proof
    raw=base.public(OPS/'ypal-ordinary-reader-proof-v6.py','0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5')
    cls=next(node for node in ast.parse(raw).body if isinstance(node,ast.ClassDef)and node.name=='Proof')
    fn=copy.deepcopy(next(node for node in cls.body if isinstance(node,ast.FunctionDef)and node.name=='metadata_inverse_actor'))
    changes=0
    for node in ast.walk(fn):
        if isinstance(node,ast.Assign)and ast.unparse(node)=="actor = selection['nativeActor']":
            node.value=ast.parse("host.metadata_epoch.ack['actor']",mode='eval').body;changes+=1
    u.need(changes==1,'one_explicit_owned_restored_metadata_terminal_actor_seam_required')
    class Proof(parent):
        def __init__(self,manifest_sha):
            super().__init__(manifest_sha)
            original=self._implementation.Proof.metadata_inverse_actor
            scope=dict(original.__globals__)
            exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FILE),'exec'),scope)
            self._epoch_metadata_inverse_actor=scope['metadata_inverse_actor']
        def metadata_inverse_actor(self,context,owner,host,operation,selection):
            host.metadata_epoch.inverse_actor_ancestry(owner,host,operation,selection)
            return self._epoch_metadata_inverse_actor(self,context,owner,host,operation,selection)
        def metadata_terminal(self,owner,outer):
            terminal=self._implementation.Proof.metadata_terminal(self,owner,outer)
            def qualified(host,operation,actor,sessions=None):
                if sessions is None and not os.path.lexists(owner.DROP):
                    intent=self.document(owner.BASE/'inverse-intent.json')
                    u.need(host.metadata_epoch.inverse and intent['nativeActor']==host.metadata_epoch.ack['actor'],
                        'actual_owned_cf333_epoch_in_original_metadata_inverse_terminal_intent_required')
                return terminal(host,operation,actor,sessions)
            return qualified
    module.Proof=Proof;return module


def __getattr__(name):return getattr(composition(),name)


def catalog_only_reader(namespace):
    """Keep the genuine full READ/catalog body; name its excluded source call."""
    u=utility();raw=u.public(OPS/'ypal-restored-read-cache-provider-v1.py',
        '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9')
    fn=copy.deepcopy(next(node for node in ast.parse(raw).body if isinstance(node,ast.FunctionDef)and node.name=='current_reads'))
    changed=0
    for node in ast.walk(fn):
        if isinstance(node,ast.Assign)and ast.unparse(node)=="proof = host.static.inverse_source() if inverse else host.read_host.runtime()":
            node.value=ast.parse("{'catalogOnly':True,'sourceActorQualified':False,'currentWriterQualified':False,'sourcePredicateExecuted':False}",mode='eval').body
            changed+=1
    u.need(changed==1,'one_explicit_excluded_source_dispatch_in_named_catalog_only_body_required')
    scope=dict(namespace.current_reads.__globals__)
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FILE),'exec'),scope)
    return scope['current_reads']


def lifecycle_inverse_catalog(refs):
    u=utility();u.need(type(refs)is dict and set(refs)=={'resultSha256','manifestSha256','producerSha256'}and
        all(u.pin(value)for value in refs.values()),'actual_metadata_lifecycle_reader_three_refs_required')
    manifest=json.loads(u.public(MANIFEST,refs['manifestSha256']))
    u.need(manifest['format']==FORMAT+'-source'and manifest['files'][FILE.name]==refs['producerSha256'],
        'only_actual_continuation2_reader_immutable_ACK_and_source_manifest_supported')
    for name,digest in{**manifest['dependencies'],**manifest['files']}.items():
        u.need(Path(name).name==name and u.pin(digest),'finite_metadata_lifecycle_catalog_source_closure_required');u.public(OPS/name,digest)
    u.public(FILE,refs['producerSha256']);module=composition();root,proof=module.core(refs['manifestSha256'])
    ack=module.acknowledgement(refs['resultSha256'],refs['manifestSha256']);op=root.operation(proof)
    u.need(ack['immutableReaderAcknowledgementOnly']is ack['validated']is True and
        ack['operatorSha256']==refs['producerSha256']and ack['operationSha256']==u.sha(u.public(BASE/'operation.json')),
        'actual_owned_published_reader_operation_before_metadata_lifecycle_inverse_required')
    phase=manifest['contexts']['phase'];provider=u.load(OPS/phase['file'],phase['sha256'])
    config=provider.config_checked(json.loads(u.public(provider.INPUT,ack['cacheInputsSha256'])))
    recorded=op['binding']['metadata']['metadataEpoch'];metadata_refs=recorded['refs']
    def forbidden(*_args,**_kwargs):raise RuntimeError('metadata_lifecycle_catalog_does_not_confer_source_authority')
    namespace=provider.namespace(config,manifest,forbidden,metadata_refs=metadata_refs)
    u.need(namespace.metadata_current_namespace.metadata_epoch.binding()==recorded,
        'same_actual_upgrade_epoch_as_immutable_reader_operation_for_catalog_only_refresh_required')
    cache=namespace.cache_runtime();host=cache.Host(config);read=catalog_only_reader(namespace)
    first=read(host,True,True,op['binding']['afterLoginCatalog'],True)
    guard=namespace.guard_current(host,True)
    last=read(host,True,True,op['binding']['afterLoginCatalog'],True)
    u.need(first==last and module.acknowledgement(refs['resultSha256'],refs['manifestSha256'])==ack,
        'full_owned_cache4_LOGIN_column_catalog_and_immutable_reader_ACK_bookends_required')
    return{**last,'format':FORMAT+'-lifecycle-inverse-catalog','operatorSha256':refs['producerSha256'],
        'readerRefs':copy.deepcopy(refs),'readerOperationSha256':ack['operationSha256'],'catalogOnly':True,
        'sourceActorQualified':False,'currentWriterQualified':False,'sourcePredicateExecuted':False,
        'originalWholeValidatorPassed':False,'metadataActorQualified':False,'guard':guard,
        'preservation':{'restoredSourceEpochQualified':False,'originalWholeValidatorPassed':False},
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('reader_epoch_requires_actual_metadata_lifecycle_and_new_context_qualification')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'oldSelectedActorAliased':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
