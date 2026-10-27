"""Finite V5 cache namespace/SQL/transport contracts, no production inputs."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).parent.resolve()

def load(name):
 s=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/name);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
m=load('ypal-ordinary-read-cache-v5.py');c=load(m.COMMON.name)
readtest=load('ypal-ordinary-read-admission-v5b.test.py');metatest=load('ypal-ordinary-consumer-handover-v5.test.py');gentest=load('ypal-ordinary-generation-v5b.test.py')
refs={'admissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64}
config={'readAdmissionSha256':refs['admissionSha256'],'readPlanSha256':refs['readPlanSha256'],'readContextInputSha256':refs['readContextInputSha256'],'metadataSelectionSha256':'4'*64,'metadataProvenanceFile':'provenance-0-observed.json','metadataProvenanceSha256':'5'*64,'generationSha256':'6'*64,'metadataInputSha256':'7'*64,'selectorCandidateSha256':'8'*64}
execution={'readConfig':refs,'candidateInputSha256':'9'*64,'ordinaryRuntime':{'resultSha256':'a'*64,'inputSha256':'b'*64}}

def local(path,digest=None,*args):
 raw=(HERE/Path(path).name).read_bytes()
 if digest is not None:m.need(m.sha(raw)==digest,'exact_local_cache_public_source_required')
 return raw

def namespace():
 original=c.module;read=readtest.namespace();read.protected=local
 delta=load(m.READ.name);delta.namespace=lambda:read
 metadata=metatest.namespace();generation=gentest.namespaces();selector=load('ypal-generation-cache-candidates-v1.py')
 def module(path,pin):
  local(path,pin)
  if path==m.READ:return delta
  if path==m.METADATA:return types.SimpleNamespace(namespace=lambda _:metadata)
  if path==m.GENERATION:return types.SimpleNamespace(namespace=lambda *_:generation)
  if path==m.CANDIDATES:return types.SimpleNamespace(namespace=lambda _:selector)
  return original(path,pin)
 i=types.SimpleNamespace(protected=local)
 with patch.object(m,'common',return_value=c),patch.object(c,'public',local),patch.object(c,'load_input',return_value=execution),patch.object(c,'module',side_effect=module),patch.object(c,'intake',return_value=i):
  n=m.namespace(copy.deepcopy(config))
 return n

class Controls(unittest.TestCase):
 def test_default_static_and_actual_ref_schema(self):
  r=subprocess.run(['/usr/bin/python3','-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True);self.assertTrue(json.loads(r.stdout)['staticOnly'])
  self.assertEqual(m.config_checked(config),config)
  for change in [lambda v:v.update(metadataInputSha256=None),lambda v:v.update(selectorCandidateSha256='0'*64),lambda v:v.update(metadataProvenanceFile='../foreign')]:
   bad=copy.deepcopy(config);change(bad)
   with self.assertRaises(RuntimeError):m.config_checked(bad)
 def test_actual_cache_runtime_new_identity_and_unchanged_commit_inverse_bodies(self):
  n=namespace();runtime=n.cache_runtime();old=load('ypal-cache-guard-owner-v1.py')
  self.assertEqual(runtime.FORMAT,m.FORMAT);self.assertEqual(runtime.BASE,m.BASE);self.assertEqual(runtime.IDENTITY,c.READ_IDENTITY)
  self.assertNotEqual(runtime.DROP,old.DROP);self.assertEqual(runtime.COMPONENT.name,'ypal-ordinary-cache-transition-v5.mjs')
  self.assertEqual(runtime.CANDIDATE_SHA,config['selectorCandidateSha256']);self.assertIsNone(runtime.COORDINATED_OWNER_SHA)
  for name in ['rehearsal','commit','drain','reconcile_commit','inverse','reconcile_inverse','read_extension','extended_plan']:
   self.assertEqual(getattr(runtime,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
   self.assertIsNot(getattr(runtime,name).__globals__,getattr(old,name).__globals__)
  self.assertIn(c.READ_SCHEMA,runtime._sql_child.__code__.co_consts)
  self.assertFalse(any(isinstance(v,str)and 'yunipals_ownership_4e77f52b_v4' in v for v in runtime.Host.prerequisites.__code__.co_consts))
 def test_catalog_sql_exact_V5_enhancement_and_wrapper_request_digest(self):
  read=load(m.READ.name);text=read.enhanced_catalog((HERE/read.CATALOG.name).read_text().strip())
  self.assertEqual((HERE/m.CATALOG.name).read_text(),text);self.assertEqual(m.sha(text.encode()),m.CATALOG_SHA)
  entry=(HERE/m.ENTRY.name).read_text();self.assertIn(m.CATALOG_SHA,entry);self.assertIn('./ypal-ordinary-cache-driver-v5.mjs',entry)
  self.assertEqual(m.sha(entry.encode()),m.ENTRY_SHA)
 def test_transport_only_pins_new_three_public_modules(self):
  peer=load(m.TRANSPORT.name);self.assertEqual(m.sha((HERE/m.TRANSPORT.name).read_bytes()),m.TRANSPORT_SHA)
  self.assertEqual(set(peer.PINS),{m.ENTRY.name,'ypal-ordinary-cache-driver-v5.mjs','ypal-ordinary-cache-transition-v5.mjs'})
  for name,digest in peer.PINS.items():self.assertEqual(m.sha((HERE/name).read_bytes()),digest)
  loader=peer.loader_bytes((HERE/'ypal-reader-peer-runtime-v1.mjs').read_bytes()).decode()
  self.assertIn(m.ENTRY.name,loader)
  with self.assertRaises(RuntimeError):peer.loader_bytes(b'foreign hook')
 def test_actual_phase_constructor_uses_new_static_ACKs_and_never_current_source(self):
  n=namespace();r=n.read_module();runtime=n.cache_runtime();calls=[]
  class ReadHost:
   def __init__(self,input_sha,plan_sha,inverse=False):
    self.asserted=(input_sha,plan_sha,inverse);calls.append(self.asserted)
    self.plan={'fixturePlan':True};self.primitives={'sdk':types.SimpleNamespace(command=lambda *_:self.fail('no command'),protected=local,lock=lambda:None)}
    self.h=types.SimpleNamespace(query=lambda *_:{'fixtureCatalog':True},raw=types.SimpleNamespace(observer=object()))
    self.helpers=types.SimpleNamespace(consumer_frame=lambda *_:None,reader_catalog=lambda *_:('hash','SELECT 1'))
   def runtime(self):raise AssertionError('static constructor must not call active source')
  intent={'format':'fixture-selector-format','operatorSha256':m.CANDIDATES_SHA,'candidateInputSha256':execution['candidateInputSha256'],
    'readConfig':execution['readConfig'],'readSchema':c.READ_SCHEMA,'readIdentity':c.READ_IDENTITY,'files':{name:'d'*64 for name in['a.env','b.env','c.conf','d.conf']}}
  value={**intent,'staged':True,'selected':False,'generationStarted':False,'cacheStarted':False,'guardTransitionExecuted':False,
    'databaseWrites':0,'servicesChanged':False,'providerRequests':0,'permissionAdmissionAcknowledged':False}
  before={'binding':{'fixture':True}};rolled={'after':{'read':{'roles':[]},'allColumnAcl':[]}}
  prepared={'format':m.FORMAT,'operatorSha256':m.sha((HERE/m.FILE.name).read_bytes()),'prepared':True,'nativeWorkerStarted':False,
    'nativeGenerationPublished':False,'config':copy.deepcopy(config),'additionalReadAcknowledgementSha256':'e'*64}
  manifest={'files':{m.FILE.name:prepared['operatorSha256']},'dependencies':{m.READ.name:m.READ_SHA,n.STATIC.name:n.STATIC_SHA,
    m.TRANSPORT.name:m.TRANSPORT_SHA,m.METADATA.name:m.METADATA_SHA,m.GENERATION.name:m.GENERATION_SHA}}
  def document(path,pin=None):
   path=Path(path)
   if path==m.INPUT:return copy.deepcopy(config)
   if path==m.BASE/'prepared.json':return prepared
   if path==m.BASE/'sql-committed.json':return {'postProof':{'catalog':{},'allColumnAcl':[]}}
   if path==r.PLAN:return {'contextInputSha256':config['readContextInputSha256']}
   if path==m.CANDIDATE_BASE/'result.json':return value
   if path==m.CANDIDATE_BASE/'intent.json':return intent
   raise AssertionError('unknown private fixture path '+str(path))
  old=r.module
  def module(path,pin):
   if path==runtime.RETAINED:return types.SimpleNamespace(artifact=lambda:True)
   if path==n.READER:
    raw=(HERE.parent/'booster-launch'/path.name).read_bytes();m.need(m.sha(raw)==pin,'exact_retained_reader_SQL_helper_required')
    value=types.ModuleType('real_retained_reader_catalog');exec(compile(raw,str(path),'exec'),value.__dict__);return value
   return old(path,pin)
  selector=n.dependency(m.CANDIDATES,m.CANDIDATES_SHA);selector.FORMAT=intent['format'];selector.FILES=list(intent['files'])
  with patch.object(r,'Host',ReadHost),patch.object(r,'admitted',return_value=({'baselineReadEdgeCount':143,'nativeRegrants':0},before,rolled)),patch.object(r,'document',side_effect=document),patch.object(r,'module',side_effect=module),patch.object(n,'cache_runtime',return_value=runtime),patch.object(runtime,'owned',return_value=(before,rolled)):
   phase=n.Phase({'cachePreparedSha256':'f'*64,'cacheInputsSha256':'a'*64,'readPlanSha256':config['readPlanSha256'],'readContextInputSha256':config['readContextInputSha256']},manifest)
   self.assertEqual(calls,[(config['readContextInputSha256'],config['readPlanSha256'],True)])
   self.assertEqual(phase.admission_ref['producerSha256'],m.READ_SHA);self.assertEqual(phase.host.candidate['readIdentity'],c.READ_IDENTITY)
   value['readIdentity']='oldV4'
   with self.assertRaisesRegex(RuntimeError,'candidate_intent'):n.Phase({'cachePreparedSha256':'f'*64,'cacheInputsSha256':'a'*64,'readPlanSha256':config['readPlanSha256'],'readContextInputSha256':config['readContextInputSha256']},manifest)
 def test_actual_cache_sessions_host_address_avoids_genuine_inet_mapper_failure(self):
  n=namespace();runtime=n.cache_runtime();old=load('ypal-cache-guard-owner-v1.py')
  path=HERE.parent/'booster-launch/ypal-old-runtime-inventory-v1.py';raw=path.read_bytes();self.assertEqual(m.sha(raw),'7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b')
  mapper=types.ModuleType('genuine_kernel_mapper');exec(compile(raw,str(path),'exec'),mapper.__dict__)
  def query(sql):return [{'pid':901,'backendStart':'start','clientAddress':'127.0.0.1'if'host(client_addr)'in sql else'127.0.0.1/32','clientPort':45678}]
  def fds(pids,uid,gid):return {str(pid):{'startTicks':456,'socketInodes':[101]if pid==123 else[202]}for pid in pids}
  observer=types.SimpleNamespace(peer_fds=fds,unix_peers=lambda _: {},run=lambda _:b'',tcp_clients=lambda raw,ipv6=False:{}if ipv6 else{101:{'clientAddress':'127.0.0.1','clientPort':45678,'transport':'tcp'}},map_owned_backends=mapper.map_owned_backends)
  host=object.__new__(runtime.Host);host.query=query;host.h=types.SimpleNamespace(observer=observer)
  actor={'processes':[{'pid':123,'startTicks':456}]}
  self.assertEqual(runtime.Host.sessions(host,actor)['owned'][0]['pid'],901)
  with self.assertRaises(ValueError):old.Host.sessions(host,actor)
 def test_exact_installed_dependency_authority_precedes_any_new_SQL_child_evaluation(self):
  n=namespace();calls=[];refuse=[False]
  def authorize():
   calls.append('pre-evaluation-inventory')
   if refuse[0]:raise RuntimeError('changed_installed_dependency')
  authorizer=types.SimpleNamespace(dependency_current=authorize)
  host=types.SimpleNamespace(new_read=types.SimpleNamespace(admitted=lambda *_:(None,None,{'after':{'allColumnAcl':[]}})),read_host=object(),config={'readAdmissionSha256':'a'*64})
  cache=types.SimpleNamespace(_sql_child=lambda *args:calls.append('child-evaluation')or{'postProof':{'allColumnAcl':[]}})
  with patch.object(c,'module',side_effect=lambda path,pin:authorizer if(path,pin)==(m.DEPENDENCY_PREFLIGHT,m.DEPENDENCY_PREFLIGHT_SHA)else self.fail('unknown dependency authorizer')):
   n.qualified_sql_child(cache,host,'inspect');self.assertEqual(calls,['pre-evaluation-inventory','child-evaluation'])
   calls.clear();refuse[0]=True
   with self.assertRaisesRegex(RuntimeError,'changed_installed_dependency'):n.qualified_sql_child(cache,host,'inspect')
   self.assertEqual(calls,['pre-evaluation-inventory'])
 def test_driver_graph_reverses_exact_single_guard_import_and_values(self):
  driver=(HERE/'ypal-ordinary-cache-driver-v5.mjs').read_text();old=(HERE/'ypal-cache-guard-owner-v1.mjs').read_text()
  self.assertEqual(driver,old.replace('./ypal-cache-guard-transition-v1.mjs','./ypal-ordinary-cache-transition-v5.mjs'))

if __name__=='__main__':unittest.main()
