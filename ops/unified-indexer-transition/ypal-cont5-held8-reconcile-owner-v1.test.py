import ast,contextlib,copy,hashlib,importlib.util,json,os,pathlib,stat,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
P=HERE/'ypal-cont5-held8-reconcile-owner-v1.py';source=P.read_text();outer=ast.parse(source)
remote=next(n.value.value for n in outer.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets))
r=ast.parse(remote);functions={n.name:n for n in r.body if isinstance(n,ast.FunctionDef)}
detail=json.loads((HERE/'ypal-cont5-held8-failure-detail-fixture.json').read_bytes())
failed=detail['operationResult']
baseline=json.loads((HERE/'ypal-cont5-construct3-result-fixture.json').read_bytes())
refs=ast.literal_eval(next(n.value for n in outer.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='EXPECTED_REFS'for t in n.targets)))
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def need(value,code):
 if not value:raise RuntimeError(code)
def execute(names,scope):
 exec(compile(ast.fix_missing_locations(ast.Module(body=[functions[n]for n in names],type_ignores=[])),str(P),'exec'),scope);return scope
class Controls(unittest.TestCase):
 def test_default_and_explicit_review_gate_are_inert_before_transport(self):
  spec=importlib.util.spec_from_file_location('actual_recon7_guard',P);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  self.assertIs(module.RECONCILIATION_SOURCE_REVIEWED,True)
  normalized=P.read_text().replace('# Root and independent full/delta review and 15 controls passed.\n','').replace('RECONCILIATION_SOURCE_REVIEWED=True','RECONCILIATION_SOURCE_REVIEWED=False')
  self.assertEqual(sha(normalized.encode()),'e423458d11e5a48251ef6b877e0ad3f04969ddf2d41d88cf485666c839dca010')
  with patch.object(module.subprocess,'run',side_effect=AssertionError('no SSH'))as transport,patch('builtins.print'),patch('sys.argv',[str(P)]):
   module.main();transport.assert_not_called()
  with patch.object(module,'RECONCILIATION_SOURCE_REVIEWED',False),patch.object(module.subprocess,'run',side_effect=AssertionError('no SSH')),patch('sys.argv',[str(P),'--run']):
   with self.assertRaisesRegex(RuntimeError,'source_review_required'):module.main()

 def test_actual_both_local_canonical_envelopes_before_SSH(self):
  scope={'hashlib':hashlib,'encoded':encoded};n=next(n for n in outer.body if isinstance(n,ast.FunctionDef)and n.name=='actual_result')
  exec(compile(ast.Module(body=[n],type_ignores=[]),str(P),'exec'),scope)
  for value in [failed,baseline]:
   self.assertIs(scope['actual_result'](value,value['resultSha256']),value)
   for altered in [{**value,'completed':0},{**value,'remoteAuditInspectionRequired':True},{**value,'unknownAnnotation':False},{**value,'resultSha256':'0'*64}]:
    with self.assertRaises(RuntimeError):scope['actual_result'](altered,value['resultSha256'])
 def auth(self,change=None):
  # Actual public canonical failure/detail envelopes; unknown full private
  # command/proof contents remain explicit protected-I/O boundary fixtures.
  raw={k:v for k,v in failed.items()if k!='resultSha256'}
  frame={row['name']:{**row,'device':2049,'mode':stat.S_IFREG|0o600,'uid':0,'gid':0,'links':1}for row in detail['captureFiles']}
  phases=copy.deepcopy(detail['phaseObservation'])
  self.assertEqual(sha(encoded(phases)),failed['rootPhaseObservationSha256'])
  commands={'diagnosticSourceSha256':'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
   'subprocessRunRestored':True,'argumentsEnvironmentTimeoutAndOriginalResultsChanged':False,'automaticRetryAllowed':False,
   'calls':[{'explicitPrivateOriginalRunIOFixture':True}for _ in range(failed['currentSubprocessCommandCount'])],'failures':[]}
  witness={'format':'yunipals-ypal-cont5-held-after-exception-v2',
   **{k:True for k in ['actualQualifierFrameMatched','caughtInnerErrorObserved','authorityFacadeUsed',
    'actualCacheAuthorityObjectPreserved','composedQualifierGlobalsQualified']},
   'innerErrorClass':detail['actualInnerErrorClass'],'innerErrorMessage':detail['actualInnerErrorFixedCode'],
   **{k:False for k in ['originalV1WitnessPassed','timingQualificationClaimed','sourceOrMetadataQualified',
    'transactionOutcomeQualified','originalExceptionReplaced','retryPerformed']}}
  prior7={'explicitAuthenticatedFull3cbPrivateIOFixture':True,'newHeldSuccessAuthority':False}
  scheduling={'format':'root-CONT5-native-approval-renewal-wait-v1','completed':True,'schedulingOnly':True,
   'genuineNativeWorkerRenewalObserved':True,'sampleCount':2,'observations':[{'privateIOFixture':1},{'privateIOFixture':2}],
   **{k:False for k in ['actualHeldCallbackQualified','SQLApprovalAuthority','sourceOrMetadataCurrentQualified',
    'timingQualificationClaimed','approvalClockReset','queryOrPredicateRetried','effectsRetried']}}
  observed={'phases':phases,'commands':commands,'witness':witness,'scheduling':scheduling,'prior7':prior7}
  message={'format':'yunipals-ypal-cache-guard-sql-v1','event':'transaction-opened','mode':detail['actualOpened']['mode'],
   'xid':detail['actualOpened']['xid'],'backend':copy.deepcopy(detail['actualOpened']['backend'])}
  opened={'message':message,'childFileSha256':detail['actualOpened']['childFileSha256'],
   'sessions':[{'pid':message['backend']['pid'],'backendStart':message['backend']['backendStart']}]}
  child=copy.deepcopy(detail['actualChild'])
  receipt={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v5','completed':False,'rollbackOnly':True,
   'failureType':'RuntimeError','failureSha256':sha('complete_actual_held_callback_then_refused_COMMIT_ACK_required'.encode()),
   'transactionOutcomeQualified':False,'productionCOMMITQualified':False,'automaticRetryAllowed':False}
  self.assertEqual(sha(encoded(receipt)),frame['failure.json']['sha256'])
  oldlocal=json.loads((HERE/'ypal-cont5-held6-reconciliation-result-fixture.json').read_bytes())
  previous={k:v for k,v in oldlocal.items()if k!='resultSha256'}
  ancestry={'resultSha256':oldlocal['resultSha256'],'rootResult':previous,'proofHashes':previous['proofHashes'],
   'newHeldSuccessAuthority':False,'newTimingAuthority':False,'originalFailureRelabelled':False}
  digests={'result.json':failed['resultSha256'],'root-phase-observations.private.json':failed['rootPhaseObservationSha256'],
   'current-subprocess-diagnostic.private.json':failed['currentSubprocessDiagnosticSha256'],
   'authenticated-held6-reconciliation.private.json':failed['proofHashes']['authenticated-held6-reconciliation'],
   'authenticated-held7-reconciliation.private.json':failed['proofHashes']['authenticated-held7-reconciliation'],
   'approval-renewal-scheduling.private.json':failed['proofHashes']['approval-renewal-scheduling'],
   'after-exception-witness.private.json':failed['afterExceptionWitnessSha256'],
   **{name:row['sha256']for name,row in frame.items()}}
  def document(path,digest):
   name=Path(path).name
   if name=='result.json'and'held6-reconcile'in str(path):self.assertEqual(digest,oldlocal['resultSha256']);return previous
   self.assertEqual(digest,digests[name])
   return {'result.json':raw,'root-phase-observations.private.json':phases,'current-subprocess-diagnostic.private.json':commands,
    'authenticated-held6-reconciliation.private.json':ancestry,'apply-sql-child.json':child,'apply-sql-opened.json':opened,'failure.json':receipt,'after-exception-witness.private.json':witness,
    'authenticated-held7-reconciliation.private.json':prior7,'approval-renewal-scheduling.private.json':scheduling}[name]
  scope={'document':document,'protected':Mock(return_value=b'explicitProtectedPrivateIOFixture'),'need':need,'encoded':encoded,'sha':sha,
   'failed_capture_frame':lambda:frame,'failed_local':failed,'baseline_local':baseline,'pathlib':pathlib,
   'FAILED_ROOT':Path('/fixture/root'),'FAILED_CAPTURE':Path('/fixture/capture'),'FAILED_SHA':failed['resultSha256'],
   'authenticate_prior_held7':Mock(return_value=prior7),'CALLER_SHA':failed['callerSha256'],'MANIFEST_SHA':failed['readerManifestSha256'],'refs':refs}
  execute(['same_local_remote','authenticate_failed'],scope)
  if change:change(raw,observed,child,opened,scope)
  return scope['authenticate_failed']()
 def test_actual_held7_public_envelope_and_genuine_parent_opened_shape(self):
  result=self.auth();self.assertEqual(result[3]['message']['xid'],'17079057');self.assertEqual(len(result[1]),6)
 def test_failed_held7_inner_child_opened_shared_and_typed_mutations_refuse(self):
  changes=[lambda r,d,c,o,s:r.update(observedSQLTransportCount=1),lambda r,d,c,o,s:r.update(caughtInnerErrorObserved=False),
   lambda r,d,c,o,s:d['phases'].update(liveProfileInstalled=True),lambda r,d,c,o,s:d['commands'].update(argumentsEnvironmentTimeoutAndOriginalResultsChanged=True),
   lambda r,d,c,o,s:d['witness'].update(innerErrorMessage='other_error'),lambda r,d,c,o,s:d['witness'].update(transactionOutcomeQualified=True),
   lambda r,d,c,o,s:d['scheduling'].update(SQLApprovalAuthority=True),
   lambda r,d,c,o,s:s.update(authenticate_prior_held7=lambda:{'foreign':True}),
   lambda r,d,c,o,s:c['actor'].update(startTicks=1),lambda r,d,c,o,s:o.update(childFileSha256='0'*64),
   lambda r,d,c,o,s:o['sessions'][0].update(backendStart='1'),lambda r,d,c,o,s:o['message']['backend'].update(roleOid='16388'),
   lambda r,d,c,o,s:s.update(failed_local={**failed,'completed':0})]
  for change in changes:
   with self.subTest(index=changes.index(change)),self.assertRaises(RuntimeError):self.auth(change)
 def test_fixed_capture_hash_inode_size_inventory_uses_actual_server_rows(self):
  rows={row['name']:row for row in detail['captureFiles']}
  class Directory:
   def iterdir(self):return [Path(name)for name in rows]
   def __truediv__(self,name):return Path(name)
  def frame(path,digest):
   need(rows[path.name]['sha256']==digest,'actual protected-I/O digest refusal');return dict(rows[path.name])
  scope={'FAILED_CAPTURE':Directory(),'need':need,'file_frame':frame}
  execute(['failed_capture_frame'],scope);self.assertEqual(len(scope['failed_capture_frame']()),6)
  for field in ['sha256','inode','bytes']:
   saved=rows['intent.json'][field];rows['intent.json'][field]=('f'*64 if field=='sha256'else 1)
   with self.subTest(field=field),self.assertRaises(RuntimeError):scope['failed_capture_frame']()
   rows['intent.json'][field]=saved
 def terminal(self,change=None):
  calls=[];cache=types.SimpleNamespace(xact_status=lambda h,x:'aborted');authority=types.SimpleNamespace(OWNER_SESSIONS_SQL='ALL_DATABASE_APP_SQL')
  def query(sql):
   calls.append(sql);return []if sql==authority.OWNER_SESSIONS_SQL else 0
  host=types.SimpleNamespace(query=query);scope={'need':need,'process_epoch_gone':lambda pid,ticks:True,'sql_processes':lambda cache:[]}
  execute(['terminal'],scope)
  if change:change(scope,cache,host,authority)
  return scope['terminal'](cache,host,authority),calls
 def test_actual_fixed_terminal_queries_and_all_role_APP_not_role_filter(self):
  value,calls=self.terminal();self.assertEqual(value['transactionStatus'],'aborted');self.assertEqual(len(calls),3)
  self.assertIn("1792993127942108",calls[0]);self.assertIn('ALL_DATABASE_APP_SQL',calls);self.assertIn('ypal_full_publication_readonly',calls[-1])
 def test_terminal_running_unknown_or_permission_failures_are_not_retried(self):
  changes=[lambda s,c,h,a:s.update(process_epoch_gone=lambda *_:False),lambda s,c,h,a:setattr(c,'xact_status',lambda *_:'in progress'),
   lambda s,c,h,a:setattr(h,'query',lambda q:[{}]if q==a.OWNER_SESSIONS_SQL else 0),lambda s,c,h,a:s.update(sql_processes=lambda _:[{}]),
   lambda s,c,h,a:setattr(h,'query',lambda q:1 if '1729509'in q else []if q==a.OWNER_SESSIONS_SQL else 0),
   lambda s,c,h,a:setattr(h,'query',lambda q:1 if 'ypal_full_publication_readonly'in q else []if q==a.OWNER_SESSIONS_SQL else 0)]
  for change in changes:
   with self.subTest(index=changes.index(change)),self.assertRaises(RuntimeError):self.terminal(change)
  def permission(s,c,h,a):s['process_epoch_gone']=lambda *_:(_ for _ in()).throw(PermissionError('actual proc access refused'))
  with self.assertRaises(PermissionError):self.terminal(permission)
 def catalog(self,change=None):
  events=[];held=False;saved={};frames={'baseline':1};failed_frames={'failed':1}
  current={'catalogSha256':'exact','postProof':{'catalog':{'allTablesAndPrivileges':[]},'reader':{'allReaderGraph':[]},'allColumnAcl':[]}}
  before={'catalog':copy.deepcopy(current)};prior={'validated':True,'bindingSha256':'prior','binding':{'transactionId':'16540148','transactionStatus':'aborted','priorChildGone':True,'priorBackendGone':True}}
  @contextlib.contextmanager
  def lock():
   nonlocal held
   self.assertFalse(held);held=True;events.append('enter')
   try:yield
   finally:held=False;events.append('exit')
  host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=lock)}))
  cache=types.SimpleNamespace(prior_cache=object());authority=types.SimpleNamespace()
  def original(actual_cache,actual_host):self.assertTrue(held);self.assertIs(actual_host,host);events.append('catalog');return prior,current
  authority.original_catalog=original
  def terminal(*args):self.assertTrue(held);events.append('terminal');return {'exactTerminal':True}
  scope={'host':host,'cache':cache,'authority':authority,'need':need,'encoded':encoded,'terminal':terminal,'baseline':{'priorAbortedSha256':'prior','beforeSha256':'before'},
   'before':before,'fixed_cache_frame':lambda cache:copy.deepcopy(frames),'failed_capture_frame':lambda:copy.deepcopy(failed_frames),
   'cache_frame':copy.deepcopy(frames),'failed_frame':copy.deepcopy(failed_frames),'proof_hashes':{},'FAILED_SHA':failed['resultSha256'],
   'baseline_local':baseline,'write':lambda name,value:saved.setdefault(name,value)and 'written'}
  if change:change(scope,current,prior,frames)
  top=next(n for n in r.body if isinstance(n,ast.Try));body=top.body
  start=next(i for i,n in enumerate(body)if isinstance(n,ast.Assign)and isinstance(n.value,ast.Constant)and n.value.value=='whole-catalog-reconciliation')
  end=next(i for i,n in enumerate(body)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='catalog_qualified'for t in n.targets))
  try:exec(compile(ast.Module(body=body[start:end+1],type_ignores=[]),str(P),'exec'),scope)
  finally:self.assertFalse(held)
  return scope,events,saved
 def test_whole_catalog_reader_columns_full_stats_and_lock_before_postflight(self):
  scope,events,saved=self.catalog();self.assertTrue(scope['catalog_qualified']);self.assertEqual(events,['enter','terminal','catalog','terminal','exit'])
  self.assertTrue(saved['whole-catalog-reconciliation.private.json']['readerGraphQualified'])
 def test_catalog_columns_reader_old_ancestry_and_inode_changes_refuse(self):
  changes=[lambda s,c,p,f:c.update(catalogSha256='different'),lambda s,c,p,f:c['postProof']['catalog'].update(extraGrant=True),
   lambda s,c,p,f:c['postProof'].update(allColumnAcl=[{'extra':True}]),lambda s,c,p,f:c['postProof']['reader'].update(extraLogin=True),
   lambda s,c,p,f:p.update(bindingSha256='different'),lambda s,c,p,f:f.update(mutatedInode=True)]
  for change in changes:
   with self.subTest(index=changes.index(change)),self.assertRaises(RuntimeError):self.catalog(change)
 def test_baseline_auth_is_byte_identical_to_previously_executed_held7_gate(self):
  old=(HERE/'ypal-cont5-held-qualification-owner-v4.py').read_text();tree=ast.parse(old)
  original=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets))
  a=" stage='authenticate-completed-construct-only3-baseline'";b=" stage='authenticate-live-programs'"
  self.assertEqual(remote[remote.index(a):remote.index(b)],original[original.index(a):original.index(b)])
 def test_no_qualifier_baseline_effect_observer_or_retry_dispatch_and_bounded_syntax(self):
  compile(source,str(P),'exec');compile(remote,'REMOTE','exec')
  called=[ast.unparse(n.func)for n in ast.walk(r)if isinstance(n,ast.Call)]
  for forbidden in ['caller.qualify_held','caller.construct_records','caller.execute_cache','caller.execute_reader','subprocess.Popen','sys.settrace','sys.setprofile']:
   self.assertNotIn(forbidden,called)
  self.assertEqual(called.count('session.preflight'),1);self.assertEqual(called.count('session.finish'),1);self.assertEqual(called.count('host.prerequisites'),1)
  self.assertIn('signal.alarm(880)',remote);self.assertIn('remaining=900-',source)

 def test_new_capture_paths_and_result_labels_use_actual_HELD8_without_relabelling_prior_7(self):
  constants={t.id:ast.literal_eval(n.value.args[0]) for n in r.body if isinstance(n,ast.Assign)and isinstance(n.value,ast.Call)and ast.unparse(n.value.func)=='pathlib.Path'for t in n.targets if isinstance(t,ast.Name)and t.id in ['FAILED_ROOT','FAILED_CAPTURE','AUDIT']}
  self.assertEqual(constants['FAILED_ROOT'],'/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-8')
  self.assertEqual(constants['FAILED_CAPTURE'],'/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-8')
  self.assertEqual(constants['AUDIT'],'/var/backups/yunipals-root-cont5-held8-reconcile-20261026-1')
  self.assertEqual(remote.count("'failedHeld8RootResultSha256':FAILED_SHA"),3)
  self.assertNotIn("'failedHeld7RootResultSha256':FAILED_SHA",remote)
  self.assertIn("root=pathlib.Path('/var/backups/yunipals-root-cont5-held7-reconcile-20261026-1')",remote)
 def test_original_3598_baseline_and_complete_catalog_body_retained_with_declared_identity_only(self):
  oldpath=HERE/'ypal-cont5-held7-reconcile-owner-v1.py'
  oldtree=ast.parse(oldpath.read_text());oldremote=next(n.value.value for n in oldtree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets))
  names=['protected','validate_history','fixed_cache_frame','archive_frame','capture_histories','same_local_remote']
  oldfn={n.name:n for n in ast.parse(oldremote).body if isinstance(n,ast.FunctionDef)}
  for name in names:self.assertEqual(ast.dump(oldfn[name],include_attributes=False),ast.dump(functions[name],include_attributes=False))
  a=" stage='authenticate-completed-construct-only3-baseline'";b=" stage='authenticate-live-programs'"
  self.assertEqual(remote[remote.index(a):remote.index(b)],oldremote[oldremote.index(a):oldremote.index(b)])
  cfb=(HERE/'ypal-cont5-held-qualification-owner-v6.py').read_text();tree=ast.parse(cfb)
  body=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets))
  original={n.name:n for n in ast.parse(body).body if isinstance(n,ast.FunctionDef)}
  for name in ['failed7_capture_frame','authenticate_failed7_ancestry','authenticate_held7_reconciliation']:
   self.assertEqual(ast.dump(original[name],include_attributes=False),ast.dump(functions[name],include_attributes=False))
 def prepared(self,change=None):
  # Actual private 2.28MB packet is not exported. Protected IO/its literal known
  # hash are explicit fixtures; original JS encoding and all structural/plan
  # and complete comparator calls execute on a small publication-shaped value.
  compact=lambda v:json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()
  plan={'explicitActualRehearsalIOFixture':True};plan_json=compact(plan).decode()
  value={'format':'yunipals-ypal-cache-guard-sql-v1','event':'commit-prepared','mode':'apply','xid':'17079057',
   'before':{'revision':1},'beforeJson':'{"revision":1}','after':{'revision':2},'afterJson':'{"revision":2}',
   'planSha256':sha(plan_json.encode()),'postProof':{'catalog':{'fullActualCatalogIOFixture':True}}}
  row=json.loads(encoded({'neverProductionPreparedACK':True,'value':value,'valueJson':compact(value).decode()}));original=compact(value)
  self.assertNotEqual(compact(row['value']).decode(),row['valueJson'])
  expected='6b1c44228a1462170eca1899765c035c5e3a394c1d042266152c1b7c9aed6f30'
  digest=lambda raw:expected if raw==original else sha(raw)
  comparator=Mock();cache=types.SimpleNamespace(js_encoded=compact,read_extension=comparator)
  before={'catalog':{'postProof':{'catalog':{'fullBeforeCatalogIOFixture':True}}}}
  rehearsed={'sql':{'result':plan,'resultJson':plan_json}}
  opened={'message':{'xid':'17079057'}}
  def document(path,digest):
   self.assertEqual(Path(path).name,'actual-prepared-observation.json')
   self.assertEqual(digest,detail['captureFiles'][0]['sha256']);return row
  scope={'document':document,'FAILED_CAPTURE':Path('/fixture/capture'),'need':need,'encoded':encoded,'json':json,'sha':digest}
  execute(['authenticate_prepared_observation'],scope)
  if change:change(row,cache,rehearsed,opened)
  result=scope['authenticate_prepared_observation'](cache,before,rehearsed,opened)
  comparator.assert_called_once_with(before['catalog']['postProof']['catalog'],value['postProof']['catalog'],plan,value['postProof']['catalog'])
  return result
 def test_failed_prepared_observation_is_strict_plan_bound_and_never_ACK(self):
  result=self.prepared();self.assertTrue(result['actualPreparedObservationAuthenticated']);self.assertTrue(result['neverProductionPreparedACK'])
  for field in ['completeHeldCallbackQualified','productionCOMMITQualified','productionPreparedACKCreated','newCommitAuthority','newHeldSuccessAuthority']:self.assertIs(result[field],False)
  changes=[lambda row,c,r,o:row.update(neverProductionPreparedACK=False),lambda row,c,r,o:row.update(valueJson='{}'),
   lambda row,c,r,o:row['value'].update(xid='17049626'),lambda row,c,r,o:row.update(unknownAnnotation=True),
   lambda row,c,r,o:r['sql'].update(resultJson='{}'),lambda row,c,r,o:o['message'].update(xid='17049626'),
   lambda row,c,r,o:setattr(c,'read_extension',Mock(side_effect=RuntimeError('full_catalog_comparator_refused')))]
  for change in changes:
   with self.subTest(index=changes.index(change)),self.assertRaises(RuntimeError):self.prepared(change)
 def test_genuine_full_prior_3cb_function_against_actual_header_graph_fixture(self):
  spec=importlib.util.spec_from_file_location('held8_previous_graph_fixture',HERE/'ypal-cont5-held-qualification-owner-v6.test.py')
  family=importlib.util.module_from_spec(spec);spec.loader.exec_module(family)
  actual=family.Controls();self.addCleanup(actual.doCleanups);scope,whole,proofs,reads=actual.reconciliation7_fixture()
  execute(['authenticate_held7_reconciliation'],scope)
  result=scope['authenticate_held7_reconciliation']();self.assertEqual(result['resultSha256'],'3cb418c0811d8fb8a03aef8b79b0e2c06fba01c6f74405e0c79044e049d438b8')
  scope['authenticate_failed7_ancestry'].assert_called_once()
  whole['terminalAfter']['transactionId']='17079057'
  with self.assertRaises(RuntimeError):scope['authenticate_held7_reconciliation']()

if __name__=='__main__':unittest.main()
