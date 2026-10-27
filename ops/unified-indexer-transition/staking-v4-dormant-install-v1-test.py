import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('staking',HERE/'staking-v4-dormant-install-v1.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
sha=lambda raw:hashlib.sha256(raw).hexdigest()
old=(HERE/'staking-support-native-v1.service.example').read_bytes()
raw=old.replace(s.OLD_SCHEMA.encode(),s.SCHEMA.encode()).replace(s.OLD_IDENTITY.encode(),s.IDENTITY.encode())

class Tests(unittest.TestCase):
 def test_candidate_preserves_actual_reviewed_template_except_two_values(self):
  self.assertEqual(sha(old),s.ORIGINAL_SHA);self.assertEqual(sha(raw),s.CANDIDATE_SHA)
  values={s.CANDIDATES/'staking-support-v4.service.candidate':raw,s.OPS/'staking-support-native-v1.service.example':old}
  owner={'committed':True,'rehearsed':False,'readIdentity':s.IDENTITY}
  def document(path,pin):
   if path==s.OWNER_RECEIPT:self.assertEqual(pin,s.OWNER_RECEIPT_SHA);return owner
   self.assertEqual(pin,s.CANDIDATE_RECEIPT_SHA);return {'files':{'staking-support-v4.service.candidate':s.CANDIDATE_SHA}}
  m=types.SimpleNamespace(document=document,protected=lambda path:values[path],sha=sha)
  with patch.object(s,'SOURCE_PINS',{}):self.assertEqual(s.candidate(m),raw)
  for field,value in [('committed',False),('rehearsed',True),('readIdentity',s.OLD_IDENTITY)]:
   saved=owner.copy();owner[field]=value
   with patch.object(s,'SOURCE_PINS',{}),self.assertRaisesRegex(RuntimeError,'actual_committed'):s.candidate(m)
   owner.clear();owner.update(saved)
  values[s.CANDIDATES/'staking-support-v4.service.candidate']=raw.replace(b'Restart=no',b'Restart=always')
  with patch.object(s,'SOURCE_PINS',{}),self.assertRaisesRegex(RuntimeError,'exact_two_value'):s.candidate(m)
 def test_absent_unit_cannot_be_existing_or_previously_started(self):
  value={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':'','Job':'','FragmentPath':'','DropInPaths':''}
  s.absent(value)
  timer={k:v for k,v in value.items()if k!='MainPID'}
  s.absent(timer,timer=True)
  with self.assertRaises(RuntimeError):s.absent(timer)
  for key,bad in [('LoadState','loaded'),('MainPID','1'),('InvocationID','abc'),('Job','1'),('DropInPaths','/unknown')]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):s.absent({**value,key:bad})
 def test_changed_source_file_is_rejected(self):
  m=types.SimpleNamespace(document=lambda p,_:({'committed':True,'rehearsed':False,'readIdentity':s.IDENTITY}if p==s.OWNER_RECEIPT else{'files':{'staking-support-v4.service.candidate':s.CANDIDATE_SHA}}),
   protected=lambda p:raw if p==s.CANDIDATES/'staking-support-v4.service.candidate' else old if p==s.OPS/'staking-support-native-v1.service.example' else b'changed',sha=sha)
  with self.assertRaisesRegex(RuntimeError,'retained_staking_runtime_changed'):s.candidate(m)
 def effective(self):
  command=next(x.removeprefix('ExecStart=')for x in raw.decode().splitlines()if x.startswith('ExecStart='))
  return {'LoadState':'loaded','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':'','Job':'','FragmentPath':str(s.TARGET),'DropInPaths':'','UnitFileState':'static','User':'yunipals_islands_staking','Group':'yunipals_islands_staking','WorkingDirectory':str(s.ROOT/'apps/yunipals-indexer'),'Environment':'','SupplementaryGroups':'','RuntimeMaxUSec':'4min','TimeoutStartUSec':'15s','TimeoutStopUSec':'20s','Restart':'no','KillMode':'control-group','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ExecMainStartTimestampMonotonic':'0','ExecStart':'{ path=/usr/bin/env ; argv[]='+command+' ; ignore_errors=no ; }'}
 def test_effective_serialization_and_typed_empty_environment(self):
  value=self.effective();empty={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0'}
  calls=[]
  def run(args):
   calls.append(args);return b'a(sb) 0\n'if args[-1]=='EnvironmentFiles'else b'as 0\n'
  m=types.SimpleNamespace(protected=lambda _:raw,run=run)
  with patch.object(s,'show',side_effect=lambda _,u:value if u==s.UNIT else empty):s.installed(m,raw)
  self.assertEqual([x[-1]for x in calls],['EnvironmentFiles','PassEnvironment','UnsetEnvironment'])
  for key,bad in [('MainPID','1'),('RuntimeMaxUSec','infinity'),('CapabilityBoundingSet','cap_chown'),('ExecStart',value['ExecStart']+' unexpected')]:
   changed={**value,key:bad}
   if key=='ExecStart':changed[key]=value[key].replace('argv[]=/usr/bin/env -i','argv[]=/usr/bin/env')
   with patch.object(s,'show',return_value=changed),self.assertRaises(RuntimeError):s.installed(m,raw)
  m.run=lambda _:b'a(sb) 1 "/private.env" false\n'
  with patch.object(s,'show',return_value=value),self.assertRaisesRegex(RuntimeError,'no_implicit'):s.installed(m,raw)
 def test_stale_review_does_not_create_any_file(self):
  m=types.SimpleNamespace(sha=sha,encoded=lambda x:json.dumps(x).encode())
  with patch.object(s,'prepare',return_value=({'a':1},raw)),patch.object(s.BASE.__class__,'mkdir')as mkdir,self.assertRaisesRegex(RuntimeError,'fresh_dormant_install_review'):
   s.apply(m,'0'*64)
  mkdir.assert_not_called()
 def test_only_daemon_reload_is_a_service_action(self):
  source=(HERE/'staking-v4-dormant-install-v1.py').read_text()
  self.assertNotIn("'start'",source);self.assertNotIn("'enable'",source);self.assertNotIn('ALTER ROLE',source);self.assertNotIn('psql',source)
  self.assertEqual(source.count("m.run(['/usr/bin/systemctl','daemon-reload'])"),1)
  self.assertLess(source.index("m.write_new(BASE/'intent.json'"),source.index('m.write_new(TARGET,raw'))
  self.assertEqual(sha((HERE/'retained-workers-stage-v1.py').read_bytes()),s.SHARED_SHA)

if __name__=='__main__':unittest.main()
