#!/usr/bin/env python3
"""V4 generation/cache acceptance using the installed official SQL compiler.

This is a read-only admission component, not a service switch. The final v4
preview and installation operators must bind its result to their own receipts.
"""
import json
from pathlib import Path
import re

SCHEMA='yunipals_ownership_35cdcb32_v4'
IDENTITY='0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d'
RELEASE='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
FORMAT='yunipals-consumer-generation-v4-proof-v2'
OWNER_RECEIPT=Path('/var/backups/yunipals-metadata-readview-v4-owner-v1-20261022/result.json')
OWNER_SHA='ad4a5004e84a9aae47e301c50af1268b88e03b8bf3c812b4096c89390a0ab24c'
CANDIDATE_RECEIPT=Path('/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022/result.json')
CANDIDATE_SHA='be0e6ec9f39d9b967a5395a7955496be801a04dc26cf90f3ce7173941e8591a0'


def fail(code):
    raise RuntimeError(code)


def selectors(target):
    value=target['publicSelectors']
    expected={'OWNERSHIP_READ_MODE':'unified','OWNERSHIP_READ_SCHEMA':SCHEMA,
              'READ_DATABASE_SCHEMA':SCHEMA,'OWNERSHIP_RELEASE_ID':RELEASE,'YUNIPALS_PROJECTION_MODE':'generation'}
    if any(value.get(key)!=want for key,want in expected.items()):
        fail('exact_v4_generation_selectors_required')
    return value


def generation_sql():
    return f"""SELECT jsonb_build_object('id',g.id::text,'state',g.state,
      'ownershipReleaseId',g.ownership_release_id,'ownershipReadIdentity',g.ownership_read_identity,
      'viewReleaseId',r.release_id,'viewReadIdentity',r.identity)
      FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.current_id
      CROSS JOIN {SCHEMA}._unified_read_release r WHERE a.singleton AND r.singleton"""


def generation(value):
    if (not isinstance(value,dict) or not isinstance(value.get('id'),str)
            or not re.fullmatch('[1-9][0-9]*',value['id']) or value.get('state')!='ready'
            or value.get('ownershipReleaseId')!=RELEASE or value.get('viewReleaseId')!=RELEASE
            or value.get('ownershipReadIdentity')!=IDENTITY or value.get('viewReadIdentity')!=IDENTITY):
        fail('actual_ready_generation_with_v4_identity_required')
    return value['id']



def guard_sql():
    # Exact native layout from the retained official installReadCache function.
    common=['metadata.token_metadata','metadata.token_publication','metadata_projection.search',
            'metadata_projection.revision','metadata_source.archive_release']
    physical='unified_shadow_20261020_7e7375b0'
    values=[]
    for chain in ('ethereum','base','polygon','bnb'):
        names=common+[physical+'.token',physical+'.token_lifecycle',physical+'.transfer_event']
        if chain=='base':names += [physical+'.canonical_event','metadata_source.native_base_metadata_state','metadata.publication_runtime']
        values += ["('"+chain+"','"+name+"'::regclass)" for name in names]
    return """WITH wanted(collection,relation_oid)AS(VALUES """+','.join(values)+"""),
      expected AS(SELECT w.*,g.relation FROM wanted w LEFT JOIN metadata_projection.read_guard g USING(collection,relation_oid))
      SELECT jsonb_build_object('valid',
        NOT EXISTS(SELECT 1 FROM expected e WHERE e.relation IS NULL OR to_regclass(e.relation) IS DISTINCT FROM e.relation_oid
          OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=e.relation_oid AND t.tgname='read_cache_dirty' AND t.tgenabled='A'
            AND t.tgfoid=CASE WHEN e.relation_oid IN('metadata_projection.search'::regclass,'metadata_projection.revision'::regclass)
              THEN 'metadata_projection.read_cache_projection_dirty()'::regprocedure ELSE 'metadata_projection.read_cache_dirty()'::regprocedure END)
          OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=e.relation_oid AND t.tgname='read_cache_truncate' AND t.tgenabled='A'
            AND t.tgfoid='metadata_projection.read_cache_dirty()'::regprocedure)
          OR(e.relation_oid IN('metadata_projection.search'::regclass,'metadata_projection.revision'::regclass)
            AND(SELECT count(*)FROM pg_trigger t WHERE t.tgrelid=e.relation_oid AND t.tgname IN('read_cache_dirty_update','read_cache_dirty_delete')
              AND t.tgenabled='A' AND t.tgfoid='metadata_projection.read_cache_projection_dirty()'::regprocedure)<>2))
        AND NOT EXISTS(SELECT 1 FROM metadata_projection.read_guard g WHERE g.collection IN('ethereum','base','polygon','bnb')
          AND NOT EXISTS(SELECT 1 FROM wanted w WHERE w.collection=g.collection AND w.relation_oid=g.relation_oid))
        AND(SELECT count(*)FROM metadata_projection.read_guard WHERE collection IN('ethereum','base','polygon','bnb'))=35
        AND(SELECT count(*)FROM metadata_projection.read_epoch WHERE collection IN('ethereum','base','polygon','bnb'))=4)"""


def cache_proof(a,owner,helper,target,*,require_fresh=True):
    public=selectors(target)
    receipt=a.document(OWNER_RECEIPT,OWNER_SHA)
    staged=a.document(CANDIDATE_RECEIPT,CANDIDATE_SHA)
    if (receipt.get('committed')is not True or receipt.get('rehearsed')is not False
            or receipt.get('readSchema')!=SCHEMA or receipt.get('readIdentity')!=IDENTITY
            or staged.get('readSchema')!=SCHEMA or staged.get('readIdentity')!=IDENTITY):
        fail('actual_v4_owner_and_candidate_receipts_required')
    # Call the acknowledged runtime facade before importing official functions.
    runtime=helper.check_current()
    before=owner.json_sql(generation_sql());identifier=generation(before)
    project=helper.ROOT/'apps/yunipals-indexer'
    code=('import {readCacheFreshSql}from'+json.dumps(str(project/'lib/metadata/read-cache.ts'))+';'
          +'import {collectionSlugs}from'+json.dumps(str(project/'lib/constants.ts'))+';'
          +'console.log(JSON.stringify({sql:"SELECT jsonb_build_object(\'fresh\',"+'
          +'readCacheFreshSql('+json.dumps(identifier)+',collectionSlugs)+")"}));process.exit(0);')
    args=['/usr/bin/env','-i','PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC',
          *[key+'='+value for key,value in public.items()],helper.NODE,'--import','tsx','--input-type=module','-e',code]
    prepared=json.loads(helper.run(args,timeout=25,cwd=str(project)));sql=prepared['sql']
    if (not isinstance(sql,str) or len(sql)>100000 or not sql.startswith("SELECT jsonb_build_object('fresh',")
            or SCHEMA not in sql or 'yunipals_ownership_35cdcb32_v3' in sql):
        fail('official_v4_read_cache_fresh_SQL_required')
    guards=owner.json_sql(guard_sql())
    if guards!={'valid':True}:fail('exact_enabled_native_cache_guards_required')
    observed=owner.json_sql(sql)
    if not isinstance(observed,dict) or set(observed)!={'fresh'} or type(observed['fresh'])is not bool:
        fail('actual_cache_freshness_boolean_required')
    if require_fresh and not observed['fresh']:
        fail('actual_selected_canonical_v4_read_cache_not_fresh')
    if owner.json_sql(generation_sql())!=before:
        fail('active_v4_generation_changed_during_acceptance')
    if helper.check_current()!=runtime:
        fail('accepted_generation_runtime_changed')
    return {'format':FORMAT,'generationId':identifier,'readSchema':SCHEMA,'readIdentity':IDENTITY,
            'sql':sql,'sqlSha256':a.sha(sql.encode()),'actualFresh':observed['fresh'],'bootstrapRequired':not observed['fresh'],'nativeGuardsVerified':True,
            'officialFunction':'readCacheFreshSql','ownerReceiptSha256':OWNER_SHA,
            'candidateReceiptSha256':CANDIDATE_SHA,'runtime':runtime,
            'generationRechecked':True,'serviceChanges':0,'databaseWrites':0,'providerCalls':0}
