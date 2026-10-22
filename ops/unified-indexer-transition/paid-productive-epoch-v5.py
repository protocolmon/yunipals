#!/usr/bin/env python3
"""Owned15z continuation after acknowledged failed-prod1 cache cleanup.

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

FORMAT='yunipals-paid-productive-epoch-v5'
BASE=Path('/var/backups/yunipals-paid-productive-epoch-v5-20261021')
OVERRIDE='zzzzzzzzzzzzzzz-unified-source6-paid-productive-v5-20261021.conf'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
MODEL_SHA='872f05a70c790f088dbbca6f2d7280cd8f527c038b3e72c8acfe64539a5b6c25'
REPAIR_EPOCH_SHA='9b0542243af98a0351697789d7da17ee57801d13b33fb2be55e2b025269e5fd6'
OBSERVER_SHA='c04ad0b91fed5881857e16db3cf21db25064461d8c5146d759573b9a82be2fa6'
PARENT_BASE=Path('/var/backups/yunipals-paid-productive-live-v4-20261021/20261021-prod1')
PARENT_EPOCH_BASE=Path('/var/backups/yunipals-paid-productive-epoch-v4-20261021/20261021-prod1')
PARENT_LIVE_SHA='17b0d6bf37422687df5ac7501918e117f7137cf83cc06103a0448e387f093365'
PARENT_JOURNAL_SHA='9eb877f2b34a649a2d3d7aecd564ae5f9a66d3e08c96c25d6451630c721a6ca5'
PARENT_RECORD_SHA='cdfb534e395b37cbf7bc7194229d5ec54f54ebbaaa28c66ac23f75756efa01be'
LIVE_BASE=Path('/var/backups/yunipals-paid-productive-live-v5-20261021')
EXECUTOR_REFERENCES_SHA='e08f0ac0d2a275e51a8dba743b5c5825b1440ae0e41073aa18cdacff8f9ef6a4'


def fail(message):raise RuntimeError(message)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def now():return datetime.now(timezone.utc)


def timer_proof(session,model,plan,run_id,path,expected):
    """Actual typed systemd armed-timer proof, never a caller boolean."""
    q=session;receipt=q.c.pinned_json(Path(path),expected,150000)
    if (Path(path)!=OPS/('paid-productive-v5-'+run_id+'.timers.json') or set(receipt)!= {'format','productivePlanSha256','runId','executorSha256','timers'} or
        receipt['format']!='yunipals-paid-productive-timers-v5' or receipt['productivePlanSha256']!=model.digest(plan) or receipt['runId']!=run_id or
        sha(q.c.trusted(OPS/'paid-productive-live-v5.py',150000))!=receipt['executorSha256']):fail('actual_productive_timer_receipt_required')
    if not isinstance(receipt['timers'],list) or len(receipt['timers'])!=2:fail('two_owned_productive_timers_required')
    from types import SimpleNamespace
    refs=q.c.load(OPS/'paid-executor-references-v1.py',EXECUTOR_REFERENCES_SHA,'productive_current_executor_references')
    loader=SimpleNamespace(load=q.c.load,sha=sha,encoded=encoded,protected=q.c.trusted,run=q.v.run)
    # One persistent bus holds BOTH exact inactive executor services through
    # every CLI and typed-property reader below; no jobs/signals are issued.
    with refs.references(loader,model.digest(plan),receipt['timers'],family='productive_v5'):
        for kind,due in [('deadline',plan['dispatchExpires']),('utc',plan['nextUtc'])]:
            rows=[r for r in receipt['timers']if r.get('kind')==kind]
            if len(rows)!=1:fail('both_productive_timer_kinds_required')
            r=rows[0];prefix='yunipals-paid-productive-v5-'+kind+'-'+model.digest(plan)[:16]
            if r.get('timerUnit')!=prefix+'.timer' or r.get('serviceUnit')!=prefix+'.service' or r.get('dueUtc')!=due or set(r.get('definitions',{}))!={str(q.v.SYSTEMD/(prefix+'.timer')),str(q.v.SYSTEMD/(prefix+'.service'))}:fail('exact_productive_timer_selectors_required')
            if any(sha(q.c.trusted(Path(p),50000))!=h for p,h in r['definitions'].items()):fail('productive_timer_definition_drift')
            props=dict(line.split('=',1)for line in q.v.run(['/usr/bin/systemctl','show','--all',r['timerUnit'],'--property=Id','--property=LoadState','--property=ActiveState','--property=SubState'],timeout=4).splitlines())
            if props!={'Id':r['timerUnit'],'LoadState':'loaded','ActiveState':'active','SubState':'waiting'}:fail('productive_timer_not_armed')
            from_epoch=q.model.moment(due);delta=from_epoch-datetime(1970,1,1,tzinfo=timezone.utc)
            stamp=(delta.days*86400+delta.seconds)*1000000+delta.microseconds
            # Frozen epoch helper owns the typed D-Bus parser, called independently.
            # The session's actual module is supplied by the frozen loader, not
            # guessed by name. Bound methods expose its globals without mutation.
            bus_property=q.check_proxy.__func__.__globals__['bus_property']
            if bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','NextElapseUSecRealtime','t')!=stamp or bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','Unit','s')!=r['serviceUnit'] or bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','RandomizedDelayUSec','t')!=0:fail('actual_productive_timer_deadline_drift')
            accuracy=bus_property(r['timerUnit'],'org.freedesktop.systemd1.Timer','AccuracyUSec','t')
            if type(accuracy)is not int or not 0<accuracy<=1000000:fail('productive_timer_accuracy_drift')
            service=dict(line.split('=',1)for line in q.v.run(['/usr/bin/systemctl','show','--all',r['serviceUnit'],'--property=Id','--property=Type','--property=Restart','--property=ActiveState','--property=ExecStart','--property=User','--property=Group','--property=NoNewPrivileges','--property=WorkingDirectory','--property=AmbientCapabilities','--property=CapabilityBoundingSet','--property=DropInPaths'],timeout=4).splitlines())
            argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v5.py')+' --run-id '+run_id+' --plan-sha256 '+model.digest(plan)+' --phase '+kind
            if service.get('Id')!=r['serviceUnit'] or service.get('Type')!='exec' or service.get('Restart')!='no' or service.get('ActiveState')!='inactive' or service.get('User')not in {'','root'}or service.get('Group')not in {'','root'}or service.get('NoNewPrivileges')!='yes'or service.get('WorkingDirectory')!=str(OPS)or set(service.get('AmbientCapabilities','').split())!={'cap_setuid','cap_setgid','cap_kill'}or set(service.get('CapabilityBoundingSet','').split())!={'cap_setuid','cap_setgid','cap_kill'}or re.findall(r'argv\[\]=(.*?)\s+;',service.get('ExecStart',''))!=[argv]:fail('exact_inactive_productive_executor_required')
            if bus_property(r['serviceUnit'],'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[] or bus_property(r['serviceUnit'],'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=900000000:fail('exact_bounded_no_dropin_productive_executor_required')

    return receipt


class Epoch:
    def __init__(self,q,model,plan,run_id,*,qualification_epoch,continuation_parent,timer_file,timer_sha,record_callback):
        q.held();model.validate(plan)
        if (model.raw_digest(Path(model.__file__).read_bytes())!=MODEL_SHA or not re.fullmatch('20261021-[a-z0-9-]{1,30}',run_id) or
            not q.record or q.record.get('cleaned')is not True or q.plan['admission']!=plan['origin'] or not callable(record_callback) or
            qualification_epoch.q is not q or qualification_epoch.operator_sha!=REPAIR_EPOCH_SHA or qualification_epoch.plan!=plan['repairPlan'] or
            not qualification_epoch.record or qualification_epoch.record.get('cleaned')is not True):
            fail('exact_productive_model_and_acknowledged_cleaned_Q_record_required')
        self.q,self.model,self.plan,self.run_id=q,model,deepcopy(plan),run_id
        self.qualification_epoch=qualification_epoch
        self.continuation_parent=deepcopy(continuation_parent);self.parent_sha=sha(encoded(self.continuation_parent))
        self.parent_record=self.parent_history()
        self.timer_file,self.timer_sha,self.callback=timer_file,timer_sha,record_callback
        self.plan_sha=model.digest(plan);self.operator_sha=sha(q.c.trusted(Path(__file__).absolute(),150000));self.record=None;self.directory=None

    def held(self):
        self.q.held();self.qualification_epoch.held()
        if self.model.digest(self.plan)!=self.plan_sha:fail('productive_plan_mutated')
        if sha(self.q.c.trusted(Path(__file__).absolute(),150000))!=self.operator_sha:fail('loaded_productive_epoch_operator_changed')
        if sha(encoded(self.continuation_parent))!=self.parent_sha:fail('productive_continuation_parent_mutated')
        self.parent_history()

    def parent_history(self):
        """Reopen acknowledged failed-prod1 history; never rebaseline its IDs."""
        p=self.continuation_parent;q=self.q
        keys={'format','runId','productivePlanSha256','livePlanFile','livePlanSha256','journalSha256','controllerResultSha256','controllerFinishedAckSha256','controllerIdentitySha256','epochRecordFile','epochRecordSha256','cacheReceiptFile','cacheReceiptSha256','cacheAckSha256','dependentProofFile','dependentProofSha256'}
        root=PARENT_BASE;old_epoch=PARENT_EPOCH_BASE
        if (not isinstance(p,dict)or set(p)!=keys or p['format']!='yunipals-productive-failed-parent-v1'or p['runId']!='20261021-prod1'or self.run_id!='20261021-prod2'or
            p['productivePlanSha256']!=self.model.digest(self.plan)or p['livePlanFile']!=str(OPS/'paid-productive-v4-20261021-prod1.live.json')or
            p['livePlanSha256']!=PARENT_LIVE_SHA or p['journalSha256']!=PARENT_JOURNAL_SHA or p['epochRecordSha256']!=PARENT_RECORD_SHA or
            any(not isinstance(p[key],str)or not re.fullmatch('[0-9a-f]{64}',p[key])for key in keys if key.endswith('Sha256'))):
            fail('exact_failed_prod1_continuation_parent_required')
        live=q.c.pinned_json(Path(p['livePlanFile']),p['livePlanSha256'],2000000)
        if live.get('review',{}).get('spec',{}).get('plan')!=self.plan:fail('same_original_financial_plan_required')
        raw=q.c.trusted(root/'journal.jsonl',16000000)
        if sha(raw)!=p['journalSha256']:fail('completed_failed_parent_journal_changed')
        rows=[json.loads(line)for line in raw.splitlines()]
        if not rows or len(rows)>4096 or any(row.get('phase')in {'sql_intent_promotion','sql_ack_promotion','productive_native_record','native_owned_proxy_epoch_selected'}for row in rows):fail('parent_must_have_no_promotion_or_native_attempt')
        def one(phase):
            matches=[row for row in rows if row.get('phase')==phase]
            if len(matches)!=1:fail('single_acknowledged_parent_phase_required')
            return matches[0]
        result=q.c.pinned_json(root/'controller-result.json',p['controllerResultSha256'],100000)
        finished=one('controller_finished');started=one('controller_started')
        ident=q.c.pinned_json(root/'controller-identity.json',p['controllerIdentitySha256'],200000)
        if (result.get('format')!='yunipals-paid-productive-live-v4'or result.get('cleaned')is not True or result.get('nativeStarted')is not False or result.get('automaticRetryAllowed')is not False or result.get('cleanupErrorClass')is not None or
            sha(encoded(finished))!=p['controllerFinishedAckSha256']or finished.get('outcomeSha256')!=p['controllerResultSha256']or finished.get('cleaned')is not True or started.get('identity')!=ident):fail('exact_failed_parent_finished_and_identity_ACK_required')
        path=Path(p['epochRecordFile'])
        if path.name!='cleaned.json'or path.parent.parent!=old_epoch:fail('exact_parent_cleaned_record_path_required')
        record=q.c.pinned_json(path,p['epochRecordSha256'],2000000);state=record.get('state',{});review=state.get('review',{})
        if (record.get('format')!='yunipals-paid-productive-epoch-v4'or set(state)!={'review','reviewHash','chains','enabled','cleaned'}or state.get('cleaned')is not True or state.get('enabled')is not True or
            set(state.get('chains',{}))!={'base','bnb'}or state.get('reviewHash')!=path.parent.name or sha(encoded(review))!=state['reviewHash']or
            review.get('operatorSha256')!='af0972c6e1d22c7179d966c19c57e92745a894a4fdbae7d7954bd893a7ced6b2'or review.get('plan')!=self.plan or review.get('runId')!='20261021-prod1'or
            review.get('repairCleanedReviewHash')!=self.qualification_epoch.record['reviewHash']or q.c.pinned_json(path.parent/'review.json',state['reviewHash'],2000000)!=review):fail('exact_parent_epoch_plan_and_repair_ancestry_required')
        acks=[row for row in rows if row.get('phase')=='productive_epoch_record']
        if not acks or acks[-1].get('path')!=str(path)or acks[-1].get('sha256')!=p['epochRecordSha256']:fail('final_parent_cleaned_record_ACK_required')
        cache_path=Path(p['cacheReceiptFile'])
        if cache_path.parent!=root or not re.fullmatch('cache-cleanup-[0-9]+.json',cache_path.name):fail('exact_parent_cache_receipt_path_required')
        cache=q.c.pinned_json(cache_path,p['cacheReceiptSha256'],2000000);cache_ack=one('owned_caches_destroyed')
        ids={name:owned.get('restoredFalseInvocationId')for name,owned in state['chains'].items()}
        if (any(not re.fullmatch('[0-9a-f]{32}',value or'')or state['chains'][name].get('filesRemoved')is not True for name,value in ids.items())or
            cache.get('format')!='yunipals-paid-productive-epoch-v4'or cache.get('cleaned')is not True or cache.get('ownedProductiveCachesDestroyed')is not True or cache.get('grantCountersReset')is not False or
            cache.get('recordFile')!=str(path)or cache.get('recordSha256')!=p['epochRecordSha256']or cache.get('restoredFalseInvocations')!=ids or
            sha(encoded(cache_ack))!=p['cacheAckSha256']or cache_ack.get('receiptFile')!=str(cache_path)or cache_ack.get('receiptSha256')!=p['cacheReceiptSha256']or cache_ack.get('result')!=cache):fail('exact_parent_cache_destruction_ACK_required')
        if p['dependentProofFile']!=str(OPS/'productive-v4-dependent-equivalence-v1.json'):fail('fixed_five_parent_dependency_proof_required')
        proof=q.c.pinned_json(Path(p['dependentProofFile']),p['dependentProofSha256'],300000)
        if (proof.get('format')!='yunipals-productive-dependent-equivalence-v1'or proof.get('sourceAttempt')!='20261021-prod1'or proof.get('failedAttemptJournalSha256')!=p['journalSha256']or proof.get('cleanedRecordSha256')!=p['epochRecordSha256']or
            proof.get('qualificationPassed')is not True or proof.get('serviceCount')!=5 or proof.get('otherNonOwnedServiceCountUnchanged')!=25 or proof.get('baselineAdoptedFromCurrent')is not False):fail('acknowledged_exact_five_dependency_proof_required')
        return state

    def verify_parent_current(self):
        self.parent_record=self.parent_history();self.q.quiet();observer=self.observer()
        for name,row in self.parent_record['review']['proxies'].items():
            current=self.parent_record['chains'][name]['restoredFalseInvocationId']
            if any(os.path.lexists(row[key])for key in ['overridePath','publicEnvironmentPath']):fail('parent_productive_selection_must_remain_removed')
            self.q.check_proxy(name,row,paid=False,expected_invocation=current)
            value=observer.observe(self.q,name,paid=False,zero=True,expected_configuration=row['legacyConfiguration'],expected_invocation=current)
            self.q.check_proxy(name,row,paid=False,expected_invocation=current)
            if value.get('cleanupOnly')is not True or value.get('dispatchAuthorized')is not False or value.get('historicalProfileIdentityVerified')is not True or value.get('profileAvailability')not in {'historical_only','expired'}:fail('parent_cleanup_only_false_observation_required')
            if self.health(name,paid=False,zero=True)['configuration']!=row['legacyConfiguration']:fail('live_parent_false_configuration_changed')

    def transition_window(self,phase):
        self.held()
        if phase not in {'enable','cleanup'}or not self.record or self.record.get('enabled')is not True or(phase=='cleanup'and self.record.get('cleaned')is not True):fail('acknowledged_owned_transition_phase_required')
        path=LIVE_BASE/self.run_id/'journal.jsonl';raw=self.q.c.trusted(path,16000000)
        rows=[json.loads(line)for line in raw.splitlines()]
        if len(rows)>4096:fail('bounded_owned_transition_journal_required')
        own=[]
        for row in rows:
            if row.get('phase')!='productive_epoch_record':continue
            record_path=Path(row['path'])
            if record_path.parent!=self.directory:continue
            payload=self.q.c.pinned_json(record_path,row['sha256'],2000000)
            if payload.get('format')!=FORMAT or payload.get('state',{}).get('reviewHash')!=self.record['reviewHash']or payload['state']['review'].get('plan')!=self.plan:fail('owned_transition_ACK_record_changed')
            own.append((record_path.name,row['at']))
        first={'prepared.json'}if phase=='enable'else {'base-removed.json','bnb-removed.json'};last='enabled.json'if phase=='enable'else'cleaned.json'
        starts=[stamp for name,stamp in own if name in first];ends=[stamp for name,stamp in own if name==last]
        if not starts or len(ends)!=1:fail('exact_owned_transition_start_and_end_ACKs_required')
        start=self.model.model().moment(starts[0]);end=self.model.model().moment(ends[0])
        if not 0<=(end-start).total_seconds()<=360:fail('bounded_ordered_owned_transition_window_required')
        return {'from':self.model.model().text_time(start),'through':self.model.model().text_time(end)}

    def timers(self):return timer_proof(self.q,self.model,self.plan,self.run_id,self.timer_file,self.timer_sha)

    def window(self):
        self.held()
        if not self.model.model().moment(self.plan['start'])<=now()<self.model.model().moment(self.plan['dispatchExpires']):fail('original_productive_dispatch_window_closed')

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
            if value!=expected:fail('unowned_productive_peer_proxy_changed')
            local(q.free,q.n,q.c,q.v,name,paid=False,zero=True)

    def review(self):
        self.window();self.verify_parent_current();self.peers();timers=self.timers();rows={}
        query=self.q.check_proxy.__func__.__globals__['query']
        if query("SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()",market=True)!=0:fail('no_active_paid_authority_before_productive_epoch')
        ids=','.join(self.model.literal(row['permitId'])for row in self.plan['permits'])
        if query('SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN('+ids+')',market=True)!=0:fail('never_admitted_parent_requires_absent_productive_permit_rows')
        q=self.q;observe=q.check_proxy.__func__.__globals__['observed']
        for name in ['base','bnb']:
            row=deepcopy(self.parent_record['review']['proxies'][name]);current=self.parent_record['chains'][name]['restoredFalseInvocationId']
            q.check_proxy(name,row,paid=False,expected_invocation=current)
            row.update(beforeInvocationId=current)
            row['overridePath']=str(q.v.SYSTEMD/(row['false']['unit']+'.d')/OVERRIDE)
            row['publicEnvironmentPath']=str(OPS/('source6-paid-productive-v5-'+self.run_id+'-'+name+'.env'))
            row['publicEnvironmentSha256']=sha(b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=true\n')
            row['overrideSha256']=sha(('[Service]\nEnvironmentFile='+row['publicEnvironmentPath']+'\n').encode())
            if any(os.path.lexists(row[k])for k in ['overridePath','publicEnvironmentPath']) or any(Path(p).name>=OVERRIDE for p in list(row['definitions'])[1:]):fail('fresh_final14z_required')
            rows[name]=row
        return {'format':FORMAT,'plan':self.plan,'runId':self.run_id,'timerReceiptSha256':self.timer_sha,'repairCleanedReviewHash':self.qualification_epoch.record['reviewHash'],'continuationParent':self.continuation_parent,'continuationParentSha256':self.parent_sha,'proxies':rows,'operatorSha256':sha(Path(__file__).read_bytes())}

    def enable(self,expected):
        if self.record is not None:fail('productive_epoch_already_attempted')
        review=self.review();marker=sha(encoded(review))
        if marker!=expected:fail('exact_fresh_productive_epoch_review_required')
        # Same protected ancestry rules as the frozen epoch evidence root.
        for p in [BASE,BASE/self.run_id]:
            p.mkdir(mode=0o700,exist_ok=True);s=p.lstat()
            if s.st_uid!=0 or s.st_mode&0o077 or p.is_symlink():fail('private_productive_evidence_root_required')
        self.directory=BASE/self.run_id/marker;self.directory.mkdir(mode=0o700)
        self.q.v.save_new(self.directory/'review.json',encoded(review))
        self.record={'review':review,'reviewHash':marker,'chains':{},'enabled':False,'cleaned':False};self.publish('prepared')
        for name,row in review['proxies'].items():
            self.window();self.timers();self.peers();self.q.quiet()
            for earlier,owned in self.record['chains'].items():
                if owned.get('afterInvocationId'):self.q.check_proxy(earlier,review['proxies'][earlier],paid=True,expected_invocation=owned['afterInvocationId'])
            self.q.check_proxy(name,row,paid=False,expected_invocation=row['beforeInvocationId'])
            owned={'publicCreated':False,'filesCreated':False,'afterInvocationId':None,'filesRemoved':False,'restoredFalseInvocationId':None};self.record['chains'][name]=owned
            self.q.v.save_new(Path(row['publicEnvironmentPath']),b'MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=true\n',0o644);owned['publicCreated']=True;self.sync_inputs(row);self.publish(name+'-public')
            self.q.v.save_new(Path(row['overridePath']),('[Service]\nEnvironmentFile='+row['publicEnvironmentPath']+'\n').encode(),0o644);owned['filesCreated']=True;self.sync_inputs(row);self.publish(name+'-selected')
            self.q.v.run(['/usr/bin/systemctl','daemon-reload']);self.q.v.run(['/usr/bin/systemctl','restart',row['false']['unit']],timeout=150)
            current=self.q.check_proxy.__func__.__globals__['observed'](self.q.v,row['false']['unit'])['InvocationID']
            if current==row['beforeInvocationId']:fail('fresh_productive_true_invocation_required')
            owned['afterInvocationId']=current;self.publish(name+'-restarted')
            self.q.check_proxy(name,row,paid=True,expected_invocation=current)
            self.q.v.retry(lambda:self.health(name,paid=True,zero=True))
        self.record['enabled']=True;result=self.validate_current(zero=True);return {**result,**self.publish('enabled')}

    def health(self,name,*,paid,zero):
        return self.q.check_proxy.__func__.__globals__['local_state'](self.q.free,self.q.n,self.q.c,self.q.v,name,paid=paid,zero=zero)

    def observer(self):
        self.held()
        return self.q.c.load(OPS/'paid-cleanup-observer-v1.py',OBSERVER_SHA,'productive_cleanup_observer')

    def cleanup_peers(self):
        self.held();observer=self.observer()
        for name,expected in self.q.record['review']['otherProxies'].items():
            observer.peer(self.q,name,expected)

    def cleanup_health(self,name,*,paid,zero):
        self.held()
        if not self.record or name not in self.record['chains']:fail('exact_owned_cleanup_chain_required')
        row=self.record['review']['proxies'][name];owned=self.record['chains'][name]
        current=owned['afterInvocationId']if paid else owned['restoredFalseInvocationId']or row['beforeInvocationId']
        self.q.check_proxy(name,row,paid=paid,expected_invocation=current)
        value=self.observer().observe(self.q,name,paid=paid,zero=zero,expected_configuration=row['legacyConfiguration'],expected_invocation=current)
        self.q.check_proxy(name,row,paid=paid,expected_invocation=current)
        if (value.get('cleanupOnly')is not True or value.get('dispatchAuthorized')is not False or
            value.get('historicalProfileIdentityVerified')is not True or value.get('profileAvailability')not in {'historical_only','expired'}):
            fail('explicit_cleanup_only_observation_required')
        return value

    def validate_current(self,*,zero=False):
        self.window();self.peers();self.timers()
        if not self.record or not self.record['enabled'] or self.record['cleaned']:fail('acknowledged_productive_epoch_required')
        values={}
        for name,row in self.record['review']['proxies'].items():
            current=self.record['chains'][name]['afterInvocationId'];self.q.check_proxy(name,row,paid=True,expected_invocation=current)
            h=self.health(name,paid=True,zero=zero)
            if h['configuration']!=row['legacyConfiguration']:fail('productive_legacy_configuration_changed')
            values[name]={'invocation':current,**h}
        return {'format':FORMAT,'reviewHash':self.record['reviewHash'],'proxies':values,'originalExpiry':self.plan['expires'],'dispatchExpires':self.plan['dispatchExpires']}

    def restore_record(self,path,expected):
        self.held();path=Path(path)
        if self.record is not None or path.parent.parent!=BASE/self.run_id:fail('exact_productive_ack_record_required')
        payload=self.q.c.pinned_json(path,expected,2000000);r=payload.get('state')
        if payload.get('format')!=FORMAT or not isinstance(r,dict) or set(r)!={'review','reviewHash','chains','enabled','cleaned'} or r['reviewHash']!=path.parent.name or sha(encoded(r['review']))!=r['reviewHash'] or r['review'].get('plan')!=self.plan or r['review'].get('repairCleanedReviewHash')!=self.qualification_epoch.record['reviewHash'] or r['review'].get('continuationParent')!=self.continuation_parent or r['review'].get('continuationParentSha256')!=self.parent_sha or r['review'].get('runId')!=self.run_id or r['review'].get('operatorSha256')!=sha(Path(__file__).read_bytes()) or self.q.c.pinned_json(path.parent/'review.json',r['reviewHash'],2000000)!=r['review']:fail('retained_productive_plan_helper_record_changed')
        for name,owned in r['chains'].items():
            if name not in {'base','bnb'} or set(owned)!={'publicCreated','filesCreated','afterInvocationId','filesRemoved','restoredFalseInvocationId'} or any(type(owned[k])is not bool for k in ['publicCreated','filesCreated','filesRemoved']) or any(owned[k]is not None and not re.fullmatch('[0-9a-f]{32}',owned[k])for k in ['afterInvocationId','restoredFalseInvocationId']):fail('exact_productive_ack_phase_required')
        self.record,self.directory=r,path.parent

    def cleanup(self,revocation):
        self.held();self.cleanup_peers();self.q.quiet()
        if not self.record:fail('retained_productive_record_required')
        if not isinstance(revocation,dict) or set(revocation)!={'format','productivePlanSha256','transactionOutcome','permitIds'} or revocation['format']!='yunipals-paid-productive-revocation-v5' or revocation['productivePlanSha256']!=self.plan_sha or revocation['transactionOutcome']not in {'commit_confirmed','not_admitted_confirmed'} or revocation['permitIds']!=[r['permitId']for r in self.plan['permits']]:fail('actual_owned_productive_revocation_receipt_required')
        # Caller also supplies an ACK, but independently read actual disabled
        # exact rows before deleting any runtime authority.
        ids=','.join(self.model.literal(r['permitId'])for r in self.plan['permits'])
        value=self.q.check_proxy.__func__.__globals__['query']("SELECT jsonb_build_object('active',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit WHERE enabled AND expires_at>clock_timestamp()),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'enabled',enabled,'chainId',chain_id,'maximumCu',maximum_cu::text,'fromBlock',from_block::text,'throughBlock',through_block::text,'expires',expires_at,'profileId',profile_id))FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN("+ids+")),'[]'::jsonb))",market=True)
        if value.get('active')!=0 or not isinstance(value.get('rows'),list)or len(value['rows'])!=(2 if revocation['transactionOutcome']=='commit_confirmed' else 0):fail('actual_productive_revocation_not_observed')
        for row in self.plan['permits'] if revocation['transactionOutcome']=='commit_confirmed' else []:
            a=next((x for x in value['rows']if x.get('permitId')==row['permitId']),{})
            if a.get('enabled')is not False or a.get('profileId')!=self.q.model.PROFILE or any(a.get(k)!=v for k,v in row.items()if k!='expires') or self.q.model.moment(a.get('expires','').replace('+00:00','Z'))!=self.q.model.moment(row['expires']):fail('actual_owned_productive_permit_changed')
        restored={}
        for name,owned in self.record['chains'].items():
            row=self.record['review']['proxies'][name]
            if owned['restoredFalseInvocationId']:
                self.q.check_proxy(name,row,paid=False,expected_invocation=owned['restoredFalseInvocationId']);self.cleanup_health(name,paid=False,zero=True);restored[name]=owned['restoredFalseInvocationId'];continue
            if owned['filesRemoved']:fail('unacknowledged_productive_false_restart_manual_reconcile')
            if owned['filesCreated']:
                if not owned['afterInvocationId']:fail('unacknowledged_productive_true_restart_manual_reconcile')
                self.q.check_proxy(name,row,paid=True,expected_invocation=owned['afterInvocationId'])
                Path(row['overridePath']).unlink();Path(row['publicEnvironmentPath']).unlink();owned['filesRemoved']=True;self.sync_inputs(row);self.publish(name+'-removed')
                self.q.v.run(['/usr/bin/systemctl','daemon-reload']);self.q.v.run(['/usr/bin/systemctl','restart',row['false']['unit']],timeout=150)
                current=self.q.check_proxy.__func__.__globals__['observed'](self.q.v,row['false']['unit'])['InvocationID']
                if current in {owned['afterInvocationId'],row['beforeInvocationId']}:fail('fresh_false_process_required_to_destroy_caches')
                owned['restoredFalseInvocationId']=current;self.publish(name+'-false-restarted');self.q.check_proxy(name,row,paid=False,expected_invocation=current);self.q.v.retry(lambda:self.cleanup_health(name,paid=False,zero=True));restored[name]=current
            elif owned['publicCreated']:
                self.q.check_proxy(name,row,paid=False,expected_invocation=row['beforeInvocationId'])
                if sha(self.q.c.trusted(Path(row['publicEnvironmentPath']),2000))!=row['publicEnvironmentSha256']:fail('unselected_productive_file_drift')
                Path(row['publicEnvironmentPath']).unlink();owned['publicCreated']=False;self.sync_inputs(row);self.publish(name+'-unselected-removed')
        if any(os.path.lexists(row[k])for row in self.record['review']['proxies'].values()for k in ['overridePath','publicEnvironmentPath']):fail('productive_true_files_remain')
        if self.record['cleaned']:
            path=self.directory/'cleaned.json';raw=self.q.c.trusted(path,2000000)
            if json.loads(raw)!={'format':FORMAT,'state':self.record}:fail('cleaned_ACK_record_changed')
            pin={'recordFile':str(path),'recordSha256':sha(raw)}
        else:
            self.record['cleaned']=True;pin=self.publish('cleaned')
        return {'format':FORMAT,'cleaned':True,'restoredFalseInvocations':restored,'ownedProductiveCachesDestroyed':True,'original12zAndFalseFilesRetained':True,'grantCountersReset':False,**pin}


def prepare(q_session,productive_plan,run_id,*,qualification_epoch,continuation_parent,timer_file,timer_sha,record_callback):
    path=Path(__file__).with_name('paid-productive-plan-v5.py');raw=q_session.c.trusted(path,100000)
    if sha(raw)!=MODEL_SHA:fail('frozen_productive_model_changed')
    import types
    model=types.ModuleType('productive_epoch_model');model.__file__=str(path);exec(compile(raw,str(path),'exec'),model.__dict__)
    return Epoch(q_session,model,productive_plan,run_id,qualification_epoch=qualification_epoch,continuation_parent=continuation_parent,timer_file=timer_file,timer_sha=timer_sha,record_callback=record_callback)
