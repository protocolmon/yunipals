#!/usr/bin/env python3
"""Explicit root-held rollback qualification, gated by actual CONT5 current/cadence/baseline success.

Import/default are inert. Root must review this source before --run. This
runner has no real COMMIT, LOGIN, refresh or service-action dispatcher.
This source preserves all earlier unexecuted held drivers and owns a fresh
held7 namespace. It accepts only the actual construct-only3 baseline and archive.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

BASELINE_RESULT=Path('/tmp/yunipals-cont5-construct-only-baseline-production-20261026-3.json')
METADATA_REFS=Path('/tmp/yunipals-actual-metadata-epoch-v3-refs-20261025.json')
RESULT=Path('/tmp/yunipals-cont5-held-rollback-qualification-production-20261026-7.json')
RECON_RESULT=Path('/tmp/yunipals-cont5-held6-reconcile-production-20261026-1.json')
# Root and independent source review passed; actual reconciliation remains required.
HELD7_SOURCE_REVIEWED=True
HELD5_RESULT=Path('/tmp/yunipals-cont5-held-rollback-qualification-production-20261026-5.json')
HELD4_RESULT=Path('/tmp/yunipals-cont5-held-rollback-qualification-production-20261026-4.json')
KERNEL_RESULT=Path('/tmp/yunipals-source6-kernel-diagnostic-production-20261026-1.json')
EXPECTED_REFS={
    'mode':'current',
    'resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
    'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
    'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
    'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'
}

REMOTE=r'''import ast,datetime,sys,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,traceback,types,time
os.umask(0o077)
baseline_local=ACTUAL_CONSTRUCT_BASELINE_RESULT
refs=ACTUAL_METADATA_REFS
held4_local=ACTUAL_HELD4_FAILURE
kernel_local=ACTUAL_KERNEL_DIAGNOSTIC
held5_local=ACTUAL_HELD5_FAILURE
recon_local=ACTUAL_HELD6_RECONCILIATION
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-7')
BASELINE_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-construct-only-baseline-20261026-3')
BASELINE_CAPTURE='cont5-baseline-20261026-3'
CAPTURE='cont5-held-rollback-20261026-7'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
CALLER=OPS/'ypal-ordinary-publication-continue-v5.py'
CALLER_SHA='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v5.manifest.json'
MANIFEST_SHA='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'
CACHE_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v5-20261026')
CACHE_INPUT_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
OWNER=OPS/'ypal-native-metadata-approval-epoch-v3.py'
OWNER_MANIFEST=OPS/'ypal-native-metadata-approval-epoch-v3.manifest.json'
kernel_reference=None;kernel_diagnostic_summary={}
started=time.monotonic_ns();stage='initial';qualifier_started=False;qualifier_returned=False;qualification_ref=None;proof_hashes={};session=None;capture_summary={};witness=None;witness_module=None;phase_events=[];command_trace=None;original_subprocess_run=subprocess.run

def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def write(name,value):
 raw=value if isinstance(value,bytes)else encoded(value)
 fd=os.open(AUDIT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(AUDIT);return sha(raw)
def protected(path,digest=None,maximum=16000000):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_actual_root_held_input_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_exact_root_held_input_bytes_required')
 return raw
def document(path,digest=None):return json.loads(protected(path,digest))
def load(path,digest):
 raw=protected(path,digest);value=types.ModuleType('root_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value
def deadline(_signum,_frame):raise RuntimeError('root_held_qualification_deadline_expired_inspect_no_retry')

def phase(label,fn,*args,**kwargs):
 began=time.monotonic_ns();returned=False
 try:
  value=fn(*args,**kwargs);returned=True;return value
 finally:phase_events.append({'label':label,'elapsedNanoseconds':time.monotonic_ns()-began,'returned':returned,'repeated':False})
def save_current_failure(name,raw):return write('current-'+name,raw)
def save_observations():
 subprocess.run=original_subprocess_run
 summary={'liveTraceInstalled':False,'liveProfileInstalled':False,'SQLParentWrapped':False,'SQLParentPopenOrPipeWrapped':False,'passiveOriginalRunObserverRetained':True,
  'SQLTransportObservationInstalled':False,'transportCountInferredFromMissingObserver':False}
 if command_trace is not None:
  value={'diagnosticSourceSha256':'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
   'calls':command_trace.calls,'failures':command_trace.failures,'subprocessRunRestored':subprocess.run is original_subprocess_run,
   'argumentsEnvironmentTimeoutAndOriginalResultsChanged':False,'automaticRetryAllowed':False}
  digest=write('current-subprocess-diagnostic.private.json',value)
  summary.update({'currentSubprocessDiagnosticSha256':digest,'currentSubprocessCommandCount':len(command_trace.calls),
   'currentSubprocessFailureCount':len(command_trace.failures),'currentSubprocessRunRestored':subprocess.run is original_subprocess_run})
 summary['rootPhaseObservationSha256']=write('root-phase-observations.private.json',{
  'format':'root-CONT5-coarse-phase-observation-v1','events':phase_events,'liveProfileInstalled':False,
  'timingQualificationClaimed':False,'originalClocksChanged':False})
 return summary

def code_shape(code):
 return(tuple(getattr(code,key)for key in['co_argcount','co_posonlyargcount','co_kwonlyargcount','co_nlocals','co_stacksize','co_flags',
  'co_code','co_names','co_varnames','co_freevars','co_cellvars','co_filename','co_name','co_qualname','co_firstlineno','co_linetable','co_exceptiontable']),
  tuple(code_shape(value)if isinstance(value,types.CodeType)else value for value in code.co_consts))
def same_local_remote(local,remote,digest,allow_failure_annotation=False):
 need(type(local)is dict and type(remote)is dict and local.get('resultSha256')==digest and sha(encoded(remote))==digest,'actual_deliberate_observation_canonical_digest_required')
 expected={**remote,'resultSha256':digest}
 if allow_failure_annotation and 'remoteAuditInspectionRequired'not in remote and 'remoteAuditInspectionRequired'in local:
  need(local['remoteAuditInspectionRequired']is True,'only_exact_true_failure_transport_annotation_permitted')
  expected['remoteAuditInspectionRequired']=True
 need(encoded(local)==encoded(expected),'all_shared_actual_predecessor_fields_and_no_unknown_annotations_required')
def deliberate_ancestry():
 old_audit=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-4')
 old_sha='29ecd865d83ccd707dc41957c2e7b513bc66bcc890214b6c66b27125a53a8d90'
 old=document(old_audit/'result.json',old_sha);same_local_remote(held4_local,old,old_sha,True)
 need(old['format']=='root-CONT5-held-rollback-qualification-v2'and old['completed']is False and old['stage']=='new-cache-context'and
  old['failureCode']=='all_required_backends_need_unique_positive_stable_kernel_attribution'and old['errorClass']=='RuntimeError'and
  old['qualifierInvoked']is old['qualifierReturned']is old['outcomeReconciliationRequired']is False and old['heldQualification']is None and
  old['callerSha256']==CALLER_SHA and old['readerManifestSha256']==MANIFEST_SHA and old['metadataRefsSha256']==sha(encoded(refs))and
  old['proofHashes']['baseline-root-result']=='2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195'and
  old['realCOMMITDispatched']is old['LOGINDispatched']is old['automaticRetryAllowed']is False and old['serviceActionsDispatched']==0,
  'actual_pre_SQL_held4_hard_source_refusal_required_not_success')
 old_capture=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-4')
 need(not os.path.lexists(old_capture),'actual_held4_qualifier_capture_must_remain_absent')
 for name in ['qualification-invocation-intent.private.json','qualifier-return.private.json','authenticated-held-qualification.private.json']:
  need(not os.path.lexists(old_audit/name),'actual_held4_never_invoked_qualifier_journals_required')
 diag_audit=pathlib.Path('/var/backups/yunipals-root-source6-kernel-diagnostic-20261026-1')
 diag_sha='b90ea254cd2965ee9b45a82a14d2dc84cb7687c5b7ae53af34ae8b44ef3f5c66'
 diag=document(diag_audit/'result.json',diag_sha);same_local_remote(kernel_local,diag,diag_sha)
 need(diag['format']=='root-source6-kernel-diagnostic-v1'and diag['completed']is True and
  diag['genuineCurrentInvoked']is diag['genuineCurrentReturned']is diag['traceRestored']is True and
  diag['kernelCallCount']==1 and diag['actorMapCaptureCount']==2 and diag['kernelRefusalCaptureCount']==diag['diagnosticCaptureErrorCount']==0 and
  diag['newRetryPolicyQualified']is diag['originalHeldFailureRelabelled']is diag['sourcePolicyChanged']is diag['wholeCallerOrMetadataQualified']is False and
  diag['databaseWrites']==diag['serviceActions']==diag['providerCalls']==0 and
  diag['privateHashes']['source-frame-before-private.json']==diag['privateHashes']['source-frame-after-private.json'],
  'actual_one_positive_source6_diagnostic_no_original_cause_or_retry_authority_required')
 for name,digest in diag['privateHashes'].items():
  need(pathlib.Path(name).name==name and pin(digest),'actual_finite_private_source_diagnostic_hashes_required');protected(diag_audit/name,digest)
 return{'priorHeld4FailureSha256':old_sha,'separateSource6DiagnosticSha256':diag_sha,
  'acceptedBaselineRootResultSha256':'2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195',
  'oldFailurePreserved':True,'failureCauseReproduced':False,'sourcePolicyChanged':False,'newRetryAuthority':False,
  'baselineReplayRequested':False,'deliberateNewObservationOnly':True}
FAILED5_SHA='099a3053d4e8e36dfb6fee888856af16300d3ad89fcbfff29d3ec23db51684fd'
FAILED5_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-5')
FAILED5_CAPTURE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-5')
def held5_failure():
 failed=document(FAILED5_AUDIT/'result.json',FAILED5_SHA);same_local_remote(held5_local,failed,FAILED5_SHA)
 need(failed['format']=='root-CONT5-held-rollback-qualification-v3'and failed['completed']is False and
  failed['stage']=='qualify-held-rollback-only'and failed['qualifierInvoked']is True and failed['qualifierReturned']is False and
  failed['heldQualification']is None and failed['outcomeReconciliationRequired']is True and
  failed['failureCode']=='complete_actual_held_callback_then_refused_COMMIT_ACK_required'and failed['observedSQLTransportCount']==0 and
  failed['sourceKernelTracebackFrameCount']==failed['sourceKernelTracebackCaptureErrorCount']==0 and
  failed['callerSha256']==CALLER_SHA and failed['readerManifestSha256']==MANIFEST_SHA and failed['metadataRefsSha256']==sha(encoded(refs))and
  failed['proofHashes']['baseline-root-result']=='2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195'and
  failed['realCOMMITDispatched']is failed['LOGINDispatched']is failed['automaticRetryAllowed']is False and failed['serviceActionsDispatched']==0,
  'actual_failed_held5_pretransport_result_required_no_success_alias')
 observed=document(FAILED5_AUDIT/'qualification-diagnostic.private.json',failed['qualificationDiagnosticSha256'])
 need(observed['caughtError']['caughtInnerErrorObserved']is True and observed['caughtError']['innerErrorClass']=='RuntimeError'and
  observed['caughtError']['innerErrorMessage']=='dependency_preauthorization_deadline_expired_no_module_evaluation'and
  observed['transports']==[]and observed['wholeParentCodeUnchanged']is observed['parentRestored']is observed['traceRestored']is True and
  observed['SQLBytesChanged']is observed['predicatesChanged']is observed['deadlinesChanged']is observed['clockReset']is observed['effectOrCaptureRetried']is False,
  'actual_inner_120_second_dependency_refusal_before_transport_required')
 return{'failedRootResultSha256':FAILED5_SHA,'qualificationDiagnosticSha256':failed['qualificationDiagnosticSha256'],
  'innerFixedCode':observed['caughtError']['innerErrorMessage'],'priorSQLTransportCount':0,'priorHeldSuccessClaimed':False,
  'originalDeadlineSeconds':120,'exclusiveTraceOverheadCausationProvenByThisGate':False,'automaticRetryAllowed':False}
def sql_processes(cache):
 target=os.fsencode(str(cache.ENTRY));rows=[]
 for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdigit():continue
  try:raw=(path/'cmdline').read_bytes()
  except(FileNotFoundError,ProcessLookupError):continue
  if target in raw.split(b'\0'):rows.append({'pid':int(path.name),'commandSha256':sha(raw)})
 return rows
def old_root_epoch_gone():
 try:raw=pathlib.Path('/proc/1571012/stat').read_text()
 except(FileNotFoundError,ProcessLookupError):return True
 ticks=int(raw[raw.rfind(')')+2:].split()[19]);need(ticks>0,'actual_old_root_process_epoch_required')
 return ticks!=6641096413
def fixed_cache_frame(cache):
 fixed={'before.json':('5ec18716b53535f022b0d3c7df6ab984f956ba071003bab72321849a3b235b85',2722766),
  'rehearsal-intent.json':('dc37acae4fcadc4c8c18f63c501352e740d3f2d9040df945cd4a2cc6e0efa9d7',2722767),
  'rehearse-sql-child.json':('67109cac93768c98cfd13ab2f6d3c2bbea1cb1619ca53aeb98974eb81e594390',2722757),
  'rehearse-sql-opened.json':('2335e662038ceb66ed8c6f16c78980cfddf0e7c965a12c69aeef8503fc92b29d',2722769),
  'rehearsed.json':('26099574afa5d4d4d70f1f1c346100aebef2a9e99c2ea51437edb3eb791c3edb',2722770),
  'authorization.json':('fc5cc6bedd21c4e253857d5b2af440f57ea56853a2e23f984c32c3d0784acf5b',2722771)}
 need({p.name for p in cache.BASE.iterdir()}==set(fixed),'exact_accepted_six_baseline_cache_files_required')
 value={name:file_frame(cache.BASE/name,digest)for name,(digest,inode)in fixed.items()}
 need(all(value[name]['inode']==inode for name,(digest,inode)in fixed.items()),'actual_accepted_baseline_file_inodes_required')
 return value
def fixed_failed_capture():
 fixed={'intent.json':('61a33d72e12e47fab4b97a9e3dac2d89f779c1fd46f4b4e64268d2c9ade1f2fc',2722809),
  'failure.json':('e751856cbb8aecb48c98f20bf1c903ab19faa50d4bc432e295f8563f781e34de',2722810)}
 need({p.name for p in FAILED5_CAPTURE.iterdir()}==set(fixed),'exact_failed_held5_intent_failure_only_required')
 value={name:file_frame(FAILED5_CAPTURE/name,digest)for name,(digest,inode)in fixed.items()}
 need(all(value[name]['inode']==inode for name,(digest,inode)in fixed.items()),'actual_failed_capture_inodes_required')
 return value
def plain_inspection(cache,host):
 need(sys.gettrace()is None and sys.getprofile()is None,'genuine_untraced_unprofiled_readonly_dependency_preparation_required')
 return phase('untraced-unprofiled-new-cache-inspect',cache.sql_child,host,'inspect')


def reconcile_and_prepare(cache,host,authority,baseline):
 # Release this lock before the unchanged caller later acquires its own lock.
 with host.read_host.primitives['sdk'].lock():
  need(sys.gettrace()is None,'genuine_untraced_readonly_dependency_preparation_required')
  files=fixed_cache_frame(cache);failed_files=fixed_failed_capture()
  need(old_root_epoch_gone()and not sql_processes(cache)and host.query(authority.OWNER_SESSIONS_SQL)==[],
   'actual_held5_root_epoch_and_all_SQLentry_APP_backends_must_be_gone')
  before=document(cache.BASE/'before.json',baseline['beforeSha256'])
  prior,catalog=phase('held5-whole-catalog-reconciliation',authority.original_catalog,cache.prior_cache,host)
  need(catalog['catalogSha256']==before['catalog']['catalogSha256']and
   host.read.acl_catalog(catalog['postProof']['catalog'])==host.read.acl_catalog(before['catalog']['postProof']['catalog'])and
   catalog['postProof']['allColumnAcl']==before['catalog']['postProof']['allColumnAcl']and
   prior['bindingSha256']==baseline['priorAbortedSha256']and prior['binding']['transactionId']=='16540148'and prior['binding']['transactionStatus']=='aborted',
   'actual_whole_catalog_all_columns_and_original_aborted_authority_match_accepted_baseline_required')
  need(fixed_cache_frame(cache)==files and fixed_failed_capture()==failed_files and
   host.query(authority.OWNER_SESSIONS_SQL)==[]and not sql_processes(cache),'actual_failed_and_baseline_files_unchanged_and_no_SQL_after_reconciliation_required')
  proof_hashes['held5-catalog-reconciliation']=write('held5-catalog-reconciliation.private.json',{
   'failedRootResultSha256':FAILED5_SHA,'baselineRootResultSha256':baseline_local['resultSha256'],'priorAborted':prior,'catalog':catalog,
   'wholeCatalogRestored':True,'allColumnACLRestored':True,'oldRootEpochGone':True,'SQLentryProcessCount':0,'ownerAPPBackendCount':0,
   'unchangedBaselineFiles':files,'unchangedFailedCaptureFiles':failed_files})
  raw_parent=cache._sql_child;qualified_parent=cache.sql_child;start=time.monotonic_ns()
  inspected=plain_inspection(cache,host)
  elapsed=time.monotonic_ns()-start
  need(sys.gettrace()is None and cache._sql_child is raw_parent and cache.sql_child is qualified_parent and
   inspected['catalogSha256']==catalog['catalogSha256']and inspected['postProof']['allColumnAcl']==catalog['postProof']['allColumnAcl']and
   host.read.acl_catalog(inspected['postProof']['catalog'])==host.read.acl_catalog(catalog['postProof']['catalog'])and
   not hasattr(cache,'_continuation_qualification')and not hasattr(cache,'_continuation_approval_gate'),
   'genuine_same_context_readonly_inspect_full_catalog_without_trace_or_approval_clock_required')
  need(fixed_cache_frame(cache)==files and fixed_failed_capture()==failed_files and
   old_root_epoch_gone()and host.query(authority.OWNER_SESSIONS_SQL)==[]and not sql_processes(cache),
   'all_baseline_failed_inodes_unchanged_and_SQL_entry_backends_gone_after_readonly_inspect_required')
  proof_hashes['untraced-dependency-inspection']=write('untraced-dependency-inspection.private.json',{
   'inspection':inspected,'elapsedNanoseconds':elapsed,'mode':'inspect','liveTraceInstalled':False,'profileInstalled':False,'sameCacheObjectRetained':True,
   'sourceFunctionsOrSelectedClosureMutated':False,'dependencyDeadlineSecondsUnchanged':120,'approvalClockStartedOrReset':False,
   'proofCachePopulatedOnlyByGenuineDependencyCurrent':True,'newTransactionTimingAuthority':False,'newSourceAuthority':False,
   'allColumnACLQualified':True,'wholeCatalogQualified':True,'baselineAndFailedFilesUnchanged':True,'ownerAPPBackendCount':0,'SQLentryProcessCount':0})

def kernel_traceback_evidence(error):
 # Only inspect traceback objects AFTER a genuine exception. No tracer, query,
 # actor capture, process probe or source-current call is made here.
 frames=[];capture_errors=[];sources=[('outer',error)]
 if witness is not None and witness.inner_error is not None and witness.inner_error is not error:
  sources.append(('genuine-qualifier-inner',witness.inner_error))
 if kernel_reference is None:return{'frames':[],'captureErrors':[],'sourceReferenceAvailable':False,'liveTraceInstalled':False,'newObservations':0}
 for label,caught in sources:
  tb=caught.__traceback__
  while tb is not None:
   frame=tb.tb_frame;code=frame.f_code
   if code.co_name=='kernel_backends'and code.co_filename==str(OPS/'ypal-ordinary-source-authority-v6.py'):
    try:
     need(code_shape(code)==kernel_reference,'only_exact_authenticated_Source6_derived_kernel_traceback_supported')
     fields=['role','actors','uid_gid','require_all','sql','rows','backend_fds','peers','tcp','result','ids','name','actor','own','final_rows']
     record={'source':label,'errorClass':type(caught).__name__,'errorMessage':str(caught),'locals':{key:frame.f_locals[key]for key in fields if key in frame.f_locals},
      'onlyLastActorFDLoopFrameAvailable':True,'observedFromActualExceptionTraceback':True}
     raw=encoded(record);need(len(raw)<=4000000 and len(frames)<6,'bounded_private_traceback_kernel_frames_required');frames.append(json.loads(raw))
    except (RuntimeError,TypeError,ValueError,OverflowError,RecursionError)as diagnostic_error:
     if len(capture_errors)<8:capture_errors.append({'class':type(diagnostic_error).__name__,'message':str(diagnostic_error)[:160]})
   tb=tb.tb_next
 return{'frames':frames,'captureErrors':capture_errors,'sourceReferenceAvailable':True,'liveTraceInstalled':False,
  'newObservations':0,'sourcePolicyChanged':False,'originalExceptionPreserved':True,'originalHeldClocksReset':False}

def file_frame(path,digest):
 raw=protected(path,digest);row=path.lstat()
 need(row.st_dev==2049 and stat.S_IMODE(row.st_mode)==0o600,'actual_private_archive_or_capture_device_mode_required')
 return{'sha256':sha(raw),'device':row.st_dev,'inode':row.st_ino,'mode':row.st_mode,'uid':row.st_uid,'gid':row.st_gid,
  'links':row.st_nlink,'bytes':row.st_size,'mtimeNs':row.st_mtime_ns,'ctimeNs':row.st_ctime_ns}
def archive_frame(path,expected):
 row=path.lstat();need({k:getattr(row,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode']}==expected['directory']and
  stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700 and
  {p.name for p in path.iterdir()}==set(expected['files'])=={'before.json','rehearsal-intent.json'},'actual_unchanged_archived_directory_and_two_files_required')
 fixed={'before.json':('a3a0c2a48aad184d3093e0b3d0933d3b798e11d3780cc7acc1d3674a3652ef54',2722747,772495),
  'rehearsal-intent.json':('dc37acae4fcadc4c8c18f63c501352e740d3f2d9040df945cd4a2cc6e0efa9d7',2722748,319)}
 for name,(digest,inode,size)in fixed.items():
  current=file_frame(path/name,digest)
  need(current==expected['files'][name]and current['inode']==inode and current['bytes']==size,'actual_archived_partial_bytes_and_inodes_unchanged_required')
def validate_history(value,root,binding):
 need(value['format']=='root-CONT5-metadata-capture-history-v1'and value['outcome']=='success'and value['exceptionCapture']is None and
  value['readOnlyMemorySnapshot']is True and value['currentObservationsPerformed']==0 and
  all(value[k]is False for k in['stableBindingMutated','timingKeyMutated','approvalClockReset'])and
  len(value['epochs'])==2 and {row['label']for row in value['epochs']}=={'sessionEpoch','cacheEpoch'},'actual_both_Epoch_success_history_required')
 for row in value['epochs']:
  need(row['stableBindingSha256']==binding and row['history']and row['lastAttempts']==row['history'][-1]['attempts'],'actual_full_epoch_capture_binding_required')
  for capture in row['history']:
   need(capture['format']=='yunipals-ypal-ordinary-metadata-current-observation-v1-capture'and capture['inverse']is False and
    capture['effectsRetried']is capture['approvalLifetimeReset']is False and 1<=len(capture['attempts'])<=3 and
    capture['attempts'][-1]['completed']is True and capture['attempts'][-1]['discarded']is False and
    all(a['effectsRetried']is a['partialObservationReused']is False for a in capture['attempts']),
    'actual_f536_capture_domain_no_old_helper3_success_alias_required')
 attempts=[a for row in value['epochs']for capture in row['history']for a in capture['attempts']]
 need(root['metadataEpochInstanceCount']==2 and root['exceptionMetadataCaptureCount']==0 and
  root['metadataCaptureCount']==sum(len(row['history'])for row in value['epochs'])and root['metadataCaptureAttemptCount']==len(attempts)and
  root['metadataDiscardedCaptureCount']==sum(a['discarded']is True for a in attempts),'actual_capture_counts_required')

def capture_histories(outcome,error=None):
 # Read memory only. Do not run another current/source observation or mutate a
 # stable binding/timing key while collecting diagnostics.
 epochs=[];state=vars(session)if session is not None else{}
 for label,epoch in [('sessionEpoch',state.get('metadata_epoch')),
  ('cacheEpoch',vars(state['cache']).get('metadata_epoch')if state.get('cache')is not None else None)]:
  if epoch is not None:
   row=vars(epoch)
   epochs.append({'label':label,'history':row.get('current_capture_history',()),
    'lastAttempts':row.get('current_capture_attempts',()),'stableBindingSha256':sha(encoded(epoch.binding()))})
 exception={'history':getattr(error,'metadata_current_capture_history',()),
  'lastAttempts':getattr(error,'metadata_current_capture_attempts',())}if error is not None else None
 payload={'format':'root-CONT5-metadata-capture-history-v1','outcome':outcome,'epochs':epochs,
  'exceptionCapture':exception,'readOnlyMemorySnapshot':True,'currentObservationsPerformed':0,
  'stableBindingMutated':False,'timingKeyMutated':False,'approvalClockReset':False}
 digest=write('metadata-capture-histories-'+outcome+'.private.json',payload)
 attempts=[attempt for epoch in epochs for capture in epoch['history']for attempt in capture['attempts']]
 return{'metadataCaptureHistorySha256':digest,'metadataEpochInstanceCount':len(epochs),
  'metadataCaptureCount':sum(len(epoch['history'])for epoch in epochs),'metadataCaptureAttemptCount':len(attempts),
  'metadataDiscardedCaptureCount':sum(attempt['discarded']is True for attempt in attempts),
  'exceptionMetadataCaptureCount':len(exception['history'])if exception is not None else 0}

def authenticate_held6_reconciliation():
 root=pathlib.Path('/var/backups/yunipals-root-cont5-held6-reconcile-20261026-1')
 digest=recon_local.get('resultSha256');need(digest=='23cb35fa68f1c728eb0d1c7e0e90238755832d434875002c1b849664f901c75d',
  'actual_successful_HELD6_reconciliation_SHA_required')
 value=document(root/'result.json',digest);same_local_remote(recon_local,value,digest)
 need(value['format']=='root-CONT5-held6-reconciliation-v1'and value['completed']is True and value['stage']=='complete'and
  value['failedHeld6RootResultSha256']=='c218a2c8a14e0bb8884e4f23aa3a513e890399a9a435f217e4ca28cc633ed372'and
  value['acceptedBaselineRootResultSha256']==baseline_local['resultSha256']=='2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195'and
  value['transactionId']=='17009625'and value['transactionStatus']=='aborted'and value['baselineFileCount']==6 and value['failedCaptureFileCount']==5 and
  all(value[k]is True for k in['childGone','backendGone','rootEpochGone','wholeCatalogQualified','allColumnACLQualified','readerGraphQualified',
   'fullCurrentQualified','fullSourcePostflightPassed','allOriginalFileBytesAndInodesUnchanged'])and
  value['callerSha256']==CALLER_SHA and value['readerManifestSha256']==MANIFEST_SHA and value['metadataRefsSha256']==sha(encoded(refs))and
  value['metadataCurrentProofProducerSha256']=='f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2'and
  all(value[k]is False for k in['automaticRetryAllowed','realCOMMITDispatched','qualifierDispatched','baselineDispatched','LOGINDispatched',
   'providerRefreshRequested','databaseMutationsDispatched','newHeldSuccessAuthority','newCommitAuthority'])and
  value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
  'actual_successful_full_HELD6_reconciliation_not_failure_or_new_held_authority_required')
 fixed={'actual-failed-held6':'actual-failed-held6.private.json','baseline-root-result':'authenticated-baseline-root-result.private.json',
  'authenticated-baseline-metadata-histories':'authenticated-baseline-metadata-histories.private.json',
  'authenticated-baseline-proof-hashes':'authenticated-baseline-proof-hashes.private.json','authenticated-baseline-archive':'authenticated-baseline-archive.private.json',
  'new-source-preflight':'new-source-preflight.private.json','new-full-current-prerequisites':'new-full-current-prerequisites.private.json',
  'whole-catalog-reconciliation':'whole-catalog-reconciliation.private.json','full-source-postflight':'full-source-postflight.private.json'}
 need(set(value['proofHashes'])==set(fixed)and all(pin(v)for v in value['proofHashes'].values())and
  value['catalogProofSha256']==value['proofHashes']['whole-catalog-reconciliation'],'all_nine_actual_HELD6_reconciliation_private_proofs_required')
 proofs={key:document(root/name,value['proofHashes'][key])for key,name in fixed.items()}
 base=proofs['baseline-root-result'];need(base==document(BASELINE_AUDIT/'result.json',baseline_local['resultSha256'])and
  encoded(baseline_local)==encoded({**base,'resultSha256':sha(encoded(base))})and
  proofs['authenticated-baseline-proof-hashes']==base['proofHashes'],
  'same_actual_accepted_baseline3_inside_HELD6_reconciliation_required')
 need(proofs['authenticated-baseline-metadata-histories']==document(BASELINE_AUDIT/'metadata-capture-histories-success.private.json',base['metadataCaptureHistorySha256'])and
  proofs['authenticated-baseline-archive']==document(BASELINE_AUDIT/'archive-result.private.json',base['archiveResultSha256']),
  'same_actual_baseline_history_and_archive_proof_nodes_required')
 failed=proofs['actual-failed-held6'];oldroot=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-6')
 need(failed==document(oldroot/'result.json',value['failedHeld6RootResultSha256'])and failed['completed']is False and
  failed['format']=='root-CONT5-held-rollback-qualification-v4'and failed['observedSQLTransportCount']==1 and
  failed['qualifierInvoked']is True and failed['qualifierReturned']is False and failed['transactionOutcomeQualified']is False,
  'actual_failed_HELD6_with_one_original_transport_must_remain_failure_ancestry')
 oldfixed={'actual-prior-aborted':'actual-prior-aborted.private.json','authenticated-baseline-archive':'authenticated-baseline-archive.private.json',
  'authenticated-baseline-metadata-histories':'authenticated-baseline-metadata-histories.private.json',
  'authenticated-baseline-proof-hashes':'authenticated-baseline-proof-hashes.private.json',
  'authenticated-deliberate-observation-ancestry':'authenticated-deliberate-observation-ancestry.private.json',
  'authenticated-held5-failure':'authenticated-held5-failure.private.json','baseline-root-result':'authenticated-baseline-root-result.private.json',
  'held5-catalog-reconciliation':'held5-catalog-reconciliation.private.json','new-full-current-prerequisites':'new-full-current-prerequisites.private.json',
  'new-source-preflight':'new-source-preflight.private.json','untraced-dependency-inspection':'untraced-dependency-inspection.private.json'}
 need(set(failed['proofHashes'])==set(oldfixed),'all_original_failed_HELD6_ancestry_proof_nodes_required')
 for key,name in oldfixed.items():protected(oldroot/name,failed['proofHashes'][key])
 diagnostics={'qualification-diagnostic.private.json':'qualificationDiagnosticSha256','failure.private.txt':'privateDiagnosticSha256',
  'metadata-capture-histories-failure.private.json':'metadataCaptureHistorySha256','call-profile.private.json':'privateCallProfileSha256',
  'current-subprocess-diagnostic.private.json':'currentSubprocessDiagnosticSha256','source-kernel-traceback-private.json':'sourceKernelTracebackSha256'}
 for name,key in diagnostics.items():protected(oldroot/name,failed[key])
 whole=proofs['whole-catalog-reconciliation'];before=document(CACHE_BASE/'before.json',base['beforeSha256'])
 expected=before['catalog'];prior=whole['priorAborted'];actual=whole['actualCatalog']
 need(whole['failedHeld6RootResultSha256']==value['failedHeld6RootResultSha256']and
  whole['acceptedBaselineRootResultSha256']==baseline_local['resultSha256']and whole['beforeSha256']==base['beforeSha256']and
  whole['wholeCatalogQualified']is whole['allColumnACLQualified']is whole['readerGraphQualified']is whole['sharedSDKLockHeld']is True and
  whole['newSQLMutationDispatched']is whole['newPreparedACKCreated']is False and actual['catalogSha256']==expected['catalogSha256']and
  all(encoded(actual['postProof'][key])==encoded(expected['postProof'][key])for key in['catalog','reader','allColumnAcl'])and
  prior['validated']is True and prior['bindingSha256']==base['priorAbortedSha256']and prior['binding']['transactionId']=='16540148'and
  prior['binding']['transactionStatus']=='aborted'and prior['binding']['priorChildGone']is prior['binding']['priorBackendGone']is True,
  'genuine_complete_original_catalog_reader_all_column_ACLs_and_prior_aborted_ancestry_required')
 terminal={'transactionId':'17009625','transactionStatus':'aborted','rootEpochGone':True,'childEpochGone':True,
  'backendEpochGone':True,'ownerAPPBackendCount':0,'matchingSQLentryProcessCount':0,'publicationReadBackendCount':0}
 need(encoded(whole['terminalBefore'])==encoded(whole['terminalAfter'])==encoded(terminal),'actual_original_HELD6_root_child_backend_and_publication_terminals_required')
 need(set(whole['baselineFiles'])=={'before.json','rehearsal-intent.json','rehearse-sql-child.json','rehearse-sql-opened.json','rehearsed.json','authorization.json'}and
  set(whole['failedCaptureFiles'])=={'intent.json','approval-before-launch.json','apply-sql-child.json','apply-sql-opened.json','failure.json'},
  'exact_six_baseline_and_five_actual_failed_HELD6_capture_records_required')
 capture=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-held-rollback-20261026-6')
 for directory,rows in[(CACHE_BASE,whole['baselineFiles']),(capture,whole['failedCaptureFiles'])]:
  need({p.name for p in directory.iterdir()}==set(rows),'actual_reconciled_original_record_population_unchanged_before_new_capture')
  for name,frame in rows.items():need(file_frame(directory/name,frame['sha256'])==frame,'all_reconciled_file_bytes_and_inodes_unchanged_before_new_capture')
 epoch=before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']
 need(proofs['new-full-current-prerequisites']['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  encoded(proofs['new-full-current-prerequisites']['metadataCurrentProof']['metadataEpoch'])==encoded(epoch)and
  proofs['full-source-postflight']['metadataActorCurrent']['currentActorQualified']is True and
  encoded(proofs['full-source-postflight']['metadataEpoch'])==encoded(epoch),
  'genuine_reconciliation_full_current_and_source_postflight_same_metadata_epoch_required')
 history=document(root/'metadata-capture-histories-success.private.json',value['metadataCaptureHistorySha256'])
 validate_history(history,value,sha(encoded(epoch)))
 return{'reconciliationSourceSha256':'35ebfb3ca9f66f246635f0ea58d82b8e4e1f4d20ced5ab7a26d563933ba1ea73',
  'resultSha256':digest,'rootResult':value,'proofHashes':value['proofHashes'],'metadataHistorySha256':value['metadataCaptureHistorySha256'],
  'originalFailedHELD6ProofHashes':failed['proofHashes'],'originalFailureDiagnosticHashes':{key:failed[key]for key in diagnostics.values()},
  'newHeldSuccessAuthority':False,'newTimingAuthority':False,'originalFailureRelabelled':False}


def authenticate_qualified_audit_files(authority,qualified):
 fixed={'intent.json','approval-before-launch.json','apply-sql-child.json','apply-sql-opened.json','actual-prepared-observation.json','complete-held-callback.json'}
 need(set(qualified['auditFiles'])==fixed,'all_six_genuine_qualified_held_audit_records_required')
 audit=authority.BASE/'captures'/CAPTURE
 rows={name:document(audit/name,qualified['auditFiles'][name])for name in fixed}
 opened=rows['apply-sql-opened.json'];child=rows['apply-sql-child.json'];packet=rows['actual-prepared-observation.json']
 need(rows['approval-before-launch.json']==qualified['approvalGate']and
  opened['childFileSha256']==qualified['auditFiles']['apply-sql-child.json']and
  opened['message']['mode']=='apply'and opened['message']['xid']==qualified['transactionId']and
  opened['message']['backend']['xid']==qualified['transactionId']and child['mode']=='apply'and
  packet['neverProductionPreparedACK']is True and sha(packet['valueJson'].encode())==qualified['actualPreparedPacketSha256']and
  rows['complete-held-callback.json']['packetSha256']==qualified['actualPreparedPacketSha256']and
  rows['complete-held-callback.json']['productionPreparedACKCreated']is False,
  'actual_genuine_opened_child_prepared_packet_and_complete_callback_chain_required')
 return rows

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_host_required')
reconciliation_proof=authenticate_held6_reconciliation()
need(not os.path.lexists(AUDIT),'fresh_exclusive_root_held_audit_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(880)
try:
 proof_hashes['authenticated-held6-reconciliation']=write('authenticated-held6-reconciliation.private.json',reconciliation_proof)
 stage='authenticate-actual-held5-preSQL-failure'
 failed5=held5_failure()
 proof_hashes['authenticated-held5-failure']=write('authenticated-held5-failure.private.json',failed5)
 stage='authenticate-deliberate-held5-ancestry'
 ancestry=deliberate_ancestry()
 proof_hashes['authenticated-deliberate-observation-ancestry']=write('authenticated-deliberate-observation-ancestry.private.json',ancestry)
 stage='authenticate-completed-construct-only3-baseline'
 baseline_root=document(BASELINE_AUDIT/'result.json',baseline_local['resultSha256'])
 need(baseline_local=={**baseline_root,'resultSha256':sha(protected(BASELINE_AUDIT/'result.json'))}and
  baseline_root['format']=='root-CONT5-construct-only-baseline-v1'and baseline_root['completed']is True and
  baseline_root['fullCurrentQualifiedByGenuineConstruct']is baseline_root['baselineCompleted']is True and
  baseline_root['historicalSchedulingEvidenceOnly']is True and baseline_root['newCadenceObservationPerformed']is baseline_root['approvalLifetimeReset']is False and
  baseline_root['baselineCaptureId']==BASELINE_CAPTURE and baseline_root['callerSha256']==CALLER_SHA and
  baseline_root['readerManifestSha256']==MANIFEST_SHA and baseline_root['metadataRefsSha256']==sha(encoded(refs))and
  baseline_root['priorReadPreparationResultSha256']=='ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc'and
  baseline_root['priorQualificationReconciliationSha256']=='80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125'and
  baseline_root['metadataCurrentProofProducerSha256']=='f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2'and
  all(baseline_root[k]is False for k in['automaticRetryAllowed','realCOMMITDispatched','LOGINDispatched','heldApplyDispatched','heldQualificationPerformed','providerRefreshRequested','historicalCONT4BaselineReusedAsCurrent'])and baseline_root['serviceActionsDispatched']==0,
  'actual_complete_construct_only3_baseline_not_old_failed_baseline_or_scheduling_SQL_authority_required')
 proof_hashes['baseline-root-result']=write('authenticated-baseline-root-result.private.json',baseline_root)
 fixed={'historical-scheduling-evidence':'historical-scheduling-evidence.private.json','context':'context.private.json',
  'metadata-ack':'metadata-ack.private.json','source-preflight':'source-preflight.private.json',
  'original-catalog-reconciliation':'original-catalog-reconciliation.private.json',
  'archive-intent':'archive-intent.private.json','archive-result':'archive-result.private.json','baseline':'baseline-result.private.json'}
 need(set(baseline_root['proofHashes'])==set(fixed),'all_eight_actual_construct_only3_proof_hashes_required')
 proofs={key:document(BASELINE_AUDIT/name,baseline_root['proofHashes'][key])for key,name in fixed.items()}
 historical=proofs['historical-scheduling-evidence']
 need(historical['rootResultSha256']==baseline_root['priorReadPreparationResultSha256']and historical['sampleCount']==31 and historical['checkedAtAdvanceCount']>=2 and
  historical['schedulingEvidenceOnly']is True and all(historical[k]is False for k in['newCurrentAuthority','newBaselineAuthority','SQLApprovalAuthority','approvalLifetimeReset']),
  'historical_cadence_is_only_scheduling_evidence_never_current_or_held_authority')
 old_audit=pathlib.Path('/var/backups/yunipals-root-cont5-current-cadence-baseline-20261026-2')
 cadence=document(old_audit/'accepted-cadence.private.json',historical['acceptedCadenceSha256'])
 need(cadence['accepted']is cadence['allSamplesAccepted']is cadence['samplerStopped']is True and
  cadence['sampleCount']==31 and cadence['checkedAtAdvanceCount']==historical['checkedAtAdvanceCount']and
  150_000_000_000<=cadence['durationNanoseconds']<180_000_000_000,'actual_previous_normal_scheduling_observation_required')
 archive=proofs['archive-result'];intent=proofs['archive-intent'];reconciled=proofs['original-catalog-reconciliation']
 need(archive['format']==intent['format']=='root-CONT5-preSQL-archive-v1'and archive['source']==intent['source']==str(CACHE_BASE)and
  archive['destination']==intent['destination']==str(BASELINE_AUDIT/'partial-cache-before-archive')and
  archive['partialFrame']==intent['partialFrame']and archive['capture2IntentFrame']==intent['capture2IntentFrame']and
  archive['originalCatalogProofSha256']==intent['originalCatalogProofSha256']==baseline_root['proofHashes']['original-catalog-reconciliation']and
  baseline_root['archiveResultSha256']==baseline_root['proofHashes']['archive-result']and
  all(archive[k]is True for k in['archived','sourceAbsent','directoryAndFileInodesPreserved','capture2IntentUnchanged','sharedSDKLockHeldDuringReconciliationAndArchive','genuineConstructWillAcquireOwnLockAfterThisLockReleases'])and
  all(archive[k]is False for k in['acceptedBaselineClaimed','oldFilesCopied','oldFilesOverwritten','newSQLDispatched'])and
  reconciled['wholeCatalogQualified']is reconciled['allColumnACLQualified']is True and reconciled['ownedAPPBackendCount']==reconciled['matchingSQLentryProcessCount']==0,
  'actual_owned_preSQL_archive_not_copied_fresh_baseline_and_full_reconciliation_required')
 archive_frame(BASELINE_AUDIT/'partial-cache-before-archive',archive['partialFrame'])
 capture2=pathlib.Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v5-20261026/captures/cont5-baseline-20261026-2/intent.json')
 need(file_frame(capture2,archive['capture2IntentFrame']['sha256'])==archive['capture2IntentFrame'],
  'actual_old_capture2_intent_preserved_around_new_baseline_required')
 baseline=proofs['baseline']
 need(baseline['completed']is True and baseline['action']=='construct-records'and baseline['captureId']==BASELINE_CAPTURE and
  baseline['sha256']==baseline_root['baselineReceiptSha256']and
  all(baseline[k]==baseline_root[k]for k in['beforeSha256','rehearsedSha256','authorizationSha256','actualNewRehearsalXID','priorAbortedSha256'])and
  baseline['productionPreparedACKCreated']is baseline['productionCOMMITQualified']is baseline['newStopActionPerformed']is False and
  proofs['context']['metadataRefs']==refs and proofs['context']['cacheInputSha256']==CACHE_INPUT_SHA,
  'genuine_new_baseline3_SQL_ROLLBACK_receipt_and_same_owned_epoch_required')
 before=document(CACHE_BASE/'before.json',baseline['beforeSha256']);metadata=before['binding']['prerequisites']['metadataCurrentProof']
 need(before['binding']['operatorSha256']=='30ee6c1935822dc2a000ea9aa874117b3e7f5cd8dee1e2d180f6a5206f85b326'and
  metadata['currentNativeMetadataQualified']is True and baseline['fullSourcePostflight']['metadataEpoch']==metadata['metadataEpoch']and
  baseline['fullSourcePostflight']['metadataActorCurrent']['currentActorQualified']is True,
  'actual_original_construct_full_current_and_source_postflight_not_historical_cadence_authority')
 expected_binding=sha(encoded(metadata['metadataEpoch']))
 history=document(BASELINE_AUDIT/'metadata-capture-histories-success.private.json',baseline_root['metadataCaptureHistorySha256'])
 validate_history(history,baseline_root,expected_binding)
 profile=document(BASELINE_AUDIT/'call-profile.private.json',baseline_root['privateCallProfileSha256'])
 need(profile['format']=='yunipals-ypal-ordinary-call-profile-v1'and len(profile['events'])==baseline_root['profiledCallCount']and
  profile['droppedCalls']==baseline_root['profiledCallsDropped']and profile['observationErrors']==baseline_root['profileObservationErrors']and
  all(profile[k]is False for k in['functionCodeChanged','argumentsChanged','returnValuesChanged','approvalClockReset','timingQualificationClaimed','effectsRetried']),
  'actual_new_baseline3_private_profile_not_timing_authority_required')
 sql_observed=document(BASELINE_AUDIT/'baseline-SQL-observation.private.json',baseline_root['baselineSQLObservationSha256'])
 need(sql_observed['format']=='root-CONT5-baseline-SQL-observation-v1'and sql_observed['wholeParentCodeUnchanged']is sql_observed['parentRestored']is True and
  len(sql_observed['transports'])==baseline_root['baselineObservedSQLTransportCount']>=1 and
  sum(row['capturedBytes']for row in sql_observed['transports'])==baseline_root['baselinePrivateSQLStderrBytes']and
  all(sql_observed[k]is False for k in['SQLBytesChanged','predicatesChanged','deadlinesChanged','clockReset','effectOrCaptureRetried','newQualificationAuthorityConferred']),
  'actual_new_baseline3_normal_SQL_observation_required')
 commands=document(BASELINE_AUDIT/'current-subprocess-diagnostic.private.json',baseline_root['currentSubprocessDiagnosticSha256'])
 need(commands['diagnosticSourceSha256']=='2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465'and
  commands['subprocessRunRestored']is baseline_root['currentSubprocessRunRestored']is True and
  commands['argumentsEnvironmentTimeoutAndOriginalResultsChanged']is commands['automaticRetryAllowed']is False and
  len(commands['calls'])==baseline_root['currentSubprocessCommandCount']<=10000 and
  len(commands['failures'])==baseline_root['currentSubprocessFailureCount']<=1000,'actual_baseline3_current_command_diagnostic_required')
 for index,row in enumerate(commands['failures'],1):
  payload=document(BASELINE_AUDIT/('current-failed-command-'+str(index)+'.json'),row['privateEvidenceSha256'])
  need(payload['summary']=={k:v for k,v in row.items()if k!='privateEvidenceSha256'},'same_private_current_command_evidence_required')
 proof_hashes['authenticated-baseline-metadata-histories']=write('authenticated-baseline-metadata-histories.private.json',history)
 proof_hashes['authenticated-baseline-proof-hashes']=write('authenticated-baseline-proof-hashes.private.json',baseline_root['proofHashes'])
 proof_hashes['authenticated-baseline-archive']=write('authenticated-baseline-archive.private.json',archive)
 stage='authenticate-live-programs'
 source_manifest=json.loads(protected(MANIFEST,MANIFEST_SHA));protected(OWNER_MANIFEST,refs['manifestSha256'])
 witness_module=load(OPS/'ypal-cont5-held-after-exception-v1.py','ba7e2570888811d741be95d53826e9dd1e71ad5beb3d89cb55cdff1e1c4925c1')
 current_diagnostic=load(OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py','2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465')
 owner=load(OWNER,refs['producerSha256']);caller=load(CALLER,CALLER_SHA)
 report=document(REPORT,REPORT_SHA)
 need(report['cacheInputsSha256']==CACHE_INPUT_SHA,'same_actual_original_cache_input_required')
 ack=owner.acknowledgement(refs['resultSha256'],refs['inputSha256'])
 need(ack==proofs['metadata-ack']and ack['immutableAcknowledgementOnly']is True,'same_actual_accepted_Owner3_ACK_as_CONT5_baseline_required')
 # Build only a reference to the genuine derived function; no Host/Authority,
 # current proof or kernel query is invoked by this authentication.
 source_guard=load(OPS/'ypal-ordinary-source-authority-v6.py','36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82')
 source_host=load(OPS/'ypal-alchemy-source-switch-v1.host.py','3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02')
 source_namespace=source_guard.composition()
 kernel_reference=code_shape(source_namespace.classified_kernel(source_host).__code__)
 stage='full-live-preflight'
 command_trace=current_diagnostic.SubprocessDiagnostics(original_subprocess_run,save_current_failure)
 need(subprocess.run is original_subprocess_run,'original_run_before_held_current_observation_required')
 subprocess.run=command_trace
 need(sys.gettrace()is None and sys.getprofile()is None,'held7_genuine_session_and_qualifier_must_have_no_live_trace_or_profile')
 session=phase('session-constructor',caller.Session,report['sourceRefs'],MANIFEST_SHA,refs)
 proof_hashes['new-source-preflight']=write('new-source-preflight.private.json',phase('session-preflight',session.preflight))
 stage='new-cache-context';context=phase('cache-context',session.cache_context,CACHE_INPUT_SHA)
 need(type(context)is tuple and len(context)==2 and context[0]is session.cache and context[1]is session.host,'actual_cache_context_tuple_required')
 cache=session.cache;authority=cache.continuation_authority
 stage='authenticate-current-baseline-files'
 actual_baseline=document(authority.BASE/'captures'/BASELINE_CAPTURE/'result.json',baseline['sha256'])
 need(all(baseline[key]==value for key,value in actual_baseline.items())and actual_baseline['completed']is True,
  'same_actual_authority_baseline_audit_receipt_required')
 for name,key in [('before.json','beforeSha256'),('rehearsed.json','rehearsedSha256'),('authorization.json','authorizationSha256')]:
  protected(cache.BASE/name,baseline[key])
 for name in ['sql-intent.json','sql-prepared.json','sql-committed.json','prepared.json','apply-sql-child.json','apply-sql-opened.json']:
  need(not os.path.lexists(cache.BASE/name),'held_qualification_requires_no_real_apply_or_COMMIT_records')
 stage='full-current-prerequisites'
 prerequisites=phase('full-current-prerequisites',session.host.prerequisites)
 need(prerequisites['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  prerequisites['metadataCurrentProof']['metadataEpoch']==session.metadata_epoch.binding(),'genuine_full_current_metadata_and_actual_epoch_required')
 proof_hashes['new-full-current-prerequisites']=write('new-full-current-prerequisites.private.json',prerequisites)
 stage='actual-prior-aborted-authority'
 prior=phase('prior-aborted-authority',authority.prior_aborted,cache.prior_cache,session.host)
 need(prior['validated']is True and prior['binding']['transactionId']=='16540148'and prior['binding']['transactionStatus']=='aborted'and
  prior['binding']['priorChildGone']is prior['binding']['priorBackendGone']is True and
  prior['bindingSha256']==baseline['priorAbortedSha256'],'same_actual_original_aborted_XID_and_unchanged_journals_required')
 proof_hashes['actual-prior-aborted']=write('actual-prior-aborted.private.json',prior)
 stage='reconcile-held5-and-prepare-untraced-dependencies'
 reconcile_and_prepare(cache,session.host,authority,baseline)
 stage='qualify-held-rollback-only'
 write('qualification-invocation-intent.private.json',{'captureId':CAPTURE,'baselineCaptureId':BASELINE_CAPTURE,
  'rootDriverVariant':'held7-unprofiled-after-exception-witness','supersededUnexecutedDriverSha256':'ffddee6679680466a823340fcd822858f2762b0d94ad5d538c6903f6ccf6ca3e',
  'baselineRootResultSha256':baseline_local['resultSha256'],'baselineReceiptSha256':baseline['sha256'],
  'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefs':refs,
  'automaticRetryAllowed':False,'realCOMMITPermitted':False,'LOGINPermitted':False,'serviceActionsPermitted':False})
 original_raw=cache._sql_child
 qualifier_started=True
 measured=phase('qualify-held-rollback-only',caller.qualify_held,session,CAPTURE)
 qualifier_returned=True
 need(measured['completed']is measured['rollbackOnly']is True and measured['productionCOMMITQualified']is False and
  measured['captureId']==CAPTURE and pin(measured['sha256']),'actual_complete_rollback_qualification_return_required')
 qualification_ref={'captureId':CAPTURE,'sha256':measured['sha256']}
 proof_hashes['qualifier-return']=write('qualifier-return.private.json',measured)
 need(cache._sql_child is original_raw and not hasattr(cache,'_continuation_qualification')and not hasattr(cache,'_continuation_approval_gate'),
  'genuine_transport_restored_and_typed_rollback_scope_cleared_required')
 stage='authenticate-complete-held-receipt'
 qualified=phase('require-qualification',authority.require_qualification,cache,session.host,qualification_ref)
 actual_qualified=document(authority.BASE/'captures'/CAPTURE/'result.json',qualification_ref['sha256'])
 need(qualified==actual_qualified and qualified['transactionId']not in{'16540148','16775453',baseline['actualNewRehearsalXID']}and qualified['transactionStatus']=='aborted'and
  qualified['completeHeldCallback']is qualified['rollbackOnly']is qualified['childGone']is qualified['backendGone']is qualified['catalogRestored']is True and
  qualified['transactionalCatalogMutationsRolledBack']is True and qualified['productionCOMMITQualified']is qualified['productionPreparedACKCreated']is False and
  qualified['reserveNanoseconds']==5_000_000_000 and qualified['approvalGate']['ttlNanoseconds']==90_000_000_000 and
  qualified['elapsedNanoseconds']+qualified['reserveNanoseconds']<qualified['approvalGate']['remainingNanoseconds'],
  'actual_new_aborted_XID_full_callback_catalog_rollback_and_unchanged_90_plus_5_budget_required')
 authenticate_qualified_audit_files(authority,qualified)
 proof_hashes['authenticated-held-qualification']=write('authenticated-held-qualification.private.json',qualified)
 observation_summary=save_observations()
 capture_summary={**capture_histories('success'),**observation_summary}
 stage='complete'
 result={'format':'root-CONT5-held-rollback-qualification-v5','completed':True,'observedAt':now(),'stage':stage,
  'baselineRootResultSha256':baseline_local['resultSha256'],'baselineReceiptSha256':baseline['sha256'],
  'heldQualification':qualification_ref,'transactionId':qualified['transactionId'],'transactionStatus':'aborted',
  'completeHeldCallback':True,'childGone':True,'backendGone':True,'catalogRestored':True,'transactionalCatalogMutationsRolledBack':True,
  'elapsedHeldNanoseconds':qualified['elapsedNanoseconds'],'reserveNanoseconds':qualified['reserveNanoseconds'],
  'approvalRemainingAtLaunchNanoseconds':qualified['approvalGate']['remainingNanoseconds'],
  'actualPreparedPacketSha256':qualified['actualPreparedPacketSha256'],'auditFileHashes':qualified['auditFiles'],'proofHashes':proof_hashes}
except BaseException as error:
 original_trace=traceback.format_exc().encode()
 # All business work has already failed; this witness never runs in its timed
 # path. A diagnostic refusal cannot replace the original failure/traceback.
 if witness_module is not None and session is not None and getattr(session,'cache',None)is not None:
  try:
   witness=witness_module.Witness(error,session.cache.continuation_authority)
   snapshot=witness.snapshot()
   capture_summary.update({'afterExceptionWitnessSha256':write('after-exception-witness.private.json',snapshot),
    'caughtInnerErrorObserved':snapshot['caughtInnerErrorObserved']})
  except BaseException as diagnostic_error:
   refusal=traceback.format_exc().encode();capture_summary['afterExceptionWitnessRefused']=True
   try:capture_summary['afterExceptionWitnessRefusalSha256']=write('after-exception-witness-refusal.private.txt',refusal)
   except BaseException:capture_summary['afterExceptionWitnessRefusalSaveFailed']=True
 try:observation_summary=save_observations()
 except BaseException:observation_summary={'observationSaveFailed':True}
 try:
  kernel_evidence=kernel_traceback_evidence(error)
  kernel_diagnostic_summary={'sourceKernelTracebackSha256':write('source-kernel-traceback-private.json',kernel_evidence),
   'sourceKernelTracebackFrameCount':len(kernel_evidence['frames']),'sourceKernelTracebackCaptureErrorCount':len(kernel_evidence['captureErrors']),
   'sourceKernelLiveTraceInstalled':False,'sourceKernelDiagnosticObservationsPerformed':0}
 except Exception:
  kernel_diagnostic_summary={'sourceKernelTracebackSaveFailed':True,'sourceKernelLiveTraceInstalled':False,'sourceKernelDiagnosticObservationsPerformed':0}
 try:capture_summary={**capture_summary,**capture_histories('failure',error),**observation_summary}
 except BaseException:
  proof_hashes['metadata-history-save-refusal']=write('metadata-history-save-refusal.private.txt',traceback.format_exc().encode())
 diagnostic=write('failure.private.txt',original_trace)
 result={'format':'root-CONT5-held-rollback-qualification-v5','completed':False,'observedAt':now(),'stage':stage,
  'qualifierInvoked':qualifier_started,'qualifierReturned':qualifier_returned,'heldQualification':qualification_ref,
  'transactionOutcomeQualified':False,'outcomeReconciliationRequired':qualifier_started,
  'privateDiagnosticSha256':diagnostic,'errorClass':type(error).__name__,
  'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained',
  'proofHashes':proof_hashes}
signal.alarm(0)
result.update(capture_summary)
result.update(kernel_diagnostic_summary)
result.update({'priorHeld6FailureSha256':'c218a2c8a14e0bb8884e4f23aa3a513e890399a9a435f217e4ca28cc633ed372',
 'priorHeld6ReconciliationSha256':recon_local['resultSha256'],'originalHeld6FailureRelabelled':False,
 'liveTraceInstalled':False,'liveProfileInstalled':False,'SQLParentWrapped':False,'SQLParentPopenOrPipeWrapped':False,'passiveOriginalRunObserverRetained':True,
 'afterExceptionWitnessSourceSha256':'ba7e2570888811d741be95d53826e9dd1e71ad5beb3d89cb55cdff1e1c4925c1',
 'priorHeld5FailureSha256':FAILED5_SHA,'readOnlyDependencyPreparationRequired':True,
 'dependencyDeadlineSecondsUnchanged':120,'approvalClockResetByPreparation':False,'priorHeld4FailureSha256':'29ecd865d83ccd707dc41957c2e7b513bc66bcc890214b6c66b27125a53a8d90',
 'separateSource6DiagnosticSha256':'b90ea254cd2965ee9b45a82a14d2dc84cb7687c5b7ae53af34ae8b44ef3f5c66',
 'originalHeld4FailureRelabelled':False,'sourcePolicyChanged':False})
result.update({'rootDriverVariant':'held7-unprofiled-after-exception-witness','supersededUnexecutedDriverSha256':'ffddee6679680466a823340fcd822858f2762b0d94ad5d538c6903f6ccf6ca3e',
 'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefsSha256':sha(encoded(refs)),
 'elapsedNanoseconds':time.monotonic_ns()-started,'automaticRetryAllowed':False,'realCOMMITDispatched':False,
 'productionCOMMITQualified':False,'productionPreparedACKCreated':False,'LOGINDispatched':False,'serviceActionsDispatched':0,
 'priorQualificationReconciliationSha256':'80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125',
 'metadataCurrentProofProducerSha256':'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2',
 'historicalCONT4BaselineReusedAsCurrent':False,
 'providerRefreshRequested':False,'qualificationOnly':True})
digest=write('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True))
raise SystemExit(0 if result['completed']else 1)
'''


def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def read_private(path):
    before=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_gid!=0 or before.st_nlink!=1 or before.st_mode&0o077 or before.st_size>16000000:
        raise RuntimeError('actual_protected_root_result_required')
    raw=path.read_bytes();after=path.lstat()
    if len(raw)!=before.st_size or any(getattr(before,key)!=getattr(after,key)for key in
        ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('same_actual_root_result_bytes_required')
    return json.loads(raw)


def exclusive(path,value):
    raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def require_reconciliation_result(value):
    expected={'actual-failed-held6','baseline-root-result','authenticated-baseline-metadata-histories',
        'authenticated-baseline-proof-hashes','authenticated-baseline-archive','new-source-preflight',
        'new-full-current-prerequisites','whole-catalog-reconciliation','full-source-postflight'}
    if type(value)is not dict or value.get('resultSha256')!='23cb35fa68f1c728eb0d1c7e0e90238755832d434875002c1b849664f901c75d'or \
        hashlib.sha256(encoded({k:v for k,v in value.items()if k!='resultSha256'})).hexdigest()!=value['resultSha256']:
        raise RuntimeError('actual_canonical_successful_HELD6_reconciliation_required_before_SSH')
    if value.get('format')!='root-CONT5-held6-reconciliation-v1'or value.get('stage')!='complete'or value.get('completed')is not True or \
        value.get('failedHeld6RootResultSha256')!='c218a2c8a14e0bb8884e4f23aa3a513e890399a9a435f217e4ca28cc633ed372'or \
        value.get('acceptedBaselineRootResultSha256')!='2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195'or \
        value.get('transactionId')!='17009625'or value.get('transactionStatus')!='aborted'or \
        not all(value.get(k)is True for k in ['childGone','backendGone','rootEpochGone','wholeCatalogQualified','allColumnACLQualified',
            'readerGraphQualified','fullCurrentQualified','fullSourcePostflightPassed','allOriginalFileBytesAndInodesUnchanged'])or \
        type(value.get('proofHashes'))is not dict or set(value['proofHashes'])!=expected or \
        value.get('catalogProofSha256')!=value['proofHashes'].get('whole-catalog-reconciliation')or \
        value.get('callerSha256')!='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'or \
        value.get('readerManifestSha256')!='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'or \
        value.get('metadataRefsSha256')!=hashlib.sha256(encoded(EXPECTED_REFS)).hexdigest()or \
        not all(value.get(k)is False for k in ['automaticRetryAllowed','realCOMMITDispatched','qualifierDispatched','baselineDispatched',
            'LOGINDispatched','providerRefreshRequested','databaseMutationsDispatched','newHeldSuccessAuthority','newCommitAuthority']):
        raise RuntimeError('actual_complete_HELD6_reconciliation_not_new_held_authority_required_before_SSH')
    return value


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:
        print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    if HELD7_SOURCE_REVIEWED is not True:raise SystemExit('HELD7_source_review_and_successful_reconciliation_contract_required_before_SSH')
    started=time.monotonic();os.umask(0o077)
    if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_held_result_required_no_retry')
    refs=read_private(METADATA_REFS);baseline=read_private(BASELINE_RESULT)
    if refs!=EXPECTED_REFS or baseline.get('format')!='root-CONT5-construct-only-baseline-v1'or baseline.get('baselineCaptureId')!='cont5-baseline-20261026-3'or \
        baseline.get('callerSha256')!='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'or \
        baseline.get('readerManifestSha256')!='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'or \
        not all(baseline.get(key)is True for key in['completed','fullCurrentQualifiedByGenuineConstruct','baselineCompleted']):
        raise SystemExit('actual_successful_CONT5_baseline_and_exact_metadata_refs_required_before_SSH')
    if not isinstance(baseline.get('resultSha256'),str)or len(baseline['resultSha256'])!=64:
        raise SystemExit('actual_CONT5_baseline_remote_result_SHA_required')
    held4=read_private(HELD4_RESULT);kernel=read_private(KERNEL_RESULT)
    for value,digest,failed in [(held4,'29ecd865d83ccd707dc41957c2e7b513bc66bcc890214b6c66b27125a53a8d90',True),
        (kernel,'b90ea254cd2965ee9b45a82a14d2dc84cb7687c5b7ae53af34ae8b44ef3f5c66',False)]:
        if type(value)is not dict or value.get('resultSha256')!=digest:raise SystemExit('actual_fixed_predecessor_result_required_before_SSH')
        canonical={key:item for key,item in value.items()if key!='resultSha256'}
        if failed and 'remoteAuditInspectionRequired'in canonical:
            if canonical.pop('remoteAuditInspectionRequired')is not True:raise SystemExit('only_actual_true_transport_annotation_supported')
        if hashlib.sha256(encoded(canonical)).hexdigest()!=digest:raise SystemExit('actual_canonical_predecessor_bytes_required_before_SSH')
    held5=read_private(HELD5_RESULT)
    if type(held5)is not dict or held5.get('resultSha256')!='099a3053d4e8e36dfb6fee888856af16300d3ad89fcbfff29d3ec23db51684fd'or hashlib.sha256(encoded({key:value for key,value in held5.items()if key!='resultSha256'})).hexdigest()!=held5['resultSha256']:
        raise SystemExit('actual_canonical_failed_held5_receipt_required_before_SSH')
    recon=read_private(RECON_RESULT)
    require_reconciliation_result(recon)
    remote=REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(baseline)).replace('ACTUAL_METADATA_REFS',repr(refs)).replace('ACTUAL_HELD4_FAILURE',repr(held4)).replace('ACTUAL_KERNEL_DIAGNOSTIC',repr(kernel)).replace('ACTUAL_HELD5_FAILURE',repr(held5)).replace('ACTUAL_HELD6_RECONCILIATION',repr(recon))
    try:
        remaining=900-(time.monotonic()-started)
        if remaining<=0:raise RuntimeError('root_qualification_total_budget_expired_before_SSH')
        process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
            input=remote,capture_output=True,text=True,timeout=remaining)
        try:
            result=json.loads(process.stdout)
            if type(result)is not dict or result.get('format')!='root-CONT5-held-rollback-qualification-v5'or type(result.get('completed'))is not bool:
                raise ValueError('unexpected_root_result_envelope')
        except Exception:
            exclusive(Path('/tmp/yunipals-cont5-held-rollback-qualification-unparsed-private-20261026-7.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result={'completed':False,'rootDriverTransportFailed':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'outcomeReconciliationRequired':True}
        if process.returncode!=0 or process.stderr:
            exclusive(Path('/tmp/yunipals-cont5-held-rollback-qualification-transport-private-20261026-7.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result.update(completed=False,remoteAuditInspectionRequired=True)
    except subprocess.TimeoutExpired as error:
        exclusive(Path('/tmp/yunipals-cont5-held-rollback-qualification-timeout-private-20261026-7.json'),
            {'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
             'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
        result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
    exclusive(RESULT,result);print(json.dumps(result,sort_keys=True))
    raise SystemExit(0 if result.get('completed')is True else 1)


if __name__=='__main__':main()
