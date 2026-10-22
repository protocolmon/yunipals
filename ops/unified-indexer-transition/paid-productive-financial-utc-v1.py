#!/usr/bin/env python3
"""Pure original-UTC cleanup SQL allowing bounded normal new-day source work."""
from copy import deepcopy
import hashlib,json
from pathlib import Path
import types

FORMAT='yunipals-paid-productive-financial-utc-v1'
MODEL_SHA='872f05a70c790f088dbbca6f2d7280cd8f527c038b3e72c8acfe64539a5b6c25'
PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'


def fail(code):raise ValueError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()


def model():
    path=Path(__file__).with_name('paid-productive-plan-v5.py');raw=path.read_bytes()
    if sha(raw)!=MODEL_SHA:fail('frozen_original_productive_model_changed')
    m=types.ModuleType('financial_utc_original_model');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m


def review(plan,current,receipt):
    m=model();m.validate(plan);origin=m.model()
    if m.digest(plan)!=PLAN_SHA:fail('only_actual_original_productive_plan_allowed')
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
    sql=m.owner_sql('utc',plan,template,receipt=receipt)
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
