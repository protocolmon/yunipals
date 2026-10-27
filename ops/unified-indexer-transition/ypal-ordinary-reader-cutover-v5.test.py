#!/usr/bin/env python3
"""V5 namespace, real held pipes/FDs, and completed acceptance DAG controls."""
import ast
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).parent.resolve()
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-ordinary-reader-cutover-v5.py');facade=load('ypal-ordinary-reader-proof-v5.py');transport=load('ypal-ordinary-reader-peer-v5.py');finish=load('ypal-ordinary-cache-finish-v5.py')
oldtests=load('ypal-native-cutover-v2.test.py')
TEMPLATE=(HERE/'ypal-native-cutover-v1.py').read_bytes()
REFS={'resultSha256':'a'*64,'manifestSha256':'b'*64,'inputSha256':'c'*64}

def local(path,pin=None,maximum=200000):
    target=HERE/Path(path).name if Path(path).parent==m.OPS else Path(path)
    raw=target.read_bytes()
    if pin is not None:m.need(m.sha(raw)==pin,'exact_local_reader_source_required')
    return raw

class Controls(unittest.TestCase):
    def controller(self):
        original=transport.public_bytes
        self.enterContext(patch.object(transport,'public_bytes',side_effect=lambda path,pin:original(HERE/Path(path).name if Path(path).parent==m.OPS else path,pin)))
        proof=types.SimpleNamespace(manifest_sha='a'*64,transport_module=lambda:transport,transport_current=lambda:{'fixture':True})
        return m.assemble(TEMPLATE,proof)
    def test_manifest_exact_V5_no_historical_alias(self):
        value=json.loads((HERE/m.MANIFEST.name).read_bytes());self.assertEqual(facade.manifest_contract(value),value)
        for change in [lambda v:v['dataIdentity'].update(readIdentity='0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'),lambda v:v['contexts']['phase'].update(file='ypal-restored-read-cache-provider-v1.py'),lambda v:v['dependencies'].update({facade.FEATURE:'e506'+'0'*60})]:
            bad=copy.deepcopy(value);change(bad)
            with self.assertRaises(RuntimeError):facade.manifest_contract(bad)
        for name,digest in {**value['files'],**value['dependencies']}.items():self.assertEqual(m.sha((HERE/name).read_bytes()),digest,name)
    def test_genuine_new_observer_ack_shape_and_reverted_old_epoch_refusal(self):
        observer=load('ypal-ordinary-observer-retained-prefix-v1.py')
        result={'format':observer.FORMAT,'mode':'new','operatorSha256':facade.CONTEXT_PINS['observer'],'releaseId':facade.DATA_IDENTITY['sourceRelease'],
          'observerScopeOnly':True,'ordinarySustainedObserver':True,'sourceActorQualified':False,'currentWriterQualified':False}
        with patch.object(observer,'recorded',return_value=(None,result)):
            ack=observer.acknowledgement('a'*64)
            self.assertEqual(facade.observer_acknowledged(ack,'a'*64,facade.CONTEXT_PINS['observer']),ack)
            result['mode']='old'
            with self.assertRaisesRegex(RuntimeError,'immutable_new_observer'):facade.observer_acknowledged(observer.acknowledgement('a'*64),'a'*64,facade.CONTEXT_PINS['observer'])
            result['mode']='new';result['releaseId']='old35'
            with self.assertRaises(RuntimeError):facade.observer_acknowledged(observer.acknowledgement('a'*64),'a'*64,facade.CONTEXT_PINS['observer'])

    def test_actual_static_constructor_excludes_all_historical_runtime_constructors(self):
        manifest_sha=m.sha((HERE/m.MANIFEST.name).read_bytes())
        with patch.object(facade,'protected',side_effect=local):p=facade.Proof(manifest_sha)
        self.assertEqual(p.READ,facade.DATA_IDENTITY['readSchema']);self.assertEqual(p.IDENTITY,facade.DATA_IDENTITY['readIdentity'])
        self.assertFalse(facade.EXCLUDED_METHODS&set(p.pure.SourceIndependentReaderMethods.__dict__))
        self.assertNotIn('phase',p.__dict__);self.assertIsNone(p._authorized_dependencies)
        old=load('ypal-native-cutover-proof-v1.py');self.assertNotEqual(old.READ,p.READ)
    def test_entire_reused_transaction_and_inverse_methods_unchanged(self):
        c=self.controller();old=load('ypal-native-cutover-v1.py')
        for name in ['publish','reconcile_publication','admit_readers','reconcile_roles','inverse','inverse_global','restore_legacy_readers','legacy_serving','reconcile_service','validate_current','validate_reader_leaf']:
            self.assertEqual(getattr(c,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
            self.assertIsNot(getattr(c,name).__globals__,getattr(old,name).__globals__)
        self.assertEqual(c.ENTRY.name,'ypal-ordinary-reader-sql-v5.mjs');self.assertEqual(c.PARITY_OWNER,'fixed-boundary-witness-v5.mjs')
        self.assertTrue(any(isinstance(v,str)and 'host(client_addr)'in v for v in c.owned_peer_session.__code__.co_consts))
        cache=finish.assemble((HERE/finish.TEMPLATE).read_bytes(),c,types.SimpleNamespace())
        oldfinish=load(finish.TEMPLATE)
        for name in ['start','reconcile_start','accept','validate_cache_leaf','drain_for_inverse','restore_old']:
            self.assertEqual(getattr(cache,name).__code__.co_code,getattr(oldfinish,name).__code__.co_code,name)
    def test_ten_exact_refs_and_static_default(self):
        c=self.controller()
        with tempfile.TemporaryDirectory(dir=HERE)as directory:
            path=Path(directory)/'input.json';value={k:'a'*64 for k in facade.INPUT_KEYS};path.write_bytes(c.encoded(value))
            self.assertEqual(c.inputs(path,c.sha(path.read_bytes())),value)
            path.write_bytes(c.encoded({**value,'transportQualificationSha256':None}))
            with self.assertRaises(RuntimeError):c.inputs(path,c.sha(path.read_bytes()))
        for name in [Path(m.__file__).name,finish.__file__]:
            result=subprocess.run([sys.executable,'-I','-B',str(HERE/Path(name).name)],capture_output=True,check=True)
            self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertEqual(result.stderr,b'')
    def test_real_missing_systemctl_execution_fields_need_typed_empty_arrays(self):
        p=facade.inherited_methods((HERE/facade.TEMPLATE).read_bytes(),lambda *args:None)
        context=p.SourceIndependentReaderMethods();unit=p.PEERS['main']['unit']
        keys=set(p.STATE_PROPERTIES);hooks={'ExecStartPre','ExecStartPost','ExecStop','ExecStopPost','ExecReload'}
        rows={k:''for k in keys-hooks};rows.update(Id=unit,LoadState='loaded');calls=[];typed={'type':'a(sasbttttuii)','data':[]}
        def command(args):
            calls.append(args)
            return ('\n'.join(k+'='+v for k,v in rows.items())+'\n').encode()if args[0]=='/usr/bin/systemctl'else json.dumps(typed).encode()
        context.host=types.SimpleNamespace(m=types.SimpleNamespace(run=command))
        value=context.state(unit);self.assertEqual(set(value),keys);self.assertEqual(len(calls),6)
        self.assertTrue(all(value[k]==''for k in hooks));self.assertTrue(all(v[0]=='/usr/bin/busctl'for v in calls[1:]))
        for bad in [{'type':'as','data':[]},{'type':'a(sasbttttuii)','data':[['foreign-hook']]},{'type':'a(sasbttttuii)','data':False}]:
            typed.clear();typed.update(bad)
            with self.subTest(bad=bad),self.assertRaisesRegex(RuntimeError,'genuine_typed_empty'):context.state(unit)
        typed.clear();typed.update(type='a(sasbttttuii)',data=[]);rows.pop('MainPID')
        with self.assertRaisesRegex(RuntimeError,'only_missing_optional'):context.state(unit)

    def test_cache_ready_compatibility_requires_exact_actual_three_receipt_refs(self):
        result={'cachePreparedSha256':'a'*64,'generationCandidateSha256':'b'*64,'sourceManifestSha256':'c'*64};calls=[]
        with patch.object(m,'protected',return_value=json.dumps(result).encode()),patch.object(m,'validate_current',side_effect=lambda *args:calls.append(args)or{'validated':True}):
            self.assertTrue(m.validate_cache_ready('d'*64,'a'*64,'b'*64)['validated']);self.assertEqual(calls,[('d'*64,'c'*64)])
            with self.assertRaises(RuntimeError):m.validate_cache_ready('d'*64,'a'*64,'foreign')
            self.assertEqual(len(calls),1)

    def role_fixture(self,feature=True):
        pure=facade.inherited_methods((HERE/facade.TEMPLATE).read_bytes(),lambda *args:self.fail('old producer loader must not run'))
        proof=object.__new__(facade.Proof);proof.pure=pure
        directory=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(directory.cleanup)
        self.enterContext(patch.object(facade,'BASE',Path(directory.name)))
        before={'roles':[{'name':name,'oid':oid,'login':name not in pure.LOGIN_ROLES}for name,oid in pure.LEAF_ROLES.items()],
          'effective':[{'role':name,'schemas':{},'functions':{},'relations':{pure.PHYSICAL+'.'+table:{'select':False}for table in pure.FEATURE_EIGHT}}for name in pure.LEAF_ROLES],
          'directRoleEdges':[],'schemas':[],'functions':[],
          'relations':[{'schema':pure.PHYSICAL,'name':name,'oid':str(1000+i),'owner':'73004621'}for i,name in enumerate(pure.FEATURE_EIGHT)]}
        current=pure.login_postcatalog(before)[0]
        if feature:
            collector=next(v for v in current['effective']if v['role']==pure.PEERS['collector']['role'])
            for row in current['relations']:
                name=pure.PHYSICAL+'.'+row['name'];collector['relations'][name]['select']=True
                current['directRoleEdges'].append({'kind':'relation','object':row['oid'],'object_name':name,'grantee':int(pure.PEERS['collector']['oid']),'grantor':73004621,'privilege':'SELECT','grantable':False,'column_number':None})
        columns=[];context=types.SimpleNamespace(logins_enabled=lambda:True,sql_ack={'postProof':{'catalog':before,'allColumnAcl':[]}},catalog=lambda:copy.deepcopy(current),query=lambda sql:0,
          phase=types.SimpleNamespace(admission_ref={'receiptSha256':'d'*64}),host=types.SimpleNamespace(read_host=types.SimpleNamespace(catalog=lambda:{'allColumnAcl':copy.deepcopy(columns)})),guard_scope=lambda value:{'guard':value})
        result={'format':'yunipals-ypal-ordinary-feature-handover-v5','operatorSha256':facade.FEATURE_SHA,'receiptSha256':REFS['resultSha256'],
          'independentPeerLifecyclesQualified':False,'allConfiguredSourcesQualified':False,'originalWholeValidatorsPassed':False,'current143WholeGraphQualified':False,
          'validated':True,'temporarySourceRetired':True,'collectorOnlyCurrentGraphQualified':True,'sourceActorQualified':False,'financialAuthorityQualified':False}
        code=types.SimpleNamespace(CONTEXT=facade.OPS/facade.FEATURE_CONTEXT,CONTEXT_SHA=facade.FEATURE_CONTEXT_SHA,validate_feature_leaf=lambda *args:result)
        proof.module=lambda name,digest:code if(name,digest)==(facade.FEATURE,facade.FEATURE_SHA)else self.fail('only new feature producer allowed')
        return proof,context,current,columns,result
    def test_actual_role_body_new_feature_and_all_column_negatives(self):
        proof,context,current,columns,result=self.role_fixture()
        value=proof.leaf_scope(context,REFS);self.assertTrue(value['featureEightComposed']);self.assertFalse(value['currentWriterQualified'])
        for change in ['foreign-edge','PUBLIC-column','wrong-context','false-qualified']:
            old=copy.deepcopy(current);columns.clear()
            if change=='foreign-edge':current['directRoleEdges'][-1]['grantable']=True
            if change=='PUBLIC-column':columns.append({'relation':'1000','edges':[{'grantee':0,'privilege':'UPDATE'}]})
            if change=='wrong-context':proof.module(facade.FEATURE,facade.FEATURE_SHA).CONTEXT_SHA='f'*64
            if change=='false-qualified':result['validated']=False
            with self.subTest(change=change),self.assertRaises(RuntimeError):proof.leaf_scope(context,REFS)
            current.clear();current.update(old);proof.module(facade.FEATURE,facade.FEATURE_SHA).CONTEXT_SHA=facade.FEATURE_CONTEXT_SHA;result['validated']=True
    def test_source_free_leaf_does_not_call_ordinary_or_historical_runtime(self):
        proof,context,_,_,_=self.role_fixture(False)
        proof.module_context=lambda *_:self.fail('no source constructor in completed leaf')
        self.assertFalse(proof.leaf_scope(context)['sourceActorQualified'])
        with self.assertRaises(RuntimeError):proof.leaf_scope(context,{'retirementSha256':'a'*64,'manifestSha256':'b'*64,'inputSha256':'c'*64})
    def test_real_reused_reader_and_cache_entrypoints_reach_new_feature_without_old_loader(self):
        proof,template,current,columns,_=self.role_fixture()
        root=m.assemble(TEMPLATE,proof);root.BASE=facade.BASE;root.PUBLICATION=root.BASE/'publication';root.PUBLICATION.mkdir(mode=0o700)
        proof.manifest_sha='1'*64;proof.manifest={'files':{Path(finish.__file__).name:m.sha(Path(finish.__file__).read_bytes())}}
        proof.source_manifest=lambda _:proof.manifest
        actors={name:{'main':{'pid':100+i}}for i,name in enumerate(proof.PEERS)}
        boots={name:{'inode':10+i}for i,name in enumerate(proof.PEERS)}
        cache_actor={'main':{'pid':500},'unit':{'InvocationID':'native-cache'}}
        cache_base=root.BASE/'cache';cache_base.mkdir(mode=0o700);boot=cache_base/'boot';boot.symlink_to('/fixture/cache.service');cache_boot=root.inode(boot,True)
        def sql_child(host,mode,**kwargs):
            self.assertEqual(mode,'freshness');return {'collections':[{'collection':name,'fresh':True}for name in['ethereum','base','polygon','bnb']]}
        cache_namespace=types.SimpleNamespace(BASE=cache_base,BOOT=boot,inode=root.inode,sql_child=sql_child)
        class Context:
            def __init__(context,inputs):
                context.__dict__.update(template.__dict__);context.inputs=inputs;context.cache=cache_namespace;context.host.actor=lambda native:cache_actor
            def leaf_scope(context,refs=None):return proof.leaf_scope(context,refs)
            def accepted_source_closure(context):return {'accepted':True}
            def metadata_comparison(context):return {'fixedComparison':True}
            def metadata(context):context.scope(True);return {'currentNativeMetadataQualified':True}
            def sessions(context,actor,oid):return {'owned':[]}
            def business_environment(context,recorded=None):return {'synthetic':recorded}
        proof.Context=Context
        after=proof.login_postcatalog(template.sql_ack['postProof']['catalog'])[0]
        operation={'binding':{'inputs':{'sourceManifestSha256':proof.manifest_sha,'cachePreparedSha256':'d'*64},'generationPublicInlineEnvironment':[],
           'metadataFixedComparison':{'fixedComparison':True},'operatorSha256':'e'*64,'afterLoginCatalog':after}}
        root.save('operation.json',operation);root.save('published.json',{'syntheticPublication':True},directory=root.PUBLICATION)
        (cache_base/'sql-committed.json').write_bytes(root.encoded(template.sql_ack));root.save('roles-prepared.json',{'after':after})
        root.published=lambda _:(operation,{'publication':True},{'prepared':True});root.operation=lambda _:operation;root.current_published=lambda *args:True
        root.owned_reader=lambda c,op,name:copy.deepcopy(actors[name]);root.reader_boot=lambda _,name:copy.deepcopy(boots[name]);root.original_inputs=lambda *args:True
        receipt={'format':root.FORMAT,'completed':True,'readersCutOver':True,'operatorSha256':'e'*64,'bootId':root.boot(),
          'operationSha256':root.sha(root.public_input(root.BASE/'operation.json')),'sourceManifestSha256':proof.manifest_sha,
          'publicationSha256':root.sha(root.public_input(root.PUBLICATION/'published.json')),'readerActors':actors,'readerBootLinks':boots,'generationId':'104'}
        receipt_sha=root.save('result.json',receipt)
        reader=root.validate_reader_leaf(receipt_sha,proof.manifest_sha,REFS)
        self.assertTrue(reader['readersCutOver']);self.assertTrue(reader['roleSlice']['featureEightComposed']);self.assertFalse(reader['sourceActorQualified'])
        cache=finish.assemble((HERE/finish.TEMPLATE).read_bytes(),root,proof);cache.BASE=root.BASE/'finish';cache.BASE.mkdir(mode=0o700)
        binding={'format':cache.FORMAT,'bootId':root.boot(),'operatorSha256':proof.manifest['files'][Path(finish.__file__).name],'cutoverSha256':receipt_sha}
        cache.save('operation.json',{'binding':binding,'reviewHash':cache.sha(cache.encoded(binding))});cache.save('started.json',{'actor':cache_actor})
        final={'format':cache.FORMAT,'completed':True,'bootId':root.boot(),'operatorSha256':binding['operatorSha256'],
          'operationSha256':root.sha(root.public_input(cache.BASE/'operation.json')),'sourceManifestSha256':proof.manifest_sha,
          'cutoverSha256':receipt_sha,'actor':cache_actor,'boot':cache_boot,'generationId':'104'}
        cache.save('result.json',final)
        accepted=cache.validate_cache_leaf(cache.sha(root.public_input(cache.BASE/'result.json')),proof.manifest_sha,REFS)
        self.assertTrue(accepted['currentFourCollectionsFresh']);self.assertFalse(accepted['sourceActorQualified'])
        current['directRoleEdges'][-1]['object']='foreign'
        with self.assertRaises(RuntimeError):root.validate_reader_leaf(receipt_sha,proof.manifest_sha,REFS)

    def protocol(self,lost=False,delay=False,start_failure=False):
        # Reuse the existing real-pipe fixture against THIS real new controller
        # and new sealed descriptor set. Only fixture expectations change.
        old=oldtests.Controls.protocol
        globals_map={**old.__globals__,'m':m,'transport':transport}
        code=old.__code__.replace(co_consts=tuple(13 if value==9 and type(value)is int else value for value in old.__code__.co_consts))
        # The FD-count literal lives in the nested spawn fixture code object.
        def rewrite(code):
            return code.replace(co_consts=tuple(rewrite(v)if isinstance(v,types.CodeType)else 13 if type(v)is int and v==9 and code.co_name=='spawn'else v for v in code.co_consts))
        return types.FunctionType(rewrite(code),globals_map)(self,lost,delay,start_failure)
    def assert_closed(self,descriptors):
        for fd in descriptors:
            with self.assertRaises(OSError):os.fstat(fd)
    def test_real_pipe_new_wire_and_durable_prepared_ACK(self):
        c,context,ack,calls,fds,base=self.protocol();result=c.child(context,'publish',{'generationId':'104'},ack)
        self.assertEqual(result,{'published':True,'xid':'900'});self.assertEqual(len(calls),1);self.assertTrue((base/'durable.json').exists());self.assert_closed(fds)
    def test_lost_ACK_no_redispatch_and_descriptor_cleanup(self):
        c,context,ack,calls,fds,base=self.protocol(lost=True)
        with self.assertRaises(RuntimeError):c.child(context,'publish',{},ack)
        self.assertEqual(len(calls),1);self.assertTrue((base/'durable.json').exists());self.assert_closed(fds)
    def test_deadline_and_failed_spawn_close_descriptors(self):
        c,context,ack,calls,fds,base=self.protocol(delay=True)
        with patch.object(c,'MAX_PREPARATION_SECONDS',.05),self.assertRaises(RuntimeError):c.child(context,'publish',{},ack)
        self.assertEqual(len(calls),1);self.assert_closed(fds)
        self.doCleanups()
        c,context,ack,calls,fds,base=self.protocol(start_failure=True)
        with self.assertRaises(OSError):c.child(context,'publish',{},ack)
        self.assert_closed(fds)

if __name__=='__main__':unittest.main(verbosity=2)
