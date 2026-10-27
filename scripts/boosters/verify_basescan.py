"""Publish the final audited booster sources on BaseScan; never signs transactions."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from extract_audit import extract

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/boosters/mainnet-smoke/verification"
AUDIT = ROOT / "docs/boosters/audit/yunipals-boosters-final-r01-2026-10-20.txt"
AUDIT_SHA = "32fae8ad6b15d52c92cdeb7fa18e4452e762ca367a6dd29c427bb65ac3f06756"
INPUT_SHA = "b1a73d9ee14e2a38876ef856e4beae76fdb61d8dc5a81c665ecf2610062b1fbd"
API = "https://api.etherscan.io/v2/api"


def save(name, value):
    (OUTPUT / name).write_text(json.dumps(value, indent=2) + "\n")


def prepare():
    if hashlib.sha256(AUDIT.read_bytes()).hexdigest() != AUDIT_SHA:
        raise ValueError("Final audit package fingerprint changed")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yunipals-verification-") as temporary:
        extract(AUDIT, temporary)
        snapshot = Path(temporary)
        standard_input = (snapshot / "audit/solc-standard-input.json").read_bytes()
        fingerprints = json.loads((snapshot / "audit/build-fingerprints.json").read_text())
        reviewed = json.loads(
            (snapshot / "docs/boosters/mainnet-smoke/deployment.unsigned.json").read_text()
        )
    if hashlib.sha256(standard_input).hexdigest() != INPUT_SHA:
        raise ValueError("Audited compiler input fingerprint changed")
    plan = json.loads((ROOT / "docs/boosters/mainnet-smoke/deployment.unsigned.json").read_text())
    if plan["transactions"] != reviewed["transactions"]:
        raise ValueError("Unsigned deployment differs from final audit")
    (OUTPUT / "solc-standard-input.json").write_bytes(standard_input)
    entries = []
    for i, transaction in enumerate(plan["transactions"]):
        name = ["PackRegistry", "ERC1967Proxy", "YunipalMonsters",
                "ERC1967Proxy", "BoosterPacks", "ERC1967Proxy"][i]
        artifact = json.loads(
            (ROOT / f"contracts/boosters/out/{name}.sol/{name}.json").read_text()
        )
        bytecode = artifact["bytecode"]["object"]
        if hashlib.sha256(bytes.fromhex(bytecode[2:])).hexdigest() != fingerprints[name]["creationBytecodeSha256"]:
            raise ValueError(f"Compiled artifact differs from audit: {name}")
        creation = transaction["unsigned"]["data"]
        if not creation.startswith(bytecode):
            raise ValueError(f"Unexpected constructor bytecode: {name}")
        constructor = creation[len(bytecode):]
        constructor_file = f"{i + 1}-constructor-arguments.txt"
        (OUTPUT / constructor_file).write_text(constructor + "\n")
        entries.append({
            "label": transaction["label"],
            "address": transaction["predictedAddress"],
            "contractIdentifier": f"{fingerprints[name]['source']}:{name}",
            "compilerVersion": "v0.8.30+commit.73712a01",
            "constructorArguments": constructor,
            "constructorArgumentsFile": constructor_file,
            "implementation": plan["transactions"][i - 1]["predictedAddress"] if i % 2 else None,
            "explorerUrl": f"https://basescan.org/address/{transaction['predictedAddress']}#code",
        })
    package = {
        "chainId": 8453,
        "auditPackageSha256": AUDIT_SHA,
        "standardInput": "solc-standard-input.json",
        "standardInputSha256": INPUT_SHA,
        "contracts": entries,
        "verificationRequiresGas": False,
    }
    save("verification-package.json", package)
    return package


def load_key():
    key = os.environ.get("ETHERSCAN_API_KEY", "").strip()
    if not key:
        filename = ROOT / ".env.verification.local"
        if filename.exists():
            if filename.stat().st_mode & 0o077:
                raise ValueError("Run chmod 600 .env.verification.local before using its API key")
            for line in filename.read_text().splitlines():
                if line.startswith("ETHERSCAN_API_KEY="):
                    key = line.partition("=")[2].strip().strip("'\"")
                    break
    if not key or key == "your_etherscan_api_key":
        raise ValueError("ETHERSCAN_API_KEY is not configured")
    return key


def api(key, action, fields=None, post=False):
    params = {"chainid": "8453", "module": "contract", "action": action, "apikey": key}
    body = fields or {}
    if not post:
        params.update(body)
    request = Request(
        API + "?" + urlencode(params),
        data=urlencode(body).encode() if post else None,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode().replace(key, "[redacted]"))
    except HTTPError as error:
        raise RuntimeError(f"Explorer API HTTP {error.code}; credentials omitted") from None
    except (URLError, TimeoutError):
        raise RuntimeError("Explorer API connection failed; credentials omitted") from None
    time.sleep(0.4)
    return result


def poll(key, action, guid):
    for _ in range(20):
        result = api(key, action, {"guid": guid})
        if result.get("status") == "1":
            return result
        if "pending" not in str(result.get("result", "")).lower():
            raise RuntimeError(f"Explorer verification failed: {result.get('result')}")
        time.sleep(3)
    raise RuntimeError(f"Verification still pending; resume with GUID {guid}")


def submit(package):
    key = load_key()
    source = (OUTPUT / package["standardInput"]).read_text()
    report_path = OUTPUT / "basescan-results.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {
        "chainId": 8453, "contracts": {}, "proxies": {}, "mainnetTransactionsSent": False
    }
    # Verify implementations first; proxy linking requires their verified ABIs.
    entries = package["contracts"]
    for entry in [entries[i] for i in [0, 2, 4, 1, 3, 5]]:
        address = entry["address"]
        existing = api(key, "getsourcecode", {"address": address})
        records = existing.get("result")
        if existing.get("status") != "1" or not isinstance(records, list):
            raise RuntimeError(f"Explorer read failed: {records}")
        record = records[0]
        if not record.get("SourceCode"):
            prior = report["contracts"].get(address, {})
            guid = prior.get("guid")
            if not guid:
                result = api(key, "verifysourcecode", {
                    "contractaddress": address,
                    "sourceCode": source,
                    "codeformat": "solidity-standard-json-input",
                    "contractname": entry["contractIdentifier"],
                    "compilerversion": entry["compilerVersion"],
                    "constructorArguments": entry["constructorArguments"],
                    # Etherscan historically used this misspelled field.
                    "constructorArguements": entry["constructorArguments"],
                    "optimizationUsed": "1",
                    "runs": "200",
                    "evmVersion": "cancun",
                    "licenseType": "3",
                }, post=True)
                if result.get("status") != "1":
                    raise RuntimeError(f"Submission failed for {address}: {result.get('result')}")
                guid = result["result"]
                report["contracts"][address] = {"label": entry["label"], "guid": guid, "status": "pending"}
                save("basescan-results.json", report)
            try:
                poll(key, "checkverifystatus", guid)
            except RuntimeError as error:
                # BaseScan can publish the source even when the job endpoint
                # reports failure. Confirm the public record before retrying.
                time.sleep(3)
                refreshed = api(key, "getsourcecode", {"address": address})
                if refreshed.get("status") != "1" or not isinstance(refreshed.get("result"), list):
                    raise error
                record = refreshed["result"][0]
                if not record.get("SourceCode"):
                    raise error
                report["contracts"][address]["jobStatusWarning"] = str(error)
            else:
                records = api(key, "getsourcecode", {"address": address})["result"]
                record = records[0]
            if not record.get("SourceCode"):
                raise RuntimeError("Explorer has not yet exposed verified source")
        report["contracts"][address] = {
            **report["contracts"].get(address, {}),
            "label": entry["label"], "status": "verified",
            "contractName": record["ContractName"], "compilerVersion": record["CompilerVersion"],
            "similarMatch": record.get("SimilarMatch"),
            "verificationLevel": "similar" if record.get("SimilarMatch") else "full",
            "url": entry["explorerUrl"],
        }
        save("basescan-results.json", report)
        print(f"Source verified: {entry['label']} — {address}", flush=True)
    for entry in entries:
        if not entry["implementation"]:
            continue
        address = entry["address"]
        record = api(key, "getsourcecode", {"address": address})["result"][0]
        if str(record.get("Implementation", "")).lower() != entry["implementation"].lower():
            guid = report["proxies"].get(address, {}).get("guid")
            if not guid:
                result = api(key, "verifyproxycontract", {
                    "address": address,
                    "expectedimplementation": entry["implementation"],
                }, post=True)
                if result.get("status") != "1":
                    raise RuntimeError(f"Proxy linking failed: {result.get('result')}")
                guid = result["result"]
                report["proxies"][address] = {"guid": guid, "status": "pending"}
                save("basescan-results.json", report)
            poll(key, "checkproxyverification", guid)
            record = api(key, "getsourcecode", {"address": address})["result"][0]
        if str(record.get("Implementation", "")).lower() != entry["implementation"].lower():
            raise RuntimeError("Explorer proxy implementation does not match deployment")
        report["proxies"][address] = {
            "status": "linked", "implementation": entry["implementation"],
            "url": f"https://basescan.org/address/{address}#readProxyContract",
        }
        save("basescan-results.json", report)
        print(f"Proxy linked: {address}", flush=True)
    report["status"] = "implementations-verified-and-proxies-linked"
    report["checkedAt"] = datetime.now(timezone.utc).isoformat()
    report["fullMatchCount"] = sum(
        record["verificationLevel"] == "full" for record in report["contracts"].values()
    )
    report["similarMatchCount"] = sum(
        record["verificationLevel"] == "similar" for record in report["contracts"].values()
    )
    save("basescan-results.json", report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--submit", action="store_true", help="Publish sources using the configured Etherscan API key")
    args = parser.parse_args()
    try:
        prepared = prepare()
        print(f"Prepared all six contracts: {OUTPUT / 'verification-package.json'}", flush=True)
        if args.submit:
            submit(prepared)
    except (ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
