#!/usr/bin/env python3
"""Explicit Reader5 before-LOGIN timing capture after an actual cache COMMIT.

Default/import are inert. Root owns any later --run dispatch. This program only
renders actual receipt refs, constructs one fresh forward reader context and
calls the genuine read-only reader callback qualifier once. It cannot dispatch
LOGIN, publication, cache COMMIT, reader/service changes or inverse actions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

COMMIT_RESULT=Path('/tmp/yunipals-cont5-cache-commit-production-20261026-1.json')
METADATA_REFS=Path('/tmp/yunipals-actual-metadata-epoch-v3-refs-20261025.json')
RESULT=Path('/tmp/yunipals-cont5-reader-qualification-production-20261026-1.json')
EXPECTED_REFS={
 'mode':'current','resultSha256':'18da893e8e39725b125e9a2eeb89ffc8b5d1b7e7e7f9674364d6b265b6c6d343',
 'inputSha256':'544104d077f24443b7e1920116d80cec62987d3aa5f58fd12a602e782c2e30ca',
 'producerSha256':'62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1',
 'manifestSha256':'464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e'}

REMOTE=r'''import datetime,hashlib,json,os,pathlib,re,signal,socket,stat,subprocess,time,traceback,types
os.umask(0o077)
commit_local=ACTUAL_COMMIT_RESULT
refs=ACTUAL_METADATA_REFS
OPS=pathlib.Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-reader-qualification-20261026-1')
COMMIT_AUDIT=pathlib.Path('/var/backups/yunipals-root-cont5-cache-commit-20261026-1')
CACHE_BASE=pathlib.Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v5-20261026')
CALLER=OPS/'ypal-ordinary-publication-continue-v5.py'
CALLER_SHA='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'
READER=OPS/'ypal-ordinary-reader-continue-v5.py'
READER_SHA='c108f1c9c10e9838b05309be28d34afbbb64c369bfe83d5641dc9d09b6762241'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v5.manifest.json'
MANIFEST_SHA='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405'
RENDERER=OPS/'ypal-ordinary-publication-continue-inputs-v5.py'
RENDERER_SHA='e3d950765b1177d2c4dc7e6787a4e08c8852dce676ff722c397a27f6ff205cf1'
PROVIDER_SHA='30ee6c1935822dc2a000ea9aa874117b3e7f5cd8dee1e2d180f6a5206f85b326'
CACHE_INPUT_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
REPORT=pathlib.Path('/var/backups/yunipals-root-publication-accept-v2-input-20261025/render/stdout.private')
REPORT_SHA='1269111486501d63172621f771e7f038d2505badf7c46cf726a2eaf3b066a8d4'
CAPTURE='cont5-reader-before-login-20261026-1'
INPUT_KEYS={'sourceManifestSha256','readPlanSha256','readContextInputSha256','cacheInputsSha256','cachePreparedSha256',
 'sustainedObserverSha256','transportQualificationSha256','publisherInstallSha256','mainInstallSha256','parityWitnessSha256'}
started=time.monotonic_ns();stage='initial';session=None;qualifier_invoked=False;qualification_ref=None;proof_hashes={};phase_events=[]
command_trace=None;original_run=subprocess.run;observations={}

def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
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
  row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_actual_reader_qualification_input_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
  all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or sha(raw)==digest),'same_actual_reader_qualification_input_bytes_required')
 return raw
def document(path,digest=None):return json.loads(protected(path,digest))
def load(path,digest):
 raw=protected(path,digest);value=types.ModuleType('reader_qualification_'+path.stem.replace('-','_'));value.__file__=str(path)
 exec(compile(raw,str(path),'exec'),value.__dict__);return value
def frame(path,digest):
 raw=protected(path,digest);row=path.lstat()
 return{'sha256':sha(raw),**{key:getattr(row,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']}}
def phase(label,fn,*args):
 began=time.monotonic_ns();returned=False
 try:value=fn(*args);returned=True;return value
 finally:phase_events.append({'label':label,'elapsedNanoseconds':time.monotonic_ns()-began,'returned':returned,'repeated':False})
def deadline(_signum,_frame):raise RuntimeError('root_reader_qualification_read_preparation_deadline_inspect_no_retry')

def authenticate_commit():
 root=document(COMMIT_AUDIT/'result.json',commit_local['resultSha256'])
 need(encoded(commit_local)==encoded({**root,'resultSha256':sha(protected(COMMIT_AUDIT/'result.json'))})and
  root['format']=='root-CONT5-cache-commit-v1'and root['completed']is True and root['callerSha256']==CALLER_SHA and
  root['readerManifestSha256']==MANIFEST_SHA and root['metadataRefsSha256']==sha(encoded(refs))and
  root['commitReturned']is root['preparedACKCreatedByGenuineCommit']is root['fullSourcePostflightQualified']is True and
  root['realCOMMITInvoked']is True and root['transactionStatus']=='committed'and
  type(root['transactionId'])is str and re.fullmatch('[1-9][0-9]*',root['transactionId'])and root['additionalReadCount']==4 and
  root['coordinatedPublicationAndReaderSwitchStillRequired']is True and
  all(root[key]is False for key in['automaticRetryAllowed','nativeWorkerStarted','nativeGenerationPublished','LOGINDispatched',
   'providerRefreshRequested','baselineDispatched','qualificationDispatched','secondPrepareACKDispatched'])and root['serviceActionsDispatched']==0,
  'actual_successful_cache_COMMIT_not_baseline_qualification_or_unknown_result_required')
 fixed={'baseline-root-result':'authenticated-baseline-root-result.private.json',
  'authenticated-baseline-metadata-histories':'authenticated-baseline-metadata-histories.private.json',
  'authenticated-prerequisites':'authenticated-CONT5_baseline-proof-hashes.private.json',
  'historical-scheduling-lineage':'authenticated-historical-scheduling-lineage.private.json',
  'held-root-result':'authenticated-held-root-result.private.json','held-qualification':'authenticated-qualified-receipt.private.json',
  'held-audits':'authenticated-six-held-audits.private.json','held-metadata-histories':'authenticated-held-metadata-histories.private.json',
  'new-source-preflight':'new-source-preflight.private.json','new-full-current-prerequisites':'new-full-current-prerequisites.private.json',
  'actual-prior-aborted':'actual-prior-aborted.private.json','source-current-before-commit':'source-current-before-commit.private.json',
  'prepared-ACK':'prepared-ACK-value.private.json','sql-committed':'sql-committed-value.private.json',
  'caller-attempt':'caller-attempt-value.private.json','actual-fresh-approval-gate':'actual-fresh-approval-gate.private.json'}
 need(set(root['proofHashes'])==set(fixed)and all(pin(v)for v in root['proofHashes'].values()),'all_actual_cache_COMMIT_private_proof_hashes_required')
 proofs={label:document(COMMIT_AUDIT/name,root['proofHashes'][label])for label,name in fixed.items()}
 prepared=document(CACHE_BASE/'prepared.json',root['preparedFileSha256'])
 committed=document(CACHE_BASE/'sql-committed.json',root['sqlCommittedFileSha256'])
 need(prepared==proofs['prepared-ACK']and committed==proofs['sql-committed']and
  prepared['format']=='yunipals-ypal-ordinary-read-cache-continue-v5'and prepared['prepared']is True and
  prepared['operatorSha256']==committed['operatorSha256']==PROVIDER_SHA and
  prepared['additionalReadCount']==4 and prepared['additionalReadAcknowledgementSha256']==root['sqlCommittedFileSha256']and
  prepared['nativeWorkerStarted']is prepared['nativeGenerationPublished']is prepared['original143WholeValidatorPassed']is False and
  prepared['legacy103ServingAccepted']is prepared['cacheBootDisabled']is prepared['coordinatedPublicationAndReaderSwitchStillRequired']is True and
  committed['mode']=='apply'and committed['xid']==root['transactionId']and committed['acknowledged']is True and
  committed['reconciledAfterUnknownAck']is False and prepared['reviewHash']==committed['reviewHash'],
  'actual_prepared_ACK_and_committed_four_READ_file_chain_required')
 before=document(CACHE_BASE/'before.json',prepared['beforeSha256'])
 metadata=before['binding']['prerequisites']['metadataCurrentProof']['metadataEpoch']
 attempt=proofs['caller-attempt']
 need(before['binding']['operatorSha256']==PROVIDER_SHA and before['binding']['config']==prepared['config']and
  metadata['refs']==refs and attempt['format']=='yunipals-ypal-ordinary-publication-continue-v5'and
  attempt['completed']is True and attempt['action']=='commit'and attempt['businessResultPresent']is True and
  attempt['automaticEffectRetryAllowed']is False and attempt['postflight']['validated']is True and
  attempt['postflight']['metadataEpoch']==metadata and attempt['postflight']['metadataActorCurrent']['currentActorQualified']is True,
  'actual_committed_reader5_input_metadata_epoch_and_full_source_postflight_required')
 return root,prepared,metadata

def save_observations(outcome,error=None):
 subprocess.run=original_run
 result={}
 if command_trace is not None:
  value={'diagnosticSourceSha256':'2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465',
   'calls':command_trace.calls,'failures':command_trace.failures,'subprocessRunRestored':subprocess.run is original_run,
   'argumentsEnvironmentTimeoutAndOriginalResultsChanged':False,'automaticRetryAllowed':False,'SQLTransportWrapperInstalled':False}
  result.update({'currentSubprocessDiagnosticSha256':write('current-subprocess-diagnostic.private.json',value),
   'currentSubprocessCommandCount':len(command_trace.calls),'currentSubprocessFailureCount':len(command_trace.failures),
   'currentSubprocessRunRestored':subprocess.run is original_run})
 state=vars(session)if session is not None else{};context=state.get('context');cache=vars(context).get('cache')if context is not None else None
 epochs=[]
 for label,epoch in [('sessionEpoch',state.get('metadata_epoch')),('readerCacheEpoch',vars(cache).get('metadata_epoch')if cache is not None else None)]:
  if epoch is not None:
   row=vars(epoch);epochs.append({'label':label,'history':row.get('current_capture_history',()),
    'lastAttempts':row.get('current_capture_attempts',()),'stableBindingSha256':sha(encoded(epoch.binding()))})
 history={'format':'root-CONT5-reader-metadata-capture-history-v1','outcome':outcome,'epochs':epochs,
  'scope':'retained-session-and-reader-context-Epochs-only',
  'exceptionCapture':{'history':getattr(error,'metadata_current_capture_history',()),'lastAttempts':getattr(error,'metadata_current_capture_attempts',())}if error is not None else None,
  'readOnlyMemorySnapshot':True,'currentObservationsPerformed':0,'stableBindingMutated':False,'timingKeyMutated':False,'approvalClockReset':False}
 result['metadataCaptureHistorySha256']=write('metadata-capture-histories-'+outcome+'.private.json',history)
 result['metadataEpochInstanceCount']=len(epochs);result['phaseObservationSha256']=write('phase-durations.private.json',phase_events)
 return result

need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_actual_root_reader_qualification_host_required')
need(not os.path.lexists(AUDIT),'fresh_root_reader_qualification_audit_required_no_retry')
AUDIT.mkdir(mode=0o700);sync(AUDIT.parent)
signal.signal(signal.SIGALRM,deadline);signal.alarm(1200)
try:
 stage='authenticate-actual-cache-COMMIT'
 commit,prepared,metadata_binding=authenticate_commit()
 proof_hashes['actual-cache-commit']=write('authenticated-cache-commit.private.json',commit)
 report=document(REPORT,REPORT_SHA)
 need(report['generationId']=='105'and report['cacheInputsSha256']==CACHE_INPUT_SHA and
  report['candidateSha256']==prepared['config']['generationSha256']and report['cacheInput']==prepared['config'],
  'actual_generation105_protected_report_and_cache_config_required')
 manifest=document(MANIFEST,MANIFEST_SHA)
 need(manifest['format']=='yunipals-ypal-ordinary-reader-continue-v5-source'and
  manifest['files'][READER.name]==READER_SHA and manifest['contexts']['phase']=={'file':'ypal-ordinary-read-cache-continue-v5.py','sha256':PROVIDER_SHA},
  'actual_reader5_manifest_and_committed_provider_required')
 for name,digest in{**manifest['dependencies'],**manifest['files']}.items():
  need(type(name)is str and name not in{'','.','..'}and '/'not in name and '\\'not in name and pin(digest),'finite_actual_reader5_source_basename_required')
  protected(OPS/name,digest)
 renderer=load(RENDERER,RENDERER_SHA);caller=load(CALLER,CALLER_SHA)
 stage='render-actual-private-reader-inputs'
 rendered=phase('render-reader-inputs',renderer.reader_inputs,commit['preparedFileSha256'],MANIFEST_SHA)
 inputs=rendered['readerInputs']
 need(rendered['immutableFileLineageOnly']is True and rendered['currentReadinessQualified']is rendered['metadataActorCurrentQualified']is False and
  rendered['metadataRefs']==refs and rendered['inputWrites']==rendered['databaseWrites']==rendered['serviceActions']==rendered['providerCalls']==0 and
  type(inputs)is dict and set(inputs)==INPUT_KEYS and all(pin(value)for value in inputs.values())and
  inputs['sourceManifestSha256']==MANIFEST_SHA and inputs['cachePreparedSha256']==commit['preparedFileSha256']and
  inputs['cacheInputsSha256']==CACHE_INPUT_SHA and all(inputs[key]==prepared['config'][key]for key in['readPlanSha256','readContextInputSha256']),
  'exact_ten_recorded_reader5_refs_after_actual_prepared_ACK_required')
 proof_hashes['rendered-reader-inputs']=write('rendered-reader-inputs.private.json',rendered)
 proof_hashes['reader-inputs']=write('reader-inputs.private.json',inputs)
 tracked={str(path):frame(path,digest)for path,digest in[(COMMIT_AUDIT/'result.json',commit_local['resultSha256']),
  (CACHE_BASE/'prepared.json',commit['preparedFileSha256']),(CACHE_BASE/'sql-committed.json',commit['sqlCommittedFileSha256'])]}
 diagnostic=load(OPS/'ypal-ordinary-metadata-capture-diagnostic-v1.py','2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465')
 command_trace=diagnostic.SubprocessDiagnostics(original_run,lambda name,raw:write('current-'+name,raw))
 need(subprocess.run is original_run,'original_run_before_reader_observation_required');subprocess.run=command_trace
 stage='fresh-forward-reader-Session'
 session=phase('session-constructor',caller.Session,report['sourceRefs'],MANIFEST_SHA,refs)
 proof_hashes['source-preflight']=write('source-preflight.private.json',phase('session-preflight',session.preflight))
 stage='fresh-reader-context'
 context=phase('reader-context',session.reader_context,MANIFEST_SHA,json.loads(encoded(inputs)))
 need(type(context)is tuple and len(context)==3 and context==(session.root,session.proof,session.context),
  'actual_fresh_reader_context_tuple_required')
 root,proof,current=context
 need(session.source.inverse is False and session.key['target']=='reader'and session.key['direction']=='forward'and
  session.key['manifestSha256']==MANIFEST_SHA and session.key['inputsSha256']==sha(encoded(inputs))and
  session.metadata_epoch.binding()==current.cache.metadata_epoch.binding()==metadata_binding and current.prepared==prepared and
  not os.path.lexists(root.BASE)and current.logins_enabled()is False,
  'fresh_forward_original_reader_private_epoch_before_any_owned_LOGIN_or_publication_required')
 proof_hashes['context']=write('context.private.json',{'readerInputsSha256':sha(encoded(inputs)),'readerManifestSha256':MANIFEST_SHA,
  'metadataRefs':refs,'metadataEpoch':metadata_binding,'context':session.key,'cachePreparedSha256':commit['preparedFileSha256'],
  'readerBASEAbsent':True,'readerLOGINsEnabled':False,'inverse':False,'automaticRetryAllowed':False})
 stage='qualify-original-before-LOGIN-callback-once'
 write('qualification-invocation-intent.private.json',{'captureId':CAPTURE,'commitRootResultSha256':commit_local['resultSha256'],
  'readerInputsSha256':sha(encoded(inputs)),'readerManifestSha256':MANIFEST_SHA,'callerSha256':CALLER_SHA,
  'mode':'reader-before-login','automaticRetryAllowed':False,'LOGINPermitted':False,'publicationPermitted':False,'serviceActionsPermitted':False})
 qualifier_invoked=True
 measured=phase('qualify-reader',caller.qualify_reader,session,CAPTURE)
 need(measured['completed']is True and measured['productionCOMMITQualified']is False and measured['captureId']==CAPTURE and pin(measured['sha256']),
  'actual_genuine_reader_timing_return_required')
 qualification_ref={'captureId':CAPTURE,'sha256':measured['sha256']}
 receipt=session.continuation_caller.require_timing(session,qualification_ref,'reader-before-login')
 need(receipt==document(session.continuation_caller.BASE/'captures'/CAPTURE/'result.json',qualification_ref['sha256'])and
  receipt['syntheticTimingInputOnly']is True and receipt['productionCOMMITQualified']is False and
  receipt['reservedEffectNanoseconds']==70_000_000_000 and receipt['elapsedNanoseconds']+receipt['reservedEffectNanoseconds']<240_000_000_000 and
  receipt['observation']=={'allOriginalPrepublicationPredicates':True,'twoLOGINCurrentlyEnabled':False,'ownedBootAndReloadEffectsNotExecuted':True}and
  receipt['fullPostflight']['validated']is True and receipt['fullPostflight']['metadataEpoch']==metadata_binding and
  receipt['fullPostflight']['metadataActorCurrent']['currentActorQualified']is True and
  receipt['databaseWrites']==receipt['serviceActions']==receipt['providerCalls']==0 and
  not os.path.lexists(root.BASE)and current.logins_enabled()is False,
  'actual_complete_before_LOGIN_measurement_full_postflight_and_original_240_including70_contract_required')
 need({path:frame(path,row['sha256'])for path,row in tracked.items()}==tracked,'actual_cache_COMMIT_and_prepared_files_unchanged_around_reader_qualification')
 proof_hashes['reader-timing']=write('reader-timing.private.json',receipt)
 observations=save_observations('success')
 result={'format':'root-CONT5-reader-qualification-v1','completed':True,'stage':'complete','readerQualification':qualification_ref,
  'readerInputsSha256':sha(encoded(inputs)),'privateReaderInputsFile':str(AUDIT/'reader-inputs.private.json'),
  'elapsedCallbackNanoseconds':receipt['elapsedNanoseconds'],'reservedEffectNanoseconds':receipt['reservedEffectNanoseconds'],
  'idleWindowNanoseconds':240_000_000_000,'fullSourcePostflightQualified':True,'mode':'reader-before-login'}
except BaseException as error:
 original_trace=traceback.format_exc().encode()
 try:observations=save_observations('failure',error)
 except BaseException:observations={'diagnosticSaveRefused':True}
 result={'format':'root-CONT5-reader-qualification-v1','completed':False,'stage':stage,'qualifierInvoked':qualifier_invoked,
  'readerQualification':qualification_ref,'qualificationCaptureInspectionRequired':qualifier_invoked,
  'privateDiagnosticSha256':write('failure.private.txt',original_trace),'errorClass':type(error).__name__,
  'failureCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else'private_diagnostics_retained'}
signal.alarm(0)
result.update(observations)
result.update({'commitRootResultSha256':commit_local['resultSha256'],'callerSha256':CALLER_SHA,'readerSha256':READER_SHA,
 'readerManifestSha256':MANIFEST_SHA,'metadataRefsSha256':sha(encoded(refs)),'captureId':CAPTURE,
 'elapsedNanoseconds':time.monotonic_ns()-started,'automaticRetryAllowed':False,'readerTimingQualificationOnly':True,
 'productionCOMMITQualified':False,'transactionRollbackQualified':False,'LOGINDispatched':False,'publicationDispatched':False,
 'cacheCOMMITDispatched':False,'baselineDispatched':False,'heldQualificationDispatched':False,'inverseDispatched':False,
 'serviceActionsDispatched':0,'providerRefreshRequested':False})
digest=write('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True))
raise SystemExit(0 if result['completed']else 1)
'''

def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def read_private(path):
 before=path.lstat()
 if not stat.S_ISREG(before.st_mode)or before.st_uid!=before.st_gid or before.st_uid!=0 or before.st_nlink!=1 or before.st_mode&0o077 or not 0<before.st_size<=16000000:
  raise RuntimeError('actual_private_reader_qualification_input_required')
 raw=path.read_bytes();after=path.lstat()
 if len(raw)!=before.st_size or any(getattr(before,key)!=getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']):
  raise RuntimeError('same_private_reader_qualification_input_required')
 return json.loads(raw)
def successful_commit(path):
 value=read_private(path)
 if type(value)is not dict or value.get('completed')is not True or value.get('format')!='root-CONT5-cache-commit-v1':
  raise RuntimeError('actual_successful_cache_COMMIT_result_required_before_SSH')
 digest=value.get('resultSha256')
 if type(digest)is not str or len(digest)!=64 or any(c not in'0123456789abcdef'for c in digest)or \
  hashlib.sha256(encoded({k:v for k,v in value.items()if k!='resultSha256'})).hexdigest()!=digest:
  raise RuntimeError('actual_complete_canonical_cache_COMMIT_result_required_before_SSH')
 if value.get('transactionStatus')!='committed'or value.get('preparedACKCreatedByGenuineCommit')is not True or \
  value.get('fullSourcePostflightQualified')is not True or value.get('callerSha256')!='a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a'or \
  value.get('readerManifestSha256')!='455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405':
  raise RuntimeError('actual_reader5_committed_prepared_ACK_chain_required_before_SSH')
 return value
def exclusive(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(encoded(value));stream.flush();os.fsync(stream.fileno())
 directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',action='store_true');args=parser.parse_args()
 if not args.run:print(json.dumps({'staticOnly':True,'SSHExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
 started=time.monotonic();os.umask(0o077)
 if os.geteuid()!=0 or os.path.lexists(RESULT):raise SystemExit('fresh_root_reader_qualification_result_required_no_retry')
 commit=successful_commit(COMMIT_RESULT);refs=read_private(METADATA_REFS)
 if refs!=EXPECTED_REFS:raise RuntimeError('actual_accepted_metadata_epoch_refs_required_before_SSH')
 remote=REMOTE.replace('ACTUAL_COMMIT_RESULT',repr(commit)).replace('ACTUAL_METADATA_REFS',repr(refs))
 try:
  remaining=1220-(time.monotonic()-started)
  if remaining<=0:raise RuntimeError('root_reader_read_preparation_budget_expired_before_SSH')
  process=subprocess.run(['ssh','-oBatchMode=yes','-oConnectTimeout=10','-oStrictHostKeyChecking=yes',
   '-oUserKnownHostsFile=/tmp/yunipals-production-known-hosts','root@168.119.172.10','python3 -I -B -'],input=remote,capture_output=True,text=True,timeout=remaining)
  try:
   result=json.loads(process.stdout)
   if type(result)is not dict or result.get('format')!='root-CONT5-reader-qualification-v1'or type(result.get('completed'))is not bool:raise ValueError('actual_reader_qualification_result_object_required')
  except Exception:result={'completed':False,'rootDriverTransportFailed':True};invalid=True
  else:invalid=False
  if invalid or process.returncode!=0 or process.stderr:
   exclusive(Path('/tmp/yunipals-cont5-reader-qualification-transport-private-20261026-1.json'),{'stdout':process.stdout,'stderr':process.stderr,'exitCode':process.returncode})
   result.update(completed=False,remoteAuditInspectionRequired=True,automaticRetryAllowed=False)
 except subprocess.TimeoutExpired as error:
  exclusive(Path('/tmp/yunipals-cont5-reader-qualification-timeout-private-20261026-1.json'),
   {'stdout':error.stdout.decode(errors='replace')if isinstance(error.stdout,bytes)else error.stdout,'stderr':error.stderr.decode(errors='replace')if isinstance(error.stderr,bytes)else error.stderr})
  result={'completed':False,'rootDriverTimedOut':True,'remoteAuditInspectionRequired':True,'automaticRetryAllowed':False}
 exclusive(RESULT,result);print(json.dumps(result,sort_keys=True))
 raise SystemExit(0 if result.get('completed')is True else 1)

if __name__=='__main__':main()
