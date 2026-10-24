#!/usr/bin/env python3
"""Read-only source/financial leaf for Arena on the acknowledged4e/71e source.

This deliberately does not invoke the obsolete whole-source validators. Current
Arena coverage/canonical readiness is additionally checked by NativeArenaSource
inside the sealed child. A terminal result is inverse-only, never forward ready.
"""
import datetime
import hashlib
import json
from pathlib import Path
import stat
import time
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
REGISTER=OPS/'ypal-combined-release-register-v1.py'
REGISTER_SHA='c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d'
SOURCE_ACK='c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
SOURCE_OP='a80ce9cca2da0dd5e40958db16e65f46e82ea859e861cfb110407e4bf93b9336'
RELEASE='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST='0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
SCHEMA='unified_ypal_20261023_v1'
TABLES={'_ponder_meta':'75963411','_ponder_checkpoint':'75963418','arena_tournament':'75963696','arena_credit':'75963726','canonical_event':'75963666','chain_block':'75963636','chain_checkpoint':'75963621','indexer_source':'75963651','transaction_candidate':'75963681'}


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def boot():return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def protected(path):
    path=Path(path)
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_source_leaf_input_required')
    s=path.lstat();need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<2000000,'bounded_source_leaf_input_required')
    raw=path.read_bytes();need(path.lstat()==s,'source_leaf_input_changed');return raw

def load():
    raw=protected(REGISTER);need(sha(raw)==REGISTER_SHA,'exact_combined_registration_leaf_required')
    m=types.ModuleType('arena_ypal_source_register');m.__file__=str(REGISTER);exec(compile(raw,str(REGISTER),'exec'),m.__dict__)
    s,h,op,ack=m.load()
    need(sha(s.protected(s.BASE/'result.json'))==SOURCE_ACK,'actual_combined_bootstrap_ack_required')
    need(ack['operationSha256']==SOURCE_OP and ack['schema']==SCHEMA and ack['buildId']=='71e2a7f3b7'and ack['native']['schemaOid']=='75963410','exact_combined_native_identity_required')
    return s,h,op,ack


def retained_proxy_frame(m,a,acknowledged):
    # Same independently reviewed unchanged proxy leaves as feature ownere506.
    names=[*(a.old_unit(c)for c in a.CHAINS),a.YPAL_UNITS[0]];result={}
    for name in names:
        state=a.state(m,name);chain=next((c for c in a.CHAINS if name==a.old_unit(c)),None)
        files,_=a.definition(m,state,chain)
        expected=dict(line.split('=',1)for line in m.env_bytes().decode().splitlines())if name==a.YPAL_UNITS[0]else None
        actor=a.live_actor(m,state,expected)
        stable=[k for k in state if k not in{'ExecStart','Environment','EnvironmentFiles'}]
        after=a.state(m,name);need(all(after[k]==state[k]for k in stable),'retained_proxy_changed_during_read')
        current={**files,'actor':actor,'settings':{k:state[k]for k in stable},'environmentPropertySha256':sha(state['Environment'].encode()),'environmentFilesPropertySha256':sha(state['EnvironmentFiles'].encode())}
        need(current==acknowledged[name],'unchanged_old_four_and_YPAL19212_proxy_leaf_required');result[name]=current
    rpc_boot=acknowledged['acceptedYpal']['rpcBoot'];need(rpc_boot['path']==str(m.BOOT_LINK),'accepted_YPAL19212_boot_path_required');a.check_link(m.BOOT_LINK,rpc_boot)
    return result


def static_and_financial(s,h,op,ack):
    s.static_inputs(h);s.old_private_inputs(op)
    need(s.base_code()==op['sourceCode']and h.role()==op['sourceRole'],'same_combined_code_private_inputs_and_writer_role_required')
    h.old_terminal(op);h.preserved_old_native(op)
    s.exact_link(s.NEW_LINK,ack['newBoot'])
    route=h.m.route_owner;before=h.m.load('before.json');binding=before['binding']
    need(binding['operatorSha256']==sha(protected(Path(route.__file__)))and binding['bootId']==boot()and binding['inputs']==h.rpc.inputs(h.m,route)and{c:route.plan(h.m,c)[0]for c in route.CHAINS}==binding['plans'],'same_acknowledged_free_route_inputs_required')
    retained_proxy_frame(h.m,route,binding['retained'])
    routes=json.loads(protected(route.BASE/'result.json'));need(sha(protected(route.BASE/'result.json'))==ack['rpcResultSha256'],'actual_route_result_required')
    need(routes['completed']is True and routes['operatorSha256']==binding['operatorSha256']and routes['bootId']==boot()and not(route.BASE/'restore-intent.json').exists(),'unreversed_same_boot_free_routes_required')
    need(time.time()<datetime.datetime.fromisoformat(route.EXPIRY.replace('Z','+00:00')).timestamp(),'unrenewed_unexpired_free_financial_window_required')
    route.exact_catalog(h.m,route.catalog(h.m),before['catalog'],True)
    current={c:route.owned(h.m,c,before)for c in route.CHAINS};need(current==routes['routes'],'same_four_combined_free_proxy_actors_required')
    for c in route.CHAINS:h.m.check_published(c+'-boot')
    capacity=h.rpc.capacity_snapshot(h.m);need({k:capacity[k]for k in binding['budgetCapacityIdentity']}==binding['budgetCapacityIdentity'],'unchanged_budget_capacity_authority_required')
    return {'bootId':boot(),'financialExpiresAt':route.EXPIRY,'freeOnly':True,'paidAuthority':False,'permits':0,'financialWindowRenewed':False,'routesReceiptSha256':ack['rpcResultSha256'],'routeActors':current}


def source_actor(s,h,op,ack,terminal_ok=False):
    state=h.state(s.NEW)
    if terminal_ok and state['MainPID']=='0':
        need(state['ControlPID']=='0'and state['ActiveState']in{'inactive','failed'}and state['Job']in{'','0'}and state['FragmentPath']==str(s.UNIT)and not state['DropInPaths']and h.files(state)=={str(s.UNIT):s.TEMPLATE_SHA},'inverse_requires_exact_owned_terminal_combined_source')
        group=Path('/sys/fs/cgroup/system.slice')/s.NEW/'cgroup.procs'
        need((not group.exists()or not group.read_text().split())and all(not Path('/proc',str(p['pid'])).exists()for p in ack['source']['processes']),'inverse_source_cgroup_and_acknowledged_processes_must_be_terminal')
        return {'sourceTerminal':True,'inverseOnly':True,'source':None}
    current=s.new_owned(h,op);need(current==ack['source'],'same_acknowledged_c96_source_actor_required')
    return {'sourceTerminal':False,'inverseOnly':False,'source':current}


def native_identity(h,ack):
    native=h.native()
    need(native['schemaOid']=='75963410'and native['app']['build_id']=='71e2a7f3b7'and native['tables']==ack['native']['tables'],'exact_acknowledged_native_catalog_required')
    rows=native['tables']
    need(all(rows.get(name)=={'oid':oid,'owner':'73004621','kind':'r'} for name,oid in TABLES.items()),'actual_nine_Arena_source_relation_OIDs_required')
    return {'schemaOid':'75963410','buildId':'71e2a7f3b7','tables':TABLES}


def validate_current(*,terminal_ok=False):
    s,h,op,ack=load();authority=static_and_financial(s,h,op,ack);actor=source_actor(s,h,op,ack,terminal_ok);native=native_identity(h,ack)
    # No cached completeness/freshness boolean from bootstrap is promoted into
    # an Arena-ready claim. The actual latest reader/canonical verifier must run.
    return {'format':'yunipals-arena-ypal-source-context-v1','validated':True,'releaseId':RELEASE,'manifestHash':MANIFEST,'schema':SCHEMA,**native,**actor,**authority,'sourceReceiptSha256':SOURCE_ACK,'sourceOperationSha256':SOURCE_OP,'originalWholeValidationPassed':False,'nativeReadinessQualified':False,'databaseWrites':0,'serviceChanges':0}
