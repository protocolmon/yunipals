"""Successor read-view ACL adapter; historical owner remains unchanged."""
import copy

ROLE="yunipals_unified_collector"

def fail(code):raise RuntimeError(code)


class Owner:
    def __init__(self, previous, guard):
        self.previous, self.guard = previous, guard

    def __getattr__(self, name):
        return getattr(self.previous, name)

    def source_acl_sql(self, helper):
        self.guard.ensure()
        query = self.previous.source_acl_sql(helper)
        start = query.index("'otherPublicReads',")
        end = query.index("'aclFingerprint',", start)
        part = query[start:end]
        needle = " AND c.relkind IN('r','p','v','m')"
        if part.count(needle) != 1:
            fail('fixed_historical_source_read_check_required')
        part = part.replace(needle, ' AND n.oid<>' + str(self.guard.graph['schemaOid']) + needle)
        return query[:start] + part + query[end:]

    def validate_postcheck(self, value, plan, binding):
        proof = self.guard.ensure()
        comparison = copy.deepcopy(value)
        rows = [r for r in comparison['roles'] if r['role'] == ROLE]
        if len(rows) != 1 or str(rows[0]['oid']) != '73187672' or rows[0]['noLogin'] is not False:
            fail('actual_owned_collector_LOGIN_postcheck_required')
        rows[0]['noLogin'] = True
        result = self.previous.validate_postcheck(comparison, plan, binding)
        return {**result, 'roles': value['roles'], 'ownedBoosterReader': proof,
                'historicalNoLoginComparisonOnly': True}

    def validate_post_source(self, catalog, binding):
        self.guard.ensure()
        comparison = self.guard.policy.historical_comparison_copy(catalog, self.guard.proof)
        expected = copy.deepcopy(binding)
        for row in expected['catalog']['roles']:
            if row['name'] == ROLE:
                row['login'] = False
        return self.previous.validate_post_source(comparison, expected)

