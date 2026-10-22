#!/usr/bin/env python3
"""One explicitly reviewed8h native Ponder replay after an actual900s F1.

Same008 workspace/schema/cache/profile and free-only gates; no automatic retry.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import stat
import time
import types

BASE_HELPER_SHA='7fdccbac60ce5c66047073c14e284b93b6e335b091c4e32424e18384f547ca7e'
QUALIFIER_SHA='c85f7f474279deff5935612ebccc694665f78a0f936a2e5675c9af48644d5054'
EPOCH_SHA='d4013f4025d2b49c32cc561c3e673c119fb3ac47529d75c7009b55c962d49961'
FORMAT='yunipals-persistent-native-replay-v1'
SOURCE='008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
NATIVE='bf4939b3ff'
SECONDS=28800
ORIGINAL_CACHE=531472384
F1=Path('/var/lib/yunipals-unified-shadow/proxy-epochs-v2/20261020-008028af-f1')
LOCK=Path('/run/lock/yunipals-unified-shadow.lock')
PLAN_KEYS={'format','runId','freeOnly','epochHelper','epochPlan','prerequisiteReviewSha256','prerequisiteMonitorSha256','maximumSeconds','qualificationHelper','terminalWitnessFile','terminalWitnessSha256','qualificationFile','qualificationSha256','baseConfiguration','liveLegacyRebaseFile','liveLegacyRebaseSha256','liveDependencyRebaseFile','liveDependencyRebaseSha256'}


def fail(message):raise RuntimeError(message)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()


def trusted(path,maximum=40000000):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts:fail('Protected absolute input required.')
    for item in [*path.parents,path]:
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not(stat.S_ISDIR(info.st_mode) and info.st_mode&stat.S_ISVTX)):
            fail('Input ancestry/protection differs.')
    if not path.is_file() or path.stat().st_size>maximum:fail('Bounded regular operator file required.')
    return path.read_bytes()


def load_epoch(path):
    raw=trusted(path)
    if digest(raw)!=EPOCH_SHA:fail('Exact frozen d401 epoch helper required.')
    helper=types.ModuleType('pinned_persistent_epoch');helper.__file__=str(path)
    exec(compile(raw,str(path),'exec'),helper.__dict__)
    return helper


def validate_plan(plan,helper):
    if (set(plan)!=PLAN_KEYS or plan['format']!=FORMAT or plan['freeOnly'] is not True or type(plan['maximumSeconds']) is not int or plan['maximumSeconds']!=SECONDS or
        not re.fullmatch(r'20261020-008028af-[a-z0-9]{1,16}',plan['runId'])):fail('Exact one8h free-only persistent plan required.')
    for key in ['prerequisiteReviewSha256','prerequisiteMonitorSha256','terminalWitnessSha256','qualificationSha256','liveLegacyRebaseSha256','liveDependencyRebaseSha256']:
        if not re.fullmatch(r'[0-9a-f]{64}',plan[key]):fail('Actual canonical F1 review/monitor pins required.')
    if (plan['prerequisiteReviewSha256']!='aeecf2ae04ab5b2d59dec64755eea19b9ee09aad5dde39bb5897a68df2794533' or
        plan['prerequisiteMonitorSha256']!='cffd7444a54679248ad00419a6b05e0b98f92623262d3073fae3108f30c8845e' or
        plan['terminalWitnessSha256']!='754d15a241dcad4199c1ce304435fc21b9b2b58f28ebb1aba2fd136a22fbcf8f' or
        plan['qualificationSha256']!='3f6f5130e9ddbd46687ddd609d5df2859c570c1dec269cbacc77bc9c0d7e7634'):
        fail('Only the exact immutable F1 qualification is supported.')
    base=plan['baseConfiguration']
    if (not isinstance(base,dict) or set(base)!={'helper','helperSha256','proofDirectory'} or
        not isinstance(base['helperSha256'],str) or base['helperSha256']!=BASE_HELPER_SHA or
        Path(base['helper']).name!='base-tenderly-config-epoch.py'):
        fail('Exact reviewed Base configuration epoch required.')
    paths=[plan[k] for k in ['epochHelper','qualificationHelper','terminalWitnessFile','qualificationFile','liveLegacyRebaseFile','liveDependencyRebaseFile']]
    paths += [base['helper'],base['proofDirectory']]
    if any(not isinstance(path,str) or not Path(path).is_absolute() or '..' in Path(path).parts for path in paths):
        fail('Protected absolute operator paths required.')
    if (Path(plan['epochHelper']).name!='proxy-epoch-v2.py' or Path(plan['qualificationHelper']).name!='f1-deadline-qualification.py' or
        Path(plan['terminalWitnessFile']).name!='f1-terminal-systemd-witness-20261021.json' or
        Path(plan['qualificationFile']).name!='f1-deadline-qualification-20261021.json'):
        fail('Exact versioned prerequisite/helper filenames required.')
    helper.validate_plan(plan['epochPlan']);p=plan['epochPlan']
    if (p['mode']!='continue' or p['runId']!=plan['runId'] or p['originReviewFile']!=str(F1/'review.json') or
        p['originMonitorFile']!=str(F1/'monitor.jsonl') or p['previousMonitorFile']!=str(F1/'monitor.jsonl')):
        fail('Persistent replay must follow exactly the successful F1 origin/monitor.')


def unit_name(plan):return 'yunipals-unified-persistent-'+plan['runId']+'.service'
def description(marker):return 'Yunipals persistent native replay '+marker


def limits(ctx):
    original=ctx.old.resource_limits()
    if original['seconds']!=900 or original['memoryBytes']!=2147483648 or original['cpuQuota']!='100%':fail('Original native resource contract changed.')
    return {**original,'seconds':SECONDS}


def properties(ctx,project):
    return {'User':ctx.old.USER,'Group':ctx.old.USER,'WorkingDirectory':str(project),'RuntimeMaxSec':str(SECONDS),
        'MemoryMax':'2147483648','MemorySwapMax':'0','CPUQuota':'100%','IOWeight':'10','Restart':'no','TimeoutStopSec':'30','KillMode':'control-group','TasksMax':'128',
        'NoNewPrivileges':'yes','PrivateTmp':'yes','ProtectSystem':'strict','ProtectHome':'yes','RestrictSUIDSGID':'yes','UMask':'0027',
        'IPAddressDeny':'any','IPAddressAllow':'127.0.0.0/8 ::1','ReadWritePaths':str(project/'.ponder')+' '+str(project/'ponder-env.d.ts')}


def command_argv(ctx,project,launch):
    return ['/usr/bin/env','-i',ctx.old.NODE,'--env-file='+str(launch),str(project/'node_modules/ponder/dist/esm/bin/ponder.js'),
        'start','--schema',ctx.old.SCHEMA,'--hostname','127.0.0.1','--port',str(ctx.old.PORT)]


def duration_us(value):
    if not isinstance(value,str):fail('Unsupported systemd duration.')
    parts=re.findall(r'([0-9]+)(us|ms|s|min|h|d)',value)
    if not parts or ''.join(a+b for a,b in parts)!=value.replace(' ',''):fail('Unsupported systemd duration.')
    scale={'us':1,'ms':1000,'s':1000000,'min':60000000,'h':3600000000,'d':86400000000}
    return sum(int(number)*scale[unit] for number,unit in parts)


def address_networks(value):
    if value=='any':return {'0.0.0.0/0','::/0'}
    try:return {str(ipaddress.ip_network(token,strict=False)) for token in value.split()}
    except (ValueError,AttributeError):fail('Unsupported persistent network constraint.')


def actual_resources(plan,ctx,invocation,marker,*,allow_timeout_shutdown=False):
    expected=properties(ctx,ctx.workspace/'apps/yunipals-indexer'); keys=[k for k in expected if k not in {'RuntimeMaxSec','CPUQuota','TimeoutStopSec'}]
    keys+=['RuntimeMaxUSec','CPUQuotaPerSecUSec','TimeoutStopUSec','Id','Description','InvocationID','ExecStart','MainPID','ActiveState','SubState','Result','ExecMainStartTimestampMonotonic']
    raw=ctx.old.command(['/usr/bin/systemctl','show',unit_name(plan),*['--property='+key for key in keys]],env=ctx.old.ROLE_ENV,timeout=2)
    value={}
    for line in raw.splitlines():
        key,sep,item=line.partition('=')
        if not sep or key not in keys or key in value:fail('Unexpected persistent unit resource metadata.')
        value[key]=item
    if (set(value)!=set(keys) or any(value[k]!=expected[k] for k in expected if k in keys and k not in {'IPAddressDeny','IPAddressAllow'}) or duration_us(value['RuntimeMaxUSec'])!=SECONDS*1000000 or
        address_networks(value['IPAddressDeny'])!={'0.0.0.0/0','::/0'} or address_networks(value['IPAddressAllow'])!={'127.0.0.0/8','::1/128'} or
        duration_us(value['CPUQuotaPerSecUSec'])!=1000000 or duration_us(value['TimeoutStopUSec'])!=30000000 or
        value['Id']!=unit_name(plan) or value['Description']!=description(marker) or value['InvocationID']!=invocation or
        not ((value['ActiveState']=='active' and value['SubState']=='running' and value['MainPID'].isdigit() and int(value['MainPID'])>0) or
            (allow_timeout_shutdown and value['Result']=='timeout' and ((value['ActiveState']=='deactivating' and value['SubState']=='stop-sigterm') or value['ActiveState'] in {'inactive','failed'})))):
        fail('Persistent source owned resources/identity differ.')
    native_start=value['ExecMainStartTimestampMonotonic']
    if not re.fullmatch(r'[0-9]{1,20}',native_start) or int(native_start)<=0 or int(native_start)>time.monotonic_ns()//1000:
        fail('Actual persistent source CLOCK_MONOTONIC start required.')
    project=ctx.workspace/'apps/yunipals-indexer';launch=ctx.workspace/'launch.env';args=command_argv(ctx,project,launch)
    if re.findall(r'argv\[\]=(.*?)\s+;',value['ExecStart'])!=[' '.join(args)] or re.findall(r'(?:^|[ {;])path=([^ ;]+)',value['ExecStart'])!=['/usr/bin/env']:
        fail('Persistent native entrypoint/launch changed.')
    return {'unit':unit_name(plan),'invocation':invocation,'runtimeMaxSeconds':SECONDS,'memoryBytes':2147483648,'cpuQuota':'100%',
        'mainStartMonotonicMicroseconds':int(native_start),'resourcePropertiesSha256':digest(encoded({k:v for k,v in value.items() if k not in {'MainPID','ExecStart','ActiveState','SubState'}}))}


def load_qualifier(path):
    raw=trusted(path)
    if digest(raw)!=QUALIFIER_SHA:fail('Exact fixed F1 race qualifier required.')
    helper=types.ModuleType('pinned_f1_qualification');helper.__file__=str(path)
    exec(compile(raw,str(path),'exec'),helper.__dict__)
    return helper


def saved_proxy_proofs(helper,p,ctx,artifact,epoch):
    rows=[]
    for chain,name in helper.CHAIN_NAMES.items():
        unit='yunipals-market-production-rpc@'+name+'.service';directory=Path(p['proxyProofDirectories'][chain])
        review_raw,result_raw=trusted(directory/'review.json'),trusted(directory/'result.json')
        review,result=json.loads(review_raw),json.loads(result_raw)
        override=Path('/etc/systemd/system')/(unit+'.d')/helper.OVERRIDE;override_raw=trusted(override)
        prior=next(row for row in ctx.parent_epoch['proxyTransitions']['proofs'] if row['chainId']==int(chain))
        expected={'unit':unit,'chainId':int(chain),'sourceRoot':p['proxyArtifact']['sourceRoot'],'sourceDigest':p['proxyArtifact']['sourceDigest'],
            'profileId':ctx.root['identity']['profileId'],'runtimeSha256':artifact['installed']['runtimeSha256'],
            'runtimeInventorySha256':p['proxyArtifact']['inventorySha256'],'runtimeArchiveSha256':artifact['inventory']['archiveSha256'],
            'overridePath':str(override),'overrideSha256':digest(override_raw),
            'beforeInvocationId':ctx.parent_report['last']['after']['legacyUnits'][unit]['InvocationID'],'afterInvocationId':epoch['legacyUnits'][unit]['InvocationID']}
        if (helper.canonical(review)!=directory.name or digest(review_raw)!=directory.name or review.get('format')!='yunipals-proxy-source-fallback-upgrade-v4' or
            review.get('beforeRuntime')!=ctx.parent_epoch['proxyRuntime'] or any(review.get(k)!=v for k,v in expected.items() if k!='afterInvocationId') or
            review.get('originalDefinitionHashes',{}).get(str(override.with_name(helper.PREVIOUS_OVERRIDE)))!=prior['overrideSha256'] or
            result.get('reviewHash')!=directory.name or result.get('review')!=review or any(result.get(k)!=v for k,v in expected.items()) or
            any(result.get(k) is not True for k in ['applied','legacyHealthPassed','legacyConfigurationPreserved','verifyExecStart']) or
            any(result.get(k) is not False for k in ['privateSettingsChanged','ingestorStarted','sourceSelectionChanged','newPermits']) or
            type(result.get('paidCalls')) is not int or result['paidCalls']!=0 or expected['beforeInvocationId']==expected['afterInvocationId'] or
            review.get('override')!=override_raw.decode()):fail('Saved F1 four-proxy proof/runtime/invocation lineage changed.')
        rows.append({'chainId':int(chain),'unit':unit,'reviewSha256':digest(review_raw),'resultSha256':digest(result_raw),**expected})
    return {'sha256':helper.canonical(rows),'proofs':rows}


def historical_prerequisite(plan,helper):
    raw=trusted(F1/'review.json');monitor=trusted(F1/'monitor.jsonl');origin=json.loads(raw)
    witness=trusted(plan['terminalWitnessFile'],4096);qraw=trusted(plan['qualificationFile'],8192)
    if (digest(raw)!=plan['prerequisiteReviewSha256'] or digest(monitor)!=plan['prerequisiteMonitorSha256'] or
        digest(witness)!=plan['terminalWitnessSha256'] or digest(qraw)!=plan['qualificationSha256']):fail('Exact F1 canonical files/qualification changed.')
    qualifier=load_qualifier(plan['qualificationHelper']);qualification=qualifier.qualify(raw,monitor,witness)
    if json.loads(qraw)!=qualification:fail('Separately reviewed F1 qualification differs from actual immutable evidence.')
    first_plan=origin['binding']['plan'];helper.validate_plan(first_plan)
    stable=helper.PLAN_KEYS-{'mode','runId','previousMonitorFile','originReviewFile','originMonitorFile'}
    if first_plan['mode']!='epoch' or any(first_plan[k]!=plan['epochPlan'][k] for k in stable):fail('F1 source context was changed.')
    ctx=helper.context(plan['epochPlan']);verifier,artifact=helper.proxy_artifact(first_plan,ctx)
    epoch=origin['binding']['epoch'];helper.saved_rebases(first_plan,ctx,epoch)
    proxy=saved_proxy_proofs(helper,first_plan,ctx,artifact,epoch)
    expected={'format':helper.FORMAT,'continuationHelperSha256':helper.CONTINUATION_SHA,'continuationPlanSha256':digest(trusted(first_plan['continuationPlanFile'])),
        'c1MonitorSha256':ctx.c1['sha256'],'c1ReviewHash':ctx.c1['first']['reviewHash'],'acceptedC1Stop':ctx.c1_stop,'workspace':str(ctx.workspace),
        'sourceDigest':SOURCE,'nativeBuild':NATIVE,'manifestHash':helper.MANIFEST,'originalCacheBytes':ORIGINAL_CACHE,
        'profileSha256':digest(trusted(Path(ctx.env['UNIFIED_RPC_PROFILE_FILE']))),'identity':ctx.root['identity'],
        'proxyHelperSha256':first_plan['proxyHelperSha256'],'proxyArtifact':first_plan['proxyArtifact'],'proxyRuntime':artifact['installed'],
        'sourceDiff':artifact['sourceDiff'],'runtimeDiff':artifact['runtimeDiff'],'proxyTransitions':proxy,'rebases':epoch['rebases'],
        'legacyUnits':epoch['legacyUnits'],'activeSelector':ctx.root['activeSelector'],'peer':ctx.root['peer'],'policy':ctx.root['policy'],
        'registeredSource':ctx.root['registeredSource'],'limits':ctx.old.resource_limits(),'freeOnly':True,'launchGrantIds':[],
        'sourceWorkspaceCopiedOrChanged':False,'schemaOrCacheReset':False,'priorEpoch':ctx.parent_provenance}
    parent=ctx.parent_report
    binding={'plan':first_plan,'helperSha256':EPOCH_SHA,'epoch':expected,'predecessorMonitorSha256':parent['sha256'],
        'previousRuntime':parent['last']['after']['metrics']['runtime'],'previousCheckpoints':parent['last']['after']['metrics']['checkpoints'],
        'legacyUnits':epoch['legacyUnits'],'activeSelector':ctx.root['activeSelector'],'workspaceProof':ctx.workspace_proof}
    if origin['binding']!=binding or helper.canonical(binding)!=origin['reviewHash']:fail('F1 does not rederive exact retained008/C1/E1/proxy4 provenance.')
    report=ctx.cont.completed_report(F1/'monitor.jsonl',ctx.workspace,NATIVE)
    # No call to d401.lineage with patched reports/state: it rejects the actual
    # deactivating sample. The independent fixed qualifier is explicit instead.
    return ctx,verifier,artifact,origin,report,qualification


def base_configuration(plan,expected_before_invocation,*,live_chain=False):
    selection=plan['baseConfiguration'];raw=trusted(selection['helper'])
    if digest(raw)!=selection['helperSha256']:fail('Base configuration helper changed.')
    module=types.ModuleType('pinned_base_configuration_epoch');module.__file__=selection['helper']
    exec(compile(raw,selection['helper'],'exec'),module.__dict__)
    return module.validate_applied(Path(selection['proofDirectory']),expected_before_invocation,live_chain=live_chain)


def live_rebase_plan(plan):
    return {**plan['epochPlan'],'legacyRebaseFile':plan['liveLegacyRebaseFile'],'legacyRebaseSha256':plan['liveLegacyRebaseSha256'],
        'dependencyRebaseFile':plan['liveDependencyRebaseFile'],'dependencyRebaseSha256':plan['liveDependencyRebaseSha256']}


def live_proxies(plan,helper,ctx,verifier,artifact,origin,current,*,live_chain):
    original=origin['binding']['epoch'];rows=[]
    for chain,name in helper.CHAIN_NAMES.items():
        unit='yunipals-market-production-rpc@'+name+'.service'
        if chain=='8453':continue
        if current[unit]!=original['legacyUnits'][unit]:fail('A non-Base proxy changed after F1.')
        directory=Path(plan['epochPlan']['proxyProofDirectories'][chain]);saved=json.loads(trusted(directory/'review.json'))
        properties=verifier.state(unit);verifier.verify_exec_start(properties,Path(plan['epochPlan']['proxyArtifact']['sourceRoot']))
        override=Path('/etc/systemd/system')/(unit+'.d')/helper.OVERRIDE
        definitions=verifier.definitions(properties)
        if definitions.pop(str(override),None)!=digest(trusted(override)):fail('Retained non-Base9z override changed.')
        config=ctx.transition.legacy_configuration(verifier,verifier.CHAINS[name][1],int(chain),verify_live_chain_id=live_chain)
        if (definitions!=saved.get('originalDefinitionHashes') or verifier.private_settings(properties)!=saved.get('privateSettings') or
            properties['InvocationID']!=current[unit]['InvocationID'] or config!=saved.get('legacyConfiguration')):
            fail('An unchanged non-Base proxy runtime/private/configuration proof drifted.')
        rows.append({'chainId':int(chain),'unit':unit,'invocation':current[unit]['InvocationID'],'reviewSha256':digest(trusted(directory/'review.json'))})
    unit='yunipals-market-production-rpc@base.service'
    base=base_configuration(plan,original['legacyUnits'][unit]['InvocationID'],live_chain=live_chain)
    if (base.get('beforeInvocationId')!=original['legacyUnits'][unit]['InvocationID'] or base.get('afterInvocationId')!=current[unit]['InvocationID'] or
        base.get('beforeRuntime')!=artifact['installed'] or base.get('afterRuntime')!=artifact['installed']):
        fail('Explicit Base configuration proof changes source4 runtime or F1 invocation origin.')
    proxy_file=Path(plan['epochPlan']['proxyArtifact']['sourceRoot'])/'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs'
    if digest(trusted(proxy_file))!=artifact['installed']['runtimeSha256']:fail('Proxy runtime bytes changed.')
    return {'unchangedThree':rows,'baseConfiguration':base}


def input_pins(plan,helper,origin):
    pins={plan['epochHelper']:EPOCH_SHA,plan['qualificationHelper']:QUALIFIER_SHA,plan['terminalWitnessFile']:plan['terminalWitnessSha256'],
        plan['qualificationFile']:plan['qualificationSha256'],str(F1/'review.json'):plan['prerequisiteReviewSha256'],str(F1/'monitor.jsonl'):plan['prerequisiteMonitorSha256'],
        plan['baseConfiguration']['helper']:plan['baseConfiguration']['helperSha256'],plan['liveLegacyRebaseFile']:plan['liveLegacyRebaseSha256'],
        plan['liveDependencyRebaseFile']:plan['liveDependencyRebaseSha256'],str(Path(__file__).absolute()):digest(trusted(Path(__file__).absolute()))}
    p=origin['binding']['plan'];epoch=origin['binding']['epoch']
    pins.update({p['continuationHelper']:helper.CONTINUATION_SHA,p['continuationPlanFile']:epoch['continuationPlanSha256'],p['c1MonitorFile']:epoch['c1MonitorSha256']})
    pins.update(helper.retained_parent_input_pins(origin['binding']['plan'],origin['binding']['epoch']))
    pins.update(origin['binding']['epoch']['priorEpoch']['inputPins'])
    for path,value in pins.items():
        if digest(trusted(path))!=value:fail('Pinned source/F1/configuration/legacy input changed.')
    return pins


def review(plan,*,existing_directory=None,live_chain=True):
    helper=load_epoch(plan['epochHelper']);validate_plan(plan,helper)
    ctx,verifier,artifact,origin,report,qualification=historical_prerequisite(plan,helper)
    old_epoch=origin['binding']['epoch'];states=ctx.old.service_states(ctx.old.LEGACY_UNITS);selector=ctx.old.active_selector()
    if selector!=old_epoch['activeSelector']:fail('Active source selector changed; persistent replay is not a cutover.')
    rebased=helper.rebases(live_rebase_plan(plan),ctx,states)
    live=live_proxies(plan,helper,ctx,verifier,artifact,origin,states,live_chain=live_chain)
    for earlier in [*ctx.reports,ctx.parent_report,report]:
        own=ctx.old.own_state(earlier['first']['unit'])
        if own['LoadState']!='not-found' and own['ActiveState'] not in {'inactive','failed'}:fail('An earlier source invocation remains active.')
    terminal=ctx.old.own_state(report['first']['unit'])
    if (terminal.get('InvocationID')!=qualification['invocation'] or terminal.get('Result')!='timeout' or
        terminal.get('ActiveState') not in {'inactive','failed'}):fail('Actual qualified F1 terminal owned state changed.')
    latest=report['last']['after']['metrics'];metrics=ctx.old.source_metrics()
    if metrics.get('runtime')!=latest.get('runtime') or metrics.get('checkpoints')!=latest.get('checkpoints'):fail('Retained source advanced after completed F1.')
    policy=ctx.cont.free_policy_snapshot(ctx.old,ctx.env,ctx.profile)
    if ctx.old.peer_acl()!=old_epoch['peer'] or ctx.cont.retained_policy_binding(ctx.old,policy,free_only=True)!=old_epoch['policy']:
        fail('Original source peer grants or free-only budget policy changed.')
    if ctx.transition.registered_source(ctx.old,ctx.profile)!=old_epoch['registeredSource']:fail('Registered physical source changed.')
    ctx.cont.validate_runtime(ctx.cont.runtime_proof(ctx.old,ctx.profile,helper.MANIFEST),NATIVE,len(ctx.profile['manifest']['sources']),latest)
    proxies=ctx.old.proxy_observation();ctx.old.validate_proxies(proxies,old_epoch['identity'])
    if any(helper.counters(proxies).values()):fail('Current isolated paid/refused counters must remain zero.')
    free=shutil.disk_usage(ctx.candidate.SOURCE).free
    epoch={'legacyUnits':states,'activeSelector':selector,'proxies':live,'rebases':rebased,'peer':old_epoch['peer'],'policy':old_epoch['policy'],
        'registeredSource':old_epoch['registeredSource'],'identity':old_epoch['identity']}
    project=ctx.workspace/'apps/yunipals-indexer';launch=ctx.workspace/'launch.env'
    binding={'format':FORMAT,'plan':plan,'helperSha256':digest(trusted(Path(__file__).absolute())),'epochHelperSha256':EPOCH_SHA,
        'prerequisite900':qualification,'prerequisite900ReviewHash':origin['reviewHash'],'prerequisite900Binding':origin['binding'],
        'liveEpoch':epoch,'inputPins':input_pins(plan,helper,origin),'sourceDigest':SOURCE,'nativeBuild':NATIVE,'retainedWorkspace':str(ctx.workspace),'retainedSchema':ctx.old.SCHEMA,
        'limits':limits(ctx),'systemdProperties':properties(ctx,project),'nativeArgv':command_argv(ctx,project,launch),'newUnit':unit_name(plan),
        'originalCacheBytes':ORIGINAL_CACHE,'freeOnly':True,'launchGrantIds':[],'sourceOrCacheReset':False,'newWorkspaceCopy':False,
        'automaticRetryAllowed':False,'consumerServingAllowed':False,'oldD401LineageAccepted':False}
    result={'reviewHash':digest(encoded(binding)),'binding':binding,'metrics':metrics,'proxies':proxies,'freeBytes':free,'started':False}
    if free<ctx.old.START_FREE or stop_reason({'freeBytes':free,'metrics':metrics,'legacyUnits':states,'activeSelector':selector},result,0):
        fail('Original cumulative disk/schema/cache/legacy limits prevent persistent launch.')
    ctx.old.free_port()
    if ctx.old.service_states((unit_name(plan),))[unit_name(plan)]['LoadState']!='not-found':fail('Fresh persistent transient unit required.')
    directory=ctx.old.BASE/'persistent-replays'/plan['runId']
    if existing_directory is None:
        if directory.exists() or directory.is_symlink():fail('Persistent attempt evidence must never be overwritten.')
    elif directory!=existing_directory or directory.is_symlink() or directory.stat().st_uid!=0 or directory.stat().st_mode&0o022 or list(directory.iterdir()):
        fail('Prepared persistent evidence directory differs.')
    return result,(helper,origin,ctx,verifier,artifact,directory)


def stop_reason(sample,baseline,elapsed):
    rules=baseline['binding']['limits']
    if sample['freeBytes']<rules['stopFreeBytes']:return 'disk_reserve'
    if sample['metrics']['schemaBytes']>rules['schemaCapBytes']:return 'schema_cap'
    if sample['metrics']['cacheBytes']-ORIGINAL_CACHE>rules['cacheGrowthCapBytes']:return 'cache_growth_cap'
    epoch=baseline['binding']['liveEpoch']
    if sample['legacyUnits']!=epoch['legacyUnits']:return 'legacy_service_changed'
    if sample['activeSelector']!=epoch['activeSelector']:return 'active_selector_changed'
    if elapsed>=SECONDS:return 'deadline'
    return None


def start(plan,ctx,marker):
    project=ctx.workspace/'apps/yunipals-indexer';launch=ctx.workspace/'launch.env'
    argv=['/usr/bin/systemd-run','--unit='+unit_name(plan),'--description='+description(marker)]
    argv+=['--property='+key+'='+value for key,value in properties(ctx,project).items()];argv+=command_argv(ctx,project,launch)
    ctx.old.command(argv,env=ctx.old.ROLE_ENV,timeout=10)
    own=ctx.old.own_state(unit_name(plan));invocation=own.get('InvocationID')
    if not isinstance(invocation,str) or not re.fullmatch(r'[0-9a-f]{32}',invocation):fail('Persistent invocation unavailable.')
    return invocation


def stop_owned(plan,ctx,invocation,marker):
    own=ctx.old.own_state(unit_name(plan))
    if own['LoadState']=='not-found' or own['ActiveState'] in {'inactive','failed'}:return
    if own.get('Description')!=description(marker) or (invocation is not None and own.get('InvocationID')!=invocation):fail('Refusing another persistent owner/invocation.')
    ctx.old.command(['/usr/bin/systemctl','stop',unit_name(plan)],env=ctx.old.ROLE_ENV,timeout=35)


def runtime_expiry(plan,ctx,own,invocation,elapsed):
    if elapsed<SECONDS or own.get('InvocationID')!=invocation or own.get('Result')!='timeout' or own.get('ExecMainStatus')=='75' or own.get('ActiveState') not in {'inactive','failed'}:return None
    keys=['InvocationID','Result','ActiveState','ExecMainStatus','ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic']
    raw=ctx.old.command(['/usr/bin/systemctl','show',unit_name(plan),*['--property='+k for k in keys]],env=ctx.old.ROLE_ENV,timeout=2)
    value={}
    for line in raw.splitlines():
        key,sep,item=line.partition('=')
        if not sep or key not in keys or key in value:return None
        value[key]=item
    if (set(value)!=set(keys) or value['InvocationID']!=invocation or value['Result']!='timeout' or value['ActiveState'] not in {'inactive','failed'} or value['ExecMainStatus']=='75' or
        any(not re.fullmatch(r'[0-9]{1,20}',value[k]) for k in keys[-2:])):return None
    a,b=int(value[keys[-2]]),int(value[keys[-1]])
    if a<=0 or b-a<SECONDS*1000000:return None
    return {'unit':unit_name(plan),'invocation':invocation,'result':'timeout','controllerElapsedSeconds':elapsed,
        'startMonotonicMicroseconds':a,'exitMonotonicMicroseconds':b,'durationMicroseconds':b-a,'requiredSeconds':SECONDS}


def validate_running(plan,prepared,baseline,sample,own,invocation,elapsed):
    helper,origin,ctx,verifier,artifact,_=prepared;epoch=baseline['binding']['liveEpoch']
    if any(digest(trusted(path))!=value for path,value in baseline['binding']['inputPins'].items()):fail('Reviewed persistent/source/F1/configuration input changed.')
    ctx.old.validate_proxies(sample['proxies'],epoch['identity'])
    if helper.counters(sample['proxies'])!=helper.counters(baseline['proxies']):fail('Isolated paid/refused counters changed or reset.')
    if sample['legacyUnits']!=epoch['legacyUnits'] or sample['activeSelector']!=epoch['activeSelector']:fail('Reviewed source/proxy/legacy epoch changed.')
    if ctx.cont.retained_policy_binding(ctx.old,sample['policy'],free_only=True)!=epoch['policy'] or ctx.old.peer_acl()!=epoch['peer']:
        fail('Free-only policy/budget or original source peer grants changed.')
    if (helper.rebases(live_rebase_plan(plan),ctx,sample['legacyUnits'])!=epoch['rebases'] or
        live_proxies(plan,helper,ctx,verifier,artifact,origin,sample['legacyUnits'],live_chain=False)!=epoch['proxies'] or
        ctx.transition.registered_source(ctx.old,ctx.profile)!=epoch['registeredSource']):fail('Current configuration/runtime/source/rebase proof changed.')
    ctx.cont.validate_runtime(ctx.cont.runtime_proof(ctx.old,ctx.profile,helper.MANIFEST),NATIVE,len(ctx.profile['manifest']['sources']),{},starting=False)
    if own.get('InvocationID')!=invocation:fail('Persistent invocation changed.')
    if own['ActiveState'] not in {'inactive','failed'}:
        actual_resources(plan,ctx,invocation,baseline['reviewHash'],allow_timeout_shutdown=elapsed>=SECONDS)


def save(path,value):
    with path.open('xb') as out:
        os.fchmod(out.fileno(),0o640);out.write(encoded(value)+b'\n');out.flush();os.fsync(out.fileno())


def apply(plan,expected):
    descriptor=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'a') as lease:
        info=os.fstat(lease.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:fail('Protected existing source lease required.')
        fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result,prepared=review(plan)
        if result['reviewHash']!=expected:fail('Persistent review changed; no source start.')
        helper,normal,ctx,verifier,artifact,directory=prepared;parent=directory.parent
        parent.mkdir(mode=0o750,exist_ok=True)
        if parent.is_symlink() or parent.stat().st_uid!=0 or parent.stat().st_mode&0o022:fail('Protected persistent report root required.')
        gid=pwd.getpwnam(ctx.old.USER).pw_gid;os.chown(parent,0,gid);directory.mkdir(mode=0o750);os.chown(directory,0,gid)
        project=ctx.workspace/'apps/yunipals-indexer';launch=ctx.workspace/'launch.env'
        ctx.cont.validate_launch_text(ctx.candidate,launch.read_text(),free_only=True)
        text=ctx.old.command(['/usr/sbin/runuser','-u',ctx.old.USER,'--','/usr/bin/env','-i',ctx.old.NODE,'--env-file='+str(launch),'--import','tsx','scripts/unified-rpc-preflight.ts'],
            cwd=project,env=ctx.old.ROLE_ENV,timeout=60)
        ctx.cont.validate_preflight(text,{'freeOnly':True},ctx.old,ctx.env)
        again,_=review(plan,existing_directory=directory,live_chain=False)
        if again['reviewHash']!=expected:fail('Persistent prerequisites changed during free-only preflight.')
        save(directory/'review.json',result)
        invocation=None;reason='launch_or_monitor_error';controller_started=time.monotonic();started=None;log=directory/'monitor.jsonl';expiry=None
        try:
            invocation=start(plan,ctx,expected)
            resources=actual_resources(plan,ctx,invocation,expected)
            started=resources['mainStartMonotonicMicroseconds']/1000000
            ctx.old.emit(log,{'event':'started','reviewHash':expected,'persistentBinding':result['binding'],'unit':unit_name(plan),'invocation':invocation,
                'limits':limits(ctx),'mainStartMonotonicMicroseconds':resources['mainStartMonotonicMicroseconds'],'baselineMetrics':result['metrics'],'baselineLegacyUnits':result['binding']['liveEpoch']['legacyUnits'],'baselineActiveSelector':result['binding']['liveEpoch']['activeSelector']})
            while True:
                tick=time.monotonic();signal.setitimer(signal.ITIMER_REAL,15)
                try:
                    own=ctx.old.own_state(unit_name(plan))
                    sample={'freeBytes':shutil.disk_usage(ctx.candidate.SOURCE).free,'metrics':ctx.old.source_metrics(),
                        'legacyUnits':ctx.old.service_states(ctx.old.LEGACY_UNITS),'activeSelector':ctx.old.active_selector(),
                        'proxies':ctx.old.proxy_observation(),'policy':ctx.cont.free_policy_snapshot(ctx.old,ctx.env,ctx.profile)}
                    validate_running(plan,prepared,result,sample,own,invocation,time.monotonic()-started)
                finally:signal.setitimer(signal.ITIMER_REAL,0)
                elapsed=time.monotonic()-started
                ctx.old.emit(log,{'event':'sample','elapsed':round(elapsed,2),'own':own,**sample})
                if own.get('ExecMainStatus')=='75' and own['ActiveState']!='active':reason='shadow_exited';break
                if own['ActiveState'] in {'inactive','failed'}:
                    expiry=runtime_expiry(plan,ctx,own,invocation,elapsed);reason='deadline' if expiry else 'shadow_exited';break
                reason=stop_reason(sample,result,elapsed)
                if reason:break
                time.sleep(max(0,ctx.old.INTERVAL-(time.monotonic()-tick)))
        except (KeyboardInterrupt,SystemExit):reason='operator_interrupt'
        except Exception as problem:
            reason='persistent_prerequisite_unavailable';ctx.old.emit(log,{'event':'monitor_guard_failed','errorClass':type(problem).__name__})
        finally:
            stop_error=None
            try:stop_owned(plan,ctx,invocation,expected)
            except Exception as problem:stop_error=type(problem).__name__
            if reason=='deadline' and stop_error is None:
                try:expiry=runtime_expiry(plan,ctx,ctx.old.own_state(unit_name(plan)),invocation,time.monotonic()-started)
                except Exception:expiry=None
            after={}
            for key,collect in [('legacyUnits',lambda:ctx.old.service_states(ctx.old.LEGACY_UNITS)),('activeSelector',ctx.old.active_selector),('proxies',ctx.old.proxy_observation),('metrics',ctx.old.source_metrics)]:
                try:after[key]=collect()
                except Exception as problem:after[key]={'unavailable':type(problem).__name__}
            ctx.old.emit(log,{'event':'stopped','reason':reason,'elapsed':None if started is None else round(time.monotonic()-started,2),'controllerElapsedSeconds':round(time.monotonic()-controller_started,2),'retainedWorkspace':str(ctx.workspace),
                'retainedSchema':ctx.old.SCHEMA,'stopError':stop_error,'runtimeExpiryEvidence':expiry,'after':after,
                'automaticRetryAllowed':False,'quarantined':reason!='deadline' or stop_error is not None,'persistentRequiredSeconds':SECONDS})


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--apply');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('Exact root/host required.')
    plan=json.loads(trusted(args.plan))
    if args.apply:
        if not re.fullmatch(r'[0-9a-f]{64}',args.apply):fail('Exact persistent review hash required.')
        signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit()))
        signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError()))
        apply(plan,args.apply)
    else:print(json.dumps(review(plan)[0],indent=2))


if __name__=='__main__':main()
