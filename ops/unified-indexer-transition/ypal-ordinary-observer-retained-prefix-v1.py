#!/usr/bin/env python3
"""One explicit observer replacement; source, paid policy and consumers unchanged."""
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
import types

FORMAT='yunipals-ypal-ordinary-observer-retained-prefix-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-observer-retained-prefix-v1-20261025')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-observer-retained-prefix-input-v1-20261025/input.json')
PREVIOUS=OPS/'ypal-alchemy-ordinary-observer-v1.py'
PREVIOUS_SHA='2a84e16a31df3d5266d0ff3992753d01c6849b3755d173a6e29f2f1cdeebab93'
FROZEN=OPS/'ypal-restored-ordinary-observer-v1.py'
FROZEN_SHA='62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3'
INSTALLER=OPS/'ypal-ordinary-observer-retained-prefix-install-v1.py'
INSTALLER_SHA='a58a3a897d25686296f3cdbf62fdcbe74075b13340b48db890f6b623d08623df'
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
DROP=Path('/etc/systemd/system/yunipals-combined-ordinary-observer.service.d/90-retained-prefix-v1.conf')


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):need(type(v)is str and re.fullmatch('[a-f0-9]{64}',v),'actual_fixed_observer_reference_required');return v
def own_sha():return sha(Path(__file__).read_bytes())
def protected(path):
    for p in [*Path(path).parents,Path(path)]:
        row=p.lstat();need(row.st_uid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_fixed_observer_replacement_input_required')
    before=Path(path).lstat();need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<4000000,'bounded_observer_replacement_file_required')
    raw=Path(path).read_bytes();after=Path(path).lstat()
    fields=('st_dev','st_ino','st_size','st_mode','st_uid','st_gid','st_mtime_ns','st_ctime_ns','st_nlink')
    need(all(getattr(before,k)==getattr(after,k)for k in fields),'observer_replacement_file_changed_during_read');return raw

def document(path,digest=None):
    raw=protected(path);need(digest is None or sha(raw)==pin(digest),'exact_observer_replacement_record_required');return json.loads(raw)
def module(path,digest):
    raw=protected(path);need(sha(raw)==digest,'exact_observer_replacement_component_required')
    n=types.ModuleType(Path(path).stem);n.__file__=str(path);exec(compile(raw,str(path),'exec'),n.__dict__);return n

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def directory():
    for p in BASE.parents:
        row=p.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==0 and not row.st_mode&0o022,'protected_replacement_journal_parent_required')
    if not os.path.lexists(BASE):BASE.mkdir(mode=0o700);sync(BASE.parent)
    row=BASE.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,'private_owned_replacement_journal_required')
def save(name,value):
    need(re.fullmatch(r'[a-z0-9-]+\.json',name),'fixed_replacement_journal_name_required')
    raw=encoded(value);fd=os.open(BASE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:out.write(raw);out.flush();os.fsync(out.fileno())
    sync(BASE);return sha(raw)
def record(name,digest=None):return document(BASE/name,digest)


def configuration(value):
    need(type(value)is dict and set(value)=={'format','predecessorObserverSha256','installationReceiptSha256','ordinaryRuntime'}and value['format']==FORMAT+'-input','fixed_replacement_input_shape_required')
    pin(value['predecessorObserverSha256']);pin(value['installationReceiptSha256'])
    need(type(value['ordinaryRuntime'])is dict and set(value['ordinaryRuntime'])=={'resultSha256','inputSha256'},'fixed_current_ordinary_source_refs_required')
    for v in value['ordinaryRuntime'].values():pin(v)
    return value


class Owner:
    def __init__(self,input_sha):
        self.input_sha=pin(input_sha);self.config=configuration(document(INPUT,input_sha))
        self.previous=module(PREVIOUS,PREVIOUS_SHA);self.old=self.previous.namespace()
        self.old_ack=self.previous.acknowledgement(self.config['predecessorObserverSha256'])
        self.old_value,self.old_result=self.old.owned_result(self.config['predecessorObserverSha256'])
        self.h=self.old.Host(self.old_result['readAdmissionSha256'],self.old_result['installationReceiptSha256'])
        self.installer=module(INSTALLER,INSTALLER_SHA);self.shared=self.installer.shared()
        self.original_command,self.environment=self.old.command()
        self.new_command=[*self.original_command[:-2],str(self.installer.TARGET/'dist/unified-observer.mjs'),'worker']
        import shlex
        self.drop=('[Service]\nExecStart=\nExecStart='+shlex.join(self.new_command)+'\n').encode()
    def installed(self):return self.installer.installed(self.shared,self.config['installationReceiptSha256'])
    def source(self):
        refs=self.config['ordinaryRuntime'];return module(INTAKE,INTAKE_SHA).validate_runtime(refs['resultSha256'],refs['inputSha256'])
    def preserved(self):
        old=self.old_value['binding']['preserved']
        # Old receipt is immutable ancestry. No old writer or whole role graph
        # is presented as current after replacement or later managed takeover.
        current={'source':self.h.direct_source(),'routes':self.h.direct_routes(),'supportRole':self.old.validate_role(self.h.query(self.old.role_sql()))}
        need(current=={k:old[k]for k in current},'same_registered_dataset_free_lanes_and_finite_support_authority_required')
        return {'predecessorSha256':self.config['predecessorObserverSha256'],'inputSha256':self.input_sha,'installation':self.installed(),**current}
    def manager(self,action):
        # The unchanged base manager has a 135-second bound. The 2a subclass
        # start hook targets its historical initial source and is not reused.
        return self.old.Host.__mro__[1].manager(self.h,action)
    def before(self):
        value=record('apply-intent.json');b=value['review']['binding']
        need(value['format']==FORMAT and value['operatorSha256']==own_sha()and value['inputSha256']==self.input_sha and
             value['review']['reviewHash']==sha(encoded(b))and b['bootId']==self.old.boot()and b['configuration']==self.config and value['automaticRetryAllowed']is False,
             'same_owned_observer_replacement_intent_required');return value
    def static(self,mode):
        b=self.before()['review']['binding'];old_installed=self.old.document(self.old.BASE/'unit-installed.json')
        need(self.old.identity(self.old.UNIT_FILE)==old_installed['identity']and sha(self.old.protected(self.old.UNIT_FILE))==self.old.TEMPLATE_SHA,
             'unchanged_original_observer_definition_required')
        self.old.check_boot(self.old_value)
        if mode=='new':
            made=record('drop-created.json')
            need(self.old.identity(DROP)==made['identity']and sha(protected(DROP))==made['sha256']==sha(self.drop)and
                 sorted(p.name for p in DROP.parent.iterdir())==[DROP.name], 'exact_owned_observer_entry_drop_required')
        else:need(not os.path.lexists(DROP.parent),'original_observer_drop_directory_must_be_absent')
        need(self.installed()==b['preserved']['installation'],'same_new_observer_artifact_required')
        return old_installed
    def scope(self,mode):
        # Reuse the frozen complete loaded-unit, cap0 peer and cgroup checks.
        # Only the explicit owned entry drop and owned start journal differ.
        n=self.previous.namespace();raw=n.protected(FROZEN);need(sha(raw)==FROZEN_SHA,'exact_frozen_observer_process_checks_required')
        tree=ast.parse(raw);fn=copy.deepcopy(next(v for v in tree.body if isinstance(v,ast.FunctionDef)and v.name=='unit_definition'))
        count=0
        for node in ast.walk(fn):
            if isinstance(node,ast.Dict):
                for i,key in enumerate(node.keys):
                    if isinstance(key,ast.Constant)and key.value=='DropInPaths':
                        need(isinstance(node.values[i],ast.Constant)and node.values[i].value=='','one_original_empty_drop_requirement_required')
                        node.values[i]=ast.Constant(str(DROP)if mode=='new'else'');count+=1
        need(count==1,'exact_one_owned_entry_drop_definition_seam_required')
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FROZEN),'exec'),n.__dict__)
        n.installed_unit=lambda _:self.static(mode);n.check_boot=lambda _:self.old.check_boot(self.old_value)
        n.start_intent=lambda _:self.start_record(mode)
        n.command=lambda:(self.new_command if mode=='new'else self.original_command,self.environment)
        n.BASE=BASE
        return n
    def start_record(self,mode):
        need(mode in {'new','old'},'fixed_owned_observer_mode_required')
        key='start-intent.json'if mode=='new'else'inverse-start-intent.json';value=record(key)
        need(value['format']==FORMAT and value['operatorSha256']==own_sha()and value['mode']==mode and value['bootId']==self.old.boot()and
             value['applyIntentSha256']==sha(protected(BASE/'apply-intent.json'))and value['inputSha256']==self.input_sha and
             type(value['earliestMonotonicUs'])is int and value['latestStartMonotonicUs']==value['earliestMonotonicUs']+135000000 and
             value['automaticRetryAllowed']is False,'exact_owned_observer_start_window_required');return value
    def live(self,mode):return self.scope(mode).live(self.h,self.old_value)
    def terminal(self,mode,actor):return self.scope(mode).terminal(self.h,self.old_value,actor)
    def begin_start(self,mode):
        key='start-intent.json'if mode=='new'else'inverse-start-intent.json';earliest=self.old.mono()
        save(key,{'format':FORMAT,'operatorSha256':own_sha(),'mode':mode,'bootId':self.old.boot(),'inputSha256':self.input_sha,
          'applyIntentSha256':sha(protected(BASE/'apply-intent.json')),'earliestMonotonicUs':earliest,'latestStartMonotonicUs':earliest+135000000,'automaticRetryAllowed':False})
        self.static(mode);state=self.h.state();need(state['MainPID']==state['ControlPID']=='0'and state['ActiveState']in{'inactive','failed'}and state['Job']in{'','0'},'terminal_observer_immediately_before_start_required')
        self.manager('start')
        actor=self.live(mode);save('started-actor.json'if mode=='new'else'inverse-started-actor.json',actor)
    def inspect(self,mode):
        # Fixed UID and command; one read-only native inspect, no RPC dispatch.
        n=self.scope(mode);h=n.Host(self.old_result['readAdmissionSha256'],self.old_result['installationReceiptSha256'])
        if mode=='new':h.installer=self.installer
        return h.peer_inspect()


def review(owner):
    need(not os.path.lexists(BASE/'apply-intent.json'),'replacement_attempt_already_exists')
    current=owner.previous.validate_current(owner.config['predecessorObserverSha256'])
    source=owner.source();preserved=owner.preserved();owner.installed();capacity=owner.h.capacity()
    need(owner.old.live(owner.h,owner.old_value)==current['actor']and owner.source()==source and owner.preserved()==preserved,
         'same_original_observer_source_and_inputs_during_review')
    binding={'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':owner.input_sha,'configuration':owner.config,'bootId':owner.old.boot(),
      'oldActor':current['actor'],'oldBoot':current['bootLink'],'sourceAtTransition':source,'preserved':preserved,'dropSha256':sha(owner.drop)}
    return {'binding':binding,'reviewHash':sha(encoded(binding)),'capacity':capacity,'controlObservation':owner.h.control(),'serviceActions':0,'databaseWrites':0,'providerRequests':0}


def acknowledge(owner,mode):
    value=owner.before();intent=owner.start_record(mode);preserved=owner.preserved();actor=owner.live(mode);inspected=owner.inspect(mode)
    need(preserved['source']['dataIdentity']['sourceRelease']==owner.old.RELEASE,'exact_registered_release_in_observer_ACK_required')
    if mode=='new':
        need(owner.source()==value['review']['binding']['sourceAtTransition'],'same_current_source_before_new_observer_ACK')
        prior=record('old-stopped.json')['controlRevisions'];deadline=owner.old.time.monotonic()+90
        while not owner.old.first_cycle_complete(owner.h.control(),prior):
            need(owner.old.time.monotonic()<deadline,'new_observer_first_cycle_pending_inspect_without_retry')
            need(owner.live(mode)==actor,'new_observer_changed_before_first_cycle');owner.old.time.sleep(1)
    need(owner.preserved()==preserved and owner.live(mode)==actor,'same_replacement_observer_before_ACK')
    if mode=='new':need(owner.source()==value['review']['binding']['sourceAtTransition'],'same_current_source_after_new_observer_ACK')
    result={'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':owner.input_sha,'applyIntentSha256':sha(encoded(value)),
      'startIntentSha256':sha(encoded(intent)),'mode':mode,'actor':actor,'dataIdentity':preserved['source']['dataIdentity'],'releaseId':owner.old.RELEASE,
      'initialSourceContext':value['review']['binding']['sourceAtTransition'],'predecessorObserverSha256':owner.config['predecessorObserverSha256'],
      'predecessorProducerSha256':PREVIOUS_SHA,'installationReceiptSha256':owner.config['installationReceiptSha256'],
      'observerScopeOnly':True,'ordinarySustainedObserver':True,'observerCurrentQualified':True,'runtimeMaximumSeconds':None,
      'sourceActorQualified':False,'currentWriterQualified':False,'sourceCoverageAccepted':False,'readerSelectionsQualified':False,
      'original143CurrentWholeValidatorPassed':False,'freeOnly':True,'paidAuthority':False,'receiptHistoryEnabled':False,
      'sourceOrConsumerMutations':0,'readOnlyInspect':inspected,'bootLink':value['review']['binding']['oldBoot'],
      'reconciled':False,'automaticRetryAllowed':False}
    key='result.json'if mode=='new'else'inverse-result.json'
    if os.path.lexists(BASE/key):
        saved=record(key);need({k:v for k,v in saved.items()if k!='readOnlyInspect'}=={k:v for k,v in result.items()if k!='readOnlyInspect'},'same_once_observer_replacement_ACK_required');result=saved
    else:save(key,result)
    return {**result,'receiptSha256':sha(encoded(result))}


def apply(owner,expected):
    current=review(owner);need(current['reviewHash']==pin(expected),'exact_current_observer_replacement_review_required')
    directory();save('apply-intent.json',{'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':owner.input_sha,'review':current,'automaticRetryAllowed':False})
    actor=current['binding']['oldActor']
    save('old-stop-intent.json',{'actor':actor,'applyIntentSha256':sha(protected(BASE/'apply-intent.json')),'automaticRetryAllowed':False})
    need(owner.old.live(owner.h,owner.old_value)==actor and owner.source()==current['binding']['sourceAtTransition'],'same_old_observer_and_source_before_stop')
    need(owner.old.live(owner.h,owner.old_value)==actor,'same_old_observer_after_last_source_check')
    owner.manager('stop');owner.old.terminal(owner.h,owner.old_value,actor)
    save('old-stopped.json',{'actor':actor,'controlRevisions':{str(row['chainId']):row['revision']for row in owner.h.control()}})
    need(owner.preserved()==current['binding']['preserved']and owner.source()==current['binding']['sourceAtTransition'],'same_source_and_inputs_after_old_observer_stop')
    save('drop-intent.json',{'path':str(DROP),'sha256':sha(owner.drop)})
    DROP.parent.mkdir(mode=0o755);sync(DROP.parent.parent)
    save('drop-directory.json',{'identity':owner.old.identity(DROP.parent)})
    fd=os.open(DROP,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:out.write(owner.drop);out.flush();os.fsync(out.fileno())
    sync(DROP.parent);save('drop-created.json',{'identity':owner.old.identity(DROP),'sha256':sha(owner.drop)})
    owner.manager('daemon-reload');owner.static('new')
    need(owner.source()==current['binding']['sourceAtTransition'],'same_source_before_new_observer_start')
    owner.begin_start('new');return acknowledge(owner,'new')


def recorded(receipt_sha):
    pin(receipt_sha)
    name='inverse-result.json'if os.path.lexists(BASE/'inverse-result.json')and sha(protected(BASE/'inverse-result.json'))==receipt_sha else'result.json'
    result=record(name,receipt_sha);owner=Owner(result['inputSha256']);intent=owner.before();mode=result['mode']
    need(mode in {'new','old','old-untouched'}and(name=='result.json')==(mode=='new'),'exact_observer_result_mode_required')
    start=owner.start_record(mode)if mode!='old-untouched'else None
    if mode!='new':
        inverse=record('inverse-intent.json')
        need(inverse['format']==FORMAT and inverse['operatorSha256']==own_sha()and inverse['applyIntentSha256']==sha(encoded(intent))and inverse['automaticRetryAllowed']is False,
             'actual_own_observer_inverse_chain_required')
    need(result['format']==FORMAT and result['operatorSha256']==own_sha()and
         result['applyIntentSha256']==sha(encoded(intent))and result['startIntentSha256']==sha(encoded(start))and
         result['predecessorObserverSha256']==owner.config['predecessorObserverSha256']and result['predecessorProducerSha256']==PREVIOUS_SHA and
         result['initialSourceContext']==intent['review']['binding']['sourceAtTransition']and
         result['dataIdentity']==intent['review']['binding']['preserved']['source']['dataIdentity']and
         result['releaseId']==result['dataIdentity']['sourceRelease']==owner.old.RELEASE,
         'exact_new_observer_activation_ancestry_required')
    need(all(result[k]is True for k in ['observerScopeOnly','ordinarySustainedObserver','freeOnly'])and
         all(result[k]is False for k in ['sourceActorQualified','currentWriterQualified','sourceCoverageAccepted','readerSelectionsQualified','original143CurrentWholeValidatorPassed','paidAuthority','receiptHistoryEnabled','automaticRetryAllowed'])and
         result['sourceOrConsumerMutations']==0 and result['runtimeMaximumSeconds']is None,'narrow_observer_only_ack_scope_required')
    return owner,result

def acknowledgement(receipt_sha):
    _,result=recorded(receipt_sha)
    return {**result,'receiptSha256':receipt_sha,'recordedActivationQualified':True,'observerCurrentQualified':False,'databaseWrites':0,'serviceActions':0,'providerRequests':0}

def validate_current(receipt_sha):
    owner,result=recorded(receipt_sha);mode=result['mode']
    if mode=='new':need(not os.path.lexists(BASE/'inverse-intent.json'),'observer_inverse_already_started')
    def actor():
        return owner.previous.validate_current(owner.config['predecessorObserverSha256'])['actor']if mode=='old-untouched'else owner.live(mode)
    first=owner.preserved();need(actor()==result['actor'],'same_acknowledged_observer_epoch_required')
    if mode!='old-untouched':owner.inspect(mode)
    need(owner.preserved()==first and actor()==result['actor'],'observer_or_scope_changed_during_current_validation')
    return {**acknowledgement(receipt_sha),'validated':True,'observerCurrentQualified':True}


def partial_terminal(owner,actor=None):
    """An owned partial definition may be loaded before or after daemon reload."""
    value=owner.before();old=value['review']['binding']['oldActor'];unit=owner.old.document(owner.old.BASE/'unit-installed.json')
    need(owner.old.identity(owner.old.UNIT_FILE)==unit['identity']and sha(owner.old.protected(owner.old.UNIT_FILE))==owner.old.TEMPLATE_SHA,
         'same_original_unit_before_partial_inverse_required');owner.old.check_boot(owner.old_value)
    row=owner.h.state()
    need(row['MainPID']==row['ControlPID']=='0'and row['Job']in{'','0'}and row['ActiveState']in{'inactive','failed'}and
         row['DropInPaths']in{'',str(DROP)},'terminal_owned_partial_observer_required')
    cg=Path('/sys/fs/cgroup/system.slice')/owner.old.UNIT/'cgroup.procs'
    need(not cg.exists()or not cg.read_text().split(),'empty_observer_cgroup_before_partial_inverse_required')
    if actor is None:
        if os.path.lexists(BASE/'start-intent.json'):
            start=owner.start_record('new');started=int(row['ExecMainStartTimestampMonotonic'])
            need(start['earliestMonotonicUs']<=started<=start['latestStartMonotonicUs']and re.fullmatch('[a-f0-9]{32}',row['InvocationID']),
                 'owned_terminal_unknown_start_window_required')
        else:actor=old
    if actor is not None:
        need(row['InvocationID']==actor['invocation']and int(row['ExecMainStartTimestampMonotonic'])==actor['startMonotonicUs']and
             not Path('/proc/'+str(actor['pid'])).exists(),'same_known_terminal_observer_epoch_required')
    need(not Path('/proc/'+str(old['pid'])).exists(),'original_observer_process_must_be_gone')
    return row


def inverse(owner,expected=None,finish=False):
    value=owner.before()
    if not finish:
        need(not os.path.lexists(BASE/'inverse-intent.json'),'one_observer_inverse_attempt_only')
        need(expected is not None,'actual_apply_or_result_receipt_required_for_inverse')
        if expected!=sha(protected(BASE/'apply-intent.json')):recorded(expected)
        actor=None
        if os.path.lexists(BASE/'start-intent.json'):
            state=owner.h.state()
            if state['ActiveState']=='active':actor=owner.live('new')
            else:
                actor=record('started-actor.json')if os.path.lexists(BASE/'started-actor.json')else None
                partial_terminal(owner,actor)
            if actor is not None and os.path.lexists(BASE/'result.json'):
                _,result=recorded(sha(protected(BASE/'result.json')));need(actor==result['actor'],'same_new_observer_before_inverse')
        save('inverse-intent.json',{'format':FORMAT,'operatorSha256':own_sha(),'applyIntentSha256':sha(encoded(value)),
          'actor':actor,'automaticRetryAllowed':False,'oldObserverSha256':owner.config['predecessorObserverSha256']})
        if actor is not None and owner.h.state()['ActiveState']=='active':
            save('inverse-stop-intent.json',{'actor':actor,'automaticRetryAllowed':False});need(owner.live('new')==actor,'same_new_observer_after_inverse_stop_intent');owner.manager('stop')
    inv=record('inverse-intent.json',expected if finish else None)
    need(inv['format']==FORMAT and inv['operatorSha256']==own_sha()and inv['applyIntentSha256']==sha(encoded(value))and inv['automaticRetryAllowed']is False,'same_observer_inverse_intent_required')
    if os.path.lexists(BASE/'inverse-start-intent.json'):return acknowledge(owner,'old')
    if not os.path.lexists(BASE/'start-intent.json')and not os.path.lexists(DROP.parent)and owner.h.state()['ActiveState']=='active':
        current=owner.previous.validate_current(owner.config['predecessorObserverSha256'])
        need(current['actor']==value['review']['binding']['oldActor'],'same_untouched_original_observer_required')
        need(value['review']['binding']['preserved']['source']['dataIdentity']['sourceRelease']==owner.old.RELEASE,'exact_untouched_observer_release_required')
        result={'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':owner.input_sha,'mode':'old-untouched',
          'applyIntentSha256':sha(encoded(value)),'startIntentSha256':sha(encoded(None)),
          'inverseIntentSha256':sha(protected(BASE/'inverse-intent.json')),'predecessorObserverSha256':owner.config['predecessorObserverSha256'],
          'predecessorProducerSha256':PREVIOUS_SHA,'initialSourceContext':value['review']['binding']['sourceAtTransition'],
          'dataIdentity':value['review']['binding']['preserved']['source']['dataIdentity'],
          'releaseId':owner.old.RELEASE,
          'actor':current['actor'],'observerCurrentQualified':True,'serviceActions':0,'sourceOrConsumerMutations':0,
          'observerScopeOnly':True,'ordinarySustainedObserver':True,'freeOnly':True,'sourceActorQualified':False,'currentWriterQualified':False,
          'sourceCoverageAccepted':False,'readerSelectionsQualified':False,'original143CurrentWholeValidatorPassed':False,
          'paidAuthority':False,'receiptHistoryEnabled':False,'automaticRetryAllowed':False,'runtimeMaximumSeconds':None,
          'bootLink':value['review']['binding']['oldBoot']}
        if not os.path.lexists(BASE/'inverse-result.json'):save('inverse-result.json',result)
        need(record('inverse-result.json')==result,'same_untouched_inverse_ACK_required');return {**result,'receiptSha256':sha(encoded(result))}
    partial_terminal(owner,inv['actor'])
    if os.path.lexists(DROP):
        owner.static('new')
        if not os.path.lexists(BASE/'drop-remove-intent.json'):save('drop-remove-intent.json',record('drop-created.json'))
        need(record('drop-remove-intent.json')==record('drop-created.json'),'same_owned_drop_removal_intent_required')
        need(owner.old.identity(DROP)==record('drop-created.json')['identity'],'same_owned_drop_before_remove');DROP.unlink();sync(DROP.parent)
    if os.path.lexists(DROP.parent):
        need(owner.old.identity(DROP.parent)==record('drop-directory.json')['identity']and not list(DROP.parent.iterdir()),'same_empty_owned_drop_directory_before_remove')
        DROP.parent.rmdir();sync(DROP.parent.parent)
    owner.manager('daemon-reload');owner.static('old');owner.begin_start('old');return acknowledge(owner,'old')


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-sha');g=p.add_mutually_exclusive_group()
    for name in ['apply','reconcile','inverse','finish-inverse','current','acknowledgement']:g.add_argument('--'+name)
    a=p.parse_args()
    if not any(vars(a).values()):print(json.dumps({'format':FORMAT,'staticOnly':True,'serviceActions':0,'databaseWrites':0,'providerRequests':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_host_for_observer_replacement_required');os.umask(0o077)
    if a.current or a.acknowledgement:
        value=validate_current(a.current)if a.current else acknowledgement(a.acknowledgement)
    else:
        owner=Owner(pin(a.input_sha))
        with owner.h.source.transition_lock():
            if a.apply:value=apply(owner,a.apply)
            elif a.reconcile:
                record('start-intent.json',pin(a.reconcile));need(not os.path.lexists(BASE/'inverse-intent.json'),'only_uninversed_start_may_reconcile');value=acknowledge(owner,'new')
            elif a.inverse:value=inverse(owner,pin(a.inverse))
            elif a.finish_inverse:value=inverse(owner,pin(a.finish_inverse),True)
            else:
                value=review(owner);directory();digest=save('review-'+str(owner.old.mono())+'.json',value)
                value={'reviewHash':value['reviewHash'],'privateReviewSha256':digest,'serviceActions':0,'databaseWrites':0,'providerRequests':0}
    print(json.dumps({k:v for k,v in value.items()if k in {'format','mode','reviewHash','privateReviewSha256','recordedActivationQualified','observerCurrentQualified','receiptSha256','serviceActions','databaseWrites','providerRequests','sourceOrConsumerMutations'}},sort_keys=True))


if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_observer_replacement_expired_inspect_without_retry'));signal.alarm(720)
    try:main()
    except Exception as error:print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
    finally:signal.alarm(0)
