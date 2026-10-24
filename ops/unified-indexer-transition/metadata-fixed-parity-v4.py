#!/usr/bin/env python3
"""Compare complete Base metadata in 16 bounded partitions in one read-only snapshot."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import re
import signal
import socket
import subprocess
import time

BOUNDARY = 52870977
SOURCE_UNIT = "yunipals-ypal-combined-source.service"
INVOCATION = "9d9fb09dc91a41b4889639576ce7348d"
SOURCE_PID = "2472127"
SOURCE_START_TICKS = 6622410657
FORMAT = "yunipals-metadata-fixed-parity-v4"
BASE = Path("/var/backups/yunipals-metadata-fixed-parity-v4-20261024")
OUTPUT = BASE / "result.json"
PEER_PASSWORD_SENTINEL = "/run/yunipals-metadata-fixed-parity-no-password-file"
APPLICATION_NAME = "yunipals_metadata_fixed_parity_v4"
CLEAN = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}
BASE_SQL = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='500ms';
SET LOCAL work_mem='16MB'; SET LOCAL temp_file_limit='512MB';
SET LOCAL max_parallel_workers_per_gather=0;
SET LOCAL enable_mergejoin=off;
WITH legacy AS NOT MATERIALIZED (
 SELECT transaction_hash,log_index,event_name,
 jsonb_build_array(transaction_hash,log_index,transaction_index,block_number::text,
 block_hash,event_name,token_id,recipient,traits) AS payload
 FROM metadata_source.chain_metadata_event
 WHERE chain_id=8453 AND contract_address='0x98433df878e8c898cb907345c3a7756e5f72240f'
 AND block_number>=22224075 AND block_number<=52870977
), native AS NOT MATERIALIZED (
 SELECT transaction_hash,log_index,name AS event_name,
 (chain_id<>8453 OR address<>'0x98433df878e8c898cb907345c3a7756e5f72240f'
 OR abi_hash<>'0x10ed1bdc491b581039c80bfe1a53832615bda607560c998ad5202542cf9a4259'
 OR name NOT IN('Mint','Update')) AS unexpected_identity,
 jsonb_build_array(transaction_hash,log_index,transaction_index,block_number::text,
 block_hash,name,args::jsonb->>'tokenId',lower(args::jsonb->>'to'),jsonb_set(args::jsonb->'yunipal','{rarityScore}',to_jsonb(args::jsonb->'yunipal'->>'rarityScore'),false)) AS payload
 FROM unified_ypal_20261023_v1.canonical_event
 WHERE source_id='metadata:base' AND block_number>=22224075 AND block_number<=52870977
), legacy_summary AS (
 SELECT count(*) AS rows,count(DISTINCT (transaction_hash,log_index)) AS unique_keys,
 count(*) FILTER(WHERE event_name='Mint') AS mints,
 count(*) FILTER(WHERE event_name='Update') AS updates,
 encode(sha256(convert_to(COALESCE(string_agg(encode(payload_hash,'hex'),''
 ORDER BY transaction_hash COLLATE "C",log_index),''),'UTF8')),'hex') AS payload_sha256
 FROM (SELECT transaction_hash,log_index,event_name,
 sha256(convert_to(payload::text,'UTF8')) AS payload_hash FROM legacy OFFSET 0) l
), native_summary AS (
 SELECT count(*) AS rows,count(DISTINCT (transaction_hash,log_index)) AS unique_keys,
 count(*) FILTER(WHERE event_name='Mint') AS mints,
 count(*) FILTER(WHERE event_name='Update') AS updates,
 count(*) FILTER(WHERE unexpected_identity IS DISTINCT FROM false) AS unexpected_identities,
 encode(sha256(convert_to(COALESCE(string_agg(encode(payload_hash,'hex'),''
 ORDER BY transaction_hash COLLATE "C",log_index),''),'UTF8')),'hex') AS payload_sha256
 FROM (SELECT transaction_hash,log_index,event_name,unexpected_identity,
 sha256(convert_to(payload::text,'UTF8')) AS payload_hash FROM native OFFSET 0) n
), comparison AS (
 SELECT count(*) FILTER(WHERE l.transaction_hash IS NULL) AS missing_legacy,
 count(*) FILTER(WHERE n.transaction_hash IS NULL) AS missing_native,
 count(*) FILTER(WHERE l.transaction_hash IS NOT NULL AND n.transaction_hash IS NOT NULL
 AND l.payload IS DISTINCT FROM n.payload) AS changed_payloads
 FROM legacy l FULL JOIN native n USING(transaction_hash,log_index)
)
SELECT jsonb_build_object('observedAt',clock_timestamp(),'database',current_database(),
 'boundary',52870977,'legacy',(SELECT to_jsonb(l) FROM legacy_summary l),
 'native',(SELECT to_jsonb(n) FROM native_summary n),
 'comparison',(SELECT to_jsonb(c) FROM comparison c),
 'legacyScan',(SELECT jsonb_build_object('chainId',chain_id,'contract',contract_address,
 'deploymentBlock',deployment_block::text,'nextBlock',next_block::text,'ingestionMode',ingestion_mode)
 FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'));
ROLLBACK;"""

PARTITIONS = tuple("0123456789abcdef")

def comparison_sql():
    prefix, rest = BASE_SQL.split("WITH legacy", 1)
    body = "WITH legacy" + rest.removesuffix("ROLLBACK;")
    statements = []
    for partition in PARTITIONS:
        current = body.replace(
            "AND block_number>=22224075 AND block_number<=52870977",
            "AND block_number>=22224075 AND block_number<=52870977 "
            f"AND substring(transaction_hash,3,1)='{partition}'"
        )
        if current.count(f"substring(transaction_hash,3,1)='{partition}'") != 2:
            raise RuntimeError("both_partitions_required")
        current = current.replace("'boundary',52870977,", f"'partition','{partition}','boundary',52870977,")
        statements.append(current)
    invalid = """SELECT jsonb_build_object('invalidKeys',jsonb_build_object(
      'legacy',(SELECT count(*) FROM metadata_source.chain_metadata_event
        WHERE chain_id=8453 AND contract_address='0x98433df878e8c898cb907345c3a7756e5f72240f'
        AND block_number>=22224075 AND block_number<=52870977
        AND (transaction_hash IS NULL OR transaction_hash !~ '^0x[0-9a-f]{64}$')),
      'native',(SELECT count(*) FROM unified_ypal_20261023_v1.canonical_event
        WHERE source_id='metadata:base' AND block_number>=22224075 AND block_number<=52870977
        AND (transaction_hash IS NULL OR transaction_hash !~ '^0x[0-9a-f]{64}$'))));
    ROLLBACK;"""
    return prefix + "\n".join(statements) + invalid

SQL = comparison_sql()
CONTEXT = {
    "releaseId": "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
    "manifestHash": "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
    "schema": "unified_ypal_20261023_v1", "schemaOid": "75963410", "buildId": "71e2a7f3b7",
    "readSchema": "yunipals_ownership_4e77f52b_v4", "readSchemaOid": "75994954",
    "readIdentity": "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67"
}
CONTEXT_GUARD = """DO $metadata_parity_context$ BEGIN
 IF NOT (current_user=session_user AND current_user='postgres' AND current_database()='yunipals_backfill'
 AND inet_client_addr()IS NULL AND current_setting('port')='5432'
 AND (SELECT oid FROM pg_database WHERE datname=current_database())=17584
 AND 'unified_ypal_20261023_v1'::regnamespace::oid=75963410
 AND 'yunipals_ownership_4e77f52b_v4'::regnamespace::oid=75994954
 AND EXISTS(SELECT 1 FROM yunipals_indexer_control.release WHERE
 id='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
 AND physical_schema='unified_ypal_20261023_v1' AND build_id='71e2a7f3b7'
 AND manifest_hash='0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112')
 AND EXISTS(SELECT 1 FROM yunipals_ownership_4e77f52b_v4._unified_read_release WHERE singleton
 AND release_id='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
 AND identity='0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'
 AND manifest_hash='0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112')
 AND EXISTS(SELECT 1 FROM unified_ypal_20261023_v1._ponder_meta WHERE key='app'
 AND value->>'version'='6' AND value->>'build_id'='71e2a7f3b7' AND value->>'is_dev'='0')
 AND EXISTS(SELECT 1 FROM unified_ypal_20261023_v1._ponder_checkpoint WHERE chain_id=8453
 AND latest_checkpoint~'^[0-9]{75}$' AND latest_checkpoint<>repeat('0',75)
 AND substring(latest_checkpoint,11,16)::numeric=8453
 AND substring(latest_checkpoint,27,16)::numeric-CASE WHEN right(latest_checkpoint,33)=repeat('9',33)THEN 0 ELSE 1 END>=52870977))
 THEN RAISE EXCEPTION 'exact_combined_Base_metadata_boundary_context_required'; END IF;
 END $metadata_parity_context$;
"""
EXECUTION_SQL = SQL.replace("WITH legacy", CONTEXT_GUARD + "WITH legacy", 1)


def command(args, data=None, timeout=10):
    # runuser starts psql as another UID. Killing only that immediate parent can
    # leave the real reader and its stdout pipe alive beyond the outer deadline.
    process = subprocess.Popen(args, text=True, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=CLEAN, cwd="/", start_new_session=True)
    try:
        stdout, stderr = process.communicate(data, timeout=timeout)
    except subprocess.TimeoutExpired:
        for sig, grace in [(signal.SIGTERM, 2), (signal.SIGKILL, 2)]:
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=grace)
                break
            except subprocess.TimeoutExpired:
                continue
        else:
            raise RuntimeError("metadata_comparison_group_termination_unknown_inspect_only")
        raise RuntimeError("bounded_metadata_comparison_timed_out_inspect_only")
    if process.returncode or stderr or len(stdout) > 64000:
        # Report only SQLSTATE; SQL diagnostics can contain source data.
        codes = re.findall(r"ERROR:\s+([A-Z0-9]{5})", stderr)
        code = codes[0] if len(codes) == 1 else "unknown"
        raise RuntimeError("bounded_metadata_comparison_failed_sqlstate_" + code)
    return stdout


def source_identity():
    raw = command(["/usr/bin/systemctl", "show", SOURCE_UNIT,
                   "--property=ActiveState,SubState,InvocationID,MainPID,ExecMainStartTimestampMonotonic,ExecMainExitTimestampMonotonic,ExecMainStatus,Result"])
    value = dict(line.split("=", 1) for line in raw.splitlines())
    if (value.get("MainPID") != SOURCE_PID or value.get("ActiveState") != "active"
            or value.get("SubState") != "running" or value.get("InvocationID") != INVOCATION):
        raise RuntimeError("acknowledged_current_combined_source_required")
    raw = (Path("/proc") / SOURCE_PID / "stat").read_bytes()
    start_ticks = int(raw[raw.rfind(b")") + 2:].split()[19])
    if start_ticks != SOURCE_START_TICKS:
        raise RuntimeError("same_combined_source_process_handle_required")
    value["startTicks"] = start_ticks

    return value


def capture():
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main":
        raise RuntimeError("exact_host_required")
    disk = os.statvfs("/var/lib/postgresql")
    free_bytes = disk.f_bavail * disk.f_frsize
    if free_bytes < 27 * 1024**3:
        raise RuntimeError("comparison_disk_reserve_required")
    before = source_identity()
    started = time.monotonic()
    if os.path.lexists(PEER_PASSWORD_SENTINEL):
        raise RuntimeError("absent_peer_password_sentinel_required")
    args = ["/usr/sbin/runuser", "-u", "postgres", "--", "/usr/bin/env", "-i",
            "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "PGHOST=/var/run/postgresql",
            "PGPORT=5432", "PGUSER=postgres", "PGDATABASE=yunipals_backfill",
            "PGAPPNAME=" + APPLICATION_NAME,
            "PGPASSFILE=" + PEER_PASSWORD_SENTINEL,
            "/usr/bin/psql", "-w", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"]
    rows = [json.loads(row) for row in command(args, EXECUTION_SQL, 360).splitlines()]
    if len(rows) != 17 or tuple(row.get("partition") for row in rows[:-1]) != PARTITIONS:
        raise RuntimeError("all_sixteen_partitions_required")
    partitions, invalid = rows[:-1], rows[-1]["invalidKeys"]
    if set(invalid) != {"legacy", "native"}:
        raise RuntimeError("invalid_key_coverage_required")
    result = {"boundary": BOUNDARY, "partitions": partitions, "invalidKeys": invalid,
              "legacyScan": partitions[0]["legacyScan"]}
    for side in ("legacy", "native"):
        fields = ["rows", "unique_keys", "mints", "updates"]
        if side == "native": fields.append("unexpected_identities")
        total = {field: sum(row[side][field] for row in partitions) for field in fields}
        total["partition_digest_sha256"] = hashlib.sha256("".join(
            row[side]["payload_sha256"] for row in partitions).encode()).hexdigest()
        result[side] = total
    result["comparison"] = {field: sum(row["comparison"][field] for row in partitions)
                            for field in ("missing_legacy", "missing_native", "changed_payloads")}
    after = source_identity()
    if before != after:
        raise RuntimeError("source_changed_during_comparison")
    old, new, differences = result["legacy"], result["native"], result["comparison"]
    scan = result["legacyScan"]
    covered = (scan["chainId"] == 8453 and scan["contract"] == "0x98433df878e8c898cb907345c3a7756e5f72240f"
               and scan["deploymentBlock"] == "22224075" and int(scan["nextBlock"]) > BOUNDARY)
    equal = (covered and all(row["legacyScan"] == scan for row in partitions)
             and all(value == 0 for value in invalid.values()) and old["rows"] > 0 and old["rows"] == new["rows"]
             and old["rows"] == old["unique_keys"] and new["rows"] == new["unique_keys"]
             and old["mints"] + old["updates"] == old["rows"]
             and new["mints"] + new["updates"] == new["rows"]
             and new["unexpected_identities"] == 0 and all(v == 0 for v in differences.values())
             and old["partition_digest_sha256"] == new["partition_digest_sha256"])
    return {"format": FORMAT, "completed": True,
                      "context": CONTEXT, "producerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                      "executionSqlSha256": hashlib.sha256(EXECUTION_SQL.encode()).hexdigest(),
                      "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "elapsedSeconds": round(time.monotonic() - started, 3),
                      "sqlSha256": hashlib.sha256(SQL.encode()).hexdigest(),
                      "source": after, "comparison": result, "exactDataParity": equal,
                      "canonicalAcceptance": False, "sourceSelected": False,
                      "databaseWrites": 0, "providerCalls": 0, "serviceJobs": 0,
                      "freeBytesBefore": free_bytes,
                      "limitations": ["Data-only comparison at the saved fixed boundary, across16 exhaustive transaction-hash partitions in one repeatable-read snapshot, using the legacy rarityScore string representation.",
                                      "Does not establish current canonical coverage, publication parity or native adoption."]}


def protected(path, cap=20000):
    path = Path(path)
    for item in [path, *path.parents]:
        st = item.lstat()
        if st.st_uid != 0 or stat.S_ISLNK(st.st_mode) or st.st_mode & 0o022:
            raise RuntimeError("protected_metadata_parity_plan_required")
    st = path.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_size > cap:
        raise RuntimeError("bounded_metadata_parity_plan_required")
    return path.read_bytes()


def review(plan_path):
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main":
        raise RuntimeError("exact_host_required")
    raw = protected(plan_path); plan = json.loads(raw)
    if plan != {"format": "yunipals-metadata-fixed-parity-plan-v4", "output": str(OUTPUT)}:
        raise RuntimeError("fixed_fresh_metadata_parity_plan_required")
    if os.path.lexists(OUTPUT):
        raise RuntimeError("exclusive_new_metadata_parity_output_required")
    for path in [OUTPUT.parent, *OUTPUT.parent.parents]:
        st = path.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
            raise RuntimeError("protected_private_metadata_report_directory_required")
    if stat.S_IMODE(OUTPUT.parent.stat().st_mode) != 0o700:
        raise RuntimeError("private_metadata_report_directory_0700_required")
    disk = os.statvfs("/var/lib/postgresql"); free_bytes = disk.f_bavail * disk.f_frsize
    if free_bytes < 27 * 1024**3:
        raise RuntimeError("comparison_disk_reserve_required")
    actor = source_identity()
    binding = {"format": "yunipals-metadata-fixed-parity-review-v4", "producerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "planSha256": hashlib.sha256(raw).hexdigest(), "plan": plan, "context": CONTEXT, "source": actor,
               "boundary": BOUNDARY, "partitions": PARTITIONS, "sqlSha256": hashlib.sha256(SQL.encode()).hexdigest(),
               "executionSqlSha256": hashlib.sha256(EXECUTION_SQL.encode()).hexdigest(), "minimumDiskReserveBytes": 27 * 1024**3,
               "providerCalls": 0, "databaseWrites": 0, "serviceActions": 0}
    encoded = (json.dumps(binding, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return {"binding": binding, "reviewHash": hashlib.sha256(encoded).hexdigest(), "freeBytesObserved": free_bytes}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--plan", required=True); parser.add_argument("--apply")
    args = parser.parse_args(); current = review(args.plan)
    if not args.apply:
        print(json.dumps({"format": "yunipals-metadata-fixed-parity-review-v4", "reviewHash": current["reviewHash"],
              "boundary": BOUNDARY, "partitions": len(PARTITIONS), "sourceActorQualified": True,
              "nativeBoundaryCheckedAtCapture": True, "sqlSha256": current["binding"]["sqlSha256"],
              "executionSqlSha256": current["binding"]["executionSqlSha256"], "minimumDiskReserveBytes": 27 * 1024**3,
              "databaseWrites": 0, "databaseConnections": 0, "providerCalls": 0, "serviceJobs": 0}, sort_keys=True)); return
    if args.apply != current["reviewHash"] or source_identity() != current["binding"]["source"]:
        raise RuntimeError("fresh_exact_metadata_parity_review_required")
    fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        result = capture()
        if result["source"] != current["binding"]["source"]:
            raise RuntimeError("source_changed_after_review")
        raw = (json.dumps({**result, "reviewHash": current["reviewHash"]}, sort_keys=True) + "\n").encode()
        with os.fdopen(fd, "wb", closefd=False) as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        print(json.dumps({"format": FORMAT, "completed": True, "reportSha256": hashlib.sha256(raw).hexdigest(),
              "boundary": BOUNDARY, "partitions": len(result["comparison"]["partitions"]),
              "legacyRows": result["comparison"]["legacy"]["rows"], "nativeRows": result["comparison"]["native"]["rows"],
              "differences": result["comparison"]["comparison"], "exactDataParity": result["exactDataParity"],
              "canonicalAcceptance": False, "sourceSelected": False, "databaseWrites": 0, "providerCalls": 0, "serviceJobs": 0}, sort_keys=True))
    finally:
        os.close(fd)


if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"format": FORMAT, "completed": False, "code": str(error) if type(error) is RuntimeError and re.fullmatch("[a-zA-Z0-9_]+", str(error)) else "metadata_parity_private_diagnostics_withheld", "automaticRetryAllowed": False}))
        raise SystemExit(1)
