#!/usr/bin/env python3
"""Actual public ExecStart pair plus complete genuine current-body controls."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-native-metadata-approval-current-observer-v1.py')
owner=load('ypal-native-metadata-approval-epoch-v3.test.py').namespace
fixture_path=HERE/'ypal-native-metadata-approval-current-observer-v1.execstart-fixture.json'
assert hashlib.sha256(fixture_path.read_bytes()).hexdigest()=='0b3554ec11dd8f3ff1b1b31b8767cd0c0e577ed328a2e5d74d10c7f058fd32d1'
pair=json.loads(fixture_path.read_bytes())


def actual_source(path,digest=None):
    raw=(HERE/Path(path).name).read_bytes()
    if digest is not None and hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('actual_local_source_hash_required')
    return raw


def actor(rendering):
    return{'unit':{'ExecStart':rendering,'MainPID':'1180697','InvocationID':'actual-fixture-invocation',
        'ExecMainStartTimestampMonotonic':'6638839277000','NRestarts':'0','User':'metadata-fixture'},
        'main':{'pid':1180697,'startTicks':6638839277,'bootId':'actual-fixture-boot'},
        'processes':[{'pid':1180697,'startTicks':6638839277,'bootId':'actual-fixture-boot'}],'commandSha256':'1'*64}


class Controls(unittest.TestCase):
    def setUp(self):
        self.ackActor=actor(pair['acknowledgedActor']);self.actualActor=actor(pair['actualActor']);self.boot={'inode':12}
        self.events=[];self.actor_values=None;self.live=set();self.owned=[{'pid':19,'backendStart':'epoch'}]
        self.ack={'format':owner.FORMAT,'validated':True,'operatorSha256':m.OWNER_SHA,'receiptSha256':m.RESULT_SHA,
            'inputSha256':m.INPUT_SHA,'actor':self.ackActor,'boot':self.boot,'operationSha256':'2'*64,
            'metadataInputSha256':'3'*64,'metadataOperationSha256':'4'*64,'metadataSelectedSha256':owner.SELECTED_SHA,
            'historicalActor':{'processes':[{'pid':10}]},'historicalBoot':self.boot,'artifactDigest':owner.ARTIFACT,
            'artifactManifestSha256':owner.ARTIFACT_MANIFEST,'workerSha256':owner.WORKER_SHA,
            'immutableAcknowledgementOnly':True,'currentActorQualified':False,'sourceActorQualified':False,
            'READAuthorityQualified':False,'publicationAuthorityQualified':False,'financialAuthorityQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        outer=self
        class Context:
            def __init__(self,input_sha,refresh_callback=None):
                outer.events.append(('Context',input_sha,refresh_callback));self.host=types.SimpleNamespace(m=object(),sessions=self.sessions)
                self.meta=types.SimpleNamespace(BOOT=Path('/fixture/boot'),link=lambda p:copy.deepcopy(outer.boot),
                    identity_alive=lambda _,p:outer.identity_alive(p))
            def read_operation(self):
                outer.events.append('operation');return{'reviewBinding':{'actor':{'processes':[{'pid':11}]}}}
            def actor(self,new):
                outer.events.append(('actor',new))
                return copy.deepcopy(next(outer.actor_values)if outer.actor_values is not None else outer.actualActor)
            def sessions(self,actual):
                outer.events.append(('sessions',copy.deepcopy(actual)));return{'owned':copy.deepcopy(outer.owned),'otherPeers':[]}
        self.Context=Context
    def identity_alive(self,process):
        self.events.append(('terminal',process['pid']));return process['pid']in self.live
    def acknowledgement(self,*_):
        self.events.append('ACK');return copy.deepcopy(self.ack)
    def capture(self,callback=None):
        with patch.object(m,'protected',side_effect=actual_source),patch.object(m,'owner_module',return_value=owner),\
                patch.dict(owner.actor_current.__globals__,{'Context':self.Context,'acknowledgement':self.acknowledgement}):
            return m.actor_current(m.RESULT_SHA,m.INPUT_SHA,callback)

    def test_actual_public_pair_parses_exact_eight_keys_and_only_two_deltas(self):
        new,_=m.parsed_exec(pair['actualActor']);old,_=m.parsed_exec(pair['acknowledgedActor'])
        self.assertEqual(set(new),{'path','argv[]','ignore_errors','start_time','stop_time','pid','code','status'})
        self.assertEqual([key for key in old if old[key]!=new[key]],['start_time','pid'])
        proof=m.actor_relation(self.actualActor,self.ackActor)
        self.assertTrue(proof['changed']);self.assertEqual(proof['changedFields'],['pid','start_time'])
        self.assertFalse(proof['acknowledgedActorSubstituted'])
        self.assertFalse(m.actor_relation(self.ackActor,self.ackActor)['changed'])
    def test_full_actual_Owner3_body_originally_refuses_then_new_observer_completes(self):
        with patch.dict(owner.actor_current.__globals__,{'Context':self.Context,'acknowledgement':self.acknowledgement}):
            with self.assertRaisesRegex(RuntimeError,'actual_new_metadata_actor_boot'):owner.actor_current(m.RESULT_SHA,m.INPUT_SHA)
        self.events=[];callback=lambda:(_ for _ in()).throw(AssertionError('SOURCE/READ callback must not run'))
        proof=self.capture(callback)
        self.assertEqual(proof['format'],m.FORMAT);self.assertEqual(proof['operatorSha256'],m.own_sha())
        self.assertEqual(proof['actor'],self.actualActor);self.assertNotEqual(proof['actor'],self.ackActor)
        self.assertEqual(proof['upgradeAcknowledgement'],self.ack);self.assertFalse(proof['originalOwner3CurrentPassed'])
        self.assertEqual([event for event in self.events if isinstance(event,tuple)and event[0]=='Context'],[('Context',m.INPUT_SHA,callback)])
        self.assertTrue(any(isinstance(event,tuple)and event[0]=='sessions'for event in self.events))
        self.assertIn(('terminal',11),self.events);self.assertIn(('terminal',10),self.events)
    def test_unchanged_raw_actor_is_also_a_new_honest_observation(self):
        self.actualActor=copy.deepcopy(self.ackActor);proof=self.capture()
        self.assertFalse(proof['execStartPresentation']['changed']);self.assertFalse(proof['originalOwner3CurrentPassed'])
    def test_any_other_actor_process_or_unit_field_refuses(self):
        mutations=[lambda a:a['unit'].update(InvocationID='foreign'),lambda a:a['unit'].update(NRestarts='1'),
            lambda a:a['main'].update(startTicks=7),lambda a:a['processes'][0].update(pid=7),
            lambda a:a.update(commandSha256='9'*64),lambda a:a['unit'].update(User='foreign')]
        for mutate in mutations:
            value=copy.deepcopy(self.actualActor);mutate(value)
            with self.assertRaises(RuntimeError):m.actor_relation(value,self.ackActor)
    def test_no_other_ExecStart_fields_transitions_or_formatting_are_allowed(self):
        replacements=[('ignore_errors=no','ignore_errors=yes'),('status=0/0','status=1/1'),('pid=0','pid=1180697'),
            ('start_time=[n/a]','start_time=[Sun 2026-10-25 20:55:16 UTC]'),('code=(null)','code=exited'),
            (' ; stop_time','  ; stop_time'),(m.WORKER,m.WORKER+'.foreign'),(' }',' ; extra=no }')]
        for old,new in replacements:
            value=copy.deepcopy(self.actualActor);value['unit']['ExecStart']=value['unit']['ExecStart'].replace(old,new)
            with self.assertRaises(RuntimeError,msg=(old,new)):m.actor_relation(value,self.ackActor)
    def test_ACK_pid_must_be_actual_positive_actor_and_recorded_time_present(self):
        for replacement in [('pid=1180697','pid=7'),('start_time=[Sun 2026-10-25 20:55:16 UTC]','start_time=[n/a]')]:
            value=copy.deepcopy(self.ackActor);value['unit']['ExecStart']=value['unit']['ExecStart'].replace(*replacement)
            with self.assertRaises(RuntimeError):m.actor_relation(self.actualActor,value)
    def test_complete_current_kernel_and_all_prior_epochs_still_required(self):
        for live in [{11},{10}]:
            self.live=live
            with self.assertRaises(RuntimeError):self.capture()
        self.live=set();self.owned=[]
        with self.assertRaises(RuntimeError):self.capture()
    def test_raw_actor_change_or_immutable_ACK_change_during_capture_refuses(self):
        second=copy.deepcopy(self.actualActor);second['unit']['InvocationID']='changed'
        self.actor_values=iter([self.actualActor,second])
        with self.assertRaises(RuntimeError):self.capture()
        self.actor_values=None;count=0
        original=self.acknowledgement
        def changed(*args):
            nonlocal count
            count+=1;value=original(*args)
            if count>1:value['operationSha256']='8'*64
            return value
        with patch.object(self,'acknowledgement',side_effect=changed),self.assertRaises(RuntimeError):self.capture()
    def test_unknown_kernel_error_propagates_and_observer_never_retries(self):
        self.Context.sessions=lambda *_:(_ for _ in()).throw(PermissionError('private-kernel-refusal'))
        with self.assertRaises(PermissionError):self.capture()
        self.assertEqual(sum(isinstance(event,tuple)and event[0]=='Context'for event in self.events),1)
    def test_fixed_actual_ancestry_is_checked_before_any_owner_evaluation(self):
        with patch.object(m,'owner_module',side_effect=AssertionError('must not evaluate')):
            with self.assertRaises(RuntimeError):m.actor_current('0'*64,m.INPUT_SHA)
    def test_one_AST_comparison_is_the_only_genuine_current_body_change(self):
        raw=actual_source(m.OPS/m.ORIGINAL,m.SOURCE_PINS[m.ORIGINAL]);tree=ast.parse(raw)
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='actor_current')
        with patch.object(m,'protected',side_effect=actual_source):compiled=m.current_method(owner)
        self.assertEqual(compiled.__defaults__,owner.actor_current.__defaults__)
        self.assertEqual(sum(ast.unparse(n)=="actor == first['actor']"for n in ast.walk(fn)if isinstance(n,ast.Compare)),1)
        # The compiler itself authenticates co_code/consts/names of this full
        # original body before its one comparison seam; no other methods move.
        self.assertIs(compiled.__globals__['Context'],owner.Context)
        self.assertIs(compiled.__globals__['acknowledgement'],owner.acknowledgement)


if __name__=='__main__':unittest.main()
