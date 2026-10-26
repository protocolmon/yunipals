#!/usr/bin/env python3
"""One root-owned current actor diagnostic; default/import inert, no retries."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

RESULT=Path('/tmp/yunipals-metadata-current-peer-diagnostic-production-20261026-1.json')
REMOTE=r'''import ast,base64,datetime,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,sys,time,traceback,types
os.umask(0o077)
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-metadata-current-peer-diagnostic-20261026-1')
OBSERVER=OPS/'ypal-native-metadata-approval-current-observer-v1.py'
OBSERVER_SHA='17a24566753c1903e1c4be3a0f9d66f24d44cd9aaee30b16ceedb21cceeb2498'
OBSERVER_MANIFEST=OPS/'ypal-native-metadata-approval-current-observer-v1.manifest.json'
OBSERVER_MANIFEST_SHA='cbd018b3dd15b2874a6b6834e76b07538d2ac493831428d6701136de2a41d432'
DIAGNOSTIC=OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py'
DIAGNOSTIC_SHA='2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465'
REFS={'mode':'current','resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
 'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
 'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
 'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'}
started=time.monotonic_ns();stage='authenticate';trace=None;error=None;private_hashes={};payloads=[];observation_invoked=False;original_run=subprocess.run

def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def protected(path,digest=None):
 path=pathlib.Path(path)
 for part in[*path.parents,path]:
  row=part.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_readonly_diagnostic_source_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=4000000 and
  all(getattr(before,k)==getattr(after,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_actual_readonly_diagnostic_source_required')
 return raw
def write(name,value):
 need(re.fullmatch('[a-z0-9-]+\\.(json|txt)',name)is not None,'fixed_private_diagnostic_name_required')
 raw=value if isinstance(value,bytes)else encoded(value)
 fd=os.open(AUDIT/name,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AUDIT);private_hashes[name]=sha(raw);return sha(raw)
def load(path,digest):
 raw=protected(path,digest);m=types.ModuleType('root_current_diagnostic_'+path.stem.replace('-','_'));m.__file__=str(path)
 exec(compile(raw,str(path),'exec'),m.__dict__);return m
def save_failed(name,raw):
 payloads.append(json.loads(raw));return write(name,raw)
def public_error_class(payload,diagnostic):
 # No errno or process-epoch inference is made for any other command/script.
 if payload.get('rawPublicPeerEvidenceRetained')is not True or not diagnostic.public_fd_peer(payload.get('argv')):
  return 'unclassified-private-command'
 err=base64.b64decode(payload['stderrBase64'],validate=True).decode('utf-8',errors='replace')
 last=err.strip().splitlines()[-1]if err.strip()else''
 for name,number,label in [('FileNotFoundError','2','authenticated-public-peer-ENOENT'),
  ('PermissionError','13','authenticated-public-peer-EACCES'),('ProcessLookupError','3','authenticated-public-peer-ESRCH')]:
  if re.fullmatch(name+': \\[Errno '+number+r"\] [^\n]+: '/proc/[0-9]+/(?:stat|status|fd(?:/[0-9]+)?)'",last):return label
 return 'authenticated-public-peer-other-refusal'
def deadline(*_):raise RuntimeError('bounded_one_metadata_current_diagnostic_expired')

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_diagnostic_host_required')
need(sys.getprofile()is None and sys.gettrace()is None,'unprofiled_untraced_diagnostic_interpreter_required')
need(not os.path.lexists(AUDIT),'exclusive_new_current_diagnostic_namespace_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(180)
try:
 manifest=json.loads(protected(OBSERVER_MANIFEST,OBSERVER_MANIFEST_SHA));raw=protected(OBSERVER,OBSERVER_SHA)
 row=[n for n in ast.parse(raw).body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id=='SOURCE_PINS']
 need(len(row)==1,'actual_observer_literal_source_closure_required')
 expected={'format':'yunipals-native-metadata-approval-current-observer-v1-source','files':{OBSERVER.name:OBSERVER_SHA,**ast.literal_eval(row[0].value)}}
 need(manifest==expected,'complete_actual_observer_source_manifest_required')
 for name,digest in manifest['files'].items():
  need(pathlib.Path(name).name==name and re.fullmatch('[a-f0-9]{64}',digest)is not None,'finite_actual_observer_source_names_required');protected(OPS/name,digest)
 diagnostic=load(DIAGNOSTIC,DIAGNOSTIC_SHA);observer=load(OBSERVER,OBSERVER_SHA)
 need(diagnostic.PUBLIC_INVENTORY_SHA=='7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'and
  diagnostic.PEER_FDS_SCRIPT_SHA=='fc771208678d07b7e76b1a7407439b553f1f1fb031272ad58d2391c51707be28',
  'exact_public_only_peer_script_and_inventory_required')
 write('intent.json',{'format':'root-metadata-current-peer-diagnostic-v1','observerSha256':OBSERVER_SHA,'diagnosticSha256':DIAGNOSTIC_SHA,
  'metadataRefs':REFS,'maximumCurrentObservations':1,'maximumSeconds':180,'automaticRetryAllowed':False,
  'oldDrainDispatcherInvoked':False,'profilerInstalled':False,'sourceAuthorityRequested':False})
 stage='one-current-actor-observation';trace=diagnostic.SubprocessDiagnostics(original_run,save_failed)
 subprocess.run=trace
 try:
  observation_invoked=True
  current=observer.actor_current(REFS['resultSha256'],REFS['inputSha256'])
 finally:subprocess.run=original_run
 write('current-proof-private.json',current)
 need(current['validated']is current['currentActorQualified']is True and current['operatorSha256']==OBSERVER_SHA and
  current['upgradeRefs']==REFS and current['immutableAcknowledgementOnly']is current['originalOwner3CurrentPassed']is False and
  all(current[k]is False for k in['sourceActorQualified','READAuthorityQualified','publicationAuthorityQualified','financialAuthorityQualified'])and
  current['databaseWrites']==current['serviceActions']==current['providerCalls']==0,'genuine_complete_current_actor_leaf_required')
 stage='complete'
except BaseException as caught:
 error=caught;subprocess.run=original_run
 write('failure-private.txt',traceback.format_exc().encode())
finally:
 subprocess.run=original_run;signal.alarm(0)
if trace is not None:write('command-summaries-private.json',{'calls':trace.calls,'failures':trace.failures})
classes=[public_error_class(row,diagnostic)for row in payloads]if trace is not None else[]
exception_commands=sum(row['exceptionClass']is not None for row in payloads)
result={'format':'root-metadata-current-peer-diagnostic-v1','completed':error is None,'stage':stage,
 'observerSha256':OBSERVER_SHA,'diagnosticSha256':DIAGNOSTIC_SHA,'currentObservationInvoked':observation_invoked,
 'currentActorQualified':error is None,'currentLeafOnly':True,'wholeCurrentOrBaselineQualified':False,
 'sourceAuthorityQualified':False,'newRetryPolicyQualified':False,'originalFailedCONT5RunRelabelled':False,
 'profilerInstalled':False,'subprocessRunRestored':subprocess.run is original_run,'oldDrainDispatcherInvoked':False,
 'commandCount':len(trace.calls)+exception_commands if trace is not None else 0,
 'failedCommandCount':len(trace.failures)if trace is not None else 0,'rawPublicPeerFailureCount':sum(row['rawPublicPeerEvidenceRetained']is True for row in payloads),
 'publicPeerErrorClasses':classes,'privateHashes':dict(private_hashes),'errorClass':type(error).__name__ if error is not None else None,
 'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else('private-diagnostics-retained'if error is not None else None),
 'elapsedNanoseconds':time.monotonic_ns()-started,'automaticRetryAllowed':False,
 'databaseMutationRequested':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
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
   input=REMOTE,capture_output=True,text=True,timeout=max(1,200-(time.monotonic()-started)))
  try:
   result=json.loads(process.stdout)
   if type(result)is not dict or result.get('format')!='root-metadata-current-peer-diagnostic-v1'or type(result.get('completed'))is not bool:raise ValueError('unexpected root envelope')
  except Exception:result={'completed':False,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
  if process.returncode!=0 or process.stderr or result.get('remoteAuditInspectionRequired'):
   exclusive(Path('/tmp/yunipals-metadata-current-peer-diagnostic-transport-private-20261026-1.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result.update(completed=False,remoteAuditInspectionRequired=True)
 except subprocess.TimeoutExpired as error:
  exclusive(Path('/tmp/yunipals-metadata-current-peer-diagnostic-timeout-private-20261026-1.json'),
   {'stdout':error.stdout.decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
    'stderr':error.stderr.decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
  result={'completed':False,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'rootDriverTimedOut':True}
 exclusive(RESULT,result);print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result.get('completed')is True else 1)
if __name__=='__main__':main()
