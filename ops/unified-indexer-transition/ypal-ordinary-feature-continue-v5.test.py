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
owner=load('ypal-ordinary-feature-handover-continue-v5.py')
context=load('ypal-ordinary-feature-context-continue-v5.py')
original_owner=load('ypal-ordinary-feature-handover-continue-v2.py')
bound_owner=load('ypal-ordinary-feature-handover-bound-v1.py')
original_context=load('ypal-ordinary-feature-context-continue-v2.py')
bound_context=load('ypal-ordinary-feature-context-bound-v1.py')
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
        self.enterContext(patch.object(owner,'template',return_value=(original_owner,(HERE/'ypal-ordinary-feature-handover-continue-v2.py').read_bytes())))
        self.enterContext(patch.object(context,'template',return_value=(original_context,(HERE/'ypal-ordinary-feature-context-continue-v2.py').read_bytes())))
        bound_owner.helper=lambda:h;bound_context.helper=lambda:h
        self.enterContext(patch.object(original_owner,'template',return_value=(bound_owner,(HERE/'ypal-ordinary-feature-handover-bound-v1.py').read_bytes())))
        self.enterContext(patch.object(original_context,'template',return_value=(bound_context,(HERE/'ypal-ordinary-feature-context-bound-v1.py').read_bytes())))
        actual=h.derive
        def derive(*args,**kwargs):
            value=actual(*args,**kwargs)
            if Path(args[2]).name==owner.FILE.name:value.template=lambda:(bound_owner,(HERE/'ypal-ordinary-feature-handover-bound-v1.py').read_bytes())
            if Path(args[2]).name==context.FILE.name:value.template=lambda:(bound_context,(HERE/'ypal-ordinary-feature-context-bound-v1.py').read_bytes())
            return value
        self.enterContext(patch.object(h,'derive',side_effect=derive))


    def test_actual_nested_owner_has_new_roots_selectors_and_private_context_identity(self):
        value=owner.composition().composition()
        self.assertEqual(value.FORMAT,owner.FORMAT);self.assertEqual(value.BASE,owner.BASE)
        self.assertEqual(value.CONTEXT,owner.CONTEXT);self.assertEqual(value.INPUT,owner.INPUT)
        raw=(HERE/'ypal-feature-handover-v1.py').read_bytes()
        marker=context
        # Static assembly only; its constructors are not invoked.
        namespace=value.assemble(raw,marker,(HERE/'ypal-restored-feature-handover-v1.py').read_bytes())
        self.assertEqual(namespace.SELECTOR,Path('/etc/yunipals-unified/booster-ypal-feature-continue-v5.public.env'))
        self.assertTrue(all(path.name=='98-ypal-feature-continue-v5.conf'for path in namespace.DROPS.values()))

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
        builder=load('ypal-ordinary-feature-continue-v5-manifest.py');manifest=builder.build(HERE)
        self.assertEqual(manifest['format'],owner.FORMAT+'-code')
        self.assertEqual(set(manifest['files']),{owner.FILE.name,context.FILE.name})
        reader=json.loads(local(context.READER_MANIFEST))
        self.assertEqual(reader['acknowledgementRoute'],{'file':context.READER,'sha256':manifest['dependencies'][context.READER],'method':'acknowledgement'})
        self.assertFalse(set(manifest['files'])&set(reader['dependencies']))

    def test_original_template_bytes_rechecked_before_evaluation(self):
        with patch.object(owner,'OPS',HERE),patch.object(owner,'template',new=load('ypal-ordinary-feature-handover-continue-v5.py').template):
            # Bind the real loader's globals to the repository source origin.
            actual=load('ypal-ordinary-feature-handover-continue-v5.py');actual.OPS=HERE
            actual.template()
            original=Path.read_bytes
            def read(path):
                raw=original(path)
                return raw+b'\n'if path.name=='ypal-ordinary-feature-handover-continue-v2.py'else raw
            with patch.object(Path,'read_bytes',new=read),self.assertRaises(RuntimeError):actual.template()

    def test_import_and_default_CLIs_are_inert(self):
        for path in [owner.__file__,context.__file__]:
            result=subprocess.run([sys.executable,'-I','-B',path],capture_output=True,text=True,check=True)
            value=json.loads(result.stdout);self.assertEqual(value['databaseWrites'],0);self.assertFalse(value.get('currentWriterQualified',False))

    def test_metadata_constructor_uses_actual_immutable_reader_operation_epoch(self):
        refs={'mode':'current','resultSha256':'1'*64,'inputSha256':'2'*64,'producerSha256':'3'*64,'manifestSha256':'4'*64}
        operation={'binding':{'metadata':{'metadataEpoch':{'refs':refs,'acknowledgement':{'metadataInputSha256':'5'*64}}}}}
        acknowledgement={'validated':True,'immutableReaderAcknowledgementOnly':True,'operatorSha256':'6'*64,
            'receiptSha256':'7'*64,'manifestSha256':'8'*64,'operationSha256':h.sha(h.encoded(operation))}
        files={Path('/reader/operation.json'):(operation,acknowledgement['operationSha256']),
            Path('/cache/input.json'):({'metadataInputSha256':'5'*64},'9'*64)}
        def document(path,digest):
            value,expected=files[path];self.assertEqual(digest,expected);return copy.deepcopy(value)
        host=types.SimpleNamespace(config={'readerResultSha256':'7'*64,'readerManifestSha256':'8'*64,'cacheInputsSha256':'9'*64},
            manifest={'dependencies':{context.READER:'6'*64}},b=types.SimpleNamespace(document=document),
            coordinator=types.SimpleNamespace(BASE=Path('/reader'),acknowledgement=lambda *args:acknowledgement),
            provider=types.SimpleNamespace(INPUT=Path('/cache/input.json')))
        self.assertEqual(context.metadata_ancestry(host),refs)
        acknowledgement['immutableReaderAcknowledgementOnly']=False
        with self.assertRaises(RuntimeError):context.metadata_ancestry(host)

    def test_initializer_only_adapts_fixed_provider_metadata_interface(self):
        calls=[];refs={'mode':'current'};provider=types.SimpleNamespace(cache_runtime=lambda *args,**kw:(calls.append((args,kw))or 'real-cache'))
        b=types.SimpleNamespace(module=lambda path,digest:provider,marker='original-records')
        def initialize(host,records,*args):
            self.assertEqual(records.marker,'original-records')
            host.provider=records.module(context.OPS/context.PROVIDER,'a'*64)
            self.assertEqual(host.provider.cache_runtime('config','actual-manifest'),'real-cache')
        current=context.composition()
        with patch.object(current,'composition',return_value=types.SimpleNamespace(initialize=initialize)),\
             patch.object(current,'metadata_ancestry',return_value=refs):
            current.initialize(types.SimpleNamespace(),b,'manifest','input',None,None)
        self.assertEqual(calls,[(('config','actual-manifest'),{'metadata_refs':refs})])


if __name__=='__main__':unittest.main()
