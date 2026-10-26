"""Real original proof bodies and owned-policy journals; all lifecycle I/O fixture-only."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=load('ypal-native-readiness-context-v1.py')
policy_tests=load('ypal-native-metadata-readiness-policy-v1.test.py')


def local(path,digest=None):
    name=Path(path).name
    origin={'final-supervisor-inventory-v1.py':HERE.parent/'solana-acceptance'/name,
        'ypal-old-runtime-inventory-v1.py':HERE.parent/'booster-launch'/name}.get(name,HERE/name)
    raw=origin.read_bytes()
    if digest is not None and hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('actual_public_source_bytes_required')
    return raw


class Controls(unittest.TestCase):
    def setUp(self):
        self.lifecycle=policy_tests.Controls();self.lifecycle.setUp();self.addCleanup(self.lifecycle.tearDown)
        self.result=self.lifecycle.apply();self.policy=policy_tests.m;self.ack=self.policy.acknowledgement(self.result)
        self.real_load=m.load
        self.enterContext(patch.object(m,'public',side_effect=local))
        self.enterContext(patch.object(m,'load',side_effect=lambda path:self.policy if Path(path)==m.POLICY else self.real_load(path)))
        self.refs={'producerSha256':m.POLICY_SHA,'manifestSha256':m.POLICY_MANIFEST_SHA,'resultSha256':self.result}
        self.ctx=m.Context(self.refs)

    def catalog(self,after=False):
        return{'read':{'functions':[{'schema':m.READ_SCHEMA,'name':'base_metadata_frame','arguments':'boolean',
            'oid':self.ack['functionOid'],'owner':'10','acl':'actual-fixture-ACL',
            'definitionMd5':self.ack['afterFunctionDefinitionMd5'if after else'beforeFunctionDefinitionMd5']}],
            'roles':[{'oid':'actual-fixture-role','login':False}],'targetEdges':[{'unchanged':'all-grants'}]},
            'allColumnAcl':[{'unchanged':'every-grantee-column'}]}

    def test_actual_source_pre_authentication_and_only_real_refs_shape(self):
        m.authenticate()
        self.assertEqual(self.ctx.ack,self.policy.acknowledgement(self.result))
        for change in [{'producerSha256':'0'*64},{'manifestSha256':'f'*64},{'resultSha256':None},{'extra':'not-admitted'}]:
            with self.assertRaises(RuntimeError):m.Context({**self.refs,**change})
        bad=json.loads(local(m.MANIFEST));bad['files'][m.POLICY.name]='f'*64
        with patch.object(m,'public',side_effect=lambda path,digest=None:m.encoded(bad)if Path(path)==m.MANIFEST else local(path,digest)),\
                patch.object(m,'load',side_effect=AssertionError('no source eval before complete manifest')):
            with self.assertRaises(RuntimeError):m.Context(self.refs)

    def test_same_context_source_manifest_and_policy_refs_cannot_change_before_current(self):
        calls=len(self.lifecycle.sql_calls);self.ctx.refs['producerSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'immutable_readiness_policy_refs'):self.ctx.current()
        self.ctx.refs=copy.deepcopy(self.refs)
        for target in[m.FILE,m.MANIFEST]:
            def changed(path,digest=None):
                raw=local(path)
                if Path(path)==target:raw+=b' '
                if digest is not None and m.sha(raw)!=digest:raise RuntimeError('same_source_fixture_changed')
                return raw
            with patch.object(m,'public',side_effect=changed):
                with self.assertRaisesRegex(RuntimeError,'same_source_fixture_changed'):self.ctx.current()
        self.assertEqual(len(self.lifecycle.sql_calls),calls)

    def test_real_policy_expected_target_projects_one_body_and_keeps_input_independent(self):
        before=self.lifecycle.before['target'];saved=copy.deepcopy(before)
        after=self.ctx.expected_target(before)
        self.assertEqual(after,self.lifecycle.actual['target']);self.assertEqual(before,saved)
        self.assertTrue(self.ctx.target_matches(after,before));self.assertFalse(self.ctx.target_matches(before,before))
        bad=copy.deepcopy(after);bad['relations'][0]['columns'].append({'foreign':'column'})
        self.assertFalse(self.ctx.target_matches(bad,before))
        after['functions'][0]['oid']='foreign'
        with self.assertRaises(RuntimeError):self.ctx.canonical_target(after)

    def test_full_catalog_projection_is_one_exact_OID_signature_and_md5_only(self):
        original=self.catalog();saved=copy.deepcopy(original);after=self.ctx.expected_catalog(original)
        self.assertEqual(original,saved);self.assertNotEqual(original,after)
        self.assertEqual(after['allColumnAcl'],original['allColumnAcl']);self.assertEqual(after['read']['roles'],original['read']['roles'])
        self.assertEqual(self.ctx.canonical_catalog(after),after)
        with self.assertRaises(RuntimeError):self.ctx.canonical_catalog(original)
        for change in [lambda v:v['read']['functions'][0].update(oid='88'),lambda v:v['read']['functions'][0].update(arguments='text'),
                       lambda v:v['read']['functions'][0].update(definitionMd5='foreign'),lambda v:v['read']['functions'].append(copy.deepcopy(v['read']['functions'][0]))]:
            bad=copy.deepcopy(original);change(bad)
            with self.assertRaises(RuntimeError):self.ctx.expected_catalog(bad)
        after['read']['roles'][0]['login']=True
        self.assertNotEqual(self.ctx.canonical_catalog(after),self.ctx.expected_catalog(original))

    def test_current_reexecutes_real_policy_snapshot_and_refuses_old_body_or_changed_marker(self):
        start=len(self.lifecycle.sql_calls)
        self.assertTrue(self.ctx.current()['actualPolicyBodyCurrent']);self.assertGreater(len(self.lifecycle.sql_calls),start)
        good=copy.deepcopy(self.lifecycle.actual)
        for change in [lambda v:v['target']['functions'][0].update(definition=self.ack['beforeFunctionDefinition']),
                       lambda v:v['target']['marker'].update(identity='foreign')]:
            self.lifecycle.actual=copy.deepcopy(good);change(self.lifecycle.actual)
            with self.assertRaises(RuntimeError):self.ctx.current()
        self.lifecycle.actual=good

    def test_actual_creator_body_old_refuses_new_own_current_retains_every_other_check(self):
        creator=policy_tests.old_tests.m
        self.lifecycle.legacy.i.query_components()['components']['readerHost'].query=lambda _:copy.deepcopy(self.lifecycle.actual['target'])
        # Fixture query components are built anew; retain the same actual returned fixture graph.
        parts=self.lifecycle.legacy.i.query_components();parts['components']['readerHost'].query=lambda _:copy.deepcopy(self.lifecycle.actual['target'])
        with patch.object(self.lifecycle.legacy.i,'query_components',return_value=parts):
            with self.assertRaisesRegex(RuntimeError,'OIDs_owner_body'):creator.data_current(self.lifecycle.created_sha)
            bound=self.ctx.bind_creator(m.Proxy(creator,__file__=str(m.CREATOR)))
            value=bound.data_current(self.lifecycle.created_sha)
            self.assertFalse(value['originalCreatorWholeValidatorPassed']);self.assertEqual(value['format'],m.FORMAT+'-created-object-current')
            self.assertEqual(bound.acknowledgement(self.lifecycle.created_sha),creator.acknowledgement(self.lifecycle.created_sha))
            self.lifecycle.actual['target']['relations'][0]['columns'].append({'foreign':'column'})
            with self.assertRaises(RuntimeError):bound.data_current(self.lifecycle.created_sha)

    def test_actual_common_metadata_primitives_keeps_real_body_and_bound_creator_query(self):
        common=load(m.COMMON.name);common.__file__=str(m.COMMON);events=[]
        creator=m.Proxy(policy_tests.old_tests.m,__file__=str(m.CREATOR))
        meta=types.SimpleNamespace(RETAINED_SHA='retained',INSTALLER_SHA='installer',INSTALL_SHA='install')
        p={'host':types.SimpleNamespace(s=object(),raw=types.SimpleNamespace(observer=object()),source_op={}), 'restoreReceipt':{}}
        intake=types.SimpleNamespace(query_components=lambda:{'components':{'privilegedSourcePrimitives':p,'readerHost':types.SimpleNamespace(query=lambda _:None)}},
            document=lambda *_:{'target':copy.deepcopy(self.lifecycle.before['target'])})
        def module(path,digest):
            if Path(path)==m.CREATOR:return creator
            if digest=='installer':return types.SimpleNamespace(installed=lambda *_:events.append('installed'))
            return object()
        common.module=module
        common.metadata_primitives=m.clone(common.metadata_primitives,{'module':module,'candidate_context':lambda _:{'createdReceiptSha256':self.lifecycle.created_sha},
            'intake':lambda:intake,'candidate_namespace':lambda _:meta})
        bound=self.ctx.bind_common(common)
        self.assertEqual(bound.metadata_primitives.__code__,common.metadata_primitives.__code__)
        with patch.object(self.ctx,'bind_creator',side_effect=lambda original:m.Proxy(original,data_current=lambda _:events.append('new-current'))):
            value=bound.metadata_primitives('candidate-fixture')
        self.assertEqual(events,['installed','new-current']);self.assertEqual(value['created']['target'],self.lifecycle.before['target'])
        self.assertIs(common.module,module)

    def test_actual_actor_static_compiler_receives_complete_fresh_common_namespace(self):
        common=load(m.COMMON.name);common.__file__=str(m.COMMON)
        original=dict(common.__dict__);bound=self.ctx.bind_common(common)
        self.assertIsNot(bound.__dict__,common.__dict__)
        self.assertTrue(set(original)<=set(bound.__dict__))
        for name in original:
            if name!='metadata_primitives':self.assertIs(bound.__dict__[name],original[name],name)
        owner=load('ypal-native-metadata-approval-epoch-v3.test.py').namespace
        initialize=owner.strip_refresh(bound.initialize_metadata,local(m.COMMON),bound.__dict__,'initialize_metadata')
        self.assertIs(initialize.__globals__['need'],common.need)
        self.assertIs(initialize.__globals__['authenticate_admission'],common.authenticate_admission)
        self.assertIs(initialize.__globals__['metadata_primitives'],bound.metadata_primitives)
        with self.assertRaisesRegex(RuntimeError,'explicit_static_V5_metadata_primitives'):
            initialize(None,None,None,None)
        metadata=types.SimpleNamespace(state=lambda _:{'MainPID':'1','ControlPID':'0','Job':'','ActiveState':'inactive'})
        terminal=owner.strip_refresh(common.metadata_terminal(metadata),local(m.COMMON),bound.__dict__,'terminal',metadata)
        self.assertIs(terminal.__globals__['terminal_sessions'],common.terminal_sessions)
        self.assertIs(terminal.__globals__['need'],common.need)
        with self.assertRaisesRegex(RuntimeError,'metadata_unit_must_be_terminal'):
            terminal(types.SimpleNamespace(m=object()),{},None)
        self.assertEqual(common.__dict__,original)

    def test_actual_admission_current_body_retains_complete_role_and_column_refusals(self):
        original=load('ypal-restored-read-admission-v1.py');before=self.catalog();after=self.ctx.expected_catalog(before)
        parts={'host':types.SimpleNamespace(catalog=lambda:copy.deepcopy(after)), 'rehearsal':{'after':before}, 'reference':{'receiptSha256':'a'*64}}
        namespace=m.Proxy(original,validate_catalog_current=m.clone(original.validate_catalog_current,{'admitted_components':lambda _:parts}))
        with self.assertRaisesRegex(RuntimeError,'full_catalog'):namespace.validate_catalog_current('a'*64)
        bound=self.ctx.bind_read_namespace(namespace)
        self.assertTrue(bound.validate_catalog_current('a'*64)['validated'])
        after['allColumnAcl'].append({'foreign':'column'})
        with self.assertRaisesRegex(RuntimeError,'full_catalog'):bound.validate_catalog_current('a'*64)
        after['allColumnAcl'].pop();after['read']['roles'][0]['login']=True
        with self.assertRaisesRegex(RuntimeError,'full_catalog'):bound.validate_catalog_current('a'*64)

    def test_actual_source_read_current_keeps_immutable_records_and_full_catalog(self):
        source=load('ypal-ordinary-source-authority-v5.py');source.__file__=str(m.SOURCE)
        original=load('ypal-restored-read-admission-v1.py');before=self.catalog();after=self.ctx.expected_catalog(before)
        parts={'host':types.SimpleNamespace(catalog=lambda:copy.deepcopy(after)), 'rehearsal':{'after':before}, 'reference':{'receiptSha256':'a'*64}}
        read=m.Proxy(original,validate_catalog_current=m.clone(original.validate_catalog_current,{'admitted_components':lambda _:parts}))
        bound=self.ctx.bind_source_guard(source);authority=object.__new__(bound.Authority)
        refs={'admissionSha256':'a'*64,'readPlanSha256':'b'*64,'readContextInputSha256':'c'*64}
        authority.read_parts=(refs,self.ctx.bind_read_namespace(read),parts)
        authority.read_target_sql='original-complete-target-SQL';authority.read_target=source.read_data_identity(self.ctx.expected_target(self.lifecycle.before['target']))
        authority.read_query=lambda _:copy.deepcopy(self.lifecycle.actual['target'])
        authority.read_record_paths=set();authority.read_records={}
        self.assertTrue(authority._read_current(refs)['validated'])
        authority.read_records={'foreign':'immutable-record'}
        with self.assertRaisesRegex(RuntimeError,'immutable_read'):authority._read_current(refs)
        authority.read_records={};after['allColumnAcl'].append({'foreign':'column'})
        with self.assertRaisesRegex(RuntimeError,'full_catalog'):authority._read_current(refs)

    def test_genuine_source_first_READ_construction_projects_expected_target_and_keeps_full_graph(self):
        source=load('ypal-ordinary-source-authority-v5.py');read=load('ypal-restored-read-admission-v1.py')
        entry=load(m.READ.name);before=self.catalog();after=self.ctx.expected_catalog(before);seen=[]
        intake=self.lifecycle.legacy.i
        def module(path,digest):
            if Path(path)==entry.BASELINE:return types.SimpleNamespace(INPUT=Path('/fixture/actual-baseline-input'),PLAN=Path('/fixture/actual-baseline-plan'))
            return intake.module(path,digest)
        creator=m.Proxy(policy_tests.old_tests.m,intake=lambda:m.Proxy(intake,module=module))
        host=types.SimpleNamespace(creator=creator,parts={'readerHost':types.SimpleNamespace(query=lambda sql:copy.deepcopy(self.lifecycle.actual['target']))},
            catalog=lambda:copy.deepcopy(after))
        refs={'admissionSha256':'a'*64,'readPlanSha256':'b'*64,'readContextInputSha256':'c'*64}
        parts={'host':host,'rehearsal':{'after':before},'reference':{'receiptSha256':refs['admissionSha256']}}
        read.admitted_components=lambda _:parts
        ack={'planSha256':refs['readPlanSha256'],'contextInputSha256':refs['readContextInputSha256'],'createdReceiptSha256':self.lifecycle.created_sha}
        admitted=m.Proxy(entry,acknowledgement=lambda _:copy.deepcopy(ack),namespace=lambda:read)
        def files(paths):seen.append(set(paths));return{'same':'all-private-record-frames-fixture'}
        source.Authority._read_current=m.clone(source.Authority._read_current,{'module':lambda path,digest:admitted,'file_frame':files})
        bound=self.ctx.bind_source_guard(source);authority=object.__new__(bound.Authority);authority.read_parts=None
        value=authority._read_current(refs)
        self.assertTrue(value['validated']);self.assertEqual(authority.read_target,source.read_data_identity(self.ctx.expected_target(self.lifecycle.before['target'])))
        self.assertEqual(authority.read_parts[0],refs);self.assertTrue(seen)
        self.assertIn(str(creator.BASE/'created.json'),authority.read_record_paths)
        self.lifecycle.actual['target']['functions'][0]['definition']=self.ack['beforeFunctionDefinition']
        with self.assertRaises(RuntimeError):authority._read_current(refs)

    def test_genuine_source_current_keeps_native_kernel_finance_and_private_checks(self):
        old=load('ypal-ordinary-source-authority-v5.test.py');control=old.Controls();authority,native,flags=control.guard()
        self.addCleanup(old.AUDIT_TEMP.cleanup)
        bound=self.ctx.bind_source_guard(old.m);current=object.__new__(bound.Authority);current.__dict__.update(authority.__dict__)
        with patch.object(old.m,'financial_current',return_value={'financialFixtureOnly':True}):
            value=current.current()
            self.assertTrue(value['currentWriterQualified']);self.assertEqual(value['operatorSha256'],m.own_sha())
            self.assertFalse(value['originalSource6CurrentPassed']);self.assertEqual(flags,['floor','heartbeat','floor','heartbeat'])
            native['app']['is_ready']=0
            with self.assertRaisesRegex(RuntimeError,'fresh_live_ready'):current.current()
            native['app']['is_ready']=1;current._snapshot=lambda:{'foreign':'private-actor-or-program'}
            with self.assertRaises(RuntimeError):current.current()

    def test_provider_transform_only_two_counted_assignments_and_inverse_is_not_granted(self):
        tree=ast.parse(local(m.PROVIDER_TEMPLATE));node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='namespace')
        before=copy.deepcopy(node);counts={'common':0,'reader':0};changed=self.ctx.transform_provider_node(node,counts)
        self.assertEqual(counts,{'common':1,'reader':1})
        class Reverse(ast.NodeTransformer):
            def visit_Call(self,row):
                if ast.unparse(row.func)in['_readiness.bind_common','_readiness.bind_read_namespace']:
                    return self.visit(row.args[0])
                return self.generic_visit(row)
        self.assertEqual(ast.dump(Reverse().visit(changed),include_attributes=False),ast.dump(before,include_attributes=False))
        parent=load('ypal-ordinary-publication-caller-v6.py').PreparedMetadata
        bound=self.ctx.bind_prepared_metadata(parent)
        with self.assertRaisesRegex(RuntimeError,'no_inverse_authority'):bound(None,None,None,True,None)

    def test_real_provider_current_reads_retains_full_graph_with_one_expected_catalog_operand(self):
        provider=load('ypal-restored-read-cache-provider-v1.py');read=load('ypal-restored-read-admission-v1.py')
        before=self.catalog();before['read']['roles']=[{'name':name,'oid':oid,'login':False}for name,oid in provider.LOGINS.items()]
        after=self.ctx.expected_catalog(before)
        r=m.Proxy(read,graph=self.ctx.bind_read_namespace(read).graph,admitted=lambda *_:({}, {}, {'after':before}))
        host=types.SimpleNamespace(new_read=r,read_host=types.SimpleNamespace(catalog=lambda:copy.deepcopy(after),runtime=lambda:{'sourceFixtureOnly':True}),
            config={'readAdmissionSha256':'a'*64,'readPlanSha256':'b'*64,'readContextInputSha256':'c'*64})
        with self.assertRaises(RuntimeError):provider.current_reads(host)
        tree=ast.parse(local(HERE/'ypal-restored-read-cache-provider-v1.py'))
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='current_reads')
        original=copy.deepcopy(node);counts={'catalog':0};node=self.ctx.transform_catalog_node(node,counts)
        self.assertEqual(counts,{'catalog':1})
        scope={**provider.current_reads.__globals__,'_readiness':self.ctx}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'actual-policy-provider-current','exec'),scope)
        self.assertTrue(scope['current_reads'](host)['validated'])
        after['allColumnAcl'].append({'foreign':'column'})
        with self.assertRaisesRegex(RuntimeError,'all_column_graph'):scope['current_reads'](host)
        after['allColumnAcl'].pop();after['read']['functions'][0]['definitionMd5']=self.ack['beforeFunctionDefinitionMd5']
        with self.assertRaises(RuntimeError):scope['current_reads'](host)
        self.assertEqual(self.ctx.catalog_expectation(self.ctx.expected_catalog(before)),self.ctx.expected_catalog(before))
        for row in ast.walk(node):
            if isinstance(row,ast.Call)and ast.unparse(row.func)=='_readiness.catalog_expectation':
                row.func=ast.Name(id='_remove_fixture_wrapper',ctx=ast.Load())
        class Reverse(ast.NodeTransformer):
            def visit_Call(self,row):
                if ast.unparse(row.func)=='_remove_fixture_wrapper':return self.visit(row.args[0])
                return self.generic_visit(row)
        self.assertEqual(ast.dump(Reverse().visit(node),include_attributes=False),ast.dump(original,include_attributes=False))

    def test_actual_Owner3_constructor_reaches_policy_creator_before_static_actor_setup(self):
        owner=load('ypal-native-metadata-approval-epoch-v3.test.py').namespace
        common=load(m.COMMON.name);common.__file__=str(m.COMMON);events=[]
        class CapturedAfterPolicy(Exception):pass
        creator=m.Proxy(policy_tests.old_tests.m,__file__=str(m.CREATOR))
        meta=types.SimpleNamespace(RETAINED_SHA='retained',INSTALLER_SHA='installer',INSTALL_SHA='install')
        p={'host':types.SimpleNamespace(s=object(),raw=types.SimpleNamespace(observer=object()),source_op={}), 'restoreReceipt':{}}
        def final_document(*_):events.append('after-policy-primitives-current');raise CapturedAfterPolicy()
        parts={'components':{'privilegedSourcePrimitives':p,'readerHost':types.SimpleNamespace(query=lambda _:None)}}
        intake=types.SimpleNamespace(query_components=lambda:parts,document=final_document)
        def module(path,digest):
            if Path(path)==m.CREATOR:return creator
            if digest=='installer':return types.SimpleNamespace(installed=lambda *_:events.append('installed'))
            return object()
        common.module=module;common.load_input=lambda _:{'candidateInputSha256':'actual-candidate-fixture'}
        common.metadata_primitives=m.clone(common.metadata_primitives,{'module':module,
            'candidate_context':lambda _:{'createdReceiptSha256':self.lifecycle.created_sha},'intake':lambda:intake,'candidate_namespace':lambda _:meta})
        entry=types.SimpleNamespace(common=lambda:common,namespace=lambda _:types.SimpleNamespace())
        parent=owner.Context
        config={'metadataInputSha256':'actual-execution-fixture'}
        init=m.clone(parent.__init__,{'authenticate':lambda:None,'configuration':lambda value:value,
            'protected':lambda *_:m.encoded(config),'module':lambda path:entry})
        class OwnerContext(parent):__init__=init
        bound=self.ctx.actor_context(m.Proxy(owner,Context=OwnerContext))
        self.assertEqual(bound.__init__.__code__,init.__code__)
        query_parts=self.lifecycle.legacy.i.query_components()
        query_parts['components']['readerHost'].query=lambda _:copy.deepcopy(self.lifecycle.actual['target'])
        with patch.object(self.lifecycle.legacy.i,'query_components',return_value=query_parts):
            with self.assertRaises(CapturedAfterPolicy):bound('actual-owned-metadata-input-fixture')
        self.assertEqual(events,['installed','after-policy-primitives-current'])

    def test_real_PreparedMetadata_constructor_and_invoke_keep_target_refresh_and_private_guards(self):
        caller=load('ypal-ordinary-publication-caller-v6.py');source=load('ypal-ordinary-source-authority-v5.py')
        source.__file__=str(m.SOURCE);events=[];frame={'owned':'all-actual-paths-fixture'}
        source.file_frame=lambda paths:copy.deepcopy(frame)
        source.module=lambda path,digest:types.SimpleNamespace(bind=lambda host:events.append('sealed-query-bind')or{'actual-query-SHA':digest})
        creator=m.Proxy(policy_tests.old_tests.m,__file__=str(m.CREATOR))
        primitives={'reader':creator,'created':{'target':copy.deepcopy(self.lifecycle.before['target'])},
            'readConfig':{'same':'admitted-refs'},'admission_ref':{'same':'actual-admission'}}
        host=types.SimpleNamespace(query=lambda _:copy.deepcopy(self.lifecycle.actual['target']),refresh=lambda:events.append('refresh'))
        namespace=types.SimpleNamespace(CANDIDATES=Path('/fixture/candidates'),INPUT=Path('/fixture/input'),SOURCES=Path('/fixture/sources'),__file__='/fixture/metadata')
        namespace.construct_context=lambda config,refresh,inverse,p,ref:events.append(('construct',config,inverse,p is primitives,ref))or host
        # The original PreparedMetadata body installs this constructor and runs
        # its original refresh/private/target bookends. The metadata workload
        # is an explicit I/O fixture here, not a current-authority substitute.
        scope={'events':events}
        exec("def metadata(phase,candidate,selection,refresh):\n"
            " p=phase.metadata_primitives()\n"
            " current=construct_context(p['readConfig'],refresh,False,p,p['admission_ref'])\n"
            " events.append('genuine-invoke-constructor-seam')\n"
            " return {'actorFixture':id(current),'current':True}\n",scope)
        namespace.metadata=scope['metadata']
        phase=types.SimpleNamespace(metadata_primitives=lambda:primitives);refresh=lambda:None
        bound=self.ctx.bind_prepared_metadata(caller.PreparedMetadata)
        value=bound(namespace,phase,refresh,False,source)
        self.assertEqual(value.invoke({},refresh,{})['current'],True)
        self.assertIn('genuine-invoke-constructor-seam',events);self.assertEqual(events.count('refresh'),1)
        self.assertIsNone(getattr(host,'metadataAuthority',None))
        frame['foreign']='private-file-or-inode'
        with self.assertRaisesRegex(RuntimeError,'immutable_metadata_constructor'):value.invoke({},refresh,{})

    def actor_fixture(self):
        actual=load('ypal-native-metadata-approval-current-observer-v1.test.py')
        controls=actual.Controls();controls.setUp();owner=actual.owner
        # The actual Owner3 actor_current and the observer's single comparison
        # seam execute. Only lifecycle constructors/host I/O are fixture-owned.
        class FixtureContext(controls.Context):
            pass
        FixtureContext.__init__=m.clone(controls.Context.__init__,{'module':lambda _:None,'METADATA':m.METADATA.name})
        self.enterContext(patch.object(owner,'Context',FixtureContext))
        self.enterContext(patch.dict(owner.actor_current.__globals__,{'acknowledgement':controls.acknowledgement}))
        self.enterContext(patch.object(actual.m,'owner_module',return_value=owner))
        self.enterContext(patch.object(actual.m,'protected',side_effect=actual.actual_source))
        real=m.load
        self.enterContext(patch.object(m,'load',side_effect=lambda path:actual.m if Path(path)==m.OBSERVER else real(path)))
        return actual,controls

    def test_genuine_actor_current_retains_raw_actor_kernel_ACK_and_private_refusals(self):
        actual,controls=self.actor_fixture()
        value=self.ctx.actor_current(actual.m.RESULT_SHA,actual.m.INPUT_SHA)
        self.assertEqual(value['actor'],controls.actualActor);self.assertNotEqual(value['actor'],controls.ackActor)
        self.assertFalse(value['originalOwner3CurrentPassed']);self.assertFalse(value['oldMetadataCurrentObserverPassed'])
        self.assertEqual(value['upgradeAcknowledgement'],controls.ack)
        controls.owned=[]
        with self.assertRaisesRegex(RuntimeError,'private_or_immutable_ACK'):self.ctx.actor_current(actual.m.RESULT_SHA,actual.m.INPUT_SHA)
        controls.owned=[{'pid':19,'backendStart':'epoch'}];controls.actualActor['unit']['InvocationID']='foreign'
        with self.assertRaisesRegex(RuntimeError,'other_unit_fields'):self.ctx.actor_current(actual.m.RESULT_SHA,actual.m.INPUT_SHA)
        with self.assertRaisesRegex(RuntimeError,'only_actual_accepted'):self.ctx.actor_current('f'*64,actual.m.INPUT_SHA)

    def test_epoch_current_uses_new_envelope_and_immutable_old_ACK_separately(self):
        actual,controls=self.actor_fixture()
        refs={'mode':'current','resultSha256':actual.m.RESULT_SHA,'inputSha256':actual.m.INPUT_SHA,
            'producerSha256':actual.m.OWNER_SHA,'manifestSha256':actual.m.OWNER_MANIFEST_SHA}
        epoch=types.SimpleNamespace(inverse=False,refs=refs,ack=copy.deepcopy(controls.ack))
        value=self.ctx.epoch_current(epoch)
        self.assertEqual(value['operatorSha256'],m.own_sha());self.assertEqual(value['upgradeAcknowledgement']['operatorSha256'],actual.m.OWNER_SHA)
        epoch.ack['operationSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'epoch_and_program_binding'):self.ctx.epoch_current(epoch)
        epoch.inverse=True
        with self.assertRaisesRegex(RuntimeError,'no_inverse_authority'):self.ctx.epoch_current(epoch)


if __name__=='__main__':unittest.main()
