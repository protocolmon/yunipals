"""Actual new generation namespace and retained transaction/monitor contracts."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent.resolve()

def load(path):
    s=importlib.util.spec_from_file_location(Path(path).stem.replace('-','_'),path);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
m=load(HERE/'ypal-ordinary-generation-v5b.py')
c=load(HERE/'ypal-ordinary-consumer-handover-v5.py')
g=load(HERE/'ypal-ordinary-generation-candidates-v5.py')
config={'candidateInputSha256':'1'*64,'candidateReceiptSha256':'2'*64,'readConfig':{'admissionSha256':'3'*64,'readPlanSha256':'4'*64,'readContextInputSha256':'5'*64}}

def local(path,pin):
    raw=(HERE/Path(path).name).read_bytes();m.need(m.sha(raw)==pin,'exact_local_generation_public_source_required');return raw

def namespaces():
    original=c.module
    def component(path,pin):
        local(path,pin)
        if path==m.METADATA:return types.SimpleNamespace(namespace=lambda _:types.SimpleNamespace(cli_context=lambda *args:None))
        if path==m.CANDIDATES:return types.SimpleNamespace(namespace=lambda _:types.SimpleNamespace(FORMAT=g.FORMAT,FILES=tuple('four')))
        return original(path,pin)
    with patch.object(m,'common',return_value=c),patch.object(c,'public',local),patch.object(c,'load_input',return_value=config),patch.object(c,'module',side_effect=component):
        return m.namespace('6'*64,'7'*64)


class Controls(unittest.TestCase):
    def test_defaults_never_start_or_query(self):
        for path in [m.__file__,g.__file__]:
            result=subprocess.run(['/usr/bin/python3','-I','-B',path],capture_output=True,check=True)
            v=json.loads(result.stdout);self.assertTrue(v['staticOnly']);self.assertEqual(v['databaseWrites'],0)

    def test_real_new_namespace_keeps_effect_unknownACK_capsule_and_inverse_bodies(self):
        n=namespaces();old=load(HERE/m.TEMPLATE.name)
        self.assertNotEqual(n.BASE,old.BASE);self.assertNotEqual(n.UNIT,old.UNIT);self.assertEqual(n.CANDIDATES,m.CANDIDATE_BASE)
        for name in ['review','drain','bridge','read_bridge','build','reconcile_build','restore_activation','read_only_capsule']:
            self.assertEqual(getattr(n,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
            self.assertIsNot(getattr(n,name).__globals__,getattr(old,name).__globals__)
        self.assertEqual(n.META_FILE,m.METADATA);self.assertEqual(n.META_SHA,m.METADATA_SHA)
        self.assertIn(m.CANDIDATE_FORMAT,n.accept_candidate.__code__.co_consts)
        self.assertIn(m.CANDIDATE_FORMAT,n.validate_candidate_database_current.__code__.co_consts)
        self.assertIn(m.WORK.name,n.unit_bytes.__code__.co_consts)
        self.assertEqual(n.module(m.METADATA,m.METADATA_SHA).cli_context('actual'),None)
        with self.assertRaises(RuntimeError):n.module(m.METADATA,'0'*64)

    def test_new_guard_recovery_graph_is_only_V5_binding_and_import_delta(self):
        guard=(HERE/m.GUARD.name).read_text();old=(HERE/'ypal-cache-guard-transition-v1.mjs').read_text()
        self.assertEqual(guard,old.replace('yunipals_ownership_4e77f52b_v4',c.READ_SCHEMA).replace('0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67',c.READ_IDENTITY))
        recovery=(HERE/m.CAPSULE.name).read_text();self.assertEqual(recovery,(HERE/'ypal-generation-recovery-v1.mjs').read_text().replace('./ypal-cache-guard-transition-v1.mjs','./ypal-ordinary-cache-transition-v5.mjs'))
        self.assertEqual(m.sha(guard.encode()),m.GUARD_SHA);self.assertEqual(m.sha(recovery.encode()),m.CAPSULE_SHA)
        n=namespaces();self.assertEqual(n.GUARD,m.GUARD);self.assertEqual(n.CAPSULE,m.CAPSULE)
        self.assertIn('./ypal-ordinary-cache-transition-v5.mjs',n.BRIDGE);self.assertNotIn('./ypal-cache-guard-transition-v1.mjs',n.BRIDGE)
        self.assertNotIn('restored-generation-candidate-v1',m.CANDIDATE_FORMAT)

    def test_actual_reused_constructor_new_metadata_and_selector_chain_no_historical_load(self):
        n=namespaces();calls=[]
        files={name:m.sha(name.encode())for name in 'four'}
        intent={'format':g.FORMAT,'operatorSha256':m.CANDIDATES_SHA,'candidateInputSha256':config['candidateInputSha256'],'readConfig':config['readConfig'],'readIdentity':c.READ_IDENTITY,'readSchema':c.READ_SCHEMA,'selectorChanges':{n.LEADER:5,'yunipals-read-cache.service':4},'files':files}
        result={**intent,'staged':True,'selected':False,'generationStarted':False,'cacheStarted':False,'guardTransitionExecuted':False,'databaseWrites':0,'servicesChanged':False,'providerRequests':0,'permissionAdmissionAcknowledged':False}
        def protected(path):
            path=Path(path)
            return path.name.encode() if path.parent==m.CANDIDATE_BASE and path.name in files else (HERE/path.name).read_bytes()
        shared=types.SimpleNamespace(protected=protected,document=lambda path,*args:intent if path.name=='intent.json' else result)
        host=types.SimpleNamespace(s=shared,m=types.SimpleNamespace(protected=protected),admission_pin=config['readConfig']['admissionSha256'])
        meta=types.SimpleNamespace(cli_context=lambda pin,inverse:calls.append((pin,inverse))or host)
        installer=types.SimpleNamespace(installed=lambda *_:{'actualFixture':'installed'})
        def component(path,digest):
            if path==n.META_FILE:return meta
            if path==n.INSTALL_FILE:return installer
            self.fail('Unexpected module/source constructor: '+str(path))
        args=types.SimpleNamespace(metadata_input_sha='6'*64,read_ack=host.admission_pin,phase=None,install_ack='installed-fixture')
        with patch.object(n,'module',side_effect=component):
            actual=n.Host(args);self.assertIs(actual.h,host);self.assertEqual(calls,[('6'*64,False)])
            args.phase='restore-activation';n.Host(args);self.assertEqual(calls[-1],('6'*64,True))
            intent['readIdentity']='oldV4'
            with self.assertRaisesRegex(RuntimeError,'exclusive_intent'):n.Host(args)
            intent['readIdentity']=c.READ_IDENTITY;args.read_ack='foreign'
            with self.assertRaisesRegex(RuntimeError,'same_actual_new_READ'):n.Host(args)

    def test_actual_ordinary_metadata_owner_exports_namespace_expected_by_constructor(self):
        entry=load(HERE/m.METADATA.name)
        with patch.object(entry,'COMMON',HERE/c.FILE.name):self.assertEqual(entry.common().META_FORMAT,c.META_FORMAT)
        self.assertIn('input_sha',entry.namespace.__code__.co_varnames)
        self.assertEqual(m.sha((HERE/m.METADATA.name).read_bytes()),m.METADATA_SHA)
        self.assertEqual(m.sha((HERE/m.CANDIDATES.name).read_bytes()),m.CANDIDATES_SHA)

    def test_actual_selector_render_maps_only_existing_five_and_four_public_keys(self):
        old=load(HERE/g.TEMPLATE.name)
        before={'OWNERSHIP_READ_MODE':'unified','BASE_METADATA_INGESTION':'native','METADATA_SOURCE_MODE':'archive','YUNIPALS_PROJECTION_MODE':'generation'}
        with patch.object(c,'public',local):meta=c.candidate_namespace({'createdReceiptSha256':'1'*64,'ordinaryRuntime':{'resultSha256':'2'*64}})
        for unit,count in [(old.LEADERBOARD,5),(old.CACHE,4)]:
            value=copy.deepcopy(before);value.update({key:pair[0]for key,pair in meta.REPIN.items()if key!='PONDER_RPC_URL_8453'and(unit==old.LEADERBOARD or key!='UNIFIED_INDEXER_RELEASE_ID')})
            result=old.retarget(meta,unit,value);self.assertEqual(sum(result[k]!=v for k,v in value.items()),count)
            self.assertEqual(result['READ_DATABASE_SCHEMA'],c.READ_SCHEMA)
            self.assertEqual(result['OWNERSHIP_READ_SCHEMA'],c.READ_SCHEMA)
            with self.assertRaises(RuntimeError):old.retarget(meta,unit,{**value,'DATABASE_URL':'forbidden'})

    def test_monitor_changes_only_owned_identity_paths_and_typed_actual_timer_shape(self):
        watch=load(HERE/m.MONITOR.name);old=load(HERE/'ypal-restored-generation-capacity-watch-v1.py')
        self.assertEqual((watch.MIN_RESERVE,watch.ABORT_FREE,watch.MAX_SECONDS),(old.MIN_RESERVE,old.ABORT_FREE,old.MAX_SECONDS))
        self.assertEqual(watch.UNIT,m.UNIT);self.assertEqual(watch.WORK,m.WORK);self.assertEqual(watch.ARTIFACT,old.ARTIFACT)
        self.assertIn(str(m.CANDIDATE_BASE/'yunipals-leaderboard.selectors.env'),watch.ENV_FILES)
        self.assertIn(str(m.BASE/'generation.public.env'),watch.ENV_FILES)
        raw={'type':'t','data':0}
        def run(argv,*args,**kwargs):return b'inactive\n'if'systemctl'in argv[0]else json.dumps(raw).encode()
        with patch.object(watch,'run',side_effect=run),patch.object(watch,'Path',side_effect=lambda _:types.SimpleNamespace(iterdir=lambda:[])):
            self.assertIsNone(watch.no_overlap_window(watch.MAX_SECONDS))
            raw['data']=[0];self.assertIsNone(watch.no_overlap_window(watch.MAX_SECONDS))
            for bad in [True,-1,[],[True],{'value':0}]:
                raw['data']=bad
                with self.assertRaises(RuntimeError):watch.no_overlap_window(watch.MAX_SECONDS)
            raw.update(type='s',data=0)
            with self.assertRaises(RuntimeError):watch.no_overlap_window(watch.MAX_SECONDS)

    def test_genuine_one_shot_definition_keeps_worker_caps_and_time_disk_bounds(self):
        n=namespaces();definition=n.unit_bytes(types.SimpleNamespace(m=types.SimpleNamespace(PROJECT=Path('/installed/project'),CLEAN={'PATH':'/usr/bin'}))).decode()
        self.assertIn('RuntimeDirectory='+m.WORK.name,definition);self.assertIn('ExecStart=/usr/bin/env -i PATH=/usr/bin /usr/bin/python3 -I -B '+str(m.MONITOR),definition)
        for field in ['Restart=no','RuntimeMaxSec=1500','TimeoutStopSec=20','KillMode=control-group','NoNewPrivileges=yes','CapabilityBoundingSet=','AmbientCapabilities=']:
            self.assertIn(field+'\n',definition)
        self.assertEqual(definition.count('ExecStart='),1)


if __name__=='__main__':unittest.main()
