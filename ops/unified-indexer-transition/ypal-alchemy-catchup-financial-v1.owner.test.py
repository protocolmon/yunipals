#!/usr/bin/env python3
"""Real private-FS/pipe and explicit unknown-ACK controls. No production DB."""
import copy
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

HERE=Path(__file__).parent


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


o=load(HERE/'ypal-alchemy-catchup-financial-v1.py','financial_owner_controls')
f=load(HERE/'ypal-alchemy-catchup-financial-v1.test.py','financial_model_fixture')
sdk=load(HERE/'ypal-managed-handover-v1.py','actual_private_FS_primitives')


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='.alchemy-financial-',dir=HERE.parents[1]);self.base=Path(self.tmp.name)/'audit'
        self.patches=[patch.object(o,'BASE',self.base),patch.object(o,'MODEL_SHA',f.m.sha((HERE/'ypal-alchemy-catchup-financial-v1.model.py').read_bytes()))]
        for p in self.patches:p.start()
        self.state,self.ranges=f.fixture();self.status='not-started';self.calls=[];self.deadline_calls=[];self.fail_after_commit=False;case=self
        def deadline(plan_sha,receipt_sha):
            o.need(o.pin(receipt_sha),'actual_deadline_required');self.deadline_calls.append((plan_sha,receipt_sha))
            return {'validated':True,'deadlinePrepared':True,'sourceActorQualified':False}
        self.h=types.SimpleNamespace(s=sdk,m=f.m,sources_sha='a'*64,range_sha='b'*64,profile=f.PROFILE,ranges=self.ranges,
            range_evidence={'sourceActorQualified':False},snapshot=lambda:copy.deepcopy(self.state),deadline=deadline,
            unchanged_sources=lambda:None,quiet=lambda *args:{'validated':True,'paidRequestsQuiet':True,'sourceActorQualified':False})
        self.h.query=lambda sql:{'status':self.status}
        self.owner=o.Owner(self.h)
        class Client:
            def __init__(self):self.work=copy.deepcopy(case.state);self.wrote=False;self.p=types.SimpleNamespace(pid=12345)
            def send(self,sql):
                case.calls.append(sql)
                if sql.startswith('INSERT'):
                    self.work=f.m.expected_admitted(case.state,case.owner.prepared()['plan']);self.wrote=True
                elif sql.startswith('UPDATE'):
                    plan=case.owner.prepared()['plan']
                    if any(row['permitId']in{p['permitId']for p in plan['permits']}and not row['enabled']for row in case.state['permits']):
                        self.work=f.m.target_utc(case.state,case.owner.close_result()['after'],plan)
                    else:self.work=f.m.target_closed(case.owner.prepared()['before'],case.state,plan,utc=case.state['clockMs']>=plan['nextUtcMs'])
                    self.wrote=True
            def observe(self,m):
                return {'snapshot':copy.deepcopy(self.work),'xid':'123','backendPid':55,'backendStart':'owned-pipe-fixture'}
            def kernel_identity(self):return {'pid':12345,'startTicks':1,'uid':111,'gid':113,'capabilitiesZero':True,'noNewPrivileges':True,'ownProcessGroup':True}
            def finish(self,commit):
                case.calls.append('COMMIT'if commit else'ROLLBACK')
                if commit:
                    path=case.base/'admission-commit-intent.json'
                    case.assertTrue(path.exists());case.assertEqual(json.loads(path.read_bytes())['xid'],'123')
                    case.state=copy.deepcopy(self.work);case.status='committed'
                    if case.fail_after_commit:raise RuntimeError('fixture_lost_COMMIT_ACK')
                else:case.status='aborted'
            def close(self):pass
        self.Client=Client
        self.patches.append(patch.object(o,'Client',Client));self.patches[-1].start()
        self.owner.prepare()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def rehearsal(self):return self.owner.transaction('admit',False)
    def commit(self):self.rehearsal();return self.owner.transaction('admit',True,deadline_sha='d'*64)
    def test_preparation_is_only_exclusive_private_inspection(self):
        self.assertEqual(os.stat(self.base).st_mode&0o777,0o700)
        self.assertEqual(os.stat(self.base/'plan.json').st_mode&0o777,0o600)
        self.assertEqual(self.owner.digest('plan.json'),self.owner.prepared()['planSha256'])
        self.assertEqual(self.calls,[])
        with self.assertRaisesRegex(RuntimeError,'fresh_one_time'):self.owner.prepare()
    def test_rehearsal_has_no_fake_deadline_requirement_or_commit(self):
        result=self.rehearsal();self.assertTrue(result['rolledBack']);self.assertEqual(self.deadline_calls,[])
        self.assertNotIn('COMMIT',self.calls);self.assertEqual(self.state,f.fixture()[0])
    def test_missing_real_deadline_refuses_before_any_SQL_attempt(self):
        self.rehearsal();before=list(self.calls)
        with self.assertRaisesRegex(RuntimeError,'actual_deadline'):self.owner.transaction('admit',True)
        self.assertEqual(self.calls,before);self.assertFalse((self.base/'admission-commit-attempt.json').exists())
    def test_real_ROOT_intent_must_precede_the_sole_COMMIT(self):
        result=self.commit();self.assertTrue(result['committed']);self.assertEqual(self.calls.count('COMMIT'),1)
        self.assertEqual(len(self.deadline_calls),2)
        intent=self.owner.intent('admission-commit-intent.json');self.assertEqual(intent['xid'],'123')
        self.assertFalse(self.owner.get('result.json')['currentPaidAuthorityQualified'])
    def test_no_repeated_commit_after_unknown_ACK_and_readonly_reconcile(self):
        self.rehearsal();self.fail_after_commit=True
        with self.assertRaisesRegex(RuntimeError,'lost_COMMIT_ACK'):self.owner.transaction('admit',True,deadline_sha='d'*64)
        self.assertFalse((self.base/'result.json').exists());self.assertEqual(self.calls.count('COMMIT'),1)
        with self.assertRaisesRegex(RuntimeError,'one_SQL_attempt'):self.owner.transaction('admit',True,deadline_sha='d'*64)
        before=list(self.calls);result=self.owner.acknowledge('admission-commit-intent.json','admit',True)
        self.assertTrue(result['committed']);self.assertEqual(self.calls,before)
    def test_aborted_XID_never_becomes_success_or_SQL_retry(self):
        self.rehearsal();self.fail_after_commit=True
        with self.assertRaises(RuntimeError):self.owner.transaction('admit',True,deadline_sha='d'*64)
        self.status='aborted';before=list(self.calls)
        with self.assertRaisesRegex(RuntimeError,'actual_committed_XID'):self.owner.acknowledge('admission-commit-intent.json','admit',True)
        self.assertEqual(self.calls,before)
    def test_expired_committed_admission_is_historical_recoverable_for_cleanup(self):
        self.rehearsal();self.fail_after_commit=True
        with self.assertRaises(RuntimeError):self.owner.transaction('admit',True,deadline_sha='d'*64)
        self.state['clockMs']=self.owner.prepared()['plan']['expiresMs']+1
        result=self.owner.acknowledge('admission-commit-intent.json','admit',True)
        self.assertTrue(result['committed']);self.assertFalse(self.owner.get('result.json')['currentPaidAuthorityQualified'])
        with self.assertRaisesRegex(RuntimeError,'nonexpired'):f.m.validate_current(self.owner.prepared()['before'],self.state,self.owner.prepared()['plan'])
    def test_source_change_after_durable_intent_rolls_back_instead_of_committing(self):
        self.rehearsal();self.h.unchanged_sources=lambda:(_ for _ in()).throw(RuntimeError('fixture_source_changed'))
        with self.assertRaisesRegex(RuntimeError,'fixture_source_changed'):self.owner.transaction('admit',True,deadline_sha='d'*64)
        self.assertTrue((self.base/'admission-commit-intent.json').exists());self.assertNotIn('COMMIT',self.calls)
    def test_immutable_ack_does_not_construct_or_query_current_source(self):
        self.commit();digest=self.owner.digest('result.json')
        with patch.object(o,'load_saved',return_value=self.owner),patch.object(self.h,'snapshot',side_effect=AssertionError('unexpected_database')):
            proof=o.acknowledgement(digest)
        self.assertFalse(proof['currentFinancialQualified']);self.assertFalse(proof['sourceActorQualified'])
    def test_current_proof_requires_actual_deadline_and_refuses_when_closing_starts(self):
        self.commit();digest=self.owner.digest('result.json')
        with patch.object(o,'load_saved',return_value=self.owner):
            proof=o.validate_current(digest);self.assertTrue(proof['currentPaidAuthorityQualified'])
            self.owner.put('close-commit-attempt.json',{'fixture':'closing'})
            with self.assertRaisesRegex(RuntimeError,'closure_started'):o.validate_current(digest)
    def test_corrupt_actual_intent_chain_cannot_be_acknowledged(self):
        self.commit();p=self.base/'admission-commit-intent.json';value=json.loads(p.read_bytes());value['modelSha256']='f'*64
        p.unlink();self.owner.put(p.name,value)
        with self.assertRaisesRegex(RuntimeError,'XID_intent_chain'):self.owner.intent(p.name)
    def rewrite(self,name,change):
        path=self.base/name;value=json.loads(path.read_bytes());change(value);path.unlink();self.owner.put(name,value)
    def test_reconcile_recomputes_exact_SQL_and_before_after_delta(self):
        self.commit()
        self.rewrite('admission-commit-intent.json',lambda row:row.update(sqlSha256='f'*64))
        with self.assertRaisesRegex(RuntimeError,'XID_intent_chain'):self.owner.intent('admission-commit-intent.json')
    def test_reconcile_refuses_foreign_effect_inside_owned_intent(self):
        self.commit()
        self.rewrite('admission-commit-intent.json',lambda row:row['after']['allocations'][0].update(dailyCu='1'))
        with self.assertRaisesRegex(RuntimeError,'before_after'):self.owner.intent('admission-commit-intent.json')
    def test_reconcile_refuses_phase_alias_and_unrecorded_deadline(self):
        self.commit()
        self.rewrite('admission-commit-intent.json',lambda row:row.update(phase='close'))
        with self.assertRaisesRegex(RuntimeError,'XID_intent_chain'):self.owner.intent('admission-commit-intent.json')
    def test_rehearsal_delta_and_recorded_child_authority_are_not_guessed(self):
        self.rehearsal();self.rewrite('admission-rehearsed.json',lambda row:row['after']['global'].update(dailyCu='1'))
        with self.assertRaisesRegex(RuntimeError,'exact_rehearsed'):self.owner.transaction('admit',True,deadline_sha='d'*64)
        self.assertNotIn('COMMIT',self.calls)
    def test_wrong_recorded_kernel_identity_refuses_historical_success(self):
        self.commit();self.rewrite('admission-commit-intent.json',lambda row:row['clientProcess'].update(uid=0))
        with self.assertRaisesRegex(RuntimeError,'XID_intent_chain'):self.owner.intent('admission-commit-intent.json')
    def test_immutable_receipt_recomputes_its_exact_plan_and_result_catalog(self):
        self.commit();self.rewrite('result.json',lambda row:row.update(permits=[]))
        with patch.object(o,'load_saved',return_value=self.owner):
            with self.assertRaisesRegex(RuntimeError,'immutable_own_financial_receipt'):o.acknowledgement(self.owner.digest('result.json'))
    def test_current_bookings_cannot_rewind_acknowledged_observation(self):
        self.commit();row=self.owner.get('result.json');plan=self.owner.prepared()['plan']
        admitted=copy.deepcopy(row['after']);owned=next(p for p in admitted['permits']if p['permitId']==plan['permits'][0]['permitId']);owned['spentCu']='10'
        self.rewrite('result.json',lambda value:value.update(after=admitted))
        with patch.object(o,'load_saved',return_value=self.owner):
            with self.assertRaisesRegex(RuntimeError,'bookings_must_not_rewind'):o.validate_current(self.owner.digest('result.json'))
    def test_close_and_UTC_are_separate_once_only_owned_transactions(self):
        self.commit();result_sha=self.owner.digest('result.json')
        with patch.object(o,'load_saved',return_value=self.owner):
            self.owner.transaction('close',True,quiet_sha='c'*64,result_sha=result_sha)
            self.assertTrue(self.owner.close_result()['committed']);self.assertEqual(self.state['global']['dailyCu'],'1000000')
            self.state['clockMs']=self.owner.prepared()['plan']['nextUtcMs']
            self.owner.transaction('utc',True,quiet_sha='c'*64,result_sha=result_sha)
            self.assertEqual(self.owner.receipt('utc-result.json','utc')['phase'],'utc')
            self.assertEqual(self.calls.count('COMMIT'),3)
            with self.assertRaisesRegex(RuntimeError,'one_SQL_attempt'):self.owner.transaction('close',True,quiet_sha='c'*64,result_sha=result_sha)


class PipeControls(unittest.TestCase):
    def test_default_import_constructs_no_runtime_and_prints_no_credentials(self):
        path=HERE/'ypal-alchemy-catchup-financial-v1.py';result=subprocess.run([sys.executable,'-I','-B',str(path)],capture_output=True,check=True)
        self.assertTrue(json.loads(result.stdout)['sourceOnly']);self.assertEqual(result.stderr,b'')
    def test_actual_persistent_pipe_packet_and_single_finish(self):
        code='import json,sys\nfor line in sys.stdin:\n if "COMMIT"in line:print(json.dumps({"finished":True}),flush=True)\n else:print(json.dumps({"packet":"x"*100000}),flush=True)'
        with patch.object(o,'args',return_value=[sys.executable,'-I','-B','-u','-c',code]):
            client=o.Client()
            try:client.send('SELECT fixture;\n');self.assertEqual(len(client.packet()['packet']),100000);client.finish(True)
            finally:client.close()
    def test_owned_pipe_timeout_kills_only_its_owned_process_group(self):
        with patch.object(o,'args',return_value=[sys.executable,'-I','-B','-u','-c','import time;time.sleep(10)']):
            client=o.Client();client.deadline=o.time.monotonic()+0.02
            try:
                with self.assertRaisesRegex(RuntimeError,'timeout_unknown'):client.packet()
            finally:client.close()
            self.assertIsNotNone(client.p.poll())


if __name__=='__main__':unittest.main()
