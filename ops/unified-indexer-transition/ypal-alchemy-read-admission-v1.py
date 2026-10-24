#!/usr/bin/env python3
"""Current-source READ143 composition; exact old SQL/column/lifecycle bodies.

Only existing seven-role reads are admitted. No cache4, LOGIN, consumer selector,
service, provider or financial mutation is exposed by this owner.
"""
import ast
import copy
import hashlib
import contextlib
import io
import json
import os
import stat
import time
from pathlib import Path
import types

FORMAT='yunipals-ypal-alchemy-read-admission-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-alchemy-read-admission-v1.py'
OLD=OPS/'ypal-restored-read-admission-v1.py'
OLD_SHA='91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4'
INTAKE=OPS/'ypal-alchemy-consumer-current-context-v1.py'
INTAKE_SHA='70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420'
ARENA=OPS/'arena-ypal-source-completion-v1.py'
ARENA_SHA='2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6'
CREDENTIALS=OPS/'arena-ypal-current-credentials-v1.py'
CREDENTIALS_SHA='0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f'
ARENA_BASE=Path('/var/backups/yunipals-arena-ypal-source-completion-v1-20261024')
AUTH_BASE=Path('/var/backups/yunipals-arena-ypal-current-credentials-v1-20261024')
BASE=Path('/var/backups/yunipals-ypal-alchemy-read-admission-v1-20261024')
INPUT_BASE=Path('/var/backups/yunipals-ypal-alchemy-read-admission-input-v1-20261024')
INPUT=INPUT_BASE/'input.json'
PLAN=INPUT_BASE/'plan.json'
FEATURES=[Path('/var/backups/yunipals-ypal-feature-handover-v1-20261024'),Path('/var/backups/yunipals-ypal-restored-feature-handover-v1-20261024')]
FRESH='yunipals-booster-ypal-source.service'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def own_sha():return sha(Path(__file__).read_bytes())
def load(path,pin):
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not p.is_symlink()and not s.st_mode&0o022,'protected_current_read_source_required')
    raw=path.read_bytes();need(len(raw)<200000 and sha(raw)==pin,'exact_current_read_source_before_evaluation_required')
    value=types.ModuleType('current_read_'+path.stem);value.__file__=str(path);exec(compile(raw,str(path),'exec'),value.__dict__);return value


def arena(config,n):
    need(set(config)=={'receiptSha256','phase','setupSha256','authSha256'} and n.pin(config['receiptSha256'])and
         config['phase']in{'admitted','passwords','login'},'actual_current_Arena_admission_and_explicit_auth_phase_required')
    helper=load(ARENA,ARENA_SHA);ack=helper.acknowledgement(config['receiptSha256'])
    receipt=n.document(ARENA_BASE/'result.json',config['receiptSha256']);passwords=None
    need(ack['validated']is ack['recordedAdmissionQualified']is True and ack['sourceActorQualified']is ack['currentWriterQualified']is False and
         receipt['operatorSha256']==ARENA_SHA,'new_current_Arena_receipt_not_old_5439_required')
    if config['phase']=='admitted':
        need(config['setupSha256']is config['authSha256']is None,'initial_NOLOGIN_phase_has_no_credential_claim')
    else:
        need(n.pin(config['setupSha256']),'actual_current_Arena_setup_ACK_required')
        credentials=load(CREDENTIALS,CREDENTIALS_SHA);setup=n.document(AUTH_BASE/'setup-result.json',config['setupSha256'])
        need(setup['format']==credentials.FORMAT and setup['operatorSha256']==CREDENTIALS_SHA and
             setup['admissionResultSha256']==config['receiptSha256'] and setup['roles']==receipt['roles'] and
             setup['sourceRole']==receipt['sourceRole'] and setup['credentialsConfigured']is True and setup['loginEnabled']is False,
             'exact_current_Arena_password_setup_chain_required')
        passwords=setup['passwordVerifierSha256']
        if config['phase']=='passwords':need(config['authSha256']is None,'password_only_phase_cannot_claim_LOGIN')
        else:
            need(n.pin(config['authSha256']),'actual_current_Arena_TCP_auth_ACK_required')
            auth=n.document(AUTH_BASE/'auth-result.json',config['authSha256']);login=n.document(AUTH_BASE/'login-result.json')
            need(auth['format']==credentials.AUTH_FORMAT and auth['operatorSha256']==CREDENTIALS_SHA and
                 auth['admissionResultSha256']==config['receiptSha256'] and auth['admissionHelperSha256']==ARENA_SHA and
                 auth['setupResultSha256']==config['setupSha256'] and auth['roles']==receipt['roles'] and auth['sourceRole']==receipt['sourceRole'] and
                 auth['credentialFiles']==setup['credentialFiles'] and auth['grantsVerified']is auth['tcpAuthenticationProven']is auth['loginEnabled']is True and
                 login['setupResultSha256']==config['setupSha256'] and login['loginEnabled']is True,
                 'exact_current_Arena_LOGIN_and_TCP_auth_chain_required')
        # Revalidate actual generated files and inodes via unchanged30a methods.
        credential_ns=credentials.build();rows=credential_ns.specs(json.loads(n.protected(helper.PROPOSAL,helper.PROPOSAL_SHA)),receipt)
        operator=credential_ns.Operator(None,{}, {},receipt,rows,AUTH_BASE);operator.files(setup)
    verified=helper.verify_current(receipt,phase=config['phase'],password_sha256=passwords)
    need(verified['validated']is verified['currentRoleGraphQualified']is True and verified['roleCount']==9 and
         verified['catalogs']['source']['requiredEdges']==13,'actual_current_nine_roles_and13_source_reads_required')
    h,business=helper.create();proposal=h.load_proposal();catalog=business.current_catalog(h,proposal,'source')
    role=receipt['sourceRole'];edges=[]
    for edge in catalog['roles'][0]['directRelationAcl']:
        if edge['granteeOid']!=role['oid']:continue
        relation=next(row for row in catalog['relations']if row['name']==edge['relation'])
        edges.append({'kind':'relation','object':str(relation['oid']),'object_name':relation['name'],'grantee':str(edge['granteeOid']),
                      'grantor':str(edge['grantorOid']),'privilege':edge['privilege'],'grantable':edge['grantOption'],'column_number':None})
    need(len(edges)==13 and all(row['privilege']=='SELECT'and row['grantable']is False for row in edges),
         'exact_thirteen_current_Arena_relation_edges_required')
    return {'validated':True,'file':str(ARENA_BASE/'result.json'),'sha256':config['receiptSha256'],'operatorSha256':ARENA_SHA,
            'sourceRole':role,'phase':config['phase'],'setupSha256':config['setupSha256'],'authSha256':config['authSha256'],
            'ownedSourceReadEdges':sorted(edges,key=encoded),'sourceActorQualified':False,'currentWriterQualified':False,
            'originalWholeValidatorPassed':False}


def arena_in_catalog(catalog,proof):
    keys=('kind','object','object_name','grantee','grantor','privilege','grantable')
    key=lambda row:tuple(str(row[k])for k in keys)
    need(proof['validated']is True and len(proof['ownedSourceReadEdges'])==13 and catalog['databaseOid']=='17584' and
         all(key(row)in{key(edge)for edge in catalog['targetEdges']}for row in proof['ownedSourceReadEdges']),
         'actual_Arena13_must_precede_current_READ143_baseline')


def namespace():
    load(OLD,OLD_SHA);raw=OLD.read_bytes();need(sha(raw)==OLD_SHA,'exact_91b_bytes_before_current_namespace_compilation_required');tree=ast.parse(raw)
    values={'FORMAT':repr(FORMAT),'BASE':'Path('+repr(str(BASE))+')','INPUT_BASE':'Path('+repr(str(INPUT_BASE))+')',
            'PLAN':'Path('+repr(str(PLAN))+')','CONTEXT':'Path('+repr(str(FILE))+')',
            'CONTEXT_SHA':'hashlib.sha256(Path(__file__).read_bytes()).hexdigest()'}
    changed=[]
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in values:
            key=node.targets[0].id;node.value=ast.parse(values[key],mode='eval').body;changed.append(key)
    need(set(changed)==set(values)and len(changed)==len(values),'exact_six_current_READ_identity_constants_required')
    ast.fix_missing_locations(tree);n=types.ModuleType('current_READ143_business');n.__file__=str(Path(__file__).absolute());exec(compile(tree,n.__file__,'exec'),n.__dict__)
    original_host=n.Host
    class Host(original_host):
        def __init__(self,context_input,plan_sha=None,inverse=False):
            need(n.pin(context_input),'actual_current_READ_context_input_SHA_required')
            self.context_input=context_input;self.input=n.document(INPUT,context_input)
            need(set(self.input)=={'format','arenaAdmission'}and self.input['format']==FORMAT+'-input','exact_current_READ_input_required')
            self.intake=load(INTAKE,INTAKE_SHA);self.context=self.intake
            self.parts=self.intake.historical_components()['components'];self.helpers=self.parts['historicalReadHelpers']
            self.primitives=self.parts['privilegedSourcePrimitives'];self.h=self.primitives['host'];self.inverse_mode=inverse
            self.static=n.module(n.STATIC,n.STATIC_SHA);self.columns=n.protected(n.COLUMNS,n.COLUMNS_SHA).decode().strip()
            self.sql=n.combined_sql(self.parts['catalogSql'],self.columns);self.plan_sha=plan_sha
            self.plan=None if plan_sha is None else n.validate_plan(self.parts,n.document(PLAN,plan_sha))
            if self.plan:need(self.plan['contextInputSha256']==context_input,'same_actual_current_READ_input_required')
        def runtime(self):return self.intake.validate_runtime()
        def consumers(self):
            helper=self.intake.module(OPS/'ypal-combined-read-admission-v2.py','c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd')
            sdk=self.primitives['sdk'];return helper.consumer_frame(types.SimpleNamespace(m=types.SimpleNamespace(run=sdk.command,protected=sdk.protected)))
        def pack_initial(self):
            c=self.intake._completion();c.h.source.pack_ready();first=c.owner.c.peers()
            need(c.owner.c.peers()==first,'actual_current_pack_actor_private_definitions_boot_CAS_required');return first
        def arena(self):return arena(self.input['arenaAdmission'],n)
        def stable(self):
            return {'runtime':self.runtime(),'consumers':self.consumers(),'temporaryPackInitial':self.pack_initial(),
                    'arenaAdmission':self.arena()}
        def inverse_source(self,before):
            expected=before['stable']['runtime'];c=self.intake._completion();raw=c.h.source.actor(self.intake.UNIT,True)
            if raw is not None:
                value=self.runtime();need(value==expected,'same_acknowledged_paid_source_for_initial_READ_inverse_required');return value
            c.loaded('paid');need(c.h.source.inputs()==c.owner.operation()['inputs'],'same_terminal_source_private_inputs_required')
            for row in expected['source']['processes']:
                try:text=(Path('/proc')/str(row['pid'])/'stat').read_text()
                except(FileNotFoundError,ProcessLookupError):continue
                need(int(text[text.rfind(')')+2:].split()[19])!=row['startTicks'],'owned_source_process_epoch_must_be_gone')
            native=c.h.source.native()
            need(native['schemaOid']==expected['schemaOid']and native['tables']==expected['nativeTableIdentities']and
                 native['cache']==expected['syncCacheIdentity']and native['app']['build_id']==expected['buildId'],
                 'same_terminal_source_native44_cache_build_required')
            peers=c.owner.c.peers();actors={FRESH:peers['actors'][FRESH]}
            c.c.host_module.kernel_backends(c.h.source.query,c.h.observer,73004621,actors,{FRESH:(970,964)},True)
            need(c.h.source.actor(self.intake.UNIT,True)is None,'source_reappeared_during_initial_READ_inverse')
            return {'validated':True,'recordedSource':expected['source'],'sourceTerminalQualified':True,
                    'sourceActorQualified':False,'currentWriterQualified':False,'financialAuthorityQualified':False,
                    'originalWholeValidatorPassed':False,'frameworkReadinessQualified':False}
    n.Host=Host
    def fresh_plan(host):
        need(not any(os.path.lexists(path)for path in FEATURES),'Arena_and_READ_baseline_must_precede_feature_operation')
        first=host.stable();qualified=host.arena();current=host.catalog();arena_in_catalog(current['read'],qualified)
        need(host.stable()==first and host.arena()==qualified,'same_current_source_Arena_and_consumers_for_READ_baseline')
        plan=copy.deepcopy(host.parts['historicalReadPlan'])
        plan.update({'format':FORMAT+'-plan','historicalPlanSha256':n.HISTORICAL_SHA,'contextOperatorSha256':n.CONTEXT_SHA,
                     'contextInputSha256':host.context_input,'contextReviewHash':sha(encoded({'runtime':first['runtime'],'arena':qualified})),
                     'arenaAdmission':qualified,'baselineCatalog':current['read'],'catalogBefore':current,'columnsSqlSha256':n.COLUMNS_SHA,
                     'operatorSha256':n.own_sha(),'bootId':n.boot(),'stable':first,'sourceIntakeProducerSha256':INTAKE_SHA})
        plan['planReviewHash']=n.sha(n.encoded(plan));n.validate_plan(host.parts,plan);return plan
    def capture_plan(host,expected):
        value=fresh_plan(host)
        info=INPUT_BASE.lstat()
        need(value['planReviewHash']==expected and info.st_uid==info.st_gid==0 and stat.S_ISDIR(info.st_mode)and
             stat.S_IMODE(info.st_mode)==0o700 and not os.path.lexists(PLAN),'fresh_exact_current_READ_plan_capture_required')
        n.save(PLAN,value);return {'captured':True,'planSha256':sha(n.protected(PLAN)),'newRoles':0,'databaseWrites':0}
    def review(host):
        need(host.plan is not None and host.plan['bootId']==n.boot()and host.plan['operatorSha256']==n.own_sha(),'same_boot_current_READ_producer_plan_required')
        stable=host.stable();before=host.catalog()
        need(before==host.plan['catalogBefore']and stable==host.plan['stable']and host.stable()==stable,
             'exact_current_plan_catalog_private_actors_required')
        need(host.arena()==host.plan['arenaAdmission'],'same_current_Arena13_before_READ_operation_required')
        value={'format':FORMAT,'operatorSha256':n.own_sha(),'bootId':n.boot(),'planSha256':host.plan_sha,'contextInputSha256':host.context_input,
               'stable':stable,'catalogBefore':before,'readEdgeCount':143,'loginChanges':0,'newDml':0,'serviceActions':0}
        return {**value,'reviewHash':n.sha(n.encoded(value))}
    def inverse_stable(host,before):
        need(host.consumers()==before['stable']['consumers']and host.pack_initial()==before['stable']['temporaryPackInitial'],
             'same_initial_consumer_and_pack_actors_for_owned_READ_inverse_required')
        return host.inverse_source(before)
    n.fresh_plan=fresh_plan;n.capture_plan=capture_plan;n.review=review;n.inverse_stable=inverse_stable
    return n


def validate_receipt(receipt_sha):return namespace().validate_receipt(receipt_sha)
def validate_catalog_current(receipt_sha):return namespace().validate_catalog_current(receipt_sha)
def validate_current(receipt_sha,plan_sha=None,context_input=None):return namespace().validate_current(receipt_sha,plan_sha,context_input)


def acknowledgement(receipt_sha):
    """Immutable journal/SQL-delta ancestry, with no Host/DB/current writer call."""
    n=namespace();receipt=n.document(BASE/'result.json',receipt_sha)
    need(receipt['format']==FORMAT and receipt['operatorSha256']==n.own_sha(),'actual_current_READ_producer_ACK_required')
    plan=n.document(PLAN,receipt['planSha256']);config=n.document(INPUT,receipt['contextInputSha256'])
    helpers=n.module(OPS/'ypal-combined-read-admission-v2.py','c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd')
    historical=n.document(Path('/var/backups/yunipals-ypal-combined-read-admission-input-v1-20261024/plan.json'),n.HISTORICAL_SHA)
    n.validate_plan({'historicalReadPlan':historical,'historicalReadHelpers':helpers,
                     'catalogSqlSha256':'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991'},plan)
    need(config['format']==FORMAT+'-input' and plan['contextInputSha256']==receipt['contextInputSha256'] and
         plan['sourceIntakeProducerSha256']==INTAKE_SHA,'actual_current_READ_input_and_source_ancestry_required')
    host=types.SimpleNamespace(plan=plan,plan_sha=receipt['planSha256'],context_input=receipt['contextInputSha256'],helpers=helpers)
    value,before,rehearsal=n.admitted(host,receipt_sha)
    return {'format':FORMAT+'-acknowledgement','validated':True,'immutableAdmissionOnly':True,
            'receiptSha256':receipt_sha,'operatorSha256':n.own_sha(),'planSha256':host.plan_sha,'contextInputSha256':host.context_input,
            'recordedSourceBinding':before['stable']['runtime'],'arenaAdmission':plan['arenaAdmission'],
            'catalogAfterSha256':value['catalogAfterSha256'],'readEdgeCount':143,
            'currentRoleGraphQualified':False,'sourceActorQualified':False,'currentWriterQualified':False,
            'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def main():
    import sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'readEdgeCount':143,'newRoles':0,'loginChanges':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    n=namespace();output=io.StringIO()
    try:
        with contextlib.redirect_stdout(output):n.main()
        value=json.loads(output.getvalue())
    except BaseException as error:
        value={'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'automaticRetryAllowed':False}
        raise
    finally:
        # Raw plans/catalogs never leave the host. Preserve each result/refusal
        # in this input operation's protected evidence, outside the single-use
        # admission BASE, so read-only reviews do not create an admission ACK.
        if INPUT_BASE.is_dir():
            evidence=INPUT_BASE/'observations'
            if not evidence.exists():evidence.mkdir(mode=0o700)
            info=evidence.lstat();need(info.st_uid==info.st_gid==0 and stat.S_ISDIR(info.st_mode)and
                 stat.S_IMODE(info.st_mode)==0o700,'root_private_current_READ_observations_required')
            name=str(time.time_ns())+'-'+str(os.getpid())+'.json'
            n.save(evidence/name,{'stdout':output.getvalue(),'aggregate':{k:v for k,v in value.items()if k in{
                'format','completed','errorClass','automaticRetryAllowed','planReviewHash','reviewHash','planSha256','admitted','captured','rehearsed','commitOutcome'}}})
    allowed={'format','completed','planReviewHash','reviewHash','planSha256','contextInputSha256','admitted','captured',
             'rehearsed','databaseCommitted','commitOutcome','readEdgeCount','loginChanges','newRoles','newDml','serviceActions'}
    print(json.dumps({**{k:v for k,v in value.items()if k in allowed},'privateResultSha256':sha(output.getvalue().encode()),
                      'rawCatalogExported':False,'providerCalls':0},sort_keys=True))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
