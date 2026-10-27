import ast,base64,copy,hashlib,importlib.util,json,os,re,subprocess,tempfile,types
from pathlib import Path
from unittest.mock import Mock
P=Path(__file__).resolve().parent
F=P/'ypal-metadata-current-peer-diagnostic-v1.py';source=F.read_text();tree=ast.parse(source)
remote=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets));r=ast.parse(remote)
functions={n.name:n for n in r.body if isinstance(n,ast.FunctionDef)}
spec=importlib.util.spec_from_file_location('frozenDiagnostic',P/'ypal-ordinary-metadata-capture-diagnostic-v1.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
assert hashlib.sha256(Path(d.__file__).read_bytes()).hexdigest()=='2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465'
raw=(P.parent/'booster-launch'/'ypal-old-runtime-inventory-v1.py').read_bytes();assert d.sha(raw)==d.PUBLIC_INVENTORY_SHA
script=next(n.value.value for n in ast.parse(raw).body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='PEER_FDS'for t in n.targets))
argv=['/usr/bin/setpriv','--reuid=0','--regid=0','--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','/usr/bin/python3','-I','-B','-c',script,'[2147483647]','0'];assert d.public_fd_peer(argv)
scope={'base64':base64,'re':re};exec(compile(ast.fix_missing_locations(ast.Module(body=[functions['public_error_class']],type_ignores=[])),str(F),'exec'),scope)
classify=scope['public_error_class'];payload={'rawPublicPeerEvidenceRetained':True,'argv':argv}
for name,num,text,label in [('FileNotFoundError',2,'No such file or directory','ENOENT'),('PermissionError',13,'Permission denied','EACCES'),('ProcessLookupError',3,'No such process','ESRCH')]:
 p={**payload,'stderrBase64':base64.b64encode((name+': [Errno '+str(num)+"] "+text+": '/proc/2147483647/stat'\n").encode()).decode()}
 assert classify(p,d)=='authenticated-public-peer-'+label,(name,classify(p,d))
for changed in [{**payload,'rawPublicPeerEvidenceRetained':False},{**payload,'argv':argv+['foreign']},{**payload,'argv':argv[:11]+['print("private")']+argv[12:]}]:
 assert classify(changed,d)=='unclassified-private-command'
p={**payload,'stderrBase64':base64.b64encode(b'AssertionError\n').decode()};assert classify(p,d)=='authenticated-public-peer-other-refusal'
# Same original argv/env/timeout/result and exception objects through frozen observer.
for fail in [False,True]:
 saved={};env={'FIXTURE':'exact'};error=subprocess.TimeoutExpired(argv,8,output=b'partial',stderr=b'public-timeout')
 expected=subprocess.CompletedProcess(argv,1,b'public-out',b'public-error')
 def original(*args,**kwargs):
  assert args[0]is argv and kwargs=={'capture_output':True,'timeout':8,'env':env}
  assert kwargs['env']is env
  if fail:raise error
  return expected
 trace=d.SubprocessDiagnostics(original,lambda name,raw:(saved.setdefault(name,raw)and d.sha(raw)))
 if fail:
  try:trace(argv,capture_output=True,timeout=8,env=env)
  except subprocess.TimeoutExpired as seen:assert seen is error
  else:raise AssertionError('same original timeout')
 else:assert trace(argv,capture_output=True,timeout=8,env=env)is expected
 assert len(saved)==1 and json.loads(next(iter(saved.values())))['rawPublicPeerEvidenceRetained']is True
# Execute exactly the actual one-call try/finally body, without remote main/SSH.
trial=next(n for n in ast.walk(r)if isinstance(n,ast.Try)and any(isinstance(c,ast.Call)and ast.unparse(c.func)=='observer.actor_current'for b in n.body for c in ast.walk(b))and n.finalbody and len(n.body)==2)
fn=ast.FunctionDef(name='invoke',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg=n)for n in ['observer','REFS','subprocess','original_run','trace']],kwonlyargs=[],kw_defaults=[],defaults=[]),body=[ast.Assign(targets=[ast.Attribute(value=ast.Name(id='subprocess',ctx=ast.Load()),attr='run',ctx=ast.Store())],value=ast.Name(id='trace',ctx=ast.Load())),copy.deepcopy(trial),ast.Return(value=ast.Name(id='current',ctx=ast.Load()))],decorator_list=[])
namespace={};exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(F),'exec'),namespace)
for fail in [False,True]:
 original=object();trace=object();sub=types.SimpleNamespace(run=original);error=RuntimeError('fixture original current refusal');expected=object();calls=[]
 def actor(result_sha,input_sha):
  calls.append((result_sha,input_sha));assert sub.run is trace
  if fail:raise error
  return expected
 observer=types.SimpleNamespace(actor_current=actor)
 try:value=namespace['invoke'](observer,{'resultSha256':'actual-result','inputSha256':'actual-input'},sub,original,trace)
 except RuntimeError as seen:assert fail and seen is error
 else:assert not fail and value is expected
 assert sub.run is original and calls==[('actual-result','actual-input')]
# Real private exclusive0600 writes, with no source/current execution.
def need(ok,code):
 if not ok:raise RuntimeError(code)
with tempfile.TemporaryDirectory()as folder:
 wscope={'AUDIT':Path(folder),'private_hashes':{},'need':need,'re':re,'os':os,'sha':d.sha,'encoded':d.encoded}
 exec(compile(ast.fix_missing_locations(ast.Module(body=[functions['sync'],functions['write']],type_ignores=[])),str(F),'exec'),wscope)
 digest=wscope['write']('fixture.json',{'private':'fixture'});assert (Path(folder)/'fixture.json').stat().st_mode&0o777==0o600
 try:wscope['write']('fixture.json',{})
 except FileExistsError:pass
 else:raise AssertionError('must preserve file')
# Actual AST has no old drain dispatcher, current observations exactly one.
names=[ast.unparse(n.func)for n in ast.walk(r)if isinstance(n,ast.Call)]
assert names.count('observer.actor_current')==1 and names.count('diagnostic.SubprocessDiagnostics')==1
assert not any(n in names for n in ['diagnostic.executor','diagnostic.capture','diagnostic.run','diagnostic.main','observer.main'])
compile(source,str(F),'exec');compile(remote,str(F)+':REMOTE','exec')
print('diagnostic actualAST14groupsPASS: publicscript3errno+3foreign+other, exactresult/timeout2, once/restore2, realprivatewrites, noold/effects dispatch; no SSH/DB')
