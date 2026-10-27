#!/usr/bin/env python3
"""Exact prod2 failed-start terminal seal, library only; no signal/job/SQL write.

The caller owns the actual source+both chain leases and supplies the unchanged
Live5/Q/Epoch5 context. No full Native7 preparation or running-record adoption.
"""
from copy import deepcopy
import hashlib,json,os,re,stat,types
from pathlib import Path

FORMAT='yunipals-paid-native-failed-start-seal-v1'
CLEANUP_FORMAT='yunipals-paid-native-failed-start-cleanup-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-paid-native-failed-start-seal-v1-20261021/20261021-prod2')
LIVE=Path('/var/backups/yunipals-paid-productive-live-v5-20261021/20261021-prod2')
NATIVE_BASE=Path('/var/backups/yunipals-paid-productive-native-v7-20261021/20261021-prod2')
REVIEW='5b1c399bbe9028a56f9faee810908b3dea3c1b07c73ca55962fe6215e1197100'
DIRECTORY=NATIVE_BASE/REVIEW
UNIT='yunipals-unified-paid-productive-v7-20261021-prod2.service'
INVOCATION='8ce7aaa1f1364533b6cea34139948a0b'
START_MONO=66028168849218
ACK_SHA='3051abac91dbcc3e7476a2b71965f0c461e506f38dca24007780e5028b03e7e2'
FAILURE_SHA='4e026b35c85c6aa3c5684305ebec8a3a55a89d767c10525a9b07689cece90384'
NATIVE_SHA='3377df491c0fc2fd3af44487077450452610c8754834190616aee2b930fb3350'
EPOCH_SHA='195fca70b2b91accaf8e4d8aa657f6a37b04dad5e496463061ad6d54f22c231c'
DEPENDENT_SHA='55cc30adb5590ce5c36852bfb040816c801d94e25619c422f92ee08c735156c3'
WORKSPACE=Path('/var/lib/yunipals-unified-shadow/20261020-008028af-a')
CGROUP=Path('/sys/fs/cgroup/system.slice')/UNIT
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}

class SealFailure(RuntimeError):pass
def fail(code):raise SealFailure(code)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def same(a,b):return encoded(a)==encoded(b)

def cgroup_empty(path=CGROUP):
    # A removed exact cgroup is distinct from a GC'd unit; the latter requires
    # a saved loaded terminal witness. Never turn EACCES/other errors into absent.
    try:root=path.lstat()
    except FileNotFoundError:return {'path':str(path),'state':'removed_after_exact_terminal','recursiveGroups':0,'processes':0}
    if not stat.S_ISDIR(root.st_mode)or root.st_uid!=0:fail('exact_owned_cgroup_directory_required')
    count=0
    def refused(error):raise error
    for directory,children,names in os.walk(path,followlinks=False,onerror=refused):
        count+=1
        if count>128:fail('bounded_owned_cgroup_hierarchy_required')
        here=Path(directory);s=here.lstat()
        if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_dev!=root.st_dev:fail('owned_cgroup_redirected')
        if 'cgroup.procs'not in names or 'cgroup.events'not in names:fail('complete_owned_cgroup_evidence_required')
        for name in ['cgroup.procs','cgroup.threads']:
            p=here/name
            if name not in names:continue
            if p.is_symlink():fail('owned_cgroup_process_file_redirected')
            if p.read_text().strip():fail('failed_native_cgroup_still_has_processes')
        if(here/'cgroup.events').is_symlink():fail('owned_cgroup_events_redirected')
        events=dict(line.split()for line in(here/'cgroup.events').read_text().splitlines())
        if events.get('populated')!='0':fail('failed_native_cgroup_not_empty')
        for name in children:
            if(here/name).is_symlink():fail('owned_cgroup_child_redirected')
    final=path.lstat()
    if(root.st_dev,root.st_ino)!=(final.st_dev,final.st_ino):fail('owned_cgroup_identity_changed')
    return {'path':str(path),'state':'present_empty','recursiveGroups':count,'processes':0}

class Seal:
    def __init__(self,q,source,native,value,journal,session,epoch):
        self.q,self.source,self.native,self.value,self.journal,self.session,self.epoch=q,source,native,value,journal,session,epoch
        self.plan=value['review']['spec']['plan'];self.run_id=value['review']['spec']['runId']
        if self.run_id!='20261021-prod2'or Path(journal.directory)!=LIVE:fail('only_actual_failed_prod2_supported')
        self.old=types.SimpleNamespace(command=lambda args,env=ENV,timeout=5:source.run(args,timeout=timeout))
        self.p=session.c.persistent();self.dep=session.c.load(OPS/'paid-dependent-transition-v1.py',DEPENDENT_SHA,'failed_start_fixed_dependent_validator')
        self.operator_sha=sha(q.protected(Path(__file__).absolute(),150000))
        self.held()
    def held(self):
        self.session.held()
        if(self.epoch.q is not self.session or self.epoch.plan!=self.plan or self.epoch.run_id!=self.run_id or self.epoch.operator_sha!=EPOCH_SHA or
            sha(self.q.protected(OPS/'paid-productive-native-v7.py',150000))!=NATIVE_SHA or
            sha(self.q.protected(OPS/'paid-productive-epoch-v5.py',150000))!=EPOCH_SHA or
            sha(self.q.protected(Path(__file__).absolute(),150000))!=self.operator_sha):fail('actual_held_original_context_required')
    def history(self):
        self.held();rows=self.journal.rows();refs=[r for r in rows if r.get('phase')=='productive_native_record']
        if not refs or refs[-1].get('path')!=str(DIRECTORY/'start-requested.json')or refs[-1].get('sha256')!=ACK_SHA:fail('exact_latest_start_requested_ACK_required')
        if any(r.get('phase')in{'native_stopped','native_proxy_cleanup_transition'}or r.get('phase')=='productive_native_record'and Path(r.get('path','')).name in{'running.json','stopped.json'}for r in rows):fail('this_is_only_unacknowledged_failed_start_reconciliation')
        finished=self.journal.latest('controller_finished')
        if(finished is None or finished.get('cleaned')is not False or self.journal.latest('sql_ack_promotion')is None or
            self.journal.latest('sql_ack_revoke')is None):fail('actual_failed_controller_finished_and_revoke_ACK_required')
        raw=self.q.protected(DIRECTORY/'start-requested.json',2000000)
        failed_raw=self.q.protected(DIRECTORY/'launch-failed.json',2000000)
        if sha(raw)!=ACK_SHA or sha(failed_raw)!=FAILURE_SHA:fail('actual_partial_native_history_changed')
        requested=json.loads(raw);failure=json.loads(failed_raw)
        if(requested.get('format')!=self.native.FORMAT or failure.get('format')!=self.native.FORMAT or failure.get('errorClass')!='PermissionError'or
            failure.get('unknownAcknowledgementRequiresManualReconcile')is not True or failure.get('automaticRetryAllowed')is not False):fail('exact_failed_launch_history_required')
        r=requested['record'];f=failure['record'];b=r['binding']
        if(r.get('phase')!='start_requested'or any(r.get(k)is not None for k in['invocation','process','startMonotonicMicroseconds','definition','terminal','seal'])or
            f.get('invocation')!=INVOCATION or f.get('startMonotonicMicroseconds')!=START_MONO or
            {k:v for k,v in f.items()if k not in{'invocation','startMonotonicMicroseconds'}}!={k:v for k,v in r.items()if k not in{'invocation','startMonotonicMicroseconds'}}or
            type(r.get('maximumSeconds'))is not int or not 60<=r['maximumSeconds']<=28800 or
            r.get('reviewHash')!=REVIEW or sha(encoded(b))!=REVIEW or self.q.protected(DIRECTORY/'review.json',2000000)!=encoded(b)):
            fail('partial_failure_is_not_a_running_native_proof')
        if(b.get('operatorSha256')!=NATIVE_SHA or b.get('runId')!=self.run_id or b.get('productivePlanSha256')!=sha(encoded(self.plan))or
            b.get('qCleanRecordSha256')!=sha(encoded(self.session.record))or b.get('retainedWorkspace')!=str(WORKSPACE)or
            b.get('sourceDigest')!=self.native.ACTOR or b.get('nativeBuild')!=self.native.NATIVE or b.get('releaseId')!=self.native.RELEASE or
            b.get('physicalSchema')!=self.native.SCHEMA or b.get('originalCacheBytes')!=531472384 or
            any(b.get(k)!=self.plan[key]for k,key in [('originalStart','start'),('originalExpires','expires'),('dispatchExpires','dispatchExpires')])):fail('original_source_clock_and_allowance_must_be_retained')
        return r,b
    def terminal(self,record,*,saved=None):
        current=self.source.run(['/usr/bin/systemctl','show','--all',UNIT,'--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=Slice','--property=ControlGroup'],timeout=4)
        pairs=[line.split('=',1)for line in current.splitlines()]
        if len(pairs)!=6 or any(len(p)!=2 for p in pairs)or len(dict(pairs))!=6:fail('complete_failed_native_state_required')
        minimal=dict(pairs)
        if minimal['LoadState']=='not-found':
            if(saved is None or saved['terminal']['LoadState']!='loaded'or saved['terminal']['InvocationID']!=INVOCATION or
                {k:v for k,v in minimal.items()if k not in{'Slice','ControlGroup'}}!={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0'}or
                minimal['ControlGroup']!=''or minimal['Slice']not in{'','system.slice'}):fail('no_GC_adoption_without_saved_exact_terminal_witness')
            group=cgroup_empty()
            if group['state']!='removed_after_exact_terminal':fail('GC_native_cgroup_must_be_absent')
            return saved['terminal'],saved['definitionSha256'],group,True
        if minimal['Slice']!='system.slice'or minimal['ControlGroup']not in{'','/system.slice/'+UNIT}:fail('exact_owned_native_slice_and_cgroup_required')
        props=self.native.unit_props(self.old,UNIT);maximum=record['maximumSeconds'];expected=self.native.properties(WORKSPACE,maximum)
        if(props['InvocationID']!=INVOCATION or props['Description']!=self.native.description(REVIEW)or props['ActiveState']not in{'inactive','failed'}or
            props['SubState']not in{'dead','failed'}or props['MainPID']!='0'or props['Result']!='exit-code'or props['ExecMainStatus']!='1'or
            props['DropInPaths']!=''or props['ExecMainStartTimestampMonotonic']!=str(START_MONO)or
            not props['ExecMainExitTimestampMonotonic'].isdigit()or int(props['ExecMainExitTimestampMonotonic'])<=START_MONO or
            any(props[k]!=v for k,v in expected.items()if k not in{'RuntimeMaxSec','CPUQuota','TimeoutStopSec','IPAddressDeny','IPAddressAllow'})or
            self.p.duration_us(props['RuntimeMaxUSec'])!=maximum*1000000 or self.p.duration_us(props['CPUQuotaPerSecUSec'])!=1000000 or
            self.p.duration_us(props['TimeoutStopUSec'])!=30000000 or self.p.address_networks(props['IPAddressDeny'])!={'0.0.0.0/0','::/0'}or
            self.p.address_networks(props['IPAddressAllow'])!={'127.0.0.0/8','::1/128'}or
            re.findall(r'(?:^|[ {;])path=([^ ;]+)',props['ExecStart'])!=['/usr/bin/env']or
            re.findall(r'argv\[\]=(.*?)\s+;',props['ExecStart'])!=[' '.join(self.native.command_argv(WORKSPACE,Path(record['binding']['overlayFile'])))]or
            props['FragmentPath']!=str(Path('/run/systemd/transient')/UNIT)):fail('exact_intended_failed_native_terminal_required')
        definition=sha(self.session.c.trusted(Path(props['FragmentPath']),100000));group=cgroup_empty()
        if minimal['ControlGroup']==''and group['state']!='removed_after_exact_terminal':fail('empty_reported_cgroup_requires_actual_absence')
        group={**group,'reportedControlGroup':minimal['ControlGroup']}
        terminal={k:props[k]for k in['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','Result','ExecMainStatus','ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic']}
        if saved is not None and(terminal!=saved['terminal']or definition!=saved['definitionSha256']):fail('saved_failed_terminal_identity_changed')
        return terminal,definition,group,False
    def source_state(self,binding):
        self.session.quiet()
        peer=self.native.scalar_state(self.source,running=False,expected=self.session.record['review']['sourcePeer'])
        schema=self.native.SCHEMA
        metrics=self.source.query("""SELECT jsonb_build_object('schemaBytes',coalesce(sum(pg_total_relation_size(c.oid))FILTER(WHERE n.nspname='"""+schema+"""'),0),'cacheBytes',coalesce(sum(pg_total_relation_size(c.oid))FILTER(WHERE n.nspname='ponder_sync'),0),'sourceRelations',count(*)FILTER(WHERE n.nspname='"""+schema+"""'),'runtime',(SELECT jsonb_build_object('buildId',value->>'build_id','ready',value->'is_ready','heartbeat',value->'heartbeat_at')FROM """+schema+"""._ponder_meta WHERE key='app'),'checkpoints',(SELECT coalesce(jsonb_agg(jsonb_build_object('chain',chain_id,'latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint)ORDER BY chain_id),'[]'::jsonb)FROM """+schema+"""._ponder_checkpoint))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','m','S')AND n.nspname IN('ponder_sync','"""+schema+"""')""")
        metrics=self.native.metrics_ok(metrics,45);anchors=self.native.source_anchors(self.source)
        if(metrics['runtime']!=binding['previousRuntime']or metrics['checkpoints']!=binding['previousCheckpoints']or anchors!=binding['previousAnchors']or
            self.native.resource_reason(__import__('shutil').disk_usage('/opt/yunipals-unified').free,metrics)is not None):fail('failed_start_source_advanced_or_resources_changed_no_rebaseline')
        for name,pin in binding['codePins'].items():
            path=Path(name)
            if not path.is_relative_to(WORKSPACE)or '..'in path.parts or sha(self.session.c.trusted(path,2000000))!=pin:fail('prepared_native_code_changed')
        if(sha(self.session.c.trusted(WORKSPACE/'launch.env'))!=binding['launchEnvSha256']or
            binding['overlayFile']!=str(OPS/'paid-productive-v7-20261021-prod2.native.env')or
            self.session.c.trusted(Path(binding['overlayFile']),2000)!=self.native.overlay_bytes(self.plan)or
            sha(self.session.c.trusted(Path(binding['overlayFile']),2000))!=binding['overlaySha256']):fail('exact_unchanged_launch_overlay_required')
        return {'sourcePeerSha256':sha(encoded(peer)),'runtimeSha256':sha(encoded(metrics['runtime'])),'checkpointsSha256':sha(encoded(metrics['checkpoints'])),'sourceAnchorsSha256':sha(encoded(anchors)),'sourceConnections':0,'sourceRelations':metrics['sourceRelations']},metrics
    def states(self,binding):
        names=sorted(binding['legacyUnits'])
        if len(names)!=32:fail('original_32_unit_graph_required')
        raw=self.source.run(['/usr/bin/systemctl','show','--all',*names,'--property=Id','--property=LoadState','--property=ActiveState','--property=SubState','--property=InvocationID'],timeout=6)
        result={}
        for block in raw.split('\n\n'):
            pairs=[line.split('=',1)for line in block.splitlines()]
            if any(len(p)!=2 for p in pairs)or len(pairs)!=len(dict(pairs)):fail('unambiguous_unit_state_required')
            row=dict(pairs)
            if row:
                if set(row)!={'Id','LoadState','ActiveState','SubState','InvocationID'}or row['Id']in result:fail('exact_unique_32_unit_state_required')
                result[row['Id']]=row
        if set(result)!=set(names):fail('complete_current_32_unit_graph_required')
        return result
    def prepare(self):
        record,binding=self.history();terminal,definition,group,gc=self.terminal(record)
        self.epoch_binding(binding,cleaned=False)
        state,metrics=self.source_state(binding);states=self.states(binding)
        snapshot=self.dep.capture(self.session,states)
        if states!=binding['legacyUnits']or snapshot!=binding['dependentSnapshot']:fail('current_failed_start_graph_changed_before_owned_cleanup')
        again=self.terminal(record)
        if(terminal,definition,group,gc)!=again:fail('terminal_or_cgroup_changed_during_seal_review')
        value={'format':FORMAT,'operatorSha256':self.operator_sha,'nativeReviewHash':REVIEW,'productivePlanSha256':sha(encoded(self.plan)),
            'startRequestedFile':str(DIRECTORY/'start-requested.json'),'startRequestedSha256':ACK_SHA,'launchFailureFile':str(DIRECTORY/'launch-failed.json'),'launchFailureSha256':FAILURE_SHA,
            'nativeUnit':UNIT,'nativeInvocation':INVOCATION,'terminal':terminal,'definitionSha256':definition,'cgroup':group,'source':state,
            'legacyUnits':states,'dependentSnapshot':snapshot,'originalStart':self.plan['start'],'originalExpires':self.plan['expires'],'dispatchExpires':self.plan['dispatchExpires'],
            'nativeRunningAcknowledged':False,'nativeRunCompleted':False,'quarantined':True,'automaticRetryAllowed':False,'schemaOrCacheReset':False}
        return {'reviewHash':sha(encoded(value)),'binding':value,'observation':{'schemaBytes':metrics['schemaBytes'],'cacheBytes':metrics['cacheBytes']}}
    def store(self,expected):
        self.held()
        if os.path.lexists(BASE):fail('fresh_failed_start_seal_directory_required_no_retry')
        ref=self.native.References(UNIT)
        try:
            ref.acquire();checked=self.prepare()
            if checked['reviewHash']!=expected:fail('exact_fresh_failed_start_seal_review_required')
            for ancestor in [*BASE.parent.parent.parents,BASE.parent.parent]:
                st=ancestor.lstat()
                if not stat.S_ISDIR(st.st_mode)or st.st_uid!=0 or st.st_mode&0o022:fail('protected_failed_seal_ancestry_required')
            parent=BASE.parent
            if not os.path.lexists(parent):parent.mkdir(mode=0o700)
            st=parent.lstat()
            if not stat.S_ISDIR(st.st_mode)or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o700:fail('protected_new_failed_seal_parent_required')
            BASE.mkdir(mode=0o700)
            try:
                receipt={'format':FORMAT,'reviewHash':checked['reviewHash'],'seal':checked['binding']}
                path=BASE/'receipt.json';pin=self.q.save(path,receipt)
                self.journal.emit('native_failed_start_terminal',receiptFile=str(path),receiptSha256=pin,nativeInvocation=INVOCATION,nativeRunningAcknowledged=False)
                self.validate_saved(str(path),pin)
                return {'receiptFile':str(path),'receiptSha256':pin,'reviewHash':checked['reviewHash'],'nativeRunningAcknowledged':False,'nativeRunCompleted':False}
            except BaseException:
                self.q.save(BASE/'failed.json',{'format':FORMAT,'manualReconcileRequired':True,'automaticRetryAllowed':False});raise
        finally:ref.close()
    def saved(self,path,pin):
        self.held()
        if Path(path)!=BASE/'receipt.json'or not self.native.is_sha(pin)or os.path.lexists(BASE/'failed.json'):fail('exact_successfully_acknowledged_failed_start_seal_required')
        raw=self.q.protected(Path(path),2000000)
        if sha(raw)!=pin:fail('saved_failed_start_seal_sha_changed')
        value=json.loads(raw);seal=value.get('seal',{})
        if(set(value)!={'format','reviewHash','seal'}or value['format']!=FORMAT or value['reviewHash']!=sha(encoded(seal))or
            seal.get('format')!=FORMAT or seal.get('operatorSha256')!=self.operator_sha or seal.get('nativeReviewHash')!=REVIEW or
            seal.get('productivePlanSha256')!=sha(encoded(self.plan))or seal.get('nativeInvocation')!=INVOCATION or seal.get('nativeUnit')!=UNIT):fail('saved_actual_failed_start_identity_changed')
        ack=self.journal.latest('native_failed_start_terminal')
        if ack is None or ack.get('receiptFile')!=str(path)or ack.get('receiptSha256')!=pin or ack.get('nativeInvocation')!=INVOCATION or ack.get('nativeRunningAcknowledged')is not False:fail('durable_failed_terminal_ACK_required')
        return seal
    def cache_receipt(self,cache_file,cache_sha,binding):
        self.epoch.held()
        if self.epoch.record is None or self.epoch.record.get('cleaned')is not True or self.epoch.record.get('enabled')is not True or self.epoch.record['reviewHash']!=binding['ownedProxyEpoch']['epochReviewHash']:fail('exact_actual_cleaned_owned_epoch_required')
        path=Path(cache_file)
        if path.parent!=LIVE or not re.fullmatch(r'cache-cleanup-[0-9]+\.json',path.name)or not self.native.is_sha(cache_sha):fail('exact_owned_cache_cleanup_receipt_required')
        raw=self.q.protected(path,2000000)
        if sha(raw)!=cache_sha:fail('owned_cache_cleanup_receipt_changed')
        cleaned_path=self.epoch.directory/'cleaned.json';cleaned_raw=self.q.protected(cleaned_path,2000000)
        if json.loads(cleaned_raw)!={'format':'yunipals-paid-productive-epoch-v5','state':self.epoch.record}:fail('actual_cleaned_owned_record_changed')
        expected={'format':'yunipals-paid-productive-epoch-v5','cleaned':True,'restoredFalseInvocations':{name:self.epoch.record['chains'][name]['restoredFalseInvocationId']for name in self.native.PROXY_UNITS},'ownedProductiveCachesDestroyed':True,'original12zAndFalseFilesRetained':True,'grantCountersReset':False,'recordFile':str(cleaned_path),'recordSha256':sha(cleaned_raw)}
        if json.loads(raw)!=expected:fail('actual_owned_cache_destruction_must_be_unchanged')
        ack=self.journal.latest('owned_caches_destroyed')
        if ack is None or ack.get('receiptFile')!=str(path)or ack.get('receiptSha256')!=cache_sha or ack.get('result')!=expected:fail('actual_cache_cleanup_ACK_required')
        return expected
    def epoch_binding(self,binding,*,cleaned):
        e=self.epoch;r=e.record;t=binding['ownedProxyEpoch']
        if(not isinstance(r,dict)or r.get('enabled')is not True or r.get('cleaned')is not cleaned or set(r.get('chains',{}))!=set(self.native.PROXY_UNITS)or
            r.get('reviewHash')!=t['epochReviewHash']or r['review'].get('operatorSha256')!=EPOCH_SHA or r['review'].get('plan')!=self.plan or
            sha(encoded(r['review']))!=r['reviewHash']or t.get('format')!='yunipals-native-owned-proxy-transition-v2'or t.get('epochOperatorSha256')!=EPOCH_SHA):fail('actual_historical_productive_epoch_binding_required')
        enabled=self.session.c.pinned_json(Path(t['enabledRecordFile']),t['enabledRecordSha256'],2000000)
        if(Path(t['enabledRecordFile'])!=e.directory/'enabled.json'or enabled.get('format')!='yunipals-paid-productive-epoch-v5'or
            enabled['state'].get('enabled')is not True or enabled['state'].get('cleaned')is not False or enabled['state'].get('review')!=r['review']or
            enabled['state'].get('reviewHash')!=r['reviewHash']or set(enabled['state'].get('chains',{}))!=set(self.native.PROXY_UNITS)or
            set(t.get('trueStates',{}))!=set(self.native.PROXY_UNITS)):fail('original_acknowledged_enabled_proxy_record_required')
        e.cleanup_peers()
        for name,owned in r['chains'].items():
            row=r['review']['proxies'][name];inv=owned['restoredFalseInvocationId']if cleaned else owned['afterInvocationId']
            if(enabled['state']['chains'][name]['afterInvocationId']!=owned['afterInvocationId']or
                t['trueStates'][name]!=binding['legacyUnits'][self.native.PROXY_UNITS[name]]or
                t['trueStates'][name]['InvocationID']!=owned['afterInvocationId']):fail('original_true_proxy_invocation_changed')
            if cleaned and(owned.get('filesRemoved')is not True or not self.native.invocation(inv)or
                any(os.path.lexists(row[key])for key in ['overridePath','publicEnvironmentPath'])):fail('owned_true_selection_must_be_removed')
            self.session.check_proxy(name,row,paid=not cleaned,expected_invocation=inv)
            observed=e.cleanup_health(name,paid=not cleaned,zero=cleaned)
            if(observed.get('cleanupOnly')is not True or observed.get('dispatchAuthorized')is not False or observed.get('historicalProfileIdentityVerified')is not True or observed.get('profileAvailability')not in{'historical_only','expired'}or
                observed.get('configuration')!=row['legacyConfiguration']):fail('cleanup_only_proxy_observation_required')
    def core_saved_check(self,seal):
        record,binding=self.history()
        if(seal['startRequestedSha256']!=ACK_SHA or seal['launchFailureSha256']!=FAILURE_SHA or seal['originalStart']!=self.plan['start']or seal['originalExpires']!=self.plan['expires']or seal['dispatchExpires']!=self.plan['dispatchExpires']or
            seal['nativeRunningAcknowledged']is not False or seal['nativeRunCompleted']is not False or seal['quarantined']is not True or seal['automaticRetryAllowed']is not False):fail('failed_start_receipt_must_not_authorize_a_run')
        self.terminal(record,saved=seal);state,_=self.source_state(binding)
        if state!=seal['source']or binding['legacyUnits']!=seal['legacyUnits']or binding['dependentSnapshot']!=seal['dependentSnapshot']:fail('retained_failed_source_or_original_graph_changed')
        return binding
    def validate_saved(self,path,pin,*,cleanup_transition_file=None,cleanup_transition_sha=None):
        seal=self.saved(path,pin);binding=self.core_saved_check(seal);cleaned=self.epoch.record.get('cleaned')is True
        self.epoch_binding(binding,cleaned=cleaned)
        states=self.states(binding);snapshot=self.dep.capture(self.session,states)
        if not cleaned:
            if cleanup_transition_file is not None or cleanup_transition_sha is not None or states!=seal['legacyUnits']or snapshot!=seal['dependentSnapshot']:fail('no_unreviewed_failed_start_graph_change')
        else:
            if cleanup_transition_file is None or not self.native.is_sha(cleanup_transition_sha):fail('saved_failed_start_cleanup_transition_required')
            self.validate_cleanup(path,pin,cleanup_transition_file,cleanup_transition_sha,seal,binding,states,snapshot)
        return deepcopy(seal)
    def bind_cleanup(self,path,pin,cache_file,cache_sha):
        seal=self.saved(path,pin);binding=self.core_saved_check(seal)
        if self.journal.latest('native_failed_start_cleanup_transition')is not None:fail('reuse_saved_failed_cleanup_transition_no_new_window')
        receipt=self.cache_receipt(cache_file,cache_sha,binding);self.epoch_binding(binding,cleaned=True)
        states=self.states(binding);snapshot=self.dep.capture(self.session,states)
        selected={name:states[unit]for name,unit in self.native.PROXY_UNITS.items()}
        window=self.epoch.transition_window('cleanup')
        proof=self.dep.validate(seal['dependentSnapshot'],snapshot,seal['legacyUnits'],states,owned_states=selected,window=window,phase='cleanup')
        if any(selected[name]['InvocationID']!=receipt['restoredFalseInvocations'][name]for name in selected):fail('actual_owned_false_invocations_required')
        return {'format':CLEANUP_FORMAT,'failedStartReceiptFile':str(path),'failedStartReceiptSha256':pin,'epochReviewHash':self.epoch.record['reviewHash'],'cacheReceiptFile':str(cache_file),'cacheReceiptSha256':cache_sha,'cleanedRecordFile':receipt['recordFile'],'cleanedRecordSha256':receipt['recordSha256'],'falseStates':selected,'afterStates':states,'dependentTransition':{'operatorSha256':DEPENDENT_SHA,'proof':proof}}
    def validate_cleanup(self,path,pin,proof_file,proof_sha,seal,binding,states,snapshot):
        p=Path(proof_file)
        if p.parent!=LIVE or not re.fullmatch(r'failed-native-cleanup-[0-9]+\.json',p.name):fail('exact_saved_failed_cleanup_path_required')
        raw=self.q.protected(p,2000000)
        if sha(raw)!=proof_sha:fail('saved_failed_cleanup_sha_changed')
        proof=json.loads(raw);ack=self.journal.latest('native_failed_start_cleanup_transition')
        if ack is None or ack.get('receiptFile')!=str(p)or ack.get('receiptSha256')!=proof_sha:fail('saved_failed_cleanup_transition_ACK_required')
        keys={'format','failedStartReceiptFile','failedStartReceiptSha256','epochReviewHash','cacheReceiptFile','cacheReceiptSha256','cleanedRecordFile','cleanedRecordSha256','falseStates','afterStates','dependentTransition'}
        if(set(proof)!=keys or proof['format']!=CLEANUP_FORMAT or proof['failedStartReceiptFile']!=str(path)or proof['failedStartReceiptSha256']!=pin or proof['epochReviewHash']!=self.epoch.record['reviewHash']or proof['afterStates']!=states):fail('saved_original_failed_cleanup_transition_required')
        receipt=self.cache_receipt(proof['cacheReceiptFile'],proof['cacheReceiptSha256'],binding)
        if proof['cleanedRecordFile']!=receipt['recordFile']or proof['cleanedRecordSha256']!=receipt['recordSha256']:fail('actual_cleaned_epoch_lineage_changed')
        selected={name:states[unit]for name,unit in self.native.PROXY_UNITS.items()};dependent=proof['dependentTransition']
        if selected!=proof['falseStates']or any(selected[name]['InvocationID']!=receipt['restoredFalseInvocations'][name]for name in selected)or dependent.get('operatorSha256')!=DEPENDENT_SHA:fail('only_exact_owned_false_invocations_allowed')
        body=dependent['proof']
        if body.get('beforeSnapshot')!=seal['dependentSnapshot']or body.get('afterSnapshot')!=snapshot:fail('saved_fixed_five_snapshots_changed')
        checked=self.dep.validate(seal['dependentSnapshot'],snapshot,seal['legacyUnits'],states,owned_states=selected,window=body['window'],phase='cleanup')
        if checked!=body:fail('saved_cleanup_window_cannot_be_rebased')
        return proof
