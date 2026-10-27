"""Native120 inverse source/config/capture controls; no effects or live DB."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n);return n
w=load('ypal-native-metadata-approval-inverse-v3.py')
old=load('ypal-native-metadata-approval-inverse-v1.py')
def local(path,digest=None):
    path=Path(path);name=path.name;origin=HERE/name
    if not origin.exists():origin=HERE.parent/('solana-acceptance'if name=='final-supervisor-inventory-v1.py'else'booster-launch')/name
    raw=origin.read_bytes()
    if digest is not None and hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('exact_inverse3_source_fixture_required')
    return raw
def namespace():
    with patch.object(w,'protected',side_effect=local):return w.composition()


class SourceControls(unittest.TestCase):
    def setUp(self):self.m=namespace()
    def config(self):
        return{'format':w.FORMAT+'-input','upgradeRefs':{'mode':'current','resultSha256':old.UPGRADE_RESULT,
            'inputSha256':old.UPGRADE_INPUT,'producerSha256':old.OWNER_SHA,'manifestSha256':old.OWNER_MANIFEST_SHA},
            'upgradeOperationSha256':'1'*64,'source':{'inputSha256':'2'*64,'producerSha256':'3'*64,'manifestSha256':'4'*64},
            'catalog':{'resultSha256':'5'*64,'producerSha256':w.SOURCE_PINS[w.READER],'manifestSha256':w.SOURCE_PINS[w.READER_MANIFEST]},
            'nativePolicyRefs':{'producerSha256':w.SOURCE_PINS['ypal-native-metadata-readiness-policy-v2.py'],
                'manifestSha256':w.SOURCE_PINS['ypal-native-metadata-readiness-policy-v2.manifest.json'],'resultSha256':'6'*64},
            'forwardAuthorityInputSha256':'7'*64,'forwardBaselineCapture':{'captureId':'actual-forward-capture','resultSha256':'8'*64}}
    def test_actual_complete_source_map_no_Core4_backedge_and_default_inert(self):
        with patch.object(w,'protected',side_effect=local):w.authenticate()
        self.assertNotIn(w.SOURCE,w.SOURCE_PINS)
        self.assertNotIn('ypal-ordinary-consumer-inverse-prefix-v4.py',w.SOURCE_PINS)
        result=subprocess.run([sys.executable,'-I','-B',str(HERE/w.FILE.name)],capture_output=True,check=True,text=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertFalse(result.stderr)
    def test_only_declared_owner_constructor_body_changes_in_original_effect_methods(self):
        parent=self.m.InverseContext.__mro__[1]
        for name,method in vars(old.InverseContext).items():
            if isinstance(method,types.FunctionType)and name!='__init__':
                self.assertEqual(getattr(parent,name).__code__,method.__code__,name)
        self.assertNotEqual(parent.__init__.__code__,old.InverseContext.__init__.__code__)
        for name in['clone_method','phase_intent','restored_actor_relation','upgrade_actor_relation','review_source_observations','actor_capture','transition_lock','main']:
            self.assertEqual(getattr(self.m,name).__code__,getattr(old,name).__code__,name)
        original=ast.parse(local(w.FROZEN));cls=next(n for n in original.body if isinstance(n,ast.ClassDef)and n.name=='InverseContext')
        self.assertEqual(sum(isinstance(n,ast.Assign)and len(n.targets)==1 and ast.unparse(n.targets[0])=='self.owner'for n in ast.walk(next(n for n in cls.body if isinstance(n,ast.FunctionDef)and n.name=='__init__'))),1)
    def test_new_input_preserves_full_upgrade_Reader6_and_native120_capture_identities(self):
        cfg=self.config();self.assertEqual(self.m.configuration(cfg),cfg)
        for mutate in[lambda v:v['upgradeRefs'].update(resultSha256='9'*64),lambda v:v['catalog'].update(producerSha256='9'*64),
            lambda v:v['nativePolicyRefs'].update(producerSha256='9'*64),lambda v:v['nativePolicyRefs'].update(manifestSha256='9'*64),
            lambda v:v.update(forwardAuthorityInputSha256=True),lambda v:v['forwardBaselineCapture'].update(captureId='../foreign'),
            lambda v:v['forwardBaselineCapture'].update(resultSha256=False),lambda v:v.pop('nativePolicyRefs')]:
            bad=copy.deepcopy(cfg);mutate(bad)
            with self.assertRaises(RuntimeError):self.m.configuration(bad)
        self.assertEqual(self.m.READER,w.READER);self.assertEqual(self.m.SOURCE,w.SOURCE)
        self.assertTrue(str(self.m.BASE).endswith('inverse-v3-20261026'))
    def capture_fixture(self):
        cfg=self.config();binding={'format':'yunipals-native-readiness-prepared-binding-v1',
            'operatorSha256':w.SOURCE_PINS[w.CONSTRUCTOR],
            'manifestSha256':w.SOURCE_PINS[w.CONSTRUCTOR.replace('.py','.manifest.json')],
            'templateCallerSha256':w.SOURCE_PINS['ypal-ordinary-publication-continue-v6.py'],
            'templateFamilySha256':w.SOURCE_PINS[w.FAMILY],'contextSha256':w.SOURCE_PINS[w.CONTEXT],
            'nativePolicyRefs':cfg['nativePolicyRefs'],'metadataRefs':cfg['upgradeRefs'],
            'authorityInputSha256':cfg['forwardAuthorityInputSha256'],'sameAlreadyBoundGuardRequired':True,
            'originalFamily1ConstructorPassed':False,'sourceFactsReused':False,'currentPredicatesChanged':False,
            'approvalScopeSeconds':120,'literalACKTailSeconds':5}
        identity={'preparedConstructorBinding':binding,'nativeReadinessPolicyRefs':cfg['nativePolicyRefs'],
            'authorityInputSha256':cfg['forwardAuthorityInputSha256'],'metadataEpoch':{'refs':cfg['upgradeRefs']}}
        original=load('ypal-ordinary-cache-continuation-authority-v1.py')
        identity.update(format='yunipals-ypal-ordinary-read-cache-continue-v6',
            providerSha256=w.SOURCE_PINS['ypal-ordinary-read-cache-continue-v6.py'],
            authoritySha256=w.SOURCE_PINS['ypal-ordinary-cache-continuation-authority-v6.py'],
            inputSha256=original.PRIOR_INPUT_SHA,sqlEntrySha256=original.ENTRY_SHA,componentSha256=original.COMPONENT_SHA,
            approvalScopeNanoseconds=120_000_000_000,literalACKTailNanoseconds=5_000_000_000,old90SecondQualificationClaimed=False)
        generation={'format':'yunipals-native-readiness-generation-binding-v1',
            'operatorSha256':w.sha(local(w.GENERATION_BINDING)),
            'manifestSha256':w.sha(local(w.GENERATION_BINDING.replace('.py','.manifest.json'))),
            'generationProducerSha256':w.SOURCE_PINS['ypal-ordinary-generation-accept-v3.py'],
            'nativePolicyRefs':cfg['nativePolicyRefs'],'authorityInputSha256':cfg['forwardAuthorityInputSha256'],
            'constructorBindingSha256':w.sha(w.encoded(binding)),
            'oldWholeGeneration3CurrentPassed':False,'candidateChecksChanged':False,'sourceFactsReused':False,
            'currentPredicatesRemoved':False,'approvalScopeSeconds':120,'literalACKTailSeconds':5}
        identity['generationCurrentBinding']=generation
        result={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6','completed':True,'action':'construct-records','identity':identity,
            'newStopActionPerformed':False,'productionPreparedACKCreated':False,'productionCOMMITQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0,'beforeSha256':'a'*64,'rehearsedSha256':'b'*64,'authorizationSha256':'c'*64}
        intent={'format':result['format'],'action':result['action'],'identity':copy.deepcopy(identity),'automaticRetryAllowed':False}
        def protected(path,digest=None):
            name=Path(path).name
            if Path(path).parent==w.OPS:return local(path,digest)
            if name=='result.json':self.assertEqual(digest,cfg['forwardBaselineCapture']['resultSha256']);return w.encoded(result)
            if name=='intent.json':return w.encoded(intent)
            self.assertEqual(digest,result[{'before.json':'beforeSha256','rehearsed.json':'rehearsedSha256','authorization.json':'authorizationSha256'}[name]])
            return b'explicit digest-checked immutable file I/O fixture'
        return cfg,result,intent,protected
    def test_complete_immutable_forward_capture_binding_and_unknown_old_alias_refusals(self):
        cfg,result,intent,protected=self.capture_fixture()
        with patch.object(w,'protected',side_effect=protected):proof=w.forward_capture(cfg)
        self.assertEqual(proof['refs'],cfg['forwardBaselineCapture']);self.assertTrue(proof['immutableForwardAncestryOnly'])
        good=copy.deepcopy(result)
        for mutate in[lambda v:v.update(completed=False),lambda v:v['identity']['preparedConstructorBinding'].update(operatorSha256='9'*64),
            lambda v:v['identity']['preparedConstructorBinding'].update(originalFamily1ConstructorPassed=True),
            lambda v:v['identity']['preparedConstructorBinding'].update(approvalScopeSeconds=True),
            lambda v:v['identity'].update(authorityInputSha256='9'*64),
            lambda v:v['identity']['generationCurrentBinding'].update(constructorBindingSha256='9'*64),
            lambda v:v['identity']['generationCurrentBinding'].update(nativePolicyRefs={}),
            lambda v:v['identity']['generationCurrentBinding'].update(operatorSha256='9'*64),
            lambda v:v['identity']['generationCurrentBinding'].update(approvalScopeSeconds=90),
            lambda v:v['identity'].update(approvalScopeNanoseconds=90_000_000_000),
            lambda v:v['identity'].update(authoritySha256=w.SOURCE_PINS['ypal-ordinary-cache-continuation-authority-v5.py']),
            lambda v:v['identity'].update(literalACKTailNanoseconds=True)]:
            result.clear();result.update(copy.deepcopy(good));mutate(result)
            intent['identity']=copy.deepcopy(result['identity'])
            with patch.object(w,'protected',side_effect=protected),self.assertRaises(RuntimeError):w.forward_capture(cfg)


class PolicyIntegration(unittest.TestCase):
    def setUp(self):
        self.m=namespace();self.native_module=load('ypal-native-readiness-context-v2.test.py')
        self.native=self.native_module.Controls();self.native.setUp();self.addCleanup(self.native.doCleanups)

    def test_actual_inverse_owner_route_enters_complete_Owner3_constructor_and_policy_creator(self):
        native=self.native;cm=self.native_module.m
        owner=load('ypal-native-metadata-approval-epoch-v3.test.py').namespace
        common=load(cm.COMMON.name);common.__file__=str(cm.COMMON);events=[]
        class AfterPolicyCurrent(Exception):pass
        creator=cm.Proxy(self.native_module.policy_tests.old_tests.m,__file__=str(cm.CREATOR))
        metadata=types.SimpleNamespace(RETAINED_SHA='retained',INSTALLER_SHA='installer',INSTALL_SHA='install')
        primitives={'host':types.SimpleNamespace(s=object(),raw=types.SimpleNamespace(observer=object()),source_op={}), 'restoreReceipt':{}}
        def after_policy(*_):events.append('after-real-policy-current');raise AfterPolicyCurrent()
        parts={'components':{'privilegedSourcePrimitives':primitives,'readerHost':types.SimpleNamespace(query=lambda _:None)}}
        intake=types.SimpleNamespace(query_components=lambda:parts,document=after_policy)
        def module(path,digest):
            if Path(path)==cm.CREATOR:return creator
            if digest=='installer':return types.SimpleNamespace(installed=lambda *_:events.append('installed'))
            return object()
        common.module=module;common.load_input=lambda _:{'candidateInputSha256':'explicit-candidate-I/O'}
        common.metadata_primitives=cm.clone(common.metadata_primitives,{'module':module,
            'candidate_context':lambda _:{'createdReceiptSha256':native.lifecycle.created_sha},
            'intake':lambda:intake,'candidate_namespace':lambda _:metadata})
        entry=types.SimpleNamespace(common=lambda:common,namespace=lambda _:types.SimpleNamespace())
        original=owner.Context.__init__
        init=cm.clone(original,{'authenticate':lambda:None,'configuration':lambda value:value,
            'protected':lambda *_:cm.encoded({'metadataInputSha256':'explicit-execution-I/O'}),'module':lambda _:entry})
        class OwnerContext(owner.Context):__init__=init
        query_parts=native.lifecycle.legacy.i.query_components()
        query_parts['components']['readerHost'].query=lambda _:copy.deepcopy(native.lifecycle.actual['target'])
        with patch.object(w,'policy_context',return_value=native.ctx),patch.object(w,'load',side_effect=lambda _:cm),\
                patch.object(native.lifecycle.legacy.i,'query_components',return_value=query_parts):
            adapted=self.m.policy_owner(cm.Proxy(owner,Context=OwnerContext),{'explicitConfigIO':True})
            self.assertIs(adapted.native_readiness_context,native.ctx)
            self.assertEqual(adapted.Context.__init__.__code__,original.__code__)
            with self.assertRaises(AfterPolicyCurrent):adapted.Context('actual-upgrade-input-I/O')
        self.assertEqual(events,['installed','after-real-policy-current'])

    def test_actual_inverse_current_upgrade_uses_full_new_actor_envelope_and_raw_ACK(self):
        actual,controls=self.native.actor_fixture();ctx=self.m.InverseContext.__new__(self.m.InverseContext)
        ctx.readiness=self.native.ctx;ctx.config={'upgradeRefs':{'mode':'current','resultSha256':actual.m.RESULT_SHA,
            'inputSha256':actual.m.INPUT_SHA,'producerSha256':actual.m.OWNER_SHA,'manifestSha256':actual.m.OWNER_MANIFEST_SHA}}
        ctx.upgrade=copy.deepcopy(controls.ack)
        proof=ctx.current_upgrade()
        self.assertEqual(proof['actor'],controls.actualActor);self.assertNotEqual(proof['actor'],controls.ackActor)
        self.assertEqual(proof['upgradeAcknowledgement'],ctx.upgrade)
        self.assertEqual(proof['format'],self.native_module.m.FORMAT+'-metadata-actor-current')
        self.assertFalse(proof['oldMetadataCurrentObserverPassed']);self.assertFalse(proof['originalOwner3CurrentPassed'])
        controls.owned=[]
        with self.assertRaises(RuntimeError):ctx.current_upgrade()
        controls.owned=[{'pid':19,'backendStart':'epoch'}];ctx.upgrade['operationSha256']='f'*64
        with self.assertRaises(RuntimeError):ctx.current_upgrade()

    def test_actual_inverse_catalog_joins_complete_reader_catalog_to_constructor_bound_before(self):
        controls=SourceControls();controls.m=self.m
        config,record,intent,protected=controls.capture_fixture()
        ctx=self.m.InverseContext.__new__(self.m.InverseContext);ctx.config=config
        ctx.forward={'result':record,'preparedConstructorBindingSha256':'a'*64}
        ctx.execution={'readConfig':{'admissionSha256':'b'*64,'readPlanSha256':'c'*64,'readContextInputSha256':'d'*64}}
        proof={'validated':True,'catalogOnly':True,'sourceActorQualified':False,'originalWholeValidatorPassed':False,
            'readAdmissionSha256':'b'*64,'readPlanSha256':'c'*64,'readContextInputSha256':'d'*64,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        reader=types.SimpleNamespace(lifecycle_inverse_catalog=lambda refs:copy.deepcopy(proof),
            acknowledgement=lambda *_:{'cachePreparedSha256':'e'*64})
        prepared={'beforeSha256':record['beforeSha256']}
        def packet(path,digest=None):
            self.assertEqual(Path(path),w.FORWARD_CACHE_BASE/'prepared.json');self.assertEqual(digest,'e'*64)
            return w.encoded(prepared)
        with patch.object(w,'protected',side_effect=packet):
            accepted=ctx.catalog(reader)
            self.assertEqual(accepted['forwardBaselineCapture'],config['forwardBaselineCapture'])
            prepared['beforeSha256']='f'*64
            with self.assertRaisesRegex(RuntimeError,'same_constructor_bound'):ctx.catalog(reader)
            prepared['beforeSha256']=record['beforeSha256'];proof['sourceActorQualified']=True
            with self.assertRaises(RuntimeError):ctx.catalog(reader)

    def retained_phase_fixture(self):
        # Execute the frozen fixture definitions against the real new namespace.
        # Lifecycle observations are explicit fixture I/O; phase journals are
        # actual exclusive files and every retained ACK predicate runs.
        value=self.m;value.FILE=HERE/w.FILE.name;value.__file__=str(value.FILE)
        body=[]
        for node in ast.parse(local('ypal-native-metadata-approval-inverse-v1.test.py')).body:
            if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='m'for t in node.targets):continue
            if isinstance(node,ast.If)and ast.unparse(node.test)=="__name__ == '__main__'":continue
            body.append(node)
        scope={'m':value,'__name__':'inverse3_retained_phase_IOfixtures','__file__':str(HERE/'ypal-native-metadata-approval-inverse-v3.test.py')}
        exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),scope['__file__'],'exec'),scope)
        fixture=scope['Controls']();self.addCleanup(fixture.tearDown);fixture.setUp()
        cfg=fixture.config
        cfg.update(nativePolicyRefs=copy.deepcopy(self.native.refs),forwardAuthorityInputSha256='7'*64,
            forwardBaselineCapture={'captureId':'real-format-fixture','resultSha256':'8'*64})
        fixture.ctx.readiness=self.native.ctx
        binding={'explicitProtectedForwardCaptureIO':True}
        fixture.ctx.forward={'preparedConstructorBinding':binding,'preparedConstructorBindingSha256':w.sha(w.encoded(binding)),
            'generationCurrentBinding':{'explicitProtectedGenerationCaptureIO':True},'result':{'beforeSha256':'a'*64}}
        fixture.inputsha=w.sha(w.encoded(cfg));fixture.ctx.input_sha=fixture.inputsha
        value.INPUT.write_bytes(w.encoded(cfg));fixture.op['inputSha256']=fixture.inputsha
        fixture.op['config']=copy.deepcopy(cfg);fixture.op['reviewBinding']['config']=copy.deepcopy(cfg)
        for row in fixture.op['rawSourceObservations']:
            row['source'].update(nativePolicyRefs=copy.deepcopy(cfg['nativePolicyRefs']),
                forwardAuthorityInputSha256=cfg['forwardAuthorityInputSha256'],forwardBaselineCapture=copy.deepcopy(cfg['forwardBaselineCapture']))
        fixture.op['rawSourceObservationsSha256']=w.sha(w.encoded(fixture.op['rawSourceObservations']))
        fixture.op['reviewHash']=scope['upstream'].review_hash(fixture.op['reviewBinding'])
        (fixture.base/'operation.json').write_bytes(w.encoded(fixture.op))
        return fixture

    def test_genuine_phase_files_pure_ACK_preserves_CF333_policy_capture_and_all_original_checks(self):
        fixture=self.retained_phase_fixture();value=self.m
        result=fixture.accepted()
        with patch.object(value,'authenticate',lambda:None),patch.object(value,'module',side_effect=fixture.pure_module),\
                patch.object(value,'context',side_effect=AssertionError('immutable ACK cannot construct current')) ,\
                patch.object(w,'INPUT',value.INPUT),patch.object(w,'protected',side_effect=lambda path,digest=None:value.protected(path,digest)),\
                patch.object(w,'policy_context',return_value=self.native.ctx),patch.object(w,'forward_capture',return_value=fixture.ctx.forward),\
                patch.object(self.native.ctx,'current',side_effect=AssertionError('immutable ACK cannot query current')):
            ack=value.acknowledgement(result,fixture.inputsha)
            self.assertTrue(ack['immutableAcknowledgementOnly']);self.assertFalse(ack['currentActorQualified'])
            self.assertEqual(ack['nativePolicyTTLSeconds'],120);self.assertFalse(ack['nativePolicyRestoreDispatched'])
            self.assertEqual(ack['nativePolicyRefs'],self.native.refs)
            self.assertEqual(ack['forwardBaselineCapture'],fixture.config['forwardBaselineCapture'])
            self.assertEqual(ack['preparedConstructorBinding'],fixture.ctx.forward['preparedConstructorBinding'])
            original=value.document('result.json')
            for key,item in[('nativePolicyTTLSeconds',90),('nativePolicyRestoreDispatched',True),
                    ('preparedConstructorBinding',{'foreign':True}),('forwardBaselineCapture',{'captureId':'other','resultSha256':'f'*64}),
                    ('operatorSha256',value.OWNER_SHA),('metadataOperationSha256','f'*64)]:
                changed=copy.deepcopy(original);changed[key]=item
                (fixture.base/'result.json').write_bytes(w.encoded(changed));digest=w.sha(w.encoded(changed))
                with self.assertRaises(RuntimeError):value.acknowledgement(digest,fixture.inputsha)
            (fixture.base/'result.json').write_bytes(w.encoded(original))
            capture=value.document('inverse-stop-capture.json');capture['priorSessions']={'owned':[]}
            (fixture.base/'inverse-stop-capture.json').write_bytes(w.encoded(capture))
            with self.assertRaises(RuntimeError):value.acknowledgement(result,fixture.inputsha)

    def test_actual_prefix_before_operation_remains_SOURCE_READ_independent_and_new_binding_exact(self):
        fixture=self.retained_phase_fixture();value=self.m
        observed,proof,_=fixture.current_observer_fixture()
        fixture.ctx.current_upgrade=lambda:copy.deepcopy(proof)
        fixture.ctx.full_source=lambda:(_ for _ in()).throw(AssertionError('actor prefix cannot call SOURCE'))
        with patch.object(value,'BASE',fixture.folder/'unstarted-inverse'),patch.object(value,'context',return_value=fixture.ctx),\
                patch.object(value,'external_source',side_effect=AssertionError('no SOURCE authority in prefix')),\
                patch.object(w,'INPUT',value.INPUT),patch.object(w,'protected',side_effect=lambda path,digest=None:value.protected(path,digest)):
            prefix=value.actor_prefix_current(fixture.inputsha)
        self.assertEqual(prefix['actor'],observed);self.assertIsNone(prefix['binding']['operationSha256'])
        self.assertFalse(prefix['sourceActorQualified']);self.assertFalse(prefix['READAuthorityQualified'])
        for key in['nativePolicyRefs','forwardAuthorityInputSha256','forwardBaselineCapture']:
            self.assertEqual(prefix[key],fixture.config[key]);self.assertEqual(prefix['binding'][key],fixture.config[key])
        self.assertEqual(prefix['bindingSha256'],w.sha(w.encoded(prefix['binding'])))

    def test_complete_inverse_SOURCE_keeps_ready_terminal_intents_and_native_capture_binding(self):
        fixture=self.retained_phase_fixture();value=self.m
        own,proof,reader,route=fixture.source_fixture()
        proof.update(nativePolicyRefs=copy.deepcopy(fixture.config['nativePolicyRefs']),
            forwardAuthorityInputSha256=fixture.config['forwardAuthorityInputSha256'],
            forwardBaselineCapture=copy.deepcopy(fixture.config['forwardBaselineCapture']))
        reader.acknowledgement=lambda *_:{'cachePreparedSha256':'e'*64}
        def private(path,digest=None):
            self.assertEqual(Path(path),w.FORWARD_CACHE_BASE/'prepared.json');self.assertEqual(digest,'e'*64)
            return w.encoded({'beforeSha256':fixture.ctx.forward['result']['beforeSha256']})
        with patch.object(value,'module',return_value=reader),patch.object(value,'external_source',return_value=route),\
                patch.object(value,'own_refs',return_value=own),patch.object(w,'protected',side_effect=private):
            accepted=fixture.ctx.full_source()
            self.assertTrue(accepted['sourceActorQualified']);self.assertTrue(accepted['READCatalogQualified'])
            good=copy.deepcopy(proof)
            for mutate in[lambda p:p.update(frameworkReady=False),
                    lambda p:p['binding']['ownedConsumerPrefix']['readers']['main'].update(ownedNativeStopIntentQualified=False),
                    lambda p:p['binding']['ownedConsumerPrefix']['cache'].update(actor=fixture.upgradeActor),
                    lambda p:p['binding']['ownedConsumerPrefix']['catalog'].update(apiLoginsEnabled=False),
                    lambda p:p.update(nativePolicyRefs={}),lambda p:p.update(forwardAuthorityInputSha256='f'*64),
                    lambda p:p.update(forwardBaselineCapture={'captureId':'foreign','resultSha256':'f'*64})]:
                proof.clear();proof.update(copy.deepcopy(good));mutate(proof)
                with self.assertRaises(RuntimeError):fixture.ctx.full_source()

    def test_actual_Reader6_lifecycle_executes_full_READ_LOGIN_guard_and_ACK_bookends(self):
        integration=load('ypal-ordinary-readiness-family-v1.integration.test.py').Integration()
        integration.setUp();self.addCleanup(integration.doCleanups)
        n,cache,host,before,after,actual,plan=integration.current_read_fixture()
        family=integration.family;root=family.reader();u=family.utility();provider=family.provider()
        cfg=SourceControls().config();cfg['nativePolicyRefs']=copy.deepcopy(integration.fixture.refs)
        cfg['forwardAuthorityInputSha256']=integration.fixture.input_sha
        manifest=json.loads(local(w.READER_MANIFEST));events=[]
        for row in actual['read']['roles']:
            if row['name']in n.current_reads.__globals__['LOGINS']:row['login']=True
        op={'binding':{'metadata':{'metadataEpoch':n.metadata_current_namespace.metadata_epoch.binding()},
            'afterLoginCatalog':copy.deepcopy(actual['read'])}}
        operation_raw=w.encoded(op)
        ack={'immutableReaderAcknowledgementOnly':True,'validated':True,
            'operatorSha256':cfg['catalog']['producerSha256'],'operationSha256':w.sha(operation_raw),'cacheInputsSha256':'a'*64}
        root.core=lambda _:(root,object());root.operation=lambda _:copy.deepcopy(op)
        root.acknowledgement=lambda *_:events.append('immutable-ACK')or copy.deepcopy(ack)
        original_public=u.public
        def public(path,digest=None):
            path=Path(path)
            if path==Path('/var/backups/yunipals-ypal-ordinary-reader-continue-v6-20261026/operation.json'):return operation_raw
            if path==provider.INPUT:
                self.assertEqual(digest,ack['cacheInputsSha256']);return w.encoded(host.config)
            return local(path,digest)
        u.public=public
        original_provider_namespace=provider.namespace
        def namespace(config,coordinator,source_guard,metadata_refs=None):
            self.assertEqual(config,host.config);self.assertEqual(metadata_refs,op['binding']['metadata']['metadataEpoch']['refs'])
            with self.assertRaisesRegex(RuntimeError,'does_not_confer_source'):source_guard()
            events.append('catalog-only-namespace-I/O');return n
        provider.namespace=namespace;provider.config_checked=lambda value:value
        # Actual Host private/process constructor I/O is supplied here; the
        # complete lifecycle/current_reads/semantic_guard predicates execute.
        cache.Host=lambda config:host;n.cache_runtime=lambda:cache
        state={'epochs':[{'collection':name,'revision':'1'}for name in['ethereum','base','polygon','bnb']],
            'allActualGuardObjectsAndColumns':'explicit-database-I/O'}
        genuine_guard=n.guard_current
        class GuardCache:
            def document(self,path):return{'result':{'after':copy.deepcopy(state)}}
            def sql_child(self,_host,mode):
                self_mode=mode;events.append(self_mode)
                if self_mode!='inspect':raise AssertionError('catalog scope cannot mutate SQL')
                return{'state':copy.deepcopy(state)}
        cm=self.native_module.m
        n.guard_current=lambda actual_host,cache_reads:genuine_guard(cm.Proxy(actual_host,cache=GuardCache()),cache_reads)
        family.utility=lambda:u
        genuine_load=w.load
        def modules(name):
            if name==w.FAMILY:return types.SimpleNamespace(Family=lambda *_:family)
            return genuine_load(name)
        with patch.object(w,'load',side_effect=modules),patch.object(w,'protected',side_effect=local):
            reader=w.reader_facade(cfg);proof=reader.lifecycle_inverse_catalog(cfg['catalog'])
            self.assertTrue(proof['validated']);self.assertTrue(proof['catalogOnly'])
            self.assertTrue(proof['apiLoginsEnabled']);self.assertEqual(proof['additionalReadCount'],4)
            self.assertFalse(proof['sourceActorQualified']);self.assertEqual(events.count('immutable-ACK'),2)
            good=copy.deepcopy(actual)
            for mutate in[lambda v:v['read']['functions'][0].update(definitionMd5='old-or-foreign-body'),
                    lambda v:v['read']['relations'][0].update(acl='foreign'),
                    lambda v:v['allColumnAcl'].append({'foreign':'grantee'}),
                    lambda v:next(row for row in v['read']['roles']if row['name']in n.current_reads.__globals__['LOGINS']).update(login=False)]:
                actual.clear();actual.update(copy.deepcopy(good));mutate(actual)
                with self.assertRaises(RuntimeError):reader.lifecycle_inverse_catalog(cfg['catalog'])
        provider.namespace=original_provider_namespace;u.public=original_public


if __name__=='__main__':unittest.main()
