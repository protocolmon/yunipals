"""Require the committed baseline to remain a prefix of each contract's storage layout."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
update = "--write-baseline" in sys.argv
for name in ["PackRegistry", "YunipalMonsters", "BoosterPacks"]:
    artifact = json.loads((root / "contracts/boosters/out" / f"{name}.sol" / f"{name}.json").read_text())
    layout = artifact["storageLayout"]
    def shape(type_id):
        value = layout["types"][type_id]
        return {key: (shape(item) if key in ["key", "value", "base"] else
                      [{"label": member["label"], "slot": member["slot"], "offset": member["offset"], "type": shape(member["type"])} for member in item] if key == "members" else item)
                for key, item in value.items() if key not in ["astId", "contract"]}
    fields = [{"label": item["label"], "slot": item["slot"], "offset": item["offset"], "type": shape(item["type"])}
              for item in layout["storage"] if item["label"] != "__gap"]
    target = root / "contracts/boosters/config" / f"{name}.storage.json"
    if update:
        target.write_text(json.dumps(fields, indent=2) + "\n")
    else:
        expected = json.loads(target.read_text())
        assert fields[:len(expected)] == expected, f"Incompatible storage change in {name}"
    print(name, "baseline written" if update else "storage compatible")
