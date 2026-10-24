#!/usr/bin/env python3
"""Actual frozen role methods and namespace controls, no host qualification."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load('ypal-restored-reader-cache-phase-v1.py')
coordinator = load('ypal-native-cutover-v2.py')
facade = load('ypal-native-cutover-proof-v2.py')
finish = load('ypal-cache-finish-v3.py')
REFS = {'retirementSha256': 'a' * 64, 'manifestSha256': 'b' * 64, 'inputSha256': 'c' * 64}


class Controls(unittest.TestCase):
    def feature(self):
        return {'format': 'yunipals-ypal-restored-feature-handover-v1', 'validated': True,
                'operatorSha256': m.FEATURE_SHA, 'receiptSha256': REFS['retirementSha256'],
                'temporarySourceRetired': True, 'collectorOnlyCurrentGraphQualified': True, 'api': {'pid': 100},
                'sourceActorQualified': False, 'financialAuthorityQualified': False, 'independentPeerLifecyclesQualified': False,
                'allConfiguredSourcesQualified': False, 'originalWholeValidatorsPassed': False,
                'current143WholeGraphQualified': False, 'databaseWrites': 0, 'serviceActions': 0}

    def mocked_feature(self, result):
        code = types.SimpleNamespace(CONTEXT=m.FEATURE_CONTEXT, CONTEXT_SHA=m.FEATURE_CONTEXT_SHA,
                                     validate_feature_leaf=lambda *args: result)
        self.enterContext(patch.object(m, 'module', side_effect=lambda path, digest: code if (path,digest)==(m.FEATURE,m.FEATURE_SHA)
                                      else self.fail('unknown producer requested')))
        self.enterContext(patch.object(m, 'protected', side_effect=lambda path,digest: b'exact fixture context'
                                      if (path,digest)==(m.FEATURE_CONTEXT,m.FEATURE_CONTEXT_SHA) else self.fail('unknown context')))
        return code

    def role_fixture(self):
        proof = facade.inherited_methods((HERE / facade.TEMPLATE).read_bytes(), lambda *a: self.fail('old loader must not run'))
        directory = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(directory.cleanup); proof.BASE = Path(directory.name)
        before = {'roles': [{'name': name, 'oid': oid, 'login': name not in proof.LOGIN_ROLES} for name,oid in proof.LEAF_ROLES.items()],
                  'effective': [{'role': name, 'schemas': {}, 'functions': {}, 'relations': {
                      proof.PHYSICAL+'.'+table: {'select': False} for table in proof.FEATURE_EIGHT}} for name in proof.LEAF_ROLES],
                  'directRoleEdges': [], 'schemas': [], 'functions': [],
                  'relations': [{'schema': proof.PHYSICAL, 'name': name, 'oid': str(1000+i), 'owner': '73004621'}
                                for i,name in enumerate(proof.FEATURE_EIGHT)]}
        current = proof.login_postcatalog(before)[0]
        collector = next(v for v in current['effective'] if v['role']==proof.PEERS['collector']['role'])
        for row in current['relations']:
            name=proof.PHYSICAL+'.'+row['name'];collector['relations'][name]['select']=True
            current['directRoleEdges'].append({'kind':'relation','object':row['oid'],'object_name':name,
                'grantee':int(proof.PEERS['collector']['oid']),'grantor':73004621,'privilege':'SELECT',
                'grantable':False,'column_number':None})
        columns=[]
        context=types.SimpleNamespace(logins_enabled=lambda:True, sql_ack={'postProof':{'catalog':before,'allColumnAcl':[]}},
            catalog=lambda:copy.deepcopy(current), query=lambda sql:0,
            phase=types.SimpleNamespace(admission_ref={'receiptSha256':'d'*64}),
            host=types.SimpleNamespace(read_host=types.SimpleNamespace(catalog=lambda:{'allColumnAcl':copy.deepcopy(columns)})),
            guard_scope=lambda enabled:{'exactGuard':enabled})
        feature={'producerSha256':m.FEATURE_SHA,'api':{'pid':100}}
        self.enterContext(patch.object(m,'feature_current',return_value=feature))
        return proof,context,current,columns

    def test_exact_frozen_sources_wire_manifest_and_static_default(self):
        for name,digest in [(m.ROOT.name,m.ROOT_SHA),('ypal-native-cutover-proof-v2.py',m.PROOF_SHA),
                            (m.FINISH.name,m.FINISH_SHA),('ypal-native-cutover-v2.manifest.json',m.MANIFEST_SHA)]:
            self.assertEqual(m.sha((HERE/name).read_bytes()),digest)
        result=subprocess.run([sys.executable,'-I','-B',str(HERE/'ypal-restored-reader-cache-phase-v1.py')],capture_output=True,check=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertEqual(result.stderr,b'')

    def test_new_feature_predicate_requires_actual_new_producer_and_context(self):
        result=self.feature();code=self.mocked_feature(result)
        self.assertEqual(m.feature_current(REFS)['producerSha256'],m.FEATURE_SHA)
        code.CONTEXT_SHA='e'*64
        with self.assertRaisesRegex(RuntimeError,'new_feature_context'):m.feature_current(REFS)

    def test_old_feature_or_foreign_new_ACK_and_extra_authority_refuse(self):
        result=self.feature();self.mocked_feature(result)
        for key,value in [('format','yunipals-ypal-feature-handover-v1'),('operatorSha256','e506'+'0'*60),
                          ('receiptSha256','f'*64),('collectorOnlyCurrentGraphQualified',False),('sourceActorQualified',True)]:
            prior=result[key];result[key]=value
            with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'new_feature_owned_retirement'):
                m.feature_current(REFS)
            result[key]=prior

    def test_feature_reference_shape_is_exact(self):
        for refs in ({}, {**REFS,'loader':'arbitrary.py'}, {**REFS,'retirementSha256':'unknown'}):
            with self.assertRaisesRegex(RuntimeError,'receipt_triple'):m.feature_current(refs)

    def test_actual_reused_role_slice_accepts_exact_new_eight_without_old_loader(self):
        proof,context,current,columns=self.role_fixture();result=m.role_scope(context,proof,REFS)
        self.assertTrue(result['fourOwnedRoleSlicesQualified']);self.assertTrue(result['allGranteeColumnACLsQualified'])
        self.assertFalse(result['sourceActorQualified']);self.assertFalse(result['currentWriterQualified'])
        self.assertEqual(result['readAdmissionSha256'],'d'*64)

    def test_different_missing_or_grantable_eighth_edge_refuses(self):
        proof,context,current,columns=self.role_fixture()
        for change in ('missing','wrong-object','grantable'):
            original=copy.deepcopy(current)
            if change=='missing':current['directRoleEdges'].pop()
            elif change=='wrong-object':current['directRoleEdges'][-1]['object']='99999'
            else:current['directRoleEdges'][-1]['grantable']=True
            with self.subTest(change=change),self.assertRaisesRegex(RuntimeError,'owned_reader_and_metadata_role_slice'):
                m.role_scope(context,proof,REFS)
            current.clear();current.update(original)

    def test_foreign_PUBLIC_column_and_no_LOGIN_phase_refuse(self):
        proof,context,current,columns=self.role_fixture()
        columns.append({'relation':'1000','edges':[{'grantee':0,'privilege':'UPDATE'}]})
        with self.assertRaisesRegex(RuntimeError,'all_grantee_column'):m.role_scope(context,proof,REFS)
        columns.clear();context.logins_enabled=lambda:False
        with self.assertRaisesRegex(RuntimeError,'owned_reader_LOGIN'):m.role_scope(context,proof,REFS)

    def test_new_namespaces_keep_entire_reader_and_cache_acceptance_bytecode(self):
        proof,context,current,columns=self.role_fixture()
        class BaseContext:
            def __init__(self,inputs):self.__dict__.update(context.__dict__)
            def business_environment(self,recorded=None):return {'synthetic':recorded}
        proof.Context=BaseContext
        root=coordinator.assemble((HERE/'ypal-native-cutover-v1.py').read_bytes(),types.SimpleNamespace())
        previous=root.reader_leaf_context
        namespace=m.reader_namespace(root,proof,REFS)
        self.assertIs(root.reader_leaf_context,previous)
        self.assertIs(namespace.validate_reader_leaf.__code__,root.validate_reader_leaf.__code__)
        self.assertIsNot(namespace.validate_reader_leaf.__globals__,root.validate_reader_leaf.__globals__)
        operation={'binding':{'inputs':{},'generationPublicInlineEnvironment':[]}}
        new=namespace.reader_leaf_context(proof,operation,REFS)
        self.assertTrue(new.scope(True)['featureEightComposed'])
        self.assertEqual(new.business_environment(),{'synthetic':[]})
        cache=finish.assemble((HERE/finish.TEMPLATE).read_bytes(),namespace,proof)
        old=load('ypal-cache-finish-v2.py')
        self.assertEqual(cache.validate_cache_leaf.__code__.co_code,old.validate_cache_leaf.__code__.co_code)
        self.assertEqual(cache.BASE,finish.BASE)

    def test_real_reader_and_cache_entrypoints_execute_new_predicate_without_old_loader(self):
        proof,template,current,columns=self.role_fixture()
        root=coordinator.assemble((HERE/'ypal-native-cutover-v1.py').read_bytes(),proof)
        root.BASE=proof.BASE;root.PUBLICATION=proof.BASE/'publication';root.PUBLICATION.mkdir(mode=0o700)
        proof.manifest_sha=m.MANIFEST_SHA
        proof.manifest={'files':{m.FINISH.name:m.FINISH_SHA}}
        proof.source_manifest=lambda pin:proof.manifest
        actors={name:{'main':{'pid':100+i}}for i,name in enumerate(proof.PEERS)}
        boots={name:{'inode':10+i}for i,name in enumerate(proof.PEERS)}
        cache_actor={'main':{'pid':500},'unit':{'InvocationID':'native-cache'}}
        cache_base=proof.BASE/'cache';cache_base.mkdir(mode=0o700)
        boot=cache_base/'boot';boot.symlink_to('/fixture/cache.service');cache_boot=root.inode(boot,True)
        def sql_child(host,mode,**kwargs):
            self.assertEqual(mode,'freshness')
            return {'collections':[{'collection':name,'fresh':True}for name in ['ethereum','base','polygon','bnb']]}
        cache_host=types.SimpleNamespace(BASE=cache_base,BOOT=boot,inode=root.inode,sql_child=sql_child)
        class BaseContext:
            def __init__(self,inputs):
                self.__dict__.update(template.__dict__);self.inputs=inputs;self.cache=cache_host
                self.host.actor=lambda native:cache_actor
            def accepted_source_closure(self):return {'accepted':True}
            def metadata_comparison(self):return {'fixedComparison':True}
            def metadata(self):
                # Real new scope executes again through the metadata callback.
                self.scope(True);return {'currentNativeMetadataQualified':True}
            def sessions(self,actor,oid):return {'owned':[]}
            def business_environment(self,recorded=None):return {'synthetic':recorded}
        proof.Context=BaseContext
        namespace=m.reader_namespace(root,proof,REFS)
        before_login=proof.login_postcatalog(template.sql_ack['postProof']['catalog'])[0]
        op={'binding':{'inputs':{'sourceManifestSha256':m.MANIFEST_SHA,'cachePreparedSha256':'d'*64},
            'generationPublicInlineEnvironment':[],'metadataFixedComparison':{'fixedComparison':True},
            'operatorSha256':m.ROOT_SHA,'afterLoginCatalog':before_login}}
        root.save('operation.json',op);root.save('published.json',{'syntheticPublication':True},directory=root.PUBLICATION)
        with (cache_base/'sql-committed.json').open('xb') as stream:
            stream.write(root.encoded(template.sql_ack))
        root.save('roles-prepared.json',{'after':before_login})
        namespace.published=lambda actual_proof:(op,{'publication':True},{'prepared':True})
        namespace.operation=lambda actual_proof:op
        namespace.current_published=lambda *args:True
        namespace.owned_reader=lambda c,operation,name:copy.deepcopy(actors[name])
        namespace.reader_boot=lambda actual_proof,name:copy.deepcopy(boots[name])
        namespace.original_inputs=lambda *args:True
        receipt={'format':root.FORMAT,'completed':True,'readersCutOver':True,'operatorSha256':m.ROOT_SHA,'bootId':root.boot(),
            'operationSha256':root.sha(root.public_input(root.BASE/'operation.json')),'sourceManifestSha256':m.MANIFEST_SHA,
            'publicationSha256':root.sha(root.public_input(root.PUBLICATION/'published.json')),
            'readerActors':actors,'readerBootLinks':boots,'generationId':'104'}
        receipt_sha=root.save('result.json',receipt)
        reader=namespace.validate_reader_leaf(receipt_sha,m.MANIFEST_SHA,REFS)
        self.assertTrue(reader['readersCutOver']);self.assertTrue(reader['roleSlice']['featureEightComposed'])
        cache=finish.assemble((HERE/finish.TEMPLATE).read_bytes(),namespace,proof)
        cache.BASE=proof.BASE/'finish';cache.BASE.mkdir(mode=0o700)
        binding={'format':cache.FORMAT,'bootId':root.boot(),'operatorSha256':m.FINISH_SHA,'cutoverSha256':receipt_sha}
        value={'binding':binding,'reviewHash':cache.sha(cache.encoded(binding))}
        cache.save('operation.json',value);cache.save('started.json',{'actor':cache_actor})
        final={'format':cache.FORMAT,'completed':True,'bootId':root.boot(),'operatorSha256':m.FINISH_SHA,
            'operationSha256':root.sha(root.public_input(cache.BASE/'operation.json')),'sourceManifestSha256':m.MANIFEST_SHA,
            'cutoverSha256':receipt_sha,'actor':cache_actor,'boot':cache_boot,'generationId':'104'}
        cache.save('result.json',final)
        accepted=cache.validate_cache_leaf(cache.sha(root.public_input(cache.BASE/'result.json')),m.MANIFEST_SHA,REFS)
        self.assertTrue(accepted['currentFourCollectionsFresh']);self.assertFalse(accepted['sourceActorQualified'])


if __name__=='__main__':unittest.main(verbosity=2)
