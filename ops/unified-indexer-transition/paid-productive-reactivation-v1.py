#!/usr/bin/env python3
"""Prepared same-ID continuation SQL. No execution, renewal or counter reset."""
import hashlib
import json
from pathlib import Path
import re
import types

FORMAT='yunipals-paid-productive-reactivation-v1'
MODEL_SHA='872f05a70c790f088dbbca6f2d7280cd8f527c038b3e72c8acfe64539a5b6c25'
ACTUAL_PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'
PARENT_RESULT_SHA='2cb3f135ca2554e90b95ada09f816189d6fab4423e14f54ed16ddf29aa25933a'
PARENT_REVIEW_SHA='7e88b1c0d2839f8789a1f0592a5279308a81fae0c4f1958624c14fadbd916fd3'
PARENT_CLEANUP_SHA='e212e33b8458a9ea50422e23bce22dd0e2be608f3d852e327faef062f4b38534'
PARENT_SEAL_SHA='31fa3c41f4c148cc42dee299468ddd3bd25af5b2113e4105dce8e579d3e74758'
PARENT_KEYS={'format','runId','productivePlanSha256','livePlanFile','livePlanSha256','journalSha256','controllerResultSha256','controllerFinishedAckSha256','startRequestedSha256','failedLaunchSha256','failedStartSealFile','failedStartSealSha256','failedStartCleanupTransitionFile','failedStartCleanupTransitionSha256','revokedPermitStateSha256','cleanupReviewFile','cleanupReviewSha256','cleanupDriverReceiptFile','cleanupDriverReceiptSha256','cleanupDriverResultFile','cleanupDriverResultSha256','currentDayCleanupFile','currentDayCleanupSha256','cleanupAckSha256','epochRecordFile','epochRecordSha256','cacheReceiptFile','cacheReceiptSha256','cacheAckSha256','dependentProofFile','dependentProofSha256','afterThirtySha256'}


def fail(code):raise ValueError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def digest(value):return hashlib.sha256(encoded(value)).hexdigest()


def model():
    path=Path(__file__).with_name('paid-productive-plan-v5.py');raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=MODEL_SHA:fail('frozen_productive_model_changed')
    value=types.ModuleType('reactivation_original_model');value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value


def validate_parent(plan,parent):
    m=model();m.validate(plan)
    if (not isinstance(parent,dict)or set(parent)!=PARENT_KEYS or
        parent.get('format')!='yunipals-productive-failed-start-parent-v1'or parent.get('runId')!='20261021-prod2'or
        parent.get('productivePlanSha256')!=digest(plan)or digest(plan)!=ACTUAL_PLAN_SHA or
        any(not m.is_sha(parent[k])for k in PARENT_KEYS if k.endswith('Sha256'))or
        parent['cleanupDriverResultSha256']!=PARENT_RESULT_SHA or parent['cleanupReviewSha256']!=PARENT_REVIEW_SHA or
        parent['currentDayCleanupSha256']!=PARENT_CLEANUP_SHA or parent['failedStartSealSha256']!=PARENT_SEAL_SHA or
        parent['startRequestedSha256']!='3051abac91dbcc3e7476a2b71965f0c461e506f38dca24007780e5028b03e7e2'or
        parent['failedLaunchSha256']!='4e026b35c85c6aa3c5684305ebec8a3a55a89d767c10525a9b07689cece90384'or
        parent['dependentProofFile']!=parent['failedStartCleanupTransitionFile']or parent['dependentProofSha256']!=parent['failedStartCleanupTransitionSha256']or
        plan['qualificationBookedCu']!='5000' or plan['qualificationPermitAuthorityCu']!='1080'):
        fail('exact_acknowledged_failed_start_parent_required')
    return m


def review(plan,parent,current,permitState):
    """External owner must reopen actual ACKs, quiet source and terminal seal."""
    m=validate_parent(plan,parent);origin=m.model()
    if (not isinstance(permitState,dict)or set(permitState)!={'active','owned'}or type(permitState['active'])is not int or permitState['active']!=0 or
        not isinstance(permitState['owned'],list)or len(permitState['owned'])!=2 or digest(permitState)!=parent['revokedPermitStateSha256']):
        fail('exact_sealed_disabled_productive_rows_required')
    for expected,actual in zip(plan['permits'],permitState['owned']):
        if (not isinstance(actual,dict)or set(actual)!={'permitId','profileId','chainId','fromBlock','throughBlock','maximumCu','spentCu','enabled','expires'}or
            type(actual['chainId'])is not int or actual['enabled']is not False or actual['profileId']!=origin.PROFILE or
            any(actual[k]!=v for k,v in expected.items()if k!='expires')or origin.moment(actual['expires'].replace('+00:00','Z'))!=origin.moment(expected['expires'])or
            not isinstance(actual['spentCu'],str)or not re.fullmatch('0|[1-9][0-9]*',actual['spentCu'])or int(actual['spentCu'])>int(expected['maximumCu'])):
            fail('existing_permit_identity_maximum_spend_or_expiry_changed')
    daily,reserve,allocations=origin.policy(current);total,background,grants=origin.grants(current,allocations)
    if (total>daily or background>daily-reserve or total<int(plan['baselineGlobalGrantedCu'])+5000 or
        background<int(plan['baselineBackgroundGrantedCu'])+5000 or any(grants[k]>origin.cu(allocations[k]['dailyCu'])for k in grants)or
        origin.moment(current['profileExpiresAt'].replace('+00:00','Z'))!=origin.moment(plan['profileExpiresAt'])):
        fail('fresh_grant_conservation_and_original_profile_required')
    # Reuse every existing financial/admission guard; no current grant hash is
    # put into the stable review, so ordinary foreground grants may advance.
    m.owner_sql('promotion',plan,current)
    return {'format':FORMAT,'productivePlanSha256':digest(plan),'continuationParentSha256':digest(parent),
        'revokedPermitStateSha256':digest(permitState),'financialOperation':'reactivate_existing_rows',
        'originalStart':plan['start'],'originalExpiry':plan['expires'],'dispatchExpires':plan['dispatchExpires'],
        'qualificationBookedCu':'5000','permitIds':[r['permitId']for r in plan['permits']],
        'permitMaximaAndSpentUnchanged':True,'grantCountersReset':False,'automaticRenewal':False}


def owner_sql(phase,plan,parent,current,permitState):
    if phase!='reactivate':fail('only_same_ID_reactivation_phase_supported')
    review(plan,parent,current,permitState);m=model();origin=m.model();sql=m.owner_sql('promotion',plan,current)
    for row,actual in zip(plan['permits'],permitState['owned']):
        insertion="INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES("+','.join([m.literal(row['permitId']),m.literal(origin.PROFILE),str(row['chainId']),row['fromBlock'],row['throughBlock'],row['maximumCu'],'true',m.literal(row['expires'])+'::timestamptz'])+");"
        match=' AND '.join(['permit_id='+m.literal(row['permitId']),'profile_id='+m.literal(origin.PROFILE),'chain_id='+str(row['chainId']),
            'from_block='+row['fromBlock'],'through_block='+row['throughBlock'],'maximum_cu='+row['maximumCu'],
            'expires_at='+m.literal(row['expires'])+'::timestamptz','NOT enabled','spent_cu='+actual['spentCu']])
        replacement='UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=true WHERE '+match+"; IF NOT FOUND THEN RAISE EXCEPTION 'exact_revoked_row_reactivation_refused'; END IF;"
        if sql.count(insertion)!=1:fail('frozen_exact_productive_insert_shape_changed')
        sql=sql.replace(insertion,replacement,1)
    ids=','.join(m.literal(r['permitId'])for r in plan['permits'])
    observed="jsonb_build_object('active',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id)WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()),'owned',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'profileId',profile_id,'chainId',chain_id,'fromBlock',from_block::text,'throughBlock',through_block::text,'maximumCu',maximum_cu::text,'spentCu',spent_cu::text,'enabled',enabled,'expires',expires_at)ORDER BY chain_id)FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN("+ids+")),'[]'::jsonb))"
    guard='IF '+observed+' IS DISTINCT FROM '+m.literal(encoded(permitState).decode())+"::jsonb THEN RAISE EXCEPTION 'sealed_productive_permit_state_changed'; END IF;"
    anchor='DO $productive_guard$ BEGIN\n'
    if sql.count(anchor)!=1 or sql.count("'phase','promotion'")!=1:fail('frozen_productive_transaction_shape_changed')
    sql=sql.replace(anchor,anchor+guard+'\n',1).replace("'phase','promotion'","'phase','reactivate'",1)
    if 'INSERT INTO' in sql or 'DELETE FROM' in sql or sql.count('SET enabled=true')!=2 or not sql.endswith('COMMIT;\n'):
        fail('only_two_existing_row_enables_allowed')
    return sql
