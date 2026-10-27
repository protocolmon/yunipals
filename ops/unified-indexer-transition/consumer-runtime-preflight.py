#!/usr/bin/env python3
"""Fixed, read-only preparation checks for the frozen9ee consumer artifact.

No installation, role/grant changes, application-row reads, APIs or providers.
A passing preparation report is never source acceptance or cutover approval.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import grp
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import socket
import stat
import subprocess

SOURCE = "9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d"
ROOT = Path("/opt/yunipals-unified/releases") / SOURCE
NODE = "/opt/node-v24.18.1/bin/node"
MATRIX_SHA = "30e8781c3d3f2c1b82b9b7724974ac530e05be3eddcbaa35ac7a9936987a13b2"
MANIFEST_SHA = "5e06ff4b9d86859814f1fd1d2b24d1db38278eec75a7c2cefcdd3689103f27e0"
INVENTORY = Path("/var/tmp/yunipals-runtime-9ee6beaf-20261021/runtime-supplement.inventory.json")
INVENTORY_SHA = "9709e298a19ecafd1021a9e49de6ddafbbc85eb5e10e9b1801cddb133859622e"
ARCHIVE_SHA = "a71a8393365b86974875fb98fdfb26a717de27189b65234c06a21f5f54e715c2"
SCHEMA = "unified_shadow_20261020_7e7375b0"
READ_SCHEMA = "yunipals_ownership_35cdcb32_v3"
CONTROL = "yunipals_indexer_control"
DATABASE = "yunipals_backfill"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
MATRIX = OPS / "ownership-consumer-preparation-v2-2026-10-21.json"
ENTRYPOINTS = {"yunipals-api.service": "lib/api/server.ts", "yunipals-collector-api.service": "lib/api/collector-server.ts",
              "yunipals-read-cache.service": "lib/metadata/read-cache-worker.ts", "yunipals-islands-api.service": "lib/api/islands-server.ts"}
ROLES = ("yunipals_unified_api", "yunipals_unified_collector", "yunipals_unified_read_cache", "yunipals_unified_islands_api")
PREVIEW_PORTS = {"yunipals-api.service": 9101, "yunipals-collector-api.service": 9112, "yunipals-islands-api.service": 9115}
LIVE_PORTS = {"yunipals-api.service": 9011, "yunipals-collector-api.service": 9012, "yunipals-islands-api.service": 9015}
STATE_KEYS = ["User", "Group", "WorkingDirectory", "ActiveState", "SubState", "MainPID", "InvocationID", "ExecStart", "EnvironmentFiles"]
PHASE = "preparation"


def encoded(value): return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
def digest(raw): return hashlib.sha256(raw).hexdigest()


def protected(path, maximum=40000000):
    path = Path(path)
    if not path.is_absolute(): raise RuntimeError("Absolute public input required.")
    for item in [*path.parents, path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not (stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX)):
            raise RuntimeError("Public input protection differs.")
    if not path.is_file() or path.stat().st_size > maximum: raise RuntimeError("Bounded public file required.")
    return path.read_bytes()


def clean(): return {"PATH": "/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}


def run(args, *, data=None, timeout=15, cwd=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True, env=clean(), timeout=timeout, cwd=cwd)
    if result.returncode: raise RuntimeError("Read-only preparation command failed; diagnostics withheld.")
    if len(result.stdout.encode()) > 2000000: raise RuntimeError("Preparation output cap exceeded.")
    return result.stdout.strip()


def matrix():
    raw = protected(MATRIX, 100000)
    if digest(raw) != MATRIX_SHA: raise RuntimeError("Pinned consumer matrix changed.")
    value = json.loads(raw)
    if ({row["unit"] for row in value["services"]} != set(ENTRYPOINTS) or value["consumer"]["sourceDigest"] != SOURCE or
            value["installable"] is not False or value["sourceAcceptance"]["verified"] is not False):
        raise RuntimeError("Exact unaccepted four-consumer matrix required.")
    return value


def runtime():
    if not ROOT.exists() or not INVENTORY.exists(): return {"verified": False, "reason": "candidate_source_or_inventory_missing"}
    raw = protected(INVENTORY)
    if digest(raw) != INVENTORY_SHA or digest(protected(ROOT / "RELEASE-MANIFEST.json")) != MANIFEST_SHA:
        raise RuntimeError("Installed9ee manifest/inventory differs.")
    inventory = json.loads(raw)
    if (inventory["sourceDigest"] != SOURCE or inventory["archiveSha256"] != ARCHIVE_SHA or
            inventory.get("sourceManifestSha256") != MANIFEST_SHA or inventory["runtime"]["node"] != "24.18.1"):
        raise RuntimeError("Installed9ee runtime identity differs.")
    run([NODE, str(ROOT / "ops/unified-indexer/prepare-release.mjs"), "--verify", str(ROOT)], timeout=90)
    actual = json.loads(run([NODE, "-p", "JSON.stringify({node:process.versions.node,platform:process.platform,arch:process.arch,modules:process.versions.modules,napi:process.versions.napi})"]))
    actual["libc"] = list(platform.libc_ver())
    if actual != inventory["runtime"]: raise RuntimeError("Consumer runtime platform differs.")
    publicly_readable = all(item.stat().st_mode & 0o001 for item in [ROOT, *ROOT.parents])
    for row in inventory["entries"]:
        relative = Path(row["path"])
        if relative.is_absolute() or ".." in relative.parts: raise RuntimeError("Runtime path leaves9ee.")
        path = ROOT / relative; info = path.lstat()
        if info.st_uid != 0 or (row["type"] != "symlink" and (stat.S_IMODE(info.st_mode) != row["mode"] or info.st_mode & 0o7022)):
            raise RuntimeError("Runtime ownership/mode changed.")
        if not path.resolve(strict=True).is_relative_to(ROOT): raise RuntimeError("Runtime link leaves9ee.")
        if row["type"] != "symlink":
            publicly_readable = publicly_readable and bool(info.st_mode & 0o004) and (row["type"] != "directory" or bool(info.st_mode & 0o001))
        if row["type"] == "symlink":
            if not stat.S_ISLNK(info.st_mode) or os.readlink(path) != row["target"]: raise RuntimeError("Runtime link changed.")
        elif row["type"] == "directory":
            if not stat.S_ISDIR(info.st_mode): raise RuntimeError("Runtime directory changed.")
        elif row["type"] != "file" or not stat.S_ISREG(info.st_mode) or info.st_size != row["bytes"] or digest(path.read_bytes()) != row["sha256"]:
            raise RuntimeError("Runtime file changed.")
    return {"verified": True, "sourceDigest": SOURCE, "manifestSha256": MANIFEST_SHA, "inventorySha256": INVENTORY_SHA,
            "runtimeArchiveSha256": ARCHIVE_SHA, "entries": len(inventory["entries"]), "applicationCodeExecuted": False, "publicRuntimeReadableAndTraversable": bool(publicly_readable)}


def state(unit):
    if unit not in ENTRYPOINTS: raise ValueError("Unapproved consumer unit.")
    raw = run(["/usr/bin/systemctl", "show", unit, *["--property=" + key for key in STATE_KEYS]])
    props = {}; envfiles = []
    for line in raw.splitlines():
        key, sep, value = line.partition("=")
        if not sep or key not in STATE_KEYS: continue
        if key == "EnvironmentFiles": envfiles.append(value)
        elif key in props: raise RuntimeError("Repeated consumer property.")
        else: props[key] = value
    if set(props) != set(STATE_KEYS) - {"EnvironmentFiles"}: raise RuntimeError("Incomplete consumer public state.")
    props["EnvironmentFilesEntries"] = envfiles
    return props


def public_unit(row, props):
    unit = row["unit"]; observed = row["observed"]; proposed = row["proposed"]
    expected = observed["execStartPublicTokens"]
    candidate = [NODE, "--import", "tsx", str(ROOT / "apps/yunipals-indexer" / ENTRYPOINTS[unit])]
    matches = re.findall(r"argv\[\]=(.*?)\s+;", props["ExecStart"])
    path = re.findall(r"(?:^|[ {;])path=([^ ;]+)", props["ExecStart"])
    known = next((tokens for tokens in [expected, candidate] if matches == [" ".join(tokens)] and path == [NODE]), None)
    env_names = []
    for entry in props["EnvironmentFilesEntries"]:
        env_names.extend(re.findall(r"(?:^| )([^ ;]+) \(ignore_errors=(?:yes|no)\)", entry))
    env_match = env_names == observed["environmentFiles"]
    # Unknown argv/path values are never emitted or hashed. Only allowlisted
    # public selectors appear; no Environment property is requested anywhere.
    cwd = props["WorkingDirectory"]
    cwd_known = cwd in {observed["WorkingDirectory"], str(ROOT / "apps/yunipals-indexer")}
    entry = None
    if known:
        entry = Path(known[-1]); entry = entry if entry.is_absolute() else Path(observed["WorkingDirectory"]) / entry
    entry_sha = None
    if entry is not None:
        try:
            info = entry.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022 and info.st_size <= 2000000:
                entry_sha = digest(entry.read_bytes())
        except FileNotFoundError: pass
    invocation = props["InvocationID"] if re.fullmatch(r"[0-9a-f]{32}", props["InvocationID"]) else None
    pid = int(props["MainPID"]) if props["MainPID"].isdigit() and int(props["MainPID"]) > 0 else None
    user = props["User"] or "root"; group = props["Group"]
    identity_known = user in {"root", "postgres", proposed["proposedRole"]} and group in {"", "root", "postgres", proposed["proposedRole"]}
    return {"unit": unit, "active": props["ActiveState"] == "active" and props["SubState"] == "running",
        "invocationId": invocation, "mainPid": pid, "knownPublicArgvMatches": known is not None,
        "publicNode": NODE if known else None, "publicEntrypoint": str(entry) if entry else None,
        "publicEntrypointSha256": entry_sha, "knownWorkingDirectoryMatches": cwd_known,
        "workingDirectory": cwd if cwd_known else None, "orderedEnvironmentSelectorsMatchBaseline": env_match,
        "orderedEnvironmentSelectors": observed["environmentFiles"] if env_match else None,
        "knownOsIdentityMatches": identity_known, "user": user if identity_known else None, "groupSetting": group if identity_known else None,
        "privateEnvironmentValuesRead": False, "fullLegacyImportClosureAttested": False,
        "baselinePort": LIVE_PORTS.get(unit), "previewPort": PREVIEW_PORTS.get(unit)}


def sockets():
    ports = sorted({*LIVE_PORTS.values(), *PREVIEW_PORTS.values()})
    selector = "( " + " or ".join("sport = :" + str(port) for port in ports) + " )"
    text = run(["/usr/bin/ss", "-Hlnpt", selector])
    result = {str(port): [] for port in ports}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 5: raise RuntimeError("Unexpected selected socket metadata.")
        local = fields[3]; match = re.search(r":([0-9]+)$", local)
        if not match or match[1] not in result: raise RuntimeError("Socket filter left reviewed ports.")
        result[match[1]].append({"loopback": local.rsplit(":", 1)[0] in {"127.0.0.1", "[::1]", "::1"},
            "pids": sorted(set(int(value) for value in re.findall(r"pid=([0-9]+)", line)))})
    return result


def os_identity(role):
    if role not in ROLES: raise ValueError("Unapproved proposed OS identity.")
    try: user, group = pwd.getpwnam(role), grp.getgrnam(role)
    except KeyError: return {"exists": False, "restricted": False, "reason": "dedicated_os_identity_missing"}
    groups = sorted(set(os.getgrouplist(role, user.pw_gid)))
    valid = user.pw_uid > 0 and user.pw_gid > 0 and user.pw_gid == group.gr_gid and groups == [group.gr_gid] and user.pw_shell in {"/usr/sbin/nologin", "/sbin/nologin", "/bin/false"}
    return {"exists": True, "uid": user.pw_uid, "gid": user.pw_gid, "matchingPrimaryGroup": user.pw_gid == group.gr_gid,
            "supplementaryGroupsEmpty": groups == [group.gr_gid], "loginDisabled": user.pw_shell in {"/usr/sbin/nologin", "/sbin/nologin", "/bin/false"}, "restricted": valid}


def peer_args(role, identity=None):
    if role not in {*ROLES, "postgres"}: raise ValueError("Unapproved peer role.")
    if role == "postgres":
        user, group = pwd.getpwnam("postgres"), grp.getgrnam("postgres")
        if user.pw_uid <= 0 or user.pw_gid <= 0 or user.pw_gid != group.gr_gid:
            raise RuntimeError("Exact nonroot postgres catalog peer identity required.")
        identity = {"restricted": True, "uid": user.pw_uid, "gid": user.pw_gid}
    else:
        if not identity or identity.get("restricted") is not True: raise RuntimeError("Restricted matching OS identity required before peer connection.")
    prefix = ["/usr/bin/setpriv", "--reuid=" + str(identity["uid"]), "--regid=" + str(identity["gid"]), "--clear-groups"]
    return [*prefix, "/usr/bin/env", "-i", "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8", "TZ=UTC",
        "PGHOST=/var/run/postgresql", "PGPORT=5432", "PGUSER=" + role, "PGDATABASE=" + DATABASE, "PGPASSFILE=/dev/null",
        "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c application_name=yunipals_consumer_preflight",
        "/usr/bin/psql", "-XwqAt", "-v", "ON_ERROR_STOP=1"]


def sql(text): return json.loads(run(peer_args("postgres"), data="BEGIN READ ONLY;\n" + text + ";\nROLLBACK;", timeout=12))


def catalog_sql():
    values = ",".join("('" + role + "')" for role in ROLES)
    return f"""WITH wanted(name) AS(VALUES {values}), roles AS(SELECT w.name,r.oid,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolconnlimit FROM wanted w LEFT JOIN pg_roles r ON r.rolname=w.name),
    protected_schemas AS(SELECT oid FROM pg_namespace WHERE nspname IN('{SCHEMA}','{READ_SCHEMA}','{CONTROL}'))
    SELECT jsonb_build_object('roles',(SELECT jsonb_agg(jsonb_build_object('name',r.name,'exists',r.oid IS NOT NULL,
      'login',r.rolcanlogin,'inherit',r.rolinherit,'superuser',r.rolsuper,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,
      'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,
      'memberships',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid),
      'databaseCreate',CASE WHEN r.oid IS NOT NULL THEN has_database_privilege(r.oid,current_database(),'CREATE') ELSE false END,
      'protectedSchemaCreate',(SELECT count(*) FROM protected_schemas n WHERE r.oid IS NOT NULL AND has_schema_privilege(r.oid,n.oid,'CREATE')),
      'protectedOwnedObjects',(SELECT count(*) FROM pg_class c WHERE c.relnamespace IN(SELECT oid FROM protected_schemas) AND c.relowner=r.oid),
      'protectedWrites',(SELECT count(*) FROM pg_class c WHERE c.relnamespace IN(SELECT oid FROM protected_schemas) AND c.relkind IN('r','p','v','m','f')
        AND r.oid IS NOT NULL AND has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      'protectedDefinerExecute',(SELECT count(*) FROM pg_proc p WHERE p.pronamespace IN(SELECT oid FROM protected_schemas) AND p.prosecdef
        AND r.oid IS NOT NULL AND has_function_privilege(r.oid,p.oid,'EXECUTE'))) ORDER BY r.name) FROM roles r),
      'hbaErrors',EXISTS(SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL),
      'hba',(SELECT jsonb_agg(jsonb_build_object('role',w.name,'rule',h.rule_number,'auth',h.auth_method,'noMapOptions',h.options IS NULL,
        'databaseKind',CASE WHEN h.database @> ARRAY['all'] THEN 'all' WHEN h.database @> ARRAY[current_database()::text] THEN 'exact'
          WHEN EXISTS(SELECT 1 FROM unnest(h.database) x WHERE x IN('sameuser','samerole','samegroup') OR x~'^[/@]') THEN 'unknown' ELSE 'no' END,
        'userKind',CASE WHEN h.user_name @> ARRAY['all'] THEN 'all' WHEN h.user_name @> ARRAY[w.name] THEN 'exact'
          WHEN EXISTS(SELECT 1 FROM unnest(h.user_name) x WHERE x~'^[/@+]') THEN 'unknown' ELSE 'no' END) ORDER BY w.name,h.rule_number)
        FROM wanted w CROSS JOIN pg_hba_file_rules h WHERE h.type='local'),
      'capacity',jsonb_build_object('maxConnections',current_setting('max_connections')::int,
        'superuserReserved',current_setting('superuser_reserved_connections')::int,
        'roleReserved',COALESCE(current_setting('reserved_connections',true),'0')::int,
        'clientSessions',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),
        'activeClientSessions',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND state='active')),
      'catalogOnly',true)"""


def role_restricted(row):
    return row.get("exists") is True and row.get("login") is True and all(row.get(key) is False for key in ["inherit", "superuser", "createDb", "createRole", "replication", "bypassRls", "databaseCreate"]) and all(row.get(key) == 0 for key in ["memberships", "protectedSchemaCreate", "protectedOwnedObjects", "protectedWrites", "protectedDefinerExecute"]) and row.get("connectionLimit") == 6


def hba_compatible(role, observation):
    if observation["hbaErrors"]: return False
    rules = sorted([row for row in observation["hba"] or [] if row["role"] == role], key=lambda row: row["rule"])
    for row in rules:
        if row["databaseKind"] == "no" or row["userKind"] == "no": continue
        return row["databaseKind"] in {"all", "exact"} and row["userKind"] in {"all", "exact"} and row["auth"] == "peer" and row["noMapOptions"] is True
    return False


PEER_SQL = "SELECT jsonb_build_object('currentRole',current_user,'sessionRole',session_user,'readOnly',current_setting('transaction_read_only')='on','unixSocket',inet_client_addr() IS NULL)"


def peer_identity(role, identity):
    value = json.loads(run(peer_args(role, identity), data="BEGIN READ ONLY;\n" + PEER_SQL + ";\nROLLBACK;", timeout=10))
    return {"verified": value == {"currentRole": role, "sessionRole": role, "readOnly": True, "unixSocket": True},
            "clearedSupplementaryGroups": True, "passwordOrCredentialFilesUsed": False}


def capacity(value):
    maximum = value["maxConnections"] - value["superuserReserved"] - value["roleReserved"]
    remaining = maximum - value["clientSessions"]
    # A single preview has hard pool4, role margin2. Keep a further16 slots for
    # existing source/support/proxy/legacy fleet bursts; snapshot only, no lease.
    return {**value, "ordinarySlots": maximum, "freeOrdinarySlots": remaining, "previewHardPool": 4,
        "previewRoleLimit": 6, "existingFleetBurstReserve": 16, "minimumHeadroom": 22,
        "sequentialPreviewHeadroomObserved": remaining >= 22, "reservedCapacityLease": False,
        "requiresFreshRecheckImmediatelyBeforePreview": True, "existingFleetConfiguredPoolLedgerVerified": False, "capacityAccepted": False}


def observe():
    global PHASE
    PHASE = "pinned_matrix"; value = matrix()
    PHASE = "candidate_runtime"; installed = runtime()
    PHASE = "public_units_and_ports"; listeners = sockets()
    services = [public_unit(row, state(row["unit"])) for row in value["services"]]
    PHASE = "catalog_and_capacity"; catalog = sql(catalog_sql()); room = capacity(catalog["capacity"])
    by_role = {row["name"]: row for row in catalog["roles"]}; identities = {}
    for role in ROLES:
        PHASE = "dedicated_identity"
        identity = os_identity(role); pg = by_role[role]; restricted = role_restricted(pg); hba = hba_compatible(role, catalog)
        peer = {"verified": False, "reason": "identity_role_or_peer_prerequisite_missing"}
        if identity["restricted"] and restricted and hba:
            try: peer = peer_identity(role, identity)
            except Exception: peer = {"verified": False, "reason": "dedicated_readonly_peer_test_failed"}
        identities[role] = {"os": identity, "postgres": pg, "restrictedPostgres": restricted,
            "simpleUnmappedPeerRuleVerified": hba, "mappedOrRegexHbaSupported": False, "peerIdentity": peer,
            "preparationMissing": not (identity["restricted"] and restricted and hba and peer["verified"])}
    for row, observed in zip(value["services"], services):
        role = row["proposed"]["proposedRole"]; port = LIVE_PORTS.get(row["unit"]); preview = PREVIEW_PORTS.get(row["unit"])
        observed["baselineListenerMatches"] = port is None or bool(listeners[str(port)]) and all(item["loopback"] and observed["mainPid"] in item["pids"] for item in listeners[str(port)])
        observed["previewPortUnused"] = preview is None or not listeners[str(preview)]
        observed["preparationMetadataPassed"] = (installed["verified"] and installed.get("publicRuntimeReadableAndTraversable") is True and observed["active"] and observed["invocationId"] is not None and observed["mainPid"] is not None and observed["knownPublicArgvMatches"] and observed["publicEntrypointSha256"] is not None and
            observed["knownWorkingDirectoryMatches"] and observed["orderedEnvironmentSelectorsMatchBaseline"] and observed["knownOsIdentityMatches"] and
            observed["baselineListenerMatches"] and observed["previewPortUnused"] and not identities[role]["preparationMissing"])
        # No preview process is started. Worker must never preview against live
        # operational write destinations; source/history acceptance is separate.
        observed["previewEligible"] = False
    return {"format": "yunipals-consumer-runtime-readonly-preflight-v1", "generatedAt": datetime.now(timezone.utc).isoformat(),
        "readiness": "blocked_source_and_acceptance_unverified", "matrixSha256": MATRIX_SHA, "candidate": installed, "services": services, "identities": identities,
        "preparationMetadataPassed": all(row["preparationMetadataPassed"] for row in services) and room["sequentialPreviewHeadroomObserved"],
        "capacity": room, "previewPorts": {str(port): not listeners[str(port)] for port in PREVIEW_PORTS.values()},
        "sourceAcceptanceVerified": False, "historyParityStorageAcceptanceVerified": False, "allPreviewEligible": False,
        "installable": False, "cutoverEligible": False, "applicationDataRead": False, "privateEnvValuesRead": False,
        "providersOrApisCalled": False, "rolesGrantsUnitsSelectorsChanged": False,
        "operationalGrantsAccepted": False, "workerPreviewLiveWriterAllowed": False,
        "qualification": "Preparation metadata only; history/source/read-view/operational-grant/public-mount and sequential capacity acceptance remain independent gates."}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main": raise RuntimeError("Exact root/host required.")
    try: report = observe()
    except Exception as error:
        report = {"format": "yunipals-consumer-runtime-readonly-preflight-v1", "status": "blocked", "phase": PHASE,
            "errorClass": type(error).__name__, "privateDiagnosticsWithheld": True, "installable": False, "cutoverEligible": False,
            "sourceAcceptanceVerified": False, "productionMutated": False}
    print(json.dumps(report, indent=2))


if __name__ == "__main__": main()
