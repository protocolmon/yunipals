#!/usr/bin/env python3
"""One authorized private comparison. Credentials stay on yunipals-main.

Every task is persisted before POST. A lost stream permits accounting recovery,
never an automatic replacement generation. No wallet or production DB is used.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import time
import urllib.error
import urllib.request

MODELS = {
    "referee": ("openai/gpt-6.1-sol", 700000, 32000, 120000),
    "haiku": ("anthropic/claude-haiku-5.5", 20000, 4096, 60000),
    "opus": ("anthropic/claude-opus-5.5", 800000, 16384, 60000),
}


def read(path):
    return json.loads(path.read_text())


def save(path, value):
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def secret(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Expected a root-owned credential file with mode 0600")
        contents = handle.read(65537)
    matches = re.findall(r"^\s*OPENROUTER_API_KEY\s*=\s*([^\r\n]+)", contents, re.M)
    if len(contents) > 65536 or len(matches) != 1:
        raise ValueError("OpenRouter credential setting is unavailable")
    value = matches[0].strip().strip("\"'")
    if not value or any(c.isspace() for c in value):
        raise ValueError("OpenRouter credential setting is malformed")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http(key, endpoint, body=None, request_id=None):
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if request_id:
        headers["X-Client-Request-Id"] = request_id
    request = urllib.request.Request("https://openrouter.ai/api/v1/" + endpoint,
        headers=headers, data=None if body is None else json.dumps(body).encode())
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=900 if body else 30)


def get(key, endpoint):
    with http(key, endpoint) as response:
        body = response.read(1000001)
    if len(body) > 1000000:
        raise ValueError("Oversized provider metadata response")
    return json.loads(body)


def available(key):
    credits = get(key, "credits")["data"]
    limits = get(key, "key")["data"]
    remaining = max(0, credits["total_credits"] - credits["total_usage"])
    if limits.get("limit_remaining") is not None:
        remaining = min(remaining, limits["limit_remaining"])
    return remaining


def stream_response(key, response, folder, receipt, receipt_path):
    chunks, finish, usage, model, generation = [], None, None, None, None
    if "text/event-stream" not in response.headers.get("Content-Type", ""):
        raw = response.read(1000001)
        if len(raw) > 1000000:
            raise ValueError("Oversized model response")
        value = json.loads(raw.decode("utf8").replace(key, "[redacted]"))
        save(folder / "response.json", value)
        if not re.fullmatch(r"gen-[A-Za-z0-9_-]+", str(value.get("id", ""))):
            raise ValueError("Provider returned no generation ID")
        receipt["generationId"] = value["id"]
        save(receipt_path, receipt)
        return value
    with (folder / "response.sse").open("w") as raw:
        os.chmod(folder / "response.sse", 0o600)
        total = 0
        for line in response:
            total += len(line)
            if total > 4000000:
                raise ValueError("Oversized model stream")
            text = line.decode("utf8").replace(key, "[redacted]")
            raw.write(text)
            raw.flush()
            if not text.startswith("data:"):
                continue
            data = text[5:].strip()
            if data == "[DONE]":
                break
            value = json.loads(data)
            if value.get("error"):
                raise ValueError("Model stream returned an error")
            if value.get("id"):
                if not re.fullmatch(r"gen-[A-Za-z0-9_-]+", value["id"]) or (generation and generation != value["id"]):
                    raise ValueError("Model generation ID changed")
                generation = value["id"]
                if not receipt.get("generationId"):
                    receipt.update(generationId=generation, state="in_progress")
                    save(receipt_path, receipt)
            model = value.get("model") or model
            if value.get("usage"):
                usage = value["usage"]
            choices = value.get("choices") or []
            if choices:
                choice = choices[0]
                content = choice.get("delta", {}).get("content")
                if isinstance(content, str):
                    chunks.append(content)
                finish = choice.get("finish_reason") or finish
        raw.flush()
        os.fsync(raw.fileno())
    if not generation or finish is None:
        raise ValueError("Model stream ended before a complete result")
    return {"id": generation, "model": model, "choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": "".join(chunks)}}], "usage": usage}


def account(key, response, receipt):
    cost = (response.get("usage") or {}).get("cost")
    def valid(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
    if not valid(cost):
        metadata = get(key, "generation?id=" + receipt["generationId"])["data"]
        if metadata.get("id") != receipt["generationId"]:
            raise ValueError("Generation accounting ID mismatch")
        cost = metadata.get("total_cost")
        receipt["generationMetadata"] = metadata
    if not valid(cost):
        raise ValueError("Actual provider charge is unavailable")
    receipt.update(actualCostUsd=cost, usage=response.get("usage"))
    return receipt


def step(job, name, key, caller=http):
    folder = job / "tasks" / name
    task, request = read(folder / "task.json"), read(folder / "request.json")
    auth = read(job / "authorization.json")
    model, reserve, output, envelope = MODELS[name]
    if task["model"] != model or request["model"] != model or task["reservedMicrousd"] != reserve or request["max_tokens"] != output:
        raise ValueError("Request differs from the authorized model and output limits")
    prices={"referee":{"prompt":2.5,"completion":10},"haiku":{"prompt":0.2,"completion":1},"opus":{"prompt":5,"completion":20}}
    expected_provider={"order":["OpenAI" if name=="referee" else "Anthropic"],"allow_fallbacks":False,"require_parameters":True,"max_price":prices[name]}
    if request.get("provider")!=expected_provider or request.get("tools") or request.get("plugins"):
        raise ValueError("Provider routing or price limits differ from authorization")
    if hashlib.sha256((folder / "request.json").read_bytes()).hexdigest() != task["requestSha256"] or len(json.dumps(request).encode()) > envelope:
        raise ValueError("Frozen request checksum or input envelope failed")
    comparison = auth["maxSpendMicrousd"] == 1520000 and auth["expectedTasks"] == list(MODELS)
    choreography = auth.get("version") == "anime-choreography-review/v1" and auth["maxSpendMicrousd"] == 800000 and auth["expectedTasks"] == ["opus"]
    production = auth.get("version") == "anime-production-rehearsal/v1" and auth["maxSpendMicrousd"] == 1500000 and auth["expectedTasks"] == ["referee", "opus"] and name == "opus"
    if not (comparison or choreography or production) or name not in auth["expectedTasks"]:
        raise ValueError("Rehearsal authorization differs from the approved tasks")
    path = folder / "receipt.json"
    receipt = read(path) if path.exists() else {"state": "reserved", "requestId": task["requestId"], "model": model, "reservedMicrousd": reserve, "submissions": 0, "actualCostUsd": None}
    if receipt["requestId"] != task["requestId"]:
        raise ValueError("Saved task identity changed")
    if receipt["state"] in ("completed", "incomplete", "failed"):
        return receipt
    if receipt["state"] == "reserved":
        save(path, receipt)
        if available(key) * 1000000 < reserve:
            raise ValueError("OpenRouter credit is below this task's conservative reservation")
        receipt.update(state="submitting", submissions=1, startedAt=time.time())
        save(path, receipt)
        try:
            with caller(key, "chat/completions", request, task["requestId"]) as response:
                value = stream_response(key, response, folder, receipt, path)
            save(folder / "response.json", value)
            receipt.update(state="accounting", generationId=value["id"], elapsedSeconds=round(time.time() - receipt["startedAt"], 3))
            save(path, receipt)
        except Exception as error:
            diagnostic = {"exception": type(error).__name__}
            if isinstance(error, urllib.error.HTTPError):
                diagnostic["httpStatus"] = error.code
                raw = error.read(1000001).decode("utf8", errors="replace").replace(key, "[redacted]")
                diagnostic["body"] = raw[:1000000]
                generation = error.headers.get("X-Generation-Id", "")
                if re.fullmatch(r"gen-[A-Za-z0-9_-]+", generation):
                    receipt["generationId"] = generation
            save(folder / "submission-error.json", diagnostic)
            receipt.update(state="uncertain", error="Submission or stream unconfirmed; automatic replacement is forbidden")
            save(path, receipt)
            raise ValueError(receipt["error"]) from None
    if receipt["state"] != "accounting" or not (folder / "response.json").exists():
        raise ValueError("Original generation needs reconciliation; no replacement was submitted")
    value = read(folder / "response.json")
    receipt = account(key, value, receipt)
    receipt["state"] = "completed" if value.get("model") == model and value.get("choices", [{}])[0].get("finish_reason") == "stop" and receipt["actualCostUsd"] * 1000000 <= reserve else "incomplete"
    save(path, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("task", choices=MODELS)
    args = parser.parse_args()
    job = args.job.resolve()
    if socket.gethostname() != "yunipals-main" or not str(job).startswith("/var/lib/yunipals-anime-arena/rehearsals/"):
        raise ValueError("Paid rehearsal must run in its private folder on yunipals-main")
    os.umask(0o077)
    key = secret(Path("/etc/yunipals-anime-arena/openrouter.env"))
    with (job / ".provider.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        receipt = step(job, args.task, key)
    print(json.dumps({k: receipt.get(k) for k in ("state", "model", "generationId", "actualCostUsd", "elapsedSeconds")}))
    if receipt["state"] != "completed":
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, urllib.error.URLError) as error:
        # Never print provider bodies, request headers, credentials or raw strategies.
        print(json.dumps({"state": "needs-attention", "error": str(error) if isinstance(error, ValueError) else type(error).__name__}))
        raise SystemExit(1)
