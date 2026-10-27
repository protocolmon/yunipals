"""Validate compact LLM race accounting; never compute or repair the race outcome."""

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

import jsonschema


def validate(race, outcome, schema):
    errors = [f"schema: {e.message}" for e in jsonschema.Draft202012Validator(schema).iter_errors(outcome)]
    warnings = []
    if errors:
        return errors, warnings
    profiles = {p["id"]: p for p in race["participants"]}
    ids = set(profiles)
    order = race["stateOrder"]
    if set(order) != ids or len(order) != len(ids):
        errors.append("Invalid input state order")
        return errors, warnings
    candidate = outcome["status"] == "candidate"
    snapshots = outcome["snapshots"]
    finish = outcome["finishOrder"]
    times = race["courseSetup"]["snapshotTimesSeconds"]
    finish_distance = race["courseSetup"]["finishTotalProgressMetres"]
    if candidate and [s["t"] for s in snapshots] != times:
        errors.append("Candidate snapshot schedule differs from the frozen course")
    if not candidate and (finish or not outcome["caveats"]):
        errors.append("Clarification must identify a missing fact and assign no finish order")
    intent_ids = [i["id"] for i in outcome["intents"]]
    if candidate and (set(intent_ids) != ids or len(intent_ids) != len(ids)):
        errors.append("Missing or duplicate free-form intent readings")

    events = {}
    previous_time = -1
    coverage = set()
    for event in outcome["events"]:
        if event["id"] in events:
            errors.append("Duplicate event " + event["id"])
        if not set(event["racers"]) <= ids:
            errors.append("Unknown racer in event " + event["id"])
        if event["t"] < previous_time or not 0 <= event["t"] <= times[-1]:
            errors.append("Invalid event chronology " + event["id"])
        events[event["id"]] = event
        previous_time = event["t"]
        coverage.update(event["racers"])

    uses = {}
    windows = defaultdict(list)
    last_ability_window = {}
    previous_time = -1
    finish_times = {f["id"]: f["t"] for f in finish}
    for use in outcome["uses"]:
        label = use["id"]
        if label in uses:
            errors.append("Duplicate use " + label)
        uses[label] = use
        rid, ability, t = use["racer"], use["ability"], use["t"]
        if rid not in ids or ability not in race["abilities"]:
            errors.append("Unknown caster or ability " + label)
            continue
        if ability not in profiles[rid]["abilityIds"]:
            errors.append("Unavailable ability " + label)
        if use["target"] is not None and use["target"] not in ids:
            errors.append("Unknown target " + label)
        if ability == "dash" and use["target"] not in (None, rid):
            errors.append("Dash has another racer as target " + label)
        if ability == "vine_snare" and use["target"] is not None:
            errors.append("Vine must target terrain " + label)
        if t < previous_time or not 0 <= t <= times[-1]:
            errors.append("Invalid activation chronology " + label)
        if rid in finish_times and t >= finish_times[rid]:
            errors.append("Ability at or after finish " + label)
        previous_time = t
        window = max(1, math.ceil(t / 20))
        windows[(rid, window)].append(use)
        key = (rid, ability)
        if key in last_ability_window and window - last_ability_window[key] <= race["abilities"][ability]["cooldownBeats"]:
            errors.append("Cooldown violation " + label)
        last_ability_window[key] = window
        event = events.get(use["event"])
        if not event or rid not in event["racers"]:
            errors.append("Missing causal event for ability " + label)
        if ability == "dash":
            duration, gain = use["activeSeconds"], use["extraPhysicalMetres"]
            if duration is None or gain is None or not 0 < duration <= 4 or not 0 <= gain <= duration * 2.5 + 0.01:
                errors.append("Dash exceeds its physical envelope " + label)
        elif use["activeSeconds"] is not None or use["extraPhysicalMetres"] is not None:
            errors.append("Dash-only numeric fields on another ability " + label)
    for (rid, window), activations in windows.items():
        if len(activations) > 1:
            errors.append(f"Multiple paid abilities in window {window}: {rid}")

    first_finish = {}
    previous = None
    for index, snapshot in enumerate(snapshots):
        if index >= len(times) or snapshot["t"] != times[index]:
            errors.append(f"Wrong snapshot time at index {index}")
        for j, rid in enumerate(order):
            progress, energy = snapshot["progress"][j], snapshot["energy"][j]
            if not 0 <= progress <= finish_distance or not 0 <= energy <= 100:
                errors.append(f"State outside bounds at {index}: {rid}")
            if index == 0 and (progress != 0 or energy != profiles[rid]["initialEnergy"]):
                errors.append("Invalid start state " + rid)
            if previous:
                old_progress, old_energy = previous["progress"][j], previous["energy"][j]
                if progress < old_progress:
                    errors.append(f"Progress decreased at {index}: {rid}")
                activations = windows[(rid, index)]
                if old_progress == finish_distance:
                    expected = old_energy
                    if progress != finish_distance or activations:
                        errors.append(f"Finished racer changed or acted at {index}: {rid}")
                elif activations:
                    expected = old_energy - sum(race["abilities"][u["ability"]]["energyCost"] for u in activations)
                else:
                    expected = min(100, old_energy + 5)
                if energy != expected:
                    errors.append(f"Energy mismatch at {index}: {rid}, expected {expected}, got {energy}")
            if progress == finish_distance and rid not in first_finish:
                first_finish[rid] = index
        previous = snapshot

    effect_ids = set()
    for effect in outcome["effects"]:
        if effect["id"] in effect_ids:
            errors.append("Duplicate effect " + effect["id"])
        effect_ids.add(effect["id"])
        use = uses.get(effect["use"])
        if not use or use["ability"] not in {"water_splash", "vine_snare"}:
            errors.append("Missing physical effect source " + effect["id"])
            continue
        start, end = effect["createdAt"], effect["clearedAt"]
        lifetime = 45 if use["ability"] == "water_splash" else 30
        if start < use["t"] or not start <= end <= start + lifetime:
            errors.append("Effect lifetime outside envelope " + effect["id"])

    if candidate:
        if len(finish) != len(ids) or {f["id"] for f in finish} != ids:
            errors.append("Finish order does not contain all eleven once")
        if not snapshots or any(p != finish_distance for p in snapshots[-1]["progress"]):
            errors.append("Not all racers finish")
        if len(finish) >= 2 and finish[0]["t"] >= finish[1]["t"]:
            errors.append("No unique first crossing recorded")
        for before, after in zip(finish, finish[1:]):
            if before["t"] > after["t"]:
                errors.append("Finish times contradict places")
        for entry in finish:
            index = first_finish.get(entry["id"])
            if index is None or index == 0 or not snapshots[index - 1]["t"] < entry["t"] <= snapshots[index]["t"]:
                errors.append("Finish time contradicts snapshots " + entry["id"])
            if not entry["events"]:
                errors.append("No finish explanation references " + entry["id"])
            for ref in entry["events"]:
                if ref not in events or entry["id"] not in events[ref]["racers"]:
                    errors.append("Unsupported finish event " + entry["id"] + ": " + ref)
        if coverage != ids:
            warnings.append("Some entrants lack causal-event coverage")
        if outcome["caveats"]:
            warnings.append("Read candidate caveats during semantic review")
    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch", type=Path)
    args = parser.parse_args()
    batch = args.batch.resolve()
    metadata = json.loads((batch / "batch.json").read_text())
    schema = json.loads((batch / "output-schema.json").read_text())
    reports = []
    for case in metadata["completedCases"]:
        folder = batch / case
        race = json.loads((folder / "input.json").read_text())
        outcome = json.loads((folder / "outcome.json").read_text())
        receipt = json.loads((folder / "receipt.json").read_text())
        errors, warnings = validate(race, outcome, schema)
        for filename, expected in [("input.json", receipt["inputSha256"]), ("outcome.json", receipt["outputSha256"])]:
            if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != expected:
                errors.append("Immutable file hash changed: " + filename)
        if hashlib.sha256((batch / "referee-system-prompt.txt").read_bytes()).hexdigest() != receipt["systemPromptSha256"]:
            errors.append("Immutable system prompt changed")
        if receipt["toolItems"]:
            errors.append("Referee used an unexpected tool")
        report = {"case": case, "status": "passed" if not errors else "failed", "outcomeStatus": outcome["status"],
                  "errors": errors, "warnings": warnings, "mechanicalChecksOnly": True,
                  "notVerified": ["strategy interpretation", "spatial reach and trajectory", "wind exposure and contextual dash reductions", "effect area/material/removal cause", "causal sufficiency", "statistical fairness"]}
        (folder / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
        reports.append(report)
        print(json.dumps(report))
    (batch / "validation.json").write_text(json.dumps(reports, indent=2) + "\n")


if __name__ == "__main__":
    main()
