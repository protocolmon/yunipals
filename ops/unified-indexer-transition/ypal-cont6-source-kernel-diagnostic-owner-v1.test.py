"""Genuine Source6 kernel/map bodies; PG, FD, private process and Root I/O fixtures."""
import ast,contextlib,copy,hashlib,importlib.util,io,json,pathlib,subprocess,sys,types,unittest
from unittest.mock import Mock,patch
HERE=pathlib.Path(__file__).resolve().parent
PATH=HERE/'ypal-cont6-source-kernel-diagnostic-owner-v1.py'
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load(PATH);g=load(HERE/'ypal-ordinary-source-authority-v6.test.py');guard=g.m;host=g.host;inventory=g.observer
local=load(HERE/'ypal-native-readiness-cache-split-v1.test.py').local

def remote():
 ns={'__name__':'fixture','__ROOT_SOURCE_SHA__':'a'*64}
 with patch('os.umask'):exec(compile(m.REMOTE,str(PATH)+':remote','exec'),ns)
 return ns

class Controls(unittest.TestCase):
 def fixture(self,kind='incomplete',gone=True,fence=True):
  self.enterContext(patch.object(guard,'public',side_effect=g.local));original=guard.composition
  def compose():
   value=original();value.public=g.local;return value
  namespace=compose();self.enterContext(patch.object(guard,'composition',side_effect=compose))
  kernel=namespace.classified_kernel(host)
  rows=[{'pid':pid,'backendStart':'epoch-'+str(pid),'clientAddress':None,'clientPort':-1}for pid in [11,12]]
  actors={'source':{'processes':[{'pid':101,'startTicks':901}]},'fresh':{'processes':[{'pid':102,'startTicks':902}]}}
  backend={'11':{'startTicks':811,'socketInodes':[1101]},'12':{'startTicks':812,'socketInodes':[1102]}}
  own={'101':{'startTicks':901,'socketInodes':[1001]},'102':{'startTicks':902,'socketInodes':[1002]}}
  peers={1001:1101,1002:1102};calls=[]
  if kind=='incomplete':own['102']['socketInodes']=[]
  if kind=='duplicate':own['102']['socketInodes']=[1001]
  def query(sql):
   self.assertEqual(sql,guard.SESSION_SQL);calls.append(sql)
   if kind in{'incomplete','duplicate'}and len(calls)>1 and gone:return copy.deepcopy(rows[:1])
   return copy.deepcopy(rows)
  def peer_fds(pids,*_):return{str(pid):copy.deepcopy(own[str(pid)])for pid in pids}
  observer=types.SimpleNamespace(peer_fds=peer_fds,unix_peers=lambda _:peers,run=lambda _:b'',tcp_clients=lambda *_:{},map_owned_backends=inventory.map_owned_backends)
  authority=types.SimpleNamespace(kernel_function=kernel,kernel_rows_valid=namespace.valid_final_source_rows,kernel_churn_type=namespace.KernelQueryChurn,
   actors=actors,expected={'actualSameActorPrivateProgramRouteFixture':True})
  authority._snapshot=lambda:copy.deepcopy(authority.expected)if fence else{'changedActualSourceActorFixture':True}
  authority.owner=types.SimpleNamespace(h=types.SimpleNamespace(source=types.SimpleNamespace(query=query),observer=observer),c=types.SimpleNamespace(host_module=host))
  args=(query,observer,73004621,actors,{name:(970,964)for name in actors},True)
  self.enterContext(patch.object(guard,'backend_probe',return_value={'format':guard.FORMAT+'-backend-fds','complete':True,'gone':None,'fds':backend}))
  self.enterContext(patch.object(guard,'proc_epoch',side_effect=lambda pid:None if gone and pid==12 else backend[str(pid)]['startTicks']))
  ns=remote();saved={};ns['guard']=guard
  def save(name,value):
   self.assertIs(ns['subprocess'].run,ns['original_run']);raw=value if type(value)is bytes else ns['encoded'](value)
   saved[name]=json.loads(raw);return ns['sha'](raw)
  ns['save']=save;seen=[]
  def operation():
   try:return guard.current_kernel(authority,*args,fence=authority.expected)
   except BaseException as error:seen.append(error);raise
  return ns,authority,operation,calls,saved,seen

 def test_01_complete_source_pins_default_closed_and_no_live_or_effect_hooks(self):
  ns=remote()
  for name,digest in ns['PINS'].items():self.assertEqual(hashlib.sha256(local(ns['OPS']/name)).hexdigest(),digest)
  out=subprocess.run([sys.executable,'-I','-B',str(PATH)],capture_output=True,check=True,text=True)
  self.assertTrue(json.loads(out.stdout)['staticOnly']);self.assertIs(type(m.SOURCE_REVIEWED),bool)
  with patch.object(m,'SOURCE_REVIEWED',False),patch.object(sys,'argv',[str(PATH),'--run']),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')):
   with self.assertRaisesRegex(RuntimeError,'reviewed_readonly'):m.main()
  tree=ast.parse(m.REMOTE);calls=[ast.unparse(n.func)for n in ast.walk(tree)if isinstance(n,ast.Call)]
  for forbidden in ['sys.settrace','sys.setprofile','context.verify','context.execute','caller.execute_cache','caller.qualify_held']:self.assertNotIn(forbidden,calls)
  self.assertNotIn('commit-authorized',m.REMOTE)

 def test_02_genuine_incomplete_prefix_locals_and_separate_gone_epochs_no_retry(self):
  ns,authority,operation,calls,saved,seen=self.fixture()
  before=ns['code_shape'](authority.kernel_function.__code__)
  with self.assertRaises(RuntimeError)as caught:ns['observe'](operation)
  self.assertIs(caught.exception,seen[0]);self.assertEqual(str(caught.exception),ns['FIXED']);self.assertEqual(len(calls),2)
  self.assertEqual(authority.kernel_attempts,[]);self.assertEqual(ns['code_shape'](authority.kernel_function.__code__),before)
  value=ns['diagnostic'];self.assertEqual((value['initialRoleRowCount'],value['mappedUniqueRowCount'],value['unmappedInitialRowCount']),(2,1,1))
  self.assertFalse(value['finalKernelQueryObserved']);self.assertTrue(value['sameActorPrivateProgramAndRouteFence'])
  self.assertEqual(value['unmappedDatabaseEpochGoneCount'],1);self.assertEqual(value['unmappedProcessEpochGoneCount'],1)
  self.assertEqual(saved['kernel-failure-locals.json']['ids'],[11]);self.assertEqual(set(saved['kernel-failure-locals.json']),{'role','actors','uid_gid','require_all','sql','rows','backend_fds','peers','tcp','result','ids','name','actor','own'})
  self.assertFalse(saved['postfailure-population.json']['positiveAttributionQualified']);self.assertFalse(value['captureQualified'])

 def test_03_genuine_duplicate_attribution_stays_strict_and_numeric_evidence_distinct(self):
  ns,_,operation,calls,_,seen=self.fixture('duplicate')
  with self.assertRaises(RuntimeError)as caught:ns['observe'](operation)
  self.assertIs(caught.exception,seen[0]);self.assertEqual(len(calls),2)
  self.assertEqual(ns['diagnostic']['duplicateAttributionCount'],1);self.assertEqual(ns['diagnostic']['unmappedInitialRowCount'],1)
  self.assertFalse(ns['diagnostic']['originalGuardPassed'])

 def test_04_live_unmapped_backend_and_changed_actor_do_not_become_disappearance(self):
  ns,_,operation,calls,_,_=self.fixture(gone=False)
  with self.assertRaises(RuntimeError):ns['observe'](operation)
  self.assertEqual(ns['diagnostic']['unmappedDatabaseEpochGoneCount'],0);self.assertEqual(ns['diagnostic']['unmappedProcessEpochGoneCount'],0)
  self.assertEqual(len(calls),2)
  self.doCleanups();ns,_,operation,calls,saved,_=self.fixture(fence=False)
  with self.assertRaises(RuntimeError):ns['observe'](operation)
  self.assertFalse(ns['diagnostic']['sameActorPrivateProgramAndRouteFence']);self.assertEqual(len(calls),1)
  self.assertNotIn('postfailure-population.json',saved)

 def test_05_positive_original_capture_has_two_queries_no_failure_observation_or_code_change(self):
  ns,authority,operation,calls,saved,_=self.fixture('good')
  original=authority.kernel_function.__code__;value=ns['observe'](operation)
  self.assertEqual(set(value),{'source','fresh'});self.assertEqual(len(calls),2);self.assertIs(authority.kernel_function.__code__,original)
  self.assertEqual(saved,{});self.assertEqual(ns['diagnostic'],{})

 def test_06_secondary_witness_failures_or_foreign_prefix_never_replace_original_error(self):
  for secondary in [MemoryError('private save'),TimeoutError('witness deadline'),KeyboardInterrupt()]:
   ns,_,operation,calls,_,seen=self.fixture()
   ns['save']=Mock(side_effect=secondary)
   with self.assertRaises(RuntimeError)as caught:ns['observe'](operation)
   self.assertIs(caught.exception,seen[0]);self.assertTrue(ns['diagnostic']['captureRefused']);self.assertEqual(len(calls),1)
   self.doCleanups()
  ns=remote();ns['guard']=guard;error=RuntimeError(ns['FIXED'])
  with self.assertRaises(RuntimeError)as caught:ns['observe'](lambda:(_ for _ in()).throw(error))
  self.assertIs(caught.exception,error);self.assertTrue(ns['diagnostic']['captureRefused'])

 def test_07_main_restores_original_run_before_failure_witness_and_writes_only_summary(self):
  ns=remote();saved={};error=RuntimeError('strict_original_business_refusal');events=[]
  class Observer:
   def snapshot(self):self_check();events.append('snapshot');return{'explicitPrivateCountersFixture':True}
  observer=Observer()
  def self_check():self.assertIs(ns['subprocess'].run,ns['original_run'])
  def run():ns['observer']=observer;ns['subprocess'].run=observer;raise error
  def witness(original):self_check();self.assertIs(original,error);events.append('after-original-failure');return{'originalFailurePreserved':True,'diagnosticOnly':True}
  def save(name,value):self_check();saved[name]=copy.deepcopy(value);return ns['sha'](ns['encoded'](value))
  ns.update(run=run,after_exception=witness,save=save,sync=lambda *_:None)
  with patch.object(pathlib.Path,'mkdir'),patch.object(ns['socket'],'gethostname',return_value='yunipals-main'),patch.object(ns['signal'],'signal'),patch.object(ns['signal'],'alarm'),contextlib.redirect_stdout(io.StringIO()):self.assertEqual(ns['main'](),1)
  self.assertIs(ns['primary'],error);self.assertEqual(events,['after-original-failure','snapshot']);self_check()
  result=saved['result.json'];self.assertFalse(result['activationDispatched']);self.assertFalse(result['qualificationAuthorityGranted']);self.assertFalse(result['effectReplayAllowed'])
  self.assertFalse(result['automaticRetryAllowed']);self.assertTrue(result['subprocessRunRestored'])


 def test_08_whole_fresh_run_installs_classifier_before_session_and_retains_original_readonly_order(self):
  ns=remote();events=[];saved={}
  class Observer:
   def __init__(self,original,save):self.original=original
   def binding(self):events.append('classifier-binding');return{'actualClassifierBindingIOFixture':True}
  source=types.SimpleNamespace(current=lambda:events.append('full-source-current')or{'actualSourceProofIOFixture':True})
  cache=types.SimpleNamespace(stopped=lambda h:events.append('actual-stopped-private'))
  host=types.SimpleNamespace(refresh=lambda:events.append('genuine-host-refresh'),prerequisites=lambda:events.append('genuine-full-prerequisites')or{'actualCompletePrerequisitesIOFixture':True})
  session=types.SimpleNamespace(source=source,cache=cache,host=host,preflight=lambda:events.append('full-preflight')or{'validated':True},cache_context=lambda sha:events.append('genuine-cache-context'),finish=lambda:events.append('full-source-finish')or{'validated':True})
  def constructor(*args):
   self.assertIsInstance(ns['subprocess'].run,Observer);events.append('fresh-session');return session
  def module(name):
   if name==ns['GUARD']:return guard
   if name==ns['CLASSIFIER']:return types.SimpleNamespace(authenticate=lambda:events.append('classifier-auth'),SubprocessDiagnostics=Observer)
   if name=='ypal-ordinary-publication-continue-v6.py':return types.SimpleNamespace(Session=constructor)
   if name=='ypal-native-readiness-prepared-binding-v1.py':return types.SimpleNamespace(bind=lambda actual:events.append('actual-77')or{'actual77BindingIOFixture':True})
   if name=='ypal-native-readiness-generation-binding-v1.py':return types.SimpleNamespace(bind=lambda actual:events.append('actual-b774')or{'actualGENBindingIOFixture':True})
   raise AssertionError(name)
  failed={'format':'root-native120-cache-split-phase-v1','rootProducerSha256':ns['PHASE_SHA'],'action':'verify',
   'completed':False,'effectInvoked':False,'phaseReturned':False,'unknownOutcomeRequiresInspection':False,'automaticRetryAllowed':False}
  def public(path,digest=None):
   if path==ns['FAILED_ROOT']:return ns['encoded'](failed)
   if path==ns['REPORT']:return ns['encoded']({'sourceRefs':{'actualSourceRefsIOFixture':True}})
   return b'explicit-authenticated-public-source-IO-fixture'
  ns.update(public=public,load=module,save=lambda name,value:saved.setdefault(name,value))
  with patch.object(ns['subprocess'],'run',ns['original_run']):
   try:value=ns['run']()
   finally:ns['subprocess'].run=ns['original_run']
  self.assertTrue(value['fullReadonlyPathReturned']);self.assertEqual(events,['classifier-auth','classifier-binding','fresh-session','full-preflight','actual-77','genuine-cache-context','actual-b774','full-source-current','actual-stopped-private','genuine-host-refresh','genuine-full-prerequisites','full-source-finish'])
  self.assertEqual(len([name for name in saved if name=='complete-prerequisites.json']),1);self.assertNotIn('verification.json',saved)

if __name__=='__main__':unittest.main()

