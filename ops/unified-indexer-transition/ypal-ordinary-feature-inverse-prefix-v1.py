#!/usr/bin/env python3
"""Owned feature inverse actor prefixes; no combined-source authority."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shlex

FORMAT='yunipals-ordinary-feature-inverse-prefix-v1'
FEATURE='ypal-ordinary-feature-handover-accept-v1.py'
FEATURE_SHA='d5d1614372bcbd0008806f5378c6085c56f95d516608493ee9f318b5cc5856b1'


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()


def intent(owner,b,name):
    value=owner.get(name+'-intent.json');op=owner.operation()
    need(value['format']==b.FORMAT and value['operatorSha256']==op['operatorSha256']==FEATURE_SHA and
         value['bootId']==b.boot() and value['operationSha256']==b.sha(b.protected(b.BASE/'operation.json')) and
         type(value['monotonicUs'])is int and value['monotonicUs']>0 and value['automaticRetryAllowed']is False,
         'actual_same_boot_operation_and_producer_feature_inverse_intent_required')
    if (b.BASE/(name+'-result.json')).exists():owner.phase(name)
    return value


def old_process_gone(pid,ticks):
    path=Path('/proc')/str(int(pid))/'stat'
    try:raw=path.read_text()
    except (FileNotFoundError,ProcessLookupError):return
    need(int(raw[raw.rfind(')')+2:].split()[19])!=int(ticks),'owned_feature_API_process_still_alive_after_stop')


def inverse_review(owner,b,op):
    value=owner.get('inverse-review.json')
    keys=['operationSha256','switchReceiptSha256','apiProof','retired','sourceProof']
    need(value['operationSha256']==b.sha(b.protected(b.BASE/'operation.json')) and
         value['switchReceiptSha256']==b.sha(b.protected(b.BASE/'switch-result.json')) and
         value['reviewHash']==b.sha(b.encoded({key:value[key]for key in keys})) and
         value['retired']is True and value['sourceProof']=={'terminal':True,'actor':None} and
         type(value['lastFeatureCursor'])is int and value['lastFeatureCursor']>=0,
         'actual_original_retired_feature_inverse_review_required')
    return value


def retirement(h,owner,b,op,retirement_sha):
    value=b.document(b.BASE/'retirement-result.json',retirement_sha);review=owner.get('retirement-review.json')
    recorded=review['binding']
    need(value['format']==b.FORMAT and value['operatorSha256']==op['operatorSha256']==FEATURE_SHA and
         value['operationSha256']==b.sha(b.protected(b.BASE/'operation.json')) and value['bootId']==b.boot() and
         value['retired']is value['allActivationPathsAbsent']is value['nativeSchemasAndReadsRetained']is True and
         value['switchReceiptSha256']==b.sha(b.protected(b.BASE/'switch-result.json'))==recorded['switchReceiptSha256'] and
         review['reviewHash']==b.sha(b.encoded(recorded)) and value['freshEvent']==recorded['freshEvent'] and
         value['postEventParitySha256']==recorded['paritySha256'],
         'actual_original_feature_retirement_receipt_review_and_real_postevent_parity_chain_required')
    captured=b.document(h.parity.capture_path(recorded['parity']['captureId']),value['postEventParitySha256'])
    h.parity.validate_receipt(captured)
    need(captured['boundary']>=value['freshEvent']['blockNumber'], 'original_complete_eight_table_capture_must_cover_real_retirement_event')
    stop=owner.phase('retire-source-stop')[1];disabled=owner.phase('retire-source-boot')[1]
    need(stop=={'terminal':True,'allRemainingWriterBackendsKernelOwnedByCombined':True} and disabled=={
        'disabled':True,'bootArchive':str(b.BASE/'temporary-source.boot.original'),'originalInodeRetained':True},
        'genuine_original_temporary_source_stop_and_owned_boot_archive_ACKs_required')
    return value


def boot_prefix(h,owner,b,op):
    retired=owner.get('retirement-review.json')['binding']['boot']
    need(retired==op['sourceBoot'],'same_original_feature_source_boot_in_retirement_and_operation_required')
    archived=b.BASE/'temporary-source.boot.original';live=os.path.lexists(b.BOOT);held=os.path.lexists(archived)
    started=(b.BASE/'inverse-source-boot-intent.json').exists()
    if started:intent(owner,b,'inverse-source-boot')
    need(live!=held,'one_actual_original_temporary_source_boot_inode_location_required')
    if live:
        need(started and b.boot_record()==retired,'only_owned_inverse_boot_move_can_restore_original_inode')
        if (b.BASE/'inverse-source-boot-result.json').exists():
            need(owner.phase('inverse-source-boot')[1]==retired,'same_original_boot_inode_in_owned_restore_ACK_required')
            h.source_activation()
    else:
        need(not (b.BASE/'inverse-source-boot-result.json').exists() and b.link_record(archived)==retired,
             'unrestored_original_boot_must_remain_at_exact_archived_inode')
        h.source_activation(True)
    state=h.state(b.SOURCE)
    fields=['RequiredBy','UpheldBy','TriggeredBy','Triggers','PartOf']
    need(all(not state.get(key)for key in fields) and state.get('WantedBy')in({'','multi-user.target'}if live else{'',None}),
         'only_owned_temporary_boot_reload_prefix_may_change_activation')
    paths=[]
    for directory in ['/etc/systemd/system','/run/systemd/system']:
        for path in Path(directory).glob('*/*'):
            if path.name==b.SOURCE or path.is_symlink()and path.resolve(strict=False)==Path(state['FragmentPath']):paths.append(str(path))
    need(sorted(paths)==([str(b.BOOT)]if live else[]),'all_temporary_source_activation_paths_must_belong_to_owned_boot_prefix')
    return {'restored':live,'acknowledged':(b.BASE/'inverse-source-boot-result.json').exists(),'boot':retired}


def files_prefix(h,owner,b):
    h.old_inputs();facts={}
    loaded=(b.BASE/'inverse-load-original-overlay-result.json').exists()
    if (b.BASE/'inverse-load-original-overlay-intent.json').exists():intent(owner,b,'inverse-load-original-overlay')
    for path in [*b.DROPS.values(),b.SELECTOR]:
        name='inverse-remove-'+b.sha(str(path).encode())[:12];exists=os.path.lexists(path)
        published=owner.get('published-'+b.sha(str(path).encode())[:12]+'.json')
        attempted=(b.BASE/(name+'-intent.json')).exists()
        if attempted:intent(owner,b,name)
        if exists:
            need(not (b.BASE/(name+'-result.json')).exists(),'owned_removed_feature_file_cannot_reappear')
            b.owned_file(path,published)
        else:
            need(attempted,'missing_feature_file_requires_exact_owned_unlink_intent')
            if (b.BASE/(name+'-result.json')).exists():
                need(owner.phase(name)[1]=={'removed':str(path)},'same_owned_feature_unlink_ACK_required')
        facts[str(path)]={'present':exists,'published':published,'unlinkIntent':attempted,
                          'unlinkAcknowledged':(b.BASE/(name+'-result.json')).exists()}
    for unit,digest in h.reader.UNIT_PINS.items():
        state=h.state(unit);path=Path('/etc/systemd/system')/unit
        original=[str(h.reader.DROPS[unit])]if unit in h.reader.DROPS else[]
        selected=original+([str(b.DROPS[unit])]if unit in b.DROPS else[])
        need(state['FragmentPath']==str(path) and b.sha(b.protected(path))==digest and
             state['DropInPaths'].split()in([original]if loaded else[original,selected]) and
             (unit==b.TIMER or state['User']==state['Group']==b.ROLE),
             'only_exact_original_or_owned_feature_loaded_definition_prefix_required')
        if unit==b.API:need(state['UnitFileState']=='enabled'and state['WantedBy']=='multi-user.target',
            'original_feature_API_boot_authority_must_remain_exact_during_inverse')
        if unit!=b.TIMER:
            args=[shlex.split(line.split('=',1)[1])for line in b.protected(path).decode().splitlines()if line.startswith('ExecStart=')]
            need(args==[shlex.split(value)for value in re.findall(r'argv\[\]=(.*?)\s+;',state['ExecStart'])]and len(args)==1,
                 'same_literal_original_feature_commands_before_every_inverse_manager_boundary_required')
            environments=[]
            for definition in[path,*map(Path,state['DropInPaths'].split())]:
                content=b.DROP_BYTES if definition in b.DROPS.values()and not os.path.lexists(definition)else b.protected(definition)
                if definition in b.DROPS.values():
                    need(b.sha(content)==facts[str(definition)]['published']['sha256'],'same_owned_feature_drop_bytes_even_during_partial_unlink_required')
                for line in content.decode().splitlines():
                    if not line.startswith('EnvironmentFile='):continue
                    name=line.split('=',1)[1].strip()
                    if not name:environments=[];continue
                    optional=name.startswith('-');name=name.lstrip('-')
                    need(name.startswith('/')and not any(value.isspace()for value in name)and
                         not any(value in name for value in['%','*','?','[','"',"'"]),
                         'literal_original_or_owned_feature_environment_file_declaration_required')
                    environments.append([name,optional])
            obj='/org/freedesktop/systemd1/unit/'+''.join(value if value.isalnum()else'_'+format(ord(value),'02x')for value in unit)
            actual=json.loads(h.sdk.command(['/usr/bin/busctl','--json=short','get-property','org.freedesktop.systemd1',obj,
                'org.freedesktop.systemd1.Service','EnvironmentFiles'],timeout=8))
            need(actual=={'type':'a(sb)','data':environments},'exact_original_private_and_owned_selector_loaded_environment_order_required')
    for digest,name in[(h.reader.API_SHA,'booster-api.mjs'),(h.reader.QUEUE_SHA,'booster-artwork-sync.mjs')]:
        need(b.sha(b.protected(Path('/opt/yunipals-unified/booster-api-releases')/digest/name))==digest,
             'same_actual_retained_feature_API_and_artwork_queue_program_bytes_required')
    if loaded:need(all(not value['present']for value in facts.values()),'original_feature_overlay_load_requires_all_owned_files_removed')
    return facts


def capture(h,owner,b,retirement_sha):
    """An external boundary accepts active restarts only with actual phase ACKs."""
    need(Path(b.__file__).name==FEATURE and b.sha(b.protected(Path(b.__file__)))==FEATURE_SHA and h.inverse_mode is True,
         'exact_actual_accept_feature_business_namespace_and_inverse_context_required')
    op=owner.operation();retirement(h,owner,b,op,retirement_sha);review=inverse_review(owner,b,op)
    # The original static proof checks the exact temporary unit/public inodes,
    # program/private inputs and loaded mounts without source actor assumptions.
    h.helpers.source_static(h)
    boot=boot_prefix(h,owner,b,op);files=files_prefix(h,owner,b)
    source_name='inverse-source-start';source_started=(b.BASE/(source_name+'-result.json')).exists()
    if (b.BASE/(source_name+'-intent.json')).exists():intent(owner,b,source_name)
    if source_started:
        need(boot['restored']is boot['acknowledged']is True,'temporary_source_start_requires_actual_owned_boot_restore_ACK')
        acknowledged=owner.phase(source_name)[1];temporary=h.source_actor(acknowledged)
        sessions=h.helpers.heartbeat_current(h,temporary['sdkActor'])
    else:
        h.terminal(b.SOURCE);h.static.gone(op['source']['sdkActor']['processes']);temporary=None;sessions=None
    api_started=(b.BASE/'inverse-start-original-api-result.json').exists()
    api_stopped=(b.BASE/'inverse-stop-api-result.json').exists()
    for name in ['inverse-stop-api','inverse-start-original-api']:
        if (b.BASE/(name+'-intent.json')).exists():intent(owner,b,name)
    if api_started:
        need(api_stopped and source_started,'restored_original_API_requires_owned_source_start_and_native_API_stop_ACKs')
        api=h.actor(False);need(api==owner.phase('inverse-start-original-api')[1],'same_acknowledged_restored_original_feature_API_required')
        api_phase='restored-original'
    elif api_stopped:
        h.terminal(b.API);previous=owner.get('switch-result.json')['api']
        old_process_gone(previous['MainPID'],previous['startTicks']);api=None;api_phase='owned-terminal'
    else:
        need(all(value['present']for value in files.values()),'active_native_feature_API_requires_all_owned_publications')
        started,_=owner.phase('start-new-api');api=h.inverse_api(owner.get('switch-result.json')['api'],started)
        if api['terminal']:
            need(review['api']is None and review['apiProof']['terminal']is True,
                 'native_API_stop_without_owned_stop_ACK_or_actual_terminal_review_cannot_qualify_external_prefix')
            api=None;api_phase='reviewed-terminal'
        else:api=api['actor'];api_phase='owned-native'
    inverse_sql=(b.BASE/'inverse-eight-selects-result.json').exists()
    if (b.BASE/'inverse-eight-selects-intent.json').exists():intent(owner,b,'inverse-eight-selects')
    catalog=h.catalog();need(catalog==op['catalogBefore'if inverse_sql else'catalogAfter'],
        'exact_feature_eight_SELECT_catalog_for_acknowledged_owned_inverse_phase_required')
    need(h.state(b.API)['MainPID']==('0'if api is None else api['MainPID']), 'feature_API_epoch_changed_during_owned_prefix_capture')
    return {'format':FORMAT,'producerSha256':sha(Path(__file__).read_bytes()),'validated':True,
        'featureOperatorSha256':FEATURE_SHA,'operationSha256':b.sha(b.protected(b.BASE/'operation.json')),
        'retirementSha256':retirement_sha,
        'inverseReviewSha256':b.sha(b.protected(b.BASE/'inverse-review.json')),
        'ownedDefinitionPrefixQualified':True,'temporarySourceActor':None if temporary is None else temporary['sdkActor'],
        'temporarySourceKernelSessions':sessions,'api':api,'apiPhase':api_phase,'bootPrefix':boot,'filePrefix':files,
        'catalogSha256':b.sha(b.encoded(catalog)),'ownedEightSELECTInverseAcknowledged':inverse_sql,
        'sourceActorQualified':False,'combinedSourceActorQualified':False,'readerAuthorityQualified':False,
        'originalWholeFeatureInversePassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def validate_current_phase(h,owner,b,retirement_sha):
    first=capture(h,owner,b,retirement_sha);last=capture(h,owner,b,retirement_sha)
    # Kernel observations may advance while the actual owned actor and files
    # remain fixed; all stable phase facts must be identical.
    stable=lambda value:{key:copy.deepcopy(item)for key,item in value.items()if key!='temporarySourceKernelSessions'}
    need(stable(first)==stable(last),'feature_owned_inverse_actor_private_or_file_prefix_changed_during_capture')
    return last


if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'sourceActorQualified':False,
    'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
