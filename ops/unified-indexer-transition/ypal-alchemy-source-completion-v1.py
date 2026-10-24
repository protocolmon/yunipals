#!/usr/bin/env python3
"""Complete the actual pending source start with restored three RW mounts.

The frozen 440f operation/intent and 91 adapter are historical parents. This
producer owns a fresh start intent and ACK; it never emits their start ACK.
"""
import argparse
import ast
import copy
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT = "yunipals-alchemy-source-completion-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-alchemy-source-completion-v1-20261024")
HOLD = Path("/etc/systemd/system/.ypal-alchemy-source-completion-v1")
ADAPTER = OPS / "ypal-alchemy-controlpid-adapter-v1.py"
ADAPTER_SHA = "91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770"
HOST_SHA = "3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02"
PENDING_SHA = "77060ef44e0719feed291d90d7fc909be8dfc84818a6a96347d247262eac303d"
BIND_RESULT = Path("/var/backups/yunipals-alchemy-cache-bindfix-v1-20261024/result.json")
BIND_RESULT_SHA = "46a04f453fe8cb3b249facc9137a1d5478fb3f8ae80ff6f69daabd0b830d1b07"
ZZ = Path("/etc/systemd/system/yunipals-ypal-combined-source.service.d/zz-source-completion-bindings-v1.conf")
GUARD_DROP = "10-source-completion-v1.conf"
SOURCE = "yunipals-ypal-combined-source.service"


def need(ok, code):
    if not ok: raise RuntimeError(code)


def load():
    import hashlib
    for path in [*ADAPTER.parents, ADAPTER]:
        st=path.lstat();need(st.st_uid==0 and not st.st_mode&0o022 and not path.is_symlink(),"protected_exact_adapter_source_required")
    raw=ADAPTER.read_bytes();need(hashlib.sha256(raw).hexdigest()==ADAPTER_SHA,"exact_executed_adapter_parent_required")
    a=types.ModuleType("actual_91_adapter");a.__file__=str(ADAPTER);exec(compile(raw,str(ADAPTER),"exec"),a.__dict__)
    v=a.business();ns,c,owner,_=v.build(a.MANIFEST_SHA,a.INPUT_SHA);a.adapt(owner,ns)
    need(owner.digest("operation.json")==a.OPERATION_SHA and owner.digest("source-paid-start-intent.json")==PENDING_SHA and
         not owner.exists("source-paid-started.json") and not owner.exists("result.json"),"exact_pending_parent_without_fabricated_start_ACK_required")
    return Completion(a,v,ns,c,owner)


class Completion:
    def __init__(self,a,v,ns,c,owner):
        self.a,self.v,self.ns,self.c,self.owner=a,v,ns,c,owner;self.h,self.m,self.p,self.leaf=owner.h,owner.m,owner.p,owner.leaf
        self.original_epoch=self.h.source_epoch
        self.loaded=self.method(ns.Owner.loaded_source,"loaded_source")
        epoch=self.method(c.host_module.Host.source_epoch,"source_epoch")
        def source_epoch(op,intent,mode,allow_restart_for_stop=False):
            if mode=="paid" and (BASE/"start-intent.json").exists():intent=self.record("start-intent.json")
            return epoch(op,intent,mode,allow_restart_for_stop)
        self.h.source_epoch=source_epoch;owner.loaded_source=self.loaded
        original_known=owner.known_source_processes
        def known():
            rows={(p['pid'],p['startTicks']):p for p in original_known()}
            if (BASE/'result.json').exists():
                for p in self.record('result.json')['source']['processes']:rows[(p['pid'],p['startTicks'])]=p
            return list(rows.values())
        owner.known_source_processes=known

    def producer(self):return self.ns.sha(self.m.protected(Path(__file__).absolute()))
    def digest(self,name):return self.ns.sha(self.m.protected(BASE/name))
    def save(self,name,value):return self.m.save(BASE/name,value)
    def envelope(self,**values):
        return {'format':FORMAT,'operatorSha256':self.producer(),'businessSha256':self.a.BUSINESS_SHA,'adapterSha256':ADAPTER_SHA,
                'operationSha256':self.a.OPERATION_SHA,'parentStartIntentSha256':PENDING_SHA,'bootId':self.m.boot(),**values}
    def record(self,name):
        row=self.m.document(BASE/name)
        need(all(row[key]==value for key,value in self.envelope().items()),'exact_same_boot_completion_record_required')
        return row

    def capture(self,bindfix_sha):
        need(bindfix_sha==BIND_RESULT_SHA,'actual_root_bindfix_receipt_hash_required')
        self.a.audit(self.owner,self.ns,False)
        value=self.envelope(bindfixReceiptSha256=bindfix_sha)
        if not (BASE/'context.json').exists():
            need(not os.path.lexists(BASE),'fresh_completion_audit_directory_required');BASE.mkdir(mode=0o700);self.m.sync(BASE.parent);self.save('context.json',value)
        need(self.record('context.json')==value,'same_actual_bindfix_and_completion_context_required')
        return self.bindfix()

    def bindfix(self):
        context=self.record('context.json');result=self.m.document(BIND_RESULT,context['bindfixReceiptSha256'])
        # Root's immutable bindfix receipt is authenticated as data, never run.
        need(result['operationSha256']==self.a.OPERATION_SHA and result['businessSha256']==self.a.BUSINESS_SHA and result['bootId']==self.m.boot() and
             result['completed'] is True and result['sourceStarted'] is False,'actual_root_owned_three_RW_bindfix_required')
        item=result['file'];need(item['path']==str(ZZ),'only_exact_root_bindfix_file_may_be_adopted')
        target=ZZ if os.path.lexists(ZZ)else HOLD/'zz.removed.conf'
        need(self.ns.sha(self.leaf.protected(target))==item['sha256'] and self.leaf.file_identity(target)==item['identity'],
             'same_root_acknowledged_bindfix_bytes_and_inode_required')
        return result

    def runtime_current(self,host,op):
        current=host.source.runtime_properties();before=op['sourceRuntime']
        need('BindPaths'in current and 'BindPaths'in before and {k:v for k,v in current.items()if k!='BindPaths'}=={k:v for k,v in before.items()if k!='BindPaths'},
             'all_nonrendered_runtime_properties_must_remain_exact')
        bindings=self.c.source_bindings()
        need(bindings['BindPaths']==op['sourceBindings']['BindPaths'] and bindings['BindPaths']['type']=='a(ssbt)' and
             len(bindings['BindPaths']['data'])==3,'actual_three_original_RW_bindings_required_zero_RW_refused')
        return True

    def definitions_current(self,host,wanted,mode):
        actual=host.definitions(host.source.state(SOURCE));expected=dict(wanted)
        if mode=='paid':
            item=self.bindfix()['file'];need(os.path.lexists(ZZ),'actual_RW_bindfix_must_be_loaded_for_paid_source')
            expected[str(ZZ)]={'sha256':item['sha256'],'identity':item['identity']}
        else:need(not os.path.lexists(ZZ),'bindfix_must_be_removed_before_original_free_configuration')
        return actual==expected

    def method(self,original,name):
        key,klass=('business','Owner')if name=='loaded_source'else('host','Host')
        file,digest=self.v.FILES[key];raw=self.m.protected(self.v.OPS/file)
        need(self.ns.sha(raw)==digest,'exact_frozen_method_source_required')
        module=ast.parse(raw);classes=[node for node in module.body if isinstance(node,ast.ClassDef)and node.name==klass]
        need(len(classes)==1,'one_exact_frozen_business_class_required')
        methods=[node for node in classes[0].body if isinstance(node,ast.FunctionDef)and node.name==name]
        need(len(methods)==1,'one_exact_frozen_business_method_required')
        tree=ast.Module(body=[methods[0]],type_ignores=[]);changes={'definitions':0,'runtime':0}
        class Predicates(ast.NodeTransformer):
            def visit_Compare(visitor,node):
                text=ast.unparse(node)
                if text in {'self.definitions(state) == definitions','self.h.definitions(state) == definitions'}:
                    changes['definitions']+=1
                    host='self'if name=='source_epoch'else'self.h'
                    return ast.copy_location(ast.parse('completion_definitions('+host+', definitions, mode)',mode='eval').body,node)
                if text in {"self.source.runtime_properties() == operation['sourceRuntime']","self.h.source.runtime_properties() == op['sourceRuntime']"}:
                    changes['runtime']+=1
                    host,op=('self','operation')if name=='source_epoch'else('self.h','op')
                    return ast.copy_location(ast.parse('completion_runtime('+host+', '+op+')',mode='eval').body,node)
                return visitor.generic_visit(node)
        tree=Predicates().visit(tree);ast.fix_missing_locations(tree)
        need(changes=={'definitions':1,'runtime':1},'exact_two_explicit_definition_and_runtime_predicate_seams_required')
        scope=dict(original.__globals__);scope.update(completion_definitions=self.definitions_current,completion_runtime=self.runtime_current)
        exec(compile(tree,str(Path(__file__).absolute()),'exec'),scope)
        return types.MethodType(scope[name],self.h if name=='source_epoch'else self.owner)

    def guard_path(self,name):return self.a.SYSTEM/(name+'.d')/GUARD_DROP
    def guard_bytes(self,name):
        flag='--deadline-utc'if'-utc-'in name else'--deadline-close'
        return ('[Service]\nExecStart=\nExecStart=/usr/bin/python3 -I -B '+str(Path(__file__).absolute())+' '+flag+' '+self.owner.operation()['planSha256']+
                '\nReadWritePaths='+str(BASE)+'\n').encode()

    def install_guards(self):
        self.bindfix();audit=self.a.audit(self.owner,self.ns,False);old=self.m.document(self.a.BASE/'guards.json')
        services=[name for name in old['files']if name.endswith('.service')]
        need(len(services)==2,'only_two_existing_supplemental_services_allowed')
        if not HOLD.exists():HOLD.mkdir(mode=0o700);self.p.sync(HOLD.parent)
        if not (BASE/'guard-overlays.json').exists():
            files={}
            for name in services:
                target=self.guard_path(name);need(not os.path.lexists(target),'fresh_owned_guard_ExecStart_dropin_required')
                files[name]=self.p.exclusive(HOLD/(name+'.conf'),self.guard_bytes(name),0o644)
            self.save('guard-overlays.json',self.envelope(adapterCompositionSha256=audit,files=files))
        row=self.record('guard-overlays.json')
        for name,item in row['files'].items():
            target=self.guard_path(name)
            if not target.parent.exists():target.parent.mkdir(mode=0o755);self.p.sync(target.parent.parent)
            if not os.path.lexists(target):
                intent=name+'.publish-intent.json'
                if not(BASE/intent).exists():self.save(intent,self.envelope(file=item))
                self.p.move_owned(HOLD/(name+'.conf'),target,item)
            need(self.ns.sha(self.leaf.protected(target))==item['sha256'] and self.leaf.file_identity(target)==self.ns.six(item['identity']),
                 'exact_owned_guard_overlay_inode_required')
        if not(BASE/'reload-intent.json').exists():
            self.save('reload-intent.json',self.envelope())
            self.h.manager('daemon-reload');self.save('reload-ack.json',self.envelope(acknowledged=True))
        need(self.record('reload-ack.json')['acknowledged']is True,'unknown_guard_reload_requires_explicit_inspection')
        self.guards_current();return {'guardOverlaysInstalled':True}

    def guards_current(self):
        row=self.record('guard-overlays.json');base=self.m.document(self.a.BASE/'guards.json');plan=self.owner.operation()['financialPlan']
        for name,item in base['files'].items():
            path=self.a.SYSTEM/name
            need(self.ns.sha(self.leaf.protected(path))==item['sha256'] and self.leaf.file_identity(path)==self.ns.six(item['identity']),
                 'original_91_guard_definition_must_stay_exact')
            fields=['Id','FragmentPath','DropInPaths','ActiveState','UnitFileState']+(['MainPID']if name.endswith('.service')else[])
            state=self.leaf.manager_properties(self.h.rpc_m,name,fields)
            need(state['Id']==name and state['FragmentPath']==str(path),'same_actual_91_guard_unit_required')
            obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum()else'_'+format(ord(c),'02x')for c in name)
            job=json.loads(self.m.command(['/usr/bin/busctl','--json=short','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Unit','Job']))
            need(job=={'type':'(uo)','data':[0,'/']},'current_extended_guard_manager_must_have_no_job')
            if name.endswith('.service'):
                need(state['ActiveState']=='inactive'and state['MainPID']=='0','extended_cleanup_service_must_be_dormant_before_paid_start')
                overlay=self.guard_path(name);saved=row['files'][name]
                need(state['DropInPaths'].split()==[str(overlay)] and self.ns.sha(self.leaf.protected(overlay))==saved['sha256'] and
                     self.leaf.file_identity(overlay)==self.ns.six(saved['identity']) and self.leaf.protected(overlay)==self.guard_bytes(name),
                     'exact_owned_extended_guard_definition_required')
                typed=self.v.typed_command(self.m,name);flag='--deadline-utc'if'-utc-'in name else'--deadline-close'
                wanted=['/usr/bin/python3','-I','-B',str(Path(__file__).absolute()),flag,self.owner.operation()['planSha256']]
                need(typed['type']=='a(sasbttttuii)'and len(typed['data'])==1 and typed['data'][0][:3]==['/usr/bin/python3',wanted,False],
                     'actual_guard_ExecStart_must_invoke_completion_cleanup')
            else:
                need(not state['DropInPaths'] and state['ActiveState']=='active'and state['UnitFileState']=='enabled'and
                     self.leaf.link_record(self.a.SYSTEM/'timers.target.wants'/name)==base['bootLinks'][name],
                     'same_actual_91_timer_activation_required')
                due=plan['nextUtcMs']if'-utc-'in name else plan['expiresMs']-300000
                need(self.leaf.timer_due(self.h.rpc_m,name)==due*1000,'same_original_2340_and_UTC_guard_calendars_required')
        return {'validated':True,'original91WholeGuardValidatorPassed':False,'newGuardCompositionQualified':True}

    def start(self):
        self.bindfix();op=self.owner.operation();self.guards_current()
        need(os.path.lexists(ZZ),'real_three_RW_bindfix_required_before_start')
        if not(BASE/'start-intent.json').exists():
            self.owner.source_context();self.owner.routes_current('paid');self.owner.admission(active=True);self.loaded('paid')
            self.owner.terminal(SOURCE,self.owner.known_source_processes())
            self.no_start_effect()
            native=self.h.source.native();self.h.r.recovery_floor(op['native'],native)
            need(str(native['app']['is_locked'])=='0'or native['clock']>=int(native['app']['heartbeat_at'])+25000,'official_Ponder_lock_wait_before_completion_start')
            cache=self.c.cache.validate_restart_capture(self.h.source.query,op['financialPlan'],native)
            need(cache['validated']is cache['cacheCoverageQualified']is True and cache['providerCalls']==cache['databaseWrites']==0,
                 'actual_cache_continuity_required_before_completion_start')
            self.save('start-intent.json',self.envelope(notBeforeUs=self.m.mono(),preStartDatabaseClock=native['clock'],
                 predecessorHeartbeat=int(native['app']['heartbeat_at']),restartCacheProof=cache,bindfixReceiptSha256=self.record('context.json')['bindfixReceiptSha256']))
            self.owner.admission(active=True);self.owner.routes_current('paid');self.guards_current()
            self.loaded('paid');self.owner.terminal(SOURCE,self.owner.known_source_processes());self.no_start_effect()
            self.h.manager('start',SOURCE)
        actor,native=self.ns.wait_read(lambda:self.h.source_epoch(op,self.record('start-intent.json'),'paid'))
        sessions=self.h.source_sessions(actor);self.ns.native_order(native);self.owner.admission(active=True);self.owner.routes_current('paid')
        self.owner.source_context();self.loaded('paid');self.guards_current()
        need(self.h.source_epoch(op,self.record('start-intent.json'),'paid')[0]==actor,'same_actual_completion_epoch_after_positive_backend_proof')
        if not(BASE/'result.json').exists():self.save('result.json',self.envelope(completed=True,source=actor,native=native,sourceKernelSessions=sessions,
             startIntentSha256=self.digest('start-intent.json'),original440PaidStartAcknowledged=False))
        need(self.record('result.json')['source']==actor,'same_own_acknowledged_completion_source_required')
        return {'sourceStarted':True,'completionResultSha256':self.digest('result.json'),'sourcePID':actor['parent']['pid'],
                'original440PaidStartAcknowledged':False,'financialAuthorityQualified':False}

    def no_start_effect(self):
        state=self.h.source.state(SOURCE);pending=self.owner.journal('source-paid-start-intent.json')
        need(state['MainPID']==state['ControlPID']=='0'and state['NRestarts']=='0'and state['Job']in{'','0'}and
             int(state['ExecMainStartTimestampMonotonic'])<pending['notBeforeUs'],
             'actual_no_start_effect_of_original_pending_intent_required')

    def qualify(self):
        self.bindfix();self.owner.source_context();self.owner.routes_current('paid');self.owner.admission(active=True)
        self.loaded('paid');self.owner.terminal(SOURCE,self.owner.known_source_processes());self.no_start_effect()
        return {'qualified':True,'actualThreeRWAndThreeROBindings':True,'oldPendingStartHasNoEffect':True,
                'newStartIntentCreated':False,'serviceActions':0,'databaseWrites':0,'providerCalls':0}

    def current(self):
        receipt=self.record('result.json')
        need(receipt['completed']is True and receipt['original440PaidStartAcknowledged']is False and
             receipt['startIntentSha256']==self.digest('start-intent.json'),'actual_own_completion_ACK_chain_required')
        actor,native=self.h.source_epoch(self.owner.operation(),self.record('start-intent.json'),'paid')
        need(actor==receipt['source'],'same_current_acknowledged_completion_epoch_required')
        self.loaded('paid');self.guards_current();self.owner.routes_current('paid');self.owner.admission(active=True)
        sessions=self.h.source_sessions(actor)
        need(self.h.source_epoch(self.owner.operation(),self.record('start-intent.json'),'paid')[0]==actor,'completion_current_final_actor_CAS_required')
        return {'validated':True,'completionResultSha256':self.digest('result.json'),'currentWriterQualified':True,
                'sourcePID':actor['parent']['pid'],'sourceReadinessQualified':str(native['app']['is_ready'])=='1',
                'financialAuthorityQualified':False,'original440PaidStartAcknowledged':False,'positiveKernelSessions':sum(len(v)for v in sessions.values())}

    def remove_bindfix(self):
        item=self.bindfix()['file'];target=HOLD/'zz.removed.conf'
        if not os.path.lexists(ZZ):
            need(self.ns.sha(self.leaf.protected(target))==item['sha256']and self.leaf.file_identity(target)==item['identity'],'same_owned_removed_bindfix_required');return
        self.owner.process_terminal(SOURCE,self.owner.known_source_processes());self.c.remaining_source_facts()
        if not(BASE/'bindfix-remove-intent.json').exists():self.save('bindfix-remove-intent.json',self.envelope(file=item))
        self.p.move_owned(ZZ,target,{'sha256':item['sha256'],'identity':self.p.identity(ZZ)})

    def close(self,utc=False,resume=False):
        result=self.owner.close(utc=utc,resume=False)
        self.remove_bindfix()
        if resume and result.get('sourceRestorePending'):
            return self.owner.start_source('free')
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--bindfix-sha')
    group=parser.add_mutually_exclusive_group()
    for flag in ['capture','qualify','install-guards','start','current','close','utc','resume-free']:group.add_argument('--'+flag,action='store_true')
    group.add_argument('--deadline-close');group.add_argument('--deadline-utc');args=parser.parse_args()
    if not any(v for k,v in vars(args).items()if k!='bindfix_sha'):
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'serviceActions':0,'databaseWrites':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_production_root_host_required')
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_unknown_outcome_no_retry'));signal.alarm(850)
    c=load()
    with c.v.transition_lock(c.m):
        if args.capture:value={'captured':True,'bindfixCompleted':c.capture(args.bindfix_sha)['completed']}
        elif args.qualify:value=c.qualify()
        elif args.install_guards:value=c.install_guards()
        elif args.start:value=c.start()
        elif args.current:value=c.current()
        elif args.resume_free:c.remove_bindfix();value=c.owner.start_source('free')
        else:
            if args.deadline_close or args.deadline_utc:need((args.deadline_close or args.deadline_utc)==c.owner.operation()['planSha256'],'same_original_deadline_plan_required')
            value=c.close(utc=bool(args.utc or args.deadline_utc),resume=bool(args.deadline_close))
    print(json.dumps(value,sort_keys=True))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
