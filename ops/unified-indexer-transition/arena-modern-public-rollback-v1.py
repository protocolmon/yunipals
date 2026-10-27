#!/usr/bin/env python3
"""Prepared modern Arena public-source recovery. Default is read-only review.

No target creation, grants, credential generation, schema migration, original
runtime start or private backup restore is implemented. Real future receipts are
required; absent admission/cutover evidence is a refusal, not an assumed success.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time
import types

FORMAT='yunipals-arena-modern-public-rollback-v1'
CUTOVER_OWNER_SHA='983f8baa24a2b82b0dce4e4716c64f9e4f68876db1d809f3a393177b390e81a6'
CUTOVER_CHILD_SHA='a5efd3ed83c3f2168055b84db4d09973ccb6ccc1d194b70ac39fa26110fd98a9'
SOURCE='264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24'
ROOT=Path('/opt/yunipals-unified/releases')/SOURCE
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
AREA=Path('/var/backups/yunipals-arena-modern-public-rollback-v1-20261023')
CUTOVER=Path('/var/backups/yunipals-arena-direct-native-cutover-v1-20261023')
TARGET=Path('/var/backups/yunipals-arena-public-rollback-target-v1-20261023')
TARGET_AUTH=Path('/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023/auth-result.json')
CHILD=OPS/'arena-modern-public-rollback-v1.mjs'
NODE=Path('/opt/node-v24.18.1/bin/node')
UNIT='yunipals-arena-public-rollback-v1.service'
PROFILE_ID='0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728'
NATIVE_RELEASE='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
READER=Path('/etc/yunipals-arena/public-rollback-reader.env')
WRITER=Path('/etc/yunipals-arena/public-rollback-writer.env')
SCANNER_PUBLIC=Path('/opt/yunipals-unified/recovery/arena-public-rollback-v1')
SCANNER_CHILD=SCANNER_PUBLIC/'arena-modern-public-rollback-v1.mjs'
SCANNER_CONFIG=SCANNER_PUBLIC/'scanner.json'
SCANNER_BASE=AREA/'scanner'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8','TZ':'UTC','TSX_DISABLE_CACHE':'1','PYTHONDONTWRITEBYTECODE':'1'}

class Refusal(RuntimeError):pass

def need(value,code):
    if not value:raise Refusal(code)
def encode(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def pin(value):return isinstance(value,str)and bool(re.fullmatch('[0-9a-f]{64}',value))and value!='0'*64

def protected(path,maximum=2000000,private=False):
    path=Path(path);need(path.is_absolute(),'absolute_protected_path_required')
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_root_path_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and 0<s.st_size<=maximum and(not private or stat.S_IMODE(s.st_mode)==0o600),'bounded_owned_regular_file_required');raw=f.read(maximum+1);need(len(raw)==s.st_size,'stable_protected_file_required');return raw

def reference(ref):
    need(set(ref)=={'file','sha256'}and pin(ref['sha256']),'actual_receipt_reference_required')
    raw=protected(ref['file']);need(sha(raw)==ref['sha256'],'actual_receipt_hash_changed');return json.loads(raw)
def module(ref):
    raw=protected(ref['file']);need(sha(raw)==ref['sha256'],'actual_helper_hash_changed');m=types.ModuleType(Path(ref['file']).stem.replace('-','_'));m.__file__=ref['file'];exec(compile(raw,ref['file'],'exec'),m.__dict__);return m

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def save(path,value,mode=0o600):
    raw=value if isinstance(value,bytes)else encode(value)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode);os.fchmod(fd,mode)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    sync(path.parent)

def install_owned_file(target,before_sha,body,receipt,intent,prepared,metadata):
    wanted={'unitSha256':sha(body),**metadata}
    def matching(path,row):
        s=path.lstat();return sha(protected(path,100000))==wanted['unitSha256']and[s.st_dev,s.st_ino]==row['identity']and stat.S_IMODE(s.st_mode)==0o644
    if receipt.exists():
        owned=json.loads(protected(receipt));need(set(owned)==set(wanted)|{'identity'}and all(owned[k]==v for k,v in wanted.items())and matching(target,owned),'owned_recovery_definition_changed');return owned
    if intent.exists():
        owned=json.loads(protected(intent));need(set(owned)==set(wanted)|{'identity'}and all(owned[k]==v for k,v in wanted.items()),'owned_source_intent_changed')
        if not matching(target,owned):
            need(sha(protected(target,100000))==before_sha and prepared.exists()and matching(prepared,owned),'unknown_partial_source_file_state')
            os.replace(prepared,target);sync(target.parent)
    else:
        need(sha(protected(target,100000))==before_sha,'native_definition_changed_before_source_install')
        save(prepared,body,0o644);s=prepared.lstat();owned={**wanted,'identity':[s.st_dev,s.st_ino]};save(intent,owned)
        os.replace(prepared,target);sync(target.parent)
    need(matching(target,owned),'published_source_file_identity_changed');save(receipt,owned);return owned


def validate_plan(p):
    need(set(p)=={'format','operationId','cutoverOwner','cutoverResult','predecessor','targetAdmission','targetAuth','targetHelper','floor','targetKind','childSha256'},'exact_recovery_plan_required')
    need(p['format']==FORMAT and re.fullmatch('[0-9a-f]{16}',p['operationId']),'fresh_owned_operation_id_required')
    for k in ['cutoverOwner','cutoverResult','predecessor','targetAdmission','targetAuth','targetHelper']:
        r=p[k];need(set(r)=={'file','sha256'}and Path(r['file']).is_absolute()and pin(r['sha256']),'actual_protected_prerequisite_required')
    need(p['cutoverOwner']['file']==str(OPS/'arena-direct-native-cutover-v1.py')and Path(p['cutoverResult']['file']).parent==CUTOVER and re.fullmatch(r'(result|continuation-result-(0|[1-9][0-9]*))\.json',Path(p['cutoverResult']['file']).name),'actual_initial_native_cutover_required')
    need(p['targetAdmission']['file']==str(TARGET/'result.json')and p['targetAuth']['file']==str(TARGET_AUTH),'separate_actual_target_admission_and_auth_required')
    need(p['cutoverOwner']['sha256']==CUTOVER_OWNER_SHA,'accepted_modern_cutover_producer_required')
    need(p['targetKind']in{'legacy_rollback','unified'}and pin(p['childSha256']),'fixed_source_direction_and_child_required')
    need(set(p['floor'])=={'block','hash'}and re.fullmatch('[1-9][0-9]*',p['floor']['block'])and re.fullmatch('0x[0-9a-f]{64}',p['floor']['hash']),'actual_recorded_canonical_floor_required')

def selector(row):
    return {'epoch':row['epoch'],'kind':row['kind'],'source_id':row['sourceId'],'accepted_block':str(row['block']),'accepted_hash':row['hash'],'review_hash':row['reviewHash']}

def acknowledge(state,intents,previous):
    """Never infer a committed transaction solely from an after-state graph."""
    actual={(r['phase'],r['xid']):r['status']for r in state['transactions']}
    need(len(actual)==len(intents)and all(actual.get((i['phase'],i['xid']))in{'committed','aborted'}for i in intents),'owned_sql_boundary_must_be_terminal')
    committed=[r for r in intents if r['phase']=='selection_commit_intent'and actual[(r['phase'],r['xid'])]=='committed']
    need(len(committed)<=1,'one_owned_source_publication_required')
    if committed:
        need(state['selection']==selector(committed[0]['selectedRow']),'committed_selector_differs_from_owned_xid');return 'published'
    need(state['selection']==previous,'unowned_source_selection_blocks_recovery');return 'halted'if state['mode']['halted']else'original'

def scanner_definition():
    # Continuous before selection, bounded by one pool/serial official500-block
    # ranges and unchanged free-only proxy profile. No finite runtime surprise.
    return f'''[Unit]\nDescription=Temporary isolated public Arena recovery projection\nAfter=network-online.target\nStartLimitIntervalSec=300\nStartLimitBurst=3\n[Service]\nType=simple\nDynamicUser=yes\nUser=yunipals-arena-public-recovery\nWorkingDirectory={ROOT}/apps/yunipals-market-api\nExecStart={NODE} {SCANNER_CHILD} --scanner {SCANNER_CONFIG}\nLoadCredential=public-db.env:{WRITER}\nEnvironment=NODE_OPTIONS=--max-old-space-size=256\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nPrivateDevices=yes\nRestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX AF_INET\nIPAddressDeny=any\nIPAddressAllow=localhost\nUMask=0077\nMemoryMax=512M\nTasksMax=32\nRuntimeMaxSec=infinity\nRestart=on-failure\nRestartSec=10s\nTimeoutStopSec=30s\n[Install]\nWantedBy=multi-user.target\n'''.encode()

def boot_identity(path,unit):
    s=path.lstat();need(stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and os.readlink(path)==str(Path('/etc/systemd/system')/unit),'exact_owned_native_boot_link_required')
    return {'path':str(path),'target':os.readlink(path),'dev':s.st_dev,'ino':s.st_ino}

def write_source_overlay(url,kind,source_id):
    need(kind in{'legacy_rollback','unified'}and re.fullmatch('0x[0-9a-f]{64}',source_id)and not any(x in url for x in '\r\n\"\'`'),'literal_owned_source_overlay_required')
    return ('ARENA_INDEXER_MODE=unified\nARENA_INDEXER_SOURCE_KIND='+kind+'\nARENA_INDEXER_RELEASE_ID='+source_id+'\nARENA_INDEXER_DATABASE_URL='+url+'\n').encode()

class Host:
    def __init__(self,plan):
        validate_plan(plan);self.plan=plan;self.base=AREA/plan['operationId']
        self.owner=module(plan['cutoverOwner']);need(self.owner.CHILD_SHA==CUTOVER_CHILD_SHA,'accepted_modern_cutover_child_required');self.original_plan=json.loads(protected(CUTOVER/'plan.json'));self.h=self.owner.Host(self.original_plan)
        operation=json.loads(protected(CUTOVER/'operation.json'));result=reference(plan['cutoverResult'])
        need(operation['operatorSha256']==plan['cutoverOwner']['sha256']and result.get('format')=='yunipals-arena-direct-native-cutover-v1'and result.get('completed')is True and result.get('sourceDigest')==SOURCE,'actual_completed_modern_native_owner_required')
        self.previous=reference(plan['predecessor']);need(self.previous.get('completed')is True and self.previous.get('sourceDigest')==SOURCE,'actual_completed_predecessor_required')
        need(sha(protected(CHILD,100000))==plan['childSha256'],'exact_recovery_child_required')
        self.provision=reference(plan['targetAdmission']);self.auth=reference(plan['targetAuth']);self.target_helper=module(plan['targetHelper'])
        need(self.provision.get('format')=='yunipals-arena-public-rollback-target-v1'and self.provision.get('commitOutcome')=='commit_confirmed'and self.provision.get('operatorSha256')==plan['targetHelper']['sha256']and self.auth.get('targetResultSha256')==plan['targetAdmission']['sha256'],'actual_separate_target_commit_and_auth_required')
        need(self.provision['database']['name']=='yunipals_arena_public_rollback'and self.provision['database']['port']==5432 and set(self.provision['tables'])=={'chain_event','credit','deployment','tournament'},'exact_prepared_public_target_required')
        need(self.auth.get('loginEnabled')is True and self.auth.get('tcpAuthenticationProven')is True,'actual_target_login_and_tcp_proof_required')
        self.catalog={**{k:self.provision[k]for k in ['tables','readerRole','writerRole']},'databaseOid':self.provision['database']['oid']}
        self.expected=self.previous_selection()
        if self.previous.get('format')==FORMAT:
            self.expected_ledger=self.previous['retainedLedger'];self.expected_identities=self.previous['identities']
        else:
            adoptions=[row for row in self.owner.transaction_intents()if row['phase']=='adoption_commit_intent']
            need(len(adoptions)==1 and isinstance(adoptions[0].get('retainedLedger'),dict),'actual_post_adoption_retained_ledger_required')
            self.expected_ledger=adoptions[0]['retainedLedger'];self.expected_identities=None
        need(self.expected['kind']!=plan['targetKind'],'source_switch_must_change_direction')
    def run(self,args,**kw):return self.h.m.run(args,**kw)
    def previous_selection(self):
        if self.previous.get('format')==FORMAT:return self.previous['selection']
        need(self.plan['predecessor']==self.plan['cutoverResult'],'initial_predecessor_must_be_exact_cutover_result')
        intents=self.owner.transaction_intents();rows=[r for r in intents if r['phase']=='selection_commit_intent'and r['selectedRow']['epoch']==self.previous['selectedEpoch']]
        need(len(rows)==1,'actual_owned_native_publication_intent_required');return selector(rows[0]['selectedRow'])
    def target_credentials(self):
        files=self.auth['credentialFiles'];need(set(files)=={str(READER),str(WRITER)},'exact_separate_two_target_credentials_required')
        values={}
        for path,pinvalue in files.items():
            raw=protected(path,10000,True);need(sha(raw)==pinvalue,'owned_target_credential_bytes_changed')
            rows=raw.decode().strip().splitlines();key='ARENA_PUBLIC_ROLLBACK_DATABASE_URL='
            need(len(rows)==1 and rows[0].startswith(key),'exact_one_key_target_credential_required');values[path]=rows[0][len(key):]
        self.public_url=values[str(READER)];self.writer_url=values[str(WRITER)]
    def target_verify(self):
        self.target_credentials()
        result=self.target_helper.validate_target(self.provision,auth_phase='login')
        need(result.get('validated')is True and result.get('databaseWrites')==0,'actual_current_public_target_catalog_required')
        return {'admissionSha256':self.plan['targetAdmission']['sha256'],'authSha256':self.plan['targetAuth']['sha256'],'currentVerified':True,'catalog':self.catalog}
    def financial(self):
        n=self.h.p.load(OPS/'source6-normal-replay-successor-v2.py',self.owner.NORMAL_SHA,'rollback_financial_only');r,b,s=n.modules()
        value=n.financial(s);proxies=s.proxies();saved=json.loads(s.protected(n.BASE/'runtime.json'))
        need(value==saved['financial']and proxies==saved['proxies']and value.get('paidAuthority')is False,'unchanged_existing_free_only_proxy_financial_authority_required')
        return {'financial':value,'proxies':proxies,'profileId':PROFILE_ID,'sourceRuntimeRequired':False,'newPaidAllowance':False}
    def native(self):
        self.h.files_and_roles();self.h.artifacts(fresh=False)
        wanted=self.previous.get('nativeActors',{})
        need(set(wanted)==set(self.h.native),'actual_eight_predecessor_native_definitions_required')
        for unit in self.h.native:
            path=Path('/etc/systemd/system')/unit;raw=protected(path,100000)
            need(sha(raw)==wanted[unit]['unitSha256'],'owned_predecessor_native_definition_changed')
            self.h.native[unit]={'body':raw,'sha256':sha(raw)}
        return self.h.native_set(allow_descendants=True)
    def links(self):
        rows={}
        for unit in self.h.native:
            path=Path('/etc/systemd/system/multi-user.target.wants')/unit
            rows[unit]=boot_identity(path,unit)
            need(self.owner.activation_paths(unit)==[str(path)],'other_native_activation_path_refused')
            need(self.run(['/usr/bin/systemctl','show','--all',unit,'--property=TriggeredBy'],maximum=1000)==b'TriggeredBy=\n','native_trigger_activation_refused')
        return rows
    def payload(self,**extra):
        url=self.public_url if self.plan['targetKind']=='legacy_rollback'else self.h.source_url
        return {'targetUrl':url,'targetKind':self.plan['targetKind'],'nativeReleaseId':NATIVE_RELEASE,'cutoverChildSha256':self.owner.CHILD_SHA,'nativeSourceRole':self.h.auth['sourceRole'],'provision':self.catalog,'floor':self.plan['floor'],'expectedSelection':self.expected,'retainedLedger':self.expected_ledger,'expectedIdentities':self.expected_identities,'rpc':{'url':'http://127.0.0.1:19202/unified','profileId':PROFILE_ID},**extra}
    def child(self,action,*,journal=None,**extra):
        # Peer postgres may maintain selectors; no provider/signing configuration
        # is ever passed. The underlying socket/DSN is prepared by frozen owner.
        need(action in{'inspect','halt','unhalt','switch','reconcile'},'fixed_recovery_action_required')
        # The direct child already binds the existing fixed operational endpoint.
        payload=self.payload(**extra)
        raw=encode(payload);authority={'format':'yunipals-arena-modern-public-rollback-authority-v1','action':action,'payloadSha256':sha(raw),'childSha256':self.plan['childSha256']}
        fds=[self.owner.sealed('arena-public-root-authority',encode(authority)),self.owner.sealed('arena-public-child',protected(CHILD,100000)),self.owner.sealed('arena-public-cutover-child',protected(self.owner.CHILD,200000))]
        bootstrap="import{readFileSync}from'node:fs';const m=await import('data:text/javascript;base64,'+readFileSync(Number(process.argv[3])).toString('base64'));await m.main(process.argv[1],Number(process.argv[2]),Number(process.argv[3]),Number(process.argv[4])).catch(()=>{process.stdout.write(JSON.stringify({format:'yunipals-arena-modern-public-rollback-child-v1',phase:'refused'})+'\\n');process.exitCode=1})"
        import pwd
        user=pwd.getpwnam('postgres');args=['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs',str(NODE),'--input-type=module','--eval',bootstrap,action,*map(str,fds)]
        output=subprocess.PIPE if journal is None else os.fdopen(os.open(journal,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600),'ab')
        try:
            p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=output,stderr=subprocess.PIPE,env=ENV,pass_fds=tuple(fds),start_new_session=True)
            try:stdout,stderr=p.communicate(raw,timeout=240)
            except BaseException:os.killpg(p.pid,signal.SIGKILL);p.communicate();raise
            if journal is not None:output.flush();os.fsync(output.fileno());stdout=protected(journal)
            rows=[json.loads(x)for x in stdout.splitlines()];need(p.returncode==0 and not stderr and rows and rows[-1].get('phase')=='result','bounded_recovery_child_refused')
            return rows[-1]['result']
        finally:
            if journal is not None:output.close()
            for fd in fds:os.close(fd)
    def scanner_identity(self):
        need(sha(protected(Path('/etc/systemd/system')/UNIT,10000))==sha(scanner_definition()),'exact_continuous_public_scanner_definition_required')
        rows=self.run(['/usr/bin/systemctl','show','--all',UNIT,*['--property='+x for x in ['MainPID','InvocationID','ActiveState','SubState','Job','RuntimeMaxUSec','Restart','NRestarts','FragmentPath','DropInPaths','ControlGroup','ExecStart','WorkingDirectory']]],maximum=10000).decode()
        p=dict(x.split('=',1)for x in rows.splitlines());need(p['FragmentPath']==str(Path('/etc/systemd/system')/UNIT)and p['WorkingDirectory']==str(ROOT/'apps/yunipals-market-api')and p['ControlGroup']=='/system.slice/'+UNIT,'exact_loaded_scanner_namespace_required');need(p['ActiveState']=='active'and p['SubState']=='running'and p['Job']==''and p['RuntimeMaxUSec']=='infinity'and p['Restart']=='on-failure'and p['DropInPaths']==''and int(p['MainPID'])>1,'acknowledged_continuous_public_scanner_required')
        receipt=json.loads(protected(SCANNER_BASE/'result.json'));need(receipt['unitSha256']==sha(scanner_definition())and receipt['targetAdmissionSha256']==self.plan['targetAdmission']['sha256']and receipt['childSha256']==self.plan['childSha256'],'same_owned_scanner_and_target_required')
        link=Path('/etc/systemd/system/multi-user.target.wants')/UNIT;need(boot_identity(link,UNIT)==receipt['bootLink']and self.owner.activation_paths(UNIT)==[str(link)],'owned_continuous_scanner_boot_path_required')
        need(sha(protected(SCANNER_CONFIG,100000))==receipt['configSha256']and sha(protected(SCANNER_CHILD,100000))==self.plan['childSha256'],'owned_scanner_public_configuration_or_program_changed')
        # An ordinary on-failure restart is allowed only under this exact owned
        # definition/cgroup; stop still binds a freshly captured invocation.
        identity=scanner_actor(p)
        return {**identity,'restarts':int(p['NRestarts']),'unitSha256':receipt['unitSha256'],'bootLink':receipt['bootLink']}
    def review(self):
        need(not os.path.lexists(self.base),'fresh_recovery_operation_required')
        self.h.m.verify_inputs(self.h.o,self.h.binding['privateInputHashes'])
        target=self.target_verify();actors=self.native();financial=self.financial();scanner=self.scanner_identity()
        observed=self.child('inspect')
        return {'format':FORMAT,'planSha256':sha(encode(self.plan)),'artifact':SOURCE,'predecessor':self.expected,'target':target,'actors':actors,'bootLinks':self.links(),'financial':financial,'scanner':scanner,'online':observed,'originalPrivateInputHashes':self.h.binding['privateInputHashes'],'privateStateRestores':0,'schemaMigrations':0,'oldRuntimeStarts':0}
    def load_operation(self):
        p=json.loads(protected(self.base/'plan.json'));r=json.loads(protected(self.base/'review.json'));o=json.loads(protected(self.base/'operation.json'))
        need(p==self.plan and o=={'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'planSha256':sha(encode(p)),'reviewSha256':sha(encode(r)),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()},'exact_same_boot_owned_operation_required')
        self.h.files_and_roles();self.h.artifacts(fresh=False)
        for unit,row in r['actors'].items():
            body=protected(self.base/(unit+'.before'))
            need(sha(body)==row['unitSha256'],'owned_before_definition_changed');self.h.native[unit]={'body':body,'sha256':sha(body)}
        self.expected_ledger=r['online']['retainedLedger'];self.expected_identities=r['online']['identities']
        self.target_credentials()
        return r
    def journal_intents(self):
        path=self.base/'sql.jsonl'
        if not path.exists():return []
        rows=[json.loads(x)for x in protected(path).splitlines()]
        need(all(r.get('format')=='yunipals-arena-modern-public-rollback-child-v1'for r in rows),'exact_recovery_sql_journal_required')
        return [r for r in rows if r['phase'].endswith('_commit_intent')]
    def status(self):
        r=self.load_operation();state=self.child('reconcile',intents=self.journal_intents(),retainedLedger=r['online']['retainedLedger'])
        phase=acknowledge(state,self.journal_intents(),r['predecessor'])
        return {'format':FORMAT,'phase':phase,'state':state,'serviceChanges':0,'databaseWrites':0,'automaticRetry':False}
    def retire_links(self,rows):
        for unit,row in rows.items():
            path=Path(row['path']);need(boot_identity(path,unit)==row,'native_boot_link_changed_before_drain')
            held=path.parent/('.'+unit+'.public-recovery-'+self.plan['operationId'])
            need(not os.path.lexists(held),'fresh_native_boot_hold_required')
            save(self.base/(unit+'.boot-intent.json'),{**row,'held':str(held)})
            os.rename(path,held);sync(path.parent)
            need(boot_identity(held,unit)=={**row,'path':str(held)},'owned_boot_inode_not_preserved')
            save(self.base/(unit+'.boot-held.json'),{**row,'held':str(held)})
    def stop_native(self,actors):
        need(self.h.native_set(allow_descendants=True)==actors,'reviewed_native_invocation_changed_before_stop')
        save(self.base/'stop-intent.json',{'actors':actors,'monotonicNanoseconds':time.monotonic_ns()})
        self.run(['/usr/bin/systemctl','stop',*actors],timeout=40)
        self.quiet()
        save(self.base/'stopped.json',{'actors':actors,'terminal':True})
    def quiet(self):
        for unit in self.h.native:
            p=self.h.r.props(self.h.m,unit)
            need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'},'native_workers_must_be_terminal')
            self.h.r.cgroup(unit)
            need(not self.owner.activation_paths(unit),'native_autoactivation_path_must_stay_held')
        self.h.r.no_jobs(self.h.m)
        need(self.h.m.catalog()['otherSessions']==0,'native_database_clients_must_be_drained')
    def install_source(self,review,selection):
        url=self.public_url if self.plan['targetKind']=='legacy_rollback'else self.h.source_url
        path=Path('/etc/yunipals-arena')/('public-source-'+self.plan['operationId']+'.env')
        raw=write_source_overlay(url,selection['kind'],selection['source_id'])
        if path.exists():need(sha(protected(path,10000,True))==sha(raw),'owned_source_overlay_changed')
        else:save(path,raw)
        out={}
        for unit,row in review['actors'].items():
            target=Path('/etc/systemd/system')/unit;before=protected(self.base/(unit+'.before'));body=before+b'\n[Service]\nEnvironmentFile='+str(path).encode()+b'\n'
            receipt=self.base/(unit+'.source-file.json');prepared=target.parent/('.'+unit+'.public-recovery-'+self.plan['operationId']+'.prepared')
            owned=install_owned_file(target,row['unitSha256'],body,receipt,self.base/(unit+'.source-file-intent.json'),prepared,{'sourceFile':str(path),'sourceSha256':sha(raw)})
            self.h.native[unit]={'body':body,'sha256':sha(body)};out[unit]=owned
        self.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
        return out
    def restore_links(self,review):
        for unit,row in review['bootLinks'].items():
            hold=json.loads(protected(self.base/(unit+'.boot-held.json')));path=Path(row['path']);held=Path(hold['held'])
            need(boot_identity(held,unit)=={**row,'path':str(held)},'held_native_boot_inode_changed')
            if os.path.lexists(path):need(boot_identity(path,unit)==row,'foreign_native_boot_path_blocks_restart')
            else:os.link(held,path,follow_symlinks=False);sync(path.parent)
    def start_native(self,review):
        self.h.m.verify_inputs(self.h.o,self.h.binding['privateInputHashes'])
        capacity=self.h.capacity()
        if not(self.base/'capacity-before-start.json').exists():save(self.base/'capacity-before-start.json',capacity)
        self.restore_links(review)
        path=self.base/'start-intent.json'
        if path.exists():
            intent=json.loads(protected(path));actors=self.h.native_set()
            ticks=os.sysconf('SC_CLK_TCK')
            need(all(intent['monotonicNanoseconds']//1000000000*ticks<=r['startTicks']<=(intent['monotonicNanoseconds']//1000000000+120)*ticks for r in actors.values()),'unknown_or_later_native_start_refused')
        else:
            for unit in self.h.native:
                p=self.h.r.props(self.h.m,unit);need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'},'native_worker_not_quiet_before_owned_restart')
            intent={'units':list(self.h.native),'monotonicNanoseconds':time.monotonic_ns(),'automaticRetry':False};save(path,intent)
            self.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
            self.h.m.verify_inputs(self.h.o,self.h.binding['privateInputHashes'])
            self.run(['/usr/bin/systemctl','start','--no-block',*self.h.native],timeout=10)
            deadline=time.monotonic()+90;first=None;since=None
            while True:
                try:actors=self.h.native_set()
                except self.owner.CutoverFailure:actors=None
                if actors:
                    if first is None:first=actors;since=time.monotonic()
                    need(actors==first,'native_worker_restarted_during_recovery')
                    if time.monotonic()-since>=20:break
                elif first:raise Refusal('native_worker_failed_after_start')
                need(time.monotonic()<deadline,'native_recovery_start_not_stable');time.sleep(.5)
        if not(self.base/'started.json').exists():save(self.base/'started.json',actors)
        return actors

def review_hash(r):
    v=json.loads(encode(r));v['online'].pop('coverage',None)
    return sha(encode(v))

def finish_prepared(h):
    r=h.load_operation();state=h.status()
    need(state['phase']=='halted','only_owned_halted_preparation_can_finish')
    intents=h.journal_intents();statuses={(x['phase'],x['xid']):x['status']for x in state['state']['transactions']}
    need(len(intents)==1 and intents[0]['phase']=='halt_commit_intent'and statuses.get(('halt_commit_intent',intents[0]['xid']))=='committed','confirmed_owned_halt_required')
    h.quiet();h.target_verify();h.financial();h.scanner_identity()
    path=h.base/'official-review.json';need(not path.exists(),'official_review_already_acknowledged')
    official=h.child('switch',retainedLedger=r['online']['retainedLedger'])
    need(official.get('applied')is False,'readonly_official_review_required');save(path,official)
    return {'format':FORMAT,'prepared':True,'officialReviewHash':official['reviewHash'],'databaseWritesThisCall':0,'serviceChangesThisCall':0}


def scanner_actor(p):
    need(re.fullmatch('[0-9a-f]{32}',p['InvocationID'])and int(p['MainPID'])>1,'actual_scanner_invocation_required')
    root=Path('/proc')/p['MainPID'];before=(root/'stat').read_text();ticks=int(before[before.rfind(')')+2:].split()[19])
    need((root/'cmdline').read_bytes().split(b'\0')==[str(NODE).encode(),str(SCANNER_CHILD).encode(),b'--scanner',str(SCANNER_CONFIG).encode(),b''],'exact_scanner_command_required')
    need((root/'cgroup').read_text().splitlines()==['0::/system.slice/'+UNIT],'exact_scanner_cgroup_required')
    status=dict(line.split(':',1)for line in(root/'status').read_text().splitlines()if ':'in line)
    need(len(set(status['Uid'].split()))==1 and int(status['Uid'].split()[0])>=61184 and status['NoNewPrivs'].strip()=='1'and all(int(status[k],16)==0 for k in ['CapPrm','CapEff','CapAmb']),'dynamic_nonprivileged_scanner_actor_required')
    after=(root/'stat').read_text();need(ticks==int(after[after.rfind(')')+2:].split()[19]),'scanner_actor_changed_during_proof')
    return {'pid':int(p['MainPID']),'startTicks':ticks,'invocation':p['InvocationID'],'uid':int(status['Uid'].split()[0])}


def scanner_properties(h):
    keys=['MainPID','InvocationID','ActiveState','SubState','Job','RuntimeMaxUSec','Restart','NRestarts','FragmentPath','DropInPaths','ExecMainStartTimestampMonotonic','ControlGroup','ExecStart','WorkingDirectory']
    raw=h.run(['/usr/bin/systemctl','show','--all',UNIT,*['--property='+k for k in keys]],maximum=10000).decode()
    value=dict(line.split('=',1)for line in raw.splitlines());need(set(value)==set(keys),'complete_scanner_manager_metadata_required');return value


def public_directory(path,fresh=False):
    if not path.exists():
        path.mkdir(mode=0o755);os.chmod(path,0o755);sync(path.parent)
    else:
        need(not fresh,'fresh_public_runtime_directory_required')
        s=path.lstat();need(stat.S_ISDIR(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o755,'existing_public_runtime_directory_must_be_traversable_owned')


def scanner_setup_review(h):
    need(not os.path.lexists(SCANNER_BASE)and not os.path.lexists(Path('/etc/systemd/system')/UNIT)and not os.path.lexists(SCANNER_PUBLIC),'fresh_scanner_namespace_required')
    need(not h.owner.activation_paths(UNIT)and not os.path.lexists(Path('/etc/systemd/system')/(UNIT+'.d'))and not os.path.lexists(Path('/run/systemd/system')/UNIT),'fresh_scanner_activation_paths_required')
    target=h.target_verify();financial=h.financial()
    return {'format':FORMAT,'scannerSetup':True,'planSha256':sha(encode(h.plan)),'target':target,'financial':financial,'unitSha256':sha(scanner_definition()),'childSha256':h.plan['childSha256'],'continuousBeforeSelection':True,'paidAuthority':False,'maximumDbPool':1,'maximumLogRange':500,'sourceDigest':SOURCE}


def scanner_start(h,expected):
    r=scanner_setup_review(h);need(sha(encode(r))==expected,'exact_scanner_setup_review_required')
    SCANNER_BASE.mkdir(mode=0o700,parents=True);save(SCANNER_BASE/'review.json',r)
    public_directory(SCANNER_PUBLIC.parent);public_directory(SCANNER_PUBLIC,fresh=True);save(SCANNER_CHILD,protected(CHILD,100000),0o644)
    config={'format':'yunipals-arena-public-scanner-v1','sourceDigest':SOURCE,'rpc':{'url':'http://127.0.0.1:19202/unified','profileId':PROFILE_ID},'provision':h.catalog,'freeOnly':True,'paidAuthority':False}
    save(SCANNER_CONFIG,config,0o644);save(Path('/etc/systemd/system')/UNIT,scanner_definition(),0o644)
    link=Path('/etc/systemd/system/multi-user.target.wants')/UNIT
    save(SCANNER_BASE/'boot-intent.json',{'path':str(link),'target':str(Path('/etc/systemd/system')/UNIT)})
    link.symlink_to(str(Path('/etc/systemd/system')/UNIT));sync(link.parent);boot=boot_identity(link,UNIT);save(SCANNER_BASE/'boot.json',boot)
    h.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
    loaded=scanner_properties(h);need(loaded['RuntimeMaxUSec']=='infinity'and loaded['Restart']=='on-failure'and loaded['DropInPaths']=='','loaded_continuous_scanner_policy_required_before_start')
    save(SCANNER_BASE/'start-intent.json',{'unitSha256':r['unitSha256'],'monotonicNanoseconds':time.monotonic_ns(),'bootLink':boot,'configSha256':sha(encode(config)),'childSha256':h.plan['childSha256'],'targetAdmissionSha256':h.plan['targetAdmission']['sha256'],'automaticRetry':False})
    h.run(['/usr/bin/systemctl','start','--no-block',UNIT],timeout=10)
    deadline=time.monotonic()+45;seen=None;since=None
    while True:
        p=scanner_properties(h)
        if p['ActiveState']=='active'and p['SubState']=='running'and int(p['MainPID'])>1 and p['Job']=='':
            current=scanner_actor(p)
            if seen is None:seen=current;since=time.monotonic()
            need(seen==current and p['NRestarts']=='0','scanner_restart_during_initial_acceptance')
            if time.monotonic()-since>=20:break
        else:need(seen is None,'scanner_failed_during_initial_acceptance')
        need(time.monotonic()<deadline,'scanner_initial_start_not_acknowledged');time.sleep(.5)
    result={'format':FORMAT,'scannerStarted':True,'unitSha256':r['unitSha256'],'childSha256':r['childSha256'],'targetAdmissionSha256':h.plan['targetAdmission']['sha256'],'configSha256':sha(encode(config)),'bootLink':boot,'runtime':seen,'continuous':True,'paidAuthority':False,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    save(SCANNER_BASE/'result.json',result);return result


def scanner_inspect(h):
    need(sha(protected(Path('/etc/systemd/system')/UNIT,10000))==sha(scanner_definition()),'exact_owned_scanner_definition_required')
    review=json.loads(protected(SCANNER_BASE/'review.json'));intent=json.loads(protected(SCANNER_BASE/'start-intent.json'));boot=json.loads(protected(SCANNER_BASE/'boot.json'))
    need(review['unitSha256']==intent['unitSha256']==sha(scanner_definition())and intent['childSha256']==h.plan['childSha256']and intent['targetAdmissionSha256']==h.plan['targetAdmission']['sha256'],'owned_scanner_setup_binding_changed')
    need(sha(protected(SCANNER_CONFIG,100000))==intent['configSha256']and sha(protected(SCANNER_CHILD,100000))==intent['childSha256'],'exact_owned_scanner_public_bytes_required')
    p=scanner_properties(h)
    need(p['FragmentPath']==str(Path('/etc/systemd/system')/UNIT)and p['DropInPaths']==''and p['RuntimeMaxUSec']=='infinity'and p['Restart']=='on-failure'and p['Job']=='','loaded_owned_scanner_configuration_changed')
    link=Path(boot['path'])
    if os.path.lexists(link):need(boot_identity(link,UNIT)==boot,'scanner_boot_path_changed')
    else:need((SCANNER_BASE/'boot-remove-intent.json').exists(),'unowned_scanner_boot_removal')
    need(h.owner.activation_paths(UNIT)in[[str(link)],[]],'unowned_other_scanner_activation_path')
    if p['ActiveState']=='active'and p['SubState']=='running':
        need(os.path.lexists(link),'continuous_scanner_boot_link_missing')
        actor=scanner_actor(p)
        if not(SCANNER_BASE/'result.json').exists():
            ticks=os.sysconf('SC_CLK_TCK');start=intent['monotonicNanoseconds']//1000000000*ticks
            need(p['NRestarts']=='0'and start<=actor['startTicks']<=start+120*ticks,'unacknowledged_start_must_be_exact_initial_window')
        runtime={**actor,'restarts':int(p['NRestarts']),'unitSha256':intent['unitSha256'],'bootLink':boot}
        return {'format':FORMAT,'state':'running','runtime':runtime,'configSha256':intent['configSha256'],'targetAdmissionSha256':intent['targetAdmissionSha256'],'childSha256':intent['childSha256'],'serviceChanges':0,'databaseWrites':0}
    need(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'},'scanner_not_terminal')
    return {'format':FORMAT,'state':'terminal','runtime':None,'bootLink':boot,'bootPresent':os.path.lexists(link),'serviceChanges':0,'databaseWrites':0}


def scanner_ack_start(h,expected):
    observed=scanner_inspect(h);need(sha(encode(observed))==expected and observed['state']=='running','exact_running_owned_scanner_observation_required')
    need(not(SCANNER_BASE/'result.json').exists()and not(SCANNER_BASE/'stop-intent.json').exists(),'fresh_initial_start_ack_only')
    result={'format':FORMAT,'scannerStarted':True,'unitSha256':observed['runtime']['unitSha256'],'childSha256':observed['childSha256'],'targetAdmissionSha256':observed['targetAdmissionSha256'],'configSha256':observed['configSha256'],'bootLink':observed['runtime']['bootLink'],'runtime':observed['runtime'],'continuous':True,'paidAuthority':False,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'startAckRecovered':True}
    save(SCANNER_BASE/'result.json',result);return result


def verified_native_return(h):
    h.target_verify();h.load_operation();state=h.child('reconcile',intents=h.journal_intents())
    need(state['selection']['kind']=='unified'and state['selection']['source_id']==NATIVE_RELEASE,'selected_public_source_cannot_be_stopped')
    completed=json.loads(protected(h.base/'result.json'))
    need(completed.get('format')==FORMAT and completed.get('completed')is True and completed.get('planSha256')==sha(encode(h.plan))and completed.get('sourceDigest')==SOURCE and completed.get('selection')==state['selection']and not state['mode']['halted'],'actual_completed_native_return_required_before_scanner_stop')
    for unit,row in completed['nativeActors'].items():
        body=protected(Path('/etc/systemd/system')/unit,100000);need(sha(body)==row['unitSha256'],'completed_native_return_definition_changed');h.h.native[unit]={'body':body,'sha256':sha(body)}
    h.h.native_set(allow_descendants=True)
    h.child('inspect',targetKind='unified',targetUrl=h.h.source_url,expectedSelection=state['selection'],floor={'block':state['selection']['accepted_block'],'hash':state['selection']['accepted_hash']},retainedLedger=completed['retainedLedger'],expectedIdentities=completed['identities'])
    return state


def finish_scanner_stop(h):
    verified_native_return(h)
    intent=json.loads(protected(SCANNER_BASE/'stop-intent.json'));now=scanner_inspect(h)
    need(now['state']=='terminal'and not(SCANNER_BASE/'stopped.json').exists(),'only_exact_pending_terminal_stop_can_finish')
    link=Path(intent['bootLink']['path']);remove=SCANNER_BASE/'boot-remove-intent.json'
    if not remove.exists():save(remove,intent['bootLink'])
    need(json.loads(protected(remove))==intent['bootLink'],'owned_boot_removal_intent_changed')
    if os.path.lexists(link):need(boot_identity(link,UNIT)==intent['bootLink'],'scanner_boot_inode_changed_before_disable');link.unlink();sync(link.parent)
    need(not h.owner.activation_paths(UNIT),'scanner_other_activation_path_refused')
    result={'format':FORMAT,'scannerStopped':True,'bootDisabled':True,'nativeActorsChanged':False,'finishOnly':True};save(SCANNER_BASE/'stopped.json',result);return result


def scanner_stop(h,expected):
    # Only after a verified return to unified. Never remove the selected public
    # source, even when its HTTP endpoint is currently broken.
    verified_native_return(h)
    observed=scanner_inspect(h);current=observed['runtime'];need(observed['state']=='running'and sha(encode(observed))==expected,'fresh_exact_scanner_stop_review_required')
    need(not(SCANNER_BASE/'stop-intent.json').exists(),'uncertain_stop_requires_readonly_inspection_not_retry')
    save(SCANNER_BASE/'stop-intent.json',current)
    h.run(['/usr/bin/systemctl','stop',UNIT],timeout=40)
    return finish_scanner_stop(h)


def abort_review(h):
    r=h.load_operation();h.target_verify();state=h.status()
    need(state['phase']in{'original','halted'}and not any(x['phase']=='selection_commit_intent'for x in h.journal_intents()),'source_publication_intent_forbids_prepublication_abort')
    h.quiet()
    for unit,row in r['actors'].items():need(sha(protected(Path('/etc/systemd/system')/unit,100000))==row['unitSha256'],'abort_must_keep_same_modern_predecessor_definition')
    previous=r['predecessor'];url=h.h.source_url if previous['kind']=='unified'else h.public_url
    source=h.child('inspect',targetKind=previous['kind'],targetUrl=url,expectedSelection=previous,retainedLedger=r['online']['retainedLedger'])
    # Catch-up head may move; immutable floor/ledger/epoch and successful fresh
    # canonical source proof are required on BOTH review and apply.
    source.pop('coverage',None)
    return {'format':FORMAT,'beforePublicationAbort':True,'state':state['state'],'source':source,'planSha256':sha(encode(h.plan)),'privateDatabaseRestored':False,'oldRuntimeStarted':False}


def abort_before_publication(h,expected):
    reviewed=abort_review(h);need(sha(encode(reviewed))==expected,'exact_prepublication_abort_review_required')
    r=h.load_operation();previous=r['predecessor'];h.expected=previous
    save(h.base/'abort-intent.json',{'reviewSha256':expected,'modernArtifact':SOURCE,'selectedEpoch':previous['epoch']})
    actors=h.start_native(r)
    h.h.m.verify_inputs(h.h.o,h.h.binding['privateInputHashes'])
    if reviewed['state']['mode']['halted']:
        url=h.h.source_url if previous['kind']=='unified'else h.public_url
        h.child('unhalt',journal=h.base/'sql.jsonl',targetKind=previous['kind'],targetUrl=url,retainedLedger=r['online']['retainedLedger'])
    result={'format':FORMAT,'abortedBeforePublication':True,'selectedEpoch':previous['epoch'],'nativeActors':actors,'privateDatabaseRestored':False,'preAdoptionRuntimeStarted':False,'sourceSelectionChanged':False}
    save(h.base/'abort-result.json',result);return result


def prepare(h,r,expected):
    need(review_hash(r)==expected,'exact_readonly_recovery_review_required')
    need(review_hash(h.review())==expected,'readiness_actors_or_private_ledger_changed_before_prepare')
    if not AREA.exists():AREA.mkdir(mode=0o700)
    h.base.mkdir(mode=0o700,parents=False);save(h.base/'plan.json',h.plan);save(h.base/'review.json',r)
    save(h.base/'operation.json',{'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'planSha256':sha(encode(h.plan)),'reviewSha256':sha(encode(r)),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
    for unit,value in h.h.native.items():save(h.base/(unit+'.before'),value['body'])
    h.retire_links(r['bootLinks']);h.stop_native(r['actors'])
    h.child('halt',journal=h.base/'sql.jsonl',retainedLedger=r['online']['retainedLedger'])
    official=h.child('switch',retainedLedger=r['online']['retainedLedger'])
    need(official.get('applied')is False and re.fullmatch('0x[0-9a-f]{64}',official.get('reviewHash','')),'actual_official_source_switch_review_required')
    save(h.base/'official-review.json',official)
    return {'format':FORMAT,'prepared':True,'workersTerminal':8,'halted':True,'officialReviewHash':official['reviewHash'],'sourceSelectionChanged':False,'automaticRetry':False}

def publish(h,expected,continuation=False):
    r=h.load_operation();h.target_verify();h.financial();h.scanner_identity()
    official=json.loads(protected(h.base/'official-review.json'));need(expected==official['reviewHash'],'exact_official_recovery_review_required')
    current=h.status();phase=current['phase'];ledger=r['online']['retainedLedger']
    if phase=='halted':
        need(not continuation,'no_implicit_republication_after_uncertain_ack');h.quiet()
        need(not any(x['phase']=='selection_commit_intent'for x in h.journal_intents()),'recorded_publication_requires_reconciliation_not_retry')
        h.child('switch',journal=h.base/'sql.jsonl',retainedLedger=ledger,applyHash=expected)
        current=h.status();need(current['phase']=='published','confirmed_owned_publication_required')
    else:need(continuation and phase=='published','only_confirmed_owned_publication_can_continue')
    selection=current['state']['selection'];h.expected=selection
    if not(h.base/'started.json').exists():
        h.install_source(r,selection);actors=h.start_native(r)
    else:
        for unit in h.h.native:
            body=protected(Path('/etc/systemd/system')/unit,100000);owned=json.loads(protected(h.base/(unit+'.source-file.json')));need(sha(body)==owned['unitSha256'],'owned_selected_definition_changed');h.h.native[unit]={'body':body,'sha256':sha(body)}
        actors=h.h.native_set(allow_descendants=not current['state']['mode']['halted'])
    h.h.m.verify_inputs(h.h.o,h.h.binding['privateInputHashes'])
    state=h.child('reconcile',intents=h.journal_intents(),retainedLedger=ledger)
    need(state['selection']==selection and state['retainedLedger'].get('verified')is True,'retained_private_work_changed')
    if state['mode']['halted']:
        need(not any(x['phase']=='unhalt_commit_intent'for x in h.journal_intents()),'uncertain_unhalt_requires_readonly_reconcile')
        h.child('unhalt',journal=h.base/'sql.jsonl',retainedLedger=ledger)
    else:
        intents=h.journal_intents();statuses={(x['phase'],x['xid']):x['status']for x in state['transactions']}
        need(sum(x['phase']=='unhalt_commit_intent'and statuses.get((x['phase'],x['xid']))=='committed'for x in intents)==1,'unhalt_requires_own_confirmed_transaction')
    result={'format':FORMAT,'completed':True,'sourceDigest':SOURCE,'planSha256':sha(encode(h.plan)),'predecessorResultSha256':h.plan['predecessor']['sha256'],'selection':selection,'selectedEpoch':selection['epoch'],'nativeActors':actors,'retainedLedger':ledger,'identities':state['identities'],'privateHistoriesRetained':True,'privateDatabaseRestored':False,'originalRuntimeStarted':False,'schemaMigrations':0,'scannerContinuous':True}
    save(h.base/'result.json',result);return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--plan-sha256',required=True);parser.add_argument('--prepare');parser.add_argument('--publish');parser.add_argument('--continue-published',dest='continue_published');parser.add_argument('--reconcile',action='store_true');parser.add_argument('--finish-prepared',action='store_true');parser.add_argument('--scanner-review',action='store_true');parser.add_argument('--scanner-start');parser.add_argument('--scanner-stop-review',action='store_true');parser.add_argument('--scanner-stop');parser.add_argument('--scanner-inspect',action='store_true');parser.add_argument('--ack-scanner-start');parser.add_argument('--finish-scanner-stop',action='store_true');parser.add_argument('--abort-review',action='store_true');parser.add_argument('--abort-before-publication')
    args=parser.parse_args();need(os.geteuid()==os.getegid()==0,'root_owner_required');import socket;need(socket.gethostname()=='yunipals-main','fixed_root_host_required');need(sum(bool(x)for x in [args.prepare,args.publish,args.continue_published,args.reconcile,args.finish_prepared,args.scanner_review,args.scanner_start,args.scanner_stop_review,args.scanner_stop,args.scanner_inspect,args.ack_scanner_start,args.finish_scanner_stop,args.abort_review,args.abort_before_publication])<=1,'one_explicit_owner_phase_required')
    raw=protected(args.plan);need(pin(args.plan_sha256)and sha(raw)==args.plan_sha256,'actual_plan_hash_required');h=Host(json.loads(raw));os.umask(0o077)
    with h.h.m.existing_source_lease():
        if args.scanner_review:r=scanner_setup_review(h);result={'review':r,'reviewHash':sha(encode(r))}
        elif args.scanner_start:result=scanner_start(h,args.scanner_start)
        elif args.scanner_stop_review or args.scanner_inspect:r=scanner_inspect(h);result={'review':r,'reviewHash':sha(encode(r)),'databaseWrites':0,'serviceChanges':0}
        elif args.ack_scanner_start:result=scanner_ack_start(h,args.ack_scanner_start)
        elif args.finish_scanner_stop:result=finish_scanner_stop(h)
        elif args.scanner_stop:result=scanner_stop(h,args.scanner_stop)
        elif args.abort_review:r=abort_review(h);result={'review':r,'reviewHash':sha(encode(r)),'databaseWrites':0,'serviceChanges':0}
        elif args.abort_before_publication:result=abort_before_publication(h,args.abort_before_publication)
        elif args.finish_prepared:result=finish_prepared(h)
        elif args.reconcile:result=h.status()
        elif args.prepare:result=prepare(h,h.review(),args.prepare)
        elif args.publish or args.continue_published:result=publish(h,args.publish or args.continue_published,bool(args.continue_published))
        else:r=h.review();result={'review':r,'reviewHash':review_hash(r),'databaseWrites':0,'serviceChanges':0}
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(e)if isinstance(e,Refusal)else'public_recovery_refused','rawMessagesExported':False,'automaticRetry':False}));raise SystemExit(1)
