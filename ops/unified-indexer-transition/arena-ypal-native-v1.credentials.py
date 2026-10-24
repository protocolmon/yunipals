#!/usr/bin/env python3
"""Bounded nine-role password/files, then separately LOGIN and read-only TCP proof."""
from __future__ import annotations
import argparse
import base64
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import stat
import subprocess
import types
from urllib.parse import urlparse

FORMAT = 'yunipals-arena-ypal-credentials-v1'
AUTH_FORMAT = 'yunipals-arena-ypal-role-auth-v1'
BASE = Path('/var/backups/yunipals-arena-ypal-credentials-v1-20261023')
ADMISSION = Path('/var/backups/yunipals-arena-ypal-admission-v1-20261024/result.json')
PROPOSAL = Path('/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-native-v1.proposal.json')
PROPOSAL_SHA = 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80'
ADMISSION_HELPER_SHA = '4efe2a556b6b4dab6826341d80caaeac62065fc3991fe5502da9e8e45be81a5e'
PREFLIGHT = Path('/opt/yunipals-unified/operations/arena-modern-package-20261022/arena-modern-runtime-preflight-v1.py')
PREFLIGHT_SHA = '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631'
RELEASE_ID = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
TARGETS = {'operational': (15438, 'yunipals_arena', 2303669), 'source': (5432, 'yunipals_backfill', 17584)}
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC','PYTHONDONTWRITEBYTECODE':'1'}
PLAN_KEYS = {'format','admissionResultFile','admissionResultSha256','admissionHelperFile','admissionHelperSha256'}

class Refusal(RuntimeError): pass

def need(value, code):
    if not value: raise Refusal(code)

def encoded(value): return json.dumps(value, sort_keys=True, separators=(',',':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def digest(value): return isinstance(value,str) and bool(re.fullmatch('[0-9a-f]{64}',value)) and value != '0'*64

def metadata(s): return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def protected(path, maximum=2000000, private=False):
    path=Path(path);need(path.is_absolute() and '..' not in path.parts,'absolute_owned_file_required')
    for parent in reversed(path.parents):
        s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'protected_file_ancestry_required')
    before=path.lstat();need(stat.S_ISREG(before.st_mode) and before.st_uid==before.st_gid==0 and before.st_nlink==1 and before.st_size<=maximum and (stat.S_IMODE(before.st_mode)==0o600 if private else not before.st_mode&0o022),'protected_file_metadata_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        need(metadata(os.fstat(fd))==metadata(before),'owned_file_open_changed');raw=os.read(fd,maximum+1)
        need(len(raw)<=maximum and metadata(before)==metadata(os.fstat(fd))==metadata(path.lstat()),'owned_file_read_changed')
        return raw
    finally: os.close(fd)

def directory(path):
    path=Path(path);need(path.is_absolute() and '..' not in path.parts,'absolute_owned_directory_required')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=nxt
            info=os.fstat(fd);need(info.st_uid==0 and not info.st_mode&0o022,'owned_directory_ancestry_required')
        return fd
    except BaseException:os.close(fd);raise

def save(path, raw):
    path=Path(path);d=directory(path.parent)
    try:
        fd=os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=d)
        try:
            os.fchown(fd,0,0);os.fchmod(fd,0o600)
            with os.fdopen(fd,'wb',closefd=False)as f:f.write(raw);f.flush();os.fsync(fd)
        finally:os.close(fd)
        os.fsync(d)
    finally:os.close(d)

def load(path,pin):
    raw=protected(path);need(sha(raw)==pin,'pinned_helper_changed');m=types.ModuleType('credentials_'+Path(path).stem);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def scram(password, salt):
    # Same small SCRAM primitive as ops/arena/provision_database.py; no import of
    # its provisioning main routine, schema migration or broad application GRANT.
    salted=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,4096)
    stored=hashlib.sha256(hmac.new(salted,b'Client Key','sha256').digest()).digest()
    server=hmac.new(salted,b'Server Key','sha256').digest()
    b64=lambda v:base64.b64encode(v).decode()
    return 'SCRAM-SHA-256$4096:'+b64(salt)+'$'+b64(stored)+':'+b64(server)

def specs(proposal, receipt):
    expected={w['role'] for w in proposal['workers']}
    need(set(receipt.get('roles',{}))==expected and receipt.get('sourceRole',{}).get('name')=='arena_native_reader','exact_nine_acknowledged_roles_required')
    rows=[]
    for w in proposal['workers']:
        rows.append({'role':w['role'],'oid':receipt['roles'][w['role']],'path':w['privateOverlay'],'limit':w['connectionLimit'],'group':'operational'})
    rows.append({'role':'arena_native_reader','oid':receipt['sourceRole']['oid'],'path':proposal['sourceReader']['privateFile'],'limit':32,'group':'source'})
    need(len({r['oid'] for r in rows if r['group']=='operational'})==8 and all(type(r['oid'])is int and r['oid']>0 for r in rows),'actual_role_oids_required')
    need({r['path'] for r in rows}=={r['path'] for r in proposal['filesAbsent']} and len(rows)==9,'exact_nine_private_paths_required')
    return rows

def validate_admission(plan,receipt,helper_raw,proposal):
    need(set(plan)==PLAN_KEYS and plan['format']==FORMAT and plan['admissionResultFile']==str(ADMISSION) and all(digest(plan[k]) for k in ['admissionResultSha256','admissionHelperSha256']),'exact_acknowledged_admission_plan_required')
    need(plan['admissionHelperSha256']==ADMISSION_HELPER_SHA and sha(helper_raw)==plan['admissionHelperSha256'] and receipt.get('format')=='yunipals-arena-ypal-admission-v1' and receipt.get('operatorSha256')==plan['admissionHelperSha256'] and receipt.get('commitOutcome')=='commit_confirmed','acknowledged_nologin_admission_required')
    need(receipt.get('proposalSha256')==PROPOSAL_SHA and receipt.get('sqlSha256')=={'operational':proposal['sql']['operational-roles.current.sql.review'],'source':proposal['sql']['arena-ypal-native-v1.source.sql.review']},'same_reviewed_admission_sql_required')
    need(receipt.get('perDatabase',{}).get('operational',{}).get('roles')==receipt.get('roles') and receipt.get('perDatabase',{}).get('source',{}).get('roles')=={receipt.get('sourceRole',{}).get('name'):receipt.get('sourceRole',{}).get('oid')},'per_database_oid_receipts_must_match')
    need(receipt.get('operationalDatabaseOid')==2303669 and receipt.get('sourceDatabaseOid')==17584 and all(receipt.get('perDatabase',{}).get(k,{}).get('commitOutcome')=='commit_confirmed' for k in TARGETS),'both_real_database_acknowledgements_required')
    return specs(proposal,receipt)

def content(row,password):
    need(bool(re.fullmatch('[A-Za-z0-9_-]{48}',password)),'fresh_random_password_required')
    port,database,_=TARGETS[row['group']]
    url=f"postgresql://{row['role']}:{password}@127.0.0.1:{port}/{database}"
    if row['group']=='source':
        return ('ARENA_INDEXER_MODE=unified\nARENA_INDEXER_SOURCE_KIND=unified\nARENA_INDEXER_RELEASE_ID='+RELEASE_ID+'\nARENA_INDEXER_DATABASE_URL='+url+'?options=-c%20default_transaction_read_only%3Don\n').encode()
    return ('ARENA_DATABASE_URL='+url+'\n').encode()

def parse_private(row,raw):
    values={}
    for line in raw.decode().splitlines():
        key,sep,value=line.partition('=');need(sep and key not in values,'exact_generated_env_required');values[key]=value
    key='ARENA_DATABASE_URL' if row['group']=='operational' else 'ARENA_INDEXER_DATABASE_URL'
    u=urlparse(values.get(key,''));port,database,_=TARGETS[row['group']]
    need(u.scheme=='postgresql' and u.hostname=='127.0.0.1' and u.port==port and u.path=='/'+database and u.username==row['role'] and not u.fragment,'fixed_private_connection_target_required')
    need(content(row,u.password or '')==raw,'only_exact_generated_connection_keys_required')
    return values[key],u.password

def guard_sql(rows,stage,password_hashes):
    parts=[]
    for r in rows:
        expected='rolpassword IS NULL' if stage=='admitted' else "encode(sha256(convert_to(rolpassword,'UTF8')),'hex')='"+password_hashes[r['role']]+"'"
        login='true' if stage=='enabled' else 'false'
        parts.append(f"IF NOT EXISTS(SELECT 1 FROM pg_authid WHERE oid={r['oid']} AND rolname='{r['role']}' AND rolcanlogin={login} AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND rolconnlimit={r['limit']} AND {expected}) OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid={r['oid']}) THEN RAISE EXCEPTION 'owned_role_auth_state_changed'; END IF;")
    return "DO $owned$ BEGIN "+''.join(parts)+" END $owned$;\n"

def mutate_sql(rows,stage,action,password_hashes,verifiers=None):
    need(action in ['password','enable','disable'],'fixed_credential_action_required')
    sql="BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s'; SELECT pg_advisory_xact_lock(hashtext('arena-modern-role-credentials-v1'));\n"+guard_sql(rows,stage,password_hashes)
    for r in rows:
        suffix=("PASSWORD '"+verifiers[r['role']]+"'") if action=='password' else ('LOGIN' if action=='enable' else 'NOLOGIN')
        if action=='password':need(bool(re.fullmatch(r'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+',verifiers[r['role']])),'scram_verifier_required')
        sql+='ALTER ROLE "'+r['role']+'" '+suffix+';\n'
    return sql+'COMMIT;\n'

class Operator:
    def __init__(self,host,plan,proposal,receipt,rows,base=BASE):self.host,self.plan,self.proposal,self.receipt,self.rows,self.base=host,plan,proposal,receipt,rows,Path(base)
    def read_result(self,name):return json.loads(protected(self.base/name,private=True))
    def review(self,phase):
        need(phase in ['setup','enable','auth','disable'],'fixed_phase_required')
        setup=None
        if phase=='setup':
            need(not os.path.lexists(self.base) and all(not os.path.lexists(r['path']) for r in self.rows),'fresh_setup_only_unknown_partial_state_refused')
            stage='admitted';hashes={}
        else:
            setup=self.read_result('setup-result.json');need(setup['format']==FORMAT and setup['planSha256']==sha(encoded(self.plan)) and setup['operatorSha256']==self.host.operator_hash(),'owned_setup_receipt_required')
            hashes=setup['passwordVerifierSha256'];stage='enabled' if phase in ['auth','disable'] else 'configured'
            self.files(setup)
            if stage=='enabled':
                enabled=self.read_result('login-result.json');need(enabled['setupResultSha256']==sha(encoded(setup)) and enabled['loginEnabled'] is True,'acknowledged_login_phase_required')
            else:need(not (self.base/'login-intent.json').exists(),'unknown_or_prior_login_attempt_refused')
        preserved=self.host.preserved();catalog=self.host.catalog(self.rows,stage,hashes)
        return {'format':FORMAT,'phase':phase,'operatorSha256':self.host.operator_hash(),'planSha256':sha(encoded(self.plan)),'admissionResultSha256':self.plan['admissionResultSha256'],'preserved':preserved,'catalog':catalog,'setupResultSha256':sha(encoded(setup)) if setup else None}
    def files(self,setup):
        need(set(setup['credentialFiles'])=={r['path'] for r in self.rows},'exact_nine_credential_hashes_required')
        for r in self.rows:
            raw=protected(r['path'],10000,True);need(sha(raw)==setup['credentialFiles'][r['path']],'owned_credential_file_changed');parse_private(r,raw)
            need(list(metadata(Path(r['path']).lstat()))==setup['credentialIdentities'][r['path']],'owned_credential_inode_changed')
    def checked_review(self,phase,expected):
        value=self.review(phase);need(digest(expected) and sha(encoded(value))==expected,'fresh_exact_credential_review_required');return value
    def setup(self,review_hash):
        review=self.checked_review('setup',review_hash);self.base.mkdir(mode=0o700)
        material={r['role']:{'password':secrets.token_urlsafe(36),'salt':secrets.token_bytes(16)} for r in self.rows}
        need(len({v['password'] for v in material.values()})==9,'distinct_passwords_required')
        verifiers={role:scram(v['password'],v['salt']) for role,v in material.items()};hashes={k:sha(v.encode()) for k,v in verifiers.items()}
        expected={r['path']:sha(content(r,material[r['role']]['password'])) for r in self.rows}
        save(self.base/'setup-intent.json',encoded({'reviewHash':review_hash,'review':review,'credentialFiles':expected,'passwordVerifierSha256':hashes,'automaticRetryAllowed':False}))
        for r in self.rows:save(Path(r['path']),content(r,material[r['role']]['password']))
        identities={r['path']:list(metadata(Path(r['path']).lstat())) for r in self.rows}
        for group in TARGETS:
            selected=[r for r in self.rows if r['group']==group]
            self.host.mutate(group,mutate_sql(selected,'admitted','password',{},verifiers))
            save(self.base/('password-'+group+'-ack.json'),encoded({'commitOutcome':'commit_confirmed','roles':{r['role']:r['oid'] for r in selected}}))
        need(self.host.preserved()==review['preserved'],'retained_original_inputs_changed')
        self.host.catalog(self.rows,'configured',hashes)
        result={'format':FORMAT,'operatorSha256':self.host.operator_hash(),'planSha256':sha(encoded(self.plan)),'admissionResultSha256':self.plan['admissionResultSha256'],'roles':self.receipt['roles'],'sourceRole':self.receipt['sourceRole'],'credentialFiles':expected,'credentialIdentities':identities,'passwordVerifierSha256':hashes,'loginEnabled':False,'credentialsConfigured':True,'privateFileWrites':9,'serviceJobs':0}
        self.files(result);save(self.base/'setup-result.json',encoded(result));return result
    def enable(self,review_hash):
        review=self.checked_review('enable',review_hash);setup=self.read_result('setup-result.json')
        save(self.base/'login-intent.json',encoded({'reviewHash':review_hash,'review':review,'automaticRetryAllowed':False}))
        for group in TARGETS:
            selected=[r for r in self.rows if r['group']==group];self.host.mutate(group,mutate_sql(selected,'configured','enable',setup['passwordVerifierSha256']))
            save(self.base/('login-'+group+'-ack.json'),encoded({'commitOutcome':'commit_confirmed','roles':{r['role']:r['oid'] for r in selected}}))
        self.host.catalog(self.rows,'enabled',setup['passwordVerifierSha256']);need(self.host.preserved()==review['preserved'],'retained_original_inputs_changed');self.files(setup)
        value={'format':FORMAT,'setupResultSha256':sha(encoded(setup)),'loginEnabled':True,'serviceJobs':0};save(self.base/'login-result.json',encoded(value));return value
    def prove(self,review_hash):
        review=self.checked_review('auth',review_hash);need(not (self.base/'auth-result.json').exists(),'auth_receipt_already_exists')
        setup=self.read_result('setup-result.json');results=[]
        for r in self.rows:
            url,password=parse_private(r,protected(r['path'],10000,True));results.append(self.host.auth(r,url,password))
        need(self.host.preserved()==review['preserved'],'retained_original_inputs_changed');self.host.catalog(self.rows,'enabled',setup['passwordVerifierSha256']);self.files(setup)
        result={'format':AUTH_FORMAT,'operatorSha256':self.host.operator_hash(),'admissionResultSha256':self.plan['admissionResultSha256'],'admissionHelperSha256':self.plan['admissionHelperSha256'],'setupResultSha256':sha(encoded(setup)),'originalActorsReceiptSha256':self.proposal['observations']['yunipals-arena-retained-actors-readonly-20261022.json'],'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'roles':self.receipt['roles'],'sourceRole':self.receipt['sourceRole'],'credentialFiles':setup['credentialFiles'],'releaseId':RELEASE_ID,'grantsVerified':True,'tcpAuthenticationProven':True,'loginEnabled':True,'authentication':results,'serviceJobs':0,'schemaWrites':0,'sourceSelectionsChanged':0,'legacyRolesChanged':False,'providerCalls':0}
        save(self.base/'auth-result.json',encoded(result));return result
    def disable(self,review_hash):
        review=self.checked_review('disable',review_hash);need(not (self.base/'disable-intent.json').exists(),'prior_disable_attempt_requires_reconciliation');setup=self.read_result('setup-result.json')
        save(self.base/'disable-intent.json',encoded({'reviewHash':review_hash,'review':review,'automaticRetryAllowed':False}))
        for group in TARGETS:
            selected=[r for r in self.rows if r['group']==group];self.host.mutate(group,mutate_sql(selected,'enabled','disable',setup['passwordVerifierSha256']))
            save(self.base/('disable-'+group+'-ack.json'),encoded({'commitOutcome':'commit_confirmed'}))
        self.host.catalog(self.rows,'configured',setup['passwordVerifierSha256']);need(self.host.preserved()==review['preserved'],'retained_original_inputs_changed')
        value={'format':FORMAT,'loginEnabled':False,'credentialsRemoved':False,'passwordsRotated':False,'serviceJobs':0};save(self.base/'disable-result.json',encoded(value));return value

def tcp_probe(row,password,sql,*,expected_failure=False):
    """No password in argv/environment/on-disk pgpass: bounded anonymous0600 fd."""
    port,database,_=TARGETS[row['group']]
    fd=os.memfd_create('arena-role-auth',os.MFD_CLOEXEC)
    try:
        os.fchmod(fd,0o600);os.write(fd,f"127.0.0.1:{port}:{database}:{row['role']}:{password}\n".encode());os.lseek(fd,0,0)
        env={**ENV,'PGPASSFILE':'/proc/self/fd/'+str(fd),'PGCONNECT_TIMEOUT':'3','PGAPPNAME':'arena_modern_role_auth','PGOPTIONS':'-c statement_timeout=3000 -c lock_timeout=1000 -c default_transaction_read_only=on'}
        argv=['/usr/bin/psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-p',str(port),'-d',database,'-U',row['role']]
        result=subprocess.run(argv,input=sql.encode(),env=env,pass_fds=(fd,),capture_output=True,timeout=8)
        if expected_failure:
            need(result.returncode!=0 and not result.stdout,'negative_tcp_or_role_probe_unexpectedly_succeeded');
            if isinstance(expected_failure,str):need(expected_failure.encode() in result.stderr,'expected_permission_denial_sqlstate_required')
            return None
        need(result.returncode==0 and not result.stderr and len(result.stdout)<=10000,'bounded_readonly_tcp_probe_failed');return result.stdout
    finally:os.close(fd)

class Host:
    def __init__(self,plan,proposal,admission_helper,receipt):self.plan,self.proposal,self.admission_helper,self.receipt=plan,proposal,admission_helper,receipt
    def operator_hash(self):return sha(protected(Path(__file__).absolute()))
    def preserved(self):
        p=load(PREFLIGHT,PREFLIGHT_SHA);restore=load(p.RESTORE,p.RESTORE_SHA);owner=restore.load_owner();observer=owner.observer()
        binding,base,restored,proof=p.retained(restore,owner,observer)
        actors={r['unit']:p.actor(restore,owner,r,restored) for r in base['services']}
        need({u:{'invocation':v['invocation'],'process':v['process']} for u,v in actors.items()}==self.proposal['current']['actors'],'original_actor_receipt_changed')
        for w in self.proposal['workers']:
            observed=subprocess.run(['/usr/bin/systemctl','show',w['unit'],'--all','--property=LoadState,ActiveState,MainPID,Job'],env=ENV,capture_output=True,timeout=5,check=True)
            values=dict(line.split('=',1) for line in observed.stdout.decode().splitlines())
            need(set(values)=={'LoadState','ActiveState','MainPID','Job'} and values['MainPID']=='0' and not values['Job'] and values['ActiveState'] in ['inactive','failed'],'native_workers_must_still_be_dormant')
        return {'originalActorsSha256':sha(encoded(actors)),'retainedSha256':sha(encoded(proof)),'privateInputsUnchanged':True,'nativeUnitsDormant':8}
    def catalog(self,rows,stage,hashes):
        phase={'admitted':'admitted','configured':'passwords','enabled':'login'}[stage]
        proof=self.admission_helper.verify_current(self.receipt,phase=phase,password_sha256=None if stage=='admitted' else hashes)
        need(proof.get('validated') is True and proof.get('roleCount')==9 and proof.get('databaseWrites')==0,'finite_admission_catalog_recheck_required')
        h=self.admission_helper.runner()
        for group in TARGETS:
            selected=[r for r in rows if r['group']==group];oids=','.join(str(r['oid']) for r in selected)
            sql="BEGIN READ ONLY; SELECT jsonb_build_object('sessions',(SELECT count(*) FROM pg_stat_activity WHERE usesysid IN("+oids+")),'free',current_setting('max_connections')::int-current_setting('superuser_reserved_connections')::int-(SELECT count(*) FROM pg_stat_activity)); ROLLBACK;"
            port,database,_=TARGETS[group];slots=json.loads(h.run(h.peer_args(port,database),sql.encode()))
            need(slots['sessions']==0 and slots['free']>=(61 if group=='operational' else 32),'dormant_roles_and_runtime_pool_headroom_required')
        return {'grantProof':proof,'ownedSessions':0,'operationalPoolSlots':60,'sourcePoolSlots':31,'headroomSufficient':True}
    def mutate(self,group,sql):
        # The existing admission peer primitive drops UID/groups/capabilities.
        port,database,_=TARGETS[group]
        argv=self.admission_helper.runner().peer_args(port,database,write=True)
        result=subprocess.run(argv,input=sql.encode(),env=ENV,capture_output=True,timeout=20)
        need(result.returncode==0 and not result.stderr and not result.stdout.strip(),'credential_transaction_ack_uncertain_no_retry')
    def auth(self,row,url,password):
        # A wrong password must fail, ruling out trust/peer/passwordless acceptance.
        tcp_probe(row,secrets.token_urlsafe(36),'SELECT 1;',expected_failure=True)
        owner_oid=2303667 if row['group']=='operational' else 73004621
        tcp_probe(row,password,"BEGIN READ ONLY; SELECT set_config('role',pg_get_userbyid("+str(owner_oid)+"),true); ROLLBACK;",expected_failure='42501')
        reads=['yunipals_arena.operational_migration'] if row['group']=='operational' else [r['name'] for r in self.proposal['sourceReader']['tables']]
        need(all(re.fullmatch(r'[a-z0-9_]+\.[a-z0-9_]+',r) for r in reads),'fixed_auth_read_relations_required')
        sql='BEGIN READ ONLY;\n'+''.join('SELECT 1 FROM '+r+' LIMIT 0;\n' for r in reads)+"SELECT jsonb_build_object('sessionUser',session_user,'currentUser',current_user,'oid',(SELECT oid::int FROM pg_roles WHERE rolname=current_user),'databaseOid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),'readOnly',current_setting('transaction_read_only')='on','memberships',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)),'elevated',(SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user)); ROLLBACK;"
        proof=json.loads(tcp_probe(row,password,sql));need(proof=={'sessionUser':row['role'],'currentUser':row['role'],'oid':row['oid'],'databaseOid':TARGETS[row['group']][2],'readOnly':True,'memberships':0,'elevated':False},'actual_dedicated_role_auth_identity_required')
        return {**proof,'badPasswordRejected':True,'ownerRoleRejected':True,'readRelations':len(reads),'connectionsConcurrent':1}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',type=Path,required=True);parser.add_argument('--plan-sha256',required=True)
    parser.add_argument('--phase',choices=['setup','enable','auth','disable'],default='setup');parser.add_argument('--apply',help='Exact fresh phase review hash; default is read-only review.')
    args=parser.parse_args();need(os.geteuid()==0 and socket.gethostname()=='yunipals-main','fixed_root_host_required');os.umask(0o077)
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError()));signal.alarm(180)
    raw=protected(args.plan);need(digest(args.plan_sha256) and sha(raw)==args.plan_sha256,'exact_protected_plan_required');plan=json.loads(raw)
    need(isinstance(plan,dict) and set(plan)==PLAN_KEYS and plan['format']==FORMAT and plan['admissionResultFile']==str(ADMISSION) and plan['admissionHelperFile']==str(PROPOSAL.parent/'arena-ypal-native-v1.admission.py') and all(digest(plan[k]) for k in ['admissionResultSha256','admissionHelperSha256']),'fixed_public_admission_plan_required')
    proposal_raw=protected(PROPOSAL);need(sha(proposal_raw)==PROPOSAL_SHA,'fixed_current_proposal_required');proposal=json.loads(proposal_raw)
    receipt_raw=protected(plan['admissionResultFile']);need(sha(receipt_raw)==plan['admissionResultSha256'],'actual_admission_receipt_hash_required');receipt=json.loads(receipt_raw)
    helper_raw=protected(plan['admissionHelperFile']);rows=validate_admission(plan,receipt,helper_raw,proposal)
    helper=load(plan['admissionHelperFile'],plan['admissionHelperSha256']);host=Host(plan,proposal,helper,receipt)
    need(callable(getattr(helper,'verify_current',None)) and callable(getattr(helper,'runner',None)),'pinned_admission_catalog_interface_required')
    lock=os.open('/run/lock/yunipals-arena-ypal-credentials-v1.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(lock);need(stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,'owned_credential_lock_required');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        op=Operator(host,plan,proposal,receipt,rows)
        if args.apply:value=getattr(op,{'setup':'setup','enable':'enable','auth':'prove','disable':'disable'}[args.phase])(args.apply)
        else:
            review=op.review(args.phase);value={**review,'reviewHash':sha(encoded(review)),'applied':False,'roleChanges':0,'privateFileWrites':0,'tcpConnections':0}
        print(json.dumps(value,sort_keys=True))
    finally:os.close(lock)

if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'status':'refused','fixedCode':str(error) if isinstance(error,Refusal) else 'fixed_credential_operation_failed','errorClass':type(error).__name__,'rawMessagesExported':False,'automaticRetryAllowed':False},sort_keys=True));raise SystemExit(1)
