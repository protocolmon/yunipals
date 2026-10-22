#!/usr/bin/env python3
"""Short owner-only Arena schema maintenance; no native source promotion/adoption.

Default review has no writes, signals, RefUnit calls or service jobs. Exact apply
retains a local private dump, drains the fixed legacy workers, invokes the official
CLI once, verifies the old payloads and resumes compatible legacy entrypoints.
"""
import argparse,contextlib,ctypes,fcntl,grp,hashlib,json,os,pwd,re,select,shlex,shutil,signal,socket,stat,subprocess,time,types
from pathlib import Path

FORMAT='yunipals-arena-owner-migration-v11'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-arena-owner-migration-v11-20261022')
ROOT=Path('/opt/yunipals-unified/releases/110c622afa37745cd78877e0a5b9e124f20965934e816f060e071d974d2e0158')
SOURCE=ROOT.name
ARTIFACT=Path('/var/tmp/yunipals-runtime-110c622a-20261022')
MANIFEST_SHA='4a615755939d813251e585676f287c5696a76d6e8627c35fcbae1546e2716359'
PROOF_SHA='357bf57f4443f2eac239699793281a7317b46bc97e93340dd671db3aab4ff0b2'
INVENTORY_SHA='32935e1cc702f8d513c89d377dab45e399a6ad839ee5b2304d67e7c269ddc84d'
RUNTIME_SHA='f34a10658b97ea96fb46b45220eb0182cc494a497396b0b65d9b930fd60a35f5'
CREDENTIAL_BUILD_RESULT_FILE=Path('/mnt/HC_Volume_107222036/arena-credential-package-20261022-b/attempt-result.json')
CREDENTIAL_BUILD_RESULT_SHA='203073f7f2e7018b3030501dc7374825b0cd1978260cb7f780ec59171a7f036e'
CREDENTIAL_BUILD_REVIEW_SHA='4782a418113b72a5fb4d7428d6a3c99c480b0d394a1a10d3883106e914988dfa'
CLI_ROOT=Path('/opt/yunipals-unified/releases/9ee6beaf38d614f68d42550803366e2b6d981425f0e14e07d12510eb0d1b724d')
CLI=CLI_ROOT/'apps/yunipals-market-api/dist/arena-migrate.mjs'
CLI_SHA='a769e0aa4e83d61d10845d928abe24c5f4025c0d8616a060eaf59829c8197727'
NODE=Path('/opt/node-v24.18.1/bin/node')
NODE_SHA='f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
OBSERVER_SHA='88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba'
VERIFIER_SHA='ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965'
MIGRATIONS=Path('/opt/yunipals-unified/operations/arena-role-inventory-20261021/operational-migrations.v1.json')
MIGRATIONS_SHA='f6f8c50c7242671f8736acdedb724df7dfd6bf0fb510343af5482e2794cf8f5b'
ROLES=('api','capacity','control','lobby','media','projector','referee','settlement')
UNITS=tuple('yunipals-arena-'+r+'.service'for r in ROLES)
OLD_TABLES={"adjudication":{"oid":2303795,"columns":["candidate","created_at","deployment","input_hash","outcome_hash","state","tournament_id","validation","winners"]},"admission":{"oid":2303766,"columns":["collection","deployment","expiry","nft_chain_id","ownership_block","ownership_hash","signature","token_id","tournament_id","wallet"]},"capacity":{"oid":2303809,"columns":["checked_at","deployment","snapshot"]},"chain_event":{"oid":2303679,"columns":["args","block_hash","block_number","deployment","event_name","log_index","transaction_hash"]},"challenge":{"oid":2303713,"columns":["deployment","expires_at","id","message","used_at","wallet"]},"client_transaction":{"oid":2336176,"columns":["action","checked_at","created_at","deployment","hash","indexed_through_block","next_check_at","result","state","tracking_until","wallet"]},"credit":{"oid":2303705,"columns":["amount","deployment","wallet"]},"deployment":{"oid":2303671,"columns":["contract","cursor","cursor_hash","finalized_at","halt_reason","halted","id","start_block"]},"fighter_snapshot":{"oid":2303741,"columns":["collection","created_at","deployment","nft_chain_id","snapshot","snapshot_hash","token_id","tournament_id"]},"frozen_input":{"oid":2303754,"columns":["ciphertext","deployment","input_hash","revealed_at","tournament_id"]},"identity_job":{"oid":2336194,"columns":["artwork","created_at","deployment","key","metadata","profile","profile_hash","provider_id","request_id","reserved_microusd","state","updated_at","usage","wallet"]},"media_job":{"oid":2303821,"columns":["deployment","detail","film_sha256","state","tournament_id","updated_at"]},"provider_task":{"oid":2303773,"columns":["actual_microusd","asset","deployment","error_code","kind","provider_id","request","request_id","reserved_microusd","response","state","tournament_id","updated_at"]},"session":{"oid":2303720,"columns":["deployment","expires_at","token_hash","wallet"]},"submission":{"oid":2303727,"columns":["ciphertext","commitment","created_at","deployment","seat","signature","tournament_id","wallet"]},"tournament":{"oid":2303692,"columns":["deployment","id","state","updated_at"]},"transaction_intent":{"oid":2303785,"columns":["deployment","nonce","purpose","raw_transaction","receipt","signer","state","tournament_id","tx_hash"]}}
NO_PASSWORD=Path('/run/yunipals-arena-owner-migration-no-password')
BACKUP_LOCK=Path('/var/lib/yunipals-arena/backups/backup.lock')
SOURCE_LEASE=Path('/run/lock/yunipals-unified-shadow.lock')
PRODUCTIVE_UNITS=('yunipals-paid-productive-controller-v5-20261021-prod2.service','yunipals-unified-paid-productive-v7-20261021-prod2.service')
PRODUCTIVE_CURRENT={'yunipals-paid-productive-controller-v6-20261021-prod3.service':'9bf04a796cf54eb0ae61bbd7f66ec243','yunipals-unified-paid-productive-v8-20261021-prod3.service':'2dce868db86948e9ad7d8935ae85243d'}
PRODUCTIVE_UNITS=(*PRODUCTIVE_UNITS,*PRODUCTIVE_CURRENT)
NORMAL_HELPER_SHA='c8c06c03d4bb929f0171876939bb0887254a08f135e4c25a31fbaa238ae166fb'
NORMAL_BASE=Path('/var/backups/yunipals-source6-normal-replay-successor-20261022')
NORMAL_RECEIPT_SHA='e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f'  # Bound only by the exact acknowledged normal/free runtime in launcher-v7.
TERMINAL_PROOF=Path('/var/backups/yunipals-arena-normal-adoption-v4-20261022/normal-proof.json')
TERMINAL_PROOF_SHA='60adfe8cc817ea5b7ebf66bfa98e4f70652000675c424c53f6862e3db9f73638'
RENEWAL_CONTROLLERS=tuple('yunipals-paid-replay-renewal-v'+str(v)+'-controller.service'for v in [4,5,6,7])
PRODUCTIVE_UNITS=(*PRODUCTIVE_UNITS,*RENEWAL_CONTROLLERS)
DROPIN='zzzz-arena-compatible-legacy-20261021.conf'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
PHASE='initial'
NEW_FUNCTIONS={'ensure_legacy_identity','identity_immutable','intent_immutable','receipt_immutable','source_switch_immutable','source_selection_fence','source_watermark_fence','media_publication_binding','media_publication_immutable','media_job_binding','provider_evidence_binding','provider_task_immutable','provider_evidence_immutable','client_tracking_immutable','client_receipt_immutable'}
NEW_TRIGGERS={('arena_legacy_identity',t,'ensure_legacy_identity')for t in ['tournament','submission','fighter_snapshot','frozen_input','admission','provider_task','transaction_intent','adjudication','media_job']}
NEW_TRIGGERS.update({(name,table,function)for name,table,function in[
 ('arena_identity_immutable','tournament_identity','identity_immutable'),('arena_intent_immutable','transaction_intent','intent_immutable'),('arena_receipt_immutable','transaction_receipt_history','receipt_immutable'),
 ('arena_source_switch_immutable','source_switch_history','source_switch_immutable'),('arena_source_selection_fence','source_selection','source_selection_fence'),('arena_source_selection_no_delete','source_selection','source_switch_immutable'),('arena_source_watermark_fence','source_operational_cursor','source_watermark_fence'),
 ('arena_media_publication_binding','media_publication','media_publication_binding'),('arena_media_publication_immutable','media_publication','media_publication_immutable'),('arena_media_job_binding','media_job','media_job_binding'),
 ('arena_provider_evidence_binding','provider_action_evidence','provider_evidence_binding'),('arena_provider_task_immutable','provider_task','provider_task_immutable'),('arena_provider_evidence_immutable','provider_action_evidence','provider_evidence_immutable'),
 ('arena_client_tracking_immutable','client_transaction','client_tracking_immutable'),('arena_client_receipt_immutable','client_receipt_history','client_receipt_immutable')]})

class MigrationFailure(RuntimeError):pass
def fail(label):raise MigrationFailure(label)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def literal(v):return"'"+str(v).replace("'","''")+"'"
def qi(v):return'"'+v.replace('"','""')+'"'
def run(argv,*,data=None,timeout=8,output=None,maximum=16000000):
    r=subprocess.run(argv,input=data,stdout=output if output is not None else subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,timeout=timeout)
    if r.returncode or r.stderr or output is None and len(r.stdout)>maximum:fail('bounded_child_failed')
    return r.stdout if output is None else b''
def save(path,value):
    raw=value if isinstance(value,bytes)else encoded(value)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    fd=os.open(Path(path).parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return sha(raw)
def load(path,pin,name,observer=None):
    raw=Path(path).read_bytes()if observer is None else observer.read(path,200000)[0]
    if sha(raw)!=pin:fail('pinned_owner_dependency_changed')
    m=types.ModuleType(name);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def observer():
    p=OPS/'arena-config-observer-v4.py';m=load(p,OBSERVER_SHA,'owner_existing_config_reader');m.read(p,200000);return m

def artifact_input(o,path,maximum):
    path=Path(path)
    if path not in{ARTIFACT/'arena-consumer-package-proof.json',ARTIFACT/'runtime-supplement.inventory.json'}:fail('exact_installed_public_artifact_input_required')
    for parent in path.parents:
        s=parent.lstat()
        if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022 and not(parent==Path('/var/tmp')and s.st_mode&stat.S_ISVTX):fail('protected_artifact_ancestry_required')
    before=path.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_nlink!=1 or before.st_mode&0o022 or before.st_size>maximum:fail('bounded_exact_artifact_input_required')
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb')as f:
        if o.metadata(os.fstat(f.fileno()))!=o.metadata(before):fail('installed_artifact_identity_changed')
        raw=f.read(maximum+1)
        if o.metadata(os.fstat(f.fileno()))!=o.metadata(before):fail('installed_artifact_changed_during_read')
    if len(raw)!=before.st_size or o.metadata(path.lstat())!=o.metadata(before):fail('installed_artifact_changed_during_read')
    return raw

def peer_prefix(*,write=False,owner=False):
    if os.path.lexists(NO_PASSWORD):fail('controlled_no_password_path_must_be_absent')
    p=pwd.getpwnam('postgres')
    if p.pw_uid<=0 or p.pw_gid<=0:fail('existing_postgres_peer_required')
    options='-c lock_timeout=2000 -c statement_timeout='+('120000'if write else'30000')+' -c idle_in_transaction_session_timeout=15000'
    if not write:options+=' -c default_transaction_read_only=on'
    if owner:options+=' -c role=yunipals_arena_owner'
    return ['/usr/bin/setpriv','--reuid='+str(p.pw_uid),'--regid='+str(p.pw_gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/nonexistent','USER=postgres','LOGNAME=postgres','PGUSER=postgres','PGHOST=/var/run/postgresql','PGPORT=15438','PGDATABASE=yunipals_arena','PGPASSFILE='+str(NO_PASSWORD),'PGOPTIONS='+options]
def sql(text,*,write=False):
    raw=run(peer_prefix(write=write)+['/usr/bin/psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1'],data=text.encode(),timeout=35,maximum=16000000)
    if os.path.lexists(NO_PASSWORD):fail('controlled_no_password_path_appeared')
    return json.loads(raw)

@contextlib.contextmanager
def existing_source_lease():
    # The productive controller owns this same lease for its entire lifecycle.
    # Never create or replace it. A maintenance review is unavailable until that
    # lifecycle has closed; apply retains the lease through legacy resumption.
    fd=os.open(SOURCE_LEASE,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd);p=SOURCE_LEASE.lstat()
        if(not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022 or s.st_nlink!=1 or
            (s.st_dev,s.st_ino)!=(p.st_dev,p.st_ino)):fail('existing_exact_source_lease_required')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:fail('productive_replay_must_close_before_arena_maintenance')
        yield fd
    finally:os.close(fd)

def private_snapshot_sql():
    parts=[]
    for table,row in sorted(OLD_TABLES.items()):
        cols=','.join(qi(c)for c in row['columns'])
        parts.extend([literal(table),f"(SELECT coalesce(jsonb_agg(to_jsonb(t)ORDER BY to_jsonb(t)::text),'[]'::jsonb)FROM(SELECT {cols} FROM yunipals_arena.{qi(table)} LIMIT 2001)t)"])
    return"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT jsonb_build_object("+','.join(parts)+");ROLLBACK;"

def snapshot():
    value=sql(private_snapshot_sql())
    if set(value)!=set(OLD_TABLES)or any(not isinstance(rows,list)or len(rows)>2000 for rows in value.values()):fail('bounded_actual_old_rows_required')
    return value

def catalog():
    origins=' UNION '.join(['SELECT deployment,id AS tournament_id FROM yunipals_arena.tournament',*['SELECT deployment,tournament_id FROM yunipals_arena.'+t for t in ['submission','fighter_snapshot','frozen_input','admission','provider_task','transaction_intent','adjudication','media_job']]])
    return sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;WITH origins AS("+origins+""" )SELECT jsonb_build_object(
      'owner',(SELECT oid::bigint FROM pg_roles WHERE rolname='yunipals_arena_owner'),
      'databaseOwner',(SELECT datdba::bigint FROM pg_database WHERE datname=current_database()),
      'schemaOwner',(SELECT nspowner::bigint FROM pg_namespace WHERE nspname='yunipals_arena'),
      'database',current_database(),'port',current_setting('port'),
      'otherSessions',(SELECT count(*)FROM pg_stat_activity WHERE datname=current_database()AND pid<>pg_backend_pid()AND backend_type='client backend'),
      'privateOriginCount',(SELECT count(*)FROM origins),
      'missingIdentityParents',(SELECT count(*)FROM origins o LEFT JOIN yunipals_arena.deployment d ON d.id=o.deployment WHERE d.id IS NULL),
      'globalNonceConflicts',(SELECT count(*)FROM(SELECT lower(signer),nonce FROM yunipals_arena.transaction_intent GROUP BY lower(signer),nonce HAVING count(*)>1)t),
      'migrationsPresent',to_regclass('yunipals_arena.operational_migration')IS NOT NULL,
      'relations',(SELECT jsonb_object_agg(c.relname,jsonb_build_object('oid',c.oid::bigint,'owner',c.relowner::bigint,'kind',c.relkind))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_arena'AND c.relkind='r'));ROLLBACK;""")

def verify_target(value):
    if any(value.get(k)!=v for k,v in {'owner':2303667,'databaseOwner':2303667,'schemaOwner':2303667,'database':'yunipals_arena','port':'15438','privateOriginCount':2,'missingIdentityParents':0,'globalNonceConflicts':0}.items()):fail('actual_arena_owner_target_changed')
    for table,row in OLD_TABLES.items():
        if value['relations'].get(table)!={'oid':row['oid'],'owner':2303667,'kind':'r'}:fail('retained_old_relation_changed')

def schema_objects():
    # Definitions stay in the host-only rollback/audit directory. Only their
    # aggregate digest and exact compatibility predicates reach public stdout.
    return sql("""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT jsonb_build_object(
      'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',p.oid::bigint,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'owner',p.proowner::bigint,'securityDefiner',p.prosecdef,'publicExecute',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),'definition',pg_get_functiondef(p.oid))ORDER BY p.oid),'[]'::jsonb)FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='yunipals_arena'AND p.prokind='f'),
      'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',t.oid::bigint,'name',t.tgname,'table',c.relname,'function',p.proname,'functionOid',p.oid::bigint,'owner',c.relowner::bigint,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))ORDER BY t.oid),'[]'::jsonb)FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='yunipals_arena'AND NOT t.tgisinternal));ROLLBACK;""")

def verify_schema_objects(before,after):
    oldf={r['oid']:r for r in before['functions']};oldt={r['oid']:r for r in before['triggers']}
    newf=[r for r in after['functions']if r['oid']not in oldf];newt=[r for r in after['triggers']if r['oid']not in oldt]
    if({r['oid']:r for r in after['functions']if r['oid']in oldf}!=oldf or {r['oid']:r for r in after['triggers']if r['oid']in oldt}!=oldt):fail('original_arena_function_or_trigger_changed')
    if(len(newf)!=len(NEW_FUNCTIONS)or {r['name']for r in newf}!=NEW_FUNCTIONS or
        any(r['owner']!=2303667 or r['arguments']!=''or r['securityDefiner']is not False or r['publicExecute']is not False for r in newf)):fail('official_invoker_function_graph_not_observed')
    if(len(newt)!=len(NEW_TRIGGERS)or {(r['name'],r['table'],r['function'])for r in newt}!=NEW_TRIGGERS or
        any(r['owner']!=2303667 or r['enabled']!='O'or r['functionOid']not in{f['oid']for f in newf}for r in newt)):fail('official_trigger_binding_graph_not_observed')
    return {'newInvokerFunctions':len(newf),'newTriggers':len(newt),'originalFunctionsAndTriggersUnchanged':True,'publicExecuteOnNewFunctions':False,'objectsSha256':sha(encoded(after))}

def official_owner_migration():
    args=peer_prefix(write=True,owner=True)+['ARENA_DATABASE_URL=postgresql:///yunipals_arena?host=/var/run/postgresql&port=15438',str(NODE),str(CLI)]
    try:
        child=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,timeout=300)
    except subprocess.TimeoutExpired as error:
        for name,raw in [('stdout',error.stdout or b''),('stderr',error.stderr or b'')]:
            if len(raw)<=64000:save(BASE/('owner-cli.'+name+'.private'),raw)
        raise
    for name,raw in [('stdout',child.stdout),('stderr',child.stderr)]:
        if len(raw)<=64000:save(BASE/('owner-cli.'+name+'.private'),raw)
    if child.returncode or child.stderr or child.stdout!=b'Arena database schema is ready.\n':fail('official_migration_ack_unknown')

def legacy_row(base,role):
    row=next(r for r in base['services']if r['unit']=='yunipals-arena-'+role+'.service')
    tokens=[t for t in row['execStartPublicTokens']if t!='<REDACTED_ARGUMENT>']
    if len(tokens)!=3 or tokens[0]!='/usr/bin/env' or not re.fullmatch(r'dist/arena-[a-z]+\.mjs',tokens[2]):fail('fixed_legacy_entrypoint_shape_required')
    return row,tokens

def dropin(role,base=None):
    if base is None:base=json.loads((OPS/'arena-config-public-baseline-v1.json').read_bytes())
    row,tokens=legacy_row(base,role);bundle=tokens[-1]
    keys={'strategy-encryption.key':'ARENA_ENCRYPTION_KEY_FILE','admission.key':'ARENA_ADMISSION_KEY_FILE','operator.key':'ARENA_LOBBY_KEY_FILE','referee.key':'ARENA_REFEREE_KEY_FILE'}
    mapping=dict(item.split(':',1)for item in row['credentialFileReferences'])
    assignments={key:('%d/'+name if name in mapping else'')for name,key in keys.items()if key in row['inlineSettingNames']}
    if 'ARENA_ENTRIES_ENABLED'in row['inlineSettingNames']:assignments['ARENA_ENTRIES_ENABLED']='false'
    if set(assignments)!=set(row['inlineSettingNames']):fail('only_observed_inline_legacy_settings_supported')
    assignments.update(ARENA_INDEXER_MODE='legacy',ARENA_INDEXER_DATABASE_URL='',ARENA_INDEXER_RELEASE_ID='',ARENA_INDEXER_SOURCE_KIND='')
    flags=[key+'='+value for key,value in assignments.items()]
    return('[Service]\nWorkingDirectory='+str(ROOT/'apps/yunipals-market-api')+'\nExecStart=\nExecStart=/usr/bin/env '+' '.join(flags)+' '+str(NODE)+' '+bundle+'\n').encode()

def resumed_baseline(base):
    result=json.loads(json.dumps(base));result['resolvedRelease']=str(ROOT)
    for row in result['services']:
        role=row['unit'].removeprefix('yunipals-arena-').removesuffix('.service')
        _,tokens=legacy_row(base,role)
        row['WorkingDirectory']=str(ROOT/'apps/yunipals-market-api')
        row['execStartPublicTokens']=['/usr/bin/env',str(NODE),tokens[-1]]
        row['inlineSettingNames']+=['ARENA_INDEXER_MODE','ARENA_INDEXER_DATABASE_URL','ARENA_INDEXER_RELEASE_ID','ARENA_INDEXER_SOURCE_KIND']
        row['DropInPaths']=' '.join([*shlex.split(row['DropInPaths']),str(Path('/etc/systemd/system')/(row['unit']+'.d')/DROPIN)])
    return result

def process_identity(props,row):
    unit=row['unit'];_,tokens=legacy_row({'services':[row]},unit.removeprefix('yunipals-arena-').removesuffix('.service'))
    pid=int(props['MainPID']);root=Path('/proc')/str(pid)
    account=pwd.getpwnam(props['User']);group=grp.getgrnam(props['Group'])
    if account.pw_uid!=971 or group.gr_gid!=965:fail('retained_arena_os_identity_required')
    status=dict(line.split(':',1)for line in (root/'status').read_text().splitlines()if ':'in line)
    if [int(x)for x in status['Uid'].split()]!=[971]*4 or [int(x)for x in status['Gid'].split()]!=[965]*4:fail('exact_legacy_process_identity_required')
    argv=(root/'cmdline').read_bytes().split(b'\0')
    if argv[-1:]!=[b''] or argv[:-1]!=[tokens[1].encode(),tokens[2].encode()]:fail('exact_legacy_node_argv_required')
    cwd=(root/'cwd').resolve(strict=True);exe=(root/'exe').resolve(strict=True)
    if cwd!=Path(row['WorkingDirectory']).resolve(strict=True)or exe!=Path(tokens[1]).resolve(strict=True):fail('retained_legacy_process_paths_changed')
    raw=(root/'stat').read_text();start=int(raw[raw.rfind(')')+2:].split()[19])
    if (root/'cgroup').read_text().splitlines()!=['0::/system.slice/'+unit]:fail('exact_legacy_process_cgroup_required')
    return {'pid':pid,'startTicks':start,'uid':971,'gid':965,'cwd':str(cwd),'exe':str(exe),'argvSha256':sha(encoded(tokens[1:]))}

def compatible_secret_reader(o,v,baseline,processes):
    """Prove both installed reader sources and the current loaded mount view."""
    app=ROOT/'apps/yunipals-market-api'
    manifest_raw,_=o.read(ROOT/'RELEASE-MANIFEST.json',2000000)
    if sha(manifest_raw)!=MANIFEST_SHA:fail('official_compatible_source_manifest_required')
    manifest=json.loads(manifest_raw);sources={}
    for name in ('config.ts','privateFile.ts'):
        relative='apps/yunipals-market-api/src/arena/live/'+name
        rows=[r for r in manifest['files']if r['path']==relative]
        body,_=o.read(app/'src/arena/live'/name,100000)
        if len(rows)!=1 or rows[0]['sha256']!=sha(body)or rows[0]['bytes']!=len(body):fail('official_compatible_credential_sources_required')
        sources[name]=sha(body)
    proofs={}
    for row in baseline['services']:
        unit=row['unit']
        if unit not in UNITS:fail('fixed_legacy_credential_unit_required')
        props=o.unit_state(v,unit)
        if process_identity(props,row)!=processes[unit]:fail('exact_credential_mount_owner_changed')
        names=[item.split(':',1)[0]for item in row['credentialFileReferences']]
        script=secret_reader_script(app,names,unit)
        args=['/usr/bin/nsenter','--target='+str(processes[unit]['pid']),'--mount','--wd='+str(app),'--','/usr/bin/setpriv','--reuid=971','--regid=965','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/nonexistent','TSX_DISABLE_CACHE=1','CREDENTIALS_DIRECTORY=/run/credentials/'+unit,str(NODE),'--input-type=module','-']
        actual=json.loads(run(args,data=script,timeout=20,maximum=4096))
        expected=[{'id':name,'sha256':sha(o.read(Path('/etc/yunipals-arena')/name,4096,private=True)[0].strip())}for name in names]
        if actual!=expected or o.unit_state(v,unit)!=props or process_identity(props,row)!=processes[unit]:fail('same_context_compatible_credential_reader_not_proven')
        proofs[unit]={'officialConfigSourceSha256':sources['config.ts'],'officialPrivateFileSourceSha256':sources['privateFile.ts'],'loadedCredentialReaderAccepted':True,'loadedBytesMatchSources':True,'credentialCount':len(names)}
    return proofs


def credential_build_evidence(o,proof,*,attempt_result_file,attempt_result_sha256,build_review_hash):
    """Read only the exact completed v2 attempt, with actual hashes supplied."""
    expected_file=Path('/mnt/HC_Volume_107222036/arena-credential-package-20261022-b/attempt-result.json')
    if attempt_result_file!=expected_file:fail('exact_v2_credential_build_result_path_required')
    if any(not isinstance(value,str)or not re.fullmatch('[0-9a-f]{64}',value)or value=='0'*64 for value in (attempt_result_sha256,build_review_hash)):
        fail('actual_completed_credential_build_hashes_required')
    raw,_=o.read(expected_file,100000)
    if sha(raw)!=attempt_result_sha256:fail('exact_completed_credential_build_result_required')
    result=json.loads(raw)
    patches={
        'apps/yunipals-market-api/src/arena/live/config.ts':'fdb0f1f29cacbc6a58b78a40c0d96cd38ff82b2b0caec8d49c12a99ca8c1e14e',
        'apps/yunipals-market-api/src/arena/live/privateFile.ts':'0e89988993ceda801201803f454ea6d1dd12b90d669368d509e476b568465750',
        'apps/yunipals-market-api/src/arena/live/privateFile.test.ts':'2b2aa80c0732db2814d8484b968b96159d22379aa67c0ceba90902191ae59b54'
    }
    archive_pins=(proof.get('source',{}).get('archiveSha256'),proof.get('runtime',{}).get('archiveSha256'),proof.get('runtime',{}).get('inventorySha256'))
    if any(not isinstance(value,str)or not re.fullmatch('[0-9a-f]{64}',value)or value=='0'*64 for value in archive_pins):fail('actual_completed_credential_archive_hashes_required')
    if(proof.get('format')!='yunipals-arena-credential-dependency-clone-package-v2'or proof.get('status')!='passed'or
       proof.get('sourceDigest')!=SOURCE or proof.get('reviewHash')!=build_review_hash or
       proof.get('source',{}).get('manifestSha256')!=MANIFEST_SHA or proof.get('source',{}).get('exactPatchedSources')!=patches or
       proof.get('verification',{}).get('targetedCredentialReaderSuites')!=2 or
       result.get('format')!=proof['format']or result.get('status')!='passed'or result.get('sourceDigest')!=SOURCE or
       result.get('reviewHash')!=build_review_hash or result.get('proofSha256')!=PROOF_SHA or
       result.get('sourceArchiveSha256')!=proof.get('source',{}).get('archiveSha256')or
       result.get('runtimeArchiveSha256')!=proof.get('runtime',{}).get('archiveSha256')or
       result.get('runtimeInventorySha256')!=proof.get('runtime',{}).get('inventorySha256')):
        fail('completed_v2_credential_build_binding_required')
    steps=result.get('steps')
    if not isinstance(steps,list)or any(not isinstance(row,dict)for row in steps):fail('actual_credential_suite_steps_required')
    names=('credential-reader-controls','relocated-credential-reader-controls')
    suites=[row for row in steps if row.get('name')in names]
    if(len(suites)!=2 or {row.get('name')for row in suites}!=set(names)or
       any(type(row.get('exitCode'))is not int or row['exitCode']!=0 or
           any(not isinstance(row.get(key),str)or not re.fullmatch('[0-9a-f]{64}',row[key])or row[key]=='0'*64 for key in ('stdoutSha256','stderrSha256'))or
           row['stdoutSha256']==sha(b'')for row in suites)):
        fail('two_actual_completed_credential_suites_required')
    return {'buildResultFile':str(expected_file),'buildResultSha256':attempt_result_sha256,
        'buildReviewHash':build_review_hash,'sourceDigest':SOURCE,'packageProofSha256':PROOF_SHA,
        'twoActualCredentialSuitesAccepted':True,
        'suiteSteps':{row['name']:{key:row[key]for key in ('exitCode','stdoutSha256','stderrSha256')}for row in suites}}



def secret_reader_script(app,names,unit,credential_root='/run/credentials'):
    return '''import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const app=APP, names=NAMES, unit=UNIT, credentials=CREDENTIALS;
const req=createRequire(app+'/package.json');
const {tsImport}=req('tsx/esm/api');
const {readPrivateFile}=await tsImport(app+'/src/arena/live/config.ts', {parentURL:pathToFileURL(app+'/package.json').href,tsconfig:app+'/tsconfig.json'});
const checks=names.map(id=>({id,sha256:createHash('sha256').update(readPrivateFile(credentials+'/'+unit+'/'+id)).digest('hex')}));
process.stdout.write(JSON.stringify(checks));
'''.replace('APP',json.dumps(str(app))).replace('NAMES',json.dumps(names)).replace('UNIT',json.dumps(unit)).replace('CREDENTIALS',json.dumps(str(credential_root))).encode()

def verify_original_definitions(o,bindings):
    for row in bindings:
        for path,pin in row['unitDefinitionsSha256'].items():
            if sha(o.read(Path(path),1000000)[0])!=pin:fail('original_arena_unit_definition_changed')

def resumed_configuration(o,v,binding):
    baseline=json.loads(o.read(OPS/'arena-config-public-baseline-v1.json',200000)[0])
    current=o.observe(v,resumed_baseline(baseline))
    expected={r['role']:r for r in binding['currentUnits']}
    for row in current['roles']:
        before=expected[row['role']]
        unchanged=['uid','configuredOsIdentitySha256','configuredDatabaseRoleSha256','configuredSourceRoleSha256','credentialMappingsMatchBaseline',
            'loadedCredentials','providerKeyPresence','unexpectedProviderKeys','requiredProviderKeyPresent','executionSignerConfigured','admissionSignerConfigured','inlineEnvironmentSha256']
        definitions={**before['unitDefinitionsSha256'],str(Path('/etc/systemd/system')/(row['unit']+'.d')/DROPIN):binding['legacyOverrides'][row['role']]}
        if(any(row[k]!=before[k]for k in unchanged)or row['invocation']==before['invocation']or
            row['unitDefinitionsSha256']!=definitions or row['runtimeSha256']!=binding['runtimeFiles'][row['role']]):fail('exact_compatible_legacy_configuration_not_observed')
    if(current['environmentFileSha256']!=binding['configurationFiles']or not current['allLoadedCredentialBytesMatchSources']or
        not current['signerKeyMaterialsDistinct']or not current['providerSelectorScopeMatchesIntendedRoles']or not current['signerSelectorScopeMatchesIntendedRoles']):fail('retained_provider_or_key_configuration_changed')
    return current

def review(plan,o,v):
    if set(plan)!={'format','packageProofFile','packageProofSha256','runtimeInventoryFile','runtimeInventorySha256'}or plan['format']!=FORMAT:fail('exact_owner_plan_required')
    if plan['packageProofFile']!=str(ARTIFACT/'arena-consumer-package-proof.json')or plan['runtimeInventoryFile']!=str(ARTIFACT/'runtime-supplement.inventory.json'):fail('exact_installed_arena_artifact_paths_required')
    if os.path.lexists(BASE):fail('fresh_owner_evidence_directory_required_no_retry')
    raw=artifact_input(o,plan['packageProofFile'],2000000)
    if sha(raw)!=plan['packageProofSha256']or plan['packageProofSha256']!=PROOF_SHA:fail('accepted_built_package_proof_required')
    proof=json.loads(raw)
    credential_evidence=credential_build_evidence(o,proof,attempt_result_file=CREDENTIAL_BUILD_RESULT_FILE,attempt_result_sha256=CREDENTIAL_BUILD_RESULT_SHA,build_review_hash=CREDENTIAL_BUILD_REVIEW_SHA)
    if(proof.get('status')!='passed'or proof.get('sourceDigest')!=SOURCE or proof['source']['manifestSha256']!=MANIFEST_SHA or proof['runtime']['archiveSha256']!=RUNTIME_SHA or proof['runtime']['entries']!=60918 or proof['verification']['dependencyPackages']!=330 or proof['verification']['ordinaryMarketBuilds']!=2 or proof['runtime'].get('separateRelocatedTreeRebuildByteIdentical')is not True):fail('actual_reproducible_arena_package_required')
    manifest,_=o.read(ROOT/'RELEASE-MANIFEST.json',2000000)
    if sha(manifest)!=MANIFEST_SHA or sha(o.read(CLI,200000)[0])!=CLI_SHA or sha(o.read(NODE,150000000)[0])!=NODE_SHA:fail('installed_exact_owner_and_compatible_runtime_required')
    invraw=artifact_input(o,plan['runtimeInventoryFile'],24000000)
    if sha(invraw)!=plan['runtimeInventorySha256']or plan['runtimeInventorySha256']!=INVENTORY_SHA or proof['runtime']['inventorySha256']!=plan['runtimeInventorySha256']:fail('actual_runtime_inventory_required')
    inventory=json.loads(invraw);entries={r['path']:r for r in inventory['entries']};runtime={}
    baseline_raw,_=o.read(OPS/'arena-config-public-baseline-v1.json',200000)
    if sha(baseline_raw)!=o.BASELINE_SHA:fail('accepted_existing_config_baseline_changed')
    baseline=json.loads(baseline_raw);configured=o.observe(v,baseline)
    inputs={str(path):sha(o.read(path,1000000,private=True)[0])for path in [*o.ENV_FILES,*[Path('/etc/yunipals-arena')/name for name in o.KEYS]]}
    for role in ROLES:
        row=next(r for r in baseline['services']if r['unit']=='yunipals-arena-'+role+'.service')
        relative='apps/yunipals-market-api/'+row['execStartPublicTokens'][-1];entry=entries[relative];body,_=o.read(ROOT/relative,5000000)
        if entry.get('type')!='file'or entry.get('sha256')!=sha(body):fail('installed_compatible_legacy_entry_changed')
        runtime[role]=sha(body)
        path=Path('/etc/systemd/system')/('yunipals-arena-'+role+'.service.d')/DROPIN
        if os.path.lexists(path):fail('fresh_exact_legacy_override_required')
    before=catalog();verify_target(before)
    if before['migrationsPresent']:fail('this_is_only_the_observed_unmigrated_target')
    migration_raw,_=o.read(MIGRATIONS,100000)
    if sha(migration_raw)!=MIGRATIONS_SHA:fail('official_migration_expectations_changed')
    processes={}
    for row in baseline['services']:
        props=o.unit_state(v,row['unit']);legacy_stop_policy(row['unit']);processes[row['unit']]=process_identity(props,row)
        if o.unit_state(v,row['unit'])!=props:fail('old_process_changed_during_review')
    compatibility=compatible_secret_reader(o,v,baseline,processes)
    binding={'format':FORMAT,'plan':plan,'operatorSha256':sha(o.read(Path(__file__).absolute(),200000)[0]),'sourceDigest':SOURCE,'ownerCliSha256':CLI_SHA,'nodeSha256':NODE_SHA,
        'currentUnits':configured['roles'],'configurationFiles':configured['environmentFileSha256'],'privateInputHashes':inputs,'oldRelations':before['relations'],'runtimeFiles':runtime,
        'processes':processes,'compatibleSecretReader':compatibility,'credentialBuildEvidence':credential_evidence,'legacyOverrides':{role:sha(dropin(role,baseline))for role in ROLES},'sourceModeAfter':'legacy','sourceSelectionChanged':False,'keyOrProviderSettingsChanged':False}
    return{'format':FORMAT,'reviewHash':sha(encoded(binding)),'binding':binding,'observation':{'otherSessions':before['otherSessions'],'countsMeasuredSeparately':True}}

class References:
    """Apply-only persistent RefUnit for exactly the eight retained old units."""
    def __init__(self):
        self.bus=ctypes.c_void_p();self.held=[];self.lib=ctypes.CDLL('libsystemd.so.0')
        self.lib.sd_bus_open_system.argtypes=[ctypes.POINTER(ctypes.c_void_p)];self.lib.sd_bus_open_system.restype=ctypes.c_int
        self.lib.sd_bus_set_method_call_timeout.argtypes=[ctypes.c_void_p,ctypes.c_uint64];self.lib.sd_bus_set_method_call_timeout.restype=ctypes.c_int
        self.lib.sd_bus_call_method.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_void_p),ctypes.c_char_p];self.lib.sd_bus_call_method.restype=ctypes.c_int
        self.lib.sd_bus_message_unref.argtypes=[ctypes.c_void_p];self.lib.sd_bus_message_unref.restype=ctypes.c_void_p
        self.lib.sd_bus_flush_close_unref.argtypes=[ctypes.c_void_p];self.lib.sd_bus_flush_close_unref.restype=ctypes.c_void_p
    def call(self,method,unit):
        if method not in{'RefUnit','UnrefUnit'}or unit not in UNITS:fail('only_fixed_arena_refs_allowed')
        reply=ctypes.c_void_p();code=self.lib.sd_bus_call_method(self.bus,b'org.freedesktop.systemd1',b'/org/freedesktop/systemd1',b'org.freedesktop.systemd1.Manager',method.encode(),None,ctypes.byref(reply),b's',ctypes.c_char_p(unit.encode()))
        if reply.value:self.lib.sd_bus_message_unref(reply)
        if code<0:fail('bounded_fixed_arena_ref_failed')
    def __enter__(self):
        try:
            if self.lib.sd_bus_open_system(ctypes.byref(self.bus))<0 or self.lib.sd_bus_set_method_call_timeout(self.bus,ctypes.c_uint64(3000000))<0:fail('bounded_system_bus_required')
            for unit in UNITS:self.call('RefUnit',unit);self.held.append(unit)
            return self
        except BaseException:self.__exit__(None,None,None);raise
    def __exit__(self,*_):
        try:
            for unit in reversed(self.held):self.call('UnrefUnit',unit)
        finally:
            self.held=[]
            if self.bus.value:self.lib.sd_bus_flush_close_unref(self.bus);self.bus=ctypes.c_void_p()

def verify_inputs(o,expected):
    for path,pin in expected.items():
        if sha(o.read(Path(path),1000000,private=True)[0])!=pin:fail('existing_private_configuration_changed')

def verify_backup_lock(fd):
    s=os.fstat(fd);p=BACKUP_LOCK.lstat()
    if not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_nlink!=1 or s.st_mode&0o077 or (s.st_dev,s.st_ino)!=(p.st_dev,p.st_ino):fail('existing_exact_private_backup_lease_required')

def legacy_stop_policy(unit):
    raw=run(['/usr/bin/systemctl','show','--all',unit,'--property=Restart','--property=KillMode'],maximum=4096).decode()
    rows=[line.split('=',1)for line in raw.splitlines()]
    if len(rows)!=2 or dict(rows)!={'Restart':'on-failure','KillMode':'control-group'}:fail('legacy_graceful_stop_policy_changed')
    return dict(rows)

def stopped(unit):
    keys=['Id','InvocationID','LoadState','ActiveState','SubState','MainPID','Result','ExecMainStatus','Slice','ControlGroup']
    raw=run(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in keys]],maximum=20000).decode()
    values=dict(line.split('=',1)for line in raw.splitlines())
    if set(values)!=set(keys)or values['Id']!=unit:fail('exact_stopped_state_required')
    return values

def productive_cgroup_empty(unit):
    if unit not in PRODUCTIVE_UNITS:fail('fixed_productive_cgroup_selector_required')
    parent=Path('/sys/fs/cgroup/system.slice');root=parent.lstat()
    if not stat.S_ISDIR(root.st_mode)or root.st_uid!=0 or root.st_mode&0o022:fail('trusted_system_slice_required')
    path=parent/unit
    try:before=path.lstat()
    except FileNotFoundError:
        if(root.st_dev,root.st_ino)!=(parent.lstat().st_dev,parent.lstat().st_ino):fail('system_slice_identity_changed')
        return 'absent'
    if not stat.S_ISDIR(before.st_mode)or before.st_uid!=0 or before.st_mode&0o022 or before.st_dev!=root.st_dev:fail('exact_owned_productive_cgroup_required')
    values={}
    for name in ['cgroup.procs','cgroup.events']:
        fd=os.open(path/name,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):fail('fixed_cgroup_file_required')
            raw=os.read(fd,4097)
            if len(raw)>4096:fail('bounded_productive_cgroup_metadata_required')
            values[name]=raw.decode('ascii')
        finally:os.close(fd)
    events=dict(line.split()for line in values['cgroup.events'].splitlines())
    if values['cgroup.procs'].strip()or events.get('populated')!='0':fail('productive_cgroup_must_be_recursively_empty')
    after=path.lstat()
    if(before.st_dev,before.st_ino)!=(after.st_dev,after.st_ino):fail('productive_cgroup_identity_changed')
    return 'present_empty'

def productive_completed_controller():
    path=OPS/'paid-productive-financial-handoff-v1.py'
    for item in [*path.parents,path]:
        s=item.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_completed_controller_reader_required')
    helper=load(path,'ab2655a6ab333b77e1f63f9bf26531fadf41475df6e5d3ba0f9d11af646e7a39','arena_completed_productive_reader')
    q,live,model,epoch,native,financial=helper.modules()
    receipt,reviewed,plan,cleanup=helper.validate_handoff(q,live,model,native)
    refs=reviewed['completion'];native_ref=refs.get('nativeStopped')
    if native_ref is None:fail('acknowledged_completed_prod3_native_required')
    record=helper.pinned(q,native_ref['file'],native_ref['sha256'])['record']
    journal=live.journal_for(q,Path(refs['journal']['file']).parent)
    started=journal.latest('controller_started')
    controller='yunipals-paid-productive-controller-v6-20261021-prod3.service'
    if started is None or started['identity']['unit']!=controller or started['identity']['invocation']!=PRODUCTIVE_CURRENT[controller]or record is None or record.get('invocation')!=PRODUCTIVE_CURRENT['yunipals-unified-paid-productive-v8-20261021-prod3.service']:fail('exact_completed_prod3_actor_lineage_required')
    helper.terminal(q,live,native,journal,record)
    return {'verified':True,'completionSha256':sha(encoded(refs)),'controllerResultSha256':refs['controllerResult']['sha256']}

def normal_source_for_arena(lease_fd):
    # The current free-only validator, not an obsolete parent's live PID, owns
    # source identity. Retain the already authenticated historical terminal
    # actors separately; that old proof never supplies the current source.
    if os.geteuid()!=0:fail('root_private_normal_source_reader_required')
    if NORMAL_RECEIPT_SHA=='0'*64:fail('actual_normal_source_runtime_receipt_pending')
    lease=os.fstat(lease_fd);named=SOURCE_LEASE.lstat()
    if(not stat.S_ISREG(lease.st_mode)or lease.st_uid!=0 or lease.st_nlink!=1 or lease.st_mode&0o022 or
       (lease.st_dev,lease.st_ino)!=(named.st_dev,named.st_ino)):fail('same_open_source_lease_required')
    try:fcntl.flock(lease_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:fail('paid_replay_must_close_before_normal_source_validation')
    path=OPS/'source6-normal-replay-successor-v2.py'
    for item in [*path.parents,path]:
        st=item.lstat()
        if stat.S_ISLNK(st.st_mode)or st.st_uid!=0 or st.st_mode&0o022:fail('protected_normal_source_reader_required')
    m=load(path,NORMAL_HELPER_SHA,'arena_current_normal_free_source_reader')
    if m.BASE!=NORMAL_BASE:fail('exact_normal_free_runtime_path_required')
    r,b,s=m.modules();value=m.validate(r,b,s,NORMAL_RECEIPT_SHA)
    raw=s.protected(NORMAL_BASE/'runtime.json')
    if sha(raw)!=NORMAL_RECEIPT_SHA:fail('exact_acknowledged_normal_free_receipt_required')
    receipt=json.loads(raw)
    if(value.get('format')!='yunipals-source6-normal-free-successor'or value.get('validated')is not True or
       value.get('runtimeReceiptSha256')!=NORMAL_RECEIPT_SHA or value.get('runtime')!=receipt.get('runtime')or
       value.get('normalOperationalRuntime')!='infinity'or value.get('freeOnly')is not True or
       value.get('paidAuthority')is not False or value.get('financialWindowRenewed')is not False or
       value.get('financialExpiresAt')!='2026-11-19T18:00:00+00:00'or
       receipt.get('freeOnly')is not True or receipt.get('paidAuthority')is not False or
       receipt.get('publicSelectionChanges')!=0 or receipt.get('baseSourceConcurrency')!=1 or
       receipt.get('heapMiB')!=4096 or receipt.get('memoryMaxBytes')!=6442450944):
        fail('exact_unselected_normal_free_runtime_required')
    terminal_raw=s.protected(TERMINAL_PROOF)
    if sha(terminal_raw)!=TERMINAL_PROOF_SHA:fail('exact_prior_terminal_proof_required')
    terminal=json.loads(terminal_raw);completion=productive_completed_controller()
    if(terminal.get('format')!='yunipals-arena-bnb-transaction-source-v1'or terminal.get('verified')is not True or
       len(terminal.get('actors',{}))!=1 or not set(terminal['actors'])<=set(RENEWAL_CONTROLLERS)or
       terminal.get('priorProductiveCompletion')!=completion):fail('authenticated_prior_terminal_actors_required')
    actual=value['runtime']
    if s.UNIT!='yunipals-unified-source6-free-v2.service':fail('exact_live_normal_source_required')
    configuration={key:receipt[key]for key in ['dropSha256','normalDropFile','bootLink','baseSourceConcurrency','heapMiB','memoryMaxBytes']}
    return {'format':'yunipals-arena-normal-free-source-v1','verified':True,'normalOperatorSha256':NORMAL_HELPER_SHA,
        'normalRuntimeReceiptSha256':NORMAL_RECEIPT_SHA,'normalConfigurationSha256':sha(encoded(configuration)),
        'terminalEvidenceSha256':TERMINAL_PROOF_SHA,'controllerResultSha256':terminal['controllerResultSha256'],
        'cleanupReceiptSha256':terminal['cleanupReceiptSha256'],'financialHandoffSha256':terminal['financialHandoffSha256'],
        'actors':terminal['actors'],'normalSource':{'unit':s.UNIT,'invocation':actual['invocation'],
            'process':{key:actual[key]for key in ['pid','startTicks']},'definitionSha256':sha(s.protected(s.ORIGINAL))},
        'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'sourceLeaseIdentity':{'dev':lease.st_dev,'ino':lease.st_ino},'priorProductiveCompletion':completion,
        'freeOnly':True,'paidAuthority':False,'financialWindowRenewed':False,'financialExpiresAt':value['financialExpiresAt'],
        'providerRequests':0,'serviceJobs':0,'sourceSelectionChanged':False,
        'normalSourceMustRemainRunning':True,'nativeReadinessClaimed':False}

def productive_is_quiet(lease_fd):
    normal=normal_source_for_arena(lease_fd)
    # Both known replay generations remain fenced. PID0 alone is insufficient
    # if a separately supervised native child or descendant is still running.
    states={unit:stopped(unit)for unit in PRODUCTIVE_UNITS}
    if any(s['MainPID']!='0'or s['ActiveState']not in{'inactive','failed'}or s['SubState']not in{'dead','failed'}for s in states.values()):fail('productive_controller_and_native_must_both_be_stopped')
    for unit,state in states.items():
        if unit in normal['actors']and state['InvocationID']not in {'',normal['actors'][unit]['invocation']}:fail('foreign_terminal_renewal_controller_refused')
        if state['LoadState']=='loaded':
            if unit in PRODUCTIVE_CURRENT and state['InvocationID']!=PRODUCTIVE_CURRENT[unit]:
                if unit!='yunipals-paid-productive-controller-v6-20261021-prod3.service'or state['InvocationID']!=''or(state['ActiveState'],state['SubState'],state['Result'],state['ExecMainStatus'])!=('inactive','dead','success','0'):fail('exact_current_productive_invocation_required')
                productive_completed_controller()
        elif state['LoadState']!='not-found'or state['InvocationID']!=''or state['ActiveState']!='inactive'or state['SubState']!='dead':fail('exact_productive_terminal_or_GC_state_required')
        group=productive_cgroup_empty(unit)
        if(state['Slice']!='system.slice'and not(state['LoadState']=='not-found'and state['Slice']==''))or state['ControlGroup']not in{'','/system.slice/'+unit}or state['ControlGroup']==''and group!='absent':fail('exact_productive_slice_and_control_group_required')
        if state['LoadState']=='not-found'and group!='absent':fail('GC_productive_unit_requires_absent_cgroup')
    if {unit:stopped(unit)for unit in PRODUCTIVE_UNITS}!=states:fail('productive_terminal_state_changed')
    return {u:{k:s[k]for k in ['LoadState','InvocationID','ActiveState','SubState','MainPID']}for u,s in states.items()}

def drain(o,v,bindings,processes):
    pending={};saved={}
    base=json.loads(o.read(OPS/'arena-config-public-baseline-v1.json',200000)[0])
    try:
        for row in bindings:
            unit=row['unit'];props=o.unit_state(v,unit)
            legacy_stop_policy(unit)
            if props['InvocationID']!=row['invocation']or v.definitions(props)!=row['unitDefinitionsSha256']:fail('reviewed_legacy_actor_changed_before_signal')
            pid=int(props['MainPID']);fd=os.pidfd_open(pid,0)
            pending[unit]=(fd,props['InvocationID'],pid,None)
            # Bind UID/GID, argv, exe, CWD, cgroup and start after pidfd-open.
            public=next(r for r in base['services']if r['unit']==unit)
            actual=process_identity(props,public);start=actual['startTicks']
            if actual!=processes[unit]or o.unit_state(v,unit)!=props:fail('exact_old_pid_start_fence_required')
            pending[unit]=(fd,props['InvocationID'],pid,start);signal.pidfd_send_signal(fd,signal.SIGTERM,None,0)
        deadline=time.monotonic()+75
        while pending:
            for unit,(fd,inv,pid,start)in list(pending.items()):
                poll=select.poll();poll.register(fd,select.POLLIN)
                if not poll.poll(0):continue
                state=stopped(unit)
                if state['InvocationID']!=inv:fail('foreign_legacy_restart_during_drain')
                if state['ActiveState']not in{'inactive','failed'}or state['MainPID']!='0':continue
                if state['Result']not in{'success','signal'}or state['ExecMainStatus']not in{'0','15','143'}:fail('legacy_exit_not_clean')
                saved[unit]={'state':state,'originalPid':pid,'originalStartTicks':start,'pidfdExitObserved':True};os.close(fd);del pending[unit]
            if time.monotonic()>=deadline:fail('legacy_graceful_drain_timeout_no_force')
            if pending:time.sleep(.1)
        return saved
    finally:
        for fd,*_ in pending.values():os.close(fd)

def postcheck(o,before,objects_before):
    after=snapshot()
    if after!=before:fail('retained_old_private_or_public_payload_changed')
    expected=json.loads(o.read(MIGRATIONS,100000)[0])['markers']
    actual=sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT jsonb_build_object('markers',(SELECT jsonb_agg(jsonb_build_object('version',version,'checksum',checksum)ORDER BY version)FROM yunipals_arena.operational_migration),'legacyMode',(SELECT bool_and(indexer_mode='legacy')FROM yunipals_arena.deployment),'selectionCount',(SELECT count(*)FROM yunipals_arena.source_selection),'historyCount',(SELECT count(*)FROM yunipals_arena.source_switch_history),'identityCount',(SELECT count(*)FROM yunipals_arena.tournament_identity),'identityLegacy',(SELECT bool_and(incarnation='legacy'AND cipher_context=deployment||'/'||tournament_id::text)FROM yunipals_arena.tournament_identity),'legacyAppIdentityInsert',has_table_privilege('yunipals_arena_app','yunipals_arena.tournament_identity','INSERT'),'legacyAppDeploymentRead',has_table_privilege('yunipals_arena_app','yunipals_arena.deployment','SELECT'));ROLLBACK;")
    if actual!={'markers':expected,'legacyMode':True,'selectionCount':0,'historyCount':0,'identityCount':2,'identityLegacy':True,'legacyAppIdentityInsert':True,'legacyAppDeploymentRead':True}:fail('official_legacy_compatibility_postcheck_failed')
    target=catalog();verify_target(target)
    if target['otherSessions']!=0:fail('legacy_workers_must_remain_drained_before_resume')
    objects_after=schema_objects();object_proof=verify_schema_objects(objects_before,objects_after);save(BASE/'objects-after.private.json',objects_after)
    return {'markersSha256':sha(encoded(expected)),'oldPayloadsSha256':sha(encoded(after)),'oldTableCounts':{k:len(v)for k,v in after.items()},'legacyIdentities':2,'sourceMode':'legacy','sourceSelectorCount':0,'oldApplicationTriggerDependenciesVerified':True,'officialObjects':object_proof}

def apply(plan,expected,o,v):
    global PHASE
    PHASE='fresh_review'
    checked=review(plan,o,v)
    if checked['reviewHash']!=expected:fail('fresh_exact_owner_review_required')
    if shutil.disk_usage('/var/backups').free<25000000000:fail('local_rollback_reserve_required')
    if os.path.lexists(BASE):fail('fresh_owner_evidence_directory_required_no_retry')
    BASE.mkdir(mode=0o700);save(BASE/'review.json',checked['binding'])
    result={'format':FORMAT,'reviewHash':expected,'migrationCommitOutcome':'not_attempted','resumed':False,'remoteBackupTransfers':0,'sourceSelectionChanged':False,'keyOrProviderConfigChanged':False}
    lock=os.open(BACKUP_LOCK,os.O_RDONLY|os.O_NOFOLLOW);fds=[]
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        verify_backup_lock(lock)
        with References():
            PHASE='graceful_legacy_drain'
            verify_inputs(o,checked['binding']['privateInputHashes'])
            save(BASE/'drain-intent.json',{'fixedUnits':list(UNITS),'forceKillAllowed':False})
            verify_original_definitions(o,checked['binding']['currentUnits'])
            result['stopped']=drain(o,v,checked['binding']['currentUnits'],checked['binding']['processes']);save(BASE/'drained.json',result['stopped'])
            target=catalog();verify_target(target)
            if target['otherSessions']!=0:fail('all_existing_arena_connections_must_drain')
            PHASE='private_baseline_and_local_backup'
            before=snapshot();save(BASE/'old-rows.private.json',before);objects_before=schema_objects();save(BASE/'objects-before.private.json',objects_before)
            fd=os.open(BASE/'arena-before.dump',os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
            with os.fdopen(fd,'wb')as out:
                run(peer_prefix()+['/usr/bin/pg_dump','--no-password','--format=custom','--lock-wait-timeout=2s','yunipals_arena'],timeout=75,output=out);out.flush();os.fsync(out.fileno())
            dump=BASE/'arena-before.dump'
            if not 0<dump.stat().st_size<=128000000:fail('bounded_local_rollback_dump_required')
            toc=run(['/usr/bin/pg_restore','--list',str(dump)],timeout=15,maximum=2000000);save(BASE/'local-rollback.json',{'dumpSha256':sha(dump.read_bytes()),'bytes':dump.stat().st_size,'tocSha256':sha(toc),'ownersAndAclsRetained':True,'externalTransfer':False})
            PHASE='official_owner_migration'
            verify_backup_lock(lock)
            verify_inputs(o,checked['binding']['privateInputHashes'])
            save(BASE/'migration-intent.json',{'cliSha256':CLI_SHA,'privateRowsSha256':sha(encoded(before)),'automaticRetry':False})
            result['migrationCommitOutcome']='unconfirmed_requires_catalog_reconcile'
            official_owner_migration()
            result['migrationCommitOutcome']='commit_confirmed';save(BASE/'migration-ack.json',{'outcome':'commit_confirmed','cliSha256':CLI_SHA})
            PHASE='retained_private_postcheck'
            result['postcheck']=postcheck(o,before,objects_before);save(BASE/'postcheck.json',result['postcheck'])
            # Root's exact review includes these eight compatible legacy paths;
            # no operational URL/provider/key/environment file is rewritten.
            PHASE='compatible_legacy_definitions'
            verify_backup_lock(lock)
            verify_inputs(o,checked['binding']['privateInputHashes'])
            verify_original_definitions(o,checked['binding']['currentUnits'])
            for role in ROLES:
                unit='yunipals-arena-'+role+'.service';parent=Path('/etc/systemd/system')/(unit+'.d')
                if parent.exists():
                    st=parent.lstat()
                    if not stat.S_ISDIR(st.st_mode)or st.st_uid!=0 or st.st_mode&0o022:fail('protected_unit_override_directory_required')
                else:parent.mkdir(mode=0o755)
                path=parent/DROPIN;body=dropin(role)
                fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o644)
                os.fchmod(fd,0o644)
                with os.fdopen(fd,'wb')as out:out.write(body);out.flush();os.fsync(out.fileno())
                directory_fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:os.fsync(directory_fd)
                finally:os.close(directory_fd)
                save(BASE/(role+'-override.json'),{'path':str(path),'sha256':sha(body)})
            PHASE='compatible_legacy_resume'
            run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
            save(BASE/'legacy-resume-intent.json',{'artifact':str(ROOT),'sourceMode':'legacy','units':list(UNITS)})
            run(['/usr/bin/systemctl','start','--no-block',*UNITS],timeout=10)
            deadline=time.monotonic()+45
            while True:
                current={unit:stopped(unit)for unit in UNITS}
                if all(p['ActiveState']=='active'and p['SubState']=='running'and p['MainPID']!='0'and p['InvocationID']!=result['stopped'][unit]['state']['InvocationID']for unit,p in current.items()):break
                if time.monotonic()>=deadline:fail('compatible_legacy_resumption_requires_manual_reconcile')
                time.sleep(.2)
            verify_inputs(o,checked['binding']['privateInputHashes'])
            configured=resumed_configuration(o,v,checked['binding']);save(BASE/'resumed-config.private.json',configured)
            result.update(resumed=True,legacyAfterInvocations={u:p['InvocationID']for u,p in current.items()},sourceModeAfter='legacy')
            save(BASE/'legacy-resumed.json',result)
        result['resultFile']=str(BASE/'result.json')
        result['resultSha256']=save(BASE/'result.json',result)
        return result
    except BaseException as error:
        result.update(errorClass=type(error).__name__,fixedCode=str(error)if isinstance(error,MigrationFailure)else'external_owner_operation_failed',manualReconciliationRequired=True,automaticRetryAllowed=False)
        save(BASE/'failed.json',result);raise
    finally:os.close(lock)

def main():
    global PHASE
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(900)
    a=argparse.ArgumentParser();a.add_argument('--plan',required=True);a.add_argument('--apply');args=a.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('fixed_root_host_required')
    o=observer();v=load(OPS/'proxy-upgrade.py',VERIFIER_SHA,'owner_existing_unit_verifier',o)
    raw,_=o.read(args.plan,100000);plan=json.loads(raw)
    with existing_source_lease() as lease_fd:
        productive_is_quiet(lease_fd)
        result=apply(plan,args.apply,o,v)if args.apply else review(plan,o,v)
    public={k:value for k,value in result.items()if k in{'format','reviewHash','migrationCommitOutcome','resumed','remoteBackupTransfers','sourceSelectionChanged','keyOrProviderConfigChanged','resultFile','resultSha256'}}
    public.update(privateValuesExported=False,automaticRetryAllowed=False)
    if not args.apply:public.update(status='reviewed',serviceJobs=0,databaseWrites=0)
    print(json.dumps(public,sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException as error:
        frames=[];trace=error.__traceback__
        while trace:
            if Path(trace.tb_frame.f_code.co_filename)==Path(__file__):frames.append({'function':trace.tb_frame.f_code.co_name,'line':trace.tb_lineno})
            trace=trace.tb_next
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if isinstance(error,MigrationFailure)else'external_owner_operation_failed','errorClass':type(error).__name__,'publicFrames':frames[-8:],'phase':PHASE,'rawMessagesExported':False,'automaticRetryAllowed':False}));raise SystemExit(1)
