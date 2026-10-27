#!/usr/bin/env python3
"""Bounded read-only scheduling observation; confers no timing/SQL authority."""
import copy
import json
import time
import types

FORMAT='root-CONT5-native-approval-renewal-wait-v1'
MAXIMUM_SAMPLES=90
MAXIMUM_NANOSECONDS=90_000_000_000
MINIMUM_REMAINING_NANOSECONDS=87_000_000_000
MAXIMUM_AGE_NANOSECONDS=2_000_000_000


def need(value,code):
    if not value:raise RuntimeError(code)

def wait_for_native_approval_renewal(authority,host,observations):
    """Call after heavy work and outside the SDK/DDL lock, before qualification.

    The caller authenticates its actual CONT5 authority and retains this fresh
    list privately even on failure. Every sample invokes the complete original
    approval_snapshot; an exception propagates immediately without query retry.
    The original qualifier performs all of its later checks independently.
    """
    need(type(observations)is list and not observations,'fresh_private_approval_scheduling_observation_list_required')
    original=authority.approval_snapshot;cache=host.cache
    need(type(original)is types.FunctionType and cache.continuation_authority is authority and
        authority.FORMAT=='yunipals-ypal-ordinary-cache-continuation-authority-v5'and
        authority.TTL_NS==90_000_000_000 and authority.COMMIT_RESERVE_NS==5_000_000_000,
        'same_actual_CONT5_Host_and_original_approval_snapshot_required')
    started=time.monotonic_ns();deadline=started+MAXIMUM_NANOSECONDS;first=None;previous=None
    for index in range(MAXIMUM_SAMPLES):
        before=time.monotonic_ns()
        need(started<=before<deadline,'bounded_native_approval_renewal_wait_deadline_expired')
        need(authority.approval_snapshot is original and host.cache is cache and cache.continuation_authority is authority,
            'same_original_approval_snapshot_and_Host_during_scheduling_wait_required')
        row={'sample':index+1,'beforeMonotonicNanoseconds':before,'returned':False,
            'schedulingOnly':True,'SQLApprovalAuthority':False,'timingQualificationClaimed':False}
        observations.append(row)
        try:gate=original(host)
        except BaseException as error:
            row.update({'errorClass':type(error).__name__,'afterMonotonicNanoseconds':time.monotonic_ns(),
                'queryOrPredicateRetried':False})
            raise
        after=time.monotonic_ns();row.update({'returned':True,'afterMonotonicNanoseconds':after,'actualApprovalSnapshot':copy.deepcopy(gate)})
        need(before<=after<deadline,'bounded_native_approval_renewal_wait_expired_after_snapshot')
        need(authority.approval_snapshot is original and host.cache is cache and cache.continuation_authority is authority,
            'same_original_approval_snapshot_and_Host_after_scheduling_query_required')
        need(gate['format']==authority.FORMAT+'-approval'and gate['ttlNanoseconds']==90_000_000_000 and
            gate['officialApprovalRefreshedByThisGate']is False and
            gate['databaseWrites']==gate['serviceActions']==gate['providerCalls']==0 and
            all(type(gate[key])is int for key in ['ageNanoseconds','remainingNanoseconds','capturedMonotonicNanoseconds','queryNanoseconds'])and
            0<=gate['ageNanoseconds']<90_000_000_000 and 0<=gate['queryNanoseconds']and
            before<=gate['capturedMonotonicNanoseconds']<=after,
            'actual_complete_original_approval_snapshot_not_synthetic_scheduling_gate_required')
        checked=int(gate['snapshot']['checkedUs'])
        if first is None:first=checked
        need(checked>=first and(previous is None or checked>=previous),'native_approval_checked_time_cannot_move_backwards')
        previous=checked
        remaining=gate['remainingNanoseconds']-(after-gate['capturedMonotonicNanoseconds'])
        row.update({'checkedUs':str(checked),'strictlyAdvancedFromInitial':checked>first,
            'remainingAfterObservationNanoseconds':remaining})
        accepted=checked>first and gate['ageNanoseconds']<=MAXIMUM_AGE_NANOSECONDS and remaining>=MINIMUM_REMAINING_NANOSECONDS
        row['schedulingThresholdsSatisfied']=accepted
        if accepted:
            final=time.monotonic_ns();remaining=gate['remainingNanoseconds']-(final-gate['capturedMonotonicNanoseconds'])
            need(after<=final<deadline,'bounded_native_approval_renewal_wait_expired_before_return')
            row['remainingBeforeReturnNanoseconds']=remaining
            if remaining>=MINIMUM_REMAINING_NANOSECONDS:
                return {'format':FORMAT,'completed':True,'firstCheckedUs':str(first),'selectedCheckedUs':str(checked),
                    'sampleCount':len(observations),'elapsedNanoseconds':final-started,'maximumSamples':MAXIMUM_SAMPLES,
                    'maximumNanoseconds':MAXIMUM_NANOSECONDS,'minimumRemainingNanoseconds':MINIMUM_REMAINING_NANOSECONDS,
                    'maximumAgeNanoseconds':MAXIMUM_AGE_NANOSECONDS,'observations':copy.deepcopy(observations),
                    'schedulingOnly':True,'genuineNativeWorkerRenewalObserved':True,'actualHeldCallbackQualified':False,
                    'SQLApprovalAuthority':False,'sourceOrMetadataCurrentQualified':False,'timingQualificationClaimed':False,
                    'approvalClockReset':False,'queryOrPredicateRetried':False,'effectsRetried':False,
                    'databaseWrites':0,'serviceActions':0,'providerCalls':0}
            row['schedulingThresholdsSatisfied']=False
        if index+1==MAXIMUM_SAMPLES:raise RuntimeError('bounded_native_approval_renewal_sample_limit_exhausted')
        now=time.monotonic_ns();need(after<=now<deadline,'bounded_native_approval_renewal_wait_expired_before_sleep')
        time.sleep(min(1.0,(deadline-now)/1_000_000_000))
    raise RuntimeError('bounded_native_approval_renewal_wait_ended_without_observed_renewal')

if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'SQLApprovalAuthority':False,
    'timingQualificationClaimed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
