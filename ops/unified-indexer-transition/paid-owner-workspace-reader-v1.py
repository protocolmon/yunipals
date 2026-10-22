#!/usr/bin/env python3
"""Read retained source-owned codegen state without broadening root DAC access.

Library only. The caller holds the existing source/chain leases. Protected
history and immutable files stay in root; a capability-free source peer reads
only the declaration and .ponder subtree. No file or service is changed.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
USER = 'yunipals_unified_shadow'
ACTOR = '008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
NATIVE = 'bf4939b3ff'
SCHEMA = 'unified_shadow_20261020_7e7375b0'
NODE = '/opt/node-v24.18.1/bin/node'
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
Q_SHA = 'eedd6c9a569ce1a805eab4e3b8d8b01674185474e4caab8cd3a293183685815f'
RESUME_SHA = '3756ad3a2eb27f21fe9f1f7005847ff42952838f220cced1db53d8a6759a539b'
STATE = 'apps/yunipals-indexer/.ponder'
DECLARATION = 'apps/yunipals-indexer/ponder-env.d.ts'
MAX_ENTRIES = 4096
MAX_BYTES = 256_000_000
MAX_OUTPUT = 2_000_000
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def fail(label): raise RuntimeError(label)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def digest(raw): return hashlib.sha256(raw).hexdigest()
def canonical(value): return digest(encoded(value))
def metadata(value):
    return [value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns]


# This is the complete source-peer program, passed literally to Python -I.
# No arbitrary path, method, env, profile or proof reader is exposed.
PEER_CODE = r'''import hashlib,json,os,pathlib,stat,sys,time
root=pathlib.Path(sys.argv[1]);uid,gid=map(int,sys.argv[2:]);start=time.monotonic()
if not root.is_absolute() or '..' in root.parts:raise RuntimeError('absolute_workspace_required')
caps={};nnp=None
for line in pathlib.Path('/proc/self/status').read_text().splitlines():
 k,sep,v=line.partition(':')
 if k in {'CapPrm','CapEff','CapInh','CapAmb','CapBnd'}:caps[k]=int(v.strip(),16)
 if k=='NoNewPrivs':nnp=int(v.strip())
if uid<=0 or gid<=0 or os.getuid()!=uid or os.geteuid()!=uid or os.getgid()!=gid or os.getgroups()!=[] or nnp!=1 or caps.get('CapBnd')!=224 or any(caps.get(k,-1)!=0 for k in ['CapPrm','CapEff','CapInh','CapAmb']):raise RuntimeError('restricted_source_peer_required')
def meta(s):return [s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
def fence():
 if time.monotonic()-start>20:raise RuntimeError('bounded_source_reader_expired')
rows=[];total=0
def one(parent,name,relative,mutable):
 global total
 fence();s=os.stat(name,dir_fd=parent,follow_symlinks=False)
 if mutable:
  if not(stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)) or s.st_uid not in {0,uid} or s.st_mode&0o022 or (stat.S_ISREG(s.st_mode) and s.st_nlink!=1):raise RuntimeError('mutable_state_redirected_or_shared')
 elif not stat.S_ISREG(s.st_mode) or s.st_uid!=uid or s.st_gid!=gid or stat.S_IMODE(s.st_mode)!=0o640 or s.st_nlink!=1:raise RuntimeError('declaration_identity_changed')
 if len(rows)>=4096:raise RuntimeError('source_reader_entry_limit')
 before=meta(s);h=None
 if stat.S_ISREG(s.st_mode):
  if s.st_size<0 or total+s.st_size>256000000:raise RuntimeError('source_reader_byte_limit')
  total+=s.st_size;fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent);hash=hashlib.sha256();read=0
  with os.fdopen(fd,'rb') as f:
   if meta(os.fstat(f.fileno()))!=before:raise RuntimeError('source_inode_changed')
   while True:
    fence();chunk=f.read(min(1048576,s.st_size-read+1))
    if not chunk:break
    read+=len(chunk)
    if read>s.st_size:raise RuntimeError('source_file_grew')
    hash.update(chunk)
   if read!=s.st_size or meta(os.fstat(f.fileno()))!=before:raise RuntimeError('source_file_changed')
  h=hash.hexdigest()
 rows.append({'path':relative,'metadata':before,'sha256':h})
 if stat.S_ISDIR(s.st_mode):
  fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_DIRECTORY,dir_fd=parent)
  try:
   if meta(os.fstat(fd))!=before:raise RuntimeError('source_directory_changed')
   with os.scandir(fd) as items:names=sorted(item.name for item in items)
   for child in names:one(fd,child,relative+'/'+child,True)
   if meta(os.fstat(fd))!=before:raise RuntimeError('source_directory_changed')
  finally:os.close(fd)
 if meta(os.stat(name,dir_fd=parent,follow_symlinks=False))!=before:raise RuntimeError('source_entry_changed')
fds=[]
try:
 for name in [str(root),'apps','yunipals-indexer']:
  fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_DIRECTORY,**({'dir_fd':fds[-1]} if fds else {}));fds.append(fd);s=os.fstat(fd)
  if s.st_uid!=0 or s.st_gid!=gid or stat.S_IMODE(s.st_mode)!=0o750:raise RuntimeError('immutable_workspace_ancestry_changed')
 one(fds[-1],'ponder-env.d.ts','apps/yunipals-indexer/ponder-env.d.ts',False)
 one(fds[-1],'.ponder','apps/yunipals-indexer/.ponder',True)
finally:
 for fd in reversed(fds):os.close(fd)
out=json.dumps({'sourceUid':uid,'sourceGid':gid,'groupsEmpty':True,'processCapabilitiesZero':True,'boundingSet':224,'noNewPrivileges':True,'rows':rows},sort_keys=True,separators=(',',':')).encode()
if len(out)>2000000:raise RuntimeError('source_reader_output_limit')
sys.stdout.buffer.write(out)
'''


def peer_snapshot(helper, workspace, *, command=None):
    if helper.USER != USER: fail('fixed_source_peer_required')
    account = pwd.getpwnam(USER)
    if account.pw_uid <= 0 or account.pw_gid <= 0: fail('prepared_nonroot_source_peer_required')
    before = {name: metadata((workspace / name).lstat()) for name in [DECLARATION, STATE]}
    argv = ['/usr/bin/setpriv', '--reuid=' + str(account.pw_uid), '--regid=' + str(account.pw_gid), '--clear-groups',
            '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i',
            'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'LANG=C.UTF-8', 'TZ=UTC', '/usr/bin/python3', '-I', '-c', PEER_CODE,
            str(workspace), str(account.pw_uid), str(account.pw_gid)]
    raw = (command or helper.command)(argv, env=ENV, timeout=25)
    if not isinstance(raw, str) or len(raw.encode()) > MAX_OUTPUT: fail('bounded_source_peer_output_required')
    value = json.loads(raw)
    if (set(value) != {'sourceUid', 'sourceGid', 'groupsEmpty', 'processCapabilitiesZero', 'boundingSet', 'noNewPrivileges', 'rows'} or
            value['sourceUid'] != account.pw_uid or value['sourceGid'] != account.pw_gid or
            value['groupsEmpty'] is not True or value['processCapabilitiesZero'] is not True or
            value['boundingSet'] != 224 or value['noNewPrivileges'] is not True or
            not isinstance(value['rows'], list) or not 2 <= len(value['rows']) <= MAX_ENTRIES):
        fail('exact_source_peer_observation_required')
    rows = {}; total = 0
    for row in value['rows']:
        if not isinstance(row, dict) or set(row) != {'path', 'metadata', 'sha256'}: fail('exact_source_peer_row_required')
        name = row['path']; path = Path(name) if isinstance(name, str) else None
        if (path is None or path.is_absolute() or '..' in path.parts or str(path) != name or
                name in rows or (name != DECLARATION and name != STATE and not path.is_relative_to(STATE))):
            fail('source_reader_path_outside_fixed_areas')
        m = row['metadata']
        if not isinstance(m, list) or len(m) != 9 or any(type(n) is not int or n < 0 for n in m): fail('exact_source_metadata_required')
        dev, ino, mode, uid, gid, links, size, _, _ = m
        directory = stat.S_ISDIR(mode)
        if (not (directory or stat.S_ISREG(mode)) or uid not in {0, account.pw_uid} or mode & 0o022 or
                (not directory and links != 1) or (name == DECLARATION and
                 (directory or uid != account.pw_uid or gid != account.pw_gid or stat.S_IMODE(mode) != 0o640)) or
                (name == STATE and not directory)):
            fail('source_metadata_contract_changed')
        if directory:
            if row['sha256'] is not None: fail('directory_cannot_have_file_digest')
        else:
            total += size
            if not isinstance(row['sha256'], str) or re.fullmatch('[0-9a-f]{64}', row['sha256']) is None: fail('exact_source_file_digest_required')
        rows[name] = row
    if total > MAX_BYTES or not {DECLARATION, STATE}.issubset(rows): fail('bounded_complete_source_areas_required')
    for name, original in before.items():
        if rows[name]['metadata'] != original or metadata((workspace / name).lstat()) != original:
            fail('root_and_source_peer_metadata_changed')
    for name in rows:
        if name not in {DECLARATION, STATE} and str(Path(name).parent) not in rows: fail('source_subtree_parent_missing')
    return account, rows


def workspace_proof(helper, cont, workspace, manifest, inventory, env, monitor_sha, *, candidate=False, review_sha=None):
    """Same historical proof records; only the two owner-only areas use a peer."""
    workspace = Path(workspace)
    account, peer = peer_snapshot(helper, workspace)
    files = {row['path']: row for row in manifest['files']}
    files.update({name: {'path': name} for name in ['RELEASE-MANIFEST.json', 'SHA256SUMS']})
    files.update({row['path']: row for row in inventory['entries'] if row['type'] == 'file'})
    links = {row['path']: row for row in inventory['entries'] if row['type'] == 'symlink'}
    directories = {'.'}
    for relative in [*files, *links, *(row['path'] for row in inventory['entries'] if row['type'] == 'directory')]:
        current = Path(relative)
        if relative not in files and relative not in links: directories.add(relative)
        directories.update(str(parent) for parent in current.parents)
    extra = {'rpc-profile.json': Path(env['UNIFIED_RPC_PROFILE_FILE']).read_bytes(),
             'launch.env': cont.launch_text(helper, workspace, env, free_only=candidate).encode()}
    reports = {'monitor.jsonl': monitor_sha}
    if candidate: reports['transition-review.json'] = review_sha
    info = workspace.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != 0o750:
        fail('retained_workspace_ownership_changed')
    recorded = []
    def walk_error(error): raise error
    for directory, children, names in os.walk(workspace, followlinks=False, onerror=walk_error):
        for name in [*children, *names]:
            path = Path(directory) / name; relative = str(path.relative_to(workspace)); info = path.lstat()
            if relative == STATE:
                children.remove(name)
                continue
            if relative in links:
                row = links[relative]
                if (not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or os.readlink(path) != row['target'] or
                        not path.resolve(strict=True).is_relative_to(workspace)): fail('retained_runtime_link_changed')
                recorded.append([relative, 'link', row['target']]); continue
            if relative in directories:
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != 0o750:
                    fail('retained_runtime_directory_changed')
                content_sha = None
            else:
                if relative not in files and relative not in {*extra, *reports}: fail('unexpected_retained_file')
                uid = account.pw_uid if relative == DECLARATION else 0
                if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o022 or info.st_nlink != 1:
                    fail('retained_runtime_file_changed')
                content_sha = peer[relative]['sha256'] if relative == DECLARATION else helper.sha(path)
                if relative == DECLARATION and metadata(info) != peer[relative]['metadata']: fail('declaration_metadata_changed')
                if relative in files:
                    source = helper.SOURCE / relative; original = source.stat()
                    mode = 0o750 if original.st_mode & 0o111 else 0o640
                    if (info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != mode or
                            (info.st_ino == original.st_ino and info.st_dev == original.st_dev)):
                        fail('independent_pinned_source_inode_required')
                    expected = cont.generated_declaration(helper) if relative == DECLARATION else source.read_bytes()
                    if content_sha != digest(expected): fail('retained_source_runtime_bytes_changed')
                elif relative in extra and content_sha != digest(extra[relative]): fail('retained_launch_profile_changed')
                elif relative in reports and content_sha != reports[relative]: fail('retained_history_file_changed')
            recorded.append([relative, 'directory' if stat.S_ISDIR(info.st_mode) else 'file', stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid, content_sha])
    for relative, row in peer.items():
        if relative == DECLARATION: continue
        m = row['metadata']
        recorded.append([relative, 'directory' if stat.S_ISDIR(m[2]) else 'file', stat.S_IMODE(m[2]), m[3], m[4], row['sha256']])
    paths = {row[0] for row in recorded}
    if (len(paths) != len(recorded) or not set(files).issubset(paths) or not set(links).issubset(paths) or
            not (directories - {'.'}).issubset(paths) or not {*extra, *reports, STATE}.issubset(paths)):
        fail('retained_workspace_incomplete')
    for name in [DECLARATION, STATE]:
        if metadata((workspace / name).lstat()) != peer[name]['metadata']: fail('source_area_changed_during_root_verification')
    proof = {'inventorySha256': canonical(sorted(recorded)), 'regularFiles': sum(row[1] == 'file' for row in recorded),
             'independentSourceInodes': True, 'exactGeneratedDeclaration': True, 'mutableStateRetained': True}
    if candidate: proof.update(grantFreeLaunchRetained=True, firstTransitionEvidenceRetained=True)
    return proof


def base_context(parent, plan):
    """Explicit copy of pinned proxy-epoch.context with only owner reads split."""
    continuation = parent.load_module(plan['continuationHelper'], parent.CONTINUATION_SHA, 'pinned_monitoring_v2_continuation')
    base_plan, transition, transition_plan, cont = continuation.load_plan(plan['continuationPlanFile'])
    old = cont.load_helper(transition_plan['initialHelper'])
    initial_plan, original, old_first, _, old_reports, old_workspace = cont.initial_evidence(old, transition.prior_plan(transition_plan))
    candidate = transition.candidate_adapter(cont, transition_plan)
    virtual = {**base_plan, 'runId': plan['runId'], 'previousMonitorFile': plan['c1MonitorFile']}
    initial, first, c1, reports, workspace = continuation.lineage(virtual, transition, transition_plan, cont, old)
    c1_stop = parent.accepted_c1_stop(c1, old.SCHEMA); root = initial['binding']
    _, old_manifest, old_inventory = old.frozen_runtime(initial_plan)
    env = old.public_env(parent.trusted(initial_plan['publicEnvFile']).decode())
    profile = json.loads(parent.trusted(initial_plan['profileFile']))
    if (parent.digest(parent.trusted(initial_plan['publicEnvFile'])) != original['binding']['publicEnvSha256'] or
            parent.digest(parent.trusted(initial_plan['profileFile'])) != original['binding']['profileSha256'] or
            old_first['first']['baselineMetrics']['cacheBytes'] != parent.ORIGINAL_CACHE or root['initialMonitorSha256'] != old_first['sha256'] or
            workspace_proof(old, cont, old_workspace, old_manifest, old_inventory, env, old_first['sha256']) != root['oldWorkspaceProof']):
        fail('original_source_configuration_workspace_cache_changed')
    pins = transition_plan['candidate']
    runtime_helper, manifest, inventory = candidate.frozen_runtime({**initial_plan, 'inventoryFile': pins['inventoryFile']})
    clean = json.loads(parent.trusted(pins['cleanEvidenceFile']))
    if (parent.digest(parent.trusted(pins['cleanEvidenceFile'])) != root['cleanEvidenceSha256'] or
            parent.digest(parent.trusted(pins['inventoryFile'])) != continuation.INVENTORY_SHA or
            candidate.sha(candidate.SOURCE / 'RELEASE-MANIFEST.json') != continuation.SOURCE_MANIFEST_SHA): fail('immutable008_source_runtime_changed')
    transition.validate_clean_evidence(clean, pins, inventory, old.RUNTIME_HELPER_SHA)
    if (transition.source_diff(old_manifest, manifest) != root['sourceDiff'] or
            transition.runtime_diff(old.SOURCE, candidate.SOURCE, old_inventory, inventory, clean['runtime']['buildRoot']) != root['runtimeDiff'] or
            runtime_helper.bundle_proof(candidate.SOURCE, manifest) != inventory['bundleProof']): fail('immutable008_provenance_changed')
    free_env = {key: value for key, value in env.items() if not key.startswith('UNIFIED_RPC_REPLAY_PERMIT_ID')}
    if candidate.native_profile(free_env) != root['identity'] or transition.offline_native_build(candidate, free_env) != root['nativeBuild']:
        fail('retained_native_manifest_build_changed')
    proof = workspace_proof(candidate, cont, workspace, manifest, inventory, free_env, first['sha256'], candidate=True,
                            review_sha=parent.digest(parent.trusted(base_plan['transitionReviewFile'])))
    access = cont.workspace_access(candidate, workspace)
    if parent.digest(cont.launch_text(candidate, workspace, free_env, free_only=True).encode()) != root['launchEnvSha256']:
        fail('retained_grant_free_launch_changed')
    return types.SimpleNamespace(continuation=continuation, transition=transition, transition_plan=transition_plan, cont=cont,
        old=old, candidate=candidate, root=root, env=env, free_env=free_env, profile=profile, manifest=manifest, inventory=inventory,
        clean=clean, workspace=workspace, workspace_proof=proof, access=access, c1=c1, c1_stop=c1_stop, reports=[*old_reports, *reports])


class ContextAdapter:
    """Delegate frozen verification; never replace imported module globals."""
    def __init__(self, helper): self.frozen = helper
    def __getattr__(self, name): return getattr(self.frozen, name)
    def context(self, plan):
        helper = self.frozen; prior = plan['priorEpoch']
        parent = helper.load_module(prior['helper'], helper.PARENT_HELPER_SHA, 'pinned_saved_parent_epoch')
        origin_raw = helper.trusted(prior['originReviewFile']); origin = json.loads(origin_raw)
        parent_plan = origin.get('binding', {}).get('plan', {}); parent.validate_plan(parent_plan)
        if parent_plan['mode'] != 'epoch': fail('only_exact_saved_first_epoch_supported')
        for key in ['continuationHelper', 'continuationPlanFile', 'c1MonitorFile']:
            if plan[key] != parent_plan[key]: fail('original_source_context_changed')
        ctx = base_context(parent, parent_plan)
        previous, provenance = helper.parent_epoch(plan, parent, ctx, origin, origin_raw)
        return types.SimpleNamespace(**vars(ctx), parent=parent, parent_report=previous,
            parent_epoch=origin['binding']['epoch'], parent_provenance=provenance)


def reconstruct(session, productive_plan):
    """Native static_context contract, using the same complete frozen history."""
    session.held(); c, v = session.c, session.v
    q = c.load(OPS / 'source6-paid-epoch-v1.py', Q_SHA, 'productive_q_reader')
    resume = c.load(OPS / 'persistent-source5-resume.py', RESUME_SHA, 'productive_saved_resume')
    p = c.persistent()
    proof, binding, last = session.n.stop_proof(c, v, session.plan['stopProofSha256'])
    review = json.loads(c.trusted(session.n.LONG2 / 'review.json'))
    record = c.history(); old_plan = record['binding']['plan']; frozen = p.load_epoch(old_plan['epochHelper'])
    p.validate_plan(old_plan, frozen)
    helper = ContextAdapter(frozen)
    ctx, _, artifact, _, _, _ = p.historical_prerequisite(old_plan, helper)
    if resume.package(c, v, p, helper, ctx, artifact, old_plan) != {**review['binding']['source5Package'], 'inventory': c.pinned_json(c.INVENTORY, c.INVENTORY_SHA)}:
        fail('original_source5_package_changed')
    if str(ctx.workspace) != review['binding']['retainedWorkspace'] or ctx.old.SCHEMA != review['binding']['retainedSchema']:
        fail('retained_actor_workspace_schema_changed')
    if (str(ctx.workspace) != proof['retainedWorkspace'] or binding['sourceDigest'] != ACTOR or binding['nativeBuild'] != NATIVE or
            ctx.old.SCHEMA != SCHEMA or ctx.old.NODE != NODE or digest(c.trusted(Path(NODE), 150_000_000)) != NODE_SHA):
        fail('exact_retained008_native_context_required')
    return types.SimpleNamespace(old=ctx.old, p=p, ctx=ctx, q=q, workspace=ctx.workspace, stopProof=proof, last=last)
