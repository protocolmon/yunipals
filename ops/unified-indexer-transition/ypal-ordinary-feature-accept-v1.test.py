"""Acceptance feature namespaces retain genuine business/event bodies."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
owner=load('ypal-ordinary-feature-handover-accept-v1.py')
context=load('ypal-ordinary-feature-context-accept-v1.py')
original_owner=load('ypal-ordinary-feature-handover-bound-v1.py')
original_context=load('ypal-ordinary-feature-context-bound-v1.py')
h=load('ypal-ordinary-generation-binding-v1.py')


def local(path,digest=None,maximum=4000000):
    raw=(HERE/Path(path).name).read_bytes()
    h.need(0<len(raw)<=maximum and(digest is None or h.sha(raw)==digest),'actual_accept_feature_source_fixture_required');return raw


def body(value):
    code=value.__code__ if hasattr(value,'__code__')else value
    return(code.co_code,code.co_names,tuple(body(item)if isinstance(item,types.CodeType)else item for item in code.co_consts))


class Controls(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(h,'public',side_effect=local))
        self.enterContext(patch.object(original_owner,'helper',return_value=h))
        self.enterContext(patch.object(original_context,'helper',return_value=h))
        self.enterContext(patch.object(owner,'template',return_value=(original_owner,(HERE/'ypal-ordinary-feature-handover-bound-v1.py').read_bytes())))
        self.enterContext(patch.object(context,'template',return_value=(original_context,(HERE/'ypal-ordinary-feature-context-bound-v1.py').read_bytes())))

    def test_actual_nested_owner_has_new_roots_selectors_and_private_context_identity(self):
        value=owner.composition().composition()
        self.assertEqual(value.FORMAT,owner.FORMAT);self.assertEqual(value.BASE,owner.BASE)
        self.assertEqual(value.CONTEXT,owner.CONTEXT);self.assertEqual(value.INPUT,owner.INPUT)
        raw=(HERE/'ypal-feature-handover-v1.py').read_bytes()
        marker=context
        # Static assembly only; its constructors are not invoked.
        namespace=value.assemble(raw,marker,(HERE/'ypal-restored-feature-handover-v1.py').read_bytes())
        self.assertEqual(namespace.SELECTOR,Path('/etc/yunipals-unified/booster-ypal-feature-accept-v1.public.env'))
        self.assertTrue(all(path.name=='98-ypal-feature-accept-v1.conf'for path in namespace.DROPS.values()))

    def test_actual_context_names_and_complete_finite_dependencies(self):
        value=context.composition();inner=value.composition()
        self.assertEqual(inner.PROVIDER,context.PROVIDER);self.assertEqual(inner.READER,context.READER)
        self.assertEqual(value.READER_MANIFEST,context.READER_MANIFEST);self.assertEqual(value.OWNER,context.OWNER)
        self.assertIn('ypal-ordinary-generation-binding-v1.py',context.PINNED)
        self.assertIn('ypal-ordinary-generation-accept-binding-v2.py',context.EXTERNAL)
        deps={**context.PINNED,**{name:h.sha(local(name))for name in context.EXTERNAL}}
        self.assertEqual(context.exact_dependencies(deps),deps)
        with self.assertRaises(RuntimeError):context.exact_dependencies({**deps,'untrusted.py':'a'*64})

    def test_real_fresh_event_nine_column_gate_and_all_other_business_methods_retained(self):
        current=context.composition().composition();baseline=original_context.composition()
        for name,fn in baseline.HostMixin.__dict__.items():
            if hasattr(fn,'__code__'):self.assertEqual(body(getattr(current.HostMixin,name)),body(fn),name)
        self.assertEqual(body(current.inverse_leaf),body(baseline.inverse_leaf))
        self.assertEqual(body(owner.composition().composition().validate_feature_leaf),
                         body(original_owner.composition().validate_feature_leaf))

    def test_actual_manifest_and_immutable_ACK_route_have_no_feature_backedge(self):
        builder=load('ypal-ordinary-feature-accept-v1-manifest.py');manifest=builder.build(HERE)
        self.assertEqual(manifest['format'],owner.FORMAT+'-code')
        self.assertEqual(set(manifest['files']),{owner.FILE.name,context.FILE.name})
        reader=json.loads(local(context.READER_MANIFEST))
        self.assertEqual(reader['acknowledgementRoute'],{'file':context.READER,'sha256':manifest['dependencies'][context.READER],'method':'acknowledgement'})
        self.assertFalse(set(manifest['files'])&set(reader['dependencies']))

    def test_original_template_bytes_rechecked_before_evaluation(self):
        with patch.object(owner,'OPS',HERE),patch.object(owner,'template',new=load('ypal-ordinary-feature-handover-accept-v1.py').template):
            # Bind the real loader's globals to the repository source origin.
            actual=load('ypal-ordinary-feature-handover-accept-v1.py');actual.OPS=HERE
            actual.template()
            original=Path.read_bytes
            def read(path):
                raw=original(path)
                return raw+b'\n'if path.name=='ypal-ordinary-feature-handover-bound-v1.py'else raw
            with patch.object(Path,'read_bytes',new=read),self.assertRaises(RuntimeError):actual.template()

    def test_import_and_default_CLIs_are_inert(self):
        for path in [owner.__file__,context.__file__]:
            result=subprocess.run([sys.executable,'-I','-B',path],capture_output=True,text=True,check=True)
            value=json.loads(result.stdout);self.assertEqual(value['databaseWrites'],0);self.assertFalse(value.get('currentWriterQualified',False))


if __name__=='__main__':unittest.main()
