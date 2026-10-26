"""Genuine composed authority/caller code; private Source/SQL/SDK I/O are fixtures."""
import ast
import contextlib
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import Mock, patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name); value=importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m=load('ypal-native-readiness-direct-commit-v1.py')
gt=load('ypal-native-readiness-generation-binding-v1.test.py')

def actual_session(owner):
    """Execute the existing genuine constructor+GEN fixture up to its binding."""
    tree=ast.parse((HERE/'ypal-native-readiness-generation-binding-v1.test.py').read_bytes())
    fn=copy.deepcopy(next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='test_actual_Host_loader_and_both_owned_identity_and_full_timing_bindings'))
    prefix=[]
    for node in fn.body:
        prefix.append(node)
        if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='binding' for t in node.targets):break
    else:raise AssertionError('actual fixture binding point required')
    fn.name='build';fn.body=prefix+ast.parse('return session, family').body
    scope=dict(gt.__dict__);exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),__file__,'exec'),scope)
    owner.enterContext(patch.object(gt.m,'public',side_effect=gt.context_tests.local))
    return scope['build'](owner)

class Controls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.owner=unittest.TestCase();cls.owner.enterContext(patch.object(m,'public',side_effect=gt.context_tests.local))
        try:
            cls.session,cls.family=actual_session(cls.owner)
            cls.authority=cls.session.cache.continuation_authority
            cls.old_guards={name:getattr(cls.authority,name).__code__ for name in ['before_literal_ack','ack_deadline','check_deadline','fresh_approval']}
            cls.binding=m.bind(cls.session,held_test_waived=True)
        except BaseException:
            cls.owner.doCleanups();raise
    @classmethod
    def tearDownClass(cls):cls.owner.doCleanups()

    def test_01_actual_source_and_full_bind_identity_timing_without_held_receipt(self):
        m.authenticate();self.assertEqual(len(m.SOURCE_PINS)+1,338)
        b=self.binding;self.assertTrue(b['heldTestWaived']);self.assertFalse(b['measuredTimingUsed']);self.assertFalse(b['heldQualificationPerformed'])
        self.assertEqual(b['unmeasuredLaunchBudgetNanoseconds'],110_000_000_000)
        identity=self.authority.new_identity(self.session.cache,self.session.host)
        self.assertEqual(identity['directCommitBinding'],b)
        self.assertEqual(identity['preparedConstructorBinding'],self.session.native_readiness_prepared_binding)
        self.assertEqual(identity['generationCurrentBinding'],self.session.native_readiness_generation_binding)
        self.assertEqual(self.session.continuation_caller.timing_key(self.session,'cache-prepared-held')['directCommitBinding'],b)
        self.assertIsNone(getattr(self.session.cache,'continuation_qualification_ref',None))
        for name,code in self.old_guards.items():self.assertEqual(getattr(self.authority,name).__code__,code)

    def test_02_actual_apply_wait_then_original_budget_and_late_ACK_guards(self):
        cache,host=self.session.cache,self.session.host;events=[];a=self.authority
        def wait(*args):events.append('renewal');return {'schedulingOnly':True}
        def snapshot(actual):
            self.assertIs(actual,host);events.append('full-current-snapshot')
            return {'remainingNanoseconds':120_000_000_000,'capturedMonotonicNanoseconds':0}
        with patch.object(m,'renewal_wait',side_effect=wait),patch.object(a,'approval_snapshot',side_effect=snapshot),patch.object(a,'require_qualification',side_effect=AssertionError('no held test')),patch.object(a.time,'monotonic_ns',return_value=1_000_000_000),patch.object(a.time,'monotonic',return_value=1):
            gate=a.approval_before_launch(cache,host,'apply')
            self.assertEqual(events,['renewal','full-current-snapshot']);self.assertEqual(gate['identity']['directCommitBinding'],self.binding)
            self.assertEqual(a.before_literal_ack(cache,host,{'mode':'apply','xid':'17590356'}),1_000_000_000)
            self.assertEqual(a.ack_deadline(cache,host,'apply'),6)
            with patch.object(a.time,'monotonic_ns',return_value=115_000_000_000):
                with self.assertRaisesRegex(RuntimeError,'deadline_before_literal'):a.before_literal_ack(cache,host,{'mode':'apply','xid':'17590356'})
            with patch.object(a,'approval_snapshot',return_value={'remainingNanoseconds':115_000_000_000}):
                with self.assertRaisesRegex(RuntimeError,'budget_and_COMMIT_reserve'):a.approval_before_launch(cache,host,'apply')

    def test_03_actual_entry_one_commit_under_original_SDK_lock_no_second_prepare(self):
        s=self.session;events=[];ack=object();caller=s.continuation_caller
        @contextlib.contextmanager
        def lock():events.append('lock');yield;events.append('unlock')
        def attempt(actual,identifier,action,run):
            self.assertIs(actual,s);self.assertEqual((identifier,action),('explicit-test-attempt','commit'));events.append('attempt');return run()
        def commit(host):self.assertIs(host,s.host);events.append('commit');return ack
        sdk=types.SimpleNamespace(lock=lock);read=types.SimpleNamespace(primitives={'sdk':sdk})
        with patch.object(s.host,'read_host',read,create=True),patch.object(caller,'attempt',side_effect=attempt),patch.object(s.cache,'commit',side_effect=commit),patch.object(self.authority,'require_qualification',side_effect=AssertionError('no qualifier')):
            self.assertIs(m.execute_commit(s,'explicit-test-attempt'),ack)
        self.assertEqual(events,['attempt','lock','commit','unlock'])
        error=RuntimeError('original actual commit failure')
        with patch.object(caller,'attempt',side_effect=error):
            with self.assertRaises(RuntimeError)as caught:m.execute_commit(s,'explicit-test-attempt')
            self.assertIs(caught.exception,error)

    def test_04_exact_caller_only_held_branch_changed_and_frozen_guards_identical(self):
        original=ast.parse(gt.context_tests.local(m.OPS/m.CALLER));fn=copy.deepcopy(next(n for n in original.body if isinstance(n,ast.FunctionDef)and n.name=='execute_cache'))
        block=next(n for n in fn.body if isinstance(n,ast.If)and ast.unparse(n.test)=="action == 'commit'")
        block.body=ast.parse("value.need(held_qualification is None,'direct_commit_must_not_claim_a_held_receipt')").body
        scope={};exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(m.FILE),'exec'),scope)
        self.assertEqual(m.shape(scope['execute_cache'].__code__),m.shape(self.session.native_readiness_direct_commit_execute.__code__))
        original_approval=copy.deepcopy(next(n for n in ast.parse(gt.context_tests.local(m.OPS/m.AUTHORITY)).body if isinstance(n,ast.FunctionDef)and n.name=='approval_before_launch'))
        targets=[n for n in ast.walk(original_approval)if isinstance(n,ast.If)and len(n.orelse)==2 and 'require_qualification' in ast.unparse(n.orelse[0])]
        self.assertEqual(len(targets),1);targets[0].orelse=ast.parse('_direct_wait(cache,host)\nrequired=110_000_000_000').body
        scope={};exec(compile(ast.fix_missing_locations(ast.Module(body=[original_approval],type_ignores=[])),str(m.FILE),'exec'),scope)
        self.assertEqual(m.shape(scope['approval_before_launch'].__code__),m.shape(self.authority.approval_before_launch.__code__))

    def renewal_fixture(self,checked,*,remaining=120_000_000_000,error=None):
        policy=m.load('ypal-ordinary-cache-continuation-authority-v6.py');context=policy.Context.__new__(policy.Context)
        context.refs={'resultSha256':'1'*64};context.ack={k:'2'*64 for k in ['inputSha256','operationSha256','functionBodySha256','beforeCatalogSha256','afterCatalogSha256']}
        current={**context.ack,'validated':True,'actualPolicyBodyCurrent':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        context.inputs=Mock();context.shared_policy=Mock();context.policy=types.SimpleNamespace(current=Mock(return_value=current));clock=[0];calls=[]
        def sample(host):
            calls.append(host)
            if error:raise error
            return {'format':policy.FORMAT+'-approval','ttlNanoseconds':120_000_000_000,'officialApprovalRefreshedByThisGate':False,
                'databaseWrites':0,'serviceActions':0,'providerCalls':0,'ageNanoseconds':0,'queryNanoseconds':0,
                'capturedMonotonicNanoseconds':clock[0],'remainingNanoseconds':remaining,'snapshot':{'checkedUs':str(checked[min(len(calls)-1,len(checked)-1)])}}
        context.original_snapshot=sample
        authority=types.SimpleNamespace(FORMAT=policy.FORMAT,TTL_NS=policy.TTL_NS,COMMIT_RESERVE_NS=policy.COMMIT_RESERVE_NS,approval_snapshot=context.approval_snapshot)
        host=types.SimpleNamespace(cache=types.SimpleNamespace(continuation_authority=authority))
        self.enterContext(patch.object(m.time,'monotonic_ns',side_effect=lambda:clock[0]))
        self.enterContext(patch.object(m.time,'sleep',side_effect=lambda seconds:clock.__setitem__(0,clock[0]+int(seconds*1e9))))
        return authority,context,host,calls

    def test_05_real_complete_Context_snapshot_wait_accepts_only_actual_advancing_renewal(self):
        authority,context,host,calls=self.renewal_fixture([100,101]);rows=[]
        result=m.renewal_wait(authority,context,host,rows)
        self.assertEqual(len(calls),2);self.assertEqual(result['sampleCount'],2);self.assertTrue(result['genuineNativeWorkerRenewalObserved'])
        self.assertFalse(result['timingQualificationClaimed']);self.assertFalse(result['SQLApprovalAuthority']);self.assertEqual(result['minimumRemainingNanoseconds'],115_000_000_000)
        self.assertEqual(context.policy.current.call_count,2);self.assertEqual(len(rows),2)
        self.assertFalse(rows[0]['schedulingThresholdsSatisfied']);self.assertTrue(rows[1]['schedulingThresholdsSatisfied'])

    def test_06_real_snapshot_error_no_retry_and_nonadvancing_bounded_refusal(self):
        error=RuntimeError('real full-current refusal');a,c,h,calls=self.renewal_fixture([100],error=error);rows=[]
        with self.assertRaises(RuntimeError)as caught:m.renewal_wait(a,c,h,rows)
        self.assertIs(caught.exception,error);self.assertEqual(len(calls),1);self.assertFalse(rows[0]['queryOrPredicateRetried'])
        a,c,h,calls=self.renewal_fixture([100]);rows=[]
        with self.assertRaisesRegex(RuntimeError,'sample_limit_exhausted'):m.renewal_wait(a,c,h,rows)
        self.assertEqual(len(calls),90)

    def test_07_nonexplicit_or_duplicate_binding_and_existing_held_receipt_refuse(self):
        with self.assertRaisesRegex(RuntimeError,'explicit_user_waiver'):m.bind(self.session,held_test_waived=False)
        with self.assertRaisesRegex(RuntimeError,'one_direct_commit'):m.bind(self.session,held_test_waived=True)
        with patch.object(self.session.cache,'continuation_qualification_ref',{'captureId':'foreign'},create=True):
            with self.assertRaisesRegex(RuntimeError,'explicit_no_held_receipt'):self.authority.new_identity(self.session.cache,self.session.host)

if __name__=='__main__':unittest.main()
