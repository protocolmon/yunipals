#!/usr/bin/env python3
"""Qualified-source successor controls; no production/service/provider calls."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load('direct_v2',HERE/'arena-direct-native-cutover-v2.py')
retained=load('retained_direct_controls',HERE/'arena-direct-native-cutover-v1-test.py')
qualification=load('retained_qualification_fixture',HERE/'source6-normal-proxy-requalification-v1-test.py')


class RetainedBoundaries(retained.Controls):
    @classmethod
    def setUpClass(cls):
        cls.binding=patch.object(retained,'m',m);cls.binding.start()
    @classmethod
    def tearDownClass(cls):cls.binding.stop()


class QualifiedSource(unittest.TestCase):
    def setUp(self):
        # Reuse the exact qualification algorithm and frozen normal operator,
        # not a fabricated "validated" boolean. Its retained fixture replaces
        # only host files/manager/SQL with synthetic observations.
        self.fixture=qualification.Requalification();self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.q=qualification.m
        self.ack=self.fixture.acknowledge()
        self.saved=json.loads(self.q.RESULT.read_bytes())
        for key,value in {'SOURCE_QUALIFICATION_RESULT':self.q.RESULT,
                          'SOURCE_QUALIFICATION_RECEIPT':self.ack['qualificationReceiptSha256'],
                          'NORMAL_RECEIPT':self.q.ORIGINAL_SHA,
                          'SOURCE_RUNTIME':self.fixture.f.normal_identity,
                          'SOURCE_NATIVE':self.saved['nativeIdentity']}.items():
            self.bind(m,key,value)
        self.loads=[]
        def loader(path,pin,name):
            self.loads.append((path,pin,name))
            self.assertEqual(path,m.SOURCE_QUALIFICATION)
            self.assertEqual(pin,m.SOURCE_QUALIFICATION_SHA)
            return self.q
        self.host=object.__new__(m.Host);self.host.p=types.SimpleNamespace(load=loader)
        self.actions=len(self.fixture.f.actions)

    def bind(self,target,key,value):
        p=patch.object(target,key,value);p.start();self.addCleanup(p.stop)

    def test_real_frozen_acknowledgement_accepts_changed_proxy_pids_without_old_whole_validate(self):
        def forbidden(*args,**kwargs):raise AssertionError('old whole validation is forbidden')
        self.bind(self.fixture.n,'validate',forbidden)
        value=self.host.normal()
        self.assertEqual(value['kind'],'acknowledged-normal-proxy-requalification-v1')
        self.assertEqual(value['runtimeReceiptSha256'],self.q.ORIGINAL_SHA)
        self.assertEqual(value['qualificationReceiptSha256'],self.ack['qualificationReceiptSha256'])
        self.assertFalse(value['originalWholeValidationPassed'])
        self.assertFalse(value['nativeCaughtUpClaimed'])
        self.assertFalse(value['paidAuthority'])
        self.assertEqual(len(self.fixture.f.actions),self.actions)
        self.assertTrue(all(sql.startswith('SELECT ')for sql in self.fixture.f.queries))

    def test_wrong_receipt_native_namespace_or_runtime_is_refused(self):
        for field,value in [('SOURCE_QUALIFICATION_RECEIPT','f'*64),('SOURCE_NATIVE',{**self.saved['nativeIdentity'],'schema':'foreign'}),
                            ('SOURCE_RUNTIME',{**self.fixture.f.normal_identity,'pid':123})]:
            with self.subTest(field=field),patch.object(m,field,value),self.assertRaises(m.CutoverFailure):self.host.normal()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_current_proxy_replacement_unit_drift_or_financial_change_is_not_accepted(self):
        proxies=self.fixture.current_proxies
        original=copy.deepcopy(proxies['base'])
        proxies['base']['pid']='99999'
        with self.assertRaisesRegex(RuntimeError,'static_binding_changed'):self.host.normal()
        proxies['base']=copy.deepcopy(original)
        proxies['base']['definitionHashes']['/etc/systemd/system/foreign.conf']='a'*64
        with self.assertRaisesRegex(RuntimeError,'unit_definition_changed'):self.host.normal()
        proxies['base']=copy.deepcopy(original)
        self.bind(self.fixture.s,'financial',lambda:{'changed':'authority'})
        with self.assertRaisesRegex(RuntimeError,'financial_policy'):self.host.normal()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_same_process_boot_link_and_financial_expiry_are_mandatory(self):
        n=self.fixture.n
        self.bind(n,'PROFILE_EXPIRY','2026-10-01T00:00:00+00:00')
        with self.assertRaises(RuntimeError):self.host.normal()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_return_flags_cannot_relabel_old_validation_or_paid_renewal(self):
        original=self.q.validate_current
        for key,value in [('originalWholeValidationPassed',True),('paidAuthority',True),('financialWindowRenewed',True),
                          ('sourceRestarted',True),('nativeCaughtUpClaimed',True),('databaseWrites',1)]:
            def changed(pin,k=key,v=value):return {**original(pin),k:v}
            with self.subTest(key=key),patch.object(self.q,'validate_current',changed),self.assertRaises(m.CutoverFailure):self.host.normal()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_old_plan_format_is_not_accepted_as_new_producer(self):
        plan={'format':'yunipals-arena-direct-native-cutover-v1',
              'roleAuth':{'file':'/actual/auth','sha256':'a'*64},'actorsReceipt':{'file':'/actual/actors','sha256':'b'*64},
              'admissionProposal':{'file':'/actual/proposal','sha256':m.PROPOSAL_SHA},
              'floor':{'block':'100','hash':'0x'+'c'*64}}
        with self.assertRaisesRegex(m.CutoverFailure,'direct_native_plan'):m.validate_plan(plan)
        plan['format']=m.FORMAT;m.validate_plan(plan)


class ImmutableBusinessBoundaries(unittest.TestCase):
    def test_only_source_method_and_explicit_producer_metadata_differ_from_v1(self):
        old=ast.parse((HERE/'arena-direct-native-cutover-v1.py').read_text())
        new=ast.parse((HERE/'arena-direct-native-cutover-v2.py').read_text())
        additions={'SOURCE_QUALIFICATION','SOURCE_QUALIFICATION_SHA','SOURCE_QUALIFICATION_RECEIPT','SOURCE_QUALIFICATION_RESULT',
                   'SOURCE_QUALIFICATION_FORMAT','SOURCE_RUNTIME','SOURCE_NATIVE','SOURCE_FINANCIAL_EXPIRY'}
        def retained_tree(tree):
            result=[]
            for node in tree.body:
                if isinstance(node,ast.Assign):
                    names={target.id for target in node.targets if isinstance(target,ast.Name)}
                    if names <= additions|{'FORMAT','BASE'}:continue
                if isinstance(node,ast.ClassDef)and node.name=='Host':
                    node=copy.deepcopy(node);node.body=[item for item in node.body if not isinstance(item,ast.FunctionDef)or item.name!='normal']
                result.append(node)
            return ast.dump(ast.Module(body=result,type_ignores=[]),include_attributes=False)
        self.assertEqual(retained_tree(old),retained_tree(new))
        self.assertEqual(m.CHILD_SHA,'a5efd3ed83c3f2168055b84db4d09973ccb6ccc1d194b70ac39fa26110fd98a9')
        self.assertEqual(m.SOURCE,'264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24')


if __name__=='__main__':unittest.main(verbosity=2)
