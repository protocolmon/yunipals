"""Only extracted source/API fixtures; never run the root driver or SSH."""
import ast,copy,hashlib,importlib.util,json,re,subprocess,time,traceback,types,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch

FILE=Path(__file__).resolve().with_name('ypal-cont5-reader-qualification-owner-v1.py')
OPS=Path(__file__).resolve().parent
source=FILE.read_bytes();outer=ast.parse(source)
remote=ast.literal_eval(next(n.value for n in outer.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='REMOTE'for x in n.targets)))
tree=ast.parse(remote)
encoded=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
sha=lambda raw:hashlib.sha256(raw).hexdigest()
P=lambda s:sha(('explicit-reader-qualification-fixture:'+s).encode())
def module(name):
 spec=importlib.util.spec_from_file_location(name,OPS/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

class Controls(unittest.TestCase):
 def helper(self,name,namespace):
  nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in{'need','sha','encoded','pin',name}]
  exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'actual_reader_source_fixture','exec'),namespace)
  return namespace[name]

 def auth_fixture(self):
  ns={'json':json,'hashlib':hashlib,'re':re};docs={}
  constants={n.targets[0].id:ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and isinstance(n.value,ast.Constant)}
  ns.update(constants);ns['COMMIT_AUDIT']=Path('/explicit-fixture/commit');ns['CACHE_BASE']=Path('/explicit-fixture/cache')
  refs={'mode':'current',**{k:P(k)for k in['resultSha256','inputSha256','producerSha256','manifestSha256']}};ns['refs']=refs
  binding={'refs':refs,'acknowledgement':{'explicitPureBinding':True}}
  config={'generationSha256':P('candidate')};before={'binding':{'operatorSha256':ns['PROVIDER_SHA'],'config':config,
   'prerequisites':{'metadataCurrentProof':{'metadataEpoch':binding}}}}
  def put(path,value):raw=encoded(value);docs[Path(path)]=raw;return sha(raw)
  before_sha=put(ns['CACHE_BASE']/'before.json',before)
  committed={'operatorSha256':ns['PROVIDER_SHA'],'mode':'apply','xid':'800003','acknowledged':True,'reconciledAfterUnknownAck':False,'reviewHash':P('review')}
  committed_sha=put(ns['CACHE_BASE']/'sql-committed.json',committed)
  prepared={'format':'yunipals-ypal-ordinary-read-cache-continue-v5','prepared':True,'operatorSha256':ns['PROVIDER_SHA'],
   'additionalReadCount':4,'additionalReadAcknowledgementSha256':committed_sha,'beforeSha256':before_sha,'config':config,'reviewHash':P('review'),
   **{k:False for k in['nativeWorkerStarted','nativeGenerationPublished','original143WholeValidatorPassed']},
   **{k:True for k in['legacy103ServingAccepted','cacheBootDisabled','coordinatedPublicationAndReaderSwitchStillRequired']}}
  prepared_sha=put(ns['CACHE_BASE']/'prepared.json',prepared)
  fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='authenticate_commit')
  fixed=ast.literal_eval(next(n.value for n in fn.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='fixed'for t in n.targets)))
  proofs={key:{'explicitReceiptFixture':key}for key in fixed}
  proofs.update({'prepared-ACK':prepared,'sql-committed':committed,'caller-attempt':{
   'format':'yunipals-ypal-ordinary-publication-continue-v5','completed':True,'action':'commit','businessResultPresent':True,
   'automaticEffectRetryAllowed':False,'postflight':{'validated':True,'metadataEpoch':binding,'metadataActorCurrent':{'currentActorQualified':True}}}})
  root={'format':'root-CONT5-cache-commit-v1','completed':True,'callerSha256':ns['CALLER_SHA'],'readerManifestSha256':ns['MANIFEST_SHA'],
   'metadataRefsSha256':sha(encoded(refs)),'commitReturned':True,'preparedACKCreatedByGenuineCommit':True,'fullSourcePostflightQualified':True,
   'realCOMMITInvoked':True,'transactionStatus':'committed','transactionId':'800003','additionalReadCount':4,
   'coordinatedPublicationAndReaderSwitchStillRequired':True,'serviceActionsDispatched':0,
   'preparedFileSha256':prepared_sha,'sqlCommittedFileSha256':committed_sha,
   **{key:False for key in['automaticRetryAllowed','nativeWorkerStarted','nativeGenerationPublished','LOGINDispatched',
    'providerRefreshRequested','baselineDispatched','qualificationDispatched','secondPrepareACKDispatched']},
   'proofHashes':{key:put(ns['COMMIT_AUDIT']/fixed[key],value)for key,value in proofs.items()}}
  def save():ns['commit_local']={**root,'resultSha256':put(ns['COMMIT_AUDIT']/'result.json',root)}
  def protected(path,digest=None):
   raw=docs[Path(path)]
   if digest is not None and sha(raw)!=digest:raise RuntimeError('fixture_actual_digest_required')
   return raw
  ns.update({'protected':protected,'document':lambda path,digest=None:json.loads(protected(path,digest))})
  save();fn=self.helper('authenticate_commit',ns)
  return fn,ns,root,prepared,proofs,docs,put,save

 def test_complete_actual_commit_schema_and_sixteen_proof_map_before_context(self):
  fn,ns,root,prepared,*_=self.auth_fixture();actual,ack,binding=fn()
  self.assertEqual(actual,root);self.assertEqual(ack,prepared);self.assertEqual(binding['refs'],ns['refs'])
  # Compare the consumer map with the actual reviewed commit producer's writes.
  commit=ast.parse((OPS/'ypal-cont5-cache-commit-owner-v1.py').read_bytes())
  cr=ast.parse(ast.literal_eval(next(n.value for n in commit.body if isinstance(n,ast.Assign)and n.targets[0].id=='REMOTE')))
  keys={n.targets[0].slice.value for n in ast.walk(cr)if isinstance(n,ast.Assign)and isinstance(n.targets[0],ast.Subscript)and
   isinstance(n.targets[0].value,ast.Name)and n.targets[0].value.id=='proof_hashes'and isinstance(n.targets[0].slice,ast.Constant)}
  keys-={'metadata-history-save-refusal','failure-journal-observations','observation-save-refusal'}
  self.assertEqual(set(root['proofHashes']),keys);self.assertEqual(len(keys),16)

 def test_failed_qualification_unknown_and_mutated_private_ACK_refuse(self):
  for mutate in[lambda r:r.update(completed=False),lambda r:r.update(format='root-CONT5-held-rollback-qualification-v2'),
   lambda r:r.update(transactionStatus='aborted'),lambda r:r.update(preparedACKCreatedByGenuineCommit=False),
   lambda r:r.update(nativeGenerationPublished=True),lambda r:r['proofHashes'].pop('held-audits')]:
   fn,_,root,_,_,_,_,save=self.auth_fixture();mutate(root);save()
   with self.assertRaises(RuntimeError):fn()
  fn,ns,*rest=self.auth_fixture();docs=rest[3];docs[ns['CACHE_BASE']/'prepared.json']=encoded({'foreign':True})
  with self.assertRaises(RuntimeError):fn()

 def test_outer_commit_gate_canonical_and_missing_success_refuses_before_transport(self):
  body=[n for n in outer.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef))and not isinstance(n,ast.FunctionDef)or
   isinstance(n,ast.FunctionDef)and n.name in{'encoded','successful_commit'}]
  ns={};exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),'reader_outer_fixture','exec'),ns)
  _,scope,*_=self.auth_fixture();value=scope['commit_local'];ns['read_private']=Mock(return_value=value)
  self.assertEqual(ns['successful_commit'](Path('/never-read')),value)
  for mutate in[lambda r:r.update(completed=False),lambda r:r.update(transactionStatus='unknown'),lambda r:r.update(extraField=True)]:
   bad=copy.deepcopy(value);mutate(bad);ns['read_private'].return_value=bad
   with self.assertRaises(RuntimeError):ns['successful_commit'](Path('/never-read'))

 def test_one_forward_reader_measurement_no_effect_or_inverse_dispatch(self):
  calls=[n for n in ast.walk(tree)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)]
  self.assertEqual(sum(isinstance(n,ast.Attribute)and n.attr=='qualify_reader'for n in ast.walk(tree)),1)
  self.assertEqual(sum(isinstance(n,ast.Attribute)and n.attr=='Session'for n in ast.walk(tree)),1)
  self.assertFalse({'execute_reader','execute_cache','qualify_held','construct_records','Popen','manager','official'}&{n.func.attr for n in calls})
  compile(source,str(FILE),'exec');compile(remote,str(FILE)+':REMOTE','exec')

 def live_fixture(self,wrong_tuple=False,wrong_epoch=False,login=False,late=False,error=None):
  main=next(n for n in tree.body if isinstance(n,ast.Try))
  def stage(n,label):return isinstance(n,ast.Assign)and isinstance(n.value,ast.Constant)and n.value.value==label and any(isinstance(x,ast.Name)and x.id=='stage'for x in n.targets)
  start=next(i for i,n in enumerate(main.body)if stage(n,'fresh-forward-reader-Session'))
  helpers=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in{'need','encoded','sha','pin','phase'}]
  code=compile(ast.fix_missing_locations(ast.Module(body=helpers+[ast.Try(body=main.body[start:],handlers=main.handlers,orelse=[],finalbody=[])],type_ignores=[])),'actual_reader_live_block_fixture','exec')
  inputs={key:P(key)for key in ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign)and n.targets[0].id=='INPUT_KEYS'))}
  inputs['sourceManifestSha256']=P('manifest');binding={'refs':{'explicitCurrentEpochFixture':True}}
  epoch=types.SimpleNamespace(binding=lambda:copy.deepcopy(binding));cache=types.SimpleNamespace(metadata_epoch=epoch)
  context=types.SimpleNamespace(cache=cache,prepared={'explicitActualPreparedFileFixture':True},logins_enabled=Mock(return_value=login))
  root=types.SimpleNamespace(BASE=Path('/explicit-fixture/absent-reader-base'));proof=object()
  key={'target':'reader','direction':'forward','manifestSha256':inputs['sourceManifestSha256'],'inputsSha256':sha(encoded(inputs))}
  receipt={'syntheticTimingInputOnly':True,'productionCOMMITQualified':False,'elapsedNanoseconds':170_000_000_000 if late else 1_000_000,
   'reservedEffectNanoseconds':70_000_000_000,'observation':{'allOriginalPrepublicationPredicates':True,'twoLOGINCurrentlyEnabled':False,'ownedBootAndReloadEffectsNotExecuted':True},
   'fullPostflight':{'validated':True,'metadataEpoch':binding,'metadataActorCurrent':{'currentActorQualified':True}},'databaseWrites':0,'serviceActions':0,'providerCalls':0}
  ref={'captureId':'cont5-reader-before-login-20261026-1','sha256':P('actualFixtureCapture')}
  caller_ns=types.SimpleNamespace(BASE=Path('/explicit-fixture/caller'),require_timing=Mock(return_value=receipt))
  session=types.SimpleNamespace(root=root,proof=proof,context=context,key=key,source=types.SimpleNamespace(inverse=False),
   metadata_epoch=types.SimpleNamespace(binding=lambda:{'foreign':True})if wrong_epoch else epoch,
   preflight=Mock(return_value={'validated':True}),reader_context=Mock(return_value=(root,proof)if wrong_tuple else(root,proof,context)),continuation_caller=caller_ns)
  caller=types.SimpleNamespace(Session=Mock(return_value=session),qualify_reader=Mock(side_effect=error)if error else Mock(return_value={'completed':True,'productionCOMMITQualified':False,**ref}))
  saved={};write=lambda name,value:saved.setdefault(name,sha(value if isinstance(value,bytes)else encoded(value)))
  ns={'json':json,'hashlib':hashlib,'re':re,'time':time,'traceback':traceback,'caller':caller,'report':{'sourceRefs':{'explicitSourceRefsFixture':True}},
   'refs':{'explicitCurrentEpochRefsFixture':True},'MANIFEST_SHA':inputs['sourceManifestSha256'],'inputs':inputs,'CAPTURE':ref['captureId'],
   'session':None,'AUDIT':Path('/explicit-fixture/audit'),'metadata_binding':binding,'prepared':context.prepared,'proof_hashes':{},'commit_local':{'resultSha256':P('actualRootFixture')},
   'commit':{'preparedFileSha256':P('prepared')},'CALLER_SHA':P('caller'),'tracked':{'fixture':{'sha256':P('file')}},
   'frame':lambda path,digest:{'sha256':digest},'write':write,'os':types.SimpleNamespace(path=types.SimpleNamespace(lexists=lambda _:False)),
   'phase_events':[],'qualifier_invoked':False,'qualification_ref':None,
   'document':lambda *args:receipt,'save_observations':Mock(return_value={'fixtureObserverRestored':True})}
  exec(code,ns);return ns,caller,session,saved

 def test_actual_live_block_context_capture_and_no_effects(self):
  ns,caller,session,saved=self.live_fixture();self.assertTrue(ns['result']['completed'])
  caller.Session.assert_called_once();session.preflight.assert_called_once();session.reader_context.assert_called_once()
  caller.qualify_reader.assert_called_once_with(session,'cont5-reader-before-login-20261026-1')
  session.continuation_caller.require_timing.assert_called_once_with(session,ns['qualification_ref'],'reader-before-login')
  self.assertIn('reader-timing.private.json',saved)
  for kwargs in[{'wrong_tuple':True},{'wrong_epoch':True},{'login':True}]:
   ns,caller,_,_=self.live_fixture(**kwargs);self.assertFalse(ns['result']['completed']);caller.qualify_reader.assert_not_called()
  ns,caller,_,_=self.live_fixture(late=True);self.assertFalse(ns['result']['completed']);caller.qualify_reader.assert_called_once()
  ns,caller,_,_=self.live_fixture(error=RuntimeError('fixture_original_qualifier_refusal'))
  self.assertFalse(ns['result']['completed']);self.assertTrue(ns['result']['qualificationCaptureInspectionRequired'])
  self.assertEqual(ns['result']['failureCode'],'fixture_original_qualifier_refusal');caller.qualify_reader.assert_called_once()

 def test_observer_cleanup_restores_original_before_private_snapshot_failure(self):
  fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='save_observations')
  class Trace:
   @property
   def calls(self):raise RuntimeError('fixture_private_diagnostic_save_refusal')
  original=Mock();run=types.SimpleNamespace(run=Mock())
  ns={'subprocess':run,'original_run':original,'command_trace':Trace()}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'actual_reader_cleanup_fixture','exec'),ns)
  with self.assertRaisesRegex(RuntimeError,'fixture_private_diagnostic_save_refusal'):ns['save_observations']('failure')
  self.assertIs(run.run,original)

 def test_missing_actual_commit_stops_actual_outer_main_before_SSH(self):
  fn=next(n for n in outer.body if isinstance(n,ast.FunctionDef)and n.name=='main')
  parser=types.SimpleNamespace(add_argument=Mock(),parse_args=lambda:types.SimpleNamespace(run=True))
  transport=Mock(side_effect=AssertionError('SSH after absent actual commit'))
  local=Mock(side_effect=FileNotFoundError('explicit_fixture_no_actual_successful_commit'))
  ns={'argparse':types.SimpleNamespace(ArgumentParser=lambda **_:parser),'__doc__':'source fixture','time':time,
   'os':types.SimpleNamespace(umask=Mock(),geteuid=lambda:0,path=types.SimpleNamespace(lexists=lambda _:False)),
   'RESULT':Path('/fixture/result'),'COMMIT_RESULT':Path('/fixture/absent-commit'),'successful_commit':local,
   'subprocess':types.SimpleNamespace(run=transport)}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'reader_actual_main_fixture','exec'),ns)
  with self.assertRaises(FileNotFoundError):ns['main']()
  local.assert_called_once();transport.assert_not_called()

 def test_outer_unknown_reply_retains_raw_without_automatic_repetition(self):
  fn=next(n for n in outer.body if isinstance(n,ast.FunctionDef)and n.name=='main');block=next(n for n in fn.body if isinstance(n,ast.Try))
  code=compile(ast.fix_missing_locations(ast.Module(body=[block],type_ignores=[])),'reader_actual_transport_fixture','exec')
  good={'format':'root-CONT5-reader-qualification-v1','completed':True}
  for stdout,status,stderr in[('[]',0,''),('not JSON',0,''),(json.dumps({**good,'completed':1}),0,''),
   (json.dumps(good),1,''),(json.dumps(good),0,'unexpected stderr')]:
   saved=[];run=Mock(return_value=types.SimpleNamespace(stdout=stdout,returncode=status,stderr=stderr))
   ns={'json':json,'Path':Path,'time':types.SimpleNamespace(monotonic=lambda:1),'started':0,'remote':'fixture_never_executed',
    'subprocess':types.SimpleNamespace(run=run,TimeoutExpired=subprocess.TimeoutExpired),'exclusive':lambda path,value:saved.append((path,value))}
   exec(code,ns);self.assertFalse(ns['result']['completed']);self.assertTrue(ns['result']['remoteAuditInspectionRequired'])
   self.assertFalse(ns['result']['automaticRetryAllowed']);self.assertEqual(saved[0][1]['stdout'],stdout);run.assert_called_once()

 def test_actual_genuine_caller_reader_qualify_and_protocol_mode(self):
  # The genuine derived CONT5 qualifier/measure/timing bodies execute. Only
  # actual Context/receipt/source I/O is replaced by explicit local fixtures.
  actual=module('ypal-ordinary-publication-continue-v5.test.py');control=actual.Controls();control.setUp()
  self.addCleanup(control.doCleanups);caller=actual.actual['ypal-ordinary-publication-continue-v5.py'];real=control.h.derive
  def derive(*args,**kwargs):
   result=real(*args,**kwargs)
   if args[1]=='6b261303f659ab2f8b9152733b5eeb6f3cb02be1c09f1ab38380dc41d3795e3a':result.helper=lambda:control.h
   return result
  with patch.object(control.h,'derive',side_effect=derive):bound=caller.composed(control.manifest_sha,control.refs)
  bound.own_sha=lambda:sha((OPS/caller.FILE.name).read_bytes())
  epoch=actual.meta.actual.Epoch(control.refs,control.manifest)
  with TemporaryDirectory(prefix='ypal-reader-callback-source-')as temp:
   base=Path(temp);capture=base/'capture';capture.mkdir(mode=0o700);documents={}
   def exclusive(path,value):raw=encoded(value);documents[Path(path)]=raw;return sha(raw)
   def public(path,digest):
    raw=documents[Path(path)]
    if sha(raw)!=digest:raise RuntimeError('fixture_exact_timing_digest')
    return raw
   context=types.SimpleNamespace(inputs={'explicitTenRefIOFixture':True},logins_enabled=Mock(return_value=False),
    host=types.SimpleNamespace(config={'generationBindingSha256':control.base.control.binding_sha}),cache=types.SimpleNamespace(legacy_http=Mock()))
   op={'binding':{'explicitGenuineReviewResultFixture':True}}
   root=types.SimpleNamespace(BASE=base/'absent-reader-base',review=Mock(return_value=op),prepublication=Mock())
   session=types.SimpleNamespace(key={'target':'reader','inputsSha256':P('inputs'),'direction':'forward'},
    root=root,proof=object(),context=context,metadata_epoch=epoch,source=types.SimpleNamespace(inverse=False),
    protocol=module('ypal-ordinary-publication-protocol-v6.py'),g=types.SimpleNamespace(exclusive=exclusive,public=public),
    finish=Mock(return_value={'validated':True,'metadataEpoch':epoch.binding()}))
   scope=bound.qualify.__globals__;prior_directory=scope['directory'];scope['directory']=lambda *_:capture
   oldbase=scope['BASE'];scope['BASE']=base
   try:
    measured=bound.qualify(session,'fixture-reader');reference={'captureId':'fixture-reader','sha256':measured['sha256']}
    # Retained directory fixture above is mapped to the actual capture path.
    documents[base/'captures'/'fixture-reader'/'result.json']=documents[capture/'result.json']
    receipt=bound.require_timing(session,reference,'reader-before-login')
    self.assertFalse(receipt['productionCOMMITQualified']);self.assertTrue(receipt['syntheticTimingInputOnly'])
    self.assertEqual(receipt['reservedEffectNanoseconds'],70_000_000_000)
    root.review.assert_called_once_with(session.proof,context.inputs);root.prepublication.assert_called_once_with(context,op)
    context.cache.legacy_http.assert_called_once_with(context.host,True);session.finish.assert_called_once()
    with self.assertRaises(RuntimeError):bound.require_timing(session,reference,'reader-after-login')
    late={**receipt,'elapsedNanoseconds':170_000_000_000}
    with self.assertRaisesRegex(RuntimeError,'actual_callback_and_owned_effect_allowance_must_fit_V6_SQL_idle_window'):
     session.protocol.require_callback_window(late,'reader')
   finally:scope['directory']=prior_directory;scope['BASE']=oldbase

if __name__=='__main__':unittest.main()
