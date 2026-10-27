"""Actual thin compositions and finite gate seams; synthetic receipts only."""
import ast
import copy
from contextlib import nullcontext
import dis
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
u=load('ypal-ordinary-cache-continuation-context-v1.py')
p=load('ypal-ordinary-read-cache-continue-v1.py')
r=load('ypal-ordinary-reader-continue-v1.py')
a=load('ypal-ordinary-publication-continue-v1.py')
b=load('ypal-ordinary-publication-continue-manifest-v1.py')
renderer=load('ypal-ordinary-publication-continue-inputs-v1.py')
prior=load('ypal-ordinary-publication-accept-v2.test.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.control=prior.Controls();self.control.setUp();self.addCleanup(self.control.doCleanups)
        self.namespace,self.config=self.control.provider();self.h=prior.value.h
        original_public=self.control.public
        def public(path,digest=None,maximum=4000000):
            if Path(path).name=='ypal-old-runtime-inventory-v1.py':
                raw=(HERE.parent/'booster-launch'/Path(path).name).read_bytes();u.need(digest is None or u.sha(raw)==digest,'actual_inventory_source_required');return raw
            return original_public(path,digest,maximum)
        self.public=public;self.enterContext(patch.object(self.control.impl,'public',side_effect=public))
        self.u=types.SimpleNamespace(**u.__dict__);self.u.public=public;self.u.helper=lambda:self.h
        original_load=self.u.load
        self.u.load=lambda path,digest:types.SimpleNamespace(config_checked=self.namespace.config_checked,common=lambda:prior.value.old.old_cache.c,
            namespace=lambda *_args,**_kwargs:self.namespace)if Path(path)==u.OLD_PROVIDER else original_load(path,digest)
        self.actual_authority=load(u.AUTHORITY);self.actual_authority.public=self.public
        self.authority=types.SimpleNamespace(approval_before_launch=Mock(),before_literal_ack=Mock(),stopped=Mock(),
            bounded_sql_parent=self.actual_authority.bounded_sql_parent)
        self.u.authority=lambda _:self.authority
        self.enterContext(patch.object(p,'utility',return_value=self.u));self.enterContext(patch.object(r,'utility',return_value=self.u))

    def actual_provider(self,inverse=False):
        old=prior.value.old.old_cache;c=old.c;original=c.module
        read=self.namespace.read_module();delta=load('ypal-ordinary-read-admission-v5b.py');delta.namespace=lambda:read
        metadata=old.metatest.namespace();selector=load('ypal-generation-cache-candidates-v1.py');binding=self.control.binding()
        def module(path,digest):
            self.control.public(path,digest);name=Path(path).name
            if name=='ypal-ordinary-read-admission-v5b.py':return delta
            if name=='ypal-ordinary-metadata-handover-v5.py':return types.SimpleNamespace(namespace=lambda _:metadata)
            if name==self.h.OWNER_FILE:return binding.owner
            if name=='ypal-ordinary-generation-candidates-v5.py':return types.SimpleNamespace(namespace=lambda _:selector)
            return original(path,digest)
        real=self.h.derive
        def derive(*args,**kwargs):
            value=real(*args,**kwargs)
            if args[1]==p.V6_SHA:value.common=lambda:c
            return value
        manifest=copy.deepcopy(self.control.documents[prior.value.r.MANIFEST.name])
        manifest['files'][p.READER.name]=u.sha((HERE/p.READER.name).read_bytes())
        with patch.object(self.h,'derive',side_effect=derive),patch.object(c,'public',side_effect=self.control.public), \
             patch.object(c,'load_input',return_value=old.execution),patch.object(c,'module',side_effect=module), \
             patch.object(c,'intake',return_value=types.SimpleNamespace(protected=self.control.public)):
            value=p.namespace(self.config,manifest,source_guard=Mock(side_effect=AssertionError('source during pure constructor')),inverse=inverse)
        return value

    def test_actual_provider_new_identity_same_data_SQL_and_retained_original_boot_location(self):
        value=self.actual_provider();cache=value.cache_runtime()
        self.assertEqual(cache.FORMAT,p.FORMAT);self.assertEqual(cache.BASE,p.BASE);self.assertEqual(Path(cache.__file__),p.FILE)
        self.assertEqual(value.INPUT,p.INPUT);self.assertEqual(cache.prior_cache.BASE,u.OLD_BASE)
        self.assertEqual(cache.retained_boot_archive,u.BOOT_ARCHIVE)
        original=load('ypal-cache-guard-owner-v1.py')
        for name in ['commit','prepare_ack','reconcile_commit','owned']:
            left,right=getattr(cache,name).__code__,getattr(original,name).__code__
            self.assertEqual((left.co_code,left.co_consts),(right.co_code,right.co_consts),name)
        self.assertEqual(cache.ENTRY_SHA,'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705')
        expected=self.actual_authority.bounded_sql_parent(cache.prior_cache._sql_child,cache.prior_cache._sql_child)
        self.assertEqual(self.actual_authority.code_identity(cache._sql_child.__code__),self.actual_authority.code_identity(expected.__code__))
        self.assertIn('continuation_ack_deadline',cache._sql_child.__code__.co_names)
        for name in ['drain','reconcile_stop','finish','inverse','finish_inverse']:
            self.assertIn(str(u.BOOT_ARCHIVE),getattr(cache,name).__code__.co_consts,name)

    def test_new_stopped_and_ACK_gates_are_explicit_not_old_success_aliases(self):
        cache=self.actual_provider().cache_runtime();host=object()
        cache.stopped(host);self.authority.stopped.assert_called_once_with(cache,host)
        launch=cache.sql_child.__closure__
        self.assertTrue(launch)
        underlying=next(cell.cell_contents for cell in launch if isinstance(cell.cell_contents,types.FunctionType))
        calls=[]
        def parent(host,mode,plan,prepared,generation,plan_json):calls.append('parent');return prepared({'mode':'apply'})
        new_cells=tuple((lambda value:lambda:value)(parent).__closure__[0]if cell.cell_contents is underlying else cell for cell in launch)
        fn=types.FunctionType(cache.sql_child.__code__,cache.sql_child.__globals__,'sql_child',cache.sql_child.__defaults__,new_cells)
        callback=Mock(side_effect=lambda packet:calls.append('all-genuine-predicates-and-save'))
        self.authority.before_literal_ack.side_effect=lambda *_:calls.append('deadline-before-literalACK')
        fn(host,'apply',None,callback)
        self.assertEqual(calls,['parent','all-genuine-predicates-and-save','deadline-before-literalACK'])

    def test_actual_compiled_approval_gate_runs_after_dependency_preauthorization_before_transport(self):
        cache=self.actual_provider().cache_runtime();actual=self.actual_authority;bounded=cache._sql_child
        instructions=list(dis.get_instructions(bounded))
        gate=[index for index,row in enumerate(instructions)if row.opname=='LOAD_GLOBAL'and isinstance(row.argval,str)and row.argval.endswith('approval_before_launch')]
        tail=[index for index,row in enumerate(instructions)if row.opname=='LOAD_GLOBAL'and row.argval=='continuation_ack_deadline']
        launch=[index for index,row in enumerate(instructions)if row.opname=='LOAD_ATTR'and row.argval=='Popen']
        self.assertEqual(len(gate),1);self.assertEqual(len(launch),1);self.assertLess(gate[0],launch[0])
        self.assertEqual(len(tail),1);self.assertGreater(tail[0],launch[0]);self.assertIn('commit-authorized',bounded.__code__.co_consts)
        with patch.object(actual,'public',side_effect=self.public):rollback=actual.rollback_transport(bounded,cache.prior_cache._sql_child,Mock())
        self.assertNotIn('commit-authorized',rollback.__code__.co_consts)
        self.assertIn(actual.WRONG_ACK,rollback.__code__.co_consts)

    def test_external_authority_requires_its_complete_actual_closure_before_evaluation(self):
        manifest=b.build()[r.MANIFEST.name]
        with patch.object(u,'public',side_effect=self.public),patch.object(u,'load',wraps=u.load)as evaluate:
            authority=u.authority(manifest)
            self.assertEqual(authority.FORMAT,'yunipals-ypal-ordinary-cache-continuation-authority-v1')
            evaluate.assert_called_once_with(u.OPS/u.AUTHORITY,manifest['dependencies'][u.AUTHORITY])
        foreign=copy.deepcopy(manifest);foreign['dependencies'].pop(next(iter(authority.SOURCE_PINS)))
        with patch.object(u,'public',side_effect=self.public),patch.object(u,'load')as evaluate:
            with self.assertRaisesRegex(RuntimeError,'exact_complete_continuation_authority_closure'):
                u.authority(foreign)
            evaluate.assert_not_called()

    def test_forward_approval_gate_cannot_be_misrepresented_as_an_inverse_proof(self):
        authority=self.actual_authority;cache=types.SimpleNamespace(inverse_mode=True);host=types.SimpleNamespace(inverse_mode=True)
        value=authority.approval_before_launch(cache,host,'inverse')
        self.assertTrue(value['notApplicable']);self.assertFalse(value['forwardApprovalQualified']);self.assertFalse(value['metadataApprovalQualified'])
        host.inverse_mode=False
        with self.assertRaises(RuntimeError):authority.approval_before_launch(cache,host,'inverse')

    def test_reader_composition_uses_new_actual_namespace_and_external_feature_names(self):
        module=r.composition()
        self.assertEqual(module.FILE,r.FILE);self.assertEqual(module.BASE,r.BASE);self.assertEqual(module.MANIFEST,r.MANIFEST)
        self.assertEqual(module.PROVIDER,p.FILE.name)
        contract=module.external_feature_contract()
        self.assertEqual(contract['acknowledgementFile'],r.FILE.name)
        self.assertEqual(contract['ownerFile'],'ypal-ordinary-feature-handover-continue-v1.py')
        self.assertEqual(module.TRANSPORT_SHA,'865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4')
        self.assertEqual(module.WIRE_SHA,'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf')

    def test_actual_manifest_and_full_reader_Proof_preserve_all_transaction_bodies(self):
        records=b.build();raw=(json.dumps(records[r.MANIFEST.name],sort_keys=True,indent=2)+'\n').encode();digest=u.sha(raw)
        original=self.public
        def public(path,expected=None,maximum=4000000):
            if Path(path).name==r.MANIFEST.name:
                u.need(expected is None or expected==digest,'actual_new_source_manifest_required');return raw
            return original(path,expected,maximum)
        with patch.object(self.control.impl,'public',side_effect=public):
            module=r.composition();proof=module.Proof(digest)
            root=module.assemble(public(module.TEMPLATE,module.TEMPLATE_SHA),proof)
        self.assertEqual(root.FORMAT,r.FORMAT);self.assertEqual(root.BASE,r.BASE)
        self.assertEqual(proof.manifest['contexts']['phase']['file'],p.FILE.name)
        original_root=load('ypal-native-cutover-v1.py')
        for name in ['inverse','publish','admit_readers','inverse_global','reconcile_inverse','validate_metadata_restored']:
            self.assertEqual(getattr(root,name).__code__.co_code,getattr(original_root,name).__code__.co_code,name)
        with patch.object(root,'public_input',side_effect=public):
            finish=proof.cache_finish_module(root,types.SimpleNamespace(proof=proof,inputs={'sourceManifestSha256':digest}))
        self.assertEqual(finish.FORMAT,'yunipals-ypal-ordinary-cache-finish-continue-v1')
        self.assertEqual(finish.BASE,Path('/var/backups/yunipals-ypal-ordinary-cache-finish-continue-v1-20261025'))
        for name in ['accept','drain_for_inverse','restore_old','reload_review']:
            self.assertIn(str(u.BOOT_ARCHIVE),getattr(finish,name).__code__.co_consts,name)
        inherited=load('ypal-cache-finish-v2.py')
        for name in ['start','reconcile_start','recover_reload','capacity','operation']:
            left,right=getattr(finish,name).__code__,getattr(inherited,name).__code__
            self.assertEqual((left.co_code,left.co_consts),(right.co_code,right.co_consts),name)

    def test_actual_caller_full_context_uses_new_producers_guard_and_complete_held_domain(self):
        records=b.build();raw=(json.dumps(records[r.MANIFEST.name],sort_keys=True,indent=2)+'\n').encode();digest=u.sha(raw)
        original=self.public
        def public(path,expected=None,maximum=4000000):
            if Path(path).name==r.MANIFEST.name:
                u.need(expected is None or expected==digest,'actual_new_source_manifest_required');return raw
            return original(path,expected,maximum)
        self.u.public=public;real=self.h.derive
        def derive(*args,**kwargs):
            result=real(*args,**kwargs)
            if args[1]==a.KERNEL_SHA:result.helper=lambda:self.h
            return result
        with patch.object(a,'utility',return_value=self.u),patch.object(self.control.impl,'public',side_effect=public), \
             patch.object(self.h,'derive',side_effect=derive):caller=a.composed(digest)
        caller.own_sha=lambda:u.sha((HERE/a.FILE.name).read_bytes())
        session=types.SimpleNamespace(key={'target':'cache','inputSha256':'fixture-input','direction':'forward'},
            host=types.SimpleNamespace(config={'generationBindingSha256':self.control.binding_sha}),protocol=load('ypal-ordinary-publication-protocol-v6.py'))
        key=caller.timing_key(session,'cache-prepared-held')
        self.assertEqual(key['format'],a.FORMAT);self.assertEqual(key['operatorSha256'],caller.own_sha())
        self.assertEqual(key['guardSha256'],'36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82')
        self.assertEqual(key['providerSha256'],u.sha((HERE/p.FILE.name).read_bytes()))
        self.assertEqual(key['readerSha256'],u.sha((HERE/r.FILE.name).read_bytes()))
        self.assertEqual(key['continuationReaderManifestSha256'],digest);self.assertFalse(key['priorOwnerTimingReused'])
        with self.assertRaisesRegex(RuntimeError,'inverse_requires_separate_actual_prefix'):
            caller.SourcePhase({'resultSha256':'a'*64,'inputSha256':'b'*64},True)

    def test_operational_API_uses_the_same_authority_instance_as_the_raw_parent(self):
        authority=types.SimpleNamespace(construct_records=Mock(return_value={'newActualRollbackRehearsal':True}),
            qualify_held=Mock(return_value={'rollbackOnly':True}),require_qualification=Mock())
        cache=types.SimpleNamespace(continuation_authority=authority,commit=Mock(return_value={'prepared':True}),
            inspect=Mock(),reconcile_commit=Mock(),prepare_ack=Mock())
        host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=nullcontext)}))
        def attempt(session,attempt_id,action,fn):return fn()
        caller=types.SimpleNamespace(need=u.need,attempt=attempt,
            continuation_authority=Mock(side_effect=AssertionError('a different module instance cannot own typed scope')))
        session=types.SimpleNamespace(cache=cache,host=host,source=types.SimpleNamespace(inverse=False,current=Mock()),
            finish=Mock(return_value={'validated':True}),continuation_caller=caller)
        self.assertTrue(a.construct_records(session,'fixture-baseline')['newActualRollbackRehearsal'])
        self.assertTrue(a.qualify_held(session,'fixture-held')['rollbackOnly'])
        reference={'captureId':'fixture-held','sha256':'a'*64}
        self.assertTrue(a.execute_cache(session,'commit',[],'fixture-commit',reference)['prepared'])
        authority.construct_records.assert_called_once_with(cache,host,'fixture-baseline')
        authority.qualify_held.assert_called_once_with(cache,host,'fixture-held')
        authority.require_qualification.assert_called_once_with(cache,host,reference)
        self.assertIs(cache.continuation_qualification_ref,reference)
        self.assertEqual(session.source.current.call_count,2);self.assertEqual(session.finish.call_count,2)

    def test_typed_inverse_direction_is_installed_before_host_construction(self):
        value=self.actual_provider()
        # The runtime itself is constructed with its real full cache body. A
        # later Host reads this flag during __init__, before inverse SQL starts.
        inverse_namespace=p.namespace
        self.assertFalse(value.cache_runtime().inverse_mode)
        self.assertTrue(self.actual_provider(True).cache_runtime().inverse_mode)
        with self.assertRaisesRegex(RuntimeError,'typed_explicit_continuation_source_direction'):
            inverse_namespace(self.config,{},inverse='inverse')

    def test_static_reader_input_renderer_authenticates_new_lineage_without_current_context(self):
        records=b.build();manifest=records[r.MANIFEST.name]
        encoded=lambda value:(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
        raw_manifest=encoded(manifest);manifest_sha=u.sha(raw_manifest);provider_sha=manifest['contexts']['phase']['sha256']
        before={'binding':{'format':p.FORMAT,'operatorSha256':provider_sha,'config':copy.deepcopy(self.config)},'reviewHash':'fixture-review'}
        before_raw=encoded(before)
        committed={'operatorSha256':provider_sha,'reviewHash':before['reviewHash'],'mode':'apply',
            'readAdmissionSha256':self.config['readAdmissionSha256']}
        committed_raw=encoded(committed)
        prepared={'format':p.FORMAT,'operatorSha256':provider_sha,'config':copy.deepcopy(self.config),'prepared':True,
            'nativeWorkerStarted':False,'nativeGenerationPublished':False,'reviewHash':before['reviewHash'],
            'beforeSha256':u.sha(before_raw),'additionalReadAcknowledgementSha256':u.sha(committed_raw)}
        prepared_raw=encoded(prepared);prepared_sha=u.sha(prepared_raw)
        observer_ref=manifest['contexts']['observer'];observer=load(observer_ref['file'])
        observed={'format':observer.FORMAT,'operatorSha256':observer_ref['sha256'],'mode':'new',
            'observerScopeOnly':True,'ordinarySustainedObserver':True}
        transport=manifest['transportQualification']
        qualified={'format':'yunipals-ordinary-reader-peer-bound-v1','qualified':True,
            'producerSha256':transport['newProducerSha256'],'wireManifestSha256':manifest['wireManifestSha256'],
            'peers':{'postgres':{},'main':{}}}
        documents={r.MANIFEST:raw_manifest,p.INPUT:encoded(self.config),p.BASE/'before.json':before_raw,
            p.BASE/'sql-committed.json':committed_raw,p.BASE/'prepared.json':prepared_raw,
            observer.BASE/'result.json':encoded(observed),Path(transport['newQualificationFile']):encoded(qualified)}
        original_public=self.public
        def public(path,digest=None,maximum=4000000):
            raw=documents.get(Path(path))
            if raw is None:return original_public(path,digest,maximum)
            u.need(digest is None or u.sha(raw)==digest,'actual_static_fixture_file_digest_required');return raw
        # Real source Proof validates the whole finite manifest. Only immutable
        # receipt reads and the default module loader are relocated here.
        with patch.object(self.control.impl,'public',side_effect=public):proof=r.composition().Proof(manifest_sha)
        installers={}
        for name,digest in [('ypal-generation-publisher-install-v1.py',proof.PUBLISHER_INSTALL_SHA),
            ('ypal-latest-complete-main-api-install-v1.py',proof.MAIN_INSTALL_SHA)]:
            installer=load(name);installers[name]=installer
            documents[installer.BASE/'result.json']=encoded({'fixtureImmutableInstallReceipt':True})
        def fixture_load(path,digest):
            public(path,digest);name=Path(path).name
            if name==p.FILE.name:return p
            if name==r.FILE.name:return types.SimpleNamespace(core=lambda _: (None,proof),
                Context=Mock(side_effect=AssertionError('static renderer must not construct current Context')))
            if name==observer_ref['file']:return observer
            if name in installers:return installers[name]
            raise AssertionError('unexpected renderer module '+name)
        # The published installed receipt digests remain fixed. Relocate their
        # protected reads after recording exactly which actual pin was required.
        prior_public=public;install_refs=[]
        def installed_public(path,digest=None,maximum=4000000):
            for name,expected in [('ypal-generation-publisher-install-v1.py',proof.PUBLISHER_INSTALL_SHA),
                ('ypal-latest-complete-main-api-install-v1.py',proof.MAIN_INSTALL_SHA)]:
                if Path(path)==installers[name].BASE/'result.json':
                    self.assertEqual(digest,expected);install_refs.append(expected);return documents[Path(path)]
            return prior_public(path,digest,maximum)
        utility=types.SimpleNamespace(**self.u.__dict__);utility.public=installed_public;utility.load=fixture_load
        utility.authority=lambda _:types.SimpleNamespace(PRIOR_INPUT_SHA=u.sha(encoded(self.config)))
        with patch.object(renderer,'utility',return_value=utility):
            result=renderer.reader_inputs(prepared_sha,manifest_sha)
            self.assertEqual(set(result['readerInputs']),proof._implementation.INPUT_KEYS)
            self.assertEqual(result['readerInputs']['cachePreparedSha256'],prepared_sha)
            self.assertFalse(result['currentReadinessQualified']);self.assertTrue(result['immutableFileLineageOnly'])
            self.assertEqual(result['inputWrites'],result['databaseWrites']);self.assertEqual(result['databaseWrites'],0)
            self.assertEqual(len(install_refs),2)
            for key,value in [('operatorSha256',u.OLD_PROVIDER_SHA),('nativeGenerationPublished',True)]:
                changed={**prepared,key:value};documents[p.BASE/'prepared.json']=encoded(changed)
                with self.assertRaisesRegex(RuntimeError,'actual_new_cache_prepared_commit'):
                    renderer.reader_inputs(u.sha(documents[p.BASE/'prepared.json']),manifest_sha)
            documents[p.BASE/'prepared.json']=prepared_raw
            with self.assertRaisesRegex(RuntimeError,'actual_static_fixture_file_digest'):
                renderer.reader_inputs('f'*64,manifest_sha)

    def test_static_defaults_do_not_enter_production_or_evaluate_private_inputs(self):
        for name in [p.FILE.name,r.FILE.name,a.FILE.name,'ypal-ordinary-cache-continuation-context-v1.py','ypal-ordinary-publication-continue-manifest-v1.py',
            'ypal-ordinary-publication-continue-inputs-v1.py']:
            output=json.loads(subprocess.run(['python3','-I','-B',str(HERE/name)],capture_output=True,check=True).stdout)
            self.assertEqual(output['databaseWrites'],0);self.assertEqual(output['serviceActions'],0);self.assertEqual(output['providerCalls'],0)


if __name__=='__main__':unittest.main()
