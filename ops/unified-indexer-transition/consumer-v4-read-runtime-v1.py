#!/usr/bin/env python3
"""V4 selected reads over the unchanged acknowledged runtime and ACL ancestry.

The retained v3 ACL catalog remains the original operational permission proof.
The additive v4 views have a separate exact committed owner receipt and live
ACL/identity check. A previous v3 preview is never a v4 serving receipt.
"""
import copy
from pathlib import Path

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OWNER_SHA='011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948'
STAGE_SHA='19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c'
CACHE_SHA='0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f'
OLD_SCHEMA='yunipals_ownership_35cdcb32_v3'
OLD_IDENTITY='0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc'
SCHEMA='yunipals_ownership_35cdcb32_v4'
IDENTITY='0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d'
DEFINITIONS_SHA='5cfae260c056a73e2f195586bc69eae651a71e7f4d4e8e191b8aee14e0db350c'


def fail(code):raise RuntimeError(code)


def definition_sql():
    # Search path is fixed so pg_get_* always qualifies the same source objects.
    return f"""SET LOCAL search_path=pg_catalog;
      SELECT jsonb_build_object(
       'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,
         'definition',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,false) END) ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace='{SCHEMA}'::regnamespace AND c.relkind IN('r','v')),
       'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'args',oidvectortypes(p.proargtypes),
         'invoker',NOT p.prosecdef,'searchPath',p.proconfig,'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname)
         FROM pg_proc p WHERE p.pronamespace='{SCHEMA}'::regnamespace))"""


def old_scope(scope):
    result=copy.deepcopy(scope)
    if result['readView']['schema']!=SCHEMA or result['readView']['identity']!=IDENTITY:
        fail('v4_selected_scope_required')
    prior=result.pop('operationalAclReadView')
    if prior['schema']!=OLD_SCHEMA or prior['identity']!=OLD_IDENTITY:
        fail('exact_v3_operational_ACL_ancestry_required')
    result['readView']=prior
    # Permissions, retained feature inventory and role OIDs remain the exact
    # acknowledged operational graph. Only selected runtime values are v4.
    return result


class Runtime:
    def __init__(self,a,owner,previous):
        self.a,self.owner,self.previous=a,owner,previous
        self.cache=a.load(OPS/'consumer-generation-v4-proof-v1.py',CACHE_SHA)
        self.v4owner=a.load(OPS/'metadata-readview-v4-owner-v1.py',OWNER_SHA)
        self.stager=a.load(OPS/'metadata-readview-v4-candidates-stage-v1.py',STAGE_SHA)
        self.READ_SCHEMA=SCHEMA
        self.plan=a.document(OPS/'metadata-readview-v4-plan.review.json',self.stager.PLAN_SHA)
        self.staged=a.document(self.cache.CANDIDATE_RECEIPT,self.cache.CANDIDATE_SHA)
        self.proof=self.check_v4()

    def __getattr__(self,name):return getattr(self.previous,name)

    def check_v4(self):
        receipt=self.a.document(self.cache.OWNER_RECEIPT,self.cache.OWNER_SHA)
        staged=self.a.document(self.cache.CANDIDATE_RECEIPT,self.cache.CANDIDATE_SHA)
        if (receipt.get('committed')is not True or receipt.get('rehearsed')is not False
                or receipt.get('readSchema')!=SCHEMA or receipt.get('readIdentity')!=IDENTITY
                or staged.get('readSchema')!=SCHEMA or staged.get('readIdentity')!=IDENTITY):
            fail('actual_v4_owner_and_candidate_required')
        if self.owner.json_sql(self.v4owner.target_sql(self.plan))!=self.v4owner.expected_target(self.plan):
            fail('committed_v4_identity_or_read_ACLs_changed')
        definitions=self.owner.json_sql(definition_sql())
        if not DEFINITIONS_SHA or self.a.sha(self.a.encoded(definitions))!=DEFINITIONS_SHA:
            fail('official_v4_relation_or_function_definition_changed')
        return {'ownerReceiptSha256':self.cache.OWNER_SHA,'candidateReceiptSha256':self.cache.CANDIDATE_SHA,
                'readSchema':SCHEMA,'readIdentity':IDENTITY,'aclScope':'exact_additive_v4_reads',
                'definitionsSha256':DEFINITIONS_SHA}

    def matrix(self):
        value=copy.deepcopy(self.previous.matrix())
        for row in value['services']:
            proposed=row['proposed']
            for key in ('OWNERSHIP_READ_SCHEMA','READ_DATABASE_SCHEMA'):
                if proposed['selectors'].get(key)!=OLD_SCHEMA:fail('expected_previous_matrix_selector_required')
                proposed['selectors'][key]=SCHEMA
        return value

    def scope(self,original):
        value=copy.deepcopy(original)
        if value['readView']['schema']!=OLD_SCHEMA or value['readView']['identity']!=OLD_IDENTITY:
            fail('exact_previous_scope_required')
        value['operationalAclReadView']=copy.deepcopy(value['readView'])
        value['readView'].update(schema=SCHEMA,identity=IDENTITY,
            expectedDdlSha256=self.plan['expectedOwnerStatementsSha256'],
            ownerCliSha256=self.staged['artifactFiles']['dist/unified-ownership-views.mjs'],
            nativeMetadataViewsCreatedButNotGranted=False,
            ownerArtifactDigest=self.plan['artifactDigest'],
            ownerArtifactManifestSha256=self.plan['artifactManifestSha256'])
        for row in value['units']:
            for key in ('OWNERSHIP_READ_SCHEMA','READ_DATABASE_SCHEMA'):
                if row['publicSelectors'].get(key)!=OLD_SCHEMA:fail('expected_previous_public_selector_required')
                row['publicSelectors'][key]=SCHEMA
        value['v4ReadOwnerProof']=self.proof
        return value

    def check_current(self):
        prior=self.previous.check_current()
        if self.check_v4()!=self.proof:fail('v4_owner_proof_changed')
        return {**prior,'selectedReadViewV4':self.proof}


class Catalog:
    """Preserve old exact operational grants; separately verify additive v4."""
    def __init__(self,old,runtime):self.old,self.runtime=old,runtime
    def __getattr__(self,name):return getattr(self.old,name)
    def capture(self,owner,scope,frozen):
        self.runtime.check_v4()
        return self.old.capture(owner,old_scope(scope),frozen)
    def catalog_sql(self,scope,frozen):return self.old.catalog_sql(old_scope(scope),frozen)
    def validate_catalog(self,value,scope,frozen,**kwargs):return self.old.validate_catalog(value,old_scope(scope),frozen,**kwargs)
    def applied(self,owner,path,pin,scope,frozen):
        self.runtime.check_v4()
        return self.old.applied(owner,path,pin,old_scope(scope),frozen)
    def unchanged_common(self,owner,helper,frozen):
        prior=self.old.unchanged_common(owner,self.runtime.previous,frozen)
        return {**prior,'selectedReadViewV4':self.runtime.check_v4()}
