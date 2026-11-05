#!/usr/bin/env python3
"""Email persistent indexing problems that public request monitoring cannot see."""
import argparse
import datetime
import fcntl
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

from request_monitor import advance, atomic_json, pending_event, send_email


IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$")
HEX_IDENTIFIER = re.compile(r"^0x[0-9a-f]{64}$")
FAILURE_ALERT_INTERVAL_SECONDS = 3600
HINTS = {
    "indexer-ready": "Check yunipals-indexer.service. Ponder reports not ready during recovery.",
    "lag": "Compare index_block and provider wait in the yunipals_indexer_profile journal records.",
    "oldest-transaction": "An open snapshot stops vacuum and slows live indexing. "
                          "SELECT pg_cancel_backend(pid) cancels one query.",
    "dead-rows": "Vacuum cannot keep up, usually because of a long-open transaction.",
    "metadata-worker": "A long query or stall has blocked the yunipals-metadata.service loop.",
    "observation": "Check yunipals-indexer-observer.service. Readiness depends on it.",
    "market": "Sales history reports a warning until this checkpoint is available.",
    "production-health": "See /var/lib/yunipals-unified-shared/production-health/latest.json.",
}


def validate_config(config):
    for key in ("recovery_checks", "maximum_check_gap_seconds", "max_transaction_seconds",
                "max_worker_heartbeat_age_seconds", "max_observation_age_seconds",
                "max_production_health_age_seconds"):
        if not isinstance(config.get(key), int) or config[key] < 1:
            raise ValueError(f"{key} must be a positive integer")
    if not isinstance(config.get("email_enabled"), bool):
        raise ValueError("email_enabled must be true or false")
    if not HEX_IDENTIFIER.match(config.get("release_id", "")):
        raise ValueError("release_id must be a release hash")
    if not config.get("chains"):
        raise ValueError("Configure at least one chain")
    for name, chain in config["chains"].items():
        if not IDENTIFIER.match(name) or not isinstance(chain.get("chain_id"), int):
            raise ValueError("Invalid chain")
        if not isinstance(chain.get("max_lag_seconds"), int) or chain["max_lag_seconds"] < 1:
            raise ValueError("Invalid chain lag threshold")
    for relation, limit in config.get("max_dead_rows", {}).items():
        if not IDENTIFIER.match(relation) or "." not in relation:
            raise ValueError("Dead-row relations must be schema-qualified identifiers")
        if not isinstance(limit, int) or limit < 1:
            raise ValueError("Invalid dead-row threshold")
    for item in config.get("market_checkpoints", []):
        if not isinstance(item.get("chain_id"), int) or not re.match(r"^[a-z0-9-]+$", item["name"]):
            raise ValueError("Invalid market checkpoint")
    for database in (config["indexer_database"], config["market_database"]):
        if not IDENTIFIER.match(database["name"]) or "." in database["name"]:
            raise ValueError("Invalid database name")
        if not isinstance(database.get("port", 5432), int):
            raise ValueError("Invalid database port")
    expected = {"indexer-ready", "lag", "oldest-transaction", "dead-rows", "metadata-worker",
                "observation", "market", "production-health"}
    checks = config.get("failure_checks", {})
    if set(checks) != expected or not all(isinstance(v, int) and v >= 1 for v in checks.values()):
        raise ValueError("failure_checks must set a positive count for every family")
    return config


def query_json(database, sql, run=subprocess.run):
    # Limits are set for every statement so that this monitor cannot become the
    # long-open transaction it reports. Peer authentication holds no credentials.
    result = run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", database["name"],
         "-p", str(database.get("port", 5432)), "-c", sql],
        capture_output=True, text=True, timeout=20, check=False,
        env={"PATH": "/usr/bin:/bin", "PGCONNECT_TIMEOUT": "5",
             "PGOPTIONS": "-c statement_timeout=10000 -c lock_timeout=2000 "
                          "-c idle_in_transaction_session_timeout=10000 "
                          "-c default_transaction_read_only=on"})
    if result.returncode != 0:
        raise RuntimeError("Database read failed")
    return json.loads(result.stdout)


def http_status(url, opener=urllib.request.urlopen):
    try:
        with opener(url, timeout=8) as response:
            return response.status, response.read(1024 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, b""


def indexer_sql(config):
    relations = ",".join(f"'{relation}'" for relation in config.get("max_dead_rows", {}))
    return f"""SELECT json_build_object(
  'oldest',(SELECT row_to_json(x) FROM (
    SELECT pid,usename AS "user",application_name AS application,state,
      round(extract(epoch FROM now()-xact_start))::bigint AS seconds,
      left(regexp_replace(query,'\\s+',' ','g'),120) AS query
    FROM pg_stat_activity
    WHERE datname=current_database() AND backend_type='client backend'
      AND backend_xmin IS NOT NULL AND pid<>pg_backend_pid()
    ORDER BY xact_start LIMIT 1) x),
  'dead',(SELECT json_object_agg(schemaname||'.'||relname,n_dead_tup) FROM pg_stat_all_tables
    WHERE schemaname||'.'||relname=ANY(ARRAY[{relations}]::text[])),
  'workerAge',(SELECT round(extract(epoch FROM now()-last_worker_at))::bigint
    FROM metadata.publication_runtime),
  'observations',(SELECT json_object_agg(chain_id,json_build_object(
      'age',round(extract(epoch FROM now())-observed_at_ms/1000.0)::bigint,'error',error_code))
    FROM yunipals_indexer_control.chain_status WHERE release_id='{config["release_id"]}'))"""


def market_sql(config):
    pairs = ",".join(f"({item['chain_id']},'{item['name']}')"
                     for item in config.get("market_checkpoints", []))
    return f"""SELECT coalesce(json_object_agg(name,json_build_object(
      'state',state,'error',last_error_code)),'{{}}'::json)
    FROM yunipals_market.checkpoint WHERE source='chain' AND (chain_id,name) IN ({pairs})"""


def bad(detail, reason="threshold_exceeded"):
    return {"ok": False, "reason": reason, "detail": detail}


def good(detail):
    return {"ok": True, "reason": None, "detail": detail}


def read_failed(detail):
    return bad(detail, "read_failed")


def collect(config, now, production_health=None, query=query_json, status=http_status):
    samples = {}
    families = {}

    def record(identifier, family, sample):
        samples[identifier] = sample
        families[identifier] = family

    url = config["ponder_url"]
    try:
        code, _ = status(f"{url}/ready")
        record("indexer-ready", "indexer-ready",
               good("Ponder is ready") if code == 200 else bad(f"/ready returned HTTP {code}"))
    except Exception:
        record("indexer-ready", "indexer-ready", read_failed("Ponder did not answer /ready"))
    lag = {}
    try:
        code, body = status(f"{url}/status")
        if code != 200:
            raise RuntimeError("Status unavailable")
        for name, chain in json.loads(body).items():
            lag[name] = round(now - chain["block"]["timestamp"])
    except Exception:
        lag = None
    for name, chain in config["chains"].items():
        identifier = f"lag-{name}"
        if lag is None or name not in lag:
            record(identifier, "lag", read_failed(f"No indexed block reported for {name}"))
        elif lag[name] > chain["max_lag_seconds"]:
            record(identifier, "lag",
                   bad(f"{name} is {lag[name]}s behind (limit {chain['max_lag_seconds']}s)"))
        else:
            record(identifier, "lag", good(f"{name} is {lag[name]}s behind"))

    try:
        indexer = query(config["indexer_database"], indexer_sql(config))
    except Exception:
        indexer = None
    oldest = indexer.get("oldest") if indexer else None
    if indexer is None:
        record("oldest-transaction", "oldest-transaction", read_failed("Indexer database read failed"))
    elif oldest and oldest["seconds"] > config["max_transaction_seconds"]:
        record("oldest-transaction", "oldest-transaction", bad(
            f"pid {oldest['pid']}, user {oldest['user']}, application "
            f"{oldest['application'] or '(none)'}, {oldest['state']}, open "
            f"{oldest['seconds']}s (limit {config['max_transaction_seconds']}s): {oldest['query']}"))
    else:
        record("oldest-transaction", "oldest-transaction",
               good(f"Oldest snapshot is {oldest['seconds'] if oldest else 0}s old"))
    dead = (indexer or {}).get("dead") or {}
    for relation, limit in config.get("max_dead_rows", {}).items():
        identifier = f"dead-rows-{relation}"
        if indexer is None or relation not in dead:
            record(identifier, "dead-rows", read_failed(f"No dead-row count for {relation}"))
        elif dead[relation] > limit:
            record(identifier, "dead-rows", bad(f"{relation} has {dead[relation]} dead rows (limit {limit})"))
        else:
            record(identifier, "dead-rows", good(f"{relation} has {dead[relation]} dead rows"))
    age = (indexer or {}).get("workerAge")
    if age is None:
        record("metadata-worker", "metadata-worker", read_failed("No metadata worker heartbeat"))
    elif age > config["max_worker_heartbeat_age_seconds"]:
        record("metadata-worker", "metadata-worker", bad(
            f"Last heartbeat {age}s ago (limit {config['max_worker_heartbeat_age_seconds']}s)"))
    else:
        record("metadata-worker", "metadata-worker", good(f"Last heartbeat {age}s ago"))
    observations = (indexer or {}).get("observations") or {}
    for name, chain in config["chains"].items():
        identifier = f"observation-{name}"
        observed = observations.get(str(chain["chain_id"]))
        if not observed or observed.get("age") is None:
            record(identifier, "observation", read_failed(f"No chain observation for {name}"))
        elif observed["error"]:
            record(identifier, "observation", bad(f"{name} observation error: {observed['error']}"))
        elif observed["age"] > config["max_observation_age_seconds"]:
            record(identifier, "observation", bad(f"{name} last observed {observed['age']}s ago"))
        else:
            record(identifier, "observation", good(f"{name} observed {observed['age']}s ago"))

    try:
        market = query(config["market_database"], market_sql(config))
    except Exception:
        market = None
    for item in config.get("market_checkpoints", []):
        identifier = f"market-{item['name']}"
        checkpoint = (market or {}).get(item["name"])
        if not checkpoint:
            record(identifier, "market", read_failed(f"No checkpoint for {item['name']}"))
        elif checkpoint["state"] != "available":
            record(identifier, "market", bad(
                f"{item['name']} is {checkpoint['state']}"
                + (f" ({checkpoint['error']})" if checkpoint["error"] else "")))
        else:
            record(identifier, "market", good(f"{item['name']} is available"))

    if production_health is None:
        record("production-health", "production-health", read_failed("Report could not be read"))
    else:
        checked = datetime.datetime.fromisoformat(production_health["checkedAt"]).timestamp()
        report_age = round(now - checked)
        if report_age > config["max_production_health_age_seconds"]:
            record("production-health", "production-health", bad(f"Report is {report_age}s old"))
        elif production_health["healthy"] is not True:
            failures = ", ".join(str(item) for item in production_health.get("failures", [])[:8])
            record("production-health", "production-health", bad(f"Failing: {failures}"))
        else:
            record("production-health", "production-health", good("Healthy"))
    return samples, families, {"lag": lag, "oldest": oldest, "dead": dead, "workerAge": age}


def rule(config, family):
    return {"failure_checks": config["failure_checks"][family],
            "recovery_checks": config["recovery_checks"],
            "maximum_check_gap_seconds": config["maximum_check_gap_seconds"]}


def notification(events, states, families, metrics):
    lines = ["Yunipals indexer health monitoring", ""]
    for identifier, event in events:
        lines.append(f"{event.upper()}: {identifier}")
        lines.append(states[identifier]["latest"]["detail"])
        if event == "alert":
            lines.append(HINTS[families[identifier]])
        lines.append("")
    lines.append(f"Chain lag in seconds: {json.dumps(metrics['lag'])}")
    lines.append("")
    lines.append("Per-minute history is in /var/lib/yunipals-indexer-health-monitor.")
    lines.append("No automatic changes were made.")
    kind = "ALERT" if any(event == "alert" for _, event in events) else "RECOVERED"
    names = ", ".join(identifier for identifier, _ in events[:4])
    if len(events) > 4:
        names += f" and {len(events) - 4} more"
    return f"[Yunipals] {kind}: indexer health: {names}", "\n".join(lines)


def cycle(config, directory, production_health=None, read=collect, deliver=send_email, now=None):
    now = time.time() if now is None else now
    state_file = directory / "state.json"
    # A corrupt existing state is an error, not an excuse to send duplicate alerts.
    previous = json.loads(state_file.read_text()) if state_file.exists() else {}
    samples, families, metrics = read(config, now, production_health)
    states = {}
    events = []
    for identifier, sample in samples.items():
        limits = rule(config, families[identifier])
        states[identifier] = advance(previous.get(identifier, {}), sample, now, limits)
        event = pending_event(states[identifier], limits)
        if event:
            events.append((identifier, event))
    atomic_json(state_file, states)
    delivery = "disabled" if not config["email_enabled"] else "idle"
    if events and config["email_enabled"]:
        try:
            deliver(*notification(events, states, families, metrics))
        except Exception:
            # Keep events pending and retry next minute. Do not print SMTP errors/credentials.
            delivery = "failed"
        else:
            for identifier, event in events:
                states[identifier]["notified"] = event == "alert"
                states[identifier]["notification_at"] = now
            atomic_json(state_file, states)
            delivery = "sent"
    report = {"checkedAt": datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat(),
              "failing": sorted(i for i, sample in samples.items() if not sample["ok"]),
              "metrics": metrics, "pendingEvents": events, "emailDelivery": delivery}
    atomic_json(directory / "latest.json", report)
    history = directory / f"samples-{report['checkedAt'][:10]}.jsonl"
    with history.open("a") as output:
        history.chmod(0o600)
        output.write(json.dumps(report) + "\n")
    for old in directory.glob("samples-????-??-??.jsonl"):
        if old.stat().st_mtime < now - 7 * 86400:
            old.unlink()
    return report


def report_monitor_failure(directory, deliver=send_email, now=None):
    # Failures here would otherwise be silent, so send at most one email an hour.
    now = time.time() if now is None else now
    marker = directory / "failure-alert"
    if marker.exists() and now - marker.stat().st_mtime < FAILURE_ALERT_INTERVAL_SECONDS:
        return False
    deliver("[Yunipals] ALERT: indexer health monitor is failing",
            "The indexer health monitor could not complete a check. Its alerts are not working.\n"
            "Run: journalctl -u yunipals-indexer-health-monitor.service")
    marker.touch()
    return True


def read_production_health(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--production-health", required=True)
    parser.add_argument("--test-email", action="store_true")
    args = parser.parse_args()
    config = validate_config(json.loads(Path(args.config).read_text()))
    directory = Path(args.state_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / "run.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if args.test_email:
            if not config["email_enabled"]:
                raise ValueError("Email is disabled")
            send_email("[Yunipals] Indexer health monitoring test",
                       "Email delivery for indexer health monitoring is configured.")
            print(json.dumps({"testEmail": "accepted_by_smtp"}))
            return
        try:
            result = cycle(config, directory, read_production_health(args.production_health))
        except Exception:
            report_monitor_failure(directory)
            raise
        print(json.dumps(result))
        if result["emailDelivery"] == "failed":
            raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"error": "indexer_health_monitor_failed_check_configuration_or_state"}))
        raise SystemExit(1)
