"""Require the release contracts to fit Base's runtime code limit."""
import json
from pathlib import Path

root=Path(__file__).resolve().parents[2]
for name in ["BoosterPacks","YunipalMonsters","PortalRules","PortalGradingValidator","PortalCollection","PortalRegistry","PortalGrading","PortalGradingCompetition","PortalCompetitionReceiver"]:
    artifact=json.loads((root/"contracts/boosters/out-permit"/f"{name}.sol"/f"{name}.json").read_text())
    size=len(artifact["deployedBytecode"]["object"].removeprefix("0x"))//2
    assert size<=24576,f"{name}: {size} bytes exceeds EIP-170; build with FOUNDRY_PROFILE=permit"
    print(f"{name}: {size} bytes, deployable")
