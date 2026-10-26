#!/usr/bin/env python3
"""Retained complete inverse controls plus actual Reader5 and CLI seams.

Actor/SQL/source observations are explicit fixtures. Protected local source
bytes, durable phase files, the CLI and the retained lock are exercised.
"""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value);return value


wrapper=load('ypal-native-metadata-approval-inverse-v2.py')
frozen=load('ypal-native-metadata-approval-inverse-v1.py')


def local(path,digest=None):
    name=Path(path).name;path=HERE/name
    if not path.exists()and name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/name
    if not path.exists()and name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/name
    raw=path.read_bytes()
    wrapper.need(digest is None or wrapper.sha(raw)==digest,'exact_actual_inverse2_source_fixture_required')
    return raw


def namespace():
    with patch.object(wrapper,'protected',side_effect=local),patch.object(wrapper,'FILE',HERE/wrapper.FILE.name):
        return wrapper.composition()


m=namespace()
raw=(HERE/'ypal-native-metadata-approval-inverse-v1.test.py').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='30ec8b6e05a6c6fdc855873f2b9ce350e1987bd4c852324c45119bf01c06d782'
body=[]
for node in ast.parse(raw).body:
    if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='m'for t in node.targets):continue
    if isinstance(node,ast.If)and ast.unparse(node.test)=="__name__ == '__main__'":continue
    body.append(node)
scope={'m':m,'__name__':'actual_inverse2_retained_controls','__file__':str(HERE/'ypal-native-metadata-approval-inverse-v2.test.py')}
exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),scope['__file__'],'exec'),scope)
RetainedControls=scope['Controls']


def code(value):
    value=value.__code__ if hasattr(value,'__code__')else value
    return(value.co_code,value.co_names,tuple(code(x)if isinstance(x,types.CodeType)else x for x in value.co_consts))


class NamespaceControls(unittest.TestCase):
    def test_complete_real_source_manifest_and_no_owned_source_backedge(self):
        built=load('ypal-native-metadata-approval-inverse-v2-manifest.py').build()
        self.assertEqual((wrapper.FORMAT+'-source'),built['format'])
        self.assertEqual(json.loads(local(wrapper.MANIFEST)),built)
        self.assertEqual(built['files'],{wrapper.FILE.name:wrapper.sha(local(wrapper.FILE)),**wrapper.SOURCE_PINS})
        for name,digest in built['files'].items():local(name,digest)
        self.assertNotIn(wrapper.SOURCE,built['files'])
        self.assertNotIn('ypal-ordinary-consumer-inverse-prefix-v3.py',built['files'])
        self.assertEqual(wrapper.sha(local(wrapper.FROZEN)),wrapper.FROZEN_SHA)

    def test_all_actual_complete_definitions_keep_original_code_and_constants(self):
        value=namespace()
        for name,item in vars(frozen).items():
            if isinstance(item,types.FunctionType):self.assertEqual(code(getattr(value,name)),code(item),name)
        for name,item in vars(frozen.InverseContext).items():
            if isinstance(item,types.FunctionType):self.assertEqual(code(getattr(value.InverseContext,name)),code(item),name)
        self.assertEqual(value.fresh_forward_reuse['constants'],sorted([
            'FORMAT','FILE','MANIFEST','INPUT','BASE','READER','READER_MANIFEST','SOURCE','SOURCE_FORMAT','SOURCE_PINS']))
        self.assertEqual(value.fresh_forward_reuse['overrides'],[])
        self.assertFalse(value.successor_derivation['originalInverseTemplateCLIPassed'])

    def test_actual_reader5_core3_and_own_identity_seams(self):
        value=namespace()
        self.assertEqual(value.READER,'ypal-ordinary-reader-continue-v5.py')
        self.assertEqual(value.SOURCE,'ypal-ordinary-consumer-prefix-source-v3.py')
        self.assertEqual(value.SOURCE_FORMAT,'yunipals-ordinary-consumer-prefix-source-v3')
        self.assertEqual(value.SOURCE_PINS[value.READER],'c108f1c9c10e9838b05309be28d34afbbb64c369bfe83d5641dc9d09b6762241')
        self.assertEqual(value.SOURCE_PINS[value.READER_MANIFEST],'455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405')
        self.assertEqual(value.FORMAT,wrapper.FORMAT);self.assertEqual(value.BASE,wrapper.BASE)
        self.assertNotEqual(value.BASE,frozen.BASE);self.assertTrue(str(value.BASE).endswith('v2-20261026'))
        self.assertEqual(value.own_sha(),wrapper.sha(local(wrapper.FILE)))
        self.assertNotEqual(value.own_sha(),wrapper.FROZEN_SHA)

    def test_whole_source_prevalidation_finishes_before_any_template_evaluation(self):
        def damaged(path,digest=None):
            if Path(path).name==wrapper.READER:raise RuntimeError('fixture_foreign_reader5_bytes')
            return local(path,digest)
        with patch.object(wrapper,'FILE',HERE/wrapper.FILE.name),patch.object(wrapper,'protected',side_effect=damaged),\
                patch.object(wrapper.types,'ModuleType',side_effect=AssertionError('evaluation_before_complete_preauth')):
            with self.assertRaisesRegex(RuntimeError,'foreign_reader5'):wrapper.composition()

    def test_real_default_cli_is_inert_without_installed_sources(self):
        result=subprocess.run([sys.executable,'-I','-B',str(HERE/wrapper.FILE.name)],capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'format':wrapper.FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0})

    def test_real_CLI_review_and_inverse_use_genuine_contextmanager_and_lock(self):
        value=namespace();owner=scope['upstream'];events=[]
        with tempfile.TemporaryDirectory(prefix='metadata-inverse2-cli-',dir=HERE)as folder:
            lock=Path(folder)/'transition.lock'
            context=types.SimpleNamespace(owner=owner,lease=None,active_step=None)
            context.review=lambda:(events.append('review')or {'sessions':{'owned':[{'positive':True}],'otherPeers':[]},'actor':'same'})
            context.inverse=lambda digest:(events.append(('inverse',digest))or {'completed':True})
            # The complete retained fence checks the actual live lock lease.
            context.inputs=lambda:events.append('inputs')
            context.full_source=lambda:events.append('full-source')
            context.fence=types.MethodType(value.clone_method(owner,'fence'),context)
            context.fence.__func__.__globals__['LOCK']=lock
            for args in [['--review'],['--inverse','a'*64]]:
                with patch.dict(owner.transition_lock.__wrapped__.__globals__,{'LOCK':lock}),\
                        patch.object(value,'context',return_value=context),patch.object(value.socket,'gethostname',return_value='yunipals-main'),\
                        patch.object(sys,'argv',[str(wrapper.FILE),'--input-sha','b'*64,*args]),contextlib.redirect_stdout(io.StringIO()):
                    # Enter the actual decorator, then the original flock lease.
                    original_review=context.review;original_inverse=context.inverse
                    def review():context.fence();return original_review()
                    def inverse(digest):context.fence();return original_inverse(digest)
                    context.review,context.inverse=review,inverse
                    try:value.main()
                    finally:context.review,context.inverse=original_review,original_inverse
                self.assertIsNone(context.lease)
            self.assertIn('full-source',events);self.assertIn(('inverse','a'*64),events)
            with self.assertRaises(RuntimeError):context.fence()


if __name__=='__main__':unittest.main()
