"""Current proof seams and frozen business-body equality; no production fixtures."""
import ast
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/name); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

m=load('ypal-restored-read-cache-provider-v1.py'); r=load('ypal-restored-read-admission-v1.py'); old=load('ypal-cache-guard-owner-v1.py')
fixture=load('ypal-cache-guard-owner-v1.test.py')


class Controls(unittest.TestCase):
    def runtime(self):
        raw=(HERE/'ypal-cache-guard-owner-v1.py').read_bytes()
        reader=types.SimpleNamespace(protected=lambda path,expected=None: raw,COLUMNS=Path('/fixed/columns.sql'))
        with patch.object(m,'read_module',return_value=reader):return m.cache_runtime()

    def test_new_namespace_does_not_execute_old_constructor_or_mutate_old_module(self):
        original=old.Host.__init__; runtime=self.runtime()
        self.assertIs(old.Host.__init__,original);self.assertEqual(old.BASE,Path('/var/backups/yunipals-ypal-cache-guard-owner-v1-20261024'))
        self.assertEqual(runtime.BASE,m.BASE);self.assertEqual(runtime.FORMAT,m.FORMAT)
        with patch.object(m,'initialize') as init:runtime.Host({'explicit':'new'})
        self.assertEqual(init.call_args.args[1],{'explicit':'new'})
        self.assertIs(init.call_args.args[2],runtime)

    def test_frozen_lifecycle_methods_are_bytecode_identical_except_named_seams(self):
        runtime=self.runtime()
        def fingerprint(code):
            def const(value):
                if isinstance(value,types.CodeType):return fingerprint(value)
                if value == 'yunipals-ypal-native-generation-candidate-v1':return m.GENERATION_FORMAT
                return value
            return (code.co_code,code.co_names,code.co_varnames,tuple(const(v)for v in code.co_consts))
        exclusions={'__init__','refresh','metadata_current'}
        for name in dir(old.Host):
            if name.startswith('__') or name in exclusions:continue
            before,after=getattr(old.Host,name),getattr(runtime.Host,name)
            if hasattr(before,'__code__'):
                self.assertEqual(fingerprint(before.__code__),fingerprint(after.__code__),name)
        names=['drain','reconcile_stop','stopped','commit','reconcile_commit','prepare_ack','archive_aborted','epoch_progress','inverse','restore_definition','reconcile_inverse','finish_inverse','loaded','publish_drop']
        for name in names:self.assertEqual(fingerprint(getattr(old,name).__code__),fingerprint(getattr(runtime,name).__code__),name)

    def test_actual_transformed_SQL_launch_has_fixed_preload_TSX_FDs_and_columns(self):
        tree=ast.parse((HERE/'ypal-cache-guard-owner-v1.py').read_bytes())
        fn=next(v for v in tree.body if isinstance(v,ast.FunctionDef) and v.name=='sql_child')
        transformed=m.transport_function(fn); text=ast.unparse(transformed)
        self.assertIn('public_cache_node_args(public)',text);self.assertIn('pass_fds=public.pass_fds',text)
        self.assertIn("'columnsSql': protected(COLUMN_SQL).decode()",text)
        self.assertIn('env = {**{',text);self.assertIn('**public.environment',text)
        for retained in ['host.sql_session','prepared(value)','os.killpg','commit-prepared','transaction-opened']:
            self.assertIn(retained,text)
        fn.name = 'unlisted_function'
        # An unknown template shape fails closed, rather than searching broadly.
        with self.assertRaises(RuntimeError):m.transport_function(fn)

    def test_only_two_exact_LOGIN_bits_possible_and_original_not_mutated(self):
        before={'roles':[{'name':n,'oid':o,'login':False,'limit':6}for n,o in m.LOGINS.items()]+[{'name':'yunipals_unified_collector','oid':'73187672','login':True}]}
        after=m.login_catalog(before,True)
        self.assertFalse(before['roles'][0]['login']);self.assertTrue(all(v['login']for v in after['roles']))
        before['roles'][0]['oid']='wrong'
        with self.assertRaises(RuntimeError):m.login_catalog(before,True)

    def test_current_proof_requires_full_column_catalog_and_no_old_whole_calls(self):
        cat={'roles':[{'name':n,'oid':o,'login':False}for n,o in m.LOGINS.items()]}
        after={'read':cat,'allColumnAcl':[]}; calls=[]
        reader=types.SimpleNamespace(catalog=lambda:copy.deepcopy(after),runtime=lambda:calls.append('active994')or{'current':True})
        newread=types.SimpleNamespace(admitted=lambda *_:({}, {}, {'after':after}),graph=r.graph,acl_catalog=r.acl_catalog)
        host=types.SimpleNamespace(new_read=newread,read_host=reader,config={'readAdmissionSha256':'a','readPlanSha256':'b','readContextInputSha256':'c'},static=types.SimpleNamespace(inverse_source=lambda:calls.append('terminal')or{'inverseOnly':True}))
        result=m.current_reads(host)
        self.assertTrue(result['validated']);self.assertFalse(result['originalWholeValidatorPassed']);self.assertEqual(calls,['active994'])
        calls.clear();self.assertTrue(m.current_reads(host,inverse=True)['inverseOnly']);self.assertEqual(calls,['terminal'])
        reader.catalog=lambda:{'read':cat,'allColumnAcl':[{'foreign':'PUBLIC'}]}
        with self.assertRaisesRegex(RuntimeError,'all_column_graph'):m.current_reads(host)

    def test_caller_cannot_inject_extra_grant_as_expected_catalog(self):
        cat={'roles':[{'name':n,'oid':o,'login':False}for n,o in m.LOGINS.items()]}
        after={'read':cat,'allColumnAcl':[]}
        host=types.SimpleNamespace(new_read=types.SimpleNamespace(admitted=lambda *_:({}, {}, {'after':after}),acl_catalog=r.acl_catalog),read_host=None,config={'readAdmissionSha256':'a'})
        with self.assertRaisesRegex(RuntimeError,'caller_expected'):m.current_reads(host,expected_catalog={**cat,'foreign':['GRANT']})

    def test_precommit_callback_refuses_foreign_column_without_COMMIT_authority(self):
        host=types.SimpleNamespace(new_read=types.SimpleNamespace(admitted=lambda *_:({}, {}, {'after':{'allColumnAcl':[]}})),read_host=None,config={'readAdmissionSha256':'a'})
        attempts=[]
        def body(host,mode,plan,prepared,*args):
            prepared({'postProof':{'allColumnAcl':[{'foreign':'column'}]}});attempts.append('COMMIT')
        cache=types.SimpleNamespace(_sql_child=body)
        with self.assertRaisesRegex(RuntimeError,'same_transaction'):m.qualified_sql_child(cache,host,'apply',{},lambda v:attempts.append('rootACK'))
        self.assertEqual(attempts,[])

    def test_actual_four_cache_relations_bind_unmanaged_full_ACL(self):
        before,after=fixture.catalogs();plan=fixture.plan()
        old.read_extension(before,after,plan,copy.deepcopy(after))
        acknowledged=copy.deepcopy(after);after['relations'][0]['acl']='foreign-unmanaged-SELECT'
        with self.assertRaisesRegex(RuntimeError,'acknowledged_cache_relation'):old.read_extension(before,after,plan,acknowledged)

    def test_guard_epochs_only_advance_full_ACLs_remain_exact(self):
        before={'epochs':[{'collection':c,'revision':'1'}for c in ['ethereum','base','polygon','bnb']], 'acl':'same', 'triggers':['exact']}
        after=copy.deepcopy(before);after['epochs'][1]['revision']='3'
        self.assertIsInstance(m.semantic_guard(before,after),str)
        for mutate in [lambda v:v['epochs'][0].update(revision='0'),lambda v:v.update(acl='foreign'),lambda v:v['triggers'].append('foreign')]:
            bad=copy.deepcopy(after);mutate(bad)
            with self.assertRaises(RuntimeError):m.semantic_guard(before,bad)

    def test_read_compatible_facade_refuses_a_foreign_passed_ACK(self):
        config={k:'a'*64 for k in m.CONFIG_KEYS};config['metadataProvenanceFile']='provenance-0-observed.json'
        query=lambda sql: {'actual':'readergraph'}
        sdk=types.SimpleNamespace(command=lambda *a,**k:b'',protected=lambda p:b'',lock=lambda:None)
        context=types.SimpleNamespace(historical=lambda:types.SimpleNamespace(READ_CATALOG=Path('/fixed/cd1.sql')),
            module=lambda *args:types.SimpleNamespace(consumer_frame=lambda h:{}),READ_HELPERS='oldpure',READ_HELPERS_SHA='pin')
        read_host=types.SimpleNamespace(h=types.SimpleNamespace(query=query,raw=types.SimpleNamespace(observer='kernel')),
            primitives={'sdk':sdk},plan={'actual':'new143'},parts={'catalogSql':'SELECT catalog'},context=context)
        runtime=self.runtime();retained=types.SimpleNamespace(artifact=lambda:None)
        r=types.SimpleNamespace(acl_catalog=lambda v:v,BASE=Path('/fixed/new143'),document=lambda *args:{'staged':True,'selected':False,'sourceRelease':runtime.RELEASE,'readIdentity':runtime.IDENTITY})
        def dependencies(path,digest):
            if path==runtime.RETAINED:return retained
            return types.SimpleNamespace(CLOSURE=())
        host=types.SimpleNamespace()
        with (patch.object(m,'static_read_host',return_value=(r,'static',read_host,{}, {}, {'after':{'read':{}}})),patch.object(m,'dependency',side_effect=dependencies),
             patch.object(m,'reader_catalog',return_value=({},'SELECT reader')),patch.object(m,'current_reads',return_value={'validated':True})as current):
            m.initialize(host,config,runtime)
            with self.assertRaisesRegex(RuntimeError,'passed_READ_ACK'):host.read.validate_current('f'*64)
            current.assert_not_called()
            self.assertTrue(host.read.validate_current(config['readAdmissionSha256'])['validated'])

    def test_new_driver_sessions_match_retained_unknown_session_predicate(self):
        source=(HERE/'ypal-restored-cache-sql-v1.mjs').read_text()
        import re
        app=re.search(r'application_name:\s*"([^"]+)"',source).group(1)
        tree=ast.parse((HERE/'ypal-cache-guard-owner-v1.py').read_bytes())
        fn=next(v for v in tree.body if isinstance(v,ast.FunctionDef)and v.name=='child_gone')
        self.assertIn(app,ast.unparse(fn));self.assertEqual(app,'ypal_cache_guard_owner_v1')

    def test_static_constructor_calls_only_explicit_static_query_factory(self):
        source=ast.parse((HERE/'ypal-restored-read-cache-provider-v1.py').read_bytes())
        fn=next(v for v in source.body if isinstance(v,ast.FunctionDef)and v.name=='static_read_host')
        calls={ast.unparse(v.func)for v in ast.walk(fn)if isinstance(v,ast.Call)}
        self.assertIn('static.query_components',calls);self.assertNotIn('r.Host',calls)
        self.assertNotIn('r.load',calls);self.assertNotIn('c9.load',calls);self.assertNotIn('self.context.load_components',calls)

if __name__=='__main__':unittest.main(verbosity=2)
