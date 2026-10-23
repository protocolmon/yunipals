import importlib.util,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
FILE=Path(__file__).with_name('receipt-v3-hardened-probe-run-v2.py')
spec=importlib.util.spec_from_file_location('probe',FILE);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
RAW=b'[Service]\nType=exec\nUser=yunipals_unified_support\nExecStart=/usr/bin/true\n'
INV='a'*32
SOURCE={'MainPID':'716994','InvocationID':'c3463c9a2e1240e8890e318ba1360cf4','ActiveState':'active'}
SUPPORT={'MainPID':'0','InvocationID':'d4c52a1889ed45b8aa99493f2ee41b33','ActiveState':'failed'}
class Checks(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='receipt-probe-v2-review-',dir='/tmp');self.root=Path(self.tmp.name);self.base=self.root/'receipt';self.target=self.root/'probe.service';self.patches=[patch.object(h,'BASE',self.base),patch.object(h,'TARGET',self.target)];[p.start()for p in self.patches];self.calls=[]
 def tearDown(self):
  [p.stop()for p in reversed(self.patches)];self.tmp.cleanup()
 def before(self):return{'reviewHash':'review','definitionSha256':h.sha(RAW),'source':SOURCE,'support':SUPPORT}
 def create_owned(self):
  self.base.mkdir();h.save('before.json',self.before());created=h.write_new(self.target,RAW,0o644);h.save('unit-created.json',created)
 def loaded(self,active=False,gc=False,drop=False):
  return{'FragmentPath':str(self.target),'DropInPaths':'/foreign.conf'if drop else'','MainPID':'1234'if active else'0','ActiveState':'active'if active else'inactive','InvocationID':''if gc else INV,'ExecMainStartTimestampMonotonic':''if gc else'1','Result':'success','ExecMainStatus':'0'}
 def test_owned_inode_positive(self):
  self.create_owned();h.owned_target()
 def test_same_bytes_replaced_inode_refused_without_commands(self):
  self.create_owned();other=self.root/'other';other.write_bytes(RAW);other.chmod(0o644);other.replace(self.target)
  with patch.object(h,'command',side_effect=lambda args,**kw:self.calls.append(args)),self.assertRaisesRegex(RuntimeError,'owned_probe_inode_required'):h.cleanup()
  self.assertTrue(self.target.exists());self.assertEqual(self.calls,[])
 def test_foreign_same_bytes_without_creation_receipt_left_untouched(self):
  self.base.mkdir();h.save('before.json',self.before());h.write_new(self.target,RAW,0o644)
  with patch.object(h,'command',side_effect=lambda args,**kw:self.calls.append(args)),self.assertRaises(FileNotFoundError):h.cleanup()
  self.assertTrue(self.target.exists());self.assertEqual(self.calls,[])
 def test_active_same_definition_is_not_stopped_or_unlinked(self):
  self.create_owned()
  with patch.object(h,'state',return_value=self.loaded(active=True)),patch.object(h,'command',side_effect=lambda args,**kw:self.calls.append(args)),self.assertRaisesRegex(RuntimeError,'wait_for_owned_probe_terminal'):h.cleanup()
  self.assertTrue(self.target.exists());self.assertEqual(self.calls,[])
 def run_apply(self,*,drop=False,gc=False,wrong_manager=False):
  def state(unit):
   if unit==h.SOURCE:return SOURCE
   if unit==h.SUPPORT:return SUPPORT
   if not self.target.exists():return{'LoadState':'not-found','MainPID':'0','ActiveState':'inactive'}
   return self.loaded(gc=gc,drop=drop)
  def command(args,**kw):
   self.calls.append(args)
   if args[0]!='journalctl':return b''
   intent=json.loads((self.base/'intent.json').read_text());stamp=max(intent['startRealtimeUs'],time.time_ns()//1000)
   value={'format':'yunipals-qualified-receipt-v3-identity-probe-v1','qualified':True,'uid':969,'gid':963,'providerCalls':0,'databaseCalls':0,'credentialReads':0,'workerStarted':False,'noNewPrivileges':True,'capabilitiesEmpty':True,'importsVerified':True}
   rows=[{'_BOOT_ID':intent['bootId'],'__REALTIME_TIMESTAMP':str(stamp),'_SYSTEMD_INVOCATION_ID':INV,'_PID':'1234','MESSAGE':json.dumps(value)}]
   if gc:rows.append({'_PID':'1','UNIT':h.UNIT,'UNIT_RESULT':'success','_BOOT_ID':intent['bootId'],'__REALTIME_TIMESTAMP':str(stamp),'INVOCATION_ID':'b'*32 if wrong_manager else INV,'MESSAGE':'manager public terminal event'})
   return b'\n'.join(json.dumps(r).encode()for r in rows)
  with patch.object(h,'review',return_value=self.before()),patch.object(h,'definition',return_value=RAW),patch.object(h,'state',side_effect=state),patch.object(h,'command',side_effect=command):return h.apply('review')
 def test_dropin_refuses_before_start_and_retains_foreign_state(self):
  with self.assertRaisesRegex(RuntimeError,'owned_probe_manager_definition'):self.run_apply(drop=True)
  self.assertFalse(any('start'in a for a in self.calls));self.assertFalse(any('stop'in a for a in self.calls));self.assertTrue(self.target.exists());self.assertTrue((self.base/'unit-created.json').exists())
 def test_successful_terminal_ack_cleans_exact_created_unit(self):
  result=self.run_apply();self.assertTrue(result['qualified']);self.assertTrue(result['cleanup']['removed']);self.assertEqual(sum('start'in a for a in self.calls),1);self.assertFalse(any('stop'in a for a in self.calls));self.assertFalse(self.target.exists())
 def test_gc_exact_manager_invocation_ack_is_accepted(self):
  result=self.run_apply(gc=True);self.assertTrue(result['qualified']);self.assertTrue(result['terminalStatusBound']);self.assertFalse(self.target.exists());self.assertEqual(sum('start'in a for a in self.calls),1)
 def test_gc_wrong_manager_invocation_refuses_without_retry(self):
  with self.assertRaisesRegex(RuntimeError,'actual_terminal_invocation_or_manager_success'):self.run_apply(gc=True,wrong_manager=True)
  self.assertFalse((self.base/'result.json').exists());self.assertTrue((self.base/'cleanup.json').exists());self.assertEqual(sum('start'in a for a in self.calls),1)
if __name__=='__main__':unittest.main(verbosity=2)
