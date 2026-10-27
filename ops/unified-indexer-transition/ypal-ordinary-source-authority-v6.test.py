"""Actual retained source/kernel code; isolated disappearance/permission controls."""
import ast
import copy
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
def load(path):
    spec=importlib.util.spec_from_file_location(path.stem,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load(HERE/'ypal-ordinary-source-authority-v6.py')
old=load(HERE/'ypal-ordinary-source-authority-v5.py')
host=load(HERE/'ypal-alchemy-source-switch-v1.host.py')
observer=load(HERE.parent/'booster-launch'/'ypal-old-runtime-inventory-v1.py')


def local(path,digest):
    origin=HERE/path.name
    if path.name==m.OBSERVER.name:origin=HERE.parent/'booster-launch'/path.name
    raw=origin.read_bytes();m.need(m.sha(raw)==digest,'exact_actual_fixture_source_required');return raw


def body(function):
    code=function.__code__ if hasattr(function,'__code__')else function
    return(code.co_code,code.co_names,tuple(body(value)if isinstance(value,types.CodeType)else value for value in code.co_consts))


class Controls(unittest.TestCase):
    def setUp(self):self.enterContext(patch.object(m,'public',side_effect=local))
    def rows(self,*pids):return[{'pid':pid,'backendStart':'pg-epoch-'+str(pid),'clientAddress':None,'clientPort':-1}for pid in pids]
    def fixture(self,sequence,mapped=None):
        raw=local(old.HOST_KERNEL,old.HOST_KERNEL_SHA)
        with patch.object(old,'public',return_value=raw):fn=old.classified_kernel(host)
        calls=[];current=[]
        def query(sql):
            self.assertEqual(sql,m.SESSION_SQL);value=copy.deepcopy(sequence[min(len(calls),len(sequence)-1)]);calls.append(sql)
            current[:]=value if type(value)is list else[];return value
        obs=types.SimpleNamespace(peer_fds=lambda pids,*_:{str(pid):{'startTicks':pid+800,'socketInodes':[pid]}for pid in pids},
            unix_peers=lambda _:[],run=lambda _:b'',tcp_clients=lambda *_:{},
            map_owned_backends=lambda *_:copy.deepcopy(current if mapped is None else mapped))
        args=(query,obs,73004621,{'source':{'processes':[{'pid':101,'startTicks':901}]}},{'source':(970,964)},True)
        authority=types.SimpleNamespace(kernel_function=fn,kernel_rows_valid=old.valid_final_source_rows,kernel_churn_type=old.KernelQueryChurn,
            expected={'sameActualFrame':True},_snapshot=lambda:{'sameActualFrame':True})
        return authority,args,calls
    def complete(self,pids):return{'format':m.FORMAT+'-backend-fds','complete':True,'gone':None,
        'fds':{str(pid):{'startTicks':pid+800,'socketInodes':[pid]}for pid in pids}}
    def gone(self,pid,ticks=None):return{'format':m.FORMAT+'-backend-fds','complete':False,
        'gone':{'pid':pid,'startTicks':ticks,'file':'stat'},'fds':{}}
    def run_kernel(self,authority,args,replies,epoch=None):
        def probe(_,pids):
            value=replies.pop(0)if replies else self.complete(pids)
            if isinstance(value,BaseException):raise value
            return value
        with patch.object(m,'backend_probe',side_effect=probe),patch.object(m,'proc_epoch',return_value=epoch),patch.object(m.time,'sleep'):
            return m.current_kernel(authority,*args,fence=authority.expected)

    def test_default_is_inert_without_runtime_sources_or_host(self):
        value=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True)
        self.assertEqual(value.stderr,b'');self.assertTrue(json.loads(value.stdout)['staticOnly'])

    def test_actual_namespace_retains_every_full_source_READ_private_route_body(self):
        value=m.composition()
        for name,function in old.Authority.__dict__.items():
            if hasattr(function,'__code__'):
                actual=getattr(value.Authority,name);self.assertEqual(body(actual),body(function),name)
                if hasattr(function,'__wrapped__'):self.assertEqual(body(actual.__wrapped__),body(function.__wrapped__),name)
        self.assertEqual(value.FORMAT,m.FORMAT);self.assertEqual(value.CAPTURE_BASE,m.CAPTURE_BASE)
        self.assertEqual(value.FAILURE_BASE,m.FAILURE_BASE)
        self.assertIs(value.Authority.current.__wrapped__.__globals__['current_kernel'],m.current_kernel)
        self.assertIs(value.Authority.kernel_churn_type,value.KernelQueryChurn)

    def test_retained_probe_body_changes_only_exact_stat_ENOENT_and_output_envelope(self):
        program=m.backend_probe_program(local(m.OBSERVER,m.OBSERVER_SHA));tree=ast.parse(program)
        loop=next(node for node in tree.body if isinstance(node,ast.For));handler=loop.body[-1]
        self.assertIsInstance(handler,ast.Try);self.assertEqual(ast.unparse(handler.handlers[0].type),'FileNotFoundError')
        self.assertIn("error.filename != str(p / 'stat')",ast.unparse(handler))
        raw=local(m.OBSERVER,m.OBSERVER_SHA);original=ast.parse(observer.PEER_FDS)
        prior=next(node for node in original.body if isinstance(node,ast.For))
        expected=copy.deepcopy(prior.body[2:]);expected.insert(1,ast.parse('observed_ticks=before').body[0])
        self.assertEqual([ast.dump(node,include_attributes=False)for node in handler.body],
                         [ast.dump(node,include_attributes=False)for node in expected])
        with self.assertRaises(RuntimeError):m.backend_probe_program(raw+b'\n')

    def test_real_exited_local_process_produces_only_typed_stat_ENOENT(self):
        child=subprocess.Popen([sys.executable,'-I','-B','-c','pass']);child.wait(timeout=8)
        result=m.backend_probe(observer,[child.pid])
        self.assertEqual(result,self.gone(child.pid));self.assertIsNone(m.proc_epoch(child.pid))

    def test_real_local_UID111_socket_inventory_retains_exact_original_positive_probe(self):
        code="import socket,time; sockets=socket.socketpair(); print('ready',flush=True); time.sleep(8)"
        child=subprocess.Popen(['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs',
            '--inh-caps=-all','--ambient-caps=-all',sys.executable,'-I','-B','-c',code],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline(),b'ready\n')
            result=m.backend_probe(observer,[child.pid]);self.assertTrue(result['complete'])
            row=result['fds'][str(child.pid)];self.assertEqual(row['startTicks'],m.proc_epoch(child.pid))
            self.assertEqual(len(row['socketInodes']),2)
        finally:
            if child.poll()is None:child.terminate()
            child.communicate(timeout=8)

    def test_probe_permission_assertion_stderr_timeout_and_unknown_reply_stay_hard(self):
        for error in [RuntimeError('bounded_readonly_inventory_command_required'),PermissionError('fixture'),subprocess.TimeoutExpired('fixture',8)]:
            with self.subTest(error=type(error).__name__),patch.object(observer,'run',side_effect=error),self.assertRaises(type(error)):
                m.backend_probe(observer,[11])
        for value in [{},self.complete([12]),{**self.gone(11),'fds':{'11':{}}},{**self.gone(11),'gone':{'pid':11,'startTicks':None,'file':'status'}}]:
            with self.subTest(value=value),patch.object(observer,'run',return_value=json.dumps(value).encode()),self.assertRaises(RuntimeError):
                m.backend_probe(observer,[11])

    def test_actual_stat_disappearance_requires_new_full_positive_capture(self):
        authority,args,calls=self.fixture([self.rows(11,12),self.rows(12),self.rows(12),self.rows(12)])
        result=self.run_kernel(authority,args,[self.gone(11)])
        self.assertEqual(result,{'source':self.rows(12)});self.assertEqual(len(calls),4)
        self.assertEqual(len(authority.kernel_attempts),2)
        self.assertFalse(authority.kernel_attempts[0]['positiveCompleteAttributionProved'])
        self.assertTrue(authority.kernel_attempts[0]['gone']['databaseEpochGone'])
        self.assertTrue(authority.kernel_attempts[1]['positiveCompleteAttributionProved'])

    def test_same_DB_epoch_absent_OS_proof_or_unrecorded_PID_refuses(self):
        for after,reply,epoch in [(self.rows(11),self.gone(11),None),(self.rows(12),self.gone(11),999),
                                  (self.rows(12),self.gone(11,901),901),(self.rows(12),self.gone(99),None)]:
            authority,args,calls=self.fixture([self.rows(11),after])
            with self.subTest(after=after,reply=reply,epoch=epoch),self.assertRaises((RuntimeError,StopIteration)):
                self.run_kernel(authority,args,[reply],epoch)

    def test_known_old_process_epoch_reuse_needs_full_fresh_role_capture(self):
        reused=self.rows(11);reused[0]['backendStart']='actual-new-database-epoch'
        authority,args,calls=self.fixture([self.rows(11),reused,reused,reused])
        self.assertEqual(self.run_kernel(authority,args,[self.gone(11,901)],epoch=902),{'source':reused})

    def test_unknown_or_unmapped_surviving_or_new_backend_never_retries_as_success(self):
        for mapped in [[],self.rows(12)+self.rows(12)]:
            authority,args,calls=self.fixture([self.rows(11),self.rows(12),self.rows(12)],mapped=mapped)
            with self.subTest(mapped=mapped),self.assertRaisesRegex(RuntimeError,'unique_positive_stable'):
                self.run_kernel(authority,args,[self.gone(11)])
            self.assertEqual(len(calls),3)

    def test_changed_actor_private_mount_or_route_fence_refuses_before_retry(self):
        authority,args,calls=self.fixture([self.rows(11),self.rows(12)])
        authority._snapshot=lambda:{'foreignPrivateActorOrRoute':True}
        with self.assertRaisesRegex(RuntimeError,'source_actor_static_private_or_route_changed'):
            self.run_kernel(authority,args,[self.gone(11)])
        self.assertEqual(len(calls),2)

    def test_final_positive_query_churn_still_repeats_full_capture_and_is_bounded(self):
        authority,args,calls=self.fixture([self.rows(11),self.rows(12),self.rows(12),self.rows(12)])
        self.assertEqual(self.run_kernel(authority,args,[]),{'source':self.rows(12)})
        self.assertTrue(authority.kernel_attempts[0]['positiveCompleteAttributionProved'])
        authority,args,calls=self.fixture([self.rows(11),self.rows(12)]*3)
        with self.assertRaises(old.KernelQueryChurn):self.run_kernel(authority,args,[])
        self.assertEqual(len(authority.kernel_attempts),3)

    def test_generic_first_probe_or_client_probe_failure_never_retries(self):
        authority,args,calls=self.fixture([self.rows(11)])
        with self.assertRaisesRegex(RuntimeError,'inventory_command'):
            self.run_kernel(authority,args,[RuntimeError('bounded_readonly_inventory_command_required')])
        self.assertEqual(len(calls),1)
        args[1].peer_fds=lambda *_:(_ for _ in()).throw(RuntimeError('client_probe_failure'))
        with self.assertRaisesRegex(RuntimeError,'client_probe_failure'):self.run_kernel(authority,args,[])
        self.assertEqual(len(calls),2)

    def test_invalid_duplicate_fresh_rows_and_exhausted_disappearance_refuse(self):
        for after in [[{'pid':12}],self.rows(12,12)]:
            authority,args,calls=self.fixture([self.rows(11),after])
            with self.subTest(after=after),self.assertRaises(RuntimeError):self.run_kernel(authority,args,[self.gone(11)])
        authority,args,calls=self.fixture([self.rows(11),self.rows(12),self.rows(12),self.rows(13),self.rows(13),self.rows(14)])
        with self.assertRaises(m.BackendDisappeared):self.run_kernel(authority,args,[self.gone(11),self.gone(12),self.gone(13)])
        self.assertEqual(len(calls),6);self.assertEqual(len(authority.kernel_attempts),3)


if __name__=='__main__':unittest.main()
