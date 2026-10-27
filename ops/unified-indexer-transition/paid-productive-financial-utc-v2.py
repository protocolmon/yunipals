#!/usr/bin/env python3
"""Finite original-UTC SQL for the exact already-reviewed productive plan.

The caller reopens the protected acknowledged cleanup and passed handoff review.
The exact immutable plan digest replaces recursive qualification-history walks;
all current-policy, ledger, permit and transaction guards remain executable SQL.
"""
from copy import deepcopy
import hashlib,json
from pathlib import Path
import types

FORMAT='yunipals-paid-productive-financial-utc-v2'
MODEL_SHA='872f05a70c790f088dbbca6f2d7280cd8f527c038b3e72c8acfe64539a5b6c25'
PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'


def fail(code):raise ValueError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()


def model():
    path=Path(__file__).with_name('paid-productive-plan-v5.py');raw=path.read_bytes()
    if sha(raw)!=MODEL_SHA:fail('frozen_original_productive_model_changed')
    m=types.ModuleType('financial_utc_original_model');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m


def original_utc_sql(m,origin,plan,current,receipt):
    """The frozen model's UTC branch, without its recursive history validator."""
    daily,reserve,allocations=origin.policy(current);total,background,grants=origin.grants(current,allocations)
    rows=plan['permits'];checks=[];q=m.literal
    checks += ["IF (SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled) FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea') IS DISTINCT FROM "+q(json.dumps(current['global'],separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'productive_global_policy_drift'; END IF;",
        "IF (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea') IS DISTINCT FROM "+q(json.dumps(sorted(allocations.values(),key=lambda r:r['workload']),separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'productive_allocation_policy_drift'; END IF;"]
    original_daily=origin.cu(plan['originalPolicy']['globalDailyCu']);original_background=original_daily-origin.cu(plan['originalPolicy']['foregroundReserveCu'])
    if total>original_daily or background>original_background:fail('original_UTC_headroom_would_be_below_existing_bookings')
    checks.append("IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'AND window_start="+q(current['grants']['day'])+"::date),0)>"+str(original_daily)+" OR COALESCE((SELECT background_granted_cu FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'AND window_start="+q(current['grants']['day'])+"::date),0)>"+str(original_background)+" THEN RAISE EXCEPTION 'original_UTC_headroom_below_fresh_bookings'; END IF;")
    if (not isinstance(receipt,dict) or receipt.get('productivePlanSha256')!=m.digest(plan) or
        receipt.get('originAdmissionSha256')!=plan['originAdmissionSha256'] or receipt.get('format')!=m.FORMAT or
        receipt.get('stage')!='prepared_productive_cleanup_not_executed' or receipt.get('ownedPermits')!=rows or
        receipt.get('nextUtc')!=plan['nextUtc'] or receipt.get('originalPolicy')!=plan['originalPolicy'] or
        receipt.get('epochStart')!=plan['start'] or receipt.get('epochExpires')!=plan['expires'] or
        receipt.get('otherAllocationsSha256')!=plan['otherAllocationsSha256'] or
        not origin.cu(plan['qualificationBookedCu'])<=origin.cu(receipt['migrationBookedGrantsCu'])<=m.ALLOWANCE or
        receipt['policy']!={'globalDailyCu':str(1_000_000+origin.cu(receipt['migrationBookedGrantsCu'])),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+origin.cu(receipt['migrationBookedGrantsCu']))}):
        fail('matching_acknowledged_productive_cleanup_receipt_required')
    target=plan['originalPolicy'];expected=receipt['policy']
    if current['grants']['day']!=origin.moment(plan['nextUtc']).date().isoformat() or grants['unified_source']!=0:
        fail('unexplained_new_day_bookings_refuse_automatic_restore')
    if daily!=origin.cu(expected['globalDailyCu']) or reserve!=200000 or origin.cu(allocations['unified_source']['dailyCu'])!=origin.cu(expected['unifiedSourceDailyCu']) or origin.other_policy(allocations)!=plan['otherAllocationsSha256']:
        fail('owned_next_utc_policy_changed')
    checks.append("IF clock_timestamp()<"+q(plan['nextUtc'])+"::timestamptz OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>"+q(current['grants']['day'])+"::date THEN RAISE EXCEPTION 'productive_utc_too_early'; END IF;")
    checks.append("IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+q(plan['grantDay'])+"::date),0)<>"+str(origin.cu(plan['baselineSourceGrantedCu'])+origin.cu(receipt['migrationBookedGrantsCu']))+" OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start="+q(current['grants']['day'])+"::date),0)<>0 THEN RAISE EXCEPTION 'productive_boundary_ledger_changed'; END IF;")
    checks.append("IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'unexpected_active_paid_permit'; END IF;")
    for row in rows:
        match=' AND '.join(['permit_id='+q(row['permitId']),'profile_id='+q(origin.PROFILE),'chain_id='+str(row['chainId']),'from_block='+row['fromBlock'],'through_block='+row['throughBlock'],'maximum_cu='+row['maximumCu'],'expires_at='+q(row['expires'])+'::timestamptz'])
        checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE "+match+" AND NOT enabled) THEN RAISE EXCEPTION 'productive_owned_permit_changed'; END IF;")
    changes=['UPDATE yunipals_market.rpc_compute_budget SET daily_cu='+target['globalDailyCu']+" WHERE scope='yunipals-opensea';",
        'UPDATE yunipals_market.rpc_compute_allocation SET daily_cu='+target['unifiedSourceDailyCu']+" WHERE scope='yunipals-opensea' AND workload='unified_source';"]
    return '\n'.join(['-- PREPARED ONLY; actual source/timer/cache/owner guards are external.','BEGIN;',"SET LOCAL statement_timeout='3000ms';","SET LOCAL lock_timeout='750ms';","SET LOCAL idle_in_transaction_session_timeout='5000ms';",
        "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));",
        'LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;',
        'DO $productive_guard$ BEGIN',*checks,*changes,'END $productive_guard$;',"SELECT jsonb_build_object('productivePlanSha256',"+q(m.digest(plan))+",'phase','utc','applied',true,'grantCountersReset',false);",'COMMIT;',''])


def review(plan,current,receipt):
    # Exact bytes were fully reviewed and validated before the protected handoff.
    # No dynamically loaded validator is replaced or mutated.
    if sha(encoded(plan))!=PLAN_SHA:fail('only_actual_original_productive_plan_allowed')
    m=model();origin=m.model()
    daily,reserve,allocations=origin.policy(current);total,background,grants=origin.grants(current,allocations)
    target=plan['originalPolicy'];source=grants['unified_source']
    if (current['grants']['day']!=origin.moment(plan['nextUtc']).date().isoformat()or
        source>origin.cu(target['unifiedSourceDailyCu'])or total>origin.cu(target['globalDailyCu'])or
        background>origin.cu(target['globalDailyCu'])-origin.cu(target['foregroundReserveCu'])or
        any(grants[key]>(origin.cu(target['unifiedSourceDailyCu'])if key=='unified_source'else origin.cu(allocations[key]['dailyCu']))for key in grants)):
        fail('normal_new_day_bookings_exceed_original_policy_manual_reconcile')
    # This is a template-only projection, never a database observation or write:
    # the predecessor's pure validator permits only source0. Removing that same
    # contribution from all three template counters preserves conservation.
    # Generated SQL below always reads the actual untouched counters under locks.
    template=deepcopy(current)
    template['grants']['workloads']['unified_source']='0'
    template['grants']['global']=str(total-source);template['grants']['background']=str(background-source)
    sql=original_utc_sql(m,origin,plan,template,receipt)
    return {'format':FORMAT,'productivePlanSha256':m.digest(plan),'cleanupReceiptSha256':m.digest(receipt),
        'dueUtc':plan['nextUtc'],'originalPolicy':deepcopy(target),'originalBookedCu':receipt['migrationBookedGrantsCu'],
        'newDaySourceCu':str(source),'normalNewDaySourceLimitCu':target['unifiedSourceDailyCu'],
        'priorDaySourceMinimumCu':str(origin.cu(plan['baselineSourceGrantedCu'])+origin.cu(receipt['migrationBookedGrantsCu'])),
        'priorDaySourceMaximumCu':str(origin.cu(target['unifiedSourceDailyCu'])+origin.cu(receipt['migrationBookedGrantsCu'])),
        'ordinaryPriorDayUsageUnmodified':True,'grantCountersReset':False,'paidAuthorityAdded':False},sql


def owner_sql(plan,current,receipt):
    reviewed,text=review(plan,current,receipt);m=model();origin=m.model();target=plan['originalPolicy'];q=m.literal
    day=q(current['grants']['day'])+'::date';scope="'yunipals-opensea'"
    value="COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope="+scope+" AND workload='unified_source' AND window_start="+day+"),0)"
    before=value+'<>0';after=value+'>'+target['unifiedSourceDailyCu']
    if text.count(before)!=1:fail('frozen_exact_new_day_source_zero_guard_changed')
    text=text.replace(before,after,1)
    prior_day=q(plan['grantDay'])+'::date'
    prior_value="COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope="+scope+" AND workload='unified_source' AND window_start="+prior_day+"),0)"
    prior_before=prior_value+'<>'+reviewed['priorDaySourceMinimumCu']
    prior_after='('+prior_value+'<'+reviewed['priorDaySourceMinimumCu']+' OR '+prior_value+'>'+reviewed['priorDaySourceMaximumCu']+')'
    if text.count(prior_before)!=1:fail('frozen_exact_prior_day_source_guard_changed')
    text=text.replace(prior_before,prior_after,1)
    fresh="""IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),0)
      IS DISTINCT FROM (SELECT coalesce(sum(granted_cu),0)FROM yunipals_market.rpc_compute_workload_window WHERE scope=SCOPE AND window_start=DAY)
      OR COALESCE((SELECT background_granted_cu FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),0)
      IS DISTINCT FROM (SELECT coalesce(sum(w.granted_cu),0)FROM yunipals_market.rpc_compute_workload_window w JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)WHERE w.scope=SCOPE AND w.window_start=DAY AND a.priority='background')
      OR EXISTS(SELECT 1 FROM yunipals_market.rpc_compute_workload_window w LEFT JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)
       WHERE w.scope=SCOPE AND w.window_start=DAY AND(a.workload IS NULL OR w.granted_cu>CASE WHEN w.workload='unified_source'THEN SOURCE_LIMIT ELSE a.daily_cu END))
      THEN RAISE EXCEPTION 'normal_new_day_allocation_conservation_changed';END IF;"""
    # Fixed distinct uppercase tokens only; caller strings never become SQL code.
    import re
    tokens={'SCOPE':scope,'DAY':day,'SOURCE_LIMIT':target['unifiedSourceDailyCu']}
    fresh=re.sub(r'\b(SCOPE|DAY|SOURCE_LIMIT)\b',lambda match:tokens[match.group()],fresh)
    anchor='DO $productive_guard$ BEGIN\n'
    if text.count(anchor)!=1 or not text.endswith('COMMIT;\n'):fail('frozen_original_UTC_transaction_shape_changed')
    text=text.replace(anchor,anchor+fresh+'\n',1)
    if ('INSERT INTO'in text or 'DELETE FROM'in text or 'SET granted_cu'in text or 'SET spent_cu'in text or
        'SET enabled=true'in text or text.count('UPDATE yunipals_market.')!=2):fail('only_original_policy_restore_allowed')
    return text
