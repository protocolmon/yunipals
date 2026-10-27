#!/usr/bin/env python3
"""Enable or remove maintenance responses on the Yunipals backend hosts."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


CONFIG = Path("/etc/nginx/sites-available/polychainmonsters")
STATE = Path("/var/backups/yunipals-cold-maintenance-20261026")
HOSTS = {"api.yunipals.com", "app.yunipals.com"}
PAGE = Path("/var/www/yunipals-maintenance/cold-maintenance.html")
HOOK = """
    # Yunipals cold maintenance; remove with maintenance.py off.
    error_page 503 =503 /__yunipals_cold_maintenance.html;
    location = /__yunipals_cold_maintenance.html {
        internal;
        alias /var/www/yunipals-maintenance/cold-maintenance.html;
        add_header Cache-Control "no-store" always;
        add_header Retry-After "300" always;
        add_header X-Robots-Tag "noindex" always;
    }
    if ($host ~* ^(api|app)\\.yunipals\\.com$) { return 503; }
"""


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def blocks(text):
    tokens = list(re.finditer(r'''\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};]+''', text))
    tokens = [token for token in tokens if not token.group().startswith("#")]
    depth = 0
    start = None
    server_depth = None
    names = set()
    for i, token in enumerate(tokens):
        value = token.group()
        if value == "{" :
            depth += 1
            if i and tokens[i - 1].group() == "server":
                start, server_depth, names = token.end(), depth, set()
        elif value == "}":
            if start is not None and depth == server_depth:
                yield start, names
                start = server_depth = None
            depth -= 1
        elif value == "server_name" and start is not None and depth == server_depth:
            for following in tokens[i + 1:]:
                if following.group() == ";":
                    break
                names.add(following.group().strip("\"'"))
    if depth != 0:
        raise RuntimeError("Unbalanced nginx configuration")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["on", "off", "status"])
    args = parser.parse_args()
    raw = CONFIG.read_bytes()
    if args.action == "status":
        print(json.dumps({"maintenance": HOOK.encode() in raw, "configSha256": digest(raw)}))
        return
    if args.action == "on":
        if STATE.exists():
            raise RuntimeError("Maintenance state already exists; inspect status before changing it")
        selected = [(position, names) for position, names in blocks(raw.decode()) if names & HOSTS]
        if set().union(*(names & HOSTS for _, names in selected)) != HOSTS:
            raise RuntimeError("Both Yunipals backend hosts must be present")
        STATE.mkdir(mode=0o700)
        (STATE / "nginx.before").write_bytes(raw)
        (STATE / "nginx.before").chmod(0o600)
        text = raw.decode()
        for position, _ in reversed(selected):
            text = text[:position] + HOOK + text[position:]
        updated = text.encode()
        (STATE / "nginx.after.sha256").write_text(digest(updated))
        PAGE.parent.mkdir(parents=True, exist_ok=True)
        PAGE.write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yunipals · Maintenance</title><body style="font-family:system-ui;background:#f6f2ff;color:#101727;padding:10vh 8vw"><h1>Yunipals will be back soon.</h1><p>Maintenance is in progress. Please try again shortly.</p><p>Your NFTs and tokens stay in your wallet.</p></body></html>')
        PAGE.chmod(0o644)
    else:
        if digest(raw) != (STATE / "nginx.after.sha256").read_text():
            raise RuntimeError("Proxy configuration changed during maintenance; inspect before restoring")
        updated = (STATE / "nginx.before").read_bytes()
    temporary = CONFIG.with_name(CONFIG.name + ".cold-maintenance-new")
    with temporary.open("xb") as stream:
        stream.write(updated)
    temporary.chmod(CONFIG.stat().st_mode & 0o777)
    temporary.replace(CONFIG)
    check = subprocess.run(["/usr/sbin/nginx", "-t"], capture_output=True)
    if check.returncode:
        CONFIG.write_bytes(raw)
        raise RuntimeError("Nginx validation failed; previous configuration restored without reload")
    subprocess.run(["/usr/bin/systemctl", "reload", "nginx.service"], check=True)
    result = {"maintenance": args.action == "on", "configSha256": digest(updated), "hosts": sorted(HOSTS)}
    (STATE / (args.action + ".json")).write_text(json.dumps(result))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
