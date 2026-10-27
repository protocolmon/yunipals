"""Actual peer shapes and real local inode prefixes; no live runtime effects."""
import ast
import copy
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE/name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load('ypal-ordinary-managed-parent-phase-v1.py')
old = load('ypal-ordinary-managed-handover-v3.py')
core = load('ypal-managed-handover-v1.py')


def peer_frame(parent='original'):
    """Execute genuine current_peer_frame/og with only their observation seams."""
    source = ast.parse((HERE/'ypal-alchemy-source-switch-v1.py').read_bytes())
    cls = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'Context')
    methods = [copy.deepcopy(node) for node in cls.body if isinstance(node, ast.FunctionDef) and node.name in {'og', 'current_peer_frame'}]
    namespace = {'FRESH': 'FRESH', 'API': 'API', 'OPS': HERE}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ClassDef(name='Context', bases=[], keywords=[], body=methods,
        decorator_list=[])], type_ignores=[])), __file__, 'exec'), namespace)
    ctx = namespace['Context'](); consumers = {name: {'fixtureStable': name} for name in
        ['yunipals-api.service', 'yunipals-collector-api.service', 'yunipals-islands-api.service', 'yunipals-metadata.service']}
    sdk = type('SDK', (), {'actor': lambda *_: None, 'definitions': lambda _, unit: {'fixtureDefinition': unit},
                         'activation': lambda _, unit: {'fixtureActivation': unit}})
    ctx.m = types.SimpleNamespace(Host=sdk, command=Mock(), protected=Mock(), module=lambda *_:
        types.SimpleNamespace(consumer_frame=lambda *_: copy.deepcopy(consumers)))
    ctx.p = types.SimpleNamespace(); ctx.h = types.SimpleNamespace(rpc_m=None, a=None,
        source=types.SimpleNamespace(rpc=types.SimpleNamespace(packet=lambda *_: {'fixtureAPI': True})))
    ctx.unit_preservation = lambda unit: {'fixtureFrame': parent if unit == m.PARENT else unit}
    return ctx.current_peer_frame()


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.system = self.root/'system'; self.system.mkdir()
        self.hold = self.root/'hold'; self.hold.mkdir(); self.foundation_base = self.root/'foundation'; self.foundation_base.mkdir()
        self.boot = self.root/'parent.boot'; self.unit = self.system/m.PARENT; self.unit.write_bytes(b'original')
        self.boot.symlink_to(str(self.unit)); self.original = {'sha256': core.sha(b'original'), 'identity': core.identity(self.unit)}
        self.original_boot = core.link_record(self.boot); self.records = {}; self.state = {'MainPID': '0', 'ControlPID': '0',
            'ActiveState': 'inactive', 'SubState': 'dead', 'Job': '', 'ExecMainStartTimestampMonotonic': '0'}
        self.actor = None; self.activation = {'fixtureOriginalActivation': True}; self.projection = {'fixtureDefinitionFrame': True}
        self.owner = types.SimpleNamespace()
        o = self.owner
        o.m = types.SimpleNamespace(SYSTEM=self.system, HOLD=self.hold, SOURCE='SOURCE', SOLANA='SOLANA', WRITERS=['SOURCE', 'SOLANA', m.PARENT],
            identity=core.identity, sha=core.sha, protected=lambda path: Path(path).read_bytes(), moved_link_matches=core.moved_link_matches,
            definition_frame=lambda *_: self.projection)
        o.f = types.SimpleNamespace(PUBLIC={'yunipals-indexer.service.example': core.sha(b'managed')}, BASE=self.foundation_base,
            sha=core.sha, protected=lambda path: Path(path).read_bytes(), canonical_actor=lambda value: copy.deepcopy(value))
        o.envelope = lambda: {'format': 'fixtureBoundOwner', 'operatorSha256': 'a'*64, 'bootId': 'fixtureBoot', 'inputSha256': 'b'*64}
        o.get = lambda name: copy.deepcopy(self.records[name]); o.has = lambda name: name in self.records
        o.digest = lambda name: 'c'*64 if name == 'operation.json' else core.sha(name.encode())
        o.h = types.SimpleNamespace(state=lambda *_: copy.deepcopy(self.state), activation=lambda *_: self.activation,
            actor=lambda unit, *_: copy.deepcopy(self.actor if unit == m.PARENT else self.original_actors.get(unit)),
            boot_link=lambda *_: self.boot, sessions=Mock(return_value={'73004621': {'owned': {'SOURCE': [{'fixtureKernel': True}]}}}))
        o.installed = Mock(return_value=self.activation); o.owned_parent_for_stop = lambda: copy.deepcopy(self.actor)
        o.managed_known_gone = Mock(); o.terminal_backends = Mock(); o.restored_files = Mock()
        o.foundation = types.SimpleNamespace(current=Mock(side_effect=lambda *_: {
            'currentWriterQualified': True, 'managedProcessTreeQualified': True, 'allSixMountsQualified': True,
            'currentManagedEpoch': self.actor, 'observation': {'positiveKernelSessions': 1}}))
        o.original_actor = Mock(side_effect=lambda unit, _: self.original_actors[unit]); self.original_actors = {}
        self.op = {'activations': {m.PARENT: {'definitions': {str(self.unit): self.original}, 'boot': self.original_boot}},
                   'unitDefinitionFrames': {m.PARENT: self.projection}, 'units': {'SOURCE': None, 'SOLANA': None}}
        self.activation = self.op['activations'][m.PARENT]

    def intent(self, name, **extra):self.records[name] = {**self.owner.envelope(), 'operationSha256': 'c'*64, **extra}

    def install(self):
        self.intent('install-intent.json')
        held = self.hold/(m.PARENT+'.definition-0')
        self.records['hold-definition-0-intent.json'] = {'value': {'source': str(self.unit), 'target': str(held), 'identity': self.original['identity']}}
        self.unit.rename(held)
        held_boot = self.hold/(m.PARENT+'.boot')
        self.records['hold-boot-'+m.PARENT+'-intent.json'] = {'value': {'source': str(self.boot), 'target': str(held_boot), 'identity': self.original_boot['identity']}}
        self.boot.rename(held_boot); self.unit.write_bytes(b'managed')
        self.records['managed-unit-prepared.json'] = {'path': str(self.unit), 'identity': core.identity(self.unit), 'sha256': core.sha(b'managed')}
        self.boot.symlink_to(str(self.unit)); self.records['new-boot-prepared.json'] = {'path': str(self.boot), 'link': core.link_record(self.boot)}
        self.activation = {'fixtureOwnedManagedActivation': True}
        self.records['installed.json'] = {**self.owner.envelope(), 'activation': self.activation}

    def start(self):
        self.install(); self.intent('parent-start-intent.json', notBeforeUs=100, activation=self.activation)
        self.state.update(MainPID='101', ActiveState='active', SubState='running', ExecMainStartTimestampMonotonic='101')
        self.actor = {'unit': {'NRestarts': '0', 'InvocationID': 'fixtureActualNewInvocation'}, 'processes': [{'fixtureActualNewPID': 101}]}

    def test_genuine_peer_frame_parent_changes_only_and_no_Arena_assumption(self):
        original, changed = peer_frame(), peer_frame('installed-newPID')
        self.assertNotEqual(original, changed); self.assertEqual(m.peer_projection(original), m.peer_projection(changed))
        self.assertNotIn('Arena', repr(original))
        for path in [('freshFrame',), ('apiFrame',), ('og', 'consumers'), ('og', 'currentFrames')]:
            altered = copy.deepcopy(changed); cursor = altered
            for key in path[:-1]:cursor = cursor[key]
            if path[-1] in {'consumers', 'currentFrames'}:cursor[path[-1]]['yunipals-api.service'] = {'foreign': True}
            else:cursor[path[-1]] = {'foreign': True}
            self.assertNotEqual(m.peer_projection(original), m.peer_projection(altered))

    def test_original_stable_refuses_legitimate_parent_transition_new_route_checks_owned_prefix(self):
        self.install(); frame = peer_frame('installed')
        base = {'retainedServingPeers': peer_frame(), 'otherPrivate': {'same': True}}
        current = lambda: {'retainedServingPeers': copy.deepcopy(frame), 'otherPrivate': {'same': True}}
        self.owner.preserved = current; self.owner.h.native = lambda: {'tables': [], 'cache': {}, 'app': {'build_id': '71e2a7f3b7'}}
        self.owner.o = types.SimpleNamespace(h=types.SimpleNamespace(r=types.SimpleNamespace(recovery_floor=Mock())), old=types.SimpleNamespace(ns=types.SimpleNamespace(native_order=Mock())))
        self.op.update(preserved=base, native=self.owner.h.native())
        with self.assertRaises(RuntimeError):old.Owner.stable(self.owner, self.op)
        self.op['preserved'] = {**base, 'retainedServingPeers': m.peer_projection(base['retainedServingPeers'])}
        self.owner.preserved = lambda: m.preserved(self.owner, current)
        self.assertEqual(m.stable(self.owner, lambda op: old.Owner.stable(self.owner, op), self.op), self.op['native'])
        frame['og']['currentFrames']['yunipals-metadata.service'] = {'foreign': True}
        with self.assertRaises(RuntimeError):m.stable(self.owner, lambda op: old.Owner.stable(self.owner, op), self.op)

    def test_original_terminal_requires_same_definitions_boot_frame_and_no_start(self):
        self.assertEqual(m.current(self.owner, self.op)['phase'], 'original-terminal')
        self.activation = {'foreign': True}
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)

    def test_installed_inactive_actual_inodes_allow_transition_without_current_success(self):
        self.install(); value = m.current(self.owner, self.op)
        self.assertEqual(value['phase'], 'owned-install'); self.assertFalse(value['currentManagedQualified'])
        self.owner.foundation.current.assert_not_called()

    def test_same_bytes_foreign_unit_boot_or_unowned_dropin_refuse(self):
        for target in ['unit', 'boot', 'dropin']:
            with self.subTest(target=target):
                case = Controls(); case.setUp(); self.addCleanup(case.doCleanups); case.install()
                if target == 'unit':
                    case.unit.rename(case.root/'foreign-old'); case.unit.write_bytes(b'managed')
                elif target == 'boot':
                    case.boot.rename(case.root/'foreign-boot'); case.boot.symlink_to(str(case.unit))
                else:
                    drop = case.system/(m.PARENT+'.d'); drop.mkdir(); (drop/'foreign.conf').write_bytes(b'foreign')
                with self.assertRaises(RuntimeError):m.current(case.owner, case.op)

    def test_unknown_live_parent_and_wrong_start_operation_refuse(self):
        self.install(); self.state.update(MainPID='101', ActiveState='active')
        self.actor = {'unit': {'NRestarts': '0'}}
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)
        self.intent('parent-start-intent.json', notBeforeUs=100, activation=self.activation)
        self.records['parent-start-intent.json']['operationSha256'] = 'd'*64
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)

    def test_started_parent_requires_boundary_observed_epoch_and_full_kernel_for_success(self):
        self.start(); self.assertFalse(m.current(self.owner, self.op)['currentManagedQualified'])
        self.records['parent-observed.json'] = {**self.owner.envelope(), 'actor': self.actor,
            'startIntentSha256': self.owner.digest('parent-start-intent.json')}
        (self.foundation_base/'result.json').write_bytes(b'fixtureActualFoundationResult')
        self.assertTrue(m.current(self.owner, self.op)['currentManagedQualified'])
        self.owner.foundation.current.return_value = None
        self.owner.foundation.current.side_effect = lambda *_: {'currentWriterQualified': True, 'managedProcessTreeQualified': True,
            'allSixMountsQualified': True, 'currentManagedEpoch': self.actor, 'observation': {'positiveKernelSessions': 0}}
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)

    def test_later_epoch_restart_or_changed_first_observation_refuse(self):
        self.start(); self.actor['unit']['NRestarts'] = '1'
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)
        self.actor['unit']['NRestarts'] = '0'; self.records['parent-first-observation.json'] = {
            **self.owner.envelope(), 'actor': {'foreign': True}, 'startIntentSha256': self.owner.digest('parent-start-intent.json')}
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)

    def test_failed_owned_parent_requires_real_start_boundary_and_drained_backends(self):
        self.start(); self.state.update(MainPID='0', ActiveState='failed', SubState='failed'); self.actor = None
        self.assertEqual(m.current(self.owner, self.op)['phase'], 'owned-start-terminal')
        self.owner.terminal_backends.assert_called_once(); self.state['ExecMainStartTimestampMonotonic'] = '99'
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)

    def test_owned_inverse_source_restart_uses_actual_intents_actors_and_positive_kernel(self):
        self.start(); self.state.update(MainPID='0', ActiveState='inactive', SubState='dead'); self.actor = None
        self.intent('inverse-intent.json'); self.records['inverse-drained.json'] = {}
        self.records['drain-SOURCE-intent.json'] = {}; self.intent('inverse-start-SOURCE-intent.json')
        self.original_actors['SOURCE'] = {'fixtureRestoredActor': True}
        self.assertEqual(m.current(self.owner, self.op)['phase'], 'owned-inverse-terminal')
        self.owner.terminal_backends.assert_not_called()
        self.owner.h.sessions.return_value = {'73004621': {'owned': {'SOURCE': []}}}
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)

    def test_partial_owned_install_locations_are_bookended_and_unknown_intent_refuses(self):
        self.install(); self.records['install-intent.json']['bootId'] = 'foreignBoot'
        with self.assertRaises(RuntimeError):m.current(self.owner, self.op)
        self.records['install-intent.json']['bootId'] = 'fixtureBoot'
        def change(_):
            self.unit.rename(self.hold/'managed-unit.removed'); return {'fixtureNative': True}
        with self.assertRaisesRegex(RuntimeError, 'phase_changed'):m.stable(self.owner, change, self.op)


if __name__ == '__main__':unittest.main()
