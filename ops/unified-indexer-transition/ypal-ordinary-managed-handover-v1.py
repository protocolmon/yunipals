#!/usr/bin/env python3
"""Once-only ordinary EVM/Solana service lifecycle; no policy, SQL or reader writes.

The observer remains independent. The new foundation produces its own actual
managed epoch ACK; neither old standalone nor consumer acceptance is relabelled.
"""
import argparse
import ast
import copy
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import types

FORMAT = 'yunipals-ordinary-managed-handover-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ordinary-managed-handover-v1-20261025')
HOLD = Path('/etc/systemd/system/.ordinary-managed-handover-v1')
FOUNDATION = OPS / 'ypal-ordinary-managed-runtime-v1.py'
FOUNDATION_SHA = 'bdaa7a51ed190757567eef4913953a83d7016735f0ae4ebb35599cbcb3b23a63'
TEMPLATE = OPS / 'ypal-managed-handover-v1.py'
TEMPLATE_SHA = 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea'
KERNEL = OPS / 'ypal-native-cutover-proof-v1.py'
KERNEL_SHA = '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946'
INVENTORY = OPS / 'final-supervisor-inventory-v1.py'
INVENTORY_SHA = 'ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912'
PARENT = 'yunipals-indexer.service'
SOURCE = 'yunipals-ypal-combined-source.service'
SOLANA = 'yunipals-solana.service'
OBSERVER = 'yunipals-combined-ordinary-observer.service'
HELPERS = {'need','encoded','sha','pin','boot','mono','identity','protected','document','sync','save','command',
           'lock','link_record','moved_link_matches','check_solana','stopped_solana','prefix_preserved','definition_frame'}
HOST_METHODS = {'query','sessions','sessions_gone','manager'}
OWNER_METHODS = {'step','stop_exact','move_owned','publish_file','owned_new_definition','finish_stop','original_actor'}


def need(ok, code):
    if not ok: raise RuntimeError(code)

def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def own_sha(): return sha(Path(__file__).read_bytes())
def pin(value): return isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) and value!='0'*64


def load(path, digest):
    path=Path(path)
    for q in [*path.parents,path]:
        s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'protected_lifecycle_source_required')
    raw=path.read_bytes();need(len(raw)<2000000 and sha(raw)==digest,'exact_lifecycle_source_required')
    module=types.ModuleType(path.stem);module.__file__=str(path);exec(compile(raw,str(path),'exec'),module.__dict__)
    need(sha(path.read_bytes())==digest,'lifecycle_source_changed');return module


def rename_no_replace(source,target):
    library=ctypes.CDLL(None,use_errno=True);call=library.renameat2
    call.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];call.restype=ctypes.c_int
    if call(-100,os.fsencode(source),-100,os.fsencode(target),1):
        code=ctypes.get_errno();raise OSError(code,'owned_noreplace_rename_refused')


def lifecycle_primitives(raw, filename):
    """Only retained finite effects: no old constructor/authority/inverse body."""
    need(sha(raw)==TEMPLATE_SHA,'exact_f5_lifecycle_primitives_required')
    tree=ast.parse(raw);body=[];functions=set();methods={};changes=set();seams={'address':0,'stop':0,'finish':0,'rename':0}
    class Address(ast.NodeTransformer):
        def visit_Constant(self,n):
            if isinstance(n.value,str) and 'client_addr::text' in n.value:
                need(n.value.count('client_addr::text')==1,'single_session_address_cast_required');seams['address']+=1
                return ast.copy_location(ast.Constant(n.value.replace('client_addr::text','host(client_addr)')),n)
            return n
    replacements={'FORMAT':FORMAT,'BASE':BASE,'HOLD':HOLD}
    for n in tree.body:
        if isinstance(n,(ast.Import,ast.ImportFrom,ast.Assign)):
            if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id in replacements:
                name=n.targets[0].id;value=replacements[name];n.value=ast.parse(repr(value) if isinstance(value,str) else 'Path('+repr(str(value))+')',mode='eval').body;changes.add(name)
            body.append(n)
        elif isinstance(n,ast.FunctionDef) and n.name in HELPERS:body.append(n);functions.add(n.name)
        elif isinstance(n,ast.ClassDef) and n.name in {'Host','Owner'}:
            allowed=HOST_METHODS if n.name=='Host' else OWNER_METHODS
            n.body=[v for v in n.body if isinstance(v,ast.FunctionDef) and v.name in allowed]
            for method in n.body:
                if n.name=='Host' and method.name=='sessions':Address().visit(method)
                if n.name=='Owner' and method.name in {'stop_exact','finish_stop'}:
                    class Gone(ast.NodeTransformer):
                        def visit_Expr(self,node):
                            if isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Attribute) and node.value.func.attr=='sessions_gone':
                                seams['stop' if method.name=='stop_exact' else 'finish']+=1
                                return [ast.copy_location(ast.parse('self.known_gone(actor)').body[0],node),node]
                            return self.generic_visit(node)
                    Gone().visit(method)
                if n.name=='Owner' and method.name in {'move_owned','publish_file'}:
                    class Rename(ast.NodeTransformer):
                        def visit_Call(self,node):
                            if ast.unparse(node.func)=='os.rename':
                                seams['rename']+=1;node.func=ast.Name(id='rename_no_replace',ctx=ast.Load())
                            return self.generic_visit(node)
                    Rename().visit(method)
            methods[n.name]={v.name for v in n.body};body.append(n)
    need(functions==HELPERS and methods=={'Host':HOST_METHODS,'Owner':OWNER_METHODS} and changes==set(replacements) and seams=={'address':1,'stop':1,'finish':1,'rename':2},
         'finite_unchanged_f5_effect_bodies_required')
    m=types.ModuleType('ordinary_managed_lifecycle_primitives');m.__file__=str(filename);m.rename_no_replace=rename_no_replace
    exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),str(filename),'exec'),m.__dict__);return m


def terminal_mapper(raw, filename):
    """Retain the proven residual kernel join, fixed to the two writer roles."""
    need(sha(raw)==KERNEL_SHA,'exact_terminal_kernel_mapper_required')
    tree=ast.parse(raw);body=[];found=set();changed=0;addresses=0
    for n in tree.body:
        if isinstance(n,(ast.Import,ast.ImportFrom)):body.append(n)
        elif isinstance(n,ast.FunctionDef) and n.name in {'need','boot','process','proc_status','residual_client_pids'}:
            body.append(n);found.add(n.name)
        elif isinstance(n,ast.ClassDef) and n.name=='Context':
            method=next(v for v in n.body if isinstance(v,ast.FunctionDef) and v.name=='terminal_sessions')
            first=method.body[1]
            need(isinstance(first,ast.Expr) and 'fixed_inverse_terminal_role_required' in ast.unparse(first),'exact_terminal_role_gate_required')
            method.body[1]=ast.parse("need(role_oid in {'73004621','16388'}, 'only_two_managed_writer_roles_allowed')").body[0];changed+=1
            class Address(ast.NodeTransformer):
                def visit_Constant(self,node):
                    nonlocal addresses
                    if isinstance(node.value,str) and 'client_addr::text' in node.value:
                        need(node.value.count('client_addr::text')==1,'single_terminal_address_cast_required');addresses+=1
                        return ast.copy_location(ast.Constant(node.value.replace('client_addr::text','host(client_addr)')),node)
                    return node
            Address().visit(method);n.body=[method];body.append(n)
    need(found=={'need','boot','process','proc_status','residual_client_pids'} and changed==1 and addresses==1,'only_terminal_role_and_address_seams_changed')
    m=types.ModuleType('ordinary_managed_terminal_mapper');m.__file__=str(filename)
    exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),str(filename),'exec'),m.__dict__);return m


def ensure_directory(path, create=False):
    if create:
        path.mkdir(mode=0o700);fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
    s=path.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'exact_owned_private_lifecycle_directory_required')


class Owner:
    def __init__(self,input_sha):
        self.f=load(FOUNDATION,FOUNDATION_SHA);self.f.protected(Path(__file__).absolute(),own_sha())
        self.foundation=self.f.Owner(input_sha);self.input_sha=input_sha;self.o=self.foundation.ordinary
        self.m=lifecycle_primitives(self.f.protected(TEMPLATE,TEMPLATE_SHA),Path(__file__))
        self.h=self.foundation.h;self.h.raw=self.o.h.source
        for name in HOST_METHODS:setattr(self.h,name,getattr(self.m.Host,name).__get__(self.h))
        self.mapper=terminal_mapper(self.f.protected(KERNEL,KERNEL_SHA),KERNEL)
        self.inventory=load(INVENTORY,INVENTORY_SHA)
        for name in OWNER_METHODS:setattr(self,name,getattr(self.m.Owner,name).__get__(self))
        self.h.failed_parent_quiet=lambda op:self.terminal_backends()
        self.h.manager=self.manager

    def manager(self,action,unit=None):
        need(action=='daemon-reload' and unit is None or action in {'start','stop'} and unit in {SOURCE,SOLANA,PARENT},
             'only_three_owned_writer_units_may_receive_manager_actions')
        need(not self.m.command(['/usr/bin/systemctl',action,*([unit] if unit else [])],timeout=130),
             'bounded_manager_ACK_unknown_no_automatic_retry')

    def envelope(self,**v):return {'format':FORMAT,'operatorSha256':own_sha(),'foundationSha256':FOUNDATION_SHA,
                                   'inputSha256':self.input_sha,'bootId':self.m.boot(),**v}
    def get(self,name):ensure_directory(BASE);return self.m.document(BASE/name)
    def put(self,name,value):ensure_directory(BASE);return self.m.save(BASE/name,value)
    def has(self,name):return os.path.lexists(BASE/name)
    def digest(self,name):return sha(self.m.protected(BASE/name))
    def operation(self):
        op=self.get('operation.json');need(all(op[k]==v for k,v in self.envelope().items()),'same_owned_lifecycle_input_producer_boot_required')
        need(op['reviewHash']==sha(encoded(op['reviewBinding'])),'exact_saved_review_binding_required');return op

    def physical_definitions(self,unit):
        loaded=self.h.definitions(unit);actual=set()
        for root in [self.m.SYSTEM,Path('/run/systemd/system')]:
            fragment=root/unit
            if os.path.lexists(fragment):actual.add(str(fragment))
            drop=root/(unit+'.d')
            if os.path.lexists(drop):
                s=drop.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'protected_fixed_dropin_directory_required')
                actual.update(str(p) for p in drop.glob('*.conf'))
        need(actual==set(loaded),'unloaded_or_foreign_writer_definition_refused')
        return loaded

    def legacy_solana(self):
        self.inventory.state();return self.legacy_inputs()

    def legacy_inputs(self):
        i=self.inventory;typed=i.observer().typed_properties(SOLANA,run=i.command)
        need(typed['EnvironmentFiles']==[[str(p),False] for p in i.FILES] and typed['LoadCredential']==[],
             'same_two_ordered_legacy_Solana_environment_files_required')
        raw,meta=i.read(i.LEGACY/'lib/solana/worker.ts',100000);need(sha(raw)==i.WORKER_SHA,'same_legacy_Solana_worker_required')
        review=self.m.document(self.m.SOLANA_STAGE/'review.json');expected=review['binding']['sourceInputs']
        need(sha(json.dumps(typed,sort_keys=True,separators=(',',':')).encode())==review['binding']['typedConfiguredPropertiesSha256'],
             'exact_staged_typed_Solana_environment_settings_required')
        definitions=self.h.definitions(SOLANA)
        need(set(definitions)=={str(self.m.SYSTEM/SOLANA)} and all(p in expected and r['sha256']==expected[p]['sha256'] for p,r in definitions.items()),
             'actual_staged_legacy_Solana_definition_required')
        return {'definition':definitions,'workerSha256':sha(raw),'workerIdentity':meta,
                'typedSha256':sha(encoded(typed)),'auth':self.h.retained_solana_auth()}

    def preserved(self):
        self.foundation.dependencies();routes=self.foundation.routes()
        obs=self.foundation.observer.validate_current(self.foundation.config['observerResultSha256'])
        need(obs['validated'] is obs['ordinarySustainedObserver'] is obs['observerCurrentQualified'] is True,'unchanged_sustained_observer_required')
        return {'routes':routes,'observer':{k:obs[k] for k in ['operatorSha256','receiptSha256','actor','bootLink','dataIdentity']},
                'inputs':self.o.h.source.inputs(),'retainedServingPeers':self.o.peers(),
                'solanaAuth':self.h.retained_solana_auth(),'legacySolanaInputs':self.legacy_inputs()}

    def stable(self,op):
        need(self.preserved()==op['preserved'],'unchanged_private_sources_finance_nine_routes_and_observer_required')
        native=self.h.native();self.o.h.r.recovery_floor(op['native'],native);self.o.old.ns.native_order(native)
        need(native['tables']==op['native']['tables'] and native['cache']==op['native']['cache'] and native['app']['build_id']=='71e2a7f3b7',
             'same_physical44_build_and_shared_cache_required')
        return native

    def terminal_all(self):
        for unit in self.m.WRITERS:need(self.h.actor(unit,True) is None,'all_known_writer_cgroups_must_be_terminal')

    def known_gone(self,actor):
        for old in actor.get('processes',[]):
            try:current=self.mapper.process(old['pid'])
            except (FileNotFoundError,ProcessLookupError):continue
            need(current['startTicks']!=old['startTicks'],'recorded_owned_process_still_live_outside_or_inside_cgroup')

    def managed_known_gone(self):
        for name in ['parent-first-observation.json','parent-observed.json']:
            if self.has(name):self.known_gone(self.get(name)['actor'])
        for name in ['inverse-stop-parent-intent.json','inverse-stop-parent-after-CAS-intent.json']:
            if self.has(name):
                actor=self.get(name)['value'].get('actor')
                if actor:self.known_gone(actor)

    def terminal_backends(self):
        ctx=self.mapper.Context();ctx.query=self.h.query;ctx.host=types.SimpleNamespace(h=types.SimpleNamespace(observer=self.o.h.observer))
        native=self.h.query("SELECT count(*) FROM pg_stat_activity WHERE datid=17584 AND usesysid=73004621")
        need(native==0,'dedicated_native_writer_role_must_be_drained')
        proof=ctx.terminal_sessions({'processes':[]},'16388')
        packet=self.h.sql_solana();need(packet['workerLock']=={'granted':0,'waiting':0},'shared_Solana_lock_must_be_released')
        return {'nativeBackends':0,'solanaResidual':proof}

    def review(self):
        need(not os.path.lexists(BASE) and not os.path.lexists(HOLD) and not os.path.lexists(self.f.BASE),
             'new_lifecycle_hold_and_foundation_epoch_namespaces_required')
        self.o.current(self.foundation.config['ordinaryResultSha256'])
        self.o.loaded_source('paid');preserved=self.preserved();legacy=self.legacy_solana();units={};activations={};frames={}
        for unit in self.m.WRITERS:
            self.physical_definitions(unit);activations[unit]=self.h.activation(unit);units[unit]=self.h.actor(unit,True)
            frames[unit]=self.m.definition_frame(self.h.state(unit))
            need((units[unit] is not None)==(unit in {SOURCE,SOLANA}),'only_exact_standalone_and_legacy_Solana_may_be_active')
        expected=self.foundation.predecessor['source'];actual=units[SOURCE]
        need(all(actual['unit'][k]==expected['unit'][k] for k in ['MainPID','InvocationID','ExecMainStartTimestampMonotonic']) and
             all(actual['parent'][k]==expected['parent'][k] for k in ['pid','startTicks','argv','cwd']) and
             {(p['pid'],p['startTicks']) for p in actual['processes']}=={(p['pid'],p['startTicks']) for p in expected['processes']},
             'exact_actual_ordinary_standalone_epoch_before_drain_required')
        need(units[SOLANA]['parent']['argv']==[self.f.NODE,'--import','tsx',str(self.inventory.LEGACY/'lib/solana/worker.ts')],
             'exact_staged_legacy_Solana_live_argv_required')
        sessions=self.h.sessions({u:a for u,a in units.items() if a},True);native=self.h.native();sol=self.h.sql_solana()
        need(sol['state']['lastErrorPresent'] is False,'legacy_Solana_error_requires_diagnosis_before_switch')
        binding=self.envelope(units=units,activations=activations,unitDefinitionFrames=frames,preserved=preserved,legacySolana=legacy,
              nativeIdentity={k:native[k] for k in ['schemaOid','tables','cache']},solanaManifest=sol['manifest'])
        need(self.preserved()==preserved and all(self.h.actor(u,True)==a for u,a in units.items()),'initial_actor_and_private_final_CAS_required')
        return {**self.envelope(), 'reviewBinding':binding,'reviewHash':sha(encoded(binding)), 'units':units,'activations':activations,
                'unitDefinitionFrames':frames,'preserved':preserved,'legacySolana':legacy,'native':native,'solana':sol,'sessions':sessions,
                'consumerAcceptanceQualified':False,'sourceSelectionChanged':False,'financialPolicyChanged':False}

    def drain(self,expected):
        need(pin(expected),'exact_review_hash_required');op=self.review();need(op['reviewHash']==expected,'fresh_exact_review_required')
        ensure_directory(BASE,True);ensure_directory(HOLD,True);self.put('operation.json',op)
        for unit in [SOURCE,SOLANA]:self.stable(op);self.stop_exact(unit,op['units'][unit],'drain-'+unit)
        return self.finish_drain()

    def finish_drain(self):
        op=self.operation();self.stable(op)
        for unit in [SOURCE,SOLANA]:
            name='drain-'+unit
            need(self.has(name+'-intent.json'),'missing_stop_intent_is_not_permission_to_dispatch')
            self.finish_stop(unit,op['units'][unit],name)
        self.terminal_all()
        for unit in [SOURCE,SOLANA]:self.known_gone(op['units'][unit])
        proof=self.terminal_backends();native=self.stable(op);sol=self.h.sql_solana()
        if not self.has('drained.json'):self.put('drained.json',self.envelope(native=native,solana=sol,terminalBackends=proof,stoppedAtUs=self.m.mono()))
        self.frozen();return {'drained':True,'databaseWrites':0,'observerStopped':False}

    def frozen(self):
        op=self.operation();self.terminal_all()
        for unit in [SOURCE,SOLANA]:self.known_gone(op['units'][unit])
        self.terminal_backends();current=self.stable(op);d=self.get('drained.json')
        self.o.h.r.recovery_floor(d['native'],current)
        need(current['checkpoints']==d['native']['checkpoints'],'no_native_checkpoint_advance_while_all_writers_terminal')
        self.m.stopped_solana(d['solana'],self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
        return current

    def install(self):
        op=self.operation();self.frozen();need(not self.has('install-intent.json'),'unknown_install_prefix_requires_inverse_not_repeated_install')
        self.put('install-intent.json',self.envelope(operationSha256=self.digest('operation.json')))
        for unit in self.m.WRITERS:
            need(self.h.activation(unit)==op['activations'][unit],'original_activation_changed_before_retirement')
            b=op['activations'][unit]['boot']
            if b:self.move_owned(self.h.boot_link(unit),HOLD/(unit+'.boot'),b['identity'],'hold-boot-'+unit)
        for n,(path,r) in enumerate(op['activations'][PARENT]['definitions'].items()):
            self.move_owned(Path(path),HOLD/(PARENT+'.definition-'+str(n)),r['identity'],'hold-definition-'+str(n))
        self.publish_file('managed-unit',self.m.SYSTEM/PARENT,self.f.protected(self.f.STAGE/'yunipals-indexer.service.example',self.f.PUBLIC['yunipals-indexer.service.example']))
        target=self.h.boot_link(PARENT);temporary=HOLD/'managed.new-boot';os.symlink(str(self.m.SYSTEM/PARENT),temporary);self.m.sync(HOLD)
        record=self.m.link_record(temporary);self.put('new-boot-prepared.json',{'path':str(target),'link':record})
        need(not os.path.lexists(target),'fresh_managed_boot_path_required');rename_no_replace(temporary,target);self.m.sync(HOLD);self.m.sync(target.parent)
        self.step('reload-managed',{},lambda:self.h.manager('daemon-reload'))
        return self.finish_install()

    def installed(self):
        op=self.operation();self.owned_new_definition('managed-unit');boot=self.get('new-boot-prepared.json')
        need(self.m.link_record(self.h.boot_link(PARENT))==boot['link'],'exact_owned_new_boot_inode_required')
        self.physical_definitions(PARENT);need(set(self.h.definitions(PARENT))=={str(self.m.SYSTEM/PARENT)},'no_managed_dropins_allowed')
        self.h.managed_settings();self.foundation.loaded_command_and_bindings()
        for unit in self.m.WRITERS:
            if unit!=PARENT:
                need(not os.path.lexists(self.h.boot_link(unit)) and self.h.definitions(unit)==op['activations'][unit]['definitions'] and
                     self.m.definition_frame(self.h.state(unit))==op['unitDefinitionFrames'][unit], 'old_writer_definitions_unchanged_and_boots_held_required')
            b=op['activations'][unit]['boot']
            if b:self.m.moved_link_matches(HOLD/(unit+'.boot'),b)
        for n,(_,r) in enumerate(op['activations'][PARENT]['definitions'].items()):
            held=HOLD/(PARENT+'.definition-'+str(n))
            need(self.m.identity(held)==r['identity'] and sha(self.m.protected(held))==r['sha256'],'original_parent_definition_backup_changed')
        return self.h.activation(PARENT)

    def finish_install(self):
        self.frozen();need(self.has('reload-managed-intent.json'),'actual_reload_intent_required')
        activation=self.installed()
        if not self.has('installed.json'):self.put('installed.json',self.envelope(activation=activation))
        need(self.get('installed.json')['activation']==activation,'same_inactive_installed_activation_required')
        return {'installedInactive':True,'oldBootInodesPreserved':True,'observerStopped':False}

    def start(self):
        need(not self.has('parent-start-intent.json'),'existing_start_intent_requires_readonly_reconcile_no_resend')
        native=self.frozen();self.installed();need(self.get('installed.json')['activation']==self.h.activation(PARENT),'installed_ACK_required')
        cache=self.o.cache.validate_restart_capture(self.o.h.source.query,self.o.plan,native)
        intent=self.envelope(notBeforeUs=self.m.mono(),operationSha256=self.digest('operation.json'),activation=self.h.activation(PARENT),native=native,cache=cache)
        self.put('parent-start-intent.json',intent)
        self.frozen();self.installed();self.h.manager('start',PARENT)
        return self.observe_start()

    def observe_start(self):
        intent=self.get('parent-start-intent.json');op=self.operation();self.stable(op);self.installed()
        need(all(intent[k]==v for k,v in self.envelope().items()) and intent['operationSha256']==self.digest('operation.json'),'exact_owned_start_intent_required')
        state=self.h.state(PARENT);need(int(state['ExecMainStartTimestampMonotonic'])>=intent['notBeforeUs'],'new_parent_epoch_after_own_intent_required')
        early=self.owned_parent_for_stop()
        if not self.has('parent-first-observation.json'):self.put('parent-first-observation.json',self.envelope(actor=early,startIntentSha256=self.digest('parent-start-intent.json')))
        need(self.f.canonical_actor(self.get('parent-first-observation.json')['actor'])==self.f.canonical_actor(early),'same_first_observed_parent_epoch_required')
        snap=self.foundation.snapshot();self.o.h.r.recovery_floor(intent['native'],snap['native'])
        self.m.prefix_preserved(self.get('drained.json')['solana'],self.h.sql_solana(int(self.get('drained.json')['solana']['ledgerPrefix']['throughId'])))
        if not os.path.lexists(self.f.BASE):self.foundation.begin()
        else:
            observed=self.foundation.record('observation-intent.json');need(observed['binding']==snap['binding'],'existing_foundation_intent_must_be_same_owned_parent')
        if not self.has('parent-observed.json'):self.put('parent-observed.json',self.envelope(actor=snap['binding']['currentManagedEpoch'],startIntentSha256=self.digest('parent-start-intent.json')))
        need(self.get('parent-observed.json')['actor']==snap['binding']['currentManagedEpoch'],'same_once_observed_parent_required')
        return {'managedObserved':True,'subsequentHeartbeatStillRequired':True,'sourceReadinessQualified':False}

    def finish(self):
        need(not self.has('inverse-intent.json'),'inverse_started_no_forward_ack')
        self.observe_start();proof=self.foundation.finish();current=self.foundation.current(proof['receiptSha256']);op=self.operation();self.stable(op);self.installed()
        result=self.envelope(completed=True,operationSha256=self.digest('operation.json'),startIntentSha256=self.digest('parent-start-intent.json'),
            foundationReceiptSha256=proof['receiptSha256'],foundationInputSha256=self.input_sha,
            managedEpoch=current['currentManagedEpoch'],oldBootsHeld=True,observerRetained=True,financialPolicyChanged=False,
            sourceSelectionChanged=False,consumerAcceptanceQualified=False,scheduledSolanaPublicationQualified=False,supervisedRestartQualified=False)
        if not self.has('result.json'):self.put('result.json',result)
        need(self.get('result.json')==result,'same_once_managed_lifecycle_ACK_required');return self.current(self.digest('result.json'))

    def current(self,result_sha):
        need(not self.has('inverse-intent.json'),'managed_lifecycle_inverse_started');result=self.m.document(BASE/'result.json',result_sha)
        need(all(result[k]==v for k,v in self.envelope().items()) and result['completed'] is True and result['operationSha256']==self.digest('operation.json'),
             'actual_managed_lifecycle_ACK_chain_required')
        self.stable(self.operation());self.installed();value=self.foundation.current(result['foundationReceiptSha256'])
        need(value['currentManagedEpoch']==result['managedEpoch'],'same_acknowledged_managed_epoch_required')
        return {**value,'lifecycleProducerSha256':own_sha(),'lifecycleReceiptSha256':result_sha,'managedInstallationQualified':True,
                'oldWriterBootRetirementQualified':True,'consumerAcceptanceQualified':False,'scheduledSolanaPublicationQualified':False,'supervisedRestartQualified':False}

    def owned_parent_for_stop(self):
        """Health-independent, including a child failing before the first ACK."""
        self.installed();intent=self.get('parent-start-intent.json');a=self.h.actor(PARENT)
        need(int(a['unit']['ExecMainStartTimestampMonotonic'])>=intent['notBeforeUs'] and a['parent']['argv']==[self.f.NODE,str(self.f.STAGE/'launcher.mjs')] and
             a['parent']['cwd']=='/' and a['parent']['parentPrivateValuesAbsent'] is True,'owned_started_parent_epoch_required_for_inverse')
        evm=self.f.source_arguments([*self.m.ENV_FILES[:3],str(self.f.ORDINARY_ENV)])
        sol=[self.f.NODE,'--max-old-space-size=4096','--env-file='+self.m.ENV_FILES[3],'--import','tsx','lib/solana/worker.ts']
        rows=a['processes'];need(1<=len(rows)<=4,'bounded_partial_managed_tree_required')
        evm_ids={r['pid'] for r in rows if r['argv']==evm}
        for row in rows:
            need(row['uid']==970 and row['gid']==964 and set(row['groups'])<={964} and
                 row['noNewPrivileges'] is row['capabilitiesZero'] is row['startupInjectionAbsent'] is True and
                 row['cgroup']=='0::/system.slice/'+PARENT,'owned_partial_tree_privileges_required')
            if row['pid']==a['parent']['pid']:continue
            known=(row['argv']==evm and row['cwd']==self.f.PROJECT or row['argv']==sol and row['cwd']==self.f.SOLANA_PROJECT)
            compiler=(row['parentPid'] in evm_ids and row['argv']==[row['executable'],'--service=0.25.12','--ping'] and row['executable'].endswith('/@esbuild/linux-x64/bin/esbuild'))
            need(compiler or known and row['parentPid']==a['parent']['pid'] and row['executable']==self.f.NODE,
                 'foreign_program_in_partial_managed_tree_refused')
        return a

    def stop_managed(self,finish):
        if not self.has('parent-start-intent.json'):
            need(self.h.actor(PARENT,True) is None,'unowned_parent_must_be_terminal');return
        name='inverse-stop-parent';s=self.h.state(PARENT)
        if self.has(name+'-not-invoked.json'):
            need(self.get(name+'-not-invoked.json')==self.envelope(operationSha256=self.digest('operation.json'),managerCommandInvoked=False),
                 'only_explicit_no_command_stop_CAS_prefix_may_be_replaced')
            name+='-after-CAS'
        if self.has(name+'-intent.json'):
            need(finish,'lost_stop_ACK_requires_explicit_finish_inverse')
            saved=self.get(name+'-intent.json')
            if saved['value'].get('pendingRestartState'):
                need(self.h.actor(PARENT,True) is None,'owned_restart_still_pending_no_stop_repeat');self.terminal_backends()
            else:self.finish_stop(PARENT,saved['value']['actor'],name)
            self.managed_known_gone();return
        self.installed()
        if s['MainPID']==s['ControlPID']=='0' and s['ActiveState']=='activating' and s['SubState']=='auto-restart':
            intent=self.get('parent-start-intent.json');need(int(s['ExecMainStartTimestampMonotonic'])>=intent['notBeforeUs'],'owned_pending_restart_epoch_required')
            cg=Path('/sys/fs/cgroup/system.slice')/PARENT/'cgroup.procs';need(not cg.exists() or not cg.read_text().split(),'empty_pending_restart_cgroup_required')
            self.terminal_backends()
            def cancel():
                if self.h.state(PARENT)!=s:
                    self.put(name+'-not-invoked.json',self.envelope(operationSha256=self.digest('operation.json'),managerCommandInvoked=False))
                    raise RuntimeError('pending_restart_changed_after_intent_no_command_sent')
                self.h.manager('stop',PARENT);need(self.h.actor(PARENT,True) is None,'owned_restart_timer_must_be_cancelled');self.terminal_backends()
                return {'terminal':True}
            self.step(name,{'unit':PARENT,'actor':None,'pendingRestartState':s},cancel)
        elif s['MainPID']!='0':self.stop_exact(PARENT,self.owned_parent_for_stop(),name)
        else:
            need(self.h.actor(PARENT,True) is None,'managed_terminal_cgroup_required');self.terminal_backends()
        self.managed_known_gone()

    def restore_files(self,op,finish):
        if self.has('managed-unit-prepared.json'):
            r=self.get('managed-unit-prepared.json');path=Path(r['path']);held=HOLD/'managed-unit.removed'
            if os.path.lexists(path) and self.m.identity(path)==r['identity']:
                need(sha(self.m.protected(path))==r['sha256'],'owned_managed_unit_bytes_changed')
                self.move_owned(path,held,r['identity'],'inverse-remove-unit',finish)
            elif os.path.lexists(held):need(finish and self.m.identity(held)==r['identity'],'same_removed_unit_inode_required')
            else:
                original=op['activations'][PARENT]['definitions'].get(str(path))
                need(os.path.lexists(HOLD/'managed-unit.prepared') or finish and original and self.m.identity(path)==original['identity'],
                     'unknown_managed_publication_prefix_refused')
        if self.has('new-boot-prepared.json'):
            r=self.get('new-boot-prepared.json')['link'];path=self.h.boot_link(PARENT);held=HOLD/'managed.boot-removed'
            if self.m.link_record(path)==r:self.move_owned(path,held,r['identity'],'inverse-remove-boot',finish)
            elif os.path.lexists(held):self.m.moved_link_matches(held,r)
            else:need(os.path.lexists(HOLD/'managed.new-boot') or finish and self.m.link_record(path)==op['activations'][PARENT]['boot'],
                      'unknown_managed_boot_prefix_refused')
        for n,(path,r) in enumerate(op['activations'][PARENT]['definitions'].items()):
            path=Path(path);held=HOLD/(PARENT+'.definition-'+str(n))
            if os.path.lexists(held):self.move_owned(held,path,r['identity'],'inverse-restore-definition-'+str(n),finish)
            need(self.m.identity(path)==r['identity'] and sha(self.m.protected(path))==r['sha256'],'same_original_parent_definition_required')
        for unit in self.m.WRITERS:
            r=op['activations'][unit]['boot'];path=self.h.boot_link(unit);held=HOLD/(unit+'.boot')
            if r:
                if os.path.lexists(held):self.move_owned(held,path,r['identity'],'inverse-restore-boot-'+unit,finish)
                self.m.moved_link_matches(path,r)
            else:need(not os.path.lexists(path),'original_absent_boot_path_must_remain_absent')

    def restored_files(self,op):
        for unit in self.m.WRITERS:
            need(self.h.activation(unit)==op['activations'][unit] and self.m.definition_frame(self.h.state(unit))==op['unitDefinitionFrames'][unit],
                 'exact_original_loaded_definitions_boot_inodes_required')
            self.physical_definitions(unit)
        self.o.loaded_source('paid')

    def inverse(self,finish=False):
        op=self.operation();self.stable(op)
        if self.has('inverse-result.json'):return self.restored_current(self.digest('inverse-result.json'))
        if self.has('inverse-intent.json'):need(finish,'existing_inverse_requires_explicit_finish')
        else:self.put('inverse-intent.json',self.envelope(operationSha256=self.digest('operation.json')))
        # No old consumer or ordinary source current validator is used here.
        if not self.has('inverse-drained.json'):
            self.stop_managed(finish)
            for unit in [SOURCE,SOLANA]:
                name='drain-'+unit
                if self.has(name+'-intent.json'):self.finish_stop(unit,op['units'][unit],name)
                else:need(self.h.actor(unit)==op['units'][unit],'undrained_original_actor_must_remain_exact')
        else:
            need(finish and self.h.actor(PARENT,True) is None,'inverse_finish_requires_same_terminal_parent')
            self.managed_known_gone();self.get('inverse-drained.json')
        if not self.has('inverse-drained.json'):
            frozen=all(self.h.actor(unit,True) is None for unit in [PARENT,SOLANA])
            if frozen:self.terminal_backends()
            self.put('inverse-drained.json',self.envelope(native=self.h.native(),solana=self.h.sql_solana(),solanaFrozen=frozen))
        d=self.get('inverse-drained.json');self.restore_files(op,finish)
        if not self.has('inverse-reload-intent.json'):self.step('inverse-reload',{},lambda:self.h.manager('daemon-reload'))
        else:
            r=self.get('inverse-reload-intent.json');need(r['operationSha256']==self.digest('operation.json') and r['bootId']==self.m.boot() and r['value']=={},'same_owned_inverse_reload_required')
        self.restored_files(op);actors={}
        for unit in [SOURCE,SOLANA]:
            name='inverse-start-'+unit
            if not self.has('drain-'+unit+'-intent.json'):actors[unit]=self.h.actor(unit);continue
            if self.has(name+'-intent.json'):
                need(finish,'lost_original_start_ACK_requires_explicit_finish_no_repeat');intent=self.get(name+'-intent.json')
            else:
                need(self.h.actor(unit,True) is None,'original_unit_must_be_terminal_before_owned_inverse_start')
                if unit==SOURCE:
                    native=self.h.native();cache=self.o.cache.validate_restart_capture(self.o.h.source.query,self.o.plan,native)
                else:native=self.h.native();cache=None
                if d['solanaFrozen'] and self.h.actor(SOLANA,True) is None:
                    self.m.stopped_solana(d['solana'],self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
                intent=self.envelope(notBeforeUs=self.m.mono(),operationSha256=self.digest('operation.json'),native=native,cache=cache)
                self.put(name+'-intent.json',intent);self.stable(op);self.restored_files(op)
                need(self.h.actor(unit,True) is None,'post_intent_original_actor_CAS_required');self.h.manager('start',unit)
            need(all(intent[k]==v for k,v in self.envelope().items()) and intent['operationSha256']==self.digest('operation.json'),'exact_original_start_intent_chain_required')
            actor=self.original_actor(unit,intent);need(actor['unit']['NRestarts']=='0','only_once_started_restored_epoch_allowed')
            if not self.has(name+'-result.json'):self.put(name+'-result.json',self.envelope(actor=actor,intentSha256=self.digest(name+'-intent.json')))
            need(self.get(name+'-result.json')['actor']==actor,'same_restored_actor_ACK_required');actors[unit]=actor
        self.stable(op);self.restored_files(op);native=self.h.native();self.o.h.r.recovery_floor(d['native'],native)
        sessions=self.h.sessions(actors,True)
        need(bool(sessions['73004621']['owned'][SOURCE]),'positive_restored_native_backend_required')
        if self.has('inverse-start-'+SOURCE+'-intent.json'):
            intent=self.get('inverse-start-'+SOURCE+'-intent.json')
            self.f.heartbeat(native,{'observationDatabaseClock':intent['native']['clock'],'heartbeatBeforeObservation':int(intent['native']['app']['heartbeat_at'])})
        sol=self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId']))
        if d['solanaFrozen']:self.m.prefix_preserved(d['solana'],sol)
        else:need(sol['manifest']==d['solana']['manifest'] and int(sol['ledgerCurrent']['credits'])>=int(d['solana']['ledgerCurrent']['credits']),
                  'undrained_Solana_ledger_must_not_rewind')
        need(all(self.h.actor(u)==a for u,a in actors.items()),'restored_actor_final_CAS_required')
        self.put('inverse-result.json',self.envelope(restored=True,operationSha256=self.digest('operation.json'),actors=actors,native=native,
            originalBootInodesRestored=True,oldStandaloneReceiptRelabelled=False,observerRetained=True,financialPolicyChanged=False,
            consumerAcceptanceQualified=False,sourceReadinessQualified=False,solanaPrefixPreserved=d['solanaFrozen']))
        return self.restored_current(self.digest('inverse-result.json'))

    def restored_heartbeat(self,native):
        name='inverse-start-'+SOURCE+'-intent.json'
        if self.has(name):
            intent=self.get(name);floor={'observationDatabaseClock':intent['native']['clock'],'heartbeatBeforeObservation':int(intent['native']['app']['heartbeat_at'])}
        else:
            intent=self.o.journal('source-paid-start-intent.json')
            floor={'observationDatabaseClock':intent['preStartDatabaseClock'],'heartbeatBeforeObservation':intent['predecessorHeartbeat']}
        self.f.heartbeat(native,floor)

    def restored_current(self,result_sha):
        r=self.m.document(BASE/'inverse-result.json',result_sha);op=self.operation()
        need(all(r[k]==v for k,v in self.envelope().items()) and r['restored'] is True and r['operationSha256']==self.digest('operation.json'),
             'exact_own_restored_source_ACK_required')
        self.stable(op);self.restored_files(op);need(self.h.actor(PARENT,True) is None,'restored_parent_must_stay_terminal')
        for unit,a in r['actors'].items():need(self.h.actor(unit)==a,'same_acknowledged_restored_epoch_required')
        native=self.h.native();self.o.h.r.recovery_floor(r['native'],native);sessions=self.h.sessions(r['actors'],True)
        need(bool(sessions['73004621']['owned'][SOURCE]),'positive_restored_source_sessions_required');self.restored_heartbeat(native)
        return {**self.envelope(validated=True,receiptSha256=result_sha,currentWriterQualified=True,sourceKind='restored-ordinary-standalone',
            sourceKernelActors={SOURCE:r['actors'][SOURCE]},oldStandaloneReceiptRelabelled=False,consumerAcceptanceQualified=False,
            currentCanonicalCoverageQualified=False,financialAuthorityQualified=False,databaseWrites=0,serviceActions=0),
            'native':native,'routingMode':'ordinary-paid'}


def validate_current_source(receipt_sha,input_sha):return Owner(input_sha).current(receipt_sha)
def validate_restored_source(receipt_sha,input_sha):return Owner(input_sha).restored_current(receipt_sha)

def main():
    p=argparse.ArgumentParser();p.add_argument('--input-sha');g=p.add_mutually_exclusive_group()
    g.add_argument('--review',action='store_true');g.add_argument('--drain');g.add_argument('--finish-drain',action='store_true')
    g.add_argument('--install',action='store_true');g.add_argument('--finish-install',action='store_true');g.add_argument('--start',action='store_true')
    g.add_argument('--reconcile-start',action='store_true');g.add_argument('--finish',action='store_true');g.add_argument('--current')
    g.add_argument('--inverse',action='store_true');g.add_argument('--finish-inverse',action='store_true');g.add_argument('--restored-current')
    a=p.parse_args()
    if not any(vars(a).values()):print(json.dumps({'format':FORMAT,'sourceOnly':True,'operatorSha256':own_sha(),'databaseWrites':0,'serviceActions':0}));return
    need(pin(a.input_sha),'actual_foundation_input_SHA_required');o=Owner(a.input_sha)
    need(os.geteuid()==0 and os.uname().nodename=='yunipals-main','fixed_host_root_required')
    def expired(*_):raise RuntimeError('bounded_lifecycle_phase_expired_inspect_unknown_intents_no_retry')
    signal.signal(signal.SIGALRM,expired);signal.alarm(300)
    with o.m.lock():
        if a.review:r=o.review();path=None;result={'reviewHash':r['reviewHash'],'reviewOnly':True}
        elif a.drain:r=o.drain(a.drain);path='operation.json';result=r
        elif a.finish_drain:r=o.finish_drain();path='drained.json';result=r
        elif a.install:r=o.install();path='installed.json';result=r
        elif a.finish_install:r=o.finish_install();path='installed.json';result=r
        elif a.start or a.reconcile_start:r=o.start() if a.start else o.observe_start();path='parent-observed.json';result=r
        elif a.finish:r=o.finish();path='result.json';result={'managedCurrent':True}
        elif a.current:r=o.current(a.current);path='result.json';result={'managedCurrent':True}
        elif a.inverse or a.finish_inverse:r=o.inverse(a.finish_inverse);path='inverse-result.json';result={'restoredCurrent':True}
        elif a.restored_current:r=o.restored_current(a.restored_current);path='inverse-result.json';result={'restoredCurrent':True}
        else:raise RuntimeError('one_explicit_lifecycle_phase_required')
        print(json.dumps({'format':FORMAT,'operatorSha256':own_sha(),**result,'receiptSha256':o.digest(path) if path else None,
                          'databaseWrites':0,'financialPolicyChanged':False,'consumerAcceptanceQualified':False},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'format':FORMAT,'failed':True,'fixedCode':str(e) if isinstance(e,RuntimeError) and re.fullmatch('[A-Za-z0-9_]{1,200}',str(e)) else 'bounded_lifecycle_phase_failed',
                          'automaticRetryAllowed':False,'databaseWrites':0},sort_keys=True));raise SystemExit(1)
