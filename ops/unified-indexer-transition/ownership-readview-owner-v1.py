#!/usr/bin/env python3
"""Create only fresh v3 ownership views/common NOLOGIN reads; never cut over."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import grp
import re
import signal
import socket
import stat
import subprocess
import types
import urllib.parse

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
PREFLIGHT_SHA='5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa'
PLANNER_SHA='656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877'
REVIEW_SHA='1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59'
GRANTS_SHA='72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49'
CATALOG_SHA='24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813'
CLI_SHA='6332482b24b04dd7e02f350ecb8658f8538ed515501be803f943ef6d86be31cf'
NODE_SHA='f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
SOURCE_ROLE='yunipals_unified_shadow'
BASE=Path('/var/backups/yunipals-ownership-readview-owner-v1-20261021')
LOCK=Path('/run/lock/yunipals-ownership-readview-owner-v1.lock')
FORMAT='yunipals-ownership-readview-owner-review-v1'
PHASE='review'
ROLES=('yunipals_unified_api','yunipals_unified_collector','yunipals_unified_read_cache','yunipals_unified_islands_api')


def fail(message):raise RuntimeError(message)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def literal(value):return "'"+str(value).replace("'","''")+"'"
def identifier(value):
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}',value):fail('Fixed SQL identifier required.')
    return '"'+value+'"'


def protected(path,maximum=40000000):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts:fail('Protected public absolute path required.')
    for entry in [*path.parents,path]:
        info=entry.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not(stat.S_ISDIR(info.st_mode) and info.st_mode&stat.S_ISVTX)):
            fail('Public operator ancestry changed.')
    before=path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size>maximum:fail('Bounded public regular input required.')
    raw=path.read_bytes();after=path.stat()
    identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if len(raw)>maximum or identity(before)!=identity(after):fail('Public input changed while reading.')
    return raw


def clean():return {'PATH':'/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
def run(args,*,data=None,cwd=None,timeout=15):
    result=subprocess.run(args,input=data,text=True,capture_output=True,env=clean(),cwd=cwd,timeout=timeout)
    if result.returncode:fail('Bounded owner command failed; raw diagnostics withheld.')
    if len(result.stdout.encode())>2000000:fail('Owner output bound exceeded.')
    return result.stdout.strip()


def load_inputs():
    raw=protected(OPS/'consumer-runtime-preflight.py')
    if digest(raw)!=PREFLIGHT_SHA:fail('Pinned preflight changed.')
    helper=types.ModuleType('ownership_owner_preflight');helper.__file__=str(OPS/'consumer-runtime-preflight.py');exec(compile(raw,helper.__file__,'exec'),helper.__dict__)
    values={}
    for name,file,sha in [('planner','ownership-readview-plan.mjs',PLANNER_SHA),('review','ownership-readview-plan.review.json',REVIEW_SHA),
                          ('grants','ownership-common-grants.review.sql',GRANTS_SHA),('catalog','ownership-readview-catalog.review.sql',CATALOG_SHA)]:
        value=protected(OPS/file)
        if digest(value)!=sha:fail('Frozen ownership preparation input changed.')
        values[name]=value
    plan=json.loads(values['review'])
    if plan.get('reviewHash')!=digest(encoded({k:v for k,v in plan.items() if k!='reviewHash'})) or plan.get('applied') is not False or plan.get('catalog') is not None:
        fail('Exact unapplied frozen read-view plan required.')
    if digest(values['grants'])!=plan['commonGrantsSha256'] or values['grants'].decode()!=plan['commonGrantsSql'] or values['catalog'].decode()!=plan['catalogQuery']:
        fail('Exact frozen SQL bodies required.')
    if [row['role'] for row in plan['roles']]!=list(ROLES):fail('Exact four consumers required.')
    cli=helper.ROOT/'apps/yunipals-indexer/scripts/unified-ownership-views.ts'
    if digest(protected(cli))!=CLI_SHA:fail('Frozen official owner CLI changed.')
    if digest(protected(Path(helper.NODE),150000000))!=NODE_SHA:fail('Exact public Node executable changed.')
    return helper,plan,values


def peer_prefix(role):
    if role not in {'postgres',SOURCE_ROLE}:fail('Only owner or retained source peer admitted.')
    user,group=pwd.getpwnam(role),grp.getgrnam(role)
    if user.pw_uid<=0 or user.pw_gid!=group.gr_gid:fail('Matching nonroot Unix peer identity required.')
    return ['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups','/usr/bin/env','-i',
            'PATH=/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG=C.UTF-8','TZ=UTC']


def sql(text,*,role='postgres',write=False):
    options='-c statement_timeout=8000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=10000 -c application_name=ownership_readview_owner_v1'
    if not write:options+=' -c default_transaction_read_only=on'
    args=[*peer_prefix(role),'PGHOST=/var/run/postgresql','PGPORT=5432','PGUSER='+role,'PGDATABASE=yunipals_backfill','PGPASSFILE=/dev/null',
          'PGOPTIONS='+options,'/usr/bin/psql','-XwqAt','-v','ON_ERROR_STOP=1']
    return run(args,data=text,timeout=25)


def json_sql(text,*,role='postgres'):
    return json.loads(sql('BEGIN READ ONLY;\n'+text+';\nROLLBACK;',role=role))


def selector_sql():
    return "SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'release',release_id) ORDER BY name),'[]'::jsonb) FROM yunipals_indexer_control.active_release"


def source_acl_sql(helper):
    # Same retained peer policy, excluding Solana namespaces before privilege evaluation.
    return f"""SELECT jsonb_build_object('sessionUser',session_user,'currentUser',current_user,
      'role',(SELECT jsonb_build_object('oid',oid::text,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls) FROM pg_roles WHERE rolname=current_user),
      'sourceOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname={literal(helper.SCHEMA)}),
      'schemaCreate',has_schema_privilege(current_user,{literal(helper.SCHEMA)},'CREATE'),'databaseSchemaCreate',has_database_privilege(current_user,current_database(),'CREATE'),
      'cacheUsage',has_schema_privilege(current_user,'ponder_sync','USAGE'),'cacheCreate',has_schema_privilege(current_user,'ponder_sync','CREATE'),
      'legacyOwnerInherited',pg_has_role(current_user,'yunipals','USAGE'),
      'dataDml',(SELECT count(*)=36 AND bool_and(has_table_privilege(current_user,c.oid,privilege)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege WHERE n.nspname='ponder_sync' AND c.relname IN('blocks','transactions','logs','intervals','traces','transaction_receipts','rpc_request_results','factories','factory_addresses')),
      'migrationReads',(SELECT count(*)=2 AND bool_and(has_table_privilege(current_user,c.oid,'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync' AND c.relname IN('kysely_migration','kysely_migration_lock')),
      'migrationWrites',(SELECT bool_or(has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync' AND c.relname IN('kysely_migration','kysely_migration_lock')),
      'sequences',(SELECT count(*)=2 AND bool_and(has_sequence_privilege(current_user,c.oid,'USAGE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ponder_sync' AND c.relname IN('factories_id_seq','factory_addresses_id_seq')),
      'otherPublicReads',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT ILIKE '%solana%' AND n.nspname NOT IN('information_schema','ponder_sync',{literal(helper.SCHEMA)}) AND c.relkind IN('r','p','v','m') AND has_table_privilege(current_user,c.oid,'SELECT')),
      'aclFingerprint',(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'owner',c.relowner,'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor,'grantee',a.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) FROM aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a WHERE a.grantee NOT IN(SELECT oid FROM pg_roles WHERE rolname IN({','.join(literal(role) for role in ROLES)})))) ORDER BY n.nspname,c.relname)::text,'[]')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN({literal(helper.SCHEMA)},'ponder_sync',{literal(helper.CONTROL)}) AND c.relkind IN('r','p','v','m','S')),
      'schemaAclFingerprint',(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('schema',nspname,'owner',nspowner,'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor,'grantee',a.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) FROM aclexplode(COALESCE(nspacl,acldefault('n',nspowner))) a WHERE a.grantee NOT IN(SELECT oid FROM pg_roles WHERE rolname IN({','.join(literal(role) for role in ROLES)})))) ORDER BY nspname)::text,'[]')) FROM pg_namespace WHERE nspname IN({literal(helper.SCHEMA)},'ponder_sync',{literal(helper.CONTROL)})))"""


def validate_source(value):
    if (value.get('sessionUser')!=SOURCE_ROLE or value.get('currentUser')!=SOURCE_ROLE or value.get('sourceOwner')!=SOURCE_ROLE or
        not re.fullmatch(r'[1-9][0-9]*',value.get('role',{}).get('oid','')) or any(value['role'].get(k) is not False for k in ['super','createDb','createRole','replication','bypassRls']) or
        any(value.get(k) is not True for k in ['schemaCreate','databaseSchemaCreate','cacheUsage','dataDml','migrationReads','sequences']) or
        any(value.get(k) is not False for k in ['cacheCreate','legacyOwnerInherited','migrationWrites']) or value.get('otherPublicReads')!=0):fail('Retained source peer ACL prerequisite differs.')
    return value


def normalize_catalog(value):
    # Only these moving runtime observations are excluded; frozen planner validates them first.
    copy=json.loads(json.dumps(value));runtime=copy['runtime']
    copy['runtime']={'version':runtime['version'],'build_id':runtime['build_id'],'is_dev':int(runtime['is_dev'])}
    for row in copy['roles']:row['oid']=int(row['oid'])
    return copy


def validate_post_source(catalog,binding):
    expected=json.loads(json.dumps(binding['catalog']));expected['readSchemaAbsent']=False
    if catalog.get('readSchemaAbsent') is not False or normalize_catalog(catalog)!=expected:fail('Registered/native source or dormant-role identity changed after owner work.')
    return {'sourceIdentityUnchanged':True,'runtimeObservation':catalog['runtime']}


def recorder(helper,catalog):
    bridge="import fs from 'node:fs';import {prepare} from '"+str(OPS/'ownership-readview-plan.mjs')+"';console.log(JSON.stringify(await prepare({root:"+json.dumps(str(helper.ROOT))+",inventoryPath:"+json.dumps(str(helper.INVENTORY))+",matrixPath:"+json.dumps(str(helper.MATRIX))+",catalogSnapshot:JSON.parse(fs.readFileSync(0,'utf8'))})));"
    return json.loads(run([helper.NODE,'--import','tsx','--input-type=module','-e',bridge],data=json.dumps(catalog),cwd=str(helper.ROOT/'apps/yunipals-indexer'),timeout=60))


def review(helper,plan,inputs):
    global PHASE
    PHASE='fresh_public_runtime_and_evm_catalog';helper.matrix();runtime=helper.runtime()
    if runtime.get('verified') is not True or runtime.get('publicRuntimeReadableAndTraversable') is not True:fail('Verified public consumer runtime required.')
    identities={role:helper.os_identity(role) for role in ROLES}
    if any(row.get('restricted') is not True for row in identities.values()):fail('Four actual restricted OS identities required.')
    catalog=json.loads(sql(inputs['catalog'].decode()));current=recorder(helper,catalog)
    if current['readView']!=plan['readView'] or current['roles']!=plan['roles'] or current['commonGrantsSha256']!=GRANTS_SHA:fail('Official immutable plan differs.')
    selector=json_sql(selector_sql())
    if selector!=[]:fail('Unused active selector required; no cutover allowed.')
    source=validate_source(json_sql(source_acl_sql(helper),role=SOURCE_ROLE))
    binding={'format':FORMAT,'helperSha256':digest(protected(Path(__file__).absolute())),'plannerSha256':PLANNER_SHA,'frozenReviewSha256':REVIEW_SHA,
      'readView':plan['readView'],'roles':plan['roles'],'sourceRuntime':runtime,'catalog':normalize_catalog(catalog),'dedicatedOs':identities,
      'sourcePeerAcl':source,'activeSelector':selector,'commonGrantsSha256':GRANTS_SHA,'ownerCliSha256':CLI_SHA,'ownerNodeSha256':NODE_SHA,
      'loginEnabled':False,'operationalDmlAllowed':False,'sourceControlSelectorWrites':False,'consumerServingAllowed':False}
    return {'reviewHash':digest(encoded(binding)),'binding':binding,'observation':{'runtime':catalog['runtime']},'applied':False}


def owner_command(helper,plan):
    view=plan['readView'];query=urllib.parse.urlencode({'host':'/var/run/postgresql','port':'5432','user':'postgres'})
    return [*peer_prefix('postgres'),'PGPASSFILE=/dev/null','UNIFIED_INDEXER_DATABASE_URL=postgresql:///yunipals_backfill?'+query,
      'UNIFIED_INDEXER_RELEASE_ID='+view['releaseId'],'UNIFIED_INDEXER_READ_SCHEMA='+view['schema'],helper.NODE,'--import','tsx',
      str(helper.ROOT/'apps/yunipals-indexer/scripts/unified-ownership-views.ts')]


def postcheck_sql(helper,plan):
    view=plan['readView'];schema=identifier(view['schema']);scope=','.join(literal(s) for s in [helper.SCHEMA,helper.READ_SCHEMA,helper.CONTROL]);parts=[]
    for graph in plan['roles']:
        role=literal(graph['role']);checks=[]
        for kind,key,privilege in [('schema','schemas','USAGE'),('table','relations','SELECT'),('function','functions','EXECUTE')]:
            checks.extend(f'has_{kind}_privilege({role},{literal(name)},{literal(privilege)})' for name in graph[key])
        reads=' AND '.join(checks)
        parts.append(f"jsonb_build_object('role',{role},'oid',(SELECT oid::text FROM pg_roles WHERE rolname={role}),'reads',({reads}),'noLogin',(SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit=6 FROM pg_roles WHERE rolname={role}),'membershipEdges',(SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname={role}),'forbidden',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN({scope}) AND CASE WHEN c.relkind='S' THEN has_sequence_privilege({role},c.oid,'USAGE,UPDATE') WHEN c.relkind IN('r','p','v','m','f') THEN has_table_privilege({role},c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ELSE false END),'schemaCreate',(SELECT count(*) FROM pg_namespace WHERE nspname IN({scope}) AND has_schema_privilege({role},oid,'CREATE')),'ownedObjects',((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN({scope}) AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname={role}))+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN({scope}) AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname={role}))),'definerExecute',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN({scope}) AND p.prosecdef AND has_function_privilege({role},p.oid,'EXECUTE')),'nativeExecute',(has_function_privilege({role},{literal(helper.READ_SCHEMA+'.base_metadata_frame(boolean)')},'EXECUTE') OR has_function_privilege({role},{literal(helper.READ_SCHEMA+'.base_metadata_probe()')},'EXECUTE')))")
    return f"""SELECT jsonb_build_object('marker',(SELECT to_jsonb(r) FROM {schema}._unified_read_release r WHERE singleton),
      'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'definition',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,false) ELSE NULL END) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace={literal(helper.READ_SCHEMA)}::regnamespace AND c.relkind IN('r','v')),
      'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'args',oidvectortypes(p.proargtypes),'invoker',NOT p.prosecdef,'searchPath',p.proconfig,'definition',pg_get_functiondef(p.oid),'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace={literal(helper.READ_SCHEMA)}::regnamespace),
      'roles',jsonb_build_array({','.join(parts)}))"""


def validate_postcheck(value,plan,binding):
    view=plan['readView'];marker=value.get('marker',{})
    if marker.get('singleton') is not True or marker.get('definitions')!=plan['definitions'] or any(marker.get(k)!=view[v] for k,v in [('identity','identity'),('release_id','releaseId'),('manifest_hash','manifestHash')]):fail('Actual immutable marker differs.')
    expected_relations={'_unified_read_release':'r','source_status':'v','token':'v','token_lifecycle':'v','transfer_event':'v','admin_role_event':'v','contract_owner_event':'v','base_metadata_scan':'v','base_metadata_event':'v'}
    if {r['name']:r['kind'] for r in value['relations']}!=expected_relations or len(value['relations'])!=9:fail('Actual read relation shape differs.')
    functions=value['functions'];expected={('source_boundary','text'),('source_probe','text'),('base_metadata_frame','boolean'),('base_metadata_probe','')}
    if len(functions)!=4 or {(r['name'],r['args']) for r in functions}!=expected or any(r['invoker'] is not True or r['searchPath']!=['search_path=pg_catalog'] or r['publicExecute'] is not False for r in functions):fail('Actual protected INVOKER function shape differs.')
    if len(value['roles'])!=4 or {row['role'] for row in value['roles']}!=set(ROLES):fail('Exact actual four-role proof required.')
    expected_oids={r['name']:int(r['oid']) for r in binding['catalog']['roles']}
    for row in value['roles']:
        if int(row['oid'])!=expected_oids[row['role']] or row.get('reads') is not True or row.get('noLogin') is not True or row.get('nativeExecute') is not False or any(row.get(k)!=0 for k in ['membershipEdges','forbidden','schemaCreate','ownedObjects','definerExecute']):fail('Actual consumer read/negative authority differs.')
    return {'markerVerified':True,'effectiveRoleGraphsVerified':True,'views':8,'securityInvokerFunctions':4,'securityDefinerFunctions':0,
      'actualDefinitionsSha256':digest(encoded({'relations':value['relations'],'functions':value['functions']})),'roleOids':expected_oids,'roles':value['roles']}


def save(path,value):
    with path.open('xb') as out:os.fchmod(out.fileno(),0o600);out.write(encoded(value)+b'\n');out.flush();os.fsync(out.fileno())

def audit(path,event,**fields):
    with path.open('ab') as out:out.write(encoded({'at':datetime.now(timezone.utc).isoformat(),'phase':PHASE,'event':event,**fields})+b'\n');out.flush();os.fsync(out.fileno())


def apply(helper,plan,inputs,expected):
    global PHASE
    descriptor=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'a') as lease:
        info=os.fstat(lease.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:fail('Private owner lease required.')
        fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        checked=review(helper,plan,inputs)
        if checked['reviewHash']!=expected:fail('Fresh exact ownership owner review required; nothing applied.')
        for parent in BASE.parents:
            info=parent.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not info.st_mode&stat.S_ISVTX):fail('Protected evidence ancestry required.')
        BASE.mkdir(mode=0o700,exist_ok=True)
        if BASE.is_symlink() or BASE.stat().st_uid!=0 or BASE.stat().st_mode&0o077:fail('Private owner evidence directory required.')
        directory=BASE/expected;directory.mkdir(mode=0o700);save(directory/'review.json',checked);log=directory/'phases.jsonl';save(log,{'event':'review_bound','reviewHash':expected})
        cli_outcome='not_attempted';grant_outcome='not_attempted';error=None;proof=None
        try:
            PHASE='official_atomic_owner_cli';cli_outcome='unconfirmed_requires_catalog_reconcile';audit(log,'attempt',action='official_owner_cli')
            output=json.loads(run(owner_command(helper,plan),cwd=str(helper.ROOT/'apps/yunipals-indexer'),timeout=45))
            if output.get('event')!='unified_ownership_candidate_created' or output.get('identity')!=plan['readView']['identity']:fail('Official owner acknowledgement differs.')
            cli_outcome='commit_confirmed';audit(log,'owner_schema_committed',identity=output['identity'])
            PHASE='unchanged_source_selector_before_grants'
            if json_sql(selector_sql())!=checked['binding']['activeSelector'] or validate_source(json_sql(source_acl_sql(helper),role=SOURCE_ROLE))!=checked['binding']['sourcePeerAcl']:
                fail('Source ACL or active selector changed after owner creation.')
            PHASE='guarded_common_grants';grant_outcome='unconfirmed_requires_catalog_reconcile';audit(log,'attempt',action='atomic_exact_read_grants')
            # Bind role OIDs again within the grant transaction, without changing frozen SQL.
            names=','.join(f'({literal(r["name"])},{int(r["oid"])})' for r in checked['binding']['catalog']['roles'])
            guard=f"DO $oid_guard$ BEGIN IF EXISTS(SELECT 1 FROM (VALUES {names}) AS wanted(name,oid) LEFT JOIN pg_roles r ON r.rolname=wanted.name WHERE r.oid IS DISTINCT FROM wanted.oid::oid) THEN RAISE EXCEPTION 'Consumer role identity changed'; END IF; END $oid_guard$;"
            grants=inputs['grants'].decode().replace('BEGIN;','BEGIN;\n'+guard,1)
            sql(grants,write=True);grant_outcome='commit_confirmed';audit(log,'common_grants_committed',roles=list(ROLES))
            PHASE='actual_read_graph_and_unchanged_source_postcheck'
            actual=json_sql(postcheck_sql(helper,plan));proof=validate_postcheck(actual,plan,checked['binding'])
            save(directory/'actual-proof.json',actual)
            if json_sql(selector_sql())!=checked['binding']['activeSelector']:fail('Active source selector changed.')
            # Fingerprints normalize out only the four approved consumers; every other
            # preexisting source/cache/control ACL entry and effective source right stays exact.
            source=validate_source(json_sql(source_acl_sql(helper),role=SOURCE_ROLE));before=checked['binding']['sourcePeerAcl']
            if source!=before:
                fail('Source-peer effective privileges changed.')
            if any(helper.os_identity(role)!=checked['binding']['dedicatedOs'][role] for role in ROLES):fail('Dedicated OS identities changed.')
            identity=validate_post_source(json.loads(sql(inputs['catalog'].decode())),checked['binding'])
            proof['sourceIdentityUnchanged']=identity['sourceIdentityUnchanged'];proof['runtimeObservation']=identity['runtimeObservation']
            proof['sourcePeerEffectiveAclUnchanged']=True;proof['activeSelectorUnchanged']=True
        except (KeyboardInterrupt,SystemExit):error={'phase':PHASE,'class':'OperatorInterrupt'}
        except Exception as problem:error={'phase':PHASE,'class':type(problem).__name__}
        if error is not None:audit(log,'failed',cliTransactionOutcome=cli_outcome,grantTransactionOutcome=grant_outcome,**error)
        PHASE='result';final={'format':'yunipals-ownership-readview-grants-applied-v1','reviewHash':expected,'applied':error is None,
          'readView':plan['readView'],'roles':[{**row,'applied':error is None} for row in plan['roles']],
          'operatorHelperSha256':digest(protected(Path(__file__).absolute())),'frozenReviewSha256':REVIEW_SHA,'cliTransactionOutcome':cli_outcome,'grantTransactionOutcome':grant_outcome,
          'actualAcceptance':proof,'error':error,'partialStateRetained':error is not None,'manualCatalogReconcileRequired':error is not None,
          'automaticRetryDropOverwriteOrCleanup':False,'loginEnabled':False,'loginAdmissionAccepted':False,'operationalDmlAllowed':False,
          'consumerServingAllowed':False,'sourceAcceptanceVerified':False,'sourceControlSelectorWrites':False,'privateEnvironmentFilesRead':False,'solanaQueries':0}
        save(directory/'result.json',final)
        if error:fail('Owner work incomplete; protected partial/uncertain state retained for manual reconciliation.')
        return final


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('Exact root/host required.')
    helper,plan,inputs=load_inputs()
    if args.apply:
        if not re.fullmatch(r'[0-9a-f]{64}',args.apply):fail('Exact owner review hash required.')
        signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit()))
        print(json.dumps(apply(helper,plan,inputs,args.apply),indent=2))
    else:print(json.dumps(review(helper,plan,inputs),indent=2))


if __name__=='__main__':main()
