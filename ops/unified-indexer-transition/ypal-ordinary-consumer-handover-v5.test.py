"""Isolated actual V5 namespaces/lifecycle and kernel mapper; no host actions."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(path):
    spec=importlib.util.spec_from_file_location(Path(path).stem.replace('-','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(HERE/'ypal-ordinary-consumer-handover-v5.py')
READ={'admissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64}
SOURCE={'resultSha256':'4'*64,'inputSha256':'5'*64}
CONFIG={'format':m.FORMAT+'-candidate-input','ordinaryRuntime':SOURCE,'readConfig':READ,'createdReceiptSha256':'6'*64}

def local(path,pin):
    raw=(HERE/Path(path).name).read_bytes();m.need(m.sha(raw)==pin,'exact_local_V5_public_source_required');return raw

def namespace():
    with patch.object(m,'public',local):return m.metadata_namespace('7'*64)


class Controls(unittest.TestCase):
    def test_default_static_and_strict_real_refs(self):
        for name in ['ypal-ordinary-consumer-handover-v5.py','ypal-ordinary-metadata-handover-v5.py']:
            result=subprocess.run(['/usr/bin/python3','-I','-B',str(HERE/name)],capture_output=True,check=True)
            value=json.loads(result.stdout);self.assertEqual(value['databaseWrites'],0);self.assertEqual(value['serviceActions'],0)
        self.assertEqual(m.candidate_input(CONFIG),CONFIG)
        with self.assertRaises(RuntimeError):m.candidate_input({**CONFIG,'createdReceiptSha256':None})
        config={'format':m.META_FORMAT+'-input','sourcesSha256':'8'*64,'ordinaryRuntime':SOURCE,'readConfig':READ,'candidateInputSha256':'9'*64,'candidateReceiptSha256':'a'*64}
        self.assertEqual(m.metadata_input(config),config)
        with self.assertRaises(RuntimeError):m.metadata_input({**config,'candidateReceiptSha256':'0'*64})

    def test_exact_new_namespace_and_retained_business_bodies(self):
        n=namespace();old=load(HERE/m.META_TEMPLATE.name)
        self.assertEqual(n.CANDIDATES,m.CANDIDATES);self.assertEqual(n.CANDIDATE_SHA,'7'*64)
        self.assertEqual(n.ADMISSION_FILE,m.READ);self.assertEqual(n.META_FILE,m.FILE)
        for name in ['drain','adopt','select','provenance','inverse','operation','reconcile','finish_original_resume','no_live_cli']:
            self.assertEqual(getattr(n,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
            self.assertIsNot(getattr(n,name).__globals__,getattr(old,name).__globals__)
        self.assertNotEqual(n.Host.terminal.__code__.co_code,old.Host.terminal.__code__.co_code)
        self.assertIn('historicalRestoreReceiptSha256',n.review.__wrapped__.__code__.co_consts)

    def test_actual_candidate_renderer_only_six_public_selectors_change(self):
        with patch.object(m,'public',local):meta=m.candidate_namespace(CONFIG)
        original=load(HERE/m.CANDIDATE_TEMPLATE.name)
        env={'OWNERSHIP_READ_MODE':'unified','BASE_METADATA_INGESTION':'native','METADATA_SOURCE_MODE':'archive','YUNIPALS_PROJECTION_MODE':'generation','DATABASE_URL':'postgresql://yunipals:synthetic@127.0.0.1:5432/yunipals_backfill','PRIVATE_FIXTURE':'unchanged'}
        env.update({k:v[0]for k,v in original.REPIN.items()})
        native=meta.retarget(env)
        self.assertEqual({k for k in native if native[k]!=env[k]},set(original.REPIN))
        self.assertEqual(native['READ_DATABASE_SCHEMA'],m.READ_SCHEMA);self.assertEqual(native['OWNERSHIP_READ_SCHEMA'],m.READ_SCHEMA)
        self.assertEqual(native['PRIVATE_FIXTURE'],env['PRIVATE_FIXTURE']);self.assertEqual(native['DATABASE_URL'],env['DATABASE_URL'])
        self.assertEqual(meta.database_identity(native)['roleOid'],'16388')
        with self.assertRaisesRegex(RuntimeError,'historical_source_constructor'):meta.load('0'*64)
        bad=copy.deepcopy(env);bad['READ_DATABASE_SCHEMA']='unreviewed';self.assertRaises(RuntimeError,meta.retarget,bad)

    def test_new_admission_authenticates_actual_delta_API_and_exact_ref3(self):
        actual=load(HERE/m.READ.name);self.assertEqual(actual.FORMAT,'yunipals-ypal-ordinary-read-admission-v5b')
        ack={'operatorSha256':m.READ_SHA,'readSchema':m.READ_SCHEMA,'readIdentity':m.READ_IDENTITY,'baselineReadEdgeCount':143,'immutableAdmissionOnly':True,'sourceActorQualified':False,'planSha256':READ['readPlanSha256'],'contextInputSha256':READ['readContextInputSha256']}
        fake=types.SimpleNamespace(acknowledgement=lambda _:copy.deepcopy(ack));h=types.SimpleNamespace(read_config=READ)
        with patch.object(m,'module',return_value=fake):
            self.assertEqual(m.authenticate_admission(h,m.admission_reference(READ)),m.admission_reference(READ))
            for field,wrong in [('operatorSha256','c'*64),('readIdentity','oldV4'),('baselineReadEdgeCount',71),('planSha256','d'*64)]:
                old=ack[field];ack[field]=wrong
                with self.assertRaises(RuntimeError):m.authenticate_admission(h,m.admission_reference(READ))
                ack[field]=old

    def test_actual_constructor_reaches_V5_initialize_and_authenticates_staged_intent_files(self):
        n=namespace()
        with patch.object(m,'public',local):candidate=m.candidate_namespace(CONFIG)
        ack={'operatorSha256':m.READ_SHA,'readSchema':m.READ_SCHEMA,'readIdentity':m.READ_IDENTITY,'baselineReadEdgeCount':143,'immutableAdmissionOnly':True,'sourceActorQualified':False,'planSha256':READ['readPlanSha256'],'contextInputSha256':READ['readContextInputSha256']}
        creator=types.SimpleNamespace(acknowledgement=lambda _:{'schemaOid':'actual-fixture-oid'})
        read=types.SimpleNamespace(acknowledgement=lambda _:ack)
        actual_module=m.module
        def modules(path,digest):
            if path==m.CREATOR:return creator
            if path==m.READ:return read
            return actual_module(path,digest)
        refresh=lambda:{'validated':True,'readAdmissionSha256':READ['admissionSha256'],'readPlanSha256':READ['readPlanSha256'],'readContextInputSha256':READ['readContextInputSha256'],'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        def protected(path):
            path=Path(path)
            return (HERE/path.name).read_bytes() if path in {m.META_TEMPLATE,m.FILE} else path.read_bytes()
        with tempfile.TemporaryDirectory()as tmp:
            base=Path(tmp);files={name:m.sha((name+' synthetic fixture').encode())for name in candidate.FILES}
            for name in files:(base/name).write_text(name+' synthetic fixture')
            intent={'format':m.FORMAT+'-candidates','operatorSha256':m.sha(m.Path(m.__file__).read_bytes()),'candidateInputSha256':'9'*64,'input':CONFIG,'readviewResultSha256':CONFIG['createdReceiptSha256'],'readConfig':READ,'readSchema':m.READ_SCHEMA,'readIdentity':m.READ_IDENTITY,'files':files,'previousReceiptSha256':candidate.PREVIOUS_SHA,'changedPrivateEnvironmentKeys':sorted(candidate.REPIN),'allOtherEnvironmentValuesPreserved':True,'newPasswordOrDatabaseUrl':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'oldWriter':{'definitions':{},'environmentFileHashes':{},'configuredEnvironmentSha256':'same'}}
            (base/'intent.json').write_bytes(m.encoded(intent));value={**intent,'staged':True,'selected':False,'adopted':False};(base/'result.json').write_bytes(m.encoded(value))
            def document(path,pin):
                raw=Path(path).read_bytes();m.need(m.sha(raw)==pin,'fixture_exact_private_journal_hash_required');return json.loads(raw)
            i=types.SimpleNamespace(document=document,DATA={'sourceRelease':'source-release'})
            p={'meta':candidate,'s':types.SimpleNamespace(protected=protected),'h':None,'m':types.SimpleNamespace(protected=protected),'installer':None,'reader':creator,'source_op':{'historical':True},'source':{'historical':True},'created':{'readSchema':m.READ_SCHEMA,'readIdentity':m.READ_IDENTITY,'target':{'schemaOid':'actual-fixture-oid'},'sourceRelease':'source-release'},'sourceAuthorityQualified':False,'candidateInput':CONFIG,'candidateInputSha256':'9'*64}
            with patch.object(m,'CANDIDATES',base),patch.object(n,'CANDIDATES',base),patch.object(n,'CANDIDATE_SHA',m.sha(m.encoded(value))),patch.object(m,'intake',return_value=i),patch.object(m,'candidate_context',return_value=CONFIG),patch.object(m,'module',side_effect=modules),patch.object(m,'public',local):
                host=n.construct_context(READ,refresh,primitives=p,admission_ref=m.admission_reference(READ))
                self.assertEqual(host.candidate,value);self.assertEqual(host.meta.READ,m.READ_SCHEMA)
                (base/candidate.FILES[0]).write_text('same path changed bytes')
                with self.assertRaisesRegex(RuntimeError,'candidate_changed'):host.refresh()
                (base/'intent.json').write_bytes(m.encoded({**intent,'readIdentity':'oldV4'}))
                with self.assertRaises(RuntimeError):n.construct_context(READ,refresh,primitives=p,admission_ref=m.admission_reference(READ))

    def test_actual_reused_adopt_frozen_cursor_and_unknown_ACK_refusal(self):
        n=namespace();calls=[];scan={'next_block':100,'ingestion_mode':'rpc'};before={'scan':scan,'approval':None}
        after={'scan':{**scan,'ingestion_mode':'native'},'approval':{'read_identity':m.READ_IDENTITY,'state':'ready'}}
        h=types.SimpleNamespace(database=lambda:before,meta=types.SimpleNamespace(RELEASE='release',IDENTITY=m.READ_IDENTITY),s=types.SimpleNamespace(document=lambda _:{'scan':scan},save=lambda *args:calls.append('saved')))
        def official(*args):calls.append(args);h.database=lambda:after;return {'adopted':True,'releaseId':'release','readIdentity':m.READ_IDENTITY,'legacyNextBlock':'100'}
        h.official=official
        with patch.object(n,'drained'),patch.object(n,'covered',return_value=True):self.assertEqual(n.adopt(h,{}),after)
        self.assertEqual(calls[0],('adopt','native-adopt'))
        h.database=lambda:{**before,'approval':{'state':'foreign'}};calls.clear()
        with patch.object(n,'drained'),patch.object(n,'covered',return_value=True),self.assertRaises(RuntimeError):n.adopt(h,{})
        self.assertFalse(calls)
        with tempfile.TemporaryDirectory()as tmp,patch.object(n,'BASE',Path(tmp)):
            (Path(tmp)/'adopt-intent.json').write_text('{}');h.refresh=lambda:None
            with patch.object(n.subprocess,'Popen',side_effect=AssertionError('no resend')),self.assertRaises(RuntimeError):n.Host.official(h,'adopt','native-adopt')

    def test_actual_sessions_use_host_address_and_validate_client_FD_epoch(self):
        n=namespace();old=load(HERE/m.META_TEMPLATE.name);path=HERE.parent/'booster-launch/ypal-old-runtime-inventory-v1.py';mapper=load(path)
        self.assertEqual(m.sha(path.read_bytes()),'7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b')
        def query(sql):return [{'pid':901,'backendStart':'start','clientAddress':'127.0.0.1'if'host(client_addr)'in sql else'127.0.0.1/32','clientPort':45678}]
        def fds(pids,uid,gid):return {str(pid):{'startTicks':456,'socketInodes':[101]if pid==123 else[202]}for pid in pids}
        observer=types.SimpleNamespace(peer_fds=fds,unix_peers=lambda _:{},run=lambda _:b'',tcp_clients=lambda raw,ipv6=False:{}if ipv6 else{101:{'clientAddress':'127.0.0.1','clientPort':45678,'transport':'tcp'}},map_owned_backends=mapper.map_owned_backends)
        h=types.SimpleNamespace(query=query,h=types.SimpleNamespace(observer=observer));actor={'processes':[{'pid':123,'startTicks':456}]}
        with self.assertRaises(ValueError):old.Host.sessions(h,actor)
        self.assertEqual(n.Host.sessions(h,actor)['owned'],[{'pid':901,'backendStart':'start','transport':'tcp'}])
        actor['processes'][0]['startTicks']=457
        with self.assertRaises(RuntimeError):n.Host.sessions(h,actor)

    def test_terminal_allows_unrelated_reconnect_but_refuses_owned_backend_or_process(self):
        n=namespace();state={'MainPID':'0','ControlPID':'0','Job':'','ActiveState':'inactive','InvocationID':'same'}
        rows=[{'pid':999,'backendStart':'legitimate-new-peer'}];calls=[]
        h=types.SimpleNamespace(m=None,query=lambda _:copy.deepcopy(rows),private=lambda _:calls.append('private'),refresh=lambda:calls.append('phase'))
        actor={'processes':[{'pid':123,'startTicks':456}]};op={'oldWriter':{}}
        sessions={'owned':[{'pid':901,'backendStart':'owned'}],'otherPeers':[]}
        with patch.object(n,'state',return_value=state),patch.object(n,'identity_alive',return_value=False):
            self.assertEqual(n.Host.terminal(h,op,actor,sessions),state);self.assertEqual(calls,['private','phase'])
            rows.append({'pid':901,'backendStart':'owned'})
            with self.assertRaisesRegex(RuntimeError,'backend_sessions'):n.Host.terminal(h,op,actor,sessions)
            rows.clear()
            with patch.object(n,'identity_alive',return_value=True),self.assertRaisesRegex(RuntimeError,'processes'):n.Host.terminal(h,op,actor,sessions)

    def test_already_terminal_uses_exact_acknowledged_invocation_and_positive_residual_proof(self):
        n=namespace();state={'MainPID':'0','ControlPID':'0','Job':'','ActiveState':'failed','InvocationID':'known'}
        actor={'unit':{'InvocationID':'known'},'processes':[{'pid':123,'startTicks':456}]};op={'oldActor':actor,'oldWriter':{},'oldBoot':{'owned':'inode'}}
        h=types.SimpleNamespace(m=None,s=types.SimpleNamespace(document=lambda _:{}),query=lambda _:[],private=lambda _:None,refresh=lambda:None)
        with tempfile.TemporaryDirectory()as tmp,patch.object(n,'BASE',Path(tmp)),patch.object(n,'BOOT',Path(tmp)/'boot'),patch.object(n,'DROP',Path(tmp)/'drop'),\
             patch.object(n,'state',return_value=state),patch.object(n,'link',return_value=op['oldBoot']),patch.object(n,'loaded',return_value=True),patch.object(n,'identity_alive',return_value=False),\
             patch.object(m,'terminal_sessions',return_value={'owned':[],'kernelPeerAttribution':True})as capture:
            self.assertEqual(n.Host.terminal(h,op,actor),state);capture.assert_called_once_with(h,actor)
            state['InvocationID']='foreign'
            with self.assertRaisesRegex(RuntimeError,'acknowledged_terminal'):n.Host.terminal(h,op,actor)
            state['InvocationID']='known'
            with patch.object(m,'terminal_sessions',side_effect=RuntimeError('orphan_backend')),self.assertRaisesRegex(RuntimeError,'orphan'):n.Host.terminal(h,op,actor)


if __name__=='__main__':unittest.main()
