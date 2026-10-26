#!/usr/bin/env python3
"""Explicit root-held rollback qualification, gated by actual CONT5 current/cadence/baseline success.

Import/default are inert. Root must review this source before --run. This
runner has no real COMMIT, LOGIN, refresh or service-action dispatcher.
This source preserves all earlier unexecuted held drivers and owns a fresh
held4 namespace. It accepts only the actual construct-only3 baseline and archive.
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
RESULT=Path('/tmp/yunipals-cont5-held-rollback-qualification-production-20261026-4.json')
EXPECTED_REFS={
    'mode':'current',
    'resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
    'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
    'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
    'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'
}

REMOTE=r'''import datetime,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,traceback,types,time
os.umask(0o077)
baseline_local=ACTUAL_CONSTRUCT_BASELINE_RESULT
refs=ACTUAL_METADATA_REFS
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-held-rollback-qualification-20261026-4')
BASELINE_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-construct-only-baseline-20261026-3')
BASELINE_CAPTURE='cont5-baseline-20261026-3'
CAPTURE='cont5-held-rollback-20261026-4'
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
started=time.monotonic_ns();stage='initial';qualifier_started=False;qualifier_returned=False;qualification_ref=None;proof_hashes={};session=None;capture_summary={};profiler=None;sql_observation=None;phase_events=[];command_trace=None;original_subprocess_run=subprocess.run

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
 global profiler
 subprocess.run=original_subprocess_run
 if profiler is not None and profiler.installed:profiler.__exit__(None,None,None)
 summary={}
 if command_trace is not None:
  value={'diagnosticSourceSha256':'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
   'calls':command_trace.calls,'failures':command_trace.failures,'subprocessRunRestored':subprocess.run is original_subprocess_run,
   'argumentsEnvironmentTimeoutAndOriginalResultsChanged':False,'automaticRetryAllowed':False}
  digest=write('current-subprocess-diagnostic.private.json',value)
  summary.update({'currentSubprocessDiagnosticSha256':digest,'currentSubprocessCommandCount':len(command_trace.calls),
   'currentSubprocessFailureCount':len(command_trace.failures),'currentSubprocessRunRestored':subprocess.run is original_subprocess_run})
 if sql_observation is not None:
  diagnostic=sql_observation.snapshot();digest=write('qualification-diagnostic.private.json',diagnostic)
  summary.update({'qualificationDiagnosticSha256':digest,'caughtInnerErrorObserved':diagnostic['caughtError']['caughtInnerErrorObserved'],
   'observedSQLTransportCount':len(diagnostic['transports']),'privateSQLStderrBytes':sum(row['capturedBytes']for row in diagnostic['transports'])})
 if profiler is None:return summary
 value={**profiler.snapshot(),'rootPhaseEvents':phase_events}
 digest=write('call-profile.private.json',value)
 return{**summary,'privateCallProfileSha256':digest,'profiledCallCount':len(value['events']),
  'profiledCallsDropped':value['droppedCalls'],'profileObservationErrors':value['observationErrors']}
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

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_host_required')
need(not os.path.lexists(AUDIT),'fresh_exclusive_root_held_audit_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(880)
try:
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
 profile_module=load(OPS/'ypal-ordinary-call-profile-v1.py','5b3aa246bf10e6e69c70d01ed4742d1817d86a0e9095f243428b4c8e9c901d8a')
 profile_files={str(OPS/name):digest for name,digest in{**source_manifest['dependencies'],**source_manifest['files']}.items()if name.endswith('.py')}
 profile_files[str(CALLER)]=CALLER_SHA
 profiler=profile_module.CallProfile(profile_files,{
  '__init__','current','metadata','refresh','publication_proof','sessions','query','actor','private','inputs','read_operation',
  'prerequisites','invoke','prepared','sql_child','_sql_child','qualified_sql_child','before_literal_ack','fresh_approval',
  'approval_snapshot','original_catalog','stopped','_construct_records','construct_records','_qualify_held','qualify_held',
  'finish','preflight','capture_current','actor_current','accepted_actor','kernel_backends','current_kernel'})
 diagnostic_module=load(OPS/'ypal-ordinary-held-diagnostic-v1.py','7bf19a75010694cf63be776cff4a3db111515eb0442a8568c9c49e883b2df61a')
 current_diagnostic=load(OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py','2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465')
 owner=load(OWNER,refs['producerSha256']);caller=load(CALLER,CALLER_SHA)
 report=document(REPORT,REPORT_SHA)
 need(report['cacheInputsSha256']==CACHE_INPUT_SHA,'same_actual_original_cache_input_required')
 ack=owner.acknowledgement(refs['resultSha256'],refs['inputSha256'])
 need(ack==proofs['metadata-ack']and ack['immutableAcknowledgementOnly']is True,'same_actual_accepted_Owner3_ACK_as_CONT5_baseline_required')
 stage='full-live-preflight'
 command_trace=current_diagnostic.SubprocessDiagnostics(original_subprocess_run,save_current_failure)
 need(subprocess.run is original_subprocess_run,'original_run_before_held_current_observation_required')
 subprocess.run=command_trace
 profiler.__enter__()
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
 stage='qualify-held-rollback-only'
 write('qualification-invocation-intent.private.json',{'captureId':CAPTURE,'baselineCaptureId':BASELINE_CAPTURE,
  'rootDriverVariant':'held4-construct-only3-baseline','supersededUnexecutedDriverSha256':'ffddee6679680466a823340fcd822858f2762b0d94ad5d538c6903f6ccf6ca3e',
  'baselineRootResultSha256':baseline_local['resultSha256'],'baselineReceiptSha256':baseline['sha256'],
  'callerSha256':CALLER_SHA,'readerManifestSha256':MANIFEST_SHA,'metadataRefs':refs,
  'automaticRetryAllowed':False,'realCOMMITPermitted':False,'LOGINPermitted':False,'serviceActionsPermitted':False})
 original_raw=cache._sql_child
 sql_observation=diagnostic_module.ObservedQualification(cache,authority)
 with sql_observation:
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
 proof_hashes['authenticated-held-qualification']=write('authenticated-held-qualification.private.json',qualified)
 observation_summary=save_observations()
 capture_summary={**capture_histories('success'),**observation_summary}
 stage='complete'
 result={'format':'root-CONT5-held-rollback-qualification-v2','completed':True,'observedAt':now(),'stage':stage,
  'baselineRootResultSha256':baseline_local['resultSha256'],'baselineReceiptSha256':baseline['sha256'],
  'heldQualification':qualification_ref,'transactionId':qualified['transactionId'],'transactionStatus':'aborted',
  'completeHeldCallback':True,'childGone':True,'backendGone':True,'catalogRestored':True,'transactionalCatalogMutationsRolledBack':True,
  'elapsedHeldNanoseconds':qualified['elapsedNanoseconds'],'reserveNanoseconds':qualified['reserveNanoseconds'],
  'approvalRemainingAtLaunchNanoseconds':qualified['approvalGate']['remainingNanoseconds'],
  'actualPreparedPacketSha256':qualified['actualPreparedPacketSha256'],'auditFileHashes':qualified['auditFiles'],'proofHashes':proof_hashes}
except BaseException as error:
 original_trace=traceback.format_exc().encode()
 try:observation_summary=save_observations()
 except BaseException:observation_summary={'observationSaveFailed':True}
 try:capture_summary={**capture_histories('failure',error),**observation_summary}
 except BaseException:
  proof_hashes['metadata-history-save-refusal']=write('metadata-history-save-refusal.private.txt',traceback.format_exc().encode())
 diagnostic=write('failure.private.txt',original_trace)
 result={'format':'root-CONT5-held-rollback-qualification-v2','completed':False,'observedAt':now(),'stage':stage,
  'qualifierInvoked':qualifier_started,'qualifierReturned':qualifier_returned,'heldQualification':qualification_ref,
  'transactionOutcomeQualified':False,'outcomeReconciliationRequired':qualifier_started,
  'privateDiagnosticSha256':diagnostic,'errorClass':type(error).__name__,
  'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained',
  'proofHashes':proof_hashes}
signal.alarm(0)
result.update(capture_summary)
result.update({'rootDriverVariant':'held4-construct-only3-baseline','supersededUnexecutedDriverSha256':'ffddee6679680466a823340fcd822858f2762b0d94ad5d538c6903f6ccf6ca3e',
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


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:
        print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
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
    remote=REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(baseline)).replace('ACTUAL_METADATA_REFS',repr(refs))
    try:
        remaining=900-(time.monotonic()-started)
        if remaining<=0:raise RuntimeError('root_qualification_total_budget_expired_before_SSH')
        process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],
            input=remote,capture_output=True,text=True,timeout=remaining)
        try:
            result=json.loads(process.stdout)
            if type(result)is not dict or result.get('format')!='root-CONT5-held-rollback-qualification-v2'or type(result.get('completed'))is not bool:
                raise ValueError('unexpected_root_result_envelope')
        except Exception:
            exclusive(Path('/tmp/yunipals-cont5-held-rollback-qualification-unparsed-private-20261026-4.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result={'completed':False,'rootDriverTransportFailed':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False,'outcomeReconciliationRequired':True}
        if process.returncode!=0 or process.stderr:
            exclusive(Path('/tmp/yunipals-cont5-held-rollback-qualification-transport-private-20261026-4.json'),
                {'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
            result.update(completed=False,remoteAuditInspectionRequired=True)
    except subprocess.TimeoutExpired as error:
        exclusive(Path('/tmp/yunipals-cont5-held-rollback-qualification-timeout-private-20261026-4.json'),
            {'stdout':(error.stdout or b'').decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,
             'stderr':(error.stderr or b'').decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
        result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
    exclusive(RESULT,result);print(json.dumps(result,sort_keys=True))
    raise SystemExit(0 if result.get('completed')is True else 1)


if __name__=='__main__':main()
