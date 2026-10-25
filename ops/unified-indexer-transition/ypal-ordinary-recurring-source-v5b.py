#!/usr/bin/env python3
"""Readonly ordinary managed source leaf for a distinct V5 recurring epoch.

The lifecycle/foundation ACKs are actual inputs, never predetermined future
values. Framework readiness is observed, not canonical reader acceptance.
"""
import hashlib
import json
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ypal-ordinary-recurring-source-v5b'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
MANAGED = OPS / 'ypal-ordinary-managed-handover-v2.py'
MANAGED_SHA = 'd5a368e8d0663970db7a54af26f65556ff02f935b4187ee9bff9485eab26851c'
FOUNDATION_SHA = '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199'
VIEW = OPS / 'ypal-ordinary-readview-v5.py'
VIEW_SHA = '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2'
READ_SCHEMA = 'yunipals_ownership_4e77f52b_v5'
READ_IDENTITY = '0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab'
DATA = {'sourceRelease':'0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
        'manifestHash':'0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
        'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7'}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) and value!='0'*64


def module(path, digest):
    for entry in [*path.parents,path]:
        row=entry.lstat()
        need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode&0o022,
             'protected_fixed_recurring_source_component_required')
    before=path.lstat();raw=path.read_bytes()
    identity=lambda row:tuple(getattr(row,key) for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and len(raw)<=200000 and sha(raw)==digest and
         identity(before)==identity(path.lstat()),'same_pinned_recurring_source_bytes_required')
    value=types.ModuleType('ordinary_recurring_'+path.stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__)
    need(identity(before)==identity(path.lstat()) and sha(path.read_bytes())==digest,'source_component_changed_during_load')
    return value


def refs_checked(refs):
    need(type(refs)is dict and set(refs)=={'lifecycleResultSha256','foundationInputSha256','readviewCreatedSha256'} and
         all(pin(value) for value in refs.values()),'actual_lifecycle_input_and_created_V5_receipt_refs_required')
    return refs


def components(refs):
    refs_checked(refs);code=module(MANAGED,MANAGED_SHA)
    need(code.FOUNDATION_SHA==FOUNDATION_SHA,'same_reviewed_ordinary_managed_foundation_required')
    owner=code.Owner(refs['foundationInputSha256']);view=module(VIEW,VIEW_SHA)
    return code,owner,view


def acknowledged(code, owner, refs):
    result=owner.m.document(code.BASE/'result.json',refs['lifecycleResultSha256'])
    need(all(result[key]==value for key,value in owner.envelope().items()) and result['completed'] is True and
         result['operatorSha256']==MANAGED_SHA and result['foundationInputSha256']==refs['foundationInputSha256'] and
         result['operationSha256']==owner.digest('operation.json') and not owner.has('inverse-intent.json'),
         'actual_uninversed_managed_lifecycle_chain_required')
    return result


def terminal(code, owner, refs, result):
    """No active-only foundation predicate and no adoption of an unknown epoch."""
    op=owner.operation();native=owner.stable(op);owner.installed()
    recorded=result['managedEpoch'];state=owner.h.state(code.PARENT)
    need(state['InvocationID']==recorded['unit']['InvocationID'] and
         state['ExecMainStartTimestampMonotonic']==recorded['unit']['ExecMainStartTimestampMonotonic'] and
         state['NRestarts']==recorded['unit']['NRestarts'] and state['MainPID']==state['ControlPID']=='0' and
         state['Job'] in {'','0'} and state['ActiveState'] in {'inactive','failed'} and owner.h.actor(code.PARENT,True) is None,
         'only_exact_acknowledged_terminal_managed_epoch_allowed')
    owner.known_gone(recorded);owner.managed_known_gone();owner.h.managed_settings()
    sessions=owner.terminal_backends()
    foundation=owner.foundation.record('result.json',result['foundationReceiptSha256'])
    owner.o.h.r.recovery_floor(foundation['nativeAtAcknowledgement'],native)
    binding=foundation['binding']
    need(all(binding[key]==value for key,value in DATA.items()) and native['schemaOid']==DATA['schemaOid'] and
         native['tables']==binding['nativeTables'] and len(native['tables'])==44 and native['cache']==binding['syncCache'] and
         native['app']['build_id']==DATA['buildId'],'same_native44_build_and_cache_after_terminal_epoch_required')
    # Freeze terminal identity around the potentially slow kernel/catalog reads.
    owner.stable(op);owner.installed();owner.known_gone(recorded)
    need(owner.h.state(code.PARENT)==state and owner.h.actor(code.PARENT,True) is None,
         'terminal_managed_epoch_changed_during_readonly_proof')
    return {**DATA,'nativeTables':native['tables'],'sourceState':'owned-terminal','currentManagedEpoch':recorded,
            'sourceKernelActors':{},'knownManagedProcessesGone':True,'remainingKernelOwnership':sessions,
            'currentWriterQualified':False,'sourceReadinessQualified':False,'terminalInverseOnly':True}


def validate_source_phase(refs, inverse=False):
    need(type(inverse)is bool,'explicit_source_phase_required')
    code,owner,view=components(refs);result=acknowledged(code,owner,refs)
    created=view.data_current(refs['readviewCreatedSha256'])
    need(created['validated'] is created['readviewDataOnly'] is True and created['receiptSha256']==refs['readviewCreatedSha256'] and
         created['readSchema']==READ_SCHEMA and created['readIdentity']==READ_IDENTITY and
         created['sourceActorQualified'] is created['currentRoleGraphQualified'] is False,
         'actual_V5_created_objects_only_not_role_or_source_authority_required')
    if owner.h.actor(code.PARENT,True) is None:
        need(inverse,'terminal_managed_source_cannot_authorize_recurring_cycle')
        value=terminal(code,owner,refs,result)
    else:
        value=owner.current(refs['lifecycleResultSha256'])
        need(value['validated'] is value['currentWriterQualified'] is value['managedInstallationQualified'] is True and
             value['lifecycleProducerSha256']==MANAGED_SHA and value['operatorSha256']==FOUNDATION_SHA and
             value['lifecycleReceiptSha256']==refs['lifecycleResultSha256'] and value['inputSha256']==refs['foundationInputSha256'] and
             value['currentManagedEpoch']==result['managedEpoch'] and all(value[key]==expected for key,expected in DATA.items()) and
             len(value['nativeTables'])==44 and type(value['sourceReadinessQualified'])is bool,
             'same_actual_lifecycle_and_foundation_current_epoch_required')
        need(inverse or value['sourceReadinessQualified'],'framework_must_be_ready_for_forward_recurring_generation')
        value={key:value[key] for key in [*DATA,'nativeTables','currentManagedEpoch','sourceKernelActors','currentWriterQualified','sourceReadinessQualified']}
        value.update(sourceState='acknowledged-active',terminalInverseOnly=False)
    need(view.data_current(refs['readviewCreatedSha256'])==created,'V5_object_identity_changed_during_source_capture')
    acknowledged(code,owner,refs)
    last=owner.h.actor(code.PARENT,True)
    if value['terminalInverseOnly']:
        state=owner.h.state(code.PARENT)
        need(last is None and all(state[key]==result['managedEpoch']['unit'][key] for key in
             ['InvocationID','ExecMainStartTimestampMonotonic','NRestarts']) and
             state['MainPID']==state['ControlPID']=='0' and state['Job'] in {'','0'} and state['ActiveState'] in {'inactive','failed'},
             'terminal_epoch_replaced_after_V5_object_capture')
        owner.known_gone(result['managedEpoch'])
    else:
        need(last is not None and owner.f.canonical_actor(last)==result['managedEpoch'],
             'managed_epoch_replaced_after_V5_object_capture')
    return {**value,'format':FORMAT,'validated':True,'receiptSha256':refs['lifecycleResultSha256'],'operatorSha256':MANAGED_SHA,
            'operationSha256':result['operationSha256'],'currentEpochReceiptSha256':result['foundationReceiptSha256'],
            'foundationInputSha256':refs['foundationInputSha256'],'readviewCreatedSha256':refs['readviewCreatedSha256'],
            'readSchema':READ_SCHEMA,'readIdentity':READ_IDENTITY,'readviewDataSha256':created['dataIdentitySha256'],
            'inverseOnly':inverse,'historicalStandaloneActorClaimedCurrent':False,'currentCanonicalCoverageQualified':False,
            'financialAuthorityQualified':False,'consumerOrArenaAuthorityQualified':False,'currentRoleGraphQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}


if __name__=='__main__':
    print(json.dumps({'format':FORMAT,'sourceOnly':True,'contextConstructed':False,'currentWriterQualified':False,
                      'workerActivationQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
