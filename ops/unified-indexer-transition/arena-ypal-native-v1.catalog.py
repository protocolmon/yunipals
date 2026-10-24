#!/usr/bin/env python3
"""Finite readonly new Arena source catalog capture; default performs no DB call."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess

FORMAT='yunipals-arena-ypal-source-catalog-v1'
BASE=Path('/var/backups/yunipals-arena-ypal-catalog-v1-20261024')
RESULT=BASE/'result.json'
SOURCE='unified_ypal_20261023_v1'
RELEASE='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST='0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
SENTINEL='/run/yunipals-arena-ypal-catalog-no-password'
CLEAN={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def sql():
    return """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog;
DO $identity$ BEGIN
 IF current_database()<>'yunipals_backfill' OR current_setting('port')<>'5432' OR session_user<>'postgres' OR current_user<>'postgres'
 OR (SELECT oid FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 17584::oid
 OR (SELECT oid FROM pg_namespace WHERE nspname='unified_ypal_20261023_v1') IS DISTINCT FROM 75963410::oid
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='unified_ypal_20261023_v1') IS DISTINCT FROM 73004621::oid
 OR (SELECT oid FROM pg_namespace WHERE nspname='yunipals_indexer_control') IS DISTINCT FROM 73011094::oid
 OR (SELECT value->>'build_id' FROM unified_ypal_20261023_v1._ponder_meta WHERE key='app') IS DISTINCT FROM '71e2a7f3b7'
 OR NOT EXISTS(SELECT 1 FROM yunipals_indexer_control.release WHERE id='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3' AND manifest_hash='0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112' AND physical_schema='unified_ypal_20261023_v1' AND build_id='71e2a7f3b7')
 THEN RAISE EXCEPTION 'fixed_4e_71e_source_identity_changed'; END IF;
END $identity$;
WITH scope AS MATERIALIZED(SELECT * FROM pg_namespace WHERE oid IN(75963410,73011094)),
 functions AS MATERIALIZED(SELECT p.*,n.nspname,l.lanname FROM pg_proc p JOIN scope n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.prokind='f')
SELECT jsonb_build_object(
 'databaseOid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'releaseId','0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3','manifestHash','0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112','buildId','71e2a7f3b7',
 'database',(SELECT jsonb_build_object('ownerOid',datdba::bigint,'connect',datallowconn,'limit',datconnlimit,'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('granteeOid',a.grantee::bigint,'grantorOid',a.grantor::bigint,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)FROM aclexplode(coalesce(datacl,acldefault('d',datdba)))a)) FROM pg_database WHERE datname=current_database()),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'oid',oid::bigint,'ownerOid',nspowner::bigint,'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('granteeOid',a.grantee::bigint,'grantorOid',a.grantor::bigint,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner)))a))ORDER BY oid)FROM scope),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid::bigint,'schema',nspname,'name',proname,'ownerOid',proowner::bigint,'language',lanname,'signature',pg_get_function_identity_arguments(oid),'result',pg_get_function_result(oid),'securityDefiner',prosecdef,'leakproof',proleakproof,'config',proconfig,'bodySha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'),'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('granteeOid',a.grantee::bigint,'grantorOid',a.grantor::bigint,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)FROM aclexplode(coalesce(proacl,acldefault('f',proowner)))a))ORDER BY oid),'[]'::jsonb)FROM functions),
 'defaultAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid::bigint,'ownerOid',defaclrole::bigint,'schemaOid',defaclnamespace::bigint,'objectType',defaclobjtype,'acl',(SELECT jsonb_agg(jsonb_build_object('granteeOid',a.grantee::bigint,'grantorOid',a.grantor::bigint,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type)FROM aclexplode(defaclacl)a))ORDER BY oid),'[]'::jsonb)FROM pg_default_acl WHERE defaclnamespace IN(0,75963410,73011094)),
 'sourceRole',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'oid',oid::bigint,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit)),'[]'::jsonb)FROM pg_roles WHERE rolname='arena_native_reader'),
 'relationIdentities',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid::bigint,'name',n.nspname||'.'||c.relname,'ownerOid',c.relowner::bigint,'kind',c.relkind,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity)ORDER BY c.oid)FROM pg_class c JOIN scope n ON n.oid=c.relnamespace WHERE c.relname IN('_ponder_meta','_ponder_checkpoint','arena_tournament','arena_credit','canonical_event','chain_block','chain_checkpoint','indexer_source','transaction_candidate','release','chain_status','chain_anchor','transaction_evidence'))
);
ROLLBACK;
"""


def peer_args():
    need(not os.path.lexists(SENTINEL),'absent_no_password_sentinel_required')
    u=pwd.getpwnam('postgres');need(u.pw_uid>0 and u.pw_gid>0,'existing_postgres_peer_required')
    return ['/usr/bin/setpriv','--reuid='+str(u.pw_uid),'--regid='+str(u.pw_gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGHOST=/var/run/postgresql','PGPORT=5432','PGDATABASE=yunipals_backfill','PGUSER=postgres','PGPASSFILE='+SENTINEL,'PGAPPNAME=arena_ypal_source_catalog','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000','/usr/bin/psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1']


def capture():
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_host_required')
    need(not os.path.lexists(BASE),'exclusive_catalog_operation_required')
    for p in [*Path(__file__).absolute().parents,Path(__file__).absolute()]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_catalog_operator_required')
    before=Path(__file__).read_bytes();query=sql().encode()
    proc=subprocess.run(peer_args(),input=query,capture_output=True,env=CLEAN,timeout=12)
    need(proc.returncode==0 and not proc.stderr and len(proc.stdout)<1000000,'bounded_clean_readonly_catalog_required')
    doc=json.loads(proc.stdout)
    need(doc['readOnly']is True and doc['isolation']=='repeatable read'and doc['databaseOid']==17584 and doc['releaseId']==RELEASE and doc['manifestHash']==MANIFEST and doc['buildId']=='71e2a7f3b7','exact_readonly_source_catalog_required')
    need(Path(__file__).read_bytes()==before,'catalog_operator_changed')
    result={'format':FORMAT,'operatorSha256':sha(before),'sqlSha256':sha(query),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'catalog':doc,'databaseWrites':0,'serviceChanges':0,'providerRequests':0,'passwordsRead':False,'functionBodiesExported':False}
    os.umask(0o077);BASE.mkdir(mode=0o700)
    fd=os.open(RESULT,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(encoded(result));f.flush();os.fsync(f.fileno())
    for p in [BASE,BASE.parent]:
        fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
    return {'format':FORMAT,'captured':True,'resultFile':str(RESULT),'resultSha256':sha(encoded(result)),'operatorSha256':sha(before),'sqlSha256':sha(query),'functionOids':[f['oid']for f in doc['functions']],'functionCount':len(doc['functions']),'defaultAclCount':len(doc['defaultAcl']),'sourceRoleCount':len(doc['sourceRole']),'databaseWrites':0,'serviceChanges':0,'providerRequests':0,'functionBodiesExported':False,'passwordsRead':False}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--capture',action='store_true');a=p.parse_args()
    if a.capture:print(json.dumps(capture(),sort_keys=True))
    else:print(json.dumps({'format':FORMAT,'operatorSha256':sha(Path(__file__).read_bytes()),'sqlSha256':sha(sql().encode()),'resultFile':str(RESULT),'captured':False,'databaseCalls':0,'serviceChanges':0,'providerRequests':0},sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException as e:
        print(json.dumps({'format':FORMAT,'captured':False,'errorClass':type(e).__name__,'rawMessagesExported':False,'automaticRetry':False},sort_keys=True));raise SystemExit(1)
