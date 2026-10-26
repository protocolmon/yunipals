"""Inert, one-shot EXPLAIN-only diagnostic of the genuine publication SQL."""
import ast
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import sys
import time
import types

FORMAT='root-genuine-publication-explain-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
TEMPLATE=OPS/'ypal-restored-metadata-handover-v1.py'
TEMPLATE_SHA='cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
PEER=OPS/'ypal-ordinary-publication-query-v2.py'
PEER_SHA='deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c'
PROJECT=Path('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer')
NODE='/opt/node-v24.18.1/bin/node'
CANDIDATES=Path('/var/backups/yunipals-ypal-ordinary-metadata-candidates-v5-20261025')
AUDIT=Path('/var/backups/yunipals-root-publication-explain-20261026-1')
READ='yunipals_ownership_4e77f52b_v5'
OLD_READ='yunipals_ownership_35cdcb32_v4'
CLEAN={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
COMPILER_CLEAN={'PATH':'/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
SOURCE_PINS={'lib/constants.ts':'31d4c01cb192d54085e26d18f7d7323c82ef54168f98b9c4c916610fe13e8e7a',
 'lib/metadata/base-mode.ts':'6fe2cb1847a587bd9d046d4f506ad6de1f22cd56cf3adb4211faf8330eccefc4',
 'lib/metadata/projection-mode.ts':'b64bbbd5f7b13f466a0bb5d61f6b55d2d487b598e2431bebe1a3b72990b5dc1e',
 'lib/metadata/publication.ts':'e23603244cd40eeff087e48ba792fdb40aa471e4cd57fdd436ae5f0549ca582e',
 'lib/metadata/read-source.ts':'1c80f8ca18c609c8a47e164730aa5409ea2a9a65c2697bac4498c2ab1ba63208',
 'lib/metadata/source/canonical.ts':'dd21d236e478925c161768f93ed299ebfdd20747ac2908cc276ec336b0b93168',
 'lib/offchain/sql.ts':'251f41c2c6f818b52e195713cfb5957281f50cda588f976d103bc108d3095510',
 'lib/ownership/projection-proof.ts':'d42b4405fcd7daff620f7c016304e9cd95c7b44d5d05ea715b2601cff49767bd',
 'lib/ownership/read-mode.ts':'de6f87fcdaa9af5b526f3e221c0efa8c98b3218f8373c702d287117baae68f05'}
FRAME=['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']

def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+chr(10)).encode()
def frame(row):return{key:getattr(row,key)for key in FRAME}
def protected(path,digest=None):
    path=Path(path)
    for part in[*path.parents,path]:
        row=part.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_exact_publication_compiler_input_required')
    first=path.lstat();need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and 0<first.st_size<=4000000,
        'bounded_regular_publication_compiler_input_required')
    raw=path.read_bytes();last=path.lstat()
    need(frame(first)==frame(last)and len(raw)==first.st_size and(digest is None or sha(raw)==digest),
        'same_actual_publication_compiler_input_bytes_required')
    return raw
def snapshot():
    paths={TEMPLATE:TEMPLATE_SHA,PEER:PEER_SHA,**{PROJECT/name:digest for name,digest in SOURCE_PINS.items()},
        CANDIDATES/'native-recovery.env':None}
    return{str(path):{'sha256':sha(protected(path,digest)),'stat':frame(path.lstat())}for path,digest in paths.items()}
def load_peer():
    value=types.ModuleType('genuine_readonly_publication_peer');value.__file__=str(PEER)
    exec(compile(protected(PEER,PEER_SHA),str(PEER),'exec'),value.__dict__)
    need(value.TEMPLATE_SHA==TEMPLATE_SHA and value.TEMPLATE==TEMPLATE and value.READ_SCHEMA==READ and value.CANDIDATES==CANDIDATES,
        'exact_published_publication_peer_policy_required')
    return value
def compile_query(peer):
    """No Host constructor: run its exact code only to the compiler/query seam."""
    compiled=compile(ast.parse(protected(TEMPLATE,TEMPLATE_SHA)),str(TEMPLATE),'exec')
    cls=next(value for value in compiled.co_consts if isinstance(value,types.CodeType)and value.co_name=='Host')
    code=next(value for value in cls.co_consts if isinstance(value,types.CodeType)and value.co_name=='publication_proof')
    need(code.co_freevars==(),'original_publication_method_has_no_reconstructed_closure')
    scope={'need':need,'sha':sha,'json':json,'subprocess':subprocess,'CANDIDATES':peer.CANDIDATES}
    body=types.FunctionType(code,scope,'publication_proof')
    receiver=types.SimpleNamespace(s=types.SimpleNamespace(protected=lambda path:protected(path,TEMPLATE_SHA)),
        m=types.SimpleNamespace(PROJECT=PROJECT,NODE=NODE,CLEAN=COMPILER_CLEAN,protected=protected),
        meta=types.SimpleNamespace(READ=READ,OLD_READ=OLD_READ))
    receiver.publication_proof=types.MethodType(body,receiver)
    sql=peer.capture_query(receiver)
    prefix="SELECT jsonb_build_object('canonicalRows',(SELECT count(*)FROM "
    suffix=(" p WHERE p.collection='base'),'publishedRows',(SELECT count(*)FROM metadata.token_publication p WHERE p.collection='base' "
        "AND p.source_kind='archive' AND p.publication_status='published' AND EXISTS(SELECT 1 FROM metadata_source.archive_release a "
        "WHERE a.release_id=p.release_id AND a.state='active')),'probe',"+READ+'.base_metadata_probe())')
    need(sql.startswith(prefix)and sql.endswith(suffix),'exact_complete_original_count_and_probe_wrapper_required')
    relation=sql[len(prefix):-len(suffix)]
    need(relation and ';'not in sql and '\\'not in sql,'one_exact_compiled_publication_SELECT_required')
    return sql,{'relationSqlSha256':sha(relation.encode()),'fullQuerySha256':sha(sql.encode()),
        'relationSqlBytes':len(relation.encode()),'fullQueryBytes':len(sql.encode()),'originalMethodCodeIdentityVerified':True}

IDENTITY="SELECT jsonb_build_object('role',current_user,'database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()))"
SETTINGS="""SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'serverVersionNum',current_setting('server_version_num')::int,
'jit',current_setting('jit'),'jitAboveCost',current_setting('jit_above_cost')::numeric,'jitInlineAboveCost',current_setting('jit_inline_above_cost')::numeric,
'jitOptimizeAboveCost',current_setting('jit_optimize_above_cost')::numeric,'workMemKiB',(SELECT setting::bigint FROM pg_settings WHERE name='work_mem'),
'hashMemMultiplier',current_setting('hash_mem_multiplier')::numeric,'maxParallelWorkersPerGather',current_setting('max_parallel_workers_per_gather')::int,
'statementTimeoutMs',(SELECT setting::int FROM pg_settings WHERE name='statement_timeout'),'lockTimeoutMs',(SELECT setting::int FROM pg_settings WHERE name='lock_timeout'),
'idleTransactionTimeoutMs',(SELECT setting::int FROM pg_settings WHERE name='idle_in_transaction_session_timeout'))"""
def payload(sql):
    return('BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;'+IDENTITY+';'+SETTINGS+
        ';EXPLAIN (ANALYZE FALSE,VERBOSE FALSE,COSTS TRUE,SETTINGS TRUE,SUMMARY TRUE,FORMAT JSON) '+sql+';ROLLBACK;').encode()
def decode_values(raw):
    text=raw.decode('utf-8');decoder=json.JSONDecoder();values=[];offset=0
    while offset<len(text):
        while offset<len(text)and text[offset].isspace():offset+=1
        if offset==len(text):break
        value,end=decoder.raw_decode(text,offset);values.append(value);offset=end
        need(len(values)<=3,'exact_identity_settings_and_EXPLAIN_JSON_values_required')
    need(len(values)==3,'complete_identity_settings_and_EXPLAIN_JSON_required');return values
def explain(peer,sql):
    need(not os.path.lexists(peer.SENTINEL),'absent_original_readonly_peer_password_file_required')
    args=['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs',
        '/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGPASSFILE='+peer.SENTINEL,
        'PGAPPNAME=ypal_full_publication_explain_only','PGOPTIONS='+peer.READ_OPTIONS,
        '/usr/bin/psql','-XwAtq','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','yunipals_backfill','-v','ON_ERROR_STOP=1']
    process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=peer.CLEAN,cwd='/',start_new_session=True)
    try:out,err=process.communicate(payload(sql),timeout=80)
    except BaseException:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.communicate();raise
    need(process.returncode==0 and not err and 0<len(out)<10000000,'bounded_readonly_EXPLAIN_peer_failed_no_retry')
    identity,settings,plan=decode_values(out)
    need(identity=={'role':'postgres','database':'yunipals_backfill','databaseOid':'17584'}and
        type(settings)is dict and settings.get('readOnly')=='on'and settings.get('statementTimeoutMs')==60000 and
        settings.get('lockTimeoutMs')==1000 and settings.get('idleTransactionTimeoutMs')==72000 and
        not os.path.lexists(peer.SENTINEL),'same_actual_original_readonly_database_identity_and_timeouts_required')
    return settings,plan,{'outputSha256':sha(out),'outputBytes':len(out),'stderrBytes':len(err)}

def numeric(value):return type(value)in{int,float}and math.isfinite(value)and 0<=value<=1e30
def aggregate(settings,plan):
    need(type(plan)is list and len(plan)==1 and type(plan[0])is dict and type(plan[0].get('Plan'))is dict,
        'one_original_EXPLAIN_JSON_plan_required')
    top=plan[0];need('Execution Time'not in top and 'Triggers'not in top,'ANALYZE_execution_evidence_is_not_permitted')
    allowed={'readOnly','serverVersionNum','jit','jitAboveCost','jitInlineAboveCost','jitOptimizeAboveCost','workMemKiB',
        'hashMemMultiplier','maxParallelWorkersPerGather','statementTimeoutMs','lockTimeoutMs','idleTransactionTimeoutMs'}
    need(set(settings)==allowed and settings['jit']in{'on','off'}and type(settings['serverVersionNum'])is int and
        all(type(settings[name])in{int,float}and math.isfinite(settings[name])for name in allowed-{'readOnly','jit'}),
        'only_explicit_scalar_plan_cost_JIT_and_memory_settings_may_be_reported')
    groups={};indexes=set();index_hashes=set();count=0;depth=0;stack=[(top['Plan'],0)]
    while stack:
        node,level=stack.pop();count+=1;depth=max(depth,level)
        need(count<=5000 and level<=128 and type(node)is dict and type(node.get('Node Type'))is str and
            re.fullmatch('[A-Za-z][A-Za-z ]{0,79}',node['Node Type'])and not any(key.startswith('Actual ')for key in node),
            'bounded_plan_nodes_without_actual_rows_or_times_required')
        rows=node.get('Plan Rows');startup=node.get('Startup Cost');total=node.get('Total Cost')
        need(type(rows)is int and rows>=0 and numeric(startup)and numeric(total),'typed_estimated_rows_and_costs_only_required')
        item=groups.setdefault(node['Node Type'],{'count':0,'maximumEstimatedRows':0,'sumEstimatedRows':0,'maximumTotalCost':0})
        item['count']+=1;item['maximumEstimatedRows']=max(item['maximumEstimatedRows'],rows);item['sumEstimatedRows']+=rows
        item['maximumTotalCost']=max(item['maximumTotalCost'],total)
        if 'Index Name'in node:
            name=node['Index Name'];need(type(name)is str,'typed_index_name_required')
            if re.fullmatch('[A-Za-z_][A-Za-z0-9_$]{0,127}',name):indexes.add(name)
            else:index_hashes.add(sha(name.encode()))
        children=node.get('Plans',[]);need(type(children)is list,'typed_child_plan_array_required')
        stack.extend((child,level+1)for child in children)
    jit=top.get('JIT',{});need(type(jit)is dict and 'Timing'not in jit,'only_nonexecuted_JIT_plan_options_allowed')
    jit_summary={}
    if jit:
        need(type(jit.get('Functions'))is int and jit['Functions']>=0 and type(jit.get('Options'))is dict and
            set(jit['Options'])<={'Inlining','Optimization','Expressions','Deforming'}and
            all(type(value)is bool for value in jit['Options'].values()),'typed_JIT_plan_options_required')
        jit_summary={'functions':jit['Functions'],'options':jit['Options']}
    root=top['Plan'];planning=top.get('Planning Time')
    need(planning is None or numeric(planning),'typed_optional_planning_time_required')
    return{'rootNodeKind':root['Node Type'],'rootEstimatedRows':root['Plan Rows'],'rootStartupCost':root['Startup Cost'],
        'rootTotalCost':root['Total Cost'],'nodeCount':count,'maximumDepth':depth,'nodeKinds':dict(sorted(groups.items())),
        'indexNames':sorted(indexes),'nonIdentifierIndexNameHashes':sorted(index_hashes),'jitPlan':jit_summary,
        'settings':settings,'planningMilliseconds':planning,'costsAreEstimatesNotMilliseconds':True,
        'summedEstimatedRowsAreAcrossNodesNotActualRows':True}

def save(name,value):
    path=AUDIT/name;raw=encoded(value);fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    fd=os.open(AUDIT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return sha(raw)
def main(args):
    if not args:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'explainAnalyzeRequested':False,'databaseDispatchRequested':False}));return 0
    need(args==['--run'],'only_one_explicit_EXPLAIN_only_dispatch_allowed')
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','root_on_the_exact_production_host_required')
    need(not os.path.lexists(AUDIT),'exclusive_new_EXPLAIN_audit_namespace_required')
    parent=AUDIT.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and not parent.st_mode&0o022,
        'protected_new_EXPLAIN_audit_parent_required')
    AUDIT.mkdir(mode=0o700);os.chmod(AUDIT,0o700)
    save('intent.json',{'format':FORMAT,'explainAnalyzeRequested':False,'actualQueryExecutionRequested':False,
        'jitSettingChanged':False,'workMemSettingChanged':False,'automaticRetryAllowed':False})
    try:
        before=snapshot();peer=load_peer();started=time.monotonic_ns();sql,query=compile_query(peer)
        compiled_ns=time.monotonic_ns()-started
        settings,plan,transport=explain(peer,sql);summary=aggregate(settings,plan)
        need(snapshot()==before,'all_compiler_and_candidate_env_bytes_and_inodes_unchanged_required')
        save('source-bookends.private.json',before)
        value={'format':FORMAT,'completed':True,**query,'planAggregate':summary,'compilerWallNanoseconds':compiled_ns,
            'transport':transport,'allCompilerAndEnvFilesUnchanged':True,'freshCompilationPerformed':True,
            'explainAnalyzeRequested':False,'actualQueryExecutionRequested':False,'planningMayEvaluatePlannerExpressions':True,
            'actualPublicationCountsOrReadinessReturned':False,'newCurrentAuthority':False,'newHeldQualification':False,
            'jitSettingChanged':False,'workMemSettingChanged':False,'databaseMutationsRequested':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0,'automaticRetryAllowed':False}
        digest=save('result.json',value);print(json.dumps({**value,'resultSha256':digest},sort_keys=True));return 0
    except BaseException as error:
        try:save('failure.json',{'format':FORMAT,'completed':False,'failureType':type(error).__name__,
            'failureSha256':sha(str(error).encode()),'automaticRetryAllowed':False,'explainAnalyzeRequested':False})
        except Exception:pass
        raise

if __name__=='__main__':
    if sys.argv[1:]:
        signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError('bounded_EXPLAIN_only_diagnostic_deadline')))
        signal.alarm(140)
    raise SystemExit(main(sys.argv[1:]))
