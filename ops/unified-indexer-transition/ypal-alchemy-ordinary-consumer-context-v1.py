#!/usr/bin/env python3
"""Read-only ordinary standalone writer intake and separate data/READ leaves.

No mutation owner is retargeted. Actual runtime/input/READ result hashes are
invocation inputs, never guessed future acknowledgements.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time
import types

FORMAT='yunipals-ypal-alchemy-ordinary-consumer-context-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
RUNTIME=OPS/'ypal-alchemy-ordinary-runtime-v1.py'
RUNTIME_SHA='3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'
STATIC=OPS/'ypal-restored-metadata-context-v1.py'
STATIC_SHA='fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
READ=OPS/'ypal-alchemy-read-admission-v1.py'
READ_SHA='c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a'
REGISTERED=Path('/var/backups/yunipals-ypal-combined-release-register-v1-20261023/registered.json')
REGISTERED_SHA='39b967846a4c84e320766075cd5c9ea478e29b85a38b6aa8306df95e94fe4cb7'
PROFILE=OPS/'ypal-combined-rpc-v1/profile.json'
PROFILE_SHA='c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'
READ_CREATED=Path('/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023/created.json')
READ_CREATED_SHA='17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3'
REGISTERED_SOURCE_ANCESTOR='c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
UNIT='yunipals-ypal-combined-source.service'
RETRY='all_required_backends_need_unique_positive_stable_kernel_attribution'
DATA={'sourceRelease':'0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
 'manifestHash':'0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
 'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7',
 'readSchema':'yunipals_ownership_4e77f52b_v4','readSchemaOid':'75994954',
 'readIdentity':'0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'}


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):
    need(isinstance(value,str)and re.fullmatch('[a-f0-9]{64}',value)and value!='0'*64,'actual_ordinary_intake_receipt_hash_required');return value

def protected(path,expected):
    path=Path(path);pin(expected)
    for item in [*path.parents,path]:
        st=item.lstat();need(st.st_uid==0 and not stat.S_ISLNK(st.st_mode)and not st.st_mode&0o022,'protected_ordinary_intake_input_required')
    before=path.lstat();identity=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<=2000000,'bounded_single_link_ordinary_intake_input_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        raw=os.read(fd,2000001)
        need(len(raw)==before.st_size and identity(before)==identity(os.fstat(fd))==identity(path.lstat())and sha(raw)==expected,
             'exact_ordinary_intake_input_hash_and_identity_required')
    finally:os.close(fd)
    return raw

def document(path,expected):return json.loads(protected(path,expected))
def module(path,expected):
    raw=protected(path,expected);need(len(raw)<=200000,'bounded_ordinary_intake_code_required')
    value=types.ModuleType('ordinary_intake_'+Path(path).stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__)
    need(protected(path,expected)==raw,'ordinary_intake_code_changed_during_evaluation');return value


def registration(query):
    registered=document(REGISTERED,REGISTERED_SHA);profile=document(PROFILE,PROFILE_SHA);created=document(READ_CREATED,READ_CREATED_SHA)
    need(registered['registered']is True and registered['releaseId']==DATA['sourceRelease']and registered['manifestHash']==DATA['manifestHash']and
         registered['sourceReceiptSha256']==REGISTERED_SOURCE_ANCESTOR and registered['activeReleaseChanged']is False and
         created['created']is True and created['selected']is False and created['readSchema']==DATA['readSchema']and
         created['readIdentity']==DATA['readIdentity']and created['sourceRelease']==DATA['sourceRelease']and created['target']['schemaOid']==DATA['readSchemaOid'],
         'actual_registered_and_created_data_ancestry_required')
    release,physical,read=DATA['sourceRelease'],DATA['schema'],DATA['readSchema']
    value=query("SELECT jsonb_build_object('registered',(SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash,'manifest',manifest) FROM yunipals_indexer_control.release WHERE id='"+release+"'),'sources',(SELECT jsonb_agg(jsonb_build_object('id',id,'chainId',chain_id,'manifestHash',manifest_hash,'definition',definition::jsonb) ORDER BY id) FROM "+physical+".indexer_source),'readSchemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='"+read+"'),'marker',(SELECT to_jsonb(m)-'created_at' FROM "+read+"._unified_read_release m WHERE singleton))")
    sources=sorted([{'id':row['id'],'chainId':row['chainId'],'manifestHash':DATA['manifestHash'],'definition':row}for row in profile['manifest']['sources']],key=lambda row:row['id'])
    need(len(sources)==12 and value=={'registered':{'id':release,'schema':physical,'build':DATA['buildId'],'manifestHash':DATA['manifestHash'],'manifest':profile['manifest']},
         'sources':sources,'readSchemaOid':DATA['readSchemaOid'],'marker':created['target']['marker']},
         'current_registered_manifest_twelve_sources_and_read_marker_required');return value


def query_components():
    """Current finite dataset queries, with historical SQL bodies labelled as such."""
    parts=module(STATIC,STATIC_SHA).query_components();native=parts['nativeIdentity']
    need(parts['sourceActorQualified']is parts['financialAuthorityQualified']is False and
         parts['historicalReadPlan']['missingCount']==143 and native['schemaOid']==DATA['schemaOid']and len(native['tables'])==44 and
         all(row['owner']=='73004621'and row['kind']=='r'for row in native['tables'].values()),'source_independent_fbb_native44_query_components_required')
    registered=registration(parts['readerHost'].query)
    return {'format':FORMAT+'-query-components','components':parts,'dataIdentity':{**DATA,'nativeTableIdentities':copy.deepcopy(native['tables']),
         'syncCacheIdentity':copy.deepcopy(native['cache']),'registeredDataSha256':sha(encoded(registered))},
         'historicalSqlScopeCount':143,'actualReadAdmissionQualified':False,'sourceActorQualified':False,'currentWriterQualified':False,
         'oldRestoredSourceContextPassed':False,'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def read_acknowledgement(result_sha):
    """Recorded c2da chain only: no current source/role claim or source constructor."""
    value=module(READ,READ_SHA).acknowledgement(pin(result_sha))
    need(value['validated']is value['immutableAdmissionOnly']is True and value['receiptSha256']==result_sha and value['operatorSha256']==READ_SHA and
         value['readEdgeCount']==143 and value['sourceActorQualified']is value['currentWriterQualified']is value['currentRoleGraphQualified']is False,
         'actual_current_READ_immutable_acknowledgement_required')
    initial=value['recordedSourceBinding']
    need(all(initial[k]==DATA[k]for k in DATA)and len(initial['nativeTableIdentities'])==44,'same_READ_recorded_logical_dataset_required')
    return value


def read_catalog_current(result_sha):
    read_acknowledgement(result_sha);value=module(READ,READ_SHA).validate_catalog_current(result_sha)
    need(value['validated']is value['catalogOnly']is True and value['receiptSha256']==result_sha and value['operatorSha256']==READ_SHA and
         value['readEdgeCount']==143 and value['sourceActorQualified']is value['sourceReadinessQualified']is value['financialAuthorityQualified']is False,
         'current_full_READ143_catalog_and_all_column_scope_required');return value


def current(runtime,result_sha,input_sha,retained_current,attempts):
    for attempt in range(3):
        try:
            value=runtime.validate_current_source(result_sha,input_sha,retained_current=retained_current)
            need(value['validated']is value['currentWriterQualified']is True and value['terminalInverseOnly']is False and
                 value['sourceState']=='acknowledged-active'and value['receiptSha']==result_sha and value['inputSha256']==input_sha and
                 value['operatorSha256']==RUNTIME_SHA and value['financialAuthorityQualified']is False and
                 all(value[k]==DATA[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId'])and
                 'currentManagedEpoch'not in value and set(value['sourceKernelActors'])=={UNIT}and
                 value['sourceKernelActors'][UNIT]==value['binding']['source']and value['binding']['source']['unit']['Id']==UNIT,
                 'actual_acknowledged_ordinary_standalone_source_required')
            need(value['bindingSha256']==sha(encoded(value['binding']))and value['routingMode']in{'paid','free'}and
                 value['managedHandoverAllowed']is(value['routingMode']=='free')and value['ordinaryFinancialClosed']is(value['routingMode']=='free'),
                 'honest_ordinary_binding_and_managed_financial_boundary_required')
            attempts.append({'attempt':attempt+1,'validated':True,'fixedCode':None});return value
        except RuntimeError as error:
            attempts.append({'attempt':attempt+1,'validated':False,'fixedCode':RETRY if str(error)==RETRY else'nonretryable_ordinary_source_refusal'})
            if str(error)!=RETRY or attempt==2:raise
            time.sleep(.25)


def observe_runtime(result_sha,input_sha,retained_current=None):
    pin(result_sha);pin(input_sha);runtime=module(RUNTIME,RUNTIME_SHA);before_attempts,after_attempts=[],[]
    first=current(runtime,result_sha,input_sha,retained_current,before_attempts);data=query_components();native=data['dataIdentity']
    need(first['nativeTables']==native['nativeTableIdentities']and first['binding']['nativeIdentity']=={
         'schemaOid':DATA['schemaOid'],'tables':native['nativeTableIdentities'],'cache':native['syncCacheIdentity'],'buildId':DATA['buildId']},
         'same_ordinary_epoch_and_current_native44_cache_identity_required')
    second=current(runtime,result_sha,input_sha,retained_current,after_attempts)
    need(first['binding']==second['binding'],'ordinary_source_changed_during_intake')
    binding={'format':FORMAT+'-runtime','validated':True,**native,'sourceKind':'standalone','sourceEpoch':'acknowledged-ordinary-alchemy',
         'runtimeProducerSha256':RUNTIME_SHA,'runtimeReceiptSha256':result_sha,'runtimeInputSha256':input_sha,'runtimeBinding':copy.deepcopy(second['binding']),
         'sourceKernelActors':copy.deepcopy(second['sourceKernelActors']),'poolMaximum':5,'routingMode':second['routingMode'],
         'chainRouting':copy.deepcopy(second['chainRouting']),'managedHandoverAllowed':second['managedHandoverAllowed'],
         'ordinaryFinancialClosed':second['ordinaryFinancialClosed'],'managedPaidRequiresSeparateFinancialOwnership':second['routingMode']=='paid',
         'currentWriterQualified':True,'intakeOnly':True,'forwardConsumerMutationQualified':False,'oldRestoredSourceContextPassed':False,
         'oldCatchupSourceContextPassed':False,'sourceReadinessQualified':False,'currentCanonicalCoverageQualified':False,'READ143AuthorityQualified':False,
         'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    return {'binding':binding,'bindingSha256':sha(encoded(binding)),'observation':{'before':first['observation'],'after':second['observation'],
         'sourceReadinessQualified':second['sourceReadinessQualified'],'currentLeafAttemptsBefore':before_attempts,'currentLeafAttemptsAfter':after_attempts}}


def validate_runtime(result_sha,input_sha,retained_current=None):return observe_runtime(result_sha,input_sha,retained_current)['binding']


def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group()
    g.add_argument('--runtime',nargs=2,metavar=('ACTUAL_RUNTIME_RESULT_SHA','ACTUAL_RUNTIME_INPUT_SHA'))
    g.add_argument('--query-components',action='store_true');g.add_argument('--read-ack');g.add_argument('--read-catalog');args=p.parse_args()
    if not any([args.runtime,args.query_components,args.read_ack,args.read_catalog]):
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'currentWriterQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_ordinary_intake_host_required')
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_ordinary_intake_expired'));signal.alarm(240)
    if args.runtime:
        value=observe_runtime(*args.runtime);b=value['binding'];out={'validated':True,'bindingSha256':value['bindingSha256'],'currentWriterQualified':True,
         'nativeRelations':len(b['nativeTableIdentities']),'sourceKind':b['sourceKind'],'routingMode':b['routingMode'],
         'managedHandoverAllowed':b['managedHandoverAllowed'],'ordinaryFinancialClosed':b['ordinaryFinancialClosed'],
         'currentLeafAttemptsBefore':value['observation']['currentLeafAttemptsBefore'],'currentLeafAttemptsAfter':value['observation']['currentLeafAttemptsAfter']}
    elif args.query_components:
        value=query_components();out={'validated':True,'currentWriterQualified':False,'nativeRelations':len(value['dataIdentity']['nativeTableIdentities']),
         'historicalSqlScopeCount':143,'registeredDataSha256':value['dataIdentity']['registeredDataSha256']}
    else:
        value=read_catalog_current(args.read_catalog)if args.read_catalog else read_acknowledgement(args.read_ack)
        out={'validated':True,'currentWriterQualified':False,'readEdgeCount':143,'catalogQualified':bool(value.get('catalogOnly')),'receiptSha256':value['receiptSha256']}
    print(json.dumps({'format':FORMAT,**out,'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'validated':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',code)else type(error).__name__,
         'databaseWrites':0,'serviceActions':0,'providerCalls':0}));raise SystemExit(1)
