"""Actual native120 namespaces; protected journals/OS/DB are explicit local I/O."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n);return n
m=load('ypal-ordinary-readiness-family-v1.py')
metadata=load('ypal-ordinary-metadata-current-policy-v1.py')
authority=load('ypal-ordinary-cache-continuation-authority-v6.py')
context_tests=load('ypal-native-readiness-context-v2.test.py')
prior=load('ypal-ordinary-publication-continue-v5.test.py')

def local(path,digest=None):
    name=Path(path).name;origin={'final-supervisor-inventory-v1.py':HERE.parent/'solana-acceptance'/name,
        'ypal-old-runtime-inventory-v1.py':HERE.parent/'booster-launch'/name}.get(name,HERE/name)
    raw=origin.read_bytes()
    if digest is not None and hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('exact_actual_family_source_fixture_required')
    return raw


class Controls(unittest.TestCase):
    def setUp(self):
        self.old=prior.Controls();self.old.setUp();self.addCleanup(self.old.doCleanups)
        self.native=context_tests.Controls();self.native.setUp();self.addCleanup(self.native.doCleanups)
        self.ctx=self.native.ctx;self.refs=copy.deepcopy(self.native.refs)
        self.input={'format':authority.FORMAT+'-input','nativePolicyRefs':self.refs}
        self.input_raw=authority.encoded(self.input);self.input_sha=authority.sha(self.input_raw)
        self.enterContext(patch.object(m,'public',side_effect=local))
        self.enterContext(patch.object(metadata,'public',side_effect=local))
        self.enterContext(patch.object(prior.bootstrap.h,'public',side_effect=prior.public))
        wrapper=prior.source(authority.FORWARD);wrapper.public=prior.public;wrapper.factory=lambda:prior.compiler
        self.enterContext(patch.object(authority,'public',side_effect=lambda path,digest=None:self.input_raw
            if Path(path)==authority.INPUT and digest==self.input_sha else local(path,digest)))
        self.enterContext(patch.object(authority,'module',side_effect=lambda name:wrapper
            if name==authority.FORWARD else self.fail('unexpected authority template')))
        original_policy=authority.policy_module
        def policy(refs):
            original_policy(refs) # Complete real eight-file authorization before private I/O fixture relocation.
            return self.native.policy
        self.enterContext(patch.object(authority,'policy_module',side_effect=policy))
        template=load('ypal-ordinary-metadata-current-epoch-v3.py');template.public=prior.public;template.factory=lambda:prior.compiler
        retained=template.composition();retained.utility=lambda:self.old.utility
        self.template=template
        original_meta_load=metadata.load
        self.enterContext(patch.object(metadata,'load',side_effect=lambda name:
            context_tests.m if name==metadata.CONTEXT else template if name==metadata.TEMPLATE else prior.e
            if name=='ypal-ordinary-metadata-current-effect-v1.py'else original_meta_load(name)))
        original_load=m.load
        supplied={m.CONTEXT:context_tests.m,m.AUTHORITY:authority,m.METADATA:metadata,
            'ypal-fresh-forward-epoch-v1.py':prior.compiler,'ypal-ordinary-metadata-current-effect-v1.py':prior.e}
        self.enterContext(patch.object(m,'load',side_effect=lambda name:supplied[name]if name in supplied else original_load(name)))
        self.family=m.Family(self.refs,self.input_sha)
        self.enterContext(patch.object(self.family.authority_context.value,'public',side_effect=local))
        for cell in self.family.authority_context.original_identity.__closure__ or():
            bound=cell.cell_contents
            if isinstance(bound,types.ModuleType)and getattr(bound,'FILE',None)==prior.e.FILE:
                self.enterContext(patch.object(bound,'public',side_effect=prior.effect_public))
                self.enterContext(patch.object(bound,'current_module',return_value=prior.meta.actual))
        # Keep the actual effect utility's authority5 identity. Relocate only
        # its authenticated public/private source I/O and the real helper.
        utility=types.SimpleNamespace(**vars(self.family._utility_template))
        def read(path,digest=None,maximum=4000000):
            if Path(path).name in{m.READER_MANIFEST,m.PROVIDER,m.READER,m.CALLER}:return local(path,digest)
            return self.old.public(path,digest,maximum)
        def loaded(path,digest):
            read(path,digest)
            if Path(path).name=='ypal-ordinary-cache-continuation-authority-v5.py':return prior.wrappers[Path(path).name]
            return self.old.loaded(path,digest)
        utility.public=read;utility.load=loaded;utility.helper=lambda:self.old.h
        utility.authority=m.clone(utility.authority,{'public':read,'load':loaded})
        self.enterContext(patch.object(prior.wrappers['ypal-ordinary-cache-continuation-authority-v5.py'].composition(),'public',side_effect=read))
        self.family._utility_template=utility
        self.manifest=json.loads(local(m.OPS/m.READER_MANIFEST));self.manifest_sha=m.sha(local(m.OPS/m.READER_MANIFEST))

    def test_actual_source_maps_and_explicit_family6_identities(self):
        m.authenticate();metadata.authenticate();authority.authenticate()
        self.assertEqual(self.family.authority_context.refs,self.refs)
        self.assertEqual(self.family.authority_context.value.TTL_NS,120_000_000_000)
        self.assertEqual(self.family.authority_context.value.COMMIT_RESERVE_NS,5_000_000_000)
        p=self.family.provider();r=self.family.reader()
        self.assertEqual(p.FILE,m.OPS/m.PROVIDER);self.assertEqual(r.FILE,m.OPS/m.READER)
        self.assertTrue(str(p.BASE).endswith('continue-v6-20261026'))
        self.assertTrue(str(r.BASE).endswith('continue-v6-20261026'))

    def test_actual_new_epoch_captures_own_context_and_retains_original_retry_window(self):
        epoch=self.family.metadata.Epoch(self.old.refs,self.manifest,False)
        proof={'explicit':'actor-current-I/O'}
        with patch.object(self.family.readiness,'epoch_current',return_value=proof)as observe:
            self.assertEqual(epoch.current(),proof)
        observe.assert_called_once_with(epoch)
        row=epoch.current_capture_history[-1]
        self.assertEqual(row['format'],metadata.FORMAT+'-capture');self.assertFalse(row['effectsRetried'])
        self.assertEqual(len(row['attempts']),1);self.assertFalse(row['attempts'][0]['discarded'])
        self.assertEqual(self.family.metadata.capture_current.__globals__['CAPTURE_WINDOW_NS'],90_000_000_000)
        self.assertEqual(self.family.metadata.capture_current.__globals__['MAXIMUM_ATTEMPTS'],3)
        with self.assertRaises(RuntimeError):self.family.metadata.Epoch(self.old.refs,self.manifest,True)

    def provider_namespace(self):
        p=self.family.provider()
        original_scope=self.old.base.actual_provider.__globals__
        old=original_scope['prior'].value.old.old_cache
        c=load('ypal-ordinary-consumer-handover-v5.py');c.__file__=str(context_tests.m.COMMON)
        original=old.c.module
        read=self.old.base.namespace.read_module();delta=load('ypal-ordinary-read-admission-v5b.py');delta.namespace=lambda:read
        native=old.metatest.namespace();selector=load('ypal-generation-cache-candidates-v1.py');binding=self.old.base.control.binding()
        def module(path,digest):
            self.old.base.control.public(path,digest);name=Path(path).name
            if name=='ypal-ordinary-read-admission-v5b.py':return delta
            if name=='ypal-ordinary-metadata-handover-v5.py':return types.SimpleNamespace(namespace=lambda _:native)
            if name==self.old.h.OWNER_FILE:return binding.owner
            if name=='ypal-ordinary-generation-candidates-v5.py':return types.SimpleNamespace(namespace=lambda _:selector)
            return original(path,digest)
        real=self.old.h.derive
        def derive(*args,**kwargs):
            result=real(*args,**kwargs)
            if args[1]==m.SOURCE_PINS['ypal-ordinary-read-cache-v6.py']:result.common=lambda:c
            return result
        for effect in[patch.object(self.old.h,'derive',side_effect=derive),patch.object(c,'public',side_effect=self.old.base.control.public),
                patch.object(old.c,'public',side_effect=self.old.base.control.public),
                patch.object(c,'load_input',return_value=old.execution),patch.object(c,'module',side_effect=module),
                patch.object(c,'intake',return_value=types.SimpleNamespace(protected=self.old.base.control.public))]:self.enterContext(effect)
        return p.namespace(self.old.config,self.manifest,Mock(side_effect=AssertionError('no Source during static namespace')),False,self.old.refs)

    def test_genuine_provider_namespace_uses_exact_context_and_catalog_compilation_seams(self):
        p=self.family.provider();n=self.provider_namespace()
        cache=n.cache_runtime()
        self.assertEqual(cache.FORMAT,p.FORMAT);self.assertEqual(cache.BASE,p.BASE)
        self.assertEqual(n.INPUT,p.INPUT)
        self.assertEqual(str(p.INPUT),'/var/backups/yunipals-ypal-ordinary-read-cache-continue-input-v6-20261026/input.json')
        self.assertEqual(cache.metadata_epoch_namespace.metadata_epoch_helper_file,metadata.FILE)
        self.assertEqual(cache.continuation_reader['manifestFile'],m.READER_MANIFEST)
        observations=[row for compiler in self.family.compilers for row in compiler.observed]
        self.assertIn({'sourceSha256':m.SOURCE_PINS['ypal-ordinary-read-cache-v6.py'],'counts':{'common':1,'reader':1}},observations)
        # Lower factory.namespace is independently adapted; it is not the same helper.derive call.
        self.assertIn('_readiness',n.current_reads.__globals__)
        self.assertEqual(cache.commit.__code__.co_code,load('ypal-cache-guard-owner-v1.py').commit.__code__.co_code)

    def caller(self):
        real=self.old.h.derive
        def derive(*args,**kwargs):
            result=real(*args,**kwargs)
            if 'helper'in vars(result):result.helper=lambda:self.old.h
            return result
        with patch.object(self.old.h,'derive',side_effect=derive):value=self.family.composed(self.manifest_sha,self.old.refs)
        value.own_sha=lambda:m.sha(local(m.OPS/m.CALLER));return value

    def test_actual_caller_composition_routes_source_guard_and_prepared_metadata(self):
        value=self.caller()
        self.assertEqual(value.PROVIDER,m.OPS/m.PROVIDER)
        self.assertEqual(value.READER,m.OPS/m.READER)
        self.assertIs(value.native_readiness_family,self.family)
        original=self.family.readiness.bind_source_guard
        def relocate(guard):
            guard.public=local
            return original(guard)
        with patch.object(self.family.readiness,'bind_source_guard',side_effect=relocate):guard=value.guard_module()
        self.assertIs(guard.module(m.OPS/m.PROVIDER,self.manifest['dependencies'][m.PROVIDER]),self.family.provider())
        self.assertIs(guard.module(m.OPS/m.READER,self.manifest['files'][m.READER]),self.family.reader())
        self.assertIs(value.SourcePhase.__init__.__globals__['guard_module'],value.guard_module)
        self.assertEqual(value.PreparedMetadata.__mro__[1].__name__,'PreparedMetadata')
        with self.assertRaises(RuntimeError):self.family.composed(self.manifest_sha,self.old.refs,True)

    def test_public_Session_constructor_executes_real_source_bootstrap_and_bound_provider(self):
        value=self.caller();original=self.family.readiness.bind_source_guard
        owner=types.SimpleNamespace(c=types.SimpleNamespace(host_module=load('ypal-alchemy-source-switch-v1.host.py')))
        observed=[]
        def relocate(raw):
            raw.public=local;parent=raw.Authority
            original_module=parent.__init__.__globals__['module']
            def bootstrap(path,digest):
                local(path,digest);observed.append(Path(path).name)
                if Path(path)==parent.__init__.__globals__['INTAKE']:return types.SimpleNamespace(explicitPrivateIntakeIOFixture=True)
                if Path(path)==parent.__init__.__globals__['RUNTIME']:return types.SimpleNamespace(Owner=lambda input_sha:owner)
                return original_module(path,digest)
            kernel=m.clone(parent.__init__.__globals__['classified_kernel'],{'public':local})
            self.enterContext(patch.dict(parent.__init__.__globals__,module=bootstrap,classified_kernel=kernel))
            # The forwarded module export is a separate fresh Source6 facade
            # lookup. Its source loader remains real; only filesystem I/O moves.
            def module(path,digest):
                n=types.ModuleType(Path(path).stem);n.__file__=str(path)
                exec(compile(local(path,digest),str(path),'exec'),n.__dict__);return n
            raw.Authority=parent;raw.module=module;return original(raw)
        with patch.object(self.family.readiness,'bind_source_guard',side_effect=relocate):
            session=value.Session({'resultSha256':'1'*64,'inputSha256':'2'*64},False)
        self.assertIs(session.source.authority.owner,owner)
        self.assertIs(session.provider.entry,self.family.provider())
        self.assertEqual(session.metadata_epoch.refs,self.old.refs)
        self.assertFalse(session.source.authority.ready);self.assertIsNone(session.readonly_preflight)
        self.assertEqual(len(observed),2)
        self.assertEqual(observed[0],'ypal-alchemy-ordinary-consumer-context-v1.py')
        self.assertEqual(observed[1],'ypal-alchemy-ordinary-runtime-v1.py')
        self.assertEqual(session.protocol.FORMAT,'yunipals-ypal-ordinary-publication-protocol-v6')

    def test_real_family_PreparedMetadata_constructor_invoke_and_private_refusal(self):
        value=self.caller();source=load('ypal-ordinary-source-authority-v5.py')
        source.__file__=str(context_tests.m.SOURCE);events=[];frame={'fixture':'all-private-frames'}
        source.file_frame=lambda paths:copy.deepcopy(frame)
        source.module=lambda path,digest:types.SimpleNamespace(bind=lambda host:events.append(('exact-query-bind',digest))or{'querySha256':digest})
        creator=context_tests.m.Proxy(context_tests.policy_tests.old_tests.m,__file__=str(context_tests.m.CREATOR))
        primitives={'reader':creator,'created':{'target':copy.deepcopy(self.native.lifecycle.before['target'])},
            'readConfig':{'fixture':'actual-admitted-ref-I/O'},'admission_ref':{'fixture':'actual-admission-I/O'}}
        host=types.SimpleNamespace(query=lambda _:copy.deepcopy(self.native.lifecycle.actual['target']),refresh=lambda:events.append('refresh'))
        selected=self.family.metadata.namespace(self.old.config['metadataInputSha256'],self.old.refs,self.manifest,False)
        selected.construct_context=lambda config,refresh,inverse,p,ref:host
        # This test executes the actual new helper/PreparedMetadata wrappers and
        # their original constructor/target/file/refresh guards. The whole SQL,
        # actor and publication workload at the inner constructor is explicit
        # I/O here and confers no metadata or held-qualification authority.
        scope={'events':events}
        exec("def metadata(phase,candidate,selection,refresh):\n"
            " p=phase.metadata_primitives()\n"
            " current=construct_context(p['readConfig'],refresh,False,p,p['admission_ref'])\n"
            " events.append('inner-metadata-workload-I/O')\n"
            " return {'actualFullMetadataProofQualified':False,'hostFixture':id(current)}\n",scope)
        selected.metadata=metadata.clone(metadata.metadata,{'_retained_metadata':scope['metadata'],
            'construct_context':selected.construct_context,'_readiness':self.family.readiness,
            '_policy_observer':{'file':metadata.CONTEXT,'sha256':m.SOURCE_PINS[metadata.CONTEXT]}})
        phase=types.SimpleNamespace(cache=types.SimpleNamespace(metadata_epoch_namespace=selected),metadata_primitives=lambda:primitives)
        refresh=lambda:None
        slot=value.PreparedMetadata(selected,phase,refresh,False,source)
        self.assertIs(slot.n,selected);self.assertEqual(slot.n.metadata_epoch.refs,self.old.refs)
        result=slot.invoke({},refresh,{})
        self.assertFalse(result['actualFullMetadataProofQualified'])
        self.assertEqual(result['nativeReadinessPolicy'],self.family.readiness.binding())
        self.assertFalse(result['oldMetadataCurrentHelperPassed']);self.assertEqual(events.count('refresh'),1)
        frame['foreign']='immutable-file-or-inode'
        with self.assertRaisesRegex(RuntimeError,'immutable_metadata_constructor'):slot.invoke({},refresh,{})

    def test_public_cache_context_actual_Host_constructor_and_new120_callback_owner_cell(self):
        value=self.caller();provider=self.family.provider();namespace=self.provider_namespace();cache=namespace.cache_runtime()
        source=load('ypal-ordinary-source-authority-v5.py');source.__file__=str(context_tests.m.SOURCE)
        events=[];frames={'explicit':'protected-constructor-frame-I/O'}
        creator=context_tests.m.Proxy(context_tests.policy_tests.old_tests.m,__file__=str(context_tests.m.CREATOR))
        primitives={'reader':creator,'created':{'target':copy.deepcopy(self.native.lifecycle.before['target'])},
            'readConfig':{'fixture':'admission-ref-I/O'},'admission_ref':{'fixture':'actual-admission-I/O'}}
        metadata_host=types.SimpleNamespace(query=lambda _:copy.deepcopy(self.native.lifecycle.actual['target']),refresh=lambda:events.append('metadata-refresh'))
        selected=cache.metadata_epoch_namespace;selected.construct_context=lambda *_:metadata_host
        scope={'events':events}
        exec("def metadata(phase,candidate,selection,refresh):\n"
            " p=phase.metadata_primitives()\n"
            " construct_context(p['readConfig'],refresh,False,p,p['admission_ref'])\n"
            " events.append('metadata-workload-I/O')\n"
            " return {'actualFullMetadataProofQualified':False}\n",scope)
        selected.metadata=metadata.clone(metadata.metadata,{'_retained_metadata':scope['metadata'],
            'construct_context':selected.construct_context,'_readiness':self.family.readiness,'_policy_observer':{'fixture':'authenticated-new-actor-route'}})
        source.file_frame=lambda _:copy.deepcopy(frames)
        def module(path,digest):
            if Path(path).name=='ypal-ordinary-metadata-handover-v5.py':return types.SimpleNamespace(namespace=lambda _:selected)
            local(path,digest);return types.SimpleNamespace(bind=lambda _: {'explicitOfficialQueryPeerIOFixture':True})
        source.module=module
        original_init=cache.Host.__init__;self.assertIn('initialize_current',original_init.__globals__)
        def private_initialize(host,config):
            events.append('actual-Host-private-initialization-I/O');host.config=config;host.cache=cache;host.inverse_mode=False
            host.metadata_primitives=lambda:primitives
        def input_document(path,digest):
            self.assertEqual(Path(path),provider.INPUT);self.assertEqual(digest,'4'*64);return copy.deepcopy(self.old.config)
        session=object.__new__(value.Session)
        session.source=types.SimpleNamespace(inverse=False,current=Mock(side_effect=AssertionError('no current claim from constructor I/O fixture')),
            refs={'resultSha256':'1'*64,'inputSha256':'2'*64},kind='forward-active')
        session.provider=value.BoundProvider(provider,session.source);session.g=source
        session.metadata_epoch=selected.metadata_epoch;session.protocol=load('ypal-ordinary-publication-protocol-v6.py')
        session.readonly_preflight={'explicitFullSourcePreflightIOFixtureOnly':True};session.cache=session.host=None
        document=self.family.authority_context.value.document
        def historical(path,digest=None):
            if Path(path)==self.family.authority_context.value.PRIOR_INPUT:
                self.assertEqual(digest,self.family.authority_context.value.PRIOR_INPUT_SHA);return copy.deepcopy(self.old.config)
            return document(path,digest)
        with patch.object(provider,'common',return_value=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=input_document))),\
                patch.object(provider,'namespace',return_value=namespace),patch.object(namespace,'cache_runtime',return_value=cache),\
                patch.dict(original_init.__globals__,initialize_current=private_initialize),\
                patch.object(self.family.authority_context.value,'document',side_effect=historical):
            result=value.Session.cache_context(session,'4'*64)
            self.assertEqual(result,(cache,session.host));self.assertIn('actual-Host-private-initialization-I/O',events)
            self.assertIs(cache.continuation_authority,self.family.authority_context.value)
            self.assertIs(cache.approval_window_context,self.family.authority_context)
            self.assertEqual(cache.continuation_context['nativeReadinessPolicy'],self.family.readiness.binding())
            # Whole native-policy current and the original approval predicate run;
            # only the DB response itself is this explicit fixed I/O fixture.
            from_fixture=load('ypal-ordinary-cache-continuation-authority-v6.test.py')
            session.host.query=lambda sql:from_fixture.approval()if sql==self.family.authority_context.value.APPROVAL_SQL else copy.deepcopy(self.native.lifecycle.actual)
            v=self.family.authority_context.value;gate=v.approval_snapshot(session.host)
            gate.update(mode='apply',identity=v.new_identity(cache,session.host));cache._continuation_approval_gate=gate
            original_dispatch=cache.sql_child
            def transport(host,mode,plan,prepared,generation,plan_json):return prepared({'mode':'apply','xid':'93002'})
            cells=tuple((lambda x:lambda:x)(transport).__closure__[0]if name=='launch'else cell
                for name,cell in zip(original_dispatch.__code__.co_freevars,original_dispatch.__closure__))
            dispatch=types.FunctionType(original_dispatch.__code__,original_dispatch.__globals__,original_dispatch.__name__,original_dispatch.__defaults__,cells)
            def prepared(packet):
                value=session.host.publication_slot.invoke({},lambda:None,{})
                self.assertFalse(value['actualFullMetadataProofQualified']);events.append('complete-original-slot-wrapper')
            with patch.object(v.time,'monotonic_ns',return_value=gate['capturedMonotonicNanoseconds']+96_000_000_000):
                dispatch(session.host,'apply',None,prepared)
                now=v.time.monotonic_ns()/1_000_000_000
                with patch.object(v.time,'monotonic',return_value=now):self.assertEqual(v.ack_deadline(cache,session.host,'apply'),now+5)
            self.assertIn('complete-original-slot-wrapper',events)
            with patch.object(v.time,'monotonic_ns',return_value=gate['capturedMonotonicNanoseconds']+116_000_000_000):
                with self.assertRaisesRegex(RuntimeError,'actual_approval_deadline'):dispatch(session.host,'apply',None,prepared)


if __name__=='__main__':unittest.main()
