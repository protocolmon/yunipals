#!/usr/bin/env python3
"""A new cache attempt requires known-aborted ancestry and held qualification."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import types

FORMAT='yunipals-ypal-ordinary-cache-continuation-authority-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-cache-continuation-authority-v1.py'
MANIFEST=OPS/'ypal-ordinary-cache-continuation-authority-v1.manifest.json'
BASE=Path('/var/backups/yunipals-ypal-ordinary-cache-continuation-authority-v1-20261025')
PRIOR=OPS/'ypal-ordinary-read-cache-accept-v2.py'
PRIOR_SHA='8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834'
PRIOR_FORMAT='yunipals-ypal-ordinary-read-cache-accept-v2'
PRIOR_BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025')
PRIOR_INPUT=Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-input-v2-20261025/input.json')
PRIOR_INPUT_SHA='2aafbf18b8b24bfcd2499d7fc9106db82d7cfe9c72acd5354d37d7c6fbd2f3fa'
PRIOR_XID='16540148'
NEW=OPS/'ypal-ordinary-read-cache-continue-v1.py'
NEW_FORMAT='yunipals-ypal-ordinary-read-cache-continue-v1'
NEW_BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-continue-v1-20261025')
CACHE=OPS/'ypal-cache-guard-owner-v1.py'
CACHE_SHA='c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba'
ENTRY_SHA='a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705'
COMPONENT_SHA='591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2'
READ_SCHEMA='yunipals_ownership_4e77f52b_v5'
READ_IDENTITY='0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab'
RELEASE='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
APP='ypal_cache_guard_owner_v1'
TTL_NS=90_000_000_000
COMMIT_RESERVE_NS=5_000_000_000
APPROVED_IMPLEMENTATION='0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca'
WRONG_ACK='rollback-only-never-authorized'
SOURCE_PINS={
    'ypal-cache-guard-owner-v1.py':'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba',
    'ypal-ordinary-read-cache-accept-v2.py':'8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834',
    'ypal-ordinary-cache-sql-v6.mjs':'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705',
    'ypal-ordinary-cache-driver-v5.mjs':'5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a',
    'ypal-ordinary-cache-transition-v5.mjs':'591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2',
    'ypal-ordinary-cache-callback-timing-v5.py':'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb',
    'ypal-restored-read-cache-provider-v1.py':'2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9',
    'ypal-ordinary-publication-protocol-v6.py':'543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502'
}

def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64
def boot():return Path('/proc/sys/kernel/random/boot_id').read_text().strip()

def public(path,digest=None,maximum=6000000):
    path=Path(path);need(path.is_absolute()and'..'not in path.parts,'fixed_absolute_cache_continuation_file_required')
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_cache_continuation_path_required')
    before=path.lstat();fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    key=lambda row:tuple(getattr(row,name)for name in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    try:
        raw=os.read(fd,maximum+1)
        need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
            key(before)==key(os.fstat(fd))==key(path.lstat())and(digest is None or pin(digest)and sha(raw)==digest),
            'same_exact_cache_continuation_file_bytes_required')
        return raw
    finally:os.close(fd)

def document(path,digest=None):return json.loads(public(path,digest))
def authenticate():
    expected={'format':FORMAT+'-source','files':{FILE.name:sha(public(FILE)),**SOURCE_PINS}}
    need(document(MANIFEST)==expected,'exact_actual_cache_continuation_authority_source_manifest_required')
    for name,digest in SOURCE_PINS.items():public(OPS/name,digest)

def frame(paths):
    result={}
    for path in paths:
        row=Path(path).lstat();raw=public(path)
        result[str(path)]={'sha256':sha(raw),**{key:getattr(row,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_size','st_mtime_ns','st_ctime_ns']}}
    return result

def new_identity(cache,host):
    need(cache.FORMAT==NEW_FORMAT and cache.BASE==NEW_BASE and Path(cache.__file__)==NEW and
        cache.ENTRY_SHA==ENTRY_SHA and cache.COMPONENT_SHA==COMPONENT_SHA and cache.RELEASE==RELEASE and cache.IDENTITY==READ_IDENTITY,
        'actual_new_continuation_namespace_same_SQL_dataset_and_identity_required')
    config=document(PRIOR_INPUT,PRIOR_INPUT_SHA)
    need(host.config==config,'same_actual_prior_cache_input_without_relabel_or_copy_required')
    return {'format':cache.FORMAT,'providerSha256':sha(public(NEW)),'inputSha256':PRIOR_INPUT_SHA,
        'configSha256':sha(encoded(config)),'authoritySha256':sha(public(FILE)),'sqlEntrySha256':ENTRY_SHA,'componentSha256':COMPONENT_SHA}

OWNER_SESSIONS_SQL="SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',(extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text,'roleOid',usesysid::text,'databaseOid',datid::text)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND application_name='ypal_cache_guard_owner_v1'AND pid<>pg_backend_pid()"

def inverse_transport_records(cache,host):
    """Attribute one coordinated inverse child; confer no inverse authority."""
    need(getattr(cache,'inverse_mode',None)is True and getattr(host,'inverse_mode',None)is True and
        getattr(cache,'_continuation_qualification',None)is None,
        'typed_coordinated_inverse_context_without_forward_qualification_required')
    refs=getattr(cache,'continuation_reader',None)
    reader='ypal-ordinary-reader-continue-v1.py';manifest_file='ypal-ordinary-reader-continue-v1.manifest.json'
    need(type(refs)is dict and set(refs)=={'file','sha256','manifestFile','manifest'}and refs['file']==reader and
        refs['manifestFile']==manifest_file and pin(refs['sha256']),'actual_continuation_reader_descriptor_required')
    public(OPS/reader,refs['sha256']);manifest=document(OPS/manifest_file)
    need(manifest==refs['manifest']and manifest['format']=='yunipals-ypal-ordinary-reader-continue-v1-source'and
        manifest['files'][reader]==refs['sha256']and manifest['dependencies'][NEW.name]==sha(public(NEW)),
        'actual_new_reader_and_provider_manifest_identity_required')
    for name,digest in{**manifest['dependencies'],**manifest['files']}.items():
        need(Path(name).name==name and pin(digest),'finite_actual_inverse_reader_source_closure_required');public(OPS/name,digest)
    area=Path('/var/backups/yunipals-ypal-ordinary-reader-continue-v1-20261025')
    op=document(area/'operation.json');initial=document(area/'inverse-intent.json');intent=document(area/'cache-inverse-intent.json')
    before=document(NEW_BASE/'before.json');committed=document(NEW_BASE/'sql-committed.json');binding=op['binding'];prior=initial['binding']
    need(binding['format']=='yunipals-ypal-ordinary-reader-continue-v1'and binding['operatorSha256']==refs['sha256']and
        binding['bootId']==boot()and op['reviewHash']==sha(encoded(binding))and
        binding['sourceManifestSha256']==sha(public(OPS/manifest_file))and
        prior['format']==binding['format']and prior['bootId']==boot()and initial['reviewHash']==sha(encoded(prior))and
        prior['operationSha256']==sha(public(area/'operation.json'))and
        intent=={'format':binding['format'],'bootId':boot(),'operationSha256':sha(public(area/'operation.json')),
            'cacheCommitSha256':sha(public(NEW_BASE/'sql-committed.json')),'inverseIntentSha256':sha(public(area/'inverse-intent.json'))}and
        committed['mode']=='apply'and committed['operatorSha256']==before['binding']['operatorSha256']==sha(public(NEW))and
        committed['bootId']==boot()and committed['reviewHash']==before['reviewHash']and
        committed['commitIntentSha256']==sha(public(NEW_BASE/'sql-intent.json'))and
        committed['preparedSha256']==sha(public(NEW_BASE/'sql-prepared.json'))and
        committed['additionalReadAuthorizationSha256']==sha(public(NEW_BASE/'authorization.json')),
        'exact_owned_coordinated_inverse_operation_intent_and_actual_cache_COMMIT_chain_required')
    return document(NEW_BASE/'inverse-sql-opened.json'),document(NEW_BASE/'inverse-sql-child.json'),public(NEW_BASE/'inverse-sql-child.json')

def prior_child_terminal(cache,host,child):
    rows=host.query(OWNER_SESSIONS_SQL)
    if rows==[]:
        cache.child_gone(host,'apply-sql-child.json')
        return {'oldZeroSessionRecoveryPredicatePassed':True,'newHeldOwnerQualified':False}
    # A new held child is legitimate only under the new, durable authority and
    # its genuine positive kernel/XID ownership. Never substitute a fake zero.
    current=getattr(host,'cache',None);need(current is not None,'unknown_cache_owner_APP_session_refused')
    new_identity(current,host);gate=getattr(current,'_continuation_approval_gate',None)
    scope=getattr(current,'_continuation_qualification',None)
    inverse=getattr(current,'inverse_mode',None)is True and getattr(host,'inverse_mode',None)is True
    if inverse:
        opened,new_child,child_raw=inverse_transport_records(current,host);mode='inverse'
    elif scope is not None:
        need(type(gate)is dict and gate['mode']=='apply','actual_new_forward_approval_gate_required_for_held_apply_owner')
        need(type(scope)is QualificationScope and scope.cache is current and scope.host is host,
            'actual_typed_rollback_qualification_transport_scope_required')
        records=scope.transport_records;opened=records['apply-sql-opened.json'];new_child=records['apply-sql-child.json']
        child_raw=public(scope.audit/'apply-sql-child.json');mode='apply'
    else:
        need(type(gate)is dict and gate['mode']=='apply','only_explicit_new_held_cache_owner_may_replace_zero_session_recovery_predicate')
        intent=document(NEW_BASE/'sql-intent.json');before=document(NEW_BASE/'before.json')
        need(intent['format']==NEW_FORMAT and intent['bootId']==boot()and intent['reviewHash']==before['reviewHash']and
            intent['rehearsalSha256']==sha(public(NEW_BASE/'rehearsed.json'))and
            intent['authorizationSha256']==sha(public(NEW_BASE/'authorization.json')),
            'actual_new_durable_cache_SQL_intent_required_before_owned_session_allowance')
        opened=document(NEW_BASE/'apply-sql-opened.json');new_child=document(NEW_BASE/'apply-sql-child.json')
        child_raw=public(NEW_BASE/'apply-sql-child.json');mode='apply'
    message=opened['message'];backend=message['backend']
    need(message['format']=='yunipals-ypal-cache-guard-sql-v1'and message['event']=='transaction-opened'and
        message['mode']==new_child['mode']==mode and re.fullmatch('[1-9][0-9]*',message['xid'])and message['xid']!=PRIOR_XID and
        opened['childFileSha256']==sha(child_raw)and new_child['bootId']==boot()and
        new_child['entrySha256']==ENTRY_SHA and new_child['componentSha256']==COMPONENT_SHA and
        new_child['processGroup']==new_child['actor']['pid']and new_child['rootParentPid']==os.getpid()and
        backend['roleOid']=='10'and backend['databaseOid']=='17584'and type(backend['pid'])is int and backend['pid']>0 and
        re.fullmatch('[1-9][0-9]*',backend['backendStart'])and
        host.m.process(str(new_child['actor']['pid']))==new_child['actor'],
        'same_new_actual_live_child_epoch_opened_SQL_and_effect_bytes_required')
    expected={key:backend[key]for key in['pid','backendStart','roleOid','databaseOid']}
    need(rows==[expected]and host.sql_session(new_child['actor'],backend,message['xid'])and host.query(OWNER_SESSIONS_SQL)==rows,
        'exactly_one_new_kernel_owned_cache_APP_backend_no_unknown_sessions_required')
    try:old=host.m.process(str(child['actor']['pid']))
    except(FileNotFoundError,ProcessLookupError):old=None
    need(old!=child['actor'],'actual_prior_failed_SQL_child_epoch_must_be_terminal')
    return {'oldZeroSessionRecoveryPredicatePassed':False,'newHeldOwnerQualified':True,'newHeldOwnerMode':mode,
        'forwardApprovalQualified':False if inverse else True,'noNewInverseAuthority':inverse}

def prior_aborted(cache,host):
    """Owned stop/aborted-XID ancestry only; no live catalog claim under locks."""
    authenticate()
    need(cache.FORMAT==PRIOR_FORMAT and cache.BASE==PRIOR_BASE and Path(cache.__file__)==PRIOR and
        cache.ENTRY_SHA==ENTRY_SHA and cache.COMPONENT_SHA==COMPONENT_SHA and host.config==document(PRIOR_INPUT,PRIOR_INPUT_SHA),
        'genuine_prior_cache_namespace_input_and_unchanged_effect_bytes_required')
    names=['before.json','rehearsed.json','authorization.json','boot-disable-intent.json','boot-disabled.json',
        'disable-reload-intent.json','disable-reload-result.json','stop-intent.json','stopped.json','sql-intent.json',
        'apply-sql-child.json','apply-sql-opened.json']
    paths=[PRIOR_BASE/name for name in names];before_frame=frame(paths)
    before,rehearsal,stopped_ack=cache.stopped(host)
    need(before['binding']['operatorSha256']==PRIOR_SHA and before['binding']['format']==PRIOR_FORMAT and
        before['binding']['bootId']==boot()and before['binding']['config']==host.config,
        'same_actual_prior_boot_operator_and_owned_stop_required')
    intent=document(PRIOR_BASE/'sql-intent.json');opened=document(PRIOR_BASE/'apply-sql-opened.json');child=document(PRIOR_BASE/'apply-sql-child.json')
    message=opened['message'];backend=message['backend']
    need(intent['format']==PRIOR_FORMAT and intent['bootId']==boot()and intent['reviewHash']==before['reviewHash']and
        intent['rehearsalSha256']==before_frame[str(PRIOR_BASE/'rehearsed.json')]['sha256']and
        intent['authorizationSha256']==before_frame[str(PRIOR_BASE/'authorization.json')]['sha256']and
        message['format']=='yunipals-ypal-cache-guard-sql-v1'and message['event']=='transaction-opened'and
        message['mode']==child['mode']=='apply'and message['xid']==PRIOR_XID and child['bootId']==boot()and
        child['entrySha256']==ENTRY_SHA and child['componentSha256']==COMPONENT_SHA and
        opened['childFileSha256']==before_frame[str(PRIOR_BASE/'apply-sql-child.json')]['sha256'],
        'exact_actual_failed_apply_intent_child_opened_XID_chain_required')
    need(all(not os.path.lexists(PRIOR_BASE/name)for name in['sql-prepared.json','sql-committed.json','prepared.json','inverse-result.json','sql-inversed.json']),
        'prior_attempt_must_have_no_prepared_authority_COMMIT_or_inverse_ACK')
    session_phase=prior_child_terminal(cache,host,child)
    need(cache.xact_status(host,PRIOR_XID)=='aborted','prior_transaction_must_be_genuinely_aborted_never_unknown_or_committed')
    need(type(backend['pid'])is int and backend['pid']>0 and re.fullmatch('[1-9][0-9]*',backend['backendStart'])and
        backend['roleOid']=='10'and backend['databaseOid']=='17584','exact_prior_backend_epoch_required')
    sql="SELECT count(*)::int FROM pg_stat_activity WHERE pid="+str(backend['pid'])+" AND (extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text='"+backend['backendStart']+"' AND datid=17584 AND usesysid=10"
    need(host.query(sql)==0,'actual_prior_owned_SQL_backend_epoch_must_be_gone')
    archive=PRIOR_BASE/'original-boot-link'
    need(not os.path.lexists(cache.BOOT)and cache.inode(archive,True)==before['binding']['boot'],
        'actual_original_cache_boot_inode_must_remain_at_prior_archive')
    host.private();need(frame(paths)==before_frame,'prior_failed_journals_or_inodes_changed_during_capture')
    binding={'priorProducerSha256':PRIOR_SHA,'priorFormat':PRIOR_FORMAT,'priorBase':str(PRIOR_BASE),'inputSha256':PRIOR_INPUT_SHA,
        'transactionId':PRIOR_XID,'transactionStatus':'aborted','records':before_frame,'originalActor':copy.deepcopy(before['binding']['originalActor']),
        'boot':copy.deepcopy(before['binding']['boot']),'retainedBootArchiveFile':str(archive),'priorChildGone':True,'priorBackendGone':True,
        'currentCatalogQualified':False,'oldWholeValidatorPassed':False}
    return {'format':FORMAT+'-prior-aborted','validated':True,'binding':binding,'bindingSha256':sha(encoded(binding)),
        'actualPriorStopped':stopped_ack,'retainedBootArchiveFile':str(archive),**session_phase,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def original_catalog(cache,host):
    prior=prior_aborted(cache,host);before,rehearsal=cache.owned(host)
    current=cache._sql_child(host,'inspect')
    need(current['catalogSha256']==before['catalog']['catalogSha256']and
        host.read.acl_catalog(current['postProof']['catalog'])==host.read.acl_catalog(before['catalog']['postProof']['catalog'])and
        current['postProof']['allColumnAcl']==before['catalog']['postProof']['allColumnAcl'],
        'complete_original_cache_catalog_all_READs_and_column_ACLs_after_aborted_prior_required')
    need(prior_aborted(cache,host)['binding']==prior['binding'],'prior_stop_or_failed_transaction_changed_around_current_catalog')
    return prior,current

APPROVAL_SQL="""WITH stamp AS MATERIALIZED(SELECT clock_timestamp()AS at),
a AS MATERIALIZED(SELECT s.*FROM metadata_source.native_base_metadata_state s WHERE release_id='"""+RELEASE+"""'),
f AS MATERIALIZED(SELECT *FROM """+READ_SCHEMA+""".base_metadata_frame(false))
SELECT jsonb_build_object('atUs',(extract(epoch FROM stamp.at)*1000000)::numeric(30,0)::text,
'checkedUs',(SELECT(extract(epoch FROM checked_at)*1000000)::numeric(30,0)::text FROM a),
'release',(SELECT release_id FROM a),'identity',(SELECT read_identity FROM a),'state',(SELECT state FROM a),
'implementation',(SELECT implementation FROM a),'errorCode',(SELECT error_code FROM a),
'frontier',(SELECT frontier FROM a),'frameFrontier',(SELECT frontier FROM f),'checkedBlock',(SELECT checked_block::text FROM a),
'checkedHash',(SELECT checked_hash FROM a),'frameBlock',(SELECT block_number::text FROM f),
'frameHash',(SELECT block_hash FROM f),'probe',"""+READ_SCHEMA+""".base_metadata_probe(),
'nativeMode',EXISTS(SELECT 1 FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'AND ingestion_mode='native'),
'canonical',EXISTS(SELECT 1 FROM a JOIN unified_ypal_20261023_v1.chain_block b ON b.chain_id=8453 AND b.block_number=a.checked_block AND b.block_hash=a.checked_hash))FROM stamp"""

def approval_snapshot(host):
    started=time.monotonic_ns();value=host.query(APPROVAL_SQL);ended=time.monotonic_ns()
    need(type(value)is dict and value.get('release')==RELEASE and value.get('identity')==READ_IDENTITY and
        value.get('state')=='ready'and value.get('errorCode')is None and value.get('probe')is value.get('nativeMode')is value.get('canonical')is True and
        value.get('frontier')==value.get('frameFrontier')and value.get('implementation')==APPROVED_IMPLEMENTATION and
        all(type(value.get(key))is str and re.fullmatch('[0-9]+',value[key])for key in['atUs','checkedUs','checkedBlock','frameBlock'])and
        int(value['checkedBlock'])<=int(value['frameBlock'])and re.fullmatch('0x[a-f0-9]{64}',value.get('checkedHash',''))and
        re.fullmatch('0x[a-f0-9]{64}',value.get('frameHash','')),
        'actual_official_native_metadata_approval_full_frame_and_dataset_required')
    age_ns=(int(value['atUs'])-int(value['checkedUs']))*1000
    # Subtract the entire query duration: the database stamp is inside it.
    remaining=TTL_NS-age_ns-(ended-started)
    need(0<=age_ns<TTL_NS and remaining>COMMIT_RESERVE_NS,'actual_official_approval_must_be_current_inside_unchanged_ninety_second_TTL')
    return {'format':FORMAT+'-approval','snapshot':value,'ageNanoseconds':age_ns,'remainingNanoseconds':remaining,
        'capturedMonotonicNanoseconds':ended,'queryNanoseconds':ended-started,'ttlNanoseconds':TTL_NS,
        'officialApprovalRefreshedByThisGate':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def fresh_approval(host,required_ns):
    need(type(required_ns)is int and required_ns>0,'actual_complete_held_callback_budget_required')
    gate=approval_snapshot(host)
    need(required_ns+COMMIT_RESERVE_NS<gate['remainingNanoseconds'],
        'complete_held_budget_and_COMMIT_reserve_must_fit_actual_official_approval_remaining_TTL')
    return gate

def check_deadline(gate):
    elapsed=time.monotonic_ns()-gate['capturedMonotonicNanoseconds']
    need(0<=elapsed and elapsed+COMMIT_RESERVE_NS<gate['remainingNanoseconds'],
        'actual_approval_deadline_before_literal_COMMIT_ACK_requires_rollback')
    return elapsed

def code_identity(code):
    return(code.co_code,code.co_names,code.co_varnames,code.co_argcount,code.co_posonlyargcount,code.co_kwonlyargcount,
        code.co_flags,code.co_exceptiontable,code.co_freevars,code.co_cellvars,
        tuple(code_identity(item)if isinstance(item,types.CodeType)else item for item in code.co_consts))

def static_module(name):
    path=OPS/name;raw=public(path,SOURCE_PINS[name]);module=types.ModuleType('cache_continuation_static_'+path.stem.replace('-','_'));module.__file__=str(path)
    exec(compile(raw,str(path),'exec'),module.__dict__);return module

def original_parent_ast():
    tree=ast.parse(public(CACHE,CACHE_SHA));fn=copy.deepcopy(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='sql_child'))
    fn=static_module('ypal-restored-read-cache-provider-v1.py').transport_function(fn);changed=0
    for node in ast.walk(fn):
        if isinstance(node,ast.Constant)and node.value=='yunipals_ownership_4e77f52b_v4':node.value=READ_SCHEMA;changed+=1
    need(changed==2,'exact_two_genuine_V5_parent_schema_seams_required')
    fn=static_module('ypal-ordinary-publication-protocol-v6.py').cache_parent_window(fn);fn.name='_sql_child'
    return fn

def compiled_parent(fn,globals_,defaults,closure):
    # Preserve the genuine module import scope. Python's method-call bytecode
    # differs when known imported globals are compiled as an isolated function.
    imports=[node for node in ast.parse(public(CACHE,CACHE_SHA)).body if isinstance(node,(ast.Import,ast.ImportFrom))]
    scope=dict(globals_);exec(compile(ast.fix_missing_locations(ast.Module(body=[*imports,fn],type_ignores=[])),str(FILE),'exec'),scope)
    value=scope['_sql_child']
    return types.FunctionType(value.__code__,globals_,'_sql_child',defaults,closure)

def bounded_sql_parent(current,prior):
    need(type(current)is type(prior)is types.FunctionType,'actual_genuine_raw_cache_SQL_parent_functions_required')
    fn=original_parent_ast();expected=compiled_parent(copy.deepcopy(fn),prior.__globals__,prior.__defaults__,prior.__closure__)
    need(code_identity(current.__code__)==code_identity(prior.__code__)==code_identity(expected.__code__),
        'whole_original_cache_parent_body_and_V6_protocol_required_before_new_tail_bound')
    changed=0;late=0
    for node in ast.walk(fn):
        for field,body in ast.iter_fields(node):
            if not isinstance(body,list):continue
            result=[]
            for statement in body:
                if (isinstance(statement,ast.Assign)and isinstance(statement.value,ast.Call)and
                    ast.unparse(statement.value.func)=='subprocess.Popen'):
                    result.append(ast.parse('continuation_approval_before_launch(host,mode)').body[0]);late+=1
                if (isinstance(statement,ast.Expr)and isinstance(statement.value,ast.Call)and ast.unparse(statement.value.func)=='proc.stdin.write'and
                    any(isinstance(item,ast.Constant)and item.value=='commit-authorized'for item in ast.walk(statement))):
                    result.append(ast.parse('deadline=min(deadline,continuation_ack_deadline(host,mode))').body[0]);changed+=1
                result.append(statement)
            setattr(node,field,result)
    need(changed==late==1,'exact_late_approval_gate_and_five_second_literal_COMMIT_ACK_tail_seams_required')
    scope={**current.__globals__,'continuation_approval_before_launch':lambda host,mode:approval_before_launch(host.cache,host,mode),
        'continuation_ack_deadline':lambda host,mode:ack_deadline(host.cache,host,mode)}
    return compiled_parent(fn,scope,current.__defaults__,current.__closure__)

def rollback_transport(current,prior,audit_save):
    expected=bounded_sql_parent(prior,prior)
    need(type(current)is types.FunctionType and code_identity(current.__code__)==code_identity(expected.__code__),
        'whole_genuine_cache_SQL_parent_with_declared_five_second_tail_required_before_rollback_only_qualification')
    constants=list(current.__code__.co_consts);need(constants.count('commit-authorized')==1,'exact_one_original_literal_cache_COMMIT_ACK_required')
    constants[constants.index('commit-authorized')]=WRONG_ACK
    code=current.__code__.replace(co_consts=tuple(constants))
    need(code.co_code==current.__code__.co_code and 'commit-authorized'not in code.co_consts and code.co_consts.count(WRONG_ACK)==1,
        'rollback_only_parent_must_have_no_literal_COMMIT_authority')
    return types.FunctionType(code,{**current.__globals__,'save':audit_save},current.__name__,current.__defaults__,current.__closure__)

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def directory(path):
    path=Path(path);path.mkdir(mode=0o700);os.chmod(path,0o700);sync(path.parent)

def write(path,value):
    raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:
        os.fchmod(stream.fileno(),0o600);stream.write(raw);stream.flush();os.fsync(stream.fileno())
    sync(Path(path).parent);return sha(raw)

def capture_directory(capture_id):
    need(type(capture_id)is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',capture_id),'new_bounded_cache_continuation_capture_ID_required')
    for path in[BASE,BASE/'captures']:
        if not os.path.lexists(path):directory(path)
        row=path.lstat();need(stat.S_ISDIR(row.st_mode)and not stat.S_ISLNK(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,
            'protected_private_cache_continuation_capture_directory_required')
    path=BASE/'captures'/capture_id;directory(path);return path

def construct_records(cache,host,capture_id):
    """Observe a new post-drain baseline and perform a genuine new SQL rollback."""
    identity=new_identity(cache,host);audit=capture_directory(capture_id)
    write(audit/'intent.json',{'format':FORMAT,'action':'construct-records','identity':identity,'automaticRetryAllowed':False})
    need(not os.path.lexists(NEW_BASE),'fresh_new_cache_namespace_required_no_prior_journal_overwrite')
    prior,catalog=original_catalog(cache.prior_cache,host)
    host.refresh();prerequisites=host.prerequisites();host.private()
    binding={'format':cache.FORMAT,'operatorSha256':identity['providerSha256'],'bootId':boot(),'config':copy.deepcopy(host.config),
        'candidateReceiptSha256':cache.CANDIDATE_SHA,'sqlDriverSha256':ENTRY_SHA,'componentSha256':COMPONENT_SHA,
        'originalActor':copy.deepcopy(prior['binding']['originalActor']),'boot':copy.deepcopy(prior['binding']['boot']),
        'prerequisites':prerequisites,'catalogSha256':catalog['catalogSha256'],
        'readCatalogSha256':sha(encoded(host.read.acl_catalog(catalog['postProof']['catalog']))),
        'additionalReadAuthorizationRequired':True,'additionalReadCount':4,
        'consumerFrame':host.read.consumer_frame(host.h),'original143PlanModified':False,'originalGeneration103Relabelled':False,
        'retainedActualStop':copy.deepcopy(prior['binding']),'newStopActionPerformed':False}
    before={'binding':binding,'reviewHash':sha(encoded(binding)),'catalog':catalog,'legacyHTTP':cache.legacy_http(host)}
    need(prior_aborted(cache.prior_cache,host)['binding']==prior['binding'],'same_actual_prior_stop_before_new_observation_records')
    directory(NEW_BASE);cache.save('before.json',before)
    cache.save('rehearsal-intent.json',{'format':cache.FORMAT,'reviewHash':before['reviewHash'],'bootId':boot(),
        'databaseCommitAllowed':False,'retainedActualPriorAbortedSha256':prior['bindingSha256']})
    result=cache.sql_child(host,'rehearse');cache.exact_four(result['result'])
    need(result['result']['beforeCatalogSha256']==catalog['catalogSha256']and cache.xact_status(host,result['xid'])=='aborted',
        'genuine_new_rehearsal_original_catalog_and_actual_ROLLBACK_XID_required')
    cache.read_extension(catalog['postProof']['catalog'],result['postProof']['catalog'],result['result'],result['postProof']['catalog'])
    _,after=original_catalog(cache.prior_cache,host)
    need(after['catalogSha256']==catalog['catalogSha256']and after['postProof']['allColumnAcl']==catalog['postProof']['allColumnAcl']and
        host.prerequisites()==prerequisites,'new_rehearsal_must_restore_whole_catalog_and_preserve_actual_prerequisites')
    delta=sha(encoded(result['result']['addedSelects']));old_authorization=document(PRIOR_BASE/'authorization.json')
    need(old_authorization['additionalReadCount']==4 and old_authorization['additionalReadDeltaSha256']==delta,
        'exact_same_explicitly_authorized_four_READ_delta_required_no_new_authority')
    rehearsed={'format':cache.FORMAT,'rehearsed':True,'committed':False,'reviewHash':before['reviewHash'],'sql':result,
        'additionalReads':result['result']['addedSelects'],'additionalReadDeltaSha256':delta,
        'beforeFileSha256':sha(public(NEW_BASE/'before.json')),'sourceReadinessClaimed':False,
        'retainedActualPriorAbortedSha256':prior['bindingSha256'],'newActualRollbackRehearsal':True}
    cache.save('rehearsed.json',rehearsed)
    authorization={'format':cache.FORMAT,'reviewHash':before['reviewHash'],'readAdmissionSha256':host.config['readAdmissionSha256'],
        'additionalReadDeltaSha256':delta,'additionalReadCount':4,'original143PlanModified':False,
        'retainedActualAuthorization':{'file':str(PRIOR_BASE/'authorization.json'),'sha256':sha(public(PRIOR_BASE/'authorization.json'))},
        'additionalAuthorityRequested':False}
    cache.save('authorization.json',authorization)
    result={'format':FORMAT,'completed':True,'action':'construct-records','identity':identity,
        'beforeSha256':sha(public(NEW_BASE/'before.json')),'rehearsedSha256':sha(public(NEW_BASE/'rehearsed.json')),
        'authorizationSha256':sha(public(NEW_BASE/'authorization.json')),'actualNewRehearsalXID':result['xid'],
        'priorAbortedSha256':prior['bindingSha256'],'newStopActionPerformed':False,'productionPreparedACKCreated':False,
        'productionCOMMITQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    digest=write(audit/'result.json',result);return{**result,'captureId':capture_id,'sha256':digest}

def stopped(cache,host):
    identity=new_identity(cache,host);before,rehearsed=cache.owned(host);prior=prior_aborted(cache.prior_cache,host)
    authorization=document(NEW_BASE/'authorization.json')
    need(before['binding']['operatorSha256']==identity['providerSha256']and
        before['binding']['retainedActualStop']==prior['binding']and before['binding']['newStopActionPerformed']is False and
        rehearsed['retainedActualPriorAbortedSha256']==prior['bindingSha256']and rehearsed['newActualRollbackRehearsal']is True and
        authorization['format']==cache.FORMAT and authorization['reviewHash']==before['reviewHash']and
        authorization['additionalReadDeltaSha256']==rehearsed['additionalReadDeltaSha256']and authorization['additionalReadCount']==4 and
        authorization['retainedActualAuthorization']=={'file':str(PRIOR_BASE/'authorization.json'),'sha256':sha(public(PRIOR_BASE/'authorization.json'))}and
        authorization['additionalAuthorityRequested']is False,
        'new_owned_observations_and_actual_retained_stop_authorization_required')
    actual={'format':FORMAT+'-retained-stop','actualPriorStopped':prior['actualPriorStopped'],
        'priorStoppedFile':str(PRIOR_BASE/'stopped.json'),'priorStoppedSha256':sha(public(PRIOR_BASE/'stopped.json')),
        'retainedBootArchiveFile':prior['retainedBootArchiveFile'],'newStopActionPerformed':False}
    return before,rehearsed,actual

def qualification_key(cache,host):
    identity=new_identity(cache,host);before,rehearsed,_=stopped(cache,host)
    context=getattr(cache,'continuation_context',None)
    need(type(context)is dict and context.get('mode')=='cache-prepared-held'and context.get('providerSha256')==identity['providerSha256']and
        context.get('guardSha256')=='36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82'and
        type(context.get('context'))is dict and context['context'].get('target')=='cache'and context['context'].get('inputSha256')==PRIOR_INPUT_SHA and
        context['context'].get('direction')=='forward'and
        context.get('operatorSha256')==sha(public(OPS/'ypal-ordinary-publication-continue-v1.py'))and
        context.get('readerSha256')==sha(public(OPS/'ypal-ordinary-reader-continue-v1.py'))and
        context.get('querySha256')=='deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c'and
        context.get('protocolSha256')=='543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502',
        'actual_new_caller_full_context_source_guard_and_cache_input_binding_required')
    return{**identity,'beforeSha256':sha(public(NEW_BASE/'before.json')),'rehearsedSha256':sha(public(NEW_BASE/'rehearsed.json')),
        'authorizationSha256':sha(public(NEW_BASE/'authorization.json')),
        'priorAbortedSha256':rehearsed['retainedActualPriorAbortedSha256'],'bootId':boot(),'continuationContext':copy.deepcopy(context)}

def require_qualification(cache,host,reference):
    need(type(reference)is dict and set(reference)=={'captureId','sha256'}and pin(reference['sha256'])and
        type(reference['captureId'])is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',reference['captureId']),
        'actual_new_complete_held_rollback_qualification_ref_required')
    audit=BASE/'captures'/reference['captureId'];value=document(audit/'result.json',reference['sha256'])
    need(value['format']==FORMAT and value['completed']is value['rollbackOnly']is value['completeHeldCallback']is True and
        value['identity']==qualification_key(cache,host)and value['productionCOMMITQualified']is value['productionPreparedACKCreated']is False and
        value['priorTimingReceiptUsed']is False and value['transactionStatus']=='aborted'and
        value['childGone']is value['backendGone']is value['catalogRestored']is value['transactionalCatalogMutationsRolledBack']is True and
        type(value['elapsedNanoseconds'])is int and 0<value['elapsedNanoseconds']and value['reserveNanoseconds']==COMMIT_RESERVE_NS and
        value['elapsedNanoseconds']+COMMIT_RESERVE_NS<TTL_NS and value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
        'actual_same_new_owner_full_held_rollback_and_complete_callback_receipt_required')
    names={'intent.json','approval-before-launch.json','apply-sql-child.json','apply-sql-opened.json',
        'actual-prepared-observation.json','complete-held-callback.json'}
    need(type(value['auditFiles'])is dict and set(value['auditFiles'])==names,
        'all_actual_held_qualification_audit_records_required')
    records={name:document(audit/name,digest)for name,digest in value['auditFiles'].items()}
    packet=records['actual-prepared-observation.json'];opened=records['apply-sql-opened.json']
    need(records['intent.json']=={'format':FORMAT,'identity':value['identity'],'rollbackOnly':True,'automaticRetryAllowed':False}and
        records['approval-before-launch.json']==value['approvalGate']and
        packet['neverProductionPreparedACK']is True and packet['value']['xid']==opened['message']['xid']==value['transactionId']and
        packet['value']['mode']==opened['message']['mode']=='apply'and
        type(packet['valueJson'])is str and json.loads(packet['valueJson'])==packet['value']and
        opened['childFileSha256']==value['auditFiles']['apply-sql-child.json']and
        records['complete-held-callback.json']['packetSha256']==value['actualPreparedPacketSha256']==sha(packet['valueJson'].encode())and
        records['complete-held-callback.json']['productionPreparedACKCreated']is False and
        type(records['complete-held-callback.json']['elapsedNanoseconds'])is int and
        0<records['complete-held-callback.json']['elapsedNanoseconds']<=value['elapsedNanoseconds']and
        value['elapsedNanoseconds']+COMMIT_RESERVE_NS<value['approvalGate']['remainingNanoseconds']and
        value['approvalGate']['identity']==new_identity(cache,host)and value['approvalGate']['mode']=='apply'and
        value['approvalGate']['officialApprovalRefreshedByThisGate']is False and value['approvalGate']['ttlNanoseconds']==TTL_NS,
        'same_actual_approval_transport_prepared_observation_and_no_COMMIT_qualification_chain_required')
    return value

class QualificationScope:
    def __init__(self,cache,host,audit):
        self.cache,self.host,self.audit=cache,host,audit;self.gate=None;self.packet=None;self.callback_finished=None;self.transport_records={}

def approval_before_launch(cache,host,mode):
    need(mode in{'inspect','freshness','rehearse','apply','inverse'},'fixed_cache_continuation_SQL_mode_required')
    if mode=='inverse':
        need(getattr(cache,'inverse_mode',None)is True and getattr(host,'inverse_mode',None)is True and
            getattr(cache,'_continuation_qualification',None)is None,'explicit_typed_inverse_context_required_forward_approval_not_applicable')
        return {'mode':'inverse','notApplicable':True,'forwardApprovalQualified':False,'metadataApprovalQualified':False,
            'noNewInverseAuthority':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    if mode in{'inspect','freshness'}:return None
    scope=getattr(cache,'_continuation_qualification',None)
    if scope is not None:
        need(type(scope)is QualificationScope and scope.cache is cache and scope.host is host and mode=='apply',
            'actual_fixed_rollback_qualification_scope_required')
        required=1
    elif mode=='rehearse':required=1
    else:
        value=require_qualification(cache,host,getattr(cache,'continuation_qualification_ref',None))
        required=value['elapsedNanoseconds']
    gate=fresh_approval(host,required);gate['mode']=mode;gate['identity']=new_identity(cache,host)
    cache._continuation_approval_gate=gate
    if scope is not None:
        need(scope.gate is None,'one_actual_approval_gate_per_held_rollback_qualification');scope.gate=gate
        write(scope.audit/'approval-before-launch.json',gate)
    return gate

def before_literal_ack(cache,host,packet):
    gate=getattr(cache,'_continuation_approval_gate',None)
    need(type(gate)is dict and gate['mode']=='apply'and gate['identity']==new_identity(cache,host)and
        packet['mode']=='apply'and re.fullmatch('[1-9][0-9]*',packet['xid']),
        'same_actual_approval_gate_owner_and_held_transaction_before_literal_ACK_required')
    elapsed=check_deadline(gate)
    scope=getattr(cache,'_continuation_qualification',None)
    if scope is not None:
        need(type(scope)is QualificationScope and scope.cache is cache and scope.host is host and scope.packet is None,
            'one_complete_actual_prepared_callback_required')
        scope.packet=copy.deepcopy(packet)
        write(scope.audit/'complete-held-callback.json',{'packetSha256':sha(cache.js_encoded(packet)),
            'elapsedNanoseconds':elapsed,'productionPreparedACKCreated':False})
        scope.callback_finished=time.monotonic_ns()
    return elapsed

def ack_deadline(cache,host,mode):
    if mode=='inverse':
        approval_before_launch(cache,host,mode);return time.monotonic()+5
    need(mode=='apply','literal_cache_ACK_requires_apply_or_typed_inverse_mode')
    gate=getattr(cache,'_continuation_approval_gate',None)
    need(type(gate)is dict and gate['mode']=='apply'and gate['identity']==new_identity(cache,host),
        'same_actual_gate_before_raw_literal_ACK_deadline_required')
    check_deadline(gate)
    return min(time.monotonic()+5,(gate['capturedMonotonicNanoseconds']+gate['remainingNanoseconds'])/1_000_000_000)

def prepared_callback(cache,host,before,rehearsed,audit):
    raw=public(CACHE,CACHE_SHA);tree=ast.parse(raw);commit=next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='commit')
    fn=copy.deepcopy(next(node for node in commit.body if isinstance(node,ast.FunctionDef)and node.name=='prepared'));changed=0
    def audit_prepared(name,value):
        need(name=='sql-prepared.json','only_actual_original_prepared_save_may_be_redirected')
        write(audit/'actual-prepared-observation.json',{'neverProductionPreparedACK':True,'value':value,'valueJson':cache.js_encoded(value).decode()})
    for node in ast.walk(fn):
        if isinstance(node,ast.Call)and ast.unparse(node)=="save('sql-prepared.json', value)":
            node.func=ast.Name(id='rollback_only_durable_observation',ctx=ast.Load());changed+=1
    need(changed==1,'exact_one_actual_prepared_save_redirect_only')
    scope={**cache.__dict__,'host':host,'before':before,'rehearsal':rehearsed,'rollback_only_durable_observation':audit_prepared}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FILE),'exec'),scope)
    return scope['prepared']

def _qualify_held(cache,host,capture_id):
    """The real apply runs and checks everything; its accepted ACK is absent."""
    identity=qualification_key(cache,host);audit=capture_directory(capture_id)
    need(not any(os.path.lexists(NEW_BASE/name)for name in['sql-intent.json','sql-prepared.json','sql-committed.json','prepared.json']),
        'held_rollback_qualification_only_before_new_actual_COMMIT_attempt')
    write(audit/'intent.json',{'format':FORMAT,'identity':identity,'rollbackOnly':True,'automaticRetryAllowed':False})
    prior,baseline=original_catalog(cache.prior_cache,host);before,rehearsed,_=stopped(cache,host)
    original=cache._sql_child;scope=QualificationScope(cache,host,audit);records={}
    def audit_save(name,value):
        need(name in{'apply-sql-child.json','apply-sql-opened.json'}and name not in records,'one_actual_held_child_and_opened_record_required')
        records[name]=copy.deepcopy(value);scope.transport_records[name]=copy.deepcopy(value);write(audit/name,value)
    # The original parent computes childFileSha256 through protected(BASE/name).
    # Redirect only these private qualification transport records to this audit.
    protected=original.__globals__['protected']
    def audit_read(path,*args,**kwargs):
        if Path(path).parent==cache.BASE and Path(path).name in records:return public(audit/Path(path).name)
        return protected(path,*args,**kwargs)
    rollback=rollback_transport(original,cache.prior_cache._sql_child,audit_save)
    rollback=types.FunctionType(rollback.__code__,{**rollback.__globals__,'protected':audit_read},rollback.__name__,rollback.__defaults__,rollback.__closure__)
    callback=prepared_callback(cache,host,before,rehearsed,audit)
    cache._sql_child=rollback;cache._continuation_qualification=scope;error=None
    try:
        cache.sql_child(host,'apply',rehearsed['sql']['result'],callback,plan_json=rehearsed['sql']['resultJson'])
    except BaseException as caught:error=caught
    finally:
        cache._sql_child=original
        for name in['_continuation_qualification','_continuation_approval_gate']:
            if hasattr(cache,name):delattr(cache,name)
    need(error is not None and scope.gate is not None and scope.packet is not None and scope.callback_finished is not None,
        'complete_actual_held_callback_then_refused_COMMIT_ACK_required')
    opened=records['apply-sql-opened.json']['message'];child=records['apply-sql-child.json']
    need(scope.packet['xid']==opened['xid']and opened['mode']==scope.packet['mode']=='apply'and
        opened['xid']!=PRIOR_XID,'actual_new_rollback_qualification_XID_and_same_prepared_packet_required')
    try:process=host.m.process(str(child['actor']['pid']))
    except(FileNotFoundError,ProcessLookupError):process=None
    need(process!=child['actor']and cache.xact_status(host,opened['xid'])=='aborted',
        'actual_rollback_only_child_epoch_gone_and_opened_XID_aborted_required')
    backend=opened['backend']
    need(type(backend['pid'])is int and backend['pid']>0 and re.fullmatch('[1-9][0-9]*',backend['backendStart']),
        'actual_rollback_qualification_backend_epoch_required')
    backend_sql="SELECT count(*)::int FROM pg_stat_activity WHERE pid="+str(backend['pid'])+" AND (extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text='"+backend['backendStart']+"' AND datid=17584 AND usesysid=10"
    need(host.query(backend_sql)==0,'actual_rollback_qualification_owned_backend_must_be_gone')
    _,after=original_catalog(cache.prior_cache,host)
    need(after['catalogSha256']==baseline['catalogSha256']and after['postProof']['allColumnAcl']==baseline['postProof']['allColumnAcl']and
        qualification_key(cache,host)==identity,'actual_complete_catalog_ROLLBACK_and_same_new_context_after_held_qualification')
    elapsed=scope.callback_finished-scope.gate['capturedMonotonicNanoseconds']
    need(0<elapsed and elapsed+COMMIT_RESERVE_NS<scope.gate['remainingNanoseconds'],
        'whole_actual_held_SQL_callback_and_reserve_must_fit_fresh_official_approval_TTL')
    value={'format':FORMAT,'completed':True,'identity':identity,'rollbackOnly':True,'completeHeldCallback':True,
        'elapsedNanoseconds':elapsed,'reserveNanoseconds':COMMIT_RESERVE_NS,'approvalGate':scope.gate,
        'transactionId':opened['xid'],'transactionStatus':'aborted','childGone':True,'backendGone':True,'catalogRestored':True,
        'actualPreparedPacketSha256':sha(cache.js_encoded(scope.packet)),'priorTimingReceiptUsed':False,
        'auditFiles':{name:sha(public(audit/name))for name in['intent.json','approval-before-launch.json','apply-sql-child.json',
            'apply-sql-opened.json','actual-prepared-observation.json','complete-held-callback.json']},
        'productionCOMMITQualified':False,'productionPreparedACKCreated':False,
        'transactionalCatalogMutationsRolledBack':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    digest=write(audit/'result.json',value)
    return{'format':FORMAT,'completed':True,'captureId':capture_id,'sha256':digest,'elapsedNanoseconds':elapsed,
        'rollbackOnly':True,'productionCOMMITQualified':False}

def qualify_held(cache,host,capture_id):
    valid=type(capture_id)is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',capture_id)
    existed=not valid or os.path.lexists(BASE/'captures'/capture_id)
    try:return _qualify_held(cache,host,capture_id)
    except BaseException as error:
        if valid and not existed:
            audit=BASE/'captures'/capture_id
            if (audit/'intent.json').exists()and not (audit/'result.json').exists()and not (audit/'failure.json').exists():
                write(audit/'failure.json',{'format':FORMAT,'completed':False,'rollbackOnly':True,
                    'failureType':type(error).__name__,'failureSha256':sha(str(error).encode()),
                    'transactionOutcomeQualified':False,'productionCOMMITQualified':False,'automaticRetryAllowed':False})
        raise

if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
    'priorAbortedQualified':False,'heldQualified':False,'productionCOMMITQualified':False}))
