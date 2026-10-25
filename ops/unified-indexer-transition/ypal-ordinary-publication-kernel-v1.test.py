"""Actual caller/guard composition; no live qualification or effect execution."""
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


graph=load('ypal-ordinary-publication-accept-v2.test.py')
m=load('ypal-ordinary-publication-kernel-v1.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.control=graph.Controls();self.control.setUp();self.addCleanup(self.control.doCleanups)
        self.h=graph.value.h;original=self.control.public
        def public(path,digest=None,maximum=200000):
            if Path(path).name=='ypal-old-runtime-inventory-v1.py':
                raw=(HERE.parent/'booster-launch'/Path(path).name).read_bytes()
                self.h.need(len(raw)<=maximum and(digest is None or self.h.sha(raw)==digest),'actual_frozen_observer_source_required');return raw
            return original(path,digest,maximum)
        self.public=public
        self.enterContext(patch.object(self.control.impl,'public',side_effect=public))
        self.enterContext(patch.object(m,'helper',return_value=self.h))

    def test_new_guard_six_source_closure_before_actual_module_and_full_body(self):
        events=[]
        def public(path,*args):events.append(Path(path).name);return self.public(path,*args)
        with patch.object(self.control.impl,'public',side_effect=public):guard=m.guard_module()
        self.assertTrue(set(json.loads(self.public(m.GUARD_MANIFEST))['files'])<=set(events))
        guard.public=lambda path,digest:self.public(path,digest)
        current=guard.composition();old=load('ypal-ordinary-source-authority-v5.py')
        self.assertEqual(current.FORMAT,guard.FORMAT)
        for name in ['current','preflight','finish','_native','_snapshot']:
            first,second=getattr(current.Authority,name),getattr(old.Authority,name)
            first=getattr(first,'__wrapped__',first);second=getattr(second,'__wrapped__',second)
            self.assertEqual((first.__code__.co_code,first.__code__.co_consts),(second.__code__.co_code,second.__code__.co_consts),name)
        self.assertIs(current.current_kernel,guard.current_kernel)

    def test_real_final_namespace_retains_all_forward_business_and_constructor_bodies(self):
        caller=m.composed();old=load('ypal-ordinary-publication-caller-v6.py')
        self.assertEqual(caller.FORMAT,m.FORMAT);self.assertEqual(caller.BASE,m.BASE)
        self.assertEqual(caller.GUARD,m.GUARD);self.assertEqual(caller.GUARD_SHA,m.GUARD_SHA)
        self.assertEqual(caller.PROVIDER.name,'ypal-ordinary-read-cache-accept-v2.py')
        self.assertEqual(caller.READER.name,'ypal-ordinary-reader-accept-v2.py')
        for name in ['execute_cache','execute_reader','qualify','cache_callback_measurement','reader_callback_measurement','bind_proof']:
            self.assertEqual(getattr(caller,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
        for cls,name in [('PreparedMetadata','__init__'),('PreparedMetadata','invoke'),('ReaderPhase','__init__'),('BoundProvider','namespace')]:
            self.assertEqual(getattr(getattr(caller,cls),name).__code__.co_code,getattr(getattr(old,cls),name).__code__.co_code)

    def test_actual_timing_binding_rejects_old_guard_old_caller_and_other_mode(self):
        caller=m.composed();caller.own_sha=lambda:self.h.sha(self.public(m.FILE))
        session=types.SimpleNamespace(key={'target':'cache','inputSha256':'fixture-input','direction':'forward'},
            host=types.SimpleNamespace(config={'generationBindingSha256':self.control.binding_sha}),
            protocol=load('ypal-ordinary-publication-protocol-v6.py'))
        key=caller.timing_key(session,'cache-prepared')
        self.assertEqual(key['guardSha256'],m.GUARD_SHA)
        self.assertEqual(key['generationBindingSha256'],self.control.binding_sha)
        receipt={'binding':key,'completed':True,'elapsedNanoseconds':20000000000,'reservedEffectNanoseconds':0,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0,'syntheticTimingInputOnly':True}
        session.g=types.SimpleNamespace(public=lambda *_:self.h.encoded(receipt))
        reference={'captureId':'synthetic-kernel','sha256':'a'*64}
        self.assertEqual(caller.require_timing(session,reference,'cache-prepared'),receipt)
        for change in [{'guardSha256':'052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0'},
                       {'operatorSha256':m.LAYER_SHA},{'mode':'reader-before-login'}]:
            receipt['binding']={**key,**change}
            with self.assertRaises(RuntimeError):caller.require_timing(session,reference,'cache-prepared')

    def test_inverse_source_dispatch_is_explicitly_closed_before_old_thin_AST(self):
        caller=m.composed()
        with self.assertRaisesRegex(RuntimeError,'inverse_requires_separate_actual_prefix'):
            caller.SourcePhase({'resultSha256':'a'*64,'inputSha256':'b'*64},True)

    def test_default_import_has_no_source_or_private_input_reads(self):
        result=subprocess.run(['python3','-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True)
        value=json.loads(result.stdout);self.assertTrue(value['staticOnly']);self.assertFalse(value['callbackTimingQualified'])
        self.assertEqual(value['databaseWrites'],0);self.assertEqual(value['serviceActions'],0)


if __name__=='__main__':unittest.main()
