#!/usr/bin/env python3
"""Source/real-file inverse controls; live actor, SQL and manager are fixtures."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-native-metadata-approval-inverse-v1.py')
upstream=load('ypal-native-metadata-approval-epoch-v3.test.py').namespace
observer=load('ypal-native-metadata-approval-current-observer-v1.py')
public_pair=json.loads((HERE/'ypal-native-metadata-approval-current-observer-v1.execstart-fixture.json').read_bytes())


def actor(inv,pid,clock):
    rendering=public_pair['acknowledgedActor'].replace('pid=1180697','pid='+str(pid))
    if inv=='restored':rendering=rendering.replace(upstream.ARTIFACT,upstream.OLD_ARTIFACT)
    return{'unit':{'InvocationID':inv,'ExecMainStartTimestampMonotonic':str(clock),'NRestarts':'0','MainPID':str(pid),
        'ExecStart':rendering},
        'processes':[{'pid':pid,'startTicks':clock}],'main':{'pid':pid,'startTicks':clock},'commandSha256':'a'*64}


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='metadata-distinct-inverse-',dir=HERE);self.folder=Path(self.tmp.name)
        self.base=self.folder/'operation';self.base.mkdir(mode=0o700)
        actual_exists=os.path.lexists
        self.patches=[patch.object(m,'BASE',self.base),patch.object(m,'INPUT',self.folder/'input.json'),
            patch.object(os.path,'lexists',lambda path:True if Path(path)==upstream.DROP else actual_exists(path))]
        for p in self.patches:p.start()
        self.upgradeActor=actor('upgrade',20,100);self.restored=actor('restored',30,300);self.historical=actor('historical',10,10)
        self.sessions={'owned':[{'pid':40,'backendStart':'fresh'}],'otherPeers':[]};self.boot={'inode':8}
        self.refs={'mode':'current','resultSha256':m.UPGRADE_RESULT,'inputSha256':m.UPGRADE_INPUT,
            'producerSha256':m.OWNER_SHA,'manifestSha256':m.OWNER_MANIFEST_SHA}
        self.config={'format':m.FORMAT+'-input','upgradeRefs':self.refs,'upgradeOperationSha256':'b'*64,
            'source':{'inputSha256':'c'*64,'producerSha256':'d'*64,'manifestSha256':'e'*64},
            'catalog':{'resultSha256':'f'*64,'producerSha256':m.SOURCE_PINS[m.READER],
                'manifestSha256':m.SOURCE_PINS[m.READER_MANIFEST]}}
        m.INPUT.write_bytes(m.encoded(self.config));self.inputsha=m.sha(m.INPUT.read_bytes())
        self.upgrade={'operationSha256':'b'*64,'actor':self.upgradeActor,'boot':self.boot,
            'metadataInputSha256':'1'*64,'metadataOperationSha256':'2'*64,'metadataSelectedSha256':upstream.SELECTED_SHA,
            'historicalActor':self.historical,'historicalBoot':self.boot}
        self.ctx=m.InverseContext.__new__(m.InverseContext);self.ctx.input_sha=self.inputsha;self.ctx.config=self.config
        self.ctx.owner=upstream;self.ctx.upgrade=self.upgrade;self.ctx.selected={'nativeActor':self.historical,'boot':self.boot}
        self.ctx.operation={'oldWriter':{'private':True}};self.ctx.inputs=lambda:None;self.ctx.fence=lambda:None
        self.ctx.meta=types.SimpleNamespace(BOOT=self.folder/'boot',link=lambda p:self.boot,identity_alive=lambda *_:False,
            stable_scan=lambda value:value,state=lambda _: {'MainPID':'0','ControlPID':'0','Job':'','ActiveState':'inactive'})
        self.managers=[];self.ctx.meta.manager=lambda _,action:self.managers.append(action)
        self.ctx.host=types.SimpleNamespace(s=types.SimpleNamespace(boot=lambda:'boot-id'),m=object(),
            sessions=lambda _:copy.deepcopy(self.sessions),database=lambda:{'scan':{'ingestion_mode':'native','cursor':'frozen'}})
        self.ctx.actor=lambda new:copy.deepcopy(self.upgradeActor if new else self.restored)
        # Relation helpers load only the actual frozen public comparator code.
        self.relation=patch.object(m,'module',side_effect=lambda name:observer if name==m.OBSERVER else load(name))
        self.relation.start();self.addCleanup(self.relation.stop)
        self.ctx.lease=None;self.ctx.active_step=None;self.ctx.source_observations=[]
        self.terminal=[];self.ctx.terminal_actor=lambda h,op,act,sessions:self.terminal.append(copy.deepcopy(sessions))
        for name in ['step','manager','stop','start','check_start']:
            setattr(self.ctx,name,types.MethodType(m.clone_method(upstream,name),self.ctx))
        self.review={'actor':self.upgradeActor,'sessions':self.sessions,'boot':self.boot,'config':self.config,
            'scan':{'ingestion_mode':'native','cursor':'frozen'},'source':{'qualified':True}}
        _,proof,reader,_=self.source_fixture();catalog=reader.lifecycle_inverse_catalog(self.config['catalog'])
        self.review['source']={'source':m.stable_source(proof),'catalog':catalog,'sourceActorQualified':True,
            'READCatalogQualified':True,'oldWholeREADValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        rawSources=[{'source':copy.deepcopy(proof),'catalog':copy.deepcopy(catalog)}for _ in range(2)]
        self.op={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':self.inputsha,'config':self.config,'bootId':'boot-id',
            'upgradeRefs':self.refs,'upgradeOperationSha256':'b'*64,'reviewBinding':self.review,'reviewHash':upstream.review_hash(self.review),
            'rawSourceObservations':rawSources,'rawSourceObservationsSha256':m.sha(m.encoded(rawSources))}
        m.write('operation.json',self.op);self.ctx.read_operation=lambda:copy.deepcopy(self.op)
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def intent(self,name,clock=200):
        value={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':self.inputsha,'bootId':'boot-id',
            'operationSha256':m.sha(m.protected(self.base/'operation.json')),'name':name,'monotonicUs':clock}
        m.write(name+'-intent.json',value);return value
    def start_chain(self):
        for n in ['inverse-stop','inverse-unlink','inverse-reload']:
            self.intent(n);m.write(n+'-result.json',{'terminal':True,'actor':self.upgradeActor,
                'sessions':self.sessions,'priorSessions':self.sessions,'removed':True,'adoptedUpgradeOverlay':True,'reloaded':True})
        m.write('inverse-stop-capture.json',{'actor':self.upgradeActor,'sessions':self.sessions,'priorSessions':self.sessions,
            'operationSha256':m.sha(m.protected(self.base/'operation.json')),'bootId':'boot-id'})
        return self.intent('inverse-start')
    def arm(self):
        self.intent('inverse-stop');self.ctx.active_step=('inverse-stop',m.sha(m.protected(self.base/'inverse-stop-intent.json')))

    def test_every_retained_effect_method_is_actual_original_code_and_constants(self):
        for n in ['fence','step','manager','stop','start','check_start']:
            new=m.clone_method(upstream,n);old=getattr(upstream.Context,n)
            self.assertIs(new.__code__,old.__code__);self.assertEqual(new.__defaults__,old.__defaults__)
            self.assertEqual(new.__globals__['BASE'],m.BASE);self.assertEqual(new.__globals__['FORMAT'],m.FORMAT)
            self.assertEqual(new.__globals__['DROP'],upstream.DROP)
        self.assertNotEqual(upstream.BASE,m.BASE);self.assertEqual(upstream.FORMAT,'yunipals-native-metadata-approval-epoch-v3')
    def test_only_actual_upgrade_and_reader4_configuration_is_accepted(self):
        self.assertEqual(m.configuration(self.config),self.config)
        for field in ['resultSha256','inputSha256','producerSha256','manifestSha256']:
            value=copy.deepcopy(self.config);value['upgradeRefs'][field]='9'*64
            with self.assertRaises(RuntimeError):m.configuration(value)
        value=copy.deepcopy(self.config);value['catalog']['producerSha256']='8'*64
        with self.assertRaises(RuntimeError):m.configuration(value)
    def test_real_manager_final_actor_CAS_precedes_stop(self):
        self.arm();events=[];self.ctx.fence=lambda:events.append('fence')
        self.ctx.actor=lambda _:events.append('actor')or copy.deepcopy(self.upgradeActor)
        self.ctx.host.sessions=lambda _:events.append('sessions')or self.sessions
        self.ctx.meta.manager=lambda _,action:events.append(action)
        self.ctx.manager('stop',self.upgradeActor,self.sessions)
        self.assertEqual(events,['fence','actor','sessions','actor','actor','stop'])
    def test_foreign_invocation_or_zero_owned_kernel_never_stops(self):
        self.arm();self.ctx.actor=lambda _:actor('foreign',50,500)
        with self.assertRaises(RuntimeError):self.ctx.manager('stop',self.upgradeActor,self.sessions)
        self.assertEqual(self.managers,[])
        self.ctx.actor=lambda _:self.upgradeActor;self.ctx.host.sessions=lambda _:{'owned':[],'otherPeers':[]}
        with self.assertRaises(RuntimeError):self.ctx.manager('stop',self.upgradeActor,self.sessions)
        self.assertEqual(self.managers,[])
    def test_stop_saves_fresh_and_prior_proofs_and_checks_both_terminal(self):
        self.arm();prior={'owned':[{'pid':41,'backendStart':'prior'}],'otherPeers':[]}
        self.ctx.stop(self.upgradeActor,prior)
        self.assertEqual(self.terminal,[self.sessions,prior]);self.assertEqual(self.managers,['stop'])
        saved=m.document('inverse-stop-capture.json');self.assertEqual(saved['sessions'],self.sessions);self.assertEqual(saved['priorSessions'],prior)
    def test_start_rechecks_terminal_after_actual_fence(self):
        intent=self.intent('inverse-start');self.ctx.active_step=('inverse-start',m.sha(m.protected(self.base/'inverse-start-intent.json')))
        self.ctx.meta.state=lambda _:{'MainPID':'99','ControlPID':'0','Job':'','ActiveState':'active'}
        with self.assertRaises(RuntimeError):self.ctx.manager('start')
        self.assertEqual(self.managers,[])
    def test_actual_original_start_rejects_foreign_clock_boot_or_restart(self):
        intent=self.intent('inverse-start')
        self.ctx.check_start(intent,self.restored,False,self.upgradeActor)
        for key,value in [('operatorSha256','a'*64),('bootId','foreign'),('monotonicUs',400),('name','new-start')]:
            with self.assertRaises(RuntimeError):self.ctx.check_start({**intent,key:value},self.restored,False,self.upgradeActor)
        act=copy.deepcopy(self.restored);act['unit']['NRestarts']='1'
        with self.assertRaises(RuntimeError):self.ctx.check_start(intent,act,False,self.upgradeActor)
    def test_start_gap_inspection_is_genuine_readonly_and_needs_all_owned_ACKs(self):
        self.start_chain();observed=self.ctx.inspect_start()
        self.assertEqual(observed['actor'],self.restored);self.assertEqual(self.managers,[])
        self.assertFalse((self.base/'inverse-start-result.json').exists())
        (self.base/'inverse-reload-result.json').unlink()
        with self.assertRaises(FileNotFoundError):self.ctx.inspect_start()
    def test_missing_start_ACK_acceptance_has_zero_manager_calls_and_new_producer(self):
        self.start_chain();result=self.ctx.accept();saved=m.document('result.json')
        self.assertTrue(result['completed']);self.assertEqual(saved['upgradeRefs'],self.refs)
        self.assertEqual(saved['operatorSha256'],m.own_sha());self.assertFalse(saved['originalOwner3InverseCLIPassed'])
        self.assertTrue(m.document('inverse-start-result.json')['reconciledReadOnly']);self.assertEqual(self.managers,[])
        self.assertEqual(saved['artifactDigest'],upstream.OLD_ARTIFACT)
    def test_start_gap_zero_kernel_changed_scan_or_live_old_epoch_refuses(self):
        self.start_chain();self.ctx.host.sessions=lambda _:{'owned':[]}
        with self.assertRaises(RuntimeError):self.ctx.inspect_start()
        self.ctx.host.sessions=lambda _:self.sessions;self.ctx.host.database=lambda:{'scan':{'foreign':True}}
        with self.assertRaises(RuntimeError):self.ctx.inspect_start()
        self.ctx.host.database=lambda:{'scan':self.review['scan']};self.ctx.meta.identity_alive=lambda *_:True
        with self.assertRaises(RuntimeError):self.ctx.inspect_start()
    def test_default_and_actor_only_paths_never_call_full_source(self):
        tree=ast.parse((HERE/m.FILE.name).read_bytes())
        for n in tree.body:
            if isinstance(n,ast.FunctionDef)and n.name in ['actor_prefix_current','acknowledgement','restored_actor_current','actor_capture']:
                calls=[ast.unparse(x.func)for x in ast.walk(n)if isinstance(x,ast.Call)]
                self.assertNotIn('value.full_source',calls,n.name);self.assertNotIn('external_source',calls,n.name)
        self.assertEqual(m.STEPS,{'inverse-stop','inverse-unlink','inverse-reload','inverse-start'})

    def pure_owner(self):
        value=types.SimpleNamespace(**upstream.__dict__)
        value.acknowledgement=lambda *_:copy.deepcopy(self.upgrade)
        return types.SimpleNamespace(composition=lambda:value)
    def pure_module(self,name):return observer if name==m.OBSERVER else self.pure_owner()
    def accepted(self):
        self.start_chain();return self.ctx.accept()['receiptSha256']
    def test_real_pure_ACK_authenticates_new_chain_without_Context_or_current(self):
        result=self.accepted()
        with patch.object(m,'authenticate',lambda:None),patch.object(m,'module',side_effect=self.pure_module),\
                patch.object(m,'context',side_effect=AssertionError('pure ACK must not construct current')):
            ack=m.acknowledgement(result,self.inputsha)
        self.assertTrue(ack['immutableAcknowledgementOnly']);self.assertFalse(ack['currentActorQualified'])
        self.assertEqual(ack['upgradeRefs'],self.refs);self.assertEqual(ack['artifactDigest'],upstream.OLD_ARTIFACT)
    def test_pure_ACK_refuses_phase_or_stop_capture_drift(self):
        result=self.accepted();path=self.base/'inverse-stop-capture.json';raw=path.read_bytes()
        with patch.object(m,'authenticate',lambda:None),patch.object(m,'module',side_effect=self.pure_module):
            changed=m.document('inverse-stop-capture.json');changed['actor']=self.restored;path.write_bytes(m.encoded(changed))
            with self.assertRaises(RuntimeError):m.acknowledgement(result,self.inputsha)
            path.write_bytes(raw);path=self.base/'inverse-reload-result.json';path.write_bytes(m.encoded({'reloaded':False}))
            with self.assertRaises(RuntimeError):m.acknowledgement(result,self.inputsha)
    def test_pure_ACK_refuses_old_owner_alias_or_changed_original_metadata_history(self):
        result=self.accepted();path=self.base/'result.json';original=m.document('result.json')
        for field,value in [('operatorSha256',m.OWNER_SHA),('originalOwner3InverseCLIPassed',True),
                ('metadataOperationSha256','9'*64),('upgradeOperationSha256','8'*64),('scan',{'changed':True})]:
            altered=copy.deepcopy(original);altered[field]=value;path.write_bytes(m.encoded(altered));digest=m.sha(path.read_bytes())
            with patch.object(m,'authenticate',lambda:None),patch.object(m,'module',side_effect=self.pure_module),self.assertRaises(RuntimeError):
                m.acknowledgement(digest,self.inputsha)
        path.write_bytes(m.encoded(original))
    def source_fixture(self):
        self.ctx.execution={'readConfig':{'admissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64},
            'ordinaryRuntime':{'real':'ancestry'}}
        own={'inputSha256':self.inputsha,'producerSha256':m.own_sha(),'manifestSha256':'4'*64}
        terminal={'phase':'owned-terminal','actor':None,'stoppedActor':self.upgradeActor,
            'ownedNativeStopIntentQualified':True,'ownedNativeStopIntentSha256':'5'*64}
        peers={name:{}for name in ['main','collector','islands']}
        prefix={'readers':{name:copy.deepcopy(terminal)for name in peers},'cache':copy.deepcopy(terminal),
            'metadataInverseRefs':own,'catalog':{'ownedCacheReadsPresent':True,'apiLoginsEnabled':True}}
        proof={'validated':True,'sourceOnlyCurrent':True,'sourceActorQualified':True,'currentWriterQualified':True,
            'frameworkReady':True,'metadataInverseFromSupplementalRefs':True,
            'operatorSha256':self.config['source']['producerSha256'],'inputSha256':self.config['source']['inputSha256'],
            'metadataInverseRefs':own,'ordinaryRuntimeAncestry':self.ctx.execution['ordinaryRuntime'],
            'financialAuthorityQualified':False,'originalWholeStablePassed':False,'oldStandaloneSuccessClaimed':False,
            **upstream.DATA,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'binding':{'ownedConsumerPrefix':prefix}}
        proof['bindingSha256']=m.sha(m.encoded(proof['binding']))
        catalog={'validated':True,'catalogOnly':True,'sourceActorQualified':False,'originalWholeValidatorPassed':False,
            'readAdmissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.calls=[]
        reader=types.SimpleNamespace(lifecycle_inverse_catalog=lambda refs:self.calls.append('catalog')or copy.deepcopy(catalog),
            composition=lambda:types.SimpleNamespace(core=lambda manifest:(None,types.SimpleNamespace(PEERS=peers))))
        route=types.SimpleNamespace(validate_current_source=lambda input_sha,refs:self.calls.append(('source',input_sha,refs))or copy.deepcopy(proof))
        return own,proof,reader,route
    def test_full_effect_fence_requires_catalog_SOURCE_and_all_actual_native_stop_intents(self):
        own,proof,reader,route=self.source_fixture()
        with patch.object(m,'module',return_value=reader),patch.object(m,'external_source',return_value=route),patch.object(m,'own_refs',return_value=own):
            value=self.ctx.full_source()
        self.assertTrue(value['sourceActorQualified']);self.assertEqual(self.calls[0],'catalog');self.assertEqual(self.calls[-1],'catalog')
        self.assertEqual(self.calls[1],('source',self.config['source']['inputSha256'],own))
    def test_effect_fence_refuses_autoexit_missingworkload_ready0_LOGINor44_drift(self):
        mutations=[lambda p:p.update(frameworkReady=False),lambda p:p.update(schemaOid='foreign'),
            lambda p:p['binding']['ownedConsumerPrefix']['readers']['main'].update(ownedNativeStopIntentQualified=False),
            lambda p:p['binding']['ownedConsumerPrefix']['cache'].update(actor=self.upgradeActor),
            lambda p:p['binding']['ownedConsumerPrefix']['readers'].pop('islands'),
            lambda p:p['binding']['ownedConsumerPrefix']['catalog'].update(apiLoginsEnabled=False),
            lambda p:p.update(ordinaryRuntimeAncestry={'foreign':True})]
        for mutate in mutations:
            own,proof,reader,route=self.source_fixture();mutate(proof)
            with patch.object(m,'module',return_value=reader),patch.object(m,'external_source',return_value=route),\
                    patch.object(m,'own_refs',return_value=own),self.assertRaises(RuntimeError):self.ctx.full_source()
    def test_real_full_SOURCE_clock_and_heartbeat_progress_without_authorization_drift(self):
        own,proof,reader,route=self.source_fixture();counter=0
        def current(*_):
            nonlocal counter
            counter+=1;value=copy.deepcopy(proof);value['native']={'clock':counter,'app':{'heartbeat_at':str(counter)}};return value
        route.validate_current_source=current
        self.ctx.current_upgrade=lambda:{'actor':copy.deepcopy(self.upgradeActor),'observer':'new-current-proof'}
        with patch.object(m,'BASE',self.folder/'fresh-operation'),patch.object(m,'module',return_value=reader),\
                patch.object(m,'external_source',return_value=route),patch.object(m,'own_refs',return_value=own):
            first=self.ctx.review();second=self.ctx.review()
        self.assertEqual(upstream.review_hash(first),upstream.review_hash(second));self.assertEqual(counter,4)
        self.assertEqual([row['source']['native']['clock']for row in self.ctx.source_observations],[1,2,3,4])
        self.assertEqual([row['source']['native']['app']['heartbeat_at']for row in self.ctx.source_observations],['1','2','3','4'])
    def test_stable_SOURCE_binding_private_or_catalog_change_still_refuses_review(self):
        for key in ['privateIdentitySha256','sourceActorSha256']:
            own,proof,reader,route=self.source_fixture();count=0
            def current(*_):
                nonlocal count
                count+=1;value=copy.deepcopy(proof);value['binding'][key]=str(count)
                value['bindingSha256']=m.sha(m.encoded(value['binding']));return value
            route.validate_current_source=current;self.ctx.current_upgrade=lambda:{'actor':self.upgradeActor}
            with patch.object(m,'BASE',self.folder/'fresh-operation'),patch.object(m,'module',return_value=reader),\
                    patch.object(m,'external_source',return_value=route),patch.object(m,'own_refs',return_value=own),self.assertRaises(RuntimeError):self.ctx.review()
        own,proof,reader,route=self.source_fixture();original=reader.lifecycle_inverse_catalog;count=0
        def catalog(refs):
            nonlocal count
            count+=1;value=original(refs);value['catalogSha256']=str(count);return value
        reader.lifecycle_inverse_catalog=catalog
        with patch.object(m,'module',return_value=reader),patch.object(m,'external_source',return_value=route),\
                patch.object(m,'own_refs',return_value=own),self.assertRaises(RuntimeError):self.ctx.full_source()
    def test_raw_review_SOURCE_records_remain_hash_bound(self):
        m.review_source_observations(self.op)
        altered=copy.deepcopy(self.op);altered['rawSourceObservations'][0]['source']['native']={'clock':'changed'}
        with self.assertRaises(RuntimeError):m.review_source_observations(altered)

    def prefix_fixture(self):
        prefix=load(m.PREFIX);epochDrop=self.folder/'epoch-overlay.conf';epochDrop.write_bytes(upstream.drop_bytes())
        originalDrop=self.folder/'original-overlay.conf';originalDrop.write_bytes(b'original owned drop\n')
        candidates=self.folder/'candidate';candidates.mkdir();(candidates/'selector').write_bytes(b'selector bytes\n')
        historical=self.folder/'historical';historical.mkdir();identity=lambda p:{'inode':Path(p).stat().st_ino}
        (historical/'native-drop-created.json').write_bytes(m.encoded(identity(originalDrop)))
        owner=types.SimpleNamespace(**upstream.__dict__);owner.DROP=epochDrop;owner.inode=identity
        epochIdentity=identity(epochDrop)
        owner.document=lambda name,digest=None:{'identity':copy.deepcopy(epochIdentity)}if name=='overlay-created.json'else (_ for _ in()).throw(AssertionError(name))
        self.ctx.owner=owner;self.ctx.operation['candidateDropSha256']=m.sha(originalDrop.read_bytes())
        self.ctx.meta.DROP=originalDrop;self.ctx.meta.CANDIDATES=candidates;self.ctx.meta.BASE=historical
        self.ctx.meta.file_identity=identity
        self.ctx.host.private=lambda writer:None
        self.ctx.host.candidate={'files':{'selector':m.sha((candidates/'selector').read_bytes())}}
        self.ctx.host.m=types.SimpleNamespace(protected=lambda path:Path(path).read_bytes())
        self.ctx.host.s.document=lambda path:json.loads(Path(path).read_bytes())
        self.ctx.host.s.protected=lambda path:Path(path).read_bytes()
        keys=['Id','User','Group','FragmentPath','DropInPaths','EnvironmentFiles','WorkingDirectory','Restart',
            'UnitFileState','WantedBy','RequiredBy','TriggeredBy','Triggers','PartOf','UpheldBy','KillMode']
        state={key:'same-owned-'+key for key in keys};state.update(self.upgradeActor['unit'])
        state.update(Job='',ControlPID='0',ActiveState='active')
        self.upgradeActor['unit']=copy.deepcopy(state);self.upgrade['actor']=copy.deepcopy(self.upgradeActor)
        self.review['actor']=copy.deepcopy(self.upgradeActor);self.op['reviewBinding']=copy.deepcopy(self.review)
        (self.base/'operation.json').write_bytes(m.encoded(self.op))
        old=copy.deepcopy(state);old['ExecStart']=old['ExecStart'].replace(upstream.ARTIFACT,upstream.OLD_ARTIFACT)
        self.ctx.up=types.SimpleNamespace(read_operation=lambda:{'reviewBinding':{'state':old}})
        self.ctx.meta.state=lambda _:copy.deepcopy(state)
        return prefix,epochDrop,state,old
    def test_real_loaded_prefix_body_accepts_authorized_and_terminal_owned_cuts(self):
        prefix,drop,state,old=self.prefix_fixture()
        with patch.object(m,'module',return_value=prefix):
            first=m.actor_capture(self.ctx);self.assertEqual(first['phase'],'owned-upgrade-inverse-authorized')
            self.intent('inverse-stop');self.assertEqual(m.actor_capture(self.ctx)['phase'],'owned-upgrade-stop-intended')
            m.write('inverse-stop-result.json',{'terminal':True})
            m.write('inverse-stop-capture.json',{'actor':self.upgradeActor,'sessions':self.sessions,'priorSessions':self.sessions,
                'operationSha256':m.sha(m.protected(self.base/'operation.json')),'bootId':'boot-id'})
            state['MainPID']='0';state['ActiveState']='inactive'
            terminal=m.actor_capture(self.ctx);self.assertIsNone(terminal['actor']);self.assertEqual(len(self.terminal),2)
            self.intent('inverse-unlink');m.write('inverse-unlink-result.json',{'removed':True});drop.unlink()
            removed=m.actor_capture(self.ctx);self.assertIn(str(drop),removed['removedFiles'])
            self.intent('inverse-reload');m.write('inverse-reload-result.json',{'reloaded':True})
            state.update(old);state.update(MainPID='0',ActiveState='inactive')
            self.assertEqual(m.actor_capture(self.ctx)['phase'],'owned-program-terminal')
    def test_active_unacknowledged_start_foreign_loaded_command_or_candidate_refuses(self):
        prefix,drop,state,old=self.prefix_fixture()
        with patch.object(m,'module',return_value=prefix):
            self.intent('inverse-stop');self.intent('inverse-start')
            with self.assertRaises(RuntimeError):m.actor_capture(self.ctx)
            (self.base/'inverse-start-intent.json').unlink();state['ExecStart']=state['ExecStart'].replace('metadata-worker.mjs','foreign-worker.mjs')
            with self.assertRaises(RuntimeError):m.actor_capture(self.ctx)
            state['ExecStart']=self.upgradeActor['unit']['ExecStart'];(self.ctx.meta.CANDIDATES/'selector').write_bytes(b'foreign')
            with self.assertRaises(RuntimeError):m.actor_capture(self.ctx)

    def current_observer_fixture(self):
        actual=copy.deepcopy(self.upgradeActor)
        actual['unit']['ExecStart']=actual['unit']['ExecStart'].replace('pid=20','pid=0').replace(
            'start_time=[Sun 2026-10-25 20:55:16 UTC]','start_time=[n/a]')
        proof={'format':observer.FORMAT,'validated':True,'currentActorQualified':True,'operatorSha256':m.SOURCE_PINS[m.OBSERVER],
            'inputSha256':self.refs['inputSha256'],'upgradeRefs':self.refs,'upgradeAcknowledgement':copy.deepcopy(self.upgrade),
            'upgradeOperationSha256':self.upgrade['operationSha256'],'boot':self.boot,'actor':actual,
            'execStartPresentation':observer.actor_relation(actual,self.upgradeActor),'originalOwner3CurrentPassed':False,
            'immutableAcknowledgementOnly':False,'sourceActorQualified':False,'READAuthorityQualified':False,
            'publicationAuthorityQualified':False,'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        return actual,proof,types.SimpleNamespace(FORMAT=observer.FORMAT,actor_current=lambda *_:copy.deepcopy(proof),actor_relation=observer.actor_relation)
    def test_current_upgrade_consumes_new_raw_observer_and_never_relabels_ACK(self):
        actual,proof,module=self.current_observer_fixture()
        with patch.object(m,'module',return_value=module):observed=self.ctx.current_upgrade()
        self.assertEqual(observed['actor'],actual);self.assertNotEqual(observed['actor'],self.upgradeActor)
        self.assertEqual(observed['upgradeAcknowledgement'],self.upgrade)
        for mutate in [lambda p:p.update(originalOwner3CurrentPassed=True),lambda p:p.update(operatorSha256=m.OWNER_SHA),
                lambda p:p['actor']['unit'].update(NRestarts='1'),lambda p:p['upgradeAcknowledgement'].update(metadataInputSha256='9'*64)]:
            actual,proof,module=self.current_observer_fixture();mutate(proof)
            with patch.object(m,'module',return_value=module),self.assertRaises(RuntimeError):self.ctx.current_upgrade()
    def test_preoperation_actor_prefix_is_SOURCE_and_READ_independent(self):
        actual,proof,module=self.current_observer_fixture();self.ctx.current_upgrade=lambda:copy.deepcopy(proof)
        self.ctx.full_source=lambda:(_ for _ in()).throw(AssertionError('actor leaf must not call SOURCE'))
        with patch.object(m,'BASE',self.folder/'not-yet-owned'),patch.object(m,'context',return_value=self.ctx),\
                patch.object(m,'external_source',side_effect=AssertionError('no SOURCE route')):
            value=m.actor_prefix_current(self.inputsha)
        self.assertEqual(value['actor'],actual);self.assertIsNone(value['binding']['operationSha256'])
        self.assertFalse(value['sourceActorQualified']);self.assertFalse(value['wholeMetadataInverseQualified'])
    def test_missing_start_ACK_precedes_full_acceptance_fence_without_deadlock(self):
        self.start_chain();events=[]
        def fence():
            self.assertTrue((self.base/'inverse-start-result.json').exists())
            self.assertFalse((self.base/'result.json').exists());events.append('complete-source-and-catalog-fence')
        self.ctx.fence=fence;self.ctx.accept()
        self.assertEqual(events,['complete-source-and-catalog-fence']);self.assertEqual(self.managers,[])
    def test_refused_full_acceptance_fence_preserves_observed_start_without_final_ACK(self):
        self.start_chain();self.ctx.fence=lambda:(_ for _ in()).throw(RuntimeError('complete_SOURCE_refused'))
        with self.assertRaisesRegex(RuntimeError,'complete_SOURCE_refused'):self.ctx.accept()
        self.assertTrue(m.document('inverse-start-result.json')['reconciledReadOnly'])
        self.assertFalse((self.base/'result.json').exists());self.assertEqual(self.managers,[])
    def test_CF333_comparator_is_explicit_new_policy_with_all_other_fields_bound(self):
        actual=copy.deepcopy(self.restored);actual['unit']['ExecStart']=actual['unit']['ExecStart'].replace('pid=30','pid=0').replace(
            'start_time=[Sun 2026-10-25 20:55:16 UTC]','start_time=[n/a]')
        proof=m.restored_actor_relation(actual,self.restored)
        self.assertTrue(proof['changed']);self.assertFalse(proof['originalObserverProgramQualified'])
        self.assertEqual(proof['worker'],m.RESTORED_WORKER);self.assertEqual(proof['operatorSha256'],m.own_sha())
        self.assertNotEqual(proof['format'],observer.FORMAT+'-ExecStart-presentation')
        with self.assertRaises(RuntimeError):m.restored_actor_relation(self.upgradeActor,self.upgradeActor)
        wrong=copy.deepcopy(actual);wrong['unit']['InvocationID']='foreign'
        with self.assertRaises(RuntimeError):m.restored_actor_relation(wrong,self.restored)
    def test_restored_current_returns_actual_CF333_rendering_and_retains_raw_ACK(self):
        result=self.accepted();recorded=m.document('result.json');actual=copy.deepcopy(self.restored)
        actual['unit']['ExecStart']=actual['unit']['ExecStart'].replace('pid=30','pid=0').replace(
            'start_time=[Sun 2026-10-25 20:55:16 UTC]','start_time=[n/a]')
        self.ctx.actor=lambda _:copy.deepcopy(actual)
        with patch.object(m,'authenticate',lambda:None),patch.object(m,'module',side_effect=self.pure_module),patch.object(m,'context',return_value=self.ctx):
            value=m.restored_actor_current(result,self.inputsha)
        self.assertEqual(value['actor'],actual);self.assertNotEqual(value['actor'],recorded['actor'])
        self.assertTrue(value['restoredExecStartPresentation']['changed']);self.assertEqual(m.document('result.json'),recorded)
        self.assertFalse(value['originalOwner3CurrentPassed']);self.assertTrue(value['currentActorIsRawObserved'])
        altered=copy.deepcopy(self.op);altered['rawSourceObservations']=[];altered['rawSourceObservationsSha256']=m.sha(m.encoded([]))
        with self.assertRaises(RuntimeError):m.review_source_observations(altered)


if __name__=='__main__':unittest.main()
