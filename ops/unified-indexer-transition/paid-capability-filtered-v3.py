#!/usr/bin/env python3
"""Finite filtered-span probe component; no live admission or execution CLI."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import types

FORMAT = "yunipals-paid-capability-components-v1"
REVISION = "filtered_base_v3"
SCOPE = "filtered_historical_span_capability"
TRANSPORT_SHA = "f288221ecb9e5f5b18723b54ddb8f7362b5079e1596c1996622454bff2c820d4"
PROFILE = "0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3"
TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
CHAINS = {
    56: {"port": 19204, "first": 7716583, "address": "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d"},
    8453: {"port": 19202, "first": 22224858, "address": "0x98433df878e8c898cb907345c3a7756e5f72240f"}
}
SPANS = (26, 1000, 10000)
MAX_CALLS, MAX_BYTES, MAX_LOGS = 6, 2_000_000, 10000
MAX_SECONDS, CALL_SECONDS, SPACING = 180, 20, 1
SELECTION_RULE = "first_inclusion_tuple_in_known_block"


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class Refusal(RuntimeError):
    pass


def fail(reason):
    raise Refusal(reason)


def transport_module():
    path = Path(__file__).with_name("paid-capability-controller-v2.py")
    raw = path.read_bytes()
    if sha(raw) != TRANSPORT_SHA:
        fail("frozen_transport_changed")
    module = types.ModuleType("paid_filtered_v3_frozen_transport")
    module.__file__ = str(path)
    sys.modules[module.__name__] = module
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


# Only the immutable, already tested transport implementation is reused. Its
# globals, call decoder, financial planner and probe loop are never replaced.
_transport = transport_module()
LoopbackTransport = _transport.LoopbackTransport
FIXED_FAILURES = _transport.FIXED_FAILURES | frozenset({
    "frozen_transport_changed", "invalid_probe_clock", "fixed_probe_identity_required", "exact_base_filtered_call_required",
    "client_body_limit", "client_response_limit", "selected_token_mismatch", "conflicting_log_inclusion",
    "selected_baseline_missing_or_changed", "unfiltered_known_base_baseline_required", "known_base_block_event_absent",
    "fixed_two_permits_required", "fixed_permit_range_required", "distinct_permit_ids_required", "live_guard_refused",
    "booked_grants_or_live_baseline_changed", "exact_prior_booked_and_window_required"
})


def moment(value):
    try:
        value = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise ValueError()
        return value.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        fail("invalid_probe_clock")


def quantity(value):
    if not isinstance(value, str) or re.fullmatch(r"0x(?:0|[1-9a-f][0-9a-f]*)", value) is None:
        fail("invalid_log_quantity")
    result = int(value, 16)
    if result > (1 << 53)-1:
        fail("invalid_log_quantity")
    return result


def topic(value):
    return isinstance(value, str) and re.fullmatch(r"0x[0-9a-fA-F]{64}", value) is not None


@dataclass(frozen=True)
class ProbeCall:
    id: int
    chain: int
    span: int
    permit: str
    token_topic: str | None = None

    def body(self):
        if (type(self.id) is not int or not 1 <= self.id <= 6 or type(self.chain) is not int or self.chain not in CHAINS or
                type(self.span) is not int or self.span not in SPANS or not isinstance(self.permit, str) or
                re.fullmatch(r"0x[0-9a-f]{64}", self.permit) is None):
            fail("fixed_probe_identity_required")
        filtered = self.chain == 8453 and self.span in (1000, 10000)
        if (filtered and (not topic(self.token_topic) or self.token_topic != self.token_topic.lower()) or
                not filtered and self.token_topic is not None):
            fail("exact_base_filtered_call_required")
        value = CHAINS[self.chain]
        topics = [TOPIC, None, None, self.token_topic] if filtered else [TOPIC]
        return {"jsonrpc": "2.0", "id": self.id, "method": "eth_getLogs", "params": [{
            "address": value["address"], "fromBlock": hex(value["first"]),
            "toBlock": hex(value["first"]+self.span-1), "topics": topics
        }]}

    def headers(self):
        self.body()
        return {"Content-Type": "application/json", "Connection": "close", "x-yunipals-unified-rpc-profile": PROFILE,
                "x-yunipals-rpc-workload": "unified_source", "x-yunipals-unified-rpc-permit": self.permit}


@dataclass(frozen=True)
class TokenSelector:
    """Private in-memory selector; public output contains only its digests."""
    token_topic: str
    key: str
    log_sha256: str
    response_sha256: str
    known_block_count: int

    def digest(self):
        return sha(encoded([8453, CHAINS[8453]["address"], CHAINS[8453]["first"], SELECTION_RULE,
                            self.token_topic, self.key, self.log_sha256, self.response_sha256]))


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("invalid_json_response")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: fail("invalid_json_response"))
    except (ValueError, UnicodeDecodeError):
        fail("invalid_json_response")


def _decode(call, status, raw, prior, selector=None):
    call.body()
    if type(status) is not int or status != 200:
        fail("http_rate_limited" if status == 429 else "http_unauthorized" if status in (401, 403) else "http_failure")
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        fail("client_body_limit")
    payload = _json(raw)
    if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0" or type(payload.get("id")) is not int or payload["id"] != call.id:
        fail("response_identity_mismatch")
    if "error" in payload:
        code = payload["error"].get("code") if isinstance(payload["error"], dict) else None
        fail("rpc_invalid_params" if code == -32602 else "rpc_range_refused" if code == -32005 else "rpc_failure")
    if set(payload) != {"jsonrpc", "id", "result"} or not isinstance(payload["result"], list) or len(payload["result"]) > MAX_LOGS:
        fail("invalid_log_result")
    chain = CHAINS[call.chain]
    found, records, block_hashes, tuples = {}, [], {}, set()
    for log in payload["result"]:
        if (not isinstance(log, dict) or not isinstance(log.get("address"), str) or log["address"].lower() != chain["address"] or
                log.get("removed") is not False or log.get("data") != "0x"):
            fail("invalid_matching_log")
        topics = log.get("topics")
        if (not isinstance(topics, list) or len(topics) != 4 or not all(topic(t) for t in topics) or topics[0].lower() != TOPIC or
                any(t[2:26] != "0"*24 for t in topics[1:3])):
            fail("invalid_erc721_topics")
        if call.token_topic is not None and topics[3].lower() != call.token_topic:
            fail("selected_token_mismatch")
        if any(not topic(log.get(key)) for key in ("blockHash", "transactionHash")):
            fail("invalid_log_hash")
        block = quantity(log.get("blockNumber"))
        if not chain["first"] <= block < chain["first"]+call.span:
            fail("log_outside_fixed_range")
        normalized = {"block": block, "transactionIndex": quantity(log.get("transactionIndex")), "logIndex": quantity(log.get("logIndex")),
                      "blockHash": log["blockHash"].lower(), "transactionHash": log["transactionHash"].lower(),
                      "topics": [t.lower() for t in topics], "address": chain["address"], "data": "0x"}
        inclusion = (block, normalized["transactionIndex"], normalized["logIndex"])
        if inclusion in tuples or block_hashes.get(block, normalized["blockHash"]) != normalized["blockHash"]:
            fail("conflicting_log_inclusion")
        tuples.add(inclusion); block_hashes[block] = normalized["blockHash"]
        key = sha(encoded([normalized["blockHash"], normalized["transactionHash"], normalized["logIndex"]]))
        if key in found:
            fail("duplicate_log")
        found[key] = sha(encoded(normalized)); records.append((inclusion, key, normalized))
    if any(found.get(key) != value for key, value in prior.items()):
        fail("nested_range_response_inconsistent")
    if call.token_topic is not None:
        if (not isinstance(selector, TokenSelector) or selector.token_topic != call.token_topic or
                found.get(selector.key) != selector.log_sha256):
            fail("selected_baseline_missing_or_changed")
    known = sum(1 for inclusion, _, _ in records if call.chain == 8453 and inclusion[0] == chain["first"])
    summary = {"logCount": len(found), "knownBaseBlockLogCount": known, "responseBytes": len(raw), "responseSha256": sha(raw),
               "filterKind": "selected_token_transfer" if call.token_topic is not None else "collection_transfer",
               "selectorSha256": selector.digest() if selector else None,
               "selectedBaselineLogSha256": selector.log_sha256 if selector else None,
               "selectedBaselineObserved": bool(selector and found.get(selector.key) == selector.log_sha256),
               "nestedConsistencyChecked": call.span in (1000, 10000)}
    return summary, found, records


def decode_reply(call, status, raw, prior, selector=None):
    summary, found, _ = _decode(call, status, raw, prior, selector)
    return summary, found


def select_base_selector(call, status, raw):
    if call.chain != 8453 or call.span != 26 or call.token_topic is not None:
        fail("unfiltered_known_base_baseline_required")
    _, found, records = _decode(call, status, raw, {})
    known = sorted((row for row in records if row[0][0] == CHAINS[8453]["first"]), key=lambda row: row[0])
    if not known:
        fail("known_base_block_event_absent")
    _, key, log = known[0]
    return TokenSelector(log["topics"][3], key, found[key], sha(raw), len(known))


def _permit_rows(permits, phase_expires):
    if not isinstance(permits, list) or len(permits) != 2:
        fail("fixed_two_permits_required")
    rows = {}
    for value in permits:
        if (not isinstance(value, dict) or set(value) != {"permitId", "chainId", "fromBlock", "throughBlock", "maximumCu", "expires"} or
                type(value["chainId"]) is not int or value["chainId"] not in CHAINS or value["chainId"] in rows):
            fail("fixed_two_permits_required")
        chain = value["chainId"]
        if (value["fromBlock"] != str(CHAINS[chain]["first"]) or value["throughBlock"] != str(CHAINS[chain]["first"]+9999) or
                value["maximumCu"] != "180" or moment(value["expires"]) != phase_expires):
            fail("fixed_permit_range_required")
        ProbeCall(1, chain, 26, value["permitId"]).body()
        rows[chain] = value
    if len({row["permitId"] for row in rows.values()}) != 2:
        fail("distinct_permit_ids_required")
    return rows


def run_probe(*, permits, fresh_guard, prior_booked_cu, phase_start, phase_expires, original_expires,
              transport=None, utc_now=lambda: datetime.now(timezone.utc), monotonic=time.monotonic, sleep=time.sleep):
    """Caller holds actual leases/admission/timers and validates every guard.

    fresh_guard(counts, baseline) returns phaseBookedCu, aggregateBookedCu,
    sourceFreeCalls and evidence; only the caller can establish actual identity,
    paid counters, permit rows and financial state. No default live guard exists.
    The shared deadline is checked around every bounded guard/transport/spacing;
    the caller retains its outer process deadline and cleanup responsibility.
    """
    transport = transport or LoopbackTransport()
    started = monotonic(); counts = {"56": 0, "8453": 0}; previous = {56: {}, 8453: {}}
    baseline, selector, last_booked = None, None, 0
    result = {"format": FORMAT, "probeRevision": REVISION, "qualificationScope": SCOPE, "denseSourceCapacityQualified": False,
              "componentOnly": True, "integrationComplete": False, "status": "failed", "capabilityQualified": False,
              "knownBaseEventObserved": False, "allSixRangesAnswered": False, "attemptedRpcCalls": 0, "completedRpcCalls": 0,
              "maximumDispatchCu": 360, "maximumSeconds": MAX_SECONDS, "responseBytes": 0, "calls": [], "selectorWitness": None,
              "priorBookedCu": prior_booked_cu if type(prior_booked_cu) is int else None, "bookedMigrationCu": None, "aggregateMigrationBookedCu": None,
              "accountingComplete": False, "cleanupRequired": True, "productivePromotionAllowed": False,
              "automaticRetryAllowed": False, "rawResponsesEmitted": False, "guardElapsedSeconds": 0.0, "transportElapsedSeconds": 0.0,
              "attemptDurations": []}

    def allowance():
        elapsed = monotonic()-started
        current = moment(utc_now())
        remaining = min(MAX_SECONDS-elapsed, (end-current).total_seconds())
        if elapsed < 0 or current < start or remaining <= 0:
            fail("probe_deadline")
        return min(CALL_SECONDS, remaining)

    def guard():
        allowance(); begin = monotonic()
        try:
            # A guard must not be able to rebaseline a shared dictionary by
            # retaining or mutating the component's earlier observation.
            value = fresh_guard(dict(counts), json.loads(encoded(baseline)) if baseline is not None else None)
            value = json.loads(encoded(value))
        except Exception:
            fail("live_guard_refused")
        finally:
            result["guardElapsedSeconds"] += monotonic()-begin
        allowance()
        if (not isinstance(value, dict) or any(type(value.get(key)) is not int for key in ("phaseBookedCu", "aggregateBookedCu")) or
                not 0 <= value["phaseBookedCu"] <= 2000 or value["aggregateBookedCu"] != prior_booked_cu+value["phaseBookedCu"] or
                value["phaseBookedCu"] < last_booked or baseline is None and value["phaseBookedCu"] != 0 or
                baseline is not None and any(value.get(key) != baseline.get(key) for key in ("sourceFreeCalls", "evidence"))):
            fail("booked_grants_or_live_baseline_changed")
        if (not isinstance(value.get("sourceFreeCalls"), dict) or set(value["sourceFreeCalls"]) != {"1", "56", "137", "8453"} or
                any(type(n) is not int or not 0 <= n <= (1 << 53)-1 for n in value["sourceFreeCalls"].values()) or
                not isinstance(value.get("evidence"), dict) or set(value["evidence"]) != {"1", "56", "137", "8453"} or
                any(not isinstance(v, list) or len(v) != 2 or any(type(n) is not int or n != 0 for n in v) for v in value["evidence"].values())):
            fail("invalid_live_counter_shape")
        return value

    try:
        start, end = moment(phase_start), min(moment(phase_expires), moment(original_expires))
        if (type(prior_booked_cu) is not int or not 0 <= prior_booked_cu <= 20_000_000 or end <= start or
                moment(phase_expires) > moment(original_expires)):
            fail("exact_prior_booked_and_window_required")
        rows = _permit_rows(permits, moment(phase_expires))
        allowance(); baseline = guard()
        for index, (chain, span) in enumerate((chain, span) for chain in (56, 8453) for span in SPANS):
            if index:
                if allowance() <= SPACING:
                    fail("probe_deadline")
                sleep(SPACING); allowance()
            before_guard = result["guardElapsedSeconds"]
            before = guard()
            call = ProbeCall(index+1, chain, span, rows[chain]["permitId"], selector.token_topic if chain == 8453 and span != 26 and selector else None)
            call.body(); result["attemptedRpcCalls"] += 1
            duration = {"chainId": chain, "span": span, "transportSeconds": 0.0, "guardSeconds": 0.0, "accepted": False}
            result["attemptDurations"].append(duration)
            begin = monotonic()
            try:
                status, raw = transport(call, allowance(), MAX_BYTES-result["responseBytes"])
            finally:
                duration["transportSeconds"] = monotonic()-begin
                result["transportElapsedSeconds"] += duration["transportSeconds"]
                duration["guardSeconds"] = result["guardElapsedSeconds"]-before_guard
            allowance()
            if not isinstance(raw, bytes) or len(raw)+result["responseBytes"] > MAX_BYTES:
                fail("client_body_limit")
            result["responseBytes"] += len(raw)
            if chain == 8453 and span == 26:
                selector = select_base_selector(call, status, raw)
                result["selectorWitness"] = {"chainId": 8453, "address": CHAINS[8453]["address"], "knownBlock": CHAINS[8453]["first"],
                    "selectionRule": SELECTION_RULE, "selectorSha256": selector.digest(), "baselineLogSha256": selector.log_sha256,
                    "baselineResponseSha256": selector.response_sha256, "baselineMatchingLogCount": selector.known_block_count,
                    "filteredResponsesContainBaseline": False, "filteredNestedConsistency": False}
                summary, found, records = _decode(call, status, raw, {}, selector)
                # The unfiltered small range may contain several transfers of
                # the chosen token. Preserve its entire matching projection,
                # not only the event that selected the token.
                previous[8453] = {key: found[key] for _, key, log in records if log["topics"][3] == selector.token_topic}
            else:
                summary, found = decode_reply(call, status, raw, previous[chain], selector if chain == 8453 else None)
                previous[chain] = found
            counts[str(chain)] += 1
            try:
                after = guard()
            finally:
                duration["guardSeconds"] = result["guardElapsedSeconds"]-before_guard
            if after["phaseBookedCu"] < before["phaseBookedCu"]:
                fail("booked_grants_regressed")
            last_booked = after["phaseBookedCu"]
            duration.update(guardSeconds=result["guardElapsedSeconds"]-before_guard, accepted=True)
            result["calls"].append({"chainId": chain, "span": span, **summary,
                                    "guardElapsedSeconds": duration["guardSeconds"], "transportElapsedSeconds": duration["transportSeconds"]})
            result["completedRpcCalls"] += 1
        result["selectorWitness"].update(filteredResponsesContainBaseline=True, filteredNestedConsistency=True)
        result.update(status="capability_responses_qualified", capabilityQualified=True, knownBaseEventObserved=True, allSixRangesAnswered=True,
                      bookedMigrationCu=last_booked, aggregateMigrationBookedCu=prior_booked_cu+last_booked, accountingComplete=True)
    except (Refusal, _transport.Refusal) as error:
        # This module and the pinned transport raise fixed labels only. Guard
        # exceptions never pass through this path or publish their messages.
        label = str(error)
        result["failure"] = "client_response_limit" if label == "shared_response_limit" else label if label in FIXED_FAILURES else "component_guard_refused"
    except TimeoutError:
        result["failure"] = "transport_timeout"
    except Exception:
        result["failure"] = "transport_or_component_failed"
    result["elapsedSeconds"] = round(monotonic()-started, 6)
    result["guardElapsedSeconds"] = round(result["guardElapsedSeconds"], 6)
    result["transportElapsedSeconds"] = round(result["transportElapsedSeconds"], 6)
    return result


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "probeRevision": REVISION, "qualificationScope": SCOPE,
                      "componentOnly": True, "productionExecutable": False, "providerCalls": 0,
                      "financialAuthority": False, "automaticRetryAllowed": False}))
