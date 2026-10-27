"""Actual authority/provider bodies; private receipts/DB are explicit I/O fixtures."""
import ast,contextlib,copy,hashlib,importlib.util,io,json,os,sys,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-ordinary-cache-inverse-authority-v1.py')
bridge_test=load('ypal-ordinary-metadata-restored-epoch-v1.test.py')

class Controls(unittest.TestCase):
    def setUp(self):
        self.fixture=bridge_test.Controls();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        # Execute the complete frozen factory control, appending only a return
        # of its explicit fixture objects; no runtime observer is installed.
        raw=(HERE/'ypal-ordinary-metadata-restored-epoch-v1.test.py').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),'b4d3e8eb9cac50fb8302f7c5a973fa80cf7338885357453f23c6f266df7a8588')
        method=copy.deepcopy(next(node for node in ast.walk(ast.parse(raw))if isinstance(node,ast.FunctionDef)and node.name=='test_actual_provider_factories_bind_exact_refs_and_keep_function_bodies'))
        keys=['namespace','cache','case','epoch','family','utility'];method.body.append(ast.Return(value=ast.Dict(keys=[ast.Constant(key)for key in keys],values=[ast.Name(id=key,ctx=ast.Load())for key in keys])))
        scope=dict(bridge_test.__dict__);exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),str(HERE/'ypal-ordinary-metadata-restored-epoch-v1.test.py'),'exec'),scope)
        self.exported=scope[method.name](self.fixture)
        self.cache=self.exported['cache'];self.case=self.exported['case'];family=self.exported['family']
        self.config={'format':m.FORMAT+'-input','readerRefs':{'resultSha256':'5'*64,'producerSha256':m.SOURCE_PINS[m.READER],
            'manifestSha256':m.SOURCE_PINS[m.READER_MANIFEST]},'metadataRestoredRefs':copy.deepcopy(self.fixture.refs)}
        self.input_raw=m.encoded(self.config);self.input_sha=m.sha(self.input_raw)
        binding={'metadata':{'metadataEpoch':self.cache.metadata_epoch.forward.binding()},
            'format':'yunipals-ypal-ordinary-reader-continue-v5','operatorSha256':m.SOURCE_PINS[m.READER],
            'bootId':self.cache.boot(),'sourceManifestSha256':m.SOURCE_PINS[m.READER_MANIFEST]}
        self.operation={'binding':binding,'reviewHash':m.sha(m.encoded(binding))}
        operation_raw=m.encoded(self.operation)
        self.reader_ack={'validated':True,'immutableReaderAcknowledgementOnly':True,'operatorSha256':self.config['readerRefs']['producerSha256'],
            'manifestSha256':self.config['readerRefs']['manifestSha256'],'receiptSha256':self.config['readerRefs']['resultSha256'],
            'operationSha256':m.sha(operation_raw),'sourceActorQualified':False,'currentReadersQualified':False}
        self.root=types.SimpleNamespace(BASE=Path('/var/backups/yunipals-ypal-ordinary-reader-continue-v5-20261026'),
            operation=Mock(side_effect=lambda _:copy.deepcopy(self.operation)),public_input=lambda _:m.encoded(self.operation))
        reader=types.SimpleNamespace(acknowledgement=Mock(side_effect=lambda *_:copy.deepcopy(self.reader_ack)),core=lambda _:(self.root,object()))
        self.effect=load(m.EFFECT);self.effect.current_module=lambda:bridge_test.observation.actual
        record=family.reconciliation_record(self.fixture.forward.refs)
        def effect_public(path,digest=None,maximum=4000000):
            if Path(path)==self.effect.RECON:
                self.assertEqual(digest,self.effect.RECON_SHA);return m.encoded(record)
            return bridge_test.public(path,digest,maximum)
        self.effect.public=effect_public
        self.wrapper=family.source(m.FORWARD)
        self.wrapper.public=family.public;self.wrapper.factory=lambda:family.compiler
        self.enterContext(patch.object(family.bootstrap.h,'public',side_effect=family.public))
        registry={m.BRIDGE:bridge_test.bridge,m.EFFECT:self.effect,m.READER:reader,m.FORWARD:self.wrapper}
        def module(name):
            bridge_test.public(m.OPS/name,m.SOURCE_PINS[name]);return registry[name]
        def public(path,digest=None):
            if Path(path)==m.INPUT:
                self.assertEqual(digest,self.input_sha);return self.input_raw
            return bridge_test.public(path,digest)
        self.enterContext(patch.object(m,'module',side_effect=module));self.enterContext(patch.object(m,'public',side_effect=public))
        self.context=m.Context(self.input_sha)
        value=self.context.value
        value.public=bridge_test.public
        original_document=value.document
        value.document=lambda path,digest=None:copy.deepcopy(self.case.config)if Path(path)==value.PRIOR_INPUT and digest==value.PRIOR_INPUT_SHA else original_document(path,digest)
        self.host=types.SimpleNamespace(config=self.case.config,inverse_mode=True,cache=self.cache)

    def test_actual_forward_reconciliation_refuses_restored_refs_and_new_identity_binds_distinct_epoch(self):
        with self.assertRaises(RuntimeError):self.effect.reconciliation(self.fixture.refs)
        prior=self.cache.continuation_authority
        self.assertIsNone(prior.approval_before_launch(self.cache,self.host,'inspect'))
        original_identity=prior.new_identity
        while original_identity.__name__!='new_identity':
            cells=dict(zip(original_identity.__code__.co_freevars,original_identity.__closure__))
            original_identity=cells['prior_identity'if 'prior_identity'in cells else'parent'].cell_contents
        original_document=original_identity.__globals__['document']
        def document(path,digest=None):
            if Path(path)==prior.PRIOR_INPUT and digest==prior.PRIOR_INPUT_SHA:return copy.deepcopy(self.case.config)
            return original_document(path,digest)
        with patch.dict(original_identity.__globals__,document=document),self.assertRaises(RuntimeError):
            prior.new_identity(self.cache,self.host)
        value=self.context.identity(self.cache,self.host)
        self.assertFalse(value['originalForwardEffectAuthorityPassed']);self.assertFalse(value['forwardApplyAuthorityQualified'])
        self.assertEqual(value['metadataRestoredEpoch'],self.cache.metadata_epoch.binding())
        self.assertEqual(value['upgradeReconciliation']['sha256'],self.effect.RECON_SHA)
        self.assertEqual(value['inverseAuthorityInputSha256'],self.input_sha)
        self.assertNotEqual(self.cache.metadata_epoch.refs['producerSha256'],self.cache.metadata_epoch.ack['upgradeRefs']['producerSha256'])

    def test_genuine_C413_stopped_and_old_inverse_predicate_bodies_remain(self):
        actual=self.context.value;prior=load('ypal-ordinary-cache-continuation-authority-v1.py')
        for name in ['stopped','prior_aborted','prior_child_terminal','inverse_transport_records','OWNER_SESSIONS_SQL']:
            value=getattr(actual,name);old=getattr(prior,name)
            if isinstance(value,types.FunctionType):self.assertEqual(value.__code__.co_code,old.__code__.co_code,name)
        old=self.cache.continuation_authority.inverse_transport_records
        current=actual.inverse_transport_records
        legacy='/var/backups/yunipals-ypal-ordinary-reader-continue-v5-20261025'
        proper=str(self.root.BASE)
        self.assertEqual(old.__code__.co_consts.count(legacy),1)
        self.assertEqual(current.__code__.co_consts,tuple(proper if item==legacy else item for item in old.__code__.co_consts))
        self.assertEqual(current.__code__.co_names,old.__code__.co_names)
        self.assertEqual(current.__defaults__,old.__defaults__);self.assertEqual(current.__closure__,old.__closure__)
        actual.authenticate()

    def test_wrong_input_reader_or_epoch_changes_refuse_before_inverse_binding(self):
        good=copy.deepcopy(self.input_raw)
        self.input_raw=m.encoded({**self.config,'unowned':True})
        with self.assertRaises(RuntimeError):self.context.inputs()
        self.input_raw=good
        for field,value in [('inverse_mode',False),('metadata_epoch',types.SimpleNamespace(refs={'foreign':True},ack={}))]:
            saved=getattr(self.cache,field);setattr(self.cache,field,value)
            with self.assertRaises(RuntimeError):self.context.identity(self.cache,self.host)
            setattr(self.cache,field,saved)

    def test_bind_preserves_actual_SQL_parent_and_closes_all_forward_dispatch(self):
        raw=self.cache._sql_child;code=raw.__code__;defaults=raw.__defaults__;closure=raw.__closure__
        authority=self.context.bind(self.cache,self.host)
        self.assertIs(self.cache._sql_child.__code__,code);self.assertIs(self.cache._sql_child.__defaults__,defaults);self.assertIs(self.cache._sql_child.__closure__,closure)
        self.assertIs(self.cache.continuation_authority,authority)
        for mode in ['apply','rehearse']:
            with self.assertRaises(RuntimeError):self.cache.sql_child(self.host,mode)
        for name in ['construct_records','qualify_held','require_qualification','fresh_approval','before_literal_ack']:
            with self.assertRaisesRegex(RuntimeError,'no_forward'):getattr(authority,name)()
        gate=self.context.approval_before_launch(self.cache,self.host,'inverse')
        self.assertTrue(gate['notApplicable']);self.assertFalse(gate['metadataApprovalQualified']);self.assertTrue(gate['noNewInverseAuthority'])
        self.assertFalse(hasattr(self.cache,'_continuation_approval_gate'))

    def test_real_bound_SQL_launch_calls_complete_provider_prechecks_and_original_late_hook(self):
        # These are explicit dependency/catalog/child I/O fixtures. The real
        # provider layers, bounded parent's code, and new authority hooks run.
        original=self.cache.sql_child
        launch=dict(zip(original.__code__.co_freevars,original.__closure__))['launch'].cell_contents
        qualified=launch.__globals__['qualified_sql_child']
        cells=dict(zip(qualified.__code__.co_freevars,qualified.__closure__))
        provider=cells['c'].cell_contents
        dependency=types.SimpleNamespace(dependency_current=Mock(return_value={'explicitDependencyIOFixture':True}))
        original_module=provider.module
        def module(path,digest):
            if Path(path)==qualified.__globals__['DEPENDENCY_PREFLIGHT']:
                self.assertEqual(digest,qualified.__globals__['DEPENDENCY_PREFLIGHT_SHA']);return dependency
            return original_module(path,digest)
        self.host.new_read=types.SimpleNamespace(admitted=Mock(return_value=(None,None,{'after':{'allColumnAcl':[]}})))
        self.host.read_host=object()
        self.host.read=types.SimpleNamespace(SQL=m.OPS/'ypal-ordinary-read-catalog-v5.sql',
            COLUMNS=m.OPS/'ypal-restored-read-admission-v1.columns.sql')
        self.host.reader_sql='SELECT actual_reader_catalog_IO_fixture'
        self.context.bind(self.cache,self.host)
        raw=self.cache._sql_child;original_code=raw.__code__;events=[];pipes=[]
        transport_scope=raw.__globals__['transport_scope']
        old_dependency=transport_scope.__globals__['dependency']
        peer=self.exported['family'].source('ypal-ordinary-cache-peer-v6.py')
        helper=self.exported['family'].source('ypal-reader-peer-runtime-v1.py')
        helper.public_bytes=bridge_test.public
        def transport_dependency(path,digest):
            if Path(path).name=='ypal-ordinary-cache-peer-v6.py':
                bridge_test.public(path,digest);return peer
            return old_dependency(path,digest)
        payload={'format':'yunipals-ypal-cache-guard-sql-v1','inspected':True,'databaseWrites':0,
            'postProof':{'allColumnAcl':[]}}
        class Child:
            pid=987654
            def __init__(inner,*args,**kwargs):
                events.append(('Popen',args,kwargs));read,write=os.pipe();os.write(write,m.encoded({'event':'result','value':payload}));os.close(write)
                inner.stdout=os.fdopen(read,'rb');inner.stdin=io.BytesIO();inner.stderr=io.BytesIO();pipes.append(inner)
            def wait(inner,timeout):self.assertEqual(timeout,5);return 0
            def poll(inner):return 0
        approval=self.context.approval_before_launch
        def gate(cache,host,mode):
            events.append(('late-authority',mode));return approval(cache,host,mode)
        with patch.object(provider,'module',side_effect=module),patch.object(raw.__globals__['subprocess'],'Popen',Child),\
             patch.object(peer,'primitives',return_value=helper),patch.dict(transport_scope.__globals__,dependency=transport_dependency),\
             patch.dict(raw.__globals__,protected=bridge_test.public),patch.object(self.context,'approval_before_launch',side_effect=gate):
            result=self.cache.sql_child(self.host,'inspect')
        self.assertEqual(result,payload);self.assertIs(self.cache._sql_child.__code__,original_code)
        self.assertEqual([row[0]for row in events],['late-authority','Popen'])
        self.assertEqual(events[0][1],'inspect');dependency.dependency_current.assert_called_once_with()
        self.host.new_read.admitted.assert_called_once_with(self.host.read_host,self.host.config['readAdmissionSha256'])
        self.assertTrue(all(stream.closed for child in pipes for stream in [child.stdin,child.stdout,child.stderr]))
        self.assertFalse(hasattr(self.cache,'_continuation_approval_gate'))

    def test_repeat_binding_foreign_Host_and_untyped_inverse_are_closed(self):
        self.context.bind(self.cache,self.host)
        with self.assertRaisesRegex(RuntimeError,'one_actual'):self.context.bind(self.cache,self.host)
        with self.assertRaisesRegex(RuntimeError,'bound_inverse_Host'):self.cache.sql_child(types.SimpleNamespace(), 'inspect')
        for value in [False,1,None]:
            old=self.host.inverse_mode;self.host.inverse_mode=value
            try:
                with self.assertRaises(RuntimeError):self.cache.sql_child(self.host,'inspect')
            finally:self.host.inverse_mode=old

    def test_actual_production_facade_dispatch_is_distinct_from_its_composed_globals(self):
        family=self.exported['family'];facade=family.source(m.FORWARD)
        facade.public=family.public;facade.factory=lambda:family.compiler
        self.assertNotIn('bounded_sql_parent',facade.__dict__)
        actual=facade.composition()
        actual.public=bridge_test.public
        self.assertIs(facade.bounded_sql_parent,actual.bounded_sql_parent)
        self.assertIsNot(facade.__dict__,actual.bounded_sql_parent.__globals__)
        self.assertIs(actual.bounded_sql_parent.__globals__,actual.__dict__)
        self.cache.continuation_authority=facade;raw=self.cache._sql_child
        selected=self.context.bind(self.cache,self.host)
        self.assertIs(selected,self.context.value);self.assertIs(self.cache.continuation_authority,selected)
        self.assertIs(self.cache._sql_child.__code__,raw.__code__)
        self.assertIsNot(selected,actual);self.assertIs(selected.new_identity.__self__,self.context)

    def test_actual_inverse_prepared_callback_retains_full_SOURCE_catalog_and_one_owned_backend(self):
        self.context.bind(self.cache,self.host);value=self.context.value;area=self.root.BASE
        raw=m.encoded;docs={};boot=self.cache.boot();provider_sha=m.SOURCE_PINS['ypal-ordinary-read-cache-continue-v5.py']
        prior_binding={'actualPriorStoppedAndAbortedPrivateIOFixture':True};prior_sha=m.sha(raw(prior_binding))
        before={'binding':{'operatorSha256':provider_sha,'retainedActualStop':prior_binding,'newStopActionPerformed':False},'reviewHash':'a'*64}
        rehearsed={'retainedActualPriorAbortedSha256':prior_sha,'newActualRollbackRehearsal':True,'additionalReadDeltaSha256':'b'*64}
        prior_authorization={'actualOriginalFourREADAuthorizationIOFixture':True};prior_stopped={'actualOriginalStopACKIOFixture':True}
        docs[str(value.PRIOR_BASE/'authorization.json')]=prior_authorization;docs[str(value.PRIOR_BASE/'stopped.json')]=prior_stopped
        authorization={'format':self.cache.FORMAT,'reviewHash':before['reviewHash'],'additionalReadDeltaSha256':'b'*64,'additionalReadCount':4,
            'retainedActualAuthorization':{'file':str(value.PRIOR_BASE/'authorization.json'),'sha256':m.sha(raw(prior_authorization))},'additionalAuthorityRequested':False}
        docs[str(value.NEW_BASE/'before.json')]=before;docs[str(value.NEW_BASE/'authorization.json')]=authorization
        for name in ['sql-intent.json','sql-prepared.json']:docs[str(value.NEW_BASE/name)]={'actualForwardPrivateIOFixture':name}
        committed={'mode':'apply','operatorSha256':provider_sha,'bootId':boot,'reviewHash':before['reviewHash'],
            'commitIntentSha256':m.sha(raw(docs[str(value.NEW_BASE/'sql-intent.json')])),'preparedSha256':m.sha(raw(docs[str(value.NEW_BASE/'sql-prepared.json')])),
            'additionalReadAuthorizationSha256':m.sha(raw(authorization))}
        docs[str(value.NEW_BASE/'sql-committed.json')]=committed;docs[str(area/'operation.json')]=self.operation
        inverse={'format':self.operation['binding']['format'],'bootId':boot,'operationSha256':m.sha(raw(self.operation))}
        initial={'binding':inverse,'reviewHash':m.sha(raw(inverse))};docs[str(area/'inverse-intent.json')]=initial
        docs[str(area/'cache-inverse-intent.json')]={'format':inverse['format'],'bootId':boot,'operationSha256':m.sha(raw(self.operation)),
            'cacheCommitSha256':m.sha(raw(committed)),'inverseIntentSha256':m.sha(raw(initial))}
        actor={'pid':456,'startTicks':789};old_actor={'pid':123,'startTicks':234}
        child={'actor':actor,'mode':'inverse','bootId':boot,'entrySha256':self.cache.ENTRY_SHA,'componentSha256':self.cache.COMPONENT_SHA,
            'processGroup':456,'rootParentPid':os.getpid()}
        backend={'pid':567,'backendStart':'123456789','roleOid':'10','databaseOid':'17584','xid':'12345'}
        message={'format':'yunipals-ypal-cache-guard-sql-v1','event':'transaction-opened','mode':'inverse','xid':'12345','backend':backend}
        docs[str(value.NEW_BASE/'inverse-sql-child.json')]=child
        docs[str(value.NEW_BASE/'inverse-sql-opened.json')]={'message':message,'childFileSha256':m.sha(raw(child))}
        old=types.SimpleNamespace(child_gone=Mock(side_effect=AssertionError('the original zero-session predicate must not be fabricated')))
        self.host.m=types.SimpleNamespace(process=Mock(side_effect=lambda pid:copy.deepcopy(actor)if pid=='456'else (_ for _ in()).throw(FileNotFoundError())))
        self.host.query=Mock(return_value=[{key:backend[key]for key in ['pid','backendStart','roleOid','databaseOid']}])
        self.host.sql_session=Mock(return_value=[{'actualPositiveKernelMappingIOFixture':True}])
        self.cache.owned=Mock(return_value=(before,rehearsed));attributed=[]
        def prior(cache,host):
            observation=value.prior_child_terminal(old,host,{'actor':old_actor});attributed.append(observation)
            return {'binding':prior_binding,'bindingSha256':prior_sha,'actualPriorStopped':prior_stopped,
                'retainedBootArchiveFile':str(value.PRIOR_BASE/'original-boot-link')}
        original_public=value.public
        def public(path,digest=None,maximum=6000000):
            if str(path)in docs:
                data=raw(docs[str(path)]);m.need(digest is None or m.sha(data)==digest,'explicit_private_IO_fixture_hash_required');return data
            return original_public(path,digest,maximum)
        family=self.exported['family'];reader=family.actual[m.READER];root,proof=reader.core(m.SOURCE_PINS[m.READER_MANIFEST])
        function=root.inverse_cache_catalog
        code=next(item for item in function.__code__.co_consts if isinstance(item,types.CodeType)and item.co_name=='prepared')
        core_test=load('ypal-ordinary-consumer-prefix-source-v3.test.py');core_case=core_test.Controls()
        self.addCleanup(core_case.doCleanups);core,source_fixture,source=core_case.source_fixture()
        after={'actualOriginal143READCatalogIOFixture':True};columns=[]
        self.host.read=types.SimpleNamespace(acl_catalog=lambda obj:obj)
        self.host.read_rehearsal={'after':after};self.host.read_host=types.SimpleNamespace(catalog=lambda:{'allColumnAcl':columns})
        ctx=types.SimpleNamespace(cache=self.cache,host=self.host,sql_ack={'resultJson':'{"actualOwnedCachePlan":true}',
            'postProof':{'catalog':{'actualFourREADCatalogIOFixture':True},'allColumnAcl':columns}},
            logins_enabled=lambda:False,catalog=lambda:{'actualFourREADCatalogIOFixture':True},proof=proof,
            phase=types.SimpleNamespace(admission_ref={name:'c'*64 for name in ['receiptSha256','planSha256','contextInputSha256']}),
            columns_current=Mock(),guard_scope=Mock(return_value={'actualCompleteGuardCatalogIOFixture':True}))
        mapper_case=load('ypal-ordinary-consumer-inverse-prefix-v3.test.py').Controls();mapper_case.setUp();self.addCleanup(mapper_case.doCleanups)
        mapper=mapper_case.runtime();scopes=[]
        def scope(cache_reads):
            catalog=mapper.catalog_scope(root,ctx,cache_reads)
            source_proof=source.current();scopes.append((catalog,source_proof));return {'validated':True,'catalog':catalog,'source':source_proof}
        ctx.inverse_scope=scope;save=Mock();terminal=Mock();op={'actualOwnedReaderOperationIOFixture':True}
        def cell(item):return(lambda:item).__closure__[0]
        closure={'context':ctx,'committed':ctx.sql_ack,'op':op}
        prepared=types.FunctionType(code,{**function.__globals__,'save':save,'all_readers_terminal':terminal},code.co_name,None,
            tuple(cell(closure[name])for name in code.co_freevars))
        packet={'mode':'inverse','planSha256':m.sha(ctx.sql_ack['resultJson'].encode()),'postProof':{'catalog':after}}
        with patch.object(value,'public',side_effect=public),patch.object(value,'prior_aborted',side_effect=prior),\
             patch.object(core,'authenticate',return_value={}),patch.object(core,'mapper_module',return_value=source_fixture.mapper):
            prepared(packet)
        self.assertEqual(len(scopes),1);self.assertTrue(scopes[0][0]['validated']);self.assertTrue(scopes[0][1]['currentWriterQualified'])
        self.assertEqual(len(attributed),1);self.assertTrue(attributed[0]['newHeldOwnerQualified']);self.assertFalse(attributed[0]['oldZeroSessionRecoveryPredicatePassed'])
        self.assertEqual(attributed[0]['newHeldOwnerMode'],'inverse');self.assertFalse(attributed[0]['forwardApprovalQualified'])
        old.child_gone.assert_not_called();self.host.sql_session.assert_called_once();terminal.assert_called_once_with(ctx,op)
        save.assert_called_once_with('cache-inverse-prepared.json',packet)

if __name__=='__main__':unittest.main(verbosity=2)
