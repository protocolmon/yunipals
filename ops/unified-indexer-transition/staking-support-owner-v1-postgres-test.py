#!/usr/bin/env python3
"""Actual local SQL compatibility only; every fixture object is rolled back."""
import importlib.util,json,select,subprocess,time,types
from pathlib import Path
HERE=Path(__file__).parent

def load(name):
 p=HERE/(name+'.py');s=importlib.util.spec_from_file_location(name.replace('-','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
M=load('staking-support-owner-v1');R=load('staking-support-prerequisite-observe-v1');P=load('application-recovery-native-column-v1')
ROOT=Path('/tmp/yunipals-unified-release-t5c5idvw/unpacked');SCHEMAS=M.SCHEMAS;TABLE_OWNER='test_staking_metadata_owner_20261021'
proc=subprocess.Popen(['docker','--host=unix:///var/run/docker.sock','exec','-i','yunipals-unified-indexer-test-20261020','/usr/bin/timeout','--signal=TERM','30s','psql','-XwqAt','-U','unified_test','-d','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
def send(sql):proc.stdin.write(sql+'\n');proc.stdin.flush()
def receive():
 if not select.select([proc.stdout],[],[],12)[0]:raise RuntimeError('fixture_response_timeout')
 line=proc.stdout.readline()
 while line and not line.strip():line=proc.stdout.readline()
 if not line:raise RuntimeError('fixture_SQL_failed:'+proc.stderr.read()[:400])
 return json.loads(line)
def query(sql):send(sql+';');return receive()
started=time.monotonic()
try:
 send("BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;SET LOCAL statement_timeout='8s';DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN("+','.join(M.literal(n)for n in SCHEMAS)+"))OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN("+M.literal(M.ROLE)+','+M.literal(TABLE_OWNER)+"))THEN RAISE EXCEPTION 'fixture_namespace_occupied';END IF;END$$;")
 send('CREATE ROLE '+TABLE_OWNER+' NOLOGIN;'+''.join('CREATE SCHEMA '+n+';'for n in SCHEMAS))
 for n in M.RELATIONS:
  if n.startswith('metadata.')or n.startswith(M.READ+'.'):continue
  if n.endswith('.release'):send('CREATE TABLE '+n+'(id text,physical_schema text,build_id text);INSERT INTO '+n+' VALUES('+','.join(M.literal(x)for x in [R.RELEASE,R.PHYSICAL,'bf4939b3ff'])+');')
  else:send('CREATE TABLE '+n+'(id int);')
 send('CREATE TABLE '+M.READ+'._unified_read_release(singleton bool,identity text,release_id text);INSERT INTO '+M.READ+'._unified_read_release VALUES(true,'+M.literal(R.IDENTITY)+','+M.literal(R.RELEASE)+');CREATE VIEW '+M.READ+'.transfer_event WITH(security_invoker=true)AS SELECT*FROM '+M.PHYSICAL+'.transfer_event;')
 send('CREATE FUNCTION '+M.FUNCTIONS[0]+"RETURNS int LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS'SELECT 1';CREATE FUNCTION "+M.FUNCTIONS[1]+"RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS'SELECT jsonb_build_object(''ready'',true)';REVOKE ALL ON FUNCTION "+','.join(M.FUNCTIONS)+' FROM PUBLIC;')
 source=(ROOT/'apps/yunipals-indexer/lib/islands/staking-verifier.ts').read_text();statements=__import__('re').findall(r'`([^`]*)`',source)
 for statement in statements[:2]:send(statement+';')
 send('GRANT USAGE ON SCHEMA metadata TO '+TABLE_OWNER+';ALTER TABLE metadata.island_staking_scan OWNER TO '+TABLE_OWNER+';ALTER TABLE metadata.island_staking_position OWNER TO '+TABLE_OWNER+';INSERT INTO metadata.island_staking_scan VALUES(\'old_schema\',\'old_build\',\'ready\',1,\'old_hash\',now());INSERT INTO metadata.island_staking_position VALUES(\'old_schema\',\'old_build\',\'1\',1,\'old_event\',NULL);')
 before={'identity':query("SELECT jsonb_build_object('systemId',(SELECT system_identifier::text FROM pg_control_system()))"),'tables':query(M.table_query(R,P)),'functions':query(M.functions_query()),'role':None}
 actual={'format':R.FORMAT,'catalog':before,'sourcePins':R.SOURCES,'osActor':{'exists':False,'restricted':False}}
 o=types.SimpleNamespace(ROOT=ROOT,protected=lambda path,cap:path.read_bytes())
 text=M.prepare(R,o,P,actual,(HERE/'staking-support-admission-v1.sql').read_bytes())
 # Only the actual local DB/session owner is substituted; the source/catalog,
 # role, full DDL/grant/ACL/invoker/row proof SQL is emitted unchanged.
 target="current_database()<>'yunipals_backfill' OR current_user<>'postgres' OR session_user<>'postgres'"
 assert text.count(target)==1
 text=text.replace(target,"current_database()<>'postgres' OR current_user<>'unified_test' OR session_user<>'unified_test'")
 text=text.replace('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;','',1);assert text.rstrip().endswith('COMMIT;');text=text.rstrip()[:-len('COMMIT;')]
 send(text);proof=M.validate_proof(receive());assert proof['scanRowsBefore']['count']==1 and proof['positionRowsBefore']['count']==1
 login=(HERE/'staking-support-login-v1.sql').read_text();identity="current_database()<>'yunipals_backfill'OR current_user<>'postgres'OR session_user<>'postgres'";assert login.count(identity)==1
 login=login.replace(identity,"current_database()<>'postgres'OR current_user<>'unified_test'OR session_user<>'unified_test'").replace('BEGIN;','',1);assert login.rstrip().endswith('COMMIT;');login=login.rstrip()[:-len('COMMIT;')]
 send('\\set expected_oid '+proof['roleOid'])
 for enabled in ['true','false']:
  send('\\set enabled '+enabled);send(login);ack=receive();assert ack['login']is(enabled=='true')and ack['roleOid']==proof['roleOid']and ack['grantsChanged']is False
 role=query("SELECT jsonb_build_object('login' ,rolcanlogin,'passwordNull',rolpassword IS NULL,'limit',rolconnlimit)FROM pg_authid WHERE rolname="+M.literal(M.ROLE));assert role=={'login':False,'passwordNull':True,'limit':2}
 after=query(M.table_query(R,P));assert (after['metadata.island_staking_scan']['table']['fileNode'],after['metadata.island_staking_position']['table']['fileNode'])==(before['tables']['metadata.island_staking_scan']['table']['fileNode'],before['tables']['metadata.island_staking_position']['table']['fileNode'])
 send('ROLLBACK;');absent=query("SELECT jsonb_build_object('schemasAbsent',NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN("+','.join(M.literal(n)for n in SCHEMAS)+")),'rolesAbsent',NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN("+M.literal(M.ROLE)+','+M.literal(TABLE_OWNER)+')))');assert all(absent.values());proc.stdin.close();assert proc.wait(timeout=5)==0
 print(json.dumps({'format':'yunipals-staking-owner-local-pg-v1','passed':True,'helperSha256':M.sha((HERE/'staking-support-owner-v1.py').read_bytes()),'SQLSha256':M.SQL_SHA,'actualGeneratedSQL':True,'localIdentitySubstitutionOnly':True,'officialNullableColumns':2,'newRoleNoLogin':True,'exactGrantBindings':len(M.required_new_rights()),'fullOldACLAndRowProof':True,'nonsuperMetadataOwnerPreserved':True,'actualSameOidLoginAndNoLoginProof':True,'noTableRewrite':True,'fullRollback':True,'elapsedSeconds':round(time.monotonic()-started,3),**absent},sort_keys=True))
finally:
 if proc.poll()is None:proc.kill();proc.wait()
