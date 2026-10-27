#!/usr/bin/env python3
"""Local lifecycle boundary controls; OS/DB actor observations are fixtures."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('approval_epoch',ROOT/'ypal-native-metadata-approval-epoch-v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def actor(inv='new',clock=200):
    return {'unit':{'InvocationID':inv,'ExecMainStartTimestampMonotonic':str(clock),'NRestarts':'0'},
        'main':{'pid':2},'processes':[{'pid':2}],'commandSha256':'b'*64}

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='ypal-approval-epoch-test-',dir=ROOT);self.base=Path(self.tmp.name)
        self.p=patch.object(m,'BASE',self.base);self.p.start()
        self.old=actor('old',50);self.old['processes']=[{'pid':1}]
        self.current=actor();self.sessions={'owned':[{'pid':19,'backendStart':'epoch'}],'otherPeers':[]}
        self.ctx=m.Context.__new__(m.Context);self.ctx.input_sha='a'*64
        self.ctx.config={'metadataInputSha256':'c'*64,'metadataOperationSha256':'d'*64,'metadataSelectedSha256':m.SELECTED_SHA}
        self.ctx.selected={'nativeActor':self.old,'boot':{'inode':1}}
        self.ctx.inputs=lambda:None;self.ctx.fence=lambda:None
        self.ctx.meta=types.SimpleNamespace(link=lambda p:{'inode':1},BOOT=Path('/fixture/boot'),
            identity_alive=lambda h,p:False,stable_scan=lambda value:value,state=lambda h:{'MainPID':'0','ControlPID':'0','Job':'','ActiveState':'inactive'})
        self.ctx.host=types.SimpleNamespace(s=types.SimpleNamespace(boot=lambda:'boot'),m=object(),
            sessions=lambda a:copy.deepcopy(self.sessions),database=lambda:{'scan':{'mode':'native'}})
        self.ctx.actor=lambda new:copy.deepcopy(self.current)
        self.op={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':self.ctx.input_sha,'bootId':'boot',
            'reviewBinding':{'actor':self.old,'scan':{'mode':'native'}},'config':self.ctx.config}
        m.write('operation.json',self.op);self.ctx.read_operation=lambda:copy.deepcopy(self.op)
        self.ctx.active_step=None
        self.manager=[];self.ctx.meta.manager=lambda h,action:self.manager.append(action)
    def tearDown(self):self.p.stop();self.tmp.cleanup()
    def intent(self,name):
        value={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':self.ctx.input_sha,'bootId':'boot',
            'operationSha256':m.sha(m.protected(self.base/'operation.json')),'name':name,'monotonicUs':100}
        m.write(name+'-intent.json',value);return value
    def start_chain(self,inverse=False):
        for name in (['inverse-stop','inverse-unlink','inverse-reload']if inverse else['old-stop','overlay-publish','new-reload']):
            self.intent(name);m.write(name+'-result.json',{'completed':True})
        if inverse:
            m.write('result.json',{'actor':self.old});m.write('inverse-intent.json',{'upgradeResultSha256':m.sha(m.protected(self.base/'result.json')),'actor':self.old})
        self.intent('inverse-start'if inverse else'new-start')
    def test_configuration_actual_install_and_historical_selected(self):
        value={'format':m.FORMAT+'-input',**self.ctx.config,'newInstallSha256':m.INSTALL_SHA}
        self.assertEqual(m.configuration(value),value)
        for key in ['newInstallSha256','metadataSelectedSha256']:
            with self.assertRaises(RuntimeError):m.configuration({**value,key:'e'*64})
    def arm(self,name='old-stop'):
        self.intent(name);self.ctx.active_step=(name,m.sha(m.protected(self.base/(name+'-intent.json'))))
    def test_stop_compares_after_final_fence(self):
        self.arm()
        events=[];self.ctx.fence=lambda:events.append('fence')
        self.ctx.actor=lambda new:(events.append('actor')or copy.deepcopy(self.current))
        self.ctx.host.sessions=lambda a:(events.append('sessions')or self.sessions)
        self.ctx.meta.manager=lambda h,action:events.append(action)
        m.Context.manager(self.ctx,'stop',self.current,self.sessions)
        self.assertEqual(events,['fence','actor','sessions','actor','actor','stop'])
    def test_stop_refuses_restarted_invocation(self):
        self.arm()
        with self.assertRaisesRegex(RuntimeError,'same_selected'):m.Context.manager(self.ctx,'stop',actor('foreign'),self.sessions)
        self.assertEqual(self.manager,[])
    def test_stop_keeps_fresh_and_prior_backend_proof(self):
        self.arm()
        prior={'owned':[{'pid':18,'backendStart':'prior'}],'otherPeers':[]}
        value=m.Context.manager(self.ctx,'stop',self.current,prior)
        self.assertEqual(value,self.sessions);proof=m.document('old-stop-capture.json')
        self.assertEqual(proof['sessions'],self.sessions);self.assertEqual(proof['priorSessions'],prior)
        self.assertEqual(self.manager,['stop'])
    def test_stop_refuses_actor_change_after_sessions(self):
        self.arm()
        values=iter([self.current,actor('restarted')]);self.ctx.actor=lambda new:next(values)
        with self.assertRaisesRegex(RuntimeError,'same_selected'):m.Context.manager(self.ctx,'stop',self.current,self.sessions)
        self.assertEqual(self.manager,[])
    def test_start_rechecks_terminal_after_fence(self):
        self.arm("new-start")
        self.ctx.meta.state=lambda h:{'MainPID':'23','ControlPID':'0','Job':'','ActiveState':'active'}
        with self.assertRaisesRegex(RuntimeError,'terminal_metadata'):m.Context.manager(self.ctx,'start')
        self.assertEqual(self.manager,[])
    def test_inspect_missing_start_result_is_read_only(self):
        self.start_chain();self.assertEqual(self.ctx.inspect_start()['actor'],self.current)
        self.assertEqual(self.manager,[]);self.assertFalse((self.base/'new-start-result.json').exists())
    def test_accept_reconciles_existing_start_without_manager(self):
        self.start_chain();self.ctx.accept();proof=m.document('new-start-result.json')
        self.assertTrue(proof['reconciledReadOnly']);self.assertEqual(proof['serviceActions'],0)
        self.assertEqual(self.manager,[]);self.assertTrue(m.document('result.json')['completed'])
    def test_inverse_accept_reconciles_old_program_new_epoch(self):
        self.start_chain(True);self.ctx.accept(inverse=True);result=m.document('inverse-result.json')
        self.assertTrue(result['restoredOriginalProgram']);self.assertEqual(result['artifactDigest'],m.OLD_ARTIFACT)
        self.assertEqual(result['upgradeResultSha256'],m.sha(m.protected(self.base/'result.json')))
        self.assertTrue(m.document('inverse-start-result.json')['reconciledReadOnly']);self.assertEqual(self.manager,[])
    def test_missing_owned_predecessor_never_reconciles(self):
        self.intent('new-start')
        with self.assertRaises(FileNotFoundError):self.ctx.accept()
        self.assertFalse((self.base/'result.json').exists());self.assertEqual(self.manager,[])
    def test_start_intent_and_new_epoch_must_match(self):
        value=self.intent('new-start')
        for key,bad in [('operatorSha256','f'*64),('bootId','foreign'),('name','inverse-start'),('monotonicUs',201)]:
            with self.assertRaisesRegex(RuntimeError,'actual_owned_intent'):
                self.ctx.check_start({**value,key:bad},self.current,True,self.old)
        restarted=actor();restarted['unit']['NRestarts']='1'
        with self.assertRaises(RuntimeError):self.ctx.check_start(value,restarted,True,self.old)
    def test_live_old_actor_refuses_reconciliation(self):
        self.start_chain();self.ctx.meta.identity_alive=lambda h,p:True
        with self.assertRaisesRegex(RuntimeError,'actual_owned_intent'):self.ctx.accept()
        self.assertFalse((self.base/'result.json').exists())
    def test_zero_owned_sessions_or_scan_mutation_refused(self):
        self.start_chain();self.ctx.host.sessions=lambda a:{'owned':[]}
        with self.assertRaisesRegex(RuntimeError,'positive_existing'):self.ctx.accept()
        self.ctx.host.sessions=lambda a:self.sessions;self.ctx.host.database=lambda:{'scan':{'mode':'foreign'}}
        with self.assertRaisesRegex(RuntimeError,'legacy_scan'):self.ctx.accept()
    def test_existing_start_ACK_cannot_be_relabelled(self):
        self.start_chain();m.write('new-start-result.json',{'actor':actor('foreign'),'boot':{'inode':1},'sessions':self.sessions,'newProgram':True})
        before=(self.base/'new-start-result.json').read_bytes()
        with self.assertRaisesRegex(RuntimeError,'cannot_be_replaced'):self.ctx.accept()
        self.assertEqual((self.base/'new-start-result.json').read_bytes(),before)
    def test_owned_pool_growth_keeps_original_evidence(self):
        self.start_chain();initial=self.ctx.inspect_start();m.write('new-start-result.json',initial)
        self.sessions['owned'].append({'pid':20,'backendStart':'new-owned-epoch'})
        self.ctx.accept(initial);self.assertEqual(m.document('new-start-result.json')['sessions']['owned'],initial['sessions']['owned'])
        self.assertEqual(len(self.ctx.inspect_start()['sessions']['owned']),2)
    def test_owned_mapping_failure_propagates(self):
        self.start_chain()
        def fail(a):raise RuntimeError('foreign_backend_cannot_be_owned')
        self.ctx.host.sessions=fail
        with self.assertRaisesRegex(RuntimeError,'foreign_backend'):self.ctx.accept()
        self.assertFalse((self.base/'result.json').exists())
    def test_default_cli_has_no_constructor_before_explicit_action(self):
        tree=ast.parse((ROOT/'ypal-native-metadata-approval-epoch-v1.py').read_bytes())
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main')
        text=ast.unparse(fn);self.assertLess(text.index("'staticOnly': True"),text.index('Context(args.input_sha,'))
    def test_protected_file_refuses_symlink_and_writable_bytes(self):
        path=self.base/'public';path.write_text('real');path.chmod(0o644);link=self.base/'alias';link.symlink_to(path)
        with self.assertRaises(RuntimeError):m.protected(link)
        path.chmod(0o664)
        with self.assertRaises(RuntimeError):m.protected(path)
    def ack_fixture(self):
        config={'format':m.FORMAT+'-input',**self.ctx.config,'newInstallSha256':m.INSTALL_SHA};self.ctx.config=config
        self.op.update(config=config,historicalActor=self.old,historicalBoot={'inode':1})
        self.op['reviewBinding'].update(config=config,boot={'inode':1})
        self.op['reviewHash']=m.sha(m.encoded(self.op['reviewBinding']))
        (self.base/'operation.json').write_bytes(m.encoded(self.op))
        path=self.base/'input.json';path.write_bytes(m.encoded(config));path.chmod(0o600)
        self.ctx.input_sha=m.sha(path.read_bytes());self.op['inputSha256']=self.ctx.input_sha
        (self.base/'operation.json').write_bytes(m.encoded(self.op))
        self.start_chain();digest=self.ctx.accept()['receiptSha256']
        return path,digest
    def test_immutable_ACK_constructs_no_host_and_checks_real_start_chain(self):
        path,digest=self.ack_fixture()
        with patch.object(m,'INPUT',path),patch.object(m,'authenticate',lambda:None),patch.object(m,'history',lambda config:(self.op,self.ctx.selected)),\
             patch.object(m,'Context',side_effect=AssertionError('ACK must not construct Host')):
            proof=m.acknowledgement(digest,self.ctx.input_sha)
        self.assertTrue(proof['immutableAcknowledgementOnly']);self.assertFalse(proof['currentActorQualified'])
    def test_immutable_ACK_refuses_rehashed_foreign_actor_or_program(self):
        path,_=self.ack_fixture();original=m.document('result.json')
        with patch.object(m,'INPUT',path),patch.object(m,'authenticate',lambda:None),patch.object(m,'history',lambda config:(self.op,self.ctx.selected)):
            for key,value in [('artifactDigest',m.OLD_ARTIFACT),('historicalActor',actor('foreign')),('actor',actor('foreign')),('metadataSelectedSha256','f'*64)]:
                raw=m.encoded({**original,key:value});(self.base/'result.json').write_bytes(raw)
                with self.assertRaisesRegex(RuntimeError,'actual_immutable'):m.acknowledgement(m.sha(raw),self.ctx.input_sha)
    def test_real_retained_namespace_and_actor_compiler_construct_without_runtime(self):
        def load(name):
            value=types.ModuleType(name);path=ROOT/name;value.__file__=str(path);exec(compile(path.read_bytes(),str(path),'exec'),value.__dict__);return value
        factory=load('ypal-fresh-forward-epoch-v1.py');common=load('ypal-ordinary-consumer-handover-v5.py')
        common.module=lambda path,digest:factory
        common.public=lambda path,digest:(ROOT/Path(path).name).read_bytes()
        namespace=common.metadata_namespace('a'*64)
        self.assertEqual(namespace.FORMAT,common.META_FORMAT);self.assertEqual(namespace.BASE,common.META_BASE)
        with patch.object(m,'protected',lambda path,digest=None:(ROOT/Path(path).name).read_bytes()):
            fn=m.actor_function(namespace)
            self.assertIn('epoch_drop',fn.__globals__);self.assertEqual(fn.__globals__['epoch_drop_sha'],m.sha(m.drop_bytes()))
            for name,source,scope in [('initialize_metadata','ypal-ordinary-consumer-handover-v5.py',common.__dict__),
                    ('operation','ypal-restored-metadata-handover-v1.py',namespace.__dict__),
                    ('terminal','ypal-ordinary-consumer-handover-v5.py',common.__dict__)]:
                result=m.strip_refresh(None,(ROOT/source).read_bytes(),scope,name,namespace if name=='terminal'else None)
                self.assertEqual(result.__name__,name)
    def test_inverse_is_closed_without_actual_separate_source_catalog_input(self):
        self.ctx.inverse_config=None
        with self.assertRaisesRegex(RuntimeError,'inverse_effects_closed'):self.ctx.inverse('a'*64)
    def test_manager_direct_call_without_owned_intent_is_closed(self):
        with self.assertRaisesRegex(RuntimeError,'current_owned_exact_phase_intent'):m.Context.manager(self.ctx,'start')
        self.assertEqual(self.manager,[])
    def inverse_fixture(self):
        self.ctx.execution={'readConfig':{'admissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64},
            'ordinaryRuntime':{'resultSha256':'4'*64,'inputSha256':'5'*64}}
        value={'format':m.FORMAT+'-inverse-input','source':{'mode':'ordinary','inputSha256':'5'*64,
            'producerSha256':m.SOURCE_PINS[m.GUARD],'manifestSha256':m.SOURCE_PINS['ypal-ordinary-source-authority-v6.manifest.json']},
            'catalog':{'resultSha256':'6'*64,'producerSha256':'7'*64,'manifestSha256':'8'*64}}
        self.ctx.inverse_config=value;self.ctx.inverse_input_sha='9'*64
        catalog={'validated':True,'catalogOnly':True,'sourceActorQualified':False,'originalWholeValidatorPassed':False,
            'readAdmissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        raw=m.encoded(value);original=m.protected
        read=lambda path,digest=None:raw if path==m.INVERSE_INPUT else original(path,digest)
        return value,catalog,read
    def test_inverse_uses_real_source_current_without_old_READ_callback(self):
        _,catalog,read=self.inverse_fixture();events=[]
        self.ctx.source=types.SimpleNamespace(current=lambda:(events.append('source')or
            {'sourceActorQualified':True,'currentWriterQualified':True,'originalWholeValidatorPassed':False}))
        reader=types.SimpleNamespace(lifecycle_inverse_catalog=lambda refs:(events.append('catalog')or copy.deepcopy(catalog)))
        with patch.object(m,'protected',read),patch.object(m,'external_module',lambda *a:reader):
            proof=self.ctx.inverse_source()
        self.assertEqual(events,['catalog','source','catalog']);self.assertFalse(proof['oldWholeREADValidatorPassed'])
    def test_inverse_refuses_source_or_catalog_authority_alias(self):
        _,catalog,read=self.inverse_fixture();self.ctx.source=types.SimpleNamespace(current=lambda:
            {'sourceActorQualified':True,'currentWriterQualified':True,'originalWholeValidatorPassed':True})
        reader=types.SimpleNamespace(lifecycle_inverse_catalog=lambda refs:catalog)
        with patch.object(m,'protected',read),patch.object(m,'external_module',lambda *a:reader):
            with self.assertRaisesRegex(RuntimeError,'full_current_ready'):self.ctx.inverse_source()
            catalog['sourceActorQualified']=True
            with self.assertRaisesRegex(RuntimeError,'catalog_only'):self.ctx.inverse_source()
    def test_external_owned_prefix_authenticates_every_literal_byte_before_eval(self):
        dependency=self.base/'dependency.py';dependency.write_text('value=1\n');dependency.chmod(0o644)
        producer=self.base/m.PREFIX_SOURCE;producer.write_text('SOURCE_PINS='+repr({'dependency.py':m.sha(dependency.read_bytes())})+'\nvalue=7\n');producer.chmod(0o644)
        producer_sha=m.sha(producer.read_bytes());manifest={'format':'test-source','files':{producer.name:producer_sha,'dependency.py':m.sha(dependency.read_bytes())}}
        path=self.base/(producer.stem+'.manifest.json');path.write_bytes(m.encoded(manifest));path.chmod(0o644)
        refs={'producerSha256':producer_sha,'manifestSha256':m.sha(path.read_bytes())}
        with patch.object(m,'OPS',self.base):
            self.assertEqual(m.external_module(m.PREFIX_SOURCE,refs,'test-source',True).value,7)
            dependency.write_text('value=2\n')
            with self.assertRaisesRegex(RuntimeError,'same_actual'):m.external_module(m.PREFIX_SOURCE,refs,'test-source',True)

if __name__=='__main__':unittest.main()
