#!/usr/bin/env python3
"""One strict Source6 current with private kernel-frame diagnostics; default/import inert."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

RESULT=Path('/tmp/yunipals-source6-kernel-diagnostic-production-20261026-1.json')
REMOTE=r'''import ast,copy,datetime,hashlib,json,marshal,os,pathlib,re,signal,socket,stat,sys,time,traceback,types
os.umask(0o077)
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-source6-kernel-diagnostic-20261026-1')
GUARD=OPS/'ypal-ordinary-source-authority-v6.py'
GUARD_SHA='36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82'
GUARD_MANIFEST=OPS/'ypal-ordinary-source-authority-v6.manifest.json'
GUARD_MANIFEST_SHA='80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452'
INVENTORY=OPS/'ypal-old-runtime-inventory-v1.py'
INVENTORY_SHA='7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'
HOST=OPS/'ypal-alchemy-source-switch-v1.host.py'
HOST_SHA='3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
FIXED='all_required_backends_need_unique_positive_stable_kernel_attribution'
started=time.monotonic_ns();stage='authenticate';error=None;authority=None;before=None;collector=None;private_hashes={};deadline_hit=False

def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def write(name,value):
 need(re.fullmatch('[a-z0-9-]+\\.(json|txt)',name)is not None,'fixed_private_kernel_diagnostic_name_required')
 raw=value if isinstance(value,bytes)else encoded(value)
 fd=os.open(AUDIT/name,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AUDIT);private_hashes[name]=sha(raw);return sha(raw)
def protected(path,digest=None):
 path=pathlib.Path(path)
 for part in[*path.parents,path]:
  row=part.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_kernel_diagnostic_source_required')
 before_stat=path.lstat();raw=path.read_bytes();after_stat=path.lstat()
 need(stat.S_ISREG(before_stat.st_mode)and before_stat.st_nlink==1 and 0<len(raw)==before_stat.st_size<=4000000 and
  all(getattr(before_stat,k)==getattr(after_stat,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_actual_kernel_diagnostic_source_required')
 return raw
def load(path,digest):
 raw=protected(path,digest);value=types.ModuleType('root_kernel_diagnostic_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value
def source_pins(raw):
 rows=[node for node in ast.parse(raw).body if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
 need(len(rows)==1,'one_actual_source6_literal_pin_map_required');return ast.literal_eval(rows[0].value)
def code_shape(code):
 return(tuple(getattr(code,key)for key in['co_argcount','co_posonlyargcount','co_kwonlyargcount','co_nlocals','co_stacksize','co_flags',
  'co_code','co_names','co_varnames','co_freevars','co_cellvars','co_filename','co_name','co_qualname','co_firstlineno','co_linetable','co_exceptiontable']),
  tuple(code_shape(value)if isinstance(value,types.CodeType)else value for value in code.co_consts))
def deadline(*_):
 global deadline_hit
 deadline_hit=True;raise RuntimeError('bounded_one_source6_kernel_diagnostic_expired')

class KernelFrames:
 """Observe only the two actual code objects; never alter a call or result."""
 def __init__(self,kernel,mapping):
  self.kernel_code=kernel.__code__;self.mapping_code=mapping.__code__;self.frames=[];self.maps=[];self.errors=[];self.calls=0;self.active={};self.maximum=4000000
 def retain(self,value):
  raw=encoded(value)
  if len(raw)>self.maximum:raise ValueError('private_kernel_frame_exceeded_capture_bound')
  return json.loads(raw)
 def __call__(self,frame,event,arg):
  if frame.f_code is not self.kernel_code and frame.f_code is not self.mapping_code:return None
  try:
   if frame.f_code is self.kernel_code:
    if event=='call':
     if self.calls>=3:raise ValueError('original_source6_kernel_attempt_bound_exceeded')
     self.calls+=1;self.active[id(frame)]=self.calls
    elif event=='exception'and type(arg[1])is RuntimeError and str(arg[1])==FIXED:
     fields=['role','actors','uid_gid','require_all','sql','rows','backend_fds','peers','tcp','result','ids','name','actor','own']
     self.frames.append(self.retain({'attempt':self.active.get(id(frame)),'fixedCode':FIXED,
      'exceptionClass':type(arg[1]).__name__,'locals':{key:frame.f_locals[key]for key in fields if key in frame.f_locals}}))
    elif event=='return':self.active.pop(id(frame),None)
   elif event=='return'and frame.f_back is not None and frame.f_back.f_code is self.kernel_code:
    fields=['actor_fds','backend_fds','rows','peers','tcp','matches']
    if len(self.maps)>=6:raise ValueError('original_bounded_actor_map_capture_limit_exceeded')
    self.maps.append(self.retain({'attempt':self.active.get(id(frame.f_back)),
     'actorName':frame.f_back.f_locals.get('name'),'locals':{key:frame.f_locals[key]for key in fields if key in frame.f_locals},'returned':arg}))
  except (TypeError,ValueError,OverflowError,RecursionError)as caught:
   # Capture failures are diagnostic evidence only. Original source guards and
   # original cancellation/clock exceptions retain their exact behavior.
   if len(self.errors)<8:self.errors.append({'class':type(caught).__name__,'code':str(caught)[:160]})
  return self

def kernel_summary(value):
 observations=[]
 for row in value.frames:
  local=row['locals'];rows=local.get('rows',[]);ids=local.get('ids',[]);wanted={item['pid']for item in rows}
  duplicate=len(ids)!=len(set(ids));missing=wanted-set(ids);extra=set(ids)-wanted
  observations.append({'attempt':row['attempt'],'rowCount':len(rows),'mappedCount':len(ids),'mappedUniqueCount':len(set(ids)),
   'duplicateAttributionObserved':duplicate,'unmappedCount':len(missing),'foreignMappedCount':len(extra),
   'fixedPrefixRefusalObserved':True,'finalKernelQueryObserved':False,
   'classification':'duplicate-and-incomplete'if duplicate and missing else 'duplicate'if duplicate else 'incomplete'if missing else 'foreign-map'if extra else 'unclassified-prefix'
   })
 return observations

def limited_postfailure():
 value={'actorPrivateRouteFrameMatched':False,'postfailurePopulationObserved':False,'positiveBackendAttributionQualified':False,
  'separateDiagnosticOnly':True,'originalFailedResultPreserved':True}
 if authority is None or before is None or deadline_hit:return value
 try:
  frame=authority._snapshot();write('post-failure-frame-private.json',frame);value['actorPrivateRouteFrameMatched']=frame==before==authority.expected
 except Exception as caught:
  value['frameErrorClass']=type(caught).__name__;write('post-failure-frame-error-private.txt',traceback.format_exc().encode())
 if not value['actorPrivateRouteFrameMatched']or deadline_hit or collector is None or not collector.frames:return value
 # This is a separate, one-shot population observation AFTER the original
 # strict current() has failed. It cannot authorize or retry that observation.
 try:
  failed=collector.frames[-1]['locals'];wanted={item['pid']:item for item in failed.get('rows',[])}
  unmapped=sorted(set(wanted)-set(failed.get('ids',[])))
  rows=authority.owner.h.source.query(guard.SESSION_SQL)
  need(namespace.valid_final_source_rows(rows),'bounded_unique_postfailure_role_population_required')
  epochs={(item['pid'],item['backendStart'])for item in rows};probes=[]
  for pid in unmapped:
   current_ticks=guard.proc_epoch(pid);original_ticks=failed.get('backend_fds',{}).get(str(pid),{}).get('startTicks')
   probes.append({'initialRow':wanted[pid],'initialProcessStartTicks':original_ticks,'actualProcessStartTicks':current_ticks,
    'initialDatabaseEpochGone':(pid,wanted[pid]['backendStart'])not in epochs,
    'initialProcessEpochGone':current_ticks is None or original_ticks is not None and current_ticks!=original_ticks})
  write('post-failure-population-private.json',{'rows':rows,'unmappedInitialEpochProbes':probes,'separateDiagnosticOnly':True,
   'originalCurrentPassed':False,'queryCount':1,'positiveAttributionQualified':False})
  value.update(postfailurePopulationObserved=True,postfailureRoleRowCount=len(rows),unmappedInitialProbeCount=len(probes),
   initialDatabaseEpochGoneCount=sum(item['initialDatabaseEpochGone']for item in probes),
   initialProcessEpochGoneCount=sum(item['initialProcessEpochGone']for item in probes))
 except Exception as caught:
  value['populationErrorClass']=type(caught).__name__;write('post-failure-population-error-private.txt',traceback.format_exc().encode())
 return value

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_kernel_diagnostic_host_required')
need(sys.getprofile()is None and sys.gettrace()is None,'unprofiled_untraced_kernel_diagnostic_interpreter_required')
need(not os.path.lexists(AUDIT),'exclusive_new_source6_kernel_diagnostic_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(560)
invoked=False;limited={};current=None
try:
 raw=protected(GUARD,GUARD_SHA);manifest=json.loads(protected(GUARD_MANIFEST,GUARD_MANIFEST_SHA))
 need(manifest=={'format':'yunipals-ypal-ordinary-source-authority-v6-source','files':{GUARD.name:GUARD_SHA,**source_pins(raw)}},'actual_complete_source6_direct_source_manifest_required')
 for name,digest in manifest['files'].items():
  need(pathlib.Path(name).name==name and re.fullmatch('[a-f0-9]{64}',digest)is not None,'actual_fixed_source6_pin_required');protected(OPS/name,digest)
 protected(HOST,HOST_SHA);inventory=load(INVENTORY,INVENTORY_SHA);guard=load(GUARD,GUARD_SHA);namespace=guard.composition()
 report=json.loads(protected(REPORT,REPORT_SHA));refs=report['sourceRefs']
 need(type(refs)is dict and set(refs)=={'resultSha256','inputSha256'}and all(type(pin)is str and re.fullmatch('[a-f0-9]{64}',pin)for pin in refs.values()),'actual_ordinary_source_refs2_required')
 write('intent.json',{'format':'root-source6-kernel-diagnostic-v1','guardSha256':GUARD_SHA,'hostSha256':HOST_SHA,'inventorySha256':INVENTORY_SHA,
  'sourceRefs':refs,'maximumCurrentCalls':1,'maximumSeconds':560,'automaticRetryAllowed':False,'originalSourcePolicyChanged':False})
 stage='genuine-source6-preflight';authority=namespace.Authority(refs['resultSha256'],refs['inputSha256'])
 preflight=authority.preflight();write('source6-preflight-private.json',preflight)
 before=authority._snapshot();namespace.equal_or_fail('same_full_source_frame_before_one_kernel_diagnostic_required',authority.expected,before)
 write('source-frame-before-private.json',before)
 expected_kernel=namespace.classified_kernel(authority.owner.c.host_module);actual_mapping=authority.owner.h.observer.map_owned_backends
 need(code_shape(authority.kernel_function.__code__)==code_shape(expected_kernel.__code__)and
  authority.kernel_function.__defaults__==expected_kernel.__defaults__ and authority.kernel_function.__closure__==expected_kernel.__closure__ and
  code_shape(actual_mapping.__code__)==code_shape(inventory.map_owned_backends.__code__)and
  actual_mapping.__defaults__==inventory.map_owned_backends.__defaults__ and actual_mapping.__closure__==inventory.map_owned_backends.__closure__,
  'exact_genuine_source6_derived_kernel_and_original_mapping_bodies_required')
 collector=KernelFrames(authority.kernel_function,actual_mapping);stage='one-genuine-source6-current'
 sys.settrace(collector)
 try:
  invoked=True;current=authority.current()
 finally:sys.settrace(None)
 write('source6-current-private.json',{'binding':current,'observation':authority.last_observation})
 after=authority._snapshot();namespace.equal_or_fail('same_full_source_actor_private_route_frame_after_current_required',before,after)
 write('source-frame-after-private.json',after);stage='complete'
except BaseException as caught:
 error=caught;sys.settrace(None);write('failure-private.txt',traceback.format_exc().encode())
 limited=limited_postfailure()
finally:
 sys.settrace(None);signal.alarm(0)
if collector is not None:
 write('kernel-frames-private.json',{'kernelFailures':collector.frames,'actorMaps':collector.maps,'captureErrors':collector.errors,
  'actualKernelAttempts':getattr(authority,'kernel_attempts',[]),'traceCodeChanged':False,'queryReissuedByDiagnostic':False})
result={'format':'root-source6-kernel-diagnostic-v1','completed':error is None,'stage':stage,
 'guardSha256':GUARD_SHA,'hostSha256':HOST_SHA,'inventorySha256':INVENTORY_SHA,'genuineCurrentInvoked':invoked,'genuineCurrentReturned':current is not None,
 'wholeCallerOrMetadataQualified':False,'originalHeldFailureRelabelled':False,'newRetryPolicyQualified':False,'sourcePolicyChanged':False,
 'kernelCallCount':collector.calls if collector is not None else 0,'actorMapCaptureCount':len(collector.maps)if collector is not None else 0,
 'kernelRefusalCaptureCount':len(collector.frames)if collector is not None else 0,'diagnosticCaptureErrorCount':len(collector.errors)if collector is not None else 0,
 'kernelSummaries':kernel_summary(collector)if collector is not None else[],'limitedPostfailure':limited,'privateHashes':dict(private_hashes),
 'errorClass':type(error).__name__ if error is not None else None,
 'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else('private-diagnostics-retained'if error is not None else None),
 'traceRestored':sys.gettrace()is None,'automaticRetryAllowed':False,'databaseMutationRequested':False,
 'databaseWrites':0,'serviceActions':0,'providerCalls':0,'elapsedNanoseconds':time.monotonic_ns()-started}
digest=write('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True));raise SystemExit(0 if result['completed']else 1)
'''

def exclusive(path,value):
 raw=(json.dumps(value,sort_keys=True)+'\n').encode();fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
 if not args.run:print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0}));return
 os.umask(0o077);started=time.monotonic()
 if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('new_root_diagnostic_result_required_no_retry')
 try:
  process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
   '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
   input=REMOTE,capture_output=True,text=True,timeout=max(1,600-(time.monotonic()-started)))
  try:
   result=json.loads(process.stdout)
   if type(result)is not dict or result.get('format')!='root-source6-kernel-diagnostic-v1'or type(result.get('completed'))is not bool:raise ValueError('unexpected root envelope')
  except Exception:result={'completed':False,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
  if process.returncode!=0 or process.stderr or result.get('remoteAuditInspectionRequired'):
   exclusive(Path('/tmp/yunipals-source6-kernel-diagnostic-transport-private-20261026-1.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result.update(completed=False,remoteAuditInspectionRequired=True)
 except subprocess.TimeoutExpired as error:
  exclusive(Path('/tmp/yunipals-source6-kernel-diagnostic-timeout-private-20261026-1.json'),
   {'stdout':error.stdout.decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
    'stderr':error.stderr.decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
  result={'completed':False,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'rootDriverTimedOut':True}
 exclusive(RESULT,result);print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result.get('completed')is True else 1)
if __name__=='__main__':main()
