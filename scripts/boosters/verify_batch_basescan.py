"""Verify only the approved batch engine implementation; never signs a transaction."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import os

from verify_basescan import load_key, api, poll

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / "docs/boosters/batch-engine-upgrade-2026-10-23"
OUTPUT = DIRECTORY / "verification"
IMPLEMENTATION = "0xeba9D4dEB6914Ab67A820Ea27C2fC3F43812E471"
PROXY = "0x455FaBAd0ac8fF1eA4DF70ca07AA56A272cB2609"
INPUT_SHA = "f66676caa22a03b578f154d5adf09d0e4099f001cff308aa1884aa6f8e642e9c"
PACKAGE_SHA = "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e"
COMPILER = "v0.8.30+commit.73712a01"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2) + "\n").encode()


def reviewed_inputs():
    source = (DIRECTORY / "solc-standard-input.json").read_bytes()
    package_raw = (DIRECTORY / "upgrade.unsigned.json").read_bytes()
    if digest(source) != INPUT_SHA or digest(package_raw) != PACKAGE_SHA:
        raise ValueError("Frozen batch verification input changed")
    standard = json.loads(source)
    package = json.loads(package_raw)
    artifact = json.loads((ROOT / "contracts/boosters/out-batch/BoosterPacks.sol/BoosterPacks.json").read_text())
    if (standard["settings"]["optimizer"] != {"enabled": True, "runs": 1}
            or standard["settings"]["evmVersion"] != "cancun"
            or standard["settings"]["viaIR"] is not True
            or standard["settings"]["metadata"] != {"bytecodeHash": "none"}
            or artifact["bytecode"]["object"] != package["candidate"]["creationBytecode"]
            or artifact["deployedBytecode"]["object"] != package["candidate"]["runtimeBytecodeTemplate"]):
        raise ValueError("Exact optimizer1 approved batch artifact required")
    return source.decode(), standard, artifact["abi"]


def canonical_abi(value):
    return sorted(json.dumps(row, sort_keys=True, separators=(",", ":")) for row in value)


def validate_record(record, standard, abi):
    raw = record.get("SourceCode", "")
    if raw.startswith("{{") and raw.endswith("}}"):
        raw = raw[1:-1]
    published = json.loads(raw)
    if (record.get("ContractName") != "BoosterPacks" or record.get("CompilerVersion") != COMPILER
            or str(record.get("OptimizationUsed")) != "1" or str(record.get("Runs")) != "1"
            or record.get("ConstructorArguments", "") not in {"", "0x"}
            or record.get("SimilarMatch") or published.get("language") != "Solidity"
            or published.get("sources") != standard["sources"]):
        raise ValueError("Explorer must expose the exact full-match batch source and compiler")
    for field in ("optimizer", "viaIR", "evmVersion", "metadata", "libraries", "remappings"):
        actual = published.get("settings", {}).get(field)
        expected = standard["settings"].get(field)
        # Etherscan omits an empty libraries object from its public record.
        if field == "libraries" and expected == {} and actual is None:
            continue
        if actual != expected:
            raise ValueError("Explorer compiler settings differ: " + field)
    published_abi = json.loads(record["ABI"])
    if canonical_abi(published_abi) != canonical_abi(abi):
        raise ValueError("Explorer ABI differs from the approved compiled batch ABI")
    return {"fullSourceMatch": True, "sourceFiles": len(standard["sources"]),
            "sourceInputSha256": INPUT_SHA, "compilerVersion": COMPILER, "optimizerRuns": 1,
            "evmVersion": "cancun", "viaIR": True, "constructorArguments": "",
            "explorerOmittedEmptyLibraries": "libraries" not in published.get("settings", {}),
            "fullAbiMatch": True, "abiSha256": digest(json.dumps(canonical_abi(abi)).encode()),
            "verificationLevel": "full"}


def save(report):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    fd, filename = tempfile.mkstemp(prefix=".batch-verification-", dir=OUTPUT)
    temporary = Path(filename)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o644)
            handle.write(encoded(report))
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(OUTPUT / "basescan-results.json")
    finally:
        temporary.unlink(missing_ok=True)


def record(key, address):
    value = api(key, "getsourcecode", {"address": address})
    if value.get("status") != "1" or not isinstance(value.get("result"), list) or len(value["result"]) != 1:
        raise RuntimeError("Explorer source record unavailable")
    return value["result"][0]


def submit():
    source, standard, abi = reviewed_inputs()
    key = load_key()
    path = OUTPUT / "basescan-results.json"
    report = json.loads(path.read_text()) if path.exists() else {
        "format": "yunipals-batch-engine-basescan-verification-v1", "chainId": 8453,
        "implementation": IMPLEMENTATION, "proxy": PROXY, "sourceInputSha256": INPUT_SHA,
        "approvedPackageSha256": PACKAGE_SHA, "mainnetTransactionsSent": False
    }
    if (report.get("implementation") != IMPLEMENTATION or report.get("proxy") != PROXY
            or report.get("sourceInputSha256") != INPUT_SHA or report.get("approvedPackageSha256") != PACKAGE_SHA):
        raise ValueError("Another verification operation occupies the batch output")
    existing = record(key, IMPLEMENTATION)
    if not existing.get("SourceCode"):
        if not report.get("sourceGuid"):
            result = api(key, "verifysourcecode", {
                "contractaddress": IMPLEMENTATION, "sourceCode": source,
                "codeformat": "solidity-standard-json-input", "contractname": "src/BoosterPacks.sol:BoosterPacks",
                "compilerversion": COMPILER, "constructorArguments": "", "constructorArguements": "",
                "optimizationUsed": "1", "runs": "1", "evmVersion": "cancun", "licenseType": "3"
            }, post=True)
            if result.get("status") != "1":
                raise RuntimeError("Source submission refused: " + str(result.get("result"))[:300])
            report["sourceGuid"] = result["result"]
            save(report)
        poll(key, "checkverifystatus", report["sourceGuid"])
        existing = record(key, IMPLEMENTATION)
    report["source"] = validate_record(existing, standard, abi)
    report["implementationUrl"] = "https://basescan.org/address/" + IMPLEMENTATION + "#code"
    save(report)
    proxy = record(key, PROXY)
    if not proxy.get("SourceCode"):
        raise RuntimeError("Existing proxy must retain its verified source")
    if str(proxy.get("Implementation", "")).lower() != IMPLEMENTATION.lower():
        if not report.get("proxyGuid"):
            result = api(key, "verifyproxycontract", {
                "address": PROXY, "expectedimplementation": IMPLEMENTATION
            }, post=True)
            if result.get("status") != "1":
                raise RuntimeError("Proxy linking refused: " + str(result.get("result"))[:300])
            report["proxyGuid"] = result["result"]
            save(report)
        poll(key, "checkproxyverification", report["proxyGuid"])
        proxy = record(key, PROXY)
    if str(proxy.get("Implementation", "")).lower() != IMPLEMENTATION.lower():
        raise RuntimeError("Explorer proxy implementation link is not current")
    report.update(status="implementation-fully-verified-and-proxy-linked",
                  proxyImplementation=IMPLEMENTATION,
                  proxyUrl="https://basescan.org/address/" + PROXY + "#readProxyContract",
                  checkedAt=datetime.now(timezone.utc).isoformat())
    save(report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--submit", action="store_true")
    args = parser.parse_args()
    if args.submit:
        value = submit()
        print(json.dumps({key: value[key] for key in ("status", "implementationUrl", "proxyUrl", "checkedAt")}))
    else:
        source, standard, abi = reviewed_inputs()
        print(json.dumps({"implementation": IMPLEMENTATION, "proxy": PROXY, "sourceInputSha256": INPUT_SHA,
                          "compilerVersion": COMPILER, "optimizerRuns": 1, "sourceFiles": len(standard["sources"]),
                          "constructorArguments": "", "mainnetTransactionsSent": False}))
