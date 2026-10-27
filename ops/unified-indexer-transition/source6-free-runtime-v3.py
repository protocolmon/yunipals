#!/usr/bin/env python3
"""One ordinary source handover after prod3 closure, using a new normal profile.

Default review is read-only. Apply holds the existing handover lease only until
the exact direct Ponder runtime receipt is saved. Steady state has no new flock.
"""
from copy import deepcopy
from contextlib import ExitStack
from datetime import datetime,timezone
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import types
import urllib.request

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-source6-free-transport-v2-20261021')
SYSTEMD=Path('/etc/systemd/system')
WORKSPACE=Path('/var/lib/yunipals-unified-shadow/20261020-008028af-a')
UNIT='yunipals-unified-source6-free-v2.service'
FORMAT='yunipals-source6-free-runtime-v3'
RUNTIME_SCOPE='temporary_pre_cutover_ordinary_source'
HANDOFF_SHA='ab2655a6ab333b77e1f63f9bf26531fadf41475df6e5d3ba0f9d11af646e7a39'
PROCESS_SHA='5b841c5343e12e9b916cfdf7e73bf54cd57580e8f1dec6b931279125a605fd36'
Q_SHA='2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
PROFILE=OPS/'normal-rpc-profile-v1.json'
PROFILE_SHA='0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e'
PROFILE_ID='0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728'
PROFILE_EXPIRES='2026-11-19T18:00:00.000Z'
COORDINATOR='faf1bb8c-4306-4c43-b55e-6ac5fa038567'
APPROVAL=OPS/'normal-rpc-profile-approved-v1.json'
OVERRIDE='zzzzzzzzzzzzzzzzzz-source6-normal-profile-v2-20261021.conf'
OVERLAY_SHA='9b07be960677cefddf514662ec92b5744d36238fe90e910c7b560af74f9abf8a'
OFFLINE_PROOF=OPS/'source6-rpc-file-proof-v1.json'
OFFLINE_PROOF_SHA='d73ec29212b5a3d9818b2846d5f2e741024935ff788b2c0604888ea0f2b046d5'
LAUNCH_SHA='feb8b0e9dd8cd55042d7c3722c83c37471dc702166fa27554f791f262dde6038'
NODE='/opt/node-v24.18.1/bin/node'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
CHAINS={'ethereum':(1,19201),'base':(8453,19202),'polygon':(137,19203),'bnb':(56,19204)}

def fail(code):raise RuntimeError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def now():return datetime.now(timezone.utc)

def modules():
    path=OPS/'paid-capability-live-v1.py'
    for p in [*path.parents,path]:
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_loader_required')
    raw=path.read_bytes()
    if len(raw)>300000 or sha(raw)!=Q_SHA:fail('exact_loader_required')
    q=types.ModuleType('ordinary_source_loader');q.__file__=str(path);exec(compile(raw,str(path),'exec'),q.__dict__)
    handoff=q.load(OPS/'paid-productive-financial-handoff-v1.py',HANDOFF_SHA,'ordinary_source_financial_handoff')
    _,live,model,epoch,native,_=handoff.modules();qe,_,om=q.modules();_,n,c,v,_=qe.modules()
    return q,handoff,live,model,epoch,native,qe,om,n,c,v

def profile(q,native,qe):
    raw=q.protected(PROFILE,100000);value=json.loads(raw)
    if(sha(raw)!=PROFILE_SHA or value.get('scope')!='yunipals-opensea'or value.get('coordinatorId')!=COORDINATOR):fail('exact_new_normal_profile_bytes_required')
    approved=json.loads(q.protected(APPROVAL,100000))
    expected={'format':'yunipals-normal-rpc-profile-approved-v1','profileFile':str(PROFILE),'profileSha256':PROFILE_SHA,'profileId':PROFILE_ID,
        'expiresAt':PROFILE_EXPIRES,'manifestHash':native.MANIFEST,'coordinatorId':COORDINATOR,'scope':'yunipals-opensea','permits':[]}
    if set(approved)!=set(expected)|{'officialApprovalOutputSha256'}or any(approved.get(k)!=v for k,v in expected.items())or not q.is_sha(approved['officialApprovalOutputSha256']):fail('official_normal_profile_approval_receipt_required')
    observed=qe.query("SELECT jsonb_build_object('profile',EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id="+qe.literal(PROFILE_ID)+"AND p.scope='yunipals-opensea'AND p.manifest_hash="+qe.literal(native.MANIFEST)+"AND p.policy="+qe.literal(encoded(value).decode())+"::jsonb AND p.expires_at="+qe.literal(PROFILE_EXPIRES)+"::timestamptz AND p.expires_at>clock_timestamp()AND p.enabled AND c.enabled AND c.coordinator_id="+qe.literal(COORDINATOR)+"::uuid),'activePermits',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id)WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()),'newProfilePermitRows',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit WHERE profile_id="+qe.literal(PROFILE_ID)+"))",market=True)
    if observed!={'profile':True,'activePermits':0,'newProfilePermitRows':0}:fail('actual_normal_profile_no_paid_permits_required')
    return {**{k:v for k,v in expected.items()if k not in {'format','expiresAt'}},'expiresAt':PROFILE_EXPIRES,'approvalFile':str(APPROVAL),'approvalSha256':sha(q.protected(APPROVAL))}

def proxy_files(name):
    if name not in CHAINS:fail('fixed_proxy_chain_required')
    public=OPS/('source6-normal-profile-v2-'+name+'.env');drop=SYSTEMD/('yunipals-market-production-rpc@'+name+'.service.d')/OVERRIDE
    body=('MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE='+str(PROFILE)+'\nMARKET_RPC_PROXY_UNIFIED_PROFILE_ID='+PROFILE_ID+'\n').encode()
    return public,drop,body,('[Service]\nEnvironmentFile='+str(public)+'\n').encode()

def proxy_metadata(q,qe,n,c,v,name):
    unit='yunipals-market-production-rpc@'+name+'.service';p=qe.observed(v,unit);v.verify_exec_start(p,n.ROOT)
    if(p['ActiveState']!='active'or p['SubState']!='running'or not re.fullmatch('[0-9a-f]{32}',p['InvocationID'])or
        v.digest(n.ROOT/'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs')!=n.PROXY_SHA):fail('exact_source6_running_proxy_required')
    return {'invocation':p['InvocationID'],'definitions':v.definitions(p),'privateSettings':v.private_settings(p),'environmentFileHashes':c.environment_hashes(v,p)}

def compare_proxy(before,after,name,*,selected):
    actual=deepcopy(after);public,drop,body,text=proxy_files(name)
    if selected:
        if(actual['definitions'].pop(str(drop),None)!=sha(text)or not actual['privateSettings']['orderedEnvironmentFiles']or
            actual['privateSettings']['orderedEnvironmentFiles'].pop()!=str(public)+' (ignore_errors=no)'or
            not actual['environmentFileHashes']or actual['environmentFileHashes'].pop()!={'path':str(public),'optional':False,'exists':True,'sha256':sha(body)}):fail('only_exact_appended_normal_profile_selector_allowed')
    if {k:v for k,v in actual.items()if k!='invocation'}!={k:v for k,v in before.items()if k!='invocation'}:fail('original_proxy_definitions_private_inputs_or_order_changed')

def health(q,v,native,name,expected_config=None):
    chain,port=CHAINS[name]
    if v.request(port,'/health').get('status')!='ready':fail('ordinary_proxy_process_unhealthy')
    metrics=v.request(port,'/metrics');config={k:metrics.get(k)for k in v.CONFIG_KEYS};u=metrics.get('unified',{})
    if(expected_config is not None and config!=expected_config)or config['freeRouting']is not True or config['paidFallbackOnFreeFailure']is not False or config['sourcePaidFallbackOnFreeFailure']is not False:fail('ordinary_proxy_legacy_configuration_changed')
    if u.get('profileId')!=PROFILE_ID or u.get('chainId')!=chain or u.get('sourceRouting')!='free_first':fail('normal_profile_free_first_routing_required')
    for workload in ['unified_source','unified_evidence']:
        row=u.get('traffic',{}).get(workload,{})
        if any(type(row.get(k))is not int or row[k]!=0 for k in ['paidCalls','refused']):fail('ordinary_runtime_paid_or_refused_traffic')
        headers={'x-yunipals-unified-rpc-profile':PROFILE_ID,'x-yunipals-rpc-workload':workload}
        gate=v.request(port,'/unified/preflight',headers=headers)
        if(gate.get('profileId')!=PROFILE_ID or gate.get('chainId')!=chain or gate.get('manifestHash')!=native.MANIFEST or
            gate.get('coordinatorId')!=COORDINATOR or gate.get('scope')!='yunipals-opensea'or gate.get('workload')!=workload or
            gate.get('paid')!='explicit_bounded_permit_only'or gate.get('replay',{}).get('mode')!='free_only'):fail('normal_free_only_profile_preflight_unavailable')
    return config

def source_state(q,qe,native,expected_role,*,running):
    value=qe.query("""SELECT jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit)FROM pg_roles WHERE rolname='yunipals_unified_shadow'),
      'memberships',(SELECT count(*)FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')OR roleid=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')),
      'sourceSessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='yunipals_unified_shadow'),
      'supportSessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='yunipals_unified_support'),
      'supportRole',(SELECT jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit)FROM pg_roles WHERE rolname='yunipals_unified_support'),
      'sourceIdentity',(SELECT jsonb_build_object('release',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash)FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'sourceManifest',(SELECT manifest FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','build',value->>'build_id','dev',value->>'is_dev')FROM unified_shadow_20261020_7e7375b0._ponder_meta WHERE key='app'),
      'activeSelectors',(SELECT count(*)FROM yunipals_indexer_control.active_release),
      'checkpoints',(SELECT coalesce(jsonb_agg(jsonb_build_object('chain',chain_id,'latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint)ORDER BY chain_id),'[]'::jsonb)FROM unified_shadow_20261020_7e7375b0._ponder_checkpoint))""")
    if(value.get('role')!=expected_role or value.get('sourceIdentity')!={'release':native.RELEASE,'schema':native.SCHEMA,'build':native.NATIVE,'manifestHash':native.MANIFEST}or
        value.get('sourceManifest')!=json.loads(q.protected(PROFILE,100000))['manifest']or
        value.get('runtime')!={'version':'6','build':native.NATIVE,'dev':'0'}or value.get('memberships')!=0 or value.get('activeSelectors')!=0 or
        type(value.get('sourceSessions'))is not int or not(1<=value['sourceSessions']<=32 if running else value['sourceSessions']==0)or
        type(value.get('supportSessions'))is not int or not 0<=value['supportSessions']<=(16 if running else 0)):fail('ordinary_source_role_runtime_or_writer_contract_changed')
    sr=value.get('supportRole')or{}
    if(sr.get('login')is not True or sr.get('connectionLimit')!=16 or any(sr.get(k)is not False for k in ['inherit','super','createDb','createRole','replication','bypassRls'])):fail('retained_support_role_contract_changed')
    points=value['checkpoints']
    if(len(points)!=4 or{r.get('chain')for r in points}!={1,56,137,8453}or any(set(r)!={'chain','latest','safe','finalized'}or any(not isinstance(r[k],str)or re.fullmatch('[0-9]{75}',r[k])is None for k in ['latest','safe','finalized'])for r in points)):fail('exact_four_retained_physical_checkpoints_required')
    return value

def source_health():
    # Ponder0.17.5 /health is empty200; /ready is intentionally not required
    # during historical replay. This is loopback only, never an upstream RPC.
    with urllib.request.urlopen('http://127.0.0.1:9024/health',timeout=2)as reply:
        if reply.status!=200 or reply.read(1)!=b'':fail('ordinary_ponder_local_health_unavailable')

def source_overlay():
    return ('UNIFIED_RPC_PROFILE_FILE='+str(PROFILE)+'\nUNIFIED_RPC_PROFILE_ID='+PROFILE_ID+'\nUNIFIED_RPC_POLICY_REQUIRED=true\nUNIFIED_RPC_FREE_ONLY=true\n').encode()

def source_command():
    return ['/usr/bin/env','-i',NODE,'--env-file='+str(WORKSPACE/'launch.env'),'--env-file='+str(OPS/'source6-free-runtime-v2.env'),str(WORKSPACE/'apps/yunipals-indexer/node_modules/ponder/dist/esm/bin/ponder.js'),'start','--schema','unified_shadow_20261020_7e7375b0','--hostname','127.0.0.1','--port','9024']

def readonly_bind(qe,unit):
    rows=qe.bus_property(unit,'org.freedesktop.systemd1.Service','BindReadOnlyPaths','a(ssbt)')
    expected=[str(OPS/'source6-rpc-file-v2/rpc-preflight.ts'),str(WORKSPACE/'apps/yunipals-indexer/lib/unified/rpc-preflight.ts'),False]
    if(not isinstance(rows,list)or len(rows)!=1 or not isinstance(rows[0],list)or len(rows[0])!=4 or
        rows[0][:3]!=expected or type(rows[0][3])is not int or rows[0][3]not in {0,16384}or
        qe.bus_property(unit,'org.freedesktop.systemd1.Service','BindPaths','a(ssbt)')!=[]):fail('exact_readonly_RPC_overlay_mount_required')

def overlay_state(q,native,*,offline_proof=None):
    helper=q.load(OPS/'source6-rpc-file-overlay-v2.py',OVERLAY_SHA,'reviewed_singleton_source_RPC_overlay')
    project=WORKSPACE/'apps/yunipals-indexer'
    candidate=q.protected(helper.PATCH)
    files,binding=helper.render(q.protected(project/'ponder.config.ts'),q.protected(project/'lib/unified/rpc-preflight.ts'),candidate)
    for name,raw in files.items():
        if q.protected(helper.DIRECTORY/name)!=raw:fail('exact_public_RPC_overlay_bytes_required')
    if json.loads(q.protected(helper.DIRECTORY/'manifest.json'))!=binding:fail('exact_public_RPC_overlay_binding_required')
    original=q.protected(OPS/'source6-rpc-file-v1/rpc-preflight.ts')
    marker=b'export function unifiedRpcHttpTransport('
    if(sha(original)!='e0c32b8c8e5838eeccfeda6d40fdc364208fe08446ecdb6761208d2443407ecb' or
        original.count(marker)!=1 or candidate.count(marker)!=1 or original.split(marker)[0]!=candidate.split(marker)[0]):
        fail('only_reviewed_source_transport_function_may_differ')
    compiler=project/'node_modules/ponder/dist/esm/build/index.js'
    # Ponder's exact installed compiler hashes only ordering/contracts/accounts/
    # blocks, then the unchanged schema and indexing sources. RPC is excluded.
    # This is an explicitly derived identity, not a claim that the candidate's
    # production Vite probe passed. That probe timed out beside the live source.
    compiler_sha='433c6c62479cb3a4eaf747e1dc687b69fb76b7bffd502f7e3162a70bbe98359c'
    # node_modules is the previously qualified immutable dependency symlink.
    # Resolve only that fixed compiler leaf; do not relax protected source reads.
    compiler=compiler.resolve(strict=True)
    if sha(q.protected(compiler,300000))!=compiler_sha:fail('exact_RPC_excluding_Ponder_build_compiler_required')
    raw=q.protected(OFFLINE_PROOF,100000)
    if sha(raw)!=OFFLINE_PROOF_SHA:fail('original_actual_host_build_proof_required')
    actual=json.loads(raw);result=actual.get('result',{});measured=result.get('proof')
    if(actual.get('returncode')!=0 or actual.get('originalDiskRpcUnchanged')is not True or actual.get('stderrBytes')!=0 or
        result.get('format')!='yunipals-source6-rpc-file-proof-v1' or result.get('childExit')!=0 or result.get('timedOut')is not False or result.get('stderrBytes')!=0 or
        result.get('rawRpcFileBindOnly')is not True or result.get('sourceServiceJobs')!=0 or result.get('databaseCalls')!=0 or result.get('providerRequests')!=0 or
        not isinstance(measured,dict)or measured.get('buildId')!=native.NATIVE or measured.get('realRpcRequests')!=0 or measured.get('offlineInterceptedFetches')!=12 or
        any(measured.get(k)is not True for k in ['rootUnchanged','cacheUnchanged','schemaAndHandlersUnchanged'])):fail('original_measured_bf_build_identity_required')
    if offline_proof is not None and offline_proof!=measured:fail('saved_original_build_proof_changed')
    return {**binding,'helperSha256':OVERLAY_SHA,'offlineProofFile':str(OFFLINE_PROOF),'offlineProofSha256':OFFLINE_PROOF_SHA,'offlineBuild':measured,
        'identityBasis':'unchanged_original_build_hash_inputs_RPC_excluded','buildCompilerSha256':compiler_sha,
        'candidateHostExecuteConfigQualified':False,'productionViteCacheTouchedByValidation':False}

def source_definition(native,marker):
    props=native.properties(WORKSPACE,28800)
    props['BindReadOnlyPaths']=str(OPS/'source6-rpc-file-v2/rpc-preflight.ts')+':'+str(WORKSPACE/'apps/yunipals-indexer/lib/unified/rpc-preflight.ts')
    text='[Unit]\nDescription=Yunipals ordinary source6 free-only '+marker+'\n[Service]\nType=exec\n'
    text+=''.join(k+'='+v+'\n'for k,v in props.items())+'ExecStart='+' '.join(source_command())+'\n'
    return {'unit':UNIT,'text':text,'sha256':sha(text.encode()),'properties':props,'maximumRuntimeSeconds':28800,'reviewHash':marker}

def effective_environment(q):
    # Parse the actual selected files as source970. No worker/database/provider
    # module imports, private values or environment dumps are returned.
    code="""import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const e=process.env,s=readFileSync('/proc/self/status','utf8');const v=Object.fromEntries(s.split('\\n').filter(x=>x.includes(':')).map(x=>[x.slice(0,x.indexOf(':')),x.slice(x.indexOf(':')+1).trim()]));if(v.Uid.split(/\\s+/).some(x=>x!=='970')||v.Gid.split(/\\s+/).some(x=>x!=='964')||v.Groups!==''||v.NoNewPrivs!=='1'||['CapInh','CapPrm','CapEff','CapAmb'].some(k=>BigInt('0x'+v[k])!==0n)||BigInt('0x'+v.CapBnd)!==224n)throw Error('source_identity');if(Object.keys(e).some(k=>k.startsWith('UNIFIED_RPC_REPLAY_PERMIT_ID')&&e[k]))throw Error('paid_permit');console.log(JSON.stringify({profileFile:e.UNIFIED_RPC_PROFILE_FILE,profileId:e.UNIFIED_RPC_PROFILE_ID,required:e.UNIFIED_RPC_POLICY_REQUIRED,freeOnly:e.UNIFIED_RPC_FREE_ONLY,profileSha256:createHash('sha256').update(readFileSync(e.UNIFIED_RPC_PROFILE_FILE)).digest('hex'),node:process.versions.node}));"""
    command=['/usr/bin/setpriv','--reuid=970','--regid=964','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs',*source_command()[:5],'--input-type=module','-e',code]
    value=json.loads(q.run(command,timeout=5))
    if value!={'profileFile':str(PROFILE),'profileId':PROFILE_ID,'required':'true','freeOnly':'true','profileSha256':PROFILE_SHA,'node':'24.18.1'}:fail('actual_source_selected_environment_not_free_only')

def financial_state(q,handoff,live,model,native,qe,om):
    receipt,reviewed,plan,cleanup=handoff.validate_handoff(q,live,model,native);current=q.snapshot(qe,om)
    original=plan['originalPolicy'];migration=int(cleanup['migrationBookedGrantsCu']);day=current['grants']['day']
    if day==plan['grantDay']:
        q.same_policy(om,current,cleanup['policy'],plan['otherAllocationsSha256'])
        booked=int(current['grants']['workloads']['unified_source'])
        if not int(plan['baselineSourceGrantedCu'])+migration<=booked<=int(original['unifiedSourceDailyCu'])+migration:fail('ordinary_source_original_day_limit_exceeded')
    elif day==om.moment(plan['nextUtc']).date().isoformat():
        ack=q.Journal(handoff.BASE).latest('sql_ack_utc')
        if ack is None:fail('actual_financial_UTC_restore_ACK_required')
        q.same_policy(om,current,original,plan['otherAllocationsSha256'])
    else:fail('ordinary_runtime_next_day_requires_new_current_policy_review')
    return receipt,reviewed,plan,cleanup

def unused(q):
    if any(os.path.lexists(p)for p in [SYSTEMD/UNIT,SYSTEMD/(UNIT+'.d'),Path('/run/systemd/transient')/UNIT]):fail('fresh_ordinary_source_unit_required')
    value=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',UNIT,'--property=LoadState','--property=ActiveState','--property=MainPID']).splitlines())
    if value!={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'}:fail('ordinary_source_unit_already_exists')

def review(q,handoff,live,model,native,qe,om,n,c,v,*,offline_proof=None):
    if os.path.lexists(BASE):
        s=BASE.lstat()
        if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700 or any(BASE.iterdir()):fail('one_fresh_ordinary_handover_only')
    receipt,closed,plan,cleanup=financial_state(q,handoff,live,model,native,qe,om);selected=profile(q,native,qe);unused(q)
    refs=closed['completion'];journal=live.journal_for(q,Path(refs['journal']['file']).parent)
    record=handoff.pinned(q,refs['nativeStopped']['file'],refs['nativeStopped']['sha256'])['record'];handoff.terminal(q,live,native,journal,record)
    peer=source_state(q,qe,native,closed['sourceRole'],running=False)
    if record is None or peer['checkpoints']!=record['seal']['metrics']['checkpoints']:fail('actual_retained_prod3_stopped_checkpoints_required')
    if sha(q.protected(WORKSPACE/'launch.env',100000))!=LAUNCH_SHA:fail('retained_grant_free_launch_bytes_changed')
    codepins=record['binding']['codePins']
    for path,pin in codepins.items():
        if sha(q.protected(Path(path),2000000))!=pin:fail('acknowledged_source_code_changed')
    rpc_overlay=overlay_state(q,native,offline_proof=offline_proof)
    proxies={}
    for name in CHAINS:
        before=proxy_metadata(q,qe,n,c,v,name)
        if before!=closed['proxies'][name]:fail('current_proxy_must_match_completed_handoff_binding')
        public,drop,_,_=proxy_files(name)
        if os.path.lexists(public)or os.path.lexists(drop)or any(Path(path).name>=OVERRIDE for path in list(before['definitions'])[1:]):fail('fresh_final_public_normal_profile_selector_required')
        # Legacy configuration is captured before selector change; all source6
        # traffic remains false/free. No upstream RPC is sent in this review.
        metrics=v.request(CHAINS[name][1],'/metrics');config={k:metrics.get(k)for k in v.CONFIG_KEYS}
        if metrics.get('unified',{}).get('sourceRouting')!='free_first':fail('paid_primary_not_removed')
        proxies[name]={'before':before,'legacyConfiguration':config}
    if os.path.lexists(OPS/'source6-free-runtime-v2.env'):fail('fresh_public_source_overlay_required')
    return {'format':FORMAT,'operatorSha256':sha(q.protected(Path(__file__).absolute(),200000)),'financialHandoffFile':str(handoff.BASE/'handoff.json'),
        'financialHandoffSha256':sha(q.protected(handoff.BASE/'handoff.json')),'prod3Completion':closed['completion'],'migrationBookedCu':cleanup['migrationBookedGrantsCu'],
        'profile':selected,'sourceRole':peer['role'],'checkpointsSha256':sha(encoded(peer['checkpoints'])),'codePins':codepins,'launchEnvSha256':LAUNCH_SHA,
        'rpcOverlay':rpc_overlay,'processReaderSha256':PROCESS_SHA,'sourceDigest':native.ACTOR,'releaseId':native.RELEASE,'schema':native.SCHEMA,'nativeBuild':native.NATIVE,'runtimeScope':RUNTIME_SCOPE,
        'proxies':proxies,'sourceOverlaySha256':sha(source_overlay()),'freeOnly':True,'permitIds':[],'paidAuthority':False,'newPaidApprovalWindow':False,'automaticRetryAllowed':False}

def public_write(q,path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'wb')as out:os.fchmod(out.fileno(),0o644);out.write(raw);out.flush();os.fsync(out.fileno())
    q.sync_directory(path.parent)

def runtime(q,native,definition,*,saved=None):
    if type(definition.get('maximumRuntimeSeconds'))is not int or not 30<=definition['maximumRuntimeSeconds']<=28800:fail('finite_remaining_original_runtime_cap_required')
    old=types.SimpleNamespace(command=lambda argv,env=ENV,timeout=5:q.run(argv,timeout=timeout))
    p=native.unit_props(old,UNIT)
    qe,_,_=q.modules();p['Type']=qe.bus_property(UNIT,'org.freedesktop.systemd1.Service','Type','s')
    if(p['Id']!=UNIT or p['Type']!='exec'or p['ActiveState']!='active'or p['SubState']!='running'or not re.fullmatch('[0-9a-f]{32}',p['InvocationID'])or
        not p['MainPID'].isdigit()or int(p['MainPID'])<=1 or p['User']!=native.USER or p['Group']!=native.USER or
        p['WorkingDirectory']!=str(WORKSPACE/'apps/yunipals-indexer')or re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[' '.join(source_command())]):fail('exact_owned_ordinary_source_runtime_required')
    q.assert_no_unit_environment(qe,UNIT);readonly_bind(qe,UNIT)
    _,_,c,_,_=qe.modules();parser=c.persistent();expected=definition['properties']
    if(any(p[k]!=v for k,v in expected.items()if k not in {'RuntimeMaxSec','CPUQuota','TimeoutStopSec','IPAddressDeny','IPAddressAllow','BindReadOnlyPaths'})or
        parser.duration_us(p['RuntimeMaxUSec'])!=definition['maximumRuntimeSeconds']*1000000 or parser.duration_us(p['CPUQuotaPerSecUSec'])!=1000000 or
        parser.duration_us(p['TimeoutStopUSec'])!=30000000 or parser.address_networks(p['IPAddressDeny'])!={'0.0.0.0/0','::/0'}or
        parser.address_networks(p['IPAddressAllow'])!={'127.0.0.0/8','::1/128'}or p['Description']!='Yunipals ordinary source6 free-only '+definition['reviewHash']):fail('ordinary_runtime_resource_or_sandbox_drift')
    if(qe.bus_property(UNIT,'org.freedesktop.systemd1.Unit','FragmentPath','s')!=str(SYSTEMD/UNIT)or
        qe.bus_property(UNIT,'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[]or
        sha(q.protected(SYSTEMD/UNIT,50000))!=definition['sha256']or qe.bus_property(UNIT,'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=definition['maximumRuntimeSeconds']*1000000):fail('ordinary_source_definition_changed')
    reader=q.load(OPS/'source6-free-process-reader-v2.py',PROCESS_SHA,'ordinary_same_UID_process_reader');process=reader.identity(int(p['MainPID']),UNIT)
    actual={'unit':UNIT,'invocation':p['InvocationID'],'process':process,'definitionSha256':definition['sha256'],'sourceRole':native.USER}
    if saved is not None and actual!=saved:fail('ordinary_source_invocation_or_process_changed')
    cutoff=definition.get('originalRuntimeExpiresMonotonicMicroseconds')
    if type(cutoff)is not int or int(p['ExecMainStartTimestampMonotonic'])+definition['maximumRuntimeSeconds']*1000000>cutoff:fail('original_eight_hour_runtime_expiry_must_not_extend')
    return actual

def apply(q,handoff,live,model,epoch,native,qe,om,n,c,v,reviewed,expected):
    if sha(encoded(reviewed))!=expected:fail('exact_fresh_ordinary_source_review_required')
    # One handover lease: stop proof/current false graph -> four owned restarts
    # -> exact source startup/receipt. It is released before return.
    with ExitStack()as locks:
        locks.enter_context(c.source_lease())
        for name in CHAINS:locks.enter_context(v.chain_lock(name))
        fresh=review(q,handoff,live,model,native,qe,om,n,c,v,offline_proof=reviewed['rpcOverlay']['offlineBuild'])
        if fresh!=reviewed:fail('ordinary_handover_current_inputs_changed')
        BASE.mkdir(mode=0o700,exist_ok=True);q.sync_directory(BASE.parent);q.save(BASE/'review.json',reviewed);q.save(BASE/'intent.json',{'reviewHash':expected,'automaticRetryAllowed':False});j=q.Journal(BASE);stage='public_profile_selectors'
        try:
            for name in CHAINS:
                before=proxy_metadata(q,qe,n,c,v,name)
                if before!=reviewed['proxies'][name]['before']:fail('owned_proxy_before_identity_changed')
                public,drop,body,text=proxy_files(name);public_write(q,public,body);public_write(q,drop,text)
                j.emit('normal_selector_created',chain=name,publicSha256=sha(body),overrideSha256=sha(text));q.run(['/usr/bin/systemctl','daemon-reload'])
                stage='normal_profile_restart_'+name;q.run(['/usr/bin/systemctl','restart','yunipals-market-production-rpc@'+name+'.service'],timeout=150)
                after=proxy_metadata(q,qe,n,c,v,name);compare_proxy(before,after,name,selected=True)
                if after['invocation']==before['invocation']:fail('fresh_proxy_process_required_for_normal_profile')
                config=v.retry(lambda:health(q,v,native,name,reviewed['proxies'][name]['legacyConfiguration']))
                q.save(BASE/(name+'-normal.json'),{'before':before,'after':after,'configuration':config});j.emit('normal_proxy_restarted',chain=name,invocation=after['invocation'])
            stage='source_environment';public_write(q,OPS/'source6-free-runtime-v2.env',source_overlay());effective_environment(q)
            source_state(q,qe,native,reviewed['sourceRole'],running=False);unused(q);profile(q,native,qe)
            definition=source_definition(native,expected);q.save(BASE/'definition.json',definition);public_write(q,SYSTEMD/UNIT,definition['text'].encode());q.run(['/usr/bin/systemctl','daemon-reload'])
            stage='single_ordinary_source_start';q.save(BASE/'source-start-intent.json',{'unit':UNIT,'definitionSha256':definition['sha256'],'automaticRetryAllowed':False})
            q.run(['/usr/bin/systemctl','start',UNIT],timeout=15);actual=runtime(q,native,definition)
            proxies={}
            for name in CHAINS:
                saved=json.loads(q.protected(BASE/(name+'-normal.json')));current=proxy_metadata(q,qe,n,c,v,name)
                if current!=saved['after']:fail('normal_proxy_changed_before_runtime_receipt')
                compare_proxy(saved['before'],current,name,selected=True);health(q,v,native,name,saved['configuration']);proxies[name]=saved
            v.retry(lambda:(source_health(),source_state(q,qe,native,reviewed['sourceRole'],running=True)))
            runtime(q,native,definition,saved=actual)
            result={'format':FORMAT,'reviewFile':str(BASE/'review.json'),'reviewSha256':expected,'definition':definition,'ordinaryRuntime':actual,'proxies':proxies,
                'profile':reviewed['profile'],'financialHandoffFile':reviewed['financialHandoffFile'],'financialHandoffSha256':reviewed['financialHandoffSha256'],
                'freeOnly':True,'permitIds':[],'paidAuthority':False,'runtimeScope':RUNTIME_SCOPE,'sourceLeaseReleaseRequiredBeforeReturn':True}
            pin=q.save(BASE/'runtime.json',result);j.emit('ordinary_runtime_started',receiptSha256=pin,unit=UNIT,invocation=actual['invocation'])
        except BaseException as error:
            q.save(BASE/'failed.json',{'stage':stage,'failure':failure(error),'manualReconcileRequired':True,'automaticRetryAllowed':False});raise
    # The receipt proves the handover sequence; this separate ACK is written
    # only after the actual context manager released source+chain leases.
    q.save(BASE/'handover-released.json',{'runtimeReceiptSha256':pin,'sourceAndChainHandoverLeasesReleased':True})
    return {'format':FORMAT,'runtimeReceiptFile':str(BASE/'runtime.json'),'runtimeReceiptSha256':pin,'sourceStarted':True,'paidAuthority':False,'runtimeScope':RUNTIME_SCOPE}

def validate_current(receipt_file,receipt_sha):
    q,handoff,live,model,_,native,qe,om,n,c,v=modules()
    if Path(receipt_file)!=BASE/'runtime.json':fail('exact_ordinary_runtime_receipt_path_required')
    value=handoff.pinned(q,receipt_file,receipt_sha);reviewed=handoff.pinned(q,value['reviewFile'],value['reviewSha256'])
    released=json.loads(q.protected(BASE/'handover-released.json'))
    if(os.path.lexists(BASE/'failed.json')or value.get('format')!=FORMAT or reviewed.get('operatorSha256')!=sha(q.protected(Path(__file__).absolute(),200000))or
        value.get('freeOnly')is not True or value.get('permitIds')!=[]or value.get('paidAuthority')is not False or value.get('runtimeScope')!=RUNTIME_SCOPE or
        released!={'runtimeReceiptSha256':receipt_sha,'sourceAndChainHandoverLeasesReleased':True}):fail('acknowledged_released_free_runtime_required')
    receipt,closed,plan,cleanup=financial_state(q,handoff,live,model,native,qe,om)
    if sha(q.protected(Path(value['financialHandoffFile'])))!=value['financialHandoffSha256']or value['profile']!=profile(q,native,qe):fail('ordinary_runtime_profile_or_financial_lineage_changed')
    for path,pin in reviewed['codePins'].items():
        if sha(q.protected(Path(path),2000000))!=pin:fail('acknowledged_ordinary_source_code_changed')
    if overlay_state(q,native,offline_proof=reviewed['rpcOverlay']['offlineBuild'])!=reviewed['rpcOverlay']:fail('owned_RPC_overlay_changed')
    if sha(q.protected(WORKSPACE/'launch.env',100000))!=LAUNCH_SHA or sha(q.protected(OPS/'source6-free-runtime-v2.env',2000))!=sha(source_overlay()):fail('ordinary_grant_free_source_environment_changed')
    actual=runtime(q,native,value['definition'],saved=value['ordinaryRuntime']);source_health();peer=source_state(q,qe,native,reviewed['sourceRole'],running=True);proxies={}
    for name,saved in value['proxies'].items():
        current=proxy_metadata(q,qe,n,c,v,name)
        if current!=saved['after']:fail('ordinary_proxy_invocation_or_inputs_changed')
        compare_proxy(saved['before'],current,name,selected=True);configuration=health(q,v,native,name,saved['configuration'])
        proxies[str(CHAINS[name][0])]={'invocation':current['invocation'],'definitionsSha256':sha(encoded(current['definitions'])),
            'privateSettingsSha256':sha(encoded({'settings':current['privateSettings'],'files':current['environmentFileHashes']})),'configuration':configuration}
    if runtime(q,native,value['definition'],saved=value['ordinaryRuntime'])!=actual:fail('ordinary_runtime_changed_during_validation')
    return {'sourceDigest':native.ACTOR,'releaseId':native.RELEASE,'schema':native.SCHEMA,'nativeBuild':native.NATIVE,
        'prod3Cleanup':{'file':closed['completion']['currentDayCleanup']['file'],'sha256':closed['completion']['currentDayCleanup']['sha256'],'bookedCu':cleanup['migrationBookedGrantsCu'],'policy':cleanup['policy']},
        'ordinaryRuntime':{**actual,'roleOid':peer['role']['oid']},'profile':value['profile'],'proxies':proxies,'freeOnly':True,'permitIds':[],'paidAuthority':False,'runtimeScope':RUNTIME_SCOPE,'rpcOverlay':reviewed['rpcOverlay']}

def failure(error):
    trace=error.__traceback__;frames=[];labels=set()
    while trace:
        code=trace.tb_frame.f_code;path=Path(code.co_filename)
        if path.absolute()==Path(__file__).absolute():
            frames.append({'file':path.name,'function':code.co_name,'line':trace.tb_lineno})
            if error.args and isinstance(error.args[0],str)and error.args[0]in code.co_consts:labels.add(error.args[0])
        trace=trace.tb_next
    return {'errorClass':type(error).__name__,'fixedCodeLabels':sorted(labels),'publicFrames':frames[-12:],'errno':error.errno if isinstance(error,OSError)else None,'rawMessageExported':False}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply');a=p.parse_args();q,handoff,live,model,epoch,native,qe,om,n,c,v=modules()
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('fixed_production_root_required')
    q.actual_root_capabilities();os.umask(0o077)
    def stop(*_):raise InterruptedError('bounded_ordinary_handover_interrupted')
    for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,stop)
    signal.alarm(900)
    try:
        reviewed=review(q,handoff,live,model,native,qe,om,n,c,v)
        out=apply(q,handoff,live,model,epoch,native,qe,om,n,c,v,reviewed,a.apply)if a.apply else {'format':FORMAT,'reviewHash':sha(encoded(reviewed)),'applied':False,'profileId':PROFILE_ID,'sourceStarted':False,'paidAuthority':False,'runtimeScope':RUNTIME_SCOPE,'nativeBuild':reviewed['nativeBuild'],'rpcOverlaySha256':sha(encoded(reviewed['rpcOverlay'])),'offlineBuild':reviewed['rpcOverlay']['offlineBuild']}
        print(json.dumps(out,sort_keys=True))
    finally:signal.alarm(0)

if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'failure':failure(error),'automaticRetryAllowed':False},sort_keys=True));raise SystemExit(1)
