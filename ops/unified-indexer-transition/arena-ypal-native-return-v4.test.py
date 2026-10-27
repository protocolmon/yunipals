#!/usr/bin/env python3
"""Actual return3 derivations; observations and receipts are synthetic fixtures."""
import ast
import copy
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


w=load('arena-ypal-native-return-v4.py')
inverse=load('arena-ypal-business-inverse-v4.py')
previous=load('arena-ypal-native-return-v1.py')


def public(path,expected=None,maximum=4000000,private=False):
    path=Path(path);source=HERE/path.name
    if path.parent==Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023'):
        source=HERE.parent/'arena-public-rollback-target-20261023'/path.name
    if not source.exists()and path.name=='final-supervisor-inventory-v1.py':source=HERE.parent/'solana-acceptance'/path.name
    if not source.exists()and path.name=='ypal-old-runtime-inventory-v1.py':source=HERE.parent/'booster-launch'/path.name
    raw=source.read_bytes();w.need(0<len(raw)<=maximum and(expected is None or w.sha(raw)==expected),'actual_local_return3_source_required')
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
            counts['builder']+=1;node.value='arena-ypal-native-return-v4-manifest.py'
        return node
    def visit_Call(self,node):
        if ast.unparse(node)=="__import__('inspect').getsource(m.composition)":
            counts['source-view']+=1;return ast.copy_location(ast.Call(func=ast.Name(id='authenticated_composition_source',ctx=ast.Load()),args=[],keywords=[]),node)
        return self.generic_visit(node)
tree=TestSources().visit(tree);w.need(counts=={'builder':1,'source-view':1},'two_actual_retained_return_test_source_seams_required')
tree.body=[node for node in tree.body if not(isinstance(node,ast.If)and ast.unparse(node.test)=="__name__ == '__main__'")]
legacy=types.ModuleType('actual_retained_return3_controls');legacy.__file__=str(HERE/'arena-ypal-native-return-v1.test.py')
legacy.authenticated_composition_source=lambda:ast.unparse(next(n for n in ast.parse(derived_raw).body if isinstance(n,ast.FunctionDef)and n.name=='composition'))
exec(compile(ast.fix_missing_locations(tree),legacy.__file__,'exec'),legacy.__dict__)
legacy.m=m;legacy.old.m=actual_inverse;legacy.old.local_public=public
RetainedControls=legacy.Controls


class SuccessorControls(unittest.TestCase):
    def test_all_actual_sources_and_builder_have_no_inverse_backedge(self):
        builder=load('arena-ypal-native-return-v4-manifest.py');value=builder.build(HERE)
        self.assertEqual(value,json.loads((HERE/w.MANIFEST.name).read_bytes()));self.assertEqual(len(value['files']),434)
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

    def test_upstream_is_the_actual_expanded_inverse3_not_its_thin_producer(self):
        with patch.object(m,'public',side_effect=public):raw=w.upstream_source(m)
        with patch.object(inverse,'public',side_effect=public):expected=inverse.authenticated_full_source()
        self.assertEqual(raw,expected);self.assertNotEqual(w.sha(raw),w.INVERSE_SHA)
        self.assertEqual(w.sha(public(w.INVERSE,w.INVERSE_SHA)),w.INVERSE_SHA)
        namespace=ast.parse(raw)
        fmt=next(n.value.value for n in namespace.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='FORMAT'for t in n.targets))
        self.assertEqual(fmt,w.INVERSE_FORMAT)

    def test_every_inverse_dependency_is_authenticated_before_its_evaluation(self):
        for refused in [w.INVERSE,w.INVERSE_MANIFEST,w.OPS/'ypal-ordinary-restored-source-prefix-v5.py',w.OPS/'arena-native-read-pool-v1.mjs']:
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

    def test_full_effect_and_reconcile_bodies_use_matching_native_return3_wire(self):
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
        self.assertIn('yunipals-arena-ypal-native-return-authority-v4',strings)
        self.assertNotIn('yunipals-arena-ypal-native-return-authority-v1',strings)
        self.assertEqual(entry.CHILD_SHA,w.sha(public(w.CHILD)))
        self.assertIn('native',value.Host.child.__code__.co_consts);self.assertNotIn('target',value.Host.child.__code__.co_consts)

    def test_previous_Return2_and_C2_cannot_authorize_this_fresh_operation(self):
        prior=load('arena-ypal-native-return-v2.py');entry,_=legacy.composed();row=legacy.plan()
        for change in [{'format':prior.FORMAT},{'childSha256':prior.CHILD_SHA},
            {'effectSource':{**row['effectSource'],'producerSha256':prior.EFFECT_SOURCE_SHA}},
            {'completedInverse':{**row['completedInverse'],'producerSha256':prior.INVERSE_SHA}},
            {'completedInverse':{**row['completedInverse'],'manifestSha256':prior.INVERSE_MANIFEST_SHA}}]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):entry.validate_plan({**row,**change})

    def test_complete_Return2_body_has_only_the_declared_composition_delta(self):
        prior=load('arena-ypal-native-return-v2.py')
        with patch.object(prior,'public',side_effect=public):before=prior.authenticated_full_source()
        functions=lambda raw:{node.name:ast.dump(node,include_attributes=False)for node in ast.parse(raw).body
            if isinstance(node,(ast.FunctionDef,ast.ClassDef))}
        a,b=functions(before),functions(derived_raw);self.assertEqual(a.keys(),b.keys())
        self.assertEqual({name for name in a if a[name]!=b[name]},{'composition'})

    def test_actual_C4_producer_and_expanded_body_identities_stay_distinct(self):
        self.assertEqual(w.INVERSE_SHA,w.sha(public(w.INVERSE)))
        self.assertNotEqual(w.INVERSE_SHA,'95f103c9c133565c18dd465a78473295dbf7eb2b8cfec7c6ea9c263ec8bee881')
        self.assertEqual(w.EFFECT_SOURCE_SHA,'a6b6c7312fec21151ea9573b08bae1cbbdb63a95ca648d8b81a633f28f4fa7cd')
        with patch.object(m,'public',side_effect=public):raw=w.upstream_source(m)
        self.assertNotEqual(w.sha(raw),w.INVERSE_SHA)
        self.assertEqual(m.successor_derivation['inverseProducerSha256'],w.INVERSE_SHA)
        self.assertEqual(w.sha(public(w.CHILD)),w.CHILD_SHA)
        self.assertNotIn(w.FILE.name,inverse.SOURCE_PINS)


class CurrentServiceControls(unittest.TestCase):
    def test_return_uses_actual_current2_and_original_service_identity(self):
        fixtures=load('arena-ypal-business-inverse-v4.test.py');entry,value=legacy.composed()
        host=value.Host.__new__(value.Host);host.plan=legacy.plan();proof=fixtures.projection_fixture(host,value)
        api=types.SimpleNamespace(sha=entry.sha,encoded=entry.encoded,validate_current=lambda *_:copy.deepcopy(proof))
        with patch.object(entry,'projection_namespace',return_value=api):
            self.assertEqual(host.projection_current(),proof['binding'])
        self.assertEqual(host.projection_service_refs['producerSha256'],fixtures.w.PROJECTION_SERVICE_SHA)
        self.assertNotEqual(host.projection_service_refs['producerSha256'],host.plan['projection']['producerSha256'])
        identity=proof['binding']['service']['readPoolIdentity']
        self.assertEqual(host.checked_read_pool_identity(identity),identity)
        with self.assertRaises(RuntimeError):host.checked_read_pool_identity({**identity,'producerSha256':host.plan['projection']['producerSha256']})

    def test_real_native_descriptor_transport_with_new_connector_envelope(self):
        fixtures=load('arena-ypal-business-inverse-v4.test.py');entry,value=legacy.composed()
        function=copy.deepcopy(fixtures.transport);count=0;parent_count=0
        for node in ast.walk(function):
            if isinstance(node,ast.Constant)and node.value=='target':node.value='native';count+=1
            if isinstance(node,ast.Assign)and ast.unparse(node.value)=='value.Host.__mro__[1].child.__globals__':
                node.value=ast.parse('value.Host.__mro__[2].child.__globals__',mode='eval').body;parent_count+=1
        self.assertEqual(count,2)
        self.assertEqual(parent_count,1)
        scope={**fixtures.legacy.__dict__,'composed':lambda:value,'plan':legacy.plan,'m':entry,
            'pool_identity':fixtures.pool_fixture}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),str(HERE/w.FILE.name)+':native-FD-fixture','exec'),scope)
        scope['transported_child'](self)
        scope['transported_child'](self,reconcile=True)

    def test_actual_new_native_child_requires_matching_real_sealed_authority(self):
        seals=load('arena-ypal-restored-v1.py');payload=b'actual-return4-wire-fixture'
        packet={'format':'yunipals-arena-ypal-native-return-authority-v4','action':'inspect',
            'payloadSha256':w.sha(payload),'childSha256':w.CHILD_SHA}
        code="""import{readFileSync}from'node:fs';
import{composition}from'./ops/unified-indexer-transition/arena-ypal-native-return-child-v4.mjs';
const read=n=>readFileSync('./ops/unified-indexer-transition/'+n);
const n=await composition(read('arena-ypal-native-return-child-v1.mjs'),read('arena-ypal-business-inverse-child-v4.mjs'),read('arena-ypal-business-inverse-child-v1.mjs'),read('arena-modern-public-rollback-v1.mjs'));
n.authority(Number(process.argv[1]),'inspect',Buffer.from('actual-return4-wire-fixture'),process.argv[2]);
"""
        for accepted,record in [(True,packet),(False,{**packet,'format':'yunipals-arena-ypal-native-return-authority-v3'}),
                (False,{**packet,'childSha256':load('arena-ypal-native-return-v3.py').CHILD_SHA})]:
            fd=seals.sealed('arena-public-root-authority',w.encoded(record))
            try:
                result=subprocess.run(['/root/.nvm/versions/node/v24.18.1/bin/node','--input-type=module','-e',code,str(fd),w.CHILD_SHA],
                    cwd=HERE.parent.parent,pass_fds=(fd,),capture_output=True,timeout=10)
                self.assertEqual(result.returncode==0,accepted,result.stderr.decode())
            finally:os.close(fd)


if __name__=='__main__':unittest.main()
