"""Require the release contracts to fit Base's runtime code limit."""
import json
import sys
from pathlib import Path

root=Path(__file__).resolve().parents[2]
output = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "out-permit"
assert output in ["out", "out-permit"], "Unsupported compiler output directory"
for name in ["BoosterPacks","YunipalMonsters","PortalRules","PortalGradingValidator","PortalCollection","PortalRegistry","PortalGrading","PortalGradingCompetition","PortalCompetitionReceiver","SerumCatalogue","YunipalAdventures","YunipalEvolution"]:
    artifact=json.loads((root/"contracts/boosters"/output/f"{name}.sol"/f"{name}.json").read_text())
    size=len(artifact["deployedBytecode"]["object"].removeprefix("0x"))//2
    assert size<=24576,f"{name}: {size} bytes exceeds EIP-170; build with FOUNDRY_PROFILE=permit"
    print(f"{name}: {size} bytes, deployable")
