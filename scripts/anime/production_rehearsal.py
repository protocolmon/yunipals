#!/usr/bin/env python3
"""Private rehearsal using the production provider routes; never signs or writes the production DB.

One direct OpenAI Responses submission and one OpenRouter choreography submission.
Saved provider IDs permit retrieval only. Keys stay in their existing server files.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import time

import rehearsal_api as router

OPENAI_PRICING = {
    "model": "gpt-6.1-sol", "inputUsdPerMillion": 2,
    "cachedInputUsdPerMillion": .1, "cacheWriteUsdPerMillion": 2.5,
    "outputUsdPerMillion": 10, "serviceTier": "default",
    "verifiedOn": "2026-10-29",
    "source": "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
}


def authorization(job):
    value = router.read(job / "authorization.json")
    if value.get("version") != "anime-production-rehearsal/v1" or value.get("maxSpendMicrousd") != 1500000 or value.get("expectedTasks") != ["referee", "opus"] or value.get("providers") != {"referee": "openai-responses", "opus": "openrouter"}:
        raise ValueError("Production-route rehearsal authorization changed")
    return value


def usage_cost(response):
    if response.get("service_tier") != "default":
        raise ValueError("Returned service tier does not match the verified rate card")
    usage = response.get("usage") or {}
    details = usage.get("input_tokens_details") or {}
    def count(container, name):
        value = container.get(name)
        if type(value) is not int or value < 0:
            raise ValueError("Complete nonnegative token accounting is required: " + name)
        return value
    inputs, outputs = count(usage, "input_tokens"), count(usage, "output_tokens")
    cached, writes = count(details, "cached_tokens"), count(details, "cache_write_tokens")
    if cached + writes > inputs or inputs > 120000 or outputs > 32000 or count(usage, "total_tokens") != inputs + outputs:
        raise ValueError("Token accounting exceeds the production request envelope")
    # Output already includes reasoning tokens: never add those a second time.
    return round(((inputs-cached-writes)*2 + cached*.1 + writes*2.5 + outputs*10)/1000000, 8)


def referee_step(job, key, client):
    auth = authorization(job)
    folder = job / "tasks/referee"
    task, request = router.read(folder / "task.json"), router.read(folder / "request.json")
    if hashlib.sha256((folder / "request.json").read_bytes()).hexdigest() != task["requestSha256"]:
        raise ValueError("Frozen referee request checksum changed")
    if set(request) != {"model", "reasoning", "service_tier", "background", "store", "max_output_tokens", "instructions", "input", "tools", "text"} or json.loads(request["input"]).get("sourceInputSha256") != auth["inputSha256"]:
        raise ValueError("Referee request does not bind the fresh frozen input")
    if task["model"] != "gpt-6.1-sol" or task["reservedMicrousd"] != 700000 or request.get("model") != task["model"] or request.get("reasoning") != {"effort": "xhigh"} or request.get("service_tier") != "default" or request.get("background") is not True or request.get("store") is not True or request.get("max_output_tokens") != 32000 or request.get("tools") != [] or len(json.dumps(request).encode()) > 120000:
        raise ValueError("Referee request differs from the production settings")
    fmt = (request.get("text") or {}).get("format") or {}
    if fmt.get("type") != "json_schema" or fmt.get("name") != "arena_outcome" or fmt.get("strict") is not True:
        raise ValueError("Referee output schema is not the production format")
    # Reuse the maintained one-shot Responses transport, upgrading its writes to
    # fsync receipts before POST. No retry path can create a second submission.
    client.save = router.save
    receipt = client.step(job, {"asset": "tasks/referee", "provider": "openai",
        "model": task["model"], "requestId": task["requestId"],
        "requestFile": "tasks/referee/request.json", "reservedUsd": .7}, key)
    receipt.update(provider="openai", model=task["model"], actualCostUsd=None,
        billingReconciled=False, costBasis="Reported token usage at published Standard rates; not invoice-reconciled")
    if receipt["state"] == "completed":
        response = router.read(folder / "response.json")
        if response.get("id") != receipt.get("providerId"):
            raise ValueError("Saved referee response ID changed")
        if response.get("model") != "gpt-6.1-sol" and not re.fullmatch(r"gpt-6\.1-sol-\d{4}-\d{2}-\d{2}", str(response.get("model", ""))):
            raise ValueError("Referee returned a different model")
        cost = usage_cost(response)
        if cost > .7:
            raise ValueError("Observed referee usage cost exceeds its reservation")
        receipt.update(usageBasedCostUsd=cost, usage=response["usage"], rateCard=OPENAI_PRICING)
        receipt.pop("estimatedCostUsd", None)
    router.save(folder / "receipt.json", receipt)
    return receipt


def load_client(root):
    file = root / "scripts/arena/validate_api.py"
    spec = importlib.util.spec_from_file_location("arena_responses_transport", file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("task", choices=["referee", "opus"])
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--wait", action="store_true")
    args = parser.parse_args()
    job = args.job.resolve()
    if socket.gethostname() != "yunipals-main" or not str(job).startswith("/var/lib/yunipals-anime-arena/rehearsals/"):
        raise ValueError("Use a private rehearsal on the verified indexer server")
    os.umask(0o077)
    authorization(job)
    client = load_client(args.repository.resolve())
    path = Path("/etc/yunipals-arena/arena.env" if args.task == "referee" else "/etc/yunipals-anime-arena/openrouter.env")
    if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise ValueError("Expected the existing root-owned private credential file")
    key = client.secret(path, "OPENAI_API_KEY") if args.task == "referee" else router.secret(path)
    deadline = time.monotonic() + 1200
    with (job / ".production-provider.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        while True:
            receipt = referee_step(job, key, client) if args.task == "referee" else router.step(job, "opus", key)
            print(json.dumps({k: receipt.get(k) for k in ["state", "model", "submissions", "usageBasedCostUsd", "actualCostUsd", "elapsedSeconds"]}), flush=True)
            if receipt["state"] == "completed":
                break
            if not args.wait or receipt["state"] not in ("queued", "in_progress") or time.monotonic() > deadline:
                raise ValueError("Original generation needs recovery; no replacement was submitted")
            time.sleep(10)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(json.dumps({"state": "needs-attention", "error": str(error) if isinstance(error, ValueError) else type(error).__name__}))
        raise SystemExit(1)
