#!/usr/bin/env python3
"""Review/apply one official nullable column on the fixed live metadata table."""
import argparse,copy,fcntl,hashlib,json,os,pwd,re,signal,socket,stat,subprocess,types
from pathlib import Path

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
ROOT=Path('/opt/yunipals-unified/releases/9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d')
BASE=Path('/var/backups/yunipals-native-metadata-publication-column-v1-20261021')
LOCK=Path('/run/lock/yunipals-unified-consumer-api-preview.lock')
FORMAT='yunipals-native-metadata-publication-column-v1'
PRIMITIVE_SHA='435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9'
PROD3=Path('/var/backups/yunipals-paid-productive-live-v6-20261021/20261021-prod3')
PROD3_PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'
UNITS=['yunipals-paid-productive-controller-v6-20261021-prod3.service','yunipals-unified-paid-productive-v8-20261021-prod3.service']
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
PHASE='bootstrap'


def fail(code):raise RuntimeError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def literal(value):return "'"+str(value).replace("'","''")+"'"
def protected(path,maximum=2000000):
    path=Path(path)
    if not path.is_absolute()or'..'in path.parts:fail('exact_absolute_protected_path_required')
    for item in [*path.parents,path]:
        s=item.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or(s.st_mode&0o022 and not(stat.S_ISDIR(s.st_mode)and s.st_mode&stat.S_ISVTX)):
            fail('protected_root_metadata_owner_input_required')
    a=path.stat()
    if not stat.S_ISREG(a.st_mode)or a.st_size>maximum:fail('bounded_regular_metadata_owner_input_required')
    raw=path.read_bytes();b=path.stat();key=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if key(a)!=key(b)or len(raw)>maximum:fail('metadata_owner_input_changed_during_read')
    return raw

def primitive():
    path=OPS/'application-recovery-native-column-v1.py';raw=protected(path,50000)
    if sha(raw)!=PRIMITIVE_SHA:fail('frozen_verified_column_primitive_changed')
    m=types.ModuleType('official_native_publication_column');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def psql(text,*,write=False,timeout=12):
    account=pwd.getpwnam('postgres');group=pwd.getpwnam('postgres').pw_gid
    if account.pw_uid<=0 or group<=0:fail('existing_nonroot_postgres_peer_required')
    options='-c default_transaction_read_only='+('off'if write else'on')+' -c statement_timeout=8000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=15000 -c timezone=UTC'
    args=['/usr/bin/setpriv','--reuid='+str(account.pw_uid),'--regid='+str(group),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs',
        '/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGHOST=/var/run/postgresql','PGPORT=5432','PGUSER=postgres','PGDATABASE=yunipals_backfill','PGPASSFILE=/dev/null','PGOPTIONS='+options,
        '/usr/bin/psql','-XwqAt','-v','ON_ERROR_STOP=1']
    done=subprocess.run(args,input=text,env=ENV,text=True,capture_output=True,timeout=timeout)
    if done.returncode!=0 or len(done.stdout)>1000000 or len(done.stderr)>100000:fail('fixed_metadata_owner_SQL_unconfirmed')
    return done.stdout

def capture(p):
    text="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL search_path=pg_catalog;SELECT jsonb_build_object('identity',jsonb_build_object('database',current_database(),'session',session_user,'current',current_user,'port',current_setting('port'),'local',inet_client_addr()IS NULL,'recovery',pg_is_in_recovery(),'dataDirectory',current_setting('data_directory'),'systemId',(SELECT system_identifier::text FROM pg_control_system())),'target',("+p.target_sql()+"));ROLLBACK;"
    value=json.loads(psql(text));identity=value.get('identity',{});target=value.get('target',{});table=target.get('table')or{}
    if (set(value)!={'identity','target'}or set(identity)!={'database','session','current','port','local','recovery','dataDirectory','systemId'}or
        any(identity.get(k)!=v for k,v in {'database':'yunipals_backfill','session':'postgres','current':'postgres','port':'5432','local':True,'recovery':False}.items())or
        not isinstance(identity.get('dataDirectory'),str)or not identity['dataDirectory'].startswith('/var/lib/postgresql/')or not re.fullmatch('[1-9][0-9]*',identity.get('systemId',''))):
        fail('fixed_live_local_main_cluster_identity_required')
    if (table.get('kind')!='r'or table.get('persistence')!='p'or not re.fullmatch('[a-z_][a-z0-9_]{0,62}',table.get('ownerName',''))or
        any(not re.fullmatch('[1-9][0-9]*',table.get(k,''))for k in ['oid','ownerOid','schemaOid','fileNode','rowTypeOid'])or
        type(table.get('attributes'))is not int or not isinstance(target.get('columns'),list)or
        any(c.get('name')=='chain_event_block_hash'for c in target['columns'])):
        fail('ordinary_existing_physical_publication_missing_only_official_column_required')
    required={'collection':'text','token_id':'numeric(78,0)','lifecycle':'integer','mint_transaction_hash':'text','chain_event_key':'text'}
    # Exact current full shape is bound below; these public names prevent a
    # same-named unrelated table from becoming the target.
    types_by_name={c.get('name'):c.get('type')for c in target['columns']}
    if any(types_by_name.get(k)!=v for k,v in required.items()):fail('official_existing_publication_base_columns_required')
    return value

def prod3_closed():
    outcome_raw=protected(PROD3/'controller-result.json',200000);outcome=json.loads(outcome_raw)
    live_raw=protected(OPS/'paid-productive-v6-20261021-prod3.live.json',1000000);value=json.loads(live_raw)
    if sha(encoded(value['review']['spec']['plan']))!=PROD3_PLAN_SHA:fail('exact_original_prod3_financial_plan_required')
    raw=protected(PROD3/'journal.jsonl',16000000);rows=[json.loads(line)for line in raw.splitlines()]
    finished=next((r for r in reversed(rows)if r.get('phase')=='controller_finished'),None)
    if (len(rows)>4096 or outcome.get('format')!='yunipals-paid-productive-live-v6'or outcome.get('cleaned')is not True or outcome.get('cleanupErrorClass')is not None or
        finished is None or finished.get('cleaned')is not True or finished.get('outcomeSha256')!=sha(outcome_raw)):
        fail('actual_acknowledged_prod3_cleanup_required_before_metadata_DDL')
    for unit in UNITS:
        done=subprocess.run(['/usr/bin/systemctl','show','--all',unit,'--property=LoadState,ActiveState,SubState,MainPID'],env=ENV,text=True,capture_output=True,timeout=4)
        fields=dict(line.split('=',1)for line in done.stdout.splitlines())
        if(done.returncode not in{0,1,3,4}or set(fields)!={'LoadState','ActiveState','SubState','MainPID'}or fields['LoadState']not in{'loaded','not-found'}or fields['ActiveState']not in{'inactive','failed'}or fields['SubState']not in{'dead','failed'}or fields['MainPID']!='0'):
            fail('prod3_controller_and_native_must_be_terminal')
    return {'controllerResultSha256':sha(outcome_raw),'controllerFinishedAckSha256':sha(encoded(finished)),'livePlanSha256':sha(live_raw)}

def expected_after(before):
    after=copy.deepcopy(before);target=after['target'];target['table']['attributes']+=1
    target['columns'].append({'number':target['table']['attributes'],'name':'chain_event_block_hash','type':'text','notNull':False,'default':None,'identity':'','generated':'','hasMissing':False,'missingValue':None,'acl':None})
    return after

def guarded_sql(p,before):
    identity=before['identity'];owner=before['target']['table']['ownerName'];target=p.target_sql();expected=expected_after(before)['target']
    if not re.fullmatch('[a-z_][a-z0-9_]{0,62}',owner):fail('simple_existing_target_owner_required')
    return """BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;
SET LOCAL search_path=pg_catalog;SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='8s';SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT pg_advisory_xact_lock(178858,9061);
DO $publication_column$DECLARE b jsonb;a jsonb;before_count bigint;after_count bigint;BEGIN
IF current_database()<>'yunipals_backfill'OR session_user<>'postgres'OR current_user<>'postgres'OR current_setting('port')<>'5432'OR inet_client_addr()IS NOT NULL OR pg_is_in_recovery()
 OR current_setting('data_directory')<>"""+literal(identity['dataDirectory'])+" OR(SELECT system_identifier::text FROM pg_control_system())<>"+literal(identity['systemId'])+""" THEN RAISE EXCEPTION 'Live metadata target changed';END IF;
LOCK TABLE metadata.token_publication IN ACCESS EXCLUSIVE MODE;
SELECT q.value INTO b FROM("""+target+")q(value);\nIF b IS DISTINCT FROM "+literal(encoded(before['target']).decode())+"::jsonb THEN RAISE EXCEPTION 'Publication catalog changed';END IF;\nSELECT count(*)INTO before_count FROM metadata.token_publication;\nSET LOCAL ROLE \""+owner+"\";\n"+p.STATEMENT+";\nRESET ROLE;\nSELECT q.value INTO a FROM("+target+")q(value);\nIF a IS DISTINCT FROM "+literal(encoded(expected).decode())+"::jsonb THEN RAISE EXCEPTION 'Only official nullable no-rewrite column delta allowed';END IF;\nSELECT count(*)INTO after_count FROM metadata.token_publication;\nIF before_count<>after_count THEN RAISE EXCEPTION 'Publication row count changed';END IF;\nPERFORM set_config('yunipals.production_native_column',jsonb_build_object('before',b,'after',a,'rowsBefore',before_count,'rowsAfter',after_count,'applied',true,'dataBackfilled',false,'hashesManufactured',false)::text,true);\nEND $publication_column$;\nSELECT current_setting('yunipals.production_native_column');\nCOMMIT;\n"

def save(path,value):
    raw=encoded(value)+b'\n'
    with path.open('xb')as out:os.fchmod(out.fileno(),0o600);out.write(raw);out.flush();os.fsync(out.fileno())
    fd=os.open(path.parent,os.O_DIRECTORY|os.O_RDONLY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def review():
    p=primitive();official=p.official(protected(ROOT/p.SOURCE,100000));before=capture(p)
    body={'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute(),100000)),'official':{k:v for k,v in official.items()if k!='format'},'before':before,'sqlSha256':sha(guarded_sql(p,before).encode())}
    return {'reviewHash':sha(encoded(body)),'binding':body},p

def main():
    global PHASE
    os.umask(0o077);a=argparse.ArgumentParser(description=__doc__);a.add_argument('--apply');args=a.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('fixed_root_host_required')
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError('bounded_metadata_owner_deadline')));signal.alarm(180)
    PHASE='readonly_official_source_and_live_target';checked,p=review();marker=checked['reviewHash']
    BASE.mkdir(mode=0o700,exist_ok=True);s=BASE.lstat()
    if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o077:fail('private_production_column_evidence_required')
    if args.apply is None:
        path=BASE/('review-'+marker+'.json')
        if not path.exists():save(path,checked)
        elif json.loads(protected(path))!=checked:fail('existing_readonly_review_changed')
        print(json.dumps({'format':FORMAT,'applied':False,'reviewHash':marker,'targetPhysical':True,'columnMissing':True,'catalogSha256':sha(encoded(checked['binding']['before'])),'privateReviewSha256':sha(protected(path))},sort_keys=True));return
    if args.apply!=marker:fail('exact_fresh_live_column_review_required')
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_mode&0o077:fail('private_sequential_metadata_owner_lease_required')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);closed=prod3_closed()
        if capture(p)!=checked['binding']['before']:fail('fresh_live_column_catalog_changed_before_attempt')
        directory=BASE/('apply-'+marker);directory.mkdir(mode=0o700);save(directory/'review.json',checked);save(directory/'prod3-closed.json',closed)
        text=guarded_sql(p,checked['binding']['before']);save(directory/'prepared.json',{'sql':text,'sqlSha256':sha(text.encode()),'automaticRetry':False})
        result={'format':FORMAT,'reviewHash':marker,'applied':False,'transactionOutcome':'unconfirmed_requires_catalog_reconcile','error':None}
        try:
            PHASE='exact_existing_owner_official_nullable_DDL';proof=p.validate_proof(json.loads(psql(text,write=True,timeout=20)));save(directory/'proof.json',proof)
            result.update(applied=True,transactionOutcome='commit_confirmed',proofSha256=sha(encoded(proof)),rowCountUnchanged=True,tableRewritten=False,dataBackfilled=False,hashesManufactured=False,grantsChanged=False,sourceSelectionChanged=False)
        except BaseException as error:result['error']={'phase':PHASE,'class':type(error).__name__}
        save(directory/'result.json',result);print(json.dumps({**result,'resultSha256':sha(protected(directory/'result.json'))},sort_keys=True))
        if not result['applied']:raise SystemExit(1)
    finally:os.close(fd)

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'format':FORMAT,'applied':False,'phase':PHASE,'errorClass':type(error).__name__,'rawMessageExported':False},sort_keys=True));raise SystemExit(1)
