"""Actual thin compositions; immutable lifecycle ACKs are synthetic fixtures."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
prior=load('ypal-ordinary-publication-continue-v1.test.py')
e=load('ypal-ordinary-metadata-current-epoch-v1.py')
p=load('ypal-ordinary-read-cache-continue-v2.py')
r=load('ypal-ordinary-reader-continue-v2.py')
a=load('ypal-ordinary-publication-continue-v2.py')
c=load('ypal-ordinary-cache-continuation-authority-v2.py')
b=load('ypal-ordinary-publication-continue-manifest-v2.py')
u=load('ypal-ordinary-cache-continuation-context-v1.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.base=prior.Controls();self.base.setUp();self.addCleanup(self.base.doCleanups)
        self.h=self.base.h;self.config=self.base.config;self.frozen_provider=prior.p
        self.outputs=b.build();self.manifest=self.outputs[r.MANIFEST.name]
        self.documents={name:b.encoded(value)for name,value in self.outputs.items()};self.manifest_sha=u.sha(self.documents[r.MANIFEST.name])
        self.utility=types.SimpleNamespace(**u.__dict__);self.utility.public=self.public;self.utility.load=self.loaded;self.utility.helper=lambda:self.h
        original=u.authority
        self.utility.authority=types.FunctionType(original.__code__,{**original.__globals__,'public':self.public,'load':self.loaded},
            original.__name__,original.__defaults__)
        self.enterContext(patch.object(e,'utility',return_value=self.utility))
        self.enterContext(patch.object(p,'epoch_module',return_value=e));self.enterContext(patch.object(a,'epoch_module',return_value=e))
        self.enterContext(patch.object(r,'utility',return_value=self.utility));self.enterContext(patch.object(c,'utility',return_value=self.utility))
        self.enterContext(patch.object(self.base.control.impl,'public',side_effect=self.public))
        self.actual_owner=load(e.OWNER)
        owner_sha=self.manifest['dependencies'][e.OWNER]
        self.refs={'mode':'current','resultSha256':'a'*64,'inputSha256':'b'*64,'producerSha256':owner_sha,
            'manifestSha256':self.manifest['dependencies'][e.OWNER_MANIFEST]}
        actor={'unit':{'Id':'yunipals-metadata.service','InvocationID':'fixture-owned-new'},'main':{'pid':777,'startTicks':9},
            'processes':[],'commandSha256':'c'*64};historical={**copy.deepcopy(actor),'main':{'pid':776,'startTicks':8}}
        self.ack={'format':e.OWNER_FORMAT,'validated':True,'operatorSha256':owner_sha,'receiptSha256':self.refs['resultSha256'],
            'inputSha256':self.refs['inputSha256'],'operationSha256':'d'*64,'metadataInputSha256':self.config['metadataInputSha256'],
            'metadataOperationSha256':'e'*64,'metadataSelectedSha256':e.SELECTED_SHA,'actor':actor,'historicalActor':historical,
            'boot':{'fixtureRetainedBoot':True},'historicalBoot':{'fixtureRetainedBoot':True},'artifactDigest':e.ARTIFACT,
            'artifactManifestSha256':e.ARTIFACT_MANIFEST,'workerSha256':e.WORKER_SHA,'immutableAcknowledgementOnly':True,
            'sourceActorQualified':False,'READAuthorityQualified':False,'publicationAuthorityQualified':False,'financialAuthorityQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.enterContext(patch.object(self.actual_owner,'acknowledgement',side_effect=lambda *_:copy.deepcopy(self.ack)))
        self.enterContext(patch.object(self.actual_owner,'actor_current',side_effect=lambda *_:{**copy.deepcopy(self.ack),'currentActorQualified':True,'immutableAcknowledgementOnly':False}))

    def public(self,path,digest=None,maximum=4000000):
        name=Path(path).name
        if name in self.documents:raw=self.documents[name]
        elif name=='final-supervisor-inventory-v1.py':raw=(HERE.parent/'solana-acceptance'/name).read_bytes()
        else:return self.base.public(path,digest,maximum)
        u.need(digest is None or u.sha(raw)==digest,'exact_actual_continuation2_fixture_source_required');return raw

    def loaded(self,path,digest):
        self.public(path,digest);name=Path(path).name
        if name==e.OWNER:return self.actual_owner
        if name==e.LEGACY.name:return types.SimpleNamespace(namespace=lambda _:prior.prior.value.old.old_cache.metatest.namespace())
        if name==p.FROZEN.name:return self.frozen_provider
        if name=='ypal-ordinary-cache-continuation-authority-v2.py':
            result=c.composition();result.public=self.public;return c
        return self.base.u.load(path,digest)

    def provider(self):
        control=self
        class Provider:
            def __getattr__(self,name):return getattr(self_module,name)if hasattr(self_module,name)else getattr(control.frozen_provider,name)
            def namespace(self,config,manifest=None,source_guard=None,inverse=False):
                return p.namespace(config,control.manifest,source_guard,inverse,control.refs)
        self_module=p
        with patch.object(prior,'p',Provider()):return self.base.actual_provider()

    def test_actual_new_provider_routes_real_metadata_namespace_without_old_actor_alias(self):
        n=self.provider();cache=n.cache_runtime()
        self.assertEqual(cache.FORMAT,p.FORMAT);self.assertEqual(cache.BASE,p.BASE);self.assertEqual(cache.prior_cache.BASE,u.OLD_BASE)
        self.assertEqual(cache.retained_boot_archive,u.BOOT_ARCHIVE)
        self.assertEqual(cache.metadata_epoch.refs,self.refs);self.assertEqual(cache.metadata_epoch_namespace.metadata.__code__.co_freevars,())
        self.assertEqual(cache.continuation_reader['manifestFile'],r.MANIFEST.name)
        self.assertEqual(p.METADATA_SHA,e.LEGACY_SHA)
        old=load('ypal-cache-guard-owner-v1.py')
        for name in ['commit','prepare_ack','owned','reconcile_commit']:
            self.assertEqual(getattr(cache,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
        previous=self.base.actual_provider().cache_runtime()
        for name in ['inverse','reconcile_inverse','finish_inverse']:
            self.assertEqual(getattr(cache,name).__code__.co_code,getattr(previous,name).__code__.co_code,name)
        self.assertEqual(cache.ENTRY_SHA,'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705')

    def test_authority2_keeps_one_typed_namespace_and_entire_original_SQL_parent(self):
        n=self.provider();cache=n.cache_runtime();authority=c.composition()
        self.assertIs(authority,c.composition());self.assertIs(c.QualificationScope,authority.QualificationScope)
        self.assertEqual(c.PRIOR_XID,'16540148');self.assertEqual(c.PRIOR_INPUT_SHA,'2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa')
        self.assertEqual(c.NEW,p.FILE);self.assertEqual(c.NEW_BASE,p.BASE)
        expected=c.bounded_sql_parent(cache.prior_cache._sql_child,cache.prior_cache._sql_child)
        self.assertEqual(c.code_identity(expected.__code__),c.code_identity(cache._sql_child.__code__))
        self.assertIn('continuation_ack_deadline',cache._sql_child.__code__.co_names)

    def test_actual_reader_Proof_and_complete_transaction_and_inverse_bodies_remain(self):
        module=r.composition();proof=module.Proof(self.manifest_sha)
        root=module.assemble(self.public(module.TEMPLATE,module.TEMPLATE_SHA),proof)
        self.assertEqual(root.FORMAT,r.FORMAT);self.assertEqual(root.BASE,r.BASE)
        original=load('ypal-native-cutover-v1.py')
        for name in ['inverse','publish','admit_readers','inverse_global','reconcile_inverse','inverse_cache_catalog']:
            self.assertEqual(getattr(root,name).__code__.co_code,getattr(original,name).__code__.co_code,name)
        self.assertEqual(module.external_feature_contract()['ownerFile'],'ypal-ordinary-feature-handover-continue-v2.py')
        self.assertEqual(module.TRANSPORT_SHA,'865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4')

    def test_actual_caller_timing_binds_complete_metadata_ACK_and_new_epoch_identity(self):
        real=self.h.derive
        def derive(*args,**kwargs):
            result=real(*args,**kwargs)
            if args[1]==prior.a.KERNEL_SHA:result.helper=lambda:self.h
            return result
        with patch.object(self.h,'derive',side_effect=derive):caller=a.composed(self.manifest_sha,self.refs)
        caller.own_sha=lambda:u.sha((HERE/a.FILE.name).read_bytes())
        epoch=e.Epoch(self.refs,self.manifest)
        session=types.SimpleNamespace(key={'target':'cache','inputSha256':'fixture','direction':'forward'},metadata_epoch=epoch,
            host=types.SimpleNamespace(config={'generationBindingSha256':self.base.control.binding_sha}),
            protocol=load('ypal-ordinary-publication-protocol-v6.py'))
        first=caller.timing_key(session,'cache-prepared-held')
        self.assertEqual(first['format'],a.FORMAT);self.assertEqual(first['metadataEpoch'],epoch.binding())
        self.assertEqual(first['metadataCurrentHelperSha256'],u.sha((HERE/e.FILE.name).read_bytes()))
        self.assertEqual(first['providerSha256'],self.manifest['contexts']['phase']['sha256'])
        self.assertFalse(first['historicalMetadataTimingReused'])
        epoch.refs['resultSha256']='f'*64
        self.assertNotEqual(caller.timing_key(session,'cache-prepared-held'),first)

    def test_lifecycle_catalog_body_preserves_auth_columns_and_LOGIN_without_source_dispatch(self):
        namespace=self.provider();fn=r.catalog_only_reader(namespace);encoded=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
        read={'roles':[{'name':name,'oid':oid,'login':False}for name,oid in namespace.LOGINS.items()]}
        columns=[{'fixturePrivateColumnACL':'unchanged'}];review='fixture-owned-review'
        rolled={'sql':{'resultJson':'fixture-actual-SQL-plan'},'additionalReadDeltaSha256':'d'*64}
        operation={'binding':{'operatorSha256':'e'*64},'reviewHash':review}
        prepared={'xid':'123','planSha256':u.sha(rolled['sql']['resultJson'].encode()),'postProof':{'allColumnAcl':columns}}
        authorization={'format':p.FORMAT,'reviewHash':review,'readAdmissionSha256':self.config['readAdmissionSha256'],
            'additionalReadCount':4,'additionalReadDeltaSha256':rolled['additionalReadDeltaSha256']}
        records={'sql-prepared.json':prepared,'authorization.json':authorization,'rehearsed.json':rolled}
        records['sql-intent.json']={'format':p.FORMAT,'bootId':'fixture-boot','reviewHash':review,
            'authorizationSha256':u.sha(encoded(authorization)),'rehearsalSha256':u.sha(encoded(rolled))}
        records['sql-committed.json']={'operatorSha256':'e'*64,'bootId':'fixture-boot','reviewHash':review,
            'readAdmissionSha256':self.config['readAdmissionSha256'],'commitIntentSha256':u.sha(encoded(records['sql-intent.json'])),
            'preparedSha256':u.sha(encoded(prepared)),'xid':'123','additionalReadAuthorizationSha256':u.sha(encoded(authorization)),
            'postProof':{'catalog':read,'allColumnAcl':columns},'result':{'fixtureSQLResult':True}}
        rehearsal={'after':{'read':read,'allColumnAcl':columns}}
        reader=types.SimpleNamespace(admitted=lambda *_:({}, {}, rehearsal),boot=lambda:'fixture-boot',
            protected=lambda path:encoded(records[Path(path).name]),graph=lambda value:value,acl_catalog=lambda value:value)
        target=namespace.login_catalog(read,True);observed={'read':target,'allColumnAcl':columns}
        source=Mock(side_effect=AssertionError('catalog-only route called a source validator'))
        host=types.SimpleNamespace(config=self.config,new_read=reader,read_host=types.SimpleNamespace(catalog=Mock(return_value=observed),runtime=source),
            static=types.SimpleNamespace(inverse_source=source))
        host.cache=types.SimpleNamespace(document=lambda path:records[Path(path).name],owned=lambda _:(operation,rolled),read_extension=Mock())
        value=fn(host,True,True,target,True)
        self.assertTrue(value['validated']);self.assertFalse(value['sourceBinding']['sourcePredicateExecuted'])
        self.assertEqual(host.read_host.catalog.call_count,2);host.cache.read_extension.assert_called_once();source.assert_not_called()
        observed['allColumnAcl']=[{'foreignColumnACL':True}]
        with self.assertRaisesRegex(RuntimeError,'full_current_direct_relation_schema_function_and_all_column_graph'):
            fn(host,True,True,target,True)

    def test_default_CLIs_do_not_construct_private_current_contexts(self):
        for name in [e.FILE.name,p.FILE.name,r.FILE.name,a.FILE.name,c.FILE.name,'ypal-ordinary-publication-continue-inputs-v2.py','ypal-ordinary-publication-continue-manifest-v2.py']:
            result=json.loads(subprocess.run(['python3','-I','-B',str(HERE/name)],capture_output=True,check=True).stdout)
            self.assertTrue(result['staticOnly']);self.assertEqual(result['databaseWrites'],result['serviceActions']);self.assertEqual(result['databaseWrites'],0)


class PureControls(unittest.TestCase):
    def test_authority_derivation_counts_all_identity_seams_without_a_lifecycle_receipt(self):
        base=prior.Controls();base.setUp()
        try:
            actual=load('ypal-ordinary-cache-continuation-authority-v2.py')
            with patch.object(actual,'utility',return_value=base.u):
                first=actual.composition();second=actual.composition()
            self.assertIs(first,second);self.assertIs(first.QualificationScope,actual.QualificationScope)
            self.assertEqual(first.NEW,p.FILE);self.assertEqual(first.NEW_BASE,p.BASE)
            self.assertEqual(first.FORMAT,actual.FORMAT);self.assertEqual(first.PRIOR_XID,'16540148')
        finally:base.doCleanups()

    def test_default_imports_are_inert_without_any_lifecycle_or_consumer_receipt(self):
        for name in [e.FILE.name,p.FILE.name,r.FILE.name,a.FILE.name,c.FILE.name,'ypal-ordinary-publication-continue-inputs-v2.py','ypal-ordinary-publication-continue-manifest-v2.py']:
            result=json.loads(subprocess.run(['python3','-I','-B',str(HERE/name)],capture_output=True,check=True).stdout)
            self.assertTrue(result['staticOnly']);self.assertEqual(result['databaseWrites'],0)


if __name__=='__main__':unittest.main()
