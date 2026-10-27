#!/usr/bin/env python3
"""Only the 24 read edges from the actual committed marketplace admission.

Construct an expected historical catalog; never normalize current observations,
rewrite receipts, issue grants, or waive unrelated catalog equality.
"""
import copy
from pathlib import Path

RESULT = Path('/var/backups/yunipals-marketplace-grants-admission-v1-20261022/source.result.json')
RESULT_SHA = '178bd1de146a4493f7b4e5140304598f280d80bece2ae2d7c38154f27091683c'
ROLE = 'market_prod_source_read'
OID = '20161305'


def fail(code): raise RuntimeError(code)


def anchor(a, owner):
    value = a.document(RESULT, RESULT_SHA)
    if (value.get('format') != 'yunipals-marketplace-grants-admission-v1' or
            value.get('cluster') != 'source' or value.get('committed') is not True or
            value.get('addedPrivileges') != 24 or any(value.get(k) != 0 for k in
            ['loginChanges','accountsCreated','serviceJobs','providerCalls','sourceSelections','budgetChanges'])):
        fail('actual_committed_24_read_marketplace_admission_required')
    before, after = value['before'], value['after']
    if before['roles'] != after['roles'] or before['effectiveAuthority'] != after['effectiveAuthority']:
        fail('marketplace_admission_must_preserve_role_and_write_authority')
    roles = after['roles']
    if len(roles) != 1 or roles[0]['name'] != ROLE or str(roles[0]['oid']) != OID:
        fail('exact_existing_marketplace_reader_OID_required')
    actual = owner.json_sql("SELECT jsonb_build_object('name',r.rolname,'oid',r.oid::text,'login',r.rolcanlogin,'inherit',r.rolinherit,'super',r.rolsuper,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,'passwordPresent',a.rolpassword IS NOT NULL,'memberships',(SELECT count(*)FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid))FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid WHERE r.rolname='market_prod_source_read'")
    if actual != roles[0]: fail('accepted_marketplace_role_attributes_changed')
    objects = {(o['kind'],o['name']):o for o in after['objects']}
    rights = []
    for permission in after['permissions']:
        kind = permission['kind']
        if (permission.get('role') != ROLE or permission.get('allowed') is not True or
                permission.get('column') is not None or kind not in {'table','function','schema'} or
                permission['privilege'] != {'table':'SELECT','function':'EXECUTE','schema':'USAGE'}[kind]):
            fail('only_exact_read_edges_without_column_or_grant_options_required')
        obj = objects[kind,permission['object']]
        rights.append({'kind':'relation'if kind=='table'else kind,'name':obj['name'],
                       'oid':obj['oid'],'owner':obj['owner'],'privilege':permission['privilege']})
    if (len(rights) != 24 or len({(r['kind'],r['name'],r['privilege'])for r in rights}) != 24 or
            {k:sum(r['privilege']==k for r in rights)for k in ['SELECT','USAGE','EXECUTE']} !=
            {'SELECT':19,'USAGE':3,'EXECUTE':2}):
        fail('exact_19_SELECT_3_USAGE_2_EXECUTE_bindings_required')
    return rights


def expected(catalog, rights):
    if len(rights) != 24: fail('exact_24_owned_marketplace_edges_required')
    by_object = {(r['kind'],r['name']):r for r in rights}
    if len(by_object) != 24: fail('distinct_owned_marketplace_objects_required')
    result = copy.deepcopy(catalog)
    matched = 0
    for obj in result['objects']:
        binding = by_object.get((obj['kind'],obj['name']))
        allowed = []
        if binding is not None:
            if (obj['oid'],obj['owner']) != (binding['oid'],binding['owner']):
                fail('committed_marketplace_object_OID_or_owner_changed')
            allowed = [{'grantor':binding['owner'],'grantee':OID,
                        'privilege':binding['privilege'],'grantable':False}]
            matched += 1
        acl = obj['acl'] or []
        # This is the authenticated historical baseline. Preserve every prior
        # ACL, including this role's older metadata reads; only append the fixed
        # admission edges. The caller compares the untouched CURRENT capture
        # against this complete expected graph, so unrelated new ACLs still fail.
        for row in allowed:
            if row not in acl: acl.append(row)
        obj['acl'] = sorted(acl,key=lambda r:(int(r['grantor']),int(r['grantee']),r['privilege'],r['grantable'])) or None
    # Feature catalog contains 22; the expanded action catalog contains all 24.
    if matched not in {22,24}: fail('exact_feature_or_expanded_action_scope_required')
    return result


def upgrade(a, owner, catalog): return expected(catalog,anchor(a,owner))


class Catalog:
    """The existing v4 catalog plus this one acknowledged historical addition."""
    def __init__(self, old, owner):
        self.old, self.owner = old, owner
        anchor(old,owner)

    def __getattr__(self,name): return getattr(self.old,name)

    def proof(self):
        return {'file':str(RESULT),'sha256':RESULT_SHA,
                'historyHelperSha256':self.old.sha(self.old.protected(Path(__file__).absolute())),
                'bindings':24,'currentObservationsNormalized':False}

    def accepted_history(self,owner,catalog):
        return upgrade(self.old,owner,self.old.accepted_history(owner,catalog))

    def applied(self,owner,path,pin,scope,frozen):
        # Same protected acknowledgement checks as the frozen owner. Only the
        # expected historical graph is augmented; current observations stay exact.
        a=self.old;result=a.document(path,pin)
        saved=a.document(Path(path).parent/'review.json',result['reviewFileSha256'])
        current_owner_sha=a.sha(a.protected(Path(a.old.__file__).absolute()))
        accepted={(a.OLDER_FORMAT,a.OLDER_OWNER_SHA),(a.PREVIOUS_FORMAT,a.PREVIOUS_OWNER_SHA),
                  a.HISTORICAL_V4,a.HISTORICAL_V5,(a.FORMAT,current_owner_sha)}
        if ((result.get('format'),result.get('operatorSha256'))not in accepted or
                result.get('applied')is not True or result.get('transactionOutcome')!='commit_confirmed' or
                saved['reviewHash']!=a.sha(a.encoded(saved['binding'])) or
                result['reviewHash']!=saved['reviewHash'] or
                result['afterSha256']!=a.sha(a.encoded(saved['binding']['after']))):
            fail('actual_confirmed_operational_ACL_receipt_required')
        # Calling capture on the existing v4 adapter also retains its live v4
        # owner/definition check. Do not delegate to old.applied's stale comparison.
        value=a.capture(owner,scope,frozen)
        if value!=self.accepted_history(owner,saved['binding']['after']):
            fail('current_operational_catalog_differs_from_owned_history')
        return result,saved,value

    def save(self,path,value):
        # Keep frozen core producer identities and add the explicit, separately
        # pinned history acknowledgement to newly produced results.
        if isinstance(value,dict)and value.get('format')in{
                'yunipals-consumer-operational-preview-v6','yunipals-consumer-operational-install-v7'}and Path(path).name=='result.json':
            value={**value,'acknowledgedMarketplaceReadHistory':self.proof()}
        return self.old.save(path,value)


def action_admission(preview,a,owner,helper,frozen,scope,plan,strict_catalog=True):
    if plan.get('actionAclFile')!=preview.ACTION_ACL_FILE or plan.get('actionAclSha256')!=preview.ACTION_ACL_SHA:
        fail('actual_committed_two_read_receipt_required')
    module=a.load(preview.OPS/'consumer-action-read-owner-v2.py',
                  '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f')
    receipt,saved=module.acknowledged(a,plan['actionAclFile'],plan['actionAclSha256'])
    if receipt.get('rollback')or receipt.get('selectBindings')!=2 or receipt.get('loginChanged')is not False or receipt.get('dmlGranted')is not False:
        fail('actual_only_two_read_admission_required')
    full=module.expanded(scope);current=a.capture(owner,full,frozen)
    a.validate_catalog(current,full,frozen,allow_login=not strict_catalog)
    accepted=a.accepted_history(owner,saved['binding']['after'])
    wanted=[r for r in accepted['objects']if r['kind']=='relation'and r['name']in module.RELATIONS]
    actual=[r for r in current['objects']if r['kind']=='relation'and r['name']in module.RELATIONS]
    if len(wanted)!=2 or actual!=wanted or strict_catalog and current!=accepted:
        fail('committed_action_read_graph_changed')
    return {'file':plan['actionAclFile'],'sha256':plan['actionAclSha256'],
            'operatorSha256':'7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f','selectBindings':2}
