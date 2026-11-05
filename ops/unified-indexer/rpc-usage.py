#!/usr/bin/env python3
"""Show which RPC providers the Yunipals RPC gateways use, and who calls them.

Run as root on yunipals-main:  python3 rpc-usage.py

Read-only. It reads each gateway's effective environment, its local /metrics,
and established TCP connections. URLs are reduced to hostnames, so API keys in
paths or credentials are never printed.
"""
import collections
import json
import re
import socket
import subprocess
import urllib.request
from urllib.parse import urlsplit

UNIT_PATTERN = re.compile(r"^yunipals-.*rpc@[a-z0-9-]+\.service$")
UPSTREAM_KEY = re.compile(r"^MARKET_RPC_PROXY_(.*UPSTREAMS?)$")
FLAG_KEY = re.compile(r"^MARKET_RPC_PROXY_(.*PAID.*|UNIFIED_SOURCE_QUEUE)$")


def run(arguments):
    return subprocess.run(arguments, capture_output=True, text=True, check=False).stdout


def host(url):
    url = url.strip().strip("'\"")
    if not url:
        return None
    parts = urlsplit(url if "://" in url else f"https://{url}")
    return parts.hostname


def environment(pid):
    try:
        raw = open(f"/proc/{pid}/environ", "rb").read().split(b"\0")
    except OSError:
        return {}
    pairs = (item.decode(errors="replace").split("=", 1) for item in raw if b"=" in item)
    return {key: value for key, value in pairs}


def unit_of(pid):
    try:
        for line in open(f"/proc/{pid}/cgroup"):
            name = line.strip().rsplit("/", 1)[-1]
            if name.endswith(".service"):
                return name
    except OSError:
        pass
    return f"pid {pid}"


def connections():
    rows = []
    for line in run(["ss", "-tnpH", "state", "established"]).splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        local, remote = fields[2], fields[3]
        pids = [int(pid) for pid in re.findall(r"pid=(\d+)", line)]
        rows.append((local, remote, pids))
    return rows


def resolve(names):
    addresses = collections.defaultdict(set)
    for name in names:
        try:
            for info in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP):
                addresses[info[4][0]].add(name)
        except OSError:
            pass
    return addresses


def address(endpoint):
    return endpoint.rsplit(":", 1)[0].strip("[]")


def main():
    units = sorted(line.split()[0] for line in run(
        ["systemctl", "list-units", "--type=service", "--state=running", "--plain", "--no-legend"]
    ).splitlines() if line and UNIT_PATTERN.match(line.split()[0]))
    gateways = []
    for unit in units:
        pid = int(run(["systemctl", "show", unit, "-p", "MainPID", "--value"]).strip() or 0)
        env = environment(pid)
        roles = {}
        for key, value in sorted(env.items()):
            match = UPSTREAM_KEY.match(key)
            if match:
                hosts = [host(item) for item in value.split(",")]
                roles[match.group(1).lower()] = [item for item in hosts if item]
        flags = {FLAG_KEY.match(k).group(1).lower(): v.strip("'\"")
                 for k, v in sorted(env.items()) if FLAG_KEY.match(k)}
        gateways.append({"unit": unit, "pid": pid, "port": env.get("MARKET_RPC_PROXY_PORT"),
                         "chain": env.get("MARKET_RPC_PROXY_CHAIN_ID"), "roles": roles, "flags": flags})

    known = resolve({h for gateway in gateways for hosts in gateway["roles"].values() for h in hosts})
    established = connections()
    for gateway in gateways:
        print(f"\n== {gateway['unit']}  chain {gateway['chain']}  port {gateway['port']}  pid {gateway['pid']}")
        for role, hosts in gateway["roles"].items():
            label = "PAID" if role == "upstream" else role
            print(f"  {label:28} {', '.join(hosts) or '(none)'}")
        enabled = [name for name, value in gateway["flags"].items() if value == "true"]
        print(f"  paid or queue flags set true: {', '.join(enabled) or 'none'}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{gateway['port']}/metrics", timeout=5) as response:
                metrics = json.load(response)
            traffic = metrics["traffic"]
            paid = sum(w.get("paidCalls", 0) for w in traffic.get("workloads", {}).values())
            print(f"  calls since start: free {traffic.get('freeCalls')}, paid {paid}, "
                  f"free failures {traffic.get('freeFailures')}, rate-limited {traffic.get('overloadedBatches')}")
            print(f"  free methods: {json.dumps(traffic.get('methods', {}).get('free', {}))}")
            print(f"  preferred pool index: {json.dumps(metrics.get('preferredFreeEndpoints', {}))}")
        except Exception:
            print("  metrics unavailable")
        upstream = collections.Counter()
        callers = collections.Counter()
        for local, remote, pids in established:
            if gateway["pid"] in pids and remote.endswith(":443"):
                ip = address(remote)
                upstream[", ".join(sorted(known.get(ip, {f"unrecognised {ip}"})))] += 1
            if gateway["port"] and remote.endswith(f":{gateway['port']}") and gateway["pid"] not in pids:
                for pid in pids:
                    callers[unit_of(pid)] += 1
        print("  open connections to providers now: "
              + (", ".join(f"{name} x{count}" for name, count in upstream.most_common()) or "none"))
        print("  callers connected now: "
              + (", ".join(f"{name} x{count}" for name, count in callers.most_common()) or "none"))

    gateway_pids = {gateway["pid"] for gateway in gateways}
    direct = collections.Counter()
    for local, remote, pids in established:
        ip = address(remote)
        if remote.endswith(":443") and ip in known and not gateway_pids.intersection(pids):
            for pid in pids:
                direct[(unit_of(pid), ", ".join(sorted(known[ip])))] += 1
    print("\n== Services connected to these providers without a gateway")
    for (unit, provider), count in sorted(direct.items()):
        print(f"  {unit} -> {provider} x{count}")
    if not direct:
        print("  none")
    print("\nShared CDN addresses can map to several hostnames. A gateway with no open")
    print("connection right now may still use that provider between requests.")


if __name__ == "__main__":
    main()
