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
FORMAT='yunipals-consumer-generation-v4-proof-v1'
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


def cache_proof(a,owner,helper,target):
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
    if owner.json_sql(sql)!={'fresh':True}:
        fail('actual_selected_canonical_v4_read_cache_not_fresh')
    if owner.json_sql(generation_sql())!=before:
        fail('active_v4_generation_changed_during_acceptance')
    if helper.check_current()!=runtime:
        fail('accepted_generation_runtime_changed')
    return {'format':FORMAT,'generationId':identifier,'readSchema':SCHEMA,'readIdentity':IDENTITY,
            'sql':sql,'sqlSha256':a.sha(sql.encode()),'actualFresh':True,
            'officialFunction':'readCacheFreshSql','ownerReceiptSha256':OWNER_SHA,
            'candidateReceiptSha256':CANDIDATE_SHA,'runtime':runtime,
            'generationRechecked':True,'serviceChanges':0,'databaseWrites':0,'providerCalls':0}
