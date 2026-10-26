"""Real official compilation and mocked peer transport; no DB/SSH/Git."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-publication-jit-comparison-owner-v1.py');base=load(m.UTILITY.name)
public_reply=json.loads((HERE/'ypal-publication-jit-comparison-owner-v1.explain-fixture.json').read_bytes())
prior={key:value for key,value in public_reply.items()if key!='resultSha256'}

def peer():
    return types.SimpleNamespace(SENTINEL='/run/nonexistent-public-fixture',CLEAN=base.CLEAN,
        READ_OPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000')
def output(jit='on',result=None,settings=None,identity=None):
    return b'\n'.join(m.encoded(row)for row in[
        identity or {'role':'postgres','database':'yunipals_backfill','databaseOid':'17584'},
        settings or {**prior['planAggregate']['settings'],'jit':jit},
        result if result is not None else {'canonicalRows':31,'publishedRows':31,'probe':True}])
def observation(jit='on',result=None):
    raw=output(jit,result);process=types.SimpleNamespace(pid=123,returncode=0,communicate=Mock(return_value=(raw,b'')))
    return process
def dummy_sql():return 'SELECT exact_fixture_full_query'

class Controls(unittest.TestCase):
    def test_default_is_inert(self):
        with patch.object(m,'utility',side_effect=AssertionError('not loaded')),patch.object(m.subprocess,'Popen',side_effect=AssertionError('not dispatched')),contextlib.redirect_stdout(io.StringIO())as stream:
            self.assertEqual(m.main([]),0)
        self.assertTrue(json.loads(stream.getvalue())['staticOnly'])

    def test_actual_published_EXPLAIN_and_utility_bytes_authenticate(self):
        self.assertEqual(m.sha((HERE/m.UTILITY.name).read_bytes()),m.UTILITY_SHA)
        self.assertEqual(public_reply['resultSha256'],m.PREVIOUS_SHA);self.assertEqual(m.sha(m.encoded(prior)),m.PREVIOUS_SHA)
        with patch.object(m,'protected',return_value=m.encoded(prior)):self.assertEqual(m.previous(base),prior)
        for delta in [{'completed':0},{'actualQueryExecutionRequested':True},{'fullQuerySha256':'f'*64},{'relationSqlBytes':3134}]:
            with self.subTest(delta=delta),patch.object(m,'protected',return_value=m.encoded(prior|delta)),self.assertRaises(RuntimeError):m.previous(base)

    def test_actual_official_compiler_reproduces_both_production_query_hashes(self):
        candidates=[Path(os.environ['YUNIPALS_PUBLICATION_TEST_NODE'])]if 'YUNIPALS_PUBLICATION_TEST_NODE'in os.environ else[
            Path('/opt/node-v24.18.1/bin/node'),Path.home()/'.nvm/versions/node/v24.18.1/bin/node']
        node=next((value for value in candidates if value.is_file()),None)
        if node is None:self.skipTest('explicit local Node24.18.1 fixture unavailable')
        if subprocess.run([str(node),'--version'],capture_output=True,text=True,check=True,timeout=5).stdout.strip()!='v24.18.1':self.skipTest('exact Node24.18.1 fixture required')
        actual_protected=base.protected
        def local(path,digest=None):
            path=Path(path)
            if path in{base.TEMPLATE,base.PEER}:raw=(HERE/path.name).read_bytes();base.need(digest is None or base.sha(raw)==digest,'actual_public_source_required');return raw
            return actual_protected(path,digest)
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.jit-public-compiler-')as temp:
            folder=Path(temp);(folder/'native-recovery.env').write_text('\n'.join([
                'DATABASE_SCHEMA=unified_ypal_20261023_v1','READ_DATABASE_SCHEMA='+base.READ,'OWNERSHIP_READ_MODE=unified',
                'OWNERSHIP_READ_SCHEMA='+base.READ,'OWNERSHIP_RELEASE_ID=0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
                'YUNIPALS_PROJECTION_MODE=generation','METADATA_SOURCE_MODE=archive','BASE_METADATA_INGESTION=native','BNB_CONFIRMATIONS=20'])+'\n')
            with patch.object(base,'protected',side_effect=local):actual_peer=base.load_peer()
            with patch.object(base,'protected',side_effect=local),patch.object(base,'PROJECT',ROOT/'apps/yunipals-indexer'),patch.object(base,'NODE',str(node)),patch.object(actual_peer,'CANDIDATES',folder):
                sql,query=base.compile_query(actual_peer)
            self.assertEqual(query['fullQuerySha256'],m.QUERY_SHA);self.assertEqual(query['relationSqlSha256'],m.RELATION_SHA)
            self.assertEqual(len(sql.encode()),3558)
            for jit in['on','off']:
                request=m.payload(base,sql,jit).decode();self.assertEqual(request.count(sql),1)
                self.assertIn('SET LOCAL jit='+jit+';',request);self.assertTrue(request.endswith(sql+';ROLLBACK;'))
                for forbidden in['EXPLAIN','ANALYZE','COMMIT','SET LOCAL work_mem','CREATE ','ALTER ','GRANT ']:self.assertNotIn(forbidden,request)

    def test_transport_policy_original_timeouts_exact_query_and_only_local_JIT(self):
        sql=dummy_sql();process=observation('off')
        with patch.object(m,'QUERY_SHA',m.sha(sql.encode())),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'Popen',return_value=process)as launch,patch.object(m.time,'monotonic_ns',side_effect=[100,200]):
            value=m.observe(base,peer(),sql,'off',prior)
        args=launch.call_args.args[0]
        for argument in['--reuid=111','--regid=113','--clear-groups','--no-new-privs','PGOPTIONS='+peer().READ_OPTIONS,'postgres','yunipals_backfill']:self.assertIn(argument,args)
        self.assertEqual(launch.call_args.kwargs['env'],peer().CLEAN);self.assertEqual(launch.call_args.kwargs['cwd'],'/')
        self.assertTrue(launch.call_args.kwargs['start_new_session']);self.assertEqual(process.communicate.call_args.kwargs,{'timeout':80})
        self.assertEqual(value['transportWallNanoseconds'],100);self.assertEqual(value['result']['canonicalRows'],31)
        self.assertIn(sql.encode(),process.communicate.call_args.args[0])

    def test_peer_refuses_foreign_identity_changed_non_JIT_settings_and_bad_result_types(self):
        cases=[output(identity={'role':'foreign'}),output(settings={**prior['planAggregate']['settings'],'workMemKiB':8192}),
            output(settings={**prior['planAggregate']['settings'],'statementTimeoutMs':60001}),output(result={'canonicalRows':True,'publishedRows':31,'probe':True}),
            output(result={'canonicalRows':31,'publishedRows':31,'probe':1}),output(result={'canonicalRows':31,'publishedRows':31,'probe':True,'extra':0})]
        sql=dummy_sql()
        for raw in cases:
            process=observation();process.communicate.return_value=(raw,b'')
            with self.subTest(raw=raw),patch.object(m,'QUERY_SHA',m.sha(sql.encode())),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'Popen',return_value=process),self.assertRaises(RuntimeError):m.observe(base,peer(),sql,'on',prior)

    def test_timeout_preserves_original_exception_and_kills_only_owned_group(self):
        sql=dummy_sql();error=subprocess.TimeoutExpired('own comparison',80)
        process=types.SimpleNamespace(pid=123,communicate=Mock(side_effect=[error,(b'',b'')]))
        with patch.object(m,'QUERY_SHA',m.sha(sql.encode())),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'Popen',return_value=process),patch.object(m.os,'killpg')as kill:
            with self.assertRaises(subprocess.TimeoutExpired)as caught:m.observe(base,peer(),sql,'on',prior)
        self.assertIs(caught.exception,error);kill.assert_called_once_with(123,signal_value:=m.signal.SIGKILL)

    def test_query_or_JIT_mode_mutation_refuses_before_Popen(self):
        for sql,jit in[(dummy_sql(),'on'),('SELECT 1;SELECT 2','off'),('SELECT 1','other')]:
            with self.subTest(sql=sql,jit=jit),patch.object(m.subprocess,'Popen')as launch,self.assertRaises(RuntimeError):m.payload(base,sql,jit)
            launch.assert_not_called()

    def test_matching_and_moving_results_have_honest_diagnostic_labels(self):
        values=[]
        for jit,ns in[('on',100),('off',50)]:
            values.append({'jit':jit,'settings':{},'result':{'canonicalRows':31,'publishedRows':31,'probe':True},
                'resultSha256':'a'*64,'transportWallNanoseconds':ns,'stdoutSha256':'b'*64,'stdoutBytes':1,'stderrBytes':0,'requestSha256':'c'*64,'fullQuerySha256':m.QUERY_SHA})
        same=m.summary(values);self.assertTrue(same['resultObjectsEqual']);self.assertEqual(same['offToOnTransportWallRatio'],0.5)
        self.assertFalse(same['causalPerformanceQualified']);self.assertTrue(same['cacheWarmupAndConcurrentMovementNotControlled'])
        self.assertNotIn('canonicalRows',json.dumps(same))
        values[1]['result']['canonicalRows']=32;changed=m.summary(values)
        self.assertFalse(changed['resultObjectsEqual']);self.assertIsNone(changed['offToOnTransportWallRatio'])

    def test_full_main_one_pair_fresh_bookends_private_results_no_effect_authority(self):
        for drift in[False,True]:
            with self.subTest(drift=drift),tempfile.TemporaryDirectory(dir=ROOT,prefix='.jit-main-test-')as temp,contextlib.ExitStack()as stack:
                audit=Path(temp)/'audit';stack.enter_context(patch.object(m,'AUDIT',audit));stack.enter_context(patch.object(m.socket,'gethostname',return_value='yunipals-main'))
                utility=types.SimpleNamespace(snapshot=Mock(side_effect=[{'same':'source'},{'same':'changed'if drift else'source'}]),load_peer=lambda:peer(),
                    compile_query=lambda _:('sql',{'fullQuerySha256':m.QUERY_SHA,'relationSqlSha256':m.RELATION_SHA,'fullQueryBytes':3558,'relationSqlBytes':3133}))
                stack.enter_context(patch.object(m,'utility',return_value=utility));stack.enter_context(patch.object(m,'previous',return_value=prior))
                stack.enter_context(patch.object(m,'protected',return_value=b'authenticated'))
                def observe(_base,_peer,_sql,jit,_prior):
                    return{'jit':jit,'settings':{},'result':{'canonicalRows':31,'publishedRows':31,'probe':True},'resultSha256':'a'*64,
                        'transportWallNanoseconds':100,'stdoutSha256':'b'*64,'stdoutBytes':1,'stderrBytes':0,'requestSha256':'c'*64,'fullQuerySha256':m.QUERY_SHA}
                observed=stack.enter_context(patch.object(m,'observe',side_effect=observe))
                with contextlib.redirect_stdout(io.StringIO())as stream:
                    if drift:
                        with self.assertRaises(RuntimeError):m.main(['--run'])
                        self.assertFalse((audit/'result.json').exists());self.assertTrue((audit/'failure.json').exists())
                    else:
                        self.assertEqual(m.main(['--run']),0);value=json.loads(stream.getvalue())
                        self.assertTrue(value['actualQueryExecutionRequested']);self.assertFalse(value['newCurrentAuthority']);self.assertFalse(value['newHeldQualification'])
                        self.assertNotIn('canonicalRows',json.dumps(value));self.assertEqual(value['resultSha256'],m.sha((audit/'result.json').read_bytes()))
                        self.assertEqual(stat_mode:=(audit/'jit-on-observation.private.json').stat().st_mode&0o777,0o600)
                self.assertEqual([call.args[3]for call in observed.call_args_list],['on','off'])
                with self.assertRaises(RuntimeError):m.main(['--run'])

if __name__=='__main__':unittest.main(verbosity=2)
