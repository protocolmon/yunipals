#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import types

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('owner',HERE/'ypal-rpc-admission-v1.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
profile=json.loads((HERE/'ypal-rpc-profile-v1.json').read_bytes())

class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='.ypal-rpc-test-',dir=HERE);self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.patch=patch.object(m,'BASE',self.base);self.patch.start();self.addCleanup(self.patch.stop)
 def test_profile_exact_actual_three_sources_and_unchanged_abis(self):
  root=HERE.parent.parent;old=json.loads((root/'ops/unified-indexer-transition/normal-rpc-profile-v1.json').read_bytes());manifest=json.loads((root/'docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json').read_bytes())
  names={'BoosterRegistry':'registry','BoosterMonsters':'monsters','BoosterEngine':'engine'}
  self.assertEqual(len(profile['manifest']['sources']),3)
  for row in profile['manifest']['sources']:
   original=next(x for x in old['manifest']['sources'] if x['id']==row['id']);key=names[row['contractName']];expected={**original,'address':manifest[key].lower(),'startBlock':manifest['receipts'][key]['blockNumber']};self.assertEqual(row,expected)
  self.assertEqual(profile['limits'],old['limits']);self.assertEqual(profile['coordinatorId'],old['coordinatorId']);self.assertEqual(profile['scope'],old['scope'])
 def test_profile_and_approval_pins(self):
  self.assertEqual(m.sha((HERE/'ypal-rpc-profile-v1.json').read_bytes()),m.PROFILE_SHA);self.assertEqual(m.sha((HERE/'ypal-rpc-approval-v1.json').read_bytes()),m.APPROVAL_SHA);self.assertEqual(m.sha((HERE/'ypal-rpc-official-v1.mjs').read_bytes()),m.RUNNER_SHA)
  a=json.loads((HERE/'ypal-rpc-approval-v1.json').read_bytes());self.assertEqual(a,{'profile':profile,'expiresAt':m.EXPIRY,'permits':[]})
 def test_all_paid_flags_disabled_and_bounded_new_endpoint(self):
  e=dict(x.split('=',1) for x in m.env_bytes().decode().splitlines());self.assertEqual(e['MARKET_RPC_PROXY_PORT'],'19212');self.assertEqual(e['MARKET_RPC_PROXY_HOST'],'127.0.0.1');self.assertEqual(e['MARKET_RPC_PROXY_MAX_IN_FLIGHT'],'2');self.assertEqual(sum('PAID' in k for k in e),7);self.assertTrue(all(v=='false' for k,v in e.items() if 'PAID' in k));self.assertEqual(e['MARKET_RPC_PROXY_UNIFIED_PROFILE_ID'],m.PROFILE_ID)
 def test_unit_append_only_overrides_no_security_reduction(self):
  original='[Service]\nUser=yunipals-market-prod-rpc\nNoNewPrivileges=yes\nCapabilityBoundingSet=\n[Install]\nWantedBy=multi-user.target\n';out=m.unit_bytes(original).decode();self.assertTrue(out.startswith(original));self.assertIn('RuntimeMaxSec=infinity',out);self.assertNotIn('User=root',out);self.assertNotIn('ExecStart=/usr/bin/setpriv',out);self.assertIn('EnvironmentFile='+str(m.ENV_FILE),out)
 def test_catalog_allows_only_exact_new_profile(self):
  before={'budget':{'dailyCu':'1000000'},'profile':None,'newPermits':0,'activePermits':0};after=copy.deepcopy(before);after['profile']={'profile_id':m.PROFILE_ID,'scope':profile['scope'],'manifest_hash':m.MANIFEST_HASH,'policy':profile,'enabled':True,'expires_at':'2026-11-19T18:00:00+00:00'}
  with patch.object(m,'pinned',return_value=json.dumps(profile).encode()):m.exact_catalog(after,before,True)
  for key,val in [('newPermits',1),('activePermits',1),('budget',{'dailyCu':'2000000'})]:
   bad=copy.deepcopy(after);bad[key]=val
   with self.assertRaises(RuntimeError),patch.object(m,'pinned',return_value=json.dumps(profile).encode()):m.exact_catalog(bad,before,True)
  for key,val in [('scope','other'),('enabled',False),('expires_at','2026-11-20T18:00:00Z'),('manifest_hash','0x'+'1'*64)]:
   bad=copy.deepcopy(after);bad['profile'][key]=val
   with self.assertRaises(RuntimeError),patch.object(m,'pinned',return_value=json.dumps(profile).encode()):m.exact_catalog(bad,before,True)
 def test_rehearsal_requires_actual_absence(self):
  v={'budget':{},'profile':{},'newPermits':0,'activePermits':0}
  with self.assertRaisesRegex(RuntimeError,'must_be_absent'):m.exact_catalog(v,v,False)
 def test_publish_and_owned_inverse_real_fs(self):
  p=self.base/'fresh.service';m.publish(p,b'[Service]\n','unit');self.assertEqual(p.read_bytes(),b'[Service]\n');m.check_published('unit');m.remove_published('unit');self.assertFalse(p.exists())
 def test_same_bytes_foreign_inode_refused(self):
  p=self.base/'fresh.service';m.publish(p,b'public','unit');replacement=self.base/'replacement';replacement.write_bytes(b'public');replacement.chmod(0o644);replacement.replace(p)
  with self.assertRaisesRegex(RuntimeError,'inode'):m.check_published('unit')
 def test_boot_link_real_fs_and_foreign_link_refused(self):
  p=self.base/'fresh.service';m.publish(p,'/etc/systemd/system/fresh.service','boot',True);self.assertEqual(p.readlink(),Path('/etc/systemd/system/fresh.service'));m.check_published('boot');replacement=self.base/'replacement';replacement.symlink_to('/etc/systemd/system/foreign.service');replacement.replace(p)
  with self.assertRaises(RuntimeError):m.check_published('boot')
 def test_unknown_existing_public_file_never_overwritten(self):
  p=self.base/'foreign';p.write_bytes(b'keep')
  with self.assertRaisesRegex(RuntimeError,'fresh_publish'):m.publish(p,b'replace','unit')
  self.assertEqual(p.read_bytes(),b'keep')
 def test_lost_publish_ack_can_remove_exact_prepared_inode(self):
  p=self.base/'fresh.service';original=m.save
  def saving(name,value):
   if name=='unit-published.json':raise OSError('lost_ack')
   return original(name,value)
  with patch.object(m,'save',side_effect=saving),self.assertRaises(OSError):m.publish(p,b'owned','unit')
  self.assertTrue(p.exists());m.check_published('unit');m.remove_published('unit');self.assertFalse(p.exists())
 def test_commit_lost_ack_reconcile_never_reexecutes_sql(self):
  intent={'bootId':m.boot(),'reviewHash':'review'};m.save('commit-intent.json',intent);pin=m.sha((self.base/'commit-intent.json').read_bytes());before={'reviewHash':'review'}
  with patch.object(m,'baseline',return_value=before),patch.object(m,'official') as sql,patch.object(m,'admission_result',return_value={'observed':True}) as result:
   self.assertEqual(m.reconcile(pin),{'observed':True});sql.assert_not_called();self.assertEqual(result.call_args.args[1],{'commitAckLost':True,'exactPresentProfileObserved':True,'commitRetried':False})
 def test_wrong_commit_intent_refused(self):
  m.save('commit-intent.json',{'bootId':m.boot()})
  with self.assertRaisesRegex(RuntimeError,'unacknowledged'):m.reconcile('0'*64)
 def test_fixed_manager_never_touches_old_source_or_proxies(self):
  with patch.object(m,'run',return_value=b'') as r:m.manager('stop');self.assertEqual(r.call_args.args[0],['/usr/bin/systemctl','stop',m.UNIT])
  with self.assertRaises(RuntimeError):m.manager('restart')
 def test_no_start_before_loaded_hardening(self):
  self.assertIn('loaded_exact_hardening_required_before_start',Path(m.__file__).read_text());self.assertIn("manager('start')",Path(m.__file__).read_text());self.assertLess(Path(m.__file__).read_text().index('loaded_exact_hardening_required_before_start'),Path(m.__file__).read_text().index("manager('start')"))
 def actor_fixture(self,restarts='0'):
  proc=self.base/'proc'/'123';proc.mkdir(parents=True)
  fields=['0']*30;fields[0]='S';fields[19]='987654';(proc/'stat').write_text('123 (node) '+' '.join(fields))
  (proc/'status').write_text('Uid:\t42 42 42 42\nGid:\t43 43 43 43\nGroups:\t43\nNoNewPrivs:\t1\n'+''.join(k+':\t0000000000000000\n' for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']))
  (proc/'cmdline').write_bytes((m.NODE+'\0'+str(m.ARTIFACT)+'\0').encode());(proc/'cgroup').write_text('0::/system.slice/'+m.UNIT+'\n');(proc/'environ').write_bytes(m.env_bytes().replace(b'\n',b'\0'))
  state={'ActiveState':'active','SubState':'running','Job':'','NRestarts':restarts,'MainPID':'123','InvocationID':'a'*32,'ExecMainStartTimestampMonotonic':'2000'}
  return proc,state
 def test_manager_restart_owned_inverse_only(self):
  proc,state=self.actor_fixture('2');real=Path
  with patch.object(m,'Path',side_effect=lambda p:real(self.base/'proc') if str(p)=='/proc' else real(p)),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=42,pw_gid=43)):
   with self.assertRaisesRegex(RuntimeError,'owned_new_proxy_running'):m.actor(state,1000)
   self.assertEqual(m.actor(state,1000,False)['pid'],123)
   (proc/'status').write_text((proc/'status').read_text().replace('Groups:\t43','Groups:\t43 44'))
   with self.assertRaisesRegex(RuntimeError,'unprivileged'):m.actor(state,1000,False)
 def test_foreign_argv_cannot_be_stopped(self):
  proc,state=self.actor_fixture();(proc/'cmdline').write_bytes(b'foreign\0');real=Path
  with patch.object(m,'Path',side_effect=lambda p:real(self.base/'proc') if str(p)=='/proc' else real(p)),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=42,pw_gid=43)),self.assertRaisesRegex(RuntimeError,'argv_and_cgroup'):m.actor(state,1000,False)
 def test_late_manual_first_start_refused_even_by_inverse(self):
  proc,state=self.actor_fixture();state['ExecMainStartTimestampMonotonic']='50000000';real=Path
  with patch.object(m,'Path',side_effect=lambda p:real(self.base/'proc') if str(p)=='/proc' else real(p)),self.assertRaisesRegex(RuntimeError,'initial_start_window'):m.actor(state,1000,False)
 def test_restored_admission_is_retained_no_sql_delete(self):
  s=Path(m.__file__).read_text();self.assertNotIn('DELETE FROM',s);self.assertNotIn('UPDATE yunipals_market',s);self.assertIn('profileAdmissionRetained',s);self.assertIn('fresh_source_must_stop_before_proxy_inverse',s)

if __name__=='__main__':unittest.main()
