#!/usr/bin/env python3
"""Pure same-origin productive accounting and exact owner SQL; no execution."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import types

FORMAT = 'yunipals-paid-productive-plan-v5'
REPAIR_SHA = '2f7fa24a6684e365a708363f15f90c9ca55a8355eaeba077a5fbbaaef2f888e1'
MODEL_SHA = 'c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef'
ALLOWANCE = 20_000_000
DISPATCH_QUALIFICATION = 1080
DRAIN_SECONDS = 90
SOURCE_STARTS = {56: 7579197, 8453: 22224075}


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
        'automaticRetryAllowed': False, 'productivePromotionAllowed': False,
        'probeRevision':'filtered_base_v3','qualificationScope':'filtered_historical_span_capability','denseSourceCapacityQualified':False,
        'componentOnly':False,'integrationComplete':True,'maximumSeconds':180,'rawResponsesEmitted':False}
    if any(probe.get(k) != value or type(probe.get(k)) is not type(value) for k, value in expected.items()): fail('actual_successful_qualification_required')
    if type(probe.get('bookedMigrationCu')) is not int or probe['bookedMigrationCu'] != booked or not 360 <= booked <= 2000:
        fail('qualification_booked_grants_mismatch')
    rows = probe.get('calls')
    if (not isinstance(rows, list) or [(r.get('chainId'), r.get('span')) for r in rows] != [(chain, size) for chain in [56, 8453] for size in [26,1000,10000]] or
        any(type(r.get('chainId'))is not int or type(r.get('span'))is not int or type(r.get('logCount')) is not int or r['logCount'] < 0 or
            type(r.get('knownBaseBlockLogCount'))is not int or not 0<=r['knownBaseBlockLogCount']<=r['logCount']or
            type(r.get('responseBytes'))is not int or r['responseBytes']<=0 or not is_sha(r.get('responseSha256')) for r in rows)):
        fail('complete_six_range_response_evidence_required')
    witness=probe.get('selectorWitness',{})
    if (not isinstance(witness,dict)or set(witness)!={'chainId','address','knownBlock','selectionRule','selectorSha256','baselineLogSha256','baselineResponseSha256','baselineMatchingLogCount','filteredResponsesContainBaseline','filteredNestedConsistency'}or
        type(witness.get('chainId'))is not int or witness['chainId']!=8453 or type(witness.get('knownBlock'))is not int or witness['knownBlock']!=22224858 or
        witness.get('address')!='0x98433df878e8c898cb907345c3a7756e5f72240f'or witness.get('selectionRule')!='first_inclusion_tuple_in_known_block'or
        any(not is_sha(witness.get(k))for k in ['selectorSha256','baselineLogSha256','baselineResponseSha256'])or
        type(witness.get('baselineMatchingLogCount'))is not int or witness['baselineMatchingLogCount']<1 or
        witness.get('filteredResponsesContainBaseline')is not True or witness.get('filteredNestedConsistency')is not True or
        witness['baselineResponseSha256']!=rows[3]['responseSha256']or witness['baselineMatchingLogCount']!=rows[3]['knownBaseBlockLogCount']):
        fail('exact_filtered_Base_selector_baseline_witness_required')
    for row in rows:
        base=row['chainId']==8453;filtered=base and row['span']in {1000,10000}
        if (row.get('filterKind')!=('selected_token_transfer'if filtered else'collection_transfer')or
            row.get('nestedConsistencyChecked')is not(row['span']in {1000,10000})or
            row.get('selectorSha256')!=(witness['selectorSha256']if base else None)or
            row.get('selectedBaselineLogSha256')!=(witness['baselineLogSha256']if base else None)or row.get('selectedBaselineObserved')is not base or
            (base and row['knownBaseBlockLogCount']<1)or(not base and row['knownBaseBlockLogCount']!=0)):
            fail('exact_filtered_scope_and_all_nested_baseline_checks_required')
    if not rows[0]['logCount']<=rows[1]['logCount']<=rows[2]['logCount']or rows[4]['logCount']>rows[5]['logCount']or rows[4]['knownBaseBlockLogCount']!=rows[5]['knownBaseBlockLogCount']:
        fail('qualified_nested_subset_counts_inconsistent')
    if (type(probe.get('responseBytes'))is not int or probe['responseBytes']!=sum(row['responseBytes']for row in rows)or not 0<probe['responseBytes']<=2000000 or
        type(probe.get('elapsedSeconds'))not in {int,float}or not math.isfinite(probe['elapsedSeconds'])or not 0<=probe['elapsedSeconds']<=180):
        fail('bounded_filtered_qualification_totals_required')


def successful_history(repair,probe,booked):
    m=model();prior=m.cu(repair['priorBookedCu']);successful_probe(probe,booked-prior)
    values={'repairPlanSha256':digest(repair),'originAdmissionSha256':digest(repair['origin']),
        'priorBookedCu':prior,'priorFailedQualificationBookedCu':prior,'aggregateMigrationBookedCu':booked,
        'priorIssuedPermitAuthorityCu':720,'aggregateIssuedPermitAuthorityCu':1080}
    if any(probe.get(k)!=value or type(probe.get(k))is not type(value)for k,value in values.items()):
        fail('all_prior_failed_qualification_charges_and_issued_authority_required')


def repair_model():
    path=Path(__file__).with_name('paid-qualification-second-repair-plan-v1.py');raw=path.read_bytes()
    if raw_digest(raw)!=REPAIR_SHA: fail('frozen_manual_repair_model_changed')
    m=types.ModuleType('productive_repair_model');m.__file__=str(path)
    exec(compile(raw,str(path),'exec'),m.__dict__)
    return m


def prepare(repair,probe,q_cleanup,current,promotion,at):
    m=model();r=repair_model();r.validate_plan(repair);origin=repair['origin'];booked=r.validate_receipt(repair,q_cleanup)
    prior_booked=m.cu(repair['priorBookedCu']);phase_booked=booked-prior_booked;successful_history(repair,probe,booked)
    expected={'format','originAdmissionSha256','probeResultSha256','qualificationCacheReceiptSha256','qualificationCleanupAckSha256',
        'qualificationCleanupReceiptSha256','dispatchCu','throughBlocks','repairPlanSha256','failedClosureSha256',
        'previousRepairPlanSha256','qualificationScope','denseSourceCapacityQualified'}
    if (not isinstance(promotion,dict)or set(promotion)!=expected or promotion['format']!='yunipals-paid-productive-promotion-v3' or
        promotion['originAdmissionSha256']!=digest(origin)or promotion['probeResultSha256']!=digest(probe)or
        promotion['qualificationCleanupReceiptSha256']!=digest(q_cleanup)or promotion['repairPlanSha256']!=digest(repair)or
        promotion['failedClosureSha256']!=repair['failedClosureSha256']or
        promotion['previousRepairPlanSha256']!=repair['previousRepairPlanSha256']or
        promotion['qualificationScope']!='filtered_historical_span_capability'or promotion['denseSourceCapacityQualified']is not False or
        any(not is_sha(promotion[k])for k in expected if k.endswith('Sha256'))or
        set(promotion['dispatchCu'])!={'56','8453'}or set(promotion['throughBlocks'])!={'56','8453'}):
        fail('explicit_repaired_success_aggregate_history_promotion_required')
    dispatch_expires=m.text_time(m.moment(origin['expires'])-timedelta(seconds=DRAIN_SECONDS))
    if not m.moment(repair['phaseStart'])<=m.moment(at)<m.moment(dispatch_expires):fail('original_repaired_epoch_expired_or_not_started')
    daily,reserve,allocations=m.policy(current);total,background,grants=m.grants(current,allocations)
    before={'globalDailyCu':str(1_000_000+booked),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+booked)}
    if (q_cleanup['policy']!=before or daily!=m.cu(before['globalDailyCu'])or reserve!=200000 or
        m.cu(allocations['unified_source']['dailyCu'])!=m.cu(before['unifiedSourceDailyCu'])or
        m.other_policy(allocations)!=origin['otherAllocationsSha256']or current['grants']['day']!=origin['grantDay']or
        grants['unified_source']!=m.cu(origin['baselineSourceGrantedCu'])+booked or
        total<m.cu(origin['baselineGlobalGrantedCu'])+booked or background<m.cu(origin['baselineBackgroundGrantedCu'])+booked or
        total>daily or background>daily-reserve or any(grants[k]>m.cu(allocations[k]['dailyCu'])for k in grants)or
        m.moment(current['profileExpiresAt'])!=m.moment(origin['profileExpiresAt'])):
        fail('actual_quiescent_repaired_cleanup_policy_or_counters_changed')
    rows=[];dispatch=0
    for chain,first in SOURCE_STARTS.items():
        maximum=m.cu(promotion['dispatchCu'][str(chain)]);last=m.cu(promotion['throughBlocks'][str(chain)])
        if maximum<1 or last<first or last>(1<<53)-1:fail('explicit_full_source_productive_range_required')
        dispatch+=maximum
        rows.append({'permitId':'0x'+digest({'origin':digest(origin),'promotion':digest(promotion),'chain':chain,'kind':'same_original_epoch_productive_after_second_manual_repair'}),
            'chainId':chain,'fromBlock':str(first),'throughBlock':str(last),'maximumCu':str(maximum),'expires':dispatch_expires})
    if dispatch+DISPATCH_QUALIFICATION>ALLOWANCE or dispatch+booked>ALLOWANCE:fail('both_qualification_issued_and_booked_tails_count_against20M')
    plan={'format':FORMAT,'stage':'prepared_productive_after_second_manual_repair_not_executed','origin':origin,'originAdmissionSha256':digest(origin),
        'repairPlan':repair,'repairPlanSha256':digest(repair),'repairProbe':probe,'repairProbeSha256':digest(probe),
        'repairCleanupReceipt':q_cleanup,'repairCleanupReceiptSha256':digest(q_cleanup),'failedClosureSha256':repair['failedClosureSha256'],
        'previousRepairPlanSha256':repair['previousRepairPlanSha256'],
        'qualificationScope':'filtered_historical_span_capability','denseSourceCapacityQualified':False,
        'promotion':promotion,'promotionSha256':digest(promotion),
        **{k:origin[k]for k in ['start','expires','nextUtc','profileExpiresAt','grantDay','baselineSourceGrantedCu','baselineGlobalGrantedCu','baselineBackgroundGrantedCu','originalPolicy','otherAllocationsSha256']},
        'dispatchExpires':dispatch_expires,'drainReserveSeconds':DRAIN_SECONDS,'qualificationBookedCu':str(booked),
        'failedQualificationBookedCu':'1000','failedFirstRepairBookedCu':str(prior_booked-1000),
        'priorQualificationBookedCu':str(prior_booked),'repairedQualificationBookedCu':str(phase_booked),'additionalBookedGrantCeilingCu':str(ALLOWANCE),
        'remainingNewBookedCu':str(ALLOWANCE-booked),'qualificationPermitAuthorityCu':str(DISPATCH_QUALIFICATION),'productivePermitAuthorityCu':str(dispatch),
        'issuedAggregateAuthorityCu':str(dispatch+DISPATCH_QUALIFICATION),'beforePolicy':before,
        'temporaryPolicy':{'globalDailyCu':'21000000','foregroundReserveCu':'200000','unifiedSourceDailyCu':str(m.cu(origin['baselineSourceGrantedCu'])+ALLOWANCE)},
        'permits':rows,'automaticRenewal':False,'qualificationCachesAndTailsCharged':True,'counterResetOrRefundAllowed':False,'newApprovalWindow':False}
    validate(plan);return plan


def validate(plan):
    m=model();r=repair_model();r.validate_plan(plan['repairPlan']);repair=plan['repairPlan'];origin=plan['origin']
    booked=r.validate_receipt(repair,plan['repairCleanupReceipt']);prior_booked=m.cu(repair['priorBookedCu']);successful_history(repair,plan['repairProbe'],booked)
    promotion=plan.get('promotion')
    keys={'format','originAdmissionSha256','probeResultSha256','qualificationCacheReceiptSha256','qualificationCleanupAckSha256',
        'qualificationCleanupReceiptSha256','dispatchCu','throughBlocks','repairPlanSha256','failedClosureSha256',
        'previousRepairPlanSha256','qualificationScope','denseSourceCapacityQualified'}
    if (not isinstance(promotion,dict)or set(promotion)!=keys or promotion.get('format')!='yunipals-paid-productive-promotion-v3'or
        any(not is_sha(promotion[k])for k in keys if k.endswith('Sha256'))or
        not isinstance(promotion.get('dispatchCu'),dict)or set(promotion['dispatchCu'])!={'56','8453'}or
        not isinstance(promotion.get('throughBlocks'),dict)or set(promotion['throughBlocks'])!={'56','8453'}):
        fail('exact_repaired_promotion_schema_and_receipt_hashes_required')
    if (plan.get('format')!=FORMAT or repair['origin']!=origin or plan['originAdmissionSha256']!=digest(origin)or
        plan['repairPlanSha256']!=digest(repair)or plan['repairProbeSha256']!=digest(plan['repairProbe'])or
        plan['repairCleanupReceiptSha256']!=digest(plan['repairCleanupReceipt'])or plan['failedClosureSha256']!=repair['failedClosureSha256']or
        plan.get('previousRepairPlanSha256')!=repair['previousRepairPlanSha256']or
        plan.get('qualificationScope')!='filtered_historical_span_capability'or plan.get('denseSourceCapacityQualified')is not False or
        any(plan[k]!=origin[k]for k in ['start','expires','nextUtc','profileExpiresAt','grantDay','baselineSourceGrantedCu','baselineGlobalGrantedCu','baselineBackgroundGrantedCu','originalPolicy','otherAllocationsSha256'])or
        plan['promotionSha256']!=digest(plan['promotion'])or plan['promotion'].get('format')!='yunipals-paid-productive-promotion-v3'or
        any(plan['promotion'].get(k)!=v for k,v in {'originAdmissionSha256':digest(origin),'repairPlanSha256':digest(repair),'failedClosureSha256':repair['failedClosureSha256'],
            'probeResultSha256':digest(plan['repairProbe']),'qualificationCleanupReceiptSha256':digest(plan['repairCleanupReceipt']),
            'previousRepairPlanSha256':repair['previousRepairPlanSha256'],'qualificationScope':'filtered_historical_span_capability'}.items())or
        plan['promotion'].get('denseSourceCapacityQualified')is not False or
        plan['dispatchExpires']!=m.text_time(m.moment(origin['expires'])-timedelta(seconds=DRAIN_SECONDS))or
        type(plan['drainReserveSeconds'])is not int or plan['drainReserveSeconds']!=90 or
        plan['qualificationBookedCu']!=str(booked)or plan['failedQualificationBookedCu']!='1000'or
        plan.get('failedFirstRepairBookedCu')!=str(prior_booked-1000)or plan.get('priorQualificationBookedCu')!=str(prior_booked)or
        plan['repairedQualificationBookedCu']!=str(booked-prior_booked)or
        plan['additionalBookedGrantCeilingCu']!=str(ALLOWANCE)or plan['remainingNewBookedCu']!=str(ALLOWANCE-booked)or
        plan['beforePolicy']!={'globalDailyCu':str(1_000_000+booked),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+booked)}or
        plan['temporaryPolicy']!={'globalDailyCu':'21000000','foregroundReserveCu':'200000','unifiedSourceDailyCu':str(m.cu(origin['baselineSourceGrantedCu'])+ALLOWANCE)}or
        plan['automaticRenewal']is not False or plan['qualificationCachesAndTailsCharged']is not True or
        plan['counterResetOrRefundAllowed']is not False or plan['newApprovalWindow']is not False):fail('original_epoch_repaired_history_or_accounting_changed')
    rows=[];dispatch=0
    for chain,first in SOURCE_STARTS.items():
        maximum=m.cu(plan['promotion']['dispatchCu'][str(chain)]);last=m.cu(plan['promotion']['throughBlocks'][str(chain)])
        if maximum<1 or last<first or last>(1<<53)-1:fail('full_source_productive_range_changed')
        dispatch+=maximum
        rows.append({'permitId':'0x'+digest({'origin':digest(origin),'promotion':digest(plan['promotion']),'chain':chain,'kind':'same_original_epoch_productive_after_second_manual_repair'}),
            'chainId':chain,'fromBlock':str(first),'throughBlock':str(last),'maximumCu':str(maximum),'expires':plan['dispatchExpires']})
    if (plan['permits']!=rows or dispatch+DISPATCH_QUALIFICATION>ALLOWANCE or dispatch+booked>ALLOWANCE or plan['qualificationPermitAuthorityCu']!=str(DISPATCH_QUALIFICATION)or
        plan['productivePermitAuthorityCu']!=str(dispatch)or plan['issuedAggregateAuthorityCu']!=str(dispatch+DISPATCH_QUALIFICATION)):
        fail('aggregate_failed_repaired_booked_and_issued_partition_changed')


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
        daily, reserve, allocations = m.policy(current); total, background, grants = m.grants(current, allocations)
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
        repair=plan['repairPlan']
        check_rows = ([{**r,'expectedSpentCu':r['spentCu']} for r in repair['previousRepairPlan']['failedClosure']['oldPermits']] +
            [{**r,'expectedSpentCu':r['spentCu']} for r in repair['failedClosure']['oldPermits']] +
            [{**r,'expectedSpentCu':'180'} for r in repair_model().qualification_permits(repair)])
        target = plan['temporaryPolicy']
        for row in rows:
            changes.append("INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES("+','.join([literal(row['permitId']),literal(m.PROFILE),str(row['chainId']),row['fromBlock'],row['throughBlock'],row['maximumCu'],'true',literal(row['expires'])+'::timestamptz'])+");")
    elif phase == 'cleanup':
        target = cleanup_receipt(plan,current)['policy']; check_rows = rows
    elif phase in {'utc','boundary'}:
        original_daily=m.cu(plan['originalPolicy']['globalDailyCu']);original_background=original_daily-m.cu(plan['originalPolicy']['foregroundReserveCu'])
        if total>original_daily or background>original_background:fail('original_UTC_headroom_would_be_below_existing_bookings')
        checks.append("IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'AND window_start="+literal(current['grants']['day'])+"::date),0)>"+str(original_daily)+" OR COALESCE((SELECT background_granted_cu FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'AND window_start="+literal(current['grants']['day'])+"::date),0)>"+str(original_background)+" THEN RAISE EXCEPTION 'original_UTC_headroom_below_fresh_bookings'; END IF;")
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
        checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE "+match+('' if phase=='revoke' else ' AND NOT enabled')+(' AND spent_cu='+row['expectedSpentCu'] if phase=='promotion' else '')+") THEN RAISE EXCEPTION 'productive_owned_permit_changed'; END IF;")
        if phase=='revoke': changes.append('UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE '+match+';')
    if target:
        changes += ['UPDATE yunipals_market.rpc_compute_budget SET daily_cu='+target['globalDailyCu']+" WHERE scope='yunipals-opensea';",
            'UPDATE yunipals_market.rpc_compute_allocation SET daily_cu='+target['unifiedSourceDailyCu']+" WHERE scope='yunipals-opensea' AND workload='unified_source';"]
    return '\n'.join(['-- PREPARED ONLY; actual source/timer/cache/owner guards are external.', 'BEGIN;',"SET LOCAL statement_timeout='3000ms';","SET LOCAL lock_timeout='750ms';","SET LOCAL idle_in_transaction_session_timeout='5000ms';",
        "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));",
        'LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;',
        'DO $productive_guard$ BEGIN',*checks,*changes,'END $productive_guard$;',"SELECT jsonb_build_object('productivePlanSha256',"+literal(digest(plan))+",'phase',"+literal(phase)+",'applied',true,'grantCountersReset',false);",'COMMIT;',''])
