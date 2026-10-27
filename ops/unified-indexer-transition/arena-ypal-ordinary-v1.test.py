"""Actual retained Arena lifecycle bodies plus ordinary/artifact/FS seams."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(path):
    spec=importlib.util.spec_from_file_location(Path(path).stem.replace('-','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(HERE/'arena-ypal-ordinary-v1.py');source=load(HERE/'arena-ypal-ordinary-v1.source.py');install=load(HERE/'arena-ordinary-runtime-v1.py')
def local(path,pin,maximum=2000000):
    raw=(HERE/Path(path).name).read_bytes();m.need(len(raw)<=maximum and m.sha(raw)==pin,'exact_local_frozen_component_required');return raw
with patch.object(m,'protected',local):n=m.namespace()
retained=load(HERE/'arena-ypal-native-v2.test.py');retained.m=n
retained.manifest={'files':{**m.PINS,m.FILE.name:m.sha(Path(m.__file__).read_bytes())}}
# The retained fake_apply helper uses this literal only as a dictionary key for
# its synthetic child digest. It never loads or admits the historical child.
retained.manifest['files']['arena-ypal-native-v1.mjs']=m.PINS['arena-ypal-ordinary-v1.mjs']
original_auth=retained.auth
def auth():
    value=original_auth();value['format']='yunipals-arena-ypal-current-role-auth-v1';return value
retained.auth=auth

class RetainedLifecycle(retained.Controls):
    def fake_apply(self,*args,**kwargs):
        tree=ast.parse((HERE/'arena-ypal-native-v2.test.py').read_bytes());cls=next(v for v in tree.body if isinstance(v,ast.ClassDef)and v.name=='Controls')
        fn=copy.deepcopy(next(v for v in cls.body if isinstance(v,ast.FunctionDef)and v.name=='fake_apply'))
        for node in ast.walk(fn):
            if isinstance(node,ast.Constant)and node.value=='yunipals-arena-ypal-native-child-v1':node.value='yunipals-arena-ypal-ordinary-child-v1'
        scope=dict(retained.__dict__);exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),__file__,'exec'),scope)
        return scope['fake_apply'](self,*args,**kwargs)
    def test_exact_plan_actual_floor_and_no_placeholder_pins(self):
        with patch.object(m,'namespace',return_value=n),patch.object(n,'read_module',return_value=source):
            value=plan();m.validate_plan(value)
            for changed in [{'ordinaryRuntime':{'resultSha256':'0'*64,'inputSha256':'b'*64}},
                            {'runtimeInstall':{'file':'/tmp/foreign','sha256':'a'*64}},
                            {'roleAuth':{'file':str(m.AUTH_BASE/'auth-result.json'),'sha256':'0'*64}},
                            {'floor':{'block':'0','hash':'0x'+'c'*64}}]:
                with self.assertRaises(RuntimeError):m.validate_plan({**value,**changed})
    def test_guard_uses_actual_admission_prepared_graph_and_owned_scram_hashes(self):
        # Only the synthetic adapter shape changes: execute the same real
        # files/roles body against the current2cac create() API.
        tree=ast.parse((HERE/'arena-ypal-native-v2.test.py').read_bytes());cls=next(v for v in tree.body if isinstance(v,ast.ClassDef)and v.name=='Controls')
        fn=copy.deepcopy(next(v for v in cls.body if isinstance(v,ast.FunctionDef)and v.name==self._testMethodName))
        class Fixture(ast.NodeTransformer):
            def visit_Call(self,node):
                if ast.unparse(node.func)=='types.SimpleNamespace'and{v.arg for v in node.keywords}=={'verify_current','runner','current_catalog'}:
                    return ast.parse("types.SimpleNamespace(verify_current=verified,create=lambda:(None,types.SimpleNamespace(current_catalog=lambda *_:{})))",mode='eval').body
                return self.generic_visit(node)
        tree=ast.fix_missing_locations(ast.Module(body=[Fixture().visit(fn)],type_ignores=[]));scope=dict(retained.__dict__);exec(compile(tree,__file__,'exec'),scope)
        with patch.object(n,'ordinary_role_catalog_sql',lambda inv,*args:inv.catalog_sql(*args)):scope[self._testMethodName](self)

class RetainedTerminalInverse(retained.SourceTerminalInverse):pass

def plan():
    return {'format':m.FORMAT,'roleAuth':{'file':str(m.AUTH_BASE/'auth-result.json'),'sha256':'9'*64},
      'currentActorsAck':{'file':str(n.ACTOR_ACK_FILE),'sha256':n.ACTOR_ACK_SHA},'admissionProposal':{'file':str(n.PROPOSAL_FILE),'sha256':m.PINS[n.PROPOSAL_FILE.name]},
      'floor':{'block':'53050000','hash':'0x'+'c'*64},'manifestSha256':'a'*64,
      'ordinaryRuntime':{'resultSha256':'b'*64,'inputSha256':'c'*64},'runtimeInstall':{'file':str(n.installer.BASE/'result.json'),'sha256':'d'*64}}

class Seams(unittest.TestCase):
    def credential_fixture(self):
        current=load(HERE/'arena-ypal-current-credentials-v1.test.py');credential=current.m;auth=current.build();f=current.f
        context=patch.object(f,'m',auth);context.start();self.addCleanup(context.stop)
        case=f.Controls('test_positive_three_explicit_phases_and_owned_disable');case.setUp();self.addCleanup(case.tearDown)
        proposal=json.loads((HERE/'arena-ypal-current-admission-v1.proposal.json').read_bytes());paths={r['role']:r['path']for r in case.rows}
        for worker in proposal['workers']:worker['privateOverlay']=paths[worker['role']]
        proposal['sourceReader']['privateFile']=paths['arena_native_reader'];proposal['filesAbsent']=[{'path':r['path']}for r in case.rows]
        receipt={**case.receipt,'format':'yunipals-arena-ypal-source-completion-v1','operatorSha256':credential.ADMISSION_HELPER_SHA,
          'commitOutcome':'commit_confirmed','proposalSha256':credential.PROPOSAL_SHA,
          'sqlSha256':{'operational':proposal['sql']['operational-roles.current.sql.review'],'source':proposal['sql']['arena-ypal-native-v1.source.sql.review']},
          'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'oldWholeInvocationGatePassed':False,
          'perDatabase':{'operational':{'commitOutcome':'commit_confirmed','roles':case.receipt['roles']},'source':{'commitOutcome':'commit_confirmed','roles':{'arena_native_reader':case.receipt['sourceRole']['oid']}}}}
        raw=auth.encoded(receipt);admission_sha=m.sha(raw);p=patch.object(m,'ADMISSION_SHA',admission_sha);p.start();self.addCleanup(p.stop)
        case.plan=credential.plan(admission_sha);case.proposal=proposal;case.receipt=receipt
        case.h.operator_hash=lambda:m.PINS['arena-ypal-current-credentials-v1.py']
        def proof(row,*_):return{'sessionUser':row['role'],'currentUser':row['role'],'oid':row['oid'],'databaseOid':auth.TARGETS[row['group']][2],
          'readOnly':True,'memberships':0,'elevated':False,'badPasswordRejected':True,'ownerRoleRejected':True,
          'readRelations':1 if row['group']=='operational'else len(proposal['sourceReader']['tables']),'connectionsConcurrent':1}
        case.h.auth=proof;case.o=auth.Operator(case.h,case.plan,proposal,receipt,case.rows,case.base)
        setup=case.o.setup(case.review('setup'));case.o.enable(case.review('enable'));result=case.o.prove(case.review('auth'))
        original_operator=auth.Operator;original_protected=auth.protected
        def protected(path,*args,**kwargs):
            path=Path(path)
            if path==n.ADMISSION_RESULT:return raw
            if path==n.ADMISSION_HELPER:return(HERE/n.ADMISSION_HELPER.name).read_bytes()
            if path==n.AUTH_BASE/'auth-result.json':return original_protected(case.base/'auth-result.json',*args,**kwargs)
            return original_protected(path,*args,**kwargs)
        p=patch.object(auth,'protected',side_effect=protected);p.start();self.addCleanup(p.stop)
        p=patch.object(auth,'Operator',side_effect=lambda *args:original_operator(*args,base=case.base));p.start();self.addCleanup(p.stop)
        owner=types.SimpleNamespace(build=lambda:auth,plan=credential.plan)
        host=types.SimpleNamespace(ordinary_namespace=n,proposal=proposal,auth=result,plan={'roleAuth':{'file':str(n.AUTH_BASE/'auth-result.json'),
          'sha256':m.sha((case.base/'auth-result.json').read_bytes())}},p=types.SimpleNamespace(load=lambda *args:owner))
        return host,case,auth,setup
    def test_private_auth_hash_requires_genuine_credential_chain_without_new_effects(self):
        host,case,auth,setup=self.credential_fixture();before=list(case.h.changes)
        self.assertTrue(m.credential_authentication(host)['privateCredentialChainQualified']);self.assertEqual(case.h.changes,before)
        host.plan['roleAuth']['sha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'receipt_hash_from_private_plan'):m.credential_authentication(host)
        self.assertEqual(case.h.changes,before)
    def test_private_hash_cannot_authorize_changed_authentication_body(self):
        host,case,auth,setup=self.credential_fixture();host.auth['authentication'][0]['badPasswordRejected']=False
        raw=auth.encoded(host.auth);(case.base/'auth-result.json').write_bytes(raw);host.plan['roleAuth']['sha256']=m.sha(raw)
        with self.assertRaisesRegex(RuntimeError,'nine_genuine'):m.credential_authentication(host)
    def test_genuine_credential_file_checker_refuses_same_bytes_foreign_inode(self):
        host,case,auth,setup=self.credential_fixture();p=Path(case.rows[0]['path']);raw=p.read_bytes();p.unlink();auth.save(p,raw)
        with self.assertRaisesRegex(auth.Refusal,'credential_inode_changed'):m.credential_authentication(host)
    def test_genuine_catalog_jit_correction_preserves_all_SQL_and_timeouts(self):
        inv=load(HERE/'arena-operational-role-inventory-v1.py')
        text=inv.catalog_sql(['arena_native_reader'],[],['unified_ypal_20261023_v1','yunipals_indexer_control'])
        actual=m.readonly_role_catalog_sql(inv,['arena_native_reader'],[],['unified_ypal_20261023_v1','yunipals_indexer_control'])
        self.assertEqual(actual.replace('SET LOCAL jit=off;',''),text)
        self.assertIn("statement_timeout='5s'",actual);self.assertIn("lock_timeout='1s'",actual)
        self.assertTrue(actual.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'));self.assertTrue(actual.endswith('ROLLBACK;\n'))
        with self.assertRaises(RuntimeError):m.readonly_role_catalog_sql(types.SimpleNamespace(catalog_sql=lambda *_:text.replace("statement_timeout='5s'","statement_timeout='50s'")))
    def test_actual_constructor_uses_mixed_admission_API_and_new_worker_paths_without_source_call(self):
        value=m.code_manifest();p=plan();p['manifestSha256']=m.sha(json.dumps(value).encode())
        proposal=json.loads((HERE/'arena-ypal-current-admission-v1.proposal.json').read_bytes())
        credential=auth();credential['admissionResultSha256']=m.ADMISSION_SHA;credential['acknowledgedCurrentActors']={'sha256':n.ACTOR_ACK_SHA}
        ack={'binding':{'same':'eight-actors'}};ac=types.SimpleNamespace(ack=ack,acknowledged=lambda:{'sha256':n.ACTOR_ACK_SHA})
        calls=[];adm=types.SimpleNamespace(create=lambda:(types.SimpleNamespace(source_ambient=lambda:calls.append('ambient')or{'publicNonDefinerFunctions':[]}),None),acknowledgement=lambda pin:calls.append(('ack',pin)))
        binding={'operatorSha256':'1'*64};owner={'migrationCommitOutcome':'commit_confirmed'};restored={'originalActors':'preserved'}
        raws={Path('/old/result.json'):json.dumps(owner).encode(),Path('/old/review.json'):json.dumps(binding).encode(),Path('/restored/result.json'):json.dumps(restored).encode()}
        baseline=json.dumps({'services':[]}).encode();o=types.SimpleNamespace(BASELINE_SHA=m.sha(baseline),read=lambda *a:(baseline,None))
        old_owner=types.SimpleNamespace(observer=lambda:o)
        restore=types.SimpleNamespace(load_owner=lambda:old_owner,PARENT=Path('/old'),BASE=Path('/restored'),RESULT_SHA=m.sha(raws[Path('/old/result.json')]),
          OWNER_REVIEW=m.sha(n.encoded(binding)),OWNER_SHA='1'*64,read=lambda _,path:raws[path])
        historical=(HERE.parent/'arena-consumer-release-review/proposal.v1.json').read_bytes()
        def read(path,*_):
            if path==n.HISTORICAL_PROPOSAL:return historical
            if path==n.PROPOSAL_FILE:return json.dumps(proposal).encode()
            if str(path)==p['roleAuth']['file']:return json.dumps(credential).encode()
            if path==n.ACTOR_ACK_FILE:return json.dumps(ack).encode()
            raise AssertionError(path)
        pre=types.SimpleNamespace(RESTORE=Path('/restore.py'),RESTORE_SHA='2'*64,RESTORE_RESULT_SHA=m.sha(n.encoded(restored)),protected=read)
        def dependency(path,*_):
            if path==pre.RESTORE:return restore
            if path==n.ACTOR_CONTEXT:return types.SimpleNamespace(Context=lambda:ac)
            if path==n.ADMISSION_HELPER:return adm
            return types.SimpleNamespace()
        pre.load=dependency
        def module(path,*_):
            if path==n.SOURCE_CONTEXT:return source
            return pre
        with patch.object(m,'namespace',return_value=n),patch.object(n,'read_module',side_effect=module),patch.object(n,'read_module_bytes',return_value=json.dumps(value).encode()),\
          patch.object(m,'credential_authentication',side_effect=lambda host:calls.append('private-auth-chain')),\
          patch.object(n.Host,'reference',lambda self,ref:json.loads(read(Path(ref['file'])))):
            h=n.Host(p)
        self.assertEqual(calls,['ambient',('ack',m.ADMISSION_SHA),'private-auth-chain'])
        for worker in h.worker_proposal['workers']:
            self.assertEqual(Path(worker['bundleRelative']).parent,install.TARGET/'dist')
        self.assertEqual(h.root,Path('/opt/yunipals-unified/releases')/install.PREDECESSOR)
    def test_detailed_cli_observation_is_exclusive_private_and_only_hashes_export(self):
        with tempfile.TemporaryDirectory(dir=HERE)as d,patch.object(m,'OBSERVATIONS',Path(d)/'observations'),patch('builtins.print')as emit:
            m.private_output(n,json.dumps({'format':m.FORMAT,'reviewHash':'a'*64,'review':{'private-value':'sentinel-private'}}))
            public=json.loads(emit.call_args.args[0]);self.assertNotIn('sentinel',json.dumps(public));self.assertFalse(public['privateValuesExported'])
            row=Path(public['privateObservationFile']);self.assertEqual(row.stat().st_mode&0o777,0o600)
            self.assertEqual(m.sha(row.read_bytes()),public['privateObservationSha256']);self.assertIn('sentinel-private',row.read_text())
    def test_child_entire_private_business_body_is_unchanged_except_import_and_domain(self):
        old=(HERE/'arena-ypal-native-v1.mjs').read_text();current=(HERE/'arena-ypal-ordinary-v1.mjs').read_text()
        begin=old.index('  const { tsImport } = req("tsx/esm/api");');end=old.index('  const pg = req("pg")',begin)
        first=current.index('  const facade = ');last=current.index('  const pg = req("pg")',first)
        rebuilt=current[:first]+old[begin:end]+current[last:]
        rebuilt=rebuilt.replace('yunipals-arena-ypal-ordinary-child-v1','yunipals-arena-ypal-native-child-v1').replace('yunipals-arena-ypal-ordinary-root-authority-v1','yunipals-arena-ypal-native-root-authority-v1')
        self.assertEqual(rebuilt,old)
    def test_all_finite_dependencies_and_static_defaults(self):
        for name,pin in m.PINS.items():self.assertEqual(m.sha((HERE/name).read_bytes()),pin,name)
        for file in [m.__file__,source.__file__,install.__file__]:
            value=json.loads(subprocess.check_output([sys.executable,'-I','-B',file]));self.assertTrue(value.get('staticOnly')or value.get('sourceOnly'));self.assertEqual(value['databaseWrites'],0)
    def test_real_manifest_and_finite_source_domain(self):
        with patch.object(m,'namespace',return_value=n):
            value=m.code_manifest();m.validate_manifest(value)
            value['files']['arena-ypal-current-credentials-v1.py']='a'*64
            with self.assertRaises(RuntimeError):m.validate_manifest(value)
        self.assertNotEqual(n.BASE.name,'yunipals-arena-ypal-restored-v1-20261024')
        self.assertEqual(n.ADMISSION_RESULT,m.ADMISSION_RESULT);self.assertEqual(n.AUTH_BASE,m.AUTH_BASE)
    def test_actual_plan_never_executes_initial_source_or_financial_constructor(self):
        with patch.object(m,'namespace',return_value=n),patch.object(n,'read_module',return_value=source):m.validate_plan(plan())
    def test_unit_only_retargets_the_literal_bundle_command(self):
        body=b'[Service]\nUser=yunipals-arena\nWorkingDirectory=/retained264a/app\nExecStart=/opt/node-v24.18.1/bin/node dist/arena-server.mjs\nEnvironmentFile=/private/unchanged\n[Install]\nWantedBy=multi-user.target\n'
        target=m.render_unit(body,{'bundleRelative':'dist/arena-server.mjs'},install.TARGET)
        self.assertEqual(target.replace(str(install.TARGET/'dist/arena-server.mjs').encode(),b'dist/arena-server.mjs'),body)
        with self.assertRaises(RuntimeError):m.render_unit(body.replace(b'dist/arena-server',b'dist/unknown'),{'bundleRelative':'dist/arena-server.mjs'},install.TARGET)
    def test_AST_business_and_private_SQL_changes_are_finite(self):
        before=ast.parse((HERE/m.TEMPLATE.name).read_bytes());after=m.transform((HERE/m.TEMPLATE.name).read_bytes())
        def funcs(tree):
            out={}
            for node in tree.body:
                if isinstance(node,ast.FunctionDef):out[node.name]=ast.dump(node,include_attributes=False)
                if isinstance(node,ast.ClassDef):
                    for fn in node.body:
                        if isinstance(fn,ast.FunctionDef):out[node.name+'.'+fn.name]=ast.dump(fn,include_attributes=False)
            return out
        a,b=funcs(before),funcs(after)
        self.assertEqual({k for k in a if a[k]!=b[k]}, {'validate_auth_receipt','journal_rows','Host.__init__','Host.files_and_roles','Host.child','Host.install_units','Host.native_boot','Host.inverse','validate_phase_leaf'})
        for name in ['apply','Host.drain','Host.backup','Host.adopted_state','Host.continue_apply','Host.inverse_review','Host.recovery_binding']:
            self.assertEqual(a[name],b[name],name)
        fn=next(v for v in after.body if isinstance(v,ast.FunctionDef)and v.name=='validate_phase_leaf')
        calls=[v.func.attr for v in ast.walk(fn)if isinstance(v,ast.Call)and isinstance(v.func,ast.Attribute)]
        self.assertNotIn('normal',calls);self.assertNotIn('current_actors',calls)
    def test_current_normal_binds_actual_ordinary_refs_and_no_old_free_claim(self):
        p=plan();proof={'format':source.FORMAT,'validated':True,'inverseOnly':False,'releaseId':n.SOURCE_ID,
          'manifestHash':n.SOURCE_CONTEXT_VALUE['manifestHash'],'schemaOid':'75963410','buildId':'71e2a7f3b7','sourceKind':'standalone',
          'sourceReceiptSha256':p['ordinaryRuntime']['resultSha256'],'sourceRuntimeInputSha256':p['ordinaryRuntime']['inputSha256'],
          'originalWholeValidationPassed':False,'financialAuthorityQualified':False,'currentCanonicalCoverageQualified':False,'sourceTerminal':False}
        h=types.SimpleNamespace(ordinary_namespace=n,plan=p,manifest={'source':n.SOURCE_CONTEXT_VALUE},p=types.SimpleNamespace(load=lambda *_:types.SimpleNamespace(FORMAT=source.FORMAT,validate_current=lambda *_,**__:copy.deepcopy(proof))))
        self.assertEqual(m.normal(h),proof);proof['sourceTerminal']=True
        with self.assertRaisesRegex(RuntimeError,'terminal_source'):m.normal(h)
        proof['inverseOnly']=True;self.assertEqual(m.normal(h,True),proof)
        proof['sourceKind']='managed'
        with self.assertRaises(RuntimeError):m.normal(h,True)

class Source(unittest.TestCase):
    def setUp(self):
        old=load(HERE/'arena-ypal-restored-v1.source.py')
        self.tables={k:{'oid':v,'owner':'73004621','kind':'r'}for k,v in old.TABLES.items()}
        self.tables.update({f'fixture_{i}':{'oid':str(900000+i),'owner':'73004621','kind':'r'}for i in range(44-len(self.tables))})
        self.native={'schemaOid':'75963410','tables':self.tables,'cache':{'owned':'cache'}}
        self.refs={'resultSha256':'b'*64,'inputSha256':'c'*64};self.actor={'processes':[{'pid':99,'startTicks':88}]}
        identity=old.native_identity(self.native)
        self.binding={'validated':True,'currentWriterQualified':True,'sourceKind':'standalone','runtimeProducerSha256':source.PINS['ypal-alchemy-ordinary-runtime-v1.py'],
         'runtimeReceiptSha256':self.refs['resultSha256'],'runtimeInputSha256':self.refs['inputSha256'],'sourceRelease':source.RELEASE,
         'nativeTableIdentities':self.tables,'syncCacheIdentity':self.native['cache'],'poolMaximum':5,'sourceReadinessQualified':False,
         'currentCanonicalCoverageQualified':False,'financialAuthorityQualified':False,'routingMode':'paid','chainRouting':source.ROUTING,
         'sourceKernelActors':{source.UNIT:self.actor},'runtimeBinding':{'financialReceiptSha256':'d'*64,'profileId':'profile'}}
        self.financial={'validated':True,'financialQualified':True,'sourceActorQualified':False,'receiptSha256':'d'*64,'manifestHash':identity['manifestHash'],'permits':[{}]*4,'profileId':'profile'}
        self.inverse={'validated':True,'sourceState':'owned-terminal','terminalInverseOnly':True,'currentWriterQualified':False,'sourceActorQualified':False,
          'financialAuthorityQualified':False,'receiptSha':self.refs['resultSha256'],'inputSha256':self.refs['inputSha256'],'operatorSha256':source.PINS['ypal-alchemy-ordinary-runtime-v1.py']}
        self.calls=[]
        def current(*a,**k):self.calls.append('current');return copy.deepcopy(self.binding)
        self.intake=types.SimpleNamespace(query_components=lambda:{'components':{'nativeIdentity':self.native}},validate_runtime=current)
        self.runtime=types.SimpleNamespace(validate_current_source=lambda *a,**k:self.calls.append('terminal')or copy.deepcopy(self.inverse))
        modules={'arena-ypal-restored-v1.source.py':old,'ypal-alchemy-ordinary-consumer-context-v1.py':self.intake,
          'ypal-alchemy-ordinary-runtime-v1.py':self.runtime,'ypal-alchemy-ordinary-financial-v1.py':types.SimpleNamespace(validate_current=lambda _:copy.deepcopy(self.financial))}
        p=patch.object(source,'module',lambda name:modules[name]);p.start();self.addCleanup(p.stop)
    def test_actual_standalone_mixed_paid_source_and_finance_are_separate(self):
        value=source.validate_current(self.refs);self.assertEqual(self.calls,['current','current']);self.assertEqual(value['source'],self.actor)
        self.assertFalse(value['financialAuthorityQualified']);self.assertFalse(value['currentCanonicalCoverageQualified']);self.assertFalse(value['oldFreeNineRouteValidatorPassed'])
        value=source.validate_current(self.refs,terminal_ok=True);self.assertTrue(value['inverseOnly']);self.assertFalse(value['sourceTerminal']);self.assertEqual(value['source'],self.actor)
    def test_owned_terminal_inverse_is_explicit_and_cannot_admit_forward(self):
        self.intake.validate_runtime=lambda *a,**k:(_ for _ in()).throw(RuntimeError('not_active'))
        with self.assertRaisesRegex(RuntimeError,'not_active'):source.validate_current(self.refs)
        value=source.validate_current(self.refs,terminal_ok=True);self.assertTrue(value['sourceTerminal']);self.assertFalse(value['sourceActorQualified']);self.assertIsNone(value['source'])
        self.inverse['sourceState']='foreign'
        with self.assertRaises(RuntimeError):source.validate_current(self.refs,terminal_ok=True)
    def test_no_managed_alias_wrong_routing_foreign_native_or_finance(self):
        for field,value in [('sourceKind','managed'),('chainRouting',{**source.ROUTING,'bnb':'paid_primary'}),('runtimeProducerSha256','c96')]:
            old=self.binding[field];self.binding[field]=value
            with self.assertRaises(RuntimeError):source.validate_current(self.refs)
            self.binding[field]=old
        self.financial['financialQualified']=False
        with self.assertRaises(RuntimeError):source.validate_current(self.refs)
        self.financial['financialQualified']=True;self.tables['arena_credit']['owner']='foreign'
        with self.assertRaises(RuntimeError):source.validate_current(self.refs)

class PublicRuntimeFS(unittest.TestCase):
    def fixture(self):
        temporary=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(temporary.cleanup);root=Path(temporary.name);os.chmod(root,0o755)
        source_root=Path('/tmp/yunipals-arena-ordinary-latest-complete-artifact-20261025')
        self.assertTrue(source_root.is_dir(),'Run real build fixture first')
        incoming=root/'input';shutil.copytree(source_root,incoming);dependencies=root/'retained-dependencies';dependencies.mkdir()
        values={'BASE':root/'audit','TARGET':root/'new-runtime'/install.ARTIFACT,'INPUT':incoming,'DEPENDENCIES':dependencies,
          'MANIFEST':HERE/'arena-ordinary-latest-complete-v1.manifest.json'}
        for key,value in values.items():p=patch.object(install,key,value);p.start();self.addCleanup(p.stop)
        return root
    def test_actual_sixteen_file_install_umask_and_owned_inode_receipt(self):
        root=self.fixture();before=install.identity(install.DEPENDENCIES);review=install.review()[0]
        mask=os.umask(0o077)
        try:value=install.install(install.sha(install.encoded(review)))
        finally:os.umask(mask)
        self.assertEqual(install.identity(install.DEPENDENCIES),before);self.assertEqual(install.installed(install.sha(install.encoded(value))),value)
        self.assertEqual(install.TARGET.stat().st_mode&0o777,0o755);self.assertEqual((install.TARGET/'dist').stat().st_mode&0o777,0o755)
        self.assertTrue(all(Path(install.TARGET/name).stat().st_mode&0o777==0o644 for name in value['layout']['files']))
        self.assertRaises(RuntimeError,install.install,install.sha(install.encoded(review)))
        raw=(install.TARGET/'dist/arena-owner-reader.mjs').read_bytes();(install.TARGET/'dist/arena-owner-reader.mjs').write_bytes(raw+b'\n')
        self.assertRaises(RuntimeError,install.installed,install.sha(install.encoded(value)))
    def test_foreign_target_or_changed_input_has_no_install_authority(self):
        root=self.fixture();review=install.review()[0];install.TARGET.parent.mkdir();install.TARGET.mkdir()
        self.assertRaises(RuntimeError,install.install,install.sha(install.encoded(review)));self.assertFalse(install.BASE.exists())
        install.TARGET.rmdir();(install.INPUT/'dist/arena-server.mjs').write_bytes(b'foreign')
        self.assertRaises(RuntimeError,install.review)
    def test_unknown_partial_install_is_never_implicitly_resent(self):
        root=self.fixture();review=install.review()[0];old=install.exclusive
        def fail(path,raw,mode):
            if path==install.TARGET/'manifest.json':raise RuntimeError('simulated_unknown_install')
            return old(path,raw,mode)
        with patch.object(install,'exclusive',side_effect=fail):self.assertRaises(RuntimeError,install.install,install.sha(install.encoded(review)))
        self.assertTrue((install.BASE/'intent.json').exists());self.assertTrue(install.TARGET.exists());self.assertFalse((install.BASE/'result.json').exists())
        self.assertRaises(RuntimeError,install.install,install.sha(install.encoded(review)))

if __name__=='__main__':unittest.main(verbosity=2)
