#!/usr/bin/env python3
"""Stage five marketplace consumer mappings and dormant role proposals only.

No SQL, login/account changes, provider calls, application imports or service
jobs. Exact owner registrations and worker starts remain separate operations.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import socket
import types
from urllib.parse import unquote, urlsplit

FORMAT = 'yunipals-marketplace-consumer-stage-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-marketplace-consumer-stage-v1-20261022')
SHARED_SHA = '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416'
POLICY_FILE = OPS / 'marketplace-owner-policy-inventory-v1.json'
POLICY_SHA = 'd88111cf41d6c79e2f22bc6fec4278c5e80c997e4ed6e8c2b3ca8c147f1ca259'
SOURCE_FILE = Path('/etc/yunipals-marketplace/production/database/source-read.env')
BUDGET_FILE = Path('/etc/yunipals-marketplace/production/budget/opensea.env')
BNB_UNIT = 'yunipals-market-production-bnb.service'
BNB_FILES = [
    '/etc/yunipals-marketplace/production/common.env',
    '/etc/yunipals-marketplace/production/database/bnb.env',
    str(BUDGET_FILE),
    '/etc/yunipals-marketplace/production/rpc/trading-bnb.env',
    '/etc/yunipals-marketplace/production/policy/bnb.env',
    str(BUDGET_FILE),
]
BNB_CWD = '/opt/yunipals-marketplace/releases/2f14e8f16bf04764b12dde8fe0da0b136eb4e6ae'
BNB_ENTRY = '/opt/yunipals-marketplace/releases/short-confirmations-20261016-2f14e8f16bf04764b12dde8fe0da0b136eb4e6ae-v2/dist/worker.mjs'
CHAINS = {'ethereum': 1, 'base': 8453, 'polygon': 137}
PORTS = {'ethereum': 19201, 'base': 19202, 'polygon': 19203}
ROLES = {chain: 'market_prod_sale_' + chain for chain in CHAINS}
OWNER = 'postgresql://postgres@localhost/yunipals_market_production?host=%2Fvar%2Frun%2Fpostgresql&port=15438&options=-c%20role%3Dmarket_prod_owner'
BUDGET_KEYS = ('MARKET_OPENSEA_BUDGET_DATABASE_URL', 'MARKET_OPENSEA_BUDGET_SCOPE', 'MARKET_OPENSEA_BUDGET_COORDINATOR_ID')
GRANT_SHA = '0b4e085deea6da7298621b51d584eb4290faa84d198b436f3bcebbd134d6ac6e'
SOURCE_GRANT_SHA = 'b1dc355a02a832748e211f3f8f23600ccfb63f8c13155697dabf2aeaa0ad1992'


def fail(code):
    raise RuntimeError(code)


def shared():
    # Bootstrap with the same protected-input primitive as the acknowledged
    # stager; execute only that exact public module, never its main().
    import hashlib
    import stat
    path = OPS / 'retained-workers-stage-v1.py'
    for part in [*path.parents, path]:
        info = part.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            fail('protected_shared_helper_required')
    raw = path.read_bytes()
    if len(raw) > 100000 or hashlib.sha256(raw).hexdigest() != SHARED_SHA:
        fail('exact_shared_helper_required')
    module = types.ModuleType('marketplace_stage_primitives')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def policy(m):
    value = m.document(POLICY_FILE, POLICY_SHA)
    config = value.get('publicConfiguration', {})
    if value.get('format') != 'yunipals-marketplace-owner-policy-inventory-v1' or config.get('readOnly') != 'on' or value.get('databaseWrites') != 0 or value.get('providerCalls') != 0:
        fail('actual_readonly_policy_inventory_required')
    rows = config.get('saleReplayConfig', [])
    if len(rows) != 3 or {r['chain_id'] for r in rows} != set(CHAINS.values()):
        fail('exact_three_owner_sale_policies_required')
    if any(not re.fullmatch('[0-9]+', r.get('start_block', '')) or not re.fullmatch('[a-z][a-z0-9_-]{0,127}', r.get('policy', '')) or type(r.get('confirmations')) is not int or r['confirmations'] < 0 for r in rows):
        fail('valid_observed_policy_required')
    if any(r['rolname'] in ROLES.values() for r in config.get('existingSaleRoles', [])):
        fail('fresh_dedicated_roles_required')
    if not any(r == {'type': 'local', 'database': ['all'], 'has_error': False, 'user_name': ['all'], 'auth_method': 'peer', 'rule_number': 1} for r in config.get('localAuthenticationRules', [])):
        fail('observed_local_peer_auth_required')
    return {chain: next(r for r in rows if r['chain_id'] == chain_id) for chain, chain_id in CHAINS.items()}


def bnb_state(m):
    keys = [*m.PROPS, 'Job']
    value, files = {}, []
    for line in m.run(['/usr/bin/systemctl', 'show', BNB_UNIT, *['--property=' + k for k in keys]]).decode().splitlines():
        key, sep, val = line.partition('=')
        if not sep or key not in keys or key in value:
            fail('bounded_bnb_unit_properties_required')
        if key == 'EnvironmentFiles':
            files.append(val)
        else:
            value[key] = val
    value['EnvironmentFiles'] = files
    if set(value) != set(keys) or value['Id'] != BNB_UNIT or value['Job'] not in ('', '0') or value['User'] != 'yunipals-market-bnb' or value['Group'] != 'yunipals-market-bnb':
        fail('retained_bnb_identity_required')
    if value['WorkingDirectory'] != BNB_CWD or re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) != [m.NODE + ' ' + BNB_ENTRY] or value['FragmentPath'] != '/etc/systemd/system/' + BNB_UNIT:
        fail('retained_bnb_command_required')
    live = value['ActiveState'] == 'active' and value['SubState'] == 'running' and re.fullmatch('[1-9][0-9]*', value['MainPID'])
    terminal = value['ActiveState'] in ('inactive', 'failed') and value['SubState'] in ('dead', 'failed') and value['MainPID'] == '0'
    if not (live or terminal):
        fail('stable_retained_bnb_state_required')
    if m.ordered_files(files) != [(p, False) for p in BNB_FILES]:
        fail('exact_retained_bnb_private_order_required')
    return value


def inputs(m):
    state = bnb_state(m)
    if any(m.service_property(BNB_UNIT, k) for k in ('PassEnvironment', 'UnsetEnvironment')):
        fail('explicit_bnb_environment_required')
    inline = m.service_property(BNB_UNIT, 'Environment')
    env = {}
    for assignment in inline:
        key, sep, val = assignment.partition('=')
        if not sep or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key):
            fail('explicit_inline_assignment_required')
        env[key] = val
    file_hashes = {}
    for path in BNB_FILES:
        raw = m.protected(path, 262144)
        file_hashes[path] = m.sha(raw)
        env.update(m.parse_env(raw))
    if env.get('MARKET_DEPLOYMENT') != 'production' or not env.get('MARKET_DATABASE_URL') or not re.fullmatch('[1-9][0-9]*', env.get('MARKET_BNB_DISCOVERY_START_BLOCK', '')):
        fail('retained_bnb_production_and_launch_required')
    forbidden = ('MARKET_OWNERSHIP_INDEXER', 'MARKET_BNB_DISCOVERY_INDEXER', 'MARKET_BNB_SALE_INDEXER')
    if any(k.startswith(forbidden) and not (k.endswith('_MODE') and v == 'legacy') for k, v in env.items()):
        fail('bnb_native_selection_already_present')
    proc = None
    if state['MainPID'] != '0':
        proc = m.process(state['MainPID'])
        actual = m.process_env(state['MainPID'])
        if any(actual.get(k) != v for k, v in env.items()) or any(k.startswith(forbidden) and actual.get(k) != env.get(k) for k in actual):
            fail('bnb_process_environment_changed')
    definitions = [state['FragmentPath'], *state['DropInPaths'].split()]
    if any(not p.startswith('/etc/systemd/system/' + BNB_UNIT + '.d/') for p in definitions[1:]):
        fail('retained_bnb_definition_paths_required')
    source_raw = m.protected(SOURCE_FILE, 262144)
    source = m.parse_env(source_raw).get('MARKET_INDEXER_DATABASE_URL')
    endpoint = urlsplit(source or '')
    if endpoint.scheme not in ('postgres', 'postgresql') or endpoint.hostname not in ('localhost', '127.0.0.1', '::1') or (endpoint.port or 5432) != 5432 or unquote(endpoint.username or '') != 'market_prod_source_read' or endpoint.path != '/yunipals_backfill' or endpoint.fragment:
        fail('existing_restricted_main_source_connection_required')
    file_hashes[str(SOURCE_FILE)] = m.sha(source_raw)
    budget_values = m.parse_env(m.protected(BUDGET_FILE, 262144))
    if any(not budget_values.get(k) for k in BUDGET_KEYS):
        fail('retained_budget_identity_required')
    budget = {k: budget_values[k] for k in BUDGET_KEYS}
    binding = {'unit': state, 'process': proc, 'processEnvironmentCompared': proc is not None,
               'definitionHashes': {p: m.sha(m.protected(p)) for p in definitions},
               'privateFileHashes': file_hashes, 'inlineEnvironmentSha256': m.sha(m.encoded(inline)),
               'bnbEnvironmentSha256': m.sha(m.encoded(env)), 'sourceUrlSha256': m.sha(source.encode()),
               'budgetConfigurationSha256': m.sha(m.encoded(budget))}
    if bnb_state(m) != state or (proc is not None and m.process(state['MainPID']) != proc):
        fail('bnb_changed_during_staging_capture')
    return binding, env, source, budget


def selectors(m, prefix, source):
    return {prefix + '_MODE': 'unified', prefix + '_DATABASE_URL': source, prefix + '_RELEASE_ID': m.RELEASE}


def runtime(m):
    receipt = m.artifact()
    inv = json.loads(m.protected(m.ARTIFACT.parent / 'runtime-supplement.inventory.json', 40000000))
    if m.sha(m.protected(m.ARTIFACT.parent / 'runtime-supplement.inventory.json', 40000000)) != receipt['runtimeInventorySha256']:
        fail('accepted_runtime_inventory_changed')
    rows = {r['path']: r for r in inv['entries']}
    pins = {}
    for name in ('marketplace-consumer.mjs', 'marketplace-rollback.mjs', 'sale-worker.mjs', 'worker.mjs'):
        path = 'apps/yunipals-market-api/dist/' + name
        row = rows[path]
        raw = m.protected(m.ROOT / path, 20000000)
        if row['type'] != 'file' or row['bytes'] != len(raw) or row['sha256'] != m.sha(raw):
            fail('accepted_marketplace_bundle_changed')
        pins[path] = row['sha256']
    return pins


def grants(m):
    raw = m.protected(m.ROOT / 'apps/yunipals-market-api/scripts/grant-sale-worker.sql')
    if m.sha(raw) != GRANT_SHA:
        fail('frozen_sale_grant_required')
    sql = raw.decode()
    body = sql[sql.index('BEGIN;') + 6:sql.rindex('COMMIT;')]
    result = '-- PROPOSAL ONLY: fresh dormant roles; no LOGIN, password, membership or service action.\nBEGIN;\n'
    for role in ROLES.values():
        result += 'CREATE ROLE ' + role + ' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;\n'
        result += body.replace(':"market_runtime_role"', role)
    result += '\nCOMMIT;\n'
    source = m.protected(m.ROOT / 'ops/unified-indexer/grant-marketplace-source.sql')
    if m.sha(source) != SOURCE_GRANT_SHA:
        fail('frozen_source_grant_required')
    source_sql = source.decode().replace(':"physical_schema"', 'unified_shadow_20261020_7e7375b0').replace(':"read_schema"', m.READ_SCHEMA).replace(':"market_source_role"', 'market_prod_source_read')
    return result.encode(), source_sql.encode()


def sale_unit(m, chain):
    project = m.ROOT / 'apps/yunipals-market-api'
    role = ROLES[chain]
    return ('# Candidate only; account, NOLOGIN-role admission and source registration remain pending.\n'
            '[Unit]\nDescription=Yunipals shared ' + chain + ' sale consumer\nAfter=network.target\n'
            '[Service]\nType=exec\nUser=' + role + '\nGroup=' + role + '\nWorkingDirectory=' + str(project) +
            '\nEnvironmentFile=' + str(BASE / ('sale-' + chain + '.env')) + '\nExecStart=' + m.NODE + ' ' + str(project / 'dist/sale-worker.mjs') +
            '\nRestart=no\nTimeoutStopSec=35\nKillMode=control-group\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nRestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=localhost\nMemoryMax=768M\nCPUQuota=50%\nUMask=0077\n').encode()


def prepare(m):
    policies = policy(m)
    pins = runtime(m)
    binding, bnb, source, budget = inputs(m)
    files = {}
    native = {**selectors(m, 'MARKET_OWNERSHIP_INDEXER', source), 'MARKET_OWNERSHIP_INDEXER_READ_SCHEMA': m.READ_SCHEMA,
              **selectors(m, 'MARKET_BNB_DISCOVERY_INDEXER', source), **selectors(m, 'MARKET_BNB_SALE_INDEXER', source)}
    files['bnb.selectors.env'] = m.env_bytes(native)
    files['bnb.owner.json'] = m.encoded({**bnb, **native, 'MARKET_MIGRATION_DATABASE_URL': OWNER})
    project = m.ROOT / 'apps/yunipals-market-api'
    files['bnb.drop-in.candidate'] = ('[Service]\nWorkingDirectory=' + str(project) + '\nEnvironmentFile=\n' + ''.join('EnvironmentFile=' + p + '\n' for p in BNB_FILES) + 'EnvironmentFile=' + str(BASE / 'bnb.selectors.env') + '\nExecStart=\nExecStart=' + m.NODE + ' ' + str(project / 'dist/worker.mjs') + '\n').encode()
    mapping = {'bnb-discovery': {'ownerFile': 'bnb.owner.json', 'unit': BNB_UNIT}, 'bnb-sales': {'ownerFile': 'bnb.owner.json', 'unit': BNB_UNIT}}
    for chain in CHAINS:
        role = ROLES[chain]
        # New peer-only operational identity. Passwords and owner authority are
        # never put in a worker environment. Existing source/budget creds stay
        # separate, with their original exact bytes and scope/coordinator.
        env = {'MARKET_DEPLOYMENT': 'production', 'MARKET_DATABASE_URL': 'postgresql://' + role + '@localhost/yunipals_market_production?host=%2Fvar%2Frun%2Fpostgresql&port=15438',
               'MARKET_DB_POOL_MAX': '4', 'MARKET_SALE_CHAIN': chain, 'MARKET_SALE_MODE': 'live',
               'MARKET_SALE_CONTINUOUS': '1', 'MARKET_SALE_RPC': 'http://127.0.0.1:' + str(PORTS[chain]) + '/',
               'MARKET_SALE_POLICY': policies[chain]['policy'], **selectors(m, 'MARKET_SALE_INDEXER', source), **budget}
        raw = m.env_bytes(env)
        m.node_roundtrip(env, raw)
        files['sale-' + chain + '.env'] = raw
        files['sale-' + chain + '.owner.json'] = m.encoded({**env, 'MARKET_MIGRATION_DATABASE_URL': OWNER})
        unit = 'yunipals-sale-unified@' + chain + '.service'
        files[unit + '.candidate'] = sale_unit(m, chain)
        mapping['collection-sales:' + chain] = {'ownerFile': 'sale-' + chain + '.owner.json', 'unit': unit, 'role': role,
            'observedOwnerPolicy': policies[chain], 'policyPreserved': True,
            'selectionPending': ['source_and_receipt_acceptance', 'source_read_grants', 'dormant_role_admission', 'exact_owner_registration'] + (['base_start_witness_and_explicit_owner_alignment_to_latest'] if chain == 'base' else [])}
    role_sql, source_sql = grants(m)
    files['market-sale-roles.proposal.sql'] = role_sql
    files['source-read-grants.proposal.sql'] = source_sql
    files['owner-connections.json'] = m.encoded({'operationalOwner': OWNER, 'executionOsUser': 'postgres', 'consumers': mapping,
        'note': 'Read private owner JSON as root, then drop groups/gid/uid to postgres before executing the official CLI. Never put private values in argv. Staging never runs this command.'})
    summary = {'format': FORMAT, 'sourceDigest': m.SOURCE, 'artifactReceiptSha256': m.ARTIFACT_SHA,
        'observedPolicySha256': POLICY_SHA, 'retained': binding, 'bundleHashes': pins,
        'mappings': mapping, 'proposedAccounts': {c: {'user': r, 'group': r, 'shell': '/usr/sbin/nologin', 'system': True, 'home': '/nonexistent', 'lockedPassword': True} for c, r in ROLES.items()},
        'proposedRolesAreNoLogin': True, 'existingSaleRoleAdopted': False,
        'sourceAndBudgetCredentialsRetained': True, 'ownerPolicyWrites': 0,
        'files': {name: m.sha(raw) for name, raw in files.items()},
        'serviceJobs': 0, 'databaseCalls': 0, 'providerRequests': 0,
        'rolesChanged': 0, 'privateValuesExported': False, 'selected': False}
    return summary, files


def stage(m, summary, files):
    if os.path.lexists(BASE):
        fail('fresh_private_marketplace_stage_required')
    parent = BASE.parent.lstat()
    if parent.st_uid != 0 or parent.st_mode & 0o022:
        fail('protected_backup_parent_required')
    BASE.mkdir(mode=0o700)
    m.write_new(BASE / 'intent.json', m.encoded(summary))
    m.sync_directory(BASE)
    m.sync_directory(BASE.parent)
    for name, raw in files.items():
        m.write_new(BASE / name, raw)
    current, *_ = inputs(m)
    if current != summary['retained'] or runtime(m) != summary['bundleHashes']:
        fail('marketplace_stage_inputs_changed')
    policy(m)
    m.write_new(BASE / 'result.json', m.encoded({**summary, 'staged': True}))
    m.sync_directory(BASE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('root_on_exact_host_required')
    os.umask(0o077)
    m = shared()
    summary, files = prepare(m)
    if args.stage:
        stage(m, summary, files)
    print(json.dumps({'format': FORMAT, 'staged': args.stage, 'bindingSha256': m.sha(m.encoded(summary)), 'directory': str(BASE),
        'files': summary['files'], 'privateValuesExported': False, 'selected': False,
        'providerRequests': 0, 'databaseCalls': 0, 'rolesChanged': 0, 'serviceJobs': 0}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: fail('marketplace_stage_deadline'))
    signal.alarm(90)
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'marketplace_staging_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code, 'privateValuesExported': False}))
        raise SystemExit(1)
    finally:
        signal.alarm(0)
