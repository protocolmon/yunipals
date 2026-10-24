#!/usr/bin/env python3
"""Explicit source context consuming a separately acknowledged current19212 RPC.

The RPC-only component is bound to root's actual v3 acknowledgement. It never
asserts that the historical proxy guard or a source-readiness gate passed.
"""
from pathlib import Path
import hashlib
import re
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
SOURCE_LEAF=OPS/'arena-ypal-native-v1.source.py'
SOURCE_LEAF_SHA='df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2'
QUALIFIER=OPS/'ypal-retained-proxy-current-v3.py'
QUALIFIER_SHA='80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf'
QUALIFICATION_RECEIPT_SHA='152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
QUALIFICATION_COMPONENT_SHA='57f0520e640ccd50743f02e0891bfb2ab3491e0368f698ea6d6f209d0d43c757'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def pin(value):return isinstance(value,str)and re.fullmatch('[a-f0-9]{64}',value)is not None
def sha(raw):return hashlib.sha256(raw).hexdigest()


def load():
    need(pin(QUALIFIER_SHA)and pin(QUALIFICATION_RECEIPT_SHA),'actual_frozen_19212_RPC_qualification_required_before_Arena_source_admission')
    # Bootstrap the existing protected code reader through the exact v1 leaf;
    # no retained module or context function is patched.
    import stat
    for path in [*SOURCE_LEAF.parents,SOURCE_LEAF]:
        info=path.lstat();need(info.st_uid==0 and not stat.S_ISLNK(info.st_mode)and not info.st_mode&0o022,'protected_retained_source_leaf_required')
    raw=SOURCE_LEAF.read_bytes();need(len(raw)<200000 and sha(raw)==SOURCE_LEAF_SHA,'exact_retained_source_leaf_required')
    leaf=types.ModuleType('retained_4e_source_identity');leaf.__file__=str(SOURCE_LEAF);exec(compile(raw,str(SOURCE_LEAF),'exec'),leaf.__dict__)
    leaf.protected(SOURCE_LEAF)
    raw=leaf.protected(QUALIFIER);need(sha(raw)==QUALIFIER_SHA,'exact_current_RPC_qualification_producer_required')
    q=types.ModuleType('qualified_current_19212_rpc');q.__file__=str(QUALIFIER);exec(compile(raw,str(QUALIFIER),'exec'),q.__dict__)
    return leaf,q


def validate_current(*,terminal_ok=False):
    leaf,q=load();proof,components=q.qualified_rpc_components(QUALIFICATION_RECEIPT_SHA)
    need(proof['format']=='yunipals-ypal-retained-proxy-current-v3'and proof['validated']is True and proof['receiptSha256']==QUALIFICATION_RECEIPT_SHA and proof['operatorSha256']==QUALIFIER_SHA and proof['currentRPCComponentSha256']==QUALIFICATION_COMPONENT_SHA and
         proof['rpcScopeOnly']is True and proof['freeOnly']is True and proof['paidAuthority']is False and proof['historicalWholeValidatorPassed']is False and
         proof['sourceActorQualified']is False and proof['temporaryYpalSourceAndApiQualified']is False and proof['sourceReadinessQualified']is False and
         all(proof[k]==0 for k in ['providerCalls','databaseWrites','serviceActions']),'actual_independent_current_RPC_component_required')
    s,h,op,ack=leaf.load()
    s.static_inputs(h);s.old_private_inputs(op)
    need(s.base_code()==op['sourceCode']and h.role()==op['sourceRole'],'same_combined_code_private_inputs_and_writer_role_required')
    h.old_terminal(op);h.preserved_old_native(op);s.exact_link(s.NEW_LINK,ack['newBoot'])
    # Reperform only static budget-capacity identity in addition to q's exact
    # current financial catalog/expiry/routes/boot/private-environment proof.
    route=h.m.route_owner;before=h.m.load('before.json');capacity=h.rpc.capacity_snapshot(h.m)
    need({k:capacity[k]for k in before['binding']['budgetCapacityIdentity']}==before['binding']['budgetCapacityIdentity'],'unchanged_budget_capacity_authority_required')
    actor=leaf.source_actor(s,h,op,ack,terminal_ok);native=leaf.native_identity(h,ack)
    return {'format':'yunipals-arena-ypal-source-context-v2','validated':True,'releaseId':leaf.RELEASE,'manifestHash':leaf.MANIFEST,'schema':leaf.SCHEMA,**native,**actor,
            'bootId':leaf.boot(),'financialExpiresAt':route.EXPIRY,'freeOnly':True,'paidAuthority':False,'permits':0,'financialWindowRenewed':False,
            'currentRPCQualification':{'file':str(q.BASE/'result.json'),'sha256':QUALIFICATION_RECEIPT_SHA,'operatorSha256':QUALIFIER_SHA,'componentSha256':proof['currentRPCComponentSha256']},
            'sourceReceiptSha256':leaf.SOURCE_ACK,'sourceOperationSha256':leaf.SOURCE_OP,'originalWholeValidationPassed':False,'nativeReadinessQualified':False,
            'databaseWrites':0,'serviceChanges':0,'providerRequests':0}
