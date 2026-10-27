#!/usr/bin/env python3
"""One official nullable-column compatibility migration on the isolated clone."""
import hashlib
import json
import os
import re

FORMAT = "yunipals-application-recovery-native-column-v1"
SOURCE = "apps/yunipals-indexer/lib/metadata/native-base-schema.ts"
SOURCE_SHA = "9104e7a1e58e987370d4fb45c870269b274cd6ce5db21d2567ff0461b4f9d6ca"
STATEMENT = "ALTER TABLE metadata.token_publication ADD COLUMN IF NOT EXISTS chain_event_block_hash text"
DATA = "/mnt/HC_Volume_107222036/typed-20261021-d/pgdata"
SYSTEM_ID = "7699063110934209473"


def encoded(value): return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def fail(message): raise RuntimeError(message)


def save(path, value):
    with path.open("xb") as output:
        os.fchmod(output.fileno(), 0o600); output.write(encoded(value)+b"\n"); output.flush(); os.fsync(output.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def official(raw):
    if sha(raw) != SOURCE_SHA or re.findall(r"`([^`]*)`", raw.decode()).count(STATEMENT) != 1:
        fail("Exact frozen9ee official nullable publication-column statement required.")
    return {"format": FORMAT, "source": SOURCE, "sourceSha256": SOURCE_SHA,
            "statementSha256": sha(STATEMENT.encode()), "nullable": True, "default": None,
            "applicationRowsUpdated": False, "sourceSelectionChanged": False}


def target_sql():
    return """WITH t AS(SELECT c.oid,c.relkind,c.relowner,c.relacl,c.relfilenode,c.relnatts,c.relpersistence,c.reltype,
 n.oid AS schema_oid,pg_get_userbyid(c.relowner) AS owner_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='metadata'AND c.relname='token_publication')
 SELECT jsonb_build_object('table',(SELECT jsonb_build_object('oid',oid::text,'schemaOid',schema_oid::text,'kind',relkind,
 'ownerOid',relowner::text,'ownerName',owner_name,'acl',relacl::text,'fileNode',relfilenode::text,'attributes',relnatts,
 'persistence',relpersistence,'rowTypeOid',reltype::text)FROM t),
 'columns',(SELECT jsonb_agg(jsonb_build_object('number',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
 'hasMissing',a.atthasmissing,'missingValue',a.attmissingval::text,'acl',a.attacl::text)ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=(SELECT oid FROM t)AND a.attnum>0 AND NOT a.attisdropped),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('oid',indexrelid::text,'definition',pg_get_indexdef(indexrelid),
 'valid',indisvalid,'ready',indisready)ORDER BY indexrelid)FROM pg_index WHERE indrelid=(SELECT oid FROM t)),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'definition',pg_get_constraintdef(oid,false),
 'validated',convalidated)ORDER BY oid)FROM pg_constraint WHERE conrelid=(SELECT oid FROM t)),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'definition',pg_get_triggerdef(oid,false),
 'enabled',tgenabled,'internal',tgisinternal)ORDER BY oid)FROM pg_trigger WHERE tgrelid=(SELECT oid FROM t)))"""


def migration_sql(expected_owner):
    if not isinstance(expected_owner, str) or not re.fullmatch("[a-z_][a-z0-9_]{0,62}", expected_owner):
        fail("Authenticated simple existing table owner required.")
    query = target_sql()
    return """BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;
SET LOCAL search_path=pg_catalog;
SET LOCAL standard_conforming_strings=on;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='1500ms';
SET LOCAL idle_in_transaction_session_timeout='15s';
DO $exact_clone_publication_column$
DECLARE b jsonb;a jsonb;old_columns jsonb;added jsonb;before_count bigint;after_count bigint;
BEGIN
 IF current_database()<>'yunipals_backfill'OR current_user<>'yunipals_full_restore_admin'
 OR current_setting('data_directory')<>'"""+DATA+"""'
 OR(SELECT system_identifier::text FROM pg_control_system())<>'"""+SYSTEM_ID+"""'
 OR inet_server_addr()IS NOT NULL OR current_setting('listen_addresses')<>''
 OR current_setting('archive_mode')<>'off'OR current_setting('default_transaction_read_only')<>'on'
 OR current_setting('transaction_read_only')<>'off'OR current_setting('shared_preload_libraries')<>''
 OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE backend_type='client backend'AND pid<>pg_backend_pid())
 THEN RAISE EXCEPTION 'Exact idle isolated clone compatibility transaction required';END IF;
 LOCK TABLE metadata.token_publication IN ACCESS EXCLUSIVE MODE;
 SELECT q.value INTO b FROM("""+query+""")q(value);
 IF b#>>'{table,kind}'<>'r'OR b#>>'{table,persistence}'<>'p'OR b#>>'{table,ownerName}'<>'"""+expected_owner+"""'
 OR b->'columns'IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'columns')c WHERE c->>'name'='chain_event_block_hash')
 THEN RAISE EXCEPTION 'Existing accepted publication table with missing official column required';END IF;
 SELECT count(*)INTO before_count FROM metadata.token_publication;
 """+STATEMENT+""";
 SELECT q.value INTO a FROM("""+query+""")q(value);
 SELECT jsonb_agg(c ORDER BY(c->>'number')::integer)INTO old_columns
 FROM jsonb_array_elements(a->'columns')c WHERE c->>'name'<>'chain_event_block_hash';
 SELECT c INTO added FROM jsonb_array_elements(a->'columns')c WHERE c->>'name'='chain_event_block_hash';
 IF(a-'columns')<>(jsonb_set(b,'{table,attributes}',to_jsonb((b#>>'{table,attributes}')::integer+1))-'columns')
 OR old_columns IS DISTINCT FROM b->'columns'
 OR added IS DISTINCT FROM jsonb_build_object('number',(b#>>'{table,attributes}')::integer+1,
 'name','chain_event_block_hash','type','text','notNull',false,'default',NULL,'identity','','generated','',
 'hasMissing',false,'missingValue',NULL,'acl',NULL)
 THEN RAISE EXCEPTION 'Only one nullable text column and no rewrite/ACL/index/constraint/trigger delta permitted';END IF;
 SELECT count(*)INTO after_count FROM metadata.token_publication;
 IF after_count<>before_count THEN RAISE EXCEPTION 'Publication row count changed';END IF;
 PERFORM set_config('yunipals.recovery_publication_column_proof',jsonb_build_object('before',b,'after',a,
 'rowsBefore',before_count,'rowsAfter',after_count,'applied',true,'dataBackfilled',false,'hashesManufactured',false)::text,true);
END $exact_clone_publication_column$;
SELECT current_setting('yunipals.recovery_publication_column_proof');
COMMIT;
"""


def validate_proof(proof):
    if not isinstance(proof, dict) or set(proof) != {"before", "after", "rowsBefore", "rowsAfter", "applied", "dataBackfilled", "hashesManufactured"}:
        fail("Exact recorded compatibility proof required.")
    if proof["applied"] is not True or proof["dataBackfilled"] is not False or proof["hashesManufactured"] is not False or type(proof["rowsBefore"]) is not int or type(proof["rowsAfter"]) is not int or proof["rowsBefore"] < 0 or proof["rowsBefore"] != proof["rowsAfter"]:
        fail("Unchanged counted publication rows and no fabricated hash required.")
    before, after = proof["before"], proof["after"]
    expected = json.loads(json.dumps(before)); expected["table"]["attributes"] += 1
    added = {"number": expected["table"]["attributes"], "name": "chain_event_block_hash", "type": "text", "notNull": False,
             "default": None, "identity": "", "generated": "", "hasMissing": False, "missingValue": None, "acl": None}
    expected["columns"].append(added)
    if expected != after: fail("Unexpected compatibility catalog delta; manual reconciliation required.")
    return proof


def apply_owned(owner, p, m, reviewed):
    """Called only after exact owner review and real isolated quarantine."""
    raw = p.protected(owner.source_root / SOURCE, 100000)
    if official(raw) != reviewed: fail("Reviewed official compatibility input changed.")
    catalog = p.protected(p.VERIFIED/"restored-private-catalog.json", 100000)
    if sha(catalog) != "e59821abc4285b09155d434f7fa3dac60eb34eebb7146f33741a8fb3be644cfe":
        fail("Accepted original typed table/owner catalog changed.")
    original = json.loads(catalog)
    rows = [r for r in original["tables"] if r["schema"] == "metadata" and r["name"] == "token_publication"]
    if len(rows) != 1: fail("Accepted original table owner evidence required.")
    sql = migration_sql(rows[0]["owner"])
    owner.audit("candidate_compatibility_official_publication_column")
    owner.report["candidateCompatibilityTransactionOutcome"] = "unconfirmed_requires_catalog_reconcile"
    save(owner.work/"candidate-compatibility-prepared.json", {"format": FORMAT, "official": reviewed, "sqlSha256": sha(sql.encode()),
           "acceptedOriginalTypedProofPreserved": True, "automaticRetry": False})
    result = owner.psql(sql, timeout=130)
    proof = validate_proof(json.loads(result))
    save(owner.work/"candidate-compatibility-applied.json", {"format": FORMAT, "official": reviewed, "proof": proof,
           "acceptedOriginalTypedProofPreserved": True, "originalRoleAuthenticationRecovered": False})
    owner.report["candidateCompatibilityTransactionOutcome"] = "commit_confirmed"
    owner.report["candidateCompatibility"] = {"official": reviewed, "proofSha256": sha(encoded(proof)), "applied": True,
           "publicationRowCountUnchanged": True, "dataBackfilled": False, "hashesManufactured": False,
           "acceptedOriginalTypedProofPreserved": True, "originalRoleAuthenticationRecovered": False}
