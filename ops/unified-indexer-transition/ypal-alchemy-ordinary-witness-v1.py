#!/usr/bin/env python3
"""Fresh unchanged fixed-boundary witness with explicit ordinary runtime fences.

Writes only new protected evidence. Never starts a worker or changes status,
roles, policies, selectors, budgets, schemas or source/runtime configuration.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import types
import urllib.request

FORMAT='yunipals-ypal-alchemy-ordinary-witness-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-fixed-boundary-witness-v1-20261024')
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
OBSERVER=OPS/'ypal-alchemy-ordinary-observer-v1.py'
OBSERVER_SHA='2a84e16a31df3d5266d0ff3992753d01c6849b3755d173a6e29f2f1cdeebab93'
OBSERVER_ACK='81c899831cf5f1fab1c5acd86448d6b44b11189b5db88e47c4fe579e85e0c088'
WITNESS=OPS/'fixed-boundary-witness-v3.mjs'
PROGRAMS={'fixed-boundary-witness-v3.mjs':'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c',
 'ownership-parity-peer-v4.mjs':'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e',
 'ownership-parity-peer-v2.mjs':'d1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920'}
NODE=Path('/opt/node-v24.18.1/bin/node')
NODE_SHA='f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
LOADER_ROOT=Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')
LOADER=LOADER_ROOT/'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs'
LOADER_SHA='17e2a92c5f1f70065b01c65d5ee9ac260839d4fc0ea78fdbb4db7b1155ccd32f'
PARITY=Path('/var/backups/yunipals-ypal-ownership-parity-v1-20261024/parity.json')
PARITY_SHA='b04ff03dadbc8fa8f167fdec862b071ee4dc6e89268bed84a5260c77c2290aa4'
OLD_FAILED=Path('/var/backups/yunipals-ypal-fixed-boundary-witness-v3-20261024/result.json')
OLD_FAILED_SHA='fc461eb69c2f4252c0a42b2812ee0dd7c1bede1cceb95187715b50a9004b39a4'
SENTINEL='/run/yunipals-ordinary-witness-no-password-file'
MAX_CONTEXT_GETS=512


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def own_sha():return sha(Path(__file__).read_bytes())
def pin(v):
    need(isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64,'actual_ordinary_witness_hash_required');return v

def protected(path,expected=None,limit=4000000):
    path=Path(path)
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_ordinary_witness_input_required')
    before=path.lstat();identity=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<=limit,'bounded_single_ordinary_witness_file_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        raw=os.read(fd,limit+1);need(len(raw)==before.st_size and identity(before)==identity(os.fstat(fd))==identity(path.lstat()),'ordinary_witness_input_changed_during_read')
    finally:os.close(fd)
    need(expected is None or sha(raw)==pin(expected),'exact_ordinary_witness_input_SHA_required');return raw

def document(path,expected=None):return json.loads(protected(path,expected))
def module(path,expected):
    raw=protected(path,expected,200000);v=types.ModuleType('ordinary_witness_'+Path(path).stem);v.__file__=str(path)
    exec(compile(raw,str(path),'exec'),v.__dict__);need(protected(path,expected,200000)==raw,'ordinary_witness_code_changed_during_evaluation');return v

def capture_path(capture_id):
    need(isinstance(capture_id,str)and re.fullmatch('[a-z][a-z0-9-]{0,47}',capture_id),'bounded_named_ordinary_witness_capture_required')
    return BASE/'captures'/capture_id

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def save(base,name,value):
    need(re.fullmatch(r'[a-z][a-z0-9-]*\.(?:json|log)',name),'fixed_ordinary_witness_record_name_required')
    raw=value if isinstance(value,bytes)else encoded(value)
    fd=os.open(base/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
    sync(base);return sha(raw)

def mkdir(path):
    try:path.mkdir(mode=0o700);sync(path.parent)
    except FileExistsError:pass
    s=path.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'root_private_ordinary_witness_directory_required')

def program_inputs():
    for name,expected in PROGRAMS.items():protected(OPS/name,expected,200000)
    protected(NODE,NODE_SHA,200000000)
    target=LOADER.resolve(strict=True)
    need(target.is_relative_to(LOADER_ROOT),'accepted_TSX_loader_target_must_stay_in_retained_context')
    protected(target,LOADER_SHA,200000)
    protected(PARITY,PARITY_SHA);protected(OLD_FAILED,OLD_FAILED_SHA)
    return {'programs':PROGRAMS,'nodeSha256':NODE_SHA,'loaderSha256':LOADER_SHA,'loaderResolvedFile':str(target),
        'candidateParitySha256':PARITY_SHA,'preservedFailedWitnessSha256':OLD_FAILED_SHA}

def plan(base):
    return {'format':'yunipals-ypal-fixed-boundary-witness-plan-v3',
      'sourceRoot':'/opt/yunipals-unified/releases/008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78',
      'baselineFile':'/opt/yunipals-unified/operations/fixed-boundary-20261020/legacy-baseline.json',
      'profileFile':str(OPS/'ypal-combined-rpc-v1/profile.json'),
      'runtimeInventoryFile':'/var/tmp/yunipals-runtime-008028af-20261020/runtime-supplement.inventory.json',
      'candidateReportFile':str(PARITY),'candidateReportSha256':PARITY_SHA,'output':str(base/'witness.json')}

def run(base,phase,expected=None):
    need(phase in{'review','capture'},'only_fixed_witness_review_or_capture_required');program_inputs()
    need(not os.path.lexists(SENTINEL),'absent_password_sentinel_required')
    argv=[str(NODE),'--import',str(LOADER),str(WITNESS),'--plan',str(base/'plan.json')]
    if phase=='capture':argv+=['--apply',pin(expected)]
    cp=subprocess.Popen(argv,cwd='/',env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','NODE_NO_WARNINGS':'1','PGPASSFILE':SENTINEL},
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    timed_out=False
    try:stdout,stderr=cp.communicate(timeout=240)
    except subprocess.TimeoutExpired:
        timed_out=True;os.killpg(cp.pid,signal.SIGTERM)
        try:stdout,stderr=cp.communicate(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(cp.pid,signal.SIGKILL);stdout,stderr=cp.communicate()
    need(not os.path.lexists(SENTINEL),'password_sentinel_must_remain_absent')
    need(len(stdout)<=4000000 and len(stderr)<=4000000,'bounded_private_witness_process_logs_required')
    save(base,phase+'-stdout.log',stdout);save(base,phase+'-stderr.log',stderr)
    meta={'exitCode':cp.returncode,'timedOut':timed_out,'stdoutSha256':sha(stdout),'stderrSha256':sha(stderr),'stdoutBytes':len(stdout),'stderrBytes':len(stderr)}
    save(base,phase+'-process.json',meta)
    need(not timed_out and not stderr and cp.returncode in({0}if phase=='review'else{0,2}),'witness_child_refused_preserved_no_retry')
    return json.loads(stdout)

def frame(result_sha,input_sha):
    intake=module(INTAKE,INTAKE_SHA);source=intake.observe_runtime(result_sha,input_sha)
    observer=module(OBSERVER,OBSERVER_SHA);current=observer.validate_current(OBSERVER_ACK)
    n=observer.namespace();receipt=n.document(n.BASE/'result.json',OBSERVER_ACK);h=n.Host(receipt['readAdmissionSha256'],receipt['installationReceiptSha256'])
    data=source['binding'];expected={k:data[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']}
    expected['nativeTableIdentitiesSha256']=sha(encoded(data['nativeTableIdentities']))
    need(current['validated']is current['observerCurrentQualified']is True and current['receiptSha256']==OBSERVER_ACK and current['operatorSha256']==OBSERVER_SHA and
         current['dataIdentity']==expected and current['sourceActorQualified']is current['currentWriterQualified']is current['paidAuthority']is False,
         'actual_current_observer_and_same_ordinary_dataset_required')
    rows=h.query("SELECT COALESCE(jsonb_agg(jsonb_build_object('chainId',s.chain_id,'revision',s.revision::text,'ageMs',floor(extract(epoch FROM statement_timestamp()-s.checked_at)*1000)::bigint,'row',to_jsonb(s))ORDER BY s.chain_id),'[]'::jsonb) FROM yunipals_indexer_control.chain_status s WHERE release_id='"+data['sourceRelease']+"'AND chain_id IN(1,56,137,8453)")
    need(len(rows)==4 and [r['chainId']for r in rows]==[1,56,137,8453]and
         all(re.fullmatch('[0-9]+',r['revision'])and type(r['ageMs'])is int and 0<=r['ageMs']<=180000 and
             r['row']['release_id']==data['sourceRelease']and r['row']['chain_id']==r['chainId']and r['row']['halted']is False for r in rows),
         'four_genuine_fresh_nonhalted_observer_control_rows_required')
    stable={'source':source['binding'],'observer':{k:current[k]for k in ['operatorSha256','receiptSha256','actor','dataIdentity','initialSourceContext','bootLink']}}
    return {'stable':stable,'sourceObservation':source['observation'],'observerReadOnlyInspect':current['readOnlyInspect'],'controlRows':rows}

def measured_frame(base,phase,result_sha,input_sha):
    """Count Python context HTTP attempts, including failures, without raw URLs."""
    need(phase in{'before-review','after-review','before-capture','after-capture'},'fixed_context_http_observation_phase_required')
    name=phase+'-context-http.json'
    need(not os.path.lexists(base/name),'context_http_observation_exists_no_implicit_retry')
    counts={'format':FORMAT+'-context-http','phase':phase,'httpGetAttempts':0,'httpGetDispatches':0,
        'nonGetAttempts':0,'bodyBearingGetAttempts':0,'maximumGetDispatches':MAX_CONTEXT_GETS,'completed':False,
        'scope':'python-context-urllib-attempts','rawRequestMetadataExported':False}
    original=urllib.request.OpenerDirector.open
    def counted(opener,fullurl,data=None,timeout=socket._GLOBAL_DEFAULT_TIMEOUT):
        method=fullurl.get_method()if isinstance(fullurl,urllib.request.Request)else'POST'if data is not None else'GET'
        if method!='GET':
            counts['nonGetAttempts']+=1;need(False,'only_get_allowed_for_context_http_inspection')
        counts['httpGetAttempts']+=1
        if data is not None or(isinstance(fullurl,urllib.request.Request)and fullurl.data is not None):
            counts['bodyBearingGetAttempts']+=1;need(False,'payload_free_context_get_required')
        need(counts['httpGetAttempts']<=MAX_CONTEXT_GETS,'finite_context_http_get_dispatch_bound_required')
        counts['httpGetDispatches']+=1
        return original(opener,fullurl,data=data,timeout=timeout)
    urllib.request.OpenerDirector.open=counted
    try:
        value=frame(result_sha,input_sha);counts['completed']=True
    except BaseException as error:
        counts['errorClass']=type(error).__name__;raise
    finally:
        urllib.request.OpenerDirector.open=original;save(base,name,counts)
    return {**value,'contextHttp':counts}

def review_wire(value,base):
    b=value['binding'];need(value['reviewHash']==sha(encoded(b))and b['format']==FORMAT and b['operatorSha256']==own_sha()and
        b['captureDirectory']==str(base)and b['planSha256']==sha(protected(base/'plan.json'))and b['plan']==plan(base),
        'exact_new_owned_witness_review_required');return b

def prepare(capture_id,result_sha,input_sha):
    pin(result_sha);pin(input_sha);base=capture_path(capture_id);need(not os.path.lexists(base),'new_exclusive_witness_capture_directory_required')
    programs=program_inputs()
    mkdir(BASE);mkdir(BASE/'captures');base.mkdir(mode=0o700);sync(base.parent)
    save(base,'input.json',{'format':FORMAT+'-input','runtimeResultSha256':result_sha,'runtimeInputSha256':input_sha,'observerReceiptSha256':OBSERVER_ACK})
    before=measured_frame(base,'before-review',result_sha,input_sha)
    save(base,'source-before-review.json',before);save(base,'plan.json',plan(base))
    child=run(base,'review');save(base,'witness-review.json',child);after=measured_frame(base,'after-review',result_sha,input_sha);save(base,'source-after-review.json',after)
    need(before['stable']==after['stable'],'source_or_observer_changed_during_witness_prepare')
    need(child['providerCallsPerformed']==child['databaseConnectionsPerformed']==0 and child['binding']['helperSha256']==PROGRAMS[WITNESS.name]and
         child['binding']['plan']==plan(base)and child['binding']['maximumRpcCalls']==21 and child['binding']['maximumHttpCalls']==12 and child['binding']['replayPermits']==[],
         'unchanged_bounded_free_witness_review_required')
    b={'format':FORMAT,'operatorSha256':own_sha(),'captureDirectory':str(base),'plan':plan(base),'planSha256':sha(protected(base/'plan.json')),
       'inputSha256':sha(protected(base/'input.json')),'programInputs':programs,'ordinaryAndObserver':after['stable'],'witnessReviewHash':pin(child['reviewHash'])}
    value={'binding':b,'reviewHash':sha(encoded(b))};save(base,'prepared.json',value)
    return {'prepared':True,'captureId':capture_id,'reviewHash':value['reviewHash'],
        'contextHttpGetAttempts':before['contextHttp']['httpGetAttempts']+after['contextHttp']['httpGetAttempts'],
        'providerCalls':0,'databaseWrites':0,'serviceActions':0}

def capture(capture_id,expected):
    base=capture_path(capture_id);need(not os.path.lexists(base/'capture-intent.json'),'capture_intent_exists_no_witness_resend');value=document(base/'prepared.json');b=review_wire(value,base)
    need(value['reviewHash']==pin(expected)and program_inputs()==b['programInputs'],'fresh_exact_prepared_witness_review_required')
    config=document(base/'input.json',b['inputSha256']);need(config['format']==FORMAT+'-input'and config['observerReceiptSha256']==OBSERVER_ACK,'same_explicit_witness_runtime_inputs_required')
    before=measured_frame(base,'before-capture',config['runtimeResultSha256'],config['runtimeInputSha256']);need(before['stable']==b['ordinaryAndObserver'],'ordinary_epoch_or_observer_changed_before_capture')
    save(base,'source-before-capture.json',before)
    save(base,'capture-intent.json',{'format':FORMAT,'operatorSha256':own_sha(),'reviewHash':expected,'preparedSha256':sha(protected(base/'prepared.json')),
        'witnessReviewHash':b['witnessReviewHash'],'automaticRetryAllowed':False})
    child_error=None
    try:child=run(base,'capture',b['witnessReviewHash'])
    except Exception as error:child_error=type(error).__name__
    after=measured_frame(base,'after-capture',config['runtimeResultSha256'],config['runtimeInputSha256']);save(base,'source-after-capture.json',after)
    need(child_error is None,'witness_capture_refused_private_logs_preserved_no_retry')
    need(before['stable']==after['stable'],'ordinary_epoch_or_observer_changed_during_capture')
    need(all(int(a['revision'])>=int(z['revision'])for z,a in zip(before['controlRows'],after['controlRows'])),'observer_control_revision_regressed_during_capture')
    report=document(base/'witness.json');canonical=report['canonical']
    need(report['format']=='yunipals-ypal-fixed-boundary-witness-v3'and report['completed']is True and report['reviewHash']==b['witnessReviewHash']and
         report['binding']['plan']==plan(base)and canonical['rpcCalls']==21 and canonical['httpCalls']==12 and canonical['permitHeaders']==canonical['retries']==0 and
         canonical['paidDispatchPossibleWithoutPermit']is False and report['legacyBaselineUnchanged']is True and report['productionChanged']is False and child['completed']is True,
         'genuine_unchanged_completed_witness_and_bounded_protocol_required')
    ready=before['sourceObservation']['sourceReadinessQualified']is after['sourceObservation']['sourceReadinessQualified']is True
    result={'format':FORMAT,'completed':True,'operatorSha256':own_sha(),'captureId':capture_id,'reviewHash':expected,
       'witnessFile':str(base/'witness.json'),'witnessSha256':sha(protected(base/'witness.json')),'witnessQualified':report['acceptance']['qualified'],
       'sourceBeforeAfterReady':ready,'qualified':report['acceptance']['qualified']and ready,'ordinaryEpochAndObserverUnchanged':True,
       'witnessRpcCalls':21,'witnessHttpCalls':12,'permitHeaders':0,'controlStatusWrites':0,'databaseWrites':0,'serviceActions':0,
       'contextHttpGetAttempts':{phase:sum(document(base/(edge+'-'+phase+'-context-http.json'))['httpGetAttempts']for edge in['before','after'])for phase in['review','capture']},
       'contextHttpNonGetAttempts':0,'contextHttpCountScope':'python-context-urllib-attempts',
       'oldFailedWitnessPreserved':True,'sourceOrFinancialAuthorityConferred':False,'ongoingReadinessClaimed':False}
    save(base,'result.json',result);return result


def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group()
    g.add_argument('--prepare',nargs=3,metavar=('CAPTURE_ID','ACTUAL_ORDINARY_RESULT_SHA','ACTUAL_ORDINARY_INPUT_SHA'))
    g.add_argument('--capture',nargs=2,metavar=('CAPTURE_ID','ACTUAL_REVIEW_HASH'));a=p.parse_args()
    if not(a.prepare or a.capture):
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_ordinary_witness_host_required');os.umask(0o077)
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_ordinary_witness_driver_timeout'));signal.alarm(900)
    r=prepare(*a.prepare)if a.prepare else capture(*a.capture)
    allowed=['prepared','captureId','reviewHash','completed','witnessSha256','witnessQualified','sourceBeforeAfterReady','qualified','witnessRpcCalls','witnessHttpCalls','contextHttpGetAttempts','contextHttpNonGetAttempts','contextHttpCountScope','permitHeaders','oldFailedWitnessPreserved']
    print(json.dumps({'format':FORMAT,**{k:v for k,v in r.items()if k in allowed},'databaseWrites':0,'serviceActions':0},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',code)else type(error).__name__,
         'automaticRetryAllowed':False,'databaseWrites':0,'serviceActions':0}));raise SystemExit(1)
