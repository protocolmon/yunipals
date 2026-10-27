"""Real thin V2 composition plus retained controls; no production evidence."""
import ast
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent

def load(name):
    path=HERE/name;spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

entry=load('ypal-ordinary-generation-attempt-v2.py')
watch=load('ypal-ordinary-generation-attempt-watch-v2.py')

def local_public(path,digest,maximum=4000000):
    raw=(HERE/Path(path).name).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=digest or len(raw)>maximum:raise RuntimeError('exact_local_reviewed_source_required')
    return raw

entry.public=local_public;watch.public=local_public
m=entry.composition();w=watch.composition()
# The actual installed programs are these same reviewed source files locally.
m.__file__=str(HERE/entry.FILE.name);w.__file__=str(HERE/watch.FILE.name)

old_tests=(HERE/'ypal-ordinary-generation-attempt-v1.test.py').read_bytes()
assert hashlib.sha256(old_tests).hexdigest()=='5e1836c447a4bf5ec7a4898e5311c2852aebebbeef93702464ba2ba80207eb13'
body=[node for node in ast.parse(old_tests).body if isinstance(node,(ast.FunctionDef,ast.ClassDef))]
exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),__file__,'exec'),globals())


def semantic_proof(changed=True):
    observation={'semanticIdentityMatched':True,'capturedAllocatedBytes':'77602816',
        'observedAllocatedBytes':'77651968'if changed else'77602816','allocatedBytesChanged':changed}
    return {'validated':True,'recoverySemantics':copy.deepcopy(entry.RECOVERY_SEMANTICS),
        'allocationObservations':{'walletStats':copy.deepcopy(observation),'derivedStamps':copy.deepcopy(observation)},
        'contextSha256':'1'*64,'databaseWrites':0,'rawRowsExported':False}


class ThinV2Controls(unittest.TestCase):
    def test_actual_new_paths_and_all_inherited_effect_and_source_gate_bodies(self):
        old=load('ypal-ordinary-generation-attempt-v1.py')
        self.assertNotEqual(m.BASE,old.BASE);self.assertEqual(m.BASE,entry.BASE);self.assertEqual(m.WORK,entry.WORK)
        self.assertEqual(m.MONITOR,entry.MONITOR);self.assertEqual(m.INPUT,entry.INPUT);self.assertEqual(m.APP,entry.APP)
        for name in ['config_checked','static_legacy_host','terminal_worker','retained_current','successful_worker_evidence',
                     'successful_worker','capacity_preflight','unit_bytes','build_review','build','acceptance_review','reconcile',
                     'validate_candidate_database_current','validate_retained_current','main']:
            self.assertEqual(getattr(m,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
        for name in ['__init__','qualify','manager']:
            self.assertEqual(getattr(m.Host,name).__code__.co_code,getattr(old.Host,name).__code__.co_code,name)

    def test_retained_namespace_routes_actual_semantic_component_before_bridge(self):
        retained=entry.retained_entry()
        self.assertEqual(retained.CAPSULE,entry.RECOVERY_FILE);self.assertEqual(retained.CAPSULE_SHA,entry.RECOVERY_SHA)
        fixture=load('ypal-ordinary-generation-v5c.test.py');common=fixture.c
        original_module=common.module
        def module(path,digest):
            local_public(path,digest)
            if path==retained.QUERY:return types.SimpleNamespace(bind=lambda _:None)
            if path==retained.METADATA:return types.SimpleNamespace(namespace=lambda _:types.SimpleNamespace())
            if path==retained.CANDIDATES:return types.SimpleNamespace(namespace=lambda _:types.SimpleNamespace(FORMAT='fixture',FILES=('fixture',)))
            return original_module(path,digest)
        with patch.object(retained,'common',return_value=common),patch.object(common,'public',side_effect=local_public), \
             patch.object(common,'load_input',return_value=fixture.config),patch.object(common,'module',side_effect=module):
            actual=retained.namespace('1'*64,'2'*64)
        self.assertEqual(actual.CAPSULE,entry.RECOVERY_FILE);self.assertEqual(actual.CAPSULE_SHA,entry.RECOVERY_SHA)
        bridge=next(cell.cell_contents for cell in actual.read_bridge.__closure__ if isinstance(cell.cell_contents,types.FunctionType)and cell.cell_contents.__name__=='read_bridge')
        frozen=load('ypal-restored-generation-v1.py')
        self.assertEqual(bridge.__code__.co_code,frozen.read_bridge.__code__.co_code)
        self.assertEqual(bridge.__globals__['CAPSULE'],entry.RECOVERY_FILE)
        self.assertEqual(bridge.__globals__['CAPSULE_SHA'],entry.RECOVERY_SHA)
        self.assertIn('verify-capsule',actual.read_bridge.__code__.co_consts)

    def test_explicit_semantics_only_accepts_real_typed_new_verifier_output(self):
        for changed in [True,False]:self.assertTrue(entry.semantic_verification(semantic_proof(changed))['validated'])
        for key,bad in [('recoverySemantics',{}),('validated',False),('databaseWrites',1),('rawRowsExported',True)]:
            proof=semantic_proof();proof[key]=bad
            with self.assertRaises(RuntimeError):entry.semantic_verification(proof)
        for key,bad in [('semanticIdentityMatched',False),('observedAllocatedBytes','-1'),('allocatedBytesChanged',False)]:
            proof=semantic_proof();proof['allocationObservations']['walletStats'][key]=bad
            with self.assertRaises(RuntimeError):entry.semantic_verification(proof)
        proof=semantic_proof();proof['allocationObservations'].pop('derivedStamps')
        with self.assertRaises(RuntimeError):entry.semantic_verification(proof)

    def test_only_new_candidate_metadata_is_added_to_frozen_acceptance_body(self):
        original=ast.parse((HERE/entry.FROZEN.name).read_bytes())
        fn=copy.deepcopy(next(node for node in original.body if isinstance(node,ast.FunctionDef)and node.name=='accept'))
        calls=[node for node in ast.walk(fn)if isinstance(node,ast.Call)and ast.unparse(node.func)=='receipt.update']
        self.assertEqual(len(calls),1)
        calls[0].keywords.extend([
            ast.keyword(arg='recoveryComponent',value=ast.Name(id='RECOVERY_COMPONENT',ctx=ast.Load())),
            ast.keyword(arg='capsuleSemanticVerification',value=ast.parse('h.legacy.recovery_semantic_verification',mode='eval').body),
            ast.keyword(arg='originalStrictCapsuleVerifierPassed',value=ast.Constant(False))])
        scope=dict(m.__dict__)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),__file__,'exec'),scope)
        self.assertEqual(scope['accept'].__code__.co_code,m.accept.__code__.co_code)
        self.assertEqual(scope['accept'].__code__.co_consts,m.accept.__code__.co_consts)

    def test_literal_source_closure_has_actual_V1_V2_and_component_without_binding_cycle(self):
        self.assertEqual(len(entry.SOURCE_PINS),164)
        for name,digest in entry.SOURCE_PINS.items():self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(),digest,name)
        self.assertNotIn('ypal-ordinary-generation-binding-v1.py',entry.SOURCE_PINS)
        self.assertEqual(entry.SOURCE_PINS[entry.FROZEN.name],entry.FROZEN_SHA)
        self.assertEqual(entry.SOURCE_PINS[entry.RECOVERY_FILE.name],entry.RECOVERY_SHA)
        self.assertEqual(entry.RECOVERY_COMPONENT['file'],entry.RECOVERY_FILE.name)
        self.assertFalse(entry.RECOVERY_COMPONENT['semantics']['predecessorStrictSuccessClaimed'])

    def test_actual_frozen_monitor_bodies_keep_all_disk_backup_cancel_and_telemetry_gates(self):
        old=load('ypal-ordinary-generation-attempt-watch-v1.py')
        for name,member in vars(old).items():
            if isinstance(member,types.FunctionType):self.assertEqual(getattr(w,name).__code__.co_code,member.__code__.co_code,name)
        self.assertEqual(w.APP,entry.APP);self.assertEqual(w.WORK,entry.WORK);self.assertEqual(w.INPUT,entry.INPUT)
        self.assertEqual(w.INPUT_FORMAT,entry.FORMAT+'-input');self.assertEqual(w.ENV_FILES[-1],str(entry.BASE/'generation.public.env'))
        self.assertEqual((w.MIN_RESERVE,w.ABORT_FREE,w.MIN_SECONDS,w.MAX_SECONDS),(25000000000,30000000000,1470,2400))
        self.assertEqual(w.ARTIFACT.name,entry.ARTIFACT)


if __name__=='__main__':unittest.main()
