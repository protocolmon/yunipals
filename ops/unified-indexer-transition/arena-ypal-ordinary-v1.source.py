#!/usr/bin/env python3
"""Actual ordinary standalone Arena source; no old restored/free epoch claim.

The physical Arena reader owns canonical point verification separately. This
leaf qualifies source identity, all native44 objects/cache, current mixed routes
and the existing ordinary financial policy, without creating or renewing it.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import types

FORMAT='yunipals-arena-ypal-ordinary-source-context-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
PINS={
 'arena-ypal-restored-v1.source.py':'68d1d2c91abc8e981c8ef19b7f4a2c7edf13bbba14ac3d2f7507da192adaf737',
 'ypal-alchemy-ordinary-consumer-context-v1.py':'5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986',
 'ypal-alchemy-ordinary-runtime-v1.py':'3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5',
 'ypal-alchemy-ordinary-financial-v1.py':'89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0'
}
UNIT='yunipals-ypal-combined-source.service'
ROUTING={'ethereum':'paid_primary','base':'paid_primary','polygon':'paid_primary','bnb':'paid_logs_free_blocks'}
RELEASE='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64


def module(name):
    path=OPS/name
    # The frozen source loader is a protected file/code reader; importing it has
    # no database, source, provider or manager effect.
    bootstrap=OPS/'arena-ypal-restored-v1.source.py'
    for p in [*bootstrap.parents,bootstrap]:
        st=p.lstat();need(st.st_uid==0 and not stat.S_ISLNK(st.st_mode)and not st.st_mode&0o022,'protected_source_loader_before_evaluation_required')
    first=bootstrap.lstat();raw=bootstrap.read_bytes()
    key=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink'])
    need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and len(raw)<200000 and key(first)==key(bootstrap.lstat())and sha(raw)==PINS[bootstrap.name],
         'exact_source_loader_before_evaluation_required')
    n=types.ModuleType('ordinary_Arena_source_loader');n.__file__=str(bootstrap)
    exec(compile(raw,str(bootstrap),'exec'),n.__dict__)
    n.module(bootstrap,PINS[bootstrap.name])
    return n.module(path,PINS[name])


def references(refs):
    need(type(refs)is dict and set(refs)=={'resultSha256','inputSha256'}and all(pin(v)for v in refs.values()),
         'actual_ordinary_source_result_and_input_required')
    return dict(refs)


def validate_current(refs,*,terminal_ok=False,retained_current=None):
    refs=references(refs);need(type(terminal_ok)is bool,'explicit_Arena_inverse_source_mode_required')
    i=module('ypal-alchemy-ordinary-consumer-context-v1.py');runtime=module('ypal-alchemy-ordinary-runtime-v1.py')
    parts=i.query_components();native=parts['components']['nativeIdentity']
    identity=module('arena-ypal-restored-v1.source.py').native_identity(native)
    terminal=False
    try:
        binding=i.validate_runtime(refs['resultSha256'],refs['inputSha256'],retained_current=retained_current)
    except RuntimeError:
        if not terminal_ok:raise
        terminal=True
    if terminal:
        value=runtime.validate_current_source(refs['resultSha256'],refs['inputSha256'],retained_current=retained_current,inverse=True)
        need(value['validated']is True and value['sourceState']=='owned-terminal'and value['terminalInverseOnly']is True and
             value['currentWriterQualified']is value['sourceActorQualified']is value['financialAuthorityQualified']is False and
             value['receiptSha']==refs['resultSha256']and value['inputSha256']==refs['inputSha256']and
             value['operatorSha256']==PINS['ypal-alchemy-ordinary-runtime-v1.py'],
             'actual_owned_ordinary_terminal_prefix_only_required')
        # The exact ordinary runtime verifies its own stopped journal, loaded
        # definitions, known PID epochs and residual positive shared-role map.
        terminal=True;actor=None;binding=copy.deepcopy(value);financial=None
    else:
        need(binding['validated']is binding['currentWriterQualified']is True and binding['sourceKind']=='standalone'and
             binding['runtimeProducerSha256']==PINS['ypal-alchemy-ordinary-runtime-v1.py']and
             binding['runtimeReceiptSha256']==refs['resultSha256']and binding['runtimeInputSha256']==refs['inputSha256']and
             binding['sourceRelease']==RELEASE and binding['nativeTableIdentities']==native['tables']and
             binding['syncCacheIdentity']==native['cache']and binding['poolMaximum']==5 and
             binding['sourceReadinessQualified']is binding['currentCanonicalCoverageQualified']is binding['financialAuthorityQualified']is False,
             'actual_ordinary_standalone_native44_cache_and_five_pool_required')
        need(binding['routingMode']in{'paid','free'}and binding['chainRouting']==(ROUTING if binding['routingMode']=='paid'else{c:'free_first'for c in ROUTING}),
             'exact_four_ordinary_routing_modes_required')
        need(set(binding['sourceKernelActors'])=={UNIT},'ordinary_source_actor_not_managed_parent_required')
        actor=copy.deepcopy(binding['sourceKernelActors'][UNIT]);terminal=False
        if binding['routingMode']=='paid':
            financial=module('ypal-alchemy-ordinary-financial-v1.py').validate_current(binding['runtimeBinding']['financialReceiptSha256'])
            need(financial['validated']is financial['financialQualified']is True and financial['sourceActorQualified']is False and
                 financial['receiptSha256']==binding['runtimeBinding']['financialReceiptSha256']and
                 financial['manifestHash']==identity['manifestHash']and len(financial['permits'])==4 and
                 financial['profileId']==binding['runtimeBinding']['profileId'],
                 'actual_current_ordinary_four_permits_and_unchanged_policy_required')
        else:financial={'ordinaryClosed':True,'disabledReceiptSha256':binding['runtimeBinding']['disabledReceiptSha256']}
        after=i.validate_runtime(refs['resultSha256'],refs['inputSha256'],retained_current=retained_current)
        need(after==binding,'ordinary_source_routes_or_financial_parent_changed_during_Arena_check')
    return {'format':FORMAT,'validated':True,**{k:identity[k]for k in ['manifestHash','schema','schemaOid','buildId']},
       'releaseId':RELEASE,'dataIdentity':identity,'source':actor,'sourceTerminal':terminal,'inverseOnly':terminal_ok,
       'sourceKind':'standalone','sourceActorQualified':not terminal,'currentWriterExclusivityQualified':not terminal,
       'sourceReceiptSha256':refs['resultSha256'],'sourceOperatorSha256':PINS['ypal-alchemy-ordinary-runtime-v1.py'],
       'sourceRuntimeInputSha256':refs['inputSha256'],'sourceRuntimeProofSha256':sha(encoded(binding)),
       'ordinaryFinancialProof':financial,'financialPolicyCurrent':financial is not None,'financialAuthorityQualified':False,
       'originalWholeValidationPassed':False,'nativeReadinessQualified':False,'currentCanonicalCoverageQualified':False,
       'oldRestoredEpochQualified':False,'oldFreeNineRouteValidatorPassed':False,'databaseWrites':0,'serviceChanges':0,'providerRequests':0}


if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'sourceActorQualified':False,'databaseWrites':0,'serviceChanges':0,'providerRequests':0},sort_keys=True))
