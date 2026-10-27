#!/usr/bin/env python3
"""Prepare one same-day resume of exact ACKed, disabled continuation permits.

No execution or new allowance: the live owner must reopen the actual cleanup
ACK, stopped controller/source, released leases, false proxies and empty caches.
The original financial plan, source baseline, booked tails and UTC duty survive.
"""
import hashlib
from pathlib import Path
import types

FORMAT = 'yunipals-paid-continuation-same-day-v1'
FINANCIAL_SHA = '93dd95ae05def701fbc6f785a8a599f5935254c141c9122e782551054db3402e'


def financial():
    path = Path(__file__).with_name('paid-continuation-financial-v1.py')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != FINANCIAL_SHA:
        raise ValueError('frozen_continuation_financial_changed')
    module = types.ModuleType('same_day_continuation_financial')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def review(plan, current, closedReceipt, *, at=None):
    m = financial()
    m.validate(plan)
    m.validate_cleanup(plan, closedReceipt)
    _, reserve, allocations, total, background, grants = m.policy(current)
    receipt = closedReceipt
    cutoff = min(m.moment(row['expires']) for row in plan['permits'])
    if (receipt['boundaryContext'] is not None or receipt['grantDay'] != plan['grantDay'] or
            current['grants']['day'] != plan['grantDay'] or m.policy_value(current) != receipt['policy'] or
            grants['unified_source'] != m.cu(receipt['sourceGrantedCu']) or
            reserve != 200000 or m.other(allocations) != plan['otherAllocationsSha256'] or
            m.cu(receipt['remainingNewBookedCu']) < 1 or
            total < m.cu(plan['baselineGlobalGrantedCu']) + m.cu(receipt['segmentBookedCu']) or
            background < m.cu(plan['baselineBackgroundGrantedCu']) + m.cu(receipt['segmentBookedCu'])):
        m.fail('exact_closed_same_day_policy_and_booked_baseline_required')
    if at is not None and not m.moment(plan['start']) <= m.moment(at) < cutoff:
        m.fail('same_day_resume_dispatch_window_unavailable')
    return {'format': FORMAT, 'planSha256': m.digest(plan), 'cleanupReceiptSha256': m.digest(receipt),
            'grantDay': plan['grantDay'], 'sourceGrantedCu': receipt['sourceGrantedCu'],
            'cumulativeMigrationBookedCu': receipt['cumulativeMigrationBookedCu'],
            'remainingNewBookedCu': receipt['remainingNewBookedCu'], 'permitStateSha256': receipt['permitStateSha256'],
            'start': plan['start'], 'expires': plan['expires'], 'day1DispatchExpires': m.text_time(cutoff),
            'beforePolicy': receipt['policy'], 'targetPolicy': plan['temporaryPolicy'],
            'grantCountersReset': False, 'newPermitsInserted': False, 'clockRenewed': False}


def owner_sql(plan, current, closedReceipt, *, at=None):
    checked = review(plan, current, closedReceipt, at=at)
    m = financial()
    q = m.literal
    scope = m.SCOPE
    day = plan['grantDay']
    receipt = closedReceipt
    target = plan['temporaryPolicy']
    allocations = sorted(current['allocations'], key=lambda row: row['workload'])
    doc = m.profile()
    checks = [
        'IF clock_timestamp()<' + q(plan['start']) + '::timestamptz OR clock_timestamp()>=' + q(checked['day1DispatchExpires']) +
        "::timestamptz THEN RAISE EXCEPTION 'same_day_resume_dispatch_window_unavailable';END IF;",
        "IF (clock_timestamp()AT TIME ZONE 'UTC')::date<>" + q(day) +
        "::date THEN RAISE EXCEPTION 'same_day_resume_grant_day_changed';END IF;",
        "IF (SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled)FROM yunipals_market.rpc_compute_budget WHERE scope=" + scope +
        ')IS DISTINCT FROM ' + q(m.encoded(current['global']).decode()) +
        "::jsonb THEN RAISE EXCEPTION 'same_day_closed_global_policy_changed';END IF;",
        "IF (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text)ORDER BY workload)FROM yunipals_market.rpc_compute_allocation WHERE scope=" + scope +
        ')IS DISTINCT FROM ' + q(m.encoded(allocations).decode()) +
        "::jsonb THEN RAISE EXCEPTION 'same_day_closed_allocations_changed';END IF;",
        'IF ' + m.source_value(day) + '<>' + receipt['sourceGrantedCu'] +
        " THEN RAISE EXCEPTION 'same_day_sealed_source_ledger_changed';END IF;",
        m.conservation_sql(day, m.cu(receipt['policy']['unifiedSourceDailyCu']), m.cu(receipt['policy']['globalDailyCu'])),
        'PERFORM 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id=' + q(m.PROFILE) + ' FOR SHARE OF p,c;',
        'IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id=' + q(m.PROFILE) +
        ' AND p.scope=' + scope + ' AND p.enabled AND c.enabled AND c.coordinator_id=' + q(m.COORDINATOR) +
        '::uuid AND p.manifest_hash=' + q('0x' + m.digest(doc['manifest'])) + ' AND p.policy=' + q(m.encoded(doc).decode()) +
        '::jsonb AND p.expires_at=' + q(m.PROFILE_EXPIRES) + '::timestamptz AND p.expires_at>=' + q(plan['expires']) +
        "::timestamptz)THEN RAISE EXCEPTION 'exact_continuation_profile_unavailable';END IF;",
        'IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id)WHERE p.scope=' + scope +
        " AND r.enabled AND r.expires_at>clock_timestamp())THEN RAISE EXCEPTION 'unexpected_active_paid_permit';END IF;"
    ]
    for column, minimum in [('granted_cu', current['grants']['global']), ('background_granted_cu', current['grants']['background'])]:
        checks.append('IF COALESCE((SELECT ' + column + ' FROM yunipals_market.rpc_compute_window WHERE scope=' + scope +
                      ' AND window_start=' + q(day) + '::date),0)<' + minimum +
                      " THEN RAISE EXCEPTION 'same_day_existing_grants_decreased';END IF;")
    changes = []
    for expected, sealed in zip(plan['permits'], receipt['permitState']['owned']):
        match = ' AND '.join([
            'permit_id=' + q(expected['permitId']), 'profile_id=' + q(m.PROFILE), 'chain_id=' + str(expected['chainId']),
            'from_block=' + expected['fromBlock'], 'through_block=' + expected['throughBlock'], 'maximum_cu=' + expected['maximumCu'],
            'expires_at=' + q(expected['expires']) + '::timestamptz', 'spent_cu=' + sealed['spentCu'], 'NOT enabled'])
        checks.append('IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE ' + match +
                      ")THEN RAISE EXCEPTION 'same_day_exact_disabled_permit_changed';END IF;")
        changes.append('UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=true WHERE ' + match + ';')
    changes += [
        'UPDATE yunipals_market.rpc_compute_budget SET daily_cu=' + target['globalDailyCu'] + ' WHERE scope=' + scope + ';',
        'UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=' + target['unifiedSourceDailyCu'] + ' WHERE scope=' + scope + " AND workload='unified_source';"]
    return '\n'.join([
        '-- PREPARED ONLY: exact protected cleanup ACK and source/proxy/timer gates required.', 'BEGIN;',
        "SET LOCAL search_path=pg_catalog;SET LOCAL standard_conforming_strings=on;SET LOCAL statement_timeout='3000ms';SET LOCAL lock_timeout='750ms';SET LOCAL idle_in_transaction_session_timeout='5000ms';",
        "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));",
        'LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;',
        'DO $same_day_guard$ BEGIN', *checks, *changes, 'END $same_day_guard$;',
        "SELECT jsonb_build_object('planSha256'," + q(checked['planSha256']) + ",'phase','resume_same_day','applied',true,'grantCountersReset',false);",
        'COMMIT;', ''])
