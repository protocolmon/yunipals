"""Root HELD7 source/actual public envelopes; all private I/O is explicit fixture."""
import ast,contextlib,copy,hashlib,importlib.util,json,os,pathlib,signal,sys,tempfile,time,traceback,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
P=HERE/'ypal-cont5-held-qualification-owner-v5.py'
def load(path):
 s=importlib.util.spec_from_file_location(Path(path).stem,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load(P);old=load(HERE/'ypal-cont5-held-qualification-owner-v4.py')
r=ast.parse(m.REMOTE);o=ast.parse(old.REMOTE);fn={n.name:n for n in r.body if isinstance(n,ast.FunctionDef)}
oldfn={n.name:n for n in o.body if isinstance(n,ast.FunctionDef)}
recon=json.loads((HERE/'ypal-cont5-held6-reconciliation-result-fixture.json').read_bytes())
base=json.loads((HERE/'ypal-cont5-construct3-result-fixture.json').read_bytes())
failed=json.loads((HERE.parents[1]/'docs/unified-indexer/cont5-held6-failure-production-2026-10-26.json').read_bytes())
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value,code):
 if not value:raise RuntimeError(code)
def execute(names,scope):
 exec(compile(ast.fix_missing_locations(ast.Module(body=[copy.deepcopy(fn[n])for n in names],type_ignores=[])),str(P),'exec'),scope);return scope
class Controls(unittest.TestCase):
 def setUp(self):
  directory=self.enterContext(tempfile.TemporaryDirectory(prefix='held7-local-controls-',dir=HERE))
  self.enterContext(patch.object(m,'RESULT',Path(directory)/m.RESULT.name))
 def test_complete_retained_functions_baseline_gate_and_original_timed_calls_unchanged(self):
  changed={'plain_inspection','save_observations','kernel_traceback_evidence'}
  for name in set(oldfn)-changed:self.assertEqual(ast.dump(fn[name],include_attributes=False),ast.dump(oldfn[name],include_attributes=False),name)
  a=" stage='authenticate-completed-construct-only3-baseline'";b=" stage='authenticate-live-programs'"
  self.assertEqual(m.REMOTE[m.REMOTE.index(a):m.REMOTE.index(b)],old.REMOTE[old.REMOTE.index(a):old.REMOTE.index(b)])
  calls=[ast.unparse(n)for n in ast.walk(r)if isinstance(n,ast.Call)]
  for name in ["phase('qualify-held-rollback-only', caller.qualify_held, session, CAPTURE)",
   "phase('require-qualification', authority.require_qualification, cache, session.host, qualification_ref)"]:
   self.assertEqual(calls.count(name),1)
  self.assertIn("qualified['elapsedNanoseconds'] + qualified['reserveNanoseconds'] < qualified['approvalGate']['remainingNanoseconds']",ast.unparse(r))
  self.assertIn('90_000_000_000',m.REMOTE);self.assertIn('5_000_000_000',m.REMOTE);self.assertIn("dependencyDeadlineSecondsUnchanged':120",m.REMOTE)
 def test_no_active_global_observer_or_transport_wrapper_and_own_namespace(self):
  called=[ast.unparse(n.func)for n in ast.walk(r)if isinstance(n,ast.Call)]
  for name in ['sys.settrace','sys.setprofile','subprocess.Popen','profiler.__enter__','diagnostic_module.ObservedQualification']:
   self.assertNotIn(name,called)
  loads=[ast.unparse(n)for n in ast.walk(r)if isinstance(n,ast.Call)and ast.unparse(n.func)=='load']
  self.assertFalse(any('7bf19'in x or '5b3aa'in x for x in loads));self.assertTrue(any('ba7e2570'in x for x in loads))
  self.assertNotIn('with sql_observation',m.REMOTE);self.assertNotIn("'profiledCallCount':",m.REMOTE)
  self.assertIn("'SQLParentPopenOrPipeWrapped':False",m.REMOTE);self.assertIn("'passiveOriginalRunObserverRetained':True",m.REMOTE)
  self.assertEqual(m.RESULT.name,'yunipals-cont5-held-rollback-qualification-production-20261026-7.json')
  compile(m.REMOTE,'REMOTE','exec');compile(P.read_text(),str(P),'exec')
 def test_actual_successful_reconciliation_header_and_unknown_or_failed_gates_before_SSH(self):
  self.assertIs(m.require_reconciliation_result(recon),recon)
  for key,value in [('completed',False),('wholeCatalogQualified',1),('transactionId','foreign'),('newHeldSuccessAuthority',True),('catalogProofSha256','0'*64)]:
   changed=copy.deepcopy(recon);changed[key]=value
   with self.assertRaises(RuntimeError):m.require_reconciliation_result(changed)
  changed=copy.deepcopy(recon);changed['proofHashes']['unknown']='1'*64
  with self.assertRaises(RuntimeError):m.require_reconciliation_result(changed)
  with patch('sys.argv',[str(P),'--run']),patch.object(m,'HELD7_SOURCE_REVIEWED',False),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')):
   with self.assertRaisesRegex(SystemExit,'source_review'):m.main()
 def test_plain_inspection_is_same_object_one_call_without_observers_or_clock_reset(self):
  marker=object();cache=types.SimpleNamespace(sql_child=Mock(return_value=marker));host=object();scope={'sys':sys,'need':need,'time':time,'phase_events':[]}
  execute(['phase','plain_inspection'],scope);self.assertIs(scope['plain_inspection'](cache,host),marker)
  cache.sql_child.assert_called_once_with(host,'inspect');self.assertEqual(len(scope['phase_events']),1)
  sentinel=lambda *_:None;sys.setprofile(sentinel)
  try:
   with self.assertRaisesRegex(RuntimeError,'untraced_unprofiled'):scope['plain_inspection'](cache,host)
  finally:sys.setprofile(None)
  self.assertEqual(cache.sql_child.call_count,1)
 def local_inputs(self):
  return {m.METADATA_REFS:m.EXPECTED_REFS,m.BASELINE_RESULT:base,m.RECON_RESULT:recon,
   m.HELD4_RESULT:json.loads((HERE/'ypal-cont5-held4-result-fixture.json').read_bytes()),
   m.HELD5_RESULT:json.loads((HERE/'ypal-cont5-held5-result-fixture.json').read_bytes()),
   m.KERNEL_RESULT:json.loads((HERE/'ypal-source6-kernel-diagnostic-result-fixture.json').read_bytes())}
 def test_missing_reconciliation_stops_real_main_before_any_SSH(self):
  inputs=self.local_inputs()
  def read(path):
   if path==m.RECON_RESULT:raise FileNotFoundError('actual_reconciliation_missing_fixture')
   return inputs[path]
  with patch('sys.argv',[str(P),'--run']),patch.object(m,'HELD7_SOURCE_REVIEWED',True),\
       patch.object(m,'read_private',side_effect=read),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')):
   with self.assertRaisesRegex(FileNotFoundError,'reconciliation_missing'):m.main()
 def test_actual_23cb_and_all_canonical_local_ancestry_render_exact_new_payload_without_execution(self):
  inputs=self.local_inputs();result=types.SimpleNamespace(returncode=0,stderr='',stdout=json.dumps({'format':'root-CONT5-held-rollback-qualification-v5','completed':False}))
  transport=Mock(return_value=result)
  with patch('sys.argv',[str(P),'--run']),patch.object(m,'HELD7_SOURCE_REVIEWED',True),\
       patch.object(m,'read_private',side_effect=lambda path:inputs[path]),patch.object(m.subprocess,'run',transport),\
       patch.object(m,'exclusive')as save,patch.object(m.os,'umask'),patch('builtins.print'):
   with self.assertRaises(SystemExit)as caught:m.main()
  self.assertEqual(caught.exception.code,1);self.assertEqual(transport.call_count,1)
  call=transport.call_args;self.assertEqual(call.args[0][-1],'python3 -I -B -')
  rendered=m.REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(base)).replace('ACTUAL_METADATA_REFS',repr(m.EXPECTED_REFS))\
   .replace('ACTUAL_HELD4_FAILURE',repr(inputs[m.HELD4_RESULT])).replace('ACTUAL_KERNEL_DIAGNOSTIC',repr(inputs[m.KERNEL_RESULT]))\
   .replace('ACTUAL_HELD5_FAILURE',repr(inputs[m.HELD5_RESULT])).replace('ACTUAL_HELD6_RECONCILIATION',repr(recon))
  self.assertEqual(call.kwargs['input'],rendered);self.assertEqual(save.call_count,1)
  self.assertEqual(save.call_args.args[0],m.RESULT);self.assertFalse(save.call_args.args[1]['completed'])
 def reconciliation_fixture(self,change=None):
  root=self.enterContext(tempfile.TemporaryDirectory(dir=HERE));folder=Path(root);cache=folder/'cache';capture=folder/'capture';cache.mkdir();capture.mkdir()
  oldroot=Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-6');rr=Path('/var/backups/yunipals-root-cont5-held6-reconcile-20261026-1');ba=folder/'baseline'
  remote_base={k:v for k,v in base.items()if k!='resultSha256'};remote_recon={k:v for k,v in recon.items()if k!='resultSha256'};remote_failed={k:v for k,v in failed.items()if k!='resultSha256'}
  catalog={'catalogSha256':'explicitPrivateCatalogIOFixture','postProof':{'catalog':{'allTablesAndACLsFixture':True},'reader':{'allReaderGraphFixture':True},'allColumnAcl':[]}}
  epoch={'actualRecordedCroppedEpochIOFixture':True};before={'catalog':catalog,'binding':{'prerequisites':{'metadataCurrentProof':{'metadataEpoch':epoch}}}}
  frames={};badframes={}
  for directory,names,rows in[(cache,['before.json','rehearsal-intent.json','rehearse-sql-child.json','rehearse-sql-opened.json','rehearsed.json','authorization.json'],frames),
   (capture,['intent.json','approval-before-launch.json','apply-sql-child.json','apply-sql-opened.json','failure.json'],badframes)]:
   for name in names:
    path=directory/name;path.write_bytes(encoded({'privateFileFixture':name}));row=path.stat();rows[name]={'sha256':sha(path.read_bytes()),'inode':row.st_ino,'bytes':row.st_size}
  terminal={'transactionId':'17009625','transactionStatus':'aborted','rootEpochGone':True,'childEpochGone':True,'backendEpochGone':True,'ownerAPPBackendCount':0,'matchingSQLentryProcessCount':0,'publicationReadBackendCount':0}
  whole={'failedHeld6RootResultSha256':failed['resultSha256'],'acceptedBaselineRootResultSha256':base['resultSha256'],'beforeSha256':base['beforeSha256'],
   'priorAborted':{'validated':True,'bindingSha256':base['priorAbortedSha256'],'binding':{'transactionId':'16540148','transactionStatus':'aborted','priorChildGone':True,'priorBackendGone':True}},
   'actualCatalog':copy.deepcopy(catalog),'wholeCatalogQualified':True,'allColumnACLQualified':True,'readerGraphQualified':True,'sharedSDKLockHeld':True,
   'newSQLMutationDispatched':False,'newPreparedACKCreated':False,'terminalBefore':copy.deepcopy(terminal),'terminalAfter':copy.deepcopy(terminal),'baselineFiles':frames,'failedCaptureFiles':badframes}
  oldhist={'explicitOriginalFullHistoryIOFixture':True};archive={'explicitOriginalArchiveIOFixture':True}
  proofs={'actual-failed-held6':remote_failed,'baseline-root-result':remote_base,'authenticated-baseline-metadata-histories':oldhist,
   'authenticated-baseline-proof-hashes':base['proofHashes'],'authenticated-baseline-archive':archive,'new-source-preflight':{'explicitFullSourcePreflightIOFixture':True},
   'new-full-current-prerequisites':{'metadataCurrentProof':{'currentNativeMetadataQualified':True,'metadataEpoch':epoch}},
   'whole-catalog-reconciliation':whole,'full-source-postflight':{'metadataActorCurrent':{'currentActorQualified':True},'metadataEpoch':epoch}}
  scope={'pathlib':types.SimpleNamespace(Path=lambda value:capture if str(value)=='/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-6'else Path(value)),
   'CACHE_BASE':cache,'BASELINE_AUDIT':ba,'baseline_local':base,'recon_local':recon,'refs':m.EXPECTED_REFS,
   'need':need,'sha':sha,'encoded':encoded,'CALLER_SHA':recon['callerSha256'],'MANIFEST_SHA':recon['readerManifestSha256']}
  fixed={'actual-failed-held6':'actual-failed-held6.private.json','baseline-root-result':'authenticated-baseline-root-result.private.json',
   **{k:k+'.private.json'for k in ['authenticated-baseline-metadata-histories','authenticated-baseline-proof-hashes','authenticated-baseline-archive','new-source-preflight',
    'new-full-current-prerequisites','whole-catalog-reconciliation','full-source-postflight']}}
  documents={str(rr/'result.json'):(recon['resultSha256'],remote_recon),str(ba/'result.json'):(base['resultSha256'],remote_base),
   str(oldroot/'result.json'):(failed['resultSha256'],remote_failed),str(cache/'before.json'):(base['beforeSha256'],before),
   str(ba/'metadata-capture-histories-success.private.json'):(base['metadataCaptureHistorySha256'],oldhist),str(ba/'archive-result.private.json'):(base['archiveResultSha256'],archive)}
  for key,name in fixed.items():documents[str(rr/name)]=(recon['proofHashes'][key],proofs[key])
  # This boundary represents the already protected actual private history; its
  # complete protocol/count checks are retained separately as exact old code.
  documents[str(rr/'metadata-capture-histories-success.private.json')]=(recon['metadataCaptureHistorySha256'],{'explicitActualFullHistoryIOFixture':True})
  reads=[]
  def document(path,digest):
   reads.append((str(path),digest));expected,value=documents[str(path)];self.assertEqual(expected,digest);return value
  scope['document']=document;scope['validate_history']=Mock();scope['protected']=Mock(return_value=b'explicitActualProtectedPrivateBytesIOFixture')
  def file_frame(path,digest):
   raw=path.read_bytes();need(sha(raw)==digest,'exact_private_file_fixture_hash_required');row=path.stat();return{'sha256':sha(raw),'inode':row.st_ino,'bytes':row.st_size}
  scope['file_frame']=file_frame;scope['re']=__import__('re');execute(['pin','same_local_remote','authenticate_held6_reconciliation'],scope)
  if change:change(scope,whole,proofs,cache,capture)
  return scope,whole,proofs,reads
 def test_actual_recon_header_full_nine_proof_map_and_original_private_graph(self):
  scope,whole,proofs,reads=self.reconciliation_fixture();result=scope['authenticate_held6_reconciliation']()
  self.assertEqual(result['resultSha256'],recon['resultSha256']);self.assertFalse(result['newHeldSuccessAuthority'])
  self.assertEqual(result['proofHashes'],recon['proofHashes']);self.assertEqual(scope['protected'].call_count,17)
  scope['validate_history'].assert_called_once();self.assertGreaterEqual(len(reads),16)
 def test_private_catalog_column_reader_terminal_inode_and_postflight_drift_refuse(self):
  changes=[lambda s,w,p,c,f:w['actualCatalog']['postProof']['allColumnAcl'].append({'foreignGrant':True}),
   lambda s,w,p,c,f:w['terminalAfter'].update(ownerAPPBackendCount=False),
   lambda s,w,p,c,f:(f/'intent.json').write_bytes(b'changed'),
   lambda s,w,p,c,f:p['full-source-postflight']['metadataActorCurrent'].update(currentActorQualified=False),
   lambda s,w,p,c,f:w['priorAborted'].update(bindingSha256='0'*64)]
  for change in changes:
   scope,whole,proofs,reads=self.reconciliation_fixture(change)
   with self.subTest(index=changes.index(change)),self.assertRaises(RuntimeError):scope['authenticate_held6_reconciliation']()
 def test_witness_failure_and_refusal_write_cannot_replace_actual_original_failure(self):
  top=next(n for n in r.body if isinstance(n,ast.Try));handler=copy.deepcopy(top.handlers[0]);error=RuntimeError('actual_original_fixed_error')
  saved={}
  def write(name,value):
   if name=='after-exception-witness-refusal.private.txt':raise OSError('explicitDiagnosticDiskRefusalFixture')
   saved[name]=value;return sha(value if isinstance(value,bytes)else encoded(value))
  scope={'original':error,'traceback':traceback,'witness_module':types.SimpleNamespace(Witness=Mock(side_effect=RuntimeError('witness_refusal_fixture'))),
   'session':types.SimpleNamespace(cache=types.SimpleNamespace(continuation_authority=object())),'capture_summary':{},'write':write,
   'save_observations':lambda:{'liveProfileInstalled':False},'kernel_traceback_evidence':lambda e:{'frames':[],'captureErrors':[]},
   'capture_histories':lambda outcome,error:{},'proof_hashes':{},'now':lambda:'fixture','stage':'qualify-held-rollback-only',
   'qualifier_started':True,'qualifier_returned':False,'qualification_ref':None,'re':__import__('re')}
  run=ast.Try(body=[ast.Raise(exc=ast.Name(id='original',ctx=ast.Load()),cause=None)],handlers=[handler],orelse=[],finalbody=[])
  exec(compile(ast.fix_missing_locations(ast.Module(body=[run],type_ignores=[])),str(P),'exec'),scope)
  self.assertTrue(scope['capture_summary']['afterExceptionWitnessRefusalSaveFailed']);self.assertEqual(scope['result']['failureCode'],str(error))
  self.assertIn(b'actual_original_fixed_error',saved['failure.private.txt']);self.assertNotIn(b'witness_refusal_fixture',saved['failure.private.txt'])
 def test_six_genuine_audit_chain_without_observer_metrics(self):
  gate={'actualFreshGateIOFixture':True};packet={'mode':'apply','xid':'actualFixtureXID'};text=json.dumps(packet,separators=(',',':'))
  rows={'intent.json':{'actualIdentityIOFixture':True},'approval-before-launch.json':gate,'apply-sql-child.json':{'mode':'apply'},
   'apply-sql-opened.json':{'message':{'mode':'apply','xid':packet['xid'],'backend':{'xid':packet['xid']}}},
   'actual-prepared-observation.json':{'neverProductionPreparedACK':True,'valueJson':text},
   'complete-held-callback.json':{'packetSha256':sha(text.encode()),'productionPreparedACKCreated':False}}
  hashes={name:sha(encoded(value))for name,value in rows.items()};rows['apply-sql-opened.json']['childFileSha256']=hashes['apply-sql-child.json'];hashes['apply-sql-opened.json']=sha(encoded(rows['apply-sql-opened.json']))
  qualified={'auditFiles':hashes,'approvalGate':gate,'transactionId':packet['xid'],'actualPreparedPacketSha256':sha(text.encode())}
  def document(path,digest):self.assertEqual(sha(encoded(rows[path.name])),digest);return rows[path.name]
  scope={'need':need,'sha':sha,'document':document,'CAPTURE':'fixture'};execute(['authenticate_qualified_audit_files'],scope)
  self.assertEqual(scope['authenticate_qualified_audit_files'](types.SimpleNamespace(BASE=Path('/fixture')),qualified),rows)
  qualified['actualPreparedPacketSha256']='0'*64
  with self.assertRaises(RuntimeError):scope['authenticate_qualified_audit_files'](types.SimpleNamespace(BASE=Path('/fixture')),qualified)

if __name__=='__main__':unittest.main()
