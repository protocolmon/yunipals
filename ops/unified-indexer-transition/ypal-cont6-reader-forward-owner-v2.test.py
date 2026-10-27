"""Closed Root Reader6 source controls; private/SQL/OS/workload I/O fixtures only."""
import ast,contextlib,copy,hashlib,importlib.util,io,json,pathlib,sys,tempfile,types,unittest
from unittest.mock import Mock,patch
OPS=pathlib.Path(__file__).resolve().parent;PATH=OPS/'ypal-cont6-reader-forward-owner-v2.py'
spec=importlib.util.spec_from_file_location('closed_Reader6_source',PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def remote(action='qualify-before'):
 ns={'__name__':'fixture','__ACTION__':action,'__ACTIVATION_LOCAL__':{'action':'activate-reads'},'__ACTIVATION_PRODUCER_SHA__':'f'*64,'__PREVIOUS_LOCAL__':None,'__ROOT_SOURCE_SHA__':'a'*64}
 with patch('os.umask'):exec(compile(m.REMOTE,str(PATH)+':remote','exec'),ns)
 return ns

def clone(function,changes):
 scope={**function.__globals__,**changes};result=types.FunctionType(function.__code__,scope,function.__name__,function.__defaults__,function.__closure__);return result

def activation_fixture(ns):
 enc=ns['encoded'];sha=ns['sha'];base=ns['SPLIT_BASE'];audit=ns['ACTIVATION_AUDIT'];files={}
 metadata={'refs':copy.deepcopy(ns['refs']),'acknowledgement':{'explicitImmutableMetadataACKFixture':True}}
 config={'generationSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64}
 before={'binding':{'operatorSha256':ns['PROVIDER_SHA'],'config':config,'prerequisites':{'metadataCurrentProof':{'metadataEpoch':metadata}}}}
 before_file=ns['ORIGINAL_CACHE_BASE']/'before.json';files[before_file]=enc(before)
 binding={'format':'yunipals-native-readiness-cache-split-v1','operatorSha256':ns['SPLIT_SHA'],'manifestSha256':ns['SPLIT_MANIFEST_SHA'],
  'inputSha256':ns['SPLIT_INPUT_SHA'],'heldTestWaived':True,'heldQualificationPerformed':False,'oldCachePreparedACKClaimed':False,'oldC54WholeValidatorPassed':False,
  'nativePolicyRefs':copy.deepcopy(ns['POLICY']),'forwardAuthorityInputSha256':ns['AUTH_SHA'],
  'constructorBindingSha256':sha(enc({'explicitPrivateIOFixture':True})),'generationBindingSha256':sha(enc({'explicitPrivateIOFixture':True}))}
 committed={'format':'yunipals-ypal-cache-guard-sql-v1','mode':'apply','xid':'17621038','acknowledged':True,'resultJson':'{}','result':{}}
 files[base/'activate-reads'/'sql-committed.json']=enc(committed)
 for area in ['prepare-guards','activate-reads']:files[base/area/'receipt.json']=enc({'binding':binding,'actualOwnedPhaseReceiptIOFixture':area})
 files[base/'verification.json']=enc({'binding':binding,'actualCompleteVerificationIOFixture':True})
 raw_prepared={'format':'yunipals-native-readiness-cache-split-v1-prepared','operatorSha256':ns['SPLIT_SHA'],'manifestSha256':ns['SPLIT_MANIFEST_SHA'],
  'binding':binding,'prepared':True,'additionalReadCount':4,'additionalReadAcknowledgementSha256':sha(files[base/'activate-reads'/'sql-committed.json']),
  'nativeWorkerStarted':False,'nativeGenerationPublished':False,'oldC54WholeValidatorPassed':False,'oldCachePreparedACKClaimed':False,
  'beforeSha256':sha(files[before_file]),'originalBeforeFile':str(before_file),'config':config,
  'preparationReceiptSha256':sha(files[base/'prepare-guards'/'receipt.json']),'activationReceiptSha256':sha(files[base/'activate-reads'/'receipt.json']),
  'verificationSha256':sha(files[base/'verification.json'])}
 files[base/'prepared.json']=enc(raw_prepared);prepared={**copy.deepcopy(raw_prepared),'receiptSha256':sha(files[base/'prepared.json']),
  'immutableAcknowledgementOnly':True,'currentQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
 sidecar={'nativePolicyRefs':ns['POLICY'],'forwardAuthorityInputSha256':ns['AUTH_SHA'],'captureClassifierRefs':ns['CLASSIFIER_REFS']}
 split=types.SimpleNamespace(BASE=base,MANIFEST=ns['SPLIT'].with_suffix('.manifest.json'),INPUT=pathlib.Path('/explicit/owned-split-input.json'),authenticate=lambda:None,
  prepared_acknowledgement=lambda prepared_sha,input_sha:copy.deepcopy(prepared),activation_record=lambda prepared_sha,input_sha:copy.deepcopy(committed))
 files[split.INPUT]=enc(sidecar)
 root={'format':'root-native120-cache-split-phase-v1','completed':True,'rootProducerSha256':ns['ACTIVATION_PRODUCER_SHA'],'action':'activate-reads',
  'inputSha256':ns['SPLIT_INPUT_SHA'],'operatorSha256':ns['SPLIT_SHA'],'manifestSha256':ns['SPLIT_MANIFEST_SHA'],'captureClassifierRefs':ns['CLASSIFIER_REFS'],
  'businessResultSha256':sha(enc({**raw_prepared,'receiptSha256':prepared['receiptSha256']})),'phaseCommitted':True,'preparedACKCreated':True,'customerREADsActivated':True,'sourcePostflightPassed':True,
  'subprocessRunRestored':True,'heldQualificationPerformed':False,'oldC54WholeValidatorPassed':False,'oldCachePreparedACKClaimed':False,
  'serviceActionsRequested':0,'readerLOGINRequested':False,'workerStartRequested':False,'automaticRetryAllowed':False}
 rows={name:{'explicitPrivateIOFixture':True}for name in ['capture-classifier-binding.json','source-preflight.json','constructor-binding.json','generation-binding.json','capture-classifier-snapshot.json','accepted-dependency-preauthorization.json']}
 rows['accepted-dependency-preauthorization.json']={'readerPeerSourceSha256':'91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6','qualifierSourceSha256':'06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76','qualificationReceiptSha256':'521e0bb514f1f6ba306b82d489f19ea53183dcdd2aa1e76aa65498cc184f1899','proof':{'explicitOriginalAcceptedInventoryIOFixture':True}}
 rows.update({'intent.json':{'format':root['format'],'rootProducerSha256':ns['ACTIVATION_PRODUCER_SHA'],'action':root['action'],'inputSha256':ns['SPLIT_INPUT_SHA'],
  'operatorSha256':ns['SPLIT_SHA'],'manifestSha256':ns['SPLIT_MANIFEST_SHA'],'captureClassifierRefs':ns['CLASSIFIER_REFS'],'automaticRetryAllowed':False},
  'split-binding.json':copy.deepcopy(binding),'business-return.json':{**raw_prepared,'receiptSha256':prepared['receiptSha256']},'source-postflight.json':{'validated':True}})
 root['privateHashes']={name:sha(enc(value))for name,value in rows.items()}
 for name,value in rows.items():files[audit/name]=enc(value)
 files[audit/'result.json']=enc(root);ns['ACTIVATION_LOCAL']={**root,'resultSha256':sha(enc(root))}
 def document(path,digest=None):
  raw=files[pathlib.Path(path)]
  if digest is not None and pathlib.Path(path)!=split.INPUT and sha(raw)!=digest:raise RuntimeError('actual fixed hash mismatch')
  return json.loads(raw)
 ns['document']=document;original=ns['load']
 ns['load']=lambda path,digest:split if path==ns['SPLIT']else original(path,digest)
 ns['protected']=lambda *args:b'explicit-authenticated-public-source-I/O-fixture'
 return root,prepared,metadata,files,rows

class Controls(unittest.TestCase):
 def test_01_actual_owned_split_root_schema_and_complete_private_ACK_chain(self):
  ns=remote();root,prepared,metadata,files,rows=activation_fixture(ns)
  actual=ns['authenticate_activation']();self.assertEqual(actual,(root,prepared,metadata));self.assertIn('intent.json',root['privateHashes'])
  for path in [ns['ACTIVATION_AUDIT']/'intent.json',ns['SPLIT_BASE']/'prepared.json',ns['ACTIVATION_AUDIT']/'source-postflight.json']:
   old=files[path];files[path]=old+b' '
   with self.assertRaisesRegex(RuntimeError,'hash mismatch'):ns['authenticate_activation']()
   files[path]=old
  bad=copy.deepcopy(ns['ACTIVATION_LOCAL']);bad['annotation']='unowned';ns['ACTIVATION_LOCAL']=bad
  with self.assertRaisesRegex(RuntimeError,'without_extra_annotations'):ns['authenticate_activation']()

 def test_02_canonical_failed_unknown_outcome_or_foreign_commit_cannot_render(self):
  ns=remote();root,_,_,_,_=activation_fixture(ns);local=copy.deepcopy(ns['ACTIVATION_LOCAL'])
  self.assertEqual(ns['encoded'](root),m.encoded(root));self.assertEqual(ns['encoded']({})[-1],10);self.assertNotEqual(ns['encoded']({})[-2:],bytes([92,110]))
  self.assertEqual(m.canonical(local,root['format']),local)
  for bad in [{**local,'completed':False},{**local,'extra':True},{**local,'resultSha256':'f'*64}]:
   with self.assertRaises(RuntimeError):m.canonical(bad,root['format'])
  for token,value in [('__ACTION__','qualify-before'),('__ACTIVATION_LOCAL__',local),('__ACTIVATION_PRODUCER_SHA__','f'*64),('__PREVIOUS_LOCAL__',None),('__ROOT_SOURCE_SHA__','a'*64)]:
   pass
  payload=m.REMOTE
  for token,value in [('__ACTION__','qualify-before'),('__ACTIVATION_LOCAL__',local),('__ACTIVATION_PRODUCER_SHA__','f'*64),('__PREVIOUS_LOCAL__',None),('__ROOT_SOURCE_SHA__','a'*64)]:payload=payload.replace(token,repr(value))
  compile(payload,str(PATH),'exec');self.assertNotIn('__ACTIVATION_LOCAL__',payload)

 def fixture(self,action):
  ns=remote(action);commit,prepared,metadata,files,_=activation_fixture(ns);events=[];writes={};enc=ns['encoded'];sha=ns['sha'];enabled=action in{'qualify-after','publish'}
  inputs={name:'5'*64 for name in ns['INPUT_KEYS']};inputs.update(sourceManifestSha256=ns['MANIFEST_SHA'],cachePreparedSha256=prepared['receiptSha256'],cacheInputsSha256=ns['CACHE_INPUT_SHA'],readPlanSha256=prepared['config']['readPlanSha256'],readContextInputSha256=prepared['config']['readContextInputSha256'])
  rendered={'readerInputs':inputs,'immutableFileLineageOnly':True,'currentReadinessQualified':False,'metadataActorCurrentQualified':False,'metadataRefs':ns['refs'],
   'nativePolicyRefs':ns['POLICY'],'forwardAuthorityInputSha256':ns['AUTH_SHA'],'inputWrites':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'cacheSplitPreparedBinding':{'explicitOwnedSplitDescriptorFixture':True}}
  manifest={'format':'yunipals-ypal-ordinary-reader-continue-v6-source','files':{ns['READER'].name:ns['READER_SHA']},'dependencies':{},'contexts':{'phase':{'file':'ypal-ordinary-read-cache-continue-v6.py','sha256':ns['PROVIDER_SHA']}}}
  report={'generationId':'105','cacheInputsSha256':ns['CACHE_INPUT_SHA'],'candidateSha256':prepared['config']['generationSha256'],'cacheInput':prepared['config'],'sourceRefs':{'actualSourceRefsFixture':True}}
  epoch=types.SimpleNamespace(binding=lambda:copy.deepcopy(metadata));state=[enabled];proof=object();context=types.SimpleNamespace(cache=types.SimpleNamespace(metadata_epoch=epoch),prepared=prepared,logins_enabled=lambda:state[0])
  inner=types.SimpleNamespace(BASE=pathlib.Path('/explicit/actual-caller'))
  session=types.SimpleNamespace(source=types.SimpleNamespace(inverse=False),metadata_epoch=epoch,continuation_caller=inner)
  def context_ctor(manifest_sha,refs):
   events.append('reader-context');session.root=root;session.proof=proof;session.context=context
   session.key={'cacheSplitPreparedBinding':copy.deepcopy(rendered['cacheSplitPreparedBinding']),'target':'reader','direction':'forward','manifestSha256':manifest_sha,'inputsSha256':sha(enc(refs))}
   return root,proof,context
  session.reader_context=context_ctor;session.preflight=lambda:events.append('preflight')or{'validated':True};session.finish=lambda:events.append('finish')or{'validated':True}
  reviewed={'reviewHash':'6'*64,'databaseWrites':0,'serviceActions':0,'binding':{'loginAuthorizationSha256':'7'*64}}
  root=types.SimpleNamespace(BASE=pathlib.Path('/explicit/actual-reader'),review=lambda p,i:events.append('review-before')or copy.deepcopy(reviewed),publication_review=lambda p:events.append('review-after')or copy.deepcopy(reviewed))
  mode='reader-after-login'if enabled else'reader-before-login';receipt={'completed':True,'syntheticTimingInputOnly':True,'productionCOMMITQualified':False,'reservedEffectNanoseconds':70_000_000_000,
   'elapsedNanoseconds':1_000_000_000,'observation':{'allOriginalPrepublicationPredicates':True,'twoLOGINCurrentlyEnabled':enabled,'ownedBootAndReloadEffectsNotExecuted':True},
   'fullPostflight':{'validated':True,'metadataEpoch':metadata,'metadataActorCurrent':{'currentActorQualified':True}},'databaseWrites':0,'serviceActions':0,'providerCalls':0}
  def require(actual,ref,actualmode):self.assertIs(actual,session);self.assertEqual(actualmode,mode);events.append('require-timing');return copy.deepcopy(receipt)
  inner.require_timing=require
  def qualify(actual,capture):events.append('qualify');return {'completed':True,'productionCOMMITQualified':False,'captureId':capture,'sha256':sha(enc(receipt))}
  def execute(actual,selected,args,attempt,timing):
   self.assertIs(actual,session);self.assertEqual(selected,action);events.append('effect-once');require(actual,timing,mode)
   self.assertEqual(args,[reviewed['reviewHash']]if enabled else[inputs,reviewed['reviewHash'],reviewed['binding']['loginAuthorizationSha256']])
   state[0]=True
   return {'readerLOGINsAdmitted':True,'globalPublicationPerformed':False,'serviceActions':0}if action=='admit-readers'else{'actualOriginalFullPublicationReturnFixture':True}
  caller=types.SimpleNamespace(Session=lambda *args:events.append('fresh-session')or session,qualify_reader=qualify,execute_reader=execute)
  def renderer(*args):self.assertEqual(args,(prepared['receiptSha256'],ns['MANIFEST_SHA'],ns['POLICY'],ns['AUTH_SHA'],ns['SPLIT_INPUT_SHA']));events.append('render');return copy.deepcopy(rendered)
  activation_load=ns['load']
  def split_bind(actual,input_sha,prepared_sha):
   self.assertIs(actual,session);self.assertEqual((input_sha,prepared_sha),(ns['SPLIT_INPUT_SHA'],prepared['receiptSha256']));events.append('split-bind');return copy.deepcopy(rendered['cacheSplitPreparedBinding'])
  class Observer:
   def __init__(self,original,save):self.original=original;self.calls=[];self.failures=[];self.raw_failures=[]
   def __call__(self,*args,**kwargs):return self.original(*args,**kwargs)
   def binding(self):return {'explicitActualClassifierBindingFixture':True}
   def snapshot(self):return {'explicitActualClassifierCountersFixture':True}
  def module(path,digest):
   if path==ns['RENDERER']:return types.SimpleNamespace(reader_inputs=renderer,bind=split_bind)
   if path==ns['CALLER']:return caller
   for item,label in [(ns['PREPARED_BINDER'],'prepared-bind'),(ns['READER_BINDER'],'route-bind'),(ns['GENERATION_BINDER'],'generation-bind')]:
    if path==item:return types.SimpleNamespace(bind=lambda s,label=label:events.append(label)or{'explicitDescriptorFixture':label})
   if path==ns['CLASSIFIER']:return types.SimpleNamespace(SubprocessDiagnostics=Observer,authenticate=lambda:None)
   if path==ns['SPLIT']:return activation_load(path,digest)
   raise AssertionError(str(path))
  original=ns['document']
  def document(path,digest=None):
   if path==ns['REPORT']:return copy.deepcopy(report)
   if path==ns['MANIFEST']:return copy.deepcopy(manifest)
   if path==inner.BASE/'captures'/ns['CAPTURE']/'result.json':self.assertEqual(digest,sha(enc(receipt)));return copy.deepcopy(receipt)
   if path==inner.BASE/'attempts'/ns['CAPTURE']/'result.json':return {'completed':True,'businessResultPresent':True,'postflight':{'validated':True},'action':action,'context':session.key,'automaticEffectRetryAllowed':False}
   return original(path,digest)
  prior={'readerQualification':{'captureId':'actual-prior-capture','sha256':'8'*64},'reviewHash':reviewed['reviewHash'],'loginAuthorizationSha256':reviewed['binding']['loginAuthorizationSha256']}
  def keep(name,value):writes[name]=copy.deepcopy(value);return sha(value if isinstance(value,bytes)else enc(value))
  ns.update(authenticate_previous=lambda c:None if action=='qualify-before'else prior,document=document,load=module,protected=lambda *args:b'explicit-public-source-IO',
   frame=lambda p,d:{'sha256':d,'explicitSameInodeFixture':True},keep=keep)
  return ns,events,writes,receipt

 def test_03_real_run_four_finite_actions_exact_ctor_order_timing_and_single_effect(self):
  for action in m.ACTIONS:
   with self.subTest(action=action):
    ns,events,writes,_=self.fixture(action)
    with patch.object(ns['os'].path,'lexists',return_value=False),patch.object(ns['subprocess'],'run',ns['original_run']):
     try:value=ns['run']()
     finally:ns['subprocess'].run=ns['original_run']
    self.assertTrue(value['completed']);self.assertTrue(value['fullSourcePostflightQualified'])
    self.assertLess(events.index('preflight'),events.index('prepared-bind'));self.assertLess(events.index('prepared-bind'),events.index('route-bind'))
    self.assertLess(events.index('route-bind'),events.index('generation-bind'));self.assertLess(events.index('generation-bind'),events.index('split-bind'));self.assertLess(events.index('split-bind'),events.index('reader-context'))
    self.assertEqual(events.count('effect-once'),int(action in{'admit-readers','publish'}));self.assertEqual(events.count('qualify'),int(action in{'qualify-before','qualify-after'}))
    self.assertEqual(value['readerLOGINDispatched'],action=='admit-readers');self.assertEqual(value['publicationDispatched'],action=='publish')

 def test_04_actual_240_including70_refusal_and_original_effect_error_no_replay(self):
  ns,events,_,receipt=self.fixture('qualify-before');receipt['elapsedNanoseconds']=170_000_000_000
  with patch.object(ns['os'].path,'lexists',return_value=False),patch.object(ns['subprocess'],'run',ns['original_run']):
   try:
    with self.assertRaisesRegex(RuntimeError,'original_240_including70'):ns['run']()
   finally:ns['subprocess'].run=ns['original_run']
  self.assertEqual(events.count('qualify'),1);self.assertNotIn('effect-once',events)
  ns,events,_,_=self.fixture('admit-readers');original_load=ns['load'];error=TimeoutError('original real SQL outcome unknown')
  def module(path,digest):
   value=original_load(path,digest)
   if path==ns['CALLER']:value.execute_reader=Mock(side_effect=error)
   return value
  ns['load']=module
  with patch.object(ns['os'].path,'lexists',return_value=False),patch.object(ns['subprocess'],'run',ns['original_run']):
   try:
    with self.assertRaises(TimeoutError)as caught:ns['run']()
   finally:ns['subprocess'].run=ns['original_run']
  self.assertIs(caught.exception,error);self.assertTrue(ns['effect_invoked'])

 def test_05_prior_action_actual_canonical_chain_and_all_private_nodes(self):
  ns=remote('publish');root,prepared,_,files,_=activation_fixture(ns);enc=ns['encoded'];sha=ns['sha']
  prior={'format':ns['FORMAT'],'completed':True,'action':'qualify-after','rootSourceSha256':ns['ROOT_SOURCE_SHA'],'splitActivationRootResultSha256':ns['ACTIVATION_LOCAL']['resultSha256'],
   'preparedSha256':prepared['receiptSha256'],'readerManifestSha256':ns['MANIFEST_SHA'],'callerSha256':ns['CALLER_SHA'],'automaticRetryAllowed':False,'fullSourcePostflightQualified':True,
   'privateHashes':{'reader-timing.json':sha(enc({'explicitFullTimingFixture':True}))}}
  audit=pathlib.Path('/var/backups/yunipals-root-cont6-reader-qualify-after-20261026-2');files[audit/'reader-timing.json']=enc({'explicitFullTimingFixture':True});files[audit/'result.json']=enc(prior)
  ns['PREVIOUS_LOCAL']={**prior,'resultSha256':sha(enc(prior))};self.assertEqual(ns['authenticate_previous'](prepared),prior)
  files[audit/'reader-timing.json']+=b' '
  with self.assertRaisesRegex(RuntimeError,'hash mismatch'):ns['authenticate_previous'](prepared)

 def test_06_no_old_receipt_alias_and_original_business_functions_are_delegated(self):
  tree=ast.parse(m.REMOTE);run=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='run');calls=[ast.unparse(n.func)for n in ast.walk(run)if isinstance(n,ast.Call)]
  self.assertEqual(calls.count('phase'),13)
  self.assertNotIn('caller.qualify_held',ast.unparse(run));self.assertNotIn('execute_cache',ast.unparse(run))
  self.assertIn('caller.execute_reader',ast.unparse(run));self.assertIn('caller.qualify_reader',ast.unparse(run));self.assertIn('root.publication_review',ast.unparse(run))
  self.assertFalse(m.READER_SOURCE_REVIEWED)
  self.assertEqual(m.ACTIVATION_PRODUCER_SHA,hashlib.sha256((OPS/'ypal-native-readiness-cache-split-phase-owner-v1.py').read_bytes()).hexdigest())
  with patch.object(sys,'argv',[str(PATH),'--run','--action','qualify-before']),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')):
   with self.assertRaisesRegex(RuntimeError,'reviewed_Reader6'):m.main()
  # Validate every actual pinned runtime byte; no import/current constructors.
  ns=remote()
  for field,name in [('CALLER_SHA','ypal-ordinary-publication-continue-v6.py'),('RENDERER_SHA','ypal-native-readiness-split-reader-binding-v1.py'),('SPLIT_SHA','ypal-native-readiness-cache-split-v1.py'),('PREPARED_BINDER_SHA','ypal-native-readiness-prepared-binding-v1.py'),('READER_BINDER_SHA','ypal-native-readiness-reader-binding-v1.py'),('GENERATION_BINDER_SHA','ypal-native-readiness-reader-generation-binding-v1.py')]:
   self.assertEqual(ns[field],hashlib.sha256((OPS/name).read_bytes()).hexdigest())


 def test_07_saved_prepared_file_return_and_pure_ACK_are_distinct_and_original_action_body_unchanged(self):
  ns=remote();root,prepared,_,files,rows=activation_fixture(ns)
  self.assertNotEqual(root['businessResultSha256'],prepared['receiptSha256'])
  self.assertEqual(ns['sha'](files[ns['SPLIT_BASE']/'prepared.json']),prepared['receiptSha256'])
  self.assertEqual(ns['sha'](ns['encoded'](rows['business-return.json'])),root['businessResultSha256'])
  old=rows['business-return.json']['receiptSha256'];rows['business-return.json']['receiptSha256']=root['businessResultSha256']
  files[ns['ACTIVATION_AUDIT']/'business-return.json']=ns['encoded'](rows['business-return.json'])
  root['privateHashes']['business-return.json']=ns['sha'](files[ns['ACTIVATION_AUDIT']/'business-return.json'])
  files[ns['ACTIVATION_AUDIT']/'result.json']=ns['encoded'](root);ns['ACTIVATION_LOCAL']={**root,'resultSha256':ns['sha'](ns['encoded'](root))}
  with self.assertRaisesRegex(RuntimeError,'accept_return_hash'):ns['authenticate_activation']()
  spec=importlib.util.spec_from_file_location('old_frozen_Reader',OPS/'ypal-cont6-reader-forward-owner-v1.py');previous=importlib.util.module_from_spec(spec);spec.loader.exec_module(previous)
  def business(source):
   run=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)and n.name=='run')
   return next(n for n in run.body if isinstance(n,ast.If)and ast.unparse(n.test)=="ACTION in {'qualify-before', 'qualify-after'}")
  self.assertEqual(ast.dump(business(m.REMOTE)),ast.dump(business(previous.REMOTE)))

 def test_08_whole_main_restores_classifier_first_preserves_original_error_and_never_replays(self):
  for diagnostic_refused in [False,True]:
   ns,_,_,_=self.fixture('admit-readers');saved={};original=TimeoutError('actual original outcome requires inspection')
   class Observer:
    calls=[];failures=[]
    def binding(self):self.assert_restored();return {'explicitClassifierBindingIOFixture':True}
    def snapshot(self):self.assert_restored();return {'explicitClassifierCountersIOFixture':True}
    def assert_restored(self):
     if ns['subprocess'].run is not ns['original_run']:raise AssertionError('restore original subprocess.run before snapshot or write')
   observer=Observer()
   def failing():ns['command_trace']=observer;ns['subprocess'].run=observer;ns['effect_invoked']=True;raise original
   def keep(name,value):
    self.assertIs(ns['subprocess'].run,ns['original_run'])
    if diagnostic_refused and name=='current-subprocess-diagnostic.json':raise MemoryError('optional diagnostic write')
    saved[name]=copy.deepcopy(value);return ns['sha'](ns['encoded'](value))
   def write(name,value):saved[name]=copy.deepcopy(value);return ns['sha'](ns['encoded'](value))
   ns.update(run=failing,keep=keep,write=write,sync=lambda *_:None)
   with patch.object(pathlib.Path,'mkdir'),patch.object(ns['socket'],'gethostname',return_value='yunipals-main'),patch.object(ns['signal'],'signal'),patch.object(ns['signal'],'alarm'),contextlib.redirect_stdout(io.StringIO()):
    self.assertEqual(ns['main'](),1)
   self.assertIs(ns['subprocess'].run,ns['original_run']);result=saved['result.json']
   self.assertEqual(result['failureType'],'TimeoutError');self.assertTrue(result['effectInvoked']);self.assertTrue(result['unknownOutcomeRequiresInspection']);self.assertFalse(result['automaticRetryAllowed'])
   self.assertIn('actual original outcome requires inspection',saved['failure.json']['traceback'])

 def test_09_outer_exact_payload_render_and_unknown_transport_are_single_attempt(self):
  ns=remote();root,_,_,_,_=activation_fixture(ns);activation=ns['ACTIVATION_LOCAL'];writes=[]
  with tempfile.TemporaryDirectory()as folder:
   source=pathlib.Path(folder)/'actual-owned-activation.json';source.write_bytes(m.encoded(activation));activation=json.loads(source.read_bytes())
   def peer(args,**kwargs):
    payload=kwargs['input'].decode();expected=m.REMOTE
    for token,value in [('__ACTION__','qualify-before'),('__ACTIVATION_LOCAL__',activation),('__ACTIVATION_PRODUCER_SHA__','f'*64),('__PREVIOUS_LOCAL__',None),('__ROOT_SOURCE_SHA__',hashlib.sha256(PATH.read_bytes()).hexdigest())]:expected=expected.replace(token,repr(value))
    self.assertEqual(payload,expected);self.assertNotIn('__ACTIVATION_',payload);compile(payload,'actual-exact-render','exec')
    return types.SimpleNamespace(stdout=b'unknown remote outcome',stderr=b'private transport refusal',returncode=143)
   with patch.object(m,'READER_SOURCE_REVIEWED',True),patch.object(m,'ACTIVATION_PRODUCER_SHA','f'*64),patch.object(sys,'argv',[str(PATH),'--run','--action','qualify-before','--activation-result',str(source)]),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'run',side_effect=peer)as call,patch.object(m,'exclusive',side_effect=lambda p,v:writes.append((p,v))),contextlib.redirect_stdout(io.StringIO()):
    self.assertEqual(m.main(),1)
   self.assertEqual(call.call_count,1);self.assertEqual(len(writes),2);self.assertTrue(writes[-1][1]['transportOutcomeUnknown']);self.assertFalse(writes[-1][1]['automaticRetryAllowed'])


 def test_10_genuine_file_bookend_accepts_saved_string_keys_and_preserves_actual_inode(self):
  ns=remote()
  with tempfile.TemporaryDirectory()as folder:
   path=pathlib.Path(folder)/'immutable-owned-fixture.json';path.write_bytes(ns['encoded']({'explicitPublicIOFixture':True}));digest=ns['sha'](path.read_bytes())
   def protected(actual,expected=None):
    raw=pathlib.Path(actual).read_bytes();self.assertEqual(ns['sha'](raw),expected);return raw
   ns['protected']=protected;first=ns['frame'](path,digest)
   self.assertEqual(first,ns['frame'](str(path),digest));self.assertEqual(first['st_ino'],path.lstat().st_ino)
   tracked={str(path):first};self.assertEqual({p:ns['frame'](p,v['sha256'])for p,v in tracked.items()},tracked)

if __name__=='__main__':unittest.main()


