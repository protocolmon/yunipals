"""Build a self-contained, checksum-identified text handoff for an independent audit."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo

from extract_audit import BEGIN, END

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "contracts/boosters"
OUT = ROOT / "docs/boosters/audit"


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build(status, unit_evidence, fork_evidence, verification=None, output=None, brief_path=None,
          deployment=None, simulation=None, extras=None):
    files = {}
    def include(relative):
        files[relative] = (ROOT / relative).read_bytes()
    def virtual(relative, data):
        files[relative] = data if isinstance(data, bytes) else encoded(data)
    def artifact(name, unit=None):
        return json.loads((BASE / "out" / (unit or name + ".sol") / (name + ".json")).read_text())
    roots = [("BoosterAdmin", None), ("PackRegistry", None), ("YunipalMonsters", None),
             ("BoosterPacks", None), ("VariantDraw", None), ("ERC1967Proxy", None),
             ("DeployBoosters", "DeployBoosters.s.sol"), ("BoosterPacksTest", "BoosterPacks.t.sol"),
             ("ProtoForkTest", "ProtoFork.t.sol"), ("MockL1Oracle", None), ("MockMulticall3", "MockL1Oracle.sol")]
    for name, unit in [("AuditPoCTest", "AuditPoC.t.sol"), ("AuditInvariantTest", "AuditInvariant.t.sol"), ("BoosterProofRecoveryTest", "BoosterProofRecovery.t.sol"), ("AuditPoC2Test", "AuditPoC2.t.sol")]:
        if (BASE / "test" / unit).exists():
            roots.append((name, unit))
    units, production = set(), set()
    for index, (name, unit) in enumerate(roots):
        source_names = set(json.loads(artifact(name, unit)["rawMetadata"])["sources"])
        units |= source_names
        if index < 6:
            production |= source_names
    for name in ["BoosterAdmin", "PackRegistry", "YunipalMonsters", "BoosterPacks", "VariantDraw"]:
        include("contracts/boosters/src/" + name + ".sol")
    for relative in sorted(units):
        if not relative.startswith("lib/"):
            include("contracts/boosters/" + relative)
    for relative in ["contracts/boosters/foundry.toml", "contracts/boosters/README.md",
                     "contracts/boosters/install-dependencies.py", "contracts/boosters/.gitignore"]:
        include(relative)
    for fixture in sorted((BASE / "test/fixtures").glob("*.json")):
        include(str(fixture.relative_to(ROOT)))
    for config in sorted((BASE / "config").glob("*.json")):
        include(str(config.relative_to(ROOT)))
    for relative in ["scripts/boosters/check-storage.py", "scripts/boosters/export-abi.py",
                     "scripts/boosters/extract_audit.py", "scripts/boosters/build_audit_package.py",
                     "packages/yunipals-market-core/src/boosterCatalog.ts",
                     "packages/yunipals-market-core/src/boosterAbi.ts",
                     "apps/yunipals-indexer/scripts/prepare-booster-pack.ts",
                     "apps/yunipals-indexer/scripts/prepare-booster-mainnet.ts",
                     "apps/yunipals-indexer/scripts/simulate-booster-deployment.ts",
                     "apps/yunipals-home-web/src/lib/boosterDeployment.ts",
                     "apps/yunipals-home-web/scripts/boosters/deployment-page.ts",
                     "scripts/boosters/build_deployment_page.mjs",
                     "docs/boosters/mainnet-smoke/deployment.unsigned.json",
                     "docs/boosters/mainnet-smoke/deployment.fork-simulation.json",
                     "docs/boosters/mainnet-smoke/wallet-signing.fork-test.json",
                     "docs/boosters/mainnet-smoke/pack.draft.json"]:
        include(relative)
    for relative in ["apps/yunipals-indexer/lib/boosters/vrf-preflight.ts",
                     "apps/yunipals-indexer/test/booster-vrf-preflight.test.ts",
                     "apps/yunipals-home-web/src/hooks/useBoosterActions.ts"]:
        if (ROOT / relative).exists():
            include(relative)
    if deployment:
        virtual("docs/boosters/mainnet-smoke/deployment.unsigned.json", Path(deployment).read_bytes())
    if simulation:
        virtual("docs/boosters/mainnet-smoke/deployment.fork-simulation.json", Path(simulation).read_bytes())
    for relative in extras or []:
        include(relative)
    brief = Path(brief_path or OUT / "brief.txt").read_bytes()
    virtual("audit/README.txt", brief)
    virtual("audit/live-mainnet-status.json", Path(status).read_bytes())
    virtual("audit/evidence/forge-unit-fuzz.json", Path(unit_evidence).read_bytes())
    virtual("audit/evidence/forge-pinned-base-fork.json", Path(fork_evidence).read_bytes())
    if verification:
        virtual("audit/evidence/package-verification.json", Path(verification).read_bytes())
    metadata = json.loads(artifact("BoosterPacks")["rawMetadata"])
    settings = {key: value for key, value in metadata["settings"].items() if key != "compilationTarget"}
    settings["outputSelection"] = {name + ".sol": {name.rsplit("/", 1)[-1]: ["abi", "evm.bytecode", "evm.deployedBytecode", "storageLayout"]} for name in ["src/PackRegistry", "src/YunipalMonsters", "src/BoosterPacks", "lib/openzeppelin/proxy/ERC1967/ERC1967Proxy"]}
    compiler_input = {"language": "Solidity", "sources": {key: {"content": (BASE / key).read_text()} for key in sorted(production)}, "settings": settings}
    virtual("audit/solc-standard-input.json", compiler_input)
    fingerprints = {}
    for name in ["PackRegistry", "YunipalMonsters", "BoosterPacks", "ERC1967Proxy"]:
        data = artifact(name)
        fingerprints[name] = {"source": next(iter(json.loads(data["rawMetadata"])["settings"]["compilationTarget"])),
                              "creationBytecodeSha256": sha(bytes.fromhex(data["bytecode"]["object"].removeprefix("0x"))),
                              "runtimeTemplateSha256": sha(bytes.fromhex(data["deployedBytecode"]["object"].removeprefix("0x"))),
                              "immutableReferences": data["deployedBytecode"].get("immutableReferences", {}), "abi": data["abi"]}
    virtual("audit/build-fingerprints.json", fingerprints)
    verify_script = b'''"""Verify Solidity Standard JSON build outputs against snapshot artifact bytecode."""
import hashlib,json
from pathlib import Path
import sys
root=Path(__file__).resolve().parent
text=Path(sys.argv[1]).read_text();result=json.loads(text[text.index("{"):])
errors=[e for e in result.get("errors",[]) if e.get("severity")=="error"]
if errors:raise SystemExit(json.dumps(errors,indent=2))
fingerprints=json.loads((root/"build-fingerprints.json").read_text())
for name,expected in fingerprints.items():
    actual=result["contracts"][expected["source"]][name]
    for part,key in [("bytecode","creationBytecodeSha256"),("deployedBytecode","runtimeTemplateSha256")]:
        code=actual["evm"][part]["object"]
        assert hashlib.sha256(bytes.fromhex(code.removeprefix("0x"))).hexdigest()==expected[key],name+" "+part+" mismatch"
    canonical=lambda values:sorted(json.dumps(item,sort_keys=True) for item in values)
    assert canonical(actual["abi"])==canonical(expected["abi"]),name+" ABI mismatch"
    print(name,"bytecode and ABI match snapshot")
'''
    virtual("audit/verify-solc-output.py", verify_script)
    for relative in sorted(units):
        if relative.startswith("lib/"):
            include("contracts/boosters/" + relative)
    for library in ["openzeppelin", "openzeppelin-upgradeable", "chainlink", "forge-std"]:
        package = BASE / "lib" / library / "package.json"
        if package.exists():
            include(str(package.relative_to(ROOT)))
        for license in (BASE / "lib" / library).glob("LICENSE*"):
            if license.is_file():
                include(str(license.relative_to(ROOT)))
    source_records = [{"path": "contracts/boosters/" + key, "sha256": sha((BASE/key).read_bytes())} for key in sorted(units)]
    source_id = sha(json.dumps(source_records, sort_keys=True, separators=(",", ":")).encode())
    entries = [{"path": key, "bytes": len(value), "sha256": sha(value)} for key, value in files.items()]
    manifest = {"format": "yunipals-audit-text-v1", "createdAt": datetime.now(ZoneInfo("Europe/Berlin")).isoformat(),
                "sourceSnapshotSha256": source_id, "solidityCompilationUnits": len(units), "productionSolidityUnits": len(production),
                "repositoryBaseHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "repositoryState": "working-tree snapshot; base HEAD does not contain the new booster code", "files": entries}
    virtual("audit/manifest.json", manifest)
    preface = brief + b"\n\nPACKAGE IDENTIFICATION AND EXTRACTION\n" + f"Source snapshot SHA256: {source_id}\nEmbedded files: {len(files)}\n".encode()
    preface += b"Every embedded file has an exact byte length and SHA256. A companion .sha256 hashes this entire text.\nTo extract, save the following Python script as extract-audit.py and run:\n  python3 extract-audit.py THIS_FILE.txt EMPTY_DESTINATION\nIt only verifies and writes files; it does not download or execute bundled code.\n\n" + (ROOT/"scripts/boosters/extract_audit.py").read_bytes()
    preface += b"\n\nEMBEDDED FILE INDEX (review primary Solidity sources first)\n" + "\n".join(files.keys()).encode() + b"\n\nEXACT FILE PAYLOADS FOLLOW\n"
    chunks = [preface]
    for name, data in files.items():
        if BEGIN in data or END in data:
            raise ValueError("Payload delimiter collision: " + name)
        chunks.extend([BEGIN, json.dumps({"path": name, "bytes": len(data), "sha256": sha(data)}, separators=(",", ":")).encode() + b"\n", data, END, b"\n"])
    target = Path(output or OUT / "yunipals-boosters-audit-2026-10-19.txt")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"".join(chunks))
    target.with_suffix(".txt.sha256").write_text(sha(target.read_bytes()) + "  " + target.name + "\n")
    print(json.dumps({"file": str(target), "bytes": target.stat().st_size, "files": len(files), "sourceSnapshotSha256": source_id, "sha256": sha(target.read_bytes())}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", required=True)
    parser.add_argument("--unit-evidence", required=True)
    parser.add_argument("--fork-evidence", required=True)
    parser.add_argument("--verification")
    parser.add_argument("--output")
    parser.add_argument("--brief")
    parser.add_argument("--deployment")
    parser.add_argument("--simulation")
    parser.add_argument("--extra", action="append", default=[])
    args = parser.parse_args()
    build(args.status, args.unit_evidence, args.fork_evidence, args.verification,
          args.output, args.brief, args.deployment, args.simulation, args.extra)
