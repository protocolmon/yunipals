"""Fail release verification when a crew implementation exceeds EIP-170."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
for name in ["PackRegistry", "BoosterPacks", "YunipalMonsters", "YunipalAdventures", "PortalGrading", "PortalGradingValidator"]:
    artifact = json.loads((root / "contracts/boosters/out" / f"{name}.sol" / f"{name}.json").read_text())
    size = len(artifact["deployedBytecode"]["object"].removeprefix("0x")) // 2
    assert size <= 24_576, f"{name} exceeds EIP-170: {size} bytes"
    print(f"{name}: {size}/24576 runtime bytes")
