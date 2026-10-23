"""Read-only ownership adapter for successor consumer transitions.

No service is started/stopped and no ACL is changed here. Callers retain their
existing mutation lease, exact candidate verifier and global capacity checks.
"""
import copy
import hashlib
import json
import os
import re
import stat
import time
import urllib.request
from pathlib import Path

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
POLICY_SHA='235c1a65309f92440335faf881d592371b10c3df824c50a1aa55ef68092ab720'
GRAPH_SHA='dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0'
ADMISSION_SHA = '4ce2f6216ee3774ad89ca5ed53bae9db606d292354715497c0eb00df74f3e909'
RECEIPT = Path('/var/backups/yunipals-booster-collection-api-v1-20261023/result.json')
ROLE = 'yunipals_unified_collector'
FEATURE_APPS = ('yunipals_booster_api', 'yunipals_booster_artwork_queue')
API_UNIT = 'yunipals-booster-api.service'
QUEUE_UNIT = 'yunipals-booster-artwork-queue.service'
TIMER_UNIT = 'yunipals-booster-artwork-queue.timer'


def fail(code):
    raise RuntimeError(code)


def graph_sql(schema):
    if schema != 'yunipals_boosters_launch_v1':
        fail('fixed_owned_booster_namespace_required')
    return """SELECT jsonb_build_object(
      'schema',(SELECT jsonb_build_object('oid',oid::text,'owner',nspowner::text)
        FROM pg_namespace WHERE nspname='yunipals_boosters_launch_v1'),
      'buildId',(SELECT value->>'build_id'FROM yunipals_boosters_launch_v1._ponder_meta WHERE key='app'),
      'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,
        'kind',c.relkind,'select',has_table_privilege('yunipals_unified_collector',c.oid,'SELECT'),
        'writes',has_table_privilege('yunipals_unified_collector',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
        'grantable',EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a
          WHERE a.grantee=73187672 AND a.is_grantable))ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='yunipals_boosters_launch_v1'AND c.relkind IN('r','p','v','m','f')),
      'readerRelations',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,
        'select',has_table_privilege('yunipals_unified_collector',c.oid,'SELECT'),
        'writes',has_table_privilege('yunipals_unified_collector',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
        ORDER BY n.nspname,c.relname),'[]'::jsonb)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%'AND n.nspname<>'information_schema'AND c.relkind IN('r','p','v','m','f')
        AND has_table_privilege('yunipals_unified_collector',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    """


def validate_graph(value, graph, read_oids, allowed_relations):
    if value.get('schema') != {'oid': str(graph['schemaOid']), 'owner': str(graph['ownerOid'])} or value.get('buildId') != graph['buildId']:
        fail('exact_owned_booster_source_namespace_and_build_required')
    expected = {r['name']: (str(r['oid']), str(r['owner'])) for r in graph['tables']}
    rows = value.get('tables') or []
    if len(rows) != len(expected) or {r['name']: (r['oid'], r['owner']) for r in rows} != expected:
        fail('exact_owned_booster_source_table_OIDs_required')
    for row in rows:
        if row['kind'] != 'r' or row['writes'] is not False or row['grantable'] is not False or row['select'] is not (row['name'] in read_oids):
            fail('only_ten_owned_booster_reads_required')
    relations = value.get('readerRelations') or []
    if (len(relations) > 5000 or len({row['name'] for row in relations}) != len(relations)
            or any(row['name'] not in allowed_relations or row['select'] is not True or row['writes'] is not False for row in relations)):
        fail('unexpected_collector_namespace_or_write_privilege')
    return value


def session_shape(rows, candidate=False):
    allowed = {FEATURE_APPS[0]: 2, FEATURE_APPS[1]: 1}
    if candidate:
        allowed['yunipals_api'] = 2
    counts = {key: 0 for key in allowed}
    seen = set()
    for row in rows:
        if (row.get('user') != ROLE or row.get('database') != 'yunipals_backfill'
                or row.get('application') not in allowed or type(row.get('pid')) is not int
                or row['pid'] <= 0 or row['pid'] in seen):
            fail('unexpected_same_role_database_session')
        seen.add(row['pid']); counts[row['application']] += 1
    if any(counts[key] > maximum for key, maximum in allowed.items()) or len(rows) > 5:
        fail('owned_reader_and_candidate_pool_budget_exceeded')
    return counts


def validate_process_status(status):
    if (any(int(v) != 967 for v in status['Uid'].split()) or any(int(v) != 961 for v in status['Gid'].split())
            or status['NoNewPrivs'].strip() != '1'
            or any(int(status[k], 16) for k in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))):
        fail('locked_capability_free_feature_process_required')


def validate_timer_state(timer):
    # systemd reports running while this timer's exact oneshot is triggered,
    # and waiting between runs. Both were observed on the pinned live unit.
    if (timer.get('Id') != TIMER_UNIT or timer.get('FragmentPath') != '/etc/systemd/system/' + TIMER_UNIT
            or timer.get('ActiveState') != 'active' or timer.get('SubState') not in {'waiting', 'running'}
            or timer.get('UnitFileState') != 'enabled' or timer.get('DropInPaths')
            or timer.get('Triggers') != QUEUE_UNIT):
        fail('owned_artwork_queue_schedule_required')


class Guard:
    def __init__(self, a, owner, helper, scope, frozen):
        self.a, self.owner, self.helper = a, owner, helper
        self.policy = a.load(OPS / 'consumer-owned-booster-policy-v2.py', POLICY_SHA)
        self.admit = a.load(OPS / 'booster-api-binding-v2.py', ADMISSION_SHA)
        self.graph = a.document(OPS / 'consumer-owned-booster-graph-v1.json', GRAPH_SHA)
        self.raw = a.protected(RECEIPT)
        if a.sha(self.raw) != self.policy.RECEIPT_SHA:
            fail('exact_owned_reader_commit_receipt_required')
        self.receipt = json.loads(self.raw)
        objects = a.objects(scope, frozen)
        self.allowed_relations = set(objects['relation']) | set(self.graph['v4Relations']) | {
            self.graph['schema'] + '.' + name for name in self.admit.SOURCE_OIDS
        }
        self.candidate = None
        self.proof = None
        self.last_graph = None

    def state(self, unit):
        keys = 'Id,User,Group,ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestampMonotonic,ControlGroup,DropInPaths,FragmentPath,UnitFileState,Job,Result,Triggers'
        raw = self.helper.run(['/usr/bin/systemctl', 'show', unit, '--property=' + keys], timeout=5)
        return dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)

    def candidate_started(self, unit, invocation, files):
        # Called only AFTER the caller's existing complete candidate verifier.
        if self.candidate is not None and (self.candidate['unit'] != unit or self.candidate['invocation'] != invocation or self.candidate['files'] != files or self.candidate['draining']):
            fail('one_owned_collector_candidate_at_a_time')
        if unit != 'yunipals-collector-api.service' and not re.fullmatch(r'yunipals-unified-api-preview-v5-20261022-[a-z0-9-]+-collector.service', unit):
            fail('fixed_collector_candidate_unit_required')
        state = self.state(unit)
        if state.get('InvocationID') != invocation or state.get('ActiveState') != 'active' or state.get('User') != ROLE or state.get('Group') != ROLE:
            fail('verified_owned_collector_candidate_required')
        if not files or any(self.a.sha(self.a.protected(Path(path), 4000000)) != pin for path, pin in files.items()):
            fail('pinned_owned_candidate_files_required')
        self.candidate = {'unit': unit, 'invocation': invocation, 'files': files, 'draining': False}
        self.policy.collector_connection_budget()

    def candidate_stopping(self, unit):
        if self.candidate and self.candidate['unit'] == unit:
            self.candidate['draining'] = True

    def candidate_finished(self, unit):
        if self.candidate and self.candidate['unit'] == unit:
            if self.pending_sessions(ROLE):
                fail('owned_collector_candidate_sessions_not_drained')
            self.candidate = None

    def session_rows(self):
        return self.owner.json_sql("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'user',usename,'database',datname,'application',application_name)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usename='" + ROLE + "'")

    def pending_sessions(self, role):
        if role != ROLE:
            return self.owner.json_sql("SELECT jsonb_build_object('n',count(*))FROM pg_stat_activity WHERE usename=" + self.a.quoted(role))['n']
        rows = self.session_rows()
        # During an explicit stop, a candidate connection may briefly outlive
        # its owned Node process. Count it for draining; never terminate it here.
        known = [r for r in rows if r.get('application') in FEATURE_APPS]
        session_shape(known)
        return len(rows) - len(known)

    def sql_session_guard(self, roles):
        if not roles or set(roles) - set(self.a.ROLES):
            fail('fixed_affected_roles_required')
        other = [r for r in roles if r != ROLE]
        terms = ['usename IN(' + ','.join(self.a.quoted(r) for r in other) + ')'] if other else []
        if ROLE in roles:
            terms.append("(usename='" + ROLE + "'AND application_name NOT IN(" + ','.join(self.a.quoted(v) for v in FEATURE_APPS) + '))')
        return "IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE " + ' OR '.join(terms) + ")THEN RAISE EXCEPTION 'unowned_consumer_sessions_must_be_zero';END IF;"

    def sql_graph_guard(self):
        self.ensure()
        return "IF (" + graph_sql(self.graph['schema']) + ') IS DISTINCT FROM ' + self.a.quoted(json.dumps(self.last_graph, separators=(',', ':'))) + "::jsonb THEN RAISE EXCEPTION 'owned_feature_graph_changed_during_consumer_transaction';END IF;"

    def _processes(self, states):
        allowed = set()
        for state in states:
            if state.get('MainPID') == '0':
                continue
            unit = state['Id']; group = state.get('ControlGroup')
            if group != '/system.slice/' + unit or state.get('User') != ROLE or state.get('Group') != ROLE:
                fail('owned_feature_actor_cgroup_required')
            procs = Path('/sys/fs/cgroup' + group + '/cgroup.procs')
            ids = {int(v) for v in procs.read_text().split()}
            if int(state['MainPID']) not in ids or len(ids) > 64:
                fail('bounded_owned_actor_processes_required')
            for pid in ids:
                status = dict(line.split(':', 1) for line in (Path('/proc') / str(pid) / 'status').read_text().splitlines() if ':' in line)
                validate_process_status(status)
            allowed |= ids
        actual = set()
        for path in Path('/proc').iterdir():
            if path.name.isdigit():
                try:
                    status = (path / 'status').read_text()
                    uid = next(line.split()[1] for line in status.splitlines() if line.startswith('Uid:'))
                    if int(uid) == 967:
                        actual.add(int(path.name))
                except (FileNotFoundError, ProcessLookupError):
                    continue
        if actual - allowed:
            fail('unexpected_same_Unix_actor_process')

    def ensure(self):
        a = self.a
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:9030/readyz', timeout=5) as response:
            ready = json.loads(response.read(100001))
            if response.status != 200 or ready.get('ready') is not True or ready.get('buildId') != self.graph['buildId']:
                fail('live_feature_availability_required_before_consumer_change')
        source = a.document(Path(self.graph['sourceReceipt']), self.graph['sourceReceiptSha256'])
        if source.get('definitionSha256') != self.graph['sourceDefinitionSha256']:
            fail('owned_temporary_source_receipt_required')
        if a.sha(a.protected(Path('/etc/systemd/system/' + self.graph['sourceUnit']))) != self.graph['sourceDefinitionSha256']:
            fail('owned_temporary_source_definition_changed')
        source_state = self.state(self.graph['sourceUnit'])
        if source_state.get('ActiveState') != 'active' or source_state.get('SubState') != 'running' or source_state.get('User') != 'yunipals_unified_shadow' or source_state.get('Group') != 'yunipals_unified_shadow' or source_state.get('DropInPaths'):
            fail('owned_temporary_source_process_required')
        queue_inputs = {path: a.sha(a.protected(Path(path), 4000000)) for path in self.policy.QUEUE_INPUTS}
        current = self.admit.capture(); api = self.admit.api_binding()
        proof = self.policy.validate_owned_feature(self.raw, current, api, queue_inputs, self.admit)
        graph = self.owner.json_sql(graph_sql(self.graph['schema']))
        validate_graph(graph, self.graph, self.admit.SOURCE_OIDS, self.allowed_relations)
        self.last_graph = graph
        # Queue state changes naturally every five seconds; use bounded stable
        # observations rather than pinning a completed invocation forever.
        for _ in range(3):
            before = self.state(QUEUE_UNIT); timer = self.state(TIMER_UNIT)
            validate_timer_state(timer)
            rows = self.session_rows()
            live_api = self.state(API_UNIT)
            identity_keys = ('Id', 'InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic', 'ActiveState', 'SubState', 'User', 'Group', 'FragmentPath', 'DropInPaths', 'ControlGroup')
            if any(live_api.get(key) != api.get(key) for key in identity_keys):
                fail('feature_API_identity_changed_during_observation')
            states = [live_api, before]
            if self.candidate:
                candidate = self.candidate
                if candidate['draining']:
                    fail('finish_owned_candidate_drain_before_catalog_observation')
                state = self.state(candidate['unit'])
                if state.get('InvocationID') != candidate['invocation'] or state.get('ActiveState') != 'active' or any(a.sha(a.protected(Path(path), 4000000)) != pin for path, pin in candidate['files'].items()):
                    fail('owned_candidate_binding_changed')
                states.append(state)
            after = self.state(QUEUE_UNIT)
            if (before.get('InvocationID'), before.get('MainPID')) != (after.get('InvocationID'), after.get('MainPID')):
                time.sleep(0.02); continue
            if before.get('User') != ROLE or before.get('Group') != ROLE or before.get('DropInPaths') or before.get('ActiveState') not in {'active', 'activating', 'inactive'}:
                fail('owned_queue_actor_required')
            session_shape(rows, self.candidate is not None)
            try:
                self._processes(states)
            except (FileNotFoundError, ProcessLookupError):
                time.sleep(0.02); continue
            except RuntimeError:
                latest = self.state(QUEUE_UNIT)
                if (before.get('InvocationID'), before.get('MainPID')) != (latest.get('InvocationID'), latest.get('MainPID')):
                    time.sleep(0.02); continue
                raise
            if self.admit.api_binding() != api:
                fail('feature_API_binding_changed_during_observation')
            break
        else:
            fail('bounded_owned_queue_observation_raced')
        self.proof = proof
        return {'receiptSha256': self.policy.RECEIPT_SHA, 'sourceNamespaceOid': self.graph['schemaOid'],
                'sourceGraphSha256': GRAPH_SHA, 'sourceReceiptSha256': self.graph['sourceReceiptSha256'],
                'apiInvocation': api['InvocationID'], 'apiBundleSha256': api['bundleSha256'],
                'apiIdentity': {key: api[key] for key in ('InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic', 'ControlGroup')},
                'queueInputs': queue_inputs, 'queueTimerEnabled': True, 'priorCollectorLogin': True,
                'connectionBudget': self.policy.collector_connection_budget()}

