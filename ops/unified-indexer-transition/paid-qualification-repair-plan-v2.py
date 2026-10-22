#!/usr/bin/env python3
"""Pure one-manual-repair accounting for the unchanged original paid epoch.

No command, database, service, credential or provider execution occurs here.
The live driver separately verifies each protected receipt and held lease.
"""
from datetime import timedelta
import hashlib
import json
from pathlib import Path
import re
import types

FORMAT = 'yunipals-paid-qualification-repair-plan-v2'
ORIGIN_SHA = 'c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef'
TRANSPORT_SHA = 'f288221ecb9e5f5b18723b54ddb8f7362b5079e1596c1996622454bff2c820d4'
PROFILE = '0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3'
ALLOWANCE = 20_000_000
PRIOR_BOOKED = 1000
NEW_BOOKED_CEILING = 2000
AGGREGATE_BOOKED_CEILING = 3000
QUALIFICATION_AUTHORITY = 720
QUIET = {'ownedPermitsRevoked':True, 'ownedSourceStopped':True, 'ownedPaidProxyCachesDestroyed':True, 'ownedSourceWritersUnchanged':True}


def fail(message): raise ValueError(message)
def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def digest(value): return hashlib.sha256(encoded(value)).hexdigest()
def raw_digest(value): return hashlib.sha256(value).hexdigest()
def is_sha(value): return isinstance(value,str) and re.fullmatch('[0-9a-f]{64}',value) is not None
def literal(value): return "'"+str(value).replace("'","''")+"'"


def model():
    path=Path(__file__).with_name('paid-backfill-policy-plan-v2.py');raw=path.read_bytes()
    if raw_digest(raw)!=ORIGIN_SHA: fail('frozen_original_accounting_model_changed')
    m=types.ModuleType('qualification_repair_original_model');m.__file__=str(path)
    exec(compile(raw,str(path),'exec'),m.__dict__)
    return m


def origin_model(): return model()
def moment(value): return model().moment(value)
def text_time(value): return model().text_time(value)
def cu(value): return model().cu(value)
def policy(value): return model().policy(value)
def grants(value,allocations): return model().grants(value,allocations)
def other_policy(value): return model().other_policy(value)


def validate_failed_closure(origin, closure):
    m=model();m.validate_plan(origin)
    keys={'format','originAdmissionSha256','runId','controllerResultSha256','probeResultSha256','controllerFinishedAckSha256',
        'probeCompleteAckSha256','livePlanSha256','cleanupReceipt','cleanupAckSha256','cacheCleanupReceiptSha256',
        'epochRecordFile','epochRecordSha256','qualified','cleaned','attemptedRpcCalls','completedRpcCalls','failure','oldPermits'}
    if (not isinstance(closure,dict) or set(closure)!=keys or closure['format']!='yunipals-failed-qualification-closure-v1' or
        closure['originAdmissionSha256']!=digest(origin) or closure['runId']!='20261021-q1' or
        closure['qualified'] is not False or closure['cleaned'] is not True or type(closure['attemptedRpcCalls']) is not int or closure['attemptedRpcCalls']!=1 or
        type(closure['completedRpcCalls']) is not int or closure['completedRpcCalls']!=0 or closure['failure']!='transport_or_live_guard_failed' or
        any(not is_sha(closure[k]) for k in keys if k.endswith('Sha256'))): fail('actual_failed_cleaned_original_qualification_required')
    path=closure['epochRecordFile']
    if (not isinstance(path,str) or not re.fullmatch('/var/backups/yunipals-source6-paid-epoch-v1-20261021/20261021-q1/[0-9a-f]{64}/cleaned-record[.]json',path)):
        fail('exact_original_cleaned_epoch_record_required')
    receipt=closure['cleanupReceipt']
    expected={'format':m.FORMAT,'stage':'prepared_current_day_cleanup_not_executed','admissionPlanSha256':digest(origin),
        'migrationBookedGrantsCu':'1000','grantDay':origin['grantDay'],'nextUtc':origin['nextUtc'],
        'otherAllocationsSha256':origin['otherAllocationsSha256'],'originalPolicy':origin['originalPolicy'],
        'epochStart':origin['start'],'epochExpires':origin['expires'],'ownedPermits':m.qualification_permits(origin),
        'policy':{'globalDailyCu':'1001000','foregroundReserveCu':'200000','unifiedSourceDailyCu':'26000'},
        'approvedAggregateAdditionalBookedCu':'20000000','aggregateUnbookedCuRemaining':'19999000',
        'cachedUnusedGrantsIncluded':True,'refundOrCounterResetAllowed':False,'executionAuthorizedByThisCalculator':False}
    if not isinstance(receipt,dict) or any(receipt.get(k)!=v or type(receipt.get(k))is not type(v) for k,v in expected.items()) or not is_sha(receipt.get('currentSnapshotSha256')):
        fail('original_1000_booked_cleanup_receipt_required')
    expected_rows=[{**row,'enabled':False,'spentCu':spent} for row,spent in zip(m.qualification_permits(origin),['60','0'])]
    if encoded(closure['oldPermits'])!=encoded(expected_rows): fail('original_disabled_permit_spend_must_remain_exact')
    return receipt


def current_state(plan, current, *, temporary):
    m=model();daily,reserve,allocations=m.policy(current);total,background,work=m.grants(current,allocations)
    expected=plan['temporaryPolicy'] if temporary else plan['beforePolicy']
    if (daily!=m.cu(expected['globalDailyCu']) or reserve!=200000 or m.cu(allocations['unified_source']['dailyCu'])!=m.cu(expected['unifiedSourceDailyCu']) or
        m.other_policy(allocations)!=plan['otherAllocationsSha256'] or current['grants']['day']!=plan['grantDay'] or
        m.moment(current['profileExpiresAt'])!=m.moment(plan['profileExpiresAt']) or total>daily or background>daily-reserve or
        any(work[k]>m.cu(allocations[k]['dailyCu']) for k in work)):
        fail('same_origin_repair_policy_day_profile_or_conservation_changed')
    booked=work['unified_source']-m.cu(plan['baselineSourceGrantedCu'])
    if (not PRIOR_BOOKED<=booked<=AGGREGATE_BOOKED_CEILING or not temporary and booked!=PRIOR_BOOKED or
        total<m.cu(plan['baselineGlobalGrantedCu'])+booked or background<m.cu(plan['baselineBackgroundGrantedCu'])+booked):
        fail('failed_qualification_tails_or_repair_booked_ceiling_changed')
    return daily,allocations,total,background,work,booked


def prepare(origin,failed_closure,current,repair_receipt,at):
    m=model();validate_failed_closure(origin,failed_closure)
    expected={'format':'yunipals-manual-qualification-repair-v1','originAdmissionSha256':digest(origin),
        'failedClosureSha256':digest(failed_closure),'transportHelperSha256':TRANSPORT_SHA,'repairOrdinal':1,
        'automaticRetry':False,'newApprovalWindow':False}
    if not isinstance(repair_receipt,dict) or encoded(repair_receipt)!=encoded(expected): fail('explicit_manual_transport_repair_receipt_required')
    start=m.moment(at);original_end=m.moment(origin['expires']);phase_end=min(start+timedelta(seconds=600),original_end-timedelta(seconds=90))
    if (start<m.moment(origin['qualificationExpiresAt']) or (phase_end-start).total_seconds()<180 or
        (m.moment(origin['nextUtc'])-original_end).total_seconds()<600): fail('repair_phase_window_or_original_day_boundary_unavailable')
    result={'format':FORMAT,'stage':'prepared_manual_repair_not_executed','origin':origin,'originAdmissionSha256':digest(origin),
        'failedClosure':failed_closure,'failedClosureSha256':digest(failed_closure),'manualRepair':repair_receipt,'manualRepairSha256':digest(repair_receipt),
        **{k:origin[k] for k in ['start','expires','nextUtc','profileExpiresAt','grantDay','baselineSourceGrantedCu','baselineGlobalGrantedCu','baselineBackgroundGrantedCu','originalPolicy','otherAllocationsSha256']},
        'phaseStart':at,'qualificationExpiresAt':m.text_time(phase_end),'priorBookedCu':'1000','phaseBaselineSourceGrantedCu':str(m.cu(origin['baselineSourceGrantedCu'])+1000),
        'phaseNewBookedCeilingCu':'2000','aggregateQualificationBookedCeilingCu':'3000','approvedAggregateAdditionalBookedCu':'20000000',
        'priorPermitAuthorityCu':'360','phasePermitAuthorityCu':'360','aggregateIssuedPermitAuthorityCu':'720',
        'beforePolicy':{'globalDailyCu':'1001000','foregroundReserveCu':'200000','unifiedSourceDailyCu':'26000'},
        'temporaryPolicy':{'globalDailyCu':'1003000','foregroundReserveCu':'200000','unifiedSourceDailyCu':str(m.cu(origin['baselineSourceGrantedCu'])+3000)},
        'automaticRetry':False,'newApprovalWindow':False,'counterResetOrRefundAllowed':False,'priorFailedQualificationCharged':True}
    validate_plan(result);current_state(result,current,temporary=False)
    return result


def validate_plan(plan):
    m=model()
    if not isinstance(plan,dict) or plan.get('format')!=FORMAT: fail('fixed_manual_repair_model_required')
    origin=plan['origin'];validate_failed_closure(origin,plan['failedClosure'])
    if (plan['originAdmissionSha256']!=digest(origin) or plan['failedClosureSha256']!=digest(plan['failedClosure']) or plan['manualRepairSha256']!=digest(plan['manualRepair']) or
        encoded(plan['manualRepair'])!=encoded({'format':'yunipals-manual-qualification-repair-v1','originAdmissionSha256':digest(origin),'failedClosureSha256':digest(plan['failedClosure']),
            'transportHelperSha256':TRANSPORT_SHA,'repairOrdinal':1,'automaticRetry':False,'newApprovalWindow':False}) or
        any(plan[k]!=origin[k] for k in ['start','expires','nextUtc','profileExpiresAt','grantDay','baselineSourceGrantedCu','baselineGlobalGrantedCu','baselineBackgroundGrantedCu','originalPolicy','otherAllocationsSha256'])):
        fail('original_epoch_or_manual_repair_identity_changed')
    start=m.moment(plan['phaseStart']);end=min(start+timedelta(seconds=600),m.moment(origin['expires'])-timedelta(seconds=90))
    constants={'priorBookedCu':'1000','phaseBaselineSourceGrantedCu':str(m.cu(origin['baselineSourceGrantedCu'])+1000),
        'phaseNewBookedCeilingCu':'2000','aggregateQualificationBookedCeilingCu':'3000','approvedAggregateAdditionalBookedCu':'20000000',
        'priorPermitAuthorityCu':'360','phasePermitAuthorityCu':'360','aggregateIssuedPermitAuthorityCu':'720',
        'beforePolicy':{'globalDailyCu':'1001000','foregroundReserveCu':'200000','unifiedSourceDailyCu':'26000'},
        'temporaryPolicy':{'globalDailyCu':'1003000','foregroundReserveCu':'200000','unifiedSourceDailyCu':str(m.cu(origin['baselineSourceGrantedCu'])+3000)},
        'automaticRetry':False,'newApprovalWindow':False,'counterResetOrRefundAllowed':False,'priorFailedQualificationCharged':True}
    if (any(plan.get(k)!=v or type(plan.get(k))is not type(v) for k,v in constants.items()) or
        plan['qualificationExpiresAt']!=m.text_time(end) or start<m.moment(origin['qualificationExpiresAt']) or (end-start).total_seconds()<180 or
        (m.moment(origin['nextUtc'])-m.moment(origin['expires'])).total_seconds()<600): fail('repair_phase_caps_or_deadline_changed')


def qualification_permits(plan):
    validate_plan(plan)
    return [{'permitId':'0x'+digest({'repair':digest(plan),'origin':plan['originAdmissionSha256'],'chainId':chain,'kind':'single_manual_transport_repair'}),
        'chainId':chain,'fromBlock':str(first),'throughBlock':str(first+9999),'maximumCu':'180','expires':plan['qualificationExpiresAt']}
        for chain,first in [(56,7716583),(8453,22224858)]]


def cleanup(plan,current,state):
    validate_plan(plan)
    if state!=QUIET: fail('actual_repair_revocation_source_and_cache_quiescence_required')
    _,_,_,_,_,booked=current_state(plan,current,temporary=True)
    return {'format':FORMAT,'stage':'prepared_same_origin_repair_cleanup_not_executed','repairPlanSha256':digest(plan),
        'originAdmissionSha256':plan['originAdmissionSha256'],'failedClosureSha256':plan['failedClosureSha256'],
        'migrationBookedGrantsCu':str(booked),'priorFailedQualificationBookedCu':'1000','repairPhaseBookedCu':str(booked-1000),
        'grantDay':plan['grantDay'],'nextUtc':plan['nextUtc'],'epochStart':plan['start'],'epochExpires':plan['expires'],
        'originalPolicy':plan['originalPolicy'],'otherAllocationsSha256':plan['otherAllocationsSha256'],
        'policy':{'globalDailyCu':str(1_000_000+booked),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+booked)},
        'ownedPermits':qualification_permits(plan),'priorOwnedPermits':plan['failedClosure']['oldPermits'],
        'aggregateIssuedPermitAuthorityCu':'720','aggregateUnbookedCuRemaining':str(ALLOWANCE-booked),
        'cachedUnusedGrantsIncluded':True,'refundOrCounterResetAllowed':False,'currentSnapshotSha256':digest(current)}


def validate_receipt(plan,receipt):
    validate_plan(plan)
    if not isinstance(receipt,dict): fail('acknowledged_repair_cleanup_receipt_required')
    booked=cu(receipt['migrationBookedGrantsCu'])
    expected={'format':FORMAT,'stage':'prepared_same_origin_repair_cleanup_not_executed','repairPlanSha256':digest(plan),
        'originAdmissionSha256':plan['originAdmissionSha256'],'failedClosureSha256':plan['failedClosureSha256'],
        'priorFailedQualificationBookedCu':'1000','repairPhaseBookedCu':str(booked-1000),'grantDay':plan['grantDay'],'nextUtc':plan['nextUtc'],
        'epochStart':plan['start'],'epochExpires':plan['expires'],'originalPolicy':plan['originalPolicy'],'otherAllocationsSha256':plan['otherAllocationsSha256'],
        'policy':{'globalDailyCu':str(1_000_000+booked),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+booked)},
        'ownedPermits':qualification_permits(plan),'priorOwnedPermits':plan['failedClosure']['oldPermits'],
        'aggregateIssuedPermitAuthorityCu':'720','aggregateUnbookedCuRemaining':str(ALLOWANCE-booked),'cachedUnusedGrantsIncluded':True,'refundOrCounterResetAllowed':False}
    if not 1000<=booked<=3000 or any(receipt.get(k)!=v or type(receipt.get(k))is not type(v)for k,v in expected.items()) or not is_sha(receipt.get('currentSnapshotSha256')):
        fail('same_original_epoch_aggregate_cleanup_changed')
    return booked


def boundary_receipt(plan,current,prior,at,state):
    if moment(at)<moment(plan['nextUtc']): fail('repair_UTC_not_reached')
    value=cleanup(plan,prior,state)
    d,r,a=policy(current);total,background,w=grants(current,a)
    if (d!=1003000 or r!=200000 or cu(a['unified_source']['dailyCu'])!=cu(plan['temporaryPolicy']['unifiedSourceDailyCu']) or
        other_policy(a)!=plan['otherAllocationsSha256'] or current['grants']['day']!=moment(plan['nextUtc']).date().isoformat() or
        w['unified_source']!=0 or total>d or background>d-r): fail('repair_boundary_policy_or_new_day_bookings_changed')
    return {**value,'stage':'prepared_repair_boundary_not_executed','cleanupCommitAcknowledged':False,
        'priorDayGrantsSha256':digest(prior['grants']),'newDaySourceGrantedCu':'0','unappliedPolicy':plan['temporaryPolicy']}


def owner_sql(phase,plan,current=None,*,receipt=None,at=None):
    """Inert owner SQL; live gates/receipts/ACKs/leases remain driver obligations."""
    validate_plan(plan);m=model();checks=[];changes=[];target=None
    if phase not in {'admission','revoke','cleanup','utc','boundary','inherited_utc'}: fail('fixed_repair_SQL_phase_required')
    rows=qualification_permits(plan)
    if phase!='revoke':
        daily,reserve,allocations=m.policy(current);total,background,work=m.grants(current,allocations)
        checks += ["IF (SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled) FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea') IS DISTINCT FROM "+literal(json.dumps(current['global'],separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'repair_global_policy_drift'; END IF;",
            "IF (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea') IS DISTINCT FROM "+literal(json.dumps(sorted(allocations.values(),key=lambda r:r['workload']),separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'repair_allocation_policy_drift'; END IF;"]
    if phase=='admission':
        current_state(plan,current,temporary=False);target=plan['temporaryPolicy']
        checks += ["IF clock_timestamp()<"+literal(plan['phaseStart'])+"::timestamptz OR clock_timestamp()>="+literal(plan['qualificationExpiresAt'])+"::timestamptz-interval '90 seconds' OR clock_timestamp()>="+literal(plan['expires'])+"::timestamptz OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(plan['grantDay'])+"::date THEN RAISE EXCEPTION 'original_repair_epoch_window_unavailable'; END IF;",
            "PERFORM 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id="+literal(PROFILE)+" FOR SHARE OF p,c;",
            "IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id="+literal(PROFILE)+" AND p.scope='yunipals-opensea' AND p.enabled AND c.enabled AND c.coordinator_id::text=(p.policy->>'coordinatorId') AND p.expires_at="+literal(plan['profileExpiresAt'])+"::timestamptz AND p.expires_at>="+literal(plan['expires'])+"::timestamptz) THEN RAISE EXCEPTION 'repair_profile_changed'; END IF;"]
        # Current foreground/other workload grants may advance after review;
        # conservation, cap bounds and the quiescent source ledger are fresh.
        checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.rpc_compute_window w WHERE w.scope='yunipals-opensea' AND w.window_start="+literal(plan['grantDay'])+"::date AND w.granted_cu>="+str(cu(plan['baselineGlobalGrantedCu'])+1000)+" AND w.background_granted_cu>="+str(cu(plan['baselineBackgroundGrantedCu'])+1000)+" AND w.granted_cu<="+str(daily)+" AND w.background_granted_cu<="+str(daily-reserve)+" AND w.granted_cu=(SELECT coalesce(sum(granted_cu),0)FROM yunipals_market.rpc_compute_workload_window WHERE scope=w.scope AND window_start=w.window_start) AND w.background_granted_cu=(SELECT coalesce(sum(x.granted_cu),0)FROM yunipals_market.rpc_compute_workload_window x JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)WHERE x.scope=w.scope AND x.window_start=w.window_start AND a.priority='background')) OR EXISTS(SELECT 1 FROM yunipals_market.rpc_compute_workload_window x JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)WHERE x.scope='yunipals-opensea' AND x.window_start="+literal(plan['grantDay'])+"::date AND x.granted_cu>a.daily_cu) THEN RAISE EXCEPTION 'repair_live_grant_conservation_changed'; END IF;")
        for row in rows:
            changes.append("INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES("+','.join([literal(row['permitId']),literal(PROFILE),str(row['chainId']),row['fromBlock'],row['throughBlock'],row['maximumCu'],'true',literal(row['expires'])+'::timestamptz'])+");")
    elif phase=='cleanup':
        target=cleanup(plan,current,QUIET)['policy']
    elif phase=='inherited_utc':
        # The live driver must prove no admission intent/ambiguity and actual
        # stopped source/destroyed caches before this inherited financial duty.
        # Absence of the exact repair rows is independently checked under locks.
        if (encoded(receipt)!=encoded(plan['failedClosure']['cleanupReceipt'])or at is None or moment(at)<moment(plan['nextUtc'])or
            current['grants']['day']!=moment(plan['nextUtc']).date().isoformat()or work['unified_source']!=0 or
            daily!=1001000 or reserve!=200000 or cu(allocations['unified_source']['dailyCu'])!=26000 or
            other_policy(allocations)!=plan['otherAllocationsSha256']or moment(current['profileExpiresAt'])!=moment(plan['profileExpiresAt'])or
            total>daily or background>daily-reserve or any(work[k]>cu(allocations[k]['dailyCu'])for k in work)):
            fail('exact_unattempted_repair_original_Q1_UTC_duty_required')
        target=plan['originalPolicy']
        ids=','.join(literal(row['permitId'])for row in rows)
        checks += ["PERFORM 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id="+literal(PROFILE)+" FOR SHARE OF p,c;",
            "IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id="+literal(PROFILE)+" AND p.scope='yunipals-opensea' AND p.enabled AND c.enabled AND c.coordinator_id::text=(p.policy->>'coordinatorId') AND p.expires_at="+literal(plan['profileExpiresAt'])+"::timestamptz) THEN RAISE EXCEPTION 'inherited_Q1_profile_changed'; END IF;"]
        checks += ["IF clock_timestamp()<"+literal(plan['nextUtc'])+"::timestamptz OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(current['grants']['day'])+"::date THEN RAISE EXCEPTION 'inherited_Q1_UTC_unavailable'; END IF;",
            "IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN("+ids+")) THEN RAISE EXCEPTION 'inherited_Q1_repair_admission_not_absent'; END IF;",
            "IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(plan['grantDay'])+"::date),0)<>"+str(cu(plan['baselineSourceGrantedCu'])+1000)+" OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(current['grants']['day'])+"::date),0)<>0 THEN RAISE EXCEPTION 'inherited_Q1_source_ledgers_changed'; END IF;"]
    elif phase in {'utc','boundary'}:
        if phase=='utc':booked=validate_receipt(plan,receipt);expected=receipt['policy']
        else:
            copy={**receipt,'stage':'prepared_same_origin_repair_cleanup_not_executed'};booked=validate_receipt(plan,copy);expected=plan['temporaryPolicy']
            if receipt.get('cleanupCommitAcknowledged')is not False or receipt.get('unappliedPolicy')!=expected or not is_sha(receipt.get('priorDayGrantsSha256')) or receipt.get('newDaySourceGrantedCu')!='0': fail('explicit_ACKless_repair_boundary_required')
        if (current['grants']['day']!=moment(plan['nextUtc']).date().isoformat() or work['unified_source']!=0 or
            daily!=cu(expected['globalDailyCu']) or reserve!=200000 or cu(allocations['unified_source']['dailyCu'])!=cu(expected['unifiedSourceDailyCu']) or other_policy(allocations)!=plan['otherAllocationsSha256']):
            fail('repair_UTC_owned_policy_or_new_day_bookings_changed')
        if at is not None and moment(at)<moment(plan['nextUtc']): fail('repair_UTC_not_reached')
        target=plan['originalPolicy']
        checks += ["IF clock_timestamp()<"+literal(plan['nextUtc'])+"::timestamptz OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(current['grants']['day'])+"::date THEN RAISE EXCEPTION 'repair_UTC_unavailable'; END IF;",
            "IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(plan['grantDay'])+"::date),0)<>"+str(cu(plan['baselineSourceGrantedCu'])+booked)+" OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(current['grants']['day'])+"::date),0)<>0 THEN RAISE EXCEPTION 'repair_UTC_source_ledger_changed'; END IF;"]
    if phase!='revoke':
        checks.append("IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'unexpected_active_paid_permit'; END IF;")
        for row in plan['failedClosure']['oldPermits']:
            checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE "+_match(row)+" AND NOT enabled AND spent_cu="+row['spentCu']+") THEN RAISE EXCEPTION 'failed_qualification_permit_changed'; END IF;")
    if phase in {'admission','cleanup'}:
        source=plan['phaseBaselineSourceGrantedCu'] if phase=='admission' else str(work['unified_source'])
        checks.append("IF (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+literal(plan['grantDay'])+"::date OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+literal(plan['grantDay'])+"::date),0)<>"+source+" THEN RAISE EXCEPTION 'repair_source_grant_baseline_changed'; END IF;")
    if phase not in {'admission','inherited_utc'}:
        for row in rows:
            checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE "+_match(row)+(''if phase=='revoke'else' AND NOT enabled')+") THEN RAISE EXCEPTION 'repair_owned_permit_changed'; END IF;")
            if phase=='revoke':changes.append('UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE '+_match(row)+';')
    if target:
        changes += ['UPDATE yunipals_market.rpc_compute_budget SET daily_cu='+target['globalDailyCu']+" WHERE scope='yunipals-opensea';",
            'UPDATE yunipals_market.rpc_compute_allocation SET daily_cu='+target['unifiedSourceDailyCu']+" WHERE scope='yunipals-opensea' AND workload='unified_source';"]
    return '\n'.join(['-- PREPARED OWNER SQL ONLY. No execution by this model.','BEGIN;',"SET LOCAL statement_timeout='3000ms';","SET LOCAL lock_timeout='750ms';","SET LOCAL idle_in_transaction_session_timeout='5000ms';",
        "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));",
        'LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;',
        'DO $repair_guard$ BEGIN',*checks,*changes,'END $repair_guard$;',"SELECT jsonb_build_object('repairPlanSha256',"+literal(digest(plan))+",'phase',"+literal(phase)+",'applied',true,'grantCountersReset',false);",'COMMIT;',''])


def _match(row):
    return ' AND '.join(['permit_id='+literal(row['permitId']),'profile_id='+literal(PROFILE),'chain_id='+str(row['chainId']),
        'from_block='+row['fromBlock'],'through_block='+row['throughBlock'],'maximum_cu='+row['maximumCu'],'expires_at='+literal(row['expires'])+'::timestamptz'])
