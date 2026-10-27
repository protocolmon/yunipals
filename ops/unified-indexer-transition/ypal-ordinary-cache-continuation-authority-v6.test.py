"""Actual C5/C413 bodies; native-policy/current/private I/O are explicit fixtures."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=load('ypal-ordinary-cache-continuation-authority-v6.py')
family=load('ypal-ordinary-publication-continue-v5.test.py')
old=load('ypal-ordinary-cache-continuation-authority-v1.py')


def approval(**changes):
    return {'atUs':'100000000','checkedUs':'95000000','release':old.RELEASE,'identity':old.READ_IDENTITY,'state':'ready',
        'implementation':old.APPROVED_IMPLEMENTATION,'errorCode':None,'frontier':'same-explicit-frontier','frameFrontier':'same-explicit-frontier',
        'checkedBlock':'60000000','checkedHash':'0x'+'b'*64,'frameBlock':'60000001','frameHash':'0x'+'c'*64,
        'probe':True,'nativeMode':True,'canonical':True,**changes}


class Controls(unittest.TestCase):
    def setUp(self):
        self.case=family.Controls();self.case.setUp();self.addCleanup(self.case.doCleanups)
        self.refs={'producerSha256':'a'*64,'manifestSha256':'b'*64,'resultSha256':'c'*64}
        self.config={'format':m.FORMAT+'-input','nativePolicyRefs':self.refs};self.input_raw=m.encoded(self.config);self.input_sha=m.sha(self.input_raw)
        self.ack={'operatorSha256':self.refs['producerSha256'],'receiptSha256':self.refs['resultSha256'],
            'inputSha256':'1'*64,'operationSha256':'2'*64,'policyTTLSeconds':120,'readSchema':old.READ_SCHEMA,'readIdentity':old.READ_IDENTITY,
            'approvedImplementation':old.APPROVED_IMPLEMENTATION,'functionBodySha256':'d'*64,'beforeCatalogSha256':'e'*64,'afterCatalogSha256':'f'*64,
            'immutableAcknowledgementOnly':True,'originalCreatorWholeValidatorPassed':False}
        self.policy=types.SimpleNamespace(acknowledgement=Mock(side_effect=lambda *_:copy.deepcopy(self.ack)),
            current=Mock(side_effect=lambda *_:copy.deepcopy(self.ack)|{'immutableAcknowledgementOnly':False,'validated':True,
                'actualPolicyBodyCurrent':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
        self.wrapper=family.source(m.FORWARD);self.wrapper.public=family.public;self.wrapper.factory=lambda:family.compiler
        self.enterContext(patch.object(family.bootstrap.h,'public',side_effect=family.public))
        def module(name):
            self.assertEqual(name,m.FORWARD);family.public(m.OPS/name,m.SOURCE_PINS[name]);return self.wrapper
        def public(path,digest=None):
            if Path(path)==m.INPUT:
                self.assertEqual(digest,self.input_sha);return self.input_raw
            return family.public(path,digest)
        self.enterContext(patch.object(m,'module',side_effect=module));self.enterContext(patch.object(m,'public',side_effect=public))
        self.enterContext(patch.object(m,'policy_module',return_value=self.policy))
        self.context=m.Context(self.input_sha);self.value=self.context.value
        # The compiled complete C413 body uses this protected-reader I/O seam.
        self.value.public=family.public
        self.host=types.SimpleNamespace(query=Mock(return_value=approval()),inverse_mode=False)

    def test_actual_fresh_C5_namespace_all_original_checks_and_only_explicit120_scope(self):
        v=self.value
        self.assertEqual(v.TTL_NS,120_000_000_000);self.assertEqual(v.COMMIT_RESERVE_NS,5_000_000_000)
        self.assertEqual(old.TTL_NS,90_000_000_000);self.assertNotEqual(v.BASE,old.BASE)
        self.assertEqual(v.FORMAT,m.FORMAT);self.assertEqual(v.FILE,m.FILE)
        prior=self.wrapper.composition()
        self.assertIs(prior,v) # The wrapper is private to this fixture Context.
        self.assertIs(v.require_qualification.__globals__['approval_snapshot'],v.approval_snapshot)
        self.assertIs(v._qualify_held.__globals__['TTL_NS'],v.TTL_NS)
        for name in ['fresh_approval','check_deadline','approval_before_launch','before_literal_ack','ack_deadline','prepared_callback',
                'require_qualification','_qualify_held','qualify_held','stopped','prior_aborted','prior_child_terminal','original_catalog']:
            self.assertEqual(getattr(v,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
        raw=self.context.original_snapshot.__code__
        self.assertEqual(raw.co_code,old.approval_snapshot.__code__.co_code)
        self.assertEqual(raw.co_consts,tuple('actual_official_approval_must_be_current_inside_explicit_120_second_TTL'
            if value=='actual_official_approval_must_be_current_inside_unchanged_ninety_second_TTL'else value for value in old.approval_snapshot.__code__.co_consts))
        v.authenticate()

    def test_120_gate_accepts_age95_only_with_actual_native120_policy_and_query_time_subtraction(self):
        self.host.query.return_value=approval(atUs='150000000',checkedUs='55000000')
        with patch.object(self.value.time,'monotonic_ns',side_effect=[100,200]):gate=self.value.approval_snapshot(self.host)
        self.assertEqual(gate['ttlNanoseconds'],120_000_000_000)
        self.assertEqual(gate['remainingNanoseconds'],25_000_000_000-100)
        self.assertFalse(gate['officialApprovalRefreshedByThisGate']);self.assertFalse(gate['old90SecondQualificationClaimed'])
        self.assertEqual(gate['nativeReadinessPolicyRefs'],self.refs)
        self.policy.current.assert_called_once_with(self.refs['resultSha256'],self.host)
        self.host.query.assert_called_once_with(old.APPROVAL_SQL)
        with patch.object(old.time,'monotonic_ns',side_effect=[100,200]),self.assertRaises(RuntimeError):old.approval_snapshot(self.host)

    def test_native90_or_wrong_body_or_dataset_or_implementation_refuses_before_approval_query(self):
        good=self.policy.current(self.refs['resultSha256'],self.host);self.policy.current.reset_mock()
        for changes in [{'policyTTLSeconds':90},{'policyTTLSeconds':True},{'functionBodySha256':'9'*64},
                {'actualPolicyBodyCurrent':False},{'readIdentity':'0x'+'9'*64},{'readSchema':'wrong'},
                {'approvedImplementation':'0x'+'9'*40},{'originalCreatorWholeValidatorPassed':True}]:
            self.host.query.reset_mock()
            with self.subTest(changes=changes),patch.object(self.policy,'current',return_value=good|changes),self.assertRaises(RuntimeError):self.value.approval_snapshot(self.host)
            self.host.query.assert_not_called()

    def test_original_state_frontier_canonical_block_probe_and_exact120_expiry_checks_remain(self):
        for changes in [{'atUs':'220000000','checkedUs':'100000000'},{'atUs':'215000000','checkedUs':'100000000'},
                {'checkedUs':'100000001'},{'state':'blocked'},{'probe':False},{'canonical':False},{'nativeMode':False},
                {'frontier':'other'},{'checkedBlock':'60000002'},{'implementation':'0x'+'f'*40},{'errorCode':'pending'}]:
            self.host.query.return_value=approval(**changes)
            with self.subTest(changes=changes),patch.object(self.value.time,'monotonic_ns',side_effect=[100,200]),self.assertRaises(RuntimeError):self.value.approval_snapshot(self.host)

    def test_whole_callback_budget_plus_five_still_fits_remaining120_not_just_nominal120(self):
        self.host.query.return_value=approval()
        with patch.object(self.value.time,'monotonic_ns',side_effect=[100,200]):gate=self.value.fresh_approval(self.host,96_000_000_000)
        self.assertEqual(gate['ttlNanoseconds'],120_000_000_000)
        with patch.object(self.value.time,'monotonic_ns',side_effect=[100,200]),self.assertRaises(RuntimeError):self.value.fresh_approval(self.host,110_000_000_000)
        with patch.object(self.value.time,'monotonic_ns',return_value=gate['capturedMonotonicNanoseconds']+110_000_000_000),self.assertRaises(RuntimeError):self.value.check_deadline(gate)
        with patch.object(self.value.time,'monotonic_ns',side_effect=[100,5_000_000_100]):other=self.value.approval_snapshot(self.host)
        self.assertEqual(other['remainingNanoseconds'],110_000_000_000)

    def test_raw_literal_ACK_tail_stays_at_most_five_seconds(self):
        identity={'actualNew120Identity':True};gate={'mode':'apply','identity':identity,'capturedMonotonicNanoseconds':100_000_000_000,'remainingNanoseconds':20_000_000_000}
        cache=types.SimpleNamespace(_continuation_approval_gate=gate)
        with patch.object(self.value,'new_identity',return_value=identity),patch.object(self.value.time,'monotonic_ns',return_value=100_000_000_100),patch.object(self.value.time,'monotonic',return_value=100.1):
            self.assertEqual(self.value.ack_deadline(cache,self.host,'apply'),105.1)
        with patch.object(self.value,'new_identity',return_value=identity),patch.object(self.value.time,'monotonic_ns',return_value=115_000_000_000),self.assertRaises(RuntimeError):self.value.ack_deadline(cache,self.host,'apply')

    def test_real_six_record_receipt_accepts96_seconds_rejects_old90_format_gate_and_corruption(self):
        v=self.value;identity={'actualNew120Context':'fixture'};owner={'nativePolicyRefs':self.refs}
        gate={'remainingNanoseconds':115_000_000_000,'identity':owner,'mode':'apply','ttlNanoseconds':v.TTL_NS,'officialApprovalRefreshedByThisGate':False}
        cache=types.SimpleNamespace(js_encoded=lambda x:json.dumps(x,separators=(',',':')).encode());packet={'mode':'apply','xid':'12345','fullPreparedIOFixture':True}
        docs={'intent.json':{'format':v.FORMAT,'identity':identity,'rollbackOnly':True,'automaticRetryAllowed':False},
            'approval-before-launch.json':gate,'apply-sql-child.json':{'actualFixtureActor':True},
            'actual-prepared-observation.json':{'neverProductionPreparedACK':True,'value':packet,'valueJson':cache.js_encoded(packet).decode()},
            'complete-held-callback.json':{'packetSha256':v.sha(cache.js_encoded(packet)),'elapsedNanoseconds':96_000_000_000,'productionPreparedACKCreated':False}}
        docs['apply-sql-opened.json']={'message':{'mode':'apply','xid':'12345'},'childFileSha256':v.sha(v.encoded(docs['apply-sql-child.json']))}
        result={'format':v.FORMAT,'completed':True,'rollbackOnly':True,'completeHeldCallback':True,'identity':identity,
            'productionCOMMITQualified':False,'productionPreparedACKCreated':False,'priorTimingReceiptUsed':False,'transactionStatus':'aborted',
            'childGone':True,'backendGone':True,'catalogRestored':True,'transactionalCatalogMutationsRolledBack':True,
            'elapsedNanoseconds':96_000_000_001,'reserveNanoseconds':5_000_000_000,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
            'approvalGate':gate,'transactionId':'12345','actualPreparedPacketSha256':v.sha(cache.js_encoded(packet))}
        def seal():
            result['auditFiles']={name:v.sha(v.encoded(row))for name,row in docs.items()if name!='result.json'}
            docs['result.json']=result;return {'captureId':'actual120-fixture','sha256':v.sha(v.encoded(result))}
        def public(path,digest=None,maximum=6000000):
            self.assertIn(str(v.BASE),str(path));raw=v.encoded(docs[Path(path).name])
            if digest is not None and v.sha(raw)!=digest:raise RuntimeError('actual_qualification_audit_digest_required')
            return raw
        with patch.object(v,'qualification_key',return_value=identity),patch.object(v,'new_identity',return_value=owner),patch.object(v,'public',side_effect=public):
            self.assertEqual(v.require_qualification(cache,self.host,seal()),result)
            result['format']='yunipals-ypal-ordinary-cache-continuation-authority-v5'
            with self.assertRaises(RuntimeError):v.require_qualification(cache,self.host,seal())
            result['format']=v.FORMAT;gate['ttlNanoseconds']=90_000_000_000
            with self.assertRaises(RuntimeError):v.require_qualification(cache,self.host,seal())
            gate['ttlNanoseconds']=v.TTL_NS;gate['remainingNanoseconds']=95_000_000_000
            with self.assertRaises(RuntimeError):v.require_qualification(cache,self.host,seal())
            gate['remainingNanoseconds']=115_000_000_000;result['elapsedNanoseconds']=116_000_000_000
            with self.assertRaises(RuntimeError):v.require_qualification(cache,self.host,seal())
            result['elapsedNanoseconds']=96_000_000_001;reference=seal();docs['complete-held-callback.json']['packetSha256']='9'*64
            with self.assertRaises(RuntimeError):v.require_qualification(cache,self.host,reference)

    def test_identity_is_distinct_and_policy_input_or_immutable_ACK_drift_refuses(self):
        cache=types.SimpleNamespace(inverse_mode=False);self.host.cache=cache
        self.context.original_identity=Mock(return_value={'authoritySha256':m.sha((HERE/m.FILE.name).read_bytes())})
        identity=self.context.identity(cache,self.host)
        self.assertEqual(identity['approvalScopeNanoseconds'],120_000_000_000);self.assertEqual(identity['literalACKTailNanoseconds'],5_000_000_000)
        self.assertEqual(identity['nativeReadinessPolicyRefs'],self.refs);self.assertFalse(identity['old90SecondQualificationClaimed'])
        old_raw=self.input_raw;self.input_raw=m.encoded(self.config|{'unowned':True})
        with self.assertRaises(RuntimeError):self.context.inputs()
        self.input_raw=old_raw;self.ack['policyTTLSeconds']=90
        with self.assertRaises(RuntimeError):self.context.inputs()

    def test_actual_provider_callback_wrapper_uses_new_before_literal_owner_and_retains_complete_body(self):
        namespace=self.case.provider();cache=namespace.cache_runtime();self.host.cache=cache
        self.context.original_identity=Mock(return_value={'explicitPrivateIdentityIOFixture':True})
        raw=cache._sql_child;dispatch=cache.sql_child;cells=dict(zip(dispatch.__code__.co_freevars,dispatch.__closure__))
        self.assertIs(cells['authority'].cell_contents,cache.continuation_authority)
        authority=self.context.bind(cache,self.host)
        self.assertIs(cache._sql_child.__code__,raw.__code__);self.assertIs(cache.sql_child.__code__,dispatch.__code__)
        changed=dict(zip(cache.sql_child.__code__.co_freevars,cache.sql_child.__closure__))
        self.assertIs(changed['authority'].cell_contents,authority)
        for key in ['cache','launch']:self.assertIs(changed[key],cells[key])
        self.assertIs(cache._sql_child.__defaults__,raw.__defaults__);self.assertIs(cache._sql_child.__closure__,raw.__closure__)
        with self.assertRaises(RuntimeError):self.context.bind(cache,self.host)
        # Execute the exact retained wrapper through its real closure protocol;
        # only the original transport launch I/O is substituted here.
        events=[];packet={'mode':'apply','xid':'12345'};prepared=Mock(side_effect=lambda p:events.append(('prepared',p)))
        def launch(actual_host,mode,plan,callback,generation,plan_json):
            self.assertIs(actual_host,self.host);callback(packet);return 'same-original-return'
        def cell(x):return(lambda:x).__closure__[0]
        closure=tuple(cell(launch)if key=='launch'else item for key,item in zip(cache.sql_child.__code__.co_freevars,cache.sql_child.__closure__))
        actual=types.FunctionType(cache.sql_child.__code__,cache.sql_child.__globals__,cache.sql_child.__name__,cache.sql_child.__defaults__,closure)
        with patch.object(authority,'before_literal_ack',side_effect=lambda c,h,p:events.append(('new120-ack',p))):
            self.assertEqual(actual(self.host,'apply',{},prepared,None,'{}'),'same-original-return')
        self.assertEqual(events,[('prepared',packet),('new120-ack',packet)]);prepared.assert_called_once_with(packet)


if __name__=='__main__':unittest.main(verbosity=2)
