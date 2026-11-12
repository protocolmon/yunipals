"""Check legacy storage prefixes and record/check the new portal release layouts."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
new_contracts = ["PortalCollection", "PortalRegistry", "PortalGrading", "PortalGradingCompetition"]
for name in ["PackRegistry", "YunipalMonsters", "BoosterPacks", *new_contracts]:
    artifact = json.loads((root / "contracts/boosters/out-permit" / f"{name}.sol/{name}.json").read_text())
    layout = artifact["storageLayout"]

    def shape(type_id):
        value = layout["types"][type_id]
        return {key: (shape(item) if key in ["key", "value", "base"] else
                      [{"label": member["label"], "slot": member["slot"], "offset": member["offset"], "type": shape(member["type"])} for member in item] if key == "members" else item)
                for key, item in value.items() if key not in ["astId", "contract"]}

    fields = [{"label": item["label"], "slot": item["slot"], "offset": item["offset"], "type": shape(item["type"])}
              for item in layout["storage"] if item["label"] != "__gap"]
    baseline = root / "contracts/boosters/config" / f"{name}.storage.json"
    if name in new_contracts and "--write-new-baselines" in sys.argv:
        assert not baseline.exists(), "Existing release baselines must be reviewed, never overwritten"
        baseline.write_text(json.dumps(fields, indent=2) + "\n")
    if name == "PortalGradingCompetition" and "--write-competition-baseline" in sys.argv:
        assert not baseline.exists(), "Competition baseline already exists"
        baseline.write_text(json.dumps(fields, indent=2) + "\n")
    expected = json.loads(baseline.read_text())
    assert fields[:len(expected)] == expected, f"Incompatible storage change in {name}"
    extended = root / "contracts/boosters/config" / f"{name}.burn-to-claim.storage.json"
    if name in new_contracts and "--write-burn-baselines" in sys.argv:
        assert not extended.exists(), "Existing burn-to-claim baselines must never be overwritten"
        extended.write_text(json.dumps(fields, indent=2) + "\n")
    if name in new_contracts and extended.exists():
        frozen = json.loads(extended.read_text())
        assert fields[:len(frozen)] == frozen, f"Incompatible burn-to-claim storage change in {name}"
    gap_ends = {"YunipalMonsters": 50, "PortalCollection": 55, "PortalRegistry": 55, "PortalGrading": 48, "PortalGradingCompetition": 50}
    if name in gap_ends:
        gap = next(item for item in layout["storage"] if item["label"] == "__gap")
        assert int(gap["slot"]) + int(layout["types"][gap["type"]]["numberOfBytes"]) // 32 == gap_ends[name], f"{name} storage gap end moved"
    print(name, "storage compatible")
