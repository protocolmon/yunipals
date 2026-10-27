#!/usr/bin/env python3
"""Source-only durable launch/recovery for the exact reviewed HELD7 payload.

Default/import are inert. --launch remains closed by the frozen producer's
actual baseline and predecessor proof gates. Launch is never retried. --inspect only
reads protected receipts/processes; it grants no new effect/current authority.
"""
import argparse
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import types

SOURCE=Path('/tmp/yunipals-root-cont5-held-rollback-qualification-20261026-7.py')
# Exact source identity; no future producer or held-success digest is accepted.
SOURCE_SHA='8e0cf675f94f64fa408f751494141714b9e784f512e46470c63238d0ab6c41db'
# Root and independent complete source reviews passed; actual8e0 gates remain.
DURABLE_LAUNCH_REVIEWED=True
LAUNCH_RESULT=Path('/tmp/yunipals-cont5-held7-detached-launch-production-20261026-1.json')
SSH=['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
 '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -']
REMOTE=r'''import base64,datetime,hashlib,json,os,pathlib,re,socket,stat,subprocess,sys,traceback
os.umask(0o077)
ACTION=ACTUAL_ACTION
PAYLOAD=ACTUAL_PAYLOAD
META=ACTUAL_META
SOURCE_SHA='8e0cf675f94f64fa408f751494141714b9e784f512e46470c63238d0ab6c41db'
AREA=pathlib.Path('/var/backups/yunipals-root-cont5-held7-detached-20261026-1')
EFFECT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-7')
FORMAT='root-CONT5-held7-detached-v1'
invoked=False;process=None

def need(ok,code):
 if not ok:raise RuntimeError(code)
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def protected(path,digest=None,allow_empty=False):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  s=item.lstat();need(s.st_uid==s.st_gid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_detached_receipt_path_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and (allow_empty or len(raw)>0)and len(raw)==before.st_size<=16000000 and
  all(getattr(before,k)==getattr(after,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_actual_detached_receipt_bytes_required')
 return raw

def write(name,value):
 need(re.fullmatch(r'[a-z-]+\.(json|py|private)',name)is not None,'fixed_detached_private_file_required')
 raw=value if type(value)is bytes else encoded(value)
 fd=os.open(AREA/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AREA);return sha(raw)
def identity(row):return{k:getattr(row,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink']}
def boot():return pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def witness(pid,argv,expected_boot):
 need(type(pid)is int and pid>0 and boot()==expected_boot,'actual_detached_worker_boot_and_PID_required')
 root=pathlib.Path('/proc')/str(pid);before=(root/'stat').read_bytes();tail=before.decode().rsplit(')',1)[1].split()
 ticks=int(tail[19]);need(ticks>0,'actual_detached_worker_process_epoch_required')
 command=(root/'cmdline').read_bytes();need(command==b'\0'.join(os.fsencode(v)for v in argv)+b'\0','exact_original_python_stdin_argv_required')
 descriptors={}
 for number,name in[(0,'payload.py'),(1,'worker-stdout.private'),(2,'worker-stderr.private')]:
  path=AREA/name;protected(path,allow_empty=number!=0)
  actual=os.stat(root/'fd'/str(number));expected=path.lstat()
  need(identity(actual)==identity(expected),'same_owned_payload_and_regular_output_FDs_required')
  descriptors[str(number)]={'file':str(path),'identity':identity(actual)}
 after=(root/'stat').read_bytes().decode().rsplit(')',1)[1].split()
 need(int(after[19])==ticks,'detached_worker_epoch_changed_during_witness')
 return{'pid':pid,'startTicks':ticks,'bootId':expected_boot,'state':tail[0],
  'commandSha256':sha(command),'argv':argv,'executable':os.readlink(root/'exe'),
  'cwd':os.readlink(root/'cwd'),'descriptors':descriptors,'actualKernelEpochQualified':True}

def checked_intent():
 raw=protected(AREA/'intent.json');intent=json.loads(raw)
 need(intent['format']==FORMAT+'-intent'and intent['sourceSha256']==SOURCE_SHA and intent['effectAudit']==str(EFFECT)and
  intent['automaticRetryAllowed']is False and intent['oneLaunchAttemptOnly']is True and intent['SQLTransportChanged']is False,
  'actual_owned_single_launch_intent_required')
 protected(AREA/'payload.py',intent['payloadSha256'])
 return intent,sha(raw)

def launch():
 global invoked,process
 need(type(META)is dict and META['sourceSha256']==SOURCE_SHA and META['effectAudit']==str(EFFECT),
  'exact_reviewed_effect_source_and_audit_required')
 payload=base64.b64decode(PAYLOAD,validate=True)
 need(0<len(payload)<=4000000 and sha(payload)==META['payloadSha256'],'exact_original_rendered_REMOTE_bytes_required')
 need(not os.path.lexists(AREA)and not os.path.lexists(EFFECT),'fresh_exclusive_launch_and_original_effect_audit_required')
 parent=AREA.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and not parent.st_mode&0o022,'protected_existing_launch_parent_required')
 AREA.mkdir(mode=0o700);sync(AREA.parent)
 payload_sha=write('payload.py',payload);epoch=boot();argv=[sys.executable,'-I','-B','-']
 intent={**META,'format':FORMAT+'-intent','payloadSha256':payload_sha,'bootId':epoch,'argv':argv,
  'oneLaunchAttemptOnly':True,'automaticRetryAllowed':False,'SQLTransportChanged':False,
  'originalRemoteAlarmSeconds':880,'originalTTLSeconds':90,'originalReserveSeconds':5}
 intent_sha=write('intent.json',intent)
 # Regular files keep terminal stdout/stderr available after SSH disappears.
 # This launcher Popen never enters or replaces the payload's SQL transport.
 output=os.open(AREA/'worker-stdout.private',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 error=os.open(AREA/'worker-stderr.private',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 input_fd=os.open(AREA/'payload.py',os.O_RDONLY|os.O_NOFOLLOW)
 try:
  need(sha(protected(AREA/'payload.py'))==payload_sha,'same_exact_payload_before_one_launch_required')
  invoked=True
  process=subprocess.Popen(argv,stdin=input_fd,stdout=output,stderr=error,start_new_session=True,close_fds=True)
 finally:
  os.close(input_fd);os.close(output);os.close(error)
 worker=None;failure=None
 try:worker=witness(process.pid,argv,epoch)
 except Exception as caught:failure={'class':type(caught).__name__,'kernelEpochQualified':False}
 receipt={'format':FORMAT+'-launch','sourceSha256':SOURCE_SHA,'intentSha256':intent_sha,'payloadSha256':payload_sha,
  'popenReturned':True,'pid':process.pid,'worker':worker,'workerWitnessFailure':failure,'automaticRetryAllowed':False,
  'operationCompleted':None,'operationOutcomeInferred':False,'SQLTransportChanged':False}
 receipt_sha=write('launch.json',receipt)
 return{'completed':True,'action':'launch','launchSha256':receipt_sha,'intentSha256':intent_sha,'payloadSha256':payload_sha,
  'pid':process.pid,'workerEpochQualified':worker is not None,'operationCompleted':None,'operationOutcomeInferred':False,
  'launchGapRequiresInspection':worker is None,'automaticRetryAllowed':False}

def inspect():
 intent,intent_sha=checked_intent();receipt=None;current=None;worker_error=None
 if os.path.lexists(AREA/'launch.json'):
  receipt=json.loads(protected(AREA/'launch.json'))
  need(receipt['format']==FORMAT+'-launch'and receipt['sourceSha256']==SOURCE_SHA and receipt['intentSha256']==intent_sha and
   receipt['payloadSha256']==intent['payloadSha256']and receipt['automaticRetryAllowed']is False and
   receipt['operationOutcomeInferred']is False,'same_actual_detached_launch_receipt_required')
  if receipt['worker']is not None:
   saved=receipt['worker']
   try:
    current=witness(saved['pid'],intent['argv'],intent['bootId'])
    need(current['startTicks']==saved['startTicks'],'only_actual_same_owned_detached_worker_epoch_allowed')
   except Exception as caught:current=None;worker_error=type(caught).__name__
 effect=None;result_path=EFFECT/'result.json'
 if os.path.lexists(result_path):
  raw=protected(result_path);value=json.loads(raw)
  need(value['format']=='root-CONT5-held-rollback-qualification-v5'and type(value['completed'])is bool and
   value['callerSha256']==intent['expectedEffect']['callerSha256']and value['readerManifestSha256']==intent['expectedEffect']['readerManifestSha256']and
   value['metadataRefsSha256']==intent['expectedEffect']['metadataRefsSha256'],
   'actual_original_effect_result_only_no_completion_inference_required')
  if value['completed']:
   need(value['baselineRootResultSha256']==intent['expectedEffect']['baselineRootResultSha256']and
    value['baselineReceiptSha256']==intent['expectedEffect']['baselineReceiptSha256']and value['transactionStatus']=='aborted'and
    all(value[key]is True for key in ['qualificationOnly','completeHeldCallback','childGone','backendGone','catalogRestored','transactionalCatalogMutationsRolledBack'])and
    all(value[key]is False for key in ['realCOMMITDispatched','productionCOMMITQualified','productionPreparedACKCreated','LOGINDispatched','sourcePolicyChanged'])and
    value['serviceActionsDispatched']==0,
    'actual_completed_original_held7_ancestry_and_rollback_only_receipt_required')
  effect={**value,'resultSha256':sha(raw)}
 return{'completed':True,'action':'inspect','intentSha256':intent_sha,'payloadSha256':intent['payloadSha256'],
  'launchReceiptPresent':receipt is not None,'sameWorkerEpochAlive':current is not None,
  'workerObservation':current,'workerObservationErrorClass':worker_error,
  'operationResult':effect,'operationCompleted':effect['completed']if effect is not None else None,
  'actualProtectedResultOnly':True,'currentOrSQLOutcomeRequalified':False,
  'unknownOutcomeRequiresInspection':effect is None,'automaticRetryAllowed':False}

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_detached_launcher_host_required')
try:
 need(ACTION in{'launch','inspect'},'one_explicit_detached_action_required')
 result=launch()if ACTION=='launch'else inspect()
except BaseException as caught:
 # Never repeat Popen, kill/restart the worker, or infer that SQL did not run.
 result={'completed':False,'action':ACTION,'errorClass':type(caught).__name__,
  'failureCode':str(caught)if type(caught)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(caught))else'private-diagnostics-required',
  'popenInvoked':invoked,'pid':process.pid if process is not None else None,
  'operationCompleted':None,'unknownOutcomeRequiresInspection':True,'automaticRetryAllowed':False}
result.update({'format':FORMAT,'sourceSha256':SOURCE_SHA,'observedAt':now(),
 'newCurrentAuthority':False,'newTimingAuthority':False,'serviceActionsDispatchedByLauncher':0,'SQLTransportChanged':False})
print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result['completed']else 1)
'''

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def exclusive(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(encoded(value));stream.flush();os.fsync(stream.fileno())
 directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)

def source_module():
 row=SOURCE.lstat();raw=SOURCE.read_bytes();after=SOURCE.lstat()
 if not stat.S_ISREG(row.st_mode)or row.st_uid!=row.st_gid or row.st_uid!=0 or row.st_nlink!=1 or row.st_mode&0o022 or \
  len(raw)!=row.st_size or len(raw)>4000000 or hashlib.sha256(raw).hexdigest()!=SOURCE_SHA or \
  any(getattr(row,k)!=getattr(after,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
  raise RuntimeError('exact_reviewed_frozen_held7_source_required')
 value=types.ModuleType('frozen_actual_held7');value.__file__=str(SOURCE)
 exec(compile(raw,str(SOURCE),'exec'),value.__dict__)
 return value,raw

def render_payload(driver,raw,profile=False):
 tree=ast.parse(raw);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main')
 starts=[i+1 for i,n in enumerate(main.body)if isinstance(n,ast.If)and ast.unparse(n.test)=='not args.run']
 ends=[i for i,n in enumerate(main.body)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='remote'for t in n.targets)]
 if len(starts)!=1 or len(ends)!=1:raise RuntimeError('one_actual_frozen_input_gate_and_render_block_required')
 body=main.body[starts[0]:ends[0]+1]
 if any(isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr in{'run','Popen','execute_cache'}for v in body for n in ast.walk(v)):
  raise RuntimeError('render_block_must_have_no_network_or_effect_dispatch')
 result=ast.parse("return {'remote':remote,'baseline':baseline,'refs':refs}").body[0]
 fn=ast.FunctionDef(name='actual_frozen_render',args=ast.arguments(posonlyargs=[],args=[],kwonlyargs=[],kw_defaults=[],defaults=[]),body=[*body,result],decorator_list=[])
 scope={**driver.__dict__,'args':types.SimpleNamespace(profile=profile)}
 exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(SOURCE),'exec'),scope)
 value=scope['actual_frozen_render']();payload=value['remote'].encode()
 return payload,{'sourceSha256':SOURCE_SHA,'payloadSha256':hashlib.sha256(payload).hexdigest(),
  'effectAudit':'/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-7',
  'expectedEffect':{'callerSha256':'a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a',
   'readerManifestSha256':'455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405',
   'metadataRefsSha256':hashlib.sha256(driver.encoded(value['refs'])).hexdigest(),
   'baselineRootResultSha256':value['baseline']['resultSha256'],'baselineReceiptSha256':value['baseline']['baselineReceiptSha256']}}

def main():
 parser=argparse.ArgumentParser(description=__doc__);actions=parser.add_mutually_exclusive_group()
 actions.add_argument('--launch',action='store_true');actions.add_argument('--inspect',action='store_true')
 parser.add_argument('--capture-id');parser.add_argument('--recover-result',action='store_true')
 args=parser.parse_args()
 if not args.launch and not args.inspect:print(json.dumps({'staticOnly':True,'SSHExecuted':False,'effectDispatched':False}));return
 if not DURABLE_LAUNCH_REVIEWED:raise RuntimeError('durable_launch_and_recovery_contract_not_yet_reviewed')
 if args.recover_result and not args.inspect:raise RuntimeError('fixed_mode_specific_detached_options_required')
 os.umask(0o077);driver,raw=source_module()
 if os.geteuid()!=0:raise RuntimeError('root_detached_controller_required')
 if args.launch:
  target=LAUNCH_RESULT
  if os.path.lexists(target):raise RuntimeError('fresh_detached_launch_result_required_never_retry')
  payload,meta=render_payload(driver,raw,False);action='launch'
 else:
  if type(args.capture_id)is not str or re.fullmatch('[a-z][a-z0-9-]{0,47}',args.capture_id)is None:raise RuntimeError('new_bounded_inspection_capture_id_required')
  target=Path('/tmp/yunipals-cont5-held7-detached-inspection-'+args.capture_id+'.json')
  if os.path.lexists(target):raise RuntimeError('fresh_readonly_inspection_result_required')
  payload=b'';meta=None;action='inspect'
 remote=REMOTE.replace('ACTUAL_ACTION',repr(action)).replace('ACTUAL_PAYLOAD',repr(base64.b64encode(payload).decode())).replace('ACTUAL_META',repr(meta))
 try:
  process=subprocess.run(SSH,input=remote,capture_output=True,text=True,timeout=40)
  result=json.loads(process.stdout)
  if type(result)is not dict or result.get('format')!='root-CONT5-held7-detached-v1'or type(result.get('completed'))is not bool:
   raise RuntimeError('actual_detached_status_envelope_required')
  if process.returncode!=0 or process.stderr:result.update(completed=False,remoteAuditInspectionRequired=True,automaticRetryAllowed=False)
 except (subprocess.TimeoutExpired,ValueError,RuntimeError)as caught:
  result={'format':'root-CONT5-held7-detached-v1','completed':False,'action':action,
   'transportErrorClass':type(caught).__name__,'unknownOutcomeRequiresInspection':True,'automaticRetryAllowed':False}
 exclusive(target,result)
 if args.recover_result:
  effect=result.get('operationResult')
  if result.get('completed')is not True or type(effect)is not dict or effect.get('completed')is not True:
   raise RuntimeError('actual_protected_successful_held7_result_required_no_inference')
  if os.path.lexists(driver.RESULT):raise RuntimeError('existing_local_held7_result_cannot_be_overwritten')
  exclusive(driver.RESULT,effect)
 print(json.dumps(result,sort_keys=True));raise SystemExit(0 if result.get('completed')is True else 1)

if __name__=='__main__':main()
