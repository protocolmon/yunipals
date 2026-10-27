#!/usr/bin/env python3
"""Exact existing-role READ closure; review/ROLLBACK precede one acknowledged COMMIT.

No roles, LOGIN, DML, selectors, services, provider or credential operations.
The retained runtime composition acknowledges only this owned ACL delta.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT = 'yunipals-ypal-combined-read-admission-v2'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-combined-read-admission-v2-20261024')
VIEW_OWNER = OPS / 'ypal-combined-readview-owner-v1.py'
VIEW_OWNER_SHA = '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058'
CREATED = Path('/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023/created.json')
CREATED_SHA = '17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3'
PLAN = Path('/var/backups/yunipals-ypal-combined-read-admission-input-v1-20261024/plan.json')
PLAN_SHA = 'fc79c53da5dc2ce3ccc9ce5c86f69ecfb75f0d25b2836d746f90f29e59ce6e0e'
SQL = OPS / 'ypal-combined-read-admission-v1.catalog.sql'
SQL_SHA = 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991'
GUARD = OPS / 'ypal-combined-rpc-admission-v3.py'
GUARD_SHA = '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862'
READ_SCHEMA = 'yunipals_ownership_4e77f52b_v4'
NATIVE = 'unified_ypal_20261023_v1'
ROLE_OIDS = {'yunipals_unified_api': '73187671', 'yunipals_unified_collector': '73187672',
             'yunipals_unified_read_cache': '73187673', 'yunipals_unified_islands_api': '73187674',
             'yunipals_islands_staking': '73765879', 'yunipals': '16388', 'yunipals_unified_support': '73036832'}
UNITS = ('yunipals-api.service', 'yunipals-collector-api.service', 'yunipals-islands-api.service', 'yunipals-metadata.service')


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def literal(value): return "'" + str(value).replace("'", "''") + "'"
def identifier(value):
    need(re.fullmatch('[a-z_][a-z_0-9]*', value or ''), 'fixed_sql_identifier_required')
    return '"' + value + '"'


def load():
    raw = VIEW_OWNER.read_bytes(); need(sha(raw) == VIEW_OWNER_SHA, 'frozen_readview_owner_required')
    view = types.ModuleType('owned_readview'); view.__file__ = str(VIEW_OWNER)
    exec(compile(raw, str(VIEW_OWNER), 'exec'), view.__dict__)
    r, s, h, op, ack, vp = view.load()
    need(sha(s.protected(VIEW_OWNER)) == VIEW_OWNER_SHA, 'protected_readview_owner_required')
    p = s.document(PLAN, PLAN_SHA); created = s.document(CREATED, CREATED_SHA)
    sql = s.protected(SQL); need(sha(sql) == SQL_SHA == p['catalogSqlSha256'], 'exact_catalog_sql_required')
    need(p['format'] == 'yunipals-ypal-combined-read-admission-plan-v1' and
         p['physicalSchema'] == NATIVE and p['physicalSchemaOid'] == '75963410' and
         p['readSchema'] == READ_SCHEMA and p['readSchemaOid'] == '75994954' and
         p['sourceRelease'] == vp['sourceRelease'] and p['readIdentity'] == vp['readIdentity'] and
         p['createdReceiptSha256'] == CREATED_SHA and p['missingCount'] == len(p['missingPermissions']) == 143 and
         p['newRoles'] == p['loginChanges'] == p['newDml'] == 0, 'finite_complete_read_closure_required')
    view.validate_target(vp, created['target'])
    need(created['created'] is True and created['sourceReceiptSha256'] == r.SOURCE_ACK_SHA and
         created['readSchema'] == READ_SCHEMA and created['readIdentity'] == p['readIdentity'] and
         created['target']['schemaOid'] == p['readSchemaOid'] and created['selected'] is False and
         created['grantsChanged'] is False, 'actual_dormant_created_readview_required')
    need({v['name']: v['oid'] for v in p['baselineCatalog']['roles']} == ROLE_OIDS,
         'exact_seven_existing_role_oids_required')
    return view, r, s, h, op, ack, p, sql.decode().strip()


def edge_key(value, direct=False):
    fields = ['kind', 'object', 'grantee', 'grantor', 'privilege', 'grantable']
    if direct: fields += ['object_name', 'column_number']
    return tuple(str(value.get(key)) for key in fields)


def expected_edges(p, direct=False):
    return {edge_key({'kind': v['kind'], 'object': v['object'], 'grantee': v['grantee'],
                      'grantor': v['grantor'], 'privilege': v['privilege'], 'grantable': False,
                      'object_name': v['name'], 'column_number': None}, direct)
            for v in p['missingPermissions']}


def validate_delta(p, before, after):
    need(before['databaseOid'] == after['databaseOid'] == '17584' and
         before['currentUser'] == before['sessionUser'] == after['currentUser'] == after['sessionUser'] == 'postgres' and
         before['socket'] is after['socket'] is True and before['port'] == after['port'] == '5432',
         'same_local_owner_database_required')
    b, a = copy.deepcopy(before), copy.deepcopy(after)
    for field, direct in [('directRoleEdges', True), ('targetEdges', False)]:
        prior = {edge_key(v, direct) for v in b.pop(field)}
        following = {edge_key(v, direct) for v in a.pop(field)}
        need(prior <= following and following - prior == expected_edges(p, direct),
             'only_exact_read_edges_with_original_grantors_required')
    # Only ACL serialization and the explicitly required effective bits may differ.
    # Complete direct role graph + complete target ACL edges above cover foreign/PUBLIC ACLs too.
    for field in ['schemas', 'relations', 'functions']:
        for value in [b, a]:
            for row in value[field] or []: row.pop('acl', None)
    effective = {v['role']: v for v in b['effective']}
    for v in p['missingPermissions']:
        role = effective[v['role']]
        if v['kind'] == 'schema': role['schemas'][v['name']]['usage'] = True
        elif v['kind'] == 'relation': role['relations'][v['name']]['select'] = True
        else: role['functions'][v['name']] = True
    need(a == b, 'all_other_roles_ownership_definitions_acl_and_effective_rights_unchanged')
    return True


def statements(p, inverse=False):
    rows = []
    for v in p['missingPermissions']:
        need(v['role'] in ROLE_OIDS and v['grantee'] == ROLE_OIDS[v['role']] and
             (v['kind'], v['privilege']) in {('schema', 'USAGE'), ('relation', 'SELECT'), ('function', 'EXECUTE')} and
             v['name'].split('.')[0] in {NATIVE, READ_SCHEMA, 'yunipals_indexer_control'},
             'fixed_existing_role_read_permissions_only')
        role = identifier(v['role']); kind = {'schema': 'SCHEMA', 'relation': 'TABLE', 'function': 'FUNCTION'}[v['kind']]
        if v['kind'] == 'schema': target = identifier(v['name'])
        elif v['kind'] == 'relation': target = '.'.join(identifier(x) for x in v['name'].split('.'))
        else:
            match = re.fullmatch(r'([a-z_0-9]+)\.([a-z_0-9]+)\((text|boolean|)\)', v['name'])
            need(match is not None, 'exact_protected_invoker_signature_required')
            target = identifier(match[1]) + '.' + identifier(match[2]) + '(' + match[3] + ')'
        rows.append(('REVOKE ' + v['privilege'] + ' ON ' + kind + ' ' + target + ' FROM ' + role if inverse else
                     'GRANT ' + v['privilege'] + ' ON ' + kind + ' ' + target + ' TO ' + role) + ';')
    need(len(rows) == len(set(rows)) == p['missingCount'], 'finite_unique_read_edges_required')
    return rows


def transaction(p, catalog_sql, before, after=None, commit=False, inverse=False):
    need(not commit or after is not None, 'exact_rehearsed_postgraph_before_commit_required')
    guard = lambda value: 'DO $catalog$ BEGIN IF (' + catalog_sql + ') IS DISTINCT FROM ' + literal(json.dumps(value)) + "::jsonb THEN RAISE EXCEPTION 'exact_read_catalog_changed'; END IF; END $catalog$;"
    sql = ("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL search_path=pg_catalog;SET LOCAL lock_timeout='3s';"
           "SET LOCAL statement_timeout='30s';SET LOCAL idle_in_transaction_session_timeout='40s';"
           "SELECT pg_advisory_xact_lock(hashtext('ypal-combined-read-admission-v1'));\n" + guard(before) + '\n' +
           '\n'.join(statements(p, inverse)) + '\n' + (guard(after) if after is not None else '') + '\n' + catalog_sql + ';\n' +
           ('COMMIT;\n' if commit else 'ROLLBACK;\n'))
    return sql


def reader_catalog(h):
    a = h.m.route_owner
    raw = h.m.pinned(a.READER_FILE, a.READER_SHA)
    module = types.ModuleType('unchanged_reader_catalog'); module.__file__ = str(a.READER_FILE)
    exec(compile(raw, str(a.READER_FILE), 'exec'), module.__dict__)
    value = a.source_query(h.m, module.catalog_sql()); module.validate_catalog(value, True)
    return value, module.catalog_sql()


def validate_reader_delta(p, before, after):
    b, a = copy.deepcopy(before), copy.deepcopy(after)
    prior = {tuple(sorted(v.items())) for v in b.pop('edges')}
    following = {tuple(sorted(v.items())) for v in a.pop('edges')}
    expected = {tuple(sorted({'kind': v['kind'], 'object': v['object'], 'grantor': v['grantor'],
                              'privilege': v['privilege'], 'grantable': False}.items()))
                for v in p['missingPermissions'] if v['role'] == 'yunipals_unified_collector'}
    need(b == a and prior <= following and following - prior == expected,
         'only_owned_collector_read_delta_from_original_reader_graph')


def retained_namespace(h, p, before, after):
    """A NEW namespace reuses pinned guard bodies; original module globals stay intact."""
    validate_reader_delta(p, before, after)
    raw = h.m.pinned(GUARD, GUARD_SHA); tree = ast.parse(raw)
    functions = {v.name: copy.deepcopy(v) for v in tree.body if isinstance(v, ast.FunctionDef)}
    fn = functions['accepted_ypal']
    predicates = [v for v in fn.body if isinstance(v, ast.Expr) and isinstance(v.value, ast.Call) and
                  isinstance(v.value.func, ast.Name) and v.value.func.id == 'need' and len(v.value.args) == 2 and
                  isinstance(v.value.args[1], ast.Constant) and v.value.args[1].value == 'accepted_reader_catalog_required']
    need(len(predicates) == 1, 'exact_single_frozen_reader_catalog_predicate_required')
    fn.body[fn.body.index(predicates[0])] = ast.copy_location(ast.parse('acknowledged_catalog(m, reader, catalog_value)').body[0], predicates[0])
    changed = 0
    for node in ast.walk(fn):
        if isinstance(node, ast.Dict):
            for index, key in enumerate(node.keys):
                if isinstance(key, ast.Constant) and key.value == 'readerCatalogSha256':
                    need(ast.unparse(node.values[index]) == "reader['roleGraphSha256']", 'fixed_original_reader_hash_field_required')
                    node.values[index] = ast.parse('sha(encoded(catalog_value))', mode='eval').body; changed += 1
    need(changed == 1, 'single_actual_reader_hash_field_required')
    def check(_m, historical, current):
        need(historical['roleGraphSha256'] == sha(encoded(before)) and current == after,
             'exact_owned_new_graph_and_retained_original_ack_required')
    namespace = dict(h.m.route_owner.__dict__)
    namespace['acknowledged_catalog'] = check
    program = ast.fix_missing_locations(ast.Module(body=[fn, functions['retained']], type_ignores=[]))
    exec(compile(program, str(Path(__file__).absolute()), 'exec'), namespace)
    return namespace


def compare_retained(current, historical, original_graph, actual_graph):
    need(set(current) == set(historical), 'complete_retained_runtime_facts_required')
    for key in current:
        if key != 'acceptedYpal': need(current[key] == historical[key], 'retained_actor_private_environment_or_definition_drift')
        else:
            now, old = current[key], historical[key]
            need(set(now) == set(old) and all(now[k] == old[k] for k in now if k != 'readerCatalogSha256') and
                 old['readerCatalogSha256'] == original_graph and now['readerCatalogSha256'] == actual_graph,
                 'only_acknowledged_reader_graph_fact_may_differ')


def acknowledged_source_binding(r, s, h, op, ack, p, before, rehearsal):
    namespace = retained_namespace(h, p, before['readerBefore'], rehearsal['readerAfter'])
    current = namespace['retained'](h.m)
    original_graph, actual_graph = sha(encoded(before['readerBefore'])), sha(encoded(rehearsal['readerAfter']))
    compare_retained(current, op['retained'], original_graph, actual_graph)
    # Reuse every fixed four-route check, while comparing the explicit current
    # retained facts instead of calling the intentionally obsolete whole baseline.
    a = h.m.route_owner; route_before = h.m.load('before.json'); b = route_before['binding']
    need(b['operatorSha256'] == sha(h.m.protected(a.__file__)) and b['bootId'] == h.m.boot() and
         b['inputs'] == h.rpc.inputs(h.m, a), 'exact_current_route_inputs_required')
    compare_retained(current, b['retained'], original_graph, actual_graph)
    need({c: a.plan(h.m, c)[0] for c in a.CHAINS} == b['plans'], 'retained_route_inputs_changed')
    capacity = h.rpc.capacity_snapshot(h.m)
    need({k: capacity[k] for k in b['budgetCapacityIdentity']} == b['budgetCapacityIdentity'], 'unchanged_budget_connection_limits_required')
    need(route_before['reviewHash'] == sha(encoded({'binding': b, 'catalog': route_before['catalog']})), 'authenticated_route_review_required')
    routes = json.loads(h.m.pinned(a.BASE / 'result.json', ack['rpcResultSha256']))
    need(routes['completed'] is True and routes['format'] == a.FORMAT and routes['operatorSha256'] == b['operatorSha256'] and
         routes['bootId'] == h.m.boot() and not (a.BASE / 'restore-intent.json').exists(), 'same_acknowledged_unrestored_routes_required')
    a.exact_catalog(h.m, a.catalog(h.m), route_before['catalog'], True)
    need({c: a.owned(h.m, c, route_before) for c in a.CHAINS} == routes['routes'], 'same_acknowledged_proxy_actors_required')
    for c in a.CHAINS: h.m.check_published(c + '-boot')
    def preserved(_h, _op):
        s.static_inputs(_h); s.old_private_inputs(_op)
        need(s.base_code() == _op['sourceCode'] and _h.role() == _op['sourceRole'], 'same_source_code_private_inputs_and_role_required')
        latest = namespace['retained'](_h.m)
        compare_retained(latest, _op['retained'], original_graph, actual_graph)
    # Compile the frozen registration binding's body in another NEW namespace.
    # Only its obsolete composite-preservation call is replaced by the explicit
    # finite preservation above; boot/source actor/native/table/runner pins remain.
    source = s.protected(OPS / 'ypal-combined-release-register-v1.py')
    need(sha(source) == 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'frozen_registration_binding_required')
    fn = copy.deepcopy(next(v for v in ast.parse(source).body if isinstance(v, ast.FunctionDef) and v.name == 'binding'))
    calls = [v for v in fn.body if isinstance(v, ast.Expr) and isinstance(v.value, ast.Call) and ast.unparse(v.value.func) == 's.check_preserved']
    need(len(calls) == 1, 'single_frozen_composite_preservation_call_required')
    fn.body[fn.body.index(calls[0])] = ast.copy_location(ast.parse('acknowledged_preserved(h, op)').body[0], calls[0])
    scope = dict(r.__dict__); scope['acknowledged_preserved'] = preserved
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), str(Path(__file__).absolute()), 'exec'), scope)
    binding = scope['binding'](s, h, op, ack)
    return binding, {'originalReaderCatalogSha256': original_graph, 'actualReaderCatalogSha256': actual_graph,
                     'actualRetainedFactsSha256': sha(encoded(current)), 'originalWholeValidatorPassed': False}


def consumer_frame(h):
    result = {}
    for unit in UNITS:
        keys = ['Id', 'FragmentPath', 'DropInPaths', 'MainPID', 'InvocationID', 'ActiveState']
        raw = h.m.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in keys]], timeout=8)
        state = dict(v.split('=', 1) for v in raw.decode().splitlines())
        need(set(state) == set(keys) and state['Id'] == unit, 'complete_retained_consumer_identity_required')
        files, environments = {}, []
        for name in [state['FragmentPath'], *state['DropInPaths'].split()]:
            if not name: continue
            raw = h.m.protected(name); files[name] = sha(raw)
            for line in raw.decode().splitlines():
                if not line.startswith('EnvironmentFile='): continue
                path = line.split('=', 1)[1].strip()
                # systemd resets the inherited EnvironmentFile list here.
                # Preserve the definition hash, then observe the final effective files.
                if not path:
                    environments = []
                    continue
                optional = path.startswith('-'); path = path.lstrip('-')
                need(path.startswith('/') and not any(x.isspace() for x in path) and not any(x in path for x in ['%', '*', '?', '[', '"', "'"]), 'literal_retained_environment_file_required')
                environments.append((path, optional))
        for path, optional in environments:
            if optional and not os.path.lexists(path): files[path] = None
            else: files[path] = sha(h.m.protected(path))
        result[unit] = {'state': state, 'files': files}
    return result


def source_binding(r, s, h, op, ack): return r.binding(s, h, op, ack)


def review(view, r, s, h, op, ack, p, sql):
    binding = source_binding(r, s, h, op, ack)
    current = view.query(h, sql)[0]
    need(current == p['baselineCatalog'], 'actual_pinned_seven_role_catalog_required')
    original, _ = reader_catalog(h); consumers = consumer_frame(h)
    need(source_binding(r, s, h, op, ack) == binding and consumer_frame(h) == consumers,
         'source_or_consumers_changed_during_read_review')
    value = {'format': FORMAT, 'operatorSha256': sha(s.protected(Path(__file__).absolute())),
             'planSha256': PLAN_SHA, 'createdReceiptSha256': CREATED_SHA, 'bootId': s.boot(),
             'sourceBinding': binding, 'catalogBefore': current, 'readerBefore': original, 'consumers': consumers,
             'readEdgeCount': p['missingCount'], 'loginChanges': 0, 'newDml': 0, 'serviceActions': 0}
    return {**value, 'reviewHash': sha(encoded(value))}


def saved(s, expected):
    value = s.document(BASE / 'before.json')
    need(value['reviewHash'] == expected == sha(encoded({k: v for k, v in value.items() if k != 'reviewHash'})) and
         value['operatorSha256'] == sha(s.protected(Path(__file__).absolute())) and value['planSha256'] == PLAN_SHA and
         value['createdReceiptSha256'] == CREATED_SHA and value['bootId'] == s.boot(), 'exact_owned_same_boot_read_review_required')
    return value


def rehearse(view, r, s, h, op, ack, p, sql, expected):
    need(not os.path.lexists(BASE), 'fresh_read_admission_operation_required')
    value = review(view, r, s, h, op, ack, p, sql); need(value['reviewHash'] == expected, 'fresh_exact_read_review_required')
    BASE.mkdir(mode=0o700); s.sync(BASE.parent); s.save(BASE / 'before.json', value)
    s.save(BASE / 'rehearsal-intent.json', {'reviewHash': expected, 'bootId': s.boot()})
    # Capture both actual graphs in the SAME grant transaction before its ROLLBACK.
    _, reader_sql = reader_catalog(h)
    text = transaction(p, sql, value['catalogBefore']).replace('\nROLLBACK;\n', '\n' + reader_sql + ';\nROLLBACK;\n')
    rows = view.query(h, text, False); need(len(rows) == 2, 'two_actual_rehearsed_catalogs_required')
    validate_delta(p, value['catalogBefore'], rows[0]); validate_reader_delta(p, value['readerBefore'], rows[1])
    need(view.query(h, sql)[0] == value['catalogBefore'] and source_binding(r, s, h, op, ack) == value['sourceBinding'],
         'rollback_exactly_preserves_all_catalog_and_runtime')
    result = {'format': FORMAT, 'rehearsed': True, 'reviewHash': expected, 'after': rows[0], 'readerAfter': rows[1],
              'databaseCommitted': False, 'serviceActions': 0, 'readEdgeCount': p['missingCount']}
    s.save(BASE / 'rehearsed.json', result); return result


def records(s, expected):
    before = saved(s, expected); rehearsal = s.document(BASE / 'rehearsed.json')
    need(rehearsal['format'] == FORMAT and rehearsal['rehearsed'] is True and rehearsal['reviewHash'] == expected,
         'actual_exact_rollback_read_rehearsal_required')
    return before, rehearsal


def post_runtime(r, s, h, op, ack, p, before, rehearsal, require_consumers=True):
    binding, proof = acknowledged_source_binding(r, s, h, op, ack, p, before, rehearsal)
    need(binding == before['sourceBinding'] and (not require_consumers or consumer_frame(h) == before['consumers']),
         'all_retained_runtime_and_private_inputs_unchanged_after_read_delta')
    return proof


def acknowledge(view, r, s, h, op, ack, p, sql, before, rehearsal, reconciled=False):
    current = view.query(h, sql)[0]; need(current == rehearsal['after'], 'exact_rehearsed_read_postgraph_required')
    validate_delta(p, before['catalogBefore'], current)
    preservation = post_runtime(r, s, h, op, ack, p, before, rehearsal)
    need(view.query(h, sql)[0] == current and consumer_frame(h) == before['consumers'], 'read_graph_or_private_consumers_changed_during_ACK')
    value = {'format': FORMAT, 'admitted': True, 'operatorSha256': before['operatorSha256'], 'reviewHash': before['reviewHash'],
             'planSha256': PLAN_SHA, 'createdReceiptSha256': CREATED_SHA, 'bootId': s.boot(),
             'commitIntentSha256': sha(s.protected(BASE / 'commit-intent.json')),
             'beforeSha256': sha(s.protected(BASE / 'before.json')), 'rehearsalSha256': sha(s.protected(BASE / 'rehearsed.json')),
             'catalogAfterSha256': sha(encoded(current)), 'originalReaderCatalogSha256': sha(encoded(before['readerBefore'])),
             'actualReaderCatalogSha256': sha(encoded(rehearsal['readerAfter'])), 'readEdgeCount': p['missingCount'],
             'originalWholeValidatorPassed': False, 'preservation': preservation, 'reconciledAfterUnknownAck': reconciled,
             'loginChanges': 0, 'newDml': 0, 'selectorChanges': 0, 'serviceActions': 0, 'sourceReadinessClaimed': False}
    s.save(BASE / 'result.json', value); return value


def commit(view, r, s, h, op, ack, p, sql, expected):
    before, rehearsal = records(s, expected)
    need(not any(os.path.lexists(BASE / name) for name in ['commit-intent.json', 'result.json', 'failed.json']),
         'one_read_commit_attempt_only')
    need(source_binding(r, s, h, op, ack) == before['sourceBinding'] and consumer_frame(h) == before['consumers'],
         'same_retained_runtime_before_read_commit')
    s.save(BASE / 'commit-intent.json', {'format': FORMAT, 'reviewHash': expected, 'bootId': s.boot(),
                                     'planSha256': PLAN_SHA, 'rehearsalSha256': sha(s.protected(BASE / 'rehearsed.json')),
                                     'automaticRetryAllowed': False})
    try:
        rows = view.query(h, transaction(p, sql, before['catalogBefore'], rehearsal['after'], True), False)
        need(rows == [rehearsal['after']], 'actual_single_read_commit_ACK_required')
        return acknowledge(view, r, s, h, op, ack, p, sql, before, rehearsal)
    except BaseException:
        s.save(BASE / 'failed.json', {'format': FORMAT, 'reviewHash': expected, 'outcomeMayBeUnknown': True, 'automaticRetryAllowed': False})
        raise


def reconcile(view, r, s, h, op, ack, p, sql, pin):
    intent = s.document(BASE / 'commit-intent.json', pin)
    need(intent['format'] == FORMAT and intent['bootId'] == s.boot() and intent['planSha256'] == PLAN_SHA and
         not (BASE / 'result.json').exists(), 'owned_same_boot_read_commit_intent_required')
    before, rehearsal = records(s, intent['reviewHash'])
    need(sha(s.protected(BASE / 'rehearsed.json')) == intent['rehearsalSha256'], 'same_committed_rehearsal_required')
    return acknowledge(view, r, s, h, op, ack, p, sql, before, rehearsal, True)


def admitted(s, pin, inverse_reconcile=False):
    value = s.document(BASE / 'result.json', pin)
    need(value['format'] == FORMAT and value['admitted'] is True and value['bootId'] == s.boot() and
         (inverse_reconcile or not (BASE / 'inverse-intent.json').exists()) and value['commitIntentSha256'] == sha(s.protected(BASE / 'commit-intent.json')),
         'owned_unreversed_read_admission_required')
    before, rehearsal = records(s, value['reviewHash'])
    intent = s.document(BASE / 'commit-intent.json', value['commitIntentSha256'])
    need(value['operatorSha256'] == before['operatorSha256'] and value['planSha256'] == PLAN_SHA and
         value['createdReceiptSha256'] == CREATED_SHA and value['readEdgeCount'] == 143 and
         value['originalReaderCatalogSha256'] == sha(encoded(before['readerBefore'])) and
         value['loginChanges'] == value['newDml'] == value['selectorChanges'] == value['serviceActions'] == 0 and
         value['originalWholeValidatorPassed'] is False and value['sourceReadinessClaimed'] is False and
         intent['format'] == FORMAT and intent['bootId'] == s.boot() and intent['reviewHash'] == value['reviewHash'] and
         intent['planSha256'] == PLAN_SHA and intent['rehearsalSha256'] == value['rehearsalSha256'],
         'exact_new_read_admission_producer_and_commit_chain_required')
    need(value['beforeSha256'] == sha(s.protected(BASE / 'before.json')) and
         value['rehearsalSha256'] == sha(s.protected(BASE / 'rehearsed.json')) and
         value['catalogAfterSha256'] == sha(encoded(rehearsal['after'])) and
         value['actualReaderCatalogSha256'] == sha(encoded(rehearsal['readerAfter'])), 'exact_read_acknowledgement_chain_required')
    return value, before, rehearsal


def acl_catalog(value):
    # Selection/adoption is owned by downstream controllers, not by READ grants.
    # They remain exact CAS/inverse boundaries for THIS admission transaction.
    return {k: v for k, v in value.items() if k not in {'activeRelease', 'nativeMetadataAdoptions'}}


def validate_current(pin):
    view, r, s, h, op, ack, p, sql = load(); value, before, rehearsal = admitted(s, pin)
    need(acl_catalog(view.query(h, sql)[0]) == acl_catalog(rehearsal['after']), 'same_current_admitted_read_graph_required')
    preservation = post_runtime(r, s, h, op, ack, p, before, rehearsal, False)
    need(acl_catalog(view.query(h, sql)[0]) == acl_catalog(rehearsal['after']), 'current_graph_changed_during_validation')
    return {'format': FORMAT, 'validated': True, 'receiptSha256': pin, 'operatorSha256': value['operatorSha256'],
            'sourceBinding': before['sourceBinding'], 'actualReaderCatalogSha256': value['actualReaderCatalogSha256'],
            'originalReaderCatalogSha256': value['originalReaderCatalogSha256'], 'preservation': preservation,
            'originalWholeValidatorPassed': False, 'consumerSelectionsQualified': False,
            'sourceReadinessClaimed': False, 'serviceActions': 0, 'databaseWrites': 0}


def inverse_review(view, r, s, h, op, ack, p, sql, pin):
    value, before, rehearsal = admitted(s, pin)
    need(view.query(h, sql)[0] == rehearsal['after'], 'exact_owned_admitted_graph_before_inverse')
    post_runtime(r, s, h, op, ack, p, before, rehearsal)
    fixed = {'format': FORMAT, 'admissionSha256': pin, 'operatorSha256': value['operatorSha256'], 'bootId': s.boot(),
             'reviewHash': value['reviewHash'], 'catalogAfterSha256': value['catalogAfterSha256'], 'consumers': before['consumers']}
    return {**fixed, 'inverseReviewHash': sha(encoded(fixed))}


def inverse(view, r, s, h, op, ack, p, sql, pin, expected):
    checked = inverse_review(view, r, s, h, op, ack, p, sql, pin)
    need(checked['inverseReviewHash'] == expected and not os.path.lexists(BASE / 'inverse-intent.json'), 'fresh_exact_owned_inverse_review_required')
    value, before, rehearsal = admitted(s, pin)
    s.save(BASE / 'inverse-intent.json', checked)
    rows = view.query(h, transaction(p, sql, rehearsal['after'], before['catalogBefore'], True, True), False)
    need(rows == [before['catalogBefore']], 'owned_inverse_commit_ACK_required')
    # New context: the original graph is restored; the historical guard passes directly again.
    fresh = load(); v, rr, ss, hh, oo, aa, pp, query = fresh
    need(v.query(hh, query)[0] == before['catalogBefore'] and source_binding(rr, ss, hh, oo, aa) == before['sourceBinding'] and
         consumer_frame(hh) == before['consumers'], 'exact_original_read_graph_and_runtime_restored')
    result = {'format': FORMAT, 'inversed': True, 'admissionSha256': pin, 'inverseReviewHash': expected,
              'catalogRestored': True, 'onlyOwnedReadEdgesRemoved': True, 'loginChanges': 0, 'serviceActions': 0}
    s.save(BASE / 'inverse-result.json', result); return result


def reconcile_inverse(view, r, s, h, op, ack, p, sql, pin):
    intent = s.document(BASE / 'inverse-intent.json', pin)
    need(intent['bootId'] == s.boot() and not (BASE / 'inverse-result.json').exists(), 'owned_inverse_intent_required')
    value, before, rehearsal = admitted(s, intent['admissionSha256'], True)
    need(intent['format'] == FORMAT and intent['operatorSha256'] == value['operatorSha256'] and
         intent['reviewHash'] == value['reviewHash'] and intent['catalogAfterSha256'] == value['catalogAfterSha256'] and
         intent['inverseReviewHash'] == sha(encoded({k: v for k, v in intent.items() if k != 'inverseReviewHash'})),
         'exact_owned_inverse_intent_binding_required')
    need(view.query(h, sql)[0] == before['catalogBefore'] and source_binding(r, s, h, op, ack) == before['sourceBinding'] and
         consumer_frame(h) == before['consumers'], 'exact_original_graph_for_inverse_reconcile')
    result = {'format': FORMAT, 'inversed': True, 'admissionSha256': intent['admissionSha256'],
              'inverseReviewHash': intent['inverseReviewHash'], 'catalogRestored': True,
              'onlyOwnedReadEdgesRemoved': True, 'reconciledAfterUnknownAck': True, 'loginChanges': 0, 'serviceActions': 0}
    s.save(BASE / 'inverse-result.json', result); return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    for name in ['rehearse', 'commit', 'reconcile', 'validate', 'inverse-review', 'reconcile-inverse']: group.add_argument('--' + name)
    group.add_argument('--inverse', nargs=2, metavar=('ADMISSION_SHA', 'REVIEW_HASH'))
    args = parser.parse_args(); need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_host_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_read_admission_expired')); signal.alarm(300)
    context = load(); view, r, s, h, op, ack, p, sql = context
    with s.transition_lock():
        if args.validate: result = validate_current(args.validate)
        elif args.inverse: result = inverse(*context, *args.inverse)
        elif args.inverse_review: result = inverse_review(*context, args.inverse_review)
        elif args.reconcile_inverse: result = reconcile_inverse(*context, args.reconcile_inverse)
        elif args.reconcile: result = reconcile(*context, args.reconcile)
        elif args.commit: result = commit(*context, args.commit)
        elif args.rehearse: result = rehearse(*context, args.rehearse)
        else: result = review(*context)
        print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
