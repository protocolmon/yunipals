#!/usr/bin/env python3
"""Root-only explicit CONT5 owned archive and construct-only runner; default/import inert.

Source preparation only. Root must review this file before invoking --run.
There is no real cache COMMIT, LOGIN, service action or held-apply dispatch.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

REFS=Path('/tmp/yunipals-actual-metadata-epoch-v3-refs-20261025.json')
RESULT=Path('/tmp/yunipals-cont5-construct-only-baseline-production-20261026-3.json')
EXPECTED_REFS={
    'mode':'current',
    'resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
    'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
    'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
    'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'
}

AVAILABILITY_RESULT=Path('/tmp/yunipals-cont5-current-cadence-baseline-production-20261026-2.json')
AVAILABILITY_SHA='ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc'
REMOTE=r'''import datetime,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,sys,time,traceback,types,ctypes
os.umask(0o077)
refs=ACTUAL_METADATA_REFS
availability_local=ACTUAL_AVAILABILITY_RESULT
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-construct-only-baseline-20261026-3')
CAPTURE='cont5-baseline-20261026-3'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
CALLER=OPS/'ypal-ordinary-publication-continue-v5.py'
CALLER_SHA='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v5.manifest.json'
MANIFEST_SHA='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'
CACHE_INPUT_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
OWNER=OPS/'ypal-native-metadata-approval-epoch-v3.py'
OWNER_MANIFEST=OPS/'ypal-native-metadata-approval-epoch-v3.manifest.json'
started=time.monotonic_ns();stage='initial';baseline_started=False;baseline_completed=False;current_qualified=False;cadence_accepted=False;archive_invoked=False;archive_completed=False;archive_ack=None
proof_hashes={};samples=[];session=None;capture_summary={};profiler=None;sql_observation=None;phase_events=[];command_trace=None;original_subprocess_run=subprocess.run

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
def protected(path,digest=None,maximum=4000000):
 path=pathlib.Path(path)
 for item in[*path.parents,path]:
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_actual_root_CONT5_input_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_exact_root_CONT5_input_bytes_required')
 return raw
def load(path,digest):
 raw=protected(path,digest);value=types.ModuleType('root_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value
def deadline(_signum,_frame):raise RuntimeError('root_CONT5_total_remote_deadline_expired_inspect_no_retry')
class BaselineSQLObservation:
 def __init__(self,cache,authority,diagnostic):
  self.cache,self.authority,self.diagnostic=cache,authority,diagnostic
  self.original=cache._sql_child;self.processes=[];self.started=False
  raw=self.original
  need(type(raw)is types.FunctionType and raw.__globals__.get('subprocess')is subprocess,
   'genuine_uninstrumented_baseline_SQL_parent_required')
  expected=authority.bounded_sql_parent(cache.prior_cache._sql_child,cache.prior_cache._sql_child)
  need(authority.code_identity(expected.__code__)==authority.code_identity(raw.__code__),
   'whole_genuine_unchanged_bounded_baseline_SQL_parent_required')
  self.code=authority.code_identity(raw.__code__)
  proxy=types.ModuleType('root_baseline_diagnostic_subprocess');proxy.__dict__.update(subprocess.__dict__);proxy.Popen=self.popen
  self.instrumented=types.FunctionType(raw.__code__,{**raw.__globals__,'subprocess':proxy},raw.__name__,raw.__defaults__,raw.__closure__)
  need(self.instrumented.__code__ is raw.__code__ and self.instrumented.__defaults__ is raw.__defaults__ and
   self.instrumented.__closure__ is raw.__closure__,'baseline_parent_code_defaults_closure_unchanged_required')
 def popen(self,*args,**kwargs):
  need(self.authority.code_identity(sys._getframe(1).f_code)==self.code,'only_actual_baseline_SQL_parent_diagnostic_Popen_required')
  process=subprocess.Popen(*args,**kwargs)
  need(process.stderr is not None,'actual_baseline_SQL_stderr_pipe_required')
  tee=self.diagnostic.StderrTee(process.stderr,process,{})
  self.processes.append(tee);process.stderr=tee;return process
 def __enter__(self):
  need(not self.started and self.cache._sql_child is self.original,'one_unmodified_baseline_SQL_parent_observation_required')
  self.started=True;self.cache._sql_child=self.instrumented;return self
 def __exit__(self,kind,value,tb):
  self.cache._sql_child=self.original;return False
 def snapshot(self):
  need(self.cache._sql_child is self.original,'baseline_SQL_parent_restored_before_diagnostic_save_required')
  return{'format':'root-CONT5-baseline-SQL-observation-v1','transports':[tee.snapshot()for tee in self.processes],
   'wholeParentCodeUnchanged':self.instrumented.__code__ is self.original.__code__,'parentRestored':True,
   'SQLBytesChanged':False,'predicatesChanged':False,'deadlinesChanged':False,'clockReset':False,
   'effectOrCaptureRetried':False,'newQualificationAuthorityConferred':False}
EXPECTED_DEVICE=2049
PARTIAL={'before.json':{'sha256':'a3a0c2a48aad184d3093e0b3d0933d3b798e11d3780cc7acc1d3674a3652ef54','inode':2722747,'bytes':772495},
 'rehearsal-intent.json':{'sha256':'dc37acae4fcadc4c8c18f63c501352e740d3f2d9040df945cd4a2cc6e0efa9d7','inode':2722748,'bytes':319}}
def single_frame(path,digest,inode,size):
 raw=protected(path,digest);row=path.lstat()
 need(row.st_dev==EXPECTED_DEVICE and row.st_ino==inode and len(raw)==size and stat.S_IMODE(row.st_mode)==0o600,
  'exact_owned_partial_file_device_mode_size_inode_and_bytes_required')
 return{'sha256':sha(raw),'device':row.st_dev,'inode':row.st_ino,'mode':row.st_mode,'uid':row.st_uid,'gid':row.st_gid,
  'links':row.st_nlink,'bytes':row.st_size,'mtimeNs':row.st_mtime_ns,'ctimeNs':row.st_ctime_ns}
def partial_frame(path):
 row=path.lstat();need(stat.S_ISDIR(row.st_mode)and not stat.S_ISLNK(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,
  'exact_private_partial_cache_directory_required')
 need({p.name for p in path.iterdir()}==set(PARTIAL),'only_exact_two_owned_preSQL_partial_files_allowed')
 return{'directory':{k:getattr(row,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode']},
  'files':{name:single_frame(path/name,entry['sha256'],entry['inode'],entry['bytes'])for name,entry in PARTIAL.items()}}
def rename_noreplace(source,destination):
 need(not os.path.lexists(destination)and source.parent.stat().st_dev==destination.parent.stat().st_dev,
  'same_filesystem_exclusive_archive_destination_required')
 libc=ctypes.CDLL(None,use_errno=True);rename=libc.renameat2
 rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
 if rename(-100,os.fsencode(source),-100,os.fsencode(destination),1)!=0:
  number=ctypes.get_errno();raise OSError(number,os.strerror(number))
def sql_processes(cache):
 target=os.fsencode(str(cache.ENTRY));rows=[]
 for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdigit():continue
  try:raw=(path/'cmdline').read_bytes()
  except(FileNotFoundError,ProcessLookupError):continue
  if target in raw.split(b'\0'):rows.append({'pid':int(path.name),'commandSha256':sha(raw)})
 return rows
def phase(label,fn,*args,**kwargs):
 began=time.monotonic_ns();returned=False
 try:
  value=fn(*args,**kwargs);returned=True;return value
 finally:phase_events.append({'label':label,'elapsedNanoseconds':time.monotonic_ns()-began,'returned':returned,'repeated':False})
def save_current_failure(name,raw):return write('current-'+name,raw)
def save_profile():
 global profiler
 subprocess.run=original_subprocess_run
 if profiler is not None and profiler.installed:profiler.__exit__(None,None,None)
 summary={}
 if command_trace is not None:
  payload={'diagnosticSourceSha256':'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
   'calls':command_trace.calls,'failures':command_trace.failures,'subprocessRunRestored':subprocess.run is original_subprocess_run,
   'argumentsEnvironmentTimeoutAndOriginalResultsChanged':False,'automaticRetryAllowed':False}
  digest=write('current-subprocess-diagnostic.private.json',payload)
  summary.update({'currentSubprocessDiagnosticSha256':digest,'currentSubprocessCommandCount':len(command_trace.calls),
   'currentSubprocessFailureCount':len(command_trace.failures),'currentSubprocessRunRestored':subprocess.run is original_subprocess_run})
 if sql_observation is not None:
  diagnostic=sql_observation.snapshot();digest=write('baseline-SQL-observation.private.json',diagnostic)
  summary.update({'baselineSQLObservationSha256':digest,'baselineObservedSQLTransportCount':len(diagnostic['transports']),
   'baselinePrivateSQLStderrBytes':sum(row['capturedBytes']for row in diagnostic['transports'])})
 if profiler is None:return summary
 value={**profiler.snapshot(),'rootPhaseEvents':phase_events}
 digest=write('call-profile.private.json',value)
 return{**summary,'privateCallProfileSha256':digest,'profiledCallCount':len(value['events']),
  'profiledCallsDropped':value['droppedCalls'],'profileObservationErrors':value['observationErrors']}
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

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_host_required')
need(not os.path.lexists(AUDIT),'fresh_exclusive_root_CONT5_audit_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(1200)
try:
 stage='authenticate-prior-failed-construction-and-scheduling-evidence'
 previous_audit=pathlib.Path('/var/backups/yunipals-root-cont5-current-cadence-baseline-20261026-2')
 previous=json.loads(protected(previous_audit/'result.json','ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc'))
 need(previous==availability_local and previous['format']=='root-CONT5-current-cadence-baseline-v1'and
  previous['completed']is False and previous['baselineStarted']is True and previous['baselineCompleted']is False and
  previous['fullCurrentQualified']is previous['cadenceAccepted']is True and previous['stage']=='baseline-construct-records'and
  previous['failureCode']=='root_CONT5_total_remote_deadline_expired_inspect_no_retry'and
  previous['callerSha256']==CALLER_SHA and previous['readerManifestSha256']==MANIFEST_SHA and
  previous['metadataRefsSha256']==sha(encoded(refs))and previous['baselineObservedSQLTransportCount']==0 and
  previous['realCOMMITDispatched']is previous['LOGINDispatched']is previous['heldApplyDispatched']is previous['heldQualificationPerformed']is False and
  previous['serviceActionsDispatched']==0,'actual_failed_baseline2_read_preparation_and_no_new_SQL_authority_required')
 cadence=json.loads(protected(previous_audit/'accepted-cadence.private.json',previous['proofHashes']['accepted-cadence']))
 need(cadence['accepted']is cadence['allSamplesAccepted']is cadence['samplerStopped']is True and
  cadence['sampleCount']==previous['sampleCount']==len(cadence['samples'])==31 and
  cadence['checkedAtAdvanceCount']>=2 and
  150_000_000_000<=cadence['durationNanoseconds']<180_000_000_000,
  'actual_previous_accepted_cadence_is_historical_scheduling_evidence_only')
 for sample in cadence['samples']:
  evidence=json.loads(protected(previous_audit/('cadence-sample-'+str(sample['index']).zfill(3)+'.private.json'),sample['proofSha256']))
  need(evidence['snapshot']['checkedUs']==sample['checkedUs']and evidence['ageNanoseconds']==sample['ageNanoseconds']and
   evidence['remainingNanoseconds']==sample['remainingNanoseconds']and evidence['officialApprovalRefreshedByThisGate']is False,
   'all_actual_historical_scheduling_sample_hashes_required')
 proof_hashes['historical-scheduling-evidence']=write('historical-scheduling-evidence.private.json',{
  'rootResultSha256':'ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc',
  'acceptedCadenceSha256':previous['proofHashes']['accepted-cadence'],'sampleCount':31,'checkedAtAdvanceCount':cadence['checkedAtAdvanceCount'],
  'schedulingEvidenceOnly':True,'newCurrentAuthority':False,'newBaselineAuthority':False,'SQLApprovalAuthority':False,'approvalLifetimeReset':False})
 stage='authenticate'
 source_manifest=json.loads(protected(MANIFEST,MANIFEST_SHA));protected(OWNER_MANIFEST,refs['manifestSha256'])
 profile_module=load(OPS/'ypal-ordinary-call-profile-v1.py','5b3aa246bf10e6e69c70d01ed4742d1817d86a0e9095f243428b4c8e9c901d8a')
 diagnostic_module=load(OPS/'ypal-ordinary-held-diagnostic-v1.py','7bf19a75010694cf63be776cff4a3db111515eb0442a8568c9c49e883b2df61a')
 current_diagnostic=load(OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py','2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465')
 profile_files={str(OPS/name):digest for name,digest in{**source_manifest['dependencies'],**source_manifest['files']}.items()if name.endswith('.py')}
 profile_files[str(CALLER)]=CALLER_SHA
 profiler=profile_module.CallProfile(profile_files,{
  '__init__','current','metadata','refresh','publication_proof','sessions','query','actor','private','inputs','read_operation',
  'prerequisites','invoke','prepared','sql_child','_sql_child','qualified_sql_child','before_literal_ack','fresh_approval',
  'approval_snapshot','original_catalog','stopped','_construct_records','construct_records','_qualify_held','qualify_held',
  'finish','preflight','capture_current','actor_current','accepted_actor','kernel_backends','current_kernel'})
 owner=load(OWNER,refs['producerSha256']);caller=load(CALLER,CALLER_SHA)
 report=json.loads(protected(REPORT,REPORT_SHA))
 need(type(report)is dict and report['cacheInputsSha256']==CACHE_INPUT_SHA and type(report['sourceRefs'])is dict,'same_actual_accepted_generation_report_and_cache_input_required')
 proof_hashes['context']=write('context.private.json',{'metadataRefs':refs,'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,
  'reportFile':str(REPORT),'reportSha256':REPORT_SHA,'cacheInputSha256':CACHE_INPUT_SHA,'baselineCaptureId':CAPTURE,
  'realCommitPermitted':False,'LOGINPermitted':False,'serviceActionsPermitted':False,'heldApplyPermitted':False})
 ack=owner.acknowledgement(refs['resultSha256'],refs['inputSha256'])
 need(ack['immutableAcknowledgementOnly']is True and ack['operatorSha256']==refs['producerSha256'],'actual_Owner3_immutable_ACK_required')
 proof_hashes['metadata-ack']=write('metadata-ack.private.json',ack)
 stage='session-preflight'
 command_trace=current_diagnostic.SubprocessDiagnostics(original_subprocess_run,save_current_failure)
 need(subprocess.run is original_subprocess_run,'original_run_before_deliberate_current_observation_required')
 subprocess.run=command_trace
 profiler.__enter__()
 session=phase('session-constructor',caller.Session,report['sourceRefs'],MANIFEST_SHA,refs)
 proof_hashes['source-preflight']=write('source-preflight.private.json',phase('session-preflight',session.preflight))
 stage='cache-context'
 context=phase('cache-context',session.cache_context,CACHE_INPUT_SHA)
 need(type(context)is tuple and len(context)==2 and context[0]is session.cache and context[1]is session.host,'actual_cache_context_tuple_required')
 stage='reconcile-and-archive-exact-partial-before'
 cache=session.cache;authority=cache.continuation_authority;sdk=session.host.read_host.primitives['sdk']
 partial_base=cache.BASE;archive_path=AUDIT/'partial-cache-before-archive'
 partial_capture=authority.BASE/'captures'/'cont5-baseline-20261026-2'
 with sdk.lock():
  prior_frame=partial_frame(partial_base)
  capture_frame=single_frame(partial_capture/'intent.json','9a1ea5c46a6d164f9c4edee50623673a550e63e166a334a518da3b422726e4ea',2722746,7035)
  need({p.name for p in partial_capture.iterdir()}=={'intent.json'},'exact_failed_capture2_intent_only_required')
  old_before=json.loads(protected(partial_base/'before.json',PARTIAL['before.json']['sha256']))
  rehearse_intent=json.loads(protected(partial_base/'rehearsal-intent.json',PARTIAL['rehearsal-intent.json']['sha256']))
  need(old_before['binding']['format']==cache.FORMAT and old_before['binding']['operatorSha256']==sha(protected(pathlib.Path(cache.__file__)))and
   old_before['binding']['config']==session.host.config and old_before['reviewHash']==sha(encoded(old_before['binding'])),
   'actual_owned_partial_before_config_provider_and_review_hash_required')
  need(rehearse_intent['format']==cache.FORMAT and rehearse_intent['reviewHash']==old_before['reviewHash']and
   rehearse_intent['bootId']==old_before['binding']['bootId']and rehearse_intent['databaseCommitAllowed']is False,
   'actual_same_partial_before_and_rollback_only_rehearsal_intent_required')
  processes=sql_processes(cache);need(not processes,'no_matching_live_SQLentry_process_before_reconciliation')
  prior,catalog=phase('whole-original-catalog-reconciliation',authority.original_catalog,cache.prior_cache,session.host)
  need(catalog['catalogSha256']==old_before['catalog']['catalogSha256']and
   session.host.read.acl_catalog(catalog['postProof']['catalog'])==session.host.read.acl_catalog(old_before['catalog']['postProof']['catalog'])and
   catalog['postProof']['allColumnAcl']==old_before['catalog']['postProof']['allColumnAcl']and
   old_before['binding']['retainedActualStop']==prior['binding']and
   rehearse_intent['retainedActualPriorAbortedSha256']==prior['bindingSha256'],
   'whole_current_original_catalog_all_column_ACLs_and_retained_stop_must_match_partial_before')
  need(session.host.query(authority.OWNER_SESSIONS_SQL)==[]and not sql_processes(cache),
   'actual_no_owned_APP_backend_or_matching_SQLentry_process_before_archive')
  need(partial_frame(partial_base)==prior_frame and single_frame(partial_capture/'intent.json',capture_frame['sha256'],2722746,7035)==capture_frame,
   'same_exact_partial_bytes_inodes_and_capture_intent_before_archive')
  proof_hashes['original-catalog-reconciliation']=write('original-catalog-reconciliation.private.json',{
   'catalog':catalog,'priorAborted':prior,'partialBeforeCatalogSha256':old_before['catalog']['catalogSha256'],
   'wholeCatalogQualified':True,'allColumnACLQualified':True,'ownedAPPBackendCount':0,'matchingSQLentryProcessCount':0})
  intent={'format':'root-CONT5-preSQL-archive-v1','source':str(partial_base),'destination':str(archive_path),
   'partialFrame':prior_frame,'capture2IntentFrame':capture_frame,'originalCatalogProofSha256':proof_hashes['original-catalog-reconciliation'],
   'acceptedBaselineClaimed':False,'oldFilesCopied':False,'oldFilesOverwritten':False,'newSQLDispatched':False}
  proof_hashes['archive-intent']=write('archive-intent.private.json',intent)
  need(partial_frame(partial_base)==prior_frame,'partial_files_changed_after_durable_archive_intent')
  archive_invoked=True;rename_noreplace(partial_base,archive_path);sync(partial_base.parent);sync(AUDIT)
  need(not os.path.lexists(partial_base)and partial_frame(archive_path)==prior_frame and
   single_frame(partial_capture/'intent.json',capture_frame['sha256'],2722746,7035)==capture_frame and
   session.host.query(authority.OWNER_SESSIONS_SQL)==[]and not sql_processes(cache),
   'actual_renamed_directory_and_file_bytes_inodes_preserved_no_SQL_after_archive')
  archive_ack={**intent,'archived':True,'sourceAbsent':True,'directoryAndFileInodesPreserved':True,
   'capture2IntentUnchanged':True,'sharedSDKLockHeldDuringReconciliationAndArchive':True,
   'genuineConstructWillAcquireOwnLockAfterThisLockReleases':True}
  proof_hashes['archive-result']=write('archive-result.private.json',archive_ack);archive_completed=True
 # Never nest original caller.construct_records' own SDK flock.
 need(archive_completed and not os.path.lexists(partial_base),'durable_archive_ACK_and_real_lock_release_before_original_construct_required')
 stage='baseline-construct-records'
 write('baseline-invocation-intent.private.json',{'captureId':CAPTURE,'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,
  'metadataRefs':refs,'cacheInputSha256':CACHE_INPUT_SHA,'archiveResultSha256':proof_hashes['archive-result'],
  'historicalSchedulingEvidenceSha256':proof_hashes['historical-scheduling-evidence'],'automaticRetryAllowed':False,'realCOMMITDispatched':False})
 sql_observation=BaselineSQLObservation(session.cache,session.cache.continuation_authority,diagnostic_module)
 with sql_observation:
  baseline_started=True
  baseline=phase('construct-records',caller.construct_records,session,CAPTURE)
 need(baseline['completed']is True and baseline['action']=='construct-records'and baseline['captureId']==CAPTURE and
  baseline['productionPreparedACKCreated']is baseline['productionCOMMITQualified']is baseline['newStopActionPerformed']is False and
  baseline['databaseWrites']==baseline['serviceActions']==baseline['providerCalls']==0 and
  type(baseline['actualNewRehearsalXID'])is str and re.fullmatch('[1-9][0-9]*',baseline['actualNewRehearsalXID'])and
  baseline['actualNewRehearsalXID']!='16540148'and all(pin(baseline[key])for key in
   ['sha256','beforeSha256','rehearsedSha256','authorizationSha256','priorAbortedSha256']),
  'actual_new_rollback_baseline_result_without_forward_effect_authority_required')
 receipt=session.cache.continuation_authority.BASE/'captures'/CAPTURE/'result.json'
 actual_baseline=json.loads(protected(receipt,baseline['sha256']))
 need(all(baseline[key]==value for key,value in actual_baseline.items()),'same_actual_baseline_audit_receipt_required')
 for name in ['sql-intent.json','sql-prepared.json','sql-committed.json','prepared.json','apply-sql-child.json','apply-sql-opened.json']:
  need(not os.path.lexists(session.cache.BASE/name),'no_apply_or_prepared_or_COMMIT_record_allowed_in_this_runner')
 new_before=json.loads(protected(cache.BASE/'before.json',baseline['beforeSha256']))
 need(new_before['binding']['prerequisites']['metadataCurrentProof']['currentNativeMetadataQualified']is True and
  new_before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']==session.metadata_epoch.binding()and
  baseline['fullSourcePostflight']['metadataEpoch']==session.metadata_epoch.binding()and
  baseline['fullSourcePostflight']['metadataActorCurrent']['currentActorQualified']is True and
  partial_frame(archive_path)==archive_ack['partialFrame'],
  'genuine_new_construct_full_current_metadata_source_postflight_and_preserved_archive_required')
 proof_hashes['baseline']=write('baseline-result.private.json',baseline);baseline_completed=True;current_qualified=True
 profile_summary=save_profile()
 need(profile_summary['baselineObservedSQLTransportCount']>=1,'actual_new_baseline_SQL_transport_observation_required')
 capture_summary={**capture_histories('success'),**profile_summary}
 stage='complete'
 result={'format':'root-CONT5-construct-only-baseline-v1','completed':True,'observedAt':now(),'stage':stage,
  'fullCurrentQualifiedByGenuineConstruct':True,'baselineCompleted':True,'baselineCaptureId':CAPTURE,
  'baselineReceiptSha256':baseline['sha256'],'beforeSha256':baseline['beforeSha256'],'rehearsedSha256':baseline['rehearsedSha256'],
  'authorizationSha256':baseline['authorizationSha256'],'actualNewRehearsalXID':baseline['actualNewRehearsalXID'],
  'priorAbortedSha256':baseline['priorAbortedSha256'],'archiveResultSha256':proof_hashes['archive-result'],
  'priorReadPreparationResultSha256':'ca9d5aca588c4d724cabc6025ef66adbff8227aa13f761baa003b11ea44bd9dc',
  'historicalSchedulingEvidenceOnly':True,'newCadenceObservationPerformed':False,'approvalLifetimeReset':False,
  'proofHashes':proof_hashes}
except BaseException as error:
 original_trace=traceback.format_exc().encode()
 try:profile_summary=save_profile()
 except BaseException:profile_summary={'profileSaveFailed':True}
 try:capture_summary={**capture_histories('failure',error),**profile_summary}
 except BaseException:
  proof_hashes['metadata-history-save-refusal']=write('metadata-history-save-refusal.private.txt',traceback.format_exc().encode())
 diagnostic=write('failure.private.txt',original_trace)
 result={'format':'root-CONT5-construct-only-baseline-v1','completed':False,'observedAt':now(),'stage':stage,
  'fullCurrentQualified':current_qualified,'cadenceAccepted':cadence_accepted,'baselineStarted':baseline_started,'baselineCompleted':baseline_completed,
  'sampleCount':len(samples),'privateDiagnosticSha256':diagnostic,
  'errorClass':type(error).__name__,'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained',
  'filesystemArchiveInvoked':archive_invoked,'filesystemArchiveCompleted':archive_completed,
  'outcomeReconciliationRequired':(baseline_started and not baseline_completed)or(archive_invoked and not archive_completed),'proofHashes':proof_hashes}
signal.alarm(0)
result.update(capture_summary)
result.update({'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefsSha256':sha(encoded(refs)),
 'elapsedNanoseconds':time.monotonic_ns()-started,'automaticRetryAllowed':False,'realCOMMITDispatched':False,'LOGINDispatched':False,
 'priorQualificationReconciliationSha256':'80f4bfc735defa3d36b6f57ce9a23fcd24c54a2a343e68e014935d153c62d125',
 'metadataCurrentProofProducerSha256':'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2',
 'historicalCONT4BaselineReusedAsCurrent':False,
 'maximumReadPreparationSeconds':1200,'maximumLocalSeconds':1220,'transactionApprovalLifetimeSeconds':90,'terminalReserveSeconds':5,
 'serviceActionsDispatched':0,'heldApplyDispatched':False,'heldQualificationPerformed':False,'providerRefreshRequested':False})
digest=write('result.json',result)
print(json.dumps({**result,'resultSha256':digest},sort_keys=True))
raise SystemExit(0 if result['completed']else 1)
'''


def actual_result(path,expected):
 before=path.lstat()
 if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_gid!=0 or before.st_nlink!=1 or before.st_mode&0o077 or before.st_size>16000000:
  raise RuntimeError('protected_actual_previous_root_result_required')
 raw=path.read_bytes();after=path.lstat()
 if len(raw)!=before.st_size or any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
  raise RuntimeError('same_actual_previous_root_result_bytes_required')
 value=json.loads(raw)
 if type(value)is not dict or value.get('resultSha256')!=expected:raise RuntimeError('actual_previous_root_result_SHA_required')
 value=dict(value);del value['resultSha256']
 if 'remoteAuditInspectionRequired'in value:
  if value['remoteAuditInspectionRequired']is not True:raise RuntimeError('only_known_true_local_transport_annotation_allowed')
  del value['remoteAuditInspectionRequired']
 canonical=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
 if hashlib.sha256(canonical).hexdigest()!=expected:raise RuntimeError('all_actual_previous_remote_result_content_required')
 return value

def exclusive(path,value):
    raw=(json.dumps(value,sort_keys=True)+'\n').encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:
        print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    started=time.monotonic();os.umask(0o077)
    if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_owned_result_path_required_no_retry')
    info=REFS.lstat()
    if not stat.S_ISREG(info.st_mode)or info.st_uid!=0 or info.st_gid!=0 or info.st_nlink!=1 or info.st_mode&0o077:
        raise SystemExit('protected_actual_metadata_refs_required')
    refs=json.loads(REFS.read_bytes())
    if refs!=EXPECTED_REFS:raise SystemExit('exact_actual_accepted_Owner3_refs_required')
    availability=actual_result(AVAILABILITY_RESULT,AVAILABILITY_SHA)
    remote=REMOTE.replace('ACTUAL_METADATA_REFS',repr(refs)).replace('ACTUAL_AVAILABILITY_RESULT',repr(availability))
    try:
        process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
            input=remote,capture_output=True,text=True,timeout=max(1,1220-(time.monotonic()-started)))
        try:
            result=json.loads(process.stdout)
            if type(result)is not dict or result.get('format')!='root-CONT5-construct-only-baseline-v1'or type(result.get('completed'))is not bool:
                raise ValueError('unexpected_root_result_envelope')
        except Exception:
            exclusive(Path('/tmp/yunipals-cont5-construct-only-baseline-unparsed-private-20261026-3.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result={'completed':False,'rootDriverTransportFailed':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
        if process.returncode!=0 or process.stderr:
            exclusive(Path('/tmp/yunipals-cont5-construct-only-baseline-transport-private-20261026-3.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result.update(completed=False,remoteAuditInspectionRequired=True)
    except subprocess.TimeoutExpired as error:
        exclusive(Path('/tmp/yunipals-cont5-construct-only-baseline-timeout-private-20261026-3.json'),
            {'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
             'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
        result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
    exclusive(RESULT,result);print(json.dumps(result,sort_keys=True))
    raise SystemExit(0 if result.get('completed')is True else 1)


if __name__=='__main__':main()
