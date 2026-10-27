"""Retain nine genuine producer controls plus explicit v2 identity/body checks."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
outer=load('arena-native-derived-projector-current-v2.py')
previous=load('arena-native-derived-projector-current-v1.test.py')
with patch.object(outer,'protected',side_effect=previous.local):actual=outer.composition()
old=previous.m
previous.m=actual

class Controls(previous.Controls):
    def test_default_and_renderer_are_inert(self):
        result=subprocess.run(['python3','-B',str(HERE/outer.FILE.name)],check=True,capture_output=True)
        self.assertTrue(__import__('json').loads(result.stdout)['staticOnly']);self.assertFalse(result.stderr)
        stream=io.StringIO()
        with patch.object(sys,'argv',[str(outer.FILE),'--render-input','a'*64]),contextlib.redirect_stdout(stream):actual.main()
        value=__import__('json').loads(stream.getvalue());self.assertEqual(value['format'],outer.FORMAT+'-input')
        self.assertEqual(value['projectorInputSha256'],'a'*64)

    def test_actual_finite_current_source_closure_authenticates_before_any_context(self):
        with patch.object(outer,'protected',side_effect=previous.local):manifest=outer.authenticate()
        self.assertEqual(len(manifest['files']),174);self.assertEqual(len(manifest['externalPrograms']),6)
        def bad(path,digest=None,maximum=4000000):
            if Path(path).name=='arena-native-derived-projector-current-v2.mjs':raise RuntimeError('changed current2 inspector')
            return previous.local(path,digest,maximum)
        with patch.object(outer,'protected',side_effect=bad),self.assertRaisesRegex(RuntimeError,'changed current2 inspector'):outer.authenticate()

    def test_every_producer_body_and_context_method_is_the_actual_frozen_v1_body(self):
        self.assertEqual(actual.fresh_forward_reuse['templateSha256'],outer.PREVIOUS_CURRENT_PRODUCER_SHA)
        self.assertFalse(actual.fresh_forward_reuse['historicalModulePatched'])
        for name,value in vars(old).items():
            if isinstance(value,types.FunctionType):
                target=getattr(actual,name);self.assertEqual(target.__code__.co_code,value.__code__.co_code,name)
                self.assertEqual(target.__code__.co_consts,value.__code__.co_consts,name)
            if isinstance(value,type)and name=='Context':
                for method,body in vars(value).items():
                    if isinstance(body,types.FunctionType):
                        target=getattr(actual.Context,method);self.assertEqual(target.__code__.co_code,body.__code__.co_code,method)
                        self.assertEqual(target.__code__.co_consts,body.__code__.co_consts,method)
        self.assertNotEqual(actual.BASE,old.BASE);self.assertNotEqual(actual.INPUT,old.INPUT)
        self.assertNotEqual(actual.FILE,old.FILE);self.assertNotEqual(actual.NODE_PROGRAM,old.NODE_PROGRAM)
        self.assertEqual(actual.SERVICE_BASE,old.SERVICE_BASE);self.assertEqual(actual.SERVICE_SHA,old.SERVICE_SHA)

    def test_node_diff_is_only_version_and_raw_Buffer_hash_fix(self):
        before=(HERE/'arena-native-derived-projector-current-v1.mjs').read_text()
        after=(HERE/'arena-native-derived-projector-current-v2.mjs').read_text()
        corrected=after.replace("export const FORMAT='yunipals-arena-native-derived-projector-current-v2';",
            "export const FORMAT='yunipals-arena-native-derived-projector-current-v1';")
        corrected=corrected.replace("typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)",
            "typeof value==='string'?value:JSON.stringify(value)")
        self.assertEqual(corrected,before)
        self.assertEqual(actual.SOURCE_PINS['arena-native-derived-projector-current-v1.py'],outer.PREVIOUS_CURRENT_PRODUCER_SHA)

if __name__=='__main__':unittest.main()
