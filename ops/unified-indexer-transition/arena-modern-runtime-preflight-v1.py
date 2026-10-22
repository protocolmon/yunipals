#!/usr/bin/env python3
"""Read-only qualification of a completed Arena release in retained service contexts."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import types

FORMAT = "yunipals-arena-modern-runtime-preflight-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
RESTORE = OPS / "yunipals-arena-runtime-restore-v1-20261022.py"
RESTORE_SHA = "505a4937867abdc623b7d21367bf76a42ecea4a103d374116dbb3181fb60febb"
RESTORE_RESULT_SHA = "b1102b2b294b98ba98e61d96850a7bb765669ca23b3d4dd5bd06504e501efc33"
RUNTIME_HELPER = Path("/opt/yunipals-unified/operations/arena-modern-package-20261022/runtime-supplement.py")
RUNTIME_HELPER_SHA = "49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4"
RELEASES = Path("/opt/yunipals-unified/releases")
RULES_HASH = "0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80"
POOL_HASH = "0x9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1"}
PLAN_KEYS = {"format", "sourceDigest", "sourceManifestSha256", "packageProofFile", "packageProofSha256", "runtimeInventoryFile", "runtimeInventorySha256", "runtimeArchiveSha256", "installResultFile", "installResultSha256"}
PHASE = "entry"


class PreflightFailure(RuntimeError):
    pass


def need(value, label):
    if not value:
        raise PreflightFailure(label)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def pin(value):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{64}", value) and value != "0" * 64


def trusted_ancestor(path, info):
    ordinary = not info.st_mode & 0o022
    sticky_var_tmp = path == Path("/var/tmp") and stat.S_IMODE(info.st_mode) == 0o1777 and info.st_gid == 0
    private_artifact = path.parent != Path("/var/tmp") or stat.S_IMODE(info.st_mode) == 0o700 and info.st_gid == 0
    return stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and (ordinary or sticky_var_tmp) and private_artifact


def protected(path, maximum=2000000):
    """A protected regular file, including inode-bound open and bounded read."""
    path = Path(path)
    need(path.is_absolute() and path.parent != Path("/var/tmp"), "absolute_protected_input_required")
    for parent in reversed(path.parents):
        s = parent.lstat()
        need(trusted_ancestor(parent, s), "protected_input_ancestry_required")
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and not before.st_mode & 0o022 and before.st_size <= maximum, "protected_bounded_regular_input_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(metadata(os.fstat(fd)) == metadata(before), "protected_input_open_changed")
        chunks = []
        count = 0
        while True:
            chunk = os.read(fd, min(1048576, maximum + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            need(count <= maximum, "protected_input_too_large")
        need(metadata(os.fstat(fd)) == metadata(before) == metadata(path.lstat()), "protected_input_changed")
        return b"".join(chunks)
    finally:
        os.close(fd)


def load(path, expected, name):
    raw = protected(path, 200000)
    need(sha(raw) == expected, "pinned_operator_changed")
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def validate_plan(plan):
    need(isinstance(plan, dict) and set(plan) == PLAN_KEYS and plan["format"] == FORMAT, "exact_public_plan_required")
    need(all(pin(plan[k]) for k in PLAN_KEYS if k.endswith("Sha256") or k == "sourceDigest"), "actual_candidate_pins_required")
    paths = {k: Path(plan[k]) for k in PLAN_KEYS if k.endswith("File")}
    need(all(p.is_absolute() and ".." not in p.parts for p in paths.values()), "absolute_candidate_artifact_paths_required")
    need(paths["packageProofFile"].name == "arena-consumer-package-proof.json" and paths["runtimeInventoryFile"].name == "runtime-supplement.inventory.json" and paths["installResultFile"].name == "install-result.json", "fixed_installed_artifact_names_required")
    need(len({p.parent for p in paths.values()}) == 1, "same_installed_artifact_directory_required")
    return RELEASES / plan["sourceDigest"]


def candidate(plan, helper):
    root = validate_plan(plan)
    proof = json.loads(protected(plan["packageProofFile"], 2000000))
    inventory_raw = protected(plan["runtimeInventoryFile"], 40000000)
    inventory = json.loads(inventory_raw)
    installed_raw = protected(plan["installResultFile"], 200000)
    installed = json.loads(installed_raw)
    need(sha(protected(plan["packageProofFile"], 2000000)) == plan["packageProofSha256"] and sha(inventory_raw) == plan["runtimeInventorySha256"] and sha(installed_raw) == plan["installResultSha256"], "exact_completed_candidate_receipts_required")
    verification = proof.get("verification", {})
    need(proof.get("format") == "yunipals-arena-modern-package-v1" and proof.get("status") == "passed" and proof.get("sourceDigest") == plan["sourceDigest"] and proof.get("source", {}).get("manifestSha256") == plan["sourceManifestSha256"], "completed_modern_build_required")
    need(all(verification.get(k) == v for k, v in {"twoFullTypechecks": True, "targetedCredentialReaderSuites": 2, "credentialControlsPerSuite": 79, "modernAcceptanceSuites": 2, "modernChecksPerSuite": 21, "ordinaryMarketBuilds": 2, "bundleCount": 36, "dependencyPackages": 330}.items()), "actual_modern_constructor_acceptance_required")
    need(verification.get("catalog", {}).get("rulesHash") == RULES_HASH and verification["catalog"].get("poolHash") == POOL_HASH and verification["catalog"].get("islands") == 898, "actual_46a4_full_catalog_build_required")
    need(proof.get("runtime", {}).get("separateRelocatedTreeRebuildByteIdentical") is True and proof["runtime"].get("archiveSha256") == plan["runtimeArchiveSha256"] and proof["runtime"].get("inventorySha256") == plan["runtimeInventorySha256"], "actual_reproducible_runtime_required")
    need(all(installed.get(k) == v for k, v in {"format": "yunipals-arena-modern-install-v1", "installed": True, "sourceDigest": plan["sourceDigest"], "manifestSha256": plan["sourceManifestSha256"], "proofSha256": plan["packageProofSha256"], "runtimeArchiveSha256": plan["runtimeArchiveSha256"], "runtimeInventorySha256": plan["runtimeInventorySha256"], "runtimeStarted": False, "serviceChanges": 0, "databaseChanges": 0, "sourceSelectionsChanged": 0}.items()), "actual_unselected_install_result_required")
    need(inventory.get("format") == "yunipals-runtime-supplement-v1" and inventory.get("sourceDigest") == plan["sourceDigest"] and inventory.get("sourceManifestSha256") == plan["sourceManifestSha256"] and inventory.get("archiveSha256") == plan["runtimeArchiveSha256"], "installed_runtime_source_binding_required")
    need(sha(protected(root / "RELEASE-MANIFEST.json")) == plan["sourceManifestSha256"], "installed_source_manifest_changed")
    manifest = helper.source_check(root, plan["sourceDigest"])
    roots, entries = helper.inventory_entries(root)
    need(roots == inventory.get("roots") and entries == inventory.get("entries") and len(entries) == proof["runtime"].get("entries") == installed.get("installedEntriesVerified") and len(manifest["files"]) == proof["source"].get("files") == installed.get("sourceFilesVerified"), "complete_installed_source_and_runtime_required")
    for name in {r["path"] for r in manifest["files"]} | {r["path"] for r in entries}:
        info = (root / name).lstat()
        need(info.st_uid == 0 and (stat.S_ISLNK(info.st_mode) or not info.st_mode & 0o022), "root_owned_immutable_candidate_payload_required")
    # No pixel/media completion is inferred from constructor qualification.
    return root, {"sourceFiles": len(manifest["files"]), "runtimeEntries": len(entries), "sourceDigest": plan["sourceDigest"], "packageProofSha256": plan["packageProofSha256"], "installResultSha256": plan["installResultSha256"], "mediaQualified": False}


def retained(restore, owner, observer):
    raw = restore.read(observer, restore.PARENT / "result.json")
    need(sha(raw) == restore.RESULT_SHA, "actual_owner11_commit_required")
    result = json.loads(raw)
    binding = json.loads(restore.read(observer, restore.PARENT / "review.json"))
    need(sha(encoded(binding)) == restore.OWNER_REVIEW and result.get("reviewHash") == restore.OWNER_REVIEW and binding.get("operatorSha256") == restore.OWNER_SHA and result.get("migrationCommitOutcome") == "commit_confirmed" and result.get("sourceSelectionChanged") is False and result.get("sourceModeAfter") == "legacy", "actual_unselected_owner11_binding_required")
    restored = json.loads(restore.read(observer, restore.BASE / "result.json"))
    need(sha(encoded(restored)) == RESTORE_RESULT_SHA and restored.get("format") == restore.FORMAT and restored.get("restored") is True and restored.get("overrideFilesRemoved") == 8 and restored.get("schemaWrites") == 0 and restored.get("privateDataRestores") == 0 and set(restored.get("originalActors", {})) == set(owner.UNITS), "actual_original_eight_restore_required")
    base_raw = observer.read(OPS / "arena-config-public-baseline-v1.json", 200000)[0]
    need(sha(base_raw) == observer.BASELINE_SHA, "retained_public_baseline_changed")
    base = json.loads(base_raw)
    need({r["unit"] for r in binding["currentUnits"]} == set(owner.UNITS) and len(binding["currentUnits"]) == 8, "exact_eight_original_bindings_required")
    owner.verify_inputs(observer, binding["privateInputHashes"])
    restore.no_jobs(owner)
    graph = restore.graph(owner, observer, base, binding, owned=False)
    for row in binding["currentUnits"]:
        public, tokens = owner.legacy_row(base, row["role"])
        need(sha(observer.read(Path(base["resolvedRelease"]) / "apps/yunipals-market-api" / tokens[-1], 5000000)[0]) == row["runtimeSha256"], "original_runtime_bytes_changed")
    post = json.loads(restore.read(observer, restore.PARENT / "postcheck.json"))
    need(post == result["postcheck"] and sha(encoded(owner.schema_objects())) == post["officialObjects"]["objectsSha256"], "committed_schema_graph_changed")
    database = restore.database(owner)
    return binding, base, restored, {"ownerResultSha256": restore.RESULT_SHA, "restoreResultSha256": RESTORE_RESULT_SHA, "definitions": graph, "committedMigrationMarkers": len(database["markers"]), "sourceMode": "legacy", "sourceSelections": 0}


def actor(restore, owner, row, restored):
    unit = row["unit"]
    props = restore.props(owner, unit)
    need(props["ActiveState"] == "active" and props["SubState"] == "running", "retained_arena_actor_not_running")
    identity = {"invocation": props["InvocationID"], "process": owner.process_identity(props, row)}
    need(identity == restored["originalActors"][unit], "exact_restored_actor_changed")
    return identity


def environment(raw, unit):
    need(isinstance(raw, bytes) and len(raw) <= 131072 and raw.endswith(b"\0"), "bounded_process_environment_required")
    values = {}
    for item in raw[:-1].split(b"\0"):
        key, sep, value = item.partition(b"=")
        need(sep and re.fullmatch(b"[A-Za-z_][A-Za-z0-9_]*", key) and key not in values, "unique_process_environment_required")
        values[key] = value
    need(len(values) <= 512 and values.get(b"CREDENTIALS_DIRECTORY") == ("/run/credentials/" + unit).encode(), "exact_current_loaded_credentials_directory_required")
    need(all(not values.get(k) for k in [b"NODE_OPTIONS", b"NODE_PATH"]), "no_unreviewed_node_preload_required")
    need(values.get(b"ARENA_REPOSITORY_ROOT", b"").startswith(b"/") and values.get(b"ARENA_RULES_HASH") == RULES_HASH.encode() and values.get(b"ARENA_INDEXER_MODE", b"legacy") in {b"", b"legacy"}, "retained_production_catalog_and_legacy_environment_required")
    # Preserve even non-UTF8 env bytes using Python's execve surrogateescape support.
    return {os.fsdecode(k): os.fsdecode(v) for k, v in values.items()}


def process_environment(pid, unit, proc=Path("/proc")):
    path = proc / str(pid) / "environ"
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == 971, "retained_process_environment_owner_required")
        raw = os.read(fd, 131073)
        need(os.read(fd, 1) == b"" and len(raw) <= 131072, "bounded_process_environment_required")
        need((os.fstat(fd).st_dev, os.fstat(fd).st_ino) == (before.st_dev, before.st_ino), "process_environment_inode_changed")
        return environment(raw, unit), sha(raw)
    finally:
        os.close(fd)


# This public relay runs AFTER nsenter and setpriv. Raw env bytes exist only in an
# anonymous sealed FD and execve's environment, never helper argv or output.
RELAY = r'''
import json,os,sys
try:
 fd=int(sys.argv[1]); payload=json.loads(os.read(fd,524289)); os.close(fd)
 if os.getuid()!=971 or os.getgid()!=965 or os.getgroups(): raise RuntimeError()
 status=dict(line.split(':',1)for line in open('/proc/self/status')if ':'in line)
 if [int(x)for x in status['Uid'].split()]!=[971]*4 or [int(x)for x in status['Gid'].split()]!=[965]*4: raise RuntimeError()
 if any(int(status[k],16)for k in ['CapPrm','CapEff','CapInh','CapAmb'])or status['NoNewPrivs'].strip()!='1': raise RuntimeError()
 env=payload['environment']; env['TSX_DISABLE_CACHE']='1'
 script=os.memfd_create('arena-constructor-script',os.MFD_CLOEXEC)
 os.write(script,payload['script'].encode());os.lseek(script,0,0);os.dup2(script,0);os.close(script)
 os.chdir(payload['app']);os.execve(payload['node'],[payload['node'],'--input-type=module','-'],env)
except BaseException:
 os.write(1,b'{"completed":false,"code":"credential_context_relay_failed"}\n');os._exit(1)
'''


PG_SCOPE = r"""
function scopedPgConfig(config){
 if(typeof config.connectionString!=='string')throw new Error('database_scope');
 const url=new URL(config.connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('database_scope');
 const options=(url.searchParams.get('options')??config.options??process.env.PGOPTIONS??'')+' -c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000';
 url.searchParams.set('options',options);
 const bounds={statement_timeout:5000,lock_timeout:2000,idle_in_transaction_session_timeout:15000,query_timeout:5000,connectionTimeoutMillis:2000};
 for(const [key,value]of Object.entries(bounds))url.searchParams.set(key,String(value));
 return{...config,...bounds,connectionString:url.href,options};
}
"""


def constructor_script(root):
    app = Path(root) / "apps/yunipals-market-api"
    # Only these public constants are embedded; the actual environment stays internal.
    return (r'''
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const app=__APP__, root=__ROOT__, expectedRules=__RULES__, expectedPool=__POOL__;
const write=process.stdout.write.bind(process.stdout);
for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
let runtime;
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
try {
 const require=createRequire(app+'/package.json');
 const {tsImport}=await import(require.resolve('tsx/esm/api'));
 const opts={parentURL:app+'/package.json',tsconfig:app+'/tsconfig.json'};
 const {rpcBudgetProxyUrl}=await tsImport(app+'/src/rpcBudgetProxyRegistry.ts',opts);
 const exactBaseUrl=new URL(rpcBudgetProxyUrl('base','production')).href;
 const nativeFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init); const body=await req.clone().text();
  if(req.url!==exactBaseUrl||req.method!=='POST'||body.length>65536)throw new Error('read_boundary');
  const rows=JSON.parse(body), requests=Array.isArray(rows)?rows:[rows];
  if(!requests.length||requests.length>12||requests.some(r=>r.jsonrpc!=='2.0'||!['eth_call','eth_chainId'].includes(r.method)||!Array.isArray(r.params)||r.method==='eth_call'&&(r.params.length!==2||typeof r.params[0]!=='object'||Array.isArray(r.params[0])||Object.keys(r.params[0]).some(k=>!['to','data','from'].includes(k)))||r.method==='eth_chainId'&&r.params.length!==0))throw new Error('read_boundary');
  calls+=requests.length;if(calls>3)throw new Error('read_limit');
  return nativeFetch(req);
 };
 const pg=require('pg');const OriginalPool=pg.Pool;
 __PG_SCOPE__
 pg.Pool=class extends OriginalPool{constructor(config){super(scopedPgConfig(config));}};
 const {loadLiveArenaCatalog,ARENA_POOL_HASH}=await tsImport(app+'/src/arena/live/catalog.ts',opts);
 const selectedRoot=process.env.ARENA_REPOSITORY_ROOT;
 const approved=JSON.parse(readFileSync(root+'/docs/arena/mainnet-rules-manifest-v1.json','utf8'));
 const candidate=loadLiveArenaCatalog(root),actual=loadLiveArenaCatalog(selectedRoot);
 const manifest=canonical(approved.manifest);
 if(approved.rulesHash!==expectedRules||hash(manifest)!==expectedRules.slice(2))throw new Error('approved_manifest_boundary');
 if(candidate.rulesHash!==expectedRules||actual.rulesHash!==expectedRules||ARENA_POOL_HASH!==expectedPool||canonical(candidate.manifest)!==manifest||canonical(actual.manifest)!==manifest||candidate.islands.length!==898||actual.islands.length!==898)throw new Error('catalog_boundary');
 const {arenaRuntime}=await tsImport(app+'/src/arena/live/runtime.ts',opts);
 runtime=await arenaRuntime({native:false});
 if(runtime.catalog.rulesHash!==expectedRules||runtime.config.rulesHash!==expectedRules||canonical(runtime.catalog.manifest)!==manifest)throw new Error('runtime_boundary');
 await runtime.close();runtime=undefined;
 write(JSON.stringify({completed:true,rulesHash:expectedRules,poolHash:expectedPool,islands:898,manifestSha256:hash(manifest),retainedRepositoryRootSha256:hash(selectedRoot),contractSettingsChecked:true,pgReadOnly:true,rpcReadCalls:calls,constructorOnly:true,closed:true})+'\n');
} catch {
 try{await runtime?.close();}catch{}
 write('{"completed":false,"code":"candidate_constructor_refused"}\n');process.exitCode=1;
}
'''.replace("__APP__", json.dumps(str(app))).replace("__ROOT__", json.dumps(str(root))).replace("__RULES__", json.dumps(RULES_HASH)).replace("__POOL__", json.dumps(POOL_HASH)).replace("__PG_SCOPE__", PG_SCOPE)).encode()


def child_result(raw):
    need(len(raw) <= 8192, "bounded_constructor_result_required")
    value = json.loads(raw)
    keys = {"completed", "rulesHash", "poolHash", "islands", "manifestSha256", "retainedRepositoryRootSha256", "contractSettingsChecked", "pgReadOnly", "rpcReadCalls", "constructorOnly", "closed"}
    need(set(value) == keys and value["completed"] is True and value["rulesHash"] == RULES_HASH and value["poolHash"] == POOL_HASH and value["islands"] == 898 and pin(value["manifestSha256"]) and pin(value["retainedRepositoryRootSha256"]) and all(value[k] is True for k in ["contractSettingsChecked", "pgReadOnly", "constructorOnly", "closed"]) and type(value["rpcReadCalls"]) is int and 1 <= value["rpcReadCalls"] <= 3, "successful_read_only_constructor_required")
    return value


def command(pid, fd, app):
    return ["/usr/bin/nsenter", "--target=" + str(pid), "--mount", "--wd=" + str(app), "--", "/usr/bin/setpriv", "--reuid=971", "--regid=965", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/python3", "-I", "-c", RELAY, str(fd)]


def invoke(pid, env, root, node):
    payload = encoded({"environment": env, "script": constructor_script(root).decode(), "app": str(root / "apps/yunipals-market-api"), "node": str(node)})
    need(len(payload) <= 524288, "bounded_internal_constructor_payload_required")
    fd = os.memfd_create("arena-private-environment", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    try:
        need(os.write(fd, payload) == len(payload), "complete_internal_payload_required")
        os.lseek(fd, 0, 0)
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE)
        child = subprocess.Popen(command(pid, fd, root / "apps/yunipals-market-api"), env=ENV, pass_fds=(fd,), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        try:
            out, err = child.communicate(timeout=45)
        except BaseException:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            raise PreflightFailure("bounded_constructor_child_failed") from None
        need(child.returncode == 0 and not err, "constructor_context_refused")
        return child_result(out)
    finally:
        os.close(fd)


def qualify_one(restore, owner, row, restored, root, observer, private_hashes):
    before = actor(restore, owner, row, restored)
    env, env_sha = process_environment(before["process"]["pid"], row["unit"])
    need(actor(restore, owner, row, restored) == before, "actor_changed_before_constructor")
    owner.verify_inputs(observer, private_hashes)
    result = invoke(before["process"]["pid"], env, root, owner.NODE)
    need(actor(restore, owner, row, restored) == before, "actor_changed_during_constructor")
    after_env, after_sha = process_environment(before["process"]["pid"], row["unit"])
    need(after_sha == env_sha and after_env == env, "actual_process_environment_changed")
    owner.verify_inputs(observer, private_hashes)
    return {"unit": row["unit"], "actor": before, "processEnvironmentSha256": env_sha, **result}


def inspect(plan, roles):
    restore = load(RESTORE, RESTORE_SHA, "retained_runtime_restore")
    owner = restore.load_owner()
    observer = owner.observer()
    helper = load(RUNTIME_HELPER, RUNTIME_HELPER_SHA, "verified_runtime_inventory")
    root, payload = candidate(plan, helper)
    binding, base, restored, retained_proof = retained(restore, owner, observer)
    need(sha(protected(owner.NODE, 150000000)) == owner.NODE_SHA, "accepted_constructor_node_required")
    rows = [row for row in base["services"] if row["unit"].removeprefix("yunipals-arena-").removesuffix(".service") in roles]
    identities = {row["unit"]: actor(restore, owner, row, restored) for row in base["services"]}
    need(len(rows) == len(roles), "fixed_requested_contexts_required")
    # Hash actual proc environments now without exposing any values in the review.
    env_hashes = {row["unit"]: process_environment(identities[row["unit"]]["process"]["pid"], row["unit"])[1] for row in rows}
    need(all(actor(restore, owner, row, restored) == identities[row["unit"]] for row in base["services"]), "actors_changed_during_review")
    proof = {"format": FORMAT, "operatorSha256": sha(protected(Path(__file__).absolute(), 200000)), "planSha256": sha(encoded(plan)), "candidate": payload, "retained": retained_proof, "actors": identities, "contextUnits": [r["unit"] for r in rows], "processEnvironmentHashes": env_hashes, "constructorInvocations": 0, "serviceJobs": 0, "schemaWrites": 0, "privateInputsUnchanged": True}
    return proof, (restore, owner, observer, root, binding, base, restored, rows)


def main():
    global PHASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--scope", choices=["api", "all-eight"], default="api")
    parser.add_argument("--qualify", help="Exact fresh read-only review hash; runs constructor+close only.")
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(600)
    raw = protected(args.plan, 100000)
    need(pin(args.plan_sha256) and sha(raw) == args.plan_sha256, "exact_candidate_plan_required")
    plan = json.loads(raw)
    roles = ["api"] if args.scope == "api" else ["api", "capacity", "control", "lobby", "media", "projector", "referee", "settlement"]
    PHASE = "read_only_review"
    proof, context = inspect(plan, roles)
    review_hash = sha(encoded(proof))
    if not args.qualify:
        print(json.dumps({**proof, "reviewHash": review_hash, "scope": args.scope, "qualified": False}, sort_keys=True))
        return
    need(pin(args.qualify) and args.qualify == review_hash, "fresh_exact_constructor_review_required")
    restore, owner, observer, root, binding, base, restored, rows = context
    PHASE = "constructor_only"
    results = [qualify_one(restore, owner, row, restored, root, observer, binding["privateInputHashes"]) for row in rows]
    # Recheck definitions, schema, all actors and complete source/runtime after probes.
    _, _, _, after = retained(restore, owner, observer)
    need(after == proof["retained"] and all(actor(restore, owner, row, restored) == proof["actors"][row["unit"]] for row in base["services"]), "retained_state_changed_during_qualification")
    candidate(plan, load(RUNTIME_HELPER, RUNTIME_HELPER_SHA, "verified_runtime_inventory_after"))
    print(json.dumps({"format": FORMAT, "reviewHash": review_hash, "scope": args.scope, "qualified": True, "qualifiedContexts": len(results), "results": results, "serviceJobs": 0, "schemaWrites": 0, "sourceSelectionsChanged": 0, "privateInputsUnchanged": True, "mediaQualified": False, "rawValuesExported": False}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "qualified": False, "phase": PHASE, "fixedCode": str(error) if isinstance(error, PreflightFailure) else "external_preflight_failure", "errorClass": type(error).__name__, "rawValuesExported": False}, sort_keys=True))
        raise SystemExit(1)
