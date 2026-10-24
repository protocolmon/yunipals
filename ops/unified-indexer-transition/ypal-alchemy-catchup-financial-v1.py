#!/usr/bin/env python3
"""One original-cap catch-up financial operation; no source/proxy lifecycle.

All live execution is a separate reviewed operator action. This preparation
does not send provider requests, change roles or start/stop a service.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT='yunipals-ypal-alchemy-catchup-financial-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-alchemy-catchup-financial-v1-20261024')
RANGE_INPUT=Path('/var/backups/yunipals-alchemy-catchup-range-input-v1-20261024/input.json')
SOURCES=OPS/'ypal-alchemy-catchup-financial-v1.sources.json'
PROFILE=OPS/'ypal-combined-rpc-v1/profile.json'
MODEL=OPS/'ypal-alchemy-catchup-financial-v1.model.py'
MODEL_SHA='703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14'
SDK_SHA='f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea'
QUIET_FILE='ypal-alchemy-primary-current-v1.py'
SENTINEL='/run/yunipals-alchemy-financial-no-password'
LOCK=Path('/run/lock/yunipals-alchemy-catchup-financial-v1.lock')


def need(ok,code):
    if not ok:raise RuntimeError(code)
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def pin(value):return isinstance(value,str)and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64


def monotonic(m,previous,current):
    need(current['clockMs']>=previous['clockMs'],'acknowledged_financial_clock_must_not_rewind')
    for key in ['windows','workloadWindows','permits']:
        fields=['day']if key=='windows'else['day','workload']if key=='workloadWindows'else['permitId']
        actual={tuple(v[k]for k in fields):v for v in current[key]}
        for prior in previous[key]:
            now=actual.get(tuple(prior[k]for k in fields));counters=['spentCu']if key=='permits'else[k for k in prior if k not in fields]
            need(now is not None and all(m.number(now[k])>=m.number(prior[k])for k in counters),
                 'acknowledged_financial_bookings_must_not_rewind')


@contextlib.contextmanager
def financial_lock():
    parent=LOCK.parent.lstat()
    need(parent.st_uid==parent.st_gid==0 and stat.S_ISDIR(parent.st_mode)and
         (not parent.st_mode&0o022 or stat.S_IMODE(parent.st_mode)==0o1777),'protected_financial_lock_parent_required')
    fd=os.open(LOCK,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        row=os.fstat(fd)
        need(stat.S_ISREG(row.st_mode)and row.st_uid==row.st_gid==0 and row.st_nlink==1 and stat.S_IMODE(row.st_mode)==0o600,
             'one_root0600_financial_lock_inode_required')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need((row.st_dev,row.st_ino)==(LOCK.lstat().st_dev,LOCK.lstat().st_ino),'financial_lock_path_changed')
        yield
    finally:os.close(fd)


def primitives():
    path=OPS/'ypal-managed-handover-v1.py'
    # Loading fixed file/query primitives only, never its obsolete Host.
    import stat
    for parent in [*path.parents,path]:
        row=parent.lstat();need(row.st_uid==0 and not row.st_mode&0o022 and not stat.S_ISLNK(row.st_mode),'protected_financial_primitive_source_required')
    raw=path.read_bytes();need(len(raw)<200000 and sha(raw)==SDK_SHA,'exact_fixed_file_and_process_primitives_required')
    value=types.ModuleType('financial_private_primitives');value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);need(sha(value.protected(path))==SDK_SHA,'same_protected_financial_primitives_required');return value


def args(readonly=True):
    need(not os.path.lexists(SENTINEL),'absent_financial_password_sentinel_required')
    options='-c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000 -c search_path=pg_catalog -c timezone=UTC'
    if readonly:options+=' -c default_transaction_read_only=on'
    return ['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs',
        '/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGPASSFILE='+SENTINEL,'PGAPPNAME=ypal_alchemy_catchup_financial_v1','PGOPTIONS='+options,
        '/usr/bin/psql','-XwAtq','-h','/var/run/postgresql','-p','15438','-U','postgres','-d','yunipals_market_production','-v','ON_ERROR_STOP=1']


class Client:
    """One persistent PG transaction, held through the durable root ACK."""
    def __init__(self,readonly=False):
        self.p=subprocess.Popen(args(readonly),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
            cwd='/',env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'})
        self.buffer=b'';self.deadline=time.monotonic()+90;self.wait=selectors.DefaultSelector();self.wait.register(self.p.stdout,selectors.EVENT_READ)
    def send(self,sql):
        need(time.monotonic()<self.deadline and self.p.poll()is None,'same_live_bounded_financial_child_required')
        self.p.stdin.write(sql.encode());self.p.stdin.flush()
    def packet(self):
        while True:
            while b'\n'in self.buffer:
                row,self.buffer=self.buffer.split(b'\n',1)
                if row.strip():return json.loads(row)
            need(time.monotonic()<self.deadline,'financial_SQL_child_timeout_unknown_ACK')
            if not self.wait.select(min(2,max(0,self.deadline-time.monotonic()))):continue
            data=os.read(self.p.stdout.fileno(),65536);need(data,'financial_SQL_child_refused_unknown_ACK')
            self.buffer+=data;need(len(self.buffer)<=16000000,'bounded_financial_packet_required')
    def observe(self,m,assign_xid=True):
        xid='pg_current_xact_id()'if assign_xid else'pg_current_xact_id_if_assigned()'
        self.send("WITH s AS ("+m.snapshot_sql()+")SELECT jsonb_build_object('snapshot',jsonb_build_object,'xid',"+xid+"::text,'backendPid',pg_backend_pid(),'backendStart',(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()))FROM s;\n")
        return self.packet()
    def kernel_identity(self):
        path=Path('/proc')/str(self.p.pid);before=(path/'stat').read_text();ticks=int(before[before.rfind(')')+2:].split()[19])
        status=dict(row.split(':',1)for row in(path/'status').read_text().splitlines()if':'in row)
        argv=(path/'cmdline').read_bytes().rstrip(b'\0').split(b'\0');expected=args(False);offset=expected.index('/usr/bin/psql')
        need(set(status['Uid'].split())=={'111'}and set(status['Gid'].split())=={'113'}and not status['Groups'].split()and
             status['NoNewPrivs'].strip()=='1'and all(int(status[key],16)==0 for key in['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])and
             Path(argv[0].decode()).name=='psql'and argv[1:]==[v.encode()for v in expected[offset+1:]]and
             os.getpgid(self.p.pid)==self.p.pid,'actual_owned_postgres_UID111_GID113_zero_capability_psql_process_required')
        after=(path/'stat').read_text();need(int(after[after.rfind(')')+2:].split()[19])==ticks,'same_owned_financial_psql_PID_epoch_required')
        return {'pid':self.p.pid,'startTicks':ticks,'uid':111,'gid':113,'capabilitiesZero':True,'noNewPrivileges':True,
                'commandSha256':sha((path/'cmdline').read_bytes()),'ownProcessGroup':True}
    def finish(self,commit):
        self.send(('COMMIT'if commit else'ROLLBACK')+";SELECT jsonb_build_object('finished',true);\n")
        need(self.packet()=={'finished':True},'one_actual_SQL_completion_marker_required')
    def close(self):
        try:
            if self.p.poll()is None:
                try:self.p.stdin.close();self.p.wait(timeout=3)
                except BaseException:
                    try:os.killpg(self.p.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    self.p.wait(timeout=3)
        finally:
            self.wait.close()
            for stream in[self.p.stdin,self.p.stdout,self.p.stderr]:
                if not stream.closed:stream.close()


class Host:
    def __init__(self,sources_sha,range_sha):
        self.s=primitives();self.m=self.s.module(MODEL,MODEL_SHA);self.sources_sha=sources_sha;self.range_sha=range_sha
        self.sources=self.s.document(SOURCES,sources_sha)
        need(self.sources['format']==FORMAT+'-sources'and set(self.sources)=={'format','closeLeaf','rangeEvidence'}and
             self.sources['closeLeaf']['file']==QUIET_FILE and set(self.sources['closeLeaf'])=={'file','sha256'}and pin(self.sources['closeLeaf']['sha256']),
             'one_real_reviewed_financial_import_free_close_leaf_required')
        self.leaf=self.s.module(OPS/QUIET_FILE,self.sources['closeLeaf']['sha256'])
        need(callable(self.leaf.validate_paid_quiet)and callable(self.leaf.validate_deadline_prepared),
             'actual_quiet_and_prepared_deadline_leaf_exports_required')
        self.profile=self.s.document(PROFILE,self.m.PROFILE_FILE_SHA);self.ranges=self.s.document(RANGE_INPUT,range_sha)
        refs=self.sources['rangeEvidence']
        need(set(refs)=={'captureHelperSha256','rawReceiptSha256','decoderSha256'}and all(pin(v)for v in refs.values())and
             refs['decoderSha256']==self.m.DECODER_SHA,'actual_capture_helper_raw_receipt_and_official_decoder_hashes_required')
        raw=self.s.document(RANGE_INPUT.parent/'raw.json',refs['rawReceiptSha256'])
        need(sha(self.s.protected(RANGE_INPUT.parent/'capture.py'))==refs['captureHelperSha256'],'actual_orchestrator_source_authenticated_hash_only_never_execute')
        decoder=self.s.protected(RANGE_INPUT.parent/'ponder-checkpoint.ts')
        self.range_evidence=self.m.validate_range_evidence(raw,self.ranges,decoder)
        self.range_evidence.update({'actualRawCaptureSha256':refs['rawReceiptSha256'],
            'captureHelperSha256':refs['captureHelperSha256'],'captureHelperExecuted':False})
    def query(self,sql):
        raw=self.s.command(args(True),('BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;'+sql+';ROLLBACK;').encode(),timeout=25)
        need(len(raw)<=16000000 and not os.path.lexists(SENTINEL),'bounded_readonly_financial_result_required')
        rows=[json.loads(line)for line in raw.decode().splitlines()if line.strip()];need(len(rows)==1,'one_actual_financial_packet_required');return rows[0]
    def snapshot(self):return self.query(self.m.snapshot_sql())
    def unchanged_sources(self):
        need(self.s.document(SOURCES,self.sources_sha)==self.sources and
             sha(self.s.protected(MODEL))==MODEL_SHA and self.s.document(PROFILE,self.m.PROFILE_FILE_SHA)==self.profile and
             self.s.document(RANGE_INPUT,self.range_sha)==self.ranges and
             sha(self.s.protected(RANGE_INPUT.parent/'capture.py'))==self.sources['rangeEvidence']['captureHelperSha256']and
             sha(self.s.protected(RANGE_INPUT.parent/'raw.json'))==self.sources['rangeEvidence']['rawReceiptSha256']and
             sha(self.s.protected(RANGE_INPUT.parent/'ponder-checkpoint.ts'))==self.m.DECODER_SHA and
             sha(self.s.protected(OPS/QUIET_FILE))==self.sources['closeLeaf']['sha256'],
             'all_reviewed_financial_model_profile_range_and_leaf_sources_must_stay_exact')
    def quiet(self,quiet_sha,result_sha):
        need(pin(quiet_sha)and pin(result_sha),'actual_quiet_and_financial_receipt_hashes_required')
        self.s.document(SOURCES,self.sources_sha);need(sha(self.s.protected(OPS/QUIET_FILE))==self.sources['closeLeaf']['sha256'],'same_actual_close_leaf_source_required')
        value=self.leaf.validate_paid_quiet(quiet_sha,result_sha)
        need(value['validated']is value['paidRequestsQuiet']is True and value['sourceActorQualified']is False,
             'actual_own_four_proxy_paid_quiet_proof_required')
        need(sha(self.s.protected(OPS/QUIET_FILE))==self.sources['closeLeaf']['sha256'],'same_close_leaf_after_current_qualification_required')
        return value
    def deadline(self,plan_sha,receipt_sha):
        need(pin(plan_sha)and pin(receipt_sha),'actual_plan_and_installed_deadline_receipt_hashes_required')
        self.s.document(SOURCES,self.sources_sha);need(sha(self.s.protected(OPS/QUIET_FILE))==self.sources['closeLeaf']['sha256'],'same_actual_deadline_leaf_source_required')
        value=self.leaf.validate_deadline_prepared(plan_sha,receipt_sha)
        need(value['validated']is value['deadlinePrepared']is True and value['sourceActorQualified']is False,
             'actual_installed_window_close_and_UTC_restoration_required_before_admission')
        need(sha(self.s.protected(OPS/QUIET_FILE))==self.sources['closeLeaf']['sha256'],'same_deadline_leaf_after_current_qualification_required')
        return value


class Owner:
    def __init__(self,h):self.h=h;self.s=h.s;self.m=h.m
    def get(self,name):return self.s.document(BASE/name)
    def put(self,name,value):return self.s.save(BASE/name,value)
    def digest(self,name):return sha(self.s.protected(BASE/name))
    def producer(self):return sha(self.s.protected(Path(__file__).absolute()))
    def prepared(self):
        row=self.get('prepared.json')
        need(row['format']==FORMAT and row['operatorSha256']==self.producer()and row['modelSha256']==MODEL_SHA and row['bootId']==self.s.boot()and
             row['sourcesSha256']==self.h.sources_sha and row['rangeInputSha256']==self.h.range_sha and
             row['rangeEvidence']==self.h.range_evidence and row['financialApplied']is False and
             row['planSha256']==self.digest('plan.json')and self.get('plan.json')==row['plan']and
             row['plan']==self.m.plan(row['before'],self.h.ranges,self.h.range_sha,row['plan']['startMs'],self.h.profile),
             'actual_own_immutable_financial_plan_baseline_and_sources_required')
        return row
    def prepare(self):
        need(not os.path.lexists(BASE),'fresh_one_time_financial_preparation_required')
        before=self.h.snapshot();plan=self.m.plan(before,self.h.ranges,self.h.range_sha,before['clockMs'],self.h.profile)
        value={'format':FORMAT,'operatorSha256':self.producer(),'modelSha256':MODEL_SHA,'bootId':self.s.boot(),'sourcesSha256':self.h.sources_sha,
            'rangeInputSha256':self.h.range_sha,'rangeEvidence':self.h.range_evidence,'before':before,'plan':plan,'planSha256':self.m.digest(plan),'financialApplied':False}
        BASE.mkdir(mode=0o700);self.s.sync(BASE.parent);self.put('plan.json',plan);self.put('prepared.json',value);return self.plan_summary(value)
    def plan_summary(self,row):
        plan=row['plan'];return {'format':FORMAT,'prepared':True,'planSha256':row['planSha256'],'preparedSha256':self.digest('prepared.json'),
            'profileId':self.m.PROFILE,'permits':plan['permits'],'startMs':plan['startMs'],'expiresMs':plan['expiresMs'],'grantDay':plan['grantDay'],
            'maximumAdditionalBookedCu':plan['maximumAdditionalBookedCu'],'normalDaily10MApproved':False,'financialApplied':False,'providerCalls':0,'serviceActions':0}
    def intent(self,name):
        value=self.get(name);row=self.prepared();phase=value['phase'];plan=row['plan']
        need(value['format']==FORMAT+'-intent'and value['operatorSha256']==self.producer()and value['modelSha256']==MODEL_SHA and
             value['bootId']==self.s.boot()and value['preparedSha256']==self.digest('prepared.json')and phase in{'admit','close','utc'}and
             name==('admission'if phase=='admit'else phase)+'-commit-intent.json'and
             isinstance(value['xid'],str)and re.fullmatch('[1-9][0-9]{0,19}',value['xid'])and
             type(value['backendPid'])is int and value['backendPid']>0 and isinstance(value['backendStart'],str)and bool(value['backendStart'])and
             type(value['clientProcess']['pid'])is type(value['clientProcess']['startTicks'])is int and
             value['clientProcess']['pid']>0 and value['clientProcess']['startTicks']>0 and
             value['clientProcess']['uid']==111 and value['clientProcess']['gid']==113 and
             value['clientProcess']['capabilitiesZero']is value['clientProcess']['noNewPrivileges']is value['clientProcess']['ownProcessGroup']is True and
             value['automaticRetryAllowed']is False and value['sqlSha256']==sha(self.m.writes(plan,phase,value['before']).encode()),
             'exact_own_financial_XID_intent_chain_required')
        if phase=='admit':
            self.validate_admission_before(value['before'],row);expected=self.m.expected_admitted(value['before'],plan)
            need(pin(value['deadlineSha256'])and value['deadlineProof']['validated']is value['deadlineProof']['deadlinePrepared']is True and
                 value['deadlineProof']['sourceActorQualified']is False and value['quietSha256']is value['financialResultSha256']is value['quietProof']is None,
                 'exact_recorded_precommit_deadline_authority_required')
        else:
            self.admitted(value['financialResultSha256'])
            need(pin(value['quietSha256'])and value['quietProof']['validated']is value['quietProof']['paidRequestsQuiet']is True and
                 value['quietProof']['sourceActorQualified']is False and value['deadlineSha256']is value['deadlineProof']is None,
                 'exact_recorded_quiet_financial_admission_chain_required')
            if phase=='close':expected=self.m.target_closed(row['before'],value['before'],plan,utc=value['before']['clockMs']>=plan['nextUtcMs'])
            else:expected=self.m.target_utc(value['before'],self.close_result()['after'],plan)
        need({k:v for k,v in value['after'].items()if k!='clockMs'}=={k:v for k,v in expected.items()if k!='clockMs'}and
             value['after']['clockMs']>=value['before']['clockMs'],
             'exact_owned_transaction_before_after_catalog_and_counter_proof_required')
        return value
    def rehearsed(self):
        row=self.prepared();value=self.get('admission-rehearsed.json')
        need(value['format']==FORMAT and value['preparedSha256']==self.digest('prepared.json')and value['phase']=='admit'and
             value['rolledBack']is True and value['databaseCommitted']is value['countersReset']is False and
             isinstance(value['transactionXid'],str)and re.fullmatch('[1-9][0-9]{0,19}',value['transactionXid']),
             'actual_successful_admission_ROLLBACK_rehearsal_required')
        self.validate_admission_before(value['before'],row)
        expected=self.m.expected_admitted(value['before'],row['plan'])
        need({k:v for k,v in value['after'].items()if k!='clockMs'}=={k:v for k,v in expected.items()if k!='clockMs'},
             'exact_rehearsed_four_permit_two_policy_delta_required')
        return value
    def receipt(self,name,phase):
        value=self.get(name);row=self.prepared();plan=row['plan'];intent_name=('admission'if phase=='admit'else phase)+'-commit-intent.json'
        intent=self.intent(intent_name)
        need(value['format']==FORMAT and value['phase']==phase and value['committed']is True and
             value['operatorSha256']==self.producer()and value['modelSha256']==MODEL_SHA and value['bootId']==self.s.boot()and
             value['preparedSha256']==self.digest('prepared.json')and value['intentSha256']==self.digest(intent_name)and
             value['transactionXid']==intent['xid']and value['before']==intent['before']and value['planSha256']==row['planSha256']and
             value['sourcesSha256']==self.h.sources_sha and value['rangeInputSha256']==self.h.range_sha and
             value['profileId']==self.m.PROFILE and value['permits']==plan['permits']and value['startMs']==plan['startMs']and value['expiresMs']==plan['expiresMs']and
             value['originalAllowanceCu']==str(self.m.ALLOWANCE)and value['normalDaily10MApproved']is value['grantCountersReset']is value['oldPermitsChanged']is
             value['sourceActorQualified']is value['proxyLifecycleQualified']is value['currentPaidAuthorityQualified']is False and
             value['providerCalls']==value['serviceActions']==0 and type(value['reconciledAfterUnknownACK'])is bool,
             'actual_immutable_own_financial_receipt_chain_required')
        if phase=='admit':self.m.validate_current(row['before'],value['after'],plan,False)
        else:self.m.validate_closed(value['after'],intent['after'],plan)
        monotonic(self.m,intent['after'],value['after'])
        return value
    def admitted(self,result_sha):
        need(pin(result_sha)and self.digest('result.json')==result_sha,'exact_actual_financial_admission_receipt_hash_required')
        return self.receipt('result.json','admit')
    def validate_admission_before(self,current,row):
        plan=row['plan'];self.m.baseline(current,self.h.profile)
        need(self.m.static(current)==self.m.static(row['before'])and self.m.source_booked(current)==self.m.source_booked(row['before'])and
             self.m.source_booked(current,plan['grantDay'])==self.m.source_booked(row['before'],plan['grantDay'])and
             plan['startMs']<=current['clockMs']<=min(plan['startMs']+900000,plan['expiresMs']-90000),
             'fresh_exact_financial_policy_source_bookings_and_same_day_window_required')
        self.m.range_plan(self.h.ranges,current['clockMs'],self.h.profile)
    def transaction(self,phase,commit=False,deadline_sha=None,quiet_sha=None,result_sha=None):
        row=self.prepared();plan=row['plan'];label=('admission'if phase=='admit'else phase)+('-commit'if commit else'-rehearsal')
        need(not(BASE/(label+'-attempt.json')).exists(),'one_SQL_attempt_only_unknown_outcome_requires_readonly_reconcile')
        deadline=self.h.deadline(row['planSha256'],deadline_sha)if phase=='admit'and(commit or deadline_sha is not None)else None
        quiet=self.h.quiet(quiet_sha,result_sha)if phase in{'close','utc'}else None
        if phase in{'close','utc'}:
            acknowledged=acknowledgement(result_sha);need(acknowledged['planSha256']==row['planSha256'],'only_own_actual_admitted_financial_result_may_close')
        if commit and phase=='admit':
            self.rehearsed()
        self.put(label+'-attempt.json',{'format':FORMAT,'preparedSha256':self.digest('prepared.json'),'phase':phase,'commitRequested':commit,'automaticRetryAllowed':False})
        client=Client()
        try:
            client.send("BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL statement_timeout='15000ms';SET LOCAL lock_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms';SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));LOCK TABLE "+','.join('yunipals_market.'+name for name in self.m.TABLES)+" IN SHARE ROW EXCLUSIVE MODE;\n")
            packet=client.observe(self.m);client_kernel=client.kernel_identity();before=packet['snapshot']
            if phase=='admit':self.validate_admission_before(before,row);expected=self.m.expected_admitted(before,plan)
            elif phase=='close':
                self.m.validate_current(row['before'],before,plan,False);expected=self.m.target_closed(row['before'],before,plan,utc=before['clockMs']>=plan['nextUtcMs'])
            elif phase=='utc':
                closed=self.close_result();expected=self.m.target_utc(before,closed['after'],plan)
            else:raise RuntimeError('fixed_financial_phase_required')
            text=self.m.writes(plan,phase,before);client.send(text+'\n');after_packet=client.observe(self.m);after=after_packet['snapshot']
            need({k:v for k,v in after.items()if k!='clockMs'}=={k:v for k,v in expected.items()if k!='clockMs'}and packet['xid']==after_packet['xid'],
                 'only_four_permits_and_exact_two_policy_values_may_change_all_counters_preserved')
            if not commit:
                client.finish(False)
                current=self.h.snapshot();need(self.m.static(current)==self.m.static(before)and self.m.source_booked(current)==self.m.source_booked(before),
                                             'actual_financial_rehearsal_must_ROLLBACK')
                value={'format':FORMAT,'preparedSha256':self.digest('prepared.json'),'phase':phase,'before':before,'after':after,
                    'rolledBack':True,'transactionXid':packet['xid'],'databaseCommitted':False,'countersReset':False}
                self.put(('admission'if phase=='admit'else phase)+'-rehearsed.json',value);return {'rehearsed':True,'rolledBack':True,'phase':phase,'countersReset':False}
            intent={'format':FORMAT+'-intent','operatorSha256':self.producer(),'modelSha256':MODEL_SHA,'bootId':self.s.boot(),
                'preparedSha256':self.digest('prepared.json'),'phase':phase,'xid':packet['xid'],'backendPid':packet['backendPid'],
                'backendStart':packet['backendStart'],'clientProcess':client_kernel,'before':before,'after':after,'sqlSha256':sha(text.encode()),'deadlineSha256':deadline_sha,
                'quietSha256':quiet_sha,'financialResultSha256':result_sha,'deadlineProof':deadline,'quietProof':quiet,'automaticRetryAllowed':False}
            self.put(label+'-intent.json',intent)
            # The exact same protected receipt is revalidated. Its actual actor/
            # definition binding belongs to that producer; optional observations
            # may advance and are not falsely asserted byte-identical here.
            if phase=='admit':self.h.deadline(row['planSha256'],deadline_sha)
            else:self.h.quiet(quiet_sha,result_sha)
            self.h.unchanged_sources();need(self.producer()==row['operatorSha256'],'same_financial_operator_immediately_before_sole_COMMIT')
            client.finish(True)
        finally:client.close()
        return self.acknowledge(label+'-intent.json',phase)
    def xid_status(self,xid):
        need(isinstance(xid,str)and re.fullmatch('[1-9][0-9]{0,19}',xid),'literal_actual_64bit_transaction_identity_required')
        return self.h.query("SELECT jsonb_build_object('status',pg_xact_status('"+xid+"'::xid8))")['status']
    def acknowledge(self,intent_name,phase,reconciled=False):
        intent=self.intent(intent_name);row=self.prepared();plan=row['plan']
        need(intent['phase']==phase and self.xid_status(intent['xid'])=='committed','actual_committed_XID_required_never_resend_unknown_SQL')
        current=self.h.snapshot()
        if phase=='admit':self.m.validate_current(row['before'],current,plan,False)
        elif phase in{'close','utc'}:
            need(self.m.static(current)==self.m.static(intent['after']),'actual_closed_permits_and_owned_restored_policy_required')
            self.m.validate_closed(current,intent['after'],plan)
        else:raise RuntimeError('fixed_financial_phase_required')
        monotonic(self.m,intent['after'],current)
        value={'format':FORMAT,'operatorSha256':self.producer(),'modelSha256':MODEL_SHA,'bootId':self.s.boot(),'phase':phase,
            'preparedSha256':self.digest('prepared.json'),'planSha256':row['planSha256'],'intentSha256':self.digest(intent_name),'transactionXid':intent['xid'],
            'profileId':self.m.PROFILE,'permits':plan['permits'],'startMs':plan['startMs'],'expiresMs':plan['expiresMs'],'before':intent['before'],'after':current,
            'sourcesSha256':self.h.sources_sha,'rangeInputSha256':self.h.range_sha,'committed':True,'reconciledAfterUnknownACK':reconciled,
            'originalAllowanceCu':str(self.m.ALLOWANCE),'normalDaily10MApproved':False,'grantCountersReset':False,'oldPermitsChanged':False,
            'sourceActorQualified':False,'proxyLifecycleQualified':False,'providerCalls':0,'serviceActions':0}
        value['currentPaidAuthorityQualified']=False
        name='result.json'if phase=='admit'else phase+'-result.json'
        need(not(BASE/name).exists(),'no_existing_financial_ACK_may_be_overwritten');self.put(name,value)
        return {'format':FORMAT,'committed':True,'phase':phase,'resultSha256':self.digest(name),'planSha256':row['planSha256'],
            'profileId':self.m.PROFILE,'permits':plan['permits'],'expiresMs':plan['expiresMs'],'grantCountersReset':False,'providerCalls':0,'serviceActions':0}
    def close_result(self):
        return self.receipt('close-result.json','close')


def load_saved():
    s=primitives();row=s.document(BASE/'prepared.json');return Owner(Host(row['sourcesSha256'],row['rangeInputSha256']))


def acknowledgement(result_sha):
    owner=load_saved();row=owner.prepared();owner.admitted(result_sha)
    return {'format':FORMAT+'-acknowledgement','validated':True,'receiptSha256':result_sha,'planSha256':row['planSha256'],
        'profileId':owner.m.PROFILE,'permits':row['plan']['permits'],'expiresMs':row['plan']['expiresMs'],'currentFinancialQualified':False,
        'sourceActorQualified':False,'proxyLifecycleQualified':False,'providerCalls':0,'serviceActions':0}


def validate_current(result_sha):
    ack=acknowledgement(result_sha);owner=load_saved();row=owner.prepared()
    need(not any((BASE/name).exists()for name in['close-commit-attempt.json','close-commit-intent.json','utc-commit-attempt.json','utc-commit-intent.json']),
         'financial_closure_started_no_new_paid_effects_allowed')
    current=owner.h.snapshot();owner.m.validate_current(row['before'],current,row['plan'])
    monotonic(owner.m,owner.admitted(result_sha)['after'],current)
    intent=owner.intent('admission-commit-intent.json');owner.h.deadline(row['planSha256'],intent['deadlineSha256']);owner.h.unchanged_sources()
    return {**ack,'format':FORMAT+'-current','currentFinancialQualified':True,'currentPaidAuthorityQualified':True,'maximumAdditionalBookedCu':str(owner.m.ADDITIONAL),
        'sourceBookedAllDaysCu':str(owner.m.source_booked(current)),'remainingOriginalAllowanceCu':str(owner.m.ALLOWANCE-owner.m.source_booked(current)),
        'catalogSha256':owner.m.digest(owner.m.static(current)),'paidAuthorityLimitedToOwnedFourPermits':True}


def qualify_peer():
    """Independent low-level READ ONLY qualification, no future input needed."""
    s=primitives();model=s.module(MODEL,MODEL_SHA);profile=s.document(PROFILE,model.PROFILE_FILE_SHA)
    client=Client(True)
    try:
        client.send('BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;\n');snapshot=client.observe(model,False)['snapshot'];kernel=client.kernel_identity()
        client.send("SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only')='on','xidStatusAvailable',to_regprocedure('pg_xact_status(xid8)')IS NOT NULL);\n")
        need(client.packet()=={'readOnly':True,'xidStatusAvailable':True}and not os.path.lexists(SENTINEL),
             'actual_readonly_market_peer_and_XID_status_prerequisites_required')
        model.baseline(snapshot,profile);client.finish(False)
    finally:client.close()
    return {'format':FORMAT+'-peer-qualification','qualified':True,'originalPolicyAndProfileQualified':True,
        'baselineCatalogSha256':model.digest(model.static(snapshot)),'allDaysSourceBookedCu':str(model.source_booked(snapshot)),
        'maximumAdditionalBookedCu':str(model.ADDITIONAL),'transactionReadOnly':True,'xidStatusAvailable':True,
        'actualUID111GID113ZeroCapsNNPQualified':kernel['capabilitiesZero']and kernel['noNewPrivileges'],
        'databaseWrites':0,'providerCalls':0,'serviceActions':0,'financialApplied':False,'sourceActorQualified':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--sources-sha');parser.add_argument('--range-sha')
    group=parser.add_mutually_exclusive_group();group.add_argument('--prepare',action='store_true');group.add_argument('--rehearse',action='store_true')
    group.add_argument('--commit',action='store_true');group.add_argument('--reconcile');group.add_argument('--validate');group.add_argument('--acknowledgement')
    group.add_argument('--qualify-peer',action='store_true')
    group.add_argument('--close',action='store_true');group.add_argument('--utc',action='store_true')
    parser.add_argument('--deadline-sha');parser.add_argument('--quiet-sha');parser.add_argument('--financial-result-sha');parser.add_argument('--reconcile-phase',choices=['admit','close','utc'],default='admit')
    args_=parser.parse_args()
    if not any([args_.prepare,args_.rehearse,args_.commit,args_.reconcile,args_.validate,args_.acknowledgement,args_.close,args_.utc,args_.qualify_peer]):
        need(not any([args_.sources_sha,args_.range_sha,args_.deadline_sha,args_.quiet_sha,args_.financial_result_sha]),'runtime_arguments_require_explicit_phase')
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'originalCapCu':'20000000','maximumNewCu':'15000000','automaticRenewal':False,'normalDaily10MApproved':False,
            'providerCalls':0,'serviceActions':0,'databaseWrites':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_financial_host_required');os.umask(0o077)
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_financial_operator_expired'));signal.alarm(180)
    if args_.qualify_peer:result=qualify_peer()
    elif args_.acknowledgement:result=acknowledgement(args_.acknowledgement)
    elif args_.validate:result=validate_current(args_.validate)
    else:
        owner=Owner(Host(args_.sources_sha,args_.range_sha))if args_.prepare else load_saved()
        with financial_lock():
            if args_.prepare:result=owner.prepare()
            elif args_.rehearse:result=owner.transaction('admit',False,deadline_sha=args_.deadline_sha)
            elif args_.commit:result=owner.transaction('admit',True,deadline_sha=args_.deadline_sha)
            elif args_.close:result=owner.transaction('close',True,quiet_sha=args_.quiet_sha,result_sha=args_.financial_result_sha)
            elif args_.utc:result=owner.transaction('utc',True,quiet_sha=args_.quiet_sha,result_sha=args_.financial_result_sha)
            else:
                name=('admission'if args_.reconcile_phase=='admit'else args_.reconcile_phase)+'-commit-intent.json'
                need(pin(args_.reconcile),'exact_actual_intent_SHA_required');intent=owner.s.document(BASE/name,args_.reconcile)
                result=owner.acknowledge(name,intent['phase'],True)
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else type(error).__name__,
            'automaticRetryAllowed':False,'providerCalls':0,'serviceActions':0}));raise SystemExit(1)
