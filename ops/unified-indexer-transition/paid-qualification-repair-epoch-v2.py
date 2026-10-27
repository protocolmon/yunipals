#!/usr/bin/env python3
"""Separate repair epoch AFTER acknowledged failed Q1 cleanup.

Library only. Caller retains the frozen Q source+both chain locks. No SQL writes,
provider requests, Q-window changes or current false-proof relabelling.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re

FORMAT='yunipals-paid-qualification-repair-epoch-v2'
BASE=Path('/var/backups/yunipals-paid-qualification-repair-epoch-v2-20261021')
OVERRIDE='zzzzzzzzzzzzz-unified-source6-qualification-repair-v2-20261021.conf'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
MODEL_SHA='49d906c711b04a026a653ee6428f63f0a6c2ecd4385d60610dbf8f02774220fb'
CLEANUP_OBSERVER_SHA='c04ad0b91fed5881857e16db3cf21db25064461d8c5146d759573b9a82be2fa6'


def fail(message):raise RuntimeError(message)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def now():return datetime.now(timezone.utc)


def timer_proof(session,model,plan,run_id,path,expected):
    """Actual typed systemd armed-timer proof, never a caller boolean."""
    q=session;receipt=q.c.pinned_json(Path(path),expected,150000)
    if (Path(path)!=OPS/('paid-qualification-repair-v2-'+run_id+'.timers.json') or set(receipt)!= {'format','repairPlanSha256','runId','executorSha256','timers'} or
        receipt['format']!='yunipals-paid-qualification-repair-timers-v2' or receipt['repairPlanSha256']!=model.digest(plan) or receipt['runId']!=run_id or
        sha(q.c.trusted(OPS/'paid-qualification-repair-live-v2.py',150000))!=receipt['executorSha256']):fail('actual_repair_timer_receipt_required')
    if not isinstance(receipt['timers'],list) or len(receipt['timers'])!=2:fail('two_owned_repair_timers_required')
    for kind,due in [('deadline',plan['qualificationExpiresAt']),('utc',plan['nextUtc'])]:
        rows=[r for r in receipt['timers']if r.get('kind')==kind]
        if len(rows)!=1:fail('both_repair_timer_kinds_required')
        r=rows[0];prefix='yunipals-paid-qualification-repair-v2-'+kind+'-'+model.digest(plan)[:16]
        if r.get('timerUnit')!=prefix+'.timer' or r.get('serviceUnit')!=prefix+'.service' or r.get('dueUtc')!=due or set(r.get('definitions',{}))!={str(q.v.SYSTEMD/(prefix+'.timer')),str(q.v.SYSTEMD/(prefix+'.service'))}:fail('exact_repair_timer_selectors_required')
        if any(sha(q.c.trusted(Path(p),50000))!=h for p,h in r['definitions'].items()):fail('repair_timer_definition_drift')
        props=dict(line.split('=',1)for line in q.v.run(['/usr/bin/systemctl','show','--all',r['timerUnit'],'--property=Id','--property=LoadState','--property=ActiveState','--property=SubState'],timeout=4).splitlines())
        if props!={'Id':r['timerUnit'],'LoadState':'loaded','ActiveState':'active','SubState':'waiting'}:fail('repair_timer_not_armed')
        from_epoch=q.model.moment(due);delta=from_epoch-datetime(1970,1,1,tzinfo=timezone.utc)
        stamp=(delta.days*86400+delta.seconds)*1000000+delta.microseconds
        # Frozen epoch helper owns the typed D-Bus parser, called independently.
        # The session's actual module is supplied by the frozen loader, not
        # guessed by name. Bound methods expose its globals without mutation.
        bus_property=q.check_proxy.__func__.__globals__['bus_property']
        if bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','NextElapseUSecRealtime','t')!=stamp or bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','Unit','s')!=r['serviceUnit'] or bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','RandomizedDelayUSec','t')!=0:fail('actual_repair_timer_deadline_drift')
        accuracy=bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','AccuracyUSec','t')
        if type(accuracy)is not int or not 0<accuracy<=1000000:fail('repair_timer_accuracy_drift')
        service=dict(line.split('=',1)for line in q.v.run(['/usr/bin/systemctl','show','--all',r['serviceUnit'],'--property=Id','--property=Type','--property=Restart','--property=ActiveState','--property=ExecStart','--property=User','--property=Group','--property=NoNewPrivileges','--property=WorkingDirectory','--property=AmbientCapabilities','--property=CapabilityBoundingSet','--property=DropInPaths'],timeout=4).splitlines())
        argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-repair-live-v2.py')+' --run-id '+run_id+' --plan-sha256 '+model.digest(plan)+' --phase '+kind
        if service.get('Id')!=r['serviceUnit'] or service.get('Type')!='exec' or service.get('Restart')!='no' or service.get('ActiveState')!='inactive' or service.get('User')not in {'','root'}or service.get('Group')not in {'','root'}or service.get('NoNewPrivileges')!='yes'or service.get('WorkingDirectory')!=str(OPS)or set(service.get('AmbientCapabilities','').split())!={'cap_setuid','cap_setgid','cap_kill'}or set(service.get('CapabilityBoundingSet','').split())!={'cap_setuid','cap_setgid','cap_kill'}or re.findall(r'argv\[\]=(.*?)\s+;',service.get('ExecStart',''))!=[argv]:fail('exact_inactive_repair_executor_required')
        if bus_property(r['serviceUnit'],'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[] or bus_property(r['serviceUnit'],'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=900000000:fail('exact_bounded_no_dropin_repair_executor_required')
    return receipt


class Epoch:
    def __init__(self,q,model,plan,run_id,*,timer_file,timer_sha,record_callback):
        q.held();model.validate_plan(plan)
        if (model.raw_digest(Path(model.__file__).read_bytes())!=MODEL_SHA or not re.fullmatch('20261021-[a-z0-9-]{1,30}',run_id) or
            not q.record or q.record.get('cleaned')is not True or q.plan['admission']!=plan['origin'] or not callable(record_callback)):
            fail('exact_repair_model_and_acknowledged_cleaned_Q_record_required')
        self.q,self.model,self.plan,self.run_id=q,model,deepcopy(plan),run_id
        self.timer_file,self.timer_sha,self.callback=timer_file,timer_sha,record_callback
        self.plan_sha=model.digest(plan);self.operator_sha=sha(q.c.trusted(Path(__file__).absolute(),150000));self.record=None;self.directory=None

    def held(self):
        self.q.held()
        if self.model.digest(self.plan)!=self.plan_sha:fail('repair_plan_mutated')
        if sha(self.q.c.trusted(Path(__file__).absolute(),150000))!=self.operator_sha:fail('loaded_repair_epoch_operator_changed')

    def timers(self):return timer_proof(self.q,self.model,self.plan,self.run_id,self.timer_file,self.timer_sha)

    def window(self):
        self.held()
        if not self.model.model().moment(self.plan['phaseStart'])<=now()<self.model.model().moment(self.plan['qualificationExpiresAt']):fail('original_repair_dispatch_window_closed')

    def quiet(self):
        self.held()
        value=self.q.quiet()
        if value!=self.q.record['review']['sourcePeer']:fail('original_restricted_source_peer_changed')
        return value

    def sync_inputs(self,row):
        for parent in {Path(row[k]).parent for k in ['overridePath','publicEnvironmentPath']}:
            fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)

    def publish(self,label):
        path=self.directory/(label+'.json');raw=encoded({'format':FORMAT,'state':self.record})
        self.q.v.save_new(path,raw);self.callback(str(path),sha(raw))
        return {'recordFile':str(path),'recordSha256':sha(raw)}

    def peers(self):
        """No Q quiet/source-session-zero check while the owned native runs."""
        self.held();q=self.q;g=q.check_proxy.__func__.__globals__;observe=g['observed'];local=g['local_state']
        for name,expected in q.record['review']['otherProxies'].items():
            p=observe(q.v,'yunipals-market-production-rpc@'+name+'.service');q.v.verify_exec_start(p,q.n.ROOT)
            value={'invocation':p['InvocationID'],'definitions':q.v.definitions(p),'privateSettings':q.v.private_settings(p),'environmentFileHashes':q.c.environment_hashes(q.v,p)}
            if value!=expected:fail('unowned_repair_peer_proxy_changed')
            local(q.free,q.n,q.c,q.v,name,paid=False,zero=True)

    def cleanup_observer(self):
        self.held()
        return self.q.c.load(OPS/'paid-cleanup-observer-v1.py',CLEANUP_OBSERVER_SHA,'repair_cleanup_observer')

    def cleanup_health(self,name,*,paid,zero):
        """Read-only cleanup proof; never asks an expired gate to admit work."""
        self.held();record=self.record if self.record is not None else self.q.record
        row=record['review']['proxies'][name];owned=record['chains'].get(name,{})
        current=owned.get('afterInvocationId')if paid else owned.get('restoredFalseInvocationId')or row['beforeInvocationId']
        if not isinstance(current,str)or not re.fullmatch('[0-9a-f]{32}',current):fail('exact_cleanup_proxy_invocation_required')
        self.q.check_proxy(name,row,paid=paid,expected_invocation=current)
        value=self.cleanup_observer().observe(self.q,name,paid=paid,zero=zero,expected_configuration=row['legacyConfiguration'],expected_invocation=current)
        if (value.get('cleanupOnly')is not True or value.get('dispatchAuthorized')is not False or
            value.get('historicalProfileIdentityVerified')is not True or value.get('profileAvailability')not in {'historical_only','expired'}):
            fail('explicit_historical_cleanup_only_proof_required')
        self.q.check_proxy(name,row,paid=paid,expected_invocation=current)
        return value

    def cleanup_peers(self):
        self.held();observer=self.cleanup_observer()
        for name,expected in self.q.record['review']['otherProxies'].items():observer.peer(self.q,name,expected)

    def cleanup_parent_cleaned(self):
        """Exact original Q1 false IDs, with no live-profile readiness claim."""
        self.held();self.quiet();self.cleanup_peers();q=self.q;r=q.record
        if r.get('cleaned')is not True or set(r.get('chains',{}))!={'base','bnb'}:fail('acknowledged_original_Q1_cleanup_required')
        raw=q.c.trusted(q.directory/'cleaned-record.json',2000000)
        if json.loads(raw)!={'format':q.check_proxy.__func__.__globals__['FORMAT'],'ownedState':r}:fail('original_Q1_cleaned_record_changed')
        restored={}
        for name in ['base','bnb']:
            row=r['review']['proxies'][name];owned=r['chains'][name]
            current=owned.get('restoredFalseInvocationId')if owned.get('filesCreated')else row['beforeInvocationId']
            if not isinstance(current,str)or not re.fullmatch('[0-9a-f]{32}',current):fail('exact_original_Q1_false_invocation_required')
            q.check_proxy(name,row,paid=False,expected_invocation=current)
            health=self.cleanup_health(name,paid=False,zero=True)
            if health['configuration']!=row['legacyConfiguration']or any(os.path.lexists(row[k])for k in ['overridePath','publicEnvironmentPath']):fail('original_Q1_false_configuration_or_files_changed')
            restored[name]=current
        return {'cleanupOnly':True,'dispatchAuthorized':False,'restoredFalseInvocations':restored,'originalQ1RecordUnchanged':True}

    def review(self):
        self.window();self.quiet();self.q.restored_state();self.peers();timers=self.timers();rows={}
        query=self.q.check_proxy.__func__.__globals__['query']
        if query("SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()",market=True)!=0:fail('no_active_paid_authority_before_repair_epoch')
        q=self.q;observe=q.check_proxy.__func__.__globals__['observed']
        for name in ['base','bnb']:
            row=deepcopy(q.record['review']['proxies'][name]);current=q.record['chains'][name]['restoredFalseInvocationId']
            q.check_proxy(name,row,paid=False,expected_invocation=current)
            row.update(beforeInvocationId=current)
            row['overridePath']=str(q.v.SYSTEMD/(row['false']['unit']+'.d')/OVERRIDE)
            row['publicEnvironmentPath']=str(OPS/('source6-paid-qualification-repair-v2-'+self.run_id+'-'+name+'.env'))
            row['publicEnvironmentSha256']=sha(b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=true\n')
            row['overrideSha256']=sha(('[Service]\nEnvironmentFile='+row['publicEnvironmentPath']+'\n').encode())
            if any(os.path.lexists(row[k])for k in ['overridePath','publicEnvironmentPath']) or any(Path(p).name>=OVERRIDE for p in list(row['definitions'])[1:]):fail('fresh_final13z_required')
            rows[name]=row
        return {'format':FORMAT,'plan':self.plan,'runId':self.run_id,'timerReceiptSha256':self.timer_sha,'qCleanedReviewHash':q.record['reviewHash'],'proxies':rows,'operatorSha256':sha(Path(__file__).read_bytes())}

    def enable(self,expected):
        if self.record is not None:fail('repair_epoch_already_attempted')
        review=self.review();marker=sha(encoded(review))
        if marker!=expected:fail('exact_fresh_repair_epoch_review_required')
        # Same protected ancestry rules as the frozen epoch evidence root.
        for p in [BASE,BASE/self.run_id]:
            p.mkdir(mode=0o700,exist_ok=True);s=p.lstat()
            if s.st_uid!=0 or s.st_mode&0o077 or p.is_symlink():fail('private_repair_evidence_root_required')
        self.directory=BASE/self.run_id/marker;self.directory.mkdir(mode=0o700)
        self.q.v.save_new(self.directory/'review.json',encoded(review))
        self.record={'review':review,'reviewHash':marker,'chains':{},'enabled':False,'cleaned':False};self.publish('prepared')
        for name,row in review['proxies'].items():
            self.window();self.timers();self.peers();self.quiet()
            for earlier,owned in self.record['chains'].items():
                if owned.get('afterInvocationId'):self.q.check_proxy(earlier,review['proxies'][earlier],paid=True,expected_invocation=owned['afterInvocationId'])
            self.q.check_proxy(name,row,paid=False,expected_invocation=row['beforeInvocationId'])
            owned={'publicCreated':False,'filesCreated':False,'afterInvocationId':None,'filesRemoved':False,'restoredFalseInvocationId':None};self.record['chains'][name]=owned
            self.q.v.save_new(Path(row['publicEnvironmentPath']),b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=true\n',0o644);owned['publicCreated']=True;self.sync_inputs(row);self.publish(name+'-public')
            self.q.v.save_new(Path(row['overridePath']),('[Service]\nEnvironmentFile='+row['publicEnvironmentPath']+'\n').encode(),0o644);owned['filesCreated']=True;self.sync_inputs(row);self.publish(name+'-selected')
            self.q.v.run(['/usr/bin/systemctl','daemon-reload']);self.q.v.run(['/usr/bin/systemctl','restart',row['false']['unit']],timeout=150)
            current=self.q.check_proxy.__func__.__globals__['observed'](self.q.v,row['false']['unit'])['InvocationID']
            if current==row['beforeInvocationId']:fail('fresh_repair_true_invocation_required')
            owned['afterInvocationId']=current;self.publish(name+'-restarted')
            self.q.check_proxy(name,row,paid=True,expected_invocation=current)
            self.q.v.retry(lambda:self.health(name,paid=True,zero=True))
        self.record['enabled']=True;result=self.validate_current(zero=True);return {**result,**self.publish('enabled')}

    def health(self,name,*,paid,zero):
        return self.q.check_proxy.__func__.__globals__['local_state'](self.q.free,self.q.n,self.q.c,self.q.v,name,paid=paid,zero=zero)

    def validate_current(self,*,zero=False):
        self.window();self.quiet();self.peers();self.timers()
        if not self.record or not self.record['enabled'] or self.record['cleaned']:fail('acknowledged_repair_epoch_required')
        values={}
        for name,row in self.record['review']['proxies'].items():
            current=self.record['chains'][name]['afterInvocationId'];self.q.check_proxy(name,row,paid=True,expected_invocation=current)
            h=self.health(name,paid=True,zero=zero)
            if h['configuration']!=row['legacyConfiguration']:fail('repair_legacy_configuration_changed')
            values[name]={'invocation':current,**h}
        return {'format':FORMAT,'reviewHash':self.record['reviewHash'],'proxies':values,'originalExpiry':self.plan['expires'],'qualificationExpiresAt':self.plan['qualificationExpiresAt']}

    def restore_record(self,path,expected):
        self.held();path=Path(path)
        if self.record is not None or path.parent.parent!=BASE/self.run_id:fail('exact_repair_ack_record_required')
        payload=self.q.c.pinned_json(path,expected,2000000);r=payload.get('state')
        if payload.get('format')!=FORMAT or not isinstance(r,dict) or set(r)!={'review','reviewHash','chains','enabled','cleaned'} or r['reviewHash']!=path.parent.name or sha(encoded(r['review']))!=r['reviewHash'] or r['review'].get('plan')!=self.plan or r['review'].get('runId')!=self.run_id or r['review'].get('operatorSha256')!=sha(Path(__file__).read_bytes()) or self.q.c.pinned_json(path.parent/'review.json',r['reviewHash'],2000000)!=r['review']:fail('retained_repair_plan_helper_record_changed')
        for name,owned in r['chains'].items():
            if name not in {'base','bnb'} or set(owned)!={'publicCreated','filesCreated','afterInvocationId','filesRemoved','restoredFalseInvocationId'} or any(type(owned[k])is not bool for k in ['publicCreated','filesCreated','filesRemoved']) or any(owned[k]is not None and not re.fullmatch('[0-9a-f]{32}',owned[k])for k in ['afterInvocationId','restoredFalseInvocationId']):fail('exact_repair_ack_phase_required')
        self.record,self.directory=r,path.parent

    def verify_cleaned(self):
        """Initial next-epoch handoff only; never adopt later proxy IDs."""
        self.held();self.peers();self.quiet()
        if not self.record or self.record.get('cleaned')is not True or set(self.record['chains'])!={'base','bnb'}:fail('both_acknowledged_cleaned_repair_chains_required')
        raw=self.q.c.trusted(self.directory/'cleaned.json',2000000)
        if json.loads(raw)!={'format':FORMAT,'state':self.record}:fail('protected_cleaned_repair_record_changed')
        ids={}
        for name,owned in self.record['chains'].items():
            invocation=owned['restoredFalseInvocationId'];row=self.record['review']['proxies'][name]
            if not invocation or not owned['filesRemoved'] or any(os.path.lexists(row[k])for k in ['overridePath','publicEnvironmentPath']):fail('owned_repair_true_authority_not_cleaned')
            self.q.check_proxy(name,row,paid=False,expected_invocation=invocation);self.health(name,paid=False,zero=True);ids[name]=invocation
        query=self.q.check_proxy.__func__.__globals__['query']
        if query("SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()",market=True)!=0:fail('active_paid_authority_prevents_repair_handoff')
        return {'format':FORMAT,'cleaned':True,'restoredFalseInvocations':ids,'recordFile':str(self.directory/'cleaned.json'),'recordSha256':sha(raw),'newInvocationAdopted':False}

    def cleanup(self,revocation):
        self.held();self.cleanup_peers();self.quiet()
        if not self.record:fail('retained_repair_record_required')
        if not isinstance(revocation,dict) or set(revocation)!={'format','repairPlanSha256','transactionOutcome','permitIds'} or revocation['format']!='yunipals-paid-qualification-repair-revocation-v1' or revocation['repairPlanSha256']!=self.plan_sha or revocation['transactionOutcome']not in {'commit_confirmed','not_admitted_confirmed'} or revocation['permitIds']!=[r['permitId']for r in self.model.qualification_permits(self.plan)]:fail('actual_owned_repair_revocation_receipt_required')
        # Caller also supplies an ACK, but independently read actual disabled
        # exact rows before deleting any runtime authority.
        ids=','.join(self.model.literal(r['permitId'])for r in self.model.qualification_permits(self.plan))
        value=self.q.check_proxy.__func__.__globals__['query']("SELECT jsonb_build_object('active',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit WHERE enabled AND expires_at>clock_timestamp()),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'enabled',enabled,'chainId',chain_id,'maximumCu',maximum_cu::text,'fromBlock',from_block::text,'throughBlock',through_block::text,'expires',expires_at,'profileId',profile_id))FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN("+ids+")),'[]'::jsonb))",market=True)
        if value.get('active')!=0 or not isinstance(value.get('rows'),list)or len(value['rows'])!=(2 if revocation['transactionOutcome']=='commit_confirmed' else 0):fail('actual_repair_revocation_not_observed')
        for row in self.model.qualification_permits(self.plan) if revocation['transactionOutcome']=='commit_confirmed' else []:
            a=next((x for x in value['rows']if x.get('permitId')==row['permitId']),{})
            if a.get('enabled')is not False or a.get('profileId')!=self.q.model.PROFILE or any(a.get(k)!=v for k,v in row.items()if k!='expires') or self.q.model.moment(a.get('expires','').replace('+00:00','Z'))!=self.q.model.moment(row['expires']):fail('actual_owned_repair_permit_changed')
        restored={}
        for name,owned in self.record['chains'].items():
            row=self.record['review']['proxies'][name]
            if owned['restoredFalseInvocationId']:
                self.q.check_proxy(name,row,paid=False,expected_invocation=owned['restoredFalseInvocationId']);self.cleanup_health(name,paid=False,zero=True);restored[name]=owned['restoredFalseInvocationId'];continue
            if owned['filesRemoved']:fail('unacknowledged_repair_false_restart_manual_reconcile')
            if owned['filesCreated']:
                if not owned['afterInvocationId']:fail('unacknowledged_repair_true_restart_manual_reconcile')
                self.q.check_proxy(name,row,paid=True,expected_invocation=owned['afterInvocationId'])
                Path(row['overridePath']).unlink();Path(row['publicEnvironmentPath']).unlink();owned['filesRemoved']=True;self.sync_inputs(row);self.publish(name+'-removed')
                self.q.v.run(['/usr/bin/systemctl','daemon-reload']);self.q.v.run(['/usr/bin/systemctl','restart',row['false']['unit']],timeout=150)
                current=self.q.check_proxy.__func__.__globals__['observed'](self.q.v,row['false']['unit'])['InvocationID']
                if current in {owned['afterInvocationId'],row['beforeInvocationId']}:fail('fresh_false_process_required_to_destroy_caches')
                owned['restoredFalseInvocationId']=current;self.publish(name+'-false-restarted');self.q.check_proxy(name,row,paid=False,expected_invocation=current);self.q.v.retry(lambda:self.cleanup_health(name,paid=False,zero=True));restored[name]=current
            elif owned['publicCreated']:
                self.q.check_proxy(name,row,paid=False,expected_invocation=row['beforeInvocationId'])
                if sha(self.q.c.trusted(Path(row['publicEnvironmentPath']),2000))!=row['publicEnvironmentSha256']:fail('unselected_repair_file_drift')
                Path(row['publicEnvironmentPath']).unlink();owned['publicCreated']=False;self.sync_inputs(row);self.publish(name+'-unselected-removed')
        if any(os.path.lexists(row[k])for row in self.record['review']['proxies'].values()for k in ['overridePath','publicEnvironmentPath']):fail('repair_true_files_remain')
        if self.record['cleaned']:
            path=self.directory/'cleaned.json';raw=self.q.c.trusted(path,2000000)
            if json.loads(raw)!={'format':FORMAT,'state':self.record}:fail('cleaned_ACK_record_changed')
            pin={'recordFile':str(path),'recordSha256':sha(raw)}
        else:
            self.record['cleaned']=True;pin=self.publish('cleaned')
        return {'format':FORMAT,'cleaned':True,'restoredFalseInvocations':restored,'ownedRepairCachesDestroyed':True,'original12zAndFalseFilesRetained':True,'grantCountersReset':False,**pin}


def prepare(q_session,repair_plan,run_id,*,timer_file,timer_sha,record_callback):
    path=Path(__file__).with_name('paid-qualification-repair-plan-v2.py');raw=q_session.c.trusted(path,100000)
    if sha(raw)!=MODEL_SHA:fail('frozen_repair_model_changed')
    import types
    model=types.ModuleType('repair_epoch_model');model.__file__=str(path);exec(compile(raw,str(path),'exec'),model.__dict__)
    return Epoch(q_session,model,repair_plan,run_id,timer_file=timer_file,timer_sha=timer_sha,record_callback=record_callback)
