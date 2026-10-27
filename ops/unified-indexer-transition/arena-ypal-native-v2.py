#!/usr/bin/env python3
"""Review-first direct Arena native cutover of the ALREADY committed schema.

No migration/credential/grant/provider/signing command exists in this owner.
Default is online read-only review. Apply requires exact review; all mutations
are owned/journaled and never retried implicitly. Reconciliation is read-only.
"""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import time
import types
from urllib.parse import urlsplit, unquote

FORMAT='yunipals-arena-ypal-native-v2'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
PACKAGE=Path('/opt/yunipals-unified/operations/arena-modern-package-20261022')
WORK=Path('/mnt/HC_Volume_107222036/arena-modern-package-20261022')
BASE=Path('/var/backups/yunipals-arena-ypal-native-v2-20261024')
MANIFEST=OPS/'arena-ypal-native-v2.manifest.json'
SOURCE='264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24'
PROOF_SHA='a2b353f788d5d6a15408c3ee9cc3e46d100a9fd6a0c4b90230fd9f53091bc01e'
PLAN_FILE=PACKAGE/'constructor-plan-20261023.json'
PLAN_SHA='490e5e7620a88a48e34eb4d25ccd93f7a06d9e67c27dd7eed6f293923c7fcf2a'
QUALIFIED=PACKAGE/'constructor-qualify-all-eight-20261023.json'
QUALIFIED_SHA='b7f8a3deac84551182f9fc02b3b9e36557b332d603810e1aa81e7441945b5162'
INSTALL_SHA='3921ea98422778333a21068aadab016af5e6e4907b8c7b9deef7c73e14d531ad'
PREFLIGHT_SHA='527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631'
SOURCE_CONTEXT=OPS/'arena-ypal-native-v2.source.py'
ACTOR_CONTEXT=OPS/'arena-ypal-native-v2.context.py'
ACTOR_ACK_FILE=Path('/var/backups/yunipals-arena-ypal-actor-ack-v1-20261024/result.json')
ACTOR_ACK_SHA='d3f1b61c244979dbf8b94281ba0d062e35fbca5ee52a1c92d9b9d97bd52781d4'
INVENTORY_SHA='c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785'
PROPOSAL_FILE=OPS/'arena-ypal-native-v1.proposal.json'
ADMISSION_HELPER=OPS/'arena-ypal-native-v2.admission.py'
ADMISSION_RESULT=Path('/var/backups/yunipals-arena-ypal-admission-v2-20261024/result.json')
AUTH_OPERATOR=OPS/'arena-ypal-native-v2.credentials.py'
AUTH_BASE=Path('/var/backups/yunipals-arena-ypal-credentials-v2-20261024')
HISTORICAL_PROPOSAL=Path('/opt/yunipals-unified/operations/arena-consumer-package-20261021/proposal.v1.json')
HISTORICAL_PROPOSAL_SHA='6cb914372d5863616dcde8f753bc97380916e86073556999eaf082cf8fc6e39e'
CHILD=OPS/'arena-ypal-native-v1.mjs'
ADAPTER=OPS/'arena-ypal-native-v1.adoption.mjs'
ADAPTER_SHA='d45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162'
DEPLOYMENT='8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca'
SOURCE_ID='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8','TZ':'UTC','TSX_DISABLE_CACHE':'1','PYTHONDONTWRITEBYTECODE':'1','PGPASSFILE':'/run/yunipals-arena-direct-native-no-password'}
PHASE='entry'

class CutoverFailure(RuntimeError):pass

def need(value,code):
    if not value:raise CutoverFailure(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def actual_pin(value):return isinstance(value,str)and re.fullmatch('[0-9a-f]{64}',value)and value!='0'*64

def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def sealed(name,raw):
    fd=os.memfd_create(name,os.MFD_ALLOW_SEALING|os.MFD_CLOEXEC);os.fchmod(fd,0o600)
    try:
        need(os.write(fd,raw)==len(raw),'bounded_anonymous_input_write_required');os.lseek(fd,0,0)
        mask=fcntl.F_SEAL_SEAL|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_GROW|fcntl.F_SEAL_WRITE
        fcntl.fcntl(fd,fcntl.F_ADD_SEALS,mask);need(fcntl.fcntl(fd,fcntl.F_GET_SEALS)==mask,'sealed_anonymous_input_required');return fd
    except BaseException:os.close(fd);raise

def save(path,value):
    raw=value if isinstance(value,bytes)else encoded(value)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:out.write(raw);out.flush();os.fsync(out.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def read_module(path,pin):
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_owner_dependency_required')
    raw=path.read_bytes();need(len(raw)<200000 and sha(raw)==pin,'exact_owner_dependency_required')
    m=types.ModuleType(path.stem.replace('-','_'));m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def read_module_bytes(path,pin):
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_owner_dependency_required')
    raw=path.read_bytes();need(len(raw)<2000000 and sha(raw)==pin,'exact_owner_dependency_required');return raw

def validate_manifest(value):
    need(set(value)=={'format','files','source','authority'} and value['format']=='yunipals-arena-ypal-native-code-v2','explicit_YPAL_code_manifest_required')
    need(set(value['files'])=={'arena-ypal-native-v2.py','arena-ypal-native-v1.mjs','arena-ypal-native-v1.adoption.mjs','arena-ypal-native-v2.source.py','arena-ypal-native-v1.catalog.py','arena-ypal-native-v1.proposal.json','arena-ypal-native-v2.rehearsal.py','arena-ypal-native-v2.admission.py','arena-ypal-native-v2.credentials.py','arena-ypal-native-v1.source.sql.review','arena-ypal-native-v1.actors.py','arena-ypal-native-v2.context.py'} and value['files'].get('arena-ypal-native-v2.py')==sha(Path(__file__).read_bytes()) and all(actual_pin(p)for p in value['files'].values()),'actual_finite_owner_manifest_required')
    need(value['source']==SOURCE_CONTEXT_VALUE,'exact_combined_YPAL_source_configuration_required')
    need(value['authority']=={'migrationsPerformed':0,'oldWholeValidationClaimed':False,'rolesRequireSeparateAdmission':True,'configurationSecretsReused':True},'bounded_new_source_authority_required')

SOURCE_CONTEXT_VALUE={'releaseId':SOURCE_ID,'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7','manifestHash':'0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112','profileId':'0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff','baseRpc':'http://127.0.0.1:19222/unified','policy':'latest','subsequentBlocks':0,'deployment':DEPLOYMENT,'startBlock':'52648146','abiHash':'0x92fff205c89c168c18abdb66ac1f46329941822e998ceccbaa153a13db183f53'}

def validate_plan(plan):
    need(set(plan)=={'format','roleAuth','currentActorsAck','admissionProposal','floor','manifestSha256'}and plan['format']==FORMAT,'exact_direct_native_plan_required')
    for key in ['roleAuth','currentActorsAck','admissionProposal']:
        r=plan[key];need(set(r)=={'file','sha256'}and Path(r['file']).is_absolute()and actual_pin(r['sha256']),'actual_protected_receipt_reference_required')
    f=plan['floor'];need(set(f)=={'block','hash'}and re.fullmatch('[1-9][0-9]*',f['block'])and re.fullmatch('0x[0-9a-f]{64}',f['hash']),'actual_canonical_floor_required')
    need(plan['currentActorsAck']=={'file':str(ACTOR_ACK_FILE),'sha256':ACTOR_ACK_SHA},'exact_actual_current_actor_reference_required')
    need(actual_pin(plan['manifestSha256']) and plan['admissionProposal']['file']==str(PROPOSAL_FILE),'exact_new_YPAL_manifest_and_admission_path_required')

def validate_auth_receipt(value,proposal,actors_pin,manifest):
    names={w['role']for w in proposal['workers']}
    files={w['privateOverlay']for w in proposal['workers']}|{'/etc/yunipals-arena/native-read.env'}
    need(value.get('format')=='yunipals-arena-ypal-role-auth-v2'and set(value.get('roles',{}))==names and len(names)==8,'exact_eight_admitted_role_oids_required')
    need(all(type(x)is int and x>0 for x in value['roles'].values())and len(set(value['roles'].values()))==8,'distinct_actual_operational_role_oids_required')
    need(set(value.get('sourceRole',{}))=={'name','oid'}and value['sourceRole']['name']=='arena_native_reader'and type(value['sourceRole']['oid'])is int and value['sourceRole']['oid']>0,'actual_dedicated_source_oid_required')
    need(set(value.get('credentialFiles',{}))==files and all(actual_pin(x)for x in value['credentialFiles'].values()),'exact_nine_owned_credential_files_required')
    need(value.get('releaseId')==SOURCE_ID,'fresh_YPAL_credential_release_binding_required')
    need(value.get('operationalDatabaseOid')==2303669 and value.get('sourceDatabaseOid')==17584 and value.get('acknowledgedCurrentActors',{}).get('sha256')==actors_pin,'actual_role_auth_target_and_actor_binding_required')
    need(all(value.get(k)is True for k in ['grantsVerified','tcpAuthenticationProven','loginEnabled']),'actual_owned_role_authentication_required')
    for key in ['operatorSha256','admissionResultSha256','admissionHelperSha256','setupResultSha256']:need(actual_pin(value.get(key)),'actual_role_setup_producer_and_result_required')
    need(value['operatorSha256']==manifest['files'][AUTH_OPERATOR.name] and value['admissionHelperSha256']==manifest['files'][ADMISSION_HELPER.name],'exact_reviewed_role_producers_required')

def validate_catalog(doc,roles,expected_oids,*,source=False,ambient_functions=0):
    need(doc.get('readOnly')is True and doc.get('isolation')=='repeatable read','readonly_role_catalog_required')
    need({r['name']for r in doc['roles']}==set(roles),'exact_catalog_role_names_required')
    for r in doc['roles']:
        attrs=r['attributes'];need(r['exists']and r['oid']==expected_oids[r['name']]and attrs['login']is True and attrs['inherit']is False and all(attrs[k]is False for k in ['superuser','createDb','createRole','replication','bypassRls']),'exact_admitted_nonowner_role_attributes_required')
        need(r['membershipEdges']==0 and r['ownedRelationCount']==0 and r['ownedFunctionCount']==0 and r['sequencePrivilegeCount']==0 and r['securityDefinerExecuteCount']==0,'no_membership_ownership_or_definer_capability')
        need(r['databaseConnect']and not r['databaseCreate']and r['databaseTemp']is source,'observed_database_ambient_authority_changed')
        need(r['extraTablePrivilegeCount']==0 and r['extraColumnPrivilegeCount']==0 and all(g['effective']and g['relation_oid']is not None for g in r['requiredGrants']),'exact_finite_effective_grant_graph_required')
        need(all(x['usage']and not x['create']and not x['owns']for x in r['schemaPrivileges'].values()),'exact_usage_without_schema_creation_required')
        need(r['functionExecuteCount']==ambient_functions,'observed_scoped_invoker_function_authority_changed')


def journal_rows(path):
    if not path.exists():return []
    rows=[]
    for line in path.read_bytes().splitlines():
        need(len(line)<2000000,'bounded_owner_journal_line_required')
        row=json.loads(line);need(row.get('format')=='yunipals-arena-ypal-native-child-v1','exact_owner_child_journal_required');rows.append(row)
    return rows

def transaction_intents():
    return [r for name in ['owner-commit.jsonl','owner-publication-continue.jsonl','owner-unhalt.jsonl','owner-unhalt-continue.jsonl']for r in journal_rows(BASE/name)if r['phase'].endswith('_commit_intent')]

def append_owned(path,value):
    if path.exists():
        s=path.lstat();need(stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<2000000,'private_bounded_owned_append_journal_required')
    fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'ab')as out:out.write(encoded(value)+b'\n');out.flush();os.fsync(out.fileno())
    sync_dir(path.parent)

def forward_phase(state,intents,adoption):
    statuses={(r['phase'],r['xid']):r['status']for r in state['transactions']}
    need(len(statuses)==len(intents)and all(statuses.get((r['phase'],r['xid']))in{'committed','aborted'}for r in intents),'every_owned_sql_boundary_must_have_known_terminal_status')
    need(statuses.get(('adoption_commit_intent',adoption['xid']))=='committed','confirmed_owned_adoption_required_for_forward_continuation')
    for origin in adoption['origins']:
        need(any(r['id']==origin['id']and r['incarnation']==origin['incarnation']and r['opened_event_id']==origin['opened']['id']and r['opened_block_hash']==origin['opened']['blockHash']and r['bound_release_id']==SOURCE_ID and r['cipher_context']==DEPLOYMENT+'/'+origin['id']for r in state['identities']),'owned_adopted_opening_or_aad_changed')
    need(state['retainedLedger']and state['retainedLedger']['verified']is True,'original_durable_ledger_must_be_retained')
    selections=[r for r in intents if r['phase']=='selection_commit_intent'and statuses[(r['phase'],r['xid'])]=='committed']
    unhalts=[r for r in intents if r['phase']=='unhalt_commit_intent'and statuses[(r['phase'],r['xid'])]=='committed']
    need(state['mode']['indexer_mode']=='unified','owned_unified_mode_required')
    if not state['selection']:
        need(not selections and not unhalts and state['history']==[]and state['mode']['halted']is True,'unowned_or_inconsistent_initial_publication_state')
        return {'phase':'publish','adoptionXid':adoption['xid'],'retainedLedger':state['retainedLedger']}
    need(len(state['selection'])==len(selections)==len(state['history'])==1,'exactly_one_owned_initial_selector_required')
    selected=state['selection'][0];owned=selections[0]['selectedRow']
    need(selected=={'epoch':owned['epoch'],'kind':owned['kind'],'source_id':owned['sourceId'],'accepted_block':owned['block'],'accepted_hash':owned['hash'],'review_hash':owned['reviewHash']}and owned['deployment']==DEPLOYMENT and owned['kind']=='unified'and owned['sourceId']==SOURCE_ID,'actual_selector_differs_from_own_commit_intent')
    need(state['history']==[{'epoch':owned['epoch'],'deployment':DEPLOYMENT,'review_hash':owned['reviewHash']}],'actual_immutable_history_differs_from_owned_selector')
    need(all(r.get('epoch')==selected['epoch']for r in intents if r['phase']=='unhalt_commit_intent'),'unhalt_intent_epoch_changed')
    if state['mode']['halted']:need(not unhalts,'committed_unhalt_must_match_actual_mode')
    else:need(len(unhalts)==1,'unhalted_mode_requires_own_confirmed_xid_and_epoch')
    return {'phase':'native'if state['mode']['halted']else'complete','adoptionXid':adoption['xid'],'selection':owned,'unhaltXid':unhalts[0]['xid']if unhalts else None,'retainedLedger':state['retainedLedger']}

def pre_adoption_inverse(state):
    need(state['selection']==[]and len(state['identities'])==2 and all(x['incarnation']=='legacy'and x['cipher_context']==DEPLOYMENT+'/'+x['id']for x in state['identities']),'adopted_identity_or_selected_source_forbids_original_runtime_inverse')
    need(all(t['status']=='aborted'for t in state['transactions']),'only_proven_aborted_own_transactions_allow_inverse')
    need(state['mode']=={'indexer_mode':'legacy','halted':False},'unowned_deployment_mode_blocks_inverse')
    return True

def valid_native_group(unit,slice_name,group):
    allowed={('system.slice','/system.slice/'+unit)}
    if '@'in unit:
        template='system-'+unit.split('@',1)[0].replace('-',r'\x2d')+'.slice'
        allowed.add((template,'/system.slice/'+template+'/'+unit))
    need((slice_name,group)in allowed,'exact_native_default_slice_required')
    return Path('/sys/fs/cgroup')/group.lstrip('/')

def capacity_admitted(doc,required):
    need(doc.get('readOnly')is True and all(type(doc.get(k))is int and doc[k]>=0 for k in ['maximum','reserved','used']),'readonly_capacity_observation_required')
    owned=doc.get('ownedUsed',0);need(type(owned)is int and 0<=owned<=required,'exact_existing_owned_pool_sessions_required')
    available=doc['maximum']-doc['reserved']-doc['used']+owned
    need(available>=required+1,'fresh_worker_pools_plus_owner_probe_headroom_required')
    return {'requiredWorkerSlots':required,'ownerProbeSlots':1,'availableIncludingExistingOwnedSessions':available,'alreadyOwned':owned,'admitted':True}

def activation_paths(unit):
    paths=set()
    for root in [Path('/etc/systemd/system'),Path('/run/systemd/system'),Path('/usr/lib/systemd/system')]:
        for suffix in ['*.wants','*.requires','*.upholds']:
            for parent in root.glob(suffix):
                path=parent/unit
                if os.path.lexists(path):paths.add(str(path))
    return sorted(paths)

def descendant_owner(pid,mains,read_process):
    seen=set();current=pid;group=None
    for _ in range(32):
        need(current not in seen,'native_descendant_parent_cycle');seen.add(current)
        row=read_process(current)
        need(row['uid']==[971]*4 and row['gid']==[965]*4 and row['nnp']=='1'and all(int(row[k],16)==0 for k in ['CapPrm','CapEff','CapAmb']),'native_descendant_privilege_or_account_changed')
        candidates=[g for g in mains if row['group']==g or row['group'].startswith(g+'/')]
        need(len(candidates)==1 and(group is None or candidates[0]==group),'foreign_native_descendant_cgroup')
        group=candidates[0]
        if current==mains[group]:return group
        need(row['parent']>1,'native_descendant_not_parented_to_owned_main');current=row['parent']
    raise CutoverFailure('native_descendant_parent_limit')

class Host:
    def __init__(self,plan):
        validate_plan(plan);self.plan=plan
        self.manifest=json.loads(read_module_bytes(MANIFEST,plan['manifestSha256']))
        validate_manifest(self.manifest)
        self.child_sha=self.manifest['files'][CHILD.name]
        self.p=read_module(PACKAGE/'arena-modern-runtime-preflight-v1.py',PREFLIGHT_SHA)
        self.r=self.p.load(self.p.RESTORE,self.p.RESTORE_SHA,'retained_direct_restore');self.m=self.r.load_owner();self.o=self.m.observer()
        self.inv=self.p.load(Path('/opt/yunipals-unified/operations/arena-role-inventory-20261021/arena-operational-role-inventory-v1.py'),INVENTORY_SHA,'current_role_catalog')
        self.root=Path('/opt/yunipals-unified/releases')/SOURCE
        self.proposal=self.reference(plan['admissionProposal']);self.auth=self.reference(plan['roleAuth']);self.actor_receipt=self.reference(plan['currentActorsAck'])
        self.actor_context=self.p.load(ACTOR_CONTEXT,self.manifest['files'][ACTOR_CONTEXT.name],'explicit_current_actor_context').Context()
        need(self.actor_receipt==self.actor_context.ack,'actual_07ea_d3f_current_actor_capture_required')
        admission=self.p.load(ADMISSION_HELPER,self.manifest['files'][ADMISSION_HELPER.name],'new_source_admission_definition')
        ambient=admission.runner().source_ambient()
        self.proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']=ambient['publicNonDefinerFunctions']
        need(plan['admissionProposal']['sha256']==self.manifest['files'][PROPOSAL_FILE.name],'exact_YPAL_proposal_required')
        validate_auth_receipt(self.auth,self.proposal,plan['currentActorsAck']['sha256'],self.manifest)
        # Historical acknowledgements remain valid after adoption. Current
        # legacy-only checks run in review(), never block read-only recovery.
        owner_raw=self.r.read(self.o,self.r.PARENT/'result.json');owner_result=json.loads(owner_raw)
        self.binding=json.loads(self.r.read(self.o,self.r.PARENT/'review.json'))
        self.restored=json.loads(self.r.read(self.o,self.r.BASE/'result.json'))
        need(sha(owner_raw)==self.r.RESULT_SHA and sha(encoded(self.binding))==self.r.OWNER_REVIEW and self.binding['operatorSha256']==self.r.OWNER_SHA and owner_result.get('migrationCommitOutcome')=='commit_confirmed'and sha(encoded(self.restored))==self.p.RESTORE_RESULT_SHA,'actual_owner_commit_and_original_restore_required')
        self.base=json.loads(self.o.read(OPS/'arena-config-public-baseline-v1.json',200000)[0])
        need(sha(self.o.read(OPS/'arena-config-public-baseline-v1.json',200000)[0])==self.o.BASELINE_SHA,'retained_public_baseline_changed')
        historical=self.p.protected(HISTORICAL_PROPOSAL,1000000);need(sha(historical)==HISTORICAL_PROPOSAL_SHA,'retained_rendered_worker_definition_required');self.worker_proposal=json.loads(historical)
        need(self.auth['acknowledgedCurrentActors']==self.actor_context.acknowledged(),'same_actual_current_actor_authentication_context_required')
        self.urls={};self.native={}
    def current_actor(self,row):
        unit=row['unit'];props=self.r.props(self.m,unit)
        need(props['ActiveState']=='active'and props['SubState']=='running','acknowledged_current_actor_must_be_running')
        actual={'invocation':props['InvocationID'],'process':self.m.process_identity(props,row)}
        need(actual==self.actor_receipt['binding']['snapshot']['actors'][unit] and self.r.props(self.m,unit)==props,'exact_acknowledged_current_actor_required')
        return actual
    def reference(self,ref):
        raw=self.p.protected(Path(ref['file']),2000000);need(sha(raw)==ref['sha256'],'exact_referenced_receipt_changed');return json.loads(raw)
    def normal(self,terminal_ok=False):
        context=self.p.load(SOURCE_CONTEXT,self.manifest['files'][SOURCE_CONTEXT.name],'explicit_YPAL_source_context')
        need(actual_pin(getattr(context,'QUALIFIER_SHA',None)) and actual_pin(getattr(context,'QUALIFICATION_RECEIPT_SHA',None)),'actual_current_19212_qualification_dependency_required')
        value=context.validate_current(terminal_ok=terminal_ok)
        need(value['releaseId']==SOURCE_ID and value['manifestHash']==self.manifest['source']['manifestHash'] and value['schemaOid']=='75963410' and value['buildId']=='71e2a7f3b7','exact_YPAL_source_context_required')
        need(value.get('originalWholeValidationPassed') is False and value.get('paidAuthority') is False,'no_historical_whole_validator_or_paid_authority_claim')
        need(terminal_ok or value.get('sourceTerminal') is False,'terminal_source_never_admits_forward_cutover')
        return value
    def files_and_roles(self):
        # Read the actual two-database admission and private password setup
        # acknowledgements. Their read-only validator binds the prepared OID,
        # direct grantor/column ACL graph and nine exact SCRAM verifier hashes.
        admission_raw=self.p.protected(ADMISSION_RESULT,2000000);setup_raw=self.p.protected(AUTH_BASE/'setup-result.json',100000)
        need(sha(admission_raw)==self.auth['admissionResultSha256']and sha(setup_raw)==self.auth['setupResultSha256'],'actual_admission_and_password_setup_receipts_required')
        admission=json.loads(admission_raw);setup=json.loads(setup_raw)
        need(admission.get('roles')==self.auth['roles']and admission.get('sourceRole')==self.auth['sourceRole']and setup.get('roles')==self.auth['roles']and setup.get('sourceRole')==self.auth['sourceRole']and setup.get('operatorSha256')==self.manifest['files'][AUTH_OPERATOR.name] and setup.get('credentialFiles')==self.auth['credentialFiles'],'same_actual_role_and_credential_setup_required')
        helper=self.p.load(ADMISSION_HELPER,self.manifest['files'][ADMISSION_HELPER.name],'direct_admission_current_verifier')
        verified=helper.verify_current(admission,phase='login',password_sha256=setup['passwordVerifierSha256'])
        need(verified.get('validated')is True and verified.get('roleCount')==9 and verified.get('databaseWrites')==0,'actual_current_prepared_grant_and_auth_graph_required')
        authurls=[]
        for path,pin in self.auth['credentialFiles'].items():
            raw,metadata=self.o.read(Path(path),100000,private=True);need(sha(raw)==pin and metadata[2]==metadata[3]==0 and stat.S_IMODE(metadata[4])==0o600,'actual_owned_credential_bytes_or_mode_changed')
            env=self.o.parse_env(raw)
            if path.endswith('/native-read.env'):
                name='arena_native_reader';url=env.get('ARENA_INDEXER_DATABASE_URL','');db='yunipals_backfill';port=5432;oid=self.auth['sourceRole']['oid'];self.source_url=url
                need(set(env)=={'ARENA_INDEXER_MODE','ARENA_INDEXER_RELEASE_ID','ARENA_INDEXER_SOURCE_KIND','ARENA_INDEXER_DATABASE_URL'}and env.get('ARENA_INDEXER_MODE')=='unified'and env.get('ARENA_INDEXER_RELEASE_ID')==SOURCE_ID and env.get('ARENA_INDEXER_SOURCE_KIND')=='unified','exact_native_read_selectors_required')
            else:
                w=next(w for w in self.proposal['workers']if w['privateOverlay']==path);name=w['role'];url=env.get('ARENA_DATABASE_URL','');db='yunipals_arena';port=15438;oid=self.auth['roles'][name]
                need(set(env)=={'ARENA_DATABASE_URL'},'role_overlay_must_not_override_retained_configuration')
            u=urlsplit(url);need(u.scheme in {'postgres','postgresql'}and u.hostname=='127.0.0.1'and u.port==port and unquote(u.path)=='/'+db and unquote(u.username or'')==name and bool(u.password)and not u.fragment,'exact_role_private_tcp_target_required')
            authurls.append({'name':name,'oid':oid,'url':url});self.urls[name]=url
        expected=[{'role':w['role'],**e}for w in self.proposal['workers']for e in w['requiredEdges']]
        names=list(self.auth['roles']);doc=self.inv.connect(self.o,15438,'yunipals_arena',self.inv.catalog_sql(names,expected,['yunipals_arena']))
        validate_catalog(doc,names,self.auth['roles'])
        source=self.proposal['sourceReader'];expected=[{'role':'arena_native_reader','relation':r['name'],'privilege':'SELECT','attribute':None}for r in source['tables']]
        doc2=self.inv.connect(self.o,5432,'yunipals_backfill',self.inv.catalog_sql(['arena_native_reader'],expected,['unified_ypal_20261023_v1','yunipals_indexer_control']))
        validate_catalog(doc2,['arena_native_reader'],{'arena_native_reader':self.auth['sourceRole']['oid']},source=True,ambient_functions=len(source['existingAmbientAuthority']['publicNonDefinerFunctions']))
        self.auth_urls=authurls
        runner=helper.runner()
        self.role_catalogs={scope:{k:v for k,v in helper.current_catalog(runner,self.proposal,scope).items()if k not in{'readOnly','isolation','markers'}}for scope in ['operational','source']}
        return {'operationalRoleOids':self.auth['roles'],'sourceRoleOid':self.auth['sourceRole']['oid'],'credentialFileHashes':self.auth['credentialFiles'],'operationalGraphSha256':sha(encoded(self.inv.stable_catalog(doc))),'sourceGraphSha256':sha(encoded(self.inv.stable_catalog(doc2)))}
    def capacity(self):
        out={}
        for name,port,database,required,names in [('operational',15438,'yunipals_arena',60,list(self.auth['roles'])),('source',5432,'yunipals_backfill',31,['arena_native_reader'])]:
            selected=self.inv.literal(json.dumps(names))
            sql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;WITH activity AS MATERIALIZED(SELECT usename FROM pg_stat_activity)SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only')='on','maximum',current_setting('max_connections')::int,'reserved',current_setting('superuser_reserved_connections')::int,'used',(SELECT count(*)::int FROM activity),'ownedUsed',(SELECT count(*)::int FROM activity WHERE usename IN(SELECT jsonb_array_elements_text("+selected+"::jsonb))));ROLLBACK;"
            out[name]=capacity_admitted(self.inv.connect(self.o,port,database,sql),required)
        return out
    def artifacts(self,fresh=True):
        raw=self.p.protected(PLAN_FILE,100000);need(sha(raw)==PLAN_SHA,'actual_installed_constructor_plan_required');candidate=json.loads(raw)
        need(candidate['sourceDigest']==SOURCE and candidate['packageProofSha256']==PROOF_SHA and candidate['installResultSha256']==INSTALL_SHA,'exact_modern_installed_candidate_required')
        self.p.candidate(candidate,self.p.load(self.p.RUNTIME_HELPER,self.p.RUNTIME_HELPER_SHA,'direct_runtime_inventory'))
        qualified_raw=self.p.protected(QUALIFIED,200000);need(sha(qualified_raw)==QUALIFIED_SHA,'actual_all_eight_constructor_result_required');q=json.loads(qualified_raw)
        need(q.get('qualified')is True and q.get('scope')=='all-eight'and q.get('qualifiedContexts')==8 and q.get('privateInputsUnchanged')is True and all(q.get(k)==0 for k in ['serviceJobs','schemaWrites','sourceSelectionsChanged']),'actual_eight_context_constructor_acceptance_required')
        proof=json.loads(self.p.protected(candidate['packageProofFile'],2000000));pins=proof['nativeUnits']['files']
        need(set(pins)=={w['unit']for w in self.proposal['workers']}and len(pins)==8,'eight_source_qualified_native_units_required')
        for name,pin in pins.items():
            body=self.p.protected(WORK/'native-units'/name,100000);need(sha(body)==pin and b'WantedBy=multi-user.target'in body,'actual_rendered_native_unit_required')
            if fresh:need(not os.path.lexists(Path('/etc/systemd/system')/name),'fresh_native_unit_namespace_required')
            need(not os.path.lexists(Path('/etc/systemd/system')/(name+'.d'))and not os.path.lexists(Path('/run/systemd/system')/name)and not os.path.lexists(Path('/run/systemd/system')/(name+'.d')),'fresh_native_unit_namespace_required')
            self.native[name]={'sha256':pin,'body':body}
            if fresh:
                need(not activation_paths(name)and not os.path.lexists(Path('/usr/lib/systemd/system')/name),'fresh_native_activation_namespace_required')
        if fresh:
            listed=self.m.run(['/usr/bin/systemctl','list-units','--all','--plain','--no-legend','--no-pager',*pins],timeout=5,maximum=200000).decode()
            need(not any(n in line.split()for n in pins for line in listed.splitlines()),'unowned_loaded_native_unit_blocks_initial_review')
        need(sha(self.p.protected(CHILD,200000))==self.child_sha,'exact_direct_owner_child_required')
        return {'sourceDigest':SOURCE,'packageProofSha256':PROOF_SHA,'installResultSha256':INSTALL_SHA,'allEightConstructorResultSha256':QUALIFIED_SHA,'unitSha256':pins,'childSha256':self.child_sha}
    def boot_links(self):
        out={};parent=Path('/etc/systemd/system/multi-user.target.wants')
        for unit in self.m.UNITS:
            p=parent/unit
            if not os.path.lexists(p):need(activation_paths(unit)==[],'other_original_activation_path_refused');out[unit]=None;continue
            st=p.lstat();need(stat.S_ISLNK(st.st_mode)and st.st_uid==0 and st.st_gid==0 and os.readlink(p)==str(Path('/etc/systemd/system')/unit),'exact_original_boot_link_required')
            out[unit]={'path':str(p),'target':os.readlink(p),'dev':st.st_dev,'ino':st.st_ino}
            need(activation_paths(unit)==[str(p)],'other_original_activation_path_refused')
            raw=self.m.run(['/usr/bin/systemctl','show','--all',unit,'--property=TriggeredBy'],timeout=5,maximum=1000).decode()
            need(raw=='TriggeredBy=\n','original_timer_or_socket_activation_refused')
        return out
    def child(self,action,*,origins=None,intents=None,epoch=None,path=None,append=False,retained_ledger=None,private_seal=None):
        payload={'sourceContext':self.manifest['source'],'sourceUrl':self.source_url,'authUrls':self.auth_urls,'floor':self.plan['floor'],'expectedOrigins':origins,'intents':intents or[],'epoch':epoch,'retainedLedger':retained_ledger,'privateSeal':private_seal}
        raw=encoded(payload);authority=encoded({'format':'yunipals-arena-ypal-native-root-authority-v1','action':action,'payloadSha256':sha(raw),'planSha256':sha(encoded(self.plan)),'childSha256':self.child_sha})
        child=self.p.protected(CHILD,200000);adapter=self.p.protected(ADAPTER,200000);markers=self.p.protected(self.m.MIGRATIONS,100000)
        need(sha(child)==self.child_sha and sha(adapter)==ADAPTER_SHA and sha(markers)==self.m.MIGRATIONS_SHA,'exact_peer_public_inputs_required')
        fds=[]
        for name,body in [('root-authority',authority),('child',child),('adapter',adapter),('markers',markers)]:fds.append(sealed('arena-direct-native-'+name,body))
        bootstrap="import{readFileSync}from'node:fs';const m=await import('data:text/javascript;base64,'+readFileSync(Number(process.argv[3])).toString('base64'));await m.main({action:process.argv[1],authorityFd:Number(process.argv[2]),childFd:Number(process.argv[3]),adapterFd:Number(process.argv[4]),markersFd:Number(process.argv[5])}).catch(e=>{process.stdout.write(JSON.stringify({format:'yunipals-arena-ypal-native-child-v1',phase:'refused',fixedCode:'direct_native_owner_refused',errorClass:e.name,rawMessagesExported:false})+'\\n');process.exitCode=1})"
        user=pwd.getpwnam('postgres');args=['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs',str(self.m.NODE),'--input-type=module','--eval',bootstrap,action,*[str(fd)for fd in fds]]
        try:
            if path is not None and append and path.exists():
                self.p.protected(path,2000000);journal_rows(path)
            output=subprocess.PIPE if path is None else os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|(os.O_APPEND if append else os.O_EXCL),0o600),'ab'if append else'wb')
            try:
                proc=subprocess.Popen(args,stdin=subprocess.PIPE,env=ENV,pass_fds=tuple(fds),stdout=output,stderr=subprocess.PIPE,start_new_session=True)
                try:stdout,stderr=proc.communicate(raw,timeout=240)
                except BaseException:
                    os.killpg(proc.pid,signal.SIGKILL);proc.communicate();raise
                if path is not None:output.flush();os.fsync(output.fileno())
            finally:
                if path is not None:output.close()
            rows=journal_rows(path)if path is not None else[json.loads(x)for x in stdout.splitlines()]
            need(proc.returncode==0 and not stderr and rows and all(r.get('format')=='yunipals-arena-ypal-native-child-v1'for r in rows),'bounded_direct_owner_child_refused')
            return rows
        finally:
            for fd in fds:os.close(fd)
    def review(self):
        need(not os.path.lexists(BASE),'fresh_direct_cutover_namespace_required')
        self.p.retained(self.r,self.m,self.o)
        role=self.files_and_roles();artifact=self.artifacts();normal=self.normal()
        self.capacity()
        self.actor_context.current_actors()
        actors={row['unit']:self.current_actor(row)for row in self.base['services']}
        rows=self.child('review');online=next(r['proof']for r in rows if r['phase']=='online_review')
        return {'format':FORMAT,'plan':self.plan,'roleAuth':role,'artifact':artifact,'normal':normal,'acknowledgedCurrentActors':self.actor_context.acknowledged(),'oldWholeInvocationGatePassed':False,'actors':actors,'oldBootLinks':self.boot_links(),'online':online,'capacityAdmitted':{'operationalWorkerSlots':60,'sourceWorkerSlots':31,'ownerProbeSlotsPerCluster':1},'privateInputsUnchanged':True,'migrationsPerformed':0,'sourceSelectionChanged':False}
    def verify_old(self,review):
        self.r.graph(self.m,self.o,self.base,self.binding,owned=False);self.m.verify_inputs(self.o,self.binding['privateInputHashes'])
        need(self.actor_context.current_actors()['actors']==review['actors'] and review['acknowledgedCurrentActors']==self.actor_context.acknowledged(),'fresh_current_actor_ack_required_before_owned_stop')
        need({row['unit']:self.current_actor(row)for row in self.base['services']}==review['actors'],'reviewed_current_actors_changed_before_stop')
        need(self.normal()==review['normal'],'normal_source_changed_before_cutover')
    def install_units(self):
        save(BASE/'native-files-intent.json',{'sha256':{n:v['sha256']for n,v in self.native.items()},'sameBoot':Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
        out={}
        for name,v in self.native.items():
            path=Path('/etc/systemd/system')/name
            prepared=path.parent/('.'+name+'.direct-native-20261023.prepared')
            fd=os.open(prepared,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
            with os.fdopen(fd,'wb')as f:f.write(v['body']);f.flush();os.fsync(f.fileno());st=os.fstat(f.fileno())
            sync_dir(path.parent)
            # Persist the inode BEFORE publishing it. A lost command ACK cannot
            # turn an exact owned inode into an unknown file on inverse.
            row={'file':str(path),'prepared':str(prepared),'sha256':v['sha256'],'dev':st.st_dev,'ino':st.st_ino}
            save(BASE/(name+'.file-prepared.json'),row)
            os.link(prepared,path,follow_symlinks=False);sync_dir(path.parent);prepared.unlink()
            sync_dir(path.parent)
            out[name]=row
            save(BASE/(name+'.file-created.json'),out[name])
        save(BASE/'native-files.json',out);self.m.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
    def retire_boot(self,links):
        for unit,row in links.items():
            if row is None:continue
            path=Path(row['path']);st=path.lstat();need(stat.S_ISLNK(st.st_mode)and(st.st_dev,st.st_ino)==(row['dev'],row['ino'])and os.readlink(path)==row['target'],'original_boot_link_changed_before_retirement')
            save(BASE/(unit+'.boot-removal-intent.json'),row);path.unlink();fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
            save(BASE/(unit+'.boot-removed.json'),row)
    def drain(self,review):
        self.verify_old(review)
        bindings=[{**row,'invocation':review['actors'][row['unit']]['invocation']}for row in self.binding['currentUnits']]
        processes={unit:row['process']for unit,row in review['actors'].items()}
        return self.m.drain(self.o,self.m.load(OPS/'proxy-upgrade.py',self.m.VERIFIER_SHA,'drain_definitions',self.o),bindings,processes)
    def quiet(self):
        self.r.no_jobs(self.m)
        for unit in self.m.UNITS:
            p=self.r.props(self.m,unit);need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'},'original_worker_not_terminal');self.r.cgroup(unit)
        need(self.m.catalog()['otherSessions']==0,'operational_clients_must_be_drained')
    def backup(self):
        need(shutil.disk_usage('/var/backups').free>=25000000000,'private_backup_reserve_required')
        save(BASE/'private-before.json',self.m.snapshot());save(BASE/'schema-before.json',self.m.schema_objects())
        path=BASE/'arena-before.dump';fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb')as out:self.m.run(self.m.peer_prefix()+['/usr/bin/pg_dump','--no-password','--format=custom','--lock-wait-timeout=2s','yunipals_arena'],timeout=75,output=out);out.flush();os.fsync(out.fileno())
        need(0<path.stat().st_size<=128000000,'bounded_current_schema_backup_required');toc=self.m.run(['/usr/bin/pg_restore','--list',str(path)],timeout=15,maximum=2000000)
        result={'dumpSha256':sha(path.read_bytes()),'bytes':path.stat().st_size,'tocSha256':sha(toc),'committedMigrationsRetained':12};save(BASE/'backup.json',result);return result
    def native_identity(self,unit):
        p=self.native_static(unit);need(p['ActiveState']=='active'and p['SubState']=='running'and re.fullmatch('[0-9a-f]{32}',p['InvocationID']),'native_actor_not_running')
        expected=next(w for w in self.proposal['workers']if w['unit']==unit);pid=int(p['MainPID']);root=Path('/proc')/str(pid)
        status=dict(line.split(':',1)for line in(root/'status').read_text().splitlines()if ':'in line)
        need([int(x)for x in status['Uid'].split()]==[971]*4 and[int(x)for x in status['Gid'].split()]==[965]*4,'native_uid_gid_changed')
        argv=(root/'cmdline').read_bytes().split(b'\0');worker=next(w for w in self.worker_proposal['workers']if w['unit']==unit)
        group=self.native_group(unit)
        need(argv==[str(self.m.NODE).encode(),worker['bundleRelative'].encode(),b'']and(root/'cgroup').read_text().splitlines()==['0::/'+str(group.relative_to('/sys/fs/cgroup'))],'exact_native_argv_and_cgroup_required')
        need(all(int(status[k],16)==0 for k in ['CapPrm','CapEff','CapAmb'])and status['NoNewPrivs'].strip()=='1','native_effective_privilege_expansion_forbidden')
        raw=(root/'stat').read_text();start=int(raw[raw.rfind(')')+2:].split()[19])
        if(BASE/'native-start-intent.json').exists():
            intent=json.loads(self.p.protected(BASE/'native-start-intent.json',10000));need(start>=intent['monotonicNs']*os.sysconf('SC_CLK_TCK')//1000000000,'native_actor_predates_owned_start_intent')
        # Root E0 may not read a NNP process's exe/cwd; use only its existing UID.
        code="import os,json,sys;from pathlib import Path;p=Path('/proc')/sys.argv[1];print(json.dumps({'exe':str((p/'exe').resolve())==sys.argv[2],'cwd':str((p/'cwd').resolve())==sys.argv[3]}))"
        args=['/usr/bin/setpriv','--reuid=971','--regid=965','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/python3','-I','-c',code,str(pid),str(self.m.NODE),str(self.root/'apps/yunipals-market-api')]
        need(json.loads(self.m.run(args,maximum=1024))=={'exe':True,'cwd':True},'native_executable_or_cwd_changed')
        after=(root/'stat').read_text();need(start==int(after[after.rfind(')')+2:].split()[19])and self.r.props(self.m,unit)==p,'native_process_changed_during_peer_proof')
        return {'pid':pid,'startTicks':start,'invocation':p['InvocationID'],'uid':971,'gid':965,'unitSha256':self.native[unit]['sha256']}
    def native_group(self,unit):
        raw=self.m.run(['/usr/bin/systemctl','show','--all',unit,'--property=Id','--property=Slice','--property=ControlGroup'],timeout=5,maximum=4000).decode()
        rows=[line.split('=',1)for line in raw.splitlines()];need(len(rows)==3 and len(dict(rows))==3,'fixed_native_cgroup_metadata_required');v=dict(rows)
        need(set(v)=={'Id','Slice','ControlGroup'}and v['Id']==unit,'exact_native_cgroup_selector_required')
        return valid_native_group(unit,v['Slice'],v['ControlGroup'])
    def native_static(self,unit):
        need(unit in self.native,'fixed_native_unit_required');path=Path('/etc/systemd/system')/unit
        need(sha(self.p.protected(path,100000))==self.native[unit]['sha256']and not os.path.lexists(Path(str(path)+'.d'))and not os.path.lexists(Path('/run/systemd/system')/unit)and not os.path.lexists(Path('/run/systemd/system')/(unit+'.d')),'native_definition_or_dropin_changed')
        p=self.r.props(self.m,unit)
        need(p['FragmentPath']==str(path)and p['DropInPaths']==''and p['User']=='yunipals-arena'and p['Group']=='yunipals-arena'and p['WorkingDirectory']==str(self.root/'apps/yunipals-market-api'),'native_manager_static_identity_changed')
        settings=[line.partition('=')for line in self.native[unit]['body'].decode().splitlines()if '='in line]
        typed=self.o.typed_properties(unit)
        need(typed['EnvironmentFiles']==[[v,False]for k,_,v in settings if k=='EnvironmentFile']and typed['Environment']==[]and typed['LoadCredential']==[v.split(':',1)for k,_,v in settings if k=='LoadCredential'],'native_manager_environment_or_credentials_changed')
        words=shlex.split(next(v for k,_,v in settings if k=='ExecStart'))
        actual=re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])
        need(len(actual)==1 and shlex.split(actual[0])in[words,[w.replace('%d','/run/credentials/'+unit)for w in words]],'native_manager_exec_changed')
        return p
    def native_set(self,allow_descendants=False):
        identities={u:self.native_identity(u)for u in self.native}
        for unit,row in identities.items():
            group=self.native_group(unit)
            if not allow_descendants:need((group/'cgroup.procs').read_text().split()==[str(row['pid'])],'unowned_native_child_blocks_unhalt')
        self.uid_inventory(identities,allow_descendants)
        return identities
    def uid_inventory(self,identities,allow_descendants=False):
        pids=self.arena_uid_pids();main_pids={r['pid']for r in identities.values()}
        need(main_pids<=pids,'owned_native_main_disappeared')
        if not allow_descendants:need(pids==main_pids,'other_arena_actor_blocks_unhalt');return
        mains={'/'+str(self.native_group(u).relative_to('/sys/fs/cgroup')):row['pid']for u,row in identities.items()}
        def read(pid):
            root=Path('/proc')/str(pid);before=(root/'stat').read_text();start=before[before.rfind(')')+2:].split()[19]
            status=dict(line.split(':',1)for line in(root/'status').read_text().splitlines()if ':'in line);groups=(root/'cgroup').read_text().splitlines();need(len(groups)==1 and groups[0].startswith('0::'),'fixed_native_descendant_cgroup_required')
            after=(root/'stat').read_text();need(start==after[after.rfind(')')+2:].split()[19],'native_descendant_pid_reused')
            return {'uid':[int(v)for v in status['Uid'].split()],'gid':[int(v)for v in status['Gid'].split()],'nnp':status['NoNewPrivs'].strip(),'parent':int(status['PPid']),'group':groups[0][3:],**{k:status[k].strip()for k in ['CapPrm','CapEff','CapAmb']}}
        for pid in pids-main_pids:
            try:descendant_owner(pid,mains,read)
            except FileNotFoundError:need(not(Path('/proc')/str(pid)).exists(),'unproved_native_descendant')
    def arena_uid_pids(self):
        pids=set()
        for p in Path('/proc').iterdir():
            if p.name.isdecimal():
                try:uid=p.stat().st_uid
                except FileNotFoundError:continue
                if uid==971:pids.add(int(p.name))
        return pids
    def native_boot(self,unit,write=False):
        path=Path('/etc/systemd/system/multi-user.target.wants')/unit;target=str(Path('/etc/systemd/system')/unit);prepared=path.parent/('.'+unit+'.direct-native-boot-20261023')
        intent_file=BASE/(unit+'.native-boot-intent.json');prepared_file=BASE/(unit+'.native-boot-prepared.json');ack_file=BASE/(unit+'.native-boot.json')
        intent={'path':str(path),'target':target,'prepared':str(prepared)}
        if intent_file.exists():need(json.loads(self.p.protected(intent_file,10000))==intent,'owned_native_boot_intent_changed')
        else:
            need(not os.path.lexists(path)and not os.path.lexists(prepared)and not prepared_file.exists()and not ack_file.exists(),'unknown_native_boot_path_refused')
            if write:save(intent_file,intent)
        row=json.loads(self.p.protected(prepared_file,10000))if prepared_file.exists()else None
        if row:
            need({k:row[k]for k in intent}==intent,'fixed_native_boot_paths_required')
            for file in [path,prepared]:
                if os.path.lexists(file):
                    s=file.lstat();need(stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and(s.st_dev,s.st_ino)==(row['dev'],row['ino'])and os.readlink(file)==target,'foreign_native_boot_inode_refused')
            need(os.path.lexists(path)or os.path.lexists(prepared),'owned_native_boot_inode_disappeared')
        else:need(not os.path.lexists(path)and not os.path.lexists(prepared),'unacknowledged_prepared_native_boot_inode_refused')
        need(activation_paths(unit)==([str(path)]if os.path.lexists(path)else[]),'other_native_autoactivation_path_refused')
        if ack_file.exists():need(row==json.loads(self.p.protected(ack_file,10000))and os.path.lexists(path),'acknowledged_native_boot_path_changed')
        if write:
            if row is None:
                prepared.symlink_to(target);sync_dir(path.parent);s=prepared.lstat();row={**intent,'dev':s.st_dev,'ino':s.st_ino};save(prepared_file,row)
            if not os.path.lexists(path):os.link(prepared,path,follow_symlinks=False);sync_dir(path.parent)
            if os.path.lexists(prepared):prepared.unlink();sync_dir(path.parent)
            if not ack_file.exists():save(ack_file,row)
        return {'published':os.path.lexists(path),'acknowledged':ack_file.exists(),'inode':None if row is None else{'dev':row['dev'],'ino':row['ino']}}
    def stable_native(self,path,allow_descendants=False):
        deadline=time.monotonic()+90;first=None;since=None
        while True:
            try:current=self.native_set(allow_descendants=allow_descendants)
            except CutoverFailure:current=None
            if current:
                if first is None:first=current;since=time.monotonic()
                need(current==first,'native_actor_restarted_during_stability')
                if time.monotonic()-since>=20:break
            elif first:raise CutoverFailure('native_actor_failed_during_stability')
            need(time.monotonic()<deadline,'native_start_not_stable');time.sleep(.5)
        save(path,first);return first
    def start_native(self,epoch):
        self.files_and_roles();self.native_resume_review(epoch)
        save(BASE/'capacity-before-start.json',self.capacity())
        need(all(not activation_paths(u)for u in self.m.UNITS),'original_autoactivation_path_reappeared')
        names=list(self.native)
        for unit in names:
            p=self.native_static(unit);need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'},'fresh_native_unit_already_running')
            self.native_boot(unit)
        save(BASE/'native-start-intent.json',{'units':names,'epoch':epoch,'automaticRetry':False,'monotonicNs':time.monotonic_ns()})
        for unit in names:self.native_boot(unit,write=True)
        self.m.run(['/usr/bin/systemctl','daemon-reload'],timeout=10);self.m.run(['/usr/bin/systemctl','start','--no-block',*names],timeout=10)
        return self.stable_native(BASE/'native-started.json')

    def recovery_binding(self):
        operation=json.loads(self.p.protected(BASE/'operation.json',10000));review=json.loads(self.p.protected(BASE/'review.json',200000))
        need(operation=={'format':FORMAT,'operatorSha256':sha(Path(__file__).read_bytes()),'childSha256':self.child_sha,'manifestSha256':self.plan['manifestSha256'],'currentActorsAcknowledgementSha256':ACTOR_ACK_SHA,'planSha256':sha(encoded(self.plan)),'reviewHash':sha(encoded(review)),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()},'exact_same_boot_owned_operation_required')
        need(json.loads(self.p.protected(BASE/'plan.json',100000))==self.plan,'owned_plan_changed');return review
    def adopted_state(self):
        rows=journal_rows(BASE/'owner-commit.jsonl');adoptions=[r for r in rows if r['phase']=='adoption_commit_intent']
        need(len(adoptions)==1 and 'retainedLedger'in adoptions[0],'one_owned_recorded_adoption_required')
        adoption=adoptions[0]
        states=self.child('status',intents=transaction_intents(),retained_ledger=adoption['retainedLedger'])
        state=next(r['state']for r in states if r['phase']=='reconciled_state')
        return adoption,state
    def original_quiet(self):
        self.r.no_jobs(self.m)
        for unit in self.m.UNITS:
            p=self.r.props(self.m,unit);need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'},'original_worker_not_terminal');self.r.cgroup(unit)
        need(all(not activation_paths(u)for u in self.m.UNITS),'original_autoactivation_path_reappeared')
    def native_resume_review(self,epoch,allow_descendants=False):
        files=json.loads(self.p.protected(BASE/'native-files.json',100000));need(set(files)==set(self.native),'exact_eight_owned_native_files_required')
        intent_file=BASE/'native-start-intent.json';intent=json.loads(self.p.protected(intent_file,10000))if intent_file.exists()else None
        if intent:need(set(intent['units'])==set(self.native)and intent['epoch']==epoch and type(intent['monotonicNs'])is int,'owned_initial_native_start_epoch_required')
        jobs=self.m.run(['/usr/bin/systemctl','list-jobs','--plain','--no-legend','--no-pager'],timeout=5,maximum=100000).decode()
        need(not any(u in line.split()for u in self.native for line in jobs.splitlines()),'native_manager_job_must_finish_before_continuation')
        out={};identities={}
        for unit in self.native:
            row=files[unit];expected=Path('/etc/systemd/system')/unit;need(row['file']==str(expected)and row['sha256']==self.native[unit]['sha256'],'owned_native_file_receipt_changed')
            s=expected.lstat();need(stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and(s.st_dev,s.st_ino)==(row['dev'],row['ino']),'owned_native_file_inode_changed')
            p=self.native_static(unit);boot=self.native_boot(unit)
            if p['MainPID']!='0':
                need(intent is not None,'running_native_actor_without_owned_start_intent');identity=self.native_identity(unit);identities[unit]=identity;out[unit]={'state':'running','identity':identity,'boot':boot}
                group=self.native_group(unit)
                if not allow_descendants:need((group/'cgroup.procs').read_text().split()==[str(identity['pid'])],'unowned_native_child_blocks_continuation')
            else:
                need(p['ActiveState']in{'inactive','failed'}and p['SubState']in{'dead','failed'},'unknown_native_start_state_refused')
                # Exact owned unit inode + manager/env/credential graph, no job,
                # empty cgroup and selected epoch prove the worker namespace.
                # Explicit continuation may resume it using its durable UUIDs.
                for group in [Path('/sys/fs/cgroup/system.slice')/unit,*([Path('/sys/fs/cgroup/system.slice')/('system-'+unit.split('@',1)[0].replace('-',r'\x2d')+'.slice')/unit]if '@'in unit else[])]:
                    if group.exists():need(not(group/'cgroup.procs').read_text().strip()and dict(line.split()for line in(group/'cgroup.events').read_text().splitlines()).get('populated')=='0','inactive_native_cgroup_not_empty')
                out[unit]={'state':'inactive','invocation':p['InvocationID'],'boot':boot}
        self.uid_inventory(identities,allow_descendants)
        return {'initialStartIntentPresent':intent is not None,'units':out}
    def continue_review(self):
        original=self.recovery_binding();self.artifacts(fresh=False);roles=self.files_and_roles();normal=self.normal()
        self.m.verify_inputs(self.o,self.binding['privateInputHashes']);self.r.graph(self.m,self.o,self.base,self.binding,owned=False);self.original_quiet()
        owner=json.loads(self.r.read(self.o,self.r.PARENT/'result.json'));need(sha(encoded(self.m.schema_objects()))==owner['postcheck']['officialObjects']['objectsSha256'],'committed_native_guard_functions_or_triggers_changed')
        adoption,state=self.adopted_state();forward=forward_phase(state,transaction_intents(),adoption)
        starting=(BASE/'native-start-intent.json').exists()
        if not starting:
            self.quiet();self.native_quiet();need(state['privateSeal']['tables']==adoption['privateSeal']['tables']and state['privateSeal']['aadSha256']==adoption['privateSeal']['aadSha256'],'pre_native_private_history_changed')
        self.child('verify-source',origins=adoption['origins'])
        need(forward['phase']!='complete'or starting,'own_unhalt_requires_prior_native_start_intent')
        native=None if forward['phase']=='publish'else self.native_resume_review(forward['selection']['epoch'],allow_descendants=forward['phase']=='complete')
        self.capacity()
        need(forward['phase']!='publish'or not starting,'cannot_publish_a_new_selector_after_native_start')
        return {'format':FORMAT,'planSha256':sha(encoded(self.plan)),'originalReviewHash':sha(encoded(original)),'forward':forward,'native':native,'normal':normal,'roleAuth':roles,'canonicalFloorReverified':True,'migrationsPerformed':0,'automaticRetry':False}
    def continue_apply(self,review,expected):
        need(sha(encoded(review))==expected,'fresh_exact_forward_continuation_review_required')
        attempts=sorted(BASE.glob('continuation-attempt-*.json'));need(len(attempts)<8,'bounded_explicit_continuation_attempts_exhausted')
        index=len(attempts);need({p.name for p in attempts}=={'continuation-attempt-'+str(n)+'.json'for n in range(index)},'owned_finite_continuation_sequence_required')
        save(BASE/('continuation-attempt-'+str(index)+'.json'),{'reviewHash':expected,'review':review,'monotonicNs':time.monotonic_ns(),'automaticRetry':False})
        adoption,state=self.adopted_state();forward=forward_phase(state,transaction_intents(),adoption)
        need(forward==review['forward'],'owned_source_transaction_state_changed_before_continuation')
        if forward['phase']=='publish':
            self.quiet();self.child('publish',origins=adoption['origins'],path=BASE/'owner-publication-continue.jsonl',append=True,retained_ledger=adoption['retainedLedger'],private_seal=adoption['privateSeal'])
            adoption,state=self.adopted_state();forward=forward_phase(state,transaction_intents(),adoption)
            need(forward['phase']=='native','owned_initial_publication_not_acknowledged')
        selected=forward['selection'];epoch=selected['epoch']
        self.child('verify-source',origins=adoption['origins']);self.files_and_roles();save(BASE/('capacity-continue-'+str(index)+'.json'),self.capacity())
        if not(BASE/'native-start-intent.json').exists():native=self.start_native(epoch)
        else:
            allow_descendants=forward['phase']=='complete';current=self.native_resume_review(epoch,allow_descendants=allow_descendants)
            if review['native']is not None:need(current==review['native'],'native_actors_or_boot_paths_changed_before_continuation')
            repairs=any(not r['boot'].get('acknowledged')for r in current['units'].values())
            for unit in self.native:
                if not current['units'][unit]['boot'].get('acknowledged'):self.native_boot(unit,write=True)
            after=self.native_resume_review(epoch,allow_descendants=allow_descendants)
            need({u:{k:v for k,v in r.items()if k!='boot'}for u,r in after['units'].items()}=={u:{k:v for k,v in r.items()if k!='boot'}for u,r in current['units'].items()},'native_actor_changed_while_finishing_owned_boot_paths')
            inactive=[u for u,r in after['units'].items()if r['state']=='inactive']
            save(BASE/('native-resume-intent-'+str(index)+'.json'),{'epoch':epoch,'states':current,'units':inactive,'monotonicNs':time.monotonic_ns(),'explicitReviewHash':expected})
            if inactive or repairs:self.m.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
            if inactive:self.m.run(['/usr/bin/systemctl','start','--no-block',*inactive],timeout=10)
            native=self.stable_native(BASE/('native-continued-'+str(index)+'.json'),allow_descendants=allow_descendants)
        self.m.verify_inputs(self.o,self.binding['privateInputHashes'])
        need(self.normal()==review['normal'],'normal_source_changed_before_continued_unhalt');self.files_and_roles();need(self.native_set(allow_descendants=forward['phase']=='complete')==native,'native_actor_changed_before_continued_unhalt')
        adoption,state=self.adopted_state();final=forward_phase(state,transaction_intents(),adoption);need(final['selection']==selected,'owned_selected_epoch_changed_before_unhalt')
        if final['phase']=='native':self.child('unhalt',epoch=epoch,path=BASE/'owner-unhalt-continue.jsonl',append=True)
        else:need(final['phase']=='complete'and final['unhaltXid'],'lost_unhalt_ack_requires_actual_committed_own_xid')
        adoption,state=self.adopted_state();done=forward_phase(state,transaction_intents(),adoption);need(done['phase']=='complete','continued_unhalt_not_confirmed')
        result={'format':FORMAT,'completed':True,'currentActorsAcknowledgementSha256':ACTOR_ACK_SHA,'oldWholeInvocationGatePassed':False,'continued':True,'sourceDigest':SOURCE,'selectedEpoch':epoch,'nativeActors':native,'migrationInvocations':0,'privateDataRestores':0,'providerActionsReissuedByOwner':0,'unhaltXid':done['unhaltXid'],'automaticRetry':False}
        save(BASE/('continuation-result-'+str(index)+'.json'),result);return result
    def inverse_review(self):
        review=self.recovery_binding();self.files_and_roles();self.artifacts(fresh=False);source=self.normal(terminal_ok=True)
        need(not(BASE/'native-start-intent.json').exists()and not(BASE/'owner-unhalt.jsonl').exists(),'native_start_or_external_effect_boundary_forbids_original_inverse')
        if(BASE/'adoption-owner-intent.json').exists():self.quiet()
        self.r.graph(self.m,self.o,self.base,self.binding,owned=False);self.m.verify_inputs(self.o,self.binding['privateInputHashes'])
        statuses=self.child('status',intents=transaction_intents());state=next(r['state']for r in statuses if r['phase']=='reconciled_state');pre_adoption_inverse(state)
        # Private bytes must still match the authoritative halted baseline if
        # an adoption was attempted. The graph alone never proves its outcome.
        commits=[r for r in journal_rows(BASE/'owner-commit.jsonl')if r['phase']=='adoption_commit_intent']
        need(not commits or state['privateSeal']==commits[-1]['privateSeal'],'private_history_changed_since_aborted_adoption')
        for unit in self.native:
            receipt=BASE/(unit+'.file-prepared.json')
            if receipt.exists():
                row=json.loads(self.p.protected(receipt,10000));path=Path(row['file'])
                if os.path.lexists(path):
                    s=path.lstat();need(stat.S_ISREG(s.st_mode)and(s.st_dev,s.st_ino)==(row['dev'],row['ino'])and sha(path.read_bytes())==row['sha256'],'foreign_native_file_blocks_inverse')
                if os.path.lexists(row['prepared']):
                    s=Path(row['prepared']).lstat();need(stat.S_ISREG(s.st_mode)and(s.st_dev,s.st_ino)==(row['dev'],row['ino'])and sha(Path(row['prepared']).read_bytes())==row['sha256'],'foreign_prepared_file_blocks_inverse')
            else:need(not os.path.lexists(Path('/etc/systemd/system')/unit),'unacknowledged_native_file_blocks_inverse')
        self.native_quiet()
        states={}
        for public in self.base['services']:
            unit=public['unit'];p=self.r.props(self.m,unit);prior=review['actors'][unit]
            if p['MainPID']!='0':need({'invocation':p['InvocationID'],'process':self.m.process_identity(p,public)}==prior,'foreign_original_actor_blocks_inverse');states[unit]='retained_running'
            else:
                need(p['ActiveState']in{'inactive','failed'}and p['InvocationID']in{'',prior['invocation']},'foreign_original_invocation_blocks_inverse');self.r.cgroup(unit);states[unit]='stopped'
        for unit,row in review['oldBootLinks'].items():
            path=Path('/etc/systemd/system/multi-user.target.wants')/unit
            if row is None:need(not os.path.lexists(path),'foreign_original_boot_link_blocks_inverse')
            elif os.path.lexists(path):
                s=path.lstat();need(stat.S_ISLNK(s.st_mode)and(s.st_dev,s.st_ino)==(row['dev'],row['ino'])and os.readlink(path)==row['target'],'foreign_original_boot_link_blocks_inverse')
            else:need((BASE/(unit+'.boot-removal-intent.json')).exists(),'unowned_original_boot_removal_blocks_inverse')
        need(not(BASE/'original-restart-intent.json').exists(),'existing_original_start_requires_readonly_reconciliation_no_retry')
        return {'format':FORMAT,'reviewHash':sha(encoded(review)),'state':state,'originalStates':states,'oldBootLinks':review['oldBootLinks'],'operatorSha256':sha(Path(__file__).read_bytes()),'privateDataRestores':0,'adoptionCommitted':False,'source':source}
    def native_quiet(self):
        for unit in self.native:
            if os.path.lexists(Path('/etc/systemd/system')/unit):
                p=self.r.props(self.m,unit);need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'}and p['SubState']in{'dead','failed'},'running_native_actor_blocks_original_inverse')
            groups=[Path('/sys/fs/cgroup/system.slice')/unit]
            if '@'in unit:
                template='system-'+unit.split('@',1)[0].replace('-',r'\x2d')+'.slice';groups.append(Path('/sys/fs/cgroup/system.slice')/template/unit)
            for group in groups:
                if group.exists():
                    need(not(group/'cgroup.procs').read_text().strip()and dict(line.split()for line in(group/'cgroup.events').read_text().splitlines()).get('populated')=='0','live_native_cgroup_blocks_original_inverse')
    def inverse(self,review,expected):
        need(sha(encoded(review))==expected,'fresh_exact_pre_adoption_inverse_review_required')
        need(self.normal(terminal_ok=True)==review['source'],'fresh_owned_active_or_terminal_source_inverse_context_required')
        save(BASE/'inverse-intent.json',{'review':review,'automaticRetry':False})
        self.native_quiet()
        for unit in self.native:
            receipt=BASE/(unit+'.file-prepared.json')
            if not receipt.exists():continue
            row=json.loads(self.p.protected(receipt,10000))
            for name in ['file','prepared']:
                path=Path(row[name])
                if os.path.lexists(path):
                    s=path.lstat();need((s.st_dev,s.st_ino)==(row['dev'],row['ino'])and stat.S_ISREG(s.st_mode)and sha(path.read_bytes())==row['sha256'],'only_owned_native_inode_may_be_removed');path.unlink();sync_dir(path.parent)
        for unit,row in review['oldBootLinks'].items():
            if row is None or os.path.lexists(row['path']):continue
            path=Path(row['path']);prepared=path.parent/('.'+unit+'.direct-native-restore-20261023')
            prepared.symlink_to(row['target']);sync_dir(path.parent);s=prepared.lstat()
            save(BASE/(unit+'.boot-restore-prepared.json'),{'path':str(path),'prepared':str(prepared),'target':row['target'],'dev':s.st_dev,'ino':s.st_ino})
            os.link(prepared,path,follow_symlinks=False);sync_dir(path.parent);prepared.unlink();sync_dir(path.parent)
        # Mode and adoption share one transaction: an aborted own transaction
        # already leaves legacy/unhalted. This inverse has NO database writer.
        self.m.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
        names=[u for u,s in review['originalStates'].items()if s=='stopped']
        save(BASE/'original-restart-intent.json',{'units':names,'automaticRetry':False,'monotonicNs':time.monotonic_ns()})
        need(self.normal(terminal_ok=True)==review['source'],'source_financial_and_static_context_changed_before_original_restart')
        if names:self.m.run(['/usr/bin/systemctl','start','--no-block',*names],timeout=10)
        deadline=time.monotonic()+60;actors=None;since=None
        while True:
            try:
                current={row['unit']:{'invocation':self.r.props(self.m,row['unit'])['InvocationID'],'process':self.m.process_identity(self.r.props(self.m,row['unit']),row)}for row in self.base['services']}
            except BaseException:current=None
            if current:
                if actors is None:actors=current;since=time.monotonic()
                need(current==actors,'original_actor_restarted_during_inverse_stability')
                if time.monotonic()-since>=10:break
            elif actors:raise CutoverFailure('original_inverse_actor_failed')
            need(time.monotonic()<deadline,'original_inverse_start_incomplete');time.sleep(.5)
        self.r.database(self.m);self.m.verify_inputs(self.o,self.binding['privateInputHashes'])
        result={'format':FORMAT,'preAdoptionRestored':True,'currentActorsAcknowledgementSha256':ACTOR_ACK_SHA,'oldWholeInvocationGatePassed':False,'originalActors':actors,'privateDataRestores':0,'migrationInvocations':0,'sourceSelectionWrites':0};save(BASE/'inverse-result.json',result);return result


def apply(host,review,expected):
    need(sha(encoded(review))==expected,'exact_fresh_online_cutover_review_required')
    need(not os.path.lexists(BASE),'fresh_operation_required_no_implicit_retry')
    BASE.mkdir(mode=0o700);sync_dir(BASE.parent);save(BASE/'plan.json',host.plan);save(BASE/'review.json',review)
    save(BASE/'operation.json',{'format':FORMAT,'operatorSha256':sha(Path(__file__).read_bytes()),'childSha256':host.child_sha,'manifestSha256':host.plan['manifestSha256'],'currentActorsAcknowledgementSha256':ACTOR_ACK_SHA,'planSha256':sha(encoded(host.plan)),'reviewHash':expected,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
    host.verify_old(review);save(BASE/'stop-intent.json',{'actors':review['actors'],'normalMustRemainRunning':True})
    host.install_units();host.retire_boot(review['oldBootLinks'])
    stopped=host.drain(review);save(BASE/'old-stopped.json',stopped);host.quiet();host.backup()
    host.files_and_roles();need(host.normal()==review['normal'],'normal_source_changed_after_drain')
    save(BASE/'adoption-owner-intent.json',{'origins':review['online']['origins'],'sourceFloor':host.plan['floor'],'automaticRetry':False})
    host.child('commit',origins=review['online']['origins'],path=BASE/'owner-commit.jsonl')
    rows=journal_rows(BASE/'owner-commit.jsonl');publication=next(r for r in rows if r['phase']=='publication_complete')
    save(BASE/'selected.json',publication)
    host.child('verify-source',origins=review['online']['origins'])
    native=host.start_native(publication['epoch']);host.m.verify_inputs(host.o,host.binding['privateInputHashes']);need(host.normal()==review['normal'],'normal_source_changed_before_unhalt');host.files_and_roles()
    need(host.native_set()==native,'reviewed_native_actors_changed_before_unhalt')
    host.child('unhalt',epoch=publication['epoch'],path=BASE/'owner-unhalt.jsonl')
    result={'format':FORMAT,'completed':True,'currentActorsAcknowledgementSha256':ACTOR_ACK_SHA,'oldWholeInvocationGatePassed':False,'sourceDigest':SOURCE,'migrationInvocations':0,'originalActorsStopped':8,'nativeActorsStarted':8,'selectedEpoch':publication['epoch'],'nativeActors':native,'privateInputsUnchanged':True,'sourceReplayOrProxyChanged':False,'automaticRetry':False}
    save(BASE/'result.json',result);return result


def validate_phase_leaf(result_sha,manifest_sha,continuation=None):
    """Current Arena-only ownership/ledger leaf, independent of source PID.

    A managed source owner must independently authenticate current source,
    canonical coverage and financial authority. This function never reports the
    old c96 runtime predicate passed after a parent lifecycle transition.
    """
    need(actual_pin(result_sha)and actual_pin(manifest_sha)and(continuation is None or type(continuation)is int and 0<=continuation<8),'explicit_actual_acceptance_reference_required')
    result_file=BASE/('result.json'if continuation is None else'continuation-result-'+str(continuation)+'.json')
    pre=read_module(PACKAGE/'arena-modern-runtime-preflight-v1.py',PREFLIGHT_SHA)
    plan=json.loads(pre.protected(BASE/'plan.json',100000));need(plan['manifestSha256']==manifest_sha,'caller_pinned_Arena_code_manifest_required');h=Host(plan)
    review=h.recovery_binding();result_raw=h.p.protected(result_file,200000);need(sha(result_raw)==result_sha,'actual_owned_Arena_result_required');result=json.loads(result_raw)
    need(result.get('format')==FORMAT and result.get('completed')is True and result.get('sourceDigest')==SOURCE and result.get('migrationInvocations')==0,'acknowledged_modern_Arena_runtime_required')
    artifact=h.artifacts(fresh=False);roles=h.files_and_roles()
    h.m.verify_inputs(h.o,h.binding['privateInputHashes']);h.r.graph(h.m,h.o,h.base,h.binding,owned=False);h.original_quiet()
    adoption,state=h.adopted_state();phase=forward_phase(state,transaction_intents(),adoption)
    need(phase['phase']=='complete'and phase['selection']['sourceId']==SOURCE_ID and result['selectedEpoch']==phase['selection']['epoch'],'actual_owned_4e_selection_epoch_and_unhalt_required')
    native=h.native_set(allow_descendants=True)
    edges={}
    for scope,doc in h.role_catalogs.items():
        rows=[]
        for role in doc['roles']:
            for edge in [*role['directRelationAcl'],*role['directColumnAcl']]:
                if edge['granteeOid']!=role['oid']:continue
                relation=next(r for r in doc['relations']if r['name']==edge['relation'])
                rows.append({'databaseOid':2303669 if scope=='operational'else 17584,'grantee':role['oid'],'grantor':edge['grantorOid'],'kind':'column'if'attribute'in edge else'relation','object':relation['oid'],'object_name':relation['name'],'column_number':edge.get('attributeNumber'),'attribute':edge.get('attribute'),'privilege':edge['privilege'],'grantable':edge['grantOption']})
            for edge in role['directSchemaAcl']:
                if edge['granteeOid']==role['oid']:rows.append({'databaseOid':2303669 if scope=='operational'else 17584,'grantee':role['oid'],'grantor':edge['grantorOid'],'kind':'schema','object':role['schemaPrivileges'][edge['schema']]['oid'],'object_name':edge['schema'],'column_number':None,'attribute':None,'privilege':edge['privilege'],'grantable':edge['grantOption']})
        for edge in doc['databaseAcl']:
            if edge['granteeOid']in{r['oid']for r in doc['roles']}:rows.append({'databaseOid':edge['databaseOid'],'grantee':edge['granteeOid'],'grantor':edge['grantorOid'],'kind':'database','object':edge['databaseOid'],'object_name':'yunipals_arena'if scope=='operational'else'yunipals_backfill','column_number':None,'attribute':None,'privilege':edge['privilege'],'grantable':edge['grantOption']})
        edges[scope]=sorted(rows,key=lambda e:encoded(e))
    return {'format':'yunipals-arena-ypal-phase-leaf-v2','validated':True,'resultFile':str(result_file),'resultSha256':result_sha,'operatorSha256':sha(Path(__file__).read_bytes()),'manifestSha256':plan['manifestSha256'],'acknowledgedCurrentActors':h.actor_context.acknowledged(),'oldWholeInvocationGatePassed':False,'artifact':artifact,'selectedSourceId':SOURCE_ID,'selectedEpoch':phase['selection']['epoch'],'unhaltXid':phase['unhaltXid'],'retainedLedger':phase['retainedLedger'],'nativeActors':native,'roleAuth':roles,'actualCatalogs':h.role_catalogs,'ownedAclDelta':edges,'ownedReadEdges':edges['source'],'admissionResultFile':str(ADMISSION_RESULT),'admissionResultSha256':h.auth['admissionResultSha256'],'authResult':plan['roleAuth'],'proposal':plan['admissionProposal'],'sourceActorQualified':False,'financialAuthorityQualified':False,'currentCanonicalCoverageQualified':False,'originalWholeValidationPassed':False,'databaseWrites':0,'serviceChanges':0,'providerRequests':0,'migrationInvocations':0}


def main():
    global PHASE
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--plan',type=Path,required=True);p.add_argument('--plan-sha256',required=True);mode=p.add_mutually_exclusive_group();mode.add_argument('--apply');mode.add_argument('--reconcile',action='store_true');mode.add_argument('--rollback-review',action='store_true');mode.add_argument('--rollback');mode.add_argument('--continue-review',action='store_true');mode.add_argument('--continue',dest='forward');args=p.parse_args()
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_host_required');os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(900)
    pre=read_module(PACKAGE/'arena-modern-runtime-preflight-v1.py',PREFLIGHT_SHA);raw=pre.protected(args.plan,100000);need(actual_pin(args.plan_sha256)and sha(raw)==args.plan_sha256,'actual_plan_hash_required');plan=json.loads(raw)
    host=Host(plan)
    with host.m.existing_source_lease():
        lock=os.open(host.m.BACKUP_LOCK,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);host.m.verify_backup_lock(lock)
            if args.reconcile:
                PHASE='readonly_reconciliation';host.recovery_binding();host.files_and_roles();rows=host.child('status',intents=transaction_intents());print(json.dumps({'format':FORMAT,'reconciliation':rows,'actions':0},sort_keys=True));return
            if args.rollback_review or args.rollback:
                PHASE='pre_adoption_inverse';review=host.inverse_review();key=sha(encoded(review))
                if args.rollback:result=host.inverse(review,args.rollback);print(json.dumps(result,sort_keys=True))
                else:print(json.dumps({'format':FORMAT,'inverseReviewHash':key,'review':review,'actions':0},sort_keys=True))
                return
            if args.continue_review or args.forward:
                PHASE='explicit_owned_forward_continuation';review=host.continue_review();key=sha(encoded(review))
                if args.forward:print(json.dumps(host.continue_apply(review,args.forward),sort_keys=True))
                else:print(json.dumps({'format':FORMAT,'continuationReviewHash':key,'review':review,'actions':0},sort_keys=True))
                return
            PHASE='online_readonly_review';review=host.review();key=sha(encoded(review))
            if args.apply:
                PHASE='owned_direct_native_cutover'
                with host.m.References():result=apply(host,review,args.apply)
                print(json.dumps(result,sort_keys=True))
            else:print(json.dumps({'format':FORMAT,'reviewHash':key,'review':review,'applied':False,'migrationInvocations':0,'serviceJobs':0},sort_keys=True))
        finally:os.close(lock)
if __name__=='__main__':
    try:main()
    except BaseException as error:
        result={'format':FORMAT,'completed':False,'phase':PHASE,'fixedCode':str(error)if isinstance(error,CutoverFailure)else'direct_native_owner_failed','errorClass':type(error).__name__,'rawMessagesExported':False,'automaticRetry':False,'oldRuntimeAutomaticRestartAllowed':False,'reconciliationRequired':True}
        try:
            if BASE.is_dir()and not(BASE/'failed.json').exists():save(BASE/'failed.json',result)
        except BaseException:pass
        print(json.dumps(result,sort_keys=True));raise SystemExit(1)
