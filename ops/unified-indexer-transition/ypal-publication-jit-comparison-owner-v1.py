"""Inert exact-publication-query comparison; transaction-local JIT on then off."""
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import time
import types

FORMAT='root-genuine-publication-jit-comparison-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
UTILITY=OPS/'ypal-publication-explain-owner-v1.py'
UTILITY_SHA='eaee00ac1f5a09d7c2b76082220563c882ea4269798113e2ebe0237831bab3e4'
PREVIOUS=Path('/var/backups/yunipals-root-publication-explain-20261026-1/result.json')
PREVIOUS_SHA='fd53eb603e450e6ee8e9aa9a77929eb36ea883292cdd3659b0cdb5b73adb9ac3'
QUERY_SHA='c2cce90adcf317aac802226d6e8d203b109bc5e68337d721057f72e8d9603272'
RELATION_SHA='bc47f8a57a2c0c90df56dd367b1217ee0e44ce9acddfe75c6b2206f7744b40ed'
AUDIT=Path('/var/backups/yunipals-root-publication-jit-comparison-20261026-1')
FRAME=['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']

def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+chr(10)).encode()
def protected(path,digest):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_exact_JIT_comparison_source_or_receipt_required')
    first=path.lstat();need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and 0<first.st_size<=4000000,
        'bounded_regular_JIT_comparison_input_required')
    raw=path.read_bytes();last=path.lstat()
    need(all(getattr(first,key)==getattr(last,key)for key in FRAME)and len(raw)==first.st_size and sha(raw)==digest,
        'same_exact_JIT_comparison_input_bytes_required');return raw
def utility():
    module=types.ModuleType('authenticated_exact_publication_compiler');module.__file__=str(UTILITY)
    exec(compile(protected(UTILITY,UTILITY_SHA),str(UTILITY),'exec'),module.__dict__);return module
def previous(base):
    value=json.loads(protected(PREVIOUS,PREVIOUS_SHA))
    need(type(value)is dict and value.get('format')==base.FORMAT and value.get('completed')is True and
        value.get('fullQuerySha256')==QUERY_SHA and value.get('relationSqlSha256')==RELATION_SHA and
        value.get('fullQueryBytes')==3558 and value.get('relationSqlBytes')==3133 and
        value.get('originalMethodCodeIdentityVerified')is value.get('freshCompilationPerformed')is True and
        value.get('actualQueryExecutionRequested')is value.get('explainAnalyzeRequested')is False,
        'actual_completed_nonexecuting_EXPLAIN_and_exact_query_ancestry_required')
    need(type(value.get('planAggregate'))is dict and type(value['planAggregate'].get('settings'))is dict,
        'actual_authenticated_EXPLAIN_scalar_settings_required')
    return value
def payload(base,sql,jit):
    need(jit in{'on','off'}and type(sql)is str and sha(sql.encode())==QUERY_SHA and ';'not in sql and '\\'not in sql,
        'one_unchanged_exact_publication_SELECT_and_fixed_JIT_mode_required')
    return('BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;SET LOCAL jit='+jit+';'+base.IDENTITY+';'+base.SETTINGS+';'+sql+';ROLLBACK;').encode()
def observe(base,peer,sql,jit,prior):
    need(not os.path.lexists(peer.SENTINEL),'absent_original_peer_password_file_required')
    args=['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs',
        '/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGPASSFILE='+peer.SENTINEL,
        'PGAPPNAME=ypal_publication_jit_comparison','PGOPTIONS='+peer.READ_OPTIONS,
        '/usr/bin/psql','-XwAtq','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','yunipals_backfill','-v','ON_ERROR_STOP=1']
    request=payload(base,sql,jit);started=time.monotonic_ns()
    process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=peer.CLEAN,cwd='/',start_new_session=True)
    try:out,err=process.communicate(request,timeout=80)
    except BaseException:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.communicate();raise
    elapsed=time.monotonic_ns()-started
    need(process.returncode==0 and not err and 0<len(out)<100000 and not os.path.lexists(peer.SENTINEL),
        'bounded_exact_publication_JIT_comparison_failed_no_retry')
    identity,settings,result=base.decode_values(out)
    need(identity=={'role':'postgres','database':'yunipals_backfill','databaseOid':'17584'},'same_original_publication_peer_identity_required')
    expected={**prior['planAggregate']['settings'],'jit':jit}
    need(encoded(settings)==encoded(expected)and settings['readOnly']=='on'and settings['statementTimeoutMs']==60000 and
        settings['lockTimeoutMs']==1000 and settings['idleTransactionTimeoutMs']==72000,
        'same_original_readonly_timeouts_and_all_non_JIT_settings_required')
    need(type(result)is dict and set(result)=={'canonicalRows','publishedRows','probe'}and
        all(type(result[key])is int and result[key]>=0 for key in['canonicalRows','publishedRows'])and type(result['probe'])is bool and
        type(elapsed)is int and elapsed>0,'genuine_typed_full_publication_result_and_elapsed_required')
    return{'jit':jit,'settings':settings,'result':result,'resultSha256':sha(encoded(result)),
        'transportWallNanoseconds':elapsed,'stdoutSha256':sha(out),'stdoutBytes':len(out),'stderrBytes':0,
        'requestSha256':sha(request),'fullQuerySha256':sha(sql.encode())}
def summary(observations):
    need(type(observations)is list and len(observations)==2 and [row['jit']for row in observations]==['on','off'],
        'exact_one_on_then_one_off_observation_required')
    on,off=observations;equal=encoded(on['result'])==encoded(off['result'])
    return{'modeOrder':['on','off'],'observations':[{key:row[key]for key in['jit','settings','resultSha256','transportWallNanoseconds',
        'stdoutSha256','stdoutBytes','stderrBytes','requestSha256','fullQuerySha256']}for row in observations],
        'resultObjectsEqual':equal,'offToOnTransportWallRatio':off['transportWallNanoseconds']/on['transportWallNanoseconds']if equal else None,
        'separateTransactionSnapshots':True,'cacheWarmupAndConcurrentMovementNotControlled':True,
        'wallIncludesProcessStartupIdentityAndSettingsQueries':True,'causalPerformanceQualified':False}
def save(name,value):
    raw=encoded(value);fd=os.open(AUDIT/name,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    fd=os.open(AUDIT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return sha(raw)
def main(args):
    if not args:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseDispatchRequested':False}));return 0
    need(args==['--run'],'one_explicit_exact_publication_JIT_pair_only')
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','root_on_exact_production_host_required')
    need(not os.path.lexists(AUDIT),'exclusive_new_JIT_comparison_audit_required')
    row=AUDIT.parent.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and not row.st_mode&0o022,
        'protected_JIT_comparison_audit_parent_required')
    AUDIT.mkdir(mode=0o700);os.chmod(AUDIT,0o700)
    save('intent.json',{'format':FORMAT,'modeOrder':['on','off'],'priorEXPLAINSha256':PREVIOUS_SHA,
        'querySha256':QUERY_SHA,'transactionLocalJITOnly':True,'automaticRetryAllowed':False})
    try:
        base=utility();prior=previous(base);before=base.snapshot();peer=base.load_peer();sql,query=base.compile_query(peer)
        need(query['fullQuerySha256']==QUERY_SHA and query['relationSqlSha256']==RELATION_SHA and
            query['fullQueryBytes']==3558 and query['relationSqlBytes']==3133,'fresh_compiler_must_reproduce_actual_EXPLAIN_query_exactly')
        observations=[];hashes={}
        for jit in['on','off']:
            value=observe(base,peer,sql,jit,prior);observations.append(value);hashes[jit]=save('jit-'+jit+'-observation.private.json',value)
        need(base.snapshot()==before and protected(PREVIOUS,PREVIOUS_SHA)and protected(UTILITY,UTILITY_SHA),
            'all_original_sources_private_env_and_receipts_unchanged_required')
        files=save('source-bookends.private.json',before)
        result={'format':FORMAT,'completed':True,'priorEXPLAINSha256':PREVIOUS_SHA,**query,'comparison':summary(observations),
            'privateObservationHashes':hashes,'sourceBookendsSha256':files,'actualQueryExecutionRequested':True,
            'actualCountsKeptPrivate':True,'explainAnalyzeRequested':False,'freshCompilationPerformed':True,
            'allCompilerAndEnvFilesUnchanged':True,'transactionLocalJITOnly':True,'workMemSettingChanged':False,
            'newCurrentAuthority':False,'newHeldQualification':False,'databaseMutationsRequested':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0,'automaticRetryAllowed':False}
        digest=save('result.json',result);print(json.dumps({**result,'resultSha256':digest},sort_keys=True));return 0
    except BaseException as error:
        try:save('failure.json',{'format':FORMAT,'completed':False,'failureType':type(error).__name__,
            'failureSha256':sha(str(error).encode()),'automaticRetryAllowed':False,'newCurrentAuthority':False})
        except Exception:pass
        raise

if __name__=='__main__':
    if sys.argv[1:]:
        signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError('bounded_two_original_readonly_publication_transports')))
        signal.alarm(200)
    raise SystemExit(main(sys.argv[1:]))
