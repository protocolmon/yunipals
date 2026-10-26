import ast,copy,hashlib,importlib.util,json,os,pathlib,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
P=HERE/'ypal-cont5-readonly-refresh-benchmark-owner-v4.py'
def load(path):
 spec=importlib.util.spec_from_file_location('readonly_fixture_'+path.stem.replace('-','_'),path)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load(P);old=load(HERE/'ypal-cont5-readonly-refresh-benchmark-owner-v3.py')
r=ast.parse(m.REMOTE);fn={n.name:n for n in r.body if isinstance(n,ast.FunctionDef)}
base=json.loads((HERE/'ypal-cont5-construct3-result-fixture.json').read_bytes());recon=json.loads((HERE/'ypal-cont5-held8-reconciliation-result-fixture.json').read_bytes());detail=json.loads((HERE/'ypal-cont5-held8-failure-detail-fixture.json').read_bytes());failed=detail['operationResult'];prior=json.loads((HERE/'ypal-cont5-readonly-refresh-benchmark-result-fixture.json').read_bytes())
ORIGINAL_SHA=hashlib.sha256;ORIGINAL_RUN=subprocess.run
MEMO_SHA='432d52299ad7040c2c587cb6db92b6aba4ff6fffd4d0adad499cfe604b08b9a0'
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return ORIGINAL_SHA(raw).hexdigest()
def need(value,code):
 if not value:raise RuntimeError(code)
def execute(names,scope):
 exec(compile(ast.Module(body=[fn[name]for name in names],type_ignores=[]),str(P),'exec'),scope);return scope
class Controls(unittest.TestCase):
 def test_closed_default_and_flag_refuse_before_transport(self):
  self.assertIs(m.BENCHMARK_SOURCE_REVIEWED,True)
  self.assertEqual(sha(P.read_bytes()),'f5bb1c8533cc31c98188c8807754f92c81ac1e10ac14e82a8baed3cbe94070aa')
  normalized=P.read_bytes().replace(b'# Root and independent full/delta review and 15 controls passed.\n',b'').replace(b'BENCHMARK_SOURCE_REVIEWED=True',b'BENCHMARK_SOURCE_REVIEWED=False')
  self.assertEqual(sha(normalized),'4b0b2e8cbe52ba7c6e0b7467fcfa84969af894ce6f94f933daf187aea2f4c2ed')
  with patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')),patch('builtins.print'),patch('sys.argv',[str(P)]):m.main()
  with patch.object(m,'BENCHMARK_SOURCE_REVIEWED',False),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')),patch('sys.argv',[str(P),'--run']),self.assertRaisesRegex(RuntimeError,'source_review_required'):m.main()
 def test_all_borrowed_auth_functions_and_entire_baseline_remain_exact(self):
  previous={n.name:n for n in ast.parse(old.REMOTE).body if isinstance(n,ast.FunctionDef)}
  changed={'deadline','observe_refresh_and_prerequisites','save_duration_observation'}
  for name,source in previous.items():
   if name not in changed:self.assertEqual(ast.dump(source,include_attributes=False),ast.dump(fn[name],include_attributes=False),name)
  a=" stage='authenticate-completed-construct-only3-baseline'";b=" stage='authenticate-live-programs'"
  self.assertEqual(m.REMOTE[m.REMOTE.index(a):m.REMOTE.index(b)],old.REMOTE[old.REMOTE.index(a):old.REMOTE.index(b)])
  for name in ['encoded','read_private','actual_result','exclusive','need_reconciliation_result','require_diagnostic_ancestor']:
   a=next(n for n in ast.parse(P.read_bytes()).body if isinstance(n,ast.FunctionDef)and n.name==name)
   b=next(n for n in ast.parse(Path(old.__file__).read_bytes()).body if isinstance(n,ast.FunctionDef)and n.name==name)
   self.assertEqual(ast.dump(a,include_attributes=False),ast.dump(b,include_attributes=False),name)
 def test_actual_root_and_recovery_and_ancestor_local_gates_remain_canonical(self):
  for value,check in [(base,None),(failed,None),(recon,m.need_reconciliation_result),(prior,m.require_diagnostic_ancestor)]:
   self.assertIs(m.actual_result(value,value['resultSha256']),value)
   if check:self.assertIs(check(value),value)
   other=copy.deepcopy(value);other['completed']=not value['completed']
   with self.assertRaises(RuntimeError):m.actual_result(other,value['resultSha256'])
  for key in ['newHeldSuccessAuthority','newCommitAuthority','productionPreparedACKCreated','completeHeldCallbackQualified']:
   changed=copy.deepcopy(recon);changed[key]=True
   with self.assertRaises(RuntimeError):m.need_reconciliation_result(changed)
 def public(self,path,digest):
  raw=(HERE/Path(path).name).read_bytes();need(sha(raw)==digest,'realPublicSourceBytesFixture');return raw
 def scope(self):
  timer=load(HERE/'ypal-readonly-run-duration-v2.py');memo=load(HERE/'ypal-readonly-sha256-memo-v1.py')
  self.assertEqual(sha(Path(memo.__file__).read_bytes()),MEMO_SHA)
  with patch.object(timer,'public',side_effect=self.public):duration=timer.RunDurations(maximum_calls=10000)
  value={'need':need,'sys':sys,'time':time,'subprocess':subprocess,'bare_subprocess_run':ORIGINAL_RUN,'duration_observer':duration,'memo_observer':memo.SHA256Memo(),
   'memo_counter_phases':[],'memo_counter_capture_errors':0,'measurement_phases':[],
   'duration_snapshot_saved':False,'duration_saved_summary':None}
  execute(['measured_call','record_memo_counters','observe_refresh_and_prerequisites','save_duration_observation'],value)
  return value,timer,memo
 def test_real_crypto_fresh_reads_alias_and_one_pair_prefix_critical_counts(self):
  scope,timer,memo=self.scope();events=[];raw=b'x'*(2*1024*1024);expected=sha(raw);alias=None;result=object()
  class Host:
   def refresh(host):
    events.append(('refresh',host));fresh=bytes(bytearray(raw));need(hashlib.sha256(fresh).hexdigest()==expected,'originalExpectedDigestPredicate')
    return subprocess.run([sys.executable,'-I','-B','-c','pass'],capture_output=True,timeout=5)
   def prerequisites(host):
    events.append(('prerequisites',host));need(hashlib.sha256(bytes(bytearray(raw))).hexdigest()==expected,'originalExpectedDigestPredicate');return result
  host=Host()
  with scope['memo_observer']:
   scope['record_memo_counters']('before-genuine-Session')
   need(hashlib.sha256(raw).hexdigest()==expected,'originalExpectedDigestPredicate')
   alias=hashlib.sha256
   value=scope['observe_refresh_and_prerequisites'](host)
  self.assertIs(value,result);self.assertEqual(events,[('refresh',host),('prerequisites',host)])
  self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
  before=scope['memo_observer'].snapshot();self.assertEqual(alias(raw).hexdigest(),expected);self.assertEqual(scope['memo_observer'].snapshot(),before)
  boundaries={row['label']:row['counters']for row in scope['memo_counter_phases']}
  self.assertEqual(boundaries['before-explicit-pair']['cacheHits'],0)
  self.assertEqual(boundaries['after-explicit-pair']['cacheHits']-boundaries['before-explicit-pair']['cacheHits'],2)
  self.assertEqual(len(scope['duration_observer'].snapshot()['calls']),1)
  for row in scope['measurement_phases']:
   self.assertTrue(row['returned']);self.assertEqual(row['wallNanoseconds'],row['endedPerfCounterNanoseconds']-row['startedPerfCounterNanoseconds'])
 def test_changed_fresh_file_still_refuses_expected_hash_and_restores_both(self):
  scope,timer,memo=self.scope()
  with tempfile.TemporaryDirectory()as temp:
   p=Path(temp)/'public';p.write_bytes(b'a'*(2*1024*1024));expected=sha(p.read_bytes());error=RuntimeError('original_expected_digest_refusal')
   class Host:
    def refresh(host):need(hashlib.sha256(p.read_bytes()).hexdigest()==expected,'original_expected_digest_refusal');p.write_bytes(b'b'*(2*1024*1024))
    def prerequisites(host):
     if hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise error
   with self.assertRaises(RuntimeError)as caught,scope['memo_observer']:
    scope['record_memo_counters']('before-genuine-Session');scope['observe_refresh_and_prerequisites'](Host())
   self.assertIs(caught.exception,error)
  self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
  self.assertEqual(scope['memo_observer'].snapshot()['cacheHits'],0)
 def test_original_error_identity_no_retry_and_both_hooks_restored(self):
  for phase in ['refresh','prerequisites']:
   with self.subTest(phase=phase):
    scope,timer,memo=self.scope();events=[];error=RuntimeError('original_'+phase)
    class Host:
     def refresh(host):
      events.append('refresh')
      if phase=='refresh':raise error
     def prerequisites(host):events.append('prerequisites');raise error
    with self.assertRaises(RuntimeError)as caught,scope['memo_observer']:
     scope['record_memo_counters']('before-genuine-Session');scope['observe_refresh_and_prerequisites'](Host())
    self.assertIs(caught.exception,error);self.assertEqual(events,['refresh']if phase=='refresh'else['refresh','prerequisites'])
    self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
    self.assertEqual(scope['memo_counter_phases'][-1]['label'],'after-explicit-pair')
 def test_counter_capture_finite_refusal_does_not_skip_original_pair(self):
  scope,timer,memo=self.scope();events=[]
  class BadCounts(dict):
   def keys(self):raise MemoryError('optionalCounterCopy')
  class Host:
   def refresh(host):events.append('refresh')
   def prerequisites(host):events.append('prerequisites');return 7
  with scope['memo_observer']:
   scope['record_memo_counters']('before-genuine-Session')
   scope['memo_observer'].counts=BadCounts(scope['memo_observer'].counts)
   # Use explicit finite bookkeeping injection at the counter-only dictcopy.
   real_dict=dict
   def finite_copy(value):
    if value is scope['memo_observer'].counts:raise MemoryError('optionalCounterCopy')
    return real_dict(value)
   scope['dict']=finite_copy
   self.assertEqual(scope['observe_refresh_and_prerequisites'](Host()),7)
  self.assertEqual(events,['refresh','prerequisites']);self.assertEqual(scope['memo_counter_capture_errors'],2)
  self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
 def test_saving_restores_both_before_any_write_and_is_same_scope_idempotent(self):
  scope,timer,memo=self.scope();writes=[]
  class Host:
   def refresh(host):return hashlib.sha256(b'z'*(2*1024*1024)).digest()
   def prerequisites(host):return hashlib.sha256(bytes(bytearray(b'z'*(2*1024*1024)))).digest()
  with scope['memo_observer']:
   scope['record_memo_counters']('before-genuine-Session');scope['observe_refresh_and_prerequisites'](Host())
  def write(name,value):
   self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN);writes.append((name,value));return sha(encoded(value))
  scope['write']=write;first=scope['save_duration_observation']();second=scope['save_duration_observation']()
  self.assertEqual(first,second);self.assertIsNot(first,second);self.assertEqual(len(writes),4)
  self.assertEqual(first['memoExplicitPairCounters']['cacheHits'],1);self.assertTrue(first['completeMemoCounterBoundaries']);self.assertTrue(first['completeRunDurationCoverage'])
  self.assertTrue(first['originalSHA256Restored']);self.assertTrue(first['privateMemoPayloadsReleased'])
 def live_scope(self,failed_stage=None):
  scope,timer,memo=self.scope();events=[];epoch={'explicitFreshEpochIOFixture':True};cachebase=Path('/fixture/cache');authoritybase=Path('/fixture/authority')
  cache=types.SimpleNamespace(BASE=cachebase,__file__='/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-read-cache-continue-v5.py',continuation_authority=types.SimpleNamespace(BASE=authoritybase))
  data=b'fresh-explicit-IO-fixture'*100000;expected=sha(data);error=RuntimeError('actual_original_'+str(failed_stage));alias=[];writes=[];written_values={};preflight_return={'explicitGenuinePreflightIOBoundaryFixture':True,'mutatedAfterOriginalSnapshot':False}
  def event(name):
   events.append(name)
   if name==failed_stage:raise error
  class Host:
   def refresh(host):event('refresh');need(hashlib.sha256(bytes(bytearray(data))).hexdigest()==expected,'originalDigestGuard')
   def prerequisites(host):event('prerequisites');need(hashlib.sha256(bytes(bytearray(data))).hexdigest()==expected,'originalDigestGuard');return {'metadataCurrentProof':{'currentNativeMetadataQualified':True,'metadataEpoch':epoch}}
  host=Host()
  class Session:
   def __init__(session,*args):
    event('Session');self.assertIsNot(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
    need(hashlib.sha256(data).hexdigest()==expected,'originalDigestGuard');alias.append(hashlib.sha256)
    session.cache=cache;session.host=host;session.metadata_epoch=types.SimpleNamespace(binding=lambda:epoch)
   def preflight(session):event('preflight');return preflight_return
   def cache_context(session,*args):event('context');preflight_return['mutatedAfterOriginalSnapshot']=True;return cache,host
   def finish(session):
    event('finish');self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
    counters=dict(scope['memo_observer'].counts);need(alias[0](data).hexdigest()==expected,'originalDigestGuard');self.assertEqual(scope['memo_observer'].counts,counters)
    return {'metadataActorCurrent':{'currentActorQualified':True},'metadataEpoch':epoch}
  def load_io(path,digest):
   if path.name=='ypal-readonly-run-duration-v2.py':return timer
   self.assertEqual(path.name,'ypal-readonly-sha256-memo-v1.py');self.assertEqual(digest,MEMO_SHA);return memo
  def write(name,value):
   self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN);writes.append(name);written_values[name]=value;return sha(value if isinstance(value,bytes)else encoded(value))
  scope.update(load=load_io,TIMER=Path('ypal-readonly-run-duration-v2.py'),TIMER_SHA='timerActualAuthenticatedIOFixture',MEMO=Path('ypal-readonly-sha256-memo-v1.py'),MEMO_SHA=MEMO_SHA,
   caller=types.SimpleNamespace(Session=Session),report={'sourceRefs':{}},refs=m.EXPECTED_REFS,MANIFEST_SHA='manifestActualAuthenticatedIOFixture',CACHE_INPUT_SHA='cacheActualAuthenticatedIOFixture',CACHE_BASE=cachebase,
   OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020'),fixed_cache_frame=lambda c: {'same6OriginalFrames':True},failed_capture_frame=lambda: {'same6OriginalFailedFrames':True},
   failed_frame={'same6OriginalFailedFrames':True},document=lambda *args:{'completed':True},BASELINE_CAPTURE='actualBaselineIOFixture',baseline={'completed':True,'sha256':'actualBaselineSHAIOFixture'},
   encoded=encoded,write=write,proof_hashes={})
  a=m.REMOTE.index(" stage='authenticate-run-timer-and-pure-SHA-helper'");b=m.REMOTE.index(" capture_summary=capture_histories('success')",a)
  block=m.REMOTE[a:b];code=compile('if True:\n'+block,str(P),'exec')
  with patch.object(timer,'public',side_effect=self.public):
   if failed_stage:
    with self.assertRaises(RuntimeError)as caught:exec(code,scope)
    self.assertIs(caught.exception,error)
   else:exec(code,scope)
  self.assertIs(hashlib.sha256,ORIGINAL_SHA);self.assertIs(subprocess.run,ORIGINAL_RUN)
  scope['fixtureWrittenValues']=written_values
  return scope,events,writes
 def test_mutable_preflight_return_is_serialized_at_original_snapshotpoint(self):
  scope,events,writes=self.live_scope()
  raw=scope['fixtureWrittenValues']['new-source-preflight.private.json']
  self.assertIs(type(raw),bytes);self.assertEqual(json.loads(raw),{'explicitGenuinePreflightIOBoundaryFixture':True,'mutatedAfterOriginalSnapshot':False})
 def test_before_pair_failure_keeps_partial_memo_and_truthful_never_entered_timer(self):
  for stage in ['Session','preflight','context']:
   with self.subTest(stage=stage):
    scope,events,writes=self.live_scope(stage)
    summary=scope['save_duration_observation']()
    self.assertTrue(summary['timerNeverEntered']);self.assertTrue(summary['subprocessRunNeverReplaced']);self.assertFalse(summary['subprocessRunRestored'])
    self.assertFalse(summary['completeRunDurationCoverage']);self.assertFalse(summary['completeMemoCounterBoundaries']);self.assertTrue(summary['originalSHA256Restored']);self.assertTrue(summary['privateMemoPayloadsReleased'])
    self.assertIn('readonly-SHA256-memo.private.json',writes);self.assertFalse(scope['fixtureWrittenValues']['readonly-run-durations.private.json']['subprocessRunRestored'])
    self.assertEqual(events[-1],stage)
 def test_actual_live_block_primes_before_Session_and_bare_postflight_after_both_restored(self):
  scope,events,writes=self.live_scope();self.assertEqual(events,['Session','preflight','context','refresh','prerequisites','finish'])
  self.assertEqual(writes[0],'new-source-preflight.private.json');self.assertIn('full-source-postflight.private.json',writes)
  self.assertEqual(scope['observation_summary']['memoPrefixCacheHits'],0);self.assertEqual(scope['observation_summary']['memoExplicitPairCounters']['cacheHits'],2)
 def test_actual_live_prefix_pair_and_postflight_errors_restore_without_replay(self):
  for stage in ['Session','preflight','context','refresh','prerequisites','finish']:
   with self.subTest(stage=stage):self.live_scope(stage)
 def test_original_error_survives_diagnostic_snapshot_or_write_refusal(self):
  top=next(n for n in r.body if isinstance(n,ast.Try));handler=copy.deepcopy(top.handlers[0]);error=RuntimeError('actual_full_Source_postflight_refused')
  scope={'original':error,'traceback':__import__('traceback'),'save_duration_observation':Mock(side_effect=MemoryError('diagnosticCounterSnapshotRefusal')),
   'capture_histories':Mock(return_value={}), 'proof_hashes':{},'write':lambda name,value:sha(value if isinstance(value,bytes)else encoded(value)),
   'now':lambda:'fixture','stage':'full-source-postflight','reconciliation_local':recon,'re':__import__('re')}
  statement=ast.Try(body=[ast.Raise(exc=ast.Name(id='original',ctx=ast.Load()))],handlers=[handler],orelse=[],finalbody=[])
  exec(compile(ast.fix_missing_locations(ast.Module(body=[statement],type_ignores=[])),str(P),'exec'),scope)
  self.assertFalse(scope['result']['completed']);self.assertEqual(scope['result']['failureCode'],'actual_full_Source_postflight_refused');self.assertIn('duration-save-refusal',scope['proof_hashes'])
 def test_outer_render_uses_exact_five_actual_inputs_no_future_success(self):
  values={m.BASELINE_RESULT:base,m.FAILED_RESULT:detail,m.RECONCILIATION_RESULT:recon,m.METADATA_REFS:m.EXPECTED_REFS,m.PRIOR_BENCHMARK_RESULT:prior};observed={}
  def transport(argv,**kwargs):observed.update(argv=argv,**kwargs);return types.SimpleNamespace(returncode=0,stderr='',stdout=json.dumps({'format':'root-CONT5-readonly-refresh-benchmark-v4','completed':True,'transportIOFixtureOnly':True}))
  with patch.object(m,'BENCHMARK_SOURCE_REVIEWED',True),patch.object(m,'read_private',side_effect=lambda p:copy.deepcopy(values[p])),patch.object(m.os.path,'lexists',return_value=False),patch.object(m,'exclusive')as save,patch.object(m.subprocess,'run',side_effect=transport),patch('builtins.print'),patch('sys.argv',[str(P),'--run']):
   with self.assertRaises(SystemExit)as done:m.main()
  self.assertEqual(done.exception.code,0);self.assertEqual(save.call_count,1)
  expected=m.REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(base)).replace('ACTUAL_METADATA_REFS',repr(m.EXPECTED_REFS)).replace('ACTUAL_HELD8_FAILURE',repr(failed)).replace('ACTUAL_HELD8_RECONCILIATION',repr(recon)).replace('ACTUAL_PRIOR_READONLY_BENCHMARK_RESULT',repr(prior))
  self.assertEqual(observed['input'],expected);self.assertNotIn('ACTUAL_',observed['input']);self.assertEqual(observed['argv'][-1],'python3 -I -B -')
  with patch.object(m,'BENCHMARK_SOURCE_REVIEWED',True),patch.object(m,'read_private',side_effect=FileNotFoundError('missingActualGraph')),patch.object(m.os.path,'lexists',return_value=False),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH'))as transport,patch('sys.argv',[str(P),'--run']),self.assertRaises(FileNotFoundError):m.main()
  transport.assert_not_called()
 def test_no_effect_or_live_parent_hook_or_CPU_observer_and_exact_fixed_helper(self):
  calls=[ast.unparse(n.func)for n in ast.walk(r)if isinstance(n,ast.Call)]
  for forbidden in ['caller.qualify_held','caller.execute_cache','caller.execute_reader','caller.construct_records','cache.sql_child','cache._sql_child','authority.approval_snapshot','subprocess.Popen','sys.settrace','sys.setprofile','cpu.StdlibCPUDurations']:
   self.assertNotIn(forbidden,calls)
  self.assertEqual(calls.count('session.preflight'),1);self.assertEqual(calls.count('session.cache_context'),1);self.assertEqual(calls.count('session.finish'),1)
  self.assertIn(MEMO_SHA,m.REMOTE);self.assertIn('maximum_payload_bytes=256*1024*1024,maximum_entries=4',m.REMOTE)
  self.assertLess(m.REMOTE.index('with memo_observer:'),m.REMOTE.index('session=caller.Session'))
  self.assertLess(m.REMOTE.index('observation_summary=save_duration_observation()'),m.REMOTE.index("stage='full-source-postflight'"))
  compile(m.REMOTE,'REMOTE4','exec')
if __name__=='__main__':unittest.main()
