import ast,contextlib,copy,hashlib,importlib.util,json,os,sys,time,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
P=HERE/'ypal-cont5-held-qualification-owner-v4.py';source=P.read_text();tree=ast.parse(source)
remote=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets))
r=ast.parse(remote);functions={n.name:n for n in r.body if isinstance(n,ast.FunctionDef)}
def need(value,code):
 if not value:raise RuntimeError(code)
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
profile=load((HERE/'ypal-ordinary-call-profile-v1.py'))
held5=json.loads((HERE/'ypal-cont5-held5-result-fixture.json').read_bytes())

class Controls(unittest.TestCase):
 def execute(self,names,scope):
  exec(compile(ast.fix_missing_locations(ast.Module(body=[functions[n]for n in names],type_ignores=[])),str(P),'exec'),scope);return scope
 def test_actual_held5_canonical_shape_and_actual_inner_snapshot_keys(self):
  canonical={key:value for key,value in held5.items()if key!='resultSha256'};self.assertEqual(sha(encoded(canonical)),held5['resultSha256'])
  diagnostic=load((HERE/'ypal-ordinary-held-diagnostic-v1.py'))
  trace=diagnostic.CaughtErrorTrace((lambda:None).__code__);trace.error=RuntimeError('dependency_preauthorization_deadline_expired_no_module_evaluation')
  observation={'caughtError':trace.snapshot(),'transports':[],'wholeParentCodeUnchanged':True,'parentRestored':True,'traceRestored':True,
   **{key:False for key in ['SQLBytesChanged','predicatesChanged','deadlinesChanged','clockReset','effectOrCaptureRetried']}}
  def document(path,digest):
   if Path(path).name=='result.json':self.assertEqual(digest,held5['resultSha256']);return copy.deepcopy(canonical)
   self.assertEqual(digest,held5['qualificationDiagnosticSha256']);return copy.deepcopy(observation)
  scope={'document':document,'FAILED5_AUDIT':Path('/fixture'),'FAILED5_SHA':held5['resultSha256'],'held5_local':held5,
   'CALLER_SHA':held5['callerSha256'],'MANIFEST_SHA':held5['readerManifestSha256'],'encoded':encoded,'sha':sha,'need':need,
   'refs':ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='EXPECTED_REFS'for t in n.targets)))}
  self.execute(['same_local_remote','held5_failure'],scope)
  value=scope['held5_failure']();self.assertEqual(value['priorSQLTransportCount'],0);self.assertFalse(value['priorHeldSuccessClaimed'])
  observation['transports']=[{'foreignSQL':True}]
  with self.assertRaisesRegex(RuntimeError,'before_transport'):scope['held5_failure']()
 def test_real_profile_suspends_and_resumes_same_events_on_inspect_return_and_error(self):
  for fails in [False,True]:
   self.assertIsNone(sys.getprofile());profiler=profile.CallProfile({str(P):sha(P.read_bytes())},{'fixture'})
   profiler.events.append({'actualPriorEvent':True});marker=RuntimeError('genuine inspect fixture refusal');calls=[]
   def inspect(host,mode):
    self.assertIsNone(sys.getprofile());self.assertIsNone(sys.gettrace());self.assertEqual(mode,'inspect');calls.append((host,mode))
    if fails:raise marker
    return{'genuineInspectIO':True}
   scope={'profiler':profiler,'sys':sys,'need':need,'phase':lambda _,fn,*args:fn(*args)}
   self.execute(['plain_inspection'],scope);profiler.__enter__()
   try:
    if fails:
     with self.assertRaises(RuntimeError)as caught:scope['plain_inspection'](types.SimpleNamespace(sql_child=inspect),'actualHost')
     self.assertIs(caught.exception,marker)
    else:self.assertEqual(scope['plain_inspection'](types.SimpleNamespace(sql_child=inspect),'actualHost'),{'genuineInspectIO':True})
    self.assertTrue(profiler.installed);self.assertEqual(profiler.events,[{'actualPriorEvent':True}]);self.assertEqual(len(calls),1)
   finally:profiler.__exit__(None,None,None)
 def reconcile(self,change=None):
  calls=[];saved={};held={'value':False};files={'actualBaselineFileAndInode':True};failed={'actualFailedCaptureFilesAndInodes':True}
  catalog={'catalogSha256':'actualCatalog','postProof':{'catalog':{'actualCompleteCatalog':True},'allColumnAcl':{'actualAllColumnACL':True}}}
  before={'catalog':copy.deepcopy(catalog)};inspected=copy.deepcopy(catalog)
  prior={'bindingSha256':'priorActualSHA','binding':{'transactionId':'16540148','transactionStatus':'aborted'}}
  baseline={'beforeSha256':'beforeActualSHA','priorAbortedSha256':'priorActualSHA'}
  @contextlib.contextmanager
  def lock():
   self.assertFalse(held['value']);held['value']=True;calls.append('lock-enter')
   try:yield
   finally:held['value']=False;calls.append('lock-exit')
  cache=types.SimpleNamespace(BASE=Path('/fixture/cache'),ENTRY=Path('/fixture/cache-entry.mjs'),_sql_child=object(),sql_child=object())
  host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=lock)}),
   read=types.SimpleNamespace(acl_catalog=lambda value:value),query=lambda sql:[])
  def original(prior_cache,actual_host):
   self.assertTrue(held['value']);self.assertIs(actual_host,host);calls.append('original-catalog');return prior,catalog
  cache.prior_cache=object();authority=types.SimpleNamespace(OWNER_SESSIONS_SQL='genuine APP SQL',original_catalog=original)
  def plain(actual_cache,actual_host):
   self.assertTrue(held['value']);self.assertIs(actual_cache,cache);self.assertIs(actual_host,host);calls.append('plain-inspect');return inspected
  scope={'sys':sys,'time':time,'need':need,'fixed_cache_frame':lambda value:copy.deepcopy(files),'fixed_failed_capture':lambda:copy.deepcopy(failed),
   'old_root_epoch_gone':lambda:True,'sql_processes':lambda _:[],'document':lambda *_:before,'phase':lambda _,fn,*args:fn(*args),
   'plain_inspection':plain,'proof_hashes':{},'write':lambda name,value:(saved.setdefault(name,value)and 'actualWrittenSHA'),
   'FAILED5_SHA':held5['resultSha256'],'baseline_local':{'resultSha256':'actualBaselineRootSHA'}}
  if change:change(scope,cache,host,prior,catalog,inspected)
  self.execute(['reconcile_and_prepare'],scope)
  self.last_calls=calls;self.last_saved=saved
  try:scope['reconcile_and_prepare'](cache,host,authority,baseline)
  finally:self.assertFalse(held['value'])
  # The original caller's later lock can acquire; no nested lock retained.
  with lock():self.assertTrue(held['value'])
  return calls,saved,scope
 def test_same_context_full_reconciliation_then_plain_inspect_lock_releases(self):
  calls,saved,scope=self.reconcile();self.assertEqual(calls[:4],['lock-enter','original-catalog','plain-inspect','lock-exit'])
  self.assertEqual(set(scope['proof_hashes']),{'held5-catalog-reconciliation','untraced-dependency-inspection'})
  self.assertTrue(saved['held5-catalog-reconciliation.private.json']['wholeCatalogRestored'])
  self.assertFalse(saved['untraced-dependency-inspection.private.json']['newTransactionTimingAuthority'])
 def test_old_process_unknown_backend_entry_and_all_catalog_mismatches_refuse(self):
  changes=[lambda s,c,h,p,k,i:s.update(old_root_epoch_gone=lambda:False),lambda s,c,h,p,k,i:s.update(sql_processes=lambda _:[{'unknown':True}]),
   lambda s,c,h,p,k,i:setattr(h,'query',lambda _:[{'foreignRoleAPP':True}]),lambda s,c,h,p,k,i:k.update(catalogSha256='foreign'),
   lambda s,c,h,p,k,i:k['postProof'].update(allColumnAcl={'foreign':True}),lambda s,c,h,p,k,i:p.update(bindingSha256='foreign')]
  for change in changes:
   with self.subTest(change=changes.index(change)):
    with self.assertRaises(RuntimeError):self.reconcile(change)
    self.assertNotIn('plain-inspect',self.last_calls);self.assertNotIn('untraced-dependency-inspection.private.json',self.last_saved)
 def test_warm_inspection_catalog_parent_and_scope_mutations_refuse(self):
  changes=[lambda s,c,h,p,k,i:i.update(catalogSha256='foreign'),lambda s,c,h,p,k,i:i['postProof'].update(allColumnAcl={'foreign':True}),
   lambda s,c,h,p,k,i:setattr(c,'_continuation_approval_gate',{}),
   lambda s,c,h,p,k,i:s.update(plain_inspection=lambda *_:setattr(c,'_sql_child',object())or i)]
  for change in changes:
   with self.subTest(change=changes.index(change)),self.assertRaises(RuntimeError):self.reconcile(change)
 def test_actual_server_inventory_matches_every_fixed_cache_and_failed_capture_pin(self):
  actual=json.loads((HERE/'ypal-cont5-held5-terminal-inventory-fixture.json').read_bytes())
  rows={label:{row['name']:row for row in actual['directories'][label]['files']}for label in ['cache','capture']}
  class Directory:
   def __init__(self,label):self.label=label
   def iterdir(self):return[types.SimpleNamespace(name=name)for name in rows[self.label]]
   def __truediv__(self,name):return Path('/fixture')/self.label/name
  def frame(path,digest):
   row=rows[path.parent.name][path.name];self.assertEqual(row['sha256'],digest);self.assertEqual(row['mode'],0o600)
   return{'inode':row['inode'],'sha256':digest,'mode':row['mode']}
  scope={'file_frame':frame,'FAILED5_CAPTURE':Directory('capture'),'need':need}
  self.execute(['fixed_cache_frame','fixed_failed_capture'],scope)
  self.assertEqual(len(scope['fixed_cache_frame'](types.SimpleNamespace(BASE=Directory('cache')))),6)
  self.assertEqual(len(scope['fixed_failed_capture']()),2)
  rows['cache']['prepared.json']={'inode':1,'sha256':'x','mode':0o600}
  with self.assertRaisesRegex(RuntimeError,'six_baseline'):scope['fixed_cache_frame'](types.SimpleNamespace(BASE=Directory('cache')))
  rows['capture']['intent.json']['inode']+=1
  with self.assertRaisesRegex(RuntimeError,'capture_inodes'):scope['fixed_failed_capture']()
 def test_original_failed_root_epoch_permission_and_reuse_classification_stays_strict(self):
  scope={'pathlib':types.SimpleNamespace(Path=lambda _:types.SimpleNamespace(read_text=lambda:'1 (fixture) S '+' '.join(['0']*18+['6641096413']))),'need':need}
  self.execute(['old_root_epoch_gone'],scope);self.assertFalse(scope['old_root_epoch_gone']())
  scope['pathlib'].Path=lambda _:types.SimpleNamespace(read_text=lambda:'1 (fixture) S '+' '.join(['0']*18+['6641096414']))
  self.assertTrue(scope['old_root_epoch_gone']())
  def absent():raise FileNotFoundError('actual gone fixture')
  scope['pathlib'].Path=lambda _:types.SimpleNamespace(read_text=absent);self.assertTrue(scope['old_root_epoch_gone']())
  def denied():raise PermissionError('strict unknown permission')
  scope['pathlib'].Path=lambda _:types.SimpleNamespace(read_text=denied)
  with self.assertRaises(PermissionError):scope['old_root_epoch_gone']()
 def test_held6_preserves_complete_actual_qualifier_tail_and_original_budgets(self):
  old=(HERE/'ypal-cont5-held-qualification-owner-v3.py').read_text();self.assertEqual(sha(old.encode()),'99c439b2c53a38a65950f61a937ac7413d907cb1de452fe900a7a0ca90c2f855')
  oldtree=ast.parse(old);prior=next(n.value.value for n in oldtree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets))
  def tail(text):return text[text.index(" stage='qualify-held-rollback-only'"):text.index('except BaseException as error:\n original_trace=')]
  self.assertEqual(tail(remote),tail(prior).replace('held5-construct-only3-baseline','held6-untraced-dependency-preparation').replace('root-CONT5-held-rollback-qualification-v3','root-CONT5-held-rollback-qualification-v4'))
  self.assertIn('signal.alarm(880)',remote);self.assertIn('remaining=900-',source)
  self.assertEqual(source.count("phase('qualify-held-rollback-only',caller.qualify_held,session,CAPTURE)"),1)
  compile(source,str(P),'exec');compile(remote,str(P)+':REMOTE','exec')

if __name__=='__main__':unittest.main(verbosity=2)
