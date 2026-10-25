#!/usr/bin/env python3
"""One strict Source6 postflight with private pass-through inventory diagnostics.

Default/import are inert. Root alone may explicitly invoke --run after review.
No retry, service action, cache baseline, held transaction or policy change.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

RESULT=Path('/tmp/yunipals-source6-postflight-inventory-diagnostic-production-20261025-1.json')
REMOTE=r'''import ast,datetime,hashlib,json,os,pathlib,re,signal,socket,stat,traceback,types,time
os.umask(0o077)
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
GUARD=OPS/'ypal-ordinary-source-authority-v6.py'
GUARD_SHA='36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82'
GUARD_MANIFEST=OPS/'ypal-ordinary-source-authority-v6.manifest.json'
GUARD_MANIFEST_SHA='80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452'
INVENTORY=OPS/'ypal-old-runtime-inventory-v1.py'
INVENTORY_SHA='7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'
RUNTIME=OPS/'ypal-alchemy-ordinary-runtime-v1.py'
RUNTIME_SHA='3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
AUDIT=pathlib.Path('/var/backups/yunipals-root-source6-postflight-inventory-diagnostic-20261025-1')
started=time.monotonic_ns();phase='authenticate';failed_commands=[];observed_commands=0;instrumented=[];proofs={};authority=None;before=None

def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def save(name,value):
 raw=value if isinstance(value,bytes)else encoded(value)
 fd=os.open(AUDIT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AUDIT);return sha(raw)
def protected(path,digest=None):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_diagnostic_input_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=4000000 and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_actual_diagnostic_input_bytes_required')
 return raw
def load(path,digest):
 raw=protected(path,digest);value=types.ModuleType('root_diagnostic_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value
def limit(_signal,_frame):raise RuntimeError('bounded_readonly_source_diagnostic_expired_no_retry')

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_source_diagnostic_host_required')
need(not os.path.lexists(AUDIT),'fresh_exclusive_source_diagnostic_audit_required')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,limit);signal.alarm(560)

def record_command(argv,kwargs,value=None,error=None):
 # The original inventory predicate still decides acceptance after this returns.
 index=len(failed_commands)+1;prefix='failed-command-'+str(index)
 stdout=(getattr(error,'stdout',None)or b'')if error is not None else value.stdout
 stderr=(getattr(error,'stderr',None)or b'')if error is not None else value.stderr
 if isinstance(stdout,str):stdout=stdout.encode()
 if isinstance(stderr,str):stderr=stderr.encode()
 argv_sha=save(prefix+'-argv.private.json',{'argv':argv,'kwargs':kwargs,'phase':phase,'observedAt':now()})
 stdout_sha=save(prefix+'-stdout.private',stdout);stderr_sha=save(prefix+'-stderr.private',stderr)
 summary={'index':index,'phase':phase,'argvFileSha256':argv_sha,'stdoutSha256':stdout_sha,'stderrSha256':stderr_sha,
  'stdoutBytes':len(stdout),'stderrBytes':len(stderr),'returnCode':None if value is None else value.returncode,
  'exceptionClass':None if error is None else type(error).__name__,
  'stderrContainsFileNotFoundError':b'FileNotFoundError'in stderr,'stderrContainsPermissionError':b'PermissionError'in stderr,
  'stderrContainsAssertionError':b'AssertionError'in stderr,'originalPredicateRetained':True,'commandRetried':False}
 save(prefix+'-summary.json',summary);failed_commands.append(summary)

def install_inventory(observer,expected):
 if any(observer is item for item in instrumented):return
 need(pathlib.Path(observer.__file__)==INVENTORY,'exact_fixed_inventory_namespace_required')
 original=observer.run;reference=expected.run
 need(isinstance(original,types.FunctionType)and original.__code__.co_code==reference.__code__.co_code and
  original.__code__.co_consts==reference.__code__.co_consts and original.__code__.co_names==reference.__code__.co_names and
  original.__defaults__==reference.__defaults__ and not original.__code__.co_freevars,
  'complete_original_inventory_run_body_required_before_logging')
 delegate=original.__globals__['subprocess'];proxy=types.SimpleNamespace(**delegate.__dict__)
 def observed_run(argv,**kwargs):
  global observed_commands
  observed_commands+=1
  try:value=delegate.run(argv,**kwargs)
  except BaseException as error:
   record_command(argv,kwargs,error=error);raise
  if value.returncode!=0 or value.stderr or len(value.stdout)>2_000_000:record_command(argv,kwargs,value=value)
  return value
 proxy.run=observed_run
 # Same run code/defaults/need/CLEAN, same argv/kwargs and same returned object.
 # Only this private diagnostic namespace's subprocess binding is observed.
 observer.run=types.FunctionType(original.__code__,{**original.__globals__,'subprocess':proxy},
  original.__name__,original.__defaults__,original.__closure__)
 need(observer.run.__code__ is original.__code__,'same_strict_inventory_run_code_required')
 instrumented.append(observer)

def install_runtime(runtime,expected):
 parent=runtime.Owner
 class ObservedOwner(parent):
  def __init__(self,*args,**kwargs):
   super().__init__(*args,**kwargs);install_inventory(self.h.observer,expected)
 runtime.Owner=ObservedOwner
 # validate_current_source and Owner.current/source_sessions bodies are inherited
 # unchanged. Every fresh actual Owner is constructed before its observer logs.

def inspect_after_failure():
 result={'actorPrivateFrameMatched':False,'limitedNativePassed':False,'positiveBackendAttributionQualified':False}
 if authority is None or before is None:return result
 try:
  frame=authority._snapshot();proofs['post-failure-frame']=save('post-failure-frame.private.json',frame)
  result['actorPrivateFrameMatched']=frame==before==authority.expected
 except Exception as error:
  result['frameErrorClass']=type(error).__name__;save('post-failure-frame-error.private.txt',traceback.format_exc().encode())
 try:
  native=authority._native();proofs['post-failure-native']=save('post-failure-native.private.json',native)
  result['limitedNativePassed']=True
 except Exception as error:
  result['nativeErrorClass']=type(error).__name__;save('post-failure-native-error.private.txt',traceback.format_exc().encode())
 return result

try:
 guard_raw=protected(GUARD,GUARD_SHA);manifest=json.loads(protected(GUARD_MANIFEST,GUARD_MANIFEST_SHA))
 pins=ast.literal_eval(next(node.value for node in ast.parse(guard_raw).body if isinstance(node,ast.Assign)and
  len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS'))
 need(manifest=={'format':'yunipals-ypal-ordinary-source-authority-v6-source','files':{GUARD.name:GUARD_SHA,**pins}},'actual_guard6_finite_source_manifest_required')
 for name,digest in manifest['files'].items():protected(OPS/name,digest)
 expected_inventory=load(INVENTORY,INVENTORY_SHA);guard=load(GUARD,GUARD_SHA)
 report=json.loads(protected(REPORT,REPORT_SHA));refs=report['sourceRefs']
 need(type(refs)is dict and set(refs)=={'resultSha256','inputSha256'},'actual_ordinary_source_ref2_required')
 authority=guard.Authority(refs['resultSha256'],refs['inputSha256'])
 # The existing caller's SourcePhase constructs this exact read_config=None
 # Authority. No metadata/READ/full-caller success is claimed by this diagnostic.
 install_inventory(authority.owner.h.observer,expected_inventory)
 original_module=authority.intake.module
 def observed_module(path,digest):
  value=original_module(path,digest)
  if pathlib.Path(path)==RUNTIME:
   need(digest==RUNTIME_SHA,'exact_original_runtime_before_diagnostic_constructor_required');install_runtime(value,expected_inventory)
  return value
 authority.intake.module=observed_module
 phase='genuine-source6-preflight'
 preflight=authority.preflight();proofs['preflight']=save('genuine-source6-preflight.private.json',preflight)
 before=authority._snapshot();guard.equal_or_fail('actual_preflight_actor_private_frame_before_finish_required',authority.expected,before)
 proofs['before-frame']=save('before-finish-frame.private.json',before)
 phase='one-genuine-source6-finish'
 value=authority.finish();proofs['finish']=save('genuine-source6-finish.private.json',value)
 after=authority._snapshot();guard.equal_or_fail('same_actor_private_frame_after_genuine_finish_required',before,after)
 proofs['after-frame']=save('after-finish-frame.private.json',after)
 signal.alarm(0)
 result={'format':'root-source6-postflight-inventory-diagnostic-v1','completed':True,'genuineFinishReturned':True,
  'phase':phase,'observedAt':now(),'instrumentedObserverCount':len(instrumented),'commandsObserved':observed_commands,
  'failedCommands':failed_commands,'proofHashes':proofs,'diagnosticOnly':True,'sourcePolicyChanged':False,
  'fullCallerOrMetadataQualified':False,'productionAcceptanceClaimed':False,'automaticRetryAllowed':False,
  'databaseWrites':0,'serviceActions':0,'providerCalls':0,'elapsedNanoseconds':time.monotonic_ns()-started}
 digest=save('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True))
except BaseException as error:
 diagnostic=save('failure.private.txt',traceback.format_exc().encode())
 # Preserve the original error. Limited postfailure reads cannot substitute a
 # whole current proof or turn this failed finish into acceptance.
 limited=inspect_after_failure();signal.alarm(0)
 result={'format':'root-source6-postflight-inventory-diagnostic-v1','completed':False,'genuineFinishReturned':False,
  'phase':phase,'observedAt':now(),'errorClass':type(error).__name__,'privateTracebackSha256':diagnostic,
  'instrumentedObserverCount':len(instrumented),'commandsObserved':observed_commands,'failedCommands':failed_commands,
  'limitedPostfailure':limited,'proofHashes':proofs,'diagnosticOnly':True,'sourcePolicyChanged':False,
  'fullCallerOrMetadataQualified':False,'productionAcceptanceClaimed':False,'automaticRetryAllowed':False,
  'databaseWrites':0,'serviceActions':0,'providerCalls':0,'elapsedNanoseconds':time.monotonic_ns()-started}
 digest=save('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True));raise
'''


def exclusive(path,value):
    raw=(json.dumps(value,sort_keys=True)+'\n').encode();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:
        print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    os.umask(0o077);started=time.monotonic()
    if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_diagnostic_result_required_no_retry')
    try:
        process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
            input=REMOTE,capture_output=True,text=True,timeout=max(1,600-(time.monotonic()-started)))
        try:result=json.loads(process.stdout)
        except Exception:result={'completed':False,'remoteAuditInspectionRequired':True,'diagnosticOnly':True,'automaticRetryAllowed':False}
        if process.returncode!=0 or process.stderr:
            exclusive(Path('/tmp/yunipals-source6-postflight-inventory-diagnostic-transport-private-20261025-1.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result['strictOriginalExceptionRetained']=process.returncode!=0;result['remoteAuditInspectionRequired']=True
    except subprocess.TimeoutExpired as error:
        exclusive(Path('/tmp/yunipals-source6-postflight-inventory-diagnostic-timeout-private-20261025-1.json'),
            {'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
             'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
        result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
    exclusive(RESULT,result);print(json.dumps(result,sort_keys=True))
    raise SystemExit(0 if result.get('completed')is True else 1)


if __name__=='__main__':main()
