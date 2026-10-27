"""Complete Phase/renderer bodies; protected ACK, DB and process I/O explicit."""
import ast,copy,importlib.util,json,subprocess,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/name);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v
m=load('ypal-native-readiness-split-reader-binding-v1.py')
g=load('ypal-native-readiness-reader-generation-binding-v1.test.py');r=g.r
renderer=load('ypal-ordinary-publication-continue-inputs-v6.test.py');local=r.family_tests.local
real_load=m.load

def source(name):
 if name==m.GENERATION:return g.m
 return real_load(name)

def receipts(family,config,before_sha='b'*64):
 split=types.SimpleNamespace(FORMAT='yunipals-native-readiness-cache-split-v1')
 binding={'nativePolicyRefs':copy.deepcopy(family.readiness.refs),'forwardAuthorityInputSha256':family.authority_context.input_sha,
  'approvalTTLSeconds':120,'literalACKTailSeconds':5,'oldCachePreparedACKClaimed':False,'oldC54WholeValidatorPassed':False}
 value={'format':split.FORMAT+'-prepared','operatorSha256':m.SOURCE_PINS[m.SPLIT],
  'manifestSha256':m.SOURCE_PINS[m.SPLIT.replace('.py','.manifest.json')],'binding':binding,'config':copy.deepcopy(config),
  'originalProviderSha256':m.SOURCE_PINS[m.PROVIDER],'prepared':True,'nativeWorkerStarted':False,'nativeGenerationPublished':False,
  'beforeSha256':before_sha,'originalReviewHash':'1'*64,'readAdmissionSha256':config['readAdmissionSha256'],
  'additionalReadAcknowledgementSha256':'a'*64}
 record={'format':'yunipals-ypal-cache-guard-sql-v1','mode':'apply','acknowledged':True,'xid':'17621038','resultJson':'{}','result':{},'postProof':{}}
 split.prepared_acknowledgement=lambda prepared_sha,input_sha:copy.deepcopy(value)
 split.activation_record=lambda prepared_sha,input_sha:copy.deepcopy(record)
 return split,value,record

class Controls(unittest.TestCase):
 def fixture(self):
  cold=r.Cold();cold.setUp();self.addCleanup(cold.doCleanups);self.f=cold.f
  self.enterContext(patch.object(m,'public',side_effect=local));self.enterContext(patch.object(g.m,'public',side_effect=local));self.enterContext(patch.object(g.m,'load',side_effect=g.source))
  self.n=self.f.provider_namespace();self.cache=self.n.cache_runtime();self.config=copy.deepcopy(self.f.old.config)
  self.split,self.prepared,self.record=receipts(self.f.family,self.config)
  def supplied(name):return self.split if name==m.SPLIT else source(name)
  self.enterContext(patch.object(m,'load',side_effect=supplied));return self.f

 def test_01_source_default_inert_and_no_effects_or_deadline_changes(self):
  with patch.object(m,'public',side_effect=local):m.authenticate()
  out=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True,text=True)
  self.assertTrue(json.loads(out.stdout)['staticOnly']);self.assertFalse(out.stderr)
  tree=ast.parse(local(m.FILE))
  forbidden={'subprocess.run','subprocess.Popen','sys.settrace','sys.setprofile','time.sleep'}
  self.assertFalse(any(isinstance(n,ast.Call)and ast.unparse(n.func)in forbidden for n in ast.walk(tree)))
  self.assertFalse(any(isinstance(n,ast.Constant)and type(n.value)is str and 'commit-authorized'in n.value for n in ast.walk(tree)))

 def test_02_actual_full_Phase_constructor_owned_receipts_scope_and_errors(self):
  self.fixture();original=self.n.Phase;old_init=original.__init__.__code__;old_scope=original.scope.__code__
  ns=old_init_globals=original.__init__.__globals__;read=ns['read_module']();events=[]
  provider=self.f.family.provider();inputs={'cachePreparedSha256':'c'*64,'cacheInputsSha256':'d'*64,
   'readPlanSha256':self.config['readPlanSha256'],'readContextInputSha256':self.config['readContextInputSha256']}
  before={'explicitOriginalOwnedBeforeIO':True};rehearsal={'explicitOriginalRehearsalIO':True}
  def document(path,digest=None):
   if Path(path)==provider.INPUT:return copy.deepcopy(self.config)
   raise AssertionError('old prepared/SQL journal must not be read: '+str(path))
  def initialize(host,config):
   host.config=config;host.cache=self.cache;host.inverse_mode=False;host.explicitOriginalHostInitIO=True
  def current(host,cache_reads=False,enabled=False,expected_catalog=None,inverse=False):
   events.append(('complete-current-I/O',host,cache_reads,enabled,expected_catalog,inverse));return{'validated':True,'sameFullCurrentFixture':True}
  self.split.bind_current=lambda cache,host,input_sha,readiness:events.append(('bind-current',cache,host))or current
  observed={'guards':[],'epochs':[{'collection':name,'revision':'1'}for name in ['ethereum','base','polygon','bnb']]};self.record['result']={'after':observed};self.record['resultJson']=json.dumps(self.record['result'])
  self.cache.sql_child=lambda host,mode:{'state':copy.deepcopy(observed)}
  self.cache.owned=lambda host:(copy.deepcopy(before),copy.deepcopy(rehearsal))
  proxy=r.family_tests.context_tests.m.Proxy(read,document=document)
  _,_,binding=m.receipt_binding(self.f.family,'e'*64,'c'*64)
  with patch.dict(ns,cache_runtime=lambda:self.cache,read_module=lambda:proxy),patch.dict(self.cache.Host.__init__.__globals__,initialize_current=initialize):
   adapted=m.phase_namespace(self.n,self.f.family,'e'*64,'c'*64,binding)
   value=adapted.Phase(inputs,self.f.manifest)
  self.assertIs(original.__init__.__code__,old_init);self.assertIs(original.scope.__code__,old_scope)
  self.assertTrue(value.host.explicitOriginalHostInitIO);self.assertEqual(value.prepared,self.prepared)
  self.assertEqual(value.before,before);self.assertEqual(value.rehearsal,rehearsal);self.assertEqual(value.sql_ack,self.record)
  self.assertEqual(events[0][0],'bind-current');scope=value.scope(False,{'actual':'expected catalog I/O'})
  self.assertTrue(scope['validated']);self.assertEqual(len([x for x in events if x[0]=='complete-current-I/O']),2)
  self.prepared['config']['readPlanSha256']='f'*64
  with self.assertRaisesRegex(RuntimeError,'immutable_split_ACK'):value.scope()
  self.prepared['config']=copy.deepcopy(self.config)
  error=TimeoutError('genuine original current deadline')
  value._split_current=lambda *_:(_ for _ in()).throw(error)
  with self.assertRaises(TimeoutError)as caught:value.scope()
  self.assertIs(caught.exception,error)
  with self.assertRaisesRegex(RuntimeError,'separate_explicit'):value.inverse_scope()

 def test_03_full_original_renderer_ten_refs_uses_new_ACK_and_forbids_old_journal(self):
  fixture=renderer.Actual();fixture.setUp();self.addCleanup(fixture.doCleanups);f=fixture.f
  self.enterContext(patch.object(g.m,'public',side_effect=local));self.enterContext(patch.object(g.m,'load',side_effect=g.source))
  self.enterContext(patch.object(m,'public',side_effect=fixture.read))
  provider=f.family.provider();old=json.loads(fixture.files[str(provider.BASE/'prepared.json')]);split,prepared,record=receipts(f.family,old['config'],old['beforeSha256'])
  prepared['additionalReadAcknowledgementSha256']='a'*64
  del fixture.files[str(provider.BASE/'prepared.json')];del fixture.files[str(provider.BASE/'sql-committed.json')]
  original=real_load
  def supplied(name):
   if name==m.FAMILY:return types.SimpleNamespace(Family=lambda refs,authority:f.family)
   if name==m.SPLIT:return split
   return source(name)
  self.enterContext(patch.object(m,'load',side_effect=supplied))
  result=m.reader_inputs('c'*64,f.manifest_sha,f.refs,f.input_sha,'e'*64)
  self.assertEqual(set(result['readerInputs']),f.family.reader().core(f.manifest_sha)[1]._implementation.INPUT_KEYS)
  self.assertEqual(result['readerInputs']['cachePreparedSha256'],'c'*64)
  self.assertEqual(result['metadataRefs'],fixture.recorded['refs']);self.assertFalse(result['oldCachePreparedACKClaimed'])
  self.assertEqual(result['cacheSplitPreparedBinding']['splitInputSha256'],'e'*64)
  prepared['originalReviewHash']='f'*64
  with self.assertRaisesRegex(RuntimeError,'original_before_config'):m.reader_inputs('c'*64,f.manifest_sha,f.refs,f.input_sha,'e'*64)

 def test_04_scope_ACK_must_record_new_binding_and_original_errors_win(self):
  self.fixture();reader=m.reader_namespace(self.f.family,'e'*64,'c'*64);binding=reader.native_readiness_split_reader_binding
  original=r.w.closure(reader.acknowledgement)['original_ack'];operation={'binding':{'sourceScope':{'cacheSplitPreparedBinding':copy.deepcopy(binding)},'inputs':{'cachePreparedSha256':'c'*64}}}
  def record(path,digest=None):
   if Path(path)==reader.BASE/'operation.json':return m.encoded(operation)
   return local(path,digest)
  value={'operationSha256':'a'*64,'cachePreparedSha256':'c'*64}
  # Only the preceding immutable ACK consumer is a private I/O boundary; no
  # current or fabricated completed Reader receipt is claimed by this fixture.
  closure=r.w.closure(reader.acknowledgement);cell=next(cell for name,cell in zip(reader.acknowledgement.__code__.co_freevars,reader.acknowledgement.__closure__)if name=='original_ack')
  retained=cell.cell_contents;cell.cell_contents=lambda *_:copy.deepcopy(value)
  self.addCleanup(setattr,cell,'cell_contents',retained)
  with patch.object(m,'public',side_effect=record):
   out=reader.acknowledgement('d'*64,self.f.manifest_sha);self.assertEqual(out['cacheSplitPreparedBinding'],binding)
   operation['binding']['sourceScope']['cacheSplitPreparedBinding']={}
   with self.assertRaisesRegex(RuntimeError,'must_name_owned'):reader.acknowledgement('d'*64,self.f.manifest_sha)
   error=RuntimeError('actual immutable previous ACK refusal');cell.cell_contents=lambda *_:(_ for _ in()).throw(error)
   with self.assertRaises(RuntimeError)as caught:reader.acknowledgement('d'*64,self.f.manifest_sha)
   self.assertIs(caught.exception,error)


 def test_05_public_Session_reader_context_and_actual_timing_keep_split_binding(self):
  fixture=r.prepared_tests.Controls();self.addCleanup(fixture.doCleanups)
  retained=r.prepared_tests.frozen_tests.Controls.caller
  def actual_reader(actual):actual.family.reader();return retained(actual)
  with patch.object(r.prepared_tests.frozen_tests.Controls,'caller',new=actual_reader):fixture.setUp()
  self.enterContext(patch.object(r.w,'public',side_effect=local));self.enterContext(patch.object(r.w,'load',side_effect=r.relocated_generation_source))
  self.enterContext(patch.object(g.m,'public',side_effect=local));self.enterContext(patch.object(g.m,'load',side_effect=g.source))
  self.enterContext(patch.object(m,'public',side_effect=local))
  split,prepared,record=receipts(fixture.family,fixture.f.old.config)
  self.enterContext(patch.object(m,'load',side_effect=lambda name:split if name==m.SPLIT else source(name)))
  ctor=r.prepared_tests.m.bind(fixture.session);route=r.w.bind(fixture.session);gen=g.m.bind(fixture.session)
  binding=m.bind(fixture.session,'e'*64,'c'*64);session=fixture.session;caller=fixture.caller;reader=fixture.family.reader()
  def private_phase(proof_class,provider):
   self.assertIs(proof_class,reader.Proof);self.assertIs(provider,session.provider)
   self.assertEqual(type(provider).namespace.__code__,r.w.nested(m.bind.__code__,'BoundProvider','namespace'))
   class Proof(proof_class):
    def initialize(self,context,inputs):
     context.host=object.__new__(fixture.cache.Host);context.host.config=copy.deepcopy(fixture.f.old.config)
     context.phase=types.SimpleNamespace(host=context.host,prepared=copy.deepcopy(prepared))
     context.prepared=copy.deepcopy(prepared);context.sql_ack=copy.deepcopy(record);context.explicitPrivatePhaseIO=True
   return Proof
  original_public=fixture.f.old.h.public
  def manifests(path,digest=None,maximum=4000000):
   if Path(path).name==m.READER_MANIFEST:return local(path,digest)
   return original_public(path,digest,maximum)
  with patch.object(caller,'bind_proof',side_effect=private_phase),patch.object(fixture.f.old.h,'public',side_effect=manifests):
   session.readonly_preflight={'explicitFullSourcePreflightIO':True}
   _,proof,context=session.reader_context(fixture.f.manifest_sha,{'cachePreparedSha256':'c'*64})
  self.assertTrue(context.explicitPrivatePhaseIO)
  key=caller.timing_key(session,'reader-before-login')
  self.assertEqual(key['cacheSplitPreparedBinding'],binding);self.assertEqual(key['context']['cacheSplitPreparedBinding'],binding)
  self.assertEqual(key['readerGenerationBinding'],gen);self.assertEqual(key['readerRouteBinding'],route);self.assertEqual(key['preparedConstructorBinding'],ctor)
  self.assertEqual(session.key['cacheSplitPreparedBinding'],binding)
  with self.assertRaises(RuntimeError):m.bind(session,'e'*64,'c'*64)
  session.native_readiness_reader_generation_binding={}
  with self.assertRaisesRegex(RuntimeError,'same_session'):caller.timing_key(session,'reader-before-login')

if __name__=='__main__':unittest.main()
