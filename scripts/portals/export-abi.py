"""Refresh the shared portal ABI from the release-profile Solidity artifacts."""
import json
import sys
from pathlib import Path

root=Path(__file__).resolve().parents[2]
items=[]
for contract,name in [("PortalCollection","portalCollectionAbi"),("PortalRegistry","portalRegistryAbi"),("PortalGrading","portalGradingAbi"),("PortalGradingCompetition","portalCompetitionAbi")]:
    artifact=json.loads((root/"contracts/boosters/out-permit"/f"{contract}.sol"/f"{contract}.json").read_text())
    abi=[item for item in artifact["abi"] if item["type"] in ["function","event","error"]]
    items.append(f"export const {name} = "+json.dumps(abi,separators=(",",":"))+" as const;")
target = root / "packages/yunipals-market-core/src/portalAbi.ts"
expected = "// Generated from Solidity. Refresh with scripts/portals/export-abi.py.\n" + "\n\n".join(items) + "\n"
if "--check" in sys.argv:
    assert target.read_text() == expected, "Portal ABI differs from release artifacts; run export-abi.py"
    print("Portal ABI matches release artifacts")
else:
    target.write_text(expected)
