#!/usr/bin/env python3
"""Finite one-window continuation accounting/SQL. No process, network or SQL execution.

The live owner supplies protected cleanup/approval ACKs and exclusive stopped
source/empty-cache proofs. UTC continuation requires an ACKed first-day seal and
normal-policy restore. Permit spend, booked grant tails and the clock never reset.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import types

FORMAT='yunipals-paid-continuation-financial-v1'
PROFILE='0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728'
PROFILE_SHA='0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e'
PROFILE_EXPIRES='2026-11-19T18:00:00Z'
COORDINATOR='faf1bb8c-4306-4c43-b55e-6ac5fa038567'
ORIGIN_SHA='c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef'
OLD_PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'
HANDOFF_SHA='620fa95f54d320e09a8d7f380aa58efc877194eeb10021230d5598df13b68885'
ORDINARY_SHA='d936bd399f90b8205fcbefe81a8cdef449d824fe3465a30f8ff9627112b610e5'
PRIOR=713000
ADDITIONAL=19287000
TOTAL=20000000
SECONDS=28800
DRAIN=90
NORMAL={'globalDailyCu':'1000000','foregroundReserveCu':'200000','unifiedSourceDailyCu':'25000'}
STARTS={56:'7579197',8453:'22224075'}
MAXIMA={'56':'16287000','8453':'3000000'}
THROUGH={'56':'130000000','8453':'55000000'}
SCOPE="'yunipals-opensea'"

def fail(code):raise ValueError(code)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def digest(v):return hashlib.sha256(encoded(v)).hexdigest()
def sha(v):return hashlib.sha256(v).hexdigest()
def is_sha(v):return isinstance(v,str)and re.fullmatch('[0-9a-f]{64}',v)is not None
def literal(v):return "'"+str(v).replace("'","''")+"'"
def cu(v):
    if not isinstance(v,str)or not re.fullmatch('0|[1-9][0-9]{0,12}',v)or int(v)>10**12:fail('canonical_CU_required')
    return int(v)
def moment(v):
    if not isinstance(v,str)or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z',v):fail('canonical_UTC_required')
    return datetime.fromisoformat(v.replace('Z','+00:00'))
def text_time(v):return v.isoformat(timespec='microseconds'if v.microsecond else'seconds').replace('+00:00','Z')
def origin():
    path=Path(__file__).with_name('paid-backfill-policy-plan-v2.py');raw=path.read_bytes()
    if sha(raw)!=ORIGIN_SHA:fail('frozen_financial_primitives_changed')
    m=types.ModuleType('continuation_financial_primitives');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m
def profile():
    raw=Path(__file__).with_name('normal-rpc-profile-v1.json').read_bytes()
    if sha(raw)!=PROFILE_SHA:fail('exact_normal_profile_required')
    return json.loads(raw)
def policy(v):
    if v.get('profileId')!=PROFILE or moment(v['profileExpiresAt'])!=moment(PROFILE_EXPIRES):fail('normal_profile_identity_changed')
    # Only the frozen parser's identity field is projected; the real snapshot
    # remains unchanged and SQL below binds the actual d059 profile directly.
    m=origin();daily,reserve,alloc=m.policy({**v,'profileId':m.PROFILE});total,bg,grants=m.grants(v,alloc)
    if total>daily or bg>daily-reserve or any(grants[k]>cu(alloc[k]['dailyCu'])for k in grants):fail('bookings_exceed_current_policy')
    return daily,reserve,alloc,total,bg,grants
def policy_value(v):
    daily,reserve,a,*_=policy(v)
    return {'globalDailyCu':str(daily),'foregroundReserveCu':str(reserve),'unifiedSourceDailyCu':a['unified_source']['dailyCu']}
def other(a):return digest({k:v for k,v in a.items()if k!='unified_source'})
def target(migration,source=None):return {'globalDailyCu':str(1000000+migration),'foregroundReserveCu':'200000','unifiedSourceDailyCu':str(25000+migration if source is None else source)}
def approval_value():return {'explicitUserApproval':True,'additionalCu':str(ADDITIONAL),'priorBookedCu':str(PRIOR),'aggregateCu':str(TOTAL),'maximumSeconds':SECONDS,'automaticRenewal':False,'dispatchCu':MAXIMA,'throughBlocks':THROUGH}

def validate_prior(v):
    keys={'cleanupReceipt','cleanupReceiptFile','cleanupReceiptSha256','handoffFile','handoffSha256','ordinaryRuntimeFile','ordinaryRuntimeSha256'}
    if not isinstance(v,dict)or set(v)!=keys or any(not is_sha(v[k])for k in keys if k.endswith('Sha256'))or v['handoffSha256']!=HANDOFF_SHA or v['ordinaryRuntimeSha256']!=ORDINARY_SHA:fail('exact_closed_prior_handoff_required')
    r=v['cleanupReceipt']
    if (r.get('format')!='yunipals-paid-productive-plan-v5'or r.get('stage')!='prepared_productive_cleanup_not_executed'or r.get('productivePlanSha256')!=OLD_PLAN_SHA or
        r.get('migrationBookedGrantsCu')!=str(PRIOR)or r.get('grantDay')!='2026-10-21'or r.get('originalPolicy')!=NORMAL or
        r.get('policy')!=target(PRIOR)or r.get('counterResetOrRefundAllowed')is not False or
        not is_sha(r.get('otherAllocationsSha256'))or not isinstance(r.get('ownedPermits'),list)or len(r['ownedPermits'])!=2):fail('actual_713000_closed_migration_required')
    for chain,row in zip(STARTS,r['ownedPermits']):
        if(set(row)!={'permitId','chainId','fromBlock','throughBlock','maximumCu','expires'}or type(row['chainId'])is not int or row['chainId']!=chain or
           not isinstance(row['permitId'],str)or not re.fullmatch('0x[0-9a-f]{64}',row['permitId'])or row['fromBlock']!=STARTS[chain]or
           row['throughBlock']!=THROUGH[str(chain)]or row['maximumCu']!=('19000000'if chain==56 else'995000')or row['expires']!='2026-10-21T19:14:55.939473Z'):fail('exact_retired_productive_permit_bounds_required')
    for k in keys:
        if k.endswith('File')and(not isinstance(v[k],str)or not v[k].startswith('/')or'..'in Path(v[k]).parts):fail('protected_absolute_prior_references_required')
    # File SHA is supplied by the owner, which reads exact bytes including any
    # newline; this pure module deliberately does not substitute a JSON digest.
    return r

def prepare(current,priorClosedReceipt,approval,at=None):
    r=validate_prior(priorClosedReceipt)
    if encoded(approval)!=encoded(approval_value()):fail('single_explicit_remaining_allowance_approval_required')
    _,_,a,_,_,g=policy(current)
    if(policy_value(current)!=r['policy']or other(a)!=r['otherAllocationsSha256']or current['grants']['day']!=r['grantDay']or not PRIOR<=g['unified_source']<=PRIOR+25000):fail('closed_prior_policy_and_ordinary_headroom_required')
    basis={'format':FORMAT,'stage':'setup_only_no_clock_no_authority','priorClosedReceipt':deepcopy(priorClosedReceipt),'approval':deepcopy(approval),
        'profileId':PROFILE,'profileExpiresAt':PROFILE_EXPIRES,'originalPolicy':NORMAL,'otherAllocationsSha256':other(a),
        'priorBookedCu':str(PRIOR),'remainingNewBookedCu':str(ADDITIONAL),'automaticRenewal':False,'counterResetOrRefundAllowed':False}
    identity=digest(basis)
    return {**basis,'permits':[{'permitId':'0x'+digest({'setup':identity,'chainId':chain,'kind':'single_approved_remaining_allowance'}),'chainId':chain,'fromBlock':STARTS[chain],'throughBlock':THROUGH[str(chain)],'maximumCu':MAXIMA[str(chain)]}for chain in STARTS]}

def activate(setup,current,at):
    expected=prepare(current,setup['priorClosedReceipt'],setup['approval'])
    if setup!=expected:fail('immutable_setup_changed')
    start=moment(at);end=start+timedelta(seconds=SECONDS);utc=start.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)
    if current['grants']['day']!=start.date().isoformat()or start.date().isoformat()!='2026-10-21'or not start<utc<end or end>moment(PROFILE_EXPIRES):fail('one_original_setup_day_cross_UTC_window_required')
    _,_,_,total,bg,g=policy(current);expires=text_time(end);dispatch=text_time(end-timedelta(seconds=DRAIN));first_dispatch=text_time(utc-timedelta(seconds=DRAIN))
    return {'format':FORMAT,'stage':'single_ready_window_not_admitted','setup':deepcopy(setup),'setupSha256':digest(setup),'profileId':PROFILE,'profileExpiresAt':PROFILE_EXPIRES,
        'start':at,'expires':expires,'dispatchExpires':dispatch,'nextUtc':text_time(utc),'grantDay':current['grants']['day'],
        'baselineSourceGrantedCu':str(g['unified_source']),'baselineGlobalGrantedCu':str(total),'baselineBackgroundGrantedCu':str(bg),
        'beforePolicy':policy_value(current),'temporaryPolicy':target(TOTAL,g['unified_source']+ADDITIONAL),'originalPolicy':NORMAL,
        'otherAllocationsSha256':setup['otherAllocationsSha256'],'priorBookedCu':str(PRIOR),'remainingNewBookedCu':str(ADDITIONAL),
        'permits':[{**row,'expires':first_dispatch}for row in setup['permits']],
        'permitsDay2':[{**row,'expires':dispatch}for row in setup['permits']],'automaticRenewal':False,'counterResetOrRefundAllowed':False}

def validate(plan):
    # Reconstruct only this finite plan, never obsolete nested Q/native history.
    s=plan['setup'];r=validate_prior(s['priorClosedReceipt'])
    setup_keys={'format','stage','priorClosedReceipt','approval','profileId','profileExpiresAt','originalPolicy','otherAllocationsSha256','priorBookedCu','remainingNewBookedCu','automaticRenewal','counterResetOrRefundAllowed','permits'}
    plan_keys={'format','stage','setup','setupSha256','profileId','profileExpiresAt','start','expires','dispatchExpires','nextUtc','grantDay','baselineSourceGrantedCu','baselineGlobalGrantedCu','baselineBackgroundGrantedCu','beforePolicy','temporaryPolicy','originalPolicy','otherAllocationsSha256','priorBookedCu','remainingNewBookedCu','permits','permitsDay2','automaticRenewal','counterResetOrRefundAllowed'}
    if (plan.get('format')!=FORMAT or plan.get('stage')!='single_ready_window_not_admitted'or plan['setupSha256']!=digest(s)or
        set(s)!=setup_keys or set(plan)!=plan_keys or s['format']!=FORMAT or s['stage']!='setup_only_no_clock_no_authority'or
        encoded(s.get('approval'))!=encoded(approval_value())or s.get('otherAllocationsSha256')!=r['otherAllocationsSha256']or
        s['profileId']!=PROFILE or s['profileExpiresAt']!=PROFILE_EXPIRES or s['originalPolicy']!=NORMAL or
        s['priorBookedCu']!=str(PRIOR)or s['remainingNewBookedCu']!=str(ADDITIONAL)or s['automaticRenewal']is not False or s['counterResetOrRefundAllowed']is not False or
        plan['profileId']!=PROFILE or plan['profileExpiresAt']!=PROFILE_EXPIRES or plan['originalPolicy']!=NORMAL or
        plan['priorBookedCu']!=str(PRIOR)or plan['remainingNewBookedCu']!=str(ADDITIONAL)or plan['otherAllocationsSha256']!=s['otherAllocationsSha256']or
        plan['automaticRenewal']is not False or plan['counterResetOrRefundAllowed']is not False or
        plan['beforePolicy']!=target(PRIOR)or not PRIOR<=cu(plan['baselineSourceGrantedCu'])<=PRIOR+25000 or
        plan['temporaryPolicy']!=target(TOTAL,cu(plan['baselineSourceGrantedCu'])+ADDITIONAL)):fail('finite_plan_identity_or_allowance_changed')
    start=moment(plan['start']);end=moment(plan['expires']);utc=start.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)
    if(end-start!=timedelta(seconds=SECONDS)or plan['dispatchExpires']!=text_time(end-timedelta(seconds=DRAIN))or plan['nextUtc']!=text_time(utc)or
       plan['grantDay']!='2026-10-21'or start.date().isoformat()!=plan['grantDay']or not start<utc<end or end>moment(PROFILE_EXPIRES)):fail('single_absolute_eight_hour_clock_changed')
    base={k:v for k,v in s.items()if k!='permits'};identity=digest(base)
    rows=[{'permitId':'0x'+digest({'setup':identity,'chainId':chain,'kind':'single_approved_remaining_allowance'}),'chainId':chain,'fromBlock':STARTS[chain],
        'throughBlock':THROUGH[str(chain)],'maximumCu':MAXIMA[str(chain)]}for chain in STARTS]
    if(s['permits']!=rows or plan['permits']!=[{**row,'expires':text_time(utc-timedelta(seconds=DRAIN))}for row in rows]or
       plan['permitsDay2']!=[{**row,'expires':plan['dispatchExpires']}for row in rows]):fail('new_permit_partition_changed')
    for k in ['baselineGlobalGrantedCu','baselineBackgroundGrantedCu']:cu(plan[k])

def segment(plan,prior):
    if prior is None:return plan['grantDay'],plan['baselineSourceGrantedCu'],plan['temporaryPolicy'],0,PRIOR
    if(prior.get('format')!=FORMAT or prior.get('stage')!='prepared_same_window_boundary_resume'or prior.get('planSha256')!=digest(plan)or
        prior['grantDay']!=moment(plan['nextUtc']).date().isoformat()or not is_sha(prior.get('utcAckSha256'))):fail('actual_ACKed_boundary_context_required')
    first=prior['firstDayCleanup']
    if first.get('boundaryContext')is not None or first.get('grantDay')!=plan['grantDay']:fail('only_one_UTC_boundary_allowed')
    validate_cleanup(plan,first);charged=cu(first['newBookedAggregateCu'])
    if prior['beforePolicy']!=NORMAL or prior['remainingNewBookedCu']!=str(ADDITIONAL-charged)or prior['temporaryPolicy']!=target(ADDITIONAL-charged,cu(prior['baselineSourceGrantedCu'])+ADDITIONAL-charged)or not 0<=cu(prior['baselineSourceGrantedCu'])<=25000:fail('boundary_remaining_allowance_changed')
    return prior['grantDay'],prior['baselineSourceGrantedCu'],prior['temporaryPolicy'],charged,0

def validate_permit_state(plan,state,previous=None,*,day2=False):
    if not isinstance(state,dict)or set(state)!={'active','owned'}or type(state['active'])is not int or state['active']!=0 or not isinstance(state['owned'],list)or len(state['owned'])!=2:fail('exact_quiesced_disabled_permit_state_required')
    for index,(expected,row)in enumerate(zip(plan['permitsDay2']if day2 else plan['permits'],state['owned'])):
        if (not isinstance(row,dict)or set(row)!={'permitId','profileId','chainId','fromBlock','throughBlock','maximumCu','spentCu','enabled','expires'}or
            type(row['chainId'])is not int or row['enabled']is not False or row['profileId']!=PROFILE or
            any(row[k]!=v for k,v in expected.items()if k!='expires')or moment(row['expires'].replace('+00:00','Z'))!=moment(expected['expires'])or
            cu(row['spentCu'])>cu(row['maximumCu'])or(previous is not None and cu(row['spentCu'])<cu(previous['owned'][index]['spentCu']))):fail('sealed_permit_identity_maximum_or_monotonic_spend_changed')

def progress(plan,current,prior=None):
    """Readonly booked progress; does not assert revoked rows or empty caches."""
    validate(plan);day,baseline,expected,old,day_prior=segment(plan,prior);_,_,a,total,bg,g=policy(current)
    booked=g['unified_source']-cu(baseline)
    global_base=cu(plan['baselineGlobalGrantedCu']if prior is None else prior['baselineGlobalGrantedCu'])
    bg_base=cu(plan['baselineBackgroundGrantedCu']if prior is None else prior['baselineBackgroundGrantedCu'])
    if (current['grants']['day']!=day or policy_value(current)!=expected or other(a)!=plan['otherAllocationsSha256']or
        not 0<=booked<=ADDITIONAL-old or total<global_base+booked or bg<bg_base+booked):fail('segment_policy_or_aggregate_booked_tails_changed')
    return {'grantDay':day,'segmentBaselineSourceCu':baseline,'sourceGrantedCu':str(g['unified_source']),'segmentBookedCu':str(booked),
        'previousNewBookedCu':str(old),'newBookedAggregateCu':str(old+booked),'cumulativeMigrationBookedCu':str(PRIOR+old+booked),
        'remainingNewBookedCu':str(ADDITIONAL-old-booked),'cleanupPolicy':target(day_prior+booked),'cleanupQuiescenceClaimed':False}

def cleanup_receipt(plan,current,prior=None,*,permitState=None):
    measured=progress(plan,current,prior)
    validate_permit_state(plan,permitState,None if prior is None else prior['firstDayCleanup']['permitState'],day2=prior is not None)
    if sum(cu(r['spentCu'])for r in permitState['owned'])>cu(measured['newBookedAggregateCu']):fail('actual_new_permit_spend_exceeds_charged_grants')
    return {'format':FORMAT,'stage':'prepared_quiesced_segment_cleanup','planSha256':digest(plan),**{k:v for k,v in measured.items()if k not in {'cleanupPolicy','cleanupQuiescenceClaimed'}},'policy':measured['cleanupPolicy'],
        'ownedPermits':deepcopy(plan['permitsDay2']if prior is not None else plan['permits']),'start':plan['start'],'expires':plan['expires'],'cachedUnusedGrantsIncluded':True,'grantCountersReset':False,
        'boundaryContext':deepcopy(prior),'permitState':deepcopy(permitState),'permitStateSha256':digest(permitState)}

def validate_cleanup(plan,r):
    if (not isinstance(r,dict)or r.get('format')!=FORMAT or r.get('stage')!='prepared_quiesced_segment_cleanup'or r.get('planSha256')!=digest(plan)or
        r.get('ownedPermits')!=(plan['permitsDay2']if r.get('boundaryContext')is not None else plan['permits'])or r.get('start')!=plan['start']or r.get('expires')!=plan['expires']or
        r.get('cachedUnusedGrantsIncluded')is not True or r.get('grantCountersReset')is not False):fail('exact_segment_cleanup_receipt_required')
    day,baseline,_,old,day_prior=segment(plan,r['boundaryContext'])
    validate_permit_state(plan,r['permitState'],None if r['boundaryContext']is None else r['boundaryContext']['firstDayCleanup']['permitState'],day2=r['boundaryContext']is not None)
    if r['permitStateSha256']!=digest(r['permitState']):fail('sealed_permit_state_hash_changed')
    booked=cu(r['segmentBookedCu'])
    if(r['grantDay']!=day or r['segmentBaselineSourceCu']!=baseline or cu(r['sourceGrantedCu'])!=cu(baseline)+booked or r['previousNewBookedCu']!=str(old)or
       r['newBookedAggregateCu']!=str(old+booked)or r['cumulativeMigrationBookedCu']!=str(PRIOR+old+booked)or old+booked>ADDITIONAL or
       r['remainingNewBookedCu']!=str(ADDITIONAL-old-booked)or r['policy']!=target(day_prior+booked)or
       sum(cu(row['spentCu'])for row in r['permitState']['owned'])>old+booked):fail('cleanup_charge_or_policy_changed')

def boundary_receipt(plan,current,firstDayCleanup,utcAckSha256,at):
    validate(plan);validate_cleanup(plan,firstDayCleanup);_,_,a,total,bg,g=policy(current)
    if(firstDayCleanup['grantDay']!=plan['grantDay']or not is_sha(utcAckSha256)or moment(at)<moment(plan['nextUtc'])or moment(at)>=moment(plan['dispatchExpires'])or
       current['grants']['day']!=moment(plan['nextUtc']).date().isoformat()or policy_value(current)!=NORMAL or other(a)!=plan['otherAllocationsSha256']):fail('ACKed_normal_UTC_restore_required_before_same_window_resume')
    remaining=cu(firstDayCleanup['remainingNewBookedCu'])
    return {'format':FORMAT,'stage':'prepared_same_window_boundary_resume','planSha256':digest(plan),'firstDayCleanup':deepcopy(firstDayCleanup),'utcAckSha256':utcAckSha256,
        'grantDay':current['grants']['day'],'baselineSourceGrantedCu':str(g['unified_source']),'baselineGlobalGrantedCu':str(total),'baselineBackgroundGrantedCu':str(bg),
        'remainingNewBookedCu':str(remaining),'beforePolicy':NORMAL,'temporaryPolicy':target(remaining,g['unified_source']+remaining)}

def source_value(day):return 'COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='+SCOPE+" AND workload='unified_source' AND window_start="+literal(day)+'::date),0)'
def conservation_sql(day,source_limit,global_limit):
    d=literal(day)+'::date'
    return """IF COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),0)
 IS DISTINCT FROM(SELECT coalesce(sum(granted_cu),0)FROM yunipals_market.rpc_compute_workload_window WHERE scope=SCOPE AND window_start=DAY)
 OR COALESCE((SELECT background_granted_cu FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),0)
 IS DISTINCT FROM(SELECT coalesce(sum(w.granted_cu),0)FROM yunipals_market.rpc_compute_workload_window w JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)WHERE w.scope=SCOPE AND w.window_start=DAY AND a.priority='background')
 OR COALESCE((SELECT granted_cu FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),0)>GLOBAL
 OR COALESCE((SELECT background_granted_cu FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),0)>GLOBAL-200000
 OR EXISTS(SELECT 1 FROM yunipals_market.rpc_compute_workload_window w LEFT JOIN yunipals_market.rpc_compute_allocation a USING(scope,workload)WHERE w.scope=SCOPE AND w.window_start=DAY AND(a.workload IS NULL OR w.granted_cu>CASE WHEN w.workload='unified_source'THEN SOURCE ELSE a.daily_cu END))
 THEN RAISE EXCEPTION 'continuation_fresh_grant_conservation_or_cap_changed';END IF;""".replace('SCOPE',SCOPE).replace('DAY',d).replace('GLOBAL',str(global_limit)).replace('SOURCE',str(source_limit))

def owner_sql(phase,plan,current,*,receipt=None,prior=None,at=None):
    validate(plan)
    if phase not in {'admission','revoke','cleanup','boundary','utc','resume','inherited_utc'}:fail('finite_financial_phase_required')
    checks=[];changes=[];q=literal;rows=plan['permits'];expected=None;target_policy=None
    if phase!='revoke':
        _,reserve,a,total,bg,g=policy(current)
        if reserve!=200000 or other(a)!=plan['otherAllocationsSha256']:fail('original_foreground_reserve_and_other_allocations_required')
        expected=policy_value(current);day=current['grants']['day'];source=g['unified_source']
        if phase=='admission':
            if day!=plan['grantDay']or expected!=plan['beforePolicy']or source!=cu(plan['baselineSourceGrantedCu']):fail('exact_quiescent_activation_baseline_required')
            target_policy=plan['temporaryPolicy'];baseline=plan['baselineSourceGrantedCu'];deadline=min(moment(plan['dispatchExpires']),moment(plan['nextUtc'])-timedelta(seconds=DRAIN))
        elif phase=='resume':
            day,baseline,temp,_,_=segment(plan,receipt)
            if current['grants']['day']!=day or expected!=NORMAL or source!=cu(baseline)or cu(receipt['remainingNewBookedCu'])<1:fail('exact_remaining_boundary_baseline_required')
            target_policy=temp;deadline=moment(plan['dispatchExpires'])
        elif phase=='cleanup':
            validate_cleanup(plan,receipt)
            if cleanup_receipt(plan,current,receipt['boundaryContext'],permitState=receipt['permitState'])!=receipt:fail('actual_quiesced_cleanup_changed')
            target_policy=receipt['policy'];baseline=receipt['sourceGrantedCu']
        elif phase=='inherited_utc':
            if(day!=moment(plan['nextUtc']).date().isoformat()or moment(at)<moment(plan['nextUtc'])or expected!=plan['beforePolicy']or source>25000 or
                not isinstance(prior,dict)or prior['grants']['day']!=plan['grantDay']or not PRIOR<=cu(prior['grants']['workloads']['unified_source'])<=PRIOR+25000):fail('never_admitted_inherited_UTC_identity_required')
            target_policy=NORMAL
            checks += ['IF clock_timestamp()<'+q(plan['nextUtc'])+"::timestamptz THEN RAISE EXCEPTION 'continuation_UTC_too_early';END IF;",
                'IF '+source_value(plan['grantDay'])+'<'+str(PRIOR)+' OR '+source_value(plan['grantDay'])+'>'+str(PRIOR+25000)+" THEN RAISE EXCEPTION 'inherited_original_713000_ledger_changed';END IF;",
                conservation_sql(plan['grantDay'],PRIOR+25000,1000000+PRIOR)]
        else:
            validate_cleanup(plan,receipt)
            due=moment(receipt['grantDay']+'T00:00:00Z')+timedelta(days=1)
            if day!=due.date().isoformat()or moment(at)<due or source>25000:fail('UTC_day_or_normal_source_bookings_changed')
            old=prior
            low=cu(receipt['sourceGrantedCu']);high=low if phase=='boundary'else cu(receipt['policy']['unifiedSourceDailyCu'])
            if not isinstance(old,dict)or old['grants']['day']!=receipt['grantDay']or not low<=cu(old['grants']['workloads']['unified_source'])<=high:fail('actual_sealed_prior_day_ledger_required')
            before=segment(plan,receipt['boundaryContext'])[2]if phase=='boundary'else receipt['policy']
            if expected!=before or(phase=='boundary'and source!=0):fail('exact_owned_UTC_or_unACKed_boundary_policy_required')
            target_policy=NORMAL
            checks += ["IF clock_timestamp()<"+q(text_time(due))+"::timestamptz THEN RAISE EXCEPTION 'continuation_UTC_too_early';END IF;",
                'IF '+source_value(receipt['grantDay'])+'<'+str(low)+' OR '+source_value(receipt['grantDay'])+'>'+str(high)+" THEN RAISE EXCEPTION 'sealed_prior_day_ledger_changed';END IF;",
                conservation_sql(receipt['grantDay'],cu(receipt['policy']['unifiedSourceDailyCu']),cu(receipt['policy']['globalDailyCu']))]
        checks += ["IF (clock_timestamp()AT TIME ZONE 'UTC')::date<>"+q(day)+"::date THEN RAISE EXCEPTION 'continuation_grant_day_changed';END IF;",
            "IF (SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled)FROM yunipals_market.rpc_compute_budget WHERE scope="+SCOPE+')IS DISTINCT FROM '+q(encoded(current['global']).decode())+"::jsonb THEN RAISE EXCEPTION 'continuation_global_policy_changed';END IF;",
            "IF (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text)ORDER BY workload)FROM yunipals_market.rpc_compute_allocation WHERE scope="+SCOPE+')IS DISTINCT FROM '+q(encoded(sorted(a.values(),key=lambda r:r['workload'])).decode())+"::jsonb THEN RAISE EXCEPTION 'continuation_allocation_policy_changed';END IF;",
            conservation_sql(day,cu(target_policy['unifiedSourceDailyCu']),cu(target_policy['globalDailyCu']))]
        if phase in {'admission','resume','cleanup'}:checks.append('IF '+source_value(day)+'<>'+baseline+" THEN RAISE EXCEPTION 'continuation_quiescent_source_changed';END IF;")
        if phase in {'admission','resume','cleanup'}:
            ctx=plan if phase=='admission'or(phase=='cleanup'and receipt['boundaryContext']is None)else(receipt if phase=='resume'else receipt['boundaryContext'])
            increment=cu(receipt['segmentBookedCu'])if phase=='cleanup'else 0
            for column,key in [('granted_cu','baselineGlobalGrantedCu'),('background_granted_cu','baselineBackgroundGrantedCu')]:
                minimum=cu(ctx[key])+increment
                checks.append('IF COALESCE((SELECT '+column+' FROM yunipals_market.rpc_compute_window WHERE scope='+SCOPE+' AND window_start='+q(day)+'::date),0)<'+str(minimum)+" THEN RAISE EXCEPTION 'continuation_existing_grants_decreased';END IF;")
        if phase in {'admission','resume'}:
            if at is not None and not moment(plan['start'])<=moment(at)<deadline:fail('single_dispatch_window_unavailable')
            checks.append('IF clock_timestamp()<'+q(plan['start'])+'::timestamptz OR clock_timestamp()>='+q(text_time(deadline))+"::timestamptz THEN RAISE EXCEPTION 'single_dispatch_window_unavailable';END IF;")
            doc=profile()
            checks += ['PERFORM 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id='+q(PROFILE)+' FOR SHARE OF p,c;',
                'IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id='+q(PROFILE)+' AND p.scope='+SCOPE+' AND p.enabled AND c.enabled AND c.coordinator_id='+q(COORDINATOR)+'::uuid AND p.manifest_hash='+q('0x'+digest(doc['manifest']))+' AND p.policy='+q(encoded(doc).decode())+'::jsonb AND p.expires_at='+q(PROFILE_EXPIRES)+'::timestamptz AND p.expires_at>='+q(plan['expires'])+"::timestamptz)THEN RAISE EXCEPTION 'exact_continuation_profile_unavailable';END IF;"]
        checks.append('IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id)WHERE p.scope='+SCOPE+" AND r.enabled AND r.expires_at>clock_timestamp())THEN RAISE EXCEPTION 'unexpected_active_paid_permit';END IF;")
    if phase=='inherited_utc':
        ids=','.join(q(row['permitId'])for row in rows)
        checks.append('IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN('+ids+"))THEN RAISE EXCEPTION 'never_admitted_requires_zero_new_rows';END IF;")
    if phase in {'cleanup','utc','boundary'}:rows=receipt['ownedPermits']
    for index,row in enumerate([]if phase=='inherited_utc'else rows):
        expiry=('expires_at IN('+q(plan['permits'][index]['expires'])+'::timestamptz,'+q(plan['permitsDay2'][index]['expires'])+'::timestamptz)')if phase=='revoke'else'expires_at='+q(row['expires'])+'::timestamptz'
        match=' AND '.join(['permit_id='+q(row['permitId']),'profile_id='+q(PROFILE),'chain_id='+str(row['chainId']),'from_block='+row['fromBlock'],'through_block='+row['throughBlock'],'maximum_cu='+row['maximumCu'],expiry])
        if phase=='admission':
            changes.append('INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at)VALUES('+','.join([q(row['permitId']),q(PROFILE),str(row['chainId']),row['fromBlock'],row['throughBlock'],row['maximumCu'],'true',q(row['expires'])+'::timestamptz'])+');')
        else:
            sealed=None if phase=='revoke'else(receipt['firstDayCleanup']['permitState']if phase=='resume'else receipt['permitState'])
            spent=' AND spent_cu>=0 AND spent_cu<=maximum_cu'if sealed is None else' AND spent_cu='+sealed['owned'][index]['spentCu']
            checks.append('IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE '+match+(''if phase=='revoke'else' AND NOT enabled')+spent+')THEN RAISE EXCEPTION '+q('exact_continuation_permit_changed')+';END IF;')
            if phase in {'revoke','resume'}:changes.append('UPDATE yunipals_market.unified_rpc_replay_permit SET enabled='+('false'if phase=='revoke'else'true,expires_at='+q(plan['permitsDay2'][index]['expires'])+'::timestamptz')+' WHERE '+match+';')
    if phase in {'admission','inherited_utc'}:
        for row in plan['setup']['priorClosedReceipt']['cleanupReceipt']['ownedPermits']:
            match=' AND '.join(['permit_id='+q(row['permitId']),"profile_id='0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3'",'chain_id='+str(row['chainId']),'from_block='+row['fromBlock'],'through_block='+row['throughBlock'],'maximum_cu='+row['maximumCu'],'expires_at='+q(row['expires'])+'::timestamptz'])
            checks.append('IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE '+match+" AND NOT enabled AND spent_cu>=0 AND spent_cu<=maximum_cu)THEN RAISE EXCEPTION 'retired_original_permit_changed';END IF;")
    if target_policy:changes += ['UPDATE yunipals_market.rpc_compute_budget SET daily_cu='+target_policy['globalDailyCu']+' WHERE scope='+SCOPE+';',"UPDATE yunipals_market.rpc_compute_allocation SET daily_cu="+target_policy['unifiedSourceDailyCu']+' WHERE scope='+SCOPE+" AND workload='unified_source';"]
    return '\n'.join(['-- PREPARED ONLY: external protected ACK, source, cache and timer gates required.','BEGIN;',"SET LOCAL search_path=pg_catalog;SET LOCAL standard_conforming_strings=on;SET LOCAL statement_timeout='3000ms';SET LOCAL lock_timeout='750ms';SET LOCAL idle_in_transaction_session_timeout='5000ms';",
        "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));",
        'LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;',
        'DO $continuation_guard$ BEGIN',*checks,*changes,'END $continuation_guard$;',"SELECT jsonb_build_object('planSha256',"+q(digest(plan))+",'phase',"+q(phase)+",'applied',true,'grantCountersReset',false);",'COMMIT;',''])

def snapshot(peer,day=None):
    if day is not None and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day):fail('fixed_UTC_snapshot_day_required')
    d="(clock_timestamp()AT TIME ZONE 'UTC')::date"if day is None else literal(day)+'::date'
    text="""SELECT jsonb_build_object('identity',jsonb_build_object('session',session_user,'current',current_user,'database',current_database(),'port',current_setting('port'),'local',inet_client_addr()IS NULL),
 'global',(SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled)FROM yunipals_market.rpc_compute_budget WHERE scope=SCOPE),
 'allocations',(SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text)ORDER BY workload)FROM yunipals_market.rpc_compute_allocation WHERE scope=SCOPE),
 'grants',jsonb_build_object('day',DAY::text,'global',COALESCE((SELECT granted_cu::text FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),'0'),'background',COALESCE((SELECT background_granted_cu::text FROM yunipals_market.rpc_compute_window WHERE scope=SCOPE AND window_start=DAY),'0'),'workloads',(SELECT jsonb_object_agg(a.workload,COALESCE(w.granted_cu,0)::text)FROM yunipals_market.rpc_compute_allocation a LEFT JOIN yunipals_market.rpc_compute_workload_window w ON w.scope=a.scope AND w.workload=a.workload AND w.window_start=DAY WHERE a.scope=SCOPE)),
 'profile',(SELECT jsonb_build_object('enabled',p.enabled,'expires',p.expires_at,'manifestHash',p.manifest_hash,'policy',p.policy,'coordinatorId',c.coordinator_id::text,'coordinatorEnabled',c.enabled)FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id=PROFILE AND p.scope=SCOPE))""".replace('SCOPE',SCOPE).replace('DAY',d).replace('PROFILE',literal(PROFILE))
    v=json.loads(peer('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout=\'3000ms\';SET LOCAL lock_timeout=\'750ms\';SET LOCAL search_path=pg_catalog;\n'+text+';ROLLBACK;'))
    if v.pop('identity')!={'session':'postgres','current':'postgres','database':'yunipals_market_production','port':'15438','local':True}:fail('fixed_market_peer_identity_required')
    p=v.pop('profile');doc=profile()
    if(p['enabled']is not True or p['coordinatorEnabled']is not True or p['coordinatorId']!=COORDINATOR or p['policy']!=doc or p['manifestHash']!='0x'+digest(doc['manifest'])or moment(p['expires'].replace('+00:00','Z'))!=moment(PROFILE_EXPIRES)):fail('exact_registered_normal_profile_required')
    v.update(scope='yunipals-opensea',profileId=PROFILE,profileExpiresAt=PROFILE_EXPIRES);policy(v);return v
