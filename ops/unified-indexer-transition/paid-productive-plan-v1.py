#!/usr/bin/env python3
"""Pure same-origin productive accounting and exact owner SQL; no execution."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import types

FORMAT = 'yunipals-paid-productive-plan-v1'
MODEL_SHA = 'c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef'
ALLOWANCE = 20_000_000
DISPATCH_QUALIFICATION = 360
DRAIN_SECONDS = 90
SOURCE_STARTS = {56: 7716583, 8453: 22224075}


def fail(message): raise ValueError(message)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def digest(value): return hashlib.sha256(encoded(value)).hexdigest()
def raw_digest(value): return hashlib.sha256(value).hexdigest()
def is_sha(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None
def literal(value): return "'" + str(value).replace("'", "''") + "'"


def model():
    path = Path(__file__).with_name('paid-backfill-policy-plan-v2.py'); raw = path.read_bytes()
    if raw_digest(raw) != MODEL_SHA: fail('frozen_origin_model_changed')
    m = types.ModuleType('productive_origin_model'); m.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), m.__dict__)
    return m


def successful_probe(probe, booked):
    expected = {'format': 'yunipals-paid-capability-components-v1', 'status': 'capability_responses_qualified',
        'capabilityQualified': True, 'knownBaseEventObserved': True, 'allSixRangesAnswered': True,
        'attemptedRpcCalls': 6, 'completedRpcCalls': 6, 'maximumDispatchCu': 360, 'accountingComplete': True,
        'automaticRetryAllowed': False, 'productivePromotionAllowed': False}
    if any(probe.get(k) != value or type(probe.get(k)) is not type(value) for k, value in expected.items()): fail('actual_successful_qualification_required')
    if type(probe.get('bookedMigrationCu')) is not int or probe['bookedMigrationCu'] != booked or not 0 < booked <= 2000:
        fail('qualification_booked_grants_mismatch')
    rows = probe.get('calls')
    if (not isinstance(rows, list) or [(r.get('chainId'), r.get('span')) for r in rows] != [(chain, size) for chain in [56, 8453] for size in [26,1000,10000]] or
        any(type(r.get('logCount')) is not int or r['logCount'] < 0 or not is_sha(r.get('responseSha256')) for r in rows) or
        not any(r['chainId'] == 8453 and type(r.get('knownBaseBlockLogCount')) is int and r['knownBaseBlockLogCount'] > 0 for r in rows)):
        fail('complete_six_range_response_evidence_required')


def prepare(origin, probe, q_cleanup, current, promotion, at):
    m = model(); m.validate_plan(origin)
    if (set(promotion) != {'format', 'originAdmissionSha256', 'probeResultSha256', 'qualificationCacheReceiptSha256',
        'qualificationCleanupAckSha256', 'qualificationCleanupReceiptSha256', 'dispatchCu', 'throughBlocks'} or
        promotion['format'] != 'yunipals-paid-productive-promotion-v1' or promotion['originAdmissionSha256'] != digest(origin) or
        any(not is_sha(promotion[k]) for k in ['probeResultSha256', 'qualificationCacheReceiptSha256', 'qualificationCleanupAckSha256', 'qualificationCleanupReceiptSha256']) or
        promotion['probeResultSha256'] != digest(probe) or promotion['qualificationCleanupReceiptSha256'] != digest(q_cleanup) or
        set(promotion['dispatchCu']) != {'56','8453'} or set(promotion['throughBlocks']) != {'56','8453'}):
        fail('explicit_protected_post_qualification_promotion_required')
    dispatch_expires = m.text_time(m.moment(origin['expires'])-timedelta(seconds=DRAIN_SECONDS))
    if not m.moment(origin['start']) <= m.moment(at) < m.moment(dispatch_expires): fail('original_epoch_expired_or_not_started')
    if (q_cleanup.get('admissionPlanSha256') != digest(origin) or q_cleanup.get('originalPolicy') != origin['originalPolicy'] or
        q_cleanup.get('epochStart') != origin['start'] or q_cleanup.get('epochExpires') != origin['expires'] or
        q_cleanup.get('nextUtc') != origin['nextUtc'] or q_cleanup.get('otherAllocationsSha256') != origin['otherAllocationsSha256'] or
        q_cleanup.get('ownedPermits') != m.qualification_permits(origin) or q_cleanup.get('cachedUnusedGrantsIncluded') is not True or
        q_cleanup.get('refundOrCounterResetAllowed') is not False): fail('acknowledged_same_origin_cleanup_receipt_required')
    booked = m.cu(q_cleanup['migrationBookedGrantsCu']); successful_probe(probe, booked)
    daily, reserve, allocations = m.policy(current); total, background, grants = m.grants(current, allocations)
    expected_old = {'globalDailyCu': str(1_000_000+booked), 'foregroundReserveCu': '200000', 'unifiedSourceDailyCu': str(25000+booked)}
    if (q_cleanup.get('policy') != expected_old or daily != m.cu(expected_old['globalDailyCu']) or reserve != 200000 or
        m.cu(allocations['unified_source']['dailyCu']) != m.cu(expected_old['unifiedSourceDailyCu']) or
        m.other_policy(allocations) != origin['otherAllocationsSha256'] or current['grants']['day'] != origin['grantDay'] or
        grants['unified_source'] != m.cu(origin['baselineSourceGrantedCu']) + booked or
        total < m.cu(origin['baselineGlobalGrantedCu'])+booked or background < m.cu(origin['baselineBackgroundGrantedCu'])+booked or
        total > daily or background > daily-reserve or any(grants[k] > m.cu(allocations[k]['dailyCu']) for k in grants) or
        m.moment(current['profileExpiresAt']) != m.moment(origin['profileExpiresAt'])):
        fail('actual_quiescent_post_qualification_policy_or_counters_changed')
    rows = []; dispatch = 0
    for chain, first in SOURCE_STARTS.items():
        maximum = m.cu(promotion['dispatchCu'][str(chain)]); last = m.cu(promotion['throughBlocks'][str(chain)])
        if maximum < 1 or last < first or last > (1<<53)-1: fail('explicit_productive_range_and_positive_partition_required')
        dispatch += maximum
        rows.append({'permitId': '0x'+digest({'origin':digest(origin),'promotion':digest(promotion),'chain':chain,'kind':'same_original_epoch_productive'}),
            'chainId': chain, 'fromBlock': str(first), 'throughBlock': str(last), 'maximumCu': str(maximum), 'expires': dispatch_expires})
    if dispatch + DISPATCH_QUALIFICATION > ALLOWANCE: fail('aggregate_issued_permit_authority_exceeds_original_allowance')
    plan = {'format': FORMAT, 'stage': 'prepared_productive_not_executed', 'origin': origin, 'originAdmissionSha256': digest(origin),
        'promotion': promotion, 'promotionSha256': digest(promotion), 'start': origin['start'], 'expires': origin['expires'], 'nextUtc': origin['nextUtc'],
        'dispatchExpires': dispatch_expires, 'drainReserveSeconds': DRAIN_SECONDS, 'profileExpiresAt': origin['profileExpiresAt'], 'grantDay': origin['grantDay'], 'baselineSourceGrantedCu': origin['baselineSourceGrantedCu'],
        'baselineGlobalGrantedCu': origin['baselineGlobalGrantedCu'], 'baselineBackgroundGrantedCu': origin['baselineBackgroundGrantedCu'],
        'qualificationBookedCu': str(booked), 'additionalBookedGrantCeilingCu': str(ALLOWANCE), 'remainingNewBookedCu': str(ALLOWANCE-booked),
        'qualificationPermitAuthorityCu': '360', 'productivePermitAuthorityCu': str(dispatch), 'issuedAggregateAuthorityCu': str(dispatch+360),
        'originalPolicy': origin['originalPolicy'], 'beforePolicy': expected_old,
        'temporaryPolicy': {'globalDailyCu': '21000000', 'foregroundReserveCu': '200000', 'unifiedSourceDailyCu': str(m.cu(origin['baselineSourceGrantedCu'])+ALLOWANCE)},
        'otherAllocationsSha256': origin['otherAllocationsSha256'], 'permits': rows, 'automaticRenewal': False,
        'qualificationCachesAndTailsCharged': True, 'counterResetOrRefundAllowed': False, 'newApprovalWindow': False}
    validate(plan)
    return plan


def validate(plan):
    m = model(); m.validate_plan(plan['origin']); origin = plan['origin']
    if (plan.get('format') != FORMAT or plan.get('originAdmissionSha256') != digest(origin) or
        any(plan[k] != origin[k] for k in ['start','expires','nextUtc','profileExpiresAt','grantDay','baselineSourceGrantedCu','baselineGlobalGrantedCu','baselineBackgroundGrantedCu','originalPolicy','otherAllocationsSha256']) or
        plan['promotionSha256'] != digest(plan['promotion']) or plan['promotion']['originAdmissionSha256'] != digest(origin) or
        plan.get('dispatchExpires') != m.text_time(m.moment(origin['expires'])-timedelta(seconds=DRAIN_SECONDS)) or
        type(plan.get('drainReserveSeconds')) is not int or plan['drainReserveSeconds'] != DRAIN_SECONDS or
        plan['additionalBookedGrantCeilingCu'] != str(ALLOWANCE) or not 0 < m.cu(plan['qualificationBookedCu']) <= 2000 or
        plan['remainingNewBookedCu'] != str(ALLOWANCE-m.cu(plan['qualificationBookedCu'])) or
        plan['beforePolicy'] != {'globalDailyCu':str(1_000_000+m.cu(plan['qualificationBookedCu'])),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+m.cu(plan['qualificationBookedCu']))} or
        plan['temporaryPolicy'] != {'globalDailyCu':'21000000','foregroundReserveCu':'200000','unifiedSourceDailyCu':str(m.cu(origin['baselineSourceGrantedCu'])+ALLOWANCE)} or
        plan['automaticRenewal'] is not False or plan['qualificationCachesAndTailsCharged'] is not True or
        plan['counterResetOrRefundAllowed'] is not False or plan['newApprovalWindow'] is not False): fail('original_productive_accounting_identity_changed')
    expected = []; total = 0
    for chain, first in SOURCE_STARTS.items():
        maximum, last = m.cu(plan['promotion']['dispatchCu'][str(chain)]), m.cu(plan['promotion']['throughBlocks'][str(chain)])
        if maximum < 1 or last < first or last > (1<<53)-1: fail('productive_range_changed')
        total += maximum
        expected.append({'permitId':'0x'+digest({'origin':digest(origin),'promotion':digest(plan['promotion']),'chain':chain,'kind':'same_original_epoch_productive'}),
            'chainId':chain,'fromBlock':str(first),'throughBlock':str(last),'maximumCu':str(maximum),'expires':plan['dispatchExpires']})
    if (plan['permits'] != expected or total+360>ALLOWANCE or plan['qualificationPermitAuthorityCu']!='360' or
        plan['productivePermitAuthorityCu'] != str(total) or plan['issuedAggregateAuthorityCu'] != str(total+360)):
        fail('productive_permit_partition_changed')


def cleanup_receipt(plan, current):
    validate(plan); m = model(); daily, reserve, allocations = m.policy(current); total, background, grants = m.grants(current, allocations)
    if (current['grants']['day'] != plan['grantDay'] or daily != 21_000_000 or reserve != 200000 or
        m.cu(allocations['unified_source']['dailyCu']) != m.cu(plan['temporaryPolicy']['unifiedSourceDailyCu']) or
        m.other_policy(allocations) != plan['otherAllocationsSha256']): fail('owned_productive_policy_changed')
    booked = grants['unified_source']-m.cu(plan['baselineSourceGrantedCu'])
    if (not m.cu(plan['qualificationBookedCu']) <= booked <= ALLOWANCE or total < m.cu(plan['baselineGlobalGrantedCu'])+booked or
        background < m.cu(plan['baselineBackgroundGrantedCu'])+booked or total > daily or background > daily-reserve or
        any(grants[k] > m.cu(allocations[k]['dailyCu']) for k in grants)): fail('original_aggregate_booked_allowance_exceeded')
    return {'format':FORMAT,'stage':'prepared_productive_cleanup_not_executed','productivePlanSha256':digest(plan),
        'originAdmissionSha256':plan['originAdmissionSha256'],'migrationBookedGrantsCu':str(booked),'qualificationBookedCu':plan['qualificationBookedCu'],
        'productiveAdditionalBookedCu':str(booked-m.cu(plan['qualificationBookedCu'])),'grantDay':plan['grantDay'],'nextUtc':plan['nextUtc'],
        'epochStart':plan['start'],'epochExpires':plan['expires'],'otherAllocationsSha256':plan['otherAllocationsSha256'],
        'originalPolicy':plan['originalPolicy'],'policy':{'globalDailyCu':str(1_000_000+booked),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+booked)},
        'ownedPermits':plan['permits'],'qualificationCachesAndTailsCharged':True,'counterResetOrRefundAllowed':False}


def boundary_receipt(plan, current, prior, at):
    """No cleanup ACK is invented: inspect both ledgers of the same origin."""
    validate(plan); m = model()
    if m.moment(at) < m.moment(plan['nextUtc']): fail('productive_boundary_not_reached')
    receipt = cleanup_receipt(plan, prior)
    daily, reserve, allocations = m.policy(current); total, background, grants = m.grants(current, allocations)
    expected_day = m.moment(plan['nextUtc']).date().isoformat()
    if (current['grants']['day'] != expected_day or daily != 21000000 or reserve != 200000 or
        m.cu(allocations['unified_source']['dailyCu']) != m.cu(plan['temporaryPolicy']['unifiedSourceDailyCu']) or
        m.other_policy(allocations) != plan['otherAllocationsSha256'] or grants['unified_source'] != 0 or
        total > daily or background > daily-reserve): fail('unexplained_new_day_bookings_or_boundary_policy_changed')
    return {**receipt, 'stage':'prepared_productive_boundary_not_executed', 'priorDayGrantsSha256':digest(prior['grants']),
        'newGrantDay':expected_day, 'newDaySourceGrantedCu':'0', 'cleanupCommitAcknowledged':False,
        'unappliedCurrentDayPolicy':plan['temporaryPolicy'], 'policy':plan['originalPolicy']}


def owner_sql(phase, plan, current=None, *, receipt=None):
    """Prepared SQL only. Caller proves exact owned source/cache/timer receipts."""
    validate(plan); m = model(); origin = plan['origin']; rows = plan['permits']; changes = []; checks = []
    if phase not in {'promotion','revoke','cleanup','utc','boundary'}: fail('fixed_productive_phase_required')
    if phase != 'revoke':
        daily, reserve, allocations = m.policy(current); _, _, grants = m.grants(current, allocations)
        checks += ["IF (SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled) FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea') IS DISTINCT FROM "+literal(json.dumps(current['global'],separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'productive_global_policy_drift'; END IF;",
            "IF (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea') IS DISTINCT FROM "+literal(json.dumps(sorted(allocations.values(),key=lambda r:r['workload']),separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'productive_allocation_policy_drift'; END IF;"]
    if phase == 'promotion':
        expected = plan['beforePolicy']
        if (daily != m.cu(expected['globalDailyCu']) or reserve != 200000 or m.cu(allocations['unified_source']['dailyCu']) != m.cu(expected['unifiedSourceDailyCu']) or
            m.other_policy(allocations) != plan['otherAllocationsSha256'] or current['grants']['day'] != plan['grantDay'] or
            grants['unified_source'] != m.cu(plan['baselineSourceGrantedCu'])+m.cu(plan['qualificationBookedCu'])): fail('quiescent_promotion_state_changed')
        checks += ["IF clock_timestamp()<"+literal(plan['start'])+"::timestamptz OR clock_timestamp()>="+literal(plan['dispatchExpires'])+"::timestamptz OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(plan['grantDay'])+"::date THEN RAISE EXCEPTION 'original_productive_epoch_unavailable'; END IF;",
            "IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'unexpected_active_paid_permit'; END IF;",
            "PERFORM 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id="+literal(m.PROFILE)+" FOR SHARE OF p,c;",
            "IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id="+literal(m.PROFILE)+" AND p.scope='yunipals-opensea' AND p.enabled AND c.enabled AND c.coordinator_id::text=(p.policy->>'coordinatorId') AND p.expires_at="+literal(plan['profileExpiresAt'])+"::timestamptz AND p.expires_at>="+literal(plan['expires'])+"::timestamptz) THEN RAISE EXCEPTION 'productive_profile_changed'; END IF;"]
        checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.rpc_compute_window w WHERE w.scope='yunipals-opensea' AND w.window_start="+literal(plan['grantDay'])+"::date AND w.granted_cu>="+str(m.cu(plan['baselineGlobalGrantedCu'])+m.cu(plan['qualificationBookedCu']))+" AND w.background_granted_cu>="+str(m.cu(plan['baselineBackgroundGrantedCu'])+m.cu(plan['qualificationBookedCu']))+" AND w.granted_cu<="+str(daily)+" AND w.background_granted_cu<="+str(daily-reserve)+" AND w.granted_cu=(SELECT coalesce(sum(granted_cu),0)FROM yunipals_market.rpc_compute_workload_window WHERE scope=w.scope AND window_start=w.window_start) AND w.background_granted_cu=(SELECT coalesce(sum(x.granted_cu),0)FROM yunipals_market.rpc_compute_workload_window x JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)WHERE x.scope=w.scope AND x.window_start=w.window_start AND a.priority='background')) OR EXISTS(SELECT 1 FROM yunipals_market.rpc_compute_workload_window x JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload) WHERE x.scope='yunipals-opensea' AND x.window_start="+literal(plan['grantDay'])+"::date AND x.granted_cu>a.daily_cu) THEN RAISE EXCEPTION 'productive_live_grant_conservation_changed'; END IF;")
        check_rows = m.qualification_permits(origin)
        target = plan['temporaryPolicy']
        for row in rows:
            changes.append("INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES("+','.join([literal(row['permitId']),literal(m.PROFILE),str(row['chainId']),row['fromBlock'],row['throughBlock'],row['maximumCu'],'true',literal(row['expires'])+'::timestamptz'])+");")
    elif phase == 'cleanup':
        target = cleanup_receipt(plan,current)['policy']; check_rows = rows
    elif phase in {'utc','boundary'}:
        if (not isinstance(receipt,dict) or receipt.get('productivePlanSha256') != digest(plan) or receipt.get('originAdmissionSha256') != plan['originAdmissionSha256'] or
            receipt.get('format') != FORMAT or receipt.get('stage') != ('prepared_productive_cleanup_not_executed' if phase=='utc' else 'prepared_productive_boundary_not_executed') or
            receipt.get('ownedPermits') != rows or receipt.get('nextUtc') != plan['nextUtc'] or receipt.get('originalPolicy') != plan['originalPolicy'] or
            receipt.get('epochStart') != plan['start'] or receipt.get('epochExpires') != plan['expires'] or
            receipt.get('otherAllocationsSha256') != plan['otherAllocationsSha256'] or
            not m.cu(plan['qualificationBookedCu']) <= m.cu(receipt['migrationBookedGrantsCu']) <= ALLOWANCE or
            receipt['policy'] != ({'globalDailyCu':str(1_000_000+m.cu(receipt['migrationBookedGrantsCu'])),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+m.cu(receipt['migrationBookedGrantsCu']))} if phase=='utc' else plan['originalPolicy'])): fail('matching_acknowledged_productive_cleanup_receipt_required')
        target = plan['originalPolicy']; check_rows = rows
        expected = receipt['policy'] if phase=='utc' else plan['temporaryPolicy']
        if phase=='boundary' and (receipt.get('cleanupCommitAcknowledged') is not False or receipt.get('unappliedCurrentDayPolicy') != plan['temporaryPolicy'] or
            not is_sha(receipt.get('priorDayGrantsSha256')) or receipt.get('newGrantDay') != m.moment(plan['nextUtc']).date().isoformat() or
            receipt.get('newDaySourceGrantedCu') != '0'): fail('explicit_ackless_boundary_receipt_required')
        if current['grants']['day'] != m.moment(plan['nextUtc']).date().isoformat() or grants['unified_source'] != 0:
            fail('unexplained_new_day_bookings_refuse_automatic_restore')
        if daily != m.cu(expected['globalDailyCu']) or reserve != 200000 or m.cu(allocations['unified_source']['dailyCu']) != m.cu(expected['unifiedSourceDailyCu']) or m.other_policy(allocations) != plan['otherAllocationsSha256']:
            fail('owned_next_utc_policy_changed')
        checks.append("IF clock_timestamp()<"+literal(plan['nextUtc'])+"::timestamptz OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(current['grants']['day'])+"::date THEN RAISE EXCEPTION 'productive_utc_too_early'; END IF;")
        checks.append("IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(plan['grantDay'])+"::date),0)<>"+str(m.cu(plan['baselineSourceGrantedCu'])+m.cu(receipt['migrationBookedGrantsCu']))+" OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(current['grants']['day'])+"::date),0)<>0 THEN RAISE EXCEPTION 'productive_boundary_ledger_changed'; END IF;")
        checks.append("IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'unexpected_active_paid_permit'; END IF;")
    else: target = None; check_rows = []
    if phase in {'promotion','cleanup'}:
        checks.append("IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'unexpected_active_paid_permit'; END IF;")
        source_value = str(m.cu(plan['baselineSourceGrantedCu'])+m.cu(plan['qualificationBookedCu'])) if phase=='promotion' else str(grants['unified_source'])
        checks.append("IF (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(plan['grantDay'])+"::date OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(plan['grantDay'])+"::date),0)<>"+source_value+" THEN RAISE EXCEPTION 'productive_quiescent_grants_changed'; END IF;")
    for row in rows if phase=='revoke' else check_rows:
        match = ' AND '.join(["permit_id="+literal(row['permitId']),"profile_id="+literal(m.PROFILE),'chain_id='+str(row['chainId']), 'from_block='+row['fromBlock'],'through_block='+row['throughBlock'],'maximum_cu='+row['maximumCu'],'expires_at='+literal(row['expires'])+'::timestamptz'])
        checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE "+match+('' if phase=='revoke' else ' AND NOT enabled')+(' AND spent_cu=maximum_cu' if phase=='promotion' else '')+") THEN RAISE EXCEPTION 'productive_owned_permit_changed'; END IF;")
        if phase=='revoke': changes.append('UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE '+match+';')
    if target:
        changes += ['UPDATE yunipals_market.rpc_compute_budget SET daily_cu='+target['globalDailyCu']+" WHERE scope='yunipals-opensea';",
            'UPDATE yunipals_market.rpc_compute_allocation SET daily_cu='+target['unifiedSourceDailyCu']+" WHERE scope='yunipals-opensea' AND workload='unified_source';"]
    return '\n'.join(['-- PREPARED ONLY; actual source/timer/cache/owner guards are external.', 'BEGIN;',"SET LOCAL statement_timeout='3000ms';","SET LOCAL lock_timeout='750ms';","SET LOCAL idle_in_transaction_session_timeout='5000ms';",
        "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));",
        'LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;',
        'DO $productive_guard$ BEGIN',*checks,*changes,'END $productive_guard$;',"SELECT jsonb_build_object('productivePlanSha256',"+literal(digest(plan))+",'phase',"+literal(phase)+",'applied',true,'grantCountersReset',false);",'COMMIT;',''])
