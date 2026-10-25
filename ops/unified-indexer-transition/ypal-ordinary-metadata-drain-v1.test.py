"""Actual frozen session/drain bodies with synthetic kernel and real private FS."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(path):
    spec=importlib.util.spec_from_file_location(Path(path).stem.replace('-','_'),path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load(HERE/'ypal-ordinary-metadata-drain-v1.py')
c=load(HERE/'ypal-ordinary-consumer-handover-v5.py')
TEMPLATE=(HERE/m.TEMPLATE.name).read_bytes()

def local(path,pin):
    raw=(HERE/Path(path).name).read_bytes();m.need(m.sha(raw)==pin,'exact_fixture_component_required');return raw

def namespace():
    with patch.object(c,'public',local):return c.metadata_namespace(m.CANDIDATE_SHA)

def phase():
    return {'validated':True,'readAdmissionSha256':'a'*64,'readPlanSha256':'b'*64,'readContextInputSha256':'c'*64,
      'catalogSha256':'d'*64,'sourceBinding':{'sourceInvocation':'fixed-source','privateHashes':['same']},
      'inverseOnly':False,'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def binding():
    n=namespace();actor={'unit':{'Restart':'on-failure','UnitFileState':'enabled','WantedBy':'multi-user.target',
      'RequiredBy':'','TriggeredBy':'','Triggers':'','PartOf':'','UpheldBy':'','InvocationID':'writer'},
      'processes':[{'pid':123,'startTicks':456}],'main':{'pid':123,'startTicks':456},'commandSha256':'cmd'}
    refs={'admissionSha256':'a'*64,'readPlanSha256':'b'*64,'readContextInputSha256':'c'*64}
    return {'format':n.FORMAT,'operatorSha256':m.OWNER_SHA,'candidateSha256':m.CANDIDATE_SHA,
      'executionContext':{'inputSha256':m.INPUT_SHA,'sourcesSha256':'e'*64},'bootId':'boot',
      'readConfig':refs,'admissionRef':{'producerSha256':'f'*64},'admissionSha256':'a'*64,'admissionOperatorSha256':'f'*64,
      'historicalMetadataProducerSha256':n.TEMPLATE_SHA,'historicalRestoreReceiptSha256':'historic',
      'oldWriter':{'definitions':{'unit':'unchanged'},'environmentFileHashes':{'private':'unchanged'},'configuredEnvironmentSha256':'same'},
      'oldActor':actor,'oldUnit':actor['unit'],'oldBoot':{'inode':99,'target':'unit'},
      'oldSessions':{'owned':[{'pid':901,'backendStart':'one','transport':'tcp'}],'otherPeers':[{'pid':902,'backendStart':'two'}]},
      'candidateDropSha256':'0'*64}

def review(value=None):
    value=binding()if value is None else value;a=m.authority(value,phase(),m.INPUT_SHA)
    return {'format':m.FORMAT,'authority':a,'reviewHash':m.sha(m.encoded(a)),'originalFullBinding':value,
      'databaseObservation':{'cursor':10},'readonlySessionCaptures':[],'originalFullReviewHash':m.sha(m.encoded(value)),'eligibleCoverage':True}


class Sessions:
    """Execute genuine current Host.sessions and genuine socket mapper."""
    def __init__(self):
        self.n=namespace();self.actor={'processes':[{'pid':123,'startTicks':456}]}
        self.rows=[{'pid':901,'backendStart':'one','clientAddress':'127.0.0.1','clientPort':45678},
          {'pid':902,'backendStart':'other','clientAddress':'127.0.0.1','clientPort':49999}]
        self.next_rows=[{**self.rows[0],'pid':911,'backendStart':'later'},self.rows[1]]
        self.query_count=0;self.peer_count=0;self.change=None;self.failure=None;self.failed=False
        self.private={'definitions':'fixed'};self.current_phase=phase();self.captures=[]
        mapper=load(HERE.parent/'booster-launch/ypal-old-runtime-inventory-v1.py')
        observer=types.SimpleNamespace(peer_fds=self.fds,unix_peers=lambda _: {},run=lambda _:b'',
          tcp_clients=lambda raw,ipv6=False:{}if ipv6 else{101:{'clientAddress':'127.0.0.1','clientPort':45678,'transport':'tcp'}},
          map_owned_backends=mapper.map_owned_backends)
        self.h=types.SimpleNamespace(query=self.query,h=types.SimpleNamespace(observer=observer),refresh=lambda:copy.deepcopy(self.current_phase),
          m=types.SimpleNamespace(snapshot=lambda _:(copy.deepcopy(self.private),{})),actor=lambda:copy.deepcopy(self.actor))
    def query(self,sql):
        assert sql==m.SESSION_SQL;self.query_count+=1
        if self.change=='between'and self.query_count==2:self.rows=copy.deepcopy(self.next_rows)
        return copy.deepcopy(self.rows)
    def fds(self,pids,uid,gid):
        self.peer_count+=1
        if self.failure and ((uid,gid)==((0,0)if self.failure=='client'else(111,113)))and (not self.failed or self.failure=='always'):
            self.failed=True
            if self.failure in {'churn','always','phase','actor'}:
                self.rows=[{**r,'backendStart':r['backendStart']+'x'}for r in self.rows]
            if self.failure=='phase':self.current_phase['catalogSha256']='changed'
            if self.failure=='actor':self.actor['processes'][0]['startTicks']+=1
            raise RuntimeError(m.PEER_FAILURE)
        return {str(pid):{'startTicks':456,'socketInodes':[101]if pid==123 else[202]}for pid in pids}
    def capture(self):return m.session_capture(self.h,copy.deepcopy(self.actor),self.n.Host.sessions,self.captures,self.n.UNIT)


class Controls(unittest.TestCase):
    def test_exact_frozen_sources_and_static_default(self):
        for name,digest in [(m.OWNER,m.OWNER_SHA),(m.COMMON,m.COMMON_SHA),(m.TEMPLATE,m.TEMPLATE_SHA)]:self.assertEqual(m.sha((HERE/name.name).read_bytes()),digest)
        out=subprocess.run(['/usr/bin/python3','-I','-B',m.__file__],capture_output=True,check=True)
        value=json.loads(out.stdout);self.assertTrue(value['staticOnly']);self.assertEqual(value['serviceActions'],0);self.assertEqual(value['databaseWrites'],0)

    def test_only_session_inventory_changes_stable_digest(self):
        first=review();second=copy.deepcopy(first['originalFullBinding'])
        second['oldSessions']={'owned':[{'pid':911,'backendStart':'new'}],'otherPeers':[{'pid':922,'backendStart':'new-other'}]}
        after=review(second);self.assertEqual(first['reviewHash'],after['reviewHash']);self.assertNotEqual(first['originalFullReviewHash'],after['originalFullReviewHash'])
        self.assertEqual(after['originalFullBinding']['oldSessions'],second['oldSessions'])
        for field in ['oldWriter','oldActor','oldUnit','oldBoot','candidateDropSha256','bootId','historicalRestoreReceiptSha256']:
            changed=copy.deepcopy(second);changed[field]={'changed':True}
            self.assertNotEqual(review(changed)['reviewHash'],first['reviewHash'],field)
        for field in ['catalogSha256','sourceBinding']:
            current=phase();current[field]={'changed':True}
            self.assertNotEqual(m.authority(second,current,m.INPUT_SHA),first['authority'])

    def test_actual_domain_candidate_input_and_READ_mismatch_refused(self):
        for field in ['operatorSha256','candidateSha256']:
            value=binding();value[field]='1'*64;self.assertRaises(RuntimeError,m.authority,value,phase(),m.INPUT_SHA)
        for field in ['readAdmissionSha256','readPlanSha256','readContextInputSha256','inverseOnly','originalWholeValidatorPassed']:
            current=phase();current[field]=not current[field]if isinstance(current[field],bool)else'wrong'
            self.assertRaises(RuntimeError,m.authority,binding(),current,m.INPUT_SHA)

    def test_real_current_body_and_mapper_capture_idle_or_positive_without_relabel(self):
        s=Sessions();value=s.capture();self.assertEqual(value['owned'],[{'pid':901,'backendStart':'one','transport':'tcp'}]);self.assertEqual(len(value['otherPeers']),1)
        self.assertEqual(len(s.captures),1);self.assertEqual(s.captures[0]['sessions'],value)
        self.assertTrue(s.captures[0]['qualified']);self.assertFalse(s.captures[0]['effectsRetried'])
        s=Sessions();s.rows=[];self.assertEqual(s.capture(),{'owned':[],'otherPeers':[]})

    def test_failed_backend_peer_is_retried_only_when_actual_rows_change(self):
        s=Sessions();s.failure='churn';value=s.capture()
        self.assertEqual(len(s.captures),2);self.assertFalse(s.captures[0]['qualified']);self.assertTrue(s.captures[1]['qualified'])
        self.assertEqual(value['owned'][0]['backendStart'],'onex')
        s=Sessions();s.failure='permission'
        with self.assertRaisesRegex(RuntimeError,'without_proved_backend_churn'):s.capture()
        self.assertEqual(s.peer_count,1)

    def test_changed_readonly_sql_bookends_retry_actual_body(self):
        s=Sessions();s.change='between';result=s.capture()
        self.assertEqual(len(s.captures),2);self.assertEqual(s.captures[0]['fixedCode'],m.SESSION_CHURN)
        self.assertEqual(result['owned'][0]['pid'],911)

    def test_client_failure_never_retried_as_backend_churn(self):
        s=Sessions();s.failure='client'
        with self.assertRaisesRegex(RuntimeError,m.PEER_FAILURE):s.capture()
        self.assertEqual(s.query_count,1);self.assertFalse(s.captures)

    def test_churn_refuses_actor_private_or_source_change(self):
        for kind in ['actor','phase']:
            s=Sessions();s.failure=kind
            with self.assertRaisesRegex(RuntimeError,'changed_during_readonly_churn'):s.capture()
            self.assertEqual(s.query_count,2)
        s=Sessions();body=s.n.Host.sessions
        def bad(h,a):
            result=body(h,a);s.private['definitions']='changed';return result
        with self.assertRaisesRegex(RuntimeError,'changed_during_session_capture'):
            m.session_capture(s.h,s.actor,bad,s.captures,s.n.UNIT)

    def test_bounded_three_observations_and_no_effect_retry(self):
        s=Sessions();s.failure='always'
        with self.assertRaisesRegex(RuntimeError,'churn_exhausted'):s.capture()
        self.assertEqual(len(s.captures),3);self.assertTrue(all(v['effectsRetried']is False for v in s.captures))
        with patch.object(m.time,'monotonic',side_effect=[0,91]),self.assertRaisesRegex(RuntimeError,'expired'):Sessions().capture()

    def test_slow_success_cannot_escape_session_deadline(self):
        s=Sessions()
        with patch.object(m.time,'monotonic',side_effect=[0,1,91]),self.assertRaisesRegex(RuntimeError,'expired'):s.capture()
        self.assertFalse(s.captures)

    def test_session_installer_keeps_frozen_class_body(self):
        s=Sessions();original=s.n.Host.sessions;s.h.sessions=types.MethodType(original,s.h)
        rows=[];m.install_session_observer(s.n,s.h,rows);s.h.sessions(s.actor)
        self.assertIs(s.n.Host.sessions,original);self.assertEqual(len(rows),1)
        s.h.sessions=types.MethodType(lambda *_:None,s.h)
        self.assertRaises(RuntimeError,m.install_session_observer,s.n,s.h,[])

    def test_real_review_full_binding_retained_and_candidate_baseline_still_checked(self):
        n=namespace();b=binding();h=types.SimpleNamespace(execution_context=b['executionContext'],refresh=phase,
          m=types.SimpleNamespace(snapshot=lambda _:(b['oldWriter'],{})),actor=lambda:b['oldActor'],database=lambda:{'scan':{'ingestion_mode':'rpc'},'approval':None},
          s=types.SimpleNamespace(protected=lambda _: (HERE/m.OWNER.name).read_bytes(),boot=lambda:'boot'),admission_pin=b['admissionSha256'],
          admission_ref=b['admissionRef'],read_config=b['readConfig'],candidate={'files':{'yunipals-metadata.service.drop-in.candidate':b['candidateDropSha256']},'oldWriter':copy.deepcopy(b['oldWriter'])},
          sessions=lambda _:b['oldSessions'])
        with tempfile.TemporaryDirectory()as tmp,patch.object(n,'BASE',Path(tmp)/'original'),patch.object(n,'DROP',Path(tmp)/'drop'),\
          patch.object(n,'execution_context',side_effect=lambda _,v:v),patch.object(n,'link',return_value={'target':'/etc/systemd/system/'+n.UNIT}),patch.object(n,'covered',return_value=True):
            value=m.capture(n,h,m.INPUT_SHA,[]);self.assertEqual(value['originalFullBinding']['oldSessions'],b['oldSessions'])
            self.assertEqual(value['authority']['operationAuthority']['oldWriter'],b['oldWriter'])
            h.candidate['oldWriter']['definitions']={'foreign':'value'}
            with self.assertRaisesRegex(RuntimeError,'staged_candidate_baseline'):m.capture(n,h,m.INPUT_SHA,[])

    def test_drain_AST_exact_except_one_first_effect_fence(self):
        n=namespace();original=next(x for x in ast.parse(TEMPLATE).body if isinstance(x,ast.FunctionDef)and x.name=='drain')
        captured=[];compile_builtin=compile
        def capture_ast(tree,*args,**kwargs):
            captured.append(copy.deepcopy(tree));return compile_builtin(tree,*args,**kwargs)
        with patch('builtins.compile',side_effect=capture_ast):m.drain_body(n,TEMPLATE)
        tree=next(x for x in captured if isinstance(x,ast.Module));actual=tree.body[0]
        fences=[i for i,x in enumerate(actual.body)if isinstance(x,ast.Expr)and isinstance(x.value,ast.Call)and ast.unparse(x.value.func)=='initial_action_fence']
        self.assertEqual(len(fences),1);i=fences[0];self.assertEqual(ast.unparse(actual.body[i+1].value.func),'BASE.mkdir')
        del actual.body[i];self.assertEqual(ast.dump(actual,include_attributes=False),ast.dump(original,include_attributes=False))

    def test_fence_refuses_actual_actor_boot_private_and_source_drift(self):
        n=namespace();b=binding();h=types.SimpleNamespace(refresh=phase,private=lambda _:None,m=types.SimpleNamespace(snapshot=lambda _:(b['oldWriter'],{})),actor=lambda:b['oldActor'])
        with tempfile.TemporaryDirectory()as tmp,patch.object(n,'BASE',Path(tmp)/'original'),patch.object(n,'DROP',Path(tmp)/'drop'),patch.object(n,'link',return_value=b['oldBoot']):
            expected=m.authority(b,phase(),m.INPUT_SHA);m.fence(n,h,b,expected)
            h.refresh=lambda:{**phase(),'catalogSha256':'different'}
            with self.assertRaisesRegex(RuntimeError,'source_or_READ_changed'):m.fence(n,h,b,expected)
            h.refresh=phase;h.actor=lambda:{'foreign':'actor'}
            with self.assertRaisesRegex(RuntimeError,'action_identity'):m.fence(n,h,b,expected)

    def test_intent_self_consistency_not_just_supplied_hash(self):
        intent={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':m.INPUT_SHA,'automaticRetryAllowed':False,'review':review()}
        self.assertEqual(m.intent_current(intent),intent)
        changed=copy.deepcopy(intent);changed['review']['originalFullBinding']['oldActor']={'different':True}
        changed['review']['originalFullReviewHash']=m.sha(m.encoded(changed['review']['originalFullBinding']))
        self.assertRaises(RuntimeError,m.intent_current,changed)

    def test_private_record_exclusive_no_follow_and_hash_fence(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp,patch.object(m,'BASE',Path(tmp)/'executor'):
            m.directory();pin=m.save('review.json',{'safe':'value'});self.assertEqual(m.record('review.json',pin),{'safe':'value'})
            self.assertEqual(m.BASE.stat().st_mode&0o777,0o700);self.assertEqual((m.BASE/'review.json').stat().st_mode&0o777,0o600)
            self.assertRaises(FileExistsError,m.save,'review.json',{})
            self.assertRaises(RuntimeError,m.record,'review.json','0'*64)
            os.symlink(m.BASE/'review.json',m.BASE/'alias.json');self.assertRaises(OSError,m.record,'alias.json')
            os.chmod(m.BASE/'review.json',0o644);self.assertRaises(RuntimeError,m.record,'review.json')

    def test_actual_drain_and_lost_ACK_reconcile_keep_original_operation(self):
        self.real_drain()

    def test_manager_unknown_ACK_is_not_retried_or_adopted(self):
        self.real_drain(fail_stop=True)

    def test_pre_effect_fence_refuses_before_original_operation_or_boot_effects(self):
        self.real_drain(fail_fence=True)

    def real_drain(self,fail_stop=False,fail_fence=False):
        n=namespace();b=binding();calls=[];stopped=False;private_calls=[];sessions=[]
        with tempfile.TemporaryDirectory(dir=HERE)as tmp,patch.object(m,'BASE',Path(tmp)/'executor'),\
          patch.object(n,'BASE',Path(tmp)/'original'),patch.object(n,'BOOT',Path(tmp)/'boot'),patch.object(n,'DROP',Path(tmp)/'drop'),\
          patch.object(n,'execution_context',side_effect=lambda _,v:v),patch.object(n,'covered',return_value=True):
            os.symlink('/etc/systemd/system/'+n.UNIT,n.BOOT);b['oldBoot']=n.link(n.BOOT)
            def save(path,value):
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'wb')as out:out.write(m.encoded(value));out.flush();os.fsync(out.fileno())
                return m.sha(m.encoded(value))
            def document(path,pin=None):
                raw=Path(path).read_bytes();m.need(pin is None or m.sha(raw)==pin,'fixture_exact_record');return json.loads(raw)
            def actor():return b['oldActor']if os.path.lexists(n.BOOT)else n.boot_disabled_actor(b['oldActor'])
            def terminal(op,old,fresh):
                self.assertTrue(stopped);self.assertEqual(fresh,sessions[-1]);self.assertEqual(old,b['oldActor'])
            def capture_sessions(old):
                self.assertEqual(old,n.boot_disabled_actor(b['oldActor']));value={'owned':[{'pid':919,'backendStart':'fresh-stop'}],'otherPeers':[]};sessions.append(value);return value
            def manager(_,action):
                nonlocal stopped
                calls.append(action)
                if action=='stop':
                    stopped=True
                    if fail_stop:raise RuntimeError('metadata_manager_ack_unknown_do_not_repeat')
            h=types.SimpleNamespace(refresh=phase,m=types.SimpleNamespace(snapshot=lambda _:(b['oldWriter'],{})),actor=actor,
              private=lambda _:private_calls.append(True),sessions=capture_sessions,database=lambda:{'scan':{'ingestion_mode':'rpc','next_block':100},'approval':None,'frame':{}},terminal=terminal,
              s=types.SimpleNamespace(sync=m.sync,save=save,document=document,boot=lambda:'boot',protected=lambda p:(HERE/m.OWNER.name).read_bytes()if Path(p).name==m.OWNER.name else Path(p).read_bytes()),
              admission_pin=b['admissionSha256'],read_config=b['readConfig'],admission_ref=b['admissionRef'])
            value=review(b)
            with patch.object(n,'manager',side_effect=manager):
                if fail_fence:h.actor=lambda:{'foreign':True}
                if fail_stop or fail_fence:
                    self.assertRaises(RuntimeError,m.execute,n,h,value,value['reviewHash'],[],TEMPLATE)
                    self.assertTrue((m.BASE/'apply-intent.json').exists());self.assertTrue((m.BASE/'failed.json').exists());self.assertFalse((m.BASE/'result.json').exists())
                    if fail_fence:self.assertFalse(n.BASE.exists());self.assertTrue(n.BOOT.is_symlink());self.assertEqual(calls,[])
                    else:self.assertEqual(calls,['daemon-reload','stop']);self.assertTrue((n.BASE/'drain-session-proof.json').exists())
                    with self.assertRaisesRegex(RuntimeError,'one_drain_executor_attempt'):m.execute(n,h,value,value['reviewHash'],[],TEMPLATE)
                    self.assertLessEqual(calls.count('stop'),1);return
                result=m.execute(n,h,value,value['reviewHash'],[],TEMPLATE)
            self.assertEqual(calls,['daemon-reload','stop']);self.assertFalse(result['adopted']);self.assertFalse(result['selected'])
            self.assertEqual(document(n.BASE/'operation.json'),b);self.assertEqual(document(n.BASE/'drain-session-proof.json')['sessions'],sessions[-1])
            self.assertNotEqual(sessions[-1],b['oldSessions']);self.assertEqual(result['originalOwnerSha256'],m.OWNER_SHA)
            # SIGKILL/lost stdout after original completion: own durable intent is
            # sufficient; no failure marker or manager dispatch is required.
            (m.BASE/'result.json').unlink();intent=m.intent_current(m.record('apply-intent.json'))
            with patch.object(n,'manager',side_effect=AssertionError('no manager during reconciliation')):
                reconciled=m.completed(n,h,intent)
            self.assertEqual(reconciled,result);m.save('result.json',reconciled)
            self.assertEqual(m.record('result.json'),result)
            save(n.BASE/'adopt-intent.json',{})
            with self.assertRaisesRegex(RuntimeError,'only_initial_completed_drain'):m.completed(n,h,intent)


if __name__=='__main__':unittest.main()
