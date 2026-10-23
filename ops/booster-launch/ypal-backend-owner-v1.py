#!/usr/bin/env python3
"""Prepare one inactive fresh YPAL source namespace. Default review is read-only.

No production ingestor/reader stop, start, selector switch or SQL is implemented
here. The only service action is one offline private-namespace build probe.
Every effect has an exclusive intent/result. Unknown prefixes are inspected or
abandoned without repeating the probe or touching original runtimes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT = "yunipals-ypal-backend-owner-v1"
BASE = Path("/var/backups/yunipals-ypal-backend-owner-v1-20261023")
INPUT = Path("/var/backups/yunipals-ypal-backend-input-v1-20261023")
ROOT = Path("/var/lib/yunipals-booster-ypal/base-ypal-v1-source008")
OLD_ROOT = Path("/var/lib/yunipals-booster-launch/20261022-source008")
OLD_PROJECT = OLD_ROOT / "apps/yunipals-indexer"
PROJECT = OLD_PROJECT
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
PUBLIC = INPUT / "public"
SOURCE = "yunipals-booster-ypal-source.service"
OLD_SOURCE = "yunipals-booster-launch.service"
API = "yunipals-booster-api.service"
QUEUE = "yunipals-booster-artwork-queue.service"
TIMER = "yunipals-booster-artwork-queue.timer"
UNITS = {SOURCE, OLD_SOURCE, API, QUEUE, TIMER}
UNIT_FILE = Path("/etc/systemd/system") / SOURCE
ENV_FILE = Path("/etc/yunipals-unified/booster-ypal.public.env")
DROP_FILES = {u: Path("/etc/systemd/system") / (u + ".d") / "95-ypal.conf" for u in (API, QUEUE)}
SCHEMA = "yunipals_boosters_ypal_v1"
OLD_SCHEMA = "yunipals_boosters_launch_v1"
NODE = "/opt/node-v24.18.1/bin/node"
SOURCE_DIGEST = "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78"
PACKAGE_SHA = "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886"
BACKEND_SHA = "94b78e09d3e5d845229a4ea8afdc481cd17b744e1b6bd9f070cb3fe9aa09a371"
ABI_SHA = "580b38c39dc3e76f92762195f4b6862123775f13d95d092b3fafa39d73adc0ba"
API_SHA = "41fe9b9cb87edaa5689ed611cd2c99b299215be7c8fb6262b560660854657c73"
QUEUE_SHA = "e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33"
SOURCE_OVERLAYS = {
    "ponder.boosters.launch.config.ts": ("ponder.boosters.launch.paced.config.ts", "a161452bc7748950727ac173f026f5cb9089960a659acf177e1da8375b3dd49b"),
    "booster-launch-transport.ts": ("booster-launch-transport.ts", "96e227ba7bb1c8e2a1789dcbd0b7d96b8b32965127a9e02ed620e19b2112e9c4")}
TABLES = sorted(["_ponder_meta", "_ponder_checkpoint", "booster_type", "booster_original", "booster_request", "booster_monster", "booster_refund", "booster_engine_state", "booster_checkpoint", "booster_event"])
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}
# Filled only from the independent observer's actual frozen public source.
# A missing pin prevents every production review/action; no guessed producer.
OBSERVER_FILE = OPS / "ypal-old-runtime-inventory-v1.py"
OBSERVER_SHA = "7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b"
QUALIFIER_FILE = PUBLIC / "ops/booster-launch/ypal-backend-qualification-v1.mjs"
QUALIFIER_SHA = "dcb7c8af69db9aa7fcd4b0a17efb5f3e1c1ad9cd85c9994aa1f9433bd3308c78"
PROFILE_FILE = OPS / "ypal-rpc-19212/profile.json"
PROFILE_SHA = "0e19f87a728a0150fae82e6125436739864edd86a6b5b1ecdfcd3503e70e0e05"
PROFILE_ID = "0x25308afec8bf9d4992afb5dbf52675d958ee1c619533e7917ae3fe08dbd29c86"
PROBE_UNIT = "yunipals-ypal-build-probe-v1.service"
PHASES = ("prepare",)


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
def boot(): return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def protected(path, maximum=40_000_000):
    path = Path(path)
    need(path.is_absolute(), "absolute_input_required")
    for p in [*path.parents, path]:
        st = p.lstat()
        need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, "protected_input_required")
    before = path.stat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum, "bounded_regular_input_required")
    raw = path.read_bytes()
    need(file_identity(before) == file_identity(path.stat()), "input_changed_during_read")
    return raw


def file_identity(st):
    return {k: getattr(st, k) for k in ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size", "st_mtime_ns", "st_ctime_ns")}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def write_new(path, raw, mode=0o600):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        identity = file_identity(os.fstat(stream.fileno()))
    sync(path.parent)
    return {"sha256": sha(raw), "identity": identity}


def save(path, value): return write_new(path, encoded(value))
def load(path): return json.loads(protected(path))


def owned_file(path, recorded):
    before = Path(path).lstat()
    need(file_identity(before) == recorded["identity"] and sha(protected(path)) == recorded["sha256"], "foreign_or_replaced_owned_file")


def remove_owned(path, recorded):
    owned_file(path, recorded)
    # Check the exact inode immediately before unlink, including same-byte swaps.
    need(file_identity(Path(path).lstat()) == recorded["identity"], "owned_inode_changed_before_unlink")
    Path(path).unlink(); sync(Path(path).parent)


def pinned_module(path, pin):
    need(isinstance(pin, str) and re.fullmatch("[0-9a-f]{64}", pin), "actual_frozen_dependency_pin_required")
    raw = protected(path)
    need(sha(raw) == pin, "exact_public_dependency_required")
    module = types.ModuleType("ypal_owned_dependency"); module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def command(args, *, data=None, timeout=30):
    result = subprocess.run(args, input=data, env=ENV, capture_output=True, timeout=timeout)
    need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 2_000_000, "bounded_command_ack_unavailable")
    return result.stdout




def unit_state(unit, absent=False):
    need(unit in UNITS, "fixed_unit_only")
    fields = ["Id", "LoadState", "ActiveState", "SubState", "MainPID", "InvocationID", "Job", "NRestarts", "FragmentPath", "DropInPaths", "ExecStart", "WorkingDirectory", "User", "Group", "ControlGroup", "ExecMainStartTimestampMonotonic", "UnitFileState"]
    if unit == TIMER:
        fields = ["Id", "LoadState", "ActiveState", "SubState", "InvocationID", "Job", "FragmentPath", "DropInPaths", "UnitFileState"]
    raw = command(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + f for f in fields]])
    value = dict(line.split("=", 1) for line in raw.decode().splitlines())
    if absent:
        need(value.get("Id") == unit and value.get("LoadState") == "not-found" and value.get("ActiveState") == "inactive" and value.get("MainPID") == "0" and not value.get("Job") and not value.get("FragmentPath") and not value.get("DropInPaths") and not value.get("ExecStart"), "fresh_absent_unit_required")
        return {k: value.get(k, "") for k in fields}
    need(set(value) == set(fields) and value["Id"] == unit and value["LoadState"] == "loaded", "complete_loaded_unit_state_required")
    return value


def quiet(state):
    if state["Id"] == TIMER:
        need(state["ActiveState"] in {"inactive", "failed"} and state["Job"] == "", "terminal_owned_timer_required")
        return
    need(state["MainPID"] == "0" and state["ActiveState"] in {"inactive", "failed"} and state["Job"] == "", "terminal_owned_unit_required")
    group = Path("/sys/fs/cgroup/system.slice") / state["Id"] / "cgroup.procs"
    need(not group.exists() or not group.read_text().split(), "empty_owned_cgroup_required")




class Journal:
    def __init__(self, base=BASE): self.base = Path(base)

    def action(self, name, binding, effect):
        need(re.fullmatch("[a-z0-9-]+", name), "fixed_action_name_required")
        intent = self.base / (name + "-intent.json")
        need(not os.path.lexists(intent), "existing_action_requires_reconcile_not_retry")
        save(intent, {"format": FORMAT, "binding": binding, "bootId": boot(), "monotonicNs": time.monotonic_ns(), "automaticRetryAllowed": False})
        result = effect()
        save(self.base / (name + "-result.json"), {"format": FORMAT, "bindingSha256": sha(protected(intent)), "result": result})
        return result


def read_qualification(file, pin, maximum_age=None):
    path = Path(file)
    allowed = path == INPUT / "chain-qualification.json" or (path.parent.parent == INPUT / "qualifications" and path.name == "result.json" and re.fullmatch("[a-z0-9-]{1,48}", path.parent.name))
    need(allowed and re.fullmatch("[0-9a-f]{64}", str(pin)), "fixed_protected_qualification_reference_required")
    raw = protected(path); value = json.loads(raw)
    need(sha(raw) == pin and value.get("format") == "yunipals-ypal-backend-qualification-owner-v1" and value.get("producerSha256") == QUALIFIER_SHA and value.get("backendProducerSha256") == BACKEND_SHA and value.get("packageSha256") == PACKAGE_SHA and value.get("hostQualified") is False and value.get("serviceChanges") == 0 and value.get("financialProfileUsed") is False and value.get("sourceAdmissionQualified") is False, "acknowledged_actual_chain_qualification_required")
    confirmed = protected(INPUT / "confirmed.json")
    need(sha(confirmed) == value["confirmedFileSha256"], "actual_owner_export_bytes_required")
    manifest = json.loads(confirmed); q = value["qualification"]
    need(value.get("confirmedCanonicalSha256") == sha((json.dumps(manifest, indent=2) + "\n").encode()) and re.fullmatch("0x[0-9a-f]{64}", str(value.get("expectedRuleHash"))), "canonical_manifest_and_activated_rule_binding_required")
    need(q.get("format") == "yunipals-ypal-backend-chain-qualification-v1" and q.get("currentStateQualified") is True and q.get("packageSha256") == PACKAGE_SHA and q.get("confirmedManifestSha256") == value["confirmedCanonicalSha256"] and q.get("chainTransactionsSent") == q.get("databaseWrites") == q.get("serviceChanges") == 0, "complete_readonly_chain_report_required")
    need(manifest.get("format") == "yunipals-ypal-fresh-deployment-confirmed-v1" and manifest.get("launchId") == "base-ypal-v1" and manifest.get("packageSha256") == PACKAGE_SHA and manifest.get("packTypeId") == "1", "canonical_fresh_owner_manifest_required")
    need(q["addresses"] == {k: manifest[k] for k in ("ypal", "registry", "monsters", "engine", "implementations")} and q["sourceStartBlock"] == manifest["sourceStartBlock"] and len(q["transactions"]) == 10 and len(q["codeHashes"]) == 7, "all_actual_deployment_identities_required")
    need(value["freeRpcGuard"]["before"] == value["freeRpcGuard"]["after"] and value["freeRpcGuard"]["before"]["freeOnly"] is True and value["freeRpcGuard"]["before"]["paidCalls"] == 0, "same_free_only_profile_before_after_required")
    guard = value["freeRpcGuard"]["before"]
    need(guard.get("provider") == "https://mainnet.base.org" and guard.get("financialProfileUsed") is False and guard.get("sourceAdmissionQualified") is False and guard.get("maximumRequests") == 160 and guard.get("maximumSeconds") == 180 and type(value.get("publicReadRequestCount")) is int and 1 <= value["publicReadRequestCount"] <= 160, "bounded_public_deployment_read_scope_required")
    if maximum_age is not None:
        need(0 <= time.time() - value["qualifiedAtEpochSeconds"] <= maximum_age, "fresh_qualification_required_for_this_phase")
    return {"file": str(path), "sha256": pin, "producerSha256": QUALIFIER_SHA, "confirmedFileSha256": sha(confirmed)}, manifest, value


def source_candidates(original, old_argv, deployment, policy):
    need(policy.get("prepared") is True and policy.get("indexPolicyAdmitted") is False and policy.get("freeOnly") is True and policy.get("paidAuthority") is False and policy.get("emptyPermits") is True, "explicit_unadmitted_offline_profile_proposal_required")
    need(policy.get("endpoint") == "http://127.0.0.1:19212/unified" and re.fullmatch("0x[0-9a-f]{64}", str(policy.get("profileId"))), "exact_new_base_proxy_required")
    need(deployment["packTypeId"] == "1" and deployment["packageSha256"] == PACKAGE_SHA, "fresh_type1_required")
    environment = {"BOOSTER_REGISTRY": deployment["registry"].lower(), "BOOSTER_ENGINE": deployment["engine"].lower(), "BOOSTER_MONSTERS": deployment["monsters"].lower(), "BOOSTER_WRAPPER": deployment["vrfWrapper"].lower(), "BOOSTER_DEPLOYMENT_BLOCK": deployment["sourceStartBlock"], "PONDER_BOOSTERS_ONLY": "true", "PONDER_ISLANDS_ONLY": "false", "DATABASE_SCHEMA": SCHEMA, "PGAPPNAME": "yunipals_ypal_source_v1", "PONDER_RPC_URL_8453": policy["endpoint"], "UNIFIED_RPC_POLICY_REQUIRED": "true", "UNIFIED_RPC_FREE_ONLY": "true", "UNIFIED_RPC_PROFILE_FILE": policy["profileFile"], "UNIFIED_RPC_PROFILE_ID": policy["profileId"], "UNIFIED_RPC_REPLAY_PERMIT_ID": "", **{"UNIFIED_RPC_REPLAY_PERMIT_ID_" + str(chain): "" for chain in (1, 56, 137, 8453)}}
    public_env = "".join(k + "=" + v + "\n" for k, v in environment.items()).encode()
    need(all("\n" not in str(v) and "\r" not in str(v) for v in environment.values()), "single_line_public_environment_required")
    argv = list(old_argv)
    old_env = "--env-file=" + str(OLD_PROJECT / "launch.public.env")
    need(argv.count(old_env) == 1 and argv.count("--schema") == 1 and argv[argv.index("--schema") + 1] == OLD_SCHEMA and "--port" in argv and argv[argv.index("--port") + 1] == "9026", "exact_existing_booster_arguments_required")
    argv[argv.index(old_env)] = "--env-file=" + str(ROOT / "launch.public.env")
    argv[argv.index("--schema") + 1] = SCHEMA
    lines = original.decode().splitlines()
    start = [i for i, line in enumerate(lines) if line.startswith("ExecStart=")]
    need(len(start) == 1 and all(not line.startswith(prefix) for line in lines for prefix in ("ExecStartPre=", "ExecStartPost=", "ExecStop=", "ExecStopPost=", "ExecCondition=", "BindPaths=", "BindReadOnlyPaths=")), "unchanged_hook_free_source_unit_required")
    before = shlex.split(lines[start[0]].split("=", 1)[1])
    need(before == ["/usr/bin/env", "-i", *old_argv], "exact_existing_source_exec_required")
    write_paths = [shlex.split(line.split("=", 1)[1]) for line in lines if line.startswith("ReadWritePaths=")]
    need(write_paths == [[str(PROJECT / ".ponder"), str(PROJECT / "ponder-env.d.ts"), str(PROJECT / "node_modules/.vite-temp")]], "only_three_declared_output_paths_writable")
    lines[start[0]] = "ExecStart=/usr/bin/env -i " + " ".join(argv)
    need(lines.count("[Service]") == 1 and lines.count("RuntimeMaxSec=infinity") == 1 and lines.count("Restart=on-failure") == 1, "continuous_source_definition_required")
    service = lines.index("[Service]") + 1
    lines[service:service] = ["BindPaths=" + str(ROOT / ".ponder") + ":" + str(PROJECT / ".ponder") + " " + str(ROOT / ".vite-temp") + ":" + str(PROJECT / "node_modules/.vite-temp") + " " + str(ROOT / "ponder-env.d.ts") + ":" + str(PROJECT / "ponder-env.d.ts"), "BindReadOnlyPaths=" + str(ROOT / "ponder.ypal.config.ts") + ":" + str(PROJECT / "ponder.boosters.launch.config.ts")]
    reader = {k: v for k, v in environment.items() if k.startswith("BOOSTER_")}
    reader.update({"BOOSTER_DATABASE_SCHEMA": SCHEMA, "BOOSTER_ARTWORK_CATALOGS": "base-mainnet-standard-v1"})
    reader_env = "".join(k + "=" + v + "\n" for k, v in reader.items()).encode()
    drop = ("[Service]\nEnvironmentFile=" + str(ENV_FILE) + "\nEnvironment=BOOSTER_ARTWORK_CATALOGS=base-mainnet-standard-v1\n").encode()
    return {"sourceEnv": public_env, "readerEnv": reader_env, "definition": ("\n".join(lines) + "\n").encode(), "argv": argv, "drop": drop}


def verify_drain(snapshot, rows):
    attribution = snapshot["source"]["sessionAttribution"]
    need(attribution.get("complete") is True and attribution.get("applicationNameOrAgeInference") is False and attribution.get("sharedRoleZeroSessionsRequired") is False, "actual_kernel_session_attribution_required")
    identity = lambda row: (row["pid"], row["backendStart"])
    old = {identity(row) for row in attribution["oldBackends"]}
    combined = {identity(row) for row in attribution["combinedBackends"]}
    actual = {identity(row) for row in rows}
    need(old.isdisjoint(actual), "old_source_backends_still_live")
    # Until the fresh source starts, every remaining writer connection must be
    # the positively identified unchanged combined actor, never a role-wide0.
    need(actual == combined, "remaining_writer_backends_not_exact_combined")
    return {"oldBackendTuplesGone": sorted(old), "combinedBackendTuplesPreserved": sorted(combined), "sharedRoleZeroSessionsRequired": False}


def source_config(deployment, policy):
    sources = policy["sourceManifest"]["sources"]
    names = {"BoosterRegistry": "registry", "BoosterMonsters": "monsters", "BoosterEngine": "engine"}
    need(len(sources) == 3 and {s["contractName"] for s in sources} == set(names), "exact_fresh_three_source_manifest_required")
    contracts = []
    for source in sources:
        key = names[source["contractName"]]
        need(source["chainId"] == 8453 and source["enabled"] is True and source["address"].lower() == deployment[key].lower() and source["startBlock"] == deployment["receipts"][key]["blockNumber"], "source_policy_deployment_or_start_mismatch")
        contracts.append(source["contractName"] + ":{...boosterConfig.contracts." + source["contractName"] + ",address:" + json.dumps(deployment[key].lower()) + ",startBlock:" + source["startBlock"] + "}")
    return ("import{createConfig}from'ponder';\nimport boosterConfig from'./ponder.boosters.config.js';\nimport{unifiedRpcTransport}from'./lib/unified/rpc-preflight.js';\nimport{boundedLaunchTransport}from'./booster-launch-transport.js';\nconst configured=unifiedRpcTransport(8453);if(typeof configured!=='function')throw Error('fresh_profile_required');const rpc=boundedLaunchTransport(configured);\nexport default createConfig({...boosterConfig,database:{kind:'postgres',poolConfig:{max:5}},chains:{base:{...boosterConfig.chains.base,rpc}},contracts:{" + ",".join(contracts) + "}});\n").encode()


PUBLIC_CACHE_PROOF = r'''import hashlib,json,os,pathlib,stat,sys
base=pathlib.Path('/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer');assert os.geteuid()==970
roots=[base/'.ponder',base/'node_modules/.vite-temp',base/'ponder-env.d.ts'];out={};total=0
for root in roots:
 paths=[root] if root.is_file() else [root,*root.rglob('*')]
 assert len(paths)<=5000
 for p in sorted(paths):
  s=p.lstat();assert not stat.S_ISLNK(s.st_mode)
  if stat.S_ISREG(s.st_mode):
   total+=s.st_size;assert total<=100000000
   b=p.read_bytes();assert (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(p.stat().st_ino,p.stat().st_mtime_ns,p.stat().st_ctime_ns)
   out[str(p)]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
print(json.dumps(out,sort_keys=True))
'''


BUILD_PROBE = r'''import{createRequire}from'node:module';import{realpathSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import net from'node:net';
let attempts=0;globalThis.fetch=()=>{attempts++;throw Error('network_forbidden')};net.Socket.prototype.connect=function(){attempts++;throw Error('sockets_forbidden')};
const project=process.cwd(),require=createRequire(realpathSync('./node_modules/ponder/package.json')),entry=pathToFileURL(require.resolve('./dist/esm/index.js')),internal=p=>import(new URL(p,entry));
const{createBuild}=await internal('./build/index.js'),{createLogger}=await internal('./internal/logger.js'),{MetricsService}=await internal('./internal/metrics.js'),{buildOptions}=await internal('./internal/options.js'),{createShutdown}=await internal('./internal/shutdown.js');
const cliOptions={root:project,config:'ponder.boosters.launch.config.ts',command:'start',version:'0.17.5',schema:'yunipals_boosters_ypal_v1',logLevel:'silent',logFormat:'json'},options=buildOptions({cliOptions});
const shutdown=createShutdown(),common={options,logger:createLogger({level:'silent',mode:'json'}),metrics:new MetricsService(),shutdown,buildShutdown:shutdown,apiShutdown:shutdown},hashes=[];
try{const build=await createBuild({common,cliOptions});for(const name of['executeConfig','executeSchema','executeIndexingFunctions']){const r=await build[name]();if(r.status!=='success')throw Error('build_failed');hashes.push(r.result.contentHash);}}finally{await shutdown.kill();}
if(attempts||process.getuid()!==970||process.getgid()!==964)throw Error('offline_actor_required');console.log(JSON.stringify({config:true,schema:true,handlers:true,buildId:createHash('sha256').update('2'+hashes.join('')).digest('hex').slice(0,10),uid:970,gid:964,networkAttempts:attempts,databaseAttempts:0}));
'''


class Host:
    def __init__(self):
        self.observer = pinned_module(OBSERVER_FILE, OBSERVER_SHA)
        need(sha(protected(QUALIFIER_FILE)) == QUALIFIER_SHA and sha(protected(PUBLIC / "ops/booster-launch/ypal-backend-prepare-v1.mjs")) == BACKEND_SHA, "fixed_chain_qualifier_sources_required")
        need(protected(PUBLIC / "package.json") == b'{"type":"module"}\n', "explicit_module_type_for_staged_public_closure_required")
        modules = PUBLIC / "node_modules"
        need(modules.is_symlink() and modules.lstat().st_uid == 0 and os.readlink(modules) == "/opt/yunipals-unified/booster-api-releases/" + API_SHA + "/node_modules", "existing_accepted_API_dependencies_only")
        self.journal = Journal()
        self.core = self.observer.load("booster-feature-handover-v7.py").Host()

    def inventory(self):
        return self.observer.capture()

    def chain(self, manifest):
        raw = command([NODE, str(QUALIFIER_FILE), "--read-only"], timeout=180)
        value = json.loads(raw)
        need(value.get("producerSha256") == QUALIFIER_SHA and value.get("backendProducerSha256") == BACKEND_SHA and value["confirmedFileSha256"] == sha(protected(INPUT / "confirmed.json")), "fresh_actual_chain_revalidation_required")
        need(value["qualification"]["addresses"] == {k: manifest[k] for k in ("ypal", "registry", "monsters", "engine", "implementations")}, "fresh_actual_deployment_changed")
        return value

    def state(self, unit, absent=False): return unit_state(unit, absent)
    def query(self, sql): return self.core.query(sql)
    def independent(self): return self.observer.independent()


    def proposal(self, deployment):
        raw = protected(PROFILE_FILE); need(sha(raw) == PROFILE_SHA, "exact_actual_fresh_profile_proposal_required")
        profile = json.loads(raw)
        need("0x" + sha(json.dumps(profile, sort_keys=True, separators=(",", ":")).encode()) == PROFILE_ID, "actual_profile_identity_required")
        need(profile["scope"] == "yunipals-opensea" and profile["coordinatorId"] == "faf1bb8c-4306-4c43-b55e-6ac5fa038567", "existing_budget_scope_and_coordinator_only")
        value = {"prepared": True, "indexPolicyAdmitted": False, "freeOnly": True, "paidAuthority": False, "emptyPermits": True, "endpoint": "http://127.0.0.1:19212/unified", "profileId": PROFILE_ID, "profileFile": str(PROFILE_FILE), "profileFileSha256": PROFILE_SHA, "sourceManifest": profile["manifest"]}
        source_config(deployment, value)
        return value

    def code_proof(self):
        path = OLD_ROOT / "BASE-SOURCE-MANIFEST.json"
        raw = protected(path); manifest = json.loads(raw); rows = manifest["files"]
        need(manifest.get("sourceDigest") == SOURCE_DIGEST and sha((json.dumps(rows, indent=2, ensure_ascii=False) + "\n").encode()) == SOURCE_DIGEST, "actual_source008_base_manifest_required")
        files = {}
        for row in rows:
            name = row["path"]
            need(not Path(name).is_absolute() and ".." not in Path(name).parts, "finite_public_source_path_required")
            file = OLD_ROOT / name
            if file == PROJECT / "ponder-env.d.ts":
                continue  # Mutable public generated output is separately hashed.
            expected = "68a0d4fd0442ecb464574434e1e349f1e4caf1c4ab2f0a70352f8b5f26afe833" if name == "apps/yunipals-indexer/lib/unified/rpc-preflight.ts" else row["sha256"]
            data = protected(file)
            need(sha(data) == expected, "retained_source008_public_file_changed")
            files[name] = sha(data)
        workspace = self.observer.workspace_packet(str(PROJECT))
        workspace["viteConfigSha256"] = sha(protected(PROJECT / "vite.config.ts"))
        for name, (_, pin) in SOURCE_OVERLAYS.items():
            need(sha(protected(PROJECT / name)) == pin, "retained_paced_transport_and_config_required")
        for parent in (OLD_ROOT, PROJECT):
            for name in (".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"):
                need(not os.path.lexists(parent / name), "no_implicit_private_environment_in_probe_workspace")
        return {"sourceDigest": SOURCE_DIGEST, "baseManifestSha256": sha(raw), "filesSha256": sha(encoded(files)), "files": len(files), "workspace": workspace}

    def cache_proof(self):
        return json.loads(command(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all", "/usr/bin/python3", "-I", "-B", "-c", PUBLIC_CACHE_PROOF], timeout=25))

    def resources(self, after=False):
        disk = os.statvfs("/var/lib")
        free = disk.f_bavail * disk.f_frsize
        need(free >= 25_000_000_000 + (0 if after else 1_000_000_000), "original_25GB_disk_reserve_required")
        memory = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
        available = int(memory["MemAvailable"].split()[0]) * 1024
        need(after or available >= 1_500_000_000, "offline_probe_memory_headroom_required")
        return {"rootFreeBytes": free, "memAvailableBytes": available, "rootReserveBytes": 25_000_000_000, "maximumProbeMemoryBytes": 1_073_741_824}

    def offline_build(self, candidate, snapshot):
        self.resources()
        need(self.probe_terminal()["managerLoadState"] == "not-found", "fresh_transient_probe_name_required")
        for parent in (Path("/etc/systemd/system"), Path("/run/systemd/system"), Path("/run/systemd/transient")):
            need(not os.path.lexists(parent / PROBE_UNIT) and not os.path.lexists(parent / (PROBE_UNIT + ".d")), "no_foreign_probe_definition_allowed")
        before = self.cache_proof()
        properties = ["User=yunipals_unified_shadow", "Group=yunipals_unified_shadow", "WorkingDirectory=" + str(PROJECT), "Type=exec", "NoNewPrivileges=yes", "PrivateTmp=yes", "PrivateNetwork=yes", "ProtectSystem=strict", "ProtectHome=yes", "RestrictSUIDSGID=yes", "RestrictAddressFamilies=AF_UNIX", "MemoryMax=1073741824", "MemorySwapMax=0", "CPUQuota=100%", "IOWeight=10", "TasksMax=128", "RuntimeMaxSec=45", "TimeoutStopSec=10", "KillMode=control-group", "LimitCORE=0"]
        for line in candidate["definition"].decode().splitlines():
            if line.startswith(("BindPaths=", "BindReadOnlyPaths=", "ReadWritePaths=")):
                properties.append(line)
        hidden = sorted(set(snapshot["privateInputHashes"]) | {"/run/postgresql", "/var/run/postgresql"})
        properties.append("InaccessiblePaths=" + " ".join("-" + p for p in hidden))
        args = ["/usr/bin/systemd-run", "--quiet", "--collect", "--wait", "--pipe", "--unit=" + PROBE_UNIT, *["--property=" + p for p in properties], "/usr/bin/env", "-i", "DATABASE_URL=postgresql://ypal_offline_probe@127.0.0.1:1/ypal_offline_probe", NODE, "--max-old-space-size=512", "--env-file=" + str(ROOT / "launch.public.env"), "--input-type=module", "-e", BUILD_PROBE]
        value = json.loads(command(args, timeout=60))
        need(value.get("config") is True and value.get("schema") is True and value.get("handlers") is True and value.get("uid") == 970 and value.get("gid") == 964 and value.get("networkAttempts") == value.get("databaseAttempts") == 0 and re.fullmatch("[0-9a-f]{10}", str(value.get("buildId"))), "actual_hardened_offline_build_required")
        need(before == self.cache_proof(), "original_cache_or_generated_bytes_changed_outside_namespace")
        self.resources(after=True)
        return {**value, "privateNetwork": True, "realDatabaseCredentialsSupplied": False, "databaseSocketsHidden": True, "originalCacheProofSha256": sha(encoded(before)), "originalOutputsUnchanged": True, "unit": PROBE_UNIT}

    def prepare_outputs(self, candidate, deployment, proposal, snapshot):
        need(not os.path.lexists(ROOT), "fresh_owned_output_root_required")
        ROOT.mkdir(mode=0o755); ROOT.chmod(0o755)
        for name in (".ponder", ".vite-temp"):
            path = ROOT / name; path.mkdir(mode=0o750); os.chown(path, 970, 964); path.chmod(0o750)
        # Public generated type declarations only; never copy an env/DB file.
        peer = "import os,sys;f=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW);b=os.read(f,500001);assert len(b)<=500000;os.close(f);sys.stdout.buffer.write(b)"
        generated = command(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all", "/usr/bin/python3", "-I", "-B", "-c", peer, str(PROJECT / "ponder-env.d.ts")])
        write_new(ROOT / "ponder-env.d.ts", generated, 0o640); os.chown(ROOT / "ponder-env.d.ts", 970, 964)
        pins = {"launch.public.env": write_new(ROOT / "launch.public.env", candidate["sourceEnv"], 0o644), "ponder.ypal.config.ts": write_new(ROOT / "ponder.ypal.config.ts", source_config(deployment, proposal), 0o644)}
        write_new(BASE / "source-unit.candidate", candidate["definition"])
        write_new(BASE / "reader.public.env.candidate", candidate["readerEnv"])
        write_new(BASE / "reader-dropin.candidate", candidate["drop"])
        proof = self.offline_build(candidate, snapshot)
        return {"root": str(ROOT), "publicFilePins": pins, "build": proof, "sourceUnitInstalled": False, "sourceStarted": False, "oldSourceStopped": False, "indexPolicyAdmitted": False}

    def old_snapshot(self):
        value = self.inventory()
        need(value["bootId"] == boot() and value["operatorSha256"] == OBSERVER_SHA, "actual_same_boot_observation_required")
        need(value["source"]["sessionAttribution"]["complete"] is True, "complete_old_backend_attribution_required")
        need(value["roles"]["collector"]["connectionLimit"] == 6, "existing_six_connection_collector_budget_required")
        return value

    def unchanged(self, operation):
        need(boot() == operation["bootId"] and self.independent() == operation["independentActors"], "independent_OG_BNB_proxy_or_private_input_changed")
        for path, pin in operation["snapshot"]["privateInputHashes"].items():
            need(self.observer.file_pin(path) == pin, "existing_private_input_changed")
        for unit in (OLD_SOURCE, API, QUEUE, TIMER):
            saved = operation["snapshot"]["source"]["unit"] if unit == OLD_SOURCE else operation["snapshot"]["api"]["unit"] if unit == API else operation["snapshot"]["queue"]["timer" if unit == TIMER else "service"]
            for path, pin in saved["definitionFiles"].items():
                need(self.observer.file_pin(path) == pin, "original_service_definition_changed")







    def probe_terminal(self):
        keys = ["Id", "LoadState", "ActiveState", "SubState", "MainPID", "Job", "ControlGroup"]
        raw = command(["/usr/bin/systemctl", "show", "--all", PROBE_UNIT, *["--property=" + k for k in keys]])
        state = dict(line.split("=", 1) for line in raw.decode().splitlines())
        need(state.get("Id") == PROBE_UNIT and state.get("MainPID") == "0" and state.get("ActiveState") in {"inactive", "failed"} and not state.get("Job") and not state.get("ControlGroup"), "probe_must_be_terminal_not_restarted_or_stopped_blindly")
        group = Path("/sys/fs/cgroup/system.slice") / PROBE_UNIT / "cgroup.procs"
        need(not group.exists() or not group.read_text().split(), "probe_cgroup_must_be_empty")
        return {"terminal": True, "pid": 0, "unit": PROBE_UNIT, "managerLoadState": state.get("LoadState")}


def stable_snapshot(value):
    """Hash identities/static inputs, while reporting changing observations apart."""
    result = json.loads(json.dumps(value)); result.pop("observedAt", None)
    app = result["nativeOld"]["app"]
    result["nativeOld"]["app"] = {key: app[key] for key in ("build_id", "version", "is_dev", "is_locked")}
    for key in ("service", "timer"):
        packet = result["queue"][key]
        state = packet["state"]
        if key == "timer":
            need(state["ActiveState"] == "active" and state["SubState"] in {"waiting", "running", "elapsed"} and state["UnitFileState"] == "enabled", "known_existing_artwork_schedule_required")
        for name in ("MainPID", "InvocationID", "ExecMainStartTimestampMonotonic", "ActiveState", "SubState", "ControlGroup", "Job", "NRestarts"):
            state.pop(name, None)
        packet.pop("argv", None); packet.pop("argvSha256", None)
    return result


class Preparation:
    def __init__(self, host, qualification_file, qualification_sha):
        self.h = host; self.file = qualification_file; self.pin = qualification_sha

    def review(self):
        ref, deployment, q = read_qualification(self.file, self.pin)
        need(not os.path.lexists(BASE) and not os.path.lexists(ROOT) and not os.path.lexists(UNIT_FILE), "fresh_inactive_preparation_required")
        for parent in (Path("/etc/systemd/system"), Path("/run/systemd/system")):
            need(not os.path.lexists(parent / SOURCE) and not os.path.lexists(parent / (SOURCE + ".d")), "no_foreign_fresh_source_definition_allowed")
        self.h.state(SOURCE, absent=True)
        need(self.h.probe_terminal()["managerLoadState"] == "not-found", "fresh_transient_probe_name_required")
        resources = self.h.resources()
        snapshot = self.h.old_snapshot()
        source_state = snapshot["source"]["unit"]["state"]
        need(source_state["UnitFileState"] == "enabled" and source_state["FragmentPath"] == "/etc/systemd/system/" + OLD_SOURCE and not source_state["DropInPaths"], "known_original_launch_definition_required")
        need(source_state.get("WantedBy") == "multi-user.target" and all(not source_state.get(k) for k in ("RequiredBy", "UpheldBy", "Triggers", "TriggeredBy")), "only_original_owned_boot_activation_allowed")
        original = protected(source_state["FragmentPath"])
        need(sha(original) == snapshot["source"]["unit"]["definitionFiles"][source_state["FragmentPath"]]["sha256"], "actual_source_definition_binding_required")
        proposal = self.h.proposal(deployment)
        candidate = source_candidates(original, snapshot["source"]["unit"]["argv"], deployment, proposal)
        current_chain = self.h.chain(deployment)
        need(current_chain["qualification"]["codeHashes"] == q["qualification"]["codeHashes"] and current_chain["qualification"]["transactions"] == q["qualification"]["transactions"], "fresh_actual_chain_identity_or_receipt_changed")
        code = self.h.code_proof()
        independent = self.h.independent()
        need(independent == snapshot["independentActors"]["current"], "independent_actor_changed_during_review")
        need(self.h.observer.actor(self.h.core, OLD_SOURCE) == snapshot["source"]["actor"], "old_source_changed_during_prepare_review")
        binding = {"format": FORMAT, "operatorSha256": sha(protected(Path(__file__).absolute())), "bootId": boot(), "phase": "inactive-prepare-only", "qualification": ref, "snapshot": stable_snapshot(snapshot), "independentActors": independent, "source008": code, "profileProposal": proposal, "indexPolicyAdmitted": False, "sourceUnitSha256": sha(candidate["definition"]), "sourceEnvironmentSha256": sha(candidate["sourceEnv"]), "freshConfigSha256": sha(source_config(deployment, proposal)), "readerEnvironmentSha256": sha(candidate["readerEnv"]), "readerDropinSha256": sha(candidate["drop"])}
        return {"binding": binding, "reviewHash": sha(encoded(binding)), "resources": resources, "sourceOrReaderActions": 0, "databaseWrites": 0, "liveBackendReady": False}, deployment, candidate

    def apply(self, expected):
        reviewed, deployment, candidate = self.review()
        need(reviewed["reviewHash"] == expected, "exact_fresh_prepare_review_required")
        binding = reviewed["binding"]
        BASE.mkdir(mode=0o700); BASE.chmod(0o700); sync(BASE.parent)
        save(BASE / "operation.json", binding)
        self.h.unchanged(binding)
        self.h.chain(deployment)  # Last current contract fence before first write.
        self.h.resources()
        result = self.h.journal.action("prepare-outputs", {"reviewHash": expected, "candidateSha256": binding["sourceUnitSha256"]}, lambda: self.h.prepare_outputs(candidate, deployment, binding["profileProposal"], binding["snapshot"]))
        self.h.probe_terminal(); self.h.unchanged(binding)
        need(self.h.code_proof() == binding["source008"] and self.h.observer.actor(self.h.core, OLD_SOURCE) == binding["snapshot"]["source"]["actor"], "original_source_code_or_actor_changed_during_probe")
        result = {"format": FORMAT, "operatorSha256": binding["operatorSha256"], "operationSha256": sha(protected(BASE / "operation.json")), "reviewHash": expected, "prepared": True, "preparation": result, "sourceUnitInstalled": False, "sourceStarted": False, "oldSourceStopped": False, "APIChanged": False, "queueChanged": False, "databaseWrites": 0, "grantChanges": 0, "indexPolicyAdmitted": False, "originalActorsAndInputsUnchanged": True, "transientOfflineProbeRuns": 1, "liveBackendReady": False}
        save(BASE / "result.json", result)
        return result

    def inspect(self, operation_sha=None):
        raw = protected(BASE / "operation.json"); binding = json.loads(raw)
        need((operation_sha is None or sha(raw) == operation_sha) and binding["format"] == FORMAT and binding["phase"] == "inactive-prepare-only" and binding["bootId"] == boot() and binding["operatorSha256"] == sha(protected(Path(__file__).absolute())), "exact_owned_preparation_required")
        need(binding["qualification"]["file"] == str(self.file) and binding["qualification"]["sha256"] == self.pin, "same_original_qualification_reference_required")
        self.h.state(SOURCE, absent=True); self.h.probe_terminal(); self.h.unchanged(binding)
        need(not os.path.lexists(UNIT_FILE) and self.h.code_proof() == binding["source008"] and self.h.observer.actor(self.h.core, OLD_SOURCE) == binding["snapshot"]["source"]["actor"], "unmodified_original_and_absent_new_source_required")
        result_path = BASE / "result.json"
        result = load(result_path) if result_path.exists() else None
        if result:
            need(result["operationSha256"] == sha(raw) and result["operatorSha256"] == binding["operatorSha256"] and result["prepared"] is True, "owned_prepare_result_required")
            for name, pin in result["preparation"]["publicFilePins"].items(): owned_file(ROOT / name, pin)
        return {"format": FORMAT, "operationSha256": sha(raw), "preparedAcknowledged": result is not None, "partialOrUnknown": result is None, "newSourceAbsent": True, "originalActorsAndInputsUnchanged": True, "resultSha256": sha(protected(result_path)) if result else None, "automaticRetryAllowed": False, "liveBackendReady": False}

    def inverse(self, pin):
        result = self.inspect(pin)
        need(not os.path.lexists(BASE / "inverse-result.json"), "preparation_inverse_already_acknowledged")
        # The only effect so far was an offline namespace probe and NEW private
        # output files. Retain them as audit evidence, never delete source/cache.
        inverse = {**result, "inverse": True, "inactivePreparationRetained": True, "serviceChanges": 0, "databaseWrites": 0, "noOldRuntimeRestartNeeded": True}
        save(BASE / "inverse-result.json", inverse)
        return inverse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qualification-file", required=True); parser.add_argument("--qualification-sha", required=True)
    parser.add_argument("--phase", choices=PHASES, default="prepare")
    modes = parser.add_mutually_exclusive_group(); modes.add_argument("--apply"); modes.add_argument("--inspect", action="store_true"); modes.add_argument("--inverse")
    args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(600)
    host = Host()
    owner = Preparation(host, args.qualification_file, args.qualification_sha)
    value = owner.apply(args.apply) if args.apply else owner.inverse(args.inverse) if args.inverse else owner.inspect() if args.inspect else owner.review()[0]
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "errorClass": type(error).__name__, "fixedCode": str(error) if isinstance(error, RuntimeError) and re.fullmatch("[a-z0-9_]+", str(error)) else "private_diagnostics_withheld", "automaticRetryAllowed": False, "manualReconciliationRequired": True})); raise SystemExit(1)
