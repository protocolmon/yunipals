#!/usr/bin/env python3
"""Finite four-chain financial model. Pure preparation; no connections/actions."""
import copy
import datetime
import hashlib
import json
import re

FORMAT='yunipals-ypal-alchemy-catchup-financial-v1'
SCOPE='yunipals-opensea'
PROFILE='0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'
MANIFEST='0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
PROFILE_FILE_SHA='c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'
DECODER_SHA='850f53b560c45a7bb3641d90277bdda723e1abdb0fc8a29ce38ec5530f3409ba'
RELEASE='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
ALLOWANCE=20000000
KNOWN_BOOKED_MINIMUM=4547000
ADDITIONAL=15000000
SECONDS=28800
PARTITION={1:1000000,56:9000000,137:2000000,8453:3000000}
MARGINS={1:7200,56:80000,137:30000,8453:30000}
ALLOCATIONS={'foreground':('foreground',150000),'incident':('foreground',50000),'order_projection':('background',400000),
             'sale':('background',200000),'source':('background',200000),'unified_evidence':('background',5000),'unified_source':('background',25000)}
TABLES=['opensea_request_budget','rpc_compute_budget','rpc_compute_allocation','rpc_compute_window',
        'rpc_compute_workload_window','unified_rpc_profile','unified_rpc_replay_permit']


def need(ok,code):
    if not ok:raise RuntimeError(code)
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def digest(value):return sha(encoded(value))
def pin(value):return isinstance(value,str)and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64
def number(value):
    need(isinstance(value,str)and re.fullmatch('0|[1-9][0-9]{0,17}',value),'literal_nonnegative_bounded_integer_string_required');return int(value)
def literal(value):return "'"+str(value).replace("'","''")+"'"
def day(milliseconds):return datetime.datetime.fromtimestamp(milliseconds/1000,datetime.timezone.utc).date().isoformat()
def next_utc(milliseconds):
    at=datetime.datetime.fromtimestamp(milliseconds/1000,datetime.timezone.utc)
    return int((at.replace(hour=0,minute=0,second=0,microsecond=0)+datetime.timedelta(days=1)).timestamp()*1000)


def snapshot_sql():
    tables=','.join(literal(name)for name in TABLES)
    return """SELECT jsonb_build_object(
      'identity',jsonb_build_object('database',current_database(),'user',current_user,'session',session_user,'port',current_setting('port'),'socket',inet_client_addr()IS NULL,'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),
      'clockMs',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
      'global',(SELECT jsonb_build_object('scope',scope,'enabled',enabled,'dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text)FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea'),
      'allocations',(SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text)ORDER BY workload)FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea'),
      'coordinator',(SELECT to_jsonb(c)FROM yunipals_market.opensea_request_budget c WHERE scope='yunipals-opensea'),
      'profiles',(SELECT jsonb_agg(to_jsonb(p)ORDER BY profile_id)FROM yunipals_market.unified_rpc_profile p WHERE scope='yunipals-opensea'),
      'permits',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',r.permit_id,'profileId',r.profile_id,'chainId',r.chain_id,'fromBlock',r.from_block::text,'throughBlock',r.through_block::text,'maximumCu',r.maximum_cu::text,'spentCu',r.spent_cu::text,'enabled',r.enabled,'expiresMs',floor(extract(epoch FROM r.expires_at)*1000)::bigint,'reviewedMs',floor(extract(epoch FROM r.reviewed_at)*1000)::bigint)ORDER BY r.permit_id)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id)WHERE p.scope='yunipals-opensea'),'[]'::jsonb),
      'windows',coalesce((SELECT jsonb_agg(jsonb_build_object('day',window_start::text,'grantedCu',granted_cu::text,'backgroundCu',background_granted_cu::text)ORDER BY window_start)FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'),'[]'::jsonb),
      'workloadWindows',coalesce((SELECT jsonb_agg(jsonb_build_object('day',window_start::text,'workload',workload,'grantedCu',granted_cu::text)ORDER BY window_start,workload)FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea'),'[]'::jsonb),
      'schemaCatalog',(SELECT jsonb_build_object('oid',oid::text,'owner',nspowner::text,'acl',nspacl::text)FROM pg_namespace WHERE nspname='yunipals_market'),
      'relationCatalog',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid::text,'name',c.relname,'kind',c.relkind,'owner',c.relowner::text,'acl',c.relacl::text,'columns',(SELECT jsonb_agg(jsonb_build_object('number',a.attnum,'name',a.attname,'type',a.atttypid::text,'notNull',a.attnotnull,'acl',a.attacl::text)ORDER BY a.attnum)FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_market'AND c.relname IN("""+tables+""")),
      'reservationFunction',(SELECT jsonb_build_object('oid',p.oid::text,'owner',p.proowner::text,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid))FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='yunipals_market'AND p.proname='reserve_unified_rpc_replay'))"""


def source_booked(snapshot,selected_day=None):
    return sum(number(row['grantedCu'])for row in snapshot['workloadWindows']if row['workload']=='unified_source'and(selected_day is None or row['day']==selected_day))


def static(snapshot):
    return {k:v for k,v in snapshot.items()if k not in{'clockMs','windows','workloadWindows'}}


def validate_ledger(snapshot):
    allocations={row['workload']:row for row in snapshot['allocations']};windows={row['day']:row for row in snapshot['windows']}
    work={(row['day'],row['workload']):row for row in snapshot['workloadWindows']}
    need(len(windows)==len(snapshot['windows'])and len(work)==len(snapshot['workloadWindows'])and
         all(re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}',d)and d<=day(snapshot['clockMs'])for d in windows)and
         all(d in windows and name in allocations for d,name in work),'unique_actual_nonfuture_budget_ledger_required')
    for date,row in windows.items():
        grant=sum(number(v['grantedCu'])for(d,name),v in work.items()if d==date)
        background=sum(number(v['grantedCu'])for(d,name),v in work.items()if d==date and allocations[name]['priority']=='background')
        need(number(row['grantedCu'])==grant and number(row['backgroundCu'])==background<=grant,
             'actual_global_background_and_workload_CU_conservation_required')


def baseline(snapshot,profile_document):
    validate_ledger(snapshot)
    ident=snapshot['identity']
    need(ident['database']=='yunipals_market_production'and ident['user']==ident['session']=='postgres'and ident['port']=='15438'and ident['socket']is True,
         'fixed_market_postgres_Unix_peer_required')
    need(snapshot['global']=={'scope':SCOPE,'enabled':True,'dailyCu':'1000000','foregroundReserveCu':'200000'},
         'original_one_million_global_and_200k_foreground_reserve_required')
    allocations={row['workload']:row for row in snapshot['allocations']}
    need(len(allocations)==len(snapshot['allocations'])and allocations=={name:{'workload':name,'priority':priority,'dailyCu':str(amount)}for name,(priority,amount)in ALLOCATIONS.items()},
         'exact_original_seven_allocations_including25k_source_required')
    for row in snapshot['allocations']:need(row['priority']in{'foreground','background'}and 0<number(row['dailyCu'])<=1000000000000,'finite_unchanged_allocation_policy_required')
    profile=[row for row in snapshot['profiles']if row['profile_id']==PROFILE]
    need(len(profile)==1 and profile[0]['scope']==SCOPE and profile[0]['manifest_hash']==MANIFEST and profile[0]['enabled']is True and
         profile[0]['policy']==profile_document and profile_document['scope']==SCOPE and
         snapshot['coordinator']['enabled']is True and str(snapshot['coordinator']['coordinator_id'])==profile[0]['policy']['coordinatorId'],
         'exact_enabled_ebc51_profile_manifest_and_coordinator_required')
    need({row['name']for row in snapshot['relationCatalog']}==set(TABLES)and len(snapshot['relationCatalog'])==7 and
         all(row['kind']=='r'for row in snapshot['relationCatalog'])and snapshot['schemaCatalog']and snapshot['reservationFunction'],
         'exact_existing_budget_relation_function_and_full_column_catalog_required')
    need(len(snapshot['permits'])<=128 and len(snapshot['windows'])<=64 and len(snapshot['workloadWindows'])<=2048 and
         not any(row['enabled']and row['expiresMs']>snapshot['clockMs']for row in snapshot['permits']),
         'bounded_financial_history_and_no_active_paid_permit_required')
    booked=source_booked(snapshot)
    need(KNOWN_BOOKED_MINIMUM<=booked and booked+ADDITIONAL<=ALLOWANCE and
         source_booked(snapshot,day(snapshot['clockMs']))<=25000,
         'original20M_conservative_booked_allowance_and_same_day_baseline_required')
    return profile[0]


def configured_minimums(profile_document):
    """Use only the unchanged profile's actually enabled source starts."""
    need(profile_document['scope']==SCOPE and profile_document['manifest']['ponderVersion']=='0.17.5',
         'existing_profile_and_official_Ponder_configuration_required')
    sources=profile_document['manifest']['sources'];need(isinstance(sources,list)and 1<=len(sources)<=64,'finite_actual_profile_sources_required')
    rows={chain:[]for chain in PARTITION}
    for source in sources:
        need(type(source['enabled'])is bool,'typed_manifest_source_enabled_required')
        if not source['enabled']:continue
        chain=source['chainId'];start=source['startBlock']
        need(type(chain)is int and chain in rows and isinstance(start,str)and re.fullmatch('0|[1-9][0-9]{0,11}',start),
             'literal_enabled_configured_source_start_required')
        rows[chain].append(int(start))
    need(all(rows.values()),'all_four_enabled_configured_chain_minima_required')
    return {chain:min(values)for chain,values in rows.items()}


def range_plan(value,clock,profile_document):
    observed=int(datetime.datetime.fromisoformat(value['observedAt'].replace('Z','+00:00')).timestamp()*1000)
    need(value['format']=='yunipals-alchemy-catchup-range-input-v1'and value['profileId']==PROFILE and value['releaseId']==RELEASE and
         value['manifestHash']==MANIFEST and value['schemaOid']=='75963410'and value['buildId']=='71e2a7f3b7'and
         pin(value['sourceActorSha256'])and 0<=clock-observed<=900000 and
         set(value['chains'])=={str(chain)for chain in PARTITION},'actual_fresh_four_chain_range_capture_required')
    rows={};minimums=configured_minimums(profile_document)
    for chain,maximum in PARTITION.items():
        row=value['chains'][str(chain)]
        need(set(row)=={'nativeCommittedBlock','syncCoveredBlock','headBlock','headTimestamp','marginBlocks'},'exact_native_sync_head_and_margin_shape_required')
        need(all(type(row[k])is int and 0<=row[k]<=1000000000000 for k in['nativeCommittedBlock','syncCoveredBlock','headBlock','marginBlocks']),
             'literal_finite_actual_block_integers_required')
        native,sync,head,margin=(row[k]for k in['nativeCommittedBlock','syncCoveredBlock','headBlock','marginBlocks'])
        first=max(0,min(native,sync)-512)
        need(first<=head and head-first<=2000000 and 0<margin<=MARGINS[chain]and
             type(row['headTimestamp'])is int and -2<=clock//1000-row['headTimestamp']<=900,
             'bounded_tail_range_recent_head_and_eight_hour_margin_required')
        need(minimums[chain]<=min(native,sync,head),'configured_start_must_precede_actual_native_sync_and_head')
        rows[chain]={'chainId':chain,'fromBlock':str(minimums[chain]),'throughBlock':str(head+margin),'maximumCu':str(maximum)}
    return rows


def complete_block(checkpoint,chain):
    """Pinned official decoder semantics; actual TypeScript equivalence tested."""
    need(isinstance(checkpoint,str)and re.fullmatch('[0-9]{75}',checkpoint),'official75_digit_checkpoint_required')
    if checkpoint=='0'*75:return None
    need(int(checkpoint[10:26])==chain,'official_checkpoint_chain_must_match')
    end=checkpoint[42:58]=='9'*16 and checkpoint[58]=='9'and checkpoint[59:75]=='9'*16
    value=int(checkpoint[26:42])-(0 if end else 1)
    return value if value>=0 else None


def validate_range_evidence(raw,ranges,decoder_raw):
    need(sha(decoder_raw)==DECODER_SHA and raw['format']=='yunipals-alchemy-range-actual-capture-v1'and
         raw['sourceActorSha256']==digest(raw['source'])==ranges['sourceActorSha256']and
         raw['schemaOid']==ranges['schemaOid']=='75963410'and raw['buildId']==ranges['buildId']=='71e2a7f3b7'and
         raw['restoreResultSha256']=='0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'and
         raw['observedAt']==ranges['observedAt']and raw['databaseWrites']==raw['serviceActions']==0 and
         raw['boundedProviderRPCRequests']==8 and len(raw['heads'])==4 and
         {v['chainId']for v in raw['heads']}==set(PARTITION)and set(raw['checkpoints'])=={str(c)for c in PARTITION},
         'actual_raw_capture_source_identity_and_exact_official_decoder_required')
    names={1:'mainnet',56:'bnb',137:'polygon',8453:'base'}
    expected={}
    for head in raw['heads']:
        chain=head['chainId'];point=complete_block(raw['checkpoints'][str(chain)]['latest'],chain)
        need(point is not None and re.fullmatch('0x[a-f0-9]{64}',head['headHash']),'actual_complete_native_boundary_and_head_hash_required')
        expected[str(chain)]={'nativeCommittedBlock':point,'syncCoveredBlock':raw['sync'][names[chain]],
            'headBlock':head['headBlock'],'headTimestamp':head['headTimestamp'],'marginBlocks':MARGINS[chain]}
    need(ranges['chains']==expected,'all_four_normalized_ranges_must_equal_actual_raw_native_sync_and_head_capture')
    return {'validated':True,'rawCanonicalSha256':digest(raw),'officialDecoderSha256':DECODER_SHA,
        'sourceActorQualified':False,'canonicalReadinessQualified':False,'providerCalls':0}


def plan(snapshot,ranges,range_sha,start_ms,profile_document):
    profile=baseline(snapshot,profile_document);need(pin(range_sha)and type(start_ms)is int and 0<=start_ms-snapshot['clockMs']<=300000,'actual_range_pin_and_near_future_start_required')
    expiry=int(datetime.datetime.fromisoformat(profile['expires_at'].replace('Z','+00:00')).timestamp()*1000)
    end=min(start_ms+SECONDS*1000,next_utc(start_ms)-900000,expiry)
    need(end-start_ms>=3600000,'at_least_one_hour_of_same_UTC_day_window_required')
    rows=range_plan(ranges,snapshot['clockMs'],profile_document);today=day(start_ms)
    need(today==day(snapshot['clockMs']),'single_UTC_day_window_only')
    value={'format':FORMAT+'-plan','profileId':PROFILE,'profileFileSha256':PROFILE_FILE_SHA,'manifestHash':MANIFEST,'rangeInputSha256':range_sha,'rangeBindingSha256':digest(ranges),
        'startMs':start_ms,'expiresMs':end,'nextUtcMs':next_utc(start_ms),'utcDrainGuardMilliseconds':900000,'grantDay':today,'maximumSeconds':SECONDS,
        'originalAllowanceCu':str(ALLOWANCE),'baselineAllDaysSourceBookedCu':str(source_booked(snapshot)),
        'maximumAdditionalBookedCu':str(ADDITIONAL),'originalPolicy':{'globalDailyCu':'1000000','sourceDailyCu':'25000','foregroundReserveCu':'200000'},
        'temporaryPolicy':{'globalDailyCu':str(1000000+ADDITIONAL),'sourceDailyCu':str(source_booked(snapshot,today)+ADDITIONAL),'foregroundReserveCu':'200000'},
        'baselineSourceDayBookedCu':str(source_booked(snapshot,today)),'baselineStaticSha256':digest(static(snapshot)),
        'syncObservationKind':'ponder_sync_block_fetch_gauge_not_complete_cache_coverage','cacheCoverageQualified':False,
        'restartRequirements':{'permissionRangePolicy':'minimum_actual_enabled_source_start_in_pinned_profile',
            'configuredMinimumBlocks':{str(k):str(v)for k,v in configured_minimums(profile_document).items()},
            'nativeTailDiagnosticLookbackBlocks':512,'maximumNativeTailHeadGapBlocks':2000000,
            'allOfficialFilterContinuousCacheThroughNativeSafeRequired':True,'actualRuntimeFilterAndConfigurationProofRequired':True,
            'numericConfiguredStartHeaderRequiredByPonder':True,'paidProxyFreeExceptionAdded':False},
        'otherAllocationsSha256':digest([row for row in snapshot['allocations']if row['workload']!='unified_source']),
        'oldPermitsSha256':digest(snapshot['permits']),'rows':list(rows.values()),'automaticRenewal':False,'normalDaily10MApproved':False}
    seed=digest(value)
    value['permits']=[{'permitId':'0x'+digest({'format':FORMAT,'planSeed':seed,'chainId':row['chainId']}),'profileId':PROFILE,**row,
        'spentCu':'0','enabled':True,'expiresMs':end,'reviewedMs':start_ms}for row in value.pop('rows')]
    return value


def expected_admitted(before,plan):
    result=copy.deepcopy(before);result['global']['dailyCu']=plan['temporaryPolicy']['globalDailyCu']
    for row in result['allocations']:
        if row['workload']=='unified_source':row['dailyCu']=plan['temporaryPolicy']['sourceDailyCu']
    result['permits']=sorted(result['permits']+copy.deepcopy(plan['permits']),key=lambda row:row['permitId'])
    return result


def validate_current(before,current,plan,active=True):
    validate_ledger(current)
    need(digest(static(before))==plan['baselineStaticSha256']and digest(before['permits'])==plan['oldPermitsSha256'],
         'actual_original_reviewed_financial_baseline_required')
    owned={row['permitId']:row for row in plan['permits']};now={row['permitId']:row for row in current['permits']}
    need(len(now)==len(current['permits'])and set(owned)<=set(now),'exact_owned_permit_rows_required')
    compare=copy.deepcopy(current);compare['clockMs']=before['clockMs'];compare['windows']=before['windows'];compare['workloadWindows']=before['workloadWindows']
    for identifier,row in owned.items():
        actual=now[identifier]
        need({k:v for k,v in actual.items()if k!='spentCu'}=={k:v for k,v in row.items()if k!='spentCu'}and
             0<=number(actual['spentCu'])<=number(row['maximumCu']),'only_monotonic_owned_permit_spending_allowed')
        for candidate in compare['permits']:
            if candidate['permitId']==identifier:candidate['spentCu']='0'
    need(compare==expected_admitted(before,plan),'all_other_profiles_old_permits_policies_catalog_ACLs_and_columns_must_match')
    for key in ['windows','workloadWindows']:
        keys=['day']if key=='windows'else['day','workload'];rows={tuple(row[k]for k in keys):row for row in current[key]}
        need(len(rows)==len(current[key]),'unique_actual_durable_budget_windows_required')
        for prior in before[key]:
            row=rows.get(tuple(prior[k]for k in keys));need(row is not None and all(number(row[field])>=number(prior[field])for field in prior if field not in keys),
                'all_original_booked_counters_must_remain_monotonic_no_reset_or_refund')
    additional=source_booked(current)-number(plan['baselineAllDaysSourceBookedCu'])
    need(0<=additional<=ADDITIONAL and source_booked(current)<=ALLOWANCE,'original20M_all_days_booked_cap_required')
    if active:need(plan['startMs']<=current['clockMs']<plan['expiresMs']and day(current['clockMs'])==plan['grantDay'],
                   'one_same_day_nonexpired_window_required')
    return additional


def target_closed(before,current,plan,utc=False):
    additional=validate_current(before,current,plan,False)
    result=copy.deepcopy(current)
    for row in result['permits']:
        if row['permitId']in{row['permitId']for row in plan['permits']}:row['enabled']=False
    result['global']['dailyCu']=str(1000000+(0 if utc else additional))
    for row in result['allocations']:
        if row['workload']=='unified_source':row['dailyCu']=str(25000+(0 if utc else additional))
    return result


def validate_closed(current,closed,plan):
    validate_ledger(current)
    need(static(current)==static(closed),'exact_owned_closed_permits_original_private_profile_and_closed_policy_required')
    for key in ['windows','workloadWindows']:
        fields=['day']if key=='windows'else['day','workload'];actual={tuple(row[k]for k in fields):row for row in current[key]}
        need(len(actual)==len(current[key]),'unique_closed_budget_windows_required')
        for old in closed[key]:
            row=actual.get(tuple(old[k]for k in fields))
            need(row is not None and all(number(row[k])>=number(old[k])for k in old if k not in fields),
                 'closed_financial_counters_must_not_reset_or_refund')
    need(current['clockMs']>=closed['clockMs']and source_booked(current)<=ALLOWANCE,'closed_time_and_original_allowance_must_not_rewind_or_exceed')
    old_source={row['day']:number(row['grantedCu'])for row in closed['workloadWindows']if row['workload']=='unified_source'}
    new_source={row['day']:number(row['grantedCu'])for row in current['workloadWindows']if row['workload']=='unified_source'}
    for date,amount in new_source.items():
        if date<plan['grantDay']:need(amount==old_source.get(date,0),'historical_source_bookings_must_stay_exact_after_close')
        elif date==plan['grantDay']:
            need(0<=amount-old_source.get(date,0)<=25000-number(plan['baselineSourceDayBookedCu']),
                 'only_original_normal_same_day_source_headroom_after_close')
        else:need(amount<=25000,'only_original_25k_new_day_normal_source_bookings_allowed')
    return True


def target_utc(current,closed,plan):
    validate_closed(current,closed,plan)
    need(current['clockMs']>=plan['nextUtcMs'],'exact_original_policy_only_after_actual_UTC_boundary')
    result=copy.deepcopy(current);result['global']['dailyCu']='1000000'
    for row in result['allocations']:
        if row['workload']=='unified_source':row['dailyCu']='25000'
    return result


def writes(plan,phase,current=None):
    if phase=='admit':
        sql=[]
        for row in plan['permits']:
            values=[literal(row['permitId']),literal(PROFILE),str(row['chainId']),row['fromBlock'],row['throughBlock'],row['maximumCu'],'true',
                'to_timestamp('+str(plan['expiresMs'])+'::numeric/1000)','to_timestamp('+str(plan['startMs'])+'::numeric/1000)']
            sql.append('INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at,reviewed_at)VALUES('+','.join(values)+');')
        global_cu=plan['temporaryPolicy']['globalDailyCu'];source_cu=plan['temporaryPolicy']['sourceDailyCu']
    else:
        need(phase in{'close','utc'}and current is not None,'exact_close_or_UTC_snapshot_required');sql=[]
        identifiers=','.join(literal(row['permitId'])for row in plan['permits'])
        sql.append('UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE permit_id IN('+identifiers+');')
        booked=source_booked(current)-number(plan['baselineAllDaysSourceBookedCu'])
        global_cu=str(1000000+(booked if phase=='close'and current['clockMs']<plan['nextUtcMs']else 0))
        source_cu=str(25000+(booked if phase=='close'and current['clockMs']<plan['nextUtcMs']else 0))
    sql+=['UPDATE yunipals_market.rpc_compute_budget SET daily_cu='+global_cu+" WHERE scope='yunipals-opensea';",
          'UPDATE yunipals_market.rpc_compute_allocation SET daily_cu='+source_cu+" WHERE scope='yunipals-opensea'AND workload='unified_source';"]
    return '\n'.join(sql)
