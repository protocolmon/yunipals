"""Exact compiler + mocked PostgreSQL controls; no DB, SSH or Git execution."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
SOURCE=HERE/'ypal-publication-explain-owner-v1.py'
spec=importlib.util.spec_from_file_location('plan',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ACTUAL_PROTECTED=m.protected
def public(path,digest=None):
    path=Path(path)
    if path==m.TEMPLATE:raw=(HERE/path.name).read_bytes()
    elif path==m.PEER:raw=(HERE/path.name).read_bytes()
    else:return ACTUAL_PROTECTED(path,digest)
    m.need(digest is None or m.sha(raw)==digest,'actual_source_fixture_digest_required');return raw

def settings():
    return{'readOnly':'on','serverVersionNum':160015,'jit':'on','jitAboveCost':100000,'jitInlineAboveCost':500000,
        'jitOptimizeAboveCost':500000,'workMemKiB':4096,'hashMemMultiplier':2,'maxParallelWorkersPerGather':2,
        'statementTimeoutMs':60000,'lockTimeoutMs':1000,'idleTransactionTimeoutMs':72000}
def plan():
    return[{'Plan':{'Node Type':'Result','Plan Rows':1,'Startup Cost':700,'Total Cost':701,'Output':['private-expression'],
        'Plans':[{'Node Type':'Index Scan','Plan Rows':440194,'Startup Cost':1,'Total Cost':700,
            'Index Name':'native_event_token_idx','Filter':'secret-document-literal','Relation Name':'private_relation'}]},
        'Planning Time':2.5,'JIT':{'Functions':5,'Options':{'Inlining':True,'Optimization':True,'Expressions':True,'Deforming':True}}}]

class Controls(unittest.TestCase):
    def peer(self):
        with patch.object(m,'protected',side_effect=public):return m.load_peer()
    def test_default_is_inert_without_any_process_or_file_constructor(self):
        import contextlib,io
        with patch.object(m,'snapshot',side_effect=AssertionError('no files')),patch.object(m.subprocess,'run',side_effect=AssertionError('no compiler')),\
            patch.object(m.subprocess,'Popen',side_effect=AssertionError('no peer')),contextlib.redirect_stdout(io.StringIO())as out:
            self.assertEqual(m.main([]),0)
        self.assertTrue(json.loads(out.getvalue())['staticOnly'])
    def test_all_exact_method_peer_and_nine_pure_compiler_sources(self):
        self.assertEqual(m.sha((HERE/m.TEMPLATE.name).read_bytes()),m.TEMPLATE_SHA)
        self.assertEqual(m.sha((HERE/m.PEER.name).read_bytes()),m.PEER_SHA)
        for name,digest in m.SOURCE_PINS.items():self.assertEqual(m.sha((ROOT/'apps/yunipals-indexer'/name).read_bytes()),digest)
        peer=self.peer();self.assertEqual(peer.READ_OPTIONS,'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000')
    def test_actual_official_compiler_and_genuine_capture_without_Host_or_DB_constructor(self):
        peer=self.peer()
        candidates=[Path(os.environ['YUNIPALS_PUBLICATION_TEST_NODE'])]if 'YUNIPALS_PUBLICATION_TEST_NODE'in os.environ else[
            Path('/opt/node-v24.18.1/bin/node'),Path.home()/'.nvm/versions/node/v24.18.1/bin/node']
        node=next((path for path in candidates if path.is_file()),None)
        if node is None:self.skipTest('explicit local Node24.18.1 compiler fixture unavailable')
        version=subprocess.run([str(node),'--version'],capture_output=True,text=True,check=True,timeout=5)
        if version.stdout.strip()!='v24.18.1':self.skipTest('compiler fixture requires exactly Node24.18.1')
        project=ROOT/'apps/yunipals-indexer'
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.publication-compiler-test-')as temporary:
            candidate=Path(temporary);(candidate/'native-recovery.env').write_text('\n'.join([
                'DATABASE_SCHEMA=unified_shadow_20261020_7e7375b0','READ_DATABASE_SCHEMA='+m.READ,'OWNERSHIP_READ_MODE=unified',
                'OWNERSHIP_READ_SCHEMA='+m.READ,'OWNERSHIP_RELEASE_ID=0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
                'YUNIPALS_PROJECTION_MODE=generation','METADATA_SOURCE_MODE=archive','BASE_METADATA_INGESTION=native','BNB_CONFIRMATIONS=20'])+'\n')
            real_run=m.subprocess.run;calls=[]
            def compile_only(args,**kwargs):
                calls.append((args,kwargs));self.assertNotIn('worker.ts',str(args));return real_run(args,**kwargs)
            with patch.object(m,'protected',side_effect=public),patch.object(m,'PROJECT',project),patch.object(m,'NODE',str(node)),\
                patch.object(peer,'CANDIDATES',candidate),patch.object(m.subprocess,'run',side_effect=compile_only),\
                patch.object(m.subprocess,'Popen',wraps=subprocess.Popen):
                sql,proof=m.compile_query(peer)
            self.assertEqual(len(calls),1);args,kwargs=calls[0]
            self.assertEqual(args[0:3],['/usr/bin/env','-i','PATH='+m.COMPILER_CLEAN['PATH']])
            self.assertIn('--env-file='+str(candidate/'native-recovery.env'),args);self.assertEqual(kwargs['timeout'],20)
            self.assertEqual(kwargs['cwd'],str(project));self.assertEqual(kwargs['env'],m.COMPILER_CLEAN)
            self.assertTrue(proof['originalMethodCodeIdentityVerified']);self.assertEqual(m.sha(sql.encode()),proof['fullQuerySha256'])
            for token in['canonicalRows','publishedRows','DISTINCT ON(event.token_id)','base_metadata_event','base_metadata_scan',
                'chain_event_block_hash','mint_transaction_hash','publication_content_hash','base_metadata_probe()',"base_error IS NOT NULL"]:
                self.assertIn(token,sql)
            self.assertNotIn(m.OLD_READ,sql);self.assertNotIn(';',sql)
    def test_genuine_capture_compiler_failure_cannot_return_a_query(self):
        peer=self.peer()
        process=types.SimpleNamespace(returncode=1,stderr=b'failure',stdout=b'')
        with patch.object(m,'protected',side_effect=public),patch.object(m,'PROJECT',ROOT/'apps/yunipals-indexer'),\
            patch.object(m.subprocess,'run',return_value=process),self.assertRaises(RuntimeError):m.compile_query(peer)
    def test_original_method_code_must_match_genuine_peer_capture(self):
        peer=self.peer()
        value=types.SimpleNamespace(meta=types.SimpleNamespace(READ=m.READ),s=types.SimpleNamespace(protected=lambda _:(HERE/m.TEMPLATE.name).read_bytes()))
        value.publication_proof=types.MethodType(lambda self:None,value)
        with self.assertRaisesRegex(RuntimeError,'genuine_unchanged_metadata_publication_body'):peer.capture_query(value)
    def test_original_readonly_peer_args_timeouts_exact_query_and_ROLLBACK(self):
        peer=self.peer();process=types.SimpleNamespace(pid=123,returncode=0)
        raw=b'\n'.join(json.dumps(value,indent=2).encode()for value in[
            {'role':'postgres','database':'yunipals_backfill','databaseOid':'17584'},settings(),plan()])+b'\n'
        process.communicate=lambda data=None,timeout=None:(raw,b'')
        from unittest.mock import Mock
        process.communicate=Mock(return_value=(raw,b''))
        with patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'Popen',return_value=process)as launch:
            actual,tree,transport=m.explain(peer,'SELECT exact_compiled_publication')
        self.assertEqual(actual,settings());self.assertEqual(tree,plan());self.assertEqual(transport['outputSha256'],m.sha(raw))
        args=launch.call_args.args[0]
        for arg in['--reuid=111','--regid=113','PGOPTIONS='+peer.READ_OPTIONS,'-XwAtq','postgres','yunipals_backfill']:self.assertIn(arg,args)
        self.assertEqual(launch.call_args.kwargs['env'],peer.CLEAN);self.assertTrue(launch.call_args.kwargs['start_new_session'])
        body=process.communicate.call_args.args[0].decode();self.assertEqual(process.communicate.call_args.kwargs,{'timeout':80})
        self.assertTrue(body.startswith('BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;'))
        self.assertTrue(body.endswith('SELECT exact_compiled_publication;ROLLBACK;'))
        self.assertIn('EXPLAIN (ANALYZE FALSE,',body);self.assertNotIn('COMMIT',body)
        self.assertNotIn('SET LOCAL jit',body);self.assertNotIn('SET LOCAL work_mem',body)
    def test_timeout_kills_only_its_owned_group_and_preserves_original_error(self):
        from unittest.mock import Mock
        peer=self.peer();error=subprocess.TimeoutExpired('readonly-plan',80)
        process=types.SimpleNamespace(pid=123,communicate=Mock(side_effect=[error,(b'',b'')]))
        with patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'Popen',return_value=process),patch.object(m.os,'killpg')as kill:
            with self.assertRaises(subprocess.TimeoutExpired)as caught:m.explain(peer,'SELECT exact')
        self.assertIs(caught.exception,error);kill.assert_called_once_with(123,m.signal.SIGKILL)
    def test_peer_identity_readonly_timeout_and_error_refusals(self):
        peer=self.peer();identity={'role':'postgres','database':'yunipals_backfill','databaseOid':'17584'}
        variants=[({**identity,'role':'foreign'},settings()),(identity,{**settings(),'readOnly':'off'}),
            (identity,{**settings(),'statementTimeoutMs':60001}),(identity,{**settings(),'lockTimeoutMs':1001})]
        for ident,current in variants:
            raw=b'\n'.join(json.dumps(value).encode()for value in[ident,current,plan()])
            process=types.SimpleNamespace(returncode=0,communicate=lambda *_args,**_kwargs:(raw,b''))
            with patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'Popen',return_value=process),self.assertRaises(RuntimeError):m.explain(peer,'SELECT exact')
    def test_aggregate_reports_only_estimates_costs_JIT_and_safe_index_names(self):
        value=m.aggregate(settings(),plan());self.assertEqual(value['nodeCount'],2)
        self.assertEqual(value['nodeKinds']['Index Scan']['maximumEstimatedRows'],440194)
        self.assertEqual(value['indexNames'],['native_event_token_idx']);self.assertEqual(value['jitPlan']['functions'],5)
        raw=json.dumps(value)
        for secret in['secret-document-literal','private-expression','private_relation','Filter','Output','Actual Rows']:
            self.assertNotIn(secret,raw)
        changed=plan();changed[0]['Plan']['Plans'][0]['Index Name']='not a safe name\nprivate'
        value=m.aggregate(settings(),changed);self.assertEqual(value['indexNames'],[]);self.assertEqual(len(value['nonIdentifierIndexNameHashes']),1)
    def test_ANALYZE_and_untyped_or_nonfinite_plan_evidence_refuses(self):
        changes=[lambda value:value[0].update({'Execution Time':1}),lambda value:value[0]['Plan'].update({'Actual Rows':1}),
            lambda value:value[0]['JIT'].update(Timing={}),lambda value:value[0]['Plan'].update({'Plan Rows':True}),
            lambda value:value[0]['Plan'].update({'Total Cost':float('nan')}),lambda value:value[0]['Plan'].update(Plans={})]
        for change in changes:
            value=plan();change(value)
            with self.subTest(case=changes.index(change)),self.assertRaises(RuntimeError):m.aggregate(settings(),value)
    def test_json_multiline_sequence_is_exactly_three_values(self):
        raw=b'\n'.join(json.dumps(value,indent=2).encode()for value in[{'identity':True},settings(),plan()])
        self.assertEqual(len(m.decode_values(raw)),3)
        for bad in[raw+b'\n{}',raw[:-2],b'{}']:
            with self.assertRaises((RuntimeError,json.JSONDecodeError)):m.decode_values(bad)
    def test_no_Host_or_application_constructor_and_no_runtime_query_execution_route(self):
        tree=ast.parse(SOURCE.read_bytes());functions={node.name:node for node in tree.body if isinstance(node,ast.FunctionDef)}
        calls=[ast.unparse(node.func)for node in ast.walk(functions['compile_query'])if isinstance(node,ast.Call)]
        self.assertNotIn('exec',calls);self.assertNotIn('Host',calls);self.assertIn('types.FunctionType',calls)
        self.assertIn('peer.capture_query',calls)
        payload=m.payload('SELECT untouched').decode()
        for forbidden in['ANALYZE TRUE','CREATE INDEX','ALTER ','COMMIT','SET LOCAL jit','SET LOCAL work_mem']:self.assertNotIn(forbidden,payload)
    def test_real_source_and_private_env_snapshot_detects_changed_bytes_and_inodes(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.publication-source-test-')as temporary:
            candidates=Path(temporary);environment=candidates/'native-recovery.env'
            environment.write_text('PUBLIC_TEST_SELECTOR=value\n');environment.chmod(0o600)
            with patch.object(m,'TEMPLATE',HERE/m.TEMPLATE.name),patch.object(m,'PEER',HERE/m.PEER.name),\
                patch.object(m,'PROJECT',ROOT/'apps/yunipals-indexer'),patch.object(m,'CANDIDATES',candidates):
                before=m.snapshot();self.assertEqual(m.snapshot(),before)
                environment.write_text('PUBLIC_TEST_SELECTOR=changed\n')
                self.assertNotEqual(m.snapshot(),before)
                environment.unlink();environment.symlink_to(HERE/m.PEER.name)
                with self.assertRaises(RuntimeError):m.snapshot()
    def test_whole_main_saves_only_aggregate_no_counts_or_env_and_never_reuses_audit(self):
        import contextlib,io
        for changed in [False,True]:
            with self.subTest(changed=changed),tempfile.TemporaryDirectory(dir=ROOT,prefix='.publication-plan-test-')as temporary,contextlib.ExitStack()as stack:
                audit=Path(temporary)/'audit';stack.enter_context(patch.object(m,'AUDIT',audit))
                stack.enter_context(patch.object(m.socket,'gethostname',return_value='yunipals-main'))
                stack.enter_context(patch.object(m,'snapshot',side_effect=[{'fixedSourceEnvHashes':True},{'fixedSourceEnvHashes':not changed}]))
                stack.enter_context(patch.object(m,'load_peer',return_value=object()))
                stack.enter_context(patch.object(m,'compile_query',return_value=('SELECT exactOriginal',{
                    'relationSqlSha256':'a'*64,'fullQuerySha256':'b'*64,'relationSqlBytes':10,'fullQueryBytes':20,'originalMethodCodeIdentityVerified':True})))
                stack.enter_context(patch.object(m,'explain',return_value=(settings(),plan(),{'outputSha256':'c'*64,'outputBytes':200,'stderrBytes':0})))
                with contextlib.redirect_stdout(io.StringIO())as output:
                    if changed:
                        with self.assertRaises(RuntimeError):m.main(['--run'])
                        self.assertFalse((audit/'result.json').exists());self.assertTrue((audit/'failure.json').exists())
                    else:
                        self.assertEqual(m.main(['--run']),0);value=json.loads(output.getvalue())
                        self.assertFalse(value['actualPublicationCountsOrReadinessReturned']);self.assertFalse(value['newCurrentAuthority'])
                        self.assertEqual(m.sha((audit/'result.json').read_bytes()),value['resultSha256'])
                        raw=json.dumps(value)
                        for secret in['private-expression','secret-document-literal','private_relation','DATABASE_URL','canonicalRows']:
                            self.assertNotIn(secret,raw)
                with self.assertRaises(RuntimeError):m.main(['--run'])

if __name__=='__main__':unittest.main(verbosity=2)
