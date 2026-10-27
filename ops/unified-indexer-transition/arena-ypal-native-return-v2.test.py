#!/usr/bin/env python3
"""Actual return2 derivations; observations and receipts are synthetic fixtures."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value);return value


w=load('arena-ypal-native-return-v2.py')
inverse=load('arena-ypal-business-inverse-v2.py')
previous=load('arena-ypal-native-return-v1.py')


def public(path,expected=None,maximum=4000000,private=False):
    path=Path(path);source=HERE/path.name
    if path.parent==Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023'):
        source=HERE.parent/'arena-public-rollback-target-20261023'/path.name
    if not source.exists()and path.name=='final-supervisor-inventory-v1.py':source=HERE.parent/'solana-acceptance'/path.name
    if not source.exists()and path.name=='ypal-old-runtime-inventory-v1.py':source=HERE.parent/'booster-launch'/path.name
    raw=source.read_bytes();w.need(0<len(raw)<=maximum and(expected is None or w.sha(raw)==expected),'actual_local_return2_source_required')
    return raw


with patch.object(w,'public',side_effect=public):
    derived_raw=w.authenticated_full_source();m=w.prepared_entry()
with patch.object(inverse,'public',side_effect=public):actual_inverse=inverse.prepared_entry()

legacy_raw=(HERE/'arena-ypal-native-return-v1.test.py').read_bytes()
w.need(w.sha(legacy_raw)=='80726edd00c9154a91555aa6e617cadec3c9303582c3216438d9197590eee460','exact_frozen_return_controls_required')
tree=ast.parse(legacy_raw);counts={'builder':0,'source-view':0}
class TestSources(ast.NodeTransformer):
    def visit_Constant(self,node):
        if node.value=='arena-ypal-native-return-v1-manifest.py':
            counts['builder']+=1;node.value='arena-ypal-native-return-v2-manifest.py'
        return node
    def visit_Call(self,node):
        if ast.unparse(node)=="__import__('inspect').getsource(m.composition)":
            counts['source-view']+=1;return ast.copy_location(ast.Call(func=ast.Name(id='authenticated_composition_source',ctx=ast.Load()),args=[],keywords=[]),node)
        return self.generic_visit(node)
tree=TestSources().visit(tree);w.need(counts=={'builder':1,'source-view':1},'two_actual_retained_return_test_source_seams_required')
tree.body=[node for node in tree.body if not(isinstance(node,ast.If)and ast.unparse(node.test)=="__name__ == '__main__'")]
legacy=types.ModuleType('actual_retained_return2_controls');legacy.__file__=str(HERE/'arena-ypal-native-return-v1.test.py')
legacy.authenticated_composition_source=lambda:ast.unparse(next(n for n in ast.parse(derived_raw).body if isinstance(n,ast.FunctionDef)and n.name=='composition'))
exec(compile(ast.fix_missing_locations(tree),legacy.__file__,'exec'),legacy.__dict__)
legacy.m=m;legacy.old.m=actual_inverse;legacy.old.local_public=public
RetainedControls=legacy.Controls


class SuccessorControls(unittest.TestCase):
    def test_all_actual_sources_and_builder_have_no_inverse_backedge(self):
        builder=load('arena-ypal-native-return-v2-manifest.py');value=builder.build(HERE)
        self.assertEqual(value,json.loads((HERE/w.MANIFEST.name).read_bytes()));self.assertEqual(len(value['files']),344)
        self.assertEqual(value['files'][w.INVERSE.name],w.INVERSE_SHA)
        self.assertEqual(value['files'][w.EFFECT_SOURCE.name],w.EFFECT_SOURCE_SHA)
        self.assertNotIn(w.FILE.name,inverse.SOURCE_PINS)
        self.assertNotEqual(w.INVERSE_SHA,previous.INVERSE_SHA);self.assertNotEqual(w.EFFECT_SOURCE_SHA,previous.EFFECT_SOURCE_SHA)

    def test_complete_return_body_changes_only_declared_composition_seams(self):
        before=ast.parse(public(w.FROZEN,w.FROZEN_SHA));after=ast.parse(derived_raw)
        functions=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
        a,b=functions(before),functions(after);self.assertEqual(a.keys(),b.keys())
        self.assertEqual({name for name in a if a[name]!=b[name]},{'composition'})
        for name in ['public','completed_predecessor','validate_completed_refs','postfeature_source','validate_native_return_leaf','main']:
            self.assertEqual(a[name],b[name],name)
        self.assertEqual(m.successor_derivation['producerSha256'],w.sha(public(w.FILE)))
        self.assertFalse(m.successor_derivation['oldCLIResultClaimed'])

    def test_upstream_is_the_actual_expanded_inverse2_not_its_thin_producer(self):
        with patch.object(m,'public',side_effect=public):raw=w.upstream_source(m)
        with patch.object(inverse,'public',side_effect=public):expected=inverse.authenticated_full_source()
        self.assertEqual(raw,expected);self.assertNotEqual(w.sha(raw),w.INVERSE_SHA)
        self.assertEqual(w.sha(public(w.INVERSE,w.INVERSE_SHA)),w.INVERSE_SHA)
        namespace=ast.parse(raw)
        fmt=next(n.value.value for n in namespace.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='FORMAT'for t in n.targets))
        self.assertEqual(fmt,w.INVERSE_FORMAT)

    def test_every_inverse_dependency_is_authenticated_before_its_evaluation(self):
        for refused in [w.INVERSE,w.INVERSE_MANIFEST,w.OPS/'ypal-ordinary-restored-source-prefix-v3.py',w.OPS/'arena-native-read-pool-v1.mjs']:
            def changed(path,*args,**kwargs):
                if Path(path)==refused:raise RuntimeError('actual_inverse_source_drift')
                return public(path,*args,**kwargs)
            with self.subTest(path=refused),patch.object(m,'public',side_effect=changed),self.assertRaisesRegex(RuntimeError,'actual_inverse_source_drift'):
                w.upstream_source(m)

    def test_old_return_source_inverse_producers_and_receipts_refuse(self):
        entry,_=legacy.composed();row=legacy.plan()
        for change in[{'format':previous.FORMAT},{'childSha256':previous.CHILD_SHA},
            {'effectSource':{**row['effectSource'],'producerSha256':previous.EFFECT_SOURCE_SHA}},
            {'completedInverse':{**row['completedInverse'],'producerSha256':previous.INVERSE_SHA}},
            {'completedInverse':{**row['completedInverse'],'manifestSha256':previous.INVERSE_MANIFEST_SHA}}]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):entry.validate_plan({**row,**change})

    def test_full_effect_and_reconcile_bodies_use_matching_native_return2_wire(self):
        entry,value=legacy.composed()
        def constants(code):
            out=[]
            for item in code.co_consts:
                if isinstance(item,types.CodeType):out.extend(constants(item))
                elif isinstance(item,str):out.append(item)
            return out
        strings=[]
        for cls in value.Host.__mro__:
            child=cls.__dict__.get('child')
            if isinstance(child,types.FunctionType):strings.extend(constants(child.__code__))
        self.assertIn('yunipals-arena-ypal-native-return-authority-v2',strings)
        self.assertNotIn('yunipals-arena-ypal-native-return-authority-v1',strings)
        self.assertEqual(entry.CHILD_SHA,w.sha(public(w.CHILD)))
        self.assertIn('native',value.Host.child.__code__.co_consts);self.assertNotIn('target',value.Host.child.__code__.co_consts)


if __name__=='__main__':unittest.main()
