"""Real owned step/phase records and inode transitions, isolated runtime seams."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def assembled(name):
    wrapper=load(name);actual_read=Path.read_bytes
    def local(path,digest=None):
        path=HERE/Path(path).name
        if not path.exists()and path.name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/path.name
        if not path.exists()and path.name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/path.name
        raw=actual_read(path);wrapper.need(digest is None or wrapper.sha(raw)==digest,'actual_local_feature_inverse3_source');return raw
    def self_read(path):return actual_read(HERE/path.name)if path==wrapper.FILE else actual_read(path)
    with patch.object(wrapper,'authenticate',lambda:None),patch.object(wrapper,'public',local),patch.object(Path,'read_bytes',self_read):
        value=wrapper.composition()
    value.__file__=str(HERE/name);wrapper.public=local
    return value

m=assembled('ypal-ordinary-feature-inverse-prefix-v5.py')
old=load('ypal-feature-handover-v1.py')
helpers=load('ypal-restored-feature-context-v1.py')


class Controls(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(tmp.cleanup);self.base=Path(tmp.name)
        b=types.SimpleNamespace(**{key:value for key,value in old.__dict__.items()if not key.startswith('__')});self.b=b
        b.__file__=str(HERE/m.FEATURE);b.BASE=self.base;b.FORMAT='yunipals-ypal-ordinary-feature-handover-accept-v1'
        b.BOOT=self.base/'source.boot';b.SELECTOR=self.base/'selector.env';b.DROPS={b.API:self.base/'API.conf',b.QUEUE:self.base/'queue.conf'}
        b.boot_record=lambda:old.link_record(b.BOOT)
        archived=self.base/'temporary-source.boot.original';archived.symlink_to('/etc/systemd/system/'+b.SOURCE);self.boot=old.link_record(archived)
        self.catalog={'fixtureCompleteCollectorCatalog':'after8'};self.source_live=False;self.api_native=True;self.api_original=False
        self.api={'MainPID':'1073741801','startTicks':100,'InvocationID':'nativeAPI','ExecMainStartTimestampMonotonic':'100'}
        self.original_api={**self.api,'MainPID':'1073741802','startTicks':101,'InvocationID':'restoredAPI'}
        self.temporary={'pid':1073741803,'startTicks':102,'invocation':'restoredFRESH','actorPids':[1073741803],
            'sdkActor':{'processes':[{'pid':1073741803,'startTicks':102}],'unit':{'InvocationID':'restoredFRESH'}}}
        self.op={'format':b.FORMAT,'operatorSha256':m.FEATURE_SHA,'bootId':b.boot(),'manifestSha256':'a'*64,'inputSha256':'b'*64,
            'sourceBoot':self.boot,'source':{'sdkActor':{'processes':[{'pid':1073741799,'startTicks':99}]}},
            'catalogBefore':{'fixtureCompleteCollectorCatalog':'before8'},'catalogAfter':copy.deepcopy(self.catalog)}
        self.put('operation.json',self.op);self.put('switch-result.json',{'api':self.api})
        self.h=h=types.SimpleNamespace(inverse_mode=True,manifest_pin='a'*64,input_pin='b'*64)
        scope={**old.__dict__,'BASE':self.base,'FORMAT':b.FORMAT,'__file__':b.__file__}
        class Owner:
            def __init__(self,h):self.h=h
            def get(self,name,digest=None):return old.document(self_base/name,digest)
            def put(self,name,value):return old.save(self_base/name,value)
        self_base=self.base
        for name in ['operation','step','phase','start_api']:
            function=getattr(old.Owner,name);setattr(Owner,name,types.FunctionType(function.__code__,scope,name,function.__defaults__))
        self.owner=Owner(h)
        self.ack('retire-source-stop',{'terminal':True,'allRemainingWriterBackendsKernelOwnedByCombined':True})
        self.ack('retire-source-boot',{'disabled':True,'bootArchive':str(archived),'originalInodeRetained':True})
        self.ack('start-new-api',self.api)
        parity={'boundary':20};parity_sha=self.put('parity.json',parity)
        retirement={'format':b.FORMAT,'operatorSha256':m.FEATURE_SHA,'operationSha256':self.digest('operation.json'),'bootId':b.boot(),
            'retired':True,'allActivationPathsAbsent':True,'nativeSchemasAndReadsRetained':True,
            'switchReceiptSha256':self.digest('switch-result.json'),'freshEvent':{'blockNumber':19},'postEventParitySha256':parity_sha}
        rb={'boot':self.boot,'switchReceiptSha256':self.digest('switch-result.json'),'freshEvent':retirement['freshEvent'],
            'paritySha256':parity_sha,'parity':{'captureId':'isolated-fixture'}}
        self.put('retirement-review.json',{'binding':rb,'reviewHash':b.sha(b.encoded(rb))});self.retirement_sha=self.put('retirement-result.json',retirement)
        inverse={'operationSha256':self.digest('operation.json'),'switchReceiptSha256':self.digest('switch-result.json'),
            'apiProof':{'terminal':False},'retired':True,'sourceProof':{'terminal':True,'actor':None}}
        self.put('inverse-review.json',{**inverse,'api':self.api,'lastFeatureCursor':20,'reviewHash':b.sha(b.encoded(inverse))})
        self.virtual={};definitions={unit:('[Service]\nExecStart=/fixture/node '+unit+'\nEnvironmentFile=/fixture/private.env\n').encode()
            for unit in [b.API,b.QUEUE,b.TIMER]};units={unit:b.sha(raw)for unit,raw in definitions.items()}
        self.reader=types.SimpleNamespace(UNIT_PINS=units,DROPS={})
        for unit in units:self.virtual[str(Path('/etc/systemd/system')/unit)]=definitions[unit]
        b.DROP_BYTES=('[Service]\nEnvironmentFile='+str(b.SELECTOR)+'\n').encode()
        for digest,name,content in [(b.sha(b'fixture API'),'booster-api.mjs',b'fixture API'),
                                    (b.sha(b'fixture queue'),'booster-artwork-sync.mjs',b'fixture queue')]:
            self.virtual[str(Path('/opt/yunipals-unified/booster-api-releases')/digest/name)]=content
            setattr(self.reader,'API_SHA'if name=='booster-api.mjs'else'QUEUE_SHA',digest)
        raw_protected=b.protected
        b.protected=lambda path,*args:self.virtual[str(path)]if str(path)in self.virtual else raw_protected(path,*args)
        for path in [*b.DROPS.values(),b.SELECTOR]:
            old.save(path,b.DROP_BYTES if path in b.DROPS.values()else b'BOOSTER_DATABASE_SCHEMA=fixture\n',0o644)
            self.put('published-'+b.sha(str(path).encode())[:12]+'.json',{'path':str(path),'identity':b.identity(path.lstat()),'sha256':b.sha(path.read_bytes())})
        h.reader=self.reader;h.old_inputs=Mock();h.static=types.SimpleNamespace(gone=Mock())
        h.sdk=types.SimpleNamespace(command=lambda *_args,**_kwargs:json.dumps({'type':'a(sb)','data':[['/fixture/private.env',False]]+
            ([]if(self.base/'inverse-load-original-overlay-result.json').exists()else[[str(b.SELECTOR),False]])}).encode())
        h.parity=types.SimpleNamespace(capture_path=lambda _:self.base/'parity.json',validate_receipt=Mock())
        h.helpers=types.SimpleNamespace(source_static=Mock(),heartbeat_current=Mock(return_value={'fixturePositiveFRESHKernel':True}))
        h.state=self.state;h.source_activation=Mock();h.catalog=lambda:copy.deepcopy(self.catalog)
        def terminal(unit):
            m.need(not(self.source_live if unit==b.SOURCE else self.api_native or self.api_original),'fixture_actual_unit_not_terminal')
            return{'unit':unit,'terminal':True}
        h.terminal=terminal;h.source_actor=lambda _:copy.deepcopy(self.temporary)
        h.actor=lambda _:copy.deepcopy(self.original_api)
        h.inverse_api=lambda *_:{'terminal':not self.api_native,'actor':copy.deepcopy(self.api)if self.api_native else None}
        original_glob=Path.glob
        def glob(path,pattern):
            if str(path)in{'/etc/systemd/system','/run/systemd/system'}and pattern=='*/*':return iter([b.BOOT]if str(path).startswith('/etc/')and os.path.lexists(b.BOOT)else[])
            return original_glob(path,pattern)
        self.enterContext(patch.object(Path,'glob',glob))

    def put(self,name,value):
        path=self.base/name
        if path.exists():path.unlink()
        return old.save(path,value)
    def digest(self,name):return old.sha(old.protected(self.base/name))
    def ack(self,name,result):
        intent={'format':self.b.FORMAT,'operatorSha256':m.FEATURE_SHA,'bootId':self.b.boot(),
            'operationSha256':self.digest('operation.json'),'monotonicUs':100,'automaticRetryAllowed':False}
        digest=self.put(name+'-intent.json',intent);self.put(name+'-result.json',{'intentSha256':digest,'result':result})
    def state(self,unit):
        if unit==self.b.SOURCE:return{'FragmentPath':'/etc/systemd/system/'+unit,'WantedBy':'multi-user.target'if os.path.lexists(self.b.BOOT)else'',
            'MainPID':str(self.temporary['pid'])if self.source_live else'0'}
        loaded=(self.base/'inverse-load-original-overlay-result.json').exists()
        drop=''if loaded or unit not in self.b.DROPS else str(self.b.DROPS[unit])
        api=self.original_api if self.api_original else self.api
        return{'FragmentPath':'/etc/systemd/system/'+unit,'DropInPaths':drop,'User':self.b.ROLE,'Group':self.b.ROLE,
            'UnitFileState':'enabled','WantedBy':'multi-user.target','ExecStart':'{ argv[]=/fixture/node '+unit+' ; }',
            'MainPID':api['MainPID']if self.api_native or self.api_original else'0'}
    def current(self):return m.validate_current_phase(self.h,self.owner,self.b,self.retirement_sha)
    def restore_boot(self,ack=True):
        self.ack('inverse-source-boot',self.boot)
        if not ack:(self.base/'inverse-source-boot-result.json').unlink()
        (self.base/'temporary-source.boot.original').rename(self.b.BOOT)
    def restore_source(self):
        self.restore_boot();self.ack('inverse-source-start',self.temporary);self.source_live=True

    def test_real_receipts_retired_actor_and_archived_boot_are_qualified_separately(self):
        value=self.current();self.assertIsNone(value['temporarySourceActor']);self.assertEqual(value['apiPhase'],'owned-native')
        self.assertFalse(value['bootPrefix']['restored']);self.assertFalse(value['sourceActorQualified'])
        self.h.static.gone.assert_called_with(self.op['source']['sdkActor']['processes'])

    def test_real_owned_boot_move_before_reload_ACK_is_a_partial_prefix(self):
        self.restore_boot(ack=False);value=self.current()
        self.assertTrue(value['bootPrefix']['restored']);self.assertFalse(value['bootPrefix']['acknowledged'])
        self.assertIsNone(value['temporarySourceActor'])

    def test_active_source_without_actual_start_ACK_refuses_and_ACK_classifies_positive_actor(self):
        self.restore_boot();self.source_live=True
        with self.assertRaisesRegex(RuntimeError,'not_terminal'):self.current()
        self.ack('inverse-source-start',self.temporary);self.assertEqual(self.current()['temporarySourceActor'],self.temporary['sdkActor'])
        self.h.helpers.heartbeat_current.assert_called()

    def test_wrong_operation_or_intent_epoch_and_foreign_boot_inode_refuse(self):
        self.restore_source();value=self.owner.get('inverse-source-start-intent.json');value['operationSha256']='f'*64
        self.put('inverse-source-start-intent.json',value)
        with self.assertRaises(RuntimeError):self.current()
        self.ack('inverse-source-start',self.temporary);foreign=self.base/'foreign-boot'
        foreign.symlink_to('/etc/systemd/system/'+self.b.SOURCE);foreign.replace(self.b.BOOT)
        with self.assertRaises(RuntimeError):self.current()

    def test_native_API_terminal_requires_own_stop_or_actual_terminal_review(self):
        self.api_native=False
        with self.assertRaisesRegex(RuntimeError,'terminal_review'):self.current()
        self.ack('inverse-stop-api',{'unit':self.b.API,'terminal':True})
        self.assertEqual(self.current()['apiPhase'],'owned-terminal')

    def test_partial_owned_unlink_is_permitted_only_after_terminal_API_and_own_intent(self):
        self.restore_source();self.api_native=False;self.ack('inverse-stop-api',{'unit':self.b.API,'terminal':True})
        path=self.b.SELECTOR;name='inverse-remove-'+self.b.sha(str(path).encode())[:12]
        self.ack(name,{'removed':str(path)});(self.base/(name+'-result.json')).unlink();path.unlink()
        value=self.current();self.assertTrue(value['filePrefix'][str(path)]['unlinkIntent'])
        self.assertFalse(value['filePrefix'][str(path)]['unlinkAcknowledged'])
        (self.base/(name+'-intent.json')).unlink()
        with self.assertRaisesRegex(RuntimeError,'exact_owned_unlink_intent'):self.current()

    def test_unknown_original_API_start_and_catalog_transition_do_not_get_success_aliases(self):
        self.restore_source();self.api_native=False;self.api_original=True
        with self.assertRaises(RuntimeError):self.current()
        self.api_original=False;self.ack('inverse-stop-api',{'unit':self.b.API,'terminal':True})
        self.catalog=copy.deepcopy(self.op['catalogBefore'])
        with self.assertRaisesRegex(RuntimeError,'eight_SELECT_catalog'):self.current()
        self.ack('inverse-eight-selects',{'fixtureGenuineSqlACK':True})
        self.assertTrue(self.current()['ownedEightSELECTInverseAcknowledged'])

    def test_real_original_step_writes_start_ACK_after_body_and_external_cut_is_strict(self):
        self.restore_boot();events=[]
        def effect(intent):
            events.append(self.current()['temporarySourceActor']);self.source_live=True
            with self.assertRaisesRegex(RuntimeError,'not_terminal'):self.current()
            events.append('owned_start_body_observed');return copy.deepcopy(self.temporary)
        self.owner.step('inverse-source-start',effect)
        self.assertEqual(events,[None,'owned_start_body_observed'])
        self.assertEqual(self.current()['temporarySourceActor'],self.temporary['sdkActor'])

    def test_actual_retained_temporary_start_calls_entry_guard_before_manager_then_observes_without_ACK_recursion(self):
        self.restore_boot();events=[];self.h.b=self.b
        signature={'argv':['fixture-program'],'cwd':'/fixture','executable':'/fixture/node','uid':970,'gid':964,'groups':[964],
            'noNewPrivileges':True,'capabilitySetSha256':'a'*64,'startupInjectionAbsent':True,'parentPrivateValuesAbsent':True,
            'cgroup':'0::/system.slice/'+self.b.SOURCE,'normalizedEnvironmentSha256':'b'*64,'invocationEnvironmentMatched':True}
        original={'parent':{**signature,'pid':1073741780,'startTicks':1},'processes':[
            {**signature,'pid':1073741780,'startTicks':1},{**signature,'pid':1073741781,'startTicks':2,'parentPid':1073741780}]}
        previous={'sdkActor':original,'invocation':'old-temporary'}
        def execute(intent):
            ticks=intent['monotonicUs']*os.sysconf('SC_CLK_TCK')//1000000
            main={**signature,'pid':1073741803,'startTicks':ticks}
            actor={'parent':main,'processes':[main,{**signature,'pid':1073741804,'startTicks':ticks,'parentPid':main['pid']}],
                'unit':{'MainPID':str(main['pid']),'InvocationID':'new-temporary'}}
            self.temporary=helpers.temporary_value(actor)
            def manager(action,unit):
                events.append(('entry',self.current()['temporarySourceActor']));self.assertEqual((action,unit),('start',self.b.SOURCE))
                self.source_live=True
            self.h.manager=manager
            def query(sql):
                if 'SELECT value' in sql:return{'heartbeat_at':101 if self.source_live else 1,'build_id':self.b.FRESH_BUILD,'is_locked':'1'}
                return 102 if self.source_live else 100
            self.h.query=query
            scope={**helpers.__dict__,'capture_temporary':lambda _:copy.deepcopy(actor),
                'temporary_sessions':lambda *_:events.append(('positive-kernel',True))or{'fixtureActualPositiveSubset':True}}
            heartbeat=helpers.heartbeat_current
            scope['heartbeat_current']=types.FunctionType(heartbeat.__code__,scope,heartbeat.__name__,heartbeat.__defaults__)
            fn=helpers.HostMixin.restart_temporary_source
            actual=types.FunctionType(fn.__code__,scope,fn.__name__,fn.__defaults__)
            return actual(self.h,intent,previous)
        self.owner.step('inverse-source-start',execute)
        self.assertEqual(events,[('entry',None),('positive-kernel',True)])
        self.assertEqual(self.current()['temporarySourceActor'],self.temporary['sdkActor'])

    def test_actual_original_API_start_entry_guard_has_no_afterstart_preACK_recursion(self):
        self.restore_source();self.api_native=False;self.ack('inverse-stop-api',{'unit':self.b.API,'terminal':True})
        for path in [*self.b.DROPS.values(),self.b.SELECTOR]:
            name='inverse-remove-'+self.b.sha(str(path).encode())[:12];self.ack(name,{'removed':str(path)});path.unlink()
        self.ack('inverse-load-original-overlay',None);events=[]
        def manager(action,unit):
            events.append(self.current()['apiPhase']);self.assertEqual((action,unit),('start',self.b.API))
            self.original_api['ExecMainStartTimestampMonotonic']=str(self.owner.get('inverse-start-original-api-intent.json')['monotonicUs'])
            self.api_original=True
        self.h.manager=manager
        self.owner.step('inverse-start-original-api',lambda intent:self.owner.start_api(False,{'InvocationID':'nativeAPI'},intent))
        self.assertEqual(events,['owned-terminal']);self.assertEqual(self.current()['apiPhase'],'restored-original')

    def test_foreign_loaded_command_environment_order_or_retained_program_refuses_even_for_terminal_API(self):
        state=self.h.state
        self.h.state=lambda unit:{**state(unit),**({'ExecStart':'{ argv[]=/foreign/program ; }'}if unit==self.b.API else{})}
        with self.assertRaisesRegex(RuntimeError,'literal_original_feature_commands'):self.current()
        self.h.state=state;command=self.h.sdk.command
        self.h.sdk.command=lambda *_args,**_kwargs:json.dumps({'type':'a(sb)','data':[['/foreign/private.env',False]]}).encode()
        with self.assertRaisesRegex(RuntimeError,'loaded_environment_order'):self.current()
        self.h.sdk.command=command
        target=str(Path('/opt/yunipals-unified/booster-api-releases')/self.reader.API_SHA/'booster-api.mjs')
        self.virtual[target]=b'foreign program'
        with self.assertRaisesRegex(RuntimeError,'retained_feature_API_and_artwork'):self.current()


if __name__=='__main__':unittest.main()
