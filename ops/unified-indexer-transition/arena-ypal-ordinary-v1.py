#!/usr/bin/env python3
"""Ordinary-epoch Arena handover, retaining the reviewed adoption lifecycle.

The eight-worker business, private ledger, transactional adoption, unknown-ACK
and pre-adoption inverse bodies come from the exact published restored owner.
Only current source/admission/auth and the two-file readiness artifact change.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time
import types

FORMAT='yunipals-arena-ypal-ordinary-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-ypal-ordinary-v1.py'
BASE=Path('/var/backups/yunipals-arena-ypal-ordinary-v1-20261025')
MANIFEST=OPS/'arena-ypal-ordinary-v1.manifest.json'
TEMPLATE=OPS/'arena-ypal-restored-v1.py'
TEMPLATE_SHA='cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a'
PINS={
 'arena-ypal-restored-v1.py':TEMPLATE_SHA,
 'arena-ypal-ordinary-v1.source.py':'9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0',
 'arena-ypal-ordinary-v1.mjs':'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf',
 'arena-ordinary-runtime-v1.py':'7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad',
 'arena-ordinary-latest-complete-v1.manifest.json':'73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf',
 'arena-ypal-source-completion-v1.py':'2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6',
 'arena-ypal-current-credentials-v1.py':'0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f',
 'arena-ypal-current-admission-v1.proposal.json':'0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4',
 'arena-ypal-native-v1.adoption.mjs':'d45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162',
 'arena-ypal-native-v2.context.py':'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd'
}
ADMISSION_RESULT=Path('/var/backups/yunipals-arena-ypal-source-completion-v1-20261024/result.json')
ADMISSION_SHA='620bb80a35dda4852af32e1a8867812133da260c8ac328802bdbd025e7049d97'
AUTH_BASE=Path('/var/backups/yunipals-arena-ypal-current-credentials-v1-20261024')
ARTIFACT='e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234'
SOURCE_VALUE={'releaseId':'0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
 'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7',
 'manifestHash':'0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
 'profileId':'0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff',
 'baseRpc':'http://127.0.0.1:19222/unified','policy':'latest','subsequentBlocks':0,
 'deployment':'8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca','startBlock':'52648146',
 'abiHash':'0x92fff205c89c168c18abdb66ac1f46329941822e998ceccbaa153a13db183f53'}
OBSERVATIONS=Path('/var/backups/yunipals-arena-ypal-ordinary-review-v1-20261025')


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def actual_pin(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64
def protected(path,expected,maximum=2000000):
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_ordinary_Arena_component_required')
    first=path.lstat();raw=path.read_bytes();key=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink'])
    need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and len(raw)<=maximum and len(raw)==first.st_size and
         key(first)==key(path.lstat())and sha(raw)==expected,'exact_ordinary_Arena_component_required');return raw
def component(name):
    path=OPS/name;raw=protected(path,PINS[name]);n=types.ModuleType('ordinary_Arena_'+path.stem);n.__file__=str(path)
    exec(compile(raw,str(path),'exec'),n.__dict__);return n


def validate_manifest(value):
    need(set(value)=={'format','files','source','authority'}and value['format']==FORMAT+'-code'and
         set(value['files'])==set(PINS)|{FILE.name}and value['files'][FILE.name]==sha(Path(__file__).read_bytes())and
         all(value['files'][name]==digest for name,digest in PINS.items()),'finite_actual_ordinary_Arena_code_manifest_required')
    need(value['source']==SOURCE_VALUE and value['authority']=={
       'migrationsPerformed':0,'oldWholeValidationClaimed':False,'rolesRequireSeparateAdmission':True,'configurationSecretsReused':True,
       'readinessArtifactDigest':ARTIFACT,'sourceKind':'standalone'},'only_existing_Arena_scope_and_new_ordinary_epoch_required')


def validate_plan(plan):
    n=namespace()
    need(set(plan)=={'format','roleAuth','currentActorsAck','admissionProposal','floor','manifestSha256','ordinaryRuntime','runtimeInstall'}and
         plan['format']==FORMAT,'exact_ordinary_Arena_plan_required')
    # Execute the unchanged original plan validation over its six original
    # fields in this new namespace. New references remain explicit additions.
    n.original_validate_plan({k:v for k,v in plan.items()if k not in{'ordinaryRuntime','runtimeInstall'}})
    source=n.read_module(n.SOURCE_CONTEXT,PINS[n.SOURCE_CONTEXT.name]);source.references(plan['ordinaryRuntime'])
    need(plan['roleAuth']['file']==str(AUTH_BASE/'auth-result.json')and actual_pin(plan['roleAuth']['sha256'])and
         plan['runtimeInstall']['file']==str(n.installer.BASE/'result.json')and
         set(plan['runtimeInstall'])=={'file','sha256'}and actual_pin(plan['runtimeInstall']['sha256']),
         'actual_current_role_auth_and_new_runtime_install_receipt_required')


def credential_authentication(host):
    """Private invocation hash plus genuine0bd setup/login/file/auth bodies.

    No old live worker constructor, LOGIN/password action or TCP dispatch runs
    here. Current catalog and real TCP checks remain in the original owner.
    """
    n=host.ordinary_namespace
    producer=host.p.load(n.AUTH_OPERATOR,PINS[n.AUTH_OPERATOR.name],'actual_current_credential_body')
    auth=producer.build();plan=producer.plan(ADMISSION_SHA)
    raw=auth.protected(n.ADMISSION_RESULT);need(sha(raw)==ADMISSION_SHA,'actual_mixed9_authentication_parent_required')
    admission=json.loads(raw)
    rows=auth.validate_admission(plan,admission,auth.protected(n.ADMISSION_HELPER),host.proposal)
    op=auth.Operator(types.SimpleNamespace(operator_hash=lambda:PINS[n.AUTH_OPERATOR.name]),plan,host.proposal,admission,rows)
    setup=op.read_result('setup-result.json');setup_sha=auth.sha(auth.encoded(setup))
    need(setup['format']==auth.FORMAT and setup['operatorSha256']==PINS[n.AUTH_OPERATOR.name]and
         setup['planSha256']==auth.sha(auth.encoded(plan))and setup['admissionResultSha256']==ADMISSION_SHA and
         setup['roles']==host.auth['roles']and setup['sourceRole']==host.auth['sourceRole']and
         setup['credentialFiles']==host.auth['credentialFiles']and host.auth['setupResultSha256']==setup_sha,
         'same_private_current_credential_setup_and_admission_chain_required')
    op.files(setup)
    login=op.read_result('login-result.json')
    need(login=={'format':auth.FORMAT,'setupResultSha256':setup_sha,'loginEnabled':True,'serviceJobs':0},
         'genuine_current_credential_login_acknowledgement_required')
    for group in auth.TARGETS:
        expected={'commitOutcome':'commit_confirmed','roles':{r['role']:r['oid']for r in rows if r['group']==group}}
        need(op.read_result('password-'+group+'-ack.json')==op.read_result('login-'+group+'-ack.json')==expected,
             'both_credential_password_and_LOGIN_boundaries_must_be_acknowledged')
    raw=auth.protected(n.AUTH_BASE/'auth-result.json',private=True)
    need(sha(raw)==host.plan['roleAuth']['sha256']and json.loads(raw)==host.auth,
         'exact_authentication_receipt_hash_from_private_plan_required')
    expected=[{'sessionUser':r['role'],'currentUser':r['role'],'oid':r['oid'],'databaseOid':auth.TARGETS[r['group']][2],
       'readOnly':True,'memberships':0,'elevated':False,'badPasswordRejected':True,'ownerRoleRejected':True,
       'readRelations':1 if r['group']=='operational'else len(host.proposal['sourceReader']['tables']),'connectionsConcurrent':1}for r in rows]
    need(host.auth['authentication']==expected,'all_nine_genuine_dedicated_authentication_proofs_required')
    return {'privateCredentialChainQualified':True,'credentialFiles':len(rows),'sourceActorQualified':False,'serviceActions':0,'databaseWrites':0}


def render_unit(body,worker,target):
    original=worker['bundleRelative'];name=Path(original).name
    need(re.fullmatch(r'arena-(server|native-(disclosure|client|referee|media|execution)|capacity)\.mjs',name),
         'one_of_seven_acknowledged_Arena_worker_bundles_required')
    lines=body.decode().splitlines(keepends=True);indices=[i for i,line in enumerate(lines)if line.startswith('ExecStart=')]
    need(len(indices)==1,'single_original_Arena_ExecStart_required');i=indices[0]
    expected='ExecStart=/opt/node-v24.18.1/bin/node '+original+'\n'
    need(lines[i]==expected,'literal_original_Arena_worker_command_required')
    lines[i]='ExecStart=/opt/node-v24.18.1/bin/node '+str(target/'dist'/name)+'\n'
    return ''.join(lines).encode()


def readonly_role_catalog_sql(inv,*args):
    text=inv.catalog_sql(*args);needle="SET LOCAL statement_timeout='5s';"
    need(text.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n')and text.endswith('ROLLBACK;\n')and
         text.count(needle)==1 and 'jit='not in text,'exact_original_readonly_Arena_catalog_bounds_required')
    return text.replace(needle,'SET LOCAL jit=off;'+needle)


def normal(host,terminal_ok=False):
    n=host.ordinary_namespace
    context=host.p.load(n.SOURCE_CONTEXT,PINS[n.SOURCE_CONTEXT.name],'ordinary_Arena_source')
    value=context.validate_current(host.plan['ordinaryRuntime'],terminal_ok=terminal_ok)
    need(value['format']==context.FORMAT and value['validated']is True and value['inverseOnly']is terminal_ok and
         value['releaseId']==n.SOURCE_ID and value['manifestHash']==host.manifest['source']['manifestHash']and
         value['schemaOid']=='75963410'and value['buildId']=='71e2a7f3b7'and value['sourceKind']=='standalone'and
         value['sourceReceiptSha256']==host.plan['ordinaryRuntime']['resultSha256']and
         value['sourceRuntimeInputSha256']==host.plan['ordinaryRuntime']['inputSha256']and
         value['originalWholeValidationPassed']is value['financialAuthorityQualified']is value['currentCanonicalCoverageQualified']is False,
         'honest_actual_ordinary_source_and_explicit_inverse_scope_required')
    need(terminal_ok or value['sourceTerminal']is False,'terminal_source_cannot_admit_Arena_forward')
    return value


def transform(raw):
    need(sha(raw)==TEMPLATE_SHA,'exact_reviewed_Arena_lifecycle_template_required');tree=ast.parse(raw)
    assignments={'FORMAT':repr(FORMAT),'BASE':'Path('+repr(str(BASE))+')','MANIFEST':'Path('+repr(str(MANIFEST))+')',
      'SOURCE_CONTEXT':"OPS/'arena-ypal-ordinary-v1.source.py'",'PROPOSAL_FILE':"OPS/'arena-ypal-current-admission-v1.proposal.json'",
      'ADMISSION_HELPER':"OPS/'arena-ypal-source-completion-v1.py'",'ADMISSION_RESULT':'Path('+repr(str(ADMISSION_RESULT))+')',
      'AUTH_OPERATOR':"OPS/'arena-ypal-current-credentials-v1.py'",'AUTH_BASE':'Path('+repr(str(AUTH_BASE))+')',
      'CHILD':"OPS/'arena-ypal-ordinary-v1.mjs'"}
    found=[]
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in assignments:
            key=node.targets[0].id;node.value=ast.parse(assignments[key],mode='eval').body;found.append(key)
    need(set(found)==set(assignments)and len(found)==len(assignments),'exact_ten_ordinary_Arena_identity_constants_required')
    literals={'yunipals-arena-ypal-role-auth-v2':'yunipals-arena-ypal-current-role-auth-v1',
      'yunipals-arena-ypal-native-root-authority-v1':'yunipals-arena-ypal-ordinary-root-authority-v1',
      'yunipals-arena-ypal-native-child-v1':'yunipals-arena-ypal-ordinary-child-v1',
      'yunipals-arena-ypal-restored-phase-leaf-v1':'yunipals-arena-ypal-ordinary-phase-leaf-v1'}
    counts={key:0 for key in literals};calls={'ambient':0,'runner':0,'catalog':0,'bootstrap':0,'preparedPaths':0,'jit':0}
    class Seams(ast.NodeTransformer):
        def visit_Constant(self,node):
            if isinstance(node.value,str)and node.value in literals:
                counts[node.value]+=1;return ast.copy_location(ast.Constant(literals[node.value]),node)
            if isinstance(node.value,str)and '.direct-native-'in node.value:
                calls['preparedPaths']+=1
                return ast.copy_location(ast.Constant(node.value.replace('.direct-native-','.ordinary-native-')),node)
            if isinstance(node.value,str)and 'yunipals-arena-ypal-native-child-v1'in node.value:
                need(node.value.count('yunipals-arena-ypal-native-child-v1')==1,'one_peer_bootstrap_failure_domain_required')
                calls['bootstrap']+=1
                return ast.copy_location(ast.Constant(node.value.replace('yunipals-arena-ypal-native-child-v1','yunipals-arena-ypal-ordinary-child-v1')),node)
            return node
        def visit_Assign(self,node):
            code=ast.unparse(node)
            if code=='ambient = admission.runner().source_ambient()':calls['ambient']+=1;return ast.parse('ambient = admission.create()[0].source_ambient()').body[0]
            if code=='runner = helper.runner()':calls['runner']+=1;return ast.parse('runner, catalog_helper = helper.create()').body[0]
            return self.generic_visit(node)
        def visit_Attribute(self,node):
            if ast.unparse(node)=='helper.current_catalog':calls['catalog']+=1;return ast.copy_location(ast.parse('catalog_helper.current_catalog',mode='eval').body,node)
            return self.generic_visit(node)
        def visit_Call(self,node):
            if ast.unparse(node.func)=='self.inv.catalog_sql':
                calls['jit']+=1;node.func=ast.Name(id='ordinary_role_catalog_sql',ctx=ast.Load());node.args.insert(0,ast.parse('self.inv',mode='eval').body)
            return self.generic_visit(node)
    tree=Seams().visit(tree);tree.body=[v for v in tree.body if not(isinstance(v,ast.If)and ast.unparse(v.test)=="__name__ == '__main__'")]
    need(counts=={k:(2 if k=='yunipals-arena-ypal-native-child-v1'else 1)for k in literals}and
         calls=={'ambient':1,'runner':1,'catalog':1,'bootstrap':1,'preparedPaths':3,'jit':2},'exact_Arena_domains_and_current_admission_API_seams_required')
    return ast.fix_missing_locations(tree)


_BUILDING=False
def namespace():
    global _BUILDING
    need(not _BUILDING,'recursive_ordinary_Arena_namespace_construction_refused');_BUILDING=True
    try:
        raw=protected(TEMPLATE,TEMPLATE_SHA);tree=transform(raw);n=types.ModuleType('ordinary_Arena_business');n.__file__=str(Path(__file__).absolute())
        n.__dict__['ordinary_role_catalog_sql']=readonly_role_catalog_sql
        exec(compile(tree,n.__file__,'exec'),n.__dict__)
        n.original_validate_plan=n.validate_plan
        # Definitions/role constructors are static; no active source is needed
        # to inspect an owned unknown prefix or a source-independent phase leaf.
        n.validate_manifest=validate_manifest;n.validate_plan=validate_plan
        n.installer=component('arena-ordinary-runtime-v1.py')
        original_init=n.Host.__init__;old_artifacts=n.Host.artifacts;old_child=n.Host.child
        def initialize(host,plan):
            original_init(host,plan);host.ordinary_namespace=n
            need(host.auth['admissionResultSha256']==ADMISSION_SHA,'actual_mixed9_admission_ACK_required')
            admission=host.p.load(n.ADMISSION_HELPER,PINS[n.ADMISSION_HELPER.name],'actual_mixed9_admission')
            admission.acknowledgement(ADMISSION_SHA)
            credential_authentication(host)
            host.worker_proposal=copy.deepcopy(host.worker_proposal)
            for worker in host.worker_proposal['workers']:
                if worker['unit']in{w['unit']for w in host.proposal['workers']}:
                    worker['bundleRelative']=str(n.installer.TARGET/'dist'/Path(worker['bundleRelative']).name)
        def artifacts(host,fresh=True):
            installed=n.installer.installed(host.plan['runtimeInstall']['sha256'])
            predecessor=old_artifacts(host,fresh)
            historical=json.loads(host.p.protected(n.HISTORICAL_PROPOSAL,1000000))
            for unit,row in host.native.items():
                worker=next(w for w in historical['workers']if w['unit']==unit)
                body=render_unit(row['body'],worker,n.installer.TARGET);host.native[unit]={'body':body,'sha256':n.sha(body)}
            return {'predecessor':predecessor,'sourceDigest':n.SOURCE,'readinessArtifactDigest':n.installer.ARTIFACT,
               'runtimeInstallReceiptSha256':host.plan['runtimeInstall']['sha256'],'runtimeManifestSha256':n.installer.MANIFEST_SHA,
               'unitSha256':{u:r['sha256']for u,r in host.native.items()},'childSha256':host.child_sha,
               'dependencyRuntimeQualifiedByPredecessor':True,'newDependencyInstallation':False}
        def child(host,*args,**kwargs):
            n.installer.installed(host.plan['runtimeInstall']['sha256']);return old_child(host,*args,**kwargs)
        n.Host.__init__=initialize;n.Host.normal=normal;n.Host.artifacts=artifacts;n.Host.child=child
        return n
    finally:_BUILDING=False


def code_manifest():
    for name,digest in PINS.items():protected(Path(__file__).absolute().parent/name,digest)
    return {'format':FORMAT+'-code','files':{**PINS,FILE.name:sha(Path(__file__).read_bytes())},
      'source':SOURCE_VALUE,'authority':{'migrationsPerformed':0,'oldWholeValidationClaimed':False,
      'rolesRequireSeparateAdmission':True,'configurationSecretsReused':True,'readinessArtifactDigest':ARTIFACT,'sourceKind':'standalone'}}


def validate_phase_leaf(result_sha,manifest_sha,continuation=None):
    return namespace().validate_phase_leaf(result_sha,manifest_sha,continuation)


def private_output(n,text,**kwargs):
    need(not kwargs and isinstance(text,str),'single_structured_Arena_owner_output_required')
    value=json.loads(text);raw=(text+'\n').encode();need(len(raw)<4000000,'bounded_private_Arena_observation_required')
    for p in OBSERVATIONS.parents:
        s=p.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'protected_Arena_observation_parent_required')
    if not os.path.lexists(OBSERVATIONS):OBSERVATIONS.mkdir(mode=0o700);n.sync_dir(OBSERVATIONS.parent)
    st=OBSERVATIONS.lstat();need(stat.S_ISDIR(st.st_mode)and st.st_uid==st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o700,'private_Arena_observation_directory_required')
    path=OBSERVATIONS/('observation-'+str(time.time_ns())+'-'+str(os.getpid())+'.json');n.save(path,raw)
    public={key:value[key]for key in ['format','completed','reviewHash','inverseReviewHash','continuationReviewHash','migrationInvocations','serviceJobs','applied','actions','automaticRetry']if key in value}
    print(json.dumps({**public,'privateObservationSha256':sha(raw),'privateObservationFile':str(path),'privateValuesExported':False},sort_keys=True))


def main():
    if len(os.sys.argv)==1:print(json.dumps({'format':FORMAT,'staticOnly':True,'migrationInvocations':0,'serviceJobs':0,'databaseWrites':0}));return
    if os.sys.argv[1:]==['--manifest']:print(json.dumps(code_manifest(),indent=2,sort_keys=True));return
    # Preserve the original complete CLI's operation/lock/intent/unknown-ACK
    # dispatch. The new namespace emits detailed observations privately.
    n=namespace();n.print=lambda text,**kwargs:private_output(n,text,**kwargs)
    try:n.main()
    except BaseException as error:
        result={'format':FORMAT,'completed':False,'phase':n.PHASE,
          'fixedCode':str(error)if isinstance(error,n.CutoverFailure)else'ordinary_Arena_owner_failed',
          'errorClass':type(error).__name__,'rawMessagesExported':False,'automaticRetry':False,
          'oldRuntimeAutomaticRestartAllowed':False,'reconciliationRequired':True}
        if n.BASE.is_dir()and not(n.BASE/'failed.json').exists():n.save(n.BASE/'failed.json',result)
        print(json.dumps(result,sort_keys=True));raise SystemExit(1)


if __name__=='__main__':main()
