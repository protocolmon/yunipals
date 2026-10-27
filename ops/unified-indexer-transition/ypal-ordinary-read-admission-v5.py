#!/usr/bin/env python3
"""Equivalent existing-role logical reads on V5; retain actual READ143 ancestry."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import types

FORMAT='yunipals-ypal-ordinary-read-admission-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-read-admission-v5-20261025')
INPUT_BASE=Path('/var/backups/yunipals-ypal-ordinary-read-input-v5-20261025')
INPUT=INPUT_BASE/'input.json'
PLAN=INPUT_BASE/'plan.json'
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
CREATOR=OPS/'ypal-ordinary-readview-v5.py'
CREATOR_SHA='1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2'
TEMPLATE=OPS/'ypal-restored-read-admission-v1.py'
TEMPLATE_SHA='91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4'
HELPERS=OPS/'ypal-combined-read-admission-v2.py'
HELPERS_SHA='c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
CATALOG=OPS/'ypal-combined-read-admission-v1.catalog.sql'
CATALOG_SHA='cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991'
BASELINE=OPS/'ypal-alchemy-read-admission-v1.py'
BASELINE_SHA='c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a'
BASELINE_BASE=Path('/var/backups/yunipals-ypal-alchemy-read-admission-v1-20261024')
OLD_READ='yunipals_ownership_4e77f52b_v4'
READ='yunipals_ownership_4e77f52b_v5'
IDENTITY='0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab'
RUNTIME=OPS/'ypal-alchemy-ordinary-runtime-v1.py'
RUNTIME_SHA='3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64

def intake():
    import stat
    for p in [*INTAKE.parents,INTAKE]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_V5_read_intake_required')
    raw=INTAKE.read_bytes();need(len(raw)<200000 and sha(raw)==INTAKE_SHA,'exact_V5_read_intake_required')
    n=types.ModuleType('V5_read_intake');n.__file__=str(INTAKE);exec(compile(raw,str(INTAKE),'exec'),n.__dict__);return n


def checked_input(value):
    need(type(value)is dict and set(value)=={'format','ordinaryRuntime','baselineReadAdmissionSha256','createdReceiptSha256'}and value['format']==FORMAT+'-input'and
         type(value['ordinaryRuntime'])is dict and set(value['ordinaryRuntime'])=={'resultSha256','inputSha256'}and
         all(pin(v)for v in value['ordinaryRuntime'].values())and pin(value['baselineReadAdmissionSha256'])and pin(value['createdReceiptSha256']),
         'actual_ordinary_V5_creator_and_baseline_READ_refs_required');return value


def enhanced_catalog(raw):
    old="'"+OLD_READ+"'";new=old+",'"+READ+"'"
    need(raw.count(old)==4 and raw.count('n.nspname='+old)==1,'exact_four_V5_catalog_namespace_seams_required')
    text=raw.replace('n.nspname='+old,'n.nspname IN('+new+')')
    # Three IN lists, while the fourth occurrence is already in the new function list.
    text=text.replace('IN(\'unified_ypal_20261023_v1\','+old,'IN(\'unified_ypal_20261023_v1\','+new)
    clause="has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')END"
    need(text.count(clause)==1,'one_effective_relation_column_write_negative_required')
    return text.replace(clause,"(has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')OR(c.nspname='"+READ+"'AND has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))END")


def prior_graph(before):
    result=copy.deepcopy(before);read=result['read']
    objects={str(row['oid'])for row in read['relations']if row['schema']==READ}
    read['schemas']=[row for row in read['schemas']if row['name']!=READ]
    for key in ['relations','functions']:read[key]=[row for row in read[key]if row['schema']!=READ]
    for key in ['directRoleEdges','targetEdges']:read[key]=[row for row in read[key]if not(row['object_name']==READ or row['object_name'].startswith(READ+'.'))]
    for role in read['effective']:
        for key in ['schemas','relations','functions']:role[key]={name:value for name,value in role[key].items()if not(name==READ or name.startswith(READ+'.'))}
    result['allColumnAcl']=[row for row in result['allColumnAcl']if str(row['relation'])not in objects]
    return result


def logical_edges(before,roles,acknowledged_before):
    """Map only acknowledged old logical reads to same actual V5 objects."""
    read=before['read'];targets={('schema',row['name']):(row['oid'],row['owner'])for row in read['schemas']}
    targets.update({('relation',row['schema']+'.'+row['name']):(row['oid'],row['owner'])for row in read['relations']})
    targets.update({('function',row['schema']+'.'+row['name']+'('+row['arguments']+')'):(row['oid'],row['owner'])for row in read['functions']})
    by_oid={str(oid):name for name,oid in roles.items()};rows=[]
    # Only the immutable c2da postgraph can define which V4 logical reads were
    # authorized. A racing V4 grant/revoke may not become our new plan baseline.
    for edge in acknowledged_before['read']['directRoleEdges']:
        name=edge['object_name'];grantee=str(edge['grantee'])
        if grantee not in by_oid or not(name==OLD_READ or name.startswith(OLD_READ+'.')):continue
        kind=edge['kind'];privilege=edge['privilege']
        need((kind,privilege)in{('schema','USAGE'),('relation','SELECT'),('function','EXECUTE')}and edge['grantable']is False and str(edge['grantor'])=='10'and edge['column_number']is None,
             'only_original_owner_granted_non_grantable_logical_reads_may_be_copied')
        wanted=READ+name[len(OLD_READ):];need((kind,wanted)in targets,'same_named_actual_V5_object_required')
        oid,owner=targets[(kind,wanted)];need(str(owner)=='10','actual_postgres_owned_V5_objects_required')
        rows.append({'kind':kind,'object':str(oid),'name':wanted,'role':by_oid[grantee],'grantee':grantee,'grantor':'10','privilege':privilege})
    rows=sorted(rows,key=encoded)
    need(0<len(rows)<=143 and len({(r['kind'],r['object'],r['grantee'],r['privilege'])for r in rows})==len(rows),'finite_unique_same_role_V5_read_closure_required')
    effective={r['role']:r for r in read['effective']}
    for r in rows:
        role=effective[r['role']]
        missing=not(role['schemas'][r['name']]['usage']if r['kind']=='schema'else role['relations'][r['name']]['select']if r['kind']=='relation'else role['functions'][r['name']])
        need(missing and not any(e['kind']==r['kind']and str(e['object'])==r['object']and str(e['grantee'])==r['grantee']and e['privilege']==r['privilege']for e in read['targetEdges']),
             'each_new_logical_read_must_be_missing_before_admission')
    for role in effective.values():
        need(not role['schemas'][READ]['create']and not any(v['writes']for name,v in role['relations'].items()if name.startswith(READ+'.')),
             'V5_effective_table_and_column_writes_must_be_absent')
    return rows

def recorded_baseline(n,i,receipt_sha):
    ack=i.read_acknowledgement(receipt_sha)
    receipt=n.document(BASELINE_BASE/'result.json',receipt_sha)
    after=n.document(BASELINE_BASE/'rehearsed.json',receipt['rehearsalSha256'])['after']
    need(ack['operatorSha256']==BASELINE_SHA and ack['catalogAfterSha256']==sha(encoded(after)),
         'actual_c2da_recorded_rehearsal_postgraph_required');return ack,after


def namespace():
    i=intake();f=i.module(FACTORY,FACTORY_SHA);helpers=f.namespace(i.protected(HELPERS,HELPERS_SHA),HELPERS_SHA,HELPERS,{'READ_SCHEMA':READ})
    raw_catalog=i.protected(CATALOG,CATALOG_SHA).decode().strip();sql=enhanced_catalog(raw_catalog)
    # Only edge-count reporting is dynamic; all COMMIT/rollback/delta/unknown
    # ACK/reconciliation/inverse bodies remain in their own new globals.
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name in{'acknowledge','admitted','validate_receipt','validate_catalog_current'}:
            expression="parts['plan']['missingCount']"if node.name.startswith('validate_')else"host.plan['missingCount']"
            class Counts(ast.NodeTransformer):
                def visit_Constant(self,v):return ast.copy_location(ast.parse(expression,mode='eval').body,v)if type(v.value)is int and v.value==143 else v
            node=Counts().visit(node)
            if node.name=='acknowledge':
                values=[v for v in node.body if isinstance(v,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='result'for t in v.targets)]
                need(len(values)==1 and isinstance(values[0].value,ast.Dict),'single_new_V5_admission_ACK_required')
                for key,expression in {'baselineReadAdmissionSha256':"host.input['baselineReadAdmissionSha256']",'createdReceiptSha256':"host.input['createdReceiptSha256']",'baselineReadEdgeCount':'143','nativeRegrants':'0'}.items():
                    values[0].value.keys.append(ast.Constant(key));values[0].value.values.append(ast.parse(expression,mode='eval').body)
        if isinstance(node,ast.ClassDef)and node.name=='Host':
            for v in ast.walk(node):
                if isinstance(v,ast.Constant)and isinstance(v.value,str)and v.value.startswith('-c statement_timeout=30000 '):v.value+=' -c jit=off'
        return node
    n=f.namespace(i.protected(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,Path(__file__).absolute(),{'FORMAT':FORMAT,'BASE':BASE,'INPUT_BASE':INPUT_BASE,'PLAN':PLAN},transform=transform)
    old_host=n.Host
    class Host(old_host):
        def __init__(self,input_sha,plan_sha=None,inverse=False):
            self.context_input=input_sha;self.input=checked_input(n.document(INPUT,input_sha));self.inverse_mode=inverse;self.plan_sha=plan_sha
            self.creator=i.module(CREATOR,CREATOR_SHA);self.created=self.creator.acknowledgement(self.input['createdReceiptSha256'])
            self.baseline,self.baseline_after=recorded_baseline(n,i,self.input['baselineReadAdmissionSha256'])
            self.parts=i.query_components()['components'];self.primitives=self.parts['privilegedSourcePrimitives'];self.h=self.primitives['host'];self.helpers=helpers
            self.sql=n.combined_sql(sql,n.protected(n.COLUMNS,n.COLUMNS_SHA).decode().strip())
            self.plan=None if plan_sha is None else validate_plan(self,n.document(PLAN,plan_sha))
        def runtime(self):
            refs=self.input['ordinaryRuntime'];return i.validate_runtime(refs['resultSha256'],refs['inputSha256'])
        def consumers(self):
            sdk=self.primitives['sdk'];return helpers.consumer_frame(types.SimpleNamespace(m=types.SimpleNamespace(run=sdk.command,protected=sdk.protected)))
        def stable(self):return {'runtime':self.runtime(),'consumers':self.consumers(),'created':self.creator.data_current(self.input['createdReceiptSha256']),
            'baselineReadAdmissionSha256':self.input['baselineReadAdmissionSha256']}
        def pack_initial(self):raise RuntimeError('V5_logical_READ_does_not_claim_pack_lifecycle_authority')
    n.Host=Host
    def validate_plan(host,p):
        need(p['format']==FORMAT+'-plan'and p['operatorSha256']==n.own_sha()and p['contextInputSha256']==host.context_input and p['input']==host.input and
             p['createdReceiptSha256']==host.input['createdReceiptSha256']and p['baselineReadAdmissionSha256']==host.input['baselineReadAdmissionSha256']and
             p['readSchema']==READ and p['readSchemaOid']==host.created['schemaOid']and p['readIdentity']==IDENTITY and
             p['catalogSqlSha256']==sha(sql.encode())and p['columnsSqlSha256']==n.COLUMNS_SHA and p['catalogBefore']['read']==p['baselineCatalog']and
             p['missingPermissions']==logical_edges(p['catalogBefore'],helpers.ROLE_OIDS,host.baseline_after)and p['missingCount']==len(p['missingPermissions'])and
             p['newRoles']==p['loginChanges']==p['newDml']==0 and p['planReviewHash']==sha(encoded({k:v for k,v in p.items()if k!='planReviewHash'})),
             'exact_actual_same_role_logical_V5_plan_and_catalog_required')
        need({r['name']:r['oid']for r in p['baselineCatalog']['roles']}==helpers.ROLE_OIDS,'same_seven_existing_role_OIDs_required')
        need(n.graph(prior_graph(p['catalogBefore']))==n.graph(host.baseline_after),'complete_acknowledged_c2da_graph_must_match_captured_pre_V5_baseline')
        target=p['catalogBefore']['read'];oids={str(row['oid'])for row in target['relations']if row['schema']==READ}
        need(all(str(edge['grantee'])==str(edge['grantor'])=='10'for edge in target['targetEdges']if edge['object_name']==READ or edge['object_name'].startswith(READ+'.'))and
             not any(str(edge['grantee'])!='10'for row in p['catalogBefore']['allColumnAcl']if str(row['relation'])in oids for edge in row['edges']),
             'fresh_V5_target_must_retain_creator_owner_only_ACLs_before_admission')
        n.validate_column_overlap(p,p['catalogBefore']);helpers.statements(p);return p
    def fresh_plan(host):
        # The old exact graph is checked only before this new delta. Afterwards
        # it remains immutable ancestry; our own full postgraph is authoritative.
        i.read_catalog_current(host.input['baselineReadAdmissionSha256']);first=host.stable();before=host.catalog()
        edges=logical_edges(before,helpers.ROLE_OIDS,host.baseline_after);need(host.stable()==first,'current_source_or_consumers_changed_before_V5_plan')
        p={'format':FORMAT+'-plan','operatorSha256':n.own_sha(),'bootId':n.boot(),'contextInputSha256':host.context_input,'input':host.input,
           'baselineReadAdmissionSha256':host.input['baselineReadAdmissionSha256'],'createdReceiptSha256':host.input['createdReceiptSha256'],
           'readSchema':READ,'readSchemaOid':host.created['schemaOid'],'readIdentity':IDENTITY,'baselineCatalog':before['read'],'catalogBefore':before,
           'catalogSqlSha256':sha(sql.encode()),'columnsSqlSha256':n.COLUMNS_SHA,'missingPermissions':edges,'missingCount':len(edges),
           'newRoles':0,'loginChanges':0,'newDml':0,'stable':first}
        p['planReviewHash']=sha(encoded(p));return validate_plan(host,p)
    def capture_plan(host,expected):
        p=fresh_plan(host);s=INPUT_BASE.lstat()
        need(p['planReviewHash']==expected and s.st_uid==s.st_gid==0 and s.st_mode&0o777==0o700 and not os.path.lexists(PLAN),'fresh_exact_V5_plan_capture_required')
        n.save(PLAN,p);return {'captured':True,'planSha256':sha(n.protected(PLAN)),'readEdgeCount':p['missingCount'],'newRoles':0,'databaseWrites':0}
    def review(host):
        need(host.plan is not None and host.plan['bootId']==n.boot(),'same_boot_V5_plan_required');stable=host.stable();before=host.catalog()
        need(before==host.plan['catalogBefore']and stable==host.plan['stable']and host.stable()==stable,'same_exact_V5_catalog_source_and_consumer_review_required')
        value={'format':FORMAT,'operatorSha256':n.own_sha(),'bootId':n.boot(),'planSha256':host.plan_sha,'contextInputSha256':host.context_input,
               'stable':stable,'catalogBefore':before,'readEdgeCount':host.plan['missingCount'],'baselineReadEdgeCount':143,'loginChanges':0,'newDml':0,'serviceActions':0}
        return {**value,'reviewHash':sha(encoded(value))}
    def inverse_stable(host,before):
        need(host.consumers()==before['stable']['consumers']and host.creator.data_current(host.input['createdReceiptSha256'])==before['stable']['created'],
             'same_original_consumers_and_V5_objects_for_owned_inverse_required')
        refs=host.input['ordinaryRuntime'];runtime=i.module(RUNTIME,RUNTIME_SHA);owner=runtime.Owner(refs['inputSha256'])
        if owner.h.source.state(runtime.SOURCE)['MainPID']!='0':
            proof=host.runtime();need(proof==before['stable']['runtime'],'same_actual_ordinary_writer_before_V5_inverse_required');return proof
        proof=runtime.validate_current_source(refs['resultSha256'],refs['inputSha256'],inverse=True)
        need(proof['validated']is proof['terminalInverseOnly']is True and proof['sourceState']=='owned-terminal'and proof['currentWriterQualified']is False,
             'actual_ordinary_owned_terminal_inverse_source_required');return proof
    n.validate_plan=lambda parts,p:validate_plan(parts,p)
    n.fresh_plan=fresh_plan;n.capture_plan=capture_plan;n.review=review;n.inverse_stable=inverse_stable
    return n

def acknowledgement(receipt_sha):
    """Immutable baseline143 + exact new logical delta, without a Host or DB."""
    need(pin(receipt_sha),'actual_V5_logical_admission_ACK_required');n=namespace();i=intake();receipt=n.document(BASE/'result.json',receipt_sha)
    plan=n.document(PLAN,receipt['planSha256']);config=checked_input(n.document(INPUT,receipt['contextInputSha256']))
    baseline,after=recorded_baseline(n,i,config['baselineReadAdmissionSha256']);creator=i.module(CREATOR,CREATOR_SHA).acknowledgement(config['createdReceiptSha256'])
    helper=i.module(FACTORY,FACTORY_SHA).namespace(i.protected(HELPERS,HELPERS_SHA),HELPERS_SHA,HELPERS,{'READ_SCHEMA':READ})
    host=types.SimpleNamespace(input=config,context_input=receipt['contextInputSha256'],plan_sha=receipt['planSha256'],
       baseline=baseline,baseline_after=after,created=creator,helpers=helper)
    host.plan=n.validate_plan(host,plan);value,before,rehearsal=n.admitted(host,receipt_sha)
    need(value['baselineReadAdmissionSha256']==config['baselineReadAdmissionSha256']and value['createdReceiptSha256']==config['createdReceiptSha256']and
         value['baselineReadEdgeCount']==143 and value['nativeRegrants']==0,'explicit_baseline143_and_only_new_logical_delta_provenance_required')
    return {'format':FORMAT+'-acknowledgement','validated':True,'immutableAdmissionOnly':True,'receiptSha256':receipt_sha,'operatorSha256':n.own_sha(),
       'planSha256':host.plan_sha,'contextInputSha256':host.context_input,'readEdgeCount':plan['missingCount'],'baselineReadEdgeCount':143,
       'baselineReadAdmissionSha256':config['baselineReadAdmissionSha256'],'createdReceiptSha256':config['createdReceiptSha256'],
       'readSchema':READ,'readSchemaOid':creator['schemaOid'],'readIdentity':IDENTITY,'catalogAfterSha256':value['catalogAfterSha256'],
       'currentRoleGraphQualified':False,'sourceActorQualified':False,'currentWriterQualified':False,'financialAuthorityQualified':False,
       'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def validate_catalog_current(receipt_sha):
    acknowledgement(receipt_sha);return namespace().validate_catalog_current(receipt_sha)

def validate_current(receipt_sha,plan_sha=None,input_sha=None):return namespace().validate_current(receipt_sha,plan_sha,input_sha)


def main():
    import sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'newRoles':0,'loginChanges':0,'nativeRegrants':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    import contextlib,io,time,stat
    n=namespace();output=io.StringIO();value={}
    try:
        with contextlib.redirect_stdout(output):n.main()
        value=json.loads(output.getvalue())
    except BaseException as error:
        value={'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'automaticRetryAllowed':False};raise
    finally:
        if INPUT_BASE.is_dir():
            folder=INPUT_BASE/'observations'
            if not folder.exists():folder.mkdir(mode=0o700)
            s=folder.lstat();need(s.st_uid==s.st_gid==0 and stat.S_ISDIR(s.st_mode)and stat.S_IMODE(s.st_mode)==0o700,'private_V5_read_observations_required')
            n.save(folder/(str(time.time_ns())+'-'+str(os.getpid())+'.json'),{'stdout':output.getvalue(),'aggregate':{k:v for k,v in value.items()if k in{'format','completed','errorClass','planReviewHash','reviewHash','planSha256','captured','rehearsed','admitted','commitOutcome'}}})
    allowed={'format','completed','planReviewHash','reviewHash','planSha256','contextInputSha256','admitted','captured','rehearsed','commitOutcome','readEdgeCount','missingCount','baselineReadEdgeCount','loginChanges','newRoles','newDml','serviceActions','nativeRegrants'}
    if value.get('admitted'):value['receiptSha256']=sha(n.protected(BASE/'result.json'));allowed.add('receiptSha256')
    print(json.dumps({**{k:v for k,v in value.items()if k in allowed},'privateResultSha256':sha(output.getvalue().encode()),'rawCatalogExported':False,'providerCalls':0},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
