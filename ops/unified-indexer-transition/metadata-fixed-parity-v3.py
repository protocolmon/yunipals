#!/usr/bin/env python3
"""Compare complete Base metadata in 16 bounded partitions in one read-only snapshot."""
import datetime
import hashlib
import json
import os
import re
import socket
import subprocess
import time

BOUNDARY = 52870977
SOURCE_UNIT = "yunipals-unified-source6-free-v2.service"
INVOCATION = "dab6fcd2704c461a9af2123168aec8f0"
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
 FROM unified_shadow_20261020_7e7375b0.canonical_event
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
      'native',(SELECT count(*) FROM unified_shadow_20261020_7e7375b0.canonical_event
        WHERE source_id='metadata:base' AND block_number>=22224075 AND block_number<=52870977
        AND (transaction_hash IS NULL OR transaction_hash !~ '^0x[0-9a-f]{64}$'))));
    ROLLBACK;"""
    return prefix + "\n".join(statements) + invalid

SQL = comparison_sql()



def command(args, data=None, timeout=10):
    result = subprocess.run(args, input=data, text=True, capture_output=True,
                            timeout=timeout, env=CLEAN)
    if result.returncode or result.stderr or len(result.stdout) > 64000:
        # Report only SQLSTATE; SQL diagnostics can contain source data.
        codes = re.findall(r"ERROR:\s+([A-Z0-9]{5})", result.stderr)
        code = codes[0] if len(codes) == 1 else "unknown"
        raise RuntimeError("bounded_metadata_comparison_failed_sqlstate_" + code)
    return result.stdout


def source_identity():
    raw = command(["/usr/bin/systemctl", "show", SOURCE_UNIT,
                   "--property=ActiveState,SubState,InvocationID,MainPID,ExecMainStartTimestampMonotonic,ExecMainExitTimestampMonotonic,ExecMainStatus,Result"])
    value = dict(line.split("=", 1) for line in raw.splitlines())
    running = (value.get("MainPID") == "108129" and value.get("ActiveState") == "active"
               and value.get("SubState") == "running")
    known_terminal = (value.get("MainPID") == "0" and value.get("ActiveState") == "failed"
                      and value.get("SubState") == "failed" and value.get("Result") == "exit-code"
                      and value.get("ExecMainStatus") == "1"
                      and value.get("ExecMainExitTimestampMonotonic") == "66087150180933")
    if (value.get("InvocationID") != INVOCATION
            or value.get("ExecMainStartTimestampMonotonic") != "66076760128343"
            or not (running or known_terminal)):
        raise RuntimeError("acknowledged_source_required")
    return value


def main():
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main":
        raise RuntimeError("exact_host_required")
    disk = os.statvfs("/var/lib/postgresql")
    free_bytes = disk.f_bavail * disk.f_frsize
    if free_bytes < 27 * 1024**3:
        raise RuntimeError("comparison_disk_reserve_required")
    before = source_identity()
    started = time.monotonic()
    args = ["/usr/sbin/runuser", "-u", "postgres", "--", "/usr/bin/env", "-i",
            "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "PGHOST=/var/run/postgresql",
            "PGPORT=5432", "PGUSER=postgres", "PGDATABASE=yunipals_backfill",
            "/usr/bin/psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"]
    rows = [json.loads(row) for row in command(args, SQL, 360).splitlines()]
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
    print(json.dumps({"format": "yunipals-metadata-fixed-parity-v3", "completed": True,
                      "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "elapsedSeconds": round(time.monotonic() - started, 3),
                      "sqlSha256": hashlib.sha256(SQL.encode()).hexdigest(),
                      "source": after, "comparison": result, "exactDataParity": equal,
                      "canonicalAcceptance": False, "sourceSelected": False,
                      "databaseWrites": 0, "providerCalls": 0, "serviceJobs": 0,
                      "freeBytesBefore": free_bytes,
                      "limitations": ["Data-only comparison at the saved fixed boundary, across16 exhaustive transaction-hash partitions in one repeatable-read snapshot, using the legacy rarityScore string representation.",
                                      "Does not establish current canonical coverage, publication parity or native adoption."]},
                     sort_keys=True))


if __name__ == "__main__":
    main()
