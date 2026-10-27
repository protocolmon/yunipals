#!/usr/bin/env python3
"""One90s/30GET ownership API preview, preserving every existing service."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import fcntl
import errno
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import time
import types
import urllib.error
import urllib.parse
import urllib.request

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
PREFLIGHT_SHA='5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa'
FORMAT='yunipals-bounded-consumer-api-preview-v5'
BASE=Path('/var/backups/yunipals-unified-consumer-preview-v5-20261021')
LOCK=Path('/run/lock/yunipals-unified-consumer-api-preview.lock')
UNIT_DIRECTORY=Path('/run/systemd/system')
MAX_SECONDS=90
MAX_REQUESTS=30
SERVICES={'main':('yunipals-api.service','yunipals_unified_api',9101),'collector':('yunipals-collector-api.service','yunipals_unified_collector',9112),
          'islands':('yunipals-islands-api.service','yunipals_unified_islands_api',9115)}
REQUESTS={
 'main':('/health','/ready','/openapi.json','/v1/indexing-status?chain=base','/v1/tokens?chain=base&limit=1&metadata=all'),
 'collector':('/ready?chain=base','/v1/collector-capabilities?chain=base','/v2/owners/0x0000000000000000000000000000000000000001/tokens?chain=base&limit=1',
              '/v2/owners/0x0000000000000000000000000000000000000001/tokens?chain=base&limit=1&cursor=invalid'),
 'islands':('/health','/ready','/v2/collections/base-islands/superseded','/v2/collections/base-islands-v2/indexing-status',
            '/v2/collections/ethereum-islands/indexing-status','/v2/islands/indexing-status','/v2/collections/base-islands-v2/tokens?limit=1')}
PLAN_KEYS={'format','runId','service','maximumSeconds','maximumRequests','ownershipReviewFile','ownershipReviewSha256','ownershipAppliedFile','ownershipAppliedSha256'}
ERRORS={'ownership_source_unavailable','database_unavailable','islands_database_unavailable','ownership_rebuilding','islands_indexer_unavailable',
        'indexer_unavailable','metadata_unavailable','collector_filters_unavailable','invalid_collector_cursor','collection_superseded','invalid_cursor'}


def fail(message):raise RuntimeError(message)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def load_preflight():
    path=OPS/'consumer-runtime-preflight.py';raw=protected(path)
    if sha(raw)!=PREFLIGHT_SHA:fail('Exact consumer preflight required.')
    module=types.ModuleType('pinned_consumer_preview_preflight');module.__file__=str(path);exec(compile(raw,str(path),'exec'),module.__dict__);return module


def protected(path,maximum=40000000):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts:fail('Protected absolute operator input required.')
    for item in [*path.parents,path]:
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not(stat.S_ISDIR(info.st_mode) and info.st_mode&stat.S_ISVTX)):
            fail('Operator input ancestry differs.')
    if not path.is_file() or path.stat().st_size>maximum:fail('Bounded regular operator input required.')
    return path.read_bytes()


def validate_plan(plan):
    if (set(plan)!=PLAN_KEYS or plan['format']!=FORMAT or plan['service'] not in SERVICES or
        not re.fullmatch(r'20261021-[a-z0-9-]{1,32}',plan['runId']) or type(plan['maximumSeconds']) is not int or plan['maximumSeconds']!=90 or
        type(plan['maximumRequests']) is not int or plan['maximumRequests']!=30):fail('Exact one-at-a-time bounded preview plan required.')
    for path_key,sha_key in [('ownershipReviewFile','ownershipReviewSha256'),('ownershipAppliedFile','ownershipAppliedSha256')]:
        path,value=plan[path_key],plan[sha_key]
        if path is None and value is None:continue
        if (not isinstance(path,str) or not Path(path).is_absolute() or '..' in Path(path).parts or
            not isinstance(value,str) or not re.fullmatch(r'[0-9a-f]{64}',value)):fail('Exact public ownership preparation pins required.')


def unit_name(plan):return 'yunipals-unified-api-preview-v5-'+plan['runId']+'-'+plan['service']+'.service'
def marker(review_hash):return 'Yunipals bounded API preview '+review_hash


def database_url(helper,role):
    options='-c default_transaction_read_only=on -c statement_timeout=3000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000'
    query=urllib.parse.urlencode({'host':'/var/run/postgresql','port':'5432','user':role,'options':options})
    return 'postgresql:///'+helper.DATABASE+'?'+query


def environment(plan,helper,row):
    _,role,port=SERVICES[plan['service']]
    value={**row['proposed']['selectors'],'DATABASE_URL':database_url(helper,role),'API_HOST':'127.0.0.1','API_PORT':str(port),'COLLECTOR_API_PORT':str(port),
        'SOLANA_API_ENABLED':'false','SOLANA_LEGACY_METADATA_ENABLED':'false','PGPASSFILE':'/dev/null',
        'API_DB_ACQUIRE_TIMEOUT_MS':'1000','API_DB_STATEMENT_TIMEOUT_MS':'3000','API_DB_LOCK_TIMEOUT_MS':'1000','API_DB_IDLE_TRANSACTION_TIMEOUT_MS':'5000'}
    if plan['service']=='islands':value.update(API_ISLANDS_ENABLED='true',API_BASE_ISLANDS_ENABLED='true',API_ISLAND_STAKING_ENABLED='false')
    if value.get('OFFCHAIN_DB_POOL_MAX')!='2' or value.get('API_DB_POOL_MAX')!='2':fail('Both exact two-slot pools required.')
    if any(not re.fullmatch(r'[A-Z][A-Z0-9_]*',k) or any(c in str(v) for c in '\n\r\0') for k,v in value.items()):fail('Invalid public overlay.')
    return value


def env_content(value):
    # EnvironmentFile uses systemd quoting; only a backslash/double quote need
    # escaping in these fixed public selectors and password-free peer URL.
    return ''.join(k+'="'+str(v).replace('\\','\\\\').replace('"','\\"')+'"\n' for k,v in value.items())


def ordered_files(entries):
    result=[]
    for entry in entries:
        parsed=re.findall(r'([^ ;]+) \(ignore_errors=(yes|no)\)',entry)
        if ' '.join(path+' (ignore_errors='+optional+')' for path,optional in parsed)!=entry:fail('Exact ordered EnvironmentFile selectors required.')
        result.extend((path,optional=='yes') for path,optional in parsed)
    return result


def unit_content(plan,helper,row,overlay,review_hash,legacy_selectors=None):
    _,role,_=SERVICES[plan['service']];project=helper.ROOT/'apps/yunipals-indexer'
    files=ordered_files(legacy_selectors) if legacy_selectors is not None else [(path,False) for path in row['observed']['environmentFiles']]
    if [path for path,_ in files]!=row['observed']['environmentFiles']:fail('Original private EnvironmentFile order changed.')
    files=files+[(str(overlay),False)]
    if any(not re.fullmatch(r'/[A-Za-z0-9_./-]+',path) or '..' in Path(path).parts for path,_ in files):fail('Exact safe ordered EnvironmentFile selectors required.')
    argv=helper.NODE+' --import tsx '+str(project/helper.ENTRYPOINTS[row['unit']])
    settings={'Type':'simple','User':role,'Group':role,'SupplementaryGroups':'','WorkingDirectory':str(project),'ExecStart':argv,'RuntimeMaxSec':'90',
        'TimeoutStopSec':'10','KillMode':'control-group','Restart':'no','MemoryMax':'536870912','MemorySwapMax':'0','CPUQuota':'50%','TasksMax':'64',
        'NoNewPrivileges':'yes','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','RestrictSUIDSGID':'yes','UMask':'0077',
        'IPAddressDeny':'any','IPAddressAllow':'127.0.0.0/8 ::1','RestrictAddressFamilies':'AF_UNIX AF_INET AF_INET6','StandardOutput':'journal','StandardError':'journal'}
    return '[Unit]\nDescription='+marker(review_hash)+'\n[Service]\n'+''.join(k+'='+v+'\n' for k,v in settings.items())+''.join('EnvironmentFile='+('-' if optional else '')+path+'\n' for path,optional in files)


def definitions(helper,row):
    observed=row['observed'];paths=[observed['FragmentPath'],*observed['DropInPaths'].split()]
    return {path:sha(helper.protected(Path(path),2000000)) for path in paths}


def ownership_evidence(plan,helper,role):
    if plan['ownershipReviewFile'] is None or plan['ownershipAppliedFile'] is None:return None
    documents=[]
    for key in ['ownershipReview','ownershipApplied']:
        raw=protected(plan[key+'File'],200000)
        if sha(raw)!=plan[key+'Sha256']:fail('Ownership grant evidence changed.')
        documents.append(json.loads(raw))
    review,applied=documents
    if review.get('format')!='yunipals-ownership-readview-grants-review-v1' or applied.get('format')!='yunipals-ownership-readview-grants-applied-v1':
        fail('Distinct reviewed and actual ownership grant proofs required.')
    view=review['readView']
    if (applied.get('applied') is not True or applied.get('readView')!=view or view.get('schema')!=helper.READ_SCHEMA or
        view.get('consumerSourceDigest')!=helper.SOURCE or view.get('sourceManifestSha256')!=helper.MANIFEST_SHA or
        view.get('buildId')!='bf4939b3ff' or view.get('releaseId')!='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c' or
        view.get('manifestHash')!='0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029' or
        view.get('identity')!='0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc' or
        view.get('ownerCliSha256')!='6332482b24b04dd7e02f350ecb8658f8538ed515501be803f943ef6d86be31cf' or
        view.get('expectedDdlSha256')!='93e0d6b4303efb06bc08f2a84301474ff02718021c1be79958c9610b5391c14b'):fail('Ownership read source/9ee identity differs.')
    before=next((r for r in review['roles'] if r.get('role')==role),None);after=next((r for r in applied['roles'] if r.get('role')==role),None)
    if before is None or after is None or after.get('applied') is not True or any(after.get(k)!=before.get(k) for k in ['role','schemas','relations','functions','privileges','schemaCreate','sourceControlReadWrites','roleMemberships','securityDefinerFunctions','graphSha256']):
        fail('Actual selected-role ownership graph differs from its review.')
    graph={k:before[k] for k in ['role','schemas','relations','functions','privileges','schemaCreate','sourceControlReadWrites','roleMemberships','securityDefinerFunctions']}
    if (graph['privileges']!={'schema':['USAGE'],'relation':['SELECT'],'function':['EXECUTE']} or
        any(graph[k] is not False for k in ['schemaCreate','sourceControlReadWrites','roleMemberships']) or graph['securityDefinerFunctions']!=[]):fail('Read-only INVOKER graph required.')
    if before.get('graphSha256')!=sha(encoded(graph)):fail('Ownership role graph hash differs.')
    allowed={helper.SCHEMA,helper.READ_SCHEMA,helper.CONTROL}
    if (len(graph['schemas'])>3 or set(graph['schemas'])-allowed or len(graph['relations'])>100 or len(graph['functions'])>20):fail('Ownership grant graph exceeds fixed EVM scope.')
    for name in graph['relations']:
        if not re.fullmatch(r'[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*',name) or name.split('.')[0] not in allowed:fail('Unexpected ownership relation selector.')
    for name in graph['functions']:
        if not re.fullmatch(r'[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\((?:text|boolean)?\)',name) or name.split('.')[0] not in allowed:fail('Unexpected ownership function selector.')
    return {'readView':view,'graph':graph,'graphSha256':before['graphSha256']}


def current_ownership(helper,evidence,role):
    if evidence is None:return {'verified':False,'reason':'ownership_review_or_applied_evidence_missing'}
    literal=lambda x:"'"+x.replace("'","''")+"'"
    graph=evidence['graph'];checks=[]
    for kind,values in [('schema',graph['schemas']),('table',graph['relations']),('function',graph['functions'])]:
        privilege='USAGE' if kind=='schema' else 'SELECT' if kind=='table' else 'EXECUTE'
        checks.extend('has_'+kind+'_privilege('+literal(role)+','+literal(name)+','+literal(privilege)+')' for name in values)
    checks.append('NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname='+literal(role)+')')
    scope=','.join(literal(v) for v in [helper.SCHEMA,helper.READ_SCHEMA,helper.CONTROL])
    checks.append('NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind=\'S\' AND n.nspname IN('+scope+') AND CASE WHEN c.relkind=\'S\' THEN has_sequence_privilege('+literal(role)+',c.oid,\'USAGE,UPDATE\') ELSE false END)')
    all_grants=' AND '.join(checks) or 'false'
    marker_name=helper.READ_SCHEMA+'._unified_read_release'
    exists=helper.sql('SELECT jsonb_build_object(\'exists\',to_regclass('+literal(marker_name)+') IS NOT NULL)')['exists']
    if not exists:return {'verified':False,'reason':'ownership_read_schema_missing'}
    value=helper.sql('SELECT jsonb_build_object(\'identity\',identity,\'releaseId\',release_id,\'manifestHash\',manifest_hash,\'grants\','+all_grants+') FROM '+marker_name+' WHERE singleton') or {}
    expected=evidence['readView'];valid=value=={'identity':expected['identity'],'releaseId':expected['releaseId'],'manifestHash':expected['manifestHash'],'grants':True}
    return {'verified':valid,'identity':value.get('identity'),'graphSha256':evidence['graphSha256'],'reason':None if valid else 'ownership_identity_or_read_grants_unavailable'}


def minimal_operational_reads(helper,role):
    # Archive middleware reads this existing operational table before its
    # shared-source guard. Never discover/grant schema-wide permissions here.
    if role not in {value[1] for value in SERVICES.values()}:fail('Exact preview role required.')
    sql="""SELECT jsonb_build_object('relationPresent',relation IS NOT NULL,
      'schemaUsage',CASE WHEN schema IS NULL THEN false ELSE has_schema_privilege('ROLE',schema,'USAGE') END,
      'select',CASE WHEN relation IS NULL THEN false ELSE has_table_privilege('ROLE',relation,'SELECT') END)
      FROM (SELECT to_regnamespace('metadata') AS schema,to_regclass('metadata.chain_readiness') AS relation) fixed""".replace('ROLE',role)
    value=helper.sql(sql)
    verified=all(value.get(key) is True for key in ['relationPresent','schemaUsage','select'])
    return {'verified':verified,'relations':['metadata.chain_readiness'],'privileges':['USAGE','SELECT'],
      'relationPresent':value.get('relationPresent') is True,'schemaUsage':value.get('schemaUsage') is True,'select':value.get('select') is True,
      'completeOperationalGrantGraphAccepted':False}


def review(plan,helper):
    validate_plan(plan);matrix=helper.matrix();runtime=helper.runtime();unit,role,port=SERVICES[plan['service']]
    row=next(row for row in matrix['services'] if row['unit']==unit)
    states={r['unit']:helper.state(r['unit']) for r in matrix['services']};public={r['unit']:helper.public_unit(r,states[r['unit']]) for r in matrix['services']}
    healthy=all(p['active'] and p['invocationId'] and p['knownPublicArgvMatches'] and p['knownWorkingDirectoryMatches'] and p['orderedEnvironmentSelectorsMatchBaseline'] and p['knownOsIdentityMatches'] and p['publicEntrypointSha256'] is not None for p in public.values())
    listeners=helper.sockets()
    for legacy in public.values():
        live=legacy['baselinePort']
        if live is not None and not (listeners[str(live)] and all(item['loopback'] and legacy['mainPid'] in item['pids'] for item in listeners[str(live)])):healthy=False
    ports_free=all(not listeners[str(p)] for _,_,p in SERVICES.values())
    catalog=helper.sql(helper.catalog_sql());room=helper.capacity(catalog['capacity']);pg=next(r for r in catalog['roles'] if r['name']==role)
    identity=helper.os_identity(role);restricted=helper.role_restricted(pg);hba=helper.hba_compatible(role,catalog)
    peer={'verified':False}
    if identity['restricted'] and restricted and hba:peer=helper.peer_identity(role,identity)
    evidence=ownership_evidence(plan,helper,role);ownership=current_ownership(helper,evidence,role);operational=minimal_operational_reads(helper,role)
    eligible=all([runtime.get('verified') is True,runtime.get('publicRuntimeReadableAndTraversable') is True,healthy,ports_free,identity['restricted'],restricted,hba,peer['verified'],ownership['verified'],operational['verified'],room['sequentialPreviewHeadroomObserved']])
    current=helper.run(['/usr/bin/systemctl','show',unit_name(plan),'--property=LoadState'])
    if current!='LoadState=not-found':fail('Fresh preview unit required.')
    directory=BASE/(plan['runId']+'-'+plan['service'])
    if directory.exists() or directory.is_symlink():fail('Preview evidence is never overwritten.')
    hashes={r['unit']:definitions(helper,r) for r in matrix['services']}
    selectors={key:states[key]['EnvironmentFilesEntries'] for key in states}
    overlay=directory/'public-preview.env';env=environment(plan,helper,row)
    binding={'format':FORMAT,'plan':plan,'helperSha256':sha(protected(Path(__file__).absolute())),'preflightHelperSha256':PREFLIGHT_SHA,'matrixSha256':helper.MATRIX_SHA,
        'sourceRuntime':runtime,'entrypointManifestSha256':row['proposed']['entrypointManifestSha256'],'legacyPublicState':public,'legacyDefinitionHashes':hashes,
        'legacyEnvironmentSelectors':selectors,'dedicatedOs':identity,'dedicatedPostgres':pg,'simplePeerVerified':hba,'peerIdentity':peer,'ownership':ownership,'minimalOperationalReads':operational,
        'publicEnvironment':env,'overlayPath':str(overlay),'capacity':{k:v for k,v in room.items() if k not in {'clientSessions','activeClientSessions','freeOrdinarySlots'}},
        'previewPort':port,'role':role,'requests':list(REQUESTS[plan['service']]),'maximumSeconds':90,'maximumRequests':30,'sourceAcceptanceVerified':False,
        'fullRouteParityLatencyAccepted':False,'operationalMetadataStakingGrantsAccepted':False,'signedVisibilityWritesAllowed':False,'solanaEnabled':False,
        'legacyServicesModified':False,'newCredentials':False,'capacityReservationClaimed':False,'exclusiveSequentialLeaseRequired':True}
    # Current session counts are deliberately observations, not immutable hash
    # fields. Apply must freshly pass the same22-slot admission threshold.
    return {'reviewHash':sha(encoded(binding)),'binding':binding,'previewEligible':eligible,'capacityObservation':room,'portsUnused':ports_free,
        'missing':{'loginOrRestrictedRole':not restricted,'dedicatedPeer':not peer['verified'],'ownershipGrantIdentity':not ownership['verified'],
            'minimalOperationalReads':not operational['verified'],'runtime':not runtime.get('verified'),'legacyHealthy':not healthy,'ports':not ports_free,'sessionHeadroom':not room['sequentialPreviewHeadroomObserved']},
        'sourceAcceptanceVerified':False,'cutoverEligible':False,'started':False},(row,directory,public,hashes)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_a,**_k):fail('Preview redirects forbidden.')


def transport_failure(problem):
    reason=problem.reason if isinstance(problem,urllib.error.URLError) else problem
    outer='URLError' if isinstance(problem,urllib.error.URLError) else 'TimeoutError' if isinstance(problem,TimeoutError) else 'ConnectionError'
    known={errno.ECONNREFUSED:('connection_refused','ECONNREFUSED'),errno.ETIMEDOUT:('timed_out','ETIMEDOUT'),
      errno.EACCES:('permission_denied','EACCES'),errno.EPERM:('permission_denied','EPERM'),errno.ENETUNREACH:('network_unreachable','ENETUNREACH'),
      errno.EHOSTUNREACH:('host_unreachable','EHOSTUNREACH'),errno.ECONNRESET:('connection_reset','ECONNRESET'),errno.EADDRNOTAVAIL:('address_unavailable','EADDRNOTAVAIL')}
    code=getattr(reason,'errno',None)
    kind,name=known.get(code,('timed_out',None) if isinstance(reason,TimeoutError) else ('unknown_transport_failure',None))
    return {'unavailable':outer,'transportFailure':kind,'transportErrno':name}


def request(port,path,*,timeout=2):
    if port not in {v[2] for v in SERVICES.values()} or path not in {p for values in REQUESTS.values() for p in values}:fail('Unapproved fixed GET preview request.')
    req=urllib.request.Request('http://127.0.0.1:'+str(port)+path,method='GET',headers={'accept':'application/json'})
    if not isinstance(timeout,(int,float)) or isinstance(timeout,bool) or not 0<timeout<=2:fail('Bounded positive GET timeout required.')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:response=opener.open(req,timeout=timeout)
    except urllib.error.HTTPError as error:response=error
    with response:
        raw=response.read(1000001)
        if len(raw)>1000000:fail('Preview response cap exceeded.')
        value=None
        try:value=json.loads(raw)
        except (ValueError,UnicodeError):pass
        error=value.get('error') if isinstance(value,dict) else None
        return {'status':response.code,'bytes':len(raw),'sha256':sha(raw),'releaseHeader':response.headers.get('X-Indexer-Release'),
            'error':error if error in ERRORS else None,'unknownErrorWithheld':error is not None and error not in ERRORS}


def own_state(helper,unit):
    keys=['Id','Description','LoadState','ActiveState','SubState','InvocationID','MainPID']
    raw=helper.run(['/usr/bin/systemctl','show',unit,*['--property='+key for key in keys]],timeout=3)
    value=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
    if set(value)!=set(keys):fail('Exact preview unit metadata required.')
    return value


def verify_preview(plan,helper,row,invocation,review_hash,selectors,overlay,overlay_raw):
    unit,role,port=SERVICES[plan['service']];name=unit_name(plan);project=helper.ROOT/'apps/yunipals-indexer'
    keys=['User','Group','SupplementaryGroups','WorkingDirectory','ExecStart','EnvironmentFiles','RuntimeMaxUSec','MemoryMax','MemorySwapMax','Description',
        'CPUQuotaPerSecUSec','Restart','NoNewPrivileges','ProtectSystem','ProtectHome','PrivateTmp','IPAddressDeny','IPAddressAllow','InvocationID','MainPID','ActiveState']
    raw=helper.run(['/usr/bin/systemctl','show',name,*['--property='+k for k in keys]],timeout=3);value={};envfiles=[]
    for line in raw.splitlines():
        key,sep,item=line.partition('=')
        if not sep or key not in keys:fail('Unexpected owned preview metadata.')
        if key=='EnvironmentFiles':envfiles.append(item);continue
        if key in value:fail('Unexpected repeated owned preview metadata.')
        value[key]=item
    value['EnvironmentFilesEntries']=envfiles
    expected={'User':role,'Group':role,'SupplementaryGroups':'','WorkingDirectory':str(project),'MemoryMax':'536870912','MemorySwapMax':'0',
        'Restart':'no','NoNewPrivileges':'yes','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','InvocationID':invocation,'ActiveState':'active','Description':marker(review_hash)}
    if (set(value)!=(set(keys)-{'EnvironmentFiles'})|{'EnvironmentFilesEntries'} or any(value[k]!=v for k,v in expected.items()) or value['RuntimeMaxUSec'] not in {'1min 30s','90s'} or
        value['CPUQuotaPerSecUSec']!='500ms' or not value['MainPID'].isdigit() or int(value['MainPID'])<=0):fail('Owned preview resources/identity differ.')
    argv=helper.NODE+' --import tsx '+str(project/helper.ENTRYPOINTS[unit])
    if re.findall(r'argv\[\]=(.*?)\s+;',value['ExecStart'])!=[argv] or re.findall(r'(?:^|[ {;])path=([^ ;]+)',value['ExecStart'])!=[helper.NODE]:
        fail('Preview entrypoint differs.')
    if ordered_files(value['EnvironmentFilesEntries'])!=ordered_files(selectors)+[(str(overlay),False)]:fail('Preview private selector order/optionality differs.')
    def networks(text):
        if text=='any':return {'0.0.0.0/0','::/0'}
        return {str(ipaddress.ip_network(x,strict=False)) for x in text.split()}
    if networks(value['IPAddressDeny'])!={'0.0.0.0/0','::/0'} or networks(value['IPAddressAllow'])!={'127.0.0.0/8','::1/128'}:
        fail('Preview network confinement differs.')
    if protected(overlay,20000)!=overlay_raw:fail('Owned public preview environment changed.')
    listeners=helper.sockets()[str(port)]
    if not listeners or any(not item['loopback'] or int(value['MainPID']) not in item['pids'] for item in listeners):fail('Preview loopback listener is not owned.')
    return {'unit':name,'invocation':invocation,'pid':int(value['MainPID']),'propertiesSha256':sha(encoded(value)),'loopbackListenerVerified':True}


def save(path,value):
    with path.open('xb') as handle:os.fchmod(handle.fileno(),0o600);handle.write(encoded(value)+b'\n');handle.flush();os.fsync(handle.fileno())


def stop_owned(helper,unit,invocation,review_hash,unit_file,content):
    own=own_state(helper,unit)
    if own['LoadState']!='not-found':
        if own['Description']!=marker(review_hash) or (invocation is not None and own['InvocationID']!=invocation):fail('Refusing another preview owner.')
        if own['ActiveState'] not in {'inactive','failed'}:helper.run(['/usr/bin/systemctl','stop',unit],timeout=15)
    if unit_file.exists():
        if unit_file.is_symlink() or protected(unit_file,20000)!=content.encode():fail('Refusing changed preview definition.')
        unit_file.unlink();helper.run(['/usr/bin/systemctl','daemon-reload'],timeout=15)


def directory_protected(path):
    for entry in [*Path(path).parents,Path(path)]:
        info=entry.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not info.st_mode&stat.S_ISVTX):fail('Protected preview directory ancestry required.')


def apply(plan,helper,expected):
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a') as lease:
        info=os.fstat(lease.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:fail('Private sequential preview lease required.')
        fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result,(row,directory,public,hashes)=review(plan,helper)
        if result['reviewHash']!=expected or not result['previewEligible']:fail('Fresh exact eligible preview review required; nothing started.')
        if BASE.exists() and (BASE.is_symlink() or BASE.stat().st_uid!=0 or BASE.stat().st_mode&0o077):fail('Private preview evidence parent required.')
        directory_protected(BASE.parent);directory_protected(UNIT_DIRECTORY)
        BASE.mkdir(mode=0o700,exist_ok=True);directory.mkdir(mode=0o700);save(directory/'review.json',result)
        overlay=directory/'public-preview.env';overlay_raw=env_content(result['binding']['publicEnvironment']).encode()
        with overlay.open('xb') as handle:os.fchmod(handle.fileno(),0o600);handle.write(overlay_raw)
        unit=unit_name(plan);unit_file=UNIT_DIRECTORY/unit;content=unit_content(plan,helper,row,overlay,expected,result['binding']['legacyEnvironmentSelectors'][row['unit']])
        invocation=None;attempts=[];error=None;definition_created=False;started=time.monotonic()
        try:
            # Recheck actual reserved/global capacity immediately before start;
            # no role-limit failure is used as a capacity backpressure strategy.
            if not helper.capacity(helper.sql(helper.catalog_sql())['capacity'])['sequentialPreviewHeadroomObserved']:fail('Fresh session reserve unavailable.')
            with unit_file.open('x') as handle:
                definition_created=True;handle.write(content)
            helper.run(['/usr/bin/systemctl','daemon-reload'],timeout=15);helper.run(['/usr/bin/systemctl','start',unit],timeout=10)
            own=own_state(helper,unit);invocation=own['InvocationID']
            if own['Description']!=marker(expected) or not re.fullmatch(r'[0-9a-f]{32}',invocation):fail('Preview invocation unavailable.')
            def observe_request(path,deadline=None):
                before=time.monotonic();remaining=started+MAX_SECONDS-before
                if deadline is not None:remaining=min(remaining,deadline-before)
                if len(attempts)>=MAX_REQUESTS or remaining<=0:fail('Preview hard request/time cap reached.')
                record={'path':path};attempts.append(record)
                try:item=request(SERVICES[plan['service']][2],path,timeout=min(2,remaining))
                except (ConnectionError,urllib.error.URLError,TimeoutError) as problem:item=transport_failure(problem)
                except Exception as problem:
                    record['errorClass']=type(problem).__name__;raise
                finally:record['elapsedMs']=round((time.monotonic()-before)*1000,2)
                record.update(item)
                return item
            first=REQUESTS[plan['service']][0];response=None
            startup_deadline=min(started+MAX_SECONDS,time.monotonic()+45)
            startup_limit=MAX_REQUESTS-len(REQUESTS[plan['service']])+1
            for attempt in range(startup_limit):
                response=observe_request(first,startup_deadline)
                if 'unavailable' not in response:break
                remaining=startup_deadline-time.monotonic()
                if remaining<=0:break
                if attempt+1<startup_limit:time.sleep(min(1.5,remaining))
            if response is None or 'unavailable' in response:fail('Preview startup unavailable within bounded probes.')
            for index,path in enumerate(REQUESTS[plan['service']]):
                item=response if index==0 else observe_request(path)
                if 'unavailable' in item:fail('Preview route transport unavailable.')
                verify_preview(plan,helper,row,invocation,expected,result['binding']['legacyEnvironmentSelectors'][row['unit']],overlay,overlay_raw)
                current=own_state(helper,unit)
                if current['InvocationID']!=invocation or current['ActiveState']!='active':fail('Preview source process stopped or changed.')
                if any(helper.public_unit(r,helper.state(r['unit']))!=public[r['unit']] or definitions(helper,r)!=hashes[r['unit']] for r in helper.matrix()['services']):
                    fail('An existing service changed during preview.')
                if (item.get('status')==200 and item.get('releaseHeader') is None) or item.get('releaseHeader') not in {None,'0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'}:fail('Preview release header mismatch.')
                if item.get('status') not in {200,400,409,410,503}:fail('Unexpected preview route status.')
        except (KeyboardInterrupt,SystemExit):error={'class':'OperatorInterrupt'}
        except Exception as problem:error={'class':type(problem).__name__}
        finally:
            cleanup=None
            try:
                if definition_created:stop_owned(helper,unit,invocation,expected,unit_file,content)
            except Exception as problem:cleanup=type(problem).__name__
            final={'format':FORMAT,'reviewHash':expected,'previewUnit':unit,'invocation':invocation,'requests':attempts,'requestCount':len(attempts),
                'elapsedSeconds':round(time.monotonic()-started,2),'error':error,'cleanupError':cleanup,'legacyServicesModified':False,'sourceAcceptanceVerified':False,
                'cutoverEligible':False,'fullRouteParityLatencyAccepted':False,'privateEnvironmentValuesRead':False,'responseRowsExported':False,
                'solanaRequests':0,'newCredentials':False,'signedVisibilityWrites':False,'databaseDmlAllowed':False,'capacityReservationClaimed':False}
            save(directory/'result.json',final)
        if error or cleanup:fail('Preview incomplete; protected bounded evidence retained.')
        return final


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--apply');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('Exact root/host required.')
    helper=load_preflight();plan=json.loads(protected(args.plan,20000))
    if args.apply:
        if not re.fullmatch(r'[0-9a-f]{64}',args.apply):fail('Exact preview review hash required.')
        signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit()))
        print(json.dumps(apply(plan,helper,args.apply),indent=2))
    else:print(json.dumps(review(plan,helper)[0],indent=2))


if __name__=='__main__':main()
