"""Complete fresh verification with one independently compiled proxy reference."""
import argparse
import json
import os
from pathlib import Path
import subprocess

import verify_ypal_basescan as base

BASE_SHA = "1c491156e3c244457848482e84385d3677ac806dfae1cb20c5178ca6f22faca6"
PROOF_SHA = "e9980a3c35b51279b662daf0dea80314a7f1ad8ee2ed4348a33946c7f1672c2a"
FOLDER = base.ROOT / "docs/boosters/ypal-fresh-launch-2026-10-23/verification-proxy-reference"
COMPILER = Path("/tmp/yunipals-solc-0.8.30")
ORIGINAL_VALIDATOR = base.validate_record


def compiled_reference():
    if base.digest(base.read(Path(base.__file__))) != BASE_SHA:
        base.fail("Frozen seven-contract verifier changed")
    proof = base.document(FOLDER / "proof.json", PROOF_SHA)
    source = base.document(FOLDER / "standard-input.json", proof["inputSha256"])
    record = base.document(FOLDER / "public-record.json", proof["publicRecordSha256"])
    package = base.document(base.PACKAGE, base.PACKAGE_SHA)
    if (proof["packageSha256"] != base.PACKAGE_SHA
            or proof["format"] != "yunipals-ypal-proxy-similar-source-byte-equivalence-v1"
            or proof["actualReferenceSettings"] != source["settings"]
            or proof["compilerVersion"] != "v0.8.30+commit.73712a01"
            or base.digest(base.read(COMPILER, 20_000_000)) != proof["compilerBinarySha256"]):
        base.fail("Pinned source, compiler and reviewed package required")
    result = subprocess.run([str(COMPILER), "--standard-json"],
                            input=json.dumps(source).encode(), capture_output=True, timeout=30,
                            env={k: os.environ[k] for k in ("PATH", "LANG", "TZ") if k in os.environ})
    if result.returncode or result.stderr or len(result.stdout) > 2_000_000:
        base.fail("Bounded independent proxy reference compilation required")
    output = json.loads(result.stdout)
    if any(e.get("severity") == "error" for e in output.get("errors", [])):
        base.fail("Proxy reference compilation contains errors")
    filename, name = proof["contractIdentifier"].split(":")
    compiled = output["contracts"][filename][name]
    artifact = package["artifacts"]["proxy"]
    for label, actual, expected in (
        ("creation", compiled["evm"]["bytecode"]["object"], artifact["creationBytecode"][2:]),
        ("runtime", compiled["evm"]["deployedBytecode"]["object"], artifact["runtimeTemplate"][2:])
    ):
        if actual != expected or base.digest(bytes.fromhex(actual)) != proof[label + "BytecodeSha256"]:
            base.fail("Public reference differs from the deployed reviewed proxy bytes")
    _, original_proof = base.reviewed_inputs()
    if (base.canonical_abi(compiled["abi"]) != base.canonical_abi(original_proof["artifacts"]["proxy"]["abi"])
            or base.canonical_abi(compiled["abi"]) != base.canonical_abi(json.loads(record["ABI"]))):
        base.fail("Complete reference and deployed proxy ABIs must agree")
    return proof, source, compiled["abi"]


def reference_validator(proof, source, abi):
    def validate(record, entry, standards, original_proof, *, reference=False):
        try:
            return ORIGINAL_VALIDATOR(record, entry, standards, original_proof, reference=reference)
        except ValueError:
            if entry["artifactKey"] != "proxy":
                raise
        similar = record.get("SimilarMatch") or ""
        if (similar != ("" if reference else proof["referenceAddress"])
                or record.get("ContractName") != "ERC1967Proxy"
                or record.get("CompilerVersion") != proof["compilerVersion"]
                or str(record.get("OptimizationUsed")) != "1" or str(record.get("Runs")) != "200"
                or base.published_input(record) != source
                or base.canonical_abi(json.loads(record.get("ABI", "null"))) != base.canonical_abi(abi)):
            base.fail("Only the exact independently compiled proxy reference is accepted")
        constructor = str(record.get("ConstructorArguments", "")).removeprefix("0x").lower()
        return {
            "verificationLevel": "full" if reference else "similar-proxy",
            "compilerVersion": proof["compilerVersion"], "optimizerRuns": 200,
            "sourceInputSha256": proof["inputSha256"],
            "reviewedSourceInputSha256": entry["sourceInputSha256"],
            "sourceFilesChecked": len(source["sources"]), "fullAbiMatch": True,
            "constructorProofScope": "actual-signed-creation-in-separate-chain-qualification",
            "explorerConstructorExact": constructor == entry["constructorArguments"].lower(),
            "similarMatch": similar or None,
            "referenceCreationAndRuntimeByteIdentical": True,
            "referenceRecompiledDuringVerification": True,
            "referenceCompilerSettings": source["settings"],
            "referenceProofSha256": PROOF_SHA
        }
    return validate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirmed", required=True, type=Path)
    parser.add_argument("--node", default="node")
    parser.add_argument("--submit", metavar="PLAN_SHA256")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    proof, source, abi = compiled_reference()
    if not args.submit:
        if args.output:
            base.fail("Output requires explicit source verification")
        plan = base.prepare(args.confirmed, args.node)
        print(json.dumps({"offlinePreparationPassed": True, "planSha256": plan["planSha256"],
                          "referenceProofSha256": PROOF_SHA, "explorerCalls": 0}))
        return
    if not args.output:
        base.fail("Explicit public verification output required")
    base.validate_record = reference_validator(proof, source, abi)
    report = base.submit(args.confirmed, args.submit, args.output, args.node)
    report["proxyReferenceSupplement"] = {"proofSha256": PROOF_SHA,
        "reference": proof["referenceAddress"], "recompiledDuringVerification": True,
        "baseVerifierSha256": BASE_SHA, "verifierSha256": base.digest(base.read(Path(__file__)))}
    base.save(args.output, report)
    print(json.dumps({"status": report["status"], "completed": report["completed"],
        "contracts": len(report["contracts"]), "proxies": len(report["proxies"]),
        "proxyMatchLevel": "similar-source-with-identical-creation-and-runtime",
        "mainnetTransactionsSent": False}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        print("YPAL reference verification refused; credentials omitted.", file=__import__("sys").stderr)
        raise SystemExit(1)
