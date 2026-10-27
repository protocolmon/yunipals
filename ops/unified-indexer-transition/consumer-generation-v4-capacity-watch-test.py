import importlib.util,json,os,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('watch',HERE/'consumer-generation-v4-capacity-watch.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_node_env_keeps_private_file_order_and_explicit_unique_app(self):
  args=m.node_args(m.APP)
  self.assertEqual([a.split('=',1)[1]for a in args if a.startswith('--env-file=')],list(m.ENV_FILES))
  self.assertIn('PGAPPNAME='+m.APP,args)
  self.assertEqual(m.ENV_FILES[0],str(m.OPS/'consumer-generation-v4-inline.env'))
  self.assertEqual(m.ENV_FILES[-1],str(m.OPS/'consumer-generation-v4-capacity.env'))
  self.assertEqual(m.MIN_RESERVE,25_000_000_000);self.assertGreater(m.ABORT_FREE,m.MIN_RESERVE)
  self.assertLess(m.MAX_SECONDS,1500)
 def test_foreign_invocation_cannot_cancel_or_kill(self):
  child=types.SimpleNamespace(pid=123,poll=lambda:None)
  with patch.object(m,'state',return_value={'InvocationID':'b'*32,'MainPID':str(os.getpid())}),patch.object(m,'backend_query')as backend,patch.object(m.os,'killpg')as kill:
   with self.assertRaisesRegex(RuntimeError,'invocation_changed'):m.stop_owned({'InvocationID':'a'*32,'MainPID':str(os.getpid())},child,123)
  backend.assert_not_called();kill.assert_not_called()
 def test_backend_termination_before_process_stop_and_zero_session_postcondition(self):
  calls=[]
  child=types.SimpleNamespace(pid=123,poll=lambda:None,wait=lambda timeout:calls.append('wait'))
  def query(terminate,since):
   calls.append('terminate'if terminate else'check');self.assertEqual(since,123)
   return {'rows':[{'pid':444,'terminated':True}]}if terminate else{'rows':[]}
  with patch.object(m,'identity'),patch.object(m,'backend_query',side_effect=query),patch.object(m.os,'killpg',side_effect=lambda*args:calls.append('signal')):
   result=m.stop_owned({},child,123)
  self.assertEqual(calls,['terminate','signal','wait','check']);self.assertEqual(result['remainingBackends'],0)
 def test_unconfirmed_backend_termination_is_failure(self):
  with patch.object(m,'identity'),patch.object(m,'backend_query',return_value={'rows':[{'pid':444,'terminated':False}]}),patch.object(m.os,'killpg')as kill:
   with self.assertRaisesRegex(RuntimeError,'termination_not_confirmed'):m.stop_owned({},None,1)
  kill.assert_not_called()
 def test_next_backup_window_and_active_backup_are_fail_closed(self):
  with tempfile.TemporaryDirectory()as work:
   def run(args,*unused,**kw):
    if args[0].endswith('systemctl'):return b'inactive\n'
    return json.dumps({'type':'t','data':[1_100_000_000]}).encode()
   with patch.object(m,'run',side_effect=run),patch.object(m.time,'time',return_value=1000),patch.object(m,'Path',side_effect=lambda p:Path(work)if p=='/proc'else Path(p)):
    with self.assertRaisesRegex(RuntimeError,'full_one_shot_window'):m.no_overlap_window(1470)
   with patch.object(m,'run',return_value=b'active\n'):
    with self.assertRaisesRegex(RuntimeError,'backup_overlap'):m.no_overlap_window(1470)
 def test_unit_retains_zero_capabilities_and_bounded_nonretry_runtime(self):
  unit=(HERE/'consumer-generation-v4-refresh.service.example').read_text()
  self.assertIn('CapabilityBoundingSet=\n',unit);self.assertIn('Restart=no\n',unit)
  self.assertIn('RuntimeMaxSec=1500\n',unit);self.assertIn('RuntimeDirectoryMode=0700\n',unit)
  self.assertIn('RuntimeDirectoryPreserve=yes\n',unit)
  self.assertNotIn('[Install]',unit)
if __name__=='__main__':unittest.main()
