"""Inverse scope/component controls with explicit physical and private I/O fixtures."""
import ast,contextlib,copy,fcntl,hashlib,importlib.util,json,os,tempfile,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent

def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('ypal-ordinary-publication-inverse-v1.py')

class Controls(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.authority_test=load('ypal-ordinary-cache-inverse-authority-v1.test.py');cls.fixture=cls.authority_test.Controls();cls.fixture.setUp()
  raw=(HERE/'ypal-ordinary-cache-inverse-authority-v1.test.py').read_bytes()
  fn=copy.deepcopy(next(n for n in ast.walk(ast.parse(raw))if isinstance(n,ast.FunctionDef)and n.name=='test_actual_inverse_prepared_callback_retains_full_SOURCE_catalog_and_one_owned_backend'))
  keys=['ctx','core','source_fixture','source','mapper','root','proof'];fn.body.append(ast.Return(value=ast.Dict(keys=[ast.Constant(k)for k in keys],values=[ast.Name(id=k,ctx=ast.Load())for k in keys])))
  scope=dict(cls.authority_test.__dict__);exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(HERE/'ypal-ordinary-cache-inverse-authority-v1.test.py'),'exec'),scope)
  cls.actual=scope[fn.name](cls.fixture)
 @classmethod
 def tearDownClass(cls):cls.fixture.doCleanups()
 def config(self,stage='stop-workloads'):
  cfg={'format':m.FORMAT+'-input','stage':stage,
   'readerRefs':{'resultSha256':'1'*64,'producerSha256':m.SOURCE_PINS[m.READER],'manifestSha256':m.SOURCE_PINS[m.READER_MANIFEST]},
   'sourcePrefix':{'inputSha256':'2'*64,'producerSha256':m.SOURCE_PINS[m.CORE],'manifestSha256':m.SOURCE_PINS['ypal-ordinary-consumer-prefix-source-v3.manifest.json']},
   'metadataInverse':None,'cacheFinish':None,'inverseAuthorityInputSha256':None,'stoppedWorkloads':None}
  if stage=='restore-original':
   cfg['metadataInverse']={'inputSha256':'3'*64,'producerSha256':m.SOURCE_PINS['ypal-native-metadata-approval-inverse-v2.py'],
    'manifestSha256':m.SOURCE_PINS['ypal-native-metadata-approval-inverse-v2.manifest.json']}
   cfg['inverseAuthorityInputSha256']='4'*64
   cfg['stoppedWorkloads']={'resultSha256':'5'*64,'inputSha256':'6'*64,'producerSha256':m.sha((HERE/m.FILE.name).read_bytes()),
    'manifestSha256':m.sha((HERE/m.MANIFEST.name).read_bytes())}
  return cfg
 def local(self,path,digest=None):
  raw=(HERE/Path(path).name).read_bytes();m.need(digest is None or m.sha(raw)==digest,'actual_local_source_IO_digest_required');return raw
 def scope(self,ready=True,committed=False,held=None,null_source_inverse=False):
  a=self.actual;controller=m.Context.__new__(m.Context);source=a['source'];source_fixture=a['source_fixture'];core=a['core']
  source_fixture.base.native['app']['is_ready']='1'if ready else'0'
  actual_inverse={'inputSha256':'c'*64,'producerSha256':m.SOURCE_PINS['ypal-native-metadata-approval-inverse-v2.py'],
   'manifestSha256':m.SOURCE_PINS['ypal-native-metadata-approval-inverse-v2.manifest.json']}
  source.config['metadataInverse']=copy.deepcopy(actual_inverse);source.metadata_inverse=copy.deepcopy(actual_inverse)
  source.supplemental_metadata_inverse=False
  source_fixture.consumer['binding']['metadataInverseRefs']=copy.deepcopy(actual_inverse);source_fixture.hash_consumer()
  source.h.protected.return_value=core.encoded(source.config)
  cfg=self.config();cfg['readerRefs']=copy.deepcopy(source.config['readerRefs']);cfg['sourcePrefix']['inputSha256']=source.input_sha
  cfg['metadataInverse']=copy.deepcopy(actual_inverse)
  controller.input_sha='7'*64;controller.config=cfg;controller.proof=a['proof'];controller.root=a['root'];controller.observations=[]
  controller.runtime=a['mapper'];controller.inputs=Mock()
  def construct_source_io(value,input_sha):
   self.assertEqual(input_sha,source.input_sha)
   value.__dict__.update(source.__dict__)
   prefix_io=types.SimpleNamespace(**source.mapper.__dict__)
   def prefix(refs,metadata_inverse,cache_finish):
    self.assertEqual(metadata_inverse,source.metadata_inverse);self.assertEqual(cache_finish,source.cache_finish)
    return source.mapper.validate_current_prefix(refs)
   prefix_io.validate_current_prefix=prefix;value.mapper=prefix_io
  # Retain the actual Core3 public API, its supplemental-ref constructor and
  # complete current body. Its parent's protected/bootstrap reads are I/O here.
  controller.core=types.SimpleNamespace(FORMAT=core.FORMAT,sha=core.sha,encoded=core.encoded,
   INPUT=core.INPUT,validate_current_source=Mock(wraps=core.validate_current_source))
  if null_source_inverse:
   source.config['metadataInverse']=None;source.supplemental_metadata_inverse=True
   source.h.protected.return_value=core.encoded(source.config)
  ctx=a['ctx'];ctx.proof=a['proof'];controller.authority=None
  if committed or held is not None:
   controller.config['stage']='restore-original'
   controller.authority=types.SimpleNamespace(value=types.SimpleNamespace(prior_aborted=Mock(return_value=held)))
  original=controller.runtime.catalog_scope
  def catalog(root,context,cache_reads):
   result=original(root,context,True)
   if committed:result.update(ownedCacheReadsPresent=False,cacheInversePrefix={'inverseCommitQualified':True})
   return result
  with patch.object(core,'authenticate',return_value={}),patch.object(core,'mapper_module',return_value=source_fixture.mapper),\
    patch.object(type(source).__bases__[0],'__init__',new=construct_source_io),\
    patch.object(m,'public',side_effect=lambda path,digest:core.encoded(source.config)if Path(path)==core.INPUT and digest==source.input_sha else self.local(path,digest)),\
    patch.object(controller.runtime,'catalog_scope',side_effect=catalog):
   result=controller.scope(ctx,False if committed else True)
  return controller,result
 def test_static_whole_manifest_and_all_actual_pinned_sources(self):
  raw=(HERE/m.FILE.name).read_bytes();expected={'format':m.FORMAT+'-source','files':{m.FILE.name:m.sha(raw),**m.SOURCE_PINS}}
  self.assertEqual(json.loads((HERE/m.MANIFEST.name).read_bytes()),expected)
  builder=load('ypal-ordinary-publication-inverse-v1-manifest.py')
  self.assertEqual(builder.encoded(builder.build()[m.MANIFEST.name]),(HERE/m.MANIFEST.name).read_bytes())
  origins=json.loads((HERE/'ypal-ordinary-consumer-prefix-v3.stage.json').read_bytes())['repositoryOrigins']
  origins.update(json.loads((HERE/'ypal-ordinary-cache-inverse-authority-v1.stage.json').read_bytes())['repositoryOrigins'])
  for name,digest in m.SOURCE_PINS.items():
   path=HERE/name
   if not path.exists():path=HERE.parent.parent/Path(origins[name])
   self.assertEqual(m.sha(path.read_bytes()),digest,name)
 def test_separate_stage_input_files_and_distinct_actual_restored_refs(self):
  with patch.object(m,'public',side_effect=self.local):
   self.assertEqual(m.configuration(self.config())['stage'],'stop-workloads')
   restored=m.configuration(self.config('restore-original'));self.assertIsNotNone(restored['stoppedWorkloads'])
   self.assertIsNotNone(restored['metadataInverse'])
  self.assertNotEqual(m.INPUTS['stop-workloads'],m.INPUTS['restore-original'])
 def test_foreign_sources_unknown_fields_or_restore_without_prior_stop_are_closed(self):
  changes=[lambda c:c.update(future=True),lambda c:c['readerRefs'].update(producerSha256='0'*64),
   lambda c:c['sourcePrefix'].update(manifestSha256='0'*64),lambda c:c.update(stage='forward'),
   lambda c:c.update(inverseAuthorityInputSha256='4'*64)]
  with patch.object(m,'public',side_effect=self.local):
   for change in changes:
    cfg=self.config();change(cfg)
    with self.subTest(change=changes.index(change)),self.assertRaises(RuntimeError):m.configuration(cfg)
   cfg=self.config('restore-original');cfg['stoppedWorkloads']=None
   with self.assertRaises(RuntimeError):m.configuration(cfg)
 def test_complete_actual_SOURCE_and_catalog_scope_has_honest_metadata_READ_contract(self):
  controller,result=self.scope();self.assertTrue(result['validated']);self.assertTrue(result['currentWriterQualified'])
  self.assertTrue(result['frameworkReadyObserved']);self.assertFalse(result['originalReader5InverseScopePassed'])
  self.assertFalse(result['originalWholeValidatorPassed']);self.assertFalse(result['wholeInverseQualified'])
  self.assertEqual(len(controller.observations),1)
  legacy=load('ypal-restored-metadata-handover-v1.py');raw=b'actual immutable candidate source I/O fixture'
  host=types.SimpleNamespace(refresh_callback=lambda:result,read_config={'admissionSha256':result['readAdmissionSha256'],
   'readPlanSha256':result['readPlanSha256'],'readContextInputSha256':result['readContextInputSha256']},
   candidate={'files':{'native-recovery.sh':m.sha(raw)}},m=types.SimpleNamespace(protected=Mock(return_value=raw)))
  self.assertIs(legacy.Host.refresh(host),result);host.m.protected.assert_called_once()
 def test_actual_Core_current_body_uses_fixed_or_supplemental_inverse_refs_without_input_relabel(self):
  fixed,proof=self.scope()
  fixed.core.validate_current_source.assert_called_once_with(fixed.config['sourcePrefix']['inputSha256'],None)
  self.assertEqual(proof['metadataInverseRefs'],fixed.config['metadataInverse'])
  self.assertFalse(fixed.observations[0]['source']['metadataInverseFromSupplementalRefs'])
  supplemental,proof=self.scope(null_source_inverse=True)
  supplemental.core.validate_current_source.assert_called_once_with(supplemental.config['sourcePrefix']['inputSha256'],supplemental.config['metadataInverse'])
  self.assertEqual(proof['metadataInverseRefs'],supplemental.config['metadataInverse'])
  self.assertTrue(supplemental.observations[0]['source']['metadataInverseFromSupplementalRefs'])
  # A different protected fixed ref refuses before executing a source proof.
  supplemental.core.validate_current_source.reset_mock()
  bad={'metadataInverse':{**supplemental.config['metadataInverse'],'inputSha256':'f'*64}}
  with patch.object(m,'public',return_value=m.encoded(bad)),self.assertRaisesRegex(RuntimeError,'actual_Core3_protected_fixed'):
   supplemental.source_current(True)
  supplemental.core.validate_current_source.assert_not_called()
 def test_ready_zero_is_not_an_unowned_initial_source_waiver(self):
  with self.assertRaisesRegex(RuntimeError,'explicit_owned_post_workload'):self.scope(ready=False)
  bad={'newHeldOwnerQualified':False,'newHeldOwnerMode':'inverse','oldZeroSessionRecoveryPredicatePassed':True}
  with self.assertRaisesRegex(RuntimeError,'positive_owned_held_inverse'):self.scope(ready=False,held=bad)
 def test_ready_zero_requires_positive_held_inverse_or_actual_committed_catalog(self):
  held={'newHeldOwnerQualified':True,'newHeldOwnerMode':'inverse','oldZeroSessionRecoveryPredicatePassed':False}
  _,proof=self.scope(ready=False,held=held);self.assertTrue(proof['heldInverseOwnerQualified']);self.assertTrue(proof['ownedInverseAllowsReadyZero'])
  _,proof=self.scope(ready=False,committed=True);self.assertTrue(proof['committedCacheInverseQualified'])
  self.assertFalse(proof['originalReader5InverseScopePassed']);self.assertFalse(proof['ready'])
 def test_current_context_scope_does_not_claim_forward_or_effect_qualification(self):
  controller,_=self.scope()
  with self.assertRaises(RuntimeError):m.timing_key(controller,'cache-inverse')
  with patch.object(m,'authenticate'),self.assertRaises(RuntimeError):m.execute(controller,'apply','forbidden')
  root=ast.parse((HERE/m.FILE.name).read_bytes());names=[ast.unparse(n.func)for n in ast.walk(root)if isinstance(n,ast.Call)]
  for forbidden in ['subprocess.Popen','subprocess.run','os.rename']:
   self.assertNotIn(forbidden,names)

 def test_complete_original_driver_is_authenticated_before_exact_business_cuts(self):
  root=self.actual['root'];controller=types.SimpleNamespace(root=root)
  with patch.object(m,'public',side_effect=self.authority_test.bridge_test.public),\
       patch.object(m,'module',side_effect=lambda name:load(name)):
   stop,finish=m.business_segments(controller)
  self.assertIn('inverse_disable_boots',stop.__code__.co_names)
  self.assertIn('all_readers_terminal',stop.__code__.co_names)
  self.assertNotIn('inverse_role_bits',stop.__code__.co_names)
  self.assertNotIn('inverse_cache_catalog',stop.__code__.co_names)
  self.assertNotIn('inverse_global',stop.__code__.co_names)
  self.assertIn('recover_metadata',finish.__code__.co_names)
  self.assertIn('legacy_serving',finish.__code__.co_names)
  self.assertNotIn('inverse-result.json',finish.__code__.co_consts)
  recover=finish.__globals__['recover_metadata']
  self.assertIn('actor_relation',recover.__code__.co_names)
  self.assertIn('reader_operation',recover.__code__.co_names)
  self.assertNotIn('only_exact_owned_auto_restarted_metadata_may_replace_selected_actor_for_inverse',recover.__code__.co_consts)
  foreign=types.FunctionType(root.inverse.__code__.replace(co_consts=tuple('foreign'if value=='inverse-result.json'else value for value in root.inverse.__code__.co_consts)),root.inverse.__globals__)
  with patch.object(m,'public',side_effect=self.authority_test.bridge_test.public),\
       patch.object(m,'module',side_effect=lambda name:load(name)),patch.object(root,'inverse',foreign),\
       self.assertRaisesRegex(RuntimeError,'complete_actual_original_reader_inverse_driver'):
   m.business_segments(controller)

 def test_each_timing_mode_runs_genuine_nested_callback_and_own_durable_receipt(self):
  root=self.actual['root'];protocol=load(m.PROTOCOL)
  with tempfile.TemporaryDirectory()as temporary,contextlib.ExitStack()as stack:
   stack.enter_context(patch.object(m,'BASE',Path(temporary)/'audit'))
   stack.enter_context(patch.object(m,'authenticate'))
   stack.enter_context(patch.object(m,'public',side_effect=lambda path,digest=None:
    self.local(path,digest)if Path(path).parent==m.OPS else self.checked_bytes(path,digest)))
   stack.enter_context(patch.object(m,'module',side_effect=lambda name:protocol if name==m.PROTOCOL else load(name)))
   for mode in m.MODES:
    with self.subTest(mode=mode):
     cfg=self.config('restore-original');reads=mode!='capsule-inverse'
     def scope(_cache_reads=True):
      if _cache_reads is None:_cache_reads=reads
      result=self.scope(committed=not _cache_reads)[1]
      # Catalog phase is explicit observation I/O for the timing-only unit.
      result['catalog']['apiLoginsEnabled']=mode=='roles-inverse'
      return result
     host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=contextlib.nullcontext)}),
      read=types.SimpleNamespace(acl_catalog=lambda value:value),read_rehearsal={'after':{'whole143AllColumnACLIOFixture':True}})
     cache=types.SimpleNamespace(stopped=Mock())
     context=types.SimpleNamespace(inverse_scope=scope,cache=cache,host=host,
      sql_ack={'resultJson':'{}'},generation_terminal=Mock())
     operation={'binding':{'afterLoginCatalog':{'LOGIN':True},'beforeLoginCatalog':{'LOGIN':False}}}
     view=types.SimpleNamespace(**root.__dict__);view.inverse_operation=Mock(return_value=(operation,{}));view.all_readers_terminal=Mock()
     view.transition_lock=contextlib.nullcontext
     controller=types.SimpleNamespace(config=cfg,input_sha='7'*64,root=view,context=context,cache=cache,host=host,
      inputs=Mock(),operation=operation,authority=types.SimpleNamespace(epoch=types.SimpleNamespace(binding=lambda:{'actualRestoredFixture':True})),
      proof=types.SimpleNamespace(DEPENDENCIES={'ypal-native-generation-v1.py':'a'*64},module=lambda *_:types.SimpleNamespace(lock=contextlib.nullcontext)))
     # The original callback body executes; terminal/kernel I/O is explicit.
     fn=getattr(view,m.MODES[mode][0])
     with patch.dict(fn.__globals__,all_readers_terminal=Mock()),\
          patch.object(m,'boundary',return_value={'catalog':{'apiLoginsEnabled':mode=='roles-inverse','ownedCacheReadsPresent':reads}}):
      receipt=m.qualify(controller,mode,mode)
     self.assertTrue(receipt['completed']);reference={key:receipt[key]for key in['captureId','sha256']}
     accepted=m.require_timing(controller,reference,mode)
     self.assertFalse(accepted['productionCOMMITQualified']);self.assertFalse(accepted['actualHeldSQLQualificationClaimed'])
     self.assertTrue(accepted['originalPreparedSaveRedirectedToOwnAudit'])
     self.assertEqual(accepted['reservedEffectNanoseconds'],protocol.callback_window(m.MODES[mode][2])['reservedEffectNanoseconds'])
     for foreign in m.MODES:
      if foreign!=mode:
       with self.assertRaises(RuntimeError):m.require_timing(controller,reference,foreign)
     cfg['metadataInverse']['inputSha256']='9'*64
     with self.assertRaises(RuntimeError):m.require_timing(controller,reference,mode)

 def checked_bytes(self,path,digest=None):
  raw=Path(path).read_bytes();self.assertTrue(digest is None or m.sha(raw)==digest);return raw

 def test_actual_original_transition_and_generation_locks_order_contention_and_release(self):
  root=self.actual['root'];actual_transition=root.transition_lock
  generation=load('ypal-native-generation-v1.py')
  original_transition_code=actual_transition.__wrapped__.__code__;original_generation_code=generation.lock.__wrapped__.__code__
  dependency=self.actual['proof'].DEPENDENCIES['ypal-native-generation-v1.py']
  self.assertEqual(dependency,m.SOURCE_PINS['ypal-native-generation-v1.py'])
  with tempfile.TemporaryDirectory()as temporary:
   base=Path(temporary);combined=base/'combined.lock';generation_path=base/'generation.lock';events=[]
   def path_io(value):
    return combined if str(value)=='/run/lock/yunipals-ypal-combined-transition.lock'else Path(value)
   def loaded(name,digest):
    self.assertEqual((name,digest),('ypal-native-generation-v1.py',dependency));events.append('module');return generation
   controller=types.SimpleNamespace(root=types.SimpleNamespace(transition_lock=actual_transition),
    proof=types.SimpleNamespace(DEPENDENCIES={'ypal-native-generation-v1.py':dependency},module=loaded))
   def locked(path):
    fd=os.open(path,os.O_RDWR)
    try:
     with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally:os.close(fd)
   def released(path):
    fd=os.open(path,os.O_RDWR)
    try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally:os.close(fd)
   with patch.dict(actual_transition.__wrapped__.__globals__,Path=path_io),patch.object(generation,'LOCK',generation_path):
    error=RuntimeError('actual lifecycle failure I/O fixture')
    with self.assertRaises(RuntimeError)as caught:
     with m.retained_locks(controller):
      locked(combined);locked(generation_path);raise error
    self.assertIs(caught.exception,error);released(combined);released(generation_path)
    controller.config={'stage':'stop-workloads','readerRefs':{},'sourcePrefix':{},'metadataInverse':None,'cacheFinish':None}
    controller.input_sha='a'*64;controller.authority=None;controller.inputs=Mock();controller.context=object()
    def reviewed(*_):
     locked(combined);locked(generation_path);events.append('review');return{'explicitOriginalReviewIOFixture':True}
    controller.root.inverse_review=reviewed
    with patch.object(m,'public',side_effect=self.local):value=m.review_stop(controller)
    self.assertTrue(m.pin(value['reviewHash']));released(combined);released(generation_path)
   self.assertEqual(events,['module','module','review'])
   self.assertIs(actual_transition.__wrapped__.__code__,original_transition_code)
   self.assertIs(generation.lock.__wrapped__.__code__,original_generation_code)
  tree=ast.parse((HERE/m.FILE.name).read_bytes())
  methods={node.name:node for node in tree.body if isinstance(node,ast.FunctionDef)}
  for name in ['qualify','execute','review_stop']:
   self.assertIn('retained_locks(controller)',ast.unparse(methods[name]))
  calls=[ast.unparse(node.func)for node in ast.walk(methods['execute'])if isinstance(node,ast.Call)]
  self.assertNotIn('review_stop',calls);self.assertIn('_review_stop',calls)

 def test_public_qualify_and_execute_failure_postflight_release_locks_and_preserve_original_exception(self):
  root=self.actual['root'];protocol=load(m.PROTOCOL)
  for target in ['qualify','execute']:
   for failure in ['business','postflight','diagnostic-disk','cancel']:
    with self.subTest(target=target,failure=failure),tempfile.TemporaryDirectory()as temporary,contextlib.ExitStack()as stack:
     base=Path(temporary);live=[];observations=[];events=[]
     @contextlib.contextmanager
     def lease(name):
      live.append(name);events.append('enter-'+name)
      try:yield
      finally:self.assertEqual(live.pop(),name);events.append('exit-'+name)
     source_error=(KeyboardInterrupt if failure=='cancel'else RuntimeError)('original_actual_'+failure+'_fixture')
     def scope(reads=None):
      if reads is None:
       self.assertEqual(live,[]);observations.append('postflight')
       if failure=='postflight':raise source_error
      elif target=='qualify'and failure in{'business','diagnostic-disk','cancel'}:raise source_error
      return{'format':m.FORMAT+'-scope','inputSha256':'7'*64,'validated':True,'inverseOnly':True,
       'sourceOnlyCurrent':True,'currentWriterQualified':True,'originalReader5InverseScopePassed':False,
       'originalWholeValidatorPassed':False,'catalog':{'apiLoginsEnabled':True,'ownedCacheReadsPresent':True}}
     operation={'binding':{'afterLoginCatalog':{'LOGIN':True},'beforeLoginCatalog':{'LOGIN':False}}}
     context=types.SimpleNamespace(inverse_scope=scope,sql_ack={'resultJson':'{}'})
     view=types.SimpleNamespace(**root.__dict__);view.BASE=base/'business';view.BASE.mkdir()
     view.transition_lock=lambda:lease('transition');view.inverse_operation=lambda _:(operation,{})
     view.all_readers_terminal=Mock()
     if target=='execute':
      def effect(*_):
       self.assertEqual(live,['transition','generation'])
       if failure in{'business','diagnostic-disk','cancel'}:raise source_error
       return{'explicitActualBusinessReturnIOFixture':True}
      view.inverse_role_bits=effect
     proof=types.SimpleNamespace(DEPENDENCIES={'ypal-native-generation-v1.py':'a'*64},
      module=lambda *_:types.SimpleNamespace(lock=lambda:lease('generation')))
     controller=types.SimpleNamespace(config=self.config('restore-original'),input_sha='7'*64,inputs=Mock(),root=view,
      proof=proof,context=context,operation=operation,cache=types.SimpleNamespace(stopped=Mock()),host=object(),
      authority=types.SimpleNamespace(epoch=types.SimpleNamespace(binding=lambda:{'restoredFixture':True})))
     stack.enter_context(patch.object(m,'BASE',base/'own'));stack.enter_context(patch.object(m,'authenticate'))
     stack.enter_context(patch.object(m,'public',side_effect=lambda path,digest=None:self.local(path,digest)if Path(path).parent==m.OPS else self.checked_bytes(path,digest)))
     stack.enter_context(patch.object(m,'module',side_effect=lambda name:load(name)))
     stack.enter_context(patch.object(m,'boundary',return_value=scope(True)if target=='execute'else{
      'catalog':{'apiLoginsEnabled':True,'ownedCacheReadsPresent':True}}))
     stack.enter_context(patch.object(m,'require_timing',return_value={'explicitActualModeReceiptIOFixture':True}))
     stack.enter_context(patch.dict(root.inverse_role_bits.__globals__,all_readers_terminal=Mock()))
     actual_write=m.write
     def write(path,value):
      if failure=='diagnostic-disk'and Path(path).name in{'failure.json','failure-postflight.json'}:
       raise OSError('diagnostic storage I/O fixture')
      return actual_write(path,value)
     stack.enter_context(patch.object(m,'write',side_effect=write))
     with self.assertRaises(type(source_error))as caught:
      if target=='qualify':m.qualify(controller,'capture','roles-inverse')
      else:m.execute(controller,'roles-inverse','attempt',{'captureId':'actual','sha256':'9'*64})
     self.assertIs(caught.exception,source_error);self.assertEqual(live,[])
     self.assertEqual(observations,[]if failure=='cancel'else['postflight'])
     self.assertEqual(events,['enter-transition','enter-generation','exit-generation','exit-transition'])
     audit=base/'own'/('captures/capture'if target=='qualify'else'attempts/attempt')
     self.assertFalse((audit/'result.json').exists())
     if failure=='postflight'and target=='execute':self.assertTrue((audit/'business-return.json').exists())

 def test_pure_workload_stop_ACK_authenticates_own_attempt_and_full_stop_proof(self):
  cfg=self.config();input_raw=m.encoded(cfg);input_sha=m.sha(input_raw)
  intent={'format':m.FORMAT+'-attempt','inputSha256':input_sha,'mode':'stop-workloads','readerRefs':cfg['readerRefs'],
   'metadataInverse':None,'cacheFinish':None,'automaticRetryAllowed':False,'reference':'a'*64}
  scope={'format':m.FORMAT+'-scope','validated':True,'inverseOnly':True,'wholeInverseQualified':False,
   'originalReader5InverseScopePassed':False,'catalog':{'apiLoginsEnabled':True,'ownedCacheReadsPresent':True},
   'inputSha256':input_sha,'readerRefs':cfg['readerRefs'],'sourcePrefixRefs':cfg['sourcePrefix'],
   'metadataInverseRefs':cfg['metadataInverse'],'cacheFinishRefs':cfg['cacheFinish'],
   'sourceOnlyCurrent':True,'currentWriterQualified':True}
  original_review={'binding':{'operationSha256':'c'*64}}
  original_review['reviewHash']=m.sha(m.encoded(original_review['binding']))
  inverse_sha=m.sha(m.encoded(original_review))
  proof={'before':copy.deepcopy(scope),'after':copy.deepcopy(scope),'inverseIntentSha256':inverse_sha,
   'originalInverseReview':original_review,'publicationUnchanged':True,
   'allOriginalReaderTerminalPredicatesPassed':True,'retainedCacheStopPredicatePassed':True}
  post={'format':m.FORMAT+'-postflight','validated':True,'inputSha256':input_sha,'operatorSha256':m.sha(self.local(m.FILE)),
   'originalSource6FinishPassed':False,'originalReader5WholeInversePassed':False,'scope':copy.deepcopy(scope)}
  proof['fullPostflightSha256']=m.sha(m.encoded(post))
  record={'format':m.FORMAT+'-stopped-workloads','completed':True,'operatorSha256':m.sha(self.local(m.FILE)),
   'inputSha256':input_sha,**{key:cfg[key]for key in ['readerRefs','sourcePrefix','cacheFinish','metadataInverse']},
   'operationSha256':'c'*64,'inverseIntentSha256':inverse_sha,'attemptId':'actual-stop-fixture',
   'attemptIntentSha256':m.sha(m.encoded(intent)),'stopProofSha256':m.sha(m.encoded(proof)),
   **{key:True for key in ['nativeReadersTerminal','nativeCacheTerminal','originalBusinessStopPrefixRetained','LOGINUnchanged',
    'cacheFourREADsUnchanged','globalGenerationUnchanged','serviceActionsMayHaveOccurred']},
   **{key:False for key in ['metadataProgramInversePerformed','forwardAuthorityQualified','wholeInverseQualified','automaticRetryAllowed']}}
  documents={m.INPUTS['stop-workloads']:input_raw,m.BASE/'stop-workloads-result.json':m.encoded(record),
   m.BASE/'attempts'/'actual-stop-fixture'/'intent.json':m.encoded(intent),
   m.BASE/'attempts'/'actual-stop-fixture'/'full-postflight.json':m.encoded(post),
   m.BASE/'attempts'/'actual-stop-fixture'/'stop-proof.json':m.encoded(proof)}
  def public(path,digest=None):
   raw=documents.get(Path(path))
   if raw is None:return self.local(path,digest)
   m.need(digest is None or m.sha(raw)==digest,'actual_private_fixture_digest_required');return raw
  with patch.object(m,'authenticate'),patch.object(m,'public',side_effect=public):
   accepted=m.stopped_acknowledgement(m.sha(m.encoded(record)),input_sha)
   self.assertTrue(accepted['immutableAcknowledgementOnly']);self.assertFalse(accepted['currentActorQualified'])
   for key,value in [('completed',1),('wholeInverseQualified',True),('automaticRetryAllowed',True),('future',True)]:
    bad={**record,key:value};documents[m.BASE/'stop-workloads-result.json']=m.encoded(bad)
    with self.subTest(key=key),self.assertRaises(RuntimeError):m.stopped_acknowledgement(m.sha(m.encoded(bad)),input_sha)
   documents[m.BASE/'stop-workloads-result.json']=m.encoded(record)
   mixed=copy.deepcopy(proof);mixed['after']['inputSha256']='f'*64
   altered={**record,'stopProofSha256':m.sha(m.encoded(mixed))}
   documents[m.BASE/'stop-workloads-result.json']=m.encoded(altered)
   documents[m.BASE/'attempts'/'actual-stop-fixture'/'stop-proof.json']=m.encoded(mixed)
   with self.assertRaisesRegex(RuntimeError,'actual_own_stop_attempt_full_scope'):
    m.stopped_acknowledgement(m.sha(m.encoded(altered)),input_sha)
   documents[m.BASE/'stop-workloads-result.json']=m.encoded(record)
   documents[m.BASE/'attempts'/'actual-stop-fixture'/'stop-proof.json']=m.encoded(proof)
   documents[m.BASE/'attempts'/'actual-stop-fixture'/'intent.json']=m.encoded({**intent,'mode':'cache-inverse'})
   with self.assertRaises(RuntimeError):m.stopped_acknowledgement(m.sha(m.encoded(record)),input_sha)

 def test_restored_recovery_comparison_is_only_the_actual_C2_epoch_before_original_inverse(self):
  f=self.fixture;bridge=self.authority_test.bridge_test.bridge;root=self.actual['root']
  epoch=f.fixture.epoch();op={'binding':{'metadata':{'metadataEpoch':epoch.forward.binding()}}}
  with patch.object(m,'public',side_effect=self.authority_test.bridge_test.public),\
       patch.object(m,'module',side_effect=lambda name:load(name)):
   controller=types.SimpleNamespace(root=root,config={'stage':'restore-original'},
    authority=types.SimpleNamespace(config={'metadataRestoredRefs':copy.deepcopy(epoch.refs)}))
   _,finish=m.business_segments(controller)
  recover=finish.__globals__['recover_metadata'];original=root.recover_metadata
  with tempfile.TemporaryDirectory()as temporary:
   base=Path(temporary);owner_base=base/'metadata';owner_base.mkdir();(base/'inverse-global-restored.json').write_text('{}')
   calls=[];owner=types.SimpleNamespace(BASE=owner_base,lock=contextlib.nullcontext,inverse=lambda *_args,**kwargs:calls.append(kwargs))
   host=types.SimpleNamespace(metadata_epoch=epoch,private=Mock());raw=copy.deepcopy(f.fixture.actual_actor)
   selected={'nativeActor':copy.deepcopy(f.fixture.forward.historical)}
   metadata_op={'oldWriter':{'actualRetainedPrivateIOFixture':True}}
   context=types.SimpleNamespace(inverse_scope=Mock(),cache=types.SimpleNamespace(stopped=Mock(),META=base/'meta',META_OWNER_SHA='d'*64),
    host=host,metadata_inverse_context=lambda:(owner,host,metadata_op),
    prepared={'config':{'metadataSelectionSha256':'e'*64}},generation=lambda:(None,{'metadataOperationSha256':epoch.ack['metadataOperationSha256']},None,None))
   documents={};globals_io={'BASE':base,'boot':lambda:'same-boot','all_readers_terminal':Mock(),
    'metadata_inverse_actor':lambda *_:raw,'public_input':lambda _:b'actual owned predecessor bytes',
    'document':lambda path,*_:selected if Path(path).name=='selected.json'else documents[Path(path).name],
    'save':lambda name,value:documents.update({name:copy.deepcopy(value)}),
    'validate_metadata_restored':lambda _:{'actualRestoredOriginalMetadataIOFixture':True}}
   with patch.dict(recover.__globals__,globals_io):
    recover(context,op)

   self.assertEqual(len(calls),1);self.assertFalse(calls[0]['finish'])
   self.assertEqual(epoch.ack['actor'],f.fixture.ack['actor']);self.assertNotEqual(raw,selected['nativeActor'])
   self.assertEqual(host.private.call_count,1)
   # The original selected-PID/autorestart gate still refuses this owned restart.
   legacy_raw=copy.deepcopy(raw);legacy_raw['unit'].update(NRestarts='0',ExecMainStartTimestampMonotonic='1')
   with patch.dict(original.__globals__,{**globals_io,'metadata_inverse_actor':lambda *_:legacy_raw,
        'document':lambda path,*_:selected if Path(path).name=='selected.json'else {'bootId':'same-boot','monotonicUs':0}}),\
        self.assertRaisesRegex(RuntimeError,'only_exact_owned_auto_restarted'):
    original(context,op)
   # After original9b's owned intent, this initial-C2 comparator is unavailable.
   with patch.dict(recover.__globals__,globals_io),patch.object(epoch,'legacy_started',return_value=True),\
        self.assertRaisesRegex(RuntimeError,'only_actual_completed_C2_epoch'):
    recover(context,op)

 def test_actual_original_inverse_SQL_boundaries_dispatch_once_with_explicit_transport_IO(self):
  root=self.actual['root'];protocol=load(m.PROTOCOL)
  with tempfile.TemporaryDirectory()as temporary,contextlib.ExitStack()as stack:
   own=Path(temporary)/'owner';business=Path(temporary)/'business';business.mkdir()
   stack.enter_context(patch.object(m.os.path,'lexists',side_effect=lambda path:Path(path).exists()or Path(path).is_symlink()))
   docs={};events=[];state={'LOGIN':True,'cache':True}
   def save(name,value,**_kwargs):
    docs[name]=copy.deepcopy(value);return m.write(business/name,value)
   def document(path,*_args):return copy.deepcopy(docs[Path(path).name])
   def read(path):
    p=Path(path)
    return p.read_bytes()if p.is_file()else b'explicit immutable original private IO fixture'
   def scope(reads=True):
    if reads is None:reads=state['cache']
    self.assertEqual(reads,state['cache'])
    return{'format':m.FORMAT+'-scope','validated':True,'inverseOnly':True,'wholeInverseQualified':False,
     'originalReader5InverseScopePassed':False,'originalWholeValidatorPassed':False,'inputSha256':'2'*64,
     'sourceOnlyCurrent':True,'currentWriterQualified':True,
     'catalog':{'apiLoginsEnabled':state['LOGIN'],'ownedCacheReadsPresent':state['cache']}}
   operation={'binding':{'operatorSha256':'a'*64,'afterLoginCatalog':{'LOGIN':True},'beforeLoginCatalog':{'LOGIN':False}}}
   initial={'binding':{'publication':{'published':True}}}
   save('inverse-intent.json',initial);save('roles-admitted.json',{'afterCatalogSha256':'b'*64})
   cache_base=Path(temporary)/'cache';cache_base.mkdir();(cache_base/'sql-committed.json').write_text('{}')
   cache=types.SimpleNamespace(BASE=cache_base,stopped=Mock())
   host=types.SimpleNamespace(read=types.SimpleNamespace(acl_catalog=lambda value:value),read_rehearsal={'after':{'actual143ACLIOFixture':True}},
    read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=contextlib.nullcontext)}),catalog_sql='unchanged full catalog SQL I/O fixture')
   sql_ack={'resultJson':'{"actualPlanIOFixture":true}','result':{'actualPlanIOFixture':True}}
   candidate={'generationId':'104','capsuleResultSha256':'c'*64}
   capsule={'currentGeneration':'103','previousGeneration':'102','externalBinding':{'actualCapsuleIOFixture':True}}
   context=types.SimpleNamespace(host=host,cache=cache,inverse_scope=scope,sql_ack=sql_ack,inputs={'cachePreparedSha256':'d'*64},
    proof=types.SimpleNamespace(CACHE_SHA='e'*64,DEPENDENCIES={'ypal-native-generation-v1.py':'a'*64},
     module=lambda *_:types.SimpleNamespace(lock=contextlib.nullcontext)),prepared={'config':{'generationSha256':'f'*64,'readAdmissionSha256':'1'*64}},
    generation_terminal=Mock(),generation=lambda:(None,candidate,None,capsule),logins_enabled=lambda:state['LOGIN'],catalog=lambda:{'LOGIN':state['LOGIN']})
   def child(c,mode,plan,prepared):
    events.append(mode)
    if mode=='roles-inverse':
     self.assertIs(prepared({'mode':mode,'before':operation['binding']['afterLoginCatalog'],'after':operation['binding']['beforeLoginCatalog'],'xid':'101'}),True)
     state['LOGIN']=False;return{'committed':True,'after':operation['binding']['beforeLoginCatalog'],'xid':'101'}
    self.assertEqual(mode,'capsule-inverse');self.assertIs(prepared({'mode':mode,'event':'capsule-prepared','xid':'103'}),True)
    return{'restored':True,'allDerivedIdentityColumnsRestored':True,'ownedGenerationRetained':'104',
     'currentGeneration':'103','previousGeneration':'102'}
   def cache_child(h,mode,plan,prepared,plan_json):
    self.assertEqual(mode,'inverse');self.assertIs(h,host);events.append('cache-inverse')
    self.assertEqual(plan_json,sql_ack['resultJson'])
    prepared({'mode':'inverse','planSha256':m.sha(plan_json.encode()),'postProof':{'catalog':host.read_rehearsal['after']},'xid':'102'})
    state['cache']=False;return{'mode':'inverse','xid':'102','acknowledged':True}
   cache.sql_child=cache_child
   globals_io={'BASE':business,'save':save,'document':document,'public_input':read,'boot':lambda:'same-boot',
    'all_readers_terminal':Mock(),'child':child,'published':lambda _:(None,{'result':{'ownedDerivedObservation':{}}},{}),
    'current_published':Mock()}
   stack.enter_context(patch.dict(root.inverse_role_bits.__globals__,globals_io))
   view=types.SimpleNamespace(**root.__dict__);view.BASE=business
   view.transition_lock=contextlib.nullcontext
   view.inverse_operation=lambda _:(operation,initial);view.all_readers_terminal=Mock()
   controller=types.SimpleNamespace(root=view,context=context,host=host,cache=cache,operation=operation,
    config=self.config('restore-original'),authority=types.SimpleNamespace(),input_sha='2'*64,inputs=Mock(),proof=context.proof)
   stack.enter_context(patch.object(m,'BASE',own));stack.enter_context(patch.object(m,'authenticate'))
   stack.enter_context(patch.object(m,'public',side_effect=self.authority_test.bridge_test.public))
   stack.enter_context(patch.object(m,'module',side_effect=lambda name:load(name)))
   timing=stack.enter_context(patch.object(m,'require_timing',return_value={'explicitAuthenticatedOwnModeReceiptIOFixture':True}))
   for mode in m.MODES:
    result=m.execute(controller,mode,mode,{'captureId':mode,'sha256':'3'*64})
    self.assertTrue(result['completed']);self.assertFalse(result['originalReader5WholeInversePassed'])
   self.assertEqual(events,list(m.MODES));self.assertEqual(timing.call_count,3)
   self.assertEqual(docs['inverse-global-restored.json']['currentGeneration'],'103')
   self.assertFalse(state['LOGIN']);self.assertFalse(state['cache'])
   with self.assertRaises(RuntimeError):m.execute(controller,'cache-inverse','cache-inverse',{'captureId':'cache-inverse','sha256':'3'*64})
   self.assertEqual(len(events),3)

 def test_retained_stop_and_serving_segments_keep_all_cuts_and_never_save_old_complete_ACK(self):
  root=self.actual['root'];proof=self.actual['proof'];controller=types.SimpleNamespace(root=root)
  with patch.object(m,'public',side_effect=self.authority_test.bridge_test.public),patch.object(m,'module',side_effect=lambda name:load(name)):
   stop,finish=m.business_segments(controller)
  with tempfile.TemporaryDirectory()as temporary:
   base=Path(temporary);events=[];docs={}
   for name in proof.PEERS:
    for prefix in ['preview-','reader-']:(base/(prefix+name+'-started.json')).write_text('{}')
   def save(name,value):docs[name]=copy.deepcopy(value);return m.write(base/name,value)
   cache_finish=types.SimpleNamespace(drain_for_inverse=lambda _:events.append('cache-drain'),
    restore_old=lambda *_:events.append('legacy-cache-restore'))
   def stop_reader(_context,_op,name,preview=False,original=False,reconcile=False):
    events.append(('stop',name,preview,original));prefix='original-'if original else'preview-'if preview else'reader-'
    (base/(prefix+name+'-stopped.json')).write_text('{}')
   definitions=lambda _op,name,preview:[(name+'-conf','/fixture/'+name+'.conf',{}),(name+'-env','/fixture/'+name+'.env',{})]
   globals_io={'BASE':base,'inverse_disable_boots':lambda *_:events.append('disable-boots'),
    'cache_finish_module':lambda _:cache_finish,'stop_reader':stop_reader,'descriptor_files':definitions,
    'unlink_owned_file':lambda label,path:events.append(('unlink',path)),'save':save,'boot':lambda:'same-boot',
    'manager':lambda *args:events.append(args),'original_loaded':lambda *_:events.append('original-loaded'),
    'all_readers_terminal':lambda *_:events.append('all-terminal'),
    'recover_metadata':lambda *_:events.append('metadata-recovery'),
    'restore_legacy_readers':lambda *_:events.append('legacy-readers-restore'),
    'legacy_serving':lambda *_:{'realServingAccepted':True,'explicitHTTPActorIOFixture':True},
    'public_input':lambda _:b'explicit original immutable effect receipt bytes'}
   context=types.SimpleNamespace(inverse_scope=lambda _:events.append('full-inverse-scope'),proof=proof)
   initial={'binding':{'publication':{'published':True}}};op={'binding':{'operatorSha256':'a'*64}}
   with patch.dict(stop.__globals__,globals_io):stop(context,op,initial,proof)
   self.assertEqual(events[0:3],['full-inverse-scope','disable-boots','cache-drain'])
   self.assertEqual(sum(isinstance(event,tuple)and event[0]=='stop'for event in events),len(proof.PEERS)*3)
   self.assertEqual(events[-1],'all-terminal')
   self.assertNotIn('roles-inverse-intent.json',docs);self.assertNotIn('cache-inverse-intent.json',docs)
   with patch.dict(finish.__globals__,globals_io):value=finish(context,op,proof)
   self.assertTrue(value['fullLegacyServingAccepted']);self.assertIn('legacy-cache-restore',events)
   self.assertNotIn('inverse-result.json',docs)
   self.assertEqual([event for event in events if event=='metadata-recovery'],['metadata-recovery'])
   # Run the public stop dispatcher and its pure ACK as one real file chain.
   # Manager/process/global-observation I/O remains explicit and scoped.
   original_review={'binding':{'publication':initial['binding']['publication'],'operationSha256':'c'*64}}
   original_review['reviewHash']=m.sha(m.encoded(original_review['binding']))
   view=types.SimpleNamespace(**root.__dict__);view.__dict__.update(globals_io)
   view.recover_metadata=root.recover_metadata
   view.transition_lock=root.transition_lock
   view.inverse_review=lambda *_:copy.deepcopy(original_review)
   view.publication_inverse_state=lambda _:copy.deepcopy(original_review['binding']['publication'])
   view.public_input=lambda path:Path(path).read_bytes()
   source_scope=self.scope()[1]
   context.generation_terminal=Mock()
   host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=contextlib.nullcontext)}))
   cfg=self.config();raw=m.encoded(cfg);digest=m.sha(raw)
   def current_scope(_):
    # Scope identity is protected-input I/O in this dispatcher/file-chain unit
    # control; the complete real Core/catalog scope has separate controls.
    result=copy.deepcopy(source_scope);result.update(inputSha256=digest,readerRefs=cfg['readerRefs'],
     sourcePrefixRefs=cfg['sourcePrefix'],metadataInverseRefs=cfg['metadataInverse'],cacheFinishRefs=cfg['cacheFinish'])
    return result
   context.inverse_scope=current_scope
   generation=load('ypal-native-generation-v1.py')
   locked_proof=types.SimpleNamespace(PEERS=proof.PEERS,DEPENDENCIES=proof.DEPENDENCIES,
    module=lambda name,digest:generation if name=='ypal-native-generation-v1.py'and digest==m.SOURCE_PINS[name]else self.fail('foreign generation lock module'))
   controller=types.SimpleNamespace(root=view,context=context,host=host,cache=types.SimpleNamespace(stopped=Mock()),proof=locked_proof,
    operation=op,ack={'operationSha256':'c'*64},config=cfg,input_sha=digest,authority=None,inputs=Mock())
   own_base=base/'new-caller';events_before=len(events)
   combined=base/'original-shared.lock';generation_path=base/'original-generation.lock'
   def path_io(path):return combined if str(path)=='/run/lock/yunipals-ypal-combined-transition.lock'else Path(path)
   def prove_both_held(*_args):
    for path in [combined,generation_path]:
     fd=os.open(path,os.O_RDWR)
     try:
      with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
     finally:os.close(fd)
    return copy.deepcopy(original_review)
   view.inverse_review=prove_both_held
   def public(path,pin=None):
    path=Path(path)
    if path==m.INPUTS['stop-workloads']:result=raw
    elif path.parent==m.OPS:return self.local(path,pin)
    else:result=path.read_bytes()
    m.need(pin is None or m.sha(result)==pin,'actual_stop_dispatch_private_chain_digest_required');return result
   with patch.object(m,'BASE',own_base),patch.object(m,'authenticate'),patch.object(m,'public',side_effect=public),\
        patch.object(m,'module',side_effect=lambda name:load(name)),\
        patch.dict(root.transition_lock.__wrapped__.__globals__,Path=path_io),patch.object(generation,'LOCK',generation_path),\
        patch.object(m.os.path,'lexists',side_effect=lambda path:Path(path).exists()or Path(path).is_symlink()):
    reviewed=m.review_stop(controller)
    result=m.execute(controller,'stop-workloads','real-stop-chain',reviewed['reviewHash'])
    accepted=m.stopped_acknowledgement(result['sha256'],digest)
    self.assertTrue(accepted['immutableAcknowledgementOnly']);self.assertFalse(accepted['wholeInverseQualified'])
    self.assertEqual(accepted['operationSha256'],'c'*64)
    with self.assertRaises(RuntimeError):m.execute(controller,'stop-workloads','real-stop-chain',reviewed['reviewHash'])
   self.assertNotIn('inverse-result.json',docs)

 def test_actual_Context_constructor_provider_Phase_Host_and_authority_binding_both_stages(self):
  f=self.fixture;family=f.exported['family'];bridge=f.authority_test.bridge_test.bridge if hasattr(f,'authority_test')else self.authority_test.bridge_test.bridge
  provider=family.actual[bridge.PROVIDER]
  for stage in ['stop-workloads','restore-original']:
   with self.subTest(stage=stage),contextlib.ExitStack()as stack:
    reader=family.actual[m.READER];actual_root,proof=reader.core(m.SOURCE_PINS[m.READER_MANIFEST])
    cfg=self.config(stage);cfg['readerRefs']=copy.deepcopy(f.config['readerRefs'])
    inputs={key:'a'*64 for key in load('ypal-ordinary-reader-proof-v6.py').INPUT_KEYS}
    inputs.update(sourceManifestSha256=proof.manifest_sha,cacheInputsSha256='b'*64,
     publisherInstallSha256=proof.PUBLISHER_INSTALL_SHA,mainInstallSha256=proof.MAIN_INSTALL_SHA,
     **{key:f.case.config[key]for key in ['readPlanSha256','readContextInputSha256']})
    operation=copy.deepcopy(f.operation);operation['binding']['inputs']=inputs
    ack=copy.deepcopy(f.reader_ack);ack['operationSha256']=m.sha(m.encoded(operation))
    root=types.SimpleNamespace(**actual_root.__dict__);root.operation=lambda _:copy.deepcopy(operation)
    inverse_intent_raw=b'explicit actual original inverse intent private IO fixture\n'
    root.public_input=lambda path:inverse_intent_raw if Path(path).name=='inverse-intent.json'else m.encoded(operation)
    root.inverse_operation=lambda _:(copy.deepcopy(operation),{'explicitInverseIntentIOFixture':True})
    program={'forwardRefs':copy.deepcopy(f.fixture.forward.refs),'restoredRefs':copy.deepcopy(f.fixture.refs)if stage=='restore-original'else None,
     'proof':{'phase':'owned-upgrade-current'}}
    actor_runtime=types.SimpleNamespace(metadata_program=Mock(return_value=program))
    mapper=types.SimpleNamespace(composition=lambda:actor_runtime,bind_cache_finish=Mock())
    new_authorities=[]
    def authority_factory(input_sha):
     module=self.authority_test.load('ypal-ordinary-cache-inverse-authority-v1.py')
     facade=family.source(module.FORWARD);facade.public=family.public;facade.factory=lambda:family.compiler
     registry={module.BRIDGE:bridge,module.EFFECT:f.effect,module.READER:types.SimpleNamespace(
      acknowledgement=lambda *_:copy.deepcopy(ack),core=lambda _:(root,proof)),module.FORWARD:facade}
     module.module=lambda name:registry[name]
     old_public=module.public
     def public(path,digest=None):
      if Path(path)==module.INPUT:return f.input_raw
      return self.authority_test.bridge_test.public(path,digest)
     module.public=public;value=module.Context(f.input_sha)
     value.value.public=self.authority_test.bridge_test.public;document=value.value.document
     value.value.document=lambda path,digest=None:copy.deepcopy(f.case.config)if Path(path)==value.value.PRIOR_INPUT else document(path,digest)
     new_authorities.append(value);return value
    if stage=='restore-original':cfg['inverseAuthorityInputSha256']=f.input_sha
    payload=m.encoded(cfg);digest=m.sha(payload)
    def public(path,pin=None):
     if Path(path)==m.INPUTS[stage]:self.assertEqual(pin,digest);return payload
     return self.local(path,pin)
    registry={m.READER:types.SimpleNamespace(acknowledgement=lambda *_:copy.deepcopy(ack),core=lambda _:(root,proof)),
     m.CORE:types.SimpleNamespace(),m.MAPPER:mapper,m.AUTHORITY:types.SimpleNamespace(Context=authority_factory),m.BRIDGE:bridge}
    observer={'format':'yunipals-ypal-ordinary-observer-retained-prefix-v1','mode':'new',
     'recordedActivationQualified':True,'observerScopeOnly':True,'ordinarySustainedObserver':True,
     'receiptSha256':inputs['sustainedObserverSha256'],'operatorSha256':proof.manifest['contexts']['observer']['sha256'],
     'releaseId':proof.RELEASE,'observerCurrentQualified':False,'sourceActorQualified':False,'currentWriterQualified':False,
     'databaseWrites':0,'serviceActions':0,'providerRequests':0}
    original_context=proof.module_context
    proof.module_context=lambda role:provider if role=='phase'else types.SimpleNamespace(acknowledgement=lambda _:observer)if role=='observer'else original_context(role)
    proof.transport_current=Mock(return_value={'explicitHistoricalDependencyAndPeerReceiptIOFixture':True})
    proof.module=lambda *_:types.SimpleNamespace(installed=Mock(return_value={'explicitInstalledArtifactReceiptIOFixture':True}))
    stack.enter_context(patch.object(bridge,'utility',return_value=f.exported['utility']))
    stack.enter_context(patch.object(bridge,'consumer_utility',return_value=f.exported['utility']))
    stack.enter_context(patch.object(family.meta.actual,'utility',return_value=f.fixture.forward.utility))
    stack.enter_context(patch.object(family.e,'consumer_utility',return_value=f.exported['utility']))
    if stage=='restore-original':
     stack.enter_context(patch.object(m,'stopped_acknowledgement',return_value={
      **{key:copy.deepcopy(cfg[key])for key in ['readerRefs','sourcePrefix','cacheFinish']},
      'metadataInverse':None,'operationSha256':ack['operationSha256'],
      'inverseIntentSha256':m.sha(inverse_intent_raw),
      'explicitImmutableStopReceiptIOFixture':True}))
    actual_create=provider.create_phase;actual_namespace=provider.namespace;created=[]
    # Keep both actual provider factories/Phase and the genuine Host __init__.
    # Its private/static initialization dependency is the explicit IO seam;
    # no whole SOURCE/current observation is represented by that fixture.
    def namespace_io(*args,**kwargs):
     class SourceIOProvider:
      def __getattr__(self,name):return getattr(provider,name)if hasattr(provider,name)else getattr(f.case.frozen_provider,name)
      def namespace(self,*_args,**_kwargs):return actual_namespace(*args,**kwargs)
     with patch.dict(f.case.base.actual_provider.__globals__,p=SourceIOProvider()):
      namespace=f.case.base.actual_provider(kwargs.get('inverse',args[3]if len(args)>3 else False))
     cache=namespace.cache_runtime()
     def private_initialize(host,config):
      host.config=config;host.cache=cache;host.inverse_mode=cache.inverse_mode
      host.m=types.SimpleNamespace(explicitInstalledPrivatePrimitivesIOFixture=True)
     stack.enter_context(patch.dict(cache.Host.__init__.__globals__,initialize_current=private_initialize))
     cache.owned=Mock(return_value=({},{}))
     prepared={'format':namespace.FORMAT,'operatorSha256':m.sha(self.local(Path(namespace.__file__))),
      'prepared':True,'nativeGenerationPublished':False,'nativeWorkerStarted':False,'config':f.case.config,
      'additionalReadAcknowledgementSha256':'c'*64}
     def document(path,pin):
      if Path(path).name=='prepared.json':return copy.deepcopy(prepared)
      if Path(path).name=='sql-committed.json':return {'explicitCommittedCacheReceiptIOFixture':True}
      if Path(path)==namespace.INPUT:return copy.deepcopy(f.case.config)
      raise AssertionError(str(path))
     sdk=types.SimpleNamespace(protected=self.local,document=document,
      BASE=self.authority_test.load('ypal-ordinary-read-admission-v5b.py').BASE)
     stack.enter_context(patch.dict(namespace.Phase.__init__.__globals__,cache_runtime=lambda:cache,read_module=lambda:sdk))
     created.append(cache);return namespace
    static=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=lambda *_:copy.deepcopy(f.case.config)))
    if stage=='restore-original':
     original_bind=bridge.bind_provider
     def bind_provider(actual,refs):
      nonlocal actual_namespace
      bound=original_bind(actual,refs);actual_namespace=bound.namespace
      stack.enter_context(patch.dict(bound.namespace.__globals__,common=lambda:static))
      stack.enter_context(patch.dict(bound.create_phase.__globals__,namespace=namespace_io,common=lambda:static));return bound
     stack.enter_context(patch.object(bridge,'bind_provider',side_effect=bind_provider))
    else:stack.enter_context(patch.dict(actual_create.__globals__,namespace=namespace_io,common=lambda:static))
    stack.enter_context(patch.object(m,'authenticate',return_value=None));stack.enter_context(patch.object(m,'public',side_effect=public))
    stack.enter_context(patch.object(m,'module',side_effect=lambda name:registry[name]))
    controller=m.Context(digest,stage)
    self.assertEqual(len(created),1);self.assertIs(controller.cache,created[0]);self.assertIs(controller.context.host,controller.host)
    self.assertEqual(controller.host.inverse_mode,stage=='restore-original')
    self.assertEqual(controller.context.phase.cache.metadata_epoch.refs,program['restoredRefs']or program['forwardRefs'])
    if stage=='restore-original':self.assertIs(controller.cache.continuation_authority,controller.authority.value)
    else:self.assertIsNone(controller.authority)
if __name__=='__main__':unittest.main(verbosity=2)
