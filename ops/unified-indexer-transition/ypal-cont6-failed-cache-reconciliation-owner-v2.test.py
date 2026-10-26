"""Closed reconciliation source controls; protected records/SQL/Host I/O explicit."""
import ast,contextlib,copy,hashlib,importlib.util,io,json,pathlib,sys,tempfile,types,unittest
from unittest.mock import Mock,patch
OPS=pathlib.Path(__file__).resolve().parent
PATH=OPS/'ypal-cont6-failed-cache-reconciliation-owner-v2.py'
PRIOR_FIXTURE=OPS/'ypal-cont6-failed-cache-reconciliation-owner-v2-prior-failure.fixture.json'
DOCS=OPS.parent.parent/'docs/unified-indexer'
BASELINE_FIXTURE=DOCS/'cont6-baseline4-production-2026-10-26.json'
FAILED_FIXTURE=DOCS/'cont6-cache-commit-failure-production-2026-10-26.json'
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(PATH);old=load(OPS/'ypal-cont6-cache-commit-owner-v1.py');cache_source=load(OPS/'ypal-cache-guard-owner-v1.py')
def root_fixture(path):
 value=json.loads(path.read_bytes())
 # Public Root documentary copies carry these three human notes outside
 # the immutable result; the runtime still accepts no extra annotations.
 for key in ['observedAt','sourceCommit','diagnosis']:value.pop(key)
 return value
def remote():
 ns={'__name__':'source_fixture','__ACTUAL_BASELINE_ROOT__':{},'__ACTUAL_FAILED_ROOT__':{},'__ACTUAL_PRIOR_RECONCILIATION_ROOT__':{},'__ROOT_SOURCE_SHA__':'a'*64,
  '__BASELINE_AUTHENTICATION_TEMPLATE_SHA__':m.BASELINE_AUTHENTICATION_TEMPLATE_SHA}
 with patch('os.umask'):exec(compile(m.REMOTE,str(PATH)+':remote','exec'),ns)
 return ns
def fn(raw,name):return next(n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef)and n.name==name)
def clone(function,changes):return types.FunctionType(function.__code__,{**function.__globals__,**changes},function.__name__,function.__defaults__,function.__closure__)

class Controls(unittest.TestCase):
 def test_01_actual_e30_ed7_canonical_shapes_and_no_annotations(self):
  for path,digest,completed in [(BASELINE_FIXTURE,m.BASELINE_SHA,True),(FAILED_FIXTURE,m.FAILED_SHA,False)]:
   value=root_fixture(path);root=m.canonical(value,digest,completed)
   self.assertEqual(hashlib.sha256(m.encoded(root)).hexdigest(),digest)
   for changed in [{**value,'extra':'unowned'},{**value,'completed':not completed},{**value,'resultSha256':'f'*64}]:
    with self.assertRaises(RuntimeError):m.canonical(changed,digest,completed)
  ns=remote();self.assertEqual(ns['encoded']({}),m.encoded({}));self.assertEqual(ns['encoded']({})[-1],10)
  observation=json.loads((OPS/'ypal-cont6-failed-cache-reconciliation-owner-v1-sql-files-fixture.json').read_bytes())
  self.assertEqual(ns['FAILED_FILES'],observation['files'])

 def test_02_baseline_authentication_whole_body_has_only_one_directory_operand_delta(self):
  original=fn(old.REMOTE,'authenticate_baseline');current=fn(m.REMOTE,'authenticate_baseline');changed=0
  for node in ast.walk(original):
   if isinstance(node,ast.Compare)and ast.unparse(node)=="set((path.name for path in CACHE_BASE.iterdir())) == {pathlib.Path(name).name for name in cache}":
    node.comparators[0]=ast.BinOp(left=node.comparators[0],op=ast.BitOr(),right=ast.Name(id='FAILED_NAMES',ctx=ast.Load()));changed+=1
  self.assertEqual(changed,1);self.assertEqual(ast.dump(original,include_attributes=False),ast.dump(current,include_attributes=False))
  for name in ['read','frame','physical','load','save','sync','encoded','save_command']:
   self.assertEqual(ast.dump(fn(old.REMOTE,name),include_attributes=False),ast.dump(fn(m.REMOTE,name),include_attributes=False),name)
  self.assertEqual(hashlib.sha256((OPS/'ypal-cont6-cache-commit-owner-v1.py').read_bytes()).hexdigest(),m.BASELINE_AUTHENTICATION_TEMPLATE_SHA)

 def failure_fixture(self):
  ns=remote();enc=ns['encoded'];sha=ns['sha'];files={};frames={}
  def put(path,value):
   raw=enc(value);files[pathlib.Path(path)]=raw;return sha(raw)
  constructor={'operatorSha256':ns['BINDING_SHA'],'manifestSha256':ns['BINDING_MANIFEST_SHA'],'nativePolicyRefs':ns['POLICY'],
   'metadataRefs':ns['META'],'authorityInputSha256':ns['AUTH_SHA']}
  generation={'operatorSha256':ns['GENERATION_SHA'],'manifestSha256':ns['GENERATION_MANIFEST_SHA'],'nativePolicyRefs':ns['POLICY'],
   'authorityInputSha256':ns['AUTH_SHA'],'constructorBindingSha256':sha(enc(constructor))}
  accepted={'rootSha256':ns['BASELINE_SHA'],'constructor':constructor,'generation':generation,'identity':{'explicitOwnedCaptureIdentityIO':True},
   'baseline':{'beforeSha256':'b'*64,'rehearsedSha256':'c'*64,'authorizationSha256':'d'*64},'frames':{}}
  direct={'operatorSha256':ns['DIRECT_SHA'],'manifestSha256':ns['DIRECT_MANIFEST_SHA'],'nativePolicyRefs':ns['POLICY'],
   'authorityInputSha256':ns['AUTH_SHA'],'heldTestWaived':True,'heldQualificationPerformed':False,'measuredTimingUsed':False,'oldHeldSuccessClaimed':False,
   'constructorBindingSha256':sha(enc(constructor)),'generationBindingSha256':sha(enc(generation))}
  rows={name:{'explicitProtectedRecordIO':True}for name in['preflight.json','sdk-lock-source.json','failure-traceback.json','subprocess-command-summaries.json','approval-renewal-scheduling.json']}
  rows.update({'authenticated-baseline4.json':accepted,'constructor-binding.json':constructor,'generation-binding.json':generation,
   'direct-commit-binding.json':direct,'intent.json':{'format':'yunipals-root-cont6-cache-commit-v1','captureId':ns['ATTEMPT'],'baselineRootSha256':ns['BASELINE_SHA'],
    'automaticRetryAllowed':False,'userHeldTestWaived':True,'cacheCommitRequested':True,'readerLOGINRequested':False}})
  actual=root_fixture(FAILED_FIXTURE);actual.pop('resultSha256');actual['privateHashes']={name:put(ns['FAILED_AUDIT']/name,value)for name,value in rows.items()}
  ns['FAILED_ROOT']=actual;ns['FAILED_SHA']=put(ns['FAILED_AUDIT']/'result.json',actual)
  attempt_dir=ns['CALLER_BASE']/'attempts'/ns['ATTEMPT'];context={'directCommitBinding':direct}
  put(attempt_dir/'intent.json',{'operatorSha256':ns['CALLER_SHA'],'action':'commit','context':context,'automaticEffectRetryAllowed':False})
  put(attempt_dir/'result.json',{'action':'commit','context':context,'automaticEffectRetryAllowed':False,'completed':False,'businessResultPresent':False,
   'fixedCode':actual['fixedCode'],'originalOwnerJournalsAreEffectAuthority':True})
  failed={name:{'explicitFailedSQLFileIO':name}for name in ns['FAILED_FILES']}
  ns['FAILED_FILES']={name:put(ns['CACHE_BASE']/name,value)for name,value in failed.items()}
  def read(path,digest=None):
   raw=files[pathlib.Path(path)]
   if digest is not None and sha(raw)!=digest:raise RuntimeError('actual protected document hash mismatch')
   return raw
  def frame(path):
   raw=read(path);return{'sha256':sha(raw),**dict.fromkeys(ns['FRAME'],1)}
  ns.update(read=read,frame=frame)
  return ns,accepted,files,rows,attempt_dir,failed

 def test_03_failure_authenticates_all_ten_private_nodes_four_files_and_no_ACK(self):
  ns,accepted,files,rows,attempt_dir,failed=self.failure_fixture()
  with patch.object(pathlib.Path,'iterdir',lambda path:iter(attempt_dir/name for name in ['intent.json','result.json'])):
   self.assertEqual(ns['authenticate_failure'](accepted),failed)
   for path in [ns['FAILED_AUDIT']/'direct-commit-binding.json',ns['CACHE_BASE']/'apply-sql-opened.json']:
    raw=files[path];files[path]=raw+b' '
    try:
     with self.assertRaises(RuntimeError):ns['authenticate_failure'](accepted)
    finally:files[path]=raw
   value=json.loads(files[attempt_dir/'result.json']);value['completed']=True;files[attempt_dir/'result.json']=ns['encoded'](value)
   with self.assertRaisesRegex(RuntimeError,'original_caller_failed'):ns['authenticate_failure'](accepted)
  self.assertGreaterEqual(len(ns['tracked']),17)

 def prepared_fixture(self):
  ns=remote();enc=ns['encoded'];sha=ns['sha'];collections=['ethereum','base','polygon','bnb']
  state={'guards':[],'epochs':[{'collection':name,'revision':'5'}for name in collections],'tables':[],'acl':[],'columnAcl':[],'functions':[],'triggers':[]}
  after=copy.deepcopy(state);after['functions']=[{'name':'actual-new-guard-IO'}];after['triggers']=[{'name':'actual-new-trigger-IO'}]
  for row in after['epochs']:row['revision']='6'
  before={'reviewHash':'a'*64,'catalog':{'catalogSha256':sha(cache_source.js_encoded(ns['catalog'](state))),
   'postProof':{'catalog':{'explicitFullREADGraphIO':'before'},'allColumnAcl':{'all':[]},'reader':{'explicitReaderRolesIO':True}},'state':state},
   'binding':{'prerequisites':{'explicitFullMetadataPrerequisitesIO':True}}}
  rehearsal={'sql':{'resultJson':'{"exactOriginalFourReadPlanIO":true}','result':{'exactOriginalFourReadPlanIO':True}}}
  cache=types.SimpleNamespace(FORMAT='yunipals-ypal-ordinary-read-cache-continue-v6',ENTRY_SHA='b'*64,COMPONENT_SHA='c'*64,boot=lambda:'actual-boot-I-O',
   js_encoded=cache_source.js_encoded,read_extension=Mock())
  accepted={'baseline':{'rehearsedSha256':'d'*64,'authorizationSha256':'e'*64}}
  child={'bootId':cache.boot(),'mode':'apply','entrySha256':cache.ENTRY_SHA,'componentSha256':cache.COMPONENT_SHA,'processGroup':1234,'actor':{'pid':1234,'startTicks':1}}
  backend={'pid':2222,'backendStart':'1793036508000000','roleOid':'10','databaseOid':'17584','xid':ns['FAILED_XID'],'clientAddress':None,'clientPort':-1}
  opened={'childFileSha256':ns['FAILED_FILES']['apply-sql-child.json'],'message':{'format':'yunipals-ypal-cache-guard-sql-v1','event':'transaction-opened','mode':'apply','xid':ns['FAILED_XID'],'backend':backend},'sessions':[{'pid':backend['pid'],'backendStart':backend['backendStart']}]}
  intent={'format':cache.FORMAT,'bootId':cache.boot(),'reviewHash':before['reviewHash'],'rehearsalSha256':accepted['baseline']['rehearsedSha256'],'authorizationSha256':accepted['baseline']['authorizationSha256']}
  packet={'format':opened['message']['format'],'event':'commit-prepared','mode':'apply','xid':ns['FAILED_XID'],'planSha256':sha(rehearsal['sql']['resultJson'].encode()),
   'before':copy.deepcopy(state),'beforeJson':cache_source.js_encoded(state).decode(),'after':copy.deepcopy(after),'afterJson':cache_source.js_encoded(after).decode(),
   'afterCatalogSha256':sha(cache_source.js_encoded(ns['catalog'](after))),'postProof':{'allColumnAcl':{'all':[]},'catalog':{'explicitFullREADGraphIO':'prepared'}}}
  # Genuine sorted Python save/reparse shape, with original JS order retained
  # separately by beforeJson/afterJson. It is an observation, never an ACK.
  packet=json.loads(enc(packet));failed={'sql-intent.json':intent,'sql-prepared.json':packet,'apply-sql-child.json':child,'apply-sql-opened.json':opened}
  return ns,cache,accepted,failed,before,rehearsal,backend

 def test_04_nested_backend_and_sorted_saved_prepared_observation_real_JS_hashes(self):
  ns,cache,accepted,failed,before,rehearsal,backend=self.prepared_fixture()
  self.assertEqual(ns['prepared_observation'](cache,object(),accepted,failed,before,rehearsal),backend)
  cache.read_extension.assert_called_once_with(before['catalog']['postProof']['catalog'],failed['sql-prepared.json']['postProof']['catalog'],rehearsal['sql']['result'],failed['sql-prepared.json']['postProof']['catalog'])
  for field,value in [('planSha256','f'*64),('mode','rehearse'),('afterCatalogSha256','f'*64)]:
   old=failed['sql-prepared.json'][field];failed['sql-prepared.json'][field]=value
   with self.assertRaises(RuntimeError):ns['prepared_observation'](cache,object(),accepted,failed,before,rehearsal)
   failed['sql-prepared.json'][field]=old
  failed['apply-sql-opened.json']['backend']=failed['apply-sql-opened.json']['message'].pop('backend')
  with self.assertRaises((RuntimeError,KeyError)):ns['prepared_observation'](cache,object(),accepted,failed,before,rehearsal)

 def test_05_genuine_original_child_gone_xact_status_backend_zero_and_refusals(self):
  ns,cache,_,failed,_,_,backend=self.prepared_fixture();child=failed['apply-sql-child.json']
  folder=self.enterContext(tempfile.TemporaryDirectory());base=pathlib.Path(folder);(base/'apply-sql-child.json').write_bytes(ns['encoded'](child))
  state={'status':'aborted','app':0,'backend':0,'alive':False}
  def query(sql):
   if 'pg_xact_status'in sql:return state['status']
   return state['app']if'application_name'in sql else state['backend']
  host=types.SimpleNamespace(m=types.SimpleNamespace(process=lambda _:child['actor']if state['alive']else None),query=query)
  cache.child_gone=clone(cache_source.child_gone,{'BASE':base,'document':lambda _:copy.deepcopy(child),'boot':cache.boot})
  cache.xact_status=cache_source.xact_status
  self.assertEqual(ns['terminal'](cache,host,backend)['transactionStatus'],'aborted')
  for key,value in [('status','committed'),('app',1),('backend',1),('backend',False),('alive',True)]:
   old=state[key];state[key]=value
   with self.assertRaises(RuntimeError):ns['terminal'](cache,host,backend)
   state[key]=old

 def run_fixture(self):
  ns,cache,accepted,failed,before,rehearsal,backend=self.prepared_fixture();events=[];writes={}
  accepted.update(frames={},constructor={'explicitConstructorIO':True},generation={'explicitGenerationIO':True},identity={'explicitIdentityIO':True},rootSha256=ns['BASELINE_SHA'])
  accepted['baseline'].update(beforeSha256='1'*64)
  ns['BASELINE_ROOT']={'proofHashes':dict.fromkeys(['oldFilesBefore','ownedInputReuse','failedFilesBefore','preflight','constructorBinding','generationBinding','baseline','failedFilesAfter','oldFilesAfter'],'2'*64),
   'metadataCaptureHistory':{'sha256':'3'*64},'commandCapture':{'sha256':'4'*64},'baselineCaptureId':'explicit-capture','baselineSha256':'5'*64}
  @contextlib.contextmanager
  def lease():
   events.append('lock-enter')
   try:yield
   finally:events.append('lock-exit')
  sdk=types.SimpleNamespace(LOCK=pathlib.Path('/run/lock/yunipals-ypal-combined-transition.lock'),lock=lease)
  current=copy.deepcopy(before['catalog']);current['state']=copy.deepcopy(current['state'])
  def original_catalog(actual,host):self.assertIs(actual,cache.prior_cache);events.append('genuine-original-catalog-I-O');return {'explicitPriorStopIO':True},copy.deepcopy(current)
  authority=types.SimpleNamespace(new_identity=lambda c,h:copy.deepcopy(accepted['identity']),original_catalog=original_catalog)
  cache.continuation_authority=authority;cache.prior_cache=object();cache.epoch_progress=lambda a,b:{'explicitGenuineMonotonicEpochIO':True}
  cache.child_gone=lambda h,n:events.append('child-gone');cache.xact_status=lambda *_:'aborted'
  host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':sdk}),query=lambda _:0,refresh=lambda:events.append('refresh'),
   prerequisites=lambda:copy.deepcopy(before['binding']['prerequisites']),read=types.SimpleNamespace(acl_catalog=lambda value:value))
  def finish():self.assertEqual(events[-1],'lock-exit');events.append('Source-finish');return {'validated':True}
  session=types.SimpleNamespace(cache=cache,host=host,preflight=lambda:events.append('full-preflight')or{'validated':True},cache_context=lambda s:events.append('cache-context'),finish=finish)
  def source(path,digest):
   if path==ns['CALLER']:return types.SimpleNamespace(Session=lambda *_:events.append('fresh-session')or session)
   if path==ns['BINDING_HELPER']:return types.SimpleNamespace(bind=lambda s:events.append('constructor-bind')or copy.deepcopy(accepted['constructor']))
   if path==ns['GENERATION_HELPER']:return types.SimpleNamespace(bind=lambda s:events.append('generation-bind')or copy.deepcopy(accepted['generation']))
   raise AssertionError(path)
  def document(path,digest=None):
   if path==ns['REPORT']:return {'sourceRefs':{'explicitSourceRefsIO':True}}
   if path==ns['CACHE_BASE']/'before.json':return before
   if path==ns['CACHE_BASE']/'rehearsed.json':return rehearsal
   return {'explicitProtectedBaselineProofIO':str(path)}
  def remember(path,digest=None):ns['tracked'][str(path)]={'explicitFrameIO':True};return document(path,digest)
  def physical(value):events.append('physical-bookend');return value
  def save(name,value):writes[name]=copy.deepcopy(value);return ns['sha'](ns['encoded'](value))
  ns.update(authenticate_baseline=lambda:accepted,authenticate_failure=lambda a:failed,authenticate_prior_reconciliation=lambda:{'explicitCompletePriorFailureIO':True},start_commands=lambda:events.append('passive-start'),load=source,document=document,remember=remember,physical=physical,save=save)
  return ns,cache,host,current,events,writes

 def test_06_full_run_one_original_catalog_prerequisites_Source_finish_and_drift_refusals(self):
  ns,cache,host,current,events,writes=self.run_fixture()
  names={'before.json','rehearsed.json','authorization.json','rehearsal-intent.json','rehearse-sql-child.json','rehearse-sql-opened.json',*ns['FAILED_NAMES']}
  with patch.object(pathlib.Path,'iterdir',lambda path:iter(path/name for name in names)):
   value=ns['run']()
  self.assertTrue(value['completed']);self.assertTrue(value['fullSourcePostflightPassed']);self.assertFalse(value['productionPreparedACKCreated'])
  self.assertFalse(value['completeCallbackQualified']);self.assertFalse(value['archiveDispatched']);self.assertFalse(value['rollbackTestDispatched'])
  self.assertEqual(events.count('genuine-original-catalog-I-O'),1);self.assertEqual(events.count('Source-finish'),1)
  self.assertLess(events.index('full-preflight'),events.index('constructor-bind'));self.assertLess(events.index('cache-context'),events.index('generation-bind'))
  for field in ['catalogSha256','reader','allColumnAcl']:
   ns,cache,host,current,events,writes=self.run_fixture()
   if field=='catalogSha256':current[field]='f'*64
   else:current['postProof'][field]={'foreign':'drift'}
   with patch.object(pathlib.Path,'iterdir',lambda path:iter(path/name for name in names)):
    with self.assertRaisesRegex(RuntimeError,'ALL_column_ACLs'):ns['run']()
   self.assertNotIn('Source-finish',events);self.assertEqual(events[-1],'lock-exit')

 def test_07_no_replay_archive_SQL_effects_or_trace_profile_hooks_and_closed_transport(self):
  run=fn(m.REMOTE,'run');calls=[ast.unparse(n.func)for n in ast.walk(run)if isinstance(n,ast.Call)]
  self.assertEqual(calls.count('authority.original_catalog'),1);self.assertEqual(calls.count('session.finish'),1)
  self.assertFalse(any(any(word in name for word in ['commit','archive','execute_','qualify','construct_records','settrace','setprofile'])for name in calls))
  with patch.object(m,'RECONCILIATION_SOURCE_REVIEWED',False),patch.object(sys,'argv',[str(PATH),'--run']),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')):
   with self.assertRaisesRegex(RuntimeError,'independent_source_review'):m.main()
  tree=ast.parse(m.REMOTE);self.assertFalse(any(isinstance(n,ast.Call)and ast.unparse(n.func)in {'sys.settrace','sys.setprofile','subprocess.Popen'}for n in ast.walk(tree)))


 def test_08_passive_command_capture_restores_before_every_outcome_diagnostic(self):
  for error in [None,RuntimeError('actual original full current Source refusal')]:
   ns=remote();bare=ns['original_run'];saved={};hook=Mock()
   ns['AUDIT']=types.SimpleNamespace(mkdir=lambda **_:None,parent='/explicit-owned-audit-I-O')
   def save(name,value):
    if name!='intent.json':self.assertIs(ns['subprocess'].run,bare)
    saved[name]=copy.deepcopy(value);return ns['sha'](ns['encoded'](value))
   def run():
    ns['subprocess'].run=hook;ns['command_trace']=types.SimpleNamespace(calls=[{'explicitCommandI/O':True}],failures=[],snapshot=lambda:{'classifiedStatDisappearances':0})
    if error:raise error
    return {'format':ns['FORMAT'],'completed':True}
   ns.update(run=run,save=save,sync=lambda _:None)
   with patch.object(ns['os'],'geteuid',return_value=0),patch.object(ns['os'],'getegid',return_value=0),\
    patch.object(ns['socket'],'gethostname',return_value='yunipals-main'),patch.object(ns['signal'],'signal'),patch.object(ns['signal'],'alarm'),\
    patch.object(ns['sys'],'getprofile',return_value=None),patch.object(ns['sys'],'gettrace',return_value=None),\
    patch.object(ns['os'].path,'lexists',return_value=False),patch.object(ns['subprocess'],'run',bare),contextlib.redirect_stdout(io.StringIO()):
    self.assertEqual(ns['main'](),1 if error else 0)
   self.assertTrue(saved['result.json']['commandCapture']['subprocessRunRestored'])
   self.assertIn('subprocess-command-summaries.json',saved)
   if error:
    self.assertIn(str(error),saved['failure.json']['traceback']);self.assertEqual(saved['result.json']['errorClass'],'RuntimeError')



 def test_09_prior_actual_root_canonical_and_retained_business_functions(self):
  actual=json.loads(PRIOR_FIXTURE.read_bytes());root=m.canonical(actual,m.PRIOR_RECONCILIATION_SHA,False)
  self.assertEqual(root['rootSourceSha256'],'ec63d076bc290af7f71c2c272ce1bd9a506ef735c5e2fcaa8b9e588f5560b95d')
  prior=load(OPS/'ypal-cont6-failed-cache-reconciliation-owner-v1.py')
  for name in ['authenticate_baseline','authenticate_failure','prepared_observation','terminal','catalog','read','frame','physical','save_command']:
   self.assertEqual(ast.dump(fn(prior.REMOTE,name),include_attributes=False),ast.dump(fn(m.REMOTE,name),include_attributes=False),name)
  self.assertIs(type(m.RECONCILIATION_SOURCE_REVIEWED),bool)
  self.assertEqual(remote()['FORMAT'],m.FORMAT)
  self.assertEqual(str(remote()['AUDIT']),'/var/backups/yunipals-root-cont6-failed-cache-reconciliation-20261026-2')

 def test_10_prior_failure_graph_complete_hash_checks_and_drift_refusal(self):
  ns=remote();enc=ns['encoded'];sha=ns['sha'];files={}
  # Protected historical I/O is synthetic; preserve all genuine authentication
  # code. The actual canonical Root/pins are checked separately in group9.
  diagnostic=load(OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py')
  inventory=load(OPS.parent/'booster-launch/ypal-old-runtime-inventory-v1.py')
  import base64
  stderr=b'explicit protected historical stderr I/O fixture'
  payload={'rawPublicPeerEvidenceRetained':True,'exceptionClass':None,
   'publicProducerSha256':'7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b',
   'scriptSha256':'fc771208678d07b7e76b1a7407439b553f1f1fb031272ad58d2391c51707be28',
   'summary':{'commandKind':'setpriv','argumentCount':14,'uid':111,'gid':113,'exitCode':1,'stdoutBytes':0,'stderrBytes':len(stderr),'clearGroups':True,'noNewPrivileges':True,'capabilityOptionsPresent':True},
   'argv':['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','/usr/bin/python3','-I','-B','-c',inventory.PEER_FDS,json.dumps([1234567]),'111'],
   'stdoutBase64':'','stderrBase64':base64.b64encode(stderr).decode()}
  self.assertTrue(diagnostic.public_fd_peer(payload['argv']))
  root=m.canonical(json.loads(PRIOR_FIXTURE.read_bytes()),m.PRIOR_RECONCILIATION_SHA,False)
  rows={name:{'explicitProtectedPrivateIO':True}for name in root['privateHashes']}
  rows.update({'intent.json':{'format':root['format'],'rootSourceSha256':ns['PRIOR_RECONCILIATION_SOURCE_SHA'],'failedCommitResultSha256':ns['FAILED_SHA'],'baselineRootSha256':ns['BASELINE_SHA'],'readOnlyReconciliation':True,'archiveRequested':False,'automaticRetryAllowed':False},
   'failure.json':{'type':'RuntimeError'},'failed-commit-authentication.json':{'rootSha256':ns['FAILED_SHA'],'fileHashes':ns['FAILED_FILES']},'failed-command-1.json':payload})
  root['privateHashes']={name:sha(enc(value))for name,value in rows.items()}
  for name,value in rows.items():files[ns['PRIOR_RECONCILIATION_AUDIT']/name]=enc(value)
  files[ns['PRIOR_RECONCILIATION_AUDIT']/'result.json']=enc(root)
  ns.update(PRIOR_RECONCILIATION_ROOT=root,PRIOR_RECONCILIATION_SHA=sha(enc(root)),load=lambda path,digest:diagnostic)
  real_sha=ns['sha']
  ns['sha']=lambda raw:'dc25ef2b9863e58df31db5c2a1ff09031166218aa49355e7c5e1c89be48f4d1f'if raw==stderr else real_sha(raw)
  def read(path,digest=None):
   raw=files[pathlib.Path(path)]
   if digest is not None and real_sha(raw)!=digest:raise RuntimeError('protected historical hash mismatch')
   return raw
  ns.update(read=read,frame=lambda path:{'sha256':real_sha(read(path)),**dict.fromkeys(ns['FRAME'],1)})
  result=ns['authenticate_prior_reconciliation']();self.assertFalse(result['oldReconciliationSuccessClaimed']);self.assertEqual(len(ns['tracked']),7)
  for name in rows:
   path=ns['PRIOR_RECONCILIATION_AUDIT']/name;raw=files[path];files[path]+=b' '
   try:
    with self.assertRaises(RuntimeError):ns['authenticate_prior_reconciliation']()
   finally:files[path]=raw
  # A validly re-saved private graph still refuses a changed public payload.
  payload['summary']['uid']=110;files[ns['PRIOR_RECONCILIATION_AUDIT']/'failed-command-1.json']=enc(payload)
  root['privateHashes']['failed-command-1.json']=real_sha(enc(payload));files[ns['PRIOR_RECONCILIATION_AUDIT']/'result.json']=enc(root);ns['PRIOR_RECONCILIATION_SHA']=real_sha(enc(root))
  with self.assertRaisesRegex(RuntimeError,'numeric_metadata_peer'):ns['authenticate_prior_reconciliation']()

 def test_11_actual_classifier_start_binding_restore_and_no_epoch_method_changes(self):
  ns=remote();helper=load(OPS/'ypal-metadata-peer-stat-churn-classifier-v1.py');saved={};bare=ns['original_run']
  original_load=ns['load']
  ns.update(load=lambda path,digest:helper,read=lambda path,digest:b'explicit authenticated manifest I/O',save=lambda name,value:saved.setdefault(name,copy.deepcopy(value))or'0'*64)
  def local(path,digest=None):
   target=OPS/pathlib.Path(path).name
   if target.name==helper.INVENTORY:target=OPS.parent/'booster-launch'/target.name
   raw=target.read_bytes()
   if digest is not None:self.assertEqual(helper.sha(raw),digest)
   return raw
  with patch.object(helper,'public',side_effect=local),patch.object(ns['subprocess'],'run',bare):
   ns['start_commands']();self.assertIs(ns['subprocess'].run,ns['command_trace']);binding=ns['command_trace'].binding()
   ns['subprocess'].run=bare
  self.assertEqual(binding['operatorSha256'],ns['CLASSIFIER_SHA']);self.assertEqual(binding['maximumReadCaptureAttempts'],3)
  self.assertEqual(binding['captureWindowNanoseconds'],90_000_000_000)
  self.assertIn('metadata-peer-classifier-binding.json',saved)
  self.assertFalse(binding['effectsRetried']);self.assertFalse(binding['newRetryLoopInstalled'])
  self.assertFalse(any(isinstance(n,ast.Assign)and any(isinstance(t,ast.Attribute)and t.attr in {'capture_current','current','actor_current'}for t in n.targets)for n in ast.walk(ast.parse(m.REMOTE))))

 def test_12_outer_three_actual_inputs_exact_remote_once_and_missing_prior_stops(self):
  import subprocess
  values={m.BASELINE:root_fixture(BASELINE_FIXTURE),m.FAILED:root_fixture(FAILED_FIXTURE),m.PRIOR_RECONCILIATION:json.loads(PRIOR_FIXTURE.read_bytes())}
  expected=m.REMOTE
  for token,value in [('__ACTUAL_BASELINE_ROOT__',m.canonical(values[m.BASELINE],m.BASELINE_SHA,True)),('__ACTUAL_FAILED_ROOT__',m.canonical(values[m.FAILED],m.FAILED_SHA,False)),('__ACTUAL_PRIOR_RECONCILIATION_ROOT__',m.canonical(values[m.PRIOR_RECONCILIATION],m.PRIOR_RECONCILIATION_SHA,False)),('__ROOT_SOURCE_SHA__',hashlib.sha256(PATH.read_bytes()).hexdigest()),('__BASELINE_AUTHENTICATION_TEMPLATE_SHA__',m.BASELINE_AUTHENTICATION_TEMPLATE_SHA)]:expected=expected.replace(token,repr(value))
  calls=[];saved=[];realread=pathlib.Path.read_bytes
  def read(path):return m.encoded(values[path])if path in values else realread(path)
  def peer(args,**kwargs):calls.append((args,kwargs));return subprocess.CompletedProcess(args,0,m.encoded({'format':m.FORMAT,'completed':True}),b'')
  with patch.object(sys,'argv',[str(PATH),'--run']),patch.object(m,'RECONCILIATION_SOURCE_REVIEWED',True),patch.object(pathlib.Path,'read_bytes',read),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'run',side_effect=peer),patch.object(m,'exclusive',side_effect=lambda path,value:saved.append((path,value))),patch.object(m.os,'umask'),contextlib.redirect_stdout(io.StringIO()):
   self.assertEqual(m.main(),0)
  self.assertEqual(len(calls),1);self.assertEqual(calls[0][1]['input'],expected.encode());self.assertNotIn('__ACTUAL_',expected)
  values[m.PRIOR_RECONCILIATION]['completed']=True
  with patch.object(sys,'argv',[str(PATH),'--run']),patch.object(m,'RECONCILIATION_SOURCE_REVIEWED',True),patch.object(pathlib.Path,'read_bytes',read),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'run',side_effect=AssertionError('no wire before authenticated prior')):
   with self.assertRaises(RuntimeError):m.main()

if __name__=='__main__':unittest.main()
