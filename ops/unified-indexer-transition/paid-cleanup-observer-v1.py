#!/usr/bin/env python3
"""Bounded cleanup observation only; never establishes dispatch approval.

The caller retains the real source/chain leases and proves its exact owned row
with Session.check_proxy before/after this observer. No provider requests, SQL
writes, permit changes, live preflight endpoint or profile renewal occurs here.
"""
import hashlib
import json
from pathlib import Path
import re

FORMAT = 'yunipals-paid-cleanup-observer-v1'
SOURCE = '6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6'
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
PROXY_SHA = 'aba79fc98d904ccbcab48127721139ef7120fa5c65b752d86c4b507b719b20e2'
PROFILE_FILE = Path('/etc/yunipals-unified/shadow-20261020/rpc-profile.json')
PROFILE_SHA = 'a3e6f755b8f13dce51ae4f9b053fb855533e7cc49ee182f14535701e0acc6232'
PROFILE = '0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3'
MANIFEST = '0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029'
COORDINATOR = 'faf1bb8c-4306-4c43-b55e-6ac5fa038567'
CHAINS = {'ethereum': (1, 19201), 'base': (8453, 19202), 'polygon': (137, 19203), 'bnb': (56, 19204)}


def fail(message): raise RuntimeError(message)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def literal(value): return "'" + str(value).replace("'", "''") + "'"


def fixed_inputs(q, name):
    q.held()
    if (name not in CHAINS or q.v.CHAINS != CHAINS or q.n.ROOT != ROOT or q.n.PROXY_SHA != PROXY_SHA or
        q.v.PROFILE != PROFILE_FILE or q.v.PROFILE_SHA != PROFILE_SHA or q.v.PROFILE_ID != PROFILE or q.v.MANIFEST != MANIFEST or
        q.model.PROFILE != PROFILE):
        fail('fixed_source6_cleanup_identity_required')
    raw = q.c.trusted(PROFILE_FILE, 2_000_000)
    if sha(raw) != PROFILE_SHA or q.v.digest(ROOT / 'apps/yunipals-market-api/dist/rpc-budget-proxy.mjs') != PROXY_SHA:
        fail('cleanup_code_or_profile_bytes_changed')
    profile = json.loads(raw)
    if profile.get('scope') != 'yunipals-opensea' or profile.get('coordinatorId') != COORDINATOR:
        fail('fixed_cleanup_profile_scope_required')
    return profile


def metadata(q, name, expected_invocation):
    if not isinstance(expected_invocation, str) or not re.fullmatch('[0-9a-f]{32}', expected_invocation):
        fail('exact_cleanup_invocation_required')
    p = q.check_proxy.__func__.__globals__['observed'](q.v, 'yunipals-market-production-rpc@' + name + '.service')
    q.v.verify_exec_start(p, ROOT)
    if p['InvocationID'] != expected_invocation or p.get('ActiveState') != 'active' or p.get('SubState') != 'running':
        fail('exact_running_cleanup_proxy_required')
    return {'invocation': p['InvocationID'], 'definitions': q.v.definitions(p), 'privateSettings': q.v.private_settings(p),
            'environmentFileHashes': q.c.environment_hashes(q.v, p)}


def historical_profile(q, profile):
    # The exact original expiry is retained, including fractional microseconds.
    # Existence/identity is distinct from the intentionally absent live-approval
    # predicate expires_at > now(). This cannot grant paid authority.
    expiry = q.plan['admission']['profileExpiresAt']
    q.model.moment(expiry)
    sql = """SELECT jsonb_build_object(
      'identity',jsonb_build_object('session',session_user,'current',current_user,'database',current_database(),'port',current_setting('port'),'local',inet_client_addr() IS NULL),
      'historicalProfileIdentityVerified',EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p
        JOIN yunipals_market.opensea_request_budget c USING(scope)
        WHERE p.profile_id=PROFILE AND p.scope='yunipals-opensea' AND p.manifest_hash=MANIFEST
          AND p.policy=POLICY::jsonb AND p.expires_at=EXPIRY::timestamptz AND p.enabled
          AND c.coordinator_id=COORDINATOR::uuid AND c.enabled),
      'profileAvailability',CASE WHEN clock_timestamp()>=EXPIRY::timestamptz THEN 'expired' ELSE 'historical_only' END)"""
    # Replace complete distinct tokens once, never recursively interpret policy.
    values = {'PROFILE': literal(PROFILE), 'MANIFEST': literal(MANIFEST), 'POLICY': literal(encoded(profile).decode()),
              'EXPIRY': literal(expiry), 'COORDINATOR': literal(COORDINATOR)}
    sql = re.sub(r'\b(PROFILE|MANIFEST|POLICY|EXPIRY|COORDINATOR)\b', lambda m: values[m.group()], sql)
    value = q.check_proxy.__func__.__globals__['query'](sql, market=True)
    if (not isinstance(value, dict) or set(value) != {'identity', 'historicalProfileIdentityVerified', 'profileAvailability'} or
        value['identity'] != {'session': 'postgres', 'current': 'postgres', 'database': 'yunipals_market_production', 'port': '15438', 'local': True} or
        value['historicalProfileIdentityVerified'] is not True or value['profileAvailability'] not in {'historical_only', 'expired'}):
        fail('exact_historical_cleanup_profile_required')
    return value['profileAvailability']


def _observe(q, name, *, paid, zero, expected_configuration, expected_invocation):
    if type(paid) is not bool or type(zero) is not bool:
        fail('typed_cleanup_observation_required')
    profile = fixed_inputs(q, name)
    before = metadata(q, name, expected_invocation)
    availability = historical_profile(q, profile)
    chain, port = CHAINS[name]
    if q.v.request(port, '/health').get('status') != 'ready': fail('cleanup_process_health_unavailable')
    metrics = q.v.request(port, '/metrics')
    if any(k not in metrics for k in q.v.CONFIG_KEYS): fail('complete_cleanup_configuration_required')
    config = {k: metrics[k] for k in q.v.CONFIG_KEYS}
    if ((expected_configuration is not None and config != expected_configuration) or config['freeRouting'] is not True or config['paidFallbackOnFreeFailure'] is not False or
        config['sourcePaidFallbackOnFreeFailure'] is not False): fail('cleanup_legacy_configuration_changed')
    unified = metrics.get('unified')
    if (not isinstance(unified, dict) or unified.get('profileId') != PROFILE or unified.get('chainId') != chain or
        unified.get('sourceRouting') != ('paid_primary' if paid else 'free_first')):
        fail('cleanup_profile_chain_or_routing_changed')
    counters = {}
    for workload in ['unified_source', 'unified_evidence']:
        row = unified.get('traffic', {}).get(workload, {})
        counters[workload] = {k: row.get(k) for k in ['paidCalls', 'refused']}
        if any(type(x) is not int or not 0 <= x <= 9007199254740991 or ((zero or workload == 'unified_evidence') and x != 0)
               for x in counters[workload].values()): fail('cleanup_counters_or_evidence_isolation_changed')
    if zero and not paid:
        budget = metrics.get('workloadBudgets', {}).get('unified_source', {})
        if (budget.get('workload') != 'unified_source' or budget.get('priority') != 'background' or
            any(type(budget.get(k)) is not int or budget[k] != 0 for k in ['grantedCu', 'usedCu', 'remainingCu'])):
            fail('false_cleanup_source_RAM_cache_not_empty')
    if fixed_inputs(q, name) != profile or metadata(q, name, expected_invocation) != before:
        fail('cleanup_proxy_changed_during_observation')
    return {'format': FORMAT, 'configuration': config, 'counters': counters,
            'cleanupOnly': True, 'dispatchAuthorized': False, 'historicalProfileIdentityVerified': True,
            'profileAvailability': availability, 'proxyMetadataSha256': sha(encoded(before))}


def observe(q, name, *, paid, zero, expected_configuration, expected_invocation):
    """Caller must separately prove the expected owned graph before/after."""
    if not isinstance(expected_configuration, dict): fail('exact_owned_cleanup_configuration_required')
    return _observe(q, name, paid=paid, zero=zero, expected_configuration=expected_configuration, expected_invocation=expected_invocation)


def peer(q, name, expected):
    """Fixed retained unowned peer identity, not a replacement peer baseline."""
    fixed_inputs(q, name)
    if not isinstance(expected, dict) or set(expected) != {'invocation', 'definitions', 'privateSettings', 'environmentFileHashes'}:
        fail('exact_retained_cleanup_peer_required')
    if metadata(q, name, expected['invocation']) != expected: fail('unowned_cleanup_peer_changed')
    # The original Q review did not store peer configuration values. Preserve
    # its actual guarantee: exact retained code, private inputs and definitions,
    # plus the complete observed free-first configuration and zero paid/refused.
    # Never substitute another chain's configuration or invent an old value.
    value = _observe(q, name, paid=False, zero=True, expected_configuration=None, expected_invocation=expected['invocation'])
    if metadata(q, name, expected['invocation']) != expected: fail('unowned_cleanup_peer_changed')
    return value
