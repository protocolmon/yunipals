"""Run four isolated text-only referee trials through the existing Codex login.

No media calls, outcome retries or file access tools are supplied. Prior outcomes
are excluded by default; replay audits must declare them explicitly.
The default is a dry run. Each fresh process sees only the frozen referee prompt,
its anonymous race input and the shared output schema.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import tomllib
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "docs/islands/race-runware-full-v1/strategy-audit"
CASES = ["baseline", "early-dash", "exposed-route", "reverse-order"]


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def obj(properties):
    return {"type": "object", "properties": properties,
            "required": list(properties), "additionalProperties": False}


def array(items):
    return {"type": "array", "items": items}


def output_schema():
    string = {"type": "string"}
    number = {"type": "number"}
    nullable = {"type": ["string", "null"]}
    state = obj({"id": string, "progress": number, "energy": number,
                 "ability": string, "targetId": nullable, "route": string,
                 "locomotion": {"type": "string", "enum": ["run", "flight"]}})
    event = obj({"id": string, "racerIds": array(string), "priorState": string,
                 "strategyBasis": string, "availableOptions": array(string),
                 "action": string, "opponentResponses": string, "ruleBasis": string,
                 "costAndConsequence": string, "comparableRacers": string})
    effect = obj({"id": string, "state": {"type": "string", "enum": ["active", "cleared"]},
                  "sourceId": nullable, "sourceAbility": nullable, "location": string,
                  "visibleCue": string, "endsWhen": string})
    beat = obj({"index": {"type": "integer"}, "raceTimeSeconds": number,
                "states": array(state), "events": array(event), "worldEffects": array(effect)})
    finish = obj({"place": {"type": "integer"}, "id": string,
                  "approximateFinishTimeSeconds": number, "decisiveEventIds": array(string),
                  "explanation": string})
    advantage = obj({"entrantId": string, "eventIds": array(string), "advantage": string,
                     "basis": {"type": "string", "enum": ["strategy", "circumstance", "combined"]},
                     "alternativeExplanationChecked": string})
    return obj({"status": {"type": "string", "enum": ["candidate", "needs-rule-clarification"]},
                "beats": array(beat), "finishOrder": array(finish),
                "decisiveAdvantages": array(advantage), "unresolvedQuestions": array(string)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--resume-batch", type=Path)
    parser.add_argument("--case", choices=CASES + ["custom-plan"])
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high", "xhigh", "max", "ultra"])
    parser.add_argument("--model", help="Explicit, recorded model override; no automatic fallback")
    parser.add_argument("--prior-outcome-supplied", action="store_true",
                        help="Record that this is a replay/audit rather than an independent simulation")
    parser.add_argument("--input-dir", type=Path, default=AUDIT)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    args = parser.parse_args()
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be positive")
    selected_cases = [args.case] if args.case else CASES
    audit = args.input_dir.resolve()
    config_path = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "config.toml"
    config = tomllib.loads(config_path.read_text())
    model = args.model or config.get("model")
    effort = args.reasoning_effort or config.get("model_reasoning_effort")
    if not model:
        raise SystemExit("A configured model is required; no silent model substitution.")
    source_system = audit / "referee-system-prompt-v2.txt"
    custom_schema = audit / "output-schema.json"
    schema = json.loads(custom_schema.read_text()) if custom_schema.exists() else output_schema()
    schema_hash = hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()
    metadata = {"cases": selected_cases, "model": model, "reasoningEffort": effort,
                "configuredModel": config.get("model"), "explicitModelOverride": args.model,
                "configuredReasoningEffort": config.get("model_reasoning_effort"),
                "systemPromptSha256": digest(source_system),
                "outputSchemaSha256": schema_hash,
                "inputs": {c: digest(audit / f"{c}-input.json") for c in selected_cases},
                "transport": "Local Codex CLI, existing ChatGPT login",
                "newSessionPerCase": True, "mediaGeneration": False,
                "priorOutcomeSupplied": args.prior_outcome_supplied, "automaticOutcomeRetries": False,
                "timeoutSeconds": args.timeout_seconds,
                "networkRequestMade": False}
    if not args.run and not args.resume_batch:
        print(json.dumps(metadata, indent=2))
        return
    if args.resume_batch:
        batch = args.resume_batch.resolve()
        if batch.parent != (audit / "runs").resolve():
            raise SystemExit("Resume only an existing adjudication batch.")
        previous = json.loads((batch / "batch.json").read_text())
        for key in ["cases", "model", "reasoningEffort", "systemPromptSha256", "inputs", "priorOutcomeSupplied"]:
            if previous[key] != metadata[key]:
                raise SystemExit(f"Frozen batch configuration changed: {key}")
        saved_schema = json.loads((batch / "output-schema.json").read_text())
        if saved_schema != schema:
            raise SystemExit("Frozen output schema changed")
        metadata = previous
        metadata["status"] = "running"
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        batch = audit / "runs" / (f"{stamp}-{args.case}" if args.case else stamp)
        batch.mkdir(parents=True, exist_ok=False)
        (batch / "referee-system-prompt.txt").write_bytes(source_system.read_bytes())
        save(batch / "output-schema.json", schema)
        metadata.update(status="running", startedAt=datetime.now(timezone.utc).isoformat(),
                        cliVersion=subprocess.check_output(["codex", "--version"], text=True).strip(),
                        completedCases=[])
    save(batch / "batch.json", metadata)
    print(f"Batch: {batch}", flush=True)
    # Keep authentication at its configured location. Drop inherited session IDs,
    # so this is a fresh request rather than a resume/fork of the current thread.
    env = dict(os.environ)
    for key in ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_REMOTE_PAYLOAD"]:
        env.pop(key, None)
    disabled = ["shell_tool", "unified_exec", "apps", "plugins", "remote_plugin",
                "multi_agent", "multi_agent_v2", "image_generation", "view_image",
                "code_mode", "code_mode_host", "skill_search", "shell_snapshot"]
    for case in selected_cases:
        folder = batch / case
        if folder.exists():
            previous = json.loads((folder / "receipt.json").read_text())
            if previous.get("status") != "completed":
                raise SystemExit(f"Existing case is not completed; refusing to resubmit {case}.")
            validation_file = folder / "validation.json"
            saved_validation = json.loads(validation_file.read_text()) if validation_file.exists() else {}
            if previous.get("validationStatus") == "failed" or saved_validation.get("status") == "failed":
                metadata.update(status="stopped-for-validation-error", failedCase=case)
                save(batch / "batch.json", metadata)
                raise SystemExit(f"Saved case failed validation; refusing to accept or resubmit {case}.")
            if digest(folder / "outcome.json") != previous["outputSha256"]:
                raise SystemExit(f"Existing output hash changed: {case}")
            # CLI configuration notices use item.type=error. They are recorded,
            # but are not referee tool calls and do not invalidate its response.
            previous["toolItems"] = [t for t in previous["observedItemTypes"]
                                     if t not in {"agent_message", "reasoning", "error"}]
            if previous["toolItems"]:
                raise SystemExit(f"Unexpected tool use in saved result: {case}")
            save(folder / "receipt.json", previous)
            if case not in metadata["completedCases"]:
                metadata["completedCases"].append(case)
            metadata["networkRequestMade"] = True
            save(batch / "batch.json", metadata)
            print(f"{case}: retained completed response; no new request", flush=True)
            continue
        folder.mkdir()
        input_bytes = (audit / f"{case}-input.json").read_bytes()
        (folder / "input.json").write_bytes(input_bytes)
        request_instructions = audit / "request-instructions.txt"
        header = request_instructions.read_text() if request_instructions.exists() else "Resolve this single race using the supplied referee instructions. Return only the schema JSON.\n\nRACE INPUT\n"
        prompt = header + input_bytes.decode()
        (folder / "user-prompt.txt").write_text(prompt)
        started = time.monotonic()
        receipt = {"case": case, "status": "starting", "model": model,
                   "reasoningEffort": effort, "attempt": 1,
                   "timeoutSeconds": args.timeout_seconds,
                   "inputSha256": hashlib.sha256(input_bytes).hexdigest(),
                   "systemPromptSha256": metadata["systemPromptSha256"],
                   "startedAt": datetime.now(timezone.utc).isoformat()}
        save(folder / "receipt.json", receipt)
        with tempfile.TemporaryDirectory(prefix="yunipals-referee-") as cwd:
            cmd = ["codex", "--no-daemon", "exec", "--ignore-user-config", "--ephemeral",
                   "--sandbox", "read-only", "--skip-git-repo-check", "--cd", cwd,
                   "--model", model, "--json", "--color", "never",
                   "--output-schema", str(batch / "output-schema.json"),
                   "--output-last-message", str(folder / "outcome.json"),
                   "-c", "web_search=\"disabled\"", "-c", "project_doc_max_bytes=0",
                   "-c", "approval_policy=\"never\"",
                   "-c", "model_instructions_file=" + json.dumps(str(batch / "referee-system-prompt.txt")),
                   "--enable", "skip_host_skill_discovery"]
            if effort:
                cmd += ["-c", "model_reasoning_effort=" + json.dumps(effort)]
            for feature in disabled:
                cmd += ["--disable", feature]
            cmd += ["-"]
            save(folder / "invocation.json", {"argv": cmd, "cwd": cwd,
                                               "auth": "Existing login; no credentials included in this file."})
            with (folder / "user-prompt.txt").open("rb") as stdin, \
                    (folder / "events.jsonl").open("wb") as stdout, \
                    (folder / "stderr.txt").open("wb") as stderr:
                child = subprocess.Popen(cmd, stdin=stdin, stdout=stdout, stderr=stderr, env=env)
                receipt["status"] = "running"
                save(folder / "receipt.json", receipt)
                print(f"{case}: started", flush=True)
                while True:
                    try:
                        returncode = child.wait(timeout=30)
                        break
                    except subprocess.TimeoutExpired:
                        elapsed = round(time.monotonic() - started)
                        print(f"{case}: processing ({elapsed}s)", flush=True)
                        if elapsed >= args.timeout_seconds:
                            receipt["timedOut"] = True
                            child.terminate()
                            try:
                                child.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                child.kill()
                                child.wait()
                            returncode = child.returncode
                            break
        events = []
        for line in (folder / "events.jsonl").read_text().splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        receipt.update(exitCode=returncode, elapsedSeconds=round(time.monotonic() - started, 2),
                       completedAt=datetime.now(timezone.utc).isoformat())
        receipt["threadId"] = next((e.get("thread_id") for e in events if e.get("type") == "thread.started"), None)
        receipt["usage"] = next((e.get("usage") for e in reversed(events) if e.get("type") == "turn.completed"), None)
        item_types = sorted({e.get("item", {}).get("type") for e in events if e.get("item", {}).get("type")})
        receipt["observedItemTypes"] = item_types
        receipt["toolItems"] = [t for t in item_types if t not in {"agent_message", "reasoning", "error"}]
        receipt["runtimeNotices"] = [e["item"].get("message", "") for e in events
                                     if e.get("item", {}).get("type") == "error"]
        output = folder / "outcome.json"
        if returncode == 0 and output.exists() and output.stat().st_size:
            try:
                value = json.loads(output.read_text())
                receipt.update(status="completed", outcomeStatus=value.get("status"), outputSha256=digest(output))
            except json.JSONDecodeError:
                receipt["status"] = "invalid-json"
        else:
            receipt["status"] = "failed"
        # A syntactically valid candidate can still omit the finish or violate
        # resource rules. Keep the raw response, but stop before handing it off.
        if receipt["status"] == "completed" and "snapshots" in schema["properties"]:
            from check_freeform_race import validate

            errors, warnings = validate(json.loads(input_bytes), value, schema)
            report = {"case": case, "status": "failed" if errors else "passed",
                      "outcomeStatus": value.get("status"), "errors": errors,
                      "warnings": warnings, "mechanicalChecksOnly": True}
            save(folder / "validation.json", report)
            receipt["validationStatus"] = report["status"]
        save(folder / "receipt.json", receipt)
        print(f"{case}: {receipt['status']} / {receipt.get('outcomeStatus', 'no outcome')} ({receipt['elapsedSeconds']}s)", flush=True)
        if receipt["status"] != "completed" or receipt["toolItems"]:
            metadata.update(status="stopped-for-execution-error", failedCase=case)
            save(batch / "batch.json", metadata)
            raise SystemExit(f"Inspect {folder}; no outcome retry or later calls submitted.")
        metadata["completedCases"].append(case)
        metadata["networkRequestMade"] = True
        if receipt.get("validationStatus") == "failed":
            metadata.update(status="stopped-for-validation-error", failedCase=case)
            save(batch / "batch.json", metadata)
            raise SystemExit(f"Inspect {folder / 'validation.json'}; raw response retained, no automatic retry.")
        save(batch / "batch.json", metadata)
    metadata.update(status="completed", completedAt=datetime.now(timezone.utc).isoformat())
    save(batch / "batch.json", metadata)
    request_kind = "replay/audit" if args.prior_outcome_supplied else "independent"
    print(f"{len(selected_cases)} {request_kind} requests completed: {batch}", flush=True)


if __name__ == "__main__":
    main()
