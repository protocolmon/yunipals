"""One-shot, resumable API validation. Never retries a generation submission.

Run one step at a time; receipts survive interruptions and credential values never
enter artifacts. The prepared authorization is separate from production results.
"""

import argparse
import base64
import fcntl
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class HttpsRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, url):
        if urlparse(url).scheme != "https":
            raise ValueError("Only HTTPS media redirects are allowed")
        return super().redirect_request(request, fp, code, msg, headers, url)


def save(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2) + "\n")
    tmp.replace(path)


def secret(path, name):
    if path.stat().st_mode & 0o077:
        raise ValueError("Credential file must have mode 600")
    contents = path.read_text().strip()
    if name == "RUNWARE_API_KEY" and "\n" not in contents and "=" not in contents:
        return contents
    for line in contents.splitlines():
        field, sep, value = line.partition("=")
        if sep and field.strip() == name:
            key = value.strip().strip("\"'")
            if key and not any(c.isspace() for c in key):
                return key
    raise ValueError("Configured credential is missing")


def api(url, key, body=None, request_id=None):
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if request_id:
        headers["X-Client-Request-Id"] = request_id
    req = Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with build_opener(NoRedirect()).open(req, timeout=45) as response:
            result = json.loads(response.read())
    except HTTPError as error:
        detail = error.read().decode(errors="replace").replace(key, "[redacted]")
        return {"httpStatus": error.code, "submissionError": detail}
    return json.loads(json.dumps(result).replace(key, "[redacted]"))


def step(folder, task, key):
    path = folder / task["asset"]
    path.mkdir(exist_ok=True)
    receipt_path = path / "receipt.json"
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {
        "state": "reserved", "requestId": task["requestId"],
        "reservedUsd": task["reservedUsd"], "submissions": 0,
    }
    if receipt["requestId"] != task["requestId"]:
        raise ValueError("Task identity changed")
    provider = task["provider"]
    if receipt["state"] in {"completed", "failed", "incomplete", "cancelled", "rejected"}:
        return receipt
    if provider == "openai":
        request = json.loads((folder / task["requestFile"]).read_text())
        if (request["model"] != "gpt-6.1-sol" or request["max_output_tokens"] > 32000
                or request["service_tier"] != "default" or request["tools"]
                or len(json.dumps(request).encode()) > 120000 or not request["background"]):
            raise ValueError("Referee request exceeds the approved envelope")
        if receipt.get("providerId"):
            if not re.fullmatch(r"resp_[A-Za-z0-9_-]+", receipt["providerId"]):
                raise ValueError("Invalid provider response ID")
            response = api("https://api.openai.com/v1/responses/" + receipt["providerId"], key)
        else:
            if receipt["state"] != "reserved":
                raise ValueError("Unconfirmed submission: reconcile it; never submit a replacement")
            receipt.update(state="submitting", submissions=1, startedAt=time.time())
            save(receipt_path, receipt)
            response = api("https://api.openai.com/v1/responses", key, request, task["requestId"])
        save(path / "response.json", response)
        if response.get("id"):
            if receipt.get("providerId") and receipt["providerId"] != response["id"]:
                raise ValueError("Provider ID changed")
            receipt.update(providerId=response["id"], state=response["status"])
            if response.get("usage"):
                usage = response["usage"]
                details = usage.get("input_tokens_details", {})
                cached = details.get("cached_tokens", 0)
                writes = details.get("cache_write_tokens", 0)
                receipt.update(usage=usage, estimatedCostUsd=round(
                    ((usage["input_tokens"]-cached-writes)*2 + cached*.1 + writes*2.5 + usage["output_tokens"]*10)/1e6, 8),
                    conservativeCostUsd=round((usage["input_tokens"]*2.5 + usage["output_tokens"]*10)/1e6, 8),
                    costKind="Token-based estimate; not an invoice")
        else:
            receipt["lastError"] = "Provider response unavailable; resume retrieval or reconcile submission"
    else:
        if task["model"] != "bytedance:seedream@4.5" or task["reservedUsd"] != .04:
            raise ValueError("Unapproved image model or budget")
        if receipt["state"] == "reserved":
            refs = []
            for ref in task["references"]:
                content = (folder / ref["file"]).read_bytes()
                if hashlib.sha256(content).hexdigest() != ref["sha256"]:
                    raise ValueError("Reference bytes changed")
                refs.append("data:" + ref["mime"] + ";base64," + base64.b64encode(content).decode())
            prompt = (folder / task["promptFile"]).read_text()
            if not 1 <= len(prompt) <= 3000:
                raise ValueError("Image prompt length outside documented limits")
            request = dict(taskType="imageInference", taskUUID=task["requestId"],
                           model=task["model"], positivePrompt=prompt,
                           width=2560, height=1440, numberResults=1, includeCost=True,
                           deliveryMethod="async", outputType="URL", outputFormat="PNG",
                           inputs={"referenceImages": refs})
            summary = {**request, "inputs": {"referenceImages": task["references"]}}
            save(path / "request-summary.json", summary)
            receipt.update(state="submitting", submissions=1, startedAt=time.time())
            save(receipt_path, receipt)
        else:
            request = {"taskType": "getResponse", "taskUUID": task["requestId"]}
        response = api("https://api.runware.ai/v1", key, [request])
        save(path / "response.json", response)
        result = [r for r in response.get("data", []) if r.get("taskUUID") == task["requestId"]]
        images = [r for r in result if r.get("imageURL")]
        if images:
            if len(images) != 1:
                raise ValueError("Expected exactly one image")
            receipt.update(state="downloading", output=images[0], actualCostUsd=images[0].get("cost"))
            save(receipt_path, receipt)
        elif response.get("errors") or response.get("submissionError"):
            receipt["lastError"] = "Provider reported an error; saved for reconciliation, no new generation"
        else:
            receipt["state"] = result[0].get("status", "processing") if result else "processing"
        if receipt.get("output"):
            url = receipt["output"]["imageURL"]
            if urlparse(url).scheme != "https":
                raise ValueError("Only HTTPS media URLs are allowed")
            with build_opener(HttpsRedirect()).open(url, timeout=45) as media:
                data = media.read(32*1024*1024+1)
            if len(data) > 32*1024*1024 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Unexpected image format or size")
            (path / "first-frame.png").write_bytes(data)
            receipt.update(state="completed", imageSha256=hashlib.sha256(data).hexdigest())
    receipt["lastCheckedAt"] = time.time()
    if receipt["state"] in {"completed", "failed", "incomplete", "cancelled"}:
        receipt["elapsedSeconds"] = round(time.time() - receipt["startedAt"], 2)
    save(receipt_path, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--folder", required=True, type=Path)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--key-file", required=True, type=Path)
    args = parser.parse_args()
    with (args.folder / (args.asset + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = json.loads((args.folder / "authorization.json").read_text())
        if not manifest["userApproved"] or manifest["totalBudgetUsd"] != 1:
            raise ValueError("Missing validation authorization")
        if sum(t["reservedUsd"] for t in manifest["providerTasks"]) > 1:
            raise ValueError("Combined reservation exceeds the cap")
        task = next(t for t in manifest["providerTasks"] if t["asset"] == args.asset)
        key = secret(args.key_file, "OPENAI_API_KEY" if task["provider"] == "openai" else "RUNWARE_API_KEY")
        receipt = step(args.folder, task, key)
        print(json.dumps({k: v for k, v in receipt.items() if k not in {"output"}}))


if __name__ == "__main__":
    main()
