import ast,copy,hashlib,importlib.util,json,os,pathlib,subprocess,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent;P=HERE/'ypal-cont5-readonly-refresh-benchmark-owner-v1.py'
def load(p):
 spec=importlib.util.spec_from_file_location('readonly_fixture_'+p.stem.replace('-','_'),p);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v
m=load(P);r=ast.parse(m.REMOTE);fn={n.name:n for n in r.body if isinstance(n,ast.FunctionDef)}
recon=json.loads((HERE/'ypal-cont5-held8-reconciliation-result-fixture.json').read_bytes());base=json.loads((HERE/'ypal-cont5-construct3-result-fixture.json').read_bytes());detail=json.loads((HERE/'ypal-cont5-held8-failure-detail-fixture.json').read_bytes());failed=detail['operationResult']
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def need(v,c):
 if not v:raise RuntimeError(c)
def execute(names,scope):
 exec(compile(ast.Module(body=[fn[n]for n in names],type_ignores=[]),str(P),'exec'),scope);return scope
class Controls(unittest.TestCase):
 def test_default_and_review_false_prevent_transport(self):
  self.assertIs(m.BENCHMARK_SOURCE_REVIEWED,True)
  normalized=P.read_text().replace('# Root and independent full/delta review and 11 controls passed.\n','').replace('BENCHMARK_SOURCE_REVIEWED=True','BENCHMARK_SOURCE_REVIEWED=False')
  self.assertEqual(sha(normalized.encode()),'6b104be3fcc0c9a2874a65f18e588d5135eee9802627badb016d0dd688f4b09b')
  with patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')),patch('builtins.print'),patch('sys.argv',[str(P)]):m.main()
  with patch.object(m,'BENCHMARK_SOURCE_REVIEWED',False),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')),patch('sys.argv',[str(P),'--run']):
   with self.assertRaisesRegex(RuntimeError,'source_review_required'):m.main()
 def test_actual_3acb_canonical_local_gate_refuses_failure_foreign_and_typed_changes(self):
  self.assertIs(m.actual_result(recon,recon['resultSha256']),recon);self.assertIs(m.need_reconciliation_result(recon),recon)
  for key,value in [('completed',False),('transactionId','17049626'),('newHeldSuccessAuthority',True),('completeHeldCallbackQualified',True),('productionPreparedACKCreated',True)]:
   v=copy.deepcopy(recon);v[key]=value
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.actual_result(v,recon['resultSha256'])
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.need_reconciliation_result(v)
 def test_entire_borrowed_auth_and_complete_baseline_bodies_remain_exact(self):
  old=load(HERE/'ypal-cont5-held8-reconcile-owner-v1.py');oldfn={n.name:n for n in ast.parse(old.REMOTE).body if isinstance(n,ast.FunctionDef)}
  for name,original in oldfn.items():
   if name=='deadline':continue
   self.assertEqual(ast.dump(original,include_attributes=False),ast.dump(fn[name],include_attributes=False),name)
  a=" stage='authenticate-completed-construct-only3-baseline'";b=" stage='authenticate-live-programs'"
  self.assertEqual(m.REMOTE[m.REMOTE.index(a):m.REMOTE.index(b)],old.REMOTE[old.REMOTE.index(a):old.REMOTE.index(b)])
 def fixture(self,change=None):
  root=Path(self.enterContext(tempfile.TemporaryDirectory()));cache=root/'cache';capture=root/'capture';cache.mkdir();capture.mkdir();baseline={k:v for k,v in base.items()if k!='resultSha256'}
  frames=[]
  for folder,names in [(cache,['before.json','rehearsal-intent.json','rehearse-sql-child.json','rehearse-sql-opened.json','rehearsed.json','authorization.json']),(capture,[v['name']for v in detail['captureFiles']])]:
   rows={}
   for name in names:
    p=folder/name;p.write_bytes(encoded({'explicitPrivateFileIOFixture':name}));row=p.stat();rows[name]={'sha256':sha(p.read_bytes()),'inode':row.st_ino,'bytes':row.st_size}
   frames.append(rows)
  # Literal known prepared file digest remains anchored by protected-I/O; its
  # 2.28MB private content is not copied to tests.
  frames[1]['actual-prepared-observation.json']['sha256']='578d82456d5e9165c632d538efeabb762b82163734ced5868f4e861aa534c0ee'
  epoch={'explicitFullCroppedMetadataEpochIOFixture':True};catalog={'catalogSha256':'catalog','postProof':{'catalog':{'completeRelationsAndAllGrantees':[]},'reader':{'completeGraph':[]},'allColumnAcl':[]}}
  terminal={'transactionId':'17079057','transactionStatus':'aborted','rootEpochGone':True,'childEpochGone':True,'backendEpochGone':True,'ownerAPPBackendCount':0,'matchingSQLentryProcessCount':0,'publicationReadBackendCount':0}
  whole={'failedHeld8RootResultSha256':failed['resultSha256'],'acceptedBaselineRootResultSha256':base['resultSha256'],'beforeSha256':base['beforeSha256'],'actualCatalog':copy.deepcopy(catalog),
   'priorAborted':{'validated':True,'bindingSha256':base['priorAbortedSha256'],'binding':{'transactionId':'16540148','transactionStatus':'aborted','priorChildGone':True,'priorBackendGone':True}},
   **{k:True for k in ['wholeCatalogQualified','allColumnACLQualified','readerGraphQualified','sharedSDKLockHeld']},'newSQLMutationDispatched':False,'newPreparedACKCreated':False,
   'terminalBefore':copy.deepcopy(terminal),'terminalAfter':copy.deepcopy(terminal),'baselineFiles':frames[0],'failedCaptureFiles':frames[1]}
  observed={'preparedObservationFileSha256':frames[1]['actual-prepared-observation.json']['sha256'],'packetSha256':'6b1c44228a1462170eca1899765c035c5e3a394c1d042266152c1b7c9aed6f30','transactionId':'17079057','actualPreparedObservationAuthenticated':True,'neverProductionPreparedACK':True,
   **{k:False for k in ['completeHeldCallbackQualified','productionCOMMITQualified','productionPreparedACKCreated','newCommitAuthority','newHeldSuccessAuthority']}}
  history={'explicitPrivateFullCurrentHistoryIOFixture':True};archive={'explicitActualArchiveIOFixture':True}
  proofs={'baseline-root-result':baseline,'actual-failed-held8':{k:v for k,v in failed.items()if k!='resultSha256'},'actual-prepared-observation':observed,'authenticated-baseline-proof-hashes':baseline['proofHashes'],
   'authenticated-baseline-metadata-histories':history,'authenticated-baseline-archive':archive,'whole-catalog-reconciliation':whole,
   'new-full-current-prerequisites':{'metadataCurrentProof':{'currentNativeMetadataQualified':True,'metadataEpoch':epoch}},'new-source-preflight':{},'full-source-postflight':{'metadataActorCurrent':{'currentActorQualified':True},'metadataEpoch':epoch}}
  read=[]
  def document(path,digest):
   name=Path(path).name;read.append((str(path),digest))
   if name=='result.json':
    if 'held8-reconcile'in str(path):self.assertEqual(digest,recon['resultSha256']);return{k:v for k,v in recon.items()if k!='resultSha256'}
    self.assertEqual(digest,base['resultSha256']);return baseline
   if name=='before.json':self.assertEqual(digest,base['beforeSha256']);return{'catalog':catalog,'binding':{'prerequisites':{'metadataCurrentProof':{'metadataEpoch':epoch}}}}
   if name=='archive-result.private.json':self.assertEqual(digest,baseline['archiveResultSha256']);return archive
   if name=='metadata-capture-histories-success.private.json':return history
   key={'authenticated-baseline-root-result':'baseline-root-result'}.get(name.removesuffix('.private.json'),name.removesuffix('.private.json'))
   self.assertEqual(digest,recon['proofHashes'][key]);return proofs[key]
  def frame(path,digest):
   rows=frames[0]if Path(path).parent==cache else frames[1];expected=rows[Path(path).name];need(digest==expected['sha256'],'exactProtectedPrivateIOFixture')
   if Path(path).name!='actual-prepared-observation.json':need(sha(Path(path).read_bytes())==digest,'physicalFixtureChanged')
   return dict(expected)
  scope={'document':document,'same_local_remote':lambda local,remote,digest:need(encoded(local)==encoded({**remote,'resultSha256':digest}),'sameActualEnvelope'),
   'reconciliation_local':recon,'FAILED_SHA':failed['resultSha256'],'baseline_local':base,'failed_local':failed,'need':need,'encoded':encoded,'sha':sha,'pin':lambda v:type(v)is str and len(v)==64,
   'pathlib':pathlib,'BASELINE_AUDIT':Path('/fixture/baseline'),'CACHE_BASE':cache,'FAILED_CAPTURE':capture,'file_frame':frame,'validate_history':Mock(),
   'CALLER_SHA':recon['callerSha256'],'MANIFEST_SHA':recon['readerManifestSha256'],'refs':m.EXPECTED_REFS}
  execute(['authenticate_reconciliation8'],scope)
  if change:change(scope,whole,proofs,cache,capture)
  return scope,whole,proofs,read
 def test_actual_ten_recovery_nodes_and_full_private_catalog_files_history(self):
  scope,w,p,reads=self.fixture();value=scope['authenticate_reconciliation8']();self.assertEqual(value['resultSha256'],recon['resultSha256']);self.assertFalse(value['newCurrentAuthority']);scope['validate_history'].assert_called_once()
  self.assertTrue(any('actual-prepared-observation.private.json'in name for name,d in reads))
 def test_recovery_catalog_column_reader_terminal_inode_and_non_ACK_mutations_refuse(self):
  changes=[lambda s,w,p,c,f:w['actualCatalog']['postProof']['allColumnAcl'].append({'foreign':True}),lambda s,w,p,c,f:w['actualCatalog']['postProof']['reader'].update(foreign=True),
   lambda s,w,p,c,f:w['terminalAfter'].update(ownerAPPBackendCount=False),lambda s,w,p,c,f:(c/'before.json').write_bytes(b'changed'),
   lambda s,w,p,c,f:p['actual-prepared-observation'].update(productionPreparedACKCreated=True),lambda s,w,p,c,f:p['full-source-postflight']['metadataActorCurrent'].update(currentActorQualified=False)]
  for change in changes:
   with self.subTest(index=changes.index(change)):
    scope,*_=self.fixture(change)
    with self.assertRaises(RuntimeError):scope['authenticate_reconciliation8']()
 def measure(self,host,timer=None):
  timer=timer or load(HERE/'ypal-readonly-run-duration-v1.py');scope={'need':need,'sys':sys,'time':__import__('time'),'duration_observer':None,'measurement_phases':[]}
  execute(['measured_call','observe_refresh_and_prerequisites'],scope);return scope['observe_refresh_and_prerequisites'](host,timer),scope
 def test_one_pair_same_host_real_subprocess_and_absolute_phase_stamps(self):
  events=[];returned=object();original=subprocess.run
  class Host:
   def refresh(host):events.append(('refresh',host));return subprocess.run([sys.executable,'-I','-B','-c','pass'],capture_output=True,timeout=5)
   def prerequisites(host):events.append(('prerequisites',host));return returned
  host=Host();value,scope=self.measure(host);self.assertIs(value,returned);self.assertEqual(events,[('refresh',host),('prerequisites',host)]);self.assertIs(subprocess.run,original)
  self.assertEqual(len(scope['duration_observer'].snapshot()['calls']),1)
  for row in scope['measurement_phases']:
   self.assertTrue(row['returned']);self.assertEqual(row['wallNanoseconds'],row['endedPerfCounterNanoseconds']-row['startedPerfCounterNanoseconds']);self.assertGreaterEqual(row['parentCPUNanoseconds'],0)
 def test_original_error_stops_pair_restores_run_and_records_failed_phase(self):
  original=subprocess.run;error=RuntimeError('actualOriginalCurrentRefusal');calls=[]
  class Host:
   def refresh(host):calls.append('refresh');raise error
   def prerequisites(host):raise AssertionError('no second call or retry')
  timer=load(HERE/'ypal-readonly-run-duration-v1.py');scope={'need':need,'sys':sys,'time':__import__('time'),'duration_observer':None,'measurement_phases':[]};execute(['measured_call','observe_refresh_and_prerequisites'],scope)
  with self.assertRaises(RuntimeError)as caught:scope['observe_refresh_and_prerequisites'](Host(),timer)
  self.assertIs(caught.exception,error);self.assertIs(subprocess.run,original);self.assertEqual(calls,['refresh']);self.assertFalse(scope['measurement_phases'][0]['returned'])
 def test_snapshot_restore_before_writes_and_reuses_only_same_saved_diagnostic_hashes(self):
  events=[];writes={};original=subprocess.run;timer=load(HERE/'ypal-readonly-run-duration-v1.py');observer=timer.RunDurations()
  with observer:pass
  def write(name,value):self.assertIs(subprocess.run,original);events.append(name);writes[name]=value;return sha(encoded(value))
  scope={'duration_observer':observer,'duration_snapshot_saved':False,'duration_saved_summary':None,'measurement_phases':[],'need':need,'write':write}
  execute(['save_duration_observation'],scope);first=scope['save_duration_observation']();second=scope['save_duration_observation']()
  self.assertEqual(first,second);self.assertEqual(len(events),2);self.assertIsNot(first,second);self.assertTrue(first['completeRunDurationCoverage'])
  scope['duration_saved_summary']=None;observer.dropped_calls=1;partial=scope['save_duration_observation']();self.assertFalse(partial['completeRunDurationCoverage'])
 def test_real_outer_main_actual_four_input_render_and_missing_recovery_before_transport(self):
  values={m.BASELINE_RESULT:base,m.FAILED_RESULT:detail,m.RECONCILIATION_RESULT:recon,m.METADATA_REFS:m.EXPECTED_REFS}
  observed={}
  def transport(argv,**kwargs):observed.update(argv=argv,**kwargs);return types.SimpleNamespace(returncode=0,stderr='',stdout=json.dumps({'format':'root-CONT5-readonly-refresh-benchmark-v1','completed':True,'explicitTransportIOFixtureOnly':True}))
  with patch.object(m,'BENCHMARK_SOURCE_REVIEWED',True),patch.object(m,'read_private',side_effect=lambda p:copy.deepcopy(values[p])),patch.object(m.os.path,'lexists',return_value=False),patch.object(m,'exclusive')as save,patch.object(m.subprocess,'run',side_effect=transport),patch('builtins.print'),patch('sys.argv',[str(P),'--run']):
   with self.assertRaises(SystemExit)as done:m.main()
  self.assertEqual(done.exception.code,0);self.assertNotIn('ACTUAL_',observed['input']);self.assertTrue(observed['input'].startswith('import ast,'));self.assertEqual(observed['argv'][-1],'python3 -I -B -')
  expected=m.REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(base)).replace('ACTUAL_METADATA_REFS',repr(m.EXPECTED_REFS)).replace('ACTUAL_HELD8_FAILURE',repr(failed)).replace('ACTUAL_HELD8_RECONCILIATION',repr(recon))
  self.assertEqual(observed['input'],expected);self.assertEqual(save.call_count,1)
  def missing(path):
   if path==m.RECONCILIATION_RESULT:raise FileNotFoundError('missingActualRecovery')
   return copy.deepcopy(values[path])
  with patch.object(m,'BENCHMARK_SOURCE_REVIEWED',True),patch.object(m,'read_private',side_effect=missing),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH'))as transport,patch('sys.argv',[str(P),'--run']):
   with self.assertRaises(FileNotFoundError):m.main()
  transport.assert_not_called()
 def test_postflight_failure_reuses_saved_diagnostics_without_replacing_original_error(self):
  top=next(n for n in r.body if isinstance(n,ast.Try));handler=copy.deepcopy(top.handlers[0]);error=RuntimeError('actual_full_Source_postflight_refused');saved={}
  summary={'privateRunDurationsSha256':'a'*64,'privateMeasurementPhasesSha256':'b'*64,'subprocessRunRestored':True}
  def write(name,value):
   if name=='history-save-refusal.private.txt':raise OSError('secondaryDiagnosticDiskRefusal')
   saved[name]=value;return sha(value if isinstance(value,bytes)else encoded(value))
  scope={'original':error,'traceback':__import__('traceback'),'save_duration_observation':Mock(return_value=summary),'capture_histories':Mock(side_effect=OSError('diagnosticMemoryHistoryRefusal')),
   'proof_hashes':{},'write':write,'now':lambda:'fixture','stage':'full-source-postflight','reconciliation_local':recon,'re':__import__('re')}
  statement=ast.Try(body=[ast.Raise(exc=ast.Name(id='original',ctx=ast.Load()))],handlers=[handler],orelse=[],finalbody=[])
  exec(compile(ast.fix_missing_locations(ast.Module(body=[statement],type_ignores=[])),str(P),'exec'),scope)
  self.assertIs(scope['result']['completed'],False);self.assertEqual(scope['result']['failureCode'],'actual_full_Source_postflight_refused')
  self.assertEqual(scope['result']['privateRunDurationsSha256'],summary['privateRunDurationsSha256']);self.assertIn('actual_full_Source_postflight_refused',saved['failure.private.txt'].decode())
  scope['save_duration_observation'].assert_called_once()
 def test_live_order_full_postflight_and_no_effect_or_approval_wait_dispatch(self):
  called=[ast.unparse(n.func)for n in ast.walk(r)if isinstance(n,ast.Call)]
  for forbidden in ['caller.qualify_held','caller.execute_cache','caller.execute_reader','caller.construct_records','cache.sql_child','cache._sql_child','authenticate_prepared_observation','wait_for_native_approval_renewal','authority.approval_snapshot','subprocess.Popen','sys.settrace','sys.setprofile']:
   self.assertNotIn(forbidden,called)
  self.assertEqual(called.count('session.preflight'),1);self.assertEqual(called.count('session.cache_context'),1);self.assertEqual(called.count('session.finish'),1)
  self.assertIn("load(TIMER,TIMER_SHA)",m.REMOTE);self.assertIn('00b35f20a783307f5a83351c34876d0fa2777cea95ae1a817f399704a1be67a4',m.REMOTE)
  self.assertLess(m.REMOTE.index("stage='one-readonly-host-refresh-and-prerequisites'"),m.REMOTE.index("stage='full-source-postflight'"))
  compile(m.REMOTE,'REMOTE','exec')
if __name__=='__main__':unittest.main()
