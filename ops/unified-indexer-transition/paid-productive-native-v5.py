#!/usr/bin/env python3
"""Exact retained008 native process for a separately admitted original paid epoch.

Library only: no admission, SQL writes, lease acquisition, proxy change or retry.
The caller holds the Q session's source+both chain locks for this whole API.
"""
from __future__ import annotations

import ctypes
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import select
import shutil
import signal
import socket
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-paid-productive-native-v5-20261021')
FORMAT = 'yunipals-paid-productive-native-v5'
ACTOR = '008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
NATIVE = 'bf4939b3ff'
SCHEMA = 'unified_shadow_20261020_7e7375b0'
RELEASE = '0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
MANIFEST = '0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029'
USER = 'yunipals_unified_shadow'
NODE = '/opt/node-v24.18.1/bin/node'
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
STOP_SHA = 'dc1ec6334f9c777b1495b0835662ff31593ef51eaa3cf0a1887940cb885bf62d'
RESUME_SHA = '3756ad3a2eb27f21fe9f1f7005847ff42952838f220cced1db53d8a6759a539b'
Q_SHA = 'eedd6c9a569ce1a805eab4e3b8d8b01674185474e4caab8cd3a293183685815f'
MODEL_SHA = '872f05a70c790f088dbbca6f2d7280cd8f527c038b3e72c8acfe64539a5b6c25'
EPOCH_SHA = 'b769398e731329e2a3cfd6eaafd9ec276d539af4c563a3e2d7c48890007535c0'
LIVE_BASE = Path('/var/backups/yunipals-paid-productive-live-v3-20261021')
PROXY_UNITS = {name:'yunipals-market-production-rpc@'+name+'.service' for name in ['base','bnb']}
ORIGINAL_CACHE = 531472384
RESERVE = 25_000_000_000
SCHEMA_CAP = 8_000_000_000
CACHE_GROWTH_CAP = 6_000_000_000
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(message): raise RuntimeError(message)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def is_sha(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None
def invocation(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{32}', value) is not None
def moment(value):
    if not isinstance(value, str) or not value.endswith('Z'): fail('Original UTC deadline required.')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))
def utc_now(): return datetime.now(timezone.utc)
def unit_name(run_id):
    if not isinstance(run_id, str) or not re.fullmatch('20261021-[a-z0-9-]{1,30}', run_id): fail('Fresh bounded productive run selector required.')
    return 'yunipals-unified-paid-productive-v5-' + run_id + '.service'
def description(marker): return 'Yunipals original-epoch productive native v5 ' + marker
def os_identity():
    account=pwd.getpwnam(USER)
    if account.pw_uid<=0 or account.pw_gid<=0: fail('Prepared nonroot native OS peer required.')
    return {'name':USER,'uid':account.pw_uid,'gid':account.pw_gid}

def remaining(plan, now):
    start, expires = moment(plan['start']), moment(plan['expires'])
    if (expires != min(start + timedelta(hours=8), moment(plan['nextUtc']), moment(plan['profileExpiresAt'])) or
        not start <= now < expires): fail('Same original bounded epoch required; no renewal.')
    dispatch = moment(plan['dispatchExpires'])
    if dispatch != expires-timedelta(seconds=90): fail('Original 90-second dispatch/drain reserve required.')
    value = int((dispatch - now).total_seconds()) - 10
    if value < 60 or value > 28800: fail('Insufficient original epoch remains for safe native launch.')
    return value


def scalar_state(q, *, running, expected):
    value = q.query("""SELECT jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,
       'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,
       'connectionLimit',rolconnlimit) FROM pg_roles WHERE rolname='yunipals_unified_shadow'),
      'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow') OR roleid=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')),
      'sessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='yunipals_unified_shadow'),
      'supportSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='yunipals_unified_support'),
      'activeSelectors',(SELECT count(*) FROM yunipals_indexer_control.active_release),
      'sourceIdentity',(SELECT jsonb_build_object('release',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash) FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'sourceManifest',(SELECT manifest FROM yunipals_indexer_control.release WHERE id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','build',value->>'build_id','dev',value->>'is_dev') FROM unified_shadow_20261020_7e7375b0._ponder_meta WHERE key='app'))""")
    if (set(value) != {'role','memberships','sessions','supportSessions','activeSelectors','sourceIdentity','sourceManifest','runtime'} or
        value['role'] != expected['role'] or value['sourceIdentity'] != expected['sourceIdentity'] or value['runtime'] != expected['runtime'] or
        value['sourceManifest'] != expected['sourceManifest'] or
        value['sourceIdentity'] != {'release': RELEASE, 'schema': SCHEMA, 'build': NATIVE, 'manifestHash': MANIFEST} or
        value['runtime'] != {'version':'6','build':NATIVE,'dev':'0'} or
        any(type(value[k]) is not int or value[k] != 0 for k in ['memberships','supportSessions','activeSelectors']) or
        type(value['sessions']) is not int or not 0 <= value['sessions'] <= (32 if running else 0)):
        fail('Native role/session/build/release/selector guard changed.')
    role = value['role']
    if (role.get('connectionLimit') != 32 or role.get('login') is not True or
        any(role.get(k) is not False for k in ['inherit','super','createDb','createRole','replication','bypassRls'])):
        fail('Restricted source peer contract changed.')
    return value


def metrics_ok(value, expected_relations=None):
    if (set(value) != {'schemaBytes','cacheBytes','sourceRelations','runtime','checkpoints'} or
        any(type(value[k]) is not int or value[k] < 0 for k in ['schemaBytes','cacheBytes','sourceRelations']) or
        value['runtime'].get('buildId') != NATIVE or
        (expected_relations is not None and value['sourceRelations'] != expected_relations)):
        fail('Retained native physical metrics changed.')
    points = value['checkpoints']
    if (not isinstance(points,list) or len(points) != 4 or {r.get('chain') for r in points} != {1,56,137,8453} or
        any(set(r) != {'chain','latest','safe','finalized'} or any(not isinstance(r[k],str) or not re.fullmatch('[0-9]{75}',r[k]) for k in ['latest','safe','finalized']) for r in points)):
        fail('Four actual physical checkpoint tuples required.')
    return value


def source_anchors(q):
    rows = q.query("""SELECT coalesce(jsonb_agg(jsonb_build_object('chain',chain_id,'number',block_number::text,
      'hash',block_hash,'parentHash',parent_hash,'timestamp',timestamp::text) ORDER BY chain_id),'[]'::jsonb)
      FROM unified_shadow_20261020_7e7375b0.chain_checkpoint""")
    # Block handlers start at latest. Historical physical checkpoints can
    # advance before any realtime block witness exists; absence is not proof
    # of canonical readiness and must not be replaced by a fixture anchor.
    if (not isinstance(rows,list) or len(rows)>4 or len({r.get('chain') for r in rows})!=len(rows) or
        any(r.get('chain') not in {1,56,137,8453} for r in rows) or
        any(set(r)!={'chain','number','hash','parentHash','timestamp'} or
            any(not isinstance(r[k],str) or re.fullmatch('0|[1-9][0-9]*',r[k]) is None for k in ['number','timestamp']) or
            any(not isinstance(r[k],str) or re.fullmatch('0x[0-9a-f]{64}',r[k]) is None for k in ['hash','parentHash']) for r in rows)):
        fail('Exact sparse allowed-chain source block witnesses required.')
    return rows


def code_pins(c, workspace):
    project=workspace/'apps/yunipals-indexer'
    paths=[project/'ponder.config.ts',project/'ponder.schema.ts',project/'package.json',workspace/'rpc-profile.json']
    for directory in [project/'src',project/'lib/arena',project/'lib/unified',project/'lib/boosters']:
        paths += sorted(directory.rglob('*.ts'))
    entry=(project/'node_modules/ponder/dist/esm/bin/ponder.js').resolve(strict=True)
    if not entry.is_relative_to(workspace): fail('Native runtime entrypoint escapes retained workspace.')
    paths.append(entry)
    return {str(path):sha(c.trusted(path,2_000_000)) for path in paths}


def resource_reason(free, metrics):
    if free < RESERVE: return 'disk_reserve'
    if metrics['schemaBytes'] > SCHEMA_CAP: return 'schema_cap'
    if metrics['cacheBytes'] - ORIGINAL_CACHE > CACHE_GROWTH_CAP: return 'cache_growth_cap'
    return None


def properties(workspace, maximum):
    project = workspace / 'apps/yunipals-indexer'
    return {'User':USER,'Group':USER,'WorkingDirectory':str(project),'RuntimeMaxSec':str(maximum),
        'MemoryMax':'2147483648','MemorySwapMax':'0','CPUQuota':'100%','IOWeight':'10','Restart':'no','TimeoutStopSec':'30',
        'KillMode':'control-group','TasksMax':'128','NoNewPrivileges':'yes','PrivateTmp':'yes','ProtectSystem':'strict',
        'ProtectHome':'yes','RestrictSUIDSGID':'yes','UMask':'0027','IPAddressDeny':'any','IPAddressAllow':'127.0.0.0/8 ::1',
        'ReadWritePaths':str(project/'.ponder')+' '+str(project/'ponder-env.d.ts')}


def command_argv(workspace, overlay):
    return ['/usr/bin/env','-i',NODE,'--env-file='+str(workspace/'launch.env'),'--env-file='+str(overlay),
        str(workspace/'apps/yunipals-indexer/node_modules/ponder/dist/esm/bin/ponder.js'),
        'start','--schema',SCHEMA,'--hostname','127.0.0.1','--port','9024']


def overlay_bytes(plan):
    rows = plan['permits']
    if len(rows) != 2 or {r['chainId'] for r in rows} != {56,8453}: fail('Only exact productive BNB/Base permit IDs allowed.')
    values = {r['chainId']:r['permitId'] for r in rows}
    if any(not isinstance(v,str) or not re.fullmatch('0x[0-9a-f]{64}',v) for v in values.values()): fail('Exact productive IDs required.')
    return ''.join('UNIFIED_RPC_REPLAY_PERMIT_ID_'+str(chain)+'='+values[chain]+'\n' for chain in [56,8453]).encode()


def source_access(old, identity, overlay=None, expected=None):
    # Check effective access as the actual nonroot UID without supplementary
    # groups/process capabilities. The controller has only SETUID/GID/KILL;
    # clearing its bounding set would require the deliberately absent SETPCAP.
    # The inherited bound alone confers no nonroot authority, and NNP prevents
    # exec-based privilege gain. Never chmod existing staging directories.
    code="""import hashlib,json,os,pathlib,sys
uid,gid=int(sys.argv[1]),int(sys.argv[2]);root=pathlib.Path(sys.argv[3]);path=sys.argv[4]
caps={}
for line in pathlib.Path('/proc/self/status').read_text().splitlines():
 k,sep,v=line.partition(':')
 if k in {'CapInh','CapPrm','CapEff','CapBnd','CapAmb'}:caps[k]=int(v.strip(),16)
 if k=='NoNewPrivs':nnp=int(v.strip())
if os.getuid()!=uid or os.getgid()!=gid or os.getgroups()!=[] or len(caps)!=5 or caps['CapBnd']!=224 or any(caps[k] for k in ['CapInh','CapPrm','CapEff','CapAmb']) or nnp!=1:raise RuntimeError('restricted_access_probe')
if not os.access(root,os.X_OK):raise RuntimeError('public_directory_not_traversable')
digest=None
if path!='-':
 p=pathlib.Path(path)
 if p.parent!=root or p.stat().st_size>2000:raise RuntimeError('bounded_public_file')
 digest=hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps({'directoryTraversable':True,'fileSha256':digest,'groupsEmpty':True,'capabilitiesZero':True,'boundingSet':224,'noNewPrivileges':True}))
"""
    argv=['/usr/bin/setpriv','--reuid='+str(identity['uid']),'--regid='+str(identity['gid']),'--clear-groups',
        '--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/env','-i',
        'PATH=/usr/sbin:/usr/bin:/sbin:/bin','LANG=C.UTF-8','TZ=UTC','/usr/bin/python3','-I','-c',code,
        str(identity['uid']),str(identity['gid']),str(OPS),str(overlay) if overlay else '-']
    result=json.loads(old.command(argv,env=ENV,timeout=5))
    if result!={'directoryTraversable':True,'fileSha256':expected,'groupsEmpty':True,'capabilitiesZero':True,'boundingSet':224,'noNewPrivileges':True}:
        fail('Effective source-user public input access unavailable.')
    return result


def unit_props(old, unit):
    keys = ['Id','Description','LoadState','ActiveState','SubState','InvocationID','MainPID','Result','ExecMainStatus','ExecStart',
        'ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic','FragmentPath','DropInPaths','MemoryCurrent','MemoryPeak','CPUUsageNSec',
        'User','Group','WorkingDirectory','RuntimeMaxUSec','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','IOWeight','Restart','TimeoutStopUSec',
        'KillMode','TasksMax','NoNewPrivileges','PrivateTmp','ProtectSystem','ProtectHome','RestrictSUIDSGID','UMask','IPAddressDeny','IPAddressAllow','ReadWritePaths']
    raw = old.command(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in keys]],env=ENV,timeout=4)
    value = {}
    for line in raw.splitlines():
        key, sep, item = line.partition('=')
        if not sep or key not in keys or key in value: fail('Unexpected native unit properties.')
        value[key] = item
    # Empty complex DropInPaths may be omitted by systemctl. This property is
    # independently proved empty through typed D-Bus before accepting absence.
    if 'DropInPaths' not in value:
        value['DropInPaths'] = typed_empty(old,unit,'org.freedesktop.systemd1.Unit','DropInPaths','as')
    if set(value) != set(keys) or value['Id'] != unit or value['LoadState'] != 'loaded' or not invocation(value['InvocationID']):
        fail('Exact loaded native actor required; no GC adoption.')
    return value


def typed_empty(old, unit, interface, key, typ):
    def read(args): return json.loads(old.command(args,env=ENV,timeout=3))
    path = read(['/usr/bin/busctl','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',unit])
    if set(path) != {'type','data'} or path['type'] != 'o' or len(path['data']) != 1 or not re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',path['data'][0]): fail('Exact typed native object required.')
    result = read(['/usr/bin/busctl','--json=short','get-property','org.freedesktop.systemd1',path['data'][0],interface,key])
    if result != {'type':typ,'data':[]}: fail('Only a proved empty native complex property can be absent.')
    return ''


def process_identity(pid, unit):
    if type(pid) is not int or pid <= 1: fail('Exact native process required.')
    account = pwd.getpwnam(USER); root = Path('/proc')/str(pid)
    raw = (root/'stat').read_text(); end=raw.rfind(')'); fields=raw[end+2:].split()
    if not raw.startswith(str(pid)+' (') or end<0 or len(fields)<20 or not fields[19].isdigit(): fail('Native process start unavailable.')
    ids = {}
    for line in (root/'status').read_text().splitlines():
        key,sep,item=line.partition(':')
        if key in {'Uid','Gid'} and sep: ids[key]=item.split()
    if ids != {'Uid':[str(account.pw_uid)]*4,'Gid':[str(account.pw_gid)]*4}: fail('Native OS identity changed.')
    if (root/'cgroup').read_text().splitlines() != ['0::/system.slice/'+unit]: fail('Native cgroup identity changed.')
    if (root/'exe').resolve(strict=True) != Path(NODE): fail('Native PID no longer executes the pinned Node path.')
    return {'pid':pid,'startTicks':int(fields[19]),'uid':account.pw_uid,'gid':account.pw_gid,'executable':NODE}


class References:
    """One apply-only system-bus connection, one exact owned productive unit."""
    def __init__(self, unit):
        if unit_name(unit.removeprefix('yunipals-unified-paid-productive-v5-').removesuffix('.service')) != unit:
            fail('Only an exact owned productive unit may be referenced.')
        self.unit=unit; self.bus=ctypes.c_void_p(); self.lib=ctypes.CDLL('libsystemd.so.0'); self.held=False
        self.lib.sd_bus_open_system.argtypes=[ctypes.POINTER(ctypes.c_void_p)]; self.lib.sd_bus_open_system.restype=ctypes.c_int
        self.lib.sd_bus_set_method_call_timeout.argtypes=[ctypes.c_void_p,ctypes.c_uint64];self.lib.sd_bus_set_method_call_timeout.restype=ctypes.c_int
        self.lib.sd_bus_call_method.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_void_p),ctypes.c_char_p]
        self.lib.sd_bus_call_method.restype=ctypes.c_int
        self.lib.sd_bus_message_unref.argtypes=[ctypes.c_void_p];self.lib.sd_bus_message_unref.restype=ctypes.c_void_p
        self.lib.sd_bus_flush_close_unref.argtypes=[ctypes.c_void_p];self.lib.sd_bus_flush_close_unref.restype=ctypes.c_void_p
    def acquire(self):
        if self.held: fail('One owned native reference only.')
        try:
            if self.lib.sd_bus_open_system(ctypes.byref(self.bus))<0: fail('Bounded native GC reference unavailable.')
            if self.lib.sd_bus_set_method_call_timeout(self.bus,ctypes.c_uint64(3_000_000))<0: fail('Native bus timeout unavailable.')
            self.call('RefUnit');self.held=True
        except BaseException:
            self.close();raise
    def call(self,method):
        if method not in {'RefUnit','UnrefUnit'}: fail('No other native D-Bus mutation allowed.')
        reply=ctypes.c_void_p()
        result=self.lib.sd_bus_call_method(self.bus,b'org.freedesktop.systemd1',b'/org/freedesktop/systemd1',b'org.freedesktop.systemd1.Manager',method.encode(),None,ctypes.byref(reply),b's',ctypes.c_char_p(self.unit.encode()))
        if reply.value: self.lib.sd_bus_message_unref(reply)
        if result<0: fail('Bounded owned native GC reference failed.')
    def close(self):
        try:
            if self.held: self.call('UnrefUnit')
        finally:
            self.held=False
            if self.bus.value: self.lib.sd_bus_flush_close_unref(self.bus);self.bus=ctypes.c_void_p()


def static_context(session, plan):
    c,v = session.c,session.v
    q = c.load(OPS/'source6-paid-epoch-v1.py',Q_SHA,'productive_q_reader')
    stop = c.load(OPS/'long2-source6-stop-v2.py',STOP_SHA,'productive_stopped_context')
    resume = c.load(OPS/'persistent-source5-resume.py',RESUME_SHA,'productive_saved_resume')
    p = c.persistent()
    proof,binding,last = session.n.stop_proof(c,v,session.plan['stopProofSha256'])
    review = json.loads(c.trusted(session.n.LONG2/'review.json'))
    _,ctx,_,_ = stop.prepare(resume,c,v,p,review)
    if (str(ctx.workspace) != proof['retainedWorkspace'] or binding['sourceDigest'] != ACTOR or binding['nativeBuild'] != NATIVE or
        ctx.old.SCHEMA != SCHEMA or ctx.old.NODE != NODE or c.sha(c.trusted(Path(NODE),150_000_000)) != NODE_SHA): fail('Exact retained008 native context required.')
    # Current checkpoints are checked in fresh review(), not here: explicit
    # crash recovery must reconstruct immutable context before validating its
    # exact ACKed live handle, whose checkpoints can legitimately have advanced.
    return types.SimpleNamespace(old=ctx.old,p=p,ctx=ctx,q=q,workspace=ctx.workspace,stopProof=proof,last=last)


class NativeRun:
    def __init__(self, session, plan, run_id, context, record_callback):
        self.session=session;self.plan=plan;self.plan_sha=sha(encoded(plan));self.run_id=run_id;self.unit=unit_name(run_id)
        if run_id == session.plan['runId']: fail('Productive run must be distinct from Q.')
        self.context=context;self.callback=record_callback;self.record=None;self.directory=None;self.references=None
        self.overlay=OPS/('paid-productive-v5-'+run_id+'.native.env')
        self.prepared_code=code_pins(session.c,context.workspace)
        self.prepared_launch=sha(session.c.trusted(context.workspace/'launch.env'))
        self.operator_sha=sha(session.c.trusted(Path(__file__).absolute()))
        self.os_peer=os_identity()
        self.pre_epoch_binding=None;self.proxy_epoch=None;self.proxy_transition=None;self.cleanup_transition=None
    def held(self):
        self.session.held()
        if sha(encoded(self.plan)) != self.plan_sha: fail('Reviewed productive plan mutated.')
        if sha(self.session.c.trusted(Path(__file__).absolute()))!=self.operator_sha: fail('Loaded native operator file changed.')
        if os_identity()!=self.os_peer: fail('Prepared native OS peer changed.')
        if not self.session.record or self.session.record.get('cleaned') is not True: fail('Acknowledged cleaned Q lineage required.')
    def publish(self,label):
        if not callable(self.callback): fail('Durable native phase acknowledgement required before mutation.')
        path=self.directory/(label+'.json');raw=encoded({'format':FORMAT,'record':self.record})
        self.session.v.save_new(path,raw);self.callback(str(path),sha(raw))
        return {'recordFile':str(path),'recordSha256':sha(raw)}
    def fresh_state(self,running):
        self.held();ctx=self.context
        peer=scalar_state(ctx.q,running=running,expected=self.session.record['review']['sourcePeer'])
        metrics=metrics_ok(ctx.old.source_metrics(),self.context.last['after']['metrics']['sourceRelations'])
        legacy=ctx.old.service_states(ctx.old.LEGACY_UNITS);selector=ctx.old.active_selector()
        if selector != []: fail('Native productive replay cannot promote views/selectors.')
        return {'peer':peer,'metrics':metrics,'anchors':source_anchors(ctx.q),'legacyUnits':legacy,'activeSelector':selector,'freeBytes':shutil.disk_usage('/opt/yunipals-unified').free}
    def review(self):
        self.held()
        if self.record is not None: fail('Fresh native review only; use the exact acknowledged handle for recovery.')
        ctx=self.context
        state=self.fresh_state(False)
        if state['metrics']['runtime'] != ctx.last['after']['metrics']['runtime'] or state['metrics']['checkpoints'] != ctx.last['after']['metrics']['checkpoints']:
            fail('Retained checkpoints advanced before native approval.')
        if resource_reason(state['freeBytes'],state['metrics']): fail('Native cumulative resource cap unavailable.')
        if ctx.old.service_states((self.unit,))[self.unit]['LoadState'] != 'not-found': fail('A fresh native unit is required; no adoption.')
        ctx.old.free_port()
        if os.path.lexists(self.overlay): fail('Fresh public native permit overlay required.')
        if code_pins(self.session.c,ctx.workspace)!=self.prepared_code or sha(self.session.c.trusted(ctx.workspace/'launch.env'))!=self.prepared_launch:
            fail('Prepared immutable native code or launch config changed; no rebaseline.')
        access=source_access(ctx.old,self.os_peer)
        remaining(self.plan,utc_now())
        # Moving heartbeat/cache bytes are observed separately, not rebaselined.
        binding={'format':FORMAT,'runId':self.run_id,'operatorSha256':self.operator_sha,
            'productivePlanSha256':self.plan_sha,'originalStart':self.plan['start'],'originalExpires':self.plan['expires'],'dispatchExpires':self.plan['dispatchExpires'],
            'qReviewHash':self.session.record['reviewHash'],'qCleanRecordSha256':sha(encoded(self.session.record)),
            'stopProofSha256':self.session.plan['stopProofSha256'],'sourceDigest':ACTOR,'nativeBuild':NATIVE,'manifestHash':MANIFEST,
            'releaseId':RELEASE,'physicalSchema':SCHEMA,'retainedWorkspace':str(ctx.workspace),'workspaceProof':ctx.ctx.workspace_proof,
            'originalCacheBytes':ORIGINAL_CACHE,'previousRuntime':state['metrics']['runtime'],'previousCheckpoints':state['metrics']['checkpoints'],
            'previousAnchors':state['anchors'],'codePins':self.prepared_code,
            'sourceRole':state['peer']['role'],'osPeer':self.os_peer,'legacyUnits':state['legacyUnits'],'activeSelector':[],'launchEnvSha256':self.prepared_launch,
            'overlayFile':str(self.overlay),'overlaySha256':sha(overlay_bytes(self.plan)),
            'sourcePublicDirectoryAccess':access,'ownedProxyEpoch':deepcopy(self.proxy_transition),
            'schemaOrCacheReset':False,'newWorkspaceCopy':False,'automaticRetryAllowed':False}
        if self.proxy_transition is None:
            if self.pre_epoch_binding is None:self.pre_epoch_binding=deepcopy(binding)
        else:
            self.check_epoch(self.proxy_epoch,cleaned=False)
            self.check_enabled_record(self.proxy_epoch,self.proxy_transition['enabledRecordFile'],self.proxy_transition['enabledRecordSha256'])
            if self.proxy_epoch.record['reviewHash']!=self.proxy_transition['epochReviewHash']:fail('Prepared owned proxy epoch changed.')
            self.compare_proxy_states(self.pre_epoch_binding['legacyUnits'],state['legacyUnits'],self.proxy_transition['trueStates'])
        return {'reviewHash':sha(encoded(binding)),'binding':binding,'observation':{'freeBytes':state['freeBytes'],'schemaBytes':state['metrics']['schemaBytes'],'cacheBytes':state['metrics']['cacheBytes']}}
    def launch(self, marker):
        if not callable(self.callback): fail('Durable native phase acknowledgement required before mutation.')
        review=self.review()
        if self.proxy_transition is None:fail('Explicit acknowledged owned proxy epoch required before native launch.')
        if marker != review['reviewHash']: fail('Exact fresh native review required.')
        self.directory=private_directory(self.run_id,marker)
        self.session.v.save_new(self.directory/'review.json',encoded(review['binding']))
        self.record={'reviewHash':marker,'binding':review['binding'],'phase':'prepared','invocation':None,'process':None,'maximumSeconds':None,'startMonotonicMicroseconds':None,'definition':None,'terminal':None,'seal':None}
        self.publish('prepared')
        try:
            self.session.v.save_new(self.overlay,overlay_bytes(self.plan),0o644)
            self.record['phase']='overlay_created';self.publish('overlay-created')
            source_access(self.context.old,self.os_peer,self.overlay,self.record['binding']['overlaySha256'])
            maximum=remaining(self.plan,utc_now());before=time.monotonic()
            self.record['maximumSeconds']=maximum;self.record['phase']='start_requested';self.publish('start-requested')
            argv=['/usr/bin/systemd-run','--unit='+self.unit,'--description='+description(marker)]
            argv += ['--property='+k+'='+v for k,v in properties(self.context.workspace,maximum).items()]
            argv += command_argv(self.context.workspace,self.overlay)
            self.context.old.command(argv,env=ENV,timeout=10)
            self.references=References(self.unit);self.references.acquire()
            props=unit_props(self.context.old,self.unit)
            if props['ActiveState'] != 'active' or props['SubState'] != 'running': fail('New native did not reach running state.')
            self.record['invocation']=props['InvocationID'];self.record['maximumSeconds']=maximum
            self.record['startMonotonicMicroseconds']=int(props['ExecMainStartTimestampMonotonic'])
            if not 0 < self.record['startMonotonicMicroseconds'] <= time.monotonic_ns()//1000: fail('Actual native monotonic start required.')
            self.record['process']=process_identity(int(props['MainPID']),self.unit)
            fragment=Path(props['FragmentPath'])
            if fragment != Path('/run/systemd/transient')/self.unit: fail('Exact owned transient definition required.')
            self.record['definition']={'path':str(fragment),'sha256':sha(self.session.c.trusted(fragment,100_000))}
            self.validate_props(props,running=True)
            if self.record['startMonotonicMicroseconds']/1_000_000 + maximum > before + maximum + 10: fail('Native launch exceeded its original deadline allowance.')
            self.record['phase']='running'
            proof=self.publish('running')
            return {**proof,'unit':self.unit,'invocation':props['InvocationID'],'reviewHash':marker,'maximumSeconds':maximum,'originalExpires':self.plan['expires'],'dispatchExpires':self.plan['dispatchExpires']}
        except BaseException as error:
            self.session.v.save_new(self.directory/'launch-failed.json',encoded({'format':FORMAT,'errorClass':type(error).__name__,'record':self.record,'unknownAcknowledgementRequiresManualReconcile':True,'automaticRetryAllowed':False}))
            raise
    def check_epoch(self,epoch,*,cleaned,dispatch=True):
        self.held()
        if (epoch is None or epoch.q is not self.session or epoch.plan!=self.plan or epoch.run_id!=self.run_id or
            epoch.operator_sha!=EPOCH_SHA or sha(self.session.c.trusted(OPS/'paid-productive-epoch-v3.py',150000))!=EPOCH_SHA or
            not epoch.record or type(cleaned)is not bool or type(dispatch)is not bool or epoch.record.get('enabled')is not True or epoch.record.get('cleaned')is not cleaned or
            epoch.record.get('reviewHash')!=sha(encoded(epoch.record.get('review'))) or
            epoch.record['review'].get('plan')!=self.plan or epoch.record['review'].get('operatorSha256')!=EPOCH_SHA or
            set(epoch.record.get('chains',{}))!={'base','bnb'}):
            fail('Exact acknowledged productive proxy epoch required; no rebaseline.')
        epoch.held()
        if cleaned:
            path=epoch.directory/'cleaned.json';raw=self.session.c.trusted(path,2_000_000)
            if json.loads(raw)!={'format':'yunipals-paid-productive-epoch-v3','state':epoch.record}:fail('Actual cleaned productive proxy record differs.')
            epoch.cleanup_peers();self.session.quiet()
            for name,owned in epoch.record['chains'].items():
                if (not owned.get('filesRemoved') or not invocation(owned.get('restoredFalseInvocationId'))):fail('Actual owned false proxy cleanup required.')
                row=epoch.record['review']['proxies'][name]
                if any(os.path.lexists(row[k])for k in ['overridePath','publicEnvironmentPath']):fail('Productive true selection remains after cleanup.')
                self.session.check_proxy(name,row,paid=False,expected_invocation=owned['restoredFalseInvocationId'])
                self.cleanup_health(epoch,name,row,paid=False,zero=True)
        elif dispatch:epoch.validate_current()
        else:
            # Recovery must remain possible after dispatch closes or while the
            # deadline executor is active. No new work is launched here.
            epoch.cleanup_peers()
            for name,owned in epoch.record['chains'].items():
                row=epoch.record['review']['proxies'][name]
                self.session.check_proxy(name,row,paid=True,expected_invocation=owned['afterInvocationId'])
                self.cleanup_health(epoch,name,row,paid=True,zero=False)
    def cleanup_health(self,epoch,name,row,*,paid,zero):
        value=epoch.cleanup_health(name,paid=paid,zero=zero)
        if (value.get('cleanupOnly')is not True or value.get('dispatchAuthorized')is not False or
            value.get('historicalProfileIdentityVerified')is not True or value.get('profileAvailability')not in {'historical_only','expired'} or
            value.get('configuration')!=row['legacyConfiguration']):
            fail('Exact cleanup-only historical proxy observation required; no dispatch authority.')
        return value
    def check_enabled_record(self,epoch,path,expected):
        if (epoch is None or Path(path)!=epoch.directory/'enabled.json' or not is_sha(expected)):
            fail('Exact acknowledged enabled proxy record required.')
        payload=self.session.c.pinned_json(Path(path),expected,2_000_000);record=payload.get('state',{})
        if (payload.get('format')!='yunipals-paid-productive-epoch-v3' or record.get('enabled')is not True or record.get('cleaned')is not False or
            record.get('reviewHash')!=epoch.record['reviewHash'] or record.get('review')!=epoch.record['review'] or
            set(record.get('chains',{}))!={'base','bnb'} or
            any(record['chains'][name].get('afterInvocationId')!=epoch.record['chains'][name].get('afterInvocationId') for name in PROXY_UNITS)):
            fail('Acknowledged enabled proxy history differs.')
        return record
    def compare_proxy_states(self,before,after,selected):
        if len(before)!=32 or set(before)!=set(after) or set(selected)!={'base','bnb'} or not set(PROXY_UNITS.values()).issubset(before):
            fail('Exact legacy service graph and two owned proxy states required.')
        for unit,value in before.items():
            if unit not in PROXY_UNITS.values():
                if after[unit]!=value:fail('Unrelated legacy unit changed during owned proxy transition.')
                continue
            name=next(name for name,u in PROXY_UNITS.items()if u==unit);target=selected[name]
            if (set(value)!={'Id','LoadState','ActiveState','SubState','InvocationID'} or value['Id']!=unit or value['LoadState']!='loaded' or
                value['ActiveState']!='active' or value['SubState']!='running' or not invocation(value['InvocationID']) or
                set(target)!=set(value) or not invocation(target['InvocationID']) or
                any(target[k]!=value[k]for k in value if k!='InvocationID') or after[unit]!=target):
                fail('Only exact owned healthy proxy invocation may transition.')
    def bind_owned_proxy_epoch(self,epoch,pre_review_hash,enabled_record_file,enabled_record_sha):
        if self.record is not None or self.proxy_transition is not None or self.pre_epoch_binding is None:
            fail('Fresh prepared native ancestry required for one explicit proxy transition.')
        before=deepcopy(self.pre_epoch_binding)
        if sha(encoded(before))!=pre_review_hash:fail('Exact approved native pre-epoch review required.')
        self.check_epoch(epoch,cleaned=False)
        enabled=self.check_enabled_record(epoch,enabled_record_file,enabled_record_sha)
        current=self.review()['binding'];selected={}
        if {k:v for k,v in before.items()if k not in {'legacyUnits','ownedProxyEpoch'}}!={k:v for k,v in current.items()if k not in {'legacyUnits','ownedProxyEpoch'}}:
            fail('Native immutable/source/checkpoint/clock ancestry changed during proxy transition.')
        for name,unit in PROXY_UNITS.items():
            row=enabled['review']['proxies'][name];owned=enabled['chains'][name]
            if row['beforeInvocationId']!=before['legacyUnits'][unit]['InvocationID'] or current['legacyUnits'][unit]['InvocationID']!=owned['afterInvocationId'] or owned['afterInvocationId']==row['beforeInvocationId']:
                fail('Exact reviewed false to owned true proxy identity required.')
            selected[name]=deepcopy(current['legacyUnits'][unit])
        self.compare_proxy_states(before['legacyUnits'],current['legacyUnits'],selected)
        self.proxy_epoch=epoch
        self.proxy_transition={'format':'yunipals-native-owned-proxy-transition-v1','epochOperatorSha256':EPOCH_SHA,'epochReviewHash':enabled['reviewHash'],
            'enabledRecordFile':str(enabled_record_file),'enabledRecordSha256':enabled_record_sha,'preReviewHash':pre_review_hash,
            'preEpochBinding':before,'trueStates':selected}
        return self.review()
    def bind_owned_proxy_cleanup(self,epoch,cache_file,cache_sha):
        if self.record is not None and self.record['phase']!='stopped':fail('Native must be stopped before proxy cleanup transition.')
        self.check_epoch(epoch,cleaned=True)
        path=Path(cache_file)
        expected_parent=LIVE_BASE/self.run_id
        if path.parent!=expected_parent or not re.fullmatch(r'cache-cleanup-[0-9]+\.json',path.name):fail('Exact acknowledged productive cache receipt path required.')
        value=self.session.c.pinned_json(path,cache_sha,2_000_000)
        expected={'format':'yunipals-paid-productive-epoch-v3','cleaned':True,
            'restoredFalseInvocations':{name:epoch.record['chains'][name]['restoredFalseInvocationId']for name in PROXY_UNITS},
            'ownedProductiveCachesDestroyed':True,'original12zAndFalseFilesRetained':True,'grantCountersReset':False,
            'recordFile':str(epoch.directory/'cleaned.json'),'recordSha256':sha(self.session.c.trusted(epoch.directory/'cleaned.json',2_000_000))}
        if value!=expected:fail('Actual immutable proxy cache destruction receipt required.')
        states=self.context.old.service_states(self.context.old.LEGACY_UNITS)
        selected={name:deepcopy(states[unit])for name,unit in PROXY_UNITS.items()}
        if any(selected[name]['InvocationID']!=expected['restoredFalseInvocations'][name]for name in PROXY_UNITS):fail('Current exact cleaned false proxy identities required.')
        self.cleanup_transition={'format':'yunipals-native-owned-proxy-cleanup-v1','epochReviewHash':epoch.record['reviewHash'],
            'cacheReceiptFile':str(path),'cacheReceiptSha256':cache_sha,'cleanedRecordFile':expected['recordFile'],
            'cleanedRecordSha256':expected['recordSha256'],'falseStates':selected}
        self.proxy_epoch=epoch
        if self.record is not None:
            if epoch.record['reviewHash']!=self.record['binding']['ownedProxyEpoch']['epochReviewHash']:fail('Stopped native cleanup belongs to another epoch.')
            self.compare_proxy_states(self.record['binding']['legacyUnits'],states,selected)
        return deepcopy(self.cleanup_transition)
    def accept_legacy(self,current):
        before=self.record['binding']['legacyUnits']
        if current==before:return True
        proof=self.cleanup_transition
        if self.record['phase']!='stopped' or proof is None or self.proxy_epoch is None: return False
        if proof['epochReviewHash']!=self.record['binding']['ownedProxyEpoch']['epochReviewHash']:return False
        # Re-open both protected receipts and recheck exact current false
        # selections every time. The original physical seal is never rewritten.
        previous=deepcopy(proof)
        self.bind_owned_proxy_cleanup(self.proxy_epoch,proof['cacheReceiptFile'],proof['cacheReceiptSha256'])
        if self.cleanup_transition!=previous:fail('Acknowledged proxy cleanup proof changed.')
        self.compare_proxy_states(before,current,proof['falseStates'])
        return True
    def validate_props(self,value,*,running):
        r=self.record;expected=properties(self.context.workspace,r['maximumSeconds']);p=self.context.p
        if (value['Id'] != self.unit or value['Description'] != description(r['reviewHash']) or value['InvocationID'] != r['invocation'] or value['DropInPaths'] != '' or
            any(value[k] != v for k,v in expected.items() if k not in {'RuntimeMaxSec','CPUQuota','TimeoutStopSec','IPAddressDeny','IPAddressAllow'}) or
            p.duration_us(value['RuntimeMaxUSec']) != r['maximumSeconds']*1_000_000 or p.duration_us(value['CPUQuotaPerSecUSec']) != 1_000_000 or
            p.duration_us(value['TimeoutStopUSec']) != 30_000_000 or p.address_networks(value['IPAddressDeny']) != {'0.0.0.0/0','::/0'} or p.address_networks(value['IPAddressAllow']) != {'127.0.0.0/8','::1/128'} or
            value['ExecMainStartTimestampMonotonic'] != str(r['startMonotonicMicroseconds']) or
            re.findall(r'(?:^|[ {;])path=([^ ;]+)',value['ExecStart']) != ['/usr/bin/env'] or
            re.findall(r'argv\[\]=(.*?)\s+;',value['ExecStart']) != [' '.join(command_argv(self.context.workspace,self.overlay))] or
            value['FragmentPath'] != r['definition']['path'] or sha(self.session.c.trusted(Path(r['definition']['path']),100_000)) != r['definition']['sha256'] or
            sha(self.session.c.trusted(self.overlay,2000)) != r['binding']['overlaySha256'] or
            sha(self.session.c.trusted(self.context.workspace/'launch.env')) != r['binding']['launchEnvSha256'] or
            any(sha(self.session.c.trusted(Path(path),2_000_000)) != expected for path,expected in r['binding']['codePins'].items())): fail('Owned native invocation/definition/resources/launch drifted.')
        if running:
            if value['ActiveState'] != 'active' or value['SubState'] != 'running' or value['MainPID'] != str(r['process']['pid']) or process_identity(r['process']['pid'],self.unit) != r['process']:
                fail('Owned running native PID/start/cgroup changed.')
        elif value['ActiveState'] not in {'inactive','failed'} or value['MainPID'] != '0': fail('Actual owned stopped state required.')
    def observe(self,handle):
        self.handle_guard(handle);state=self.fresh_state(True);props=unit_props(self.context.old,self.unit)
        terminal=props['ActiveState'] in {'inactive','failed'}
        self.validate_props(props,running=not terminal)
        if not self.accept_legacy(state['legacyUnits']) or state['activeSelector'] != []: fail('Legacy invocation or selector drift during native replay.')
        reason=resource_reason(state['freeBytes'],state['metrics'])
        expiry=runtime_expiry(props,self.record)
        if terminal: reason='owned_runtime_expired' if expiry else 'native_exited_75' if props['ExecMainStatus']=='75' else 'native_exited'
        elif utc_now() >= moment(self.plan['dispatchExpires']): reason='dispatch_deadline'
        elapsed=(time.monotonic_ns()//1000-self.record['startMonotonicMicroseconds'])/1_000_000
        def counter(key):
            return int(props[key]) if re.fullmatch('[0-9]+',props[key]) else None
        return {'format':FORMAT,'unit':self.unit,'invocation':self.record['invocation'],'elapsedSeconds':elapsed,'originalExpires':self.plan['expires'],'dispatchExpires':self.plan['dispatchExpires'],
            'sourceConnections':state['peer']['sessions'],'metrics':state['metrics'],'sourceAnchors':state['anchors'],'freeBytes':state['freeBytes'],
            'resources':{'memoryCurrent':counter('MemoryCurrent'),'memoryPeak':counter('MemoryPeak'),'cpuUsageNanoseconds':counter('CPUUsageNSec')},
            'ownedState':{k:props[k] for k in ['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','Result','ExecMainStatus']},
            'runtimeExpiryEvidence':expiry,'stopReason':reason,'automaticRetryAllowed':False}
    def handle_guard(self,handle):
        self.held()
        if self.record is None or self.record['phase'] != 'running' or handle.get('reviewHash') != self.record['reviewHash'] or handle.get('unit') != self.unit or handle.get('invocation') != self.record['invocation']:
            fail('Exact acknowledged running native handle required; no actor adoption.')
    def stop_owned(self,handle,reason):
        if self.record is not None and self.record['phase']=='stopped': return self.stopped_state(handle)
        self.handle_guard(handle)
        if reason not in {'original_deadline','dispatch_deadline','owned_runtime_expired','operator_interrupt','disk_reserve','schema_cap','cache_growth_cap','native_exited','native_exited_75','guard_failure','budget_exhausted','provider_refused'}: fail('Fixed native stop reason required.')
        if reason=='original_deadline' and utc_now()<moment(self.plan['expires']): fail('An early stop is not the original deadline.')
        if reason=='dispatch_deadline' and utc_now()<moment(self.plan['dispatchExpires']): fail('An early stop is not the dispatch deadline.')
        props=unit_props(self.context.old,self.unit)
        if props['ActiveState'] not in {'inactive','failed'}:
            self.validate_props(props,running=True)
            if not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'): fail('Exact kernel pidfd required; no name/PID fallback.')
            fd=os.pidfd_open(self.record['process']['pid'],0)
            try:
                self.validate_props(unit_props(self.context.old,self.unit),running=True)
                signal.pidfd_send_signal(fd,signal.SIGTERM,None,0)
                poll=select.poll();poll.register(fd,select.POLLIN)
                if not poll.poll(45_000): fail('Native graceful stop timeout; no force kill or retry.')
            finally: os.close(fd)
        deadline=time.monotonic()+5
        while True:
            props=unit_props(self.context.old,self.unit)
            if props['ActiveState'] in {'inactive','failed'} and props['MainPID']=='0': break
            if time.monotonic()>=deadline: fail('Native systemd cleanup incomplete; no force kill/retry.')
            time.sleep(.1)
        self.validate_props(props,running=False)
        expiry=runtime_expiry(props,self.record)
        if reason=='owned_runtime_expired' and expiry is None: fail('Actual full owned runtime expiry evidence required.')
        state=self.fresh_state(False)
        if not self.accept_legacy(state['legacyUnits']) or state['activeSelector'] != []: fail('Post-stop legacy/selector changed.')
        terminal={k:props[k] for k in ['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','Result','ExecMainStatus','ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic']}
        self.record['terminal']=terminal
        clean=props['Result'] in {'success','signal','timeout'} and props['ExecMainStatus'] in {'0','15','143'} and reason not in {'native_exited','native_exited_75','guard_failure','provider_refused'}
        self.record['seal']={'format':FORMAT,'reviewHash':self.record['reviewHash'],'reason':reason,'terminal':terminal,
            'runtimeSha256':sha(encoded(state['metrics']['runtime'])),'checkpointsSha256':sha(encoded(state['metrics']['checkpoints'])),
            'metrics':state['metrics'],'sourceAnchors':state['anchors'],'sourceConnections':0,'sourceDigest':ACTOR,'nativeBuild':NATIVE,'releaseId':RELEASE,'schema':SCHEMA,
            'retainedWorkspace':str(self.context.workspace),'originalCacheBytes':ORIGINAL_CACHE,'runtimeExpiryEvidence':expiry,
            'completedOriginalWindow':utc_now()>=moment(self.plan['expires']),'quarantined':not clean,'automaticRetryAllowed':False}
        self.record['phase']='stopped';proof=self.publish('stopped')
        if self.references is not None: self.references.close();self.references=None
        return {**self.record['seal'],**proof}
    def restore_handle(self,path,expected,*,owned_proxy_epoch=None):
        self.held();path=Path(path)
        if self.record is not None or not is_sha(expected) or path.parent.parent != BASE/self.run_id or not is_sha(path.parent.name): fail('Exact protected acknowledged native phase path required.')
        value=self.session.c.pinned_json(path,expected,2_000_000)
        if set(value) != {'format','record'} or value['format'] != FORMAT: fail('Protected native journal required.')
        record=value['record'];binding=record.get('binding',{})
        if (set(record) != {'reviewHash','binding','phase','invocation','process','maximumSeconds','startMonotonicMicroseconds','definition','terminal','seal'} or
            record['phase'] not in {'running','stopped'} or record['reviewHash'] != path.parent.name or sha(encoded(binding)) != record['reviewHash'] or
            binding.get('productivePlanSha256') != self.plan_sha or binding.get('qCleanRecordSha256') != sha(encoded(self.session.record)) or
            binding.get('operatorSha256') != sha(self.session.c.trusted(Path(__file__).absolute())) or not invocation(record['invocation']) or
            binding.get('runId')!=self.run_id or binding.get('retainedWorkspace')!=str(self.context.workspace) or binding.get('sourceDigest')!=ACTOR or
            binding.get('nativeBuild')!=NATIVE or binding.get('releaseId')!=RELEASE or binding.get('physicalSchema')!=SCHEMA or
            binding.get('originalStart')!=self.plan['start'] or binding.get('originalExpires')!=self.plan['expires'] or
            binding.get('dispatchExpires')!=self.plan['dispatchExpires'] or
            binding.get('osPeer')!=self.os_peer or
            type(record['maximumSeconds']) is not int or not 60<=record['maximumSeconds']<=28800 or
            type(record['startMonotonicMicroseconds']) is not int or record['startMonotonicMicroseconds']<=0):
            fail('Only exact ACKed running native phase may be restored; unknown start is manual reconciliation.')
        if self.session.c.pinned_json(path.parent/'review.json',record['reviewHash'],2_000_000) != binding: fail('Owned native immutable review differs.')
        self.record,self.directory=record,path.parent
        transition=binding.get('ownedProxyEpoch')
        if (not isinstance(transition,dict) or set(transition)!={'format','epochOperatorSha256','epochReviewHash','enabledRecordFile','enabledRecordSha256','preReviewHash','preEpochBinding','trueStates'} or
            transition['format']!='yunipals-native-owned-proxy-transition-v1' or transition['epochOperatorSha256']!=EPOCH_SHA or
            sha(encoded(transition['preEpochBinding']))!=transition['preReviewHash'] or owned_proxy_epoch is None):
            fail('Actual acknowledged owned proxy epoch required for native recovery.')
        pre=transition['preEpochBinding']
        if (pre.get('ownedProxyEpoch')is not None or
            {k:v for k,v in pre.items()if k not in {'legacyUnits','ownedProxyEpoch'}}!={k:v for k,v in binding.items()if k not in {'legacyUnits','ownedProxyEpoch'}}):
            fail('Recovered native ancestry changed during proxy transition.')
        self.compare_proxy_states(pre['legacyUnits'],binding['legacyUnits'],transition['trueStates'])
        self.check_epoch(owned_proxy_epoch,cleaned=owned_proxy_epoch.record.get('cleaned'),dispatch=False)
        self.check_enabled_record(owned_proxy_epoch,transition['enabledRecordFile'],transition['enabledRecordSha256'])
        if transition.get('epochReviewHash')!=owned_proxy_epoch.record['reviewHash']:fail('Recovered native proxy epoch differs.')
        self.proxy_epoch=owned_proxy_epoch;self.proxy_transition=deepcopy(transition);self.pre_epoch_binding=deepcopy(transition['preEpochBinding'])
        if record['phase']=='running' and owned_proxy_epoch.record['cleaned']is not False:fail('Running native cannot recover a cleaned proxy epoch.')
        elif owned_proxy_epoch.record['cleaned'] is True and self.cleanup_transition is None:fail('Explicit acknowledged proxy cleanup required for stopped recovery.')
        if record['phase']=='stopped':
            handle={'unit':self.unit,'invocation':record['invocation'],'reviewHash':record['reviewHash']}
            return {**self.stopped_state(handle),**handle,'recordFile':str(path),'recordSha256':expected,'liveActorAdopted':False}
        props=unit_props(self.context.old,self.unit);self.validate_props(props,running=props['ActiveState'] not in {'inactive','failed'})
        self.references=References(self.unit);self.references.acquire()
        return {'unit':self.unit,'invocation':record['invocation'],'reviewHash':record['reviewHash'],'recordFile':str(path),'recordSha256':expected,'liveActorAdopted':False}
    def stopped_state(self,handle):
        self.held();record=self.record
        if (record is None or record['phase']!='stopped' or handle.get('reviewHash')!=record['reviewHash'] or handle.get('unit')!=self.unit or
            handle.get('invocation')!=record['invocation'] or record['terminal'] is None or record['seal'] is None or
            record['terminal']!=record['seal']['terminal'] or record['terminal'].get('InvocationID')!=record['invocation'] or
            record['terminal'].get('Id')!=self.unit or record['terminal'].get('MainPID')!='0' or
            record['terminal'].get('ActiveState') not in {'inactive','failed'}): fail('Exact ACKed stopped native proof required.')
        own=self.context.old.own_state(self.unit)
        if own.get('LoadState')!='not-found': self.validate_props(unit_props(self.context.old,self.unit),running=False)
        state=self.fresh_state(False)
        if (sha(encoded(state['metrics']['runtime']))!=record['seal']['runtimeSha256'] or
            sha(encoded(state['metrics']['checkpoints']))!=record['seal']['checkpointsSha256'] or state['anchors']!=record['seal']['sourceAnchors'] or
            not self.accept_legacy(state['legacyUnits']) or state['activeSelector']!=[]):
            fail('Retained stopped source advanced or changed; do not rebaseline it.')
        return {**record['seal'],'alreadyAcknowledgedStop':True,'nativeRestarted':False,'unitGcBackedByActualSavedWitness':own.get('LoadState')=='not-found'}
    def close(self):
        if self.references is not None: self.references.close();self.references=None


def runtime_expiry(props,record):
    if (props.get('Result')!='timeout' or props.get('ActiveState') not in {'inactive','failed'} or props.get('ExecMainStatus') not in {'0','15','143'} or
        any(not isinstance(props.get(k),str) or re.fullmatch('[0-9]{1,20}',props[k]) is None for k in ['ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic'])):
        return None
    start,end=int(props['ExecMainStartTimestampMonotonic']),int(props['ExecMainExitTimestampMonotonic'])
    if start!=record['startMonotonicMicroseconds'] or end-start<record['maximumSeconds']*1_000_000 or end>time.monotonic_ns()//1000: return None
    return {'unit':props['Id'],'invocation':props['InvocationID'],'startMonotonicMicroseconds':start,'exitMonotonicMicroseconds':end,
        'durationMicroseconds':end-start,'maximumSeconds':record['maximumSeconds'],'newEightHourWindow':False}


def private_directory(run_id,marker):
    unit_name(run_id)
    if not is_sha(marker): fail('Exact native review hash required.')
    for path in [*BASE.parents,BASE]:
        if path == BASE and not path.exists(): path.mkdir(mode=0o700)
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or (info.st_mode&0o022 and not info.st_mode&stat.S_ISVTX): fail('Protected native proof ancestry required.')
    parent=BASE/run_id;parent.mkdir(mode=0o700,exist_ok=True)
    info=parent.lstat()
    if info.st_uid!=0 or not stat.S_ISDIR(info.st_mode) or info.st_mode&0o077: fail('Private native run directory required.')
    directory=parent/marker;directory.mkdir(mode=0o700)
    return directory


def prepare(session, productive_plan, run_id, *, record_callback):
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main': fail('Exact production root/host required.')
    session.held()
    model=session.c.load(OPS/'paid-productive-plan-v5.py',MODEL_SHA,'native_productive_model')
    model.validate(productive_plan)
    if productive_plan['origin'] != session.plan['admission']: fail('Native cannot replace the original Q approval.')
    if not session.record or session.record.get('cleaned') is not True: fail('Cleaned acknowledged Q epoch required.')
    context=static_context(session,productive_plan)
    return NativeRun(session,productive_plan,run_id,context,record_callback)
