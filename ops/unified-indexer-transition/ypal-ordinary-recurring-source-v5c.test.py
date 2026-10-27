#!/usr/bin/env python3
"""Synthetic source leaves, executing the new wrapper's real refusal paths."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock, patch

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('recurring_source',HERE/'ypal-ordinary-recurring-source-v5c.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def fixture(self):
        refs={'lifecycleResultSha256':'a'*64,'foundationInputSha256':'b'*64,'featureInputSha256':'2'*64,'readviewCreatedSha256':'c'*64}
        unit={'InvocationID':'d'*32,'ExecMainStartTimestampMonotonic':'123','NRestarts':'0'}
        actor={'unit':unit,'parent':{'pid':234,'startTicks':'23'},'processes':[{'pid':234,'startTicks':'23'}]}
        trace=[];tables=[{'oid':str(100+i)} for i in range(44)]
        native={'schemaOid':'75963410','tables':tables,'cache':{'oid':'12'},'app':{'build_id':'71e2a7f3b7'}}
        result={'format':'lifecycle','operatorSha256':m.MANAGED_SHA,'completed':True,'operationSha256':'e'*64,
          'foundationInputSha256':refs['foundationInputSha256'],'featureInputSha256':refs['featureInputSha256'],'foundationReceiptSha256':'f'*64,'managedEpoch':actor}
        state={**unit,'MainPID':'0','ControlPID':'0','Job':'','ActiveState':'failed'}
        current={**m.DATA,'validated':True,'currentWriterQualified':True,'managedInstallationQualified':True,
          'lifecycleProducerSha256':m.MANAGED_SHA,'operatorSha256':m.FOUNDATION_SHA,
          'lifecycleReceiptSha256':refs['lifecycleResultSha256'],'inputSha256':refs['foundationInputSha256'],'featureInputSha256':refs['featureInputSha256'],
          'currentManagedEpoch':actor,'nativeTables':tables,'sourceKernelActors':{'yunipals-indexer.service':actor},
          'sourceReadinessQualified':True}
        live=[actor];marker={'validated':True,'readviewDataOnly':True,'receiptSha256':refs['readviewCreatedSha256'],
          'readSchema':m.READ_SCHEMA,'readIdentity':m.READ_IDENTITY,'sourceActorQualified':False,
          'currentRoleGraphQualified':False,'dataIdentitySha256':'1'*64}
        def get_result(path,digest):
            self.assertEqual(digest,refs['lifecycleResultSha256']);trace.append('ack');return result
        def get_current(digest):
            self.assertEqual(digest,refs['lifecycleResultSha256']);trace.append('current');return current
        def floor(old,new):self.assertEqual(old,native);self.assertEqual(new,native);trace.append('floor')
        owner=types.SimpleNamespace(m=types.SimpleNamespace(document=get_result),envelope=lambda:{'format':'lifecycle'},
          digest=lambda name:'e'*64,has=lambda name:False,current=get_current,
          h=types.SimpleNamespace(actor=lambda *_:live[0],state=lambda _:copy.deepcopy(state),managed_settings=lambda:trace.append('mounts')),
          f=types.SimpleNamespace(canonical_actor=lambda value:value),operation=lambda:{'operation':'fixed'},
          stable=lambda op:(trace.append('stable') or native),installed=lambda:trace.append('installed'),
          known_gone=lambda a:trace.append('known-gone'),managed_known_gone=lambda:trace.append('all-known-gone'),
          terminal_backends=lambda:(trace.append('kernel') or {'nativeBackends':0}),
          o=types.SimpleNamespace(h=types.SimpleNamespace(r=types.SimpleNamespace(recovery_floor=floor))),
          foundation=types.SimpleNamespace(record=lambda *_:{'nativeAtAcknowledgement':native,
            'binding':{**m.DATA,'nativeTables':tables,'syncCache':native['cache']}}))
        code=types.SimpleNamespace(BASE=Path('/synthetic/lifecycle'),PARENT='yunipals-indexer.service')
        view=types.SimpleNamespace(data_current=lambda digest:copy.deepcopy(marker))
        return refs,code,owner,view,result,current,live,state,marker,trace

    def test_default_constructs_nothing(self):
        value=json.loads(subprocess.check_output(['/usr/bin/python3','-I','-B',str(HERE/'ypal-ordinary-recurring-source-v5c.py')]))
        self.assertFalse(value['contextConstructed']);self.assertFalse(value['workerActivationQualified'])
        self.assertEqual(value['databaseWrites']+value['serviceActions']+value['providerCalls'],0)

    def test_actual_refs_required_before_loading(self):
        with patch.object(m,'module',side_effect=AssertionError('must not load')):
            for refs in [{},{'lifecycleResultSha256':'0'*64,'foundationInputSha256':'b'*64,'featureInputSha256':'2'*64,'readviewCreatedSha256':'c'*64}]:
                with self.assertRaisesRegex(RuntimeError,'actual_lifecycle'):m.components(refs)

    def test_fixed_lifecycle_receives_actual_foundation_and_feature_input_hashes(self):
        refs,*_=self.fixture();created=object();view=object()
        code=types.SimpleNamespace(FOUNDATION_SHA=m.FOUNDATION_SHA,Owner=Mock(return_value=created))
        with patch.object(m,'module',side_effect=[code,view]):
            self.assertEqual(m.components(refs),(code,created,view))
        code.Owner.assert_called_once_with(refs['foundationInputSha256'],refs['featureInputSha256'])
        self.assertEqual(m.sha((HERE/m.MANAGED.name).read_bytes()),m.MANAGED_SHA)
        with patch.object(m,'module',side_effect=AssertionError('old three-ref interface must not load')):
            with self.assertRaises(RuntimeError):m.components({k:v for k,v in refs.items()if k!='featureInputSha256'})

    def test_foreign_feature_input_in_lifecycle_ACK_refuses_before_current(self):
        refs,code,owner,view,result,*_=self.fixture();result['featureInputSha256']='9'*64
        owner.current=lambda _:self.fail('no current after wrong feature input ACK')
        with patch.object(m,'components',return_value=(code,owner,view)):
            with self.assertRaisesRegex(RuntimeError,'actual_uninversed'):m.validate_source_phase(refs)

    def test_actual_lifecycle_and_V5_objects_are_separate_proofs(self):
        refs,code,o,v,_,_,_,_,_,trace=self.fixture()
        with patch.object(m,'components',return_value=(code,o,v)):
            value=m.validate_source_phase(refs)
        self.assertEqual(trace,['ack','current','ack']);self.assertTrue(value['currentWriterQualified'])
        self.assertEqual(value['readSchema'],m.READ_SCHEMA)
        for key in ['currentCanonicalCoverageQualified','financialAuthorityQualified','currentRoleGraphQualified','consumerOrArenaAuthorityQualified']:
            self.assertFalse(value[key])

    def test_framework_unready_refuses_forward_but_is_honest_for_inverse(self):
        refs,code,o,v,_,current,*_=self.fixture();current['sourceReadinessQualified']=False
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'framework_must_be_ready'):m.validate_source_phase(refs)
            value=m.validate_source_phase(refs,inverse=True)
        self.assertFalse(value['sourceReadinessQualified']);self.assertTrue(value['currentWriterQualified'])

    def test_old_source_or_wrong_foundation_is_not_relabelled(self):
        for field,bad in [('operatorSha256','9'*64),('lifecycleProducerSha256','8'*64),('inputSha256','7'*64),('featureInputSha256','6'*64),('buildId','old')]:
            refs,code,o,v,_,current,*_=self.fixture();current[field]=bad
            with patch.object(m,'components',return_value=(code,o,v)):
                with self.assertRaisesRegex(RuntimeError,'same_actual_lifecycle'):m.validate_source_phase(refs)

    def test_V4_or_changed_marker_refuses(self):
        refs,code,o,v,_,_,_,_,marker,_=self.fixture();marker['readSchema']='yunipals_ownership_4e77f52b_v4'
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'actual_V5'):m.validate_source_phase(refs)
        marker['readSchema']=m.READ_SCHEMA
        v.data_current=lambda _:copy.deepcopy(marker)
        original=o.current
        def drift(digest):marker['dataIdentitySha256']='2'*64;return original(digest)
        o.current=drift
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'V5_object_identity_changed'):m.validate_source_phase(refs)

    def test_actor_replacement_during_last_object_query_refuses(self):
        refs,code,o,v,_,_,live,_,marker,_=self.fixture();calls=[]
        def read(_):
            calls.append(True)
            if len(calls)==2:live[0]={'unit':{'InvocationID':'foreign'}}
            return copy.deepcopy(marker)
        v.data_current=read
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'managed_epoch_replaced'):m.validate_source_phase(refs)

    def test_exact_terminal_is_inverse_only_and_never_calls_active_current(self):
        refs,code,o,v,_,_,live,_,_,trace=self.fixture();live[0]=None
        o.current=lambda _:self.fail('terminal proof must not call active foundation')
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'cannot_authorize'):m.validate_source_phase(refs)
            value=m.validate_source_phase(refs,inverse=True)
        self.assertTrue(value['terminalInverseOnly']);self.assertFalse(value['currentWriterQualified'])
        self.assertFalse(value['sourceReadinessQualified']);self.assertIn('kernel',trace);self.assertIn('all-known-gone',trace)

    def test_terminal_unknown_restart_or_live_known_process_refuses(self):
        refs,code,o,v,_,_,live,state,_,_=self.fixture();live[0]=None;state['NRestarts']='1'
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_terminal'):m.validate_source_phase(refs,inverse=True)
        state['NRestarts']='0';o.known_gone=lambda _ :m.need(False,'known_process_live')
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'known_process_live'):m.validate_source_phase(refs,inverse=True)

    def test_inverse_started_refuses_before_current_or_marker(self):
        refs,code,o,v,*_=self.fixture();o.has=lambda _:True;o.current=lambda _:self.fail('no current allowed')
        v.data_current=lambda _:self.fail('no marker allowed')
        with patch.object(m,'components',return_value=(code,o,v)):
            with self.assertRaisesRegex(RuntimeError,'uninversed'):m.validate_source_phase(refs)


if __name__=='__main__':unittest.main()
