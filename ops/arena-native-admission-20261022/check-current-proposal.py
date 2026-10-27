#!/usr/bin/env python3
"""Static exact admission review only. No DB/network/service/Git/apply action."""
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def need(value, code):
    if not value:
        raise ValueError(code)


def grant_edges(text):
    result = set()
    priv = r'(?:SELECT|INSERT|UPDATE|DELETE)(?:\s*\([a-z0-9_,\s]+\))?'
    statements = re.findall(r'^GRANT\s+(' + priv + r'(?:\s*,\s*' + priv + r')*)\s+ON TABLE\s+(yunipals_arena\.[a-z_]+)\s+TO\s+"([a-z_]+)"\s*;', text, re.M)
    for modes, relation, role in statements:
        parsed = re.findall(r'(SELECT|INSERT|UPDATE|DELETE)(?:\s*\(([^)]+)\))?', modes)
        need(parsed and re.sub(r'(SELECT|INSERT|UPDATE|DELETE)(?:\s*\([^)]+\))?|[,\s]', '', modes) == '', 'unsupported_grant_syntax')
        for privilege, columns in parsed:
            for column in [x.strip() for x in columns.split(',')] if columns else [None]:
                edge = (role, relation, privilege, column)
                need(edge not in result, 'duplicate_grant_edge')
                result.add(edge)
    return result


def validate(proposal, operational, source):
    need(proposal['format'] == 'yunipals-arena-native-current-admission-proposal-v1' and proposal['status'] == 'review_only_not_applied', 'review_only_proposal_required')
    need(proposal['candidate']['sourceDigest'] == '264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24' and proposal['candidate']['files'] == 1796, 'actual_modern_source_required')
    need(all(x == 0 for x in proposal['actionsPerformed'].values()), 'no_action_claim_required')
    workers = proposal['workers']
    names = {w['role'] for w in workers}
    need(len(workers) == len(names) == 8 and all(w['exists'] is False and w['observedRoleOid'] is None for w in workers), 'eight_actual_absent_roles_required')
    need(len(proposal['current']['committedMarkers']) == 12 and all(x['present'] and x['checksumMatches'] for x in proposal['current']['committedMarkers']), 'actual_committed_twelve_markers_required')
    need(len(proposal['current']['actors']) == 8 and proposal['current']['sourceSelectionCount'] == 0 and proposal['current']['nativeMode'] is False, 'retained_legacy_actors_required')
    expected = {(w['role'], e['relation'], e['privilege'], e['attribute']) for w in workers for e in w['requiredEdges']}
    need(len(expected) == 227 and grant_edges(operational) == expected, 'exact_207_historical_plus20_current_edges_required')
    creates = re.findall(r'^CREATE ROLE "([a-z_]+)" (.+);$', operational, re.M)
    need(len(creates) == 8 and {x[0] for x in creates} == names, 'exact_eight_role_creations_required')
    for name, flags in creates:
        worker = next(w for w in workers if w['role'] == name)
        need(flags == 'NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ' + str(worker['connectionLimit']), 'fixed_nonlogin_nonowner_attributes_required')
    # Every DML write remains historical or one of the measured twenty additions.
    for role, relation, privilege, column in expected:
        need(privilege not in {'TRUNCATE', 'TRIGGER', 'REFERENCES'}, 'no_unreviewed_table_privilege')
        need(not (relation.endswith(('.source_selection', '.source_switch_history', '.operational_migration')) and privilege != 'SELECT'), 'no_owner_selector_or_marker_writes')
        need(privilege != 'DELETE' or relation in {'yunipals_arena.session', 'yunipals_arena.capacity'}, 'no_durable_history_delete')
    need(not re.search(r'^GRANT\s+(?:EXECUTE|ALL)\b|^ALTER (?:ROLE|DEFAULT)|^REVOKE\b|^UPDATE\b|^DELETE\b|^INSERT\b', operational, re.M), 'no_login_function_default_or_data_mutation')
    need("current_exact_27_relation_graph_changed" in operational and "official_arena_migration_set_changed" in operational, 'current_oid_and_marker_guards_required')
    need('CREATE ROLE arena_native_reader NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32;' in source, 'fresh_nonlogin_source_reader_required')
    tables = proposal['sourceReader']['tables']
    need(len(tables) == 13 and len({r['oid'] for r in tables}) == 13, 'thirteen_actual_source_oids_required')
    grants = re.findall(r'^GRANT SELECT ON (.+?) TO "arena_native_reader";', source, re.M | re.S)
    actual_source_relations = {name.strip().replace(chr(34), '') for block in grants for name in block.split(',')}
    need(len(grants) == 2 and len(actual_source_relations) == 13 and actual_source_relations == {r['name'] for r in tables}, 'exact_thirteen_source_selects_required')
    need(not re.search(r'^GRANT (?:INSERT|UPDATE|DELETE|EXECUTE|ALL)|^ALTER |^REVOKE ', source, re.M), 'source_grants_remain_read_only')
    need(proposal['sourceReader']['existingAmbientAuthority']['publicDatabase'] == ['CONNECT', 'TEMPORARY'] and len(proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']) == 2 and all(not r['securityDefiner'] for r in proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']), 'honest_existing_source_public_authority_required')
    need(proposal['directCutover']['extraLegacyUpgradeRequired'] is False and proposal['directCutover']['reuseMigrationOperator'] is False and proposal['directCutover']['newCommittedSchemaOwnerAdopterRequired'] is True, 'direct_native_without_migration_replay_required')
    return {'format': proposal['format'], 'status': 'static_current_admission_review_passed', 'operationalRoles': 8, 'sourceRoles': 1, 'operationalGrantEdges': 227, 'currentDeltaStatements': 7, 'sourceTableReads': 13, 'databaseCalls': 0, 'serviceJobs': 0, 'applied': False}


def main():
    proposal = json.loads((HERE / 'proposal.current.json').read_bytes())
    for name, pin in proposal['sql'].items():
        need(hashlib.sha256((HERE / name).read_bytes()).hexdigest() == pin, 'reviewed_sql_bytes_changed')
    print(json.dumps(validate(proposal, (HERE / 'operational-roles.current.sql.review').read_text(), (HERE / 'source-reader.current.sql.review').read_text()), sort_keys=True))


if __name__ == '__main__':
    main()
