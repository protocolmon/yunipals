#!/usr/bin/env python3
"""Build an isolated, Base-Sepolia-only eleven-entry variant of the release pool."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--forge", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2] / "contracts/boosters"
    original = (root / "src/PortalGradingCompetition.sol").read_text()
    replacements = {
        "uint256 public constant BATCH_SIZE = 111;": "uint256 public constant BATCH_SIZE = 11;",
        '"YunipalsCompetitionV2:111:500000:sum4:earlier-entry:50,30,20:submitter:sequential-themes"':
            '"YunipalsCompetitionTestV2:11:500000:sum4:earlier-entry:50,30,20:submitter:sequential-themes"',
        "constructor() {\n        _disableInitializers();":
            'constructor() {\n        require(block.chainid == 84532, "Base Sepolia rehearsal only");\n        _disableInitializers();',
        'require(grading_.code.length != 0 && address(usdc_).code.length != 0, "invalid contracts");':
            'require(block.chainid == 84532, "Base Sepolia rehearsal only");\n        require(grading_.code.length != 0 && address(usdc_).code.length != 0, "invalid contracts");',
    }
    fixture = original
    for before, after in replacements.items():
        assert fixture.count(before) == 1, "Release source changed; review the test-only transformation"
        fixture = fixture.replace(before, after)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yunipals-eleven-build-") as temp:
        project = Path(temp)
        shutil.copytree(root / "src", project / "src")
        shutil.copyfile(root / "foundry.toml", project / "foundry.toml")
        (project / "lib").symlink_to(root / "lib", target_is_directory=True)
        (project / "src/PortalGradingCompetition.sol").write_text(fixture)
        subprocess.run([args.forge, "build", "--root", str(project), "--skip", "test", "--skip", "script"],
                       env={**os.environ, "FOUNDRY_PROFILE": "permit"}, check=True)
        artifact = project / "out-permit/PortalGradingCompetition.sol/PortalGradingCompetition.json"
        shutil.copyfile(artifact, output / "PortalGradingCompetition.json")
        shutil.copyfile(project / "out-permit/PortalGrading.sol/PortalGrading.json", output / "PortalGrading.json")
    (output / "PortalGradingCompetition.test-only.sol").write_text(fixture)
    manifest = {
        "chainId": 84532, "batchSize": 11, "productionBatchSize": 111,
        "testOnly": True, "productionSourceUnchanged": True,
        "sourceSha256": hashlib.sha256(original.encode()).hexdigest(),
        "testSourceSha256": hashlib.sha256(fixture.encode()).hexdigest(),
        "artifactSha256": hashlib.sha256((output / "PortalGradingCompetition.json").read_bytes()).hexdigest(),
        "changes": ["BATCH_SIZE=11", "distinct test RULES_HASH", "Sepolia guard in constructor and initializer"]
    }
    assert (root / "src/PortalGradingCompetition.sol").read_text() == original
    (output / "test-build.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
