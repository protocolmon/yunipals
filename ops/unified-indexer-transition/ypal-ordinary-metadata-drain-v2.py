#!/usr/bin/env python3
"""Exact metadata drain with bounded genuine coverage re-observation only."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import types

FORMAT = 'yunipals-ypal-ordinary-metadata-drain-v2'
BASE = Path('/var/backups/yunipals-ypal-ordinary-metadata-drain-v2-20261025')
PREVIOUS = Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-metadata-drain-v1.py')
PREVIOUS_SHA = '920982e39c4a5aa6e2eebd20f7850a1497a2905b6b6031813f9d96e59c6de51e'
MOVING_SCAN_FIELDS = {'next_block', 'target_block', 'target_hash', 'last_scanned_hash', 'updated_at'}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def next_block(scan):
    value = scan['next_block']
    need(type(value) in {str, int} and re.fullmatch('[0-9]+', str(value)), 'actual_nonnegative_metadata_cursor_required')
    return int(value)


def coverage_observation(n, host, database, observations, audit):
    began = time.monotonic()
    first = database(host)
    if n.covered(first):
        return first
    until = began + 90
    stopped = (n.BASE / 'stop-old-intent.json').exists()
    capture = {'phase': 'stopped' if stopped else 'before-effects', 'databaseObservations': [copy.deepcopy(first)],
               'covered': False, 'effectsRetried': False}
    observations.append(capture)
    try:
        scan = first['scan']
        need(type(scan) is dict and scan['ingestion_mode'] == 'rpc' and first['approval'] is None,
             'only_original_unadopted_rpc_metadata_cursor_may_wait_for_coverage')
        stable_scan = {key: value for key, value in scan.items() if key not in MOVING_SCAN_FIELDS}
        cursor = next_block(scan)
        if stopped:
            operation = host.s.document(n.BASE / 'operation.json')
            need(operation == host._coverage_operation_binding, 'actual_original_operation_must_match_own_executor_before_wait')
            def fence():
                need(host.s.document(n.BASE / 'operation.json') == operation, 'metadata_operation_changed_during_coverage_wait')
                n.drained(host, operation)
        else:
            actor = host.actor()
            private = host.m.snapshot(n.UNIT)[0]
            def fence():
                need(not os.path.lexists(n.BASE) and host.actor() == actor and host.m.snapshot(n.UNIT)[0] == private,
                     'metadata_actor_private_or_operation_changed_during_coverage_wait')
        fence()
        while True:
            need(time.monotonic() < until, 'bounded_actual_metadata_coverage_wait_expired')
            time.sleep(min(1, max(0, until - time.monotonic())))
            need(time.monotonic() < until, 'bounded_actual_metadata_coverage_wait_expired')
            fence()
            current = database(host)  # Errors propagate; only a real false result is re-observed.
            capture['databaseObservations'].append(copy.deepcopy(current))
            now_scan = current['scan']
            need(type(now_scan) is dict and current['approval'] is None and
                 {key: value for key, value in now_scan.items() if key not in MOVING_SCAN_FIELDS} == stable_scan and
                 set(now_scan) == set(scan), 'metadata_scan_identity_or_mode_changed_during_coverage_wait')
            if stopped:
                need(now_scan == scan, 'stopped_metadata_cursor_must_not_change_during_coverage_wait')
            else:
                need(next_block(now_scan) >= cursor, 'live_metadata_cursor_must_not_rewind_during_coverage_wait')
                cursor = next_block(now_scan)
            fence()
            need(time.monotonic() < until, 'bounded_actual_metadata_coverage_wait_expired')
            if n.covered(current):
                capture['covered'] = True
                return current
    finally:
        capture['elapsedSeconds'] = time.monotonic() - began
        audit(capture)


def namespace(raw):
    """New executor namespace; no frozen module globals or drain body changes."""
    need(sha(raw) == PREVIOUS_SHA, 'exact_frozen920_executor_required')
    tree = ast.parse(raw)
    changed = set()
    seams = {'install': 0, 'binding': 0, 'review-observation': 0, 'failed-observation': 0}
    body = []
    for node in tree.body:
        if isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'":
            continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            key = node.targets[0].id
            if key in {'FORMAT', 'BASE'}:
                node.value = ast.parse(repr(FORMAT) if key == 'FORMAT' else 'Path(' + repr(str(BASE)) + ')', mode='eval').body
                changed.add(key)
        if isinstance(node, ast.FunctionDef) and node.name == 'main':
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and ast.unparse(call.func) == 'install_session_observer':
                    call.func = ast.Name(id='install_observers', ctx=ast.Load()); seams['install'] += 1
        if isinstance(node, ast.FunctionDef) and node.name == 'execute':
            node.body.insert(0, ast.parse("h._coverage_operation_binding=copy.deepcopy(review['originalFullBinding'])").body[0])
            seams['binding'] += 1
            for value in ast.walk(node):
                if isinstance(value, ast.Dict) and any(isinstance(key, ast.Constant) and key.value == 'originalOperationMayExist' for key in value.keys):
                    value.keys.append(ast.Constant('readonlyCoverageCaptures'))
                    value.values.append(ast.parse("copy.deepcopy(getattr(h,'_coverage_observations',[]))", mode='eval').body); seams['failed-observation'] += 1
        if isinstance(node, ast.FunctionDef) and node.name == 'capture':
            result = next(row.value for row in node.body if isinstance(row, ast.Return))
            need(isinstance(result, ast.Dict), 'exact_original_executor_review_required')
            result.keys.append(ast.Constant('readonlyCoverageCaptures'))
            result.values.append(ast.parse("copy.deepcopy(getattr(host,'_coverage_observations',[]))", mode='eval').body); seams['review-observation'] += 1
        body.append(node)
    need(changed == {'FORMAT', 'BASE'} and seams == {'install': 1, 'binding': 1, 'review-observation': 1, 'failed-observation': 1},
         'exact_new_executor_identity_database_observer_and_audit_seams_required')
    value = types.ModuleType('ordinary_metadata_coverage_executor_v2')
    value.__file__ = str(Path(__file__).absolute())
    def install_observers(n, host, observations):
        value.install_session_observer(n, host, observations)
        original = host.database.__func__
        host._coverage_observations = []
        host._coverage_operation_binding = None
        def audit(record):
            value.directory()
            value.save('coverage-' + str(time.time_ns()) + '-' + str(os.getpid()) + '.json', record)
        def database(self):
            return coverage_observation(n, self, original, self._coverage_observations, audit)
        host.database = types.MethodType(database, host)
    value.install_observers = install_observers
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), value.__file__, 'exec'), value.__dict__)
    return value


def frozen():
    for path in [*PREVIOUS.parents, PREVIOUS]:
        row = path.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022, 'protected_frozen_metadata_executor_required')
    raw = PREVIOUS.read_bytes()
    need(len(raw) < 100000 and sha(raw) == PREVIOUS_SHA, 'exact_frozen920_executor_required')
    return raw


def main():
    if len(sys.argv) == 1:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'databaseWrites': 0, 'serviceActions': 0,
                          'coverageQualified': False, 'originalOwnerUnchanged': True}))
        return
    import signal
    def expired(*_):
        raise RuntimeError('bounded_metadata_coverage_executor_expired_inspect_no_retry')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(900)
    try:
        namespace(frozen()).main()
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': str(error) if type(error) is RuntimeError and
                         re.fullmatch('[a-z0-9_]+', str(error)) else type(error).__name__, 'automaticRetryAllowed': False}))
        raise SystemExit(1)
