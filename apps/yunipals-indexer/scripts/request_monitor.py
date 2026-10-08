#!/usr/bin/env python3
"""Probe public collection reads and email persistent incident transitions."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import smtplib
import ssl
import subprocess
import time
from email.message import EmailMessage
from urllib.parse import urlsplit


MAX_BODY_BYTES = 2 * 1024 * 1024


def validate_config(config):
    for name, low, high in (("slow_seconds", 1, 60), ("timeout_seconds", 2, 90),
                            ("failure_checks", 1, 10), ("recovery_checks", 1, 10),
                            ("maximum_check_gap_seconds", 60, 3600)):
        value = config.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise ValueError(f"Invalid {name}")
    if any(not isinstance(config[name], int) for name in ("failure_checks", "recovery_checks")):
        raise ValueError("Consecutive-check thresholds must be integers")
    if config["timeout_seconds"] <= config["slow_seconds"]:
        raise ValueError("timeout_seconds must exceed slow_seconds")
    routes = config.get("routes", [])
    if not 1 <= len(routes) <= 12:
        raise ValueError("Configure between one and twelve routes")
    if len(routes) * (config["timeout_seconds"] + 2) > 120:
        raise ValueError("Combined probe deadline must fit within two minutes")
    ids = set()
    for route in routes:
        url = urlsplit(route["url"])
        if (not url.hostname or url.username or url.password or url.fragment
                or url.scheme != "https"):
            raise ValueError("Probe URLs must be public HTTPS URLs without credentials")
        if route["kind"] not in ("evm", "solana", "islands", "staking"):
            raise ValueError("Invalid route kind")
        if not route["id"] or route["id"] in ids:
            raise ValueError("Route IDs must be nonempty and unique")
        ids.add(route["id"])
    if not isinstance(config.get("email_enabled"), bool):
        raise ValueError("email_enabled must be true or false")
    return config


def valid_response(kind, body):
    if not isinstance(body, dict):
        return False
    if kind == "staking":
        return body.get("enabled") is True and body.get("ready") is True
    items = body.get("items")
    if not isinstance(items, list) or not items or not isinstance(body.get("total"), int):
        return False
    if body["total"] < len(items):
        return False
    chains = {"solana"} if kind == "solana" else {"ethereum", "base", "polygon", "bnb"}
    return all(isinstance(item, dict) and isinstance(item.get("tokenId"), str)
               and item.get("chain") in chains and item.get("burned") is not True
               and (kind != "islands" or item.get("collectionId") == "ethereum-islands")
               for item in items)


def probe(route, config, run=subprocess.run, clock=time.monotonic):
    started = clock()
    status = 0
    reason = "request_failed"
    try:
        result = run([
            "curl", "--silent", "--show-error", "--proto", "=https",
            "--connect-timeout", "5", "--max-time", str(config["timeout_seconds"]),
            "--max-filesize", str(MAX_BODY_BYTES),
            "--header", "Accept: application/json",
            "--header", "Origin: https://www.yunipals.com",
            "--user-agent", "Yunipals-Request-Monitor/1.0",
            "--write-out", "\n%{http_code}", route["url"]
        ], capture_output=True, timeout=config["timeout_seconds"] + 2)
        raw, code = result.stdout.rsplit(b"\n", 1)
        status = int(code)
        if result.returncode:
            reason = "timeout" if result.returncode == 28 else "request_failed"
        elif status != 200:
            reason = "http_error"
        elif len(raw) > MAX_BODY_BYTES or not valid_response(route["kind"], json.loads(raw)):
            reason = "invalid_or_unready_response"
        else:
            reason = None
    except subprocess.TimeoutExpired:
        reason = "timeout"
    except (OSError, ValueError, TypeError):
        reason = "invalid_or_failed_response"
    elapsed = round(clock() - started, 3)
    if reason is None and elapsed > config["slow_seconds"]:
        reason = "slow_response"
    return {"ok": reason is None, "seconds": elapsed, "status": status, "reason": reason}


def advance(previous, sample, now, config):
    state = dict(previous)
    if now - state.get("checked_at", now) > config["maximum_check_gap_seconds"]:
        state["bad"] = state["good"] = 0
    state.update(checked_at=now, latest=sample)
    if sample["ok"]:
        state["bad"] = 0
        state["good"] = state.get("good", 0) + 1
        if state.get("active") and state["good"] >= config["recovery_checks"]:
            state.update(active=False, recovered_at=now)
    else:
        state["good"] = 0
        state["bad"] = state.get("bad", 0) + 1
        if not state.get("active") and state["bad"] >= config["failure_checks"]:
            state.update(active=True, opened_at=now)
    return state


def pending_event(state, config):
    if state.get("active") and not state.get("notified"):
        return "alert"
    if (not state.get("active") and state.get("notified")
            and state.get("good", 0) >= config["recovery_checks"]):
        return "recovery"
    return None


def atomic_json(path, value):
    temporary = path.with_suffix(".next")
    with temporary.open("w") as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def send_email(subject, body):
    # Credentials are supplied by a private systemd EnvironmentFile, never logged.
    host = os.environ["MONITOR_SMTP_HOST"]
    sender = os.environ["MONITOR_EMAIL_FROM"]
    recipient = os.environ["MONITOR_EMAIL_TO"]
    mode = os.environ.get("MONITOR_SMTP_TLS", "starttls")
    if mode not in ("starttls", "implicit"):
        raise ValueError("SMTP requires TLS")
    if any("\n" in value or "\r" in value for value in (host, sender, recipient)):
        raise ValueError("Invalid mail configuration")
    port = int(os.environ.get("MONITOR_SMTP_PORT", "465" if mode == "implicit" else "587"))
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = sender, recipient, subject
    message.set_content(body)
    context = ssl.create_default_context()
    connection = (smtplib.SMTP_SSL(host, port, timeout=15, context=context)
                  if mode == "implicit" else smtplib.SMTP(host, port, timeout=15))
    with connection as smtp:
        if mode == "starttls":
            smtp.starttls(context=context)
        username = os.environ.get("MONITOR_SMTP_USER")
        if username:
            smtp.login(username, os.environ["MONITOR_SMTP_PASSWORD"])
        if smtp.send_message(message):
            raise RuntimeError("Recipient refused")


def notification(events, routes, states, config):
    labels = {route["id"]: route for route in routes}
    lines = ["Yunipals public request monitoring", "",
             f"Threshold: over {config['slow_seconds']} seconds or a failed/invalid response; "
             f"{config['failure_checks']} consecutive checks to alert, "
             f"{config['recovery_checks']} healthy checks to recover.", ""]
    for route_id, event in events:
        state = states[route_id]
        sample = state["latest"]
        lines.extend([f"{event.upper()}: {labels[route_id]['name']}", labels[route_id]["url"],
                      f"Latest: {sample['seconds']:.3f}s, HTTP {sample['status']}, "
                      f"{sample['reason'] or 'healthy'}", ""])
    lines.append("Check the API logs and database query timings. No automatic changes were made.")
    kind = "ALERT" if any(event == "alert" for _, event in events) else "RECOVERED"
    return f"[Yunipals] {kind}: public collection requests", "\n".join(lines)


def cycle(config, directory, sample_route=probe, deliver=send_email, now=None):
    now = time.time() if now is None else now
    state_file = directory / "state.json"
    # A corrupt existing state is an error, not an excuse to send duplicate alerts.
    states = json.loads(state_file.read_text()) if state_file.exists() else {}
    samples = {}
    for route in config["routes"]:
        route_id = route["id"]
        samples[route_id] = sample_route(route, config)
        states[route_id] = advance(states.get(route_id, {}), samples[route_id], now, config)
    events = [(route["id"], pending_event(states[route["id"]], config)) for route in config["routes"]]
    events = [(route_id, event) for route_id, event in events if event]
    atomic_json(state_file, states)
    delivery = "disabled" if not config["email_enabled"] else "idle"
    if events and config["email_enabled"]:
        try:
            deliver(*notification(events, config["routes"], states, config))
        except Exception:
            # Keep events pending and retry next minute. Do not print SMTP errors/credentials.
            delivery = "failed"
        else:
            for route_id, event in events:
                states[route_id]["notified"] = event == "alert"
                states[route_id]["notification_at"] = now
            atomic_json(state_file, states)
            delivery = "sent"
    report = {"checkedAt": datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat(),
              "samples": samples, "pendingEvents": events, "emailDelivery": delivery}
    atomic_json(directory / "latest.json", report)
    # Bounded per-day timing history; never save response bodies or private headers.
    history = directory / f"samples-{report['checkedAt'][:10]}.jsonl"
    with history.open("a") as output:
        os.chmod(history, 0o600)
        output.write(json.dumps(report) + "\n")
    for old in directory.glob("samples-????-??-??.jsonl"):
        if old.stat().st_mtime < now - 7 * 86400:
            old.unlink()
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
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
            send_email("[Yunipals] Monitoring test", "Email delivery for Yunipals request monitoring is configured. This is a test, not an incident.")
            print(json.dumps({"testEmail": "accepted_by_smtp"}))
            return
        result = cycle(config, directory)
        print(json.dumps(result))
        if result["emailDelivery"] == "failed":
            raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"error": "request_monitor_failed_check_configuration_or_state"}))
        raise SystemExit(1)
