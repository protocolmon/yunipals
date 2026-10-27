#!/usr/bin/env python3
"""Actual successor composition; observations are local synthetic fixtures."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value);return value


w=load('arena-ypal-business-inverse-v2.py')
old=load('arena-ypal-business-inverse-v1.py')


def local(path,expected=None,maximum=4000000,private=False):
    path=Path(path);source=HERE/path.name
    if path.parent==old.TARGET_HELPER.parent:source=HERE.parent/'arena-public-rollback-target-20261023'/path.name
    if not source.exists()and path.name=='final-supervisor-inventory-v1.py':source=HERE.parent/'solana-acceptance'/path.name
    if not source.exists()and path.name=='ypal-old-runtime-inventory-v1.py':source=HERE.parent/'booster-launch'/path.name
    raw=source.read_bytes();w.need(0<len(raw)<=maximum and(expected is None or w.sha(raw)==expected),'actual_local_successor_source_bytes_required')
    return raw


with patch.object(w,'public',side_effect=local):
    derived_raw=w.authenticated_full_source()
    m=w.prepared_entry()

# Retain the genuine old source controls in the actual new globals. Only the
# manifest-builder filename and the pool identity fixture domain change.
legacy_raw=(HERE/'arena-ypal-business-inverse-v1.test.py').read_bytes()
w.need(w.sha(legacy_raw)=='8f064381ae9aa5b4750b360ba79f88bd86dd72407299d1bb38374a9311a18ce9','exact_frozen_retained_source_controls_required')
legacy_tree=ast.parse(legacy_raw);counts={'builder':0,'pool':0}
for node in ast.walk(legacy_tree):
    if isinstance(node,ast.Constant)and node.value=='arena-ypal-business-inverse-v1-manifest.py':
        node.value='arena-ypal-business-inverse-v2-manifest.py';counts['builder']+=1
    elif isinstance(node,ast.Constant)and node.value=='yunipals-arena-native-derived-projector-owner-v1-read-pools':
        node.value='yunipals-arena-native-derived-projector-owner-v2-read-pools';counts['pool']+=1
assert counts=={'builder':1,'pool':1}
legacy_tree.body=[node for node in legacy_tree.body if not(isinstance(node,ast.If)and ast.unparse(node.test)=="__name__ == '__main__'")]
legacy=types.ModuleType('actual_inverse2_retained_controls');legacy.__file__=str(HERE/'arena-ypal-business-inverse-v1.test.py')
exec(compile(ast.fix_missing_locations(legacy_tree),legacy.__file__,'exec'),legacy.__dict__)
legacy.m=m;legacy.local_public=local


def retained_main_control(self):
    tree=ast.parse(derived_raw);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main')
    flags=[n.args[0].value for n in ast.walk(main)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and
        n.func.attr=='add_argument'and n.args and isinstance(n.args[0],ast.Constant)]
    self.assertEqual(set(flags),{'--plan-sha','--prepare','--publish','--continue-published','--reconcile','--accept','--finish-prepared'})
    statements=[ast.unparse(n)for n in main.body]
    self.assertLess(statements.index('os.umask(63)'),next(i for i,s in enumerate(statements)if s.startswith('host = value.Host(')))
    self.assertEqual(m.MAXIMUM_PARENT_SECONDS,1200)


legacy.Controls.test_main_exposes_no_target_creation_or_scanner_modes=retained_main_control
RetainedControls=legacy.Controls


class SuccessorControls(unittest.TestCase):
    def composed(self):
        with patch.object(m,'public',side_effect=local):return m.composition()

    def test_actual_source_closure_and_pure_builder_match_all_real_bytes(self):
        builder=load('arena-ypal-business-inverse-v2-manifest.py');value=builder.build(HERE)
        self.assertEqual(value,json.loads((HERE/w.MANIFEST.name).read_bytes()))
        self.assertEqual(value['format'],w.FORMAT+'-source');self.assertEqual(len(value['files']),328)
        self.assertEqual(value['files'][w.OWNER.name],w.OWNER_SHA)
        self.assertEqual(value['files'][w.PROJECTION.name],w.PROJECTION_SHA)
        self.assertEqual(value['files'][w.EFFECT_SOURCE.name],w.EFFECT_SOURCE_SHA)
        self.assertNotIn('arena-ypal-native-return-v2.py',value['files'])
        self.assertNotEqual(w.OWNER_SHA,old.OWNER_SHA);self.assertNotEqual(w.PROJECTION_SHA,old.PROJECTION_SHA)

    def test_deterministic_expansion_changes_only_declared_source_routes(self):
        with patch.object(w,'public',side_effect=local):self.assertEqual(w.authenticated_full_source(),derived_raw)
        previous=ast.parse(local(w.FROZEN,w.FROZEN_SHA));current=ast.parse(derived_raw)
        functions=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
        a,b=functions(previous),functions(current);self.assertEqual(a.keys(),b.keys())
        self.assertEqual({key for key in a if a[key]!=b[key]},{'owner_namespace','projection_sources','composition'})
        for name in ['main','validate_plan','snapshot','current_leaf','accept','validate_inverse_leaf','public']:
            self.assertEqual(a[name],b[name],name)
        self.assertEqual(m.successor_derivation['derivedSourceSha256'],w.sha(derived_raw))
        self.assertEqual(m.successor_derivation['producerSha256'],w.sha((HERE/w.FILE.name).read_bytes()))
        self.assertFalse(m.successor_derivation['oldCLIResultClaimed'])

    def test_source_drift_refuses_before_any_template_compilation(self):
        for refused in [w.FROZEN,w.PROJECTION_MANIFEST,w.OPS/'ypal-native-metadata-approval-epoch-v2.py',w.EFFECT_SOURCE]:
            def changed(path,*args,**kwargs):
                if Path(path)==refused:raise RuntimeError('actual_source_drift')
                return local(path,*args,**kwargs)
            with self.subTest(path=refused),patch.object(w,'public',side_effect=changed),self.assertRaisesRegex(RuntimeError,'actual_source_drift'):
                w.prepared_entry()

    def test_actual_owner20_manifest_and_all_source_bytes_before_eval(self):
        manifest=json.loads(local(w.OWNER_MANIFEST,w.OWNER_MANIFEST_SHA));seen=[]
        def observed(path,*args,**kwargs):seen.append(Path(path).name);return local(path,*args,**kwargs)
        api=types.SimpleNamespace(code_manifest=lambda:copy.deepcopy(manifest),namespace=lambda:'only_after_complete_authentication')
        with patch.object(m,'public',side_effect=observed),patch.object(m,'evaluate',return_value=api)as evaluate:
            self.assertEqual(m.owner_namespace(),'only_after_complete_authentication')
            self.assertTrue(set(manifest['files'])<=set(seen));evaluate.assert_called_once_with(w.OWNER,w.OWNER_SHA)
        for change in [lambda v:v.update(format='yunipals-arena-ypal-ordinary-accept-v1-code'),lambda v:v['files'].pop(next(iter(v['files'])))]:
            bad=copy.deepcopy(manifest);change(bad)
            with patch.object(m,'public',side_effect=lambda path,*a,**k:json.dumps(bad).encode()if Path(path)==w.OWNER_MANIFEST else local(path,*a,**k)),\
                patch.object(m,'evaluate',side_effect=AssertionError('no_eval_before_actual20_map')),self.assertRaises(RuntimeError):m.owner_namespace()

    def test_old_owner_projection_support_source_and_pool_domains_refuse(self):
        row=legacy.plan()
        for change in [{'format':old.FORMAT},{'cutoverOwner':{'file':str(old.OWNER),'sha256':old.OWNER_SHA}},
            {'projection':{**row['projection'],'producerSha256':old.PROJECTION_SHA}}, {'support':old.SUPPORT},
            {'effectSource':{**row['effectSource'],'producerSha256':old.EFFECT_SOURCE_SHA}}]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):m.validate_plan({**row,**change})
        value=self.composed();host=object.__new__(value.Host);host.plan=row;identity=legacy.pool_identity(host,value)
        self.assertEqual(host.checked_read_pool_identity(identity),identity)
        with self.assertRaises(RuntimeError):host.checked_read_pool_identity({**identity,'format':'yunipals-arena-native-derived-projector-owner-v1-read-pools'})

    def test_compiler_requires_all_seven_exact_literal_seams(self):
        raw=local(w.FROZEN,w.FROZEN_SHA).replace(b'yunipals-arena-ypal-ordinary-accept-v1-code',b'foreign-owner-code')
        with patch.object(w,'source_manifest'),patch.object(w,'public',return_value=raw),self.assertRaisesRegex(RuntimeError,'seven_identity_seams'):
            w.authenticated_full_source()

    def test_real_new_leaf_domain_and_own_receipt_producer(self):
        self.assertEqual(m.FORMAT,w.FORMAT);self.assertEqual(m.FILE,w.FILE);self.assertEqual(m.INPUT,w.INPUT)
        self.assertNotEqual(m.CHILD_SHA,old.CHILD_SHA);self.assertEqual(m.CHILD_SHA,w.sha(local(w.CHILD)))
        self.assertEqual(m.CHILD_FORMAT,'yunipals-arena-ypal-business-inverse-child-v2')
        self.assertEqual(m.ARTIFACT,w.ARTIFACT);self.assertEqual(m.BASE_SOURCE,w.BASE_SOURCE);self.assertEqual(m.INSTALL_ACK,w.INSTALL_ACK)
        self.assertEqual(m.validate_inverse_leaf.__code__.co_code,old.validate_inverse_leaf.__code__.co_code)
        self.assertEqual(m.validate_inverse_leaf.__code__.co_consts,old.validate_inverse_leaf.__code__.co_consts)
        self.assertEqual(m.accept.__code__.co_code,old.accept.__code__.co_code)
        self.assertEqual(m.accept.__code__.co_consts,old.accept.__code__.co_consts)
        def body(c):return(c.co_code,c.co_names,tuple(body(v)if isinstance(v,types.CodeType)else v for v in c.co_consts))
        self.assertEqual(body(m.public.__code__),body(old.public.__code__))

    def test_actual_new_child_accepts_only_matching_real_sealed_authority(self):
        seals=load('arena-ypal-restored-v1.py');payload=b'synthetic-fixture-payload'
        packet={'format':'yunipals-arena-ypal-business-inverse-authority-v2','action':'inspect',
            'payloadSha256':w.sha(payload),'childSha256':m.CHILD_SHA}
        source="""import{readFileSync}from'node:fs';
import{composition}from'./ops/unified-indexer-transition/arena-ypal-business-inverse-child-v2.mjs';
const n=await composition(readFileSync('./ops/unified-indexer-transition/arena-ypal-business-inverse-child-v1.mjs'),readFileSync('./ops/unified-indexer-transition/arena-modern-public-rollback-v1.mjs'));
n.authority(Number(process.argv[1]),'inspect',Buffer.from('synthetic-fixture-payload'),process.argv[2]);
"""
        for accepted,value in[(True,packet),(False,{**packet,'format':'yunipals-arena-ypal-business-inverse-authority-v1'}),
            (False,{**packet,'payloadSha256':'b'*64}),(False,{**packet,'childSha256':old.CHILD_SHA})]:
            fd=seals.sealed('arena-public-root-authority',w.encoded(value))
            try:
                result=subprocess.run(['/root/.nvm/versions/node/v24.18.1/bin/node','--input-type=module','-e',source,str(fd),m.CHILD_SHA],
                    cwd=HERE.parent.parent,pass_fds=(fd,),capture_output=True,timeout=10)
                self.assertEqual(result.returncode==0,accepted,result.stderr.decode())
            finally:os.close(fd)


if __name__=='__main__':unittest.main()
