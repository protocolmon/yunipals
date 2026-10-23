#!/usr/bin/env python3
"""Review, copy and monitor one bounded Ponder shadow; never run at import time.

This is an operator helper outside the frozen release. It starts only its new
transient unit after exact review-hash approval. All database probes are READ
ONLY, and no provider key/environment file or application worker is loaded.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import stat
import subprocess
import time
import urllib.request
from urllib.parse import parse_qs, unquote, urlparse

SOURCE_DIGEST = "7e7375b029f3d009422f19ea25ed1dd439ebd0cf22f0b95233c258fae1119c27"
SOURCE = Path("/opt/yunipals-unified/releases") / SOURCE_DIGEST
USER = "yunipals_unified_shadow"
SCHEMA = "unified_shadow_20261020_7e7375b0"
BASE = Path("/var/lib/yunipals-unified-shadow")
NODE = "/opt/node-v24.18.1/bin/node"
INVENTORY_SHA = "3e5b50c8d6353b1ff12f7c855af4954ffd9c080b832b1d16e606d33f236a8120"
RUNTIME_HELPER_SHA = "49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4"
PORT = 9024
DEADLINE = 900
INTERVAL = 10
START_FREE = 45_000_000_000
STOP_FREE = 30_000_000_000
SCHEMA_CAP = 8_000_000_000
CACHE_GROWTH_CAP = 6_000_000_000
PROXIES = {1: 19201, 8453: 19202, 137: 19203, 56: 19204}
LEGACY_UNITS = tuple("yunipals-" + name + ".service" for name in [
    "indexer", "bnb", "solana", "islands-indexer", "base-islands-v2", "metadata", "read-cache",
    "islands-metadata", "api", "collector-api", "islands-api", "exomon-preview-api", "leaderboard",
    "market-production-api", "market-production-bnb", "market-production-read@base",
    "market-production-read@ethereum", "market-production-read@polygon", "market-production-rpc@base",
    "market-production-rpc@bnb", "market-production-rpc@ethereum", "market-production-rpc@polygon",
    "market-production-signature", "market-production-stream", "arena-api", "arena-capacity",
    "arena-control", "arena-lobby", "arena-media", "arena-projector", "arena-referee", "arena-settlement"
])
RESOURCE_ENV = {"PONDER_MAX_THREADS": "2", "PONDER_CACHE_BYTES": "134217728", "NODE_OPTIONS": "--max-old-space-size=1536"}
PUBLIC_KEYS = {
    "UNIFIED_BASE_ISLANDS_V2_ENABLED", "UNIFIED_ARENA_DEPLOYMENTS", "MARKET_BNB_DISCOVERY_START_BLOCK",
    "BNB_CONFIRMATIONS", "BOOSTER_REGISTRY", "BOOSTER_ENGINE", "BOOSTER_MONSTERS", "BOOSTER_WRAPPER",
    "BOOSTER_DEPLOYMENT_BLOCK", "UNIFIED_RECEIPT_HISTORY_JSON", "UNIFIED_RPC_POLICY_REQUIRED",
    "UNIFIED_RPC_PROFILE_FILE", "UNIFIED_RPC_PROFILE_ID", "DATABASE_URL", "DATABASE_SCHEMA",
    *(f"PONDER_RPC_URL_{chain}" for chain in PROXIES),
    *(f"UNIFIED_RPC_REPLAY_PERMIT_ID_{chain}" for chain in PROXIES), *RESOURCE_ENV
}
PEER_URL = f"postgresql://{USER}@localhost/yunipals_backfill?host=%2Fvar%2Frun%2Fpostgresql&port=5432"
ROLE_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}


def fail(message):
    raise RuntimeError(message)


def sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(part)
    return value.hexdigest()


def canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def command(argv, *, env=None, cwd=None, timeout=5):
    result = subprocess.run(argv, env=env or ROLE_ENV, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        fail("Bounded operator command failed; raw output suppressed.")
    return result.stdout


def pg(sql, *, market=False, peer=False):
    user = USER if peer else "postgres"
    port, database = (15438, "yunipals_market_production") if market else (5432, "yunipals_backfill")
    text = command(["runuser", "-u", user, "--", "/usr/bin/psql", "-X", "-qAt", "-h", "/var/run/postgresql",
                    "-p", str(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
                    "BEGIN READ ONLY; SET LOCAL statement_timeout='3s'; " + sql + "; COMMIT"], timeout=5)
    return json.loads(text)


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def public_env(text):
    values = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator != "=" or key not in PUBLIC_KEYS or key in values:
            fail("Unknown/duplicate public shadow environment key.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if any(char in value for char in "\x00\r\n"):
            fail("Invalid public environment value.")
        values[key] = value
    for chain, port in PROXIES.items():
        if values.get(f"PONDER_RPC_URL_{chain}") != f"http://127.0.0.1:{port}/unified":
            fail("Every source RPC must use the exact isolated loopback proxy path.")
        if not re.fullmatch(r"0x[0-9a-f]{64}", values.get(f"UNIFIED_RPC_REPLAY_PERMIT_ID_{chain}", "")):
            fail("Four exact per-chain bounded permits are required.")
    if values.get("UNIFIED_RPC_POLICY_REQUIRED") != "true":
        fail("The reviewed RPC policy cannot be disabled.")
    for key, expected in RESOURCE_ENV.items():
        if key in values and values[key] != expected:
            fail("Shadow resources cannot differ from their fixed limits.")
    peer = urlparse(values.get("DATABASE_URL", PEER_URL))
    query = parse_qs(peer.query)
    if (peer.scheme not in {"postgres", "postgresql"} or peer.password is not None or
            (peer.username or query.get("user", [""])[0]) != USER or peer.path != "/yunipals_backfill" or
            query.get("host", [unquote(peer.hostname or "")])[0] != "/var/run/postgresql" or
            str(query.get("port", [peer.port or 5432])[0]) != "5432" or
            set(query) - {"host", "port", "user", "application_name"} or
            any(len(values) != 1 for values in query.values()) or values.get("DATABASE_SCHEMA", SCHEMA) != SCHEMA):
        fail("Shadow peer database/schema cannot be overridden.")
    values.update(DATABASE_URL=PEER_URL, DATABASE_SCHEMA=SCHEMA)
    if query.get("user", [USER])[0] != USER:
        fail("Peer query cannot select another database role.")
    return values


def service_states(units):
    result = subprocess.run(["systemctl", "show", *units, "--property=Id,LoadState,ActiveState,SubState,InvocationID"],
                            env=ROLE_ENV, capture_output=True, text=True, timeout=4)
    if result.returncode not in {0, 1}:
        fail("Service state query failed.")
    text = result.stdout
    rows = {}
    for block in text.strip().split("\n\n"):
        row = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        if row.get("Id") in units:
            rows[row["Id"]] = row
    if set(rows) != set(units):
        fail("Incomplete service-state observation.")
    return rows


def own_state(unit):
    result = subprocess.run(["systemctl", "show", unit,
                             "--property=Id,LoadState,ActiveState,SubState,InvocationID,Description,MemoryCurrent,MemoryPeak,CPUUsageNSec,ExecMainStatus,Result"],
                            env=ROLE_ENV, capture_output=True, text=True, timeout=4)
    row = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if result.returncode not in {0, 1} or row.get("Id") != unit or "LoadState" not in row:
        fail("Own unit state query failed.")
    return row


def http_json(port, path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}{path}", timeout=1.5) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        fail("Oversized local proxy metric response.")
    return json.loads(data)


def proxy_observation():
    def one(item):
        chain, port = item
        health = http_json(port, "/health")
        if health.get("status") != "ready":
            fail("Legacy proxy health is unavailable.")
        metrics = http_json(port, "/metrics")
        unified = metrics.get("unified")
        return str(chain), {"health": "ready", "observedHead": metrics.get("observedHead"),
                            "traffic": metrics.get("traffic"), "unified": unified,
                            "workloadBudgets": {key: metrics.get("workloadBudgets", {}).get(key)
                                                for key in ["unified_source", "unified_evidence"]}}
    with ThreadPoolExecutor(max_workers=4) as pool:
        return dict(pool.map(one, PROXIES.items()))


def validate_proxies(proxies, identity):
    for chain, value in proxies.items():
        if value["unified"] is None or value["unified"].get("profileId") != identity["profileId"] or value["unified"].get("chainId") != int(chain):
            fail("An existing proxy has not activated this isolated profile.")


def peer_acl():
    value = pg(f"""SELECT jsonb_build_object('sessionUser',session_user,'currentUser',current_user,
      'role',(SELECT jsonb_build_object('super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,
        'replication',rolreplication,'bypassRls',rolbypassrls) FROM pg_roles WHERE rolname=current_user),
      'sourceOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname={literal(SCHEMA)}),
      'schemaCreate',has_schema_privilege(current_user,{literal(SCHEMA)},'CREATE'),
      'databaseSchemaCreate',has_database_privilege(current_user,current_database(),'CREATE'),
      'cacheUsage',has_schema_privilege(current_user,'ponder_sync','USAGE'),
      'cacheCreate',has_schema_privilege(current_user,'ponder_sync','CREATE'),
      'legacyOwnerInherited',pg_has_role(current_user,'yunipals','USAGE'),
      'dataDml',(SELECT count(*)=36 AND bool_and(has_table_privilege(current_user,c.oid,privilege))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege WHERE n.nspname='ponder_sync'
        AND c.relname IN('blocks','transactions','logs','intervals','traces','transaction_receipts','rpc_request_results','factories','factory_addresses')),
      'migrationReads',(SELECT count(*)=2 AND bool_and(has_table_privilege(current_user,c.oid,'SELECT'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync' AND c.relname IN('kysely_migration','kysely_migration_lock')),
      'migrationWrites',(SELECT bool_or(has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync' AND c.relname IN('kysely_migration','kysely_migration_lock')),
      'sequences',(SELECT count(*)=2 AND bool_and(has_sequence_privilege(current_user,c.oid,'USAGE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ponder_sync' AND c.relname IN('factories_id_seq','factory_addresses_id_seq')),
      'otherPublicReads',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT ILIKE '%solana%' AND n.nspname NOT IN('information_schema','ponder_sync',{literal(SCHEMA)})
        AND c.relkind IN('r','p','v','m') AND has_table_privilege(current_user,c.oid,'SELECT'))
      )""", peer=True)
    validate_acl(value)
    return value


def validate_acl(value):
    if (value["sessionUser"] != USER or value["currentUser"] != USER or value["sourceOwner"] != USER or
            any(value["role"].values()) or not all(value[key] for key in ["schemaCreate", "databaseSchemaCreate", "cacheUsage", "dataDml", "migrationReads", "sequences"]) or
            any(value[key] for key in ["cacheCreate", "legacyOwnerInherited", "migrationWrites", "otherPublicReads"])):
        fail("Restricted peer/source/cache privilege prerequisite failed.")


def policy_snapshot(env, profile):
    ids = ",".join(literal(env[f"UNIFIED_RPC_REPLAY_PERMIT_ID_{chain}"]) for chain in PROXIES)
    value = pg(f"""SELECT jsonb_build_object(
      'profile',(SELECT jsonb_build_object('id',profile_id,'enabled',enabled,'unexpired',expires_at>clock_timestamp(),
         'expiry',expires_at::text,'policyMatches',policy={literal(json.dumps(profile))}::jsonb)
         FROM yunipals_market.unified_rpc_profile WHERE profile_id={literal(env['UNIFIED_RPC_PROFILE_ID'])}),
      'budget',(SELECT jsonb_build_object('daily',daily_cu,'reserve',foreground_reserve_cu,'enabled',enabled)
         FROM yunipals_market.rpc_compute_budget WHERE scope={literal(profile['scope'])}),
      'allocations',(SELECT jsonb_agg(jsonb_build_object('workload',workload,'daily',daily_cu,'priority',priority) ORDER BY workload)
         FROM yunipals_market.rpc_compute_allocation WHERE scope={literal(profile['scope'])} AND workload IN('unified_source','unified_evidence')),
      'permits',(SELECT jsonb_agg(jsonb_build_object('id',permit_id,'chain',chain_id,'profile',profile_id,'from',from_block::text,
         'through',through_block::text,'maximum',maximum_cu,'spent',spent_cu,'enabled',enabled,'unexpired',expires_at>clock_timestamp(),'expiry',expires_at::text) ORDER BY chain_id)
         FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN({ids}))
      )""", market=True)
    validate_policy(value, env, profile)
    return value


def validate_policy(value, env, profile):
    row = value.get("profile") or {}
    budget = value.get("budget") or {}
    allocations = {x["workload"]: x for x in value.get("allocations") or []}
    if (row.get("id") != env["UNIFIED_RPC_PROFILE_ID"] or not all(row.get(key) for key in ["enabled", "unexpired", "policyMatches"]) or
            budget != {"daily": 1_000_000, "reserve": 200_000, "enabled": True}):
        fail("Exact enabled profile/global budget prerequisite failed.")
    for key, cap in [("unified_source", 25_000), ("unified_evidence", 5_000)]:
        allocation = allocations.get(key) or {}
        if allocation.get("priority") != "background" or not 0 < allocation.get("daily", 0) <= cap:
            fail("Bounded background allocation prerequisite failed.")
    permits = value.get("permits") or []
    if {x["chain"] for x in permits} != set(PROXIES) or len(permits) != 4:
        fail("Four reviewed permits are required.")
    for permit in permits:
        minimum = min(int(x["startBlock"]) for x in profile["manifest"]["sources"] if x["enabled"] and x["chainId"] == permit["chain"])
        if (permit["id"] != env[f"UNIFIED_RPC_REPLAY_PERMIT_ID_{permit['chain']}"] or permit["profile"] != env["UNIFIED_RPC_PROFILE_ID"] or
                not permit["enabled"] or not permit["unexpired"] or not 0 < permit["maximum"] <= 5000 or
                not 0 <= permit["spent"] < permit["maximum"] or int(permit["from"]) > minimum or int(permit["through"]) < minimum):
            fail("Bounded historical permit prerequisite failed.")


def policy_binding(policy):
    value = json.loads(json.dumps(policy))
    for permit in value["permits"]:
        permit.pop("spent")
        permit.pop("unexpired")
    value["profile"].pop("unexpired")
    return value


def active_selector():
    exists = pg("SELECT to_json(to_regclass('yunipals_indexer_control.active_release') IS NOT NULL)")
    if not exists:
        return []
    return pg("SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'release',release_id,'epoch',epoch) ORDER BY name),'[]'::jsonb) FROM yunipals_indexer_control.active_release")


def source_metrics():
    value = pg(f"""SELECT jsonb_build_object(
       'schemaBytes',coalesce(sum(pg_total_relation_size(c.oid)) FILTER(WHERE n.nspname={literal(SCHEMA)}),0),
       'cacheBytes',coalesce(sum(pg_total_relation_size(c.oid)) FILTER(WHERE n.nspname='ponder_sync'),0),
       'sourceRelations',count(*) FILTER(WHERE n.nspname={literal(SCHEMA)}),
       'metaExists',to_regclass('{SCHEMA}._ponder_meta') IS NOT NULL,
       'checkpointsExist',to_regclass('{SCHEMA}._ponder_checkpoint') IS NOT NULL)
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','m','S') AND n.nspname IN('ponder_sync',{literal(SCHEMA)})""")
    if value.pop("metaExists"):
        value["runtime"] = pg(f"SELECT (SELECT jsonb_build_object('buildId',value->>'build_id','ready',value->'is_ready','heartbeat',value->'heartbeat_at') FROM {SCHEMA}._ponder_meta WHERE key='app')")
    if value.pop("checkpointsExist"):
        value["checkpoints"] = pg(f"SELECT coalesce(jsonb_agg(jsonb_build_object('chain',chain_id,'latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint) ORDER BY chain_id),'[]'::jsonb) FROM {SCHEMA}._ponder_checkpoint")
    return value


def load_plan(path):
    plan = json.loads(Path(path).read_text())
    if set(plan) != {"format", "runId", "inventoryFile", "runtimeHelper", "publicEnvFile", "profileFile"} or plan["format"] != "yunipals-bounded-shadow-v1":
        fail("Unknown bounded shadow plan fields.")
    if not re.fullmatch(r"20261020-7e7375b0-[a-z0-9]{1,16}", plan["runId"]):
        fail("Invalid unique shadow run ID.")
    for key in ["inventoryFile", "runtimeHelper", "publicEnvFile", "profileFile"]:
        if not Path(plan[key]).is_absolute() or Path(plan[key]).is_symlink():
            fail("Use absolute regular reviewed input paths.")
    return plan


def frozen_runtime(plan):
    if sha(plan["runtimeHelper"]) != RUNTIME_HELPER_SHA or sha(plan["inventoryFile"]) != INVENTORY_SHA:
        fail("Runtime helper/inventory pins differ.")
    spec = importlib.util.spec_from_file_location("pinned_runtime_supplement", plan["runtimeHelper"])
    helper = importlib.util.module_from_spec(spec)
    # Avoid writing a Python cache into either immutable source or helper directory.
    import sys
    sys.dont_write_bytecode = True
    spec.loader.exec_module(helper)
    manifest = helper.source_check(SOURCE, SOURCE_DIGEST)
    inventory = json.loads(Path(plan["inventoryFile"]).read_text())
    helper.platform_check(NODE, inventory["runtime"])
    if inventory["sourceDigest"] != SOURCE_DIGEST:
        fail("Runtime supplement selects another source.")
    for row in inventory["entries"]:
        if not helper.allowed(row["path"]):
            fail("Runtime inventory escapes its allowlist.")
        path = SOURCE / row["path"]
        mode = stat.S_IMODE(path.lstat().st_mode)
        if row["type"] == "file":
            helper.plain_ancestors(SOURCE, row["path"])
            if not path.is_file() or mode != row["mode"] or path.stat().st_size != row["bytes"] or sha(path) != row["sha256"]:
                fail("Installed runtime file differs from pin.")
        elif row["type"] == "directory":
            helper.plain_ancestors(SOURCE, row["path"])
            if not path.is_dir() or mode != row["mode"]:
                fail("Installed runtime directory differs.")
        elif not path.is_symlink() or os.readlink(path) != row["target"] or not path.resolve(strict=True).is_relative_to(SOURCE):
            fail("Installed runtime link differs/leaves source.")
    installed_ids = pg("SELECT jsonb_agg(name ORDER BY name) FROM ponder_sync.kysely_migration", peer=True)
    expected_ids = sorted(re.findall(r'^\s*["\'](\d{4}_\d{1,2}_\d{1,2}_[^"\']+)["\']\s*:',
                                    (SOURCE / 'apps/yunipals-indexer/node_modules/ponder/src/sync-store/migrations.ts').read_text(), re.M))
    if installed_ids != expected_ids:
        fail("Shared cache migration identity changed.")
    return helper, manifest, inventory


def native_profile(env):
    code = """import {readFileSync} from 'node:fs';
      import {buildSourceManifest,sourceManifestHash} from './lib/unified/sources.ts';
      import {validateUnifiedRpcProfile,unifiedRpcProfileId,unifiedRpcManifestId} from '../../packages/yunipals-indexer-server/src/rpc-policy.ts';
      const p=validateUnifiedRpcProfile(JSON.parse(readFileSync(process.env.UNIFIED_RPC_PROFILE_FILE,'utf8')));
      const id=unifiedRpcProfileId(p);if(id!==process.env.UNIFIED_RPC_PROFILE_ID||unifiedRpcManifestId(p)!==sourceManifestHash(buildSourceManifest()))throw Error('profile mismatch');
      if(!p.manifest.sources.every(s=>s.enabled))throw Error('all sources must be enabled');
      console.log(JSON.stringify({profileId:id,manifestHash:unifiedRpcManifestId(p)}));"""
    return json.loads(command([NODE, "--import", "tsx", "--input-type=module", "-e", code],
                              env={**ROLE_ENV, **env}, cwd=SOURCE / "apps/yunipals-indexer", timeout=15))


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", PORT))


def review(plan):
    helper, manifest, inventory = frozen_runtime(plan)
    env = public_env(Path(plan["publicEnvFile"]).read_text())
    if env.get("UNIFIED_RPC_PROFILE_FILE") != plan["profileFile"]:
        fail("Public environment/profile path differs.")
    profile = json.loads(Path(plan["profileFile"]).read_text())
    identity = native_profile(env)
    peer = peer_acl()
    policy = policy_snapshot(env, profile)
    baseline = service_states(LEGACY_UNITS)
    proxies = proxy_observation()
    validate_proxies(proxies, identity)
    free_port()
    existing = service_states((unit_name(plan),))[unit_name(plan)]
    if existing["LoadState"] != "not-found":
        fail("Use a fresh transient shadow unit name.")
    workspace = BASE / plan["runId"]
    if workspace.exists() or workspace.is_symlink():
        fail("Use a fresh workspace; never overwrite retained shadow state.")
    free = shutil.disk_usage(SOURCE).free
    if free < START_FREE:
        fail("At least45GB free space is required before shadow preparation.")
    state = source_metrics()
    if state["sourceRelations"] != 0:
        fail("Initial shadow requires its fresh empty schema; retained state is never reset.")
    binding = {"plan": plan, "source": SOURCE_DIGEST, "runtimeInventory": INVENTORY_SHA,
               "publicEnvSha256": sha(plan["publicEnvFile"]), "profileSha256": sha(plan["profileFile"]),
               "identity": identity, "peer": peer, "policy": policy_binding(policy), "legacyUnits": baseline,
               "activeSelector": active_selector(), "limits": resource_limits()}
    return {"hash": canonical(binding), "binding": binding, "freeBytes": free, "metrics": state,
            "proxies": proxies}, (helper, manifest, inventory, env, profile)


def resource_limits():
    return {"seconds": DEADLINE, "memoryBytes": 2_147_483_648, "cpuQuota": "100%", "ioWeight": 10,
            "threads": 2, "cacheBytes": 134_217_728, "heapMb": 1536, "port": PORT,
            "startFreeBytes": START_FREE, "stopFreeBytes": STOP_FREE, "schemaCapBytes": SCHEMA_CAP,
            "cacheGrowthCapBytes": CACHE_GROWTH_CAP, "intervalSeconds": INTERVAL}


def unit_name(plan):
    return "yunipals-unified-shadow-" + plan["runId"] + ".service"


def copy_workspace(plan, manifest, inventory, env):
    account = pwd.getpwnam(USER)
    BASE.mkdir(mode=0o750, parents=True, exist_ok=True)
    if BASE.is_symlink() or BASE.stat().st_uid != 0:
        fail("Workspace base must be root-owned and real.")
    os.chown(BASE, 0, account.pw_gid)
    base = BASE / plan["runId"]
    base.mkdir(mode=0o750)
    os.chown(base, 0, account.pw_gid)
    files = [*manifest["files"], {"path": "RELEASE-MANIFEST.json"}, {"path": "SHA256SUMS"}]
    files.extend(x for x in inventory["entries"] if x["type"] == "file")
    for row in files:
        source, target = SOURCE / row["path"], base / row["path"]
        target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        with source.open("rb") as incoming, target.open("xb") as outgoing:
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
        if source.stat().st_ino == target.stat().st_ino and source.stat().st_dev == target.stat().st_dev:
            fail("Workspace files must never hardlink immutable source.")
        if sha(source) != sha(target):
            fail("Workspace copy checksum differs.")
        if row.get("sha256") and sha(target) != row["sha256"]:
            fail("Workspace input changed from its frozen pin.")
        target.chmod(0o750 if source.stat().st_mode & 0o111 else 0o640)
        os.chown(target, 0, account.pw_gid)
    for row in inventory["entries"]:
        if row["type"] == "directory":
            (base / row["path"]).mkdir(mode=0o750, parents=True, exist_ok=True)
        elif row["type"] == "symlink":
            path = base / row["path"]
            path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
            path.symlink_to(row["target"])
    for directory, children, _ in os.walk(base, followlinks=False):
        path = Path(directory)
        path.chmod(0o750)
        os.chown(path, 0, account.pw_gid)
    for row in inventory["entries"]:
        if row["type"] == "symlink" and not (base / row["path"]).resolve(strict=True).is_relative_to(base):
            fail("Workspace relative link leaves its verified copy.")
    project = base / "apps/yunipals-indexer"
    state = project / ".ponder"
    state.mkdir(mode=0o700)
    os.chown(state, account.pw_uid, account.pw_gid)
    declaration = project / "ponder-env.d.ts"
    os.chown(declaration, account.pw_uid, account.pw_gid)
    declaration.chmod(0o640)
    copied_profile = base / "rpc-profile.json"
    shutil.copyfile(plan["profileFile"], copied_profile)
    copied_profile.chmod(0o640)
    os.chown(copied_profile, 0, account.pw_gid)
    launch = {**env, **RESOURCE_ENV, "UNIFIED_RPC_PROFILE_FILE": str(copied_profile),
              "HOME": str(state), "TMPDIR": "/tmp", "PATH": "/opt/node-v24.18.1/bin:/usr/bin:/bin"}
    env_file = base / "launch.env"
    env_file.write_text("".join(f"{key}={value}\n" for key, value in sorted(launch.items())))
    env_file.chmod(0o640)
    os.chown(env_file, 0, account.pw_gid)
    return base, project, env_file


def workspace_access(base):
    code = r'''import json,os,pathlib,stat,sys
r=pathlib.Path(sys.argv[1]); allowed={r/'apps/yunipals-indexer/.ponder',r/'apps/yunipals-indexer/ponder-env.d.ts'}
files=0
for directory,dirs,names in os.walk(r,followlinks=False):
 p=pathlib.Path(directory)
 if os.access(p,os.W_OK) and p not in allowed:raise RuntimeError('unexpected writable directory')
 for name in names:
  q=p/name
  if q.is_symlink():
   if not q.resolve(strict=True).is_relative_to(r):raise RuntimeError('link escape')
   continue
  files+=1
  if not os.access(q,os.R_OK):raise RuntimeError('unreadable runtime file')
  if os.access(q,os.W_OK) and q not in allowed:raise RuntimeError('unexpected writable file')
for q in allowed:
 if not os.access(q,os.W_OK):raise RuntimeError('required codegen path unwritable')
print(json.dumps({'readableFiles':files,'onlyRequiredCodegenPathsWritable':True}))'''
    return json.loads(command(["runuser", "-u", USER, "--", "/usr/bin/python3", "-c", code, str(base)], timeout=20))


def systemd_start(plan, project, env_file, marker):
    unit = unit_name(plan)
    properties = {"User": USER, "Group": USER, "WorkingDirectory": str(project), "RuntimeMaxSec": "900",
                  "MemoryMax": "2147483648", "MemorySwapMax": "0", "CPUQuota": "100%", "IOWeight": "10",
                  "Restart": "no", "TimeoutStopSec": "30", "KillMode": "control-group", "TasksMax": "128",
                  "NoNewPrivileges": "yes", "PrivateTmp": "yes", "ProtectSystem": "strict", "ProtectHome": "yes",
                  "RestrictSUIDSGID": "yes", "UMask": "0027", "IPAddressDeny": "any", "IPAddressAllow": "127.0.0.0/8 ::1",
                  "ReadWritePaths": str(project / ".ponder") + " " + str(project / "ponder-env.d.ts")}
    argv = ["systemd-run", "--unit=" + unit, "--description=Yunipals bounded shadow " + marker]
    argv.extend("--property=" + key + "=" + value for key, value in properties.items())
    argv.extend(["/usr/bin/env", "-i", NODE, "--env-file=" + str(env_file),
                 str(project / "node_modules/ponder/dist/esm/bin/ponder.js"), "start", "--schema", SCHEMA,
                 "--hostname", "127.0.0.1", "--port", str(PORT)])
    command(argv, timeout=10)
    own = own_state(unit)
    if not own.get("InvocationID"):
        fail("New shadow invocation identity is unavailable.")
    return own["InvocationID"]


def stop_reason(sample, baseline, initial_cache, elapsed):
    if elapsed >= DEADLINE:
        return "deadline"
    if sample["freeBytes"] < STOP_FREE:
        return "disk_reserve"
    if sample["metrics"]["schemaBytes"] > SCHEMA_CAP:
        return "schema_cap"
    if sample["metrics"]["cacheBytes"] - initial_cache > CACHE_GROWTH_CAP:
        return "cache_growth_cap"
    if sample["legacyUnits"] != baseline["binding"]["legacyUnits"]:
        return "legacy_service_changed"
    if sample["activeSelector"] != baseline["binding"]["activeSelector"]:
        return "active_selector_changed"
    return None


def stop_owned(unit, invocation, marker):
    current = own_state(unit)
    if current["LoadState"] == "not-found" or current["ActiveState"] in {"inactive", "failed"}:
        return
    if ((invocation is not None and current["InvocationID"] != invocation) or
            current.get("Description") != "Yunipals bounded shadow " + marker):
        fail("Refusing to stop a unit with another invocation identity.")
    command(["systemctl", "stop", unit], timeout=35)


def emit(path, event):
    data = {"at": datetime.now(timezone.utc).isoformat(), **event}
    with path.open("a") as handle:
        handle.write(json.dumps(data, separators=(",", ":")) + "\n")
    print(json.dumps(data, separators=(",", ":")), flush=True)


def apply(plan, expected):
    with open("/run/lock/yunipals-unified-shadow.lock", "a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline, prepared = review(plan)
        if baseline["hash"] != expected:
            fail("Review identity changed; inspect current prerequisites again.")
        helper, manifest, inventory, env, profile = prepared
        base, project, env_file = copy_workspace(plan, manifest, inventory, env)
        access = workspace_access(base)
        helper.source_check(SOURCE, SOURCE_DIGEST)
        if service_states(LEGACY_UNITS) != baseline["binding"]["legacyUnits"] or active_selector() != baseline["binding"]["activeSelector"]:
            fail("Legacy source/services changed during workspace preparation.")
        peer_acl()
        if policy_binding(policy_snapshot(env, profile)) != baseline["binding"]["policy"]:
            fail("Reviewed policy identity changed during copying.")
        if sha(plan["publicEnvFile"]) != baseline["binding"]["publicEnvSha256"] or sha(base / "rpc-profile.json") != baseline["binding"]["profileSha256"]:
            fail("Reviewed public input changed during copying.")
        if shutil.disk_usage(SOURCE).free < START_FREE:
            fail("Free-space start prerequisite changed during copying.")
        free_port()
        # The actual guarded native preflight makes only its existing four free
        # chain checks; there is no historical probe and no provider key loaded.
        command(["runuser", "-u", USER, "--", "/usr/bin/env", "-i", NODE, "--env-file=" + str(env_file),
                 "--import", "tsx", "scripts/unified-rpc-preflight.ts"], cwd=project, timeout=60)
        log = base / "monitor.jsonl"
        started = time.monotonic()
        invocation = None
        reason = "monitor_error"
        try:
            invocation = systemd_start(plan, project, env_file, expected)
            emit(log, {"event": "started", "reviewHash": expected, "unit": unit_name(plan), "invocation": invocation,
                       "limits": resource_limits(), "baselineMetrics": baseline["metrics"], "workspaceAccess": access,
                       "baselineLegacyUnits": baseline["binding"]["legacyUnits"], "baselineActiveSelector": baseline["binding"]["activeSelector"]})
            while True:
                tick = time.monotonic()
                signal.setitimer(signal.ITIMER_REAL, 15)
                try:
                    own = own_state(unit_name(plan))
                    sample = {"freeBytes": shutil.disk_usage(SOURCE).free, "metrics": source_metrics(),
                              "legacyUnits": service_states(LEGACY_UNITS), "activeSelector": active_selector(),
                              "proxies": proxy_observation(), "policy": policy_snapshot(env, profile)}
                    validate_proxies(sample["proxies"], baseline["binding"]["identity"])
                    if policy_binding(sample["policy"]) != baseline["binding"]["policy"]:
                        fail("Reviewed policy identity changed during the shadow.")
                finally:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                emit(log, {"event": "sample", "elapsed": round(tick - started, 2), "own": own, **sample})
                reason = stop_reason(sample, baseline, baseline["metrics"]["cacheBytes"], time.monotonic() - started)
                if reason:
                    break
                if own["ActiveState"] in {"inactive", "failed"}:
                    reason = "shadow_exited"
                    break
                if own["InvocationID"] != invocation:
                    reason = "shadow_invocation_changed"
                    break
                time.sleep(max(0, INTERVAL - (time.monotonic() - tick)))
        except (KeyboardInterrupt, SystemExit):
            reason = "operator_interrupt"
        except Exception as error:
            reason = "monitor_prerequisite_unavailable"
            emit(log, {"event": "monitor_guard_failed", "errorClass": type(error).__name__})
        finally:
            stop_error = None
            try:
                stop_owned(unit_name(plan), invocation, expected)
            except Exception as error:
                stop_error = type(error).__name__
            after = {}
            for key, collect in [("legacyUnits", lambda: service_states(LEGACY_UNITS)), ("activeSelector", active_selector),
                                 ("proxies", proxy_observation), ("metrics", source_metrics)]:
                try:
                    after[key] = collect()
                except Exception as error:
                    after[key] = {"unavailable": type(error).__name__}
            emit(log, {"event": "stopped", "reason": reason, "elapsed": round(time.monotonic() - started, 2),
                       "retainedWorkspace": str(base), "retainedSchema": SCHEMA, "stopError": stop_error, "after": after})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--apply")
    args = parser.parse_args()
    if os.getuid() != 0 or socket.gethostname() != "yunipals-main":
        fail("This operator helper targets root on yunipals-main only.")
    plan = load_plan(args.plan)
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply):
            fail("An exact prior review hash is required.")
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit()))
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        apply(plan, args.apply)
    else:
        result, _ = review(plan)
        print(json.dumps({"reviewHash": result["hash"], "binding": result["binding"], "freeBytes": result["freeBytes"],
                          "metrics": result["metrics"], "started": False}, indent=2))


if __name__ == "__main__":
    main()
