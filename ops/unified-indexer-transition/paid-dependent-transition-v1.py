#!/usr/bin/env python3
"""Fixed five-service snapshots and exact owned-proxy transition validation."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASIS = OPS / 'productive-v4-dependent-equivalence-v1.json'
BASIS_SHA = '8df219273e9a8ea0ea5bdb39efc79343cf02acf902de3907f1dc9e871ad29e0a'
FIVE = ('yunipals-bnb.service', 'yunipals-indexer.service', 'yunipals-metadata.service',
        'yunipals-market-production-read@base.service', 'yunipals-market-production-signature.service')
OWNED = {n: 'yunipals-market-production-rpc@' + n + '.service' for n in ['base', 'bnb']}
KEYS = {'Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID'}
IDENTITY = {'definitionsSha256', 'privateSettingsSha256', 'execIdentitySha256', 'runtimeFilesSha256'}
PINS = {'paid-source6-dependent-restarts-v1.py': '4668511cb75e917a92185d42f822ed4ed467412d904340344e0fb4ebc1997676',
        'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965',
        'dependency-rebase-range-hints-v5.py': '1baaaafca0021ea710f2234b6a705a3fa6a4978608810a51aa9ef56913e544e0'}


def fail(label): raise RuntimeError(label)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def digest(value): return sha(encoded(value))
def moment(value): return datetime.fromisoformat(value.replace('Z', '+00:00'))


def healthy(unit, value):
    if (set(value) != KEYS or value['Id'] != unit or value['LoadState'] != 'loaded' or value['ActiveState'] != 'active' or
            value['SubState'] != 'running' or not isinstance(value['InvocationID'], str) or not re.fullmatch('[0-9a-f]{32}', value['InvocationID'])):
        fail('exact_healthy_dependent_tuple_required')


def files(session, props):
    rows = []
    for entry in props['EnvironmentFilesEntries']:
        pieces = re.findall(r'([^ ;]+) \(ignore_errors=(yes|no)\)', entry)
        if ' '.join(p + ' (ignore_errors=' + optional + ')' for p, optional in pieces) != entry: fail('ordered_selected_file_shape_required')
        for name, optional in pieces:
            path = Path(name)
            if not path.is_absolute() or '..' in path.parts: fail('absolute_selected_file_required')
            if not os.path.lexists(path) and optional == 'yes': rows.append({'path': name, 'optional': True, 'exists': False}); continue
            rows.append({'path': name, 'optional': optional == 'yes', 'exists': True,
                         'sha256': sha(session.c.trusted(path, 2_000_000))})
    if len(rows) > 16: fail('bounded_selected_file_count_required')
    return rows


def capture(session, states):
    session.held()
    helper = session.c.load(OPS / 'paid-source6-dependent-restarts-v1.py', PINS['paid-source6-dependent-restarts-v1.py'], 'transition_runtime_equivalence')
    verifier = session.c.load(OPS / 'proxy-upgrade.py', PINS['proxy-upgrade.py'], 'transition_public_verifier')
    dependency = session.c.load(OPS / 'dependency-rebase-range-hints-v5.py', PINS['dependency-rebase-range-hints-v5.py'], 'transition_public_runtime_reader')
    basis = session.c.pinned_json(BASIS, BASIS_SHA, 200_000)
    if (basis.get('format') != 'yunipals-productive-dependent-equivalence-v1' or basis.get('qualificationPassed') is not True or
            basis.get('serviceCount') != 5 or {r.get('unit') for r in basis.get('services', [])} != set(FIVE)):
        fail('exact_reviewed_five_service_basis_required')
    accepted = {}
    for filename, pin, key in [('dependency-rebase-range-hints-v5.json', helper.DEPENDENCY_SHA, 'services'),
                               ('legacy-rebase-range-hints-v5.json', helper.LEGACY_SHA, 'workers')]:
        for row in session.c.pinned_json(OPS / filename, pin, 150_000)[key]:
            if row.get('unit') in FIVE: accepted[row['unit']] = row
    if set(accepted) != set(FIVE): fail('exact_accepted_five_runtime_rows_required')
    bus = session.check_proxy.__func__.__globals__['bus_property']; units = {}
    for unit in FIVE:
        healthy(unit, states[unit]); reference = next(r for r in basis['services'] if r['unit'] == unit)
        props = helper.properties(verifier, unit)
        # Runtime identity is inherited from the original accepted receipts;
        # this explicit intermediate state came from the separate5034 proof.
        prior = {**accepted[unit], 'afterState': reference['beforeState']}
        checked = helper.equivalent(verifier, dependency, unit, prior, reference['beforeState'], states[unit], props)
        identity = {k: checked[k] for k in IDENTITY}
        if identity != {k: reference[k] for k in IDENTITY}: fail('reviewed_dependent_runtime_or_configuration_changed')
        relationships = {}
        for key in ['Requires', 'PartOf', 'BindsTo']:
            values = bus(unit, 'org.freedesktop.systemd1.Unit', key, 'as')
            if (not isinstance(values, list) or len(values) > 256 or any(not isinstance(v, str) or len(v) > 512 for v in values) or len(set(values)) != len(values)):
                fail('bounded_typed_dependency_relationships_required')
            relationships[key] = sorted(values)
        edges = {k: sorted(set(values).intersection(OWNED.values())) for k, values in relationships.items()}
        if not any(edges.values()): fail('owned_proxy_dependency_edge_required')
        started = bus(unit, 'org.freedesktop.systemd1.Service', 'ExecMainStartTimestamp', 't')
        if type(started) is not int or started <= 0: fail('actual_dependent_start_required')
        units[unit] = {'state': deepcopy(states[unit]), 'runtimeIdentity': identity,
                       'environmentFileHashes': files(session, props), 'relationshipSha256': digest(relationships),
                       'ownedProxyRelations': edges, 'startRealtimeUs': started}
    return {'format': 'yunipals-paid-dependent-snapshot-v1', 'basisProofSha256': BASIS_SHA, 'units': units}


def snapshot(value):
    if not isinstance(value, dict) or set(value) != {'format', 'basisProofSha256', 'units'} or value['format'] != 'yunipals-paid-dependent-snapshot-v1' or value['basisProofSha256'] != BASIS_SHA or set(value['units']) != set(FIVE):
        fail('exact_fixed_five_snapshot_required')
    for unit, row in value['units'].items():
        if set(row) != {'state', 'runtimeIdentity', 'environmentFileHashes', 'relationshipSha256', 'ownedProxyRelations', 'startRealtimeUs'} or set(row['runtimeIdentity']) != IDENTITY:
            fail('exact_dependent_snapshot_fields_required')
        healthy(unit, row['state'])
        if any(not isinstance(h, str) or not re.fullmatch('[0-9a-f]{64}', h) for h in [*row['runtimeIdentity'].values(), row['relationshipSha256']]) or type(row['startRealtimeUs']) is not int or row['startRealtimeUs'] <= 0:
            fail('exact_dependent_snapshot_identity_required')
        if not isinstance(row['environmentFileHashes'], list) or len(row['environmentFileHashes']) > 16: fail('bounded_dependent_file_snapshot_required')
        for item in row['environmentFileHashes']:
            if (not isinstance(item, dict) or set(item) != ({'path', 'optional', 'exists', 'sha256'} if item.get('exists') is True else {'path', 'optional', 'exists'}) or
                    type(item.get('optional')) is not bool or type(item.get('exists')) is not bool or
                    not isinstance(item.get('path'), str) or not Path(item['path']).is_absolute() or '..' in Path(item['path']).parts or
                    item['exists'] is False and item['optional'] is not True or item['exists'] is True and not re.fullmatch('[0-9a-f]{64}', item.get('sha256', ''))):
                fail('exact_selected_file_checksum_shape_required')
        if set(row['ownedProxyRelations']) != {'Requires', 'PartOf', 'BindsTo'} or any(not isinstance(v, list) or len(set(v)) != len(v) or not set(v).issubset(OWNED.values()) for v in row['ownedProxyRelations'].values()) or not any(row['ownedProxyRelations'].values()):
            fail('exact_owned_dependency_intersections_required')
    return value


def validate(before, after, before_states, after_states, *, owned_states, window, phase):
    snapshot(before); snapshot(after)
    if phase not in {'enable', 'cleanup'} or set(window) != {'from', 'through'} or not 0 <= (moment(window['through']) - moment(window['from'])).total_seconds() <= 360:
        fail('bounded_separate_owned_transition_window_required')
    if len(before_states) != 32 or set(before_states) != set(after_states) or not set(FIVE).union(OWNED.values()).issubset(before_states) or set(owned_states) != set(OWNED):
        fail('exact_full_legacy_graph_required')
    changed = []
    for unit, old in before_states.items():
        current = after_states[unit]
        if unit in OWNED.values():
            name = next(n for n, u in OWNED.items() if u == unit)
            healthy(unit, old); healthy(unit, current)
            if current != owned_states[name] or any(current[k] != old[k] for k in KEYS - {'InvocationID'}): fail('exact_owned_proxy_transition_required')
        elif unit not in FIVE:
            if old != current: fail('unreviewed_legacy_unit_transition_refused')
        else:
            healthy(unit, old); healthy(unit, current)
            a, b = before['units'][unit], after['units'][unit]
            if a['state'] != old or b['state'] != current: fail('snapshot_not_bound_to_actual_service_graph')
            if {k: v for k, v in a.items() if k not in {'state', 'startRealtimeUs'}} != {k: v for k, v in b.items() if k not in {'state', 'startRealtimeUs'}}:
                fail('dependent_code_configuration_or_private_file_changed')
            if old != current:
                started = datetime.fromtimestamp(b['startRealtimeUs'] // 1_000_000, timezone.utc).replace(microsecond=b['startRealtimeUs'] % 1_000_000)
                if not moment(window['from']) <= started <= moment(window['through']): fail('dependent_restart_outside_owned_window')
                changed.append(unit)
            elif a['startRealtimeUs'] != b['startRealtimeUs']: fail('unchanged_invocation_start_changed')
    return {'format': 'yunipals-paid-dependent-transition-v1', 'phase': phase, 'basisProofSha256': BASIS_SHA,
            'beforeSnapshot': deepcopy(before), 'afterSnapshot': deepcopy(after), 'beforeStatesSha256': digest(before_states),
            'afterStatesSha256': digest(after_states), 'ownedStates': deepcopy(owned_states), 'window': deepcopy(window),
            'changedDependentUnits': sorted(changed), 'onlyInvocationChanged': True,
            'otherTwentyFiveExact': True, 'currentPrivateFileStabilityProven': True, 'historicalPrivateFileEqualityClaimed': False}


