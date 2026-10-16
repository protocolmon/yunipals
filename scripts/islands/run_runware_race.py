"""Run one manifest-defined video through Runware; dry-run by default.

Credentials stay server-side. Generation submissions are never retried;
--resume only retrieves the persisted task UUID and downloads its result.
"""

import argparse
import base64
import hashlib
import json
import os
import socket
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from omni_media import image_mime_type

ROOT = Path(__file__).resolve().parents[2]
API = "https://api.runware.ai/v1"
DEFAULT_MANIFEST = ROOT / "docs/islands/race-runware-test-v1/manifest.json"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class SecureMediaRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != "https":
            raise ValueError("Refusing a non-HTTPS media redirect")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def read_key(path):
    key = os.environ.get("RUNWARE_API_KEY")
    if not key and path.exists():
        if path.stat().st_mode & 0o077:
            raise ValueError(f"Key file must have permissions 600: {path}")
        key = path.read_text().strip()
    if key and (any(c.isspace() for c in key) or key.startswith("RUNWARE_API_KEY=")):
        raise ValueError("Supply only the API key, with no assignment or extra lines")
    return key


def prior_allows_submission(prior, manifest):
    """Permit only known admission failures or an explicitly approved replacement."""
    try:
        rejection = json.loads(prior.get("error", "{}"))
    except (ValueError, TypeError):
        return False
    if not isinstance(rejection, dict):
        return False
    errors = rejection.get("errors", [])
    if prior.get("httpStatus") != 400 or rejection.get("data") or not errors:
        return False
    if prior.get("status") == "submission_rejected":
        return all(error.get("code") in {"concurrentRequestLimitExceeded", "insufficientCredits"} for error in errors)
    approved = manifest.get("replacementAuthorizedForTaskUUID")
    return bool(
        approved and approved == prior.get("taskUUID")
        and manifest.get("nativeAudio") is False
        and prior.get("status") == "retrieval_failed"
        and all(error.get("taskUUID") == approved
                and error.get("status") == "error"
                and error.get("code") == "invalidProviderContent" for error in errors)
    )


def build_request(manifest, folder, task_id):
    frame_inputs = []
    frame_summary = []
    for position, field in (("first", "firstFrame"), ("last", "lastFrame")):
        if not manifest.get(field):
            continue
        frame = (folder / manifest[field]).resolve()
        raw = frame.read_bytes()
        mime = image_mime_type(raw)
        digest = hashlib.sha256(raw).hexdigest()
        if manifest.get(field + "Sha256") and manifest[field + "Sha256"] != digest:
            raise ValueError(f"Reviewed {position} frame has changed")
        stored_url = manifest.get(field + "Url")
        if stored_url:
            parsed = urlparse(stored_url)
            if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".runware.ai"):
                raise ValueError("Stored frame URL must use Runware HTTPS media storage")
            if manifest.get(field + "UrlSha256") != digest:
                raise ValueError("Stored frame must match the verified local artwork")
        frame_inputs.append({"image": stored_url or f"data:{mime};base64,{base64.b64encode(raw).decode()}", "frame": position})
        frame_summary.append({"path": str(frame), "frame": position, "mimeType": mime, "sha256": digest, **({"imageUrl": stored_url} if stored_url else {})})
    if not frame_inputs or frame_inputs[0]["frame"] != "first":
        raise ValueError("A first frame is required")
    prompt = (folder / manifest["promptFile"]).read_text()
    prompt_digest = hashlib.sha256(prompt.encode()).hexdigest()
    if manifest.get("promptSha256") and manifest["promptSha256"] != prompt_digest:
        raise ValueError("Reviewed video prompt has changed")
    prompt_limits = {"prunaai:p-video@2": (1, 2048), "minimax:h3@max": (2, 7000), "xai:grok-imagine@video-1.5-lite": (1, 4000)}
    if manifest["model"] in prompt_limits:
        minimum, maximum = prompt_limits[manifest["model"]]
        if not minimum <= len(prompt) <= maximum:
            raise ValueError(f"{manifest['model']} requires {minimum}–{maximum} prompt characters")
    if manifest["model"] == "xai:grok-imagine@video-1.5-lite" and len(frame_inputs) != 1:
        raise ValueError("Grok Imagine Video 1.5 Lite supports only a first frame")
    task = {
        "taskType": "videoInference",
        "taskUUID": task_id,
        "model": manifest["model"],
        "positivePrompt": prompt,
        "inputs": {"frameImages": frame_inputs},
        "resolution": manifest["resolution"],
        "duration": manifest["durationSeconds"],
        "settings": {"audio": manifest.get("nativeAudio", True), "draft": False},
        "numberResults": 1,
        "deliveryMethod": "async",
        "outputType": "URL",
        "outputFormat": "MP4",
        "includeCost": True
    }
    if "fps" in manifest:
        task["fps"] = manifest["fps"]
    if "outputQuality" in manifest:
        quality = manifest["outputQuality"]
        if type(quality) is not int or not 20 <= quality <= 99:
            raise ValueError("Output compression quality must be an integer from 20 to 99")
        task["outputQuality"] = quality
    if "promptUpsampling" in manifest:
        task["settings"]["promptUpsampling"] = manifest["promptUpsampling"]
    if manifest["model"] == "minimax:h3@max":
        if not 5 <= manifest["durationSeconds"] <= 15 or manifest["resolution"] not in {"480p", "768p"}:
            raise ValueError("MiniMax H3 Max requires 5–15 seconds at 480p or 768p")
        task["settings"] = {"promptExpansion": "disabled"}
    elif manifest["model"] == "xai:grok-imagine@video-1.5-lite":
        # Audio is always generated; this model exposes no settings object.
        task.pop("settings")
    summary = {**task, "inputs": {"frameImages": frame_summary}, "promptSha256": prompt_digest, "estimatedCostUsd": round(manifest["durationSeconds"] * manifest["estimatedUsdPerSecond"] + manifest.get("estimatedInputCostUsd", 0), 4)}
    return task, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--api-key-file", type=Path, default=ROOT / ".runware-api.key")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--generate", action="store_true")
    group.add_argument("--resume", type=Path)
    args = parser.parse_args()
    key = read_key(args.api_key_file)
    manifest = json.loads(args.manifest.read_text())
    folder = args.manifest.resolve().parent
    if args.generate and manifest.get("generationAllowed") is False:
        raise SystemExit("This manifest is not approved for video generation")
    if args.generate and manifest.get("submissionReady") is False:
        raise SystemExit("This shot still has an unresolved preparation dependency")
    if args.generate and manifest.get("singleSubmissionOnly"):
        existing = list((folder / "runs").glob("*/receipt.json"))
        for path in existing:
            prior = json.loads(path.read_text())
            if not prior_allows_submission(prior, manifest):
                raise SystemExit("A run already exists. Inspect and resume it; do not submit a duplicate")
    if not args.generate and not args.resume:
        _, summary = build_request(manifest, folder, "DRY-RUN")
        summary.update(credentialPresent=bool(key), networkRequestMade=False)
        save(folder / "dry-run.json", summary)
        print(json.dumps({k: v for k, v in summary.items() if k != "positivePrompt"}, indent=2))
        return
    if not key:
        raise SystemExit("Set RUNWARE_API_KEY or populate the private .runware-api.key file")

    api_opener = build_opener(NoRedirect())

    def api(task):
        request = Request(API, data=json.dumps([task]).encode(), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
        with api_opener.open(request, timeout=90) as response:
            return json.loads(response.read())

    if args.resume:
        run = args.resume.resolve()
        receipt = json.loads((run / "receipt.json").read_text())
        if receipt["status"] == "completed" and (run / "video.mp4").exists():
            print(f"Already downloaded: {run / 'video.mp4'}")
            return
    else:
        task_id = str(uuid.uuid4())
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        run = folder / "runs" / f"{stamp}-{task_id[:8]}"
        task, summary = build_request(manifest, folder, task_id)
        run.mkdir(parents=True)
        receipt = {"status": "submitting", "taskUUID": task_id, "model": manifest["model"], "startedAt": datetime.now(timezone.utc).isoformat(), "generationSubmissions": 1, "estimatedCostUsd": summary["estimatedCostUsd"]}
        save(run / "request-summary.json", summary)
        save(run / "receipt.json", receipt)
    print(f"Run: {run}", flush=True)
    started = time.monotonic()
    submitted = args.resume is not None
    try:
        if args.resume and receipt.get("output", {}).get("videoURL"):
            response = {"data": [receipt["output"]]}
        else:
            response = api({"taskType": "getResponse", "taskUUID": receipt["taskUUID"]} if args.resume else task)
            submitted = True
        interval = 5
        while True:
            # Redact defensively before persisting provider messages.
            response = json.loads(json.dumps(response).replace(key, "[redacted]"))
            save(run / "last-response.json", response)
            if response.get("error") or response.get("errors"):
                receipt.update(status="provider_error", error=response.get("errors") or response.get("error"))
                save(run / "receipt.json", receipt)
                raise RuntimeError("Runware returned an error; see the saved receipt. No generation retry.")
            results = [item for item in response.get("data", []) if item.get("taskUUID") == receipt["taskUUID"]]
            videos = [item for item in results if item.get("videoURL")]
            if videos:
                if len(videos) != 1:
                    raise RuntimeError("Expected exactly one output video")
                result = videos[0]
                receipt.update(status="downloading", output=result, actualCostUsd=result.get("cost"))
                save(run / "receipt.json", receipt)
                break
            state = results[0].get("status", "processing") if results else "awaiting_response"
            if state in {"error", "failed", "cancelled", "canceled"}:
                receipt.update(status="provider_error", error=results)
                raise RuntimeError("Generation failed; no automatic generation retry")
            receipt.update(status=state, lastCheckedAt=datetime.now(timezone.utc).isoformat())
            save(run / "receipt.json", receipt)
            if time.monotonic() - started > 1800:
                raise RuntimeError("Polling time limit reached. Resume the same run; do not resubmit")
            print(f"Runware status: {state}; elapsed {round(time.monotonic() - started)}s", flush=True)
            time.sleep(interval)
            interval = min(interval * 2, 20)
            response = api({"taskType": "getResponse", "taskUUID": receipt["taskUUID"]})
        url = result["videoURL"]
        if urlparse(url).scheme != "https":
            raise ValueError("Expected HTTPS output URL")
        # This separate request never receives the API authorization header.
        with build_opener(SecureMediaRedirect()).open(url, timeout=120) as response:
            raw = response.read()
        (run / "video.mp4").write_bytes(raw)
        probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height,r_frame_rate,channels,sample_rate", "-of", "json", str(run / "video.mp4")]))
        save(run / "media-info.json", probe)
        receipt.update(status="completed", completedAt=datetime.now(timezone.utc).isoformat(), retrievalElapsedSeconds=round(time.monotonic() - started, 2), videoSha256=hashlib.sha256(raw).hexdigest(), videoSeconds=float(probe["format"]["duration"]), providerCostReported=result.get("cost") is not None)
        save(run / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        print(f"Video saved: {run / 'video.mp4'}")
    except HTTPError as exc:
        # Error payloads can echo inputs; do not print them to the terminal.
        details = exc.read().decode(errors="replace").replace(key, "[redacted]")
        receipt.update(status="retrieval_failed" if submitted else "submission_rejected" if 400 <= exc.code < 500 else "unknown_submission", httpStatus=exc.code, error=details[:4000])
        save(run / "receipt.json", receipt)
        raise SystemExit(f"Runware HTTP {exc.code}. Details saved to {run / 'receipt.json'}. No automatic submission retry.")
    except URLError as exc:
        before_connection = isinstance(exc.reason, socket.gaierror)
        receipt.update(status="not_submitted" if before_connection and not submitted else "retrieval_failed" if submitted else "unknown_submission", message=str(exc).replace(key, "[redacted]"))
        if before_connection and not submitted:
            receipt["generationSubmissions"] = 0
        save(run / "receipt.json", receipt)
        raise SystemExit(f"{receipt['message']}\nSaved run: {run}")
    except Exception as exc:
        if receipt.get("status") != "provider_error":
            receipt["status"] = "retrieval_failed" if submitted else "unknown_submission"
        receipt["message"] = str(exc).replace(key, "[redacted]")
        save(run / "receipt.json", receipt)
        raise SystemExit(f"{receipt['message']}\nSaved run: {run}")


if __name__ == "__main__":
    main()
