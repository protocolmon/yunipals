"""Prepare or explicitly verify seven receipt-derived YPAL contracts; never signs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

from verify_basescan import load_key, api, poll

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "docs/boosters/ypal-fresh-launch-2026-10-23/verification-preparation"
PACKAGE = ROOT / "apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json"
PACKAGE_SHA = "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886"
PROOF_SHA = "9ede068cb5ba59d75ff9337ae6c4467176f4c9036647546fa816f4e78e47ecd0"
BRIDGE = ROOT / "scripts/boosters/verify_ypal_basescan_chain.mjs"
BRIDGE_SHA = "814cb23c5c8e62851bfdefd01ef611799d2a3493d08692c5c27670792ed6b309"
BACKEND_SHA = "94b78e09d3e5d845229a4ea8afdc481cd17b744e1b6bd9f070cb3fe9aa09a371"
API_HELPER_SHA = "552a820d5864ff960582576def8d4e1413b44b02f60788caf6268fec2a63ca4d"
FORMAT = "yunipals-ypal-basescan-verification-v1"
STEPS = ("ypal", "registryImplementation", "registry", "monstersImplementation",
         "monsters", "engineImplementation", "engine")
INPUTS = {
    "token": ("contracts/ypal/evidence/ypal-standard-input.json", "e14be2f25575a982175698eefb92bc211041f6e6b4782ad414a2f069255dd139"),
    "boosters": ("docs/boosters/permit-engine-upgrade-2026-10-23/solc-standard-input.json", "4c72f37ef060a68374322f4c9d9753dc3285c38958346a06756f6e4dad97cf85"),
    "proxy": ("docs/boosters/ypal-fresh-launch-2026-10-23/verification-preparation/proxy-solc-standard-input.json", "4b599d8684c32750eb0b4d3200962bc54a28c6674a7be074cd47da071c476896")
}


def fail(message):
    raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def read(path, maximum=4_000_000):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
        fail("Bounded regular public input required")
    raw = path.read_bytes()
    after = path.stat()
    keys = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if keys(before) != keys(after):
        fail("Public verification input changed while reading")
    return raw


def document(path, pin):
    raw = read(path)
    if digest(raw) != pin:
        fail("Frozen verification input changed")
    return json.loads(raw)


def reviewed_inputs():
    package = document(PACKAGE, PACKAGE_SHA)
    proof = document(FOLDER / "compiler-proof.json", PROOF_SHA)
    standards = {key: document(ROOT / path, pin) for key, (path, pin) in INPUTS.items()}
    if (proof.get("format") != "yunipals-ypal-verification-compiler-proof-v1"
            or proof.get("packageSha256") != PACKAGE_SHA
            or proof.get("allFiveArtifactsByteMatchReviewedPackage") is not True
            or proof.get("proxyRuns1And200CreationAndRuntimeByteIdentical") is not True):
        fail("Actual standalone compiler/package comparison required")
    for key, artifact in proof["artifacts"].items():
        source_key = artifact["inputKey"]
        source = standards[source_key]
        name, pin = INPUTS[source_key]
        expected_settings = {"enabled": True, "runs": 1}
        if (proof["inputs"][source_key] != {"path": name, "sha256": pin}
                or source["language"] != "Solidity" or source["settings"]["optimizer"] != expected_settings
                or source["settings"]["viaIR"] is not True
                or source["settings"]["metadata"] != {"bytecodeHash": "none"}
                or source["settings"]["evmVersion"] != ("paris" if key == "ypal" else "cancun")
                or digest(bytes.fromhex(package["artifacts"][key]["creationBytecode"][2:])) != artifact["creationSha256"]
                or digest(bytes.fromhex(package["artifacts"][key]["runtimeTemplate"][2:])) != artifact["runtimeTemplateSha256"]):
            fail("Source, compiler and reviewed creation/runtime must agree")
    if digest(read(ROOT / "scripts/boosters/verify_basescan.py")) != API_HELPER_SHA:
        fail("Existing credential/API helper changed")
    return standards, proof


def bridge(confirmed, node, *, qualify=False):
    if digest(read(BRIDGE)) != BRIDGE_SHA:
        fail("Frozen receipt/chain bridge changed")
    executable = shutil.which(node) if not Path(node).is_absolute() else node
    if not executable:
        fail("Node 24 executable is required")
    # Never pass the explorer key or unrelated provider credentials to the child.
    allowed = ("PATH", "LANG", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
               "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS")
    environment = {name: os.environ[name] for name in allowed if name in os.environ}
    command = [executable, "--no-warnings", str(BRIDGE), str(Path(confirmed).resolve())]
    if qualify:
        command.append("--qualify")
    result = subprocess.run(command, capture_output=True, timeout=240, env=environment, cwd=ROOT)
    if result.returncode or result.stderr or len(result.stdout) > 1_000_000:
        fail("Receipt/chain preparation refused; no explorer submission attempted")
    return json.loads(result.stdout)


def prepare(confirmed, node="node"):
    standards, proof = reviewed_inputs()
    if confirmed is None:
        return {"format": FORMAT, "packageSha256": PACKAGE_SHA, "compilerProofSha256": PROOF_SHA,
                "sourcesReady": True, "actualManifestRequired": True, "chainQualified": False,
                "explorerCalls": 0, "transactionsSent": 0}
    raw = read(confirmed, 200000)
    value = bridge(confirmed, node)
    if (value.get("format") != "yunipals-ypal-basescan-chain-preparation-v1"
            or value.get("packageSha256") != PACKAGE_SHA or value.get("backendSha256") != BACKEND_SHA
            or value.get("confirmedManifestFileSha256") != digest(raw)
            or value.get("chainQualified") is not False or value.get("qualification") is not None
            or [row["step"] for row in value.get("contracts", [])] != list(STEPS)):
        fail("Exact receipt-derived offline preparation required")
    contracts = []
    for row in value["contracts"]:
        artifact = proof["artifacts"][row["artifactKey"]]
        source_key = artifact["inputKey"]
        if row["contractName"] != artifact["contractIdentifier"].split(":")[-1]:
            fail("Receipt artifact identifier changed")
        contracts.append({**row, "contractIdentifier": artifact["contractIdentifier"],
                          "compilerVersion": artifact["compilerVersion"], "inputKey": source_key,
                          "sourceInputSha256": INPUTS[source_key][1], "optimizerRuns": 1,
                          "evmVersion": standards[source_key]["settings"]["evmVersion"]})
    plan = {"format": FORMAT, "chainId": 8453, "packageSha256": PACKAGE_SHA,
            "confirmedManifestFileSha256": digest(raw), "compilerProofSha256": PROOF_SHA,
            "bridgeSha256": BRIDGE_SHA, "backendSha256": BACKEND_SHA, "contracts": contracts,
            "verificationRequiresGas": False, "transactionsSent": 0}
    return {**plan, "planSha256": digest(encoded(plan)), "chainQualified": False}


def qualify(plan, confirmed, node):
    fresh = bridge(confirmed, node, qualify=True)
    q = fresh.get("qualification") or {}
    if (fresh.get("chainQualified") is not True or fresh.get("packageSha256") != PACKAGE_SHA
            or fresh.get("backendSha256") != BACKEND_SHA
            or fresh.get("confirmedManifestFileSha256") != plan["confirmedManifestFileSha256"]
            or q.get("format") != "yunipals-ypal-backend-chain-qualification-v1"
            or q.get("packageSha256") != PACKAGE_SHA or q.get("currentStateQualified") is not True
            or q.get("chainId") != 8453 or len(q.get("transactions", [])) != 10
            or not re.fullmatch("0x[0-9a-fA-F]{64}", q.get("blockHash", ""))):
        fail("Fresh actual complete deployment chain qualification required")
    transport = fresh.get("publicReadOnlyQualification") or {}
    methods = transport.get("methodCounts", {})
    allowed = {"eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionReceipt",
               "eth_getTransactionByHash", "eth_getCode", "eth_getStorageAt", "eth_call"}
    if (transport.get("endpoint") != "https://mainnet.base.org" or transport.get("requestCap") != 128 or transport.get("maximumSeconds") != 180
            or type(transport.get("rpcCalls")) is not int or not 0 < transport["rpcCalls"] <= 128
            or not isinstance(methods, dict) or set(methods) - allowed
            or any(type(n) is not int or n <= 0 for n in methods.values())
            or sum(methods.values()) != transport["rpcCalls"] or transport.get("retryCount") != 0
            or transport.get("financialIndexerProfileUsed") is not False or transport.get("profileChanges") != 0
            or transport.get("paidProvider") is not False or transport.get("transactionMethodsAllowed") is not False):
        fail("Fixed bounded public readonly deployment qualification required")
    for saved, current in zip(plan["contracts"], fresh.get("contracts", []), strict=True):
        if any(saved.get(key) != value for key, value in current.items()):
            fail("Actual receipt constructor or creation input changed")
        if q.get("codeHashes", {}).get(saved["step"]) != saved["runtimeKeccak256"]:
            fail("Current onchain runtime differs from the reviewed constructor/artifact")
    return q


def canonical_abi(abi):
    return sorted(json.dumps(row, sort_keys=True, separators=(",", ":")) for row in abi)


def published_input(record):
    raw = record.get("SourceCode", "")
    if not isinstance(raw, str) or len(raw) > 2_000_000:
        fail("Bounded explorer standard input required")
    if raw.startswith("{{") and raw.endswith("}}"):
        raw = raw[1:-1]
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("language") != "Solidity" or not isinstance(value.get("sources"), dict) or not isinstance(value.get("settings"), dict):
        fail("Explorer Solidity standard input required")
    return value


def validate_record(record, entry, standards, proof, *, reference=False):
    published = published_input(record)
    source = standards[entry["inputKey"]]
    artifact = proof["artifacts"][entry["artifactKey"]]
    proxy = entry["artifactKey"] == "proxy"
    similar = record.get("SimilarMatch") or ""
    if similar and (not proxy or reference or not re.fullmatch("0x[0-9a-fA-F]{40}", similar)):
        fail("Full explorer source match required for token and implementations")
    if (record.get("ContractName") != entry["contractName"]
            or record.get("CompilerVersion") != entry["compilerVersion"]
            or str(record.get("OptimizationUsed")) != "1"):
        fail("Explorer contract/compiler differs from the reviewed artifact")
    actual = published.get("settings", {})
    expected = source["settings"]
    runs = int(record.get("Runs", -1))
    if runs not in ({1, 200} if proxy else {1}) or actual.get("optimizer") != {"enabled": True, "runs": runs}:
        fail("Explorer optimizer differs from the byte-reproduced settings")
    if set(actual) - {"optimizer", "viaIR", "evmVersion", "metadata", "libraries", "remappings", "outputSelection"}:
        fail("Unexpected explorer compiler setting")
    for key in ("viaIR", "evmVersion", "metadata"):
        if actual.get(key) != expected.get(key):
            fail("Explorer compiler setting differs: " + key)
    if actual.get("libraries", {}) != expected.get("libraries", {}):
        fail("Explorer linked libraries differ")
    if proxy:
        if any(published.get("sources", {}).get(key) != value for key, value in source["sources"].items()):
            fail("Explorer proxy transitive source closure differs")
        remappings = actual.get("remappings", [])
        if (not isinstance(remappings, list) or len(remappings) != len(set(remappings))
                or set(remappings) - set(expected.get("remappings", []))):
            fail("Explorer proxy remappings differ from reviewed mappings")
    elif (published.get("sources") != source["sources"]
          or actual.get("remappings") != expected.get("remappings")):
        fail("Exact full explorer source input required")
    actual_abi = json.loads(record.get("ABI", "null"))
    if not isinstance(actual_abi, list) or canonical_abi(actual_abi) != canonical_abi(artifact["abi"]):
        fail("Explorer complete ABI differs from reproduced compiler ABI")
    constructor = str(record.get("ConstructorArguments", "")).removeprefix("0x").lower()
    if not similar and not reference and constructor != entry["constructorArguments"].lower():
        fail("Explorer constructor arguments differ from actual signed creation")
    return {"verificationLevel": "similar-proxy" if similar else "full",
            "compilerVersion": entry["compilerVersion"], "optimizerRuns": runs,
            "sourceInputSha256": entry["sourceInputSha256"], "sourceFilesChecked": len(source["sources"]),
            "fullAbiMatch": True, "constructorProofScope": "actual-signed-creation-in-separate-chain-qualification",
            "explorerConstructorExact": constructor == entry["constructorArguments"].lower(),
            "similarMatch": similar or None, "proxyEquivalentRuns1And200Proven": proxy}


def record(key, address):
    value = api(key, "getsourcecode", {"address": address})
    if value.get("status") != "1" or not isinstance(value.get("result"), list) or len(value["result"]) != 1 or not isinstance(value["result"][0], dict):
        fail("One explorer source record required")
    return value["result"][0]


def validate_source(key, row, entry, standards, proof):
    checked = validate_record(row, entry, standards, proof)
    if checked["similarMatch"]:
        reference_row = record(key, checked["similarMatch"])
        validate_record(reference_row, entry, standards, proof, reference=True)
        checked["independentFullReferenceSourceChecked"] = True
    return checked


def save(path, report):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        fail("Refuse symlink verification output")
    fd, name = tempfile.mkstemp(prefix=".ypal-verification-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o644)
            stream.write((json.dumps(report, indent=2) + "\n").encode())
            stream.flush(); os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def submit(confirmed, expected, output, node="node"):
    plan = prepare(confirmed, node)
    if plan["planSha256"] != expected:
        fail("Exact reviewed seven-contract verification plan required")
    standards, proof = reviewed_inputs()
    initial = qualify(plan, confirmed, node)  # Always before loading the existing key or making any explorer call.
    path = Path(output)
    if path.name != "basescan-results.json":
        fail("Explicit basescan-results.json public output required")
    report = json.loads(read(path)) if path.exists() else {"format": FORMAT, "plan": plan,
        "contracts": {}, "proxies": {}, "mainnetTransactionsSent": False}
    if report.get("format") != FORMAT or report.get("plan") != plan:
        fail("Another verification plan occupies this output")
    key = load_key()
    report["completed"] = False
    report["initialChainQualification"] = initial
    report["status"] = "in-progress"
    save(path, report)
    # Full implementation sources precede proxy association.
    entries = sorted(plan["contracts"], key=lambda row: row["implementation"] is not None)
    for entry in entries:
        address = entry["address"]
        previous = report["contracts"].get(address, {})
        current = record(key, address)
        if not current.get("SourceCode") or (current.get("SimilarMatch") and entry["artifactKey"] != "proxy"):
            guid = previous.get("guid")
            if not guid:
                response = api(key, "verifysourcecode", {
                    "contractaddress": address, "sourceCode": json.dumps(standards[entry["inputKey"]]),
                    "codeformat": "solidity-standard-json-input", "contractname": entry["contractIdentifier"],
                    "compilerversion": entry["compilerVersion"], "constructorArguments": entry["constructorArguments"],
                    "constructorArguements": entry["constructorArguments"], "optimizationUsed": "1",
                    "runs": "1", "evmVersion": entry["evmVersion"], "licenseType": "3"
                }, post=True)
                if response.get("status") != "1":
                    # An already-verified reply is accepted only through the independent strict public record below.
                    current = record(key, address)
                    validate_source(key, current, entry, standards, proof)
                else:
                    guid = response["result"]
                    report["contracts"][address] = {"guid": guid, "status": "pending"}
                    save(path, report)
            if guid:
                try:
                    poll(key, "checkverifystatus", guid)
                except RuntimeError:
                    current = record(key, address)
                    validate_source(key, current, entry, standards, proof)
                current = record(key, address)
        checked = validate_source(key, current, entry, standards, proof)
        report["contracts"][address] = {**previous, **report["contracts"].get(address, {}),
            "step": entry["step"], "status": "verified", **checked,
            "url": "https://basescan.org/address/" + address + "#code"}
        save(path, report)
    for entry in entries:
        if not entry["implementation"]:
            continue
        address = entry["address"]
        current = record(key, address)
        if (str(current.get("Proxy")) != "1"
                or str(current.get("Implementation", "")).lower() != entry["implementation"].lower()):
            guid = report["proxies"].get(address, {}).get("guid")
            if not guid:
                response = api(key, "verifyproxycontract", {"address": address,
                    "expectedimplementation": entry["implementation"]}, post=True)
                if response.get("status") != "1":
                    fail("Explorer proxy association submission refused")
                guid = response["result"]
                report["proxies"][address] = {"guid": guid, "status": "pending"}
                save(path, report)
            poll(key, "checkproxyverification", guid)
        current = record(key, address)
        validate_source(key, current, entry, standards, proof)
        if (str(current.get("Proxy")) != "1"
                or str(current.get("Implementation", "")).lower() != entry["implementation"].lower()):
            fail("Explorer proxy association is not the current confirmed implementation")
        report["proxies"][address] = {**report["proxies"].get(address, {}), "status": "linked",
            "implementation": entry["implementation"]}
        save(path, report)
    report["finalChainQualification"] = qualify(plan, confirmed, node)
    # Independently reread every public source and association after the final chain check.
    for entry in entries:
        current = record(key, entry["address"])
        validate_source(key, current, entry, standards, proof)
        if entry["implementation"] and (str(current.get("Proxy")) != "1"
                or str(current.get("Implementation", "")).lower() != entry["implementation"].lower()):
            fail("Explorer association changed during final qualification")
    report.update(status="seven-contracts-verified-and-three-proxies-linked", completed=True,
                  checkedAt=datetime.now(timezone.utc).isoformat())
    save(path, report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirmed", type=Path)
    parser.add_argument("--node", default="node")
    parser.add_argument("--qualify", action="store_true")
    parser.add_argument("--submit", metavar="PLAN_SHA256")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.submit:
            if not args.confirmed or not args.output or args.qualify:
                fail("Submit requires actual confirmed manifest and output, without --qualify")
            result = submit(args.confirmed, args.submit, args.output, args.node)
            value = {"status": result["status"], "completed": result["completed"],
                     "contracts": len(result["contracts"]), "proxies": len(result["proxies"]),
                     "mainnetTransactionsSent": False}
        else:
            if args.output:
                fail("Output is reserved for explicit verification; prepare prints public data only")
            value = prepare(args.confirmed, args.node)
            if args.qualify:
                if not args.confirmed:
                    fail("Actual confirmed manifest required before qualification")
                value = {**value, "qualification": qualify(value, args.confirmed, args.node), "chainQualified": True}
        print(json.dumps(value, indent=2))
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError):
        print("YPAL verification refused; credentials and private configuration omitted.", file=__import__("sys").stderr)
        raise SystemExit(1)
