#!/usr/bin/env python3
"""One original ordinary runtime observation; default/import inert, no retry."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

FORMAT='root-cont6-runtime-peer-diagnostic-v1'
RESULT=Path('/tmp/yunipals-cont6-runtime-peer-diagnostic-production-20261026-1.json')
TRANSPORT=Path('/tmp/yunipals-cont6-runtime-peer-diagnostic-transport-private-20261026-1.json')
REMOTE=r'''import ast,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,sys,time,traceback,types
os.umask(0o077)
FORMAT='root-cont6-runtime-peer-diagnostic-v1'
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont6-runtime-peer-diagnostic-20261026-1')
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
RUNTIME=OPS/'ypal-alchemy-ordinary-runtime-v1.py'
RUNTIME_SHA='3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'
DIAGNOSTIC=OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py'
DIAGNOSTIC_SHA='2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465'
FAILED=pathlib.Path('/var/backups/yunipals-root-cont6-baseline-20261026-3')
FAILED_SHA='bbf9beeb941a239d8b22fab7ad52ee2ad300c42da1c78928a4a689698082232a'
CACHE_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v6-20261026')
FAILED_CAPTURE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v6-20261026/captures/cont6-baseline-20261026-3')
stage='authenticate';trace=None;invoked=False;error=None;proofs={};payloads=[];original_run=subprocess.run;started=time.monotonic_ns()
def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+chr(10)).encode()
def read(path,digest=None):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_runtime_diagnostic_file_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=6000000 and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_exact_runtime_diagnostic_file_required');return raw
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def write(name,value):
 need(re.fullmatch('[a-z0-9-]+[.](json|txt)',name)is not None,'fixed_private_runtime_diagnostic_filename_required')
 raw=value if isinstance(value,bytes)else encoded(value)
 fd=os.open(AUDIT/name,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AUDIT);proofs[name]=sha(raw);return sha(raw)
def load(path,digest):
 raw=read(path,digest);value=types.ModuleType('readonly_runtime_diagnostic_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value
def save_failed(name,raw):
 payloads.append(json.loads(raw));return write(name,raw)
def authenticate():
 previous=json.loads(read(FAILED/'result.private.json',FAILED_SHA))
 need(previous['format']=='yunipals-root-cont6-baseline-v3'and previous['completed']is False and previous['stage']=='full-source-preflight'and
  previous['constructInvoked']is previous['constructReturned']is previous['cacheCommitRequested']is previous['readerLOGINRequested']is False and
  previous['serviceActionsRequested']==0 and previous['fixedCode']=='bounded_readonly_inventory_command_required'and
  not os.path.lexists(CACHE_BASE)and not os.path.lexists(FAILED_CAPTURE),'actual_third_preconstruct_inventory_refusal_without_baseline_or_effects_required')
 detail=json.loads(read(FAILED/'failure-traceback.private.json',previous['proofHashes']['failureTraceback']))
 need(detail['type']=='RuntimeError'and all(name in detail['traceback']for name in['source_sessions','kernel_backends','peer_fds','ypal-old-runtime-inventory-v1.py']),
  'actual_original_runtime_peer_inventory_failure_trace_required')
 refs=json.loads(read(REPORT,REPORT_SHA))['sourceRefs']
 need(type(refs)is dict and set(refs)=={'resultSha256','inputSha256'}and all(type(value)is str and re.fullmatch('[a-f0-9]{64}',value)for value in refs.values()),
  'actual_protected_ordinary_source_refs_required')
 raw=read(RUNTIME,RUNTIME_SHA);rows=[row for row in ast.parse(raw).body if isinstance(row,ast.Assign)and len(row.targets)==1 and isinstance(row.targets[0],ast.Name)and row.targets[0].id=='PINS']
 need(len(rows)==1,'one_actual_original_runtime_literal_source_closure_required');pins=ast.literal_eval(rows[0].value)
 need(type(pins)is dict and all(type(name)is str and pathlib.Path(name).name==name and type(digest)is str and re.fullmatch('[a-f0-9]{64}',digest)for name,digest in pins.items()),'finite_pinned_runtime_source_closure_required')
 for name,digest in pins.items():read(OPS/name,digest)
 return refs

def observe(runtime,diagnostic,refs):
 global trace,invoked
 trace=diagnostic.SubprocessDiagnostics(original_run,save_failed);subprocess.run=trace
 try:
  invoked=True
  return runtime.validate_current_source(refs['resultSha256'],refs['inputSha256'])
 finally:subprocess.run=original_run

def main():
 global stage,error
 need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_runtime_diagnostic_host_required')
 need(sys.getprofile()is None and sys.gettrace()is None,'unprofiled_untraced_runtime_diagnostic_required')
 AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
 write('intent.json',{'format':FORMAT,'runtimeSha256':RUNTIME_SHA,'diagnosticSha256':DIAGNOSTIC_SHA,'failedRootResultSha256':FAILED_SHA,
  'maximumPublicRuntimeObservations':1,'maximumSeconds':180,'extraRetryIntroduced':False,'fullSourcePreflightRequested':False,'databaseMutationRequested':False})
 def expired(*_):raise TimeoutError('root_original_runtime_diagnostic_bound_expired')
 signal.signal(signal.SIGALRM,expired);signal.alarm(180)
 try:
  refs=authenticate();diagnostic=load(DIAGNOSTIC,DIAGNOSTIC_SHA);runtime=load(RUNTIME,RUNTIME_SHA)
  need(diagnostic.PUBLIC_INVENTORY_SHA=='7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'and
   diagnostic.PEER_FDS_SCRIPT_SHA=='fc771208678d07b7e76b1a7407439b553f1f1fb031272ad58d2391c51707be28','exact_existing_public_inventory_peer_diagnostic_required')
  stage='one-original-runtime-current';value=observe(runtime,diagnostic,refs)
  write('original-runtime-proof-private.json',value)
  need(value['validated']is value['currentWriterQualified']is True and value['terminalInverseOnly']is False and
   value['operatorSha256']==RUNTIME_SHA and value['inputSha256']==refs['inputSha256']and value['receiptSha']==refs['resultSha256']and
   value['financialAuthorityQualified']is False and value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
   'complete_genuine_original_runtime_current_leaf_required')
  stage='complete'
 except BaseException as caught:
  error=caught
  try:write('failure-private.txt',traceback.format_exc().encode())
  except BaseException:pass
 finally:subprocess.run=original_run;signal.alarm(0)
 if trace is not None:write('command-summaries-private.json',{'calls':trace.calls,'failures':trace.failures})
 result={'format':FORMAT,'completed':error is None,'stage':stage,'runtimeObservationInvoked':invoked,'originalRuntimeObservationPassed':error is None,
  'runtimeSha256':RUNTIME_SHA,'diagnosticSha256':DIAGNOSTIC_SHA,'failedRootResultSha256':FAILED_SHA,
  'commandCount':len(trace.calls)+sum(row['exceptionClass']is not None for row in payloads)if trace is not None else 0,
  'failedCommandCount':len(trace.failures)if trace is not None else 0,'rawPrivatePublicPeerFailureCount':sum(row['rawPublicPeerEvidenceRetained']is True for row in payloads),
  'errorClass':type(error).__name__ if error is not None else None,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else None,
  'subprocessRunRestored':subprocess.run is original_run,'elapsedNanoseconds':time.monotonic_ns()-started,'privateHashes':dict(proofs),
  'fullSourcePreflightQualified':False,'baselineQualified':False,'timingOrHeldAuthorityQualified':False,'oldFailedRunRelabelled':False,
  'automaticRetryAllowed':False,'extraRetryIntroduced':False,'databaseMutationRequested':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
 digest=write('result.json',result);print(encoded({**result,'resultSha256':digest}).decode(),end='');return 0 if result['completed']else 1
if __name__=='__main__':raise SystemExit(main())
'''

def exclusive(path,value):
 raw=(json.dumps(value,sort_keys=True)+chr(10)).encode();fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
 if not args.run:print(json.dumps({'format':FORMAT,'staticOnly':True,'SSHExecuted':False}));return 0
 os.umask(0o077)
 if os.path.lexists(RESULT)or os.path.lexists(TRANSPORT):raise RuntimeError('exclusive_new_root_runtime_diagnostic_namespace_required')
 try:
  peer=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
   '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],input=REMOTE.encode(),capture_output=True,timeout=200)
  out,err,status=peer.stdout,peer.stderr,peer.returncode
 except subprocess.TimeoutExpired as caught:out,err,status=caught.stdout or b'',caught.stderr or b'',None
 value=None
 try:
  candidate=json.loads(out)
  if type(candidate)is dict and candidate.get('format')==FORMAT and type(candidate.get('completed'))is bool and not err and status==(0 if candidate['completed']else 1):value=candidate
 except(ValueError,UnicodeError):pass
 if value is None:
  exclusive(TRANSPORT,{'stdoutHex':out.hex(),'stderrHex':err.hex(),'returncode':status})
  value={'format':FORMAT,'completed':False,'transportOutcomeUnknown':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
 exclusive(RESULT,value);print(json.dumps(value,sort_keys=True));return 0 if value['completed']else 1

if __name__=='__main__':raise SystemExit(main())
