"""Local source controls only. SQL/Source/SDK and protected-file observations are explicit I/O fixtures."""
import ast,contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,sys,tempfile,types,unittest
from unittest.mock import Mock,patch
OPS=pathlib.Path(__file__).resolve().parent
PATH=OPS/'ypal-cont6-cache-commit-owner-v1.py'
def load():
 spec=importlib.util.spec_from_file_location('reviewed_closed_commit_entry',PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load()
def remote():
 ns={'__name__':'source_fixture','__ACTUAL_BASELINE_ROOT__':{}}
 with patch('os.umask'):exec(compile(m.REMOTE,str(PATH)+':remote','exec'),ns)
 return ns

class Controls(unittest.TestCase):
 def test_01_actual_completed_e30_baseline_canonical_roundtrip_refuses_annotations(self):
  public=json.loads((OPS.parents[1]/'docs/unified-indexer/cont6-baseline4-production-2026-10-26.json').read_bytes())
  local={key:value for key,value in public.items()if key not in {'observedAt','diagnosis','sourceCommit'}};value=m.baseline(local)
  self.assertEqual(hashlib.sha256(m.encoded(value)).hexdigest(),'e30ecf9aa2b45910cd260ce3610b94678e0516e01351b1c2bd5ba14a5533d8d7')
  self.assertNotIn('resultSha256',value);payload=m.REMOTE.replace('__ACTUAL_BASELINE_ROOT__',repr(value));compile(payload,str(PATH),'exec')
  ns=remote();self.assertEqual(ns['encoded'](value),m.encoded(value))
  for changed in [{**local,'annotation':'unreviewed'},{**local,'resultSha256':'f'*64},{**local,'completed':False}]:
   with self.assertRaises(RuntimeError):m.baseline(changed)

 def fixture(self,*,bad_ack=False,bad_xid=False,bad_postflight=False):
  ns=remote();events=[];writes={};enc=ns['encoded'];sha=ns['sha'];cachebase=ns['CACHE_BASE'];constructor={'actualConstructorFixture':True};generation={'actualGenerationFixture':True}
  identity={'preparedConstructorBinding':constructor,'generationCurrentBinding':generation};binding={'heldTestWaived':True,'heldQualificationPerformed':False,'measuredTimingUsed':False,'oldHeldSuccessClaimed':False}
  accepted={'frames':{'physical':'original'},'constructor':constructor,'generation':generation,'identity':identity,'rootSha256':'e'*64,'baseline':{'beforeSha256':'b'*64}}
  authority=types.SimpleNamespace(new_identity=lambda cache,host:copy.deepcopy(identity));cache=types.SimpleNamespace(continuation_authority=authority,xact_status=lambda host,xid:events.append(('xact',xid))or('aborted'if bad_xid else'committed'))
  caller=types.SimpleNamespace(BASE=pathlib.Path('/explicit/caller'))
  sdk=types.SimpleNamespace(LOCK=pathlib.Path('/run/lock/yunipals-ypal-combined-transition.lock'),__file__='actual-reviewed-managed-source')
  session=types.SimpleNamespace(cache=cache,host=types.SimpleNamespace(read_host=types.SimpleNamespace(primitives={'sdk':sdk})),continuation_caller=caller,
   preflight=lambda:events.append('preflight')or{'validated':True},cache_context=lambda sha:events.append('cache-context'))
  rows={name:enc(value)for name,value in {'sql-intent.json':{'actualIntentFixture':True},'sql-prepared.json':{'xid':'17590356'},'sql-committed.json':{'xid':'17590356'},'apply-sql-child.json':{'actualChildFixture':True},'apply-sql-opened.json':{'message':{'xid':'17590356'}}}.items()}
  ack={'prepared':not bad_ack,'nativeWorkerStarted':False,'nativeGenerationPublished':False,'legacy103ServingAccepted':True,'additionalReadCount':4,
   'additionalReadAcknowledgementSha256':sha(rows['sql-committed.json']),'beforeSha256':'b'*64}
  def bind(actual,**kw):self.assertIs(actual,session);self.assertEqual(kw,{'held_test_waived':True});events.append('bind-explicit-waiver');return copy.deepcopy(binding)
  def commit(actual,attempt):self.assertIs(actual,session);self.assertEqual(attempt,ns['ATTEMPT']);events.append('commit-once');return copy.deepcopy(ack)
  direct=types.SimpleNamespace(bind=bind,execute_commit=commit)
  def source(path,digest):
   name=path.name
   if path==ns['CALLER']:
    def construct(*args):self.assertEqual(args[-1],False);events.append('fresh-session');return session
    return types.SimpleNamespace(Session=construct)
   if path==ns['BINDING_HELPER']:return types.SimpleNamespace(bind=lambda s:events.append('constructor')or copy.deepcopy(constructor))
   if path==ns['GENERATION_HELPER']:return types.SimpleNamespace(bind=lambda s:events.append('generation')or copy.deepcopy(generation))
   if path==ns['DIRECT_HELPER']:return direct
   raise AssertionError(name)
  def read(path,digest=None):
   if path==ns['REPORT']:return enc({'sourceRefs':{'actualSourceRefsFixture':True}})
   if path==ns['DIRECT_HELPER'].with_suffix('.manifest.json'):return b'explicit-manifest-IO-fixture'
   if path==cachebase/'prepared.json':return enc(ack)
   if path.parent==cachebase and path.name in rows:return rows[path.name]
   if path==caller.BASE/'attempts'/ns['ATTEMPT']/'result.json':return enc({'completed':True,'action':'commit','postflight':{'validated':not bad_postflight},'context':{'directCommitBinding':binding},'automaticEffectRetryAllowed':False})
   raise AssertionError(str(path))
  def save(name,value):writes[name]=copy.deepcopy(value);events.append(('save',name));return sha(enc(value))
  ns.update(authenticate_baseline=lambda:accepted,start_commands=lambda:events.append('start-command-pass-through'),load=source,read=read,save=save,
   physical=lambda frames:self.assertEqual(frames,accepted['frames'])or events.append('physical-bookend'))
  return ns,events,writes,ack

 def test_02_full_genuine_entry_dispatch_once_authenticates_actual_prepared_and_XID_chain(self):
  ns,events,writes,ack=self.fixture();result=ns['run']()
  self.assertTrue(result['completed']);self.assertEqual(result['transactionId'],'17590356');self.assertEqual(result['transactionStatus'],'committed')
  self.assertEqual(events.count('commit-once'),1);self.assertLess(events.index('constructor'),events.index('cache-context'));self.assertLess(events.index('generation'),events.index('bind-explicit-waiver'))
  self.assertEqual(writes['business-return.json'],ack);self.assertTrue(result['fullSourcePostflightPassed']);self.assertFalse(result['heldQualificationPerformed']);self.assertFalse(result['readerLOGINRequested'])
  self.assertEqual(events[-1],'physical-bookend');self.assertTrue(ns['invoked']);self.assertTrue(ns['returned'])

 def test_03_returned_ACK_aborted_XID_and_failed_original_postflight_cannot_claim_success(self):
  for flags,code in [({'bad_ack':True},'real_prepared_ACK'),({'bad_xid':True},'actual_committed_XID'),({'bad_postflight':True},'original_caller_attempt')]:
   with self.subTest(flags=flags):
    ns,events,_,_=self.fixture(**flags)
    with self.assertRaisesRegex(RuntimeError,code):ns['run']()
    self.assertEqual(events.count('commit-once'),1)

 def test_04_actual_original_prepare_ACK_keys_and_no_second_ACK_or_qualifier_calls(self):
  raw=ast.parse((OPS/'ypal-cache-guard-owner-v1.py').read_bytes());fn=next(n for n in raw.body if isinstance(n,ast.FunctionDef)and n.name=='prepare_ack')
  keys={k.value for node in ast.walk(fn)if isinstance(node,ast.Dict)for k in node.keys if isinstance(k,ast.Constant)and isinstance(k.value,str)}
  self.assertTrue({'prepared','nativeWorkerStarted','nativeGenerationPublished','legacy103ServingAccepted','additionalReadCount','additionalReadAcknowledgementSha256','beforeSha256'}<=keys)
  tree=ast.parse(m.REMOTE);run=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='run')
  calls=[ast.unparse(n.func)for n in ast.walk(run)if isinstance(n,ast.Call)]
  self.assertEqual(calls.count('direct.execute_commit'),1)
  self.assertFalse(any(any(word in name for word in ['qualify_held','prepare_ack','execute_reader','construct_records'])for name in calls))
  compile(m.REMOTE,str(PATH),'exec')
  with patch.object(m,'COMMIT_SOURCE_REVIEWED',False),patch.object(sys,'argv',[str(PATH),'--run']),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH before review')):
   with self.assertRaisesRegex(RuntimeError,'reviewed_direct_commit'):m.main()

 def test_05_restore_FIRST_then_private_diagnostics_on_success_and_unknown_failure(self):
  for error in [None,RuntimeError('actual SQL outcome requires inspection')]:
   ns=remote();saved={};events=[];bare=ns['original_run'];hook=Mock();ns['AUDIT']=types.SimpleNamespace(mkdir=lambda **_:None,parent='/explicit/local-audit')
   def save(name,value):
    if name!='intent.json':self.assertIs(ns['subprocess'].run,bare)
    saved[name]=copy.deepcopy(value);return ns['sha'](ns['encoded'](value))
   def run():
    ns['subprocess'].run=hook;ns['command_trace']=types.SimpleNamespace(calls=[{'explicitPassThroughFixture':True}],failures=[])
    ns['session']=types.SimpleNamespace(native_readiness_direct_commit_scheduling=[{'actualSampleFixture':True}],native_readiness_direct_commit_scheduling_result={'schedulingOnly':True})
    ns['invoked']=True
    if error:raise error
    return {'format':ns['FORMAT'],'completed':True}
   ns.update(run=run,save=save,sync=lambda _:None)
   with patch.object(ns['os'],'geteuid',return_value=0),patch.object(ns['os'],'getegid',return_value=0),patch.object(ns['socket'],'gethostname',return_value='yunipals-main'),patch.object(ns['signal'],'signal'),patch.object(ns['signal'],'alarm'),patch.object(ns['sys'],'getprofile',return_value=None),patch.object(ns['sys'],'gettrace',return_value=None),patch.object(ns['subprocess'],'run',bare),contextlib.redirect_stdout(io.StringIO()):
    self.assertEqual(ns['main'](),1 if error else 0)
   self.assertIn('approval-renewal-scheduling.json',saved);self.assertTrue(saved['result.json']['commandCapture']['subprocessRunRestored'])
   if error:
    self.assertIn(str(error),saved['failure-traceback.json']['traceback']);self.assertTrue(saved['result.json']['unknownOutcomeRequiresInspection']);self.assertFalse(saved['result.json']['automaticRetryAllowed'])

if __name__=='__main__':unittest.main()
