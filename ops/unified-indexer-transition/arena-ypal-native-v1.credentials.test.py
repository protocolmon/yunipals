#!/usr/bin/env python3
"""Finite local controls. No production/DB/network/subprocess execution."""
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
S=importlib.util.spec_from_file_location('credentials',HERE/'arena-ypal-native-v1.credentials.py');m=importlib.util.module_from_spec(S);S.loader.exec_module(m)

class FakeHost:
 def __init__(self,rows):self.rows=rows;self.phase='admitted';self.changes=[];self.pending={};self.fail_group=None;self.drift=False;self.auth_fail=False;self.catalog_fail=False
 def operator_hash(self):return 'a'*64
 def preserved(self):return {'actors':'retained','privateInputsUnchanged':not self.drift}
 def catalog(self,rows,stage,hashes):
  if self.catalog_fail:raise m.Refusal('acl_drift')
  if stage=='admitted':assert not hashes
  else:assert set(hashes)=={r['role'] for r in rows}
  return {'stage':stage,'exactGrants':True,'roleCount':9,'sessions':0}
 def mutate(self,group,sql):
  self.changes.append((group,sql))
  assert sql.startswith('BEGIN;') and sql.endswith('COMMIT;\n')
  if self.fail_group==group:raise m.Refusal('lost_commit_ack')
 def auth(self,row,url,password):
  if self.auth_fail:raise m.Refusal('auth_refused')
  return {'currentUser':row['role'],'sessionUser':row['role'],'oid':row['oid'],'readOnly':True}

class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='arena-credential-test-',dir=HERE);self.root=Path(self.tmp.name);self.base=self.root/'receipts';self.files=self.root/'connections';self.files.mkdir(mode=0o700)
  self.rows=[{'role':'yunipals_arena_native_'+x,'oid':200+i,'path':str(self.files/(x+'.env')),'limit':4 if x=='disclosure' else 8,'group':'operational'} for i,x in enumerate(['api','disclosure','client','referee','media','execution_lobby','execution_referee','capacity'])]
  self.rows.append({'role':'arena_native_reader','oid':909,'path':str(self.files/'source.env'),'limit':32,'group':'source'})
  self.proposal={'observations':{'yunipals-arena-retained-actors-readonly-20261022.json':'f'*64}}
  self.receipt={'roles':{r['role']:r['oid'] for r in self.rows[:-1]},'sourceRole':{'name':'arena_native_reader','oid':909}}
  self.plan={'admissionResultSha256':'b'*64,'admissionHelperSha256':'c'*64}
  self.h=FakeHost(self.rows);self.o=m.Operator(self.h,self.plan,self.proposal,self.receipt,self.rows,self.base)
 def tearDown(self):self.tmp.cleanup()
 def review(self,phase):return m.sha(m.encoded(self.o.review(phase)))
 def setup_credentials(self):return self.o.setup(self.review('setup'))
 def enable(self):self.setup_credentials();return self.o.enable(self.review('enable'))
 def test_acknowledged_receipt_requires_both_boundaries_and_exact_oid_maps(self):
  proposal={'workers':[{'role':r['role'],'privateOverlay':r['path'],'connectionLimit':r['limit']} for r in self.rows[:-1]],'sourceReader':{'privateFile':self.rows[-1]['path']},'filesAbsent':[{'path':r['path']} for r in self.rows],'sql':{'operational-roles.current.sql.review':'1'*64,'arena-ypal-native-v1.source.sql.review':'2'*64}}
  raw=(HERE/'arena-ypal-native-v1.admission.py').read_bytes();pin=m.sha(raw)
  plan={'format':m.FORMAT,'admissionResultFile':str(m.ADMISSION),'admissionResultSha256':'b'*64,'admissionHelperFile':'/public/commit-admission.py','admissionHelperSha256':pin}
  receipt={**self.receipt,'format':'yunipals-arena-ypal-admission-v1','operatorSha256':pin,'commitOutcome':'commit_confirmed','proposalSha256':m.PROPOSAL_SHA,'sqlSha256':{'operational':'1'*64,'source':'2'*64},'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'perDatabase':{'operational':{'commitOutcome':'commit_confirmed','roles':self.receipt['roles']},'source':{'commitOutcome':'commit_confirmed','roles':{'arena_native_reader':909}}}}
  self.assertEqual(len(m.validate_admission(plan,receipt,raw,proposal)),9)
  for part in ['operational','source']:
   bad=json.loads(json.dumps(receipt));bad['perDatabase'][part]['commitOutcome']='unknown';self.assertRaises(m.Refusal,m.validate_admission,plan,bad,raw,proposal)
  bad=json.loads(json.dumps(receipt));bad['perDatabase']['source']['roles']['arena_native_reader']=910;self.assertRaises(m.Refusal,m.validate_admission,plan,bad,raw,proposal)
 def test_host_reuses_exact_verifier_and_refuses_owned_sessions(self):
  calls=[];active=[False]
  def verify(receipt,**kw):calls.append(kw);return {'validated':True,'roleCount':9,'databaseWrites':0}
  runner=types.SimpleNamespace(peer_args=lambda *args:['readonly',*args],run=lambda *args:json.dumps({'sessions':1 if active[0] else 0,'free':100}).encode())
  helper=types.SimpleNamespace(verify_current=verify,runner=lambda:runner)
  host=m.Host(self.plan,self.proposal,helper,self.receipt);hashes={r['role']:'d'*64 for r in self.rows}
  host.catalog(self.rows,'configured',hashes);self.assertEqual(calls[-1],{'phase':'passwords','password_sha256':hashes})
  host.catalog(self.rows,'enabled',hashes);self.assertEqual(calls[-1]['phase'],'login')
  active[0]=True;self.assertRaises(m.Refusal,host.catalog,self.rows,'enabled',hashes)
 def test_positive_three_explicit_phases_and_owned_disable(self):
  s=self.setup_credentials();self.assertFalse(s['loginEnabled']);self.assertEqual(len(self.h.changes),2)
  e=self.o.enable(self.review('enable'));self.assertTrue(e['loginEnabled']);self.assertEqual(len(self.h.changes),4)
  a=self.o.prove(self.review('auth'));self.assertEqual(a['format'],m.AUTH_FORMAT);self.assertEqual(len(a['authentication']),9);self.assertTrue(a['tcpAuthenticationProven']);self.assertFalse(a['legacyRolesChanged'])
  d=self.o.disable(self.review('disable'));self.assertFalse(d['loginEnabled']);self.assertEqual(len(self.h.changes),6)
 def test_setup_review_is_readonly_and_nine_paths_are_exclusive(self):
  self.o.review('setup');self.assertFalse(self.base.exists());self.assertFalse(self.h.changes)
  Path(self.rows[0]['path']).write_text('foreign');self.assertRaises(m.Refusal,self.o.review,'setup');self.assertFalse(self.h.changes)
 def test_wrong_review_refused_before_any_write(self):
  self.assertRaises(m.Refusal,self.o.setup,'0'*64);self.assertFalse(self.base.exists());self.assertFalse(self.h.changes)
 def test_scram_only_sql_plaintext_never_in_sql_or_public_result(self):
  s=self.setup_credentials();sql=''.join(v for _,v in self.h.changes)
  passwords=[m.parse_private(r,Path(r['path']).read_bytes())[1] for r in self.rows]
  self.assertEqual(len(set(passwords)),9)
  for r in self.rows[:-1]:self.assertEqual(set(line.partition('=')[0] for line in Path(r['path']).read_text().splitlines()),{'ARENA_DATABASE_URL'})
  for password in passwords:self.assertNotIn(password,sql);self.assertNotIn(password,json.dumps(s))
  self.assertEqual(sql.count("PASSWORD 'SCRAM-SHA-256$4096:"),9);self.assertNotIn(' LOGIN;',sql)
 def test_files_0600_even_with_permissive_umask(self):
  old=os.umask(0)
  try:self.setup_credentials()
  finally:os.umask(old)
  for r in self.rows:self.assertEqual(Path(r['path']).stat().st_mode&0o777,0o600)
 def test_existing_symlink_and_hardlink_refused(self):
  target=self.root/'target';target.write_text('sentinel');path=self.files/'link';path.symlink_to(target)
  self.assertRaises(FileExistsError,m.save,path,b'changed');self.assertEqual(target.read_text(),'sentinel')
  link=self.files/'hard';os.link(target,link);os.chmod(target,0o600);self.assertRaises(m.Refusal,m.protected,link,100,True)
 def test_parent_symlink_refused(self):
  real=self.root/'real';real.mkdir();link=self.root/'parent';link.symlink_to(real,target_is_directory=True)
  self.assertRaises(OSError,m.save,link/'credential',b'private');self.assertFalse((real/'credential').exists())
 def test_password_commit_ack_loss_refuses_any_retry_or_rotation(self):
  self.h.fail_group='source';self.assertRaises(m.Refusal,self.setup_credentials);self.assertTrue((self.base/'password-operational-ack.json').exists());self.assertFalse((self.base/'setup-result.json').exists())
  before=[Path(r['path']).read_bytes() for r in self.rows];self.assertRaises(m.Refusal,self.o.review,'setup');self.assertEqual(before,[Path(r['path']).read_bytes() for r in self.rows]);self.assertEqual(len(self.h.changes),2)
 def test_login_ack_loss_is_not_auth_authority(self):
  self.setup_credentials();self.h.fail_group='source';self.assertRaises(m.Refusal,self.o.enable,self.review('enable'))
  self.assertTrue((self.base/'login-operational-ack.json').exists());self.assertFalse((self.base/'login-result.json').exists());self.assertRaises(FileNotFoundError,self.o.review,'auth');self.assertRaises(m.Refusal,self.o.review,'enable')
 def test_acl_drift_blocks_before_private_file_or_login_writes(self):
  self.h.catalog_fail=True;self.assertRaises(m.Refusal,self.setup_credentials);self.assertFalse(self.base.exists());self.assertFalse(self.h.changes)
 def test_same_bytes_foreign_inode_refused(self):
  self.setup_credentials();p=Path(self.rows[0]['path']);raw=p.read_bytes();p.unlink();m.save(p,raw)
  self.assertRaises(m.Refusal,self.o.review,'enable')
 def test_extra_keys_or_wrong_db_urls_refused(self):
  r=self.rows[0];raw=m.content(r,'x'*48);self.assertRaises(m.Refusal,m.parse_private,r,raw+b'OPENAI_API_KEY=unasked\n');self.assertRaises(m.Refusal,m.parse_private,r,raw.replace(b'15438',b'5432'))
 def test_source_connection_has_only_public_selectors_and_readonly_option(self):
  r=self.rows[-1];raw=m.content(r,'y'*48);url,password=m.parse_private(r,raw);self.assertEqual(password,'y'*48);self.assertIn('default_transaction_read_only%3Don',url);self.assertNotIn(b'ARENA_REPOSITORY_ROOT',raw);self.assertNotIn(b'OPENAI',raw)
 def test_auth_failure_never_creates_success_receipt_or_reissues_login(self):
  self.enable();self.h.auth_fail=True;self.assertRaises(m.Refusal,self.o.prove,self.review('auth'));self.assertFalse((self.base/'auth-result.json').exists());self.assertEqual(len(self.h.changes),4)
  self.h.auth_fail=False;self.assertTrue(self.o.prove(self.review('auth'))['tcpAuthenticationProven']);self.assertEqual(len(self.h.changes),4)
 def test_preserved_original_input_drift_fails_postcheck(self):
  original=self.h.mutate
  def change(group,sql):original(group,sql);self.h.drift=True
  self.h.mutate=change;self.assertRaises(m.Refusal,self.setup_credentials);self.assertFalse((self.base/'setup-result.json').exists())
 def test_sql_guards_exact_oid_password_and_empty_sessions(self):
  r=self.rows[0];sql=m.mutate_sql([r],'configured','enable',{r['role']:'d'*64})
  for fragment in ['oid=200','rolcanlogin=false','NOT rolsuper','pg_stat_activity',"'"+'d'*64+"'",'ALTER ROLE "'+r['role']+'" LOGIN;']:self.assertIn(fragment,sql)
  self.assertNotIn('yunipals_arena_app',sql);self.assertNotIn('GRANT',sql)
 def test_tcp_password_uses_0600_anonymous_fd_never_argv_or_env(self):
  password='p'*48;captured={}
  def execute(argv,**kw):
   self.assertNotIn(password,' '.join(argv));self.assertNotIn(password,json.dumps(kw['env']));self.assertEqual(kw['env']['PGPASSFILE'],'/proc/self/fd/'+str(kw['pass_fds'][0]));fd=kw['pass_fds'][0];self.assertEqual(os.fstat(fd).st_mode&0o777,0o600);self.assertIn(password.encode(),os.read(fd,1000));captured['fd']=fd;return types.SimpleNamespace(returncode=0,stdout=b'{}\n',stderr=b'')
  with patch.object(m.subprocess,'run',execute):self.assertEqual(m.tcp_probe(self.rows[0],password,'SELECT 1;'),b'{}\n')
  self.assertRaises(OSError,os.fstat,captured['fd'])
 def test_owner_negative_requires_real_permission_sqlstate(self):
  with patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=3,stdout=b'',stderr=b'ERROR: 42601')):self.assertRaises(m.Refusal,m.tcp_probe,self.rows[0],'p'*48,'SELECT;',expected_failure='42501')
  with patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=3,stdout=b'',stderr=b'ERROR: 42501')):self.assertIsNone(m.tcp_probe(self.rows[0],'p'*48,'SELECT;',expected_failure='42501'))
 def test_wrong_password_success_is_rejected(self):
  with patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=b'1\n',stderr=b'')):self.assertRaises(m.Refusal,m.tcp_probe,self.rows[0],'p'*48,'SELECT 1;',expected_failure=True)
 def test_auth_repeated_success_and_disable_repeated_attempt_refused(self):
  self.enable();self.o.prove(self.review('auth'));self.assertRaises(m.Refusal,self.o.prove,self.review('auth'));self.o.disable(self.review('disable'));self.assertRaises(m.Refusal,self.o.disable,self.review('disable'))

if __name__=='__main__':unittest.main()
