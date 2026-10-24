#!/usr/bin/env python3
"""Complete only source13 after actual operational8 COMMIT; never resend op8."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import types

FORMAT='yunipals-arena-ypal-source-completion-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-ypal-source-completion-v1.py'
PARENT=OPS/'arena-ypal-current-admission-v1.py'
PARENT_SHA='c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035'
PARENT_BASE=Path('/var/backups/yunipals-arena-ypal-current-admission-v1-20261024')
OPERATIONAL_RESULT_SHA='ec196512185ad685998c118d4dc92803c885532fb2ed65095eec6484ab0f15af'
BASE=Path('/var/backups/yunipals-arena-ypal-source-completion-v1-20261024')
PROPOSAL=OPS/'arena-ypal-current-admission-v1.proposal.json'
PROPOSAL_SHA='0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def own_sha():return sha(Path(__file__).read_bytes())
def parent():
    for p in [*PARENT.parents,PARENT]:
        s=p.lstat();need(s.st_uid==0 and not p.is_symlink()and not s.st_mode&0o022,'protected_current_admission_parent_required')
    raw=PARENT.read_bytes();need(len(raw)<200000 and sha(raw)==PARENT_SHA,'exact_current_admission_parent_before_evaluation_required')
    value=types.ModuleType('actual_partial_current_admission');value.__file__=str(PARENT);exec(compile(raw,str(PARENT),'exec'),value.__dict__);return value


def create():
    p=parent();h,original=p.create();n=types.ModuleType('source_only_completion_business')
    n.__dict__.update({**original.__dict__,'__file__':str(FILE),'FORMAT':FORMAT,'BASE':BASE,'RUNNER_SHA':own_sha()})
    # Function bodies are unchanged. New records live only under the new BASE.
    for name,fn in original.__dict__.items():
        if isinstance(fn,types.FunctionType)and fn.__globals__ is original.__dict__:
            copy=types.FunctionType(fn.__code__,n.__dict__,fn.__name__,fn.__defaults__,fn.__closure__);copy.__kwdefaults__=fn.__kwdefaults__;n.__dict__[name]=copy
    original_catalog=n.catalog_sql
    def catalog_sql(h,proposal,scope,*,inside=False):
        text=original_catalog(h,proposal,scope,inside=inside)
        if scope=='source':
            needle="SET LOCAL statement_timeout='5s';"
            need(text.count(needle)==1 and 'jit='not in text,'exact_frozen_source_catalog_timeout_before_jit_switch_required')
            text=text.replace(needle,'SET LOCAL jit=off;'+needle)
        return text
    n.catalog_sql=catalog_sql
    return h,n


def records(h,n):
    intent=n.saved(h,PARENT_BASE/'intent.json');op=n.saved(h,PARENT_BASE/'operational-result.json')
    prepared=n.saved(h,PARENT_BASE/'operational-prepared.json');commit=n.saved(h,PARENT_BASE/'operational-commit-intent.json')
    attempted=n.saved(h,PARENT_BASE/'operational-intent.json');source=n.saved(h,PARENT_BASE/'source-intent.json');failed=n.saved(h,PARENT_BASE/'failed.json')
    need(sha(h.read(PARENT_BASE/'operational-result.json',OPERATIONAL_RESULT_SHA))==OPERATIONAL_RESULT_SHA and
         intent['format']=='yunipals-arena-ypal-current-admission-v1'and intent['operatorSha256']==PARENT_SHA and
         intent['reviewHash']==h.sha(h.encoded({k:v for k,v in intent.items()if k!='reviewHash'}))and
         intent['proposalSha256']==PROPOSAL_SHA and intent['acknowledgedCurrentActors']==h.acknowledged(),
         'actual_immutable_parent_and_operational8_ACK_required')
    backend=prepared['catalog']['markers']
    need(prepared['format']==intent['format']and prepared['scope']=='operational'and len(prepared['roles'])==8 and
         commit=={'preparedSha256':h.sha(h.encoded(prepared)),'backendPid':backend['backendPid'],'backendStart':backend['backendStart']}and
         op['commitOutcome']=='commit_confirmed'and op['acknowledgement']=='explicit_commit_ack_and_fresh_catalog'and
         op['roles']==prepared['roles']and op['preparedSha256']==commit['preparedSha256']and op['sqlSha256']==h.PINS['operational-roles.current.sql.review']and
         attempted=={'format':intent['format'],'scope':'operational','sqlSha256':op['sqlSha256'],'reviewHash':intent['reviewHash']}and
         source=={'format':intent['format'],'scope':'source','sqlSha256':h.PINS['arena-ypal-native-v1.source.sql.review'],'reviewHash':intent['reviewHash']}and
         failed['format']==intent['format']and failed['commitOutcome']=='partial_or_unknown'and failed['acknowledgedDatabaseBoundaries']=={'operational':op}and
         failed['automaticRetryAllowed']is False,'exact_original_partial_boundary_chain_required')
    need(not any(os.path.lexists(PARENT_BASE/name)for name in ['source-prepared.json','source-commit-intent.json','source-result.json','result.json']),
         'parent_source_must_remain_intent_only_never_relabelled_complete')
    return {'intent':intent,'operational':op,'prepared':prepared,
            'parentIntentSha256':sha(h.read(PARENT_BASE/'intent.json')),'parentSourceIntentSha256':sha(h.read(PARENT_BASE/'source-intent.json')),
            'parentFailureSha256':sha(h.read(PARENT_BASE/'failed.json')),'operationalResultSha256':OPERATIONAL_RESULT_SHA}


def absent_source_backends(h):
    sql="BEGIN READ ONLY;SELECT count(*) FROM pg_stat_activity WHERE datid=17584 AND usename='postgres' AND application_name='arena_native_admission_commit';ROLLBACK;"
    need(h.run(h.peer_args(5432,'yunipals_backfill'),sql.encode()).strip()==b'0','all_original_fixed_source_commit_backends_must_be_gone')


def review(h,n):
    h.full_source();old=records(h,n);proposal=h.load_proposal()
    current=n.current_catalog(h,proposal,'operational');n.validate_catalog(h,proposal,'operational',current,old['operational']['roles'])
    need(n.graph(current)==n.graph(old['prepared']['catalog']),'actual_operational8_catalog_must_remain_exact')
    absent_source_backends(h);source=n.current_catalog(h,proposal,'source')
    need(len(source['roles'])==1 and source['roles'][0]['name']=='arena_native_reader'and source['roles'][0]['exists']is False and source['roles'][0]['oid']is None,
         'source_role_must_still_be_absent_before_new_attempt')
    context=h.context(proposal);need(context==old['intent']['context'],'same_acknowledged_current_source_and_eight_Arena_actors_required');h.full_source()
    binding={'format':FORMAT,'operatorSha256':own_sha(),'parentOperatorSha256':PARENT_SHA,'parentIntentSha256':old['parentIntentSha256'],
             'parentSourceIntentSha256':old['parentSourceIntentSha256'],'parentFailureSha256':old['parentFailureSha256'],
             'operationalResultSha256':OPERATIONAL_RESULT_SHA,'context':context,'sourceBeforeGraphSha256':h.sha(h.encoded(n.graph(source))),
             'sourceSqlSha256':h.PINS['arena-ypal-native-v1.source.sql.review'],'inspectionJitEnabled':False,'inspectionTimeoutSeconds':5,'DDLTimeoutSeconds':15}
    return proposal,{**binding,'reviewHash':h.sha(h.encoded(binding))}


def combined(h,n,operation,source):
    old=records(h,n);role_name=next(iter(source['roles']))
    return {'format':FORMAT,'operatorSha256':own_sha(),'completed':True,'commitOutcome':'commit_confirmed','parentOperatorSha256':PARENT_SHA,
            'parentIntentSha256':old['parentIntentSha256'],'parentSourceIntentSha256':old['parentSourceIntentSha256'],'parentFailureSha256':old['parentFailureSha256'],
            'operationalResultSha256':OPERATIONAL_RESULT_SHA,'sourceResultSha256':sha(h.read(BASE/'source-result.json')),
            'reviewHash':operation['reviewHash'],'roles':old['operational']['roles'],'sourceRole':{'name':role_name,'oid':source['roles'][role_name]},
            'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'proposalSha256':PROPOSAL_SHA,
            'sqlSha256':{'operational':old['operational']['sqlSha256'],'source':source['sqlSha256']},
            'perDatabase':{'operational':old['operational'],'source':source},'perDatabaseProducerSha256':{'operational':PARENT_SHA,'source':own_sha()},
            'releaseId':'0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3','sourceCatalogSha256':old['intent']['sourceAmbient']['sourceCatalogSha256'],
            'acknowledgedCurrentActors':h.acknowledged(),'oldWholeInvocationGatePassed':False,'databaseBoundariesAtomic':False,
            'loginChanges':0,'privateFileWrites':0,'serviceJobs':0,'schemaMigrations':0,'sourceSelectionsChanged':0,'automaticRetryAllowed':False,
            'inspectionJitEnabled':False,'inspectionTimeoutSeconds':5,'DDLTimeoutSeconds':15}


def acknowledgement(receipt_sha):
    h,n=create();result=json.loads(h.read(BASE/'result.json',receipt_sha));operation=n.saved(h,BASE/'operation.json');old=records(h,n)
    need(operation['format']==FORMAT and operation['operatorSha256']==own_sha()and
         operation['reviewHash']==h.sha(h.encoded({k:v for k,v in operation.items()if k!='reviewHash'}))and
         operation['parentIntentSha256']==old['parentIntentSha256']and operation['parentSourceIntentSha256']==old['parentSourceIntentSha256']and
         operation['parentFailureSha256']==old['parentFailureSha256']and operation['operationalResultSha256']==OPERATIONAL_RESULT_SHA and
         operation['context']==old['intent']['context']and operation['sourceSqlSha256']==h.PINS['arena-ypal-native-v1.source.sql.review'],
         'exact_new_source_only_operation_required')
    rehearsal=n.saved(h,BASE/'rehearsed.json');need(rehearsal['reviewHash']==operation['reviewHash']and rehearsal['rolledBack']is True and
         rehearsal['sourceRoleAbsentAfter']is True and rehearsal['sourceSqlSha256']==operation['sourceSqlSha256'],
         'actual_source_only_rollback_ACK_required')
    source=n.saved(h,BASE/'source-result.json');prepared=n.saved(h,BASE/'source-prepared.json');commit=n.saved(h,BASE/'source-commit-intent.json')
    backend=prepared['catalog']['markers'];attempted=n.saved(h,BASE/'source-intent.json')
    need(prepared['format']==FORMAT and prepared['scope']=='source'and len(prepared['roles'])==1 and
         commit=={'preparedSha256':h.sha(h.encoded(prepared)),'backendPid':backend['backendPid'],'backendStart':backend['backendStart']}and
         attempted=={'format':FORMAT,'scope':'source','sqlSha256':operation['sourceSqlSha256'],'reviewHash':operation['reviewHash']}and
         source['commitOutcome']=='commit_confirmed'and source['roles']==prepared['roles']and source['preparedSha256']==commit['preparedSha256']and
         source['sqlSha256']==operation['sourceSqlSha256']and result==combined(h,n,operation,source),'exact_new_source_prepared_COMMIT_and_combined_receipt_chain_required')
    return {'format':FORMAT+'-acknowledgement','validated':True,'recordedAdmissionQualified':True,'receiptSha256':receipt_sha,'operatorSha256':own_sha(),
            'roles':result['roles'],'sourceRole':result['sourceRole'],'currentRoleGraphQualified':False,'sourceActorQualified':False,
            'currentWriterQualified':False,'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def verify_current(receipt,*,phase='admitted',password_sha256=None):
    h,n=create();need(receipt==json.loads(h.read(BASE/'result.json')),'exact_new_combined9_receipt_required')
    acknowledgement(sha(h.read(BASE/'result.json')));proposal=h.load_proposal();old=records(h,n);summaries={}
    for scope in n.SCOPES:
        source=scope=='source';prepared=n.saved(h,(BASE if source else PARENT_BASE)/(scope+'-prepared.json'))
        roles={receipt['sourceRole']['name']:receipt['sourceRole']['oid']}if source else receipt['roles']
        current=n.current_catalog(h,proposal,scope);subset=None if password_sha256 is None else{name:password_sha256[name]for name in roles}
        summaries[scope]=n.validate_catalog(h,proposal,scope,current,roles,phase=phase,password_sha256=subset)
        need(n.graph(current)==n.expected_graph(prepared['catalog'],phase),'exact_current_combined9_role_graph_required')
    return {'validated':True,'phase':phase,'roleCount':9,'catalogs':summaries,'currentRoleGraphQualified':True,
            'sourceActorQualified':False,'currentWriterQualified':False,'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def validate_catalog_current(receipt_sha,*,phase='admitted',password_sha256=None):
    h,_=create();return verify_current(json.loads(h.read(BASE/'result.json',receipt_sha)),phase=phase,password_sha256=password_sha256)


def output(**v):print(json.dumps({'format':FORMAT,**v,'loginChanges':0,'privateFileWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True))
def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--review',action='store_true');g.add_argument('--rehearse');g.add_argument('--commit');g.add_argument('--reconcile',action='store_true');a=p.parse_args()
    if not any([a.review,a.rehearse,a.commit,a.reconcile]):output(sourceOnly=True,roleChanges=0,databaseWrites=0);return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main'and Path(__file__).absolute()==FILE,'fixed_source_completion_host_and_file_required')
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_source_completion_expired'));signal.alarm(300);h,n=create()
    if a.reconcile:
        need(not os.path.lexists(BASE/'result.json'),'source_completion_ACK_already_exists');h.full_source();operation=n.saved(h,BASE/'operation.json')
        old=records(h,n);proposal=h.load_proposal();prepared=n.saved(h,BASE/'source-prepared.json');commit=n.saved(h,BASE/'source-commit-intent.json')
        backend=prepared['catalog']['markers'];need(commit=={'preparedSha256':h.sha(h.encoded(prepared)),'backendPid':backend['backendPid'],'backendStart':backend['backendStart']},'owned_source_commit_intent_required')
        sql="BEGIN READ ONLY;SELECT count(*)FROM pg_stat_activity WHERE pid="+str(int(backend['backendPid']))+" AND backend_start::text='"+backend['backendStart'].replace("'","''")+"';ROLLBACK;"
        need(h.run(h.peer_args(5432,'yunipals_backfill'),sql.encode()).strip()==b'0','original_source_commit_backend_must_be_terminal')
        current=n.current_catalog(h,proposal,'source');n.validate_catalog(h,proposal,'source',current,prepared['roles']);need(n.graph(current)==n.graph(prepared['catalog']),'exact_new_source_postgraph_for_reconcile_required')
        source={'commitOutcome':'commit_confirmed','acknowledgement':'reconciled_exact_prepared_oids_and_acls_after_terminal_backend','roles':prepared['roles'],'preparedSha256':commit['preparedSha256'],'sqlSha256':operation['sourceSqlSha256']}
        if(BASE/'source-result.json').exists():
            prior=n.saved(h,BASE/'source-result.json');need(all(prior[k]==source[k]for k in ['commitOutcome','roles','preparedSha256','sqlSha256']),'existing_source_ACK_must_match_exactly');source=prior
        else:n.save(h,BASE/'source-result.json',source)
        h.full_source();result=combined(h,n,operation,source);n.save(h,BASE/'result.json',result);verify_current(result)
        output(completed=True,resultSha256=sha(h.read(BASE/'result.json')),reconciled=True);return
    proposal,binding=review(h,n)
    if a.review:
        need(not os.path.lexists(BASE),'fresh_source_only_completion_review_required');BASE.mkdir(mode=0o700);n.save(h,BASE/'review.json',binding)
        output(reviewed=True,reviewHash=binding['reviewHash'],roleChanges=0,databaseWrites=0);return
    need(n.saved(h,BASE/'review.json')==binding,'same_source_only_completion_review_required')
    raw=h.read(h.OPS/'arena-ypal-native-v1.source.sql.review',binding['sourceSqlSha256'])
    if a.rehearse:
        need(a.rehearse==binding['reviewHash']and not os.path.lexists(BASE/'rehearsal-intent.json'),'one_exact_source_only_rehearsal_required')
        n.save(h,BASE/'rehearsal-intent.json',{'reviewHash':a.rehearse,'commitAllowed':False})
        h.rollback_sql(raw);payload=raw[:-8]+n.catalog_sql(h,proposal,'source',inside=True).encode()+b'\nROLLBACK;\n'
        current=json.loads(h.run(h.peer_args(5432,'yunipals_backfill',write=True),payload,timeout=45));roles={r['name']:r['oid']for r in current['roles']}
        n.validate_catalog(h,proposal,'source',current,roles);need(review(h,n)[1]==binding,'source_role_or_original_context_changed_after_rollback')
        result={'reviewHash':binding['reviewHash'],'rolledBack':True,'sourceRoleAbsentAfter':True,'sourceSqlSha256':binding['sourceSqlSha256'],'temporaryCatalogSha256':h.sha(h.encoded(current))}
        n.save(h,BASE/'rehearsed.json',result);output(rehearsed=True,sourceRoleAbsentAfter=True,persistentRoleChanges=0);return
    need(a.commit==binding['reviewHash']and not os.path.lexists(BASE/'operation.json')and n.saved(h,BASE/'rehearsed.json')['reviewHash']==binding['reviewHash'],'one_exact_source13_commit_after_actual_rollback_required')
    n.save(h,BASE/'operation.json',binding)
    try:
        source=n.boundary(h,proposal,'source',raw,binding);h.full_source();result=combined(h,n,binding,source);n.save(h,BASE/'result.json',result);verify_current(result)
        output(completed=True,resultSha256=sha(h.read(BASE/'result.json')),roleCount=9,sourceRolesCreated=1,operationalSQLReplayed=False)
    except BaseException as error:
        n.save(h,BASE/'failed.json',{'format':FORMAT,'errorClass':type(error).__name__,'automaticRetryAllowed':False});raise


if __name__=='__main__':
    try:main()
    except BaseException as e:output(completed=False,errorClass=type(e).__name__,automaticRetryAllowed=False);raise SystemExit(1)
