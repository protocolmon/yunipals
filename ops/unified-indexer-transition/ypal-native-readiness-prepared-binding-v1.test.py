"""Exact double-bound constructor regression; OS/private/DB workload I/O is local."""
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n);return n
m=load('ypal-native-readiness-prepared-binding-v1.py')
frozen_tests=load('ypal-ordinary-readiness-family-v1.test.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.f=frozen_tests.Controls();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.family=self.f.family;self.context=self.family.readiness;self.caller=self.f.caller();self.selected=None
        self.enterContext(patch.object(m,'public',side_effect=frozen_tests.local))
        real_load=m.load
        def source(name):
            n=real_load(name)
            if name=='ypal-ordinary-source-authority-v6.py':n.public=frozen_tests.local
            return n
        self.enterContext(patch.object(m,'load',side_effect=source))
        original_bind=self.context.bind_source_guard
        owner=types.SimpleNamespace(c=types.SimpleNamespace(host_module=load('ypal-alchemy-source-switch-v1.host.py')))
        def relocate(raw):
            raw.public=frozen_tests.local;parent=raw.Authority;original=parent.__init__
            def bootstrap(path,digest):
                frozen_tests.local(path,digest)
                if Path(path)==original.__globals__['INTAKE']:return types.SimpleNamespace(explicitIntakeIOFixture=True)
                if Path(path)==original.__globals__['RUNTIME']:return types.SimpleNamespace(Owner=lambda _:owner)
                raise AssertionError(str(path))
            inner=original.__wrapped__
            kernel=frozen_tests.m.clone(inner.__globals__['classified_kernel'],{'public':frozen_tests.local})
            # Only the constructor's bootstrap I/O moves. The retained READ
            # method's module/projection/file-frame globals remain genuine.
            relocated=frozen_tests.m.clone(inner,{'module':bootstrap,'classified_kernel':kernel})
            cells=tuple((lambda value:lambda:value)(relocated).__closure__[0]if name=='function'else cell
                for name,cell in zip(original.__code__.co_freevars,original.__closure__))
            parent.__init__=types.FunctionType(original.__code__,original.__globals__,original.__name__,original.__defaults__,cells)
            parent.__init__.__wrapped__=relocated
            raw.Authority=parent
            def module(path,digest):
                if Path(path).name=='ypal-ordinary-publication-query-v2.py':
                    frozen_tests.local(path,digest);return types.SimpleNamespace(bind=lambda _: {'explicitQueryPeerIOFixture':True})
                if Path(path).name=='ypal-ordinary-metadata-handover-v5.py'and self.selected is not None:
                    return types.SimpleNamespace(namespace=lambda _:self.selected)
                n=types.ModuleType(Path(path).stem);n.__file__=str(path)
                exec(compile(frozen_tests.local(path,digest),str(path),'exec'),n.__dict__);return n
            raw.module=module;return original_bind(raw)
        with patch.object(self.context,'bind_source_guard',side_effect=relocate):
            self.session=self.caller.Session({'resultSha256':'1'*64,'inputSha256':'2'*64},False)
        self.session.continuation_caller=self.caller
        self.assertIs(self.session.g,self.session.source.g)
        self.namespace=self.f.provider_namespace();self.cache=self.namespace.cache_runtime();self.selected=self.cache.metadata_epoch_namespace
        creator=frozen_tests.context_tests.m.Proxy(frozen_tests.context_tests.policy_tests.old_tests.m,
            __file__=str(frozen_tests.context_tests.m.CREATOR))
        self.primitives={'reader':creator,'created':{'target':copy.deepcopy(self.f.native.lifecycle.before['target'])},
            'readConfig':{'explicit':'admission-I/O'},'admission_ref':{'explicit':'admission-reference-I/O'}}
        self.events=[]
        self.host=types.SimpleNamespace(query=lambda _:copy.deepcopy(self.f.native.lifecycle.actual['target']),refresh=lambda:self.events.append('refresh'))
        self.selected.construct_context=lambda *_:self.host
        self.input=self.f.native.lifecycle.root/'prepared-input.json';self.input.write_bytes(b'actual protected frame fixture\n');self.input.chmod(0o600)
        self.selected.INPUT=self.input
        scope={'events':self.events}
        exec("def metadata(phase,candidate,selection,refresh):\n"
            " p=phase.metadata_primitives()\n"
            " construct_context(p['readConfig'],refresh,False,p,p['admission_ref'])\n"
            " events.append('inner-workload-I/O')\n"
            " return {'actualFullMetadataProofQualified':False}\n",scope)
        self.selected.metadata=frozen_tests.metadata.clone(frozen_tests.metadata.metadata,
            {'_retained_metadata':scope['metadata'],'construct_context':self.selected.construct_context,
                '_readiness':self.context,'_policy_observer':{'explicit':'new-actor-workload-I/O'}})
        self.phase=types.SimpleNamespace(cache=self.cache,metadata_primitives=lambda:self.primitives)

    def construct(self):return self.caller.PreparedMetadata(self.selected,self.phase,lambda:None,False,self.session.g)

    def test_exact_original_bound_guard_failure_then_real_constructor_and_invoke_succeed(self):
        before=self.caller.PreparedMetadata
        with self.assertRaises(KeyError)as error:self.construct()
        self.assertEqual(error.exception.args,('module',))
        binding=m.bind(self.session);slot=self.construct()
        self.assertEqual(slot.__init__.__func__.__code__,before.__init__.__code__)
        self.assertEqual(slot.invoke.__func__.__code__,before.invoke.__code__)
        self.assertIs(slot.g,self.session.g)
        self.assertIs(self.caller.ReaderPhase.__init__.__globals__['PreparedMetadata'],self.caller.PreparedMetadata)
        result=slot.invoke({},lambda:None,{})
        self.assertFalse(result['actualFullMetadataProofQualified']);self.assertIn('inner-workload-I/O',self.events)
        self.assertFalse(binding['originalFamily1ConstructorPassed'])
        self.input.write_bytes(b'changed same protected input inode\n')
        with self.assertRaisesRegex(RuntimeError,'immutable_metadata_constructor'):slot.invoke({},lambda:None,{})

    def test_wrong_guard_policy_and_retained_body_refuse_before_recomposition(self):
        original=self.caller.PreparedMetadata
        self.session.source.g=object()
        with self.assertRaises(RuntimeError):m.bind(self.session)
        self.session.source.g=self.session.g
        method=self.session.g.Authority._read_current;closure=m.closure(method)
        cells=tuple((lambda x:lambda:x)(lambda *_:None).__closure__[0]if name=='retained'else cell
            for name,cell in zip(method.__code__.co_freevars,method.__closure__))
        self.session.g.Authority._read_current=types.FunctionType(method.__code__,method.__globals__,method.__name__,method.__defaults__,cells)
        with self.assertRaisesRegex(RuntimeError,'complete_original_policy_adapted'):m.bind(self.session)
        self.assertIs(self.caller.PreparedMetadata,original)

    def test_wrong_policy_closure_and_wrong_parent_refuse(self):
        method=self.session.g.Authority.current
        cells=tuple((lambda x:lambda:x)(object()).__closure__[0]if name=='policy'else cell
            for name,cell in zip(method.__code__.co_freevars,method.__closure__))
        self.session.g.Authority.current=types.FunctionType(method.__code__,method.__globals__,method.__name__,method.__defaults__,cells)
        with self.assertRaisesRegex(RuntimeError,'same_policy_closure'):m.bind(self.session)
        self.session.g.Authority.current=method
        self.caller.PreparedMetadata=type('ForeignPrepared',(),{'__init__':lambda *_:None})
        with self.assertRaises(RuntimeError):m.bind(self.session)

    def test_original_constructor_error_identity_and_single_bind(self):
        m.bind(self.session)
        with self.assertRaises(RuntimeError):m.bind(self.session)
        error=RuntimeError('explicit-external-constructor-deadline')
        self.selected.construct_context=lambda *_:(_ for _ in()).throw(error)
        try:self.construct()
        except BaseException as observed:self.assertIs(observed,error)
        else:self.fail('original constructor error was swallowed')

    def test_public_cache_context_keeps_helper_identity_after_closed_timing_assignment(self):
        binding=m.bind(self.session);provider=self.family.provider();session=self.session
        session.readonly_preflight={'explicitFullSourcePreflightIOFixtureOnly':True};session.source.kind='forward-active'
        def initialize(host,config):
            host.config=config;host.cache=self.cache;host.inverse_mode=False;host.metadata_primitives=lambda:self.primitives
        original_doc=self.family.authority_context.value.document
        def document(path,digest=None):
            if Path(path)==self.family.authority_context.value.PRIOR_INPUT:return copy.deepcopy(self.f.old.config)
            return original_doc(path,digest)
        with patch.object(provider,'common',return_value=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=lambda *_:copy.deepcopy(self.f.old.config)))),\
                patch.object(provider,'namespace',return_value=self.namespace),patch.object(self.namespace,'cache_runtime',return_value=self.cache),\
                patch.dict(self.cache.Host.__init__.__globals__,initialize_current=initialize),\
                patch.object(self.family.authority_context.value,'document',side_effect=document):
            session.cache_context('4'*64)
            # patch.dict restores the whole fixture cache namespace at exit;
            # observe actual installed fields before that test-only cleanup.
            self.assertEqual(session.key['preparedConstructorBinding'],binding)
            self.assertEqual(session.cache.continuation_context['preparedConstructorBinding'],binding)
            self.assertEqual(self.caller.timing_key(session,'cache-prepared-held')['preparedConstructorBinding'],binding)
            self.assertEqual(session.cache.continuation_context['context']['preparedConstructorBinding'],binding)
            authority=self.family.authority_context.value
            self.assertEqual(authority.new_identity(session.cache,session.host)['preparedConstructorBinding'],binding)
            self.assertIs(authority.construct_records.__globals__['new_identity'],authority.new_identity)


if __name__=='__main__':unittest.main()
