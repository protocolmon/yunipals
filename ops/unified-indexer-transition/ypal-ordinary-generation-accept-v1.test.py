#!/usr/bin/env python3
"""Actual acceptance composition; boundary fixtures are not live receipts."""
import ast
import copy
import importlib.util
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE/name); result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result); return result


m = module('ypal-ordinary-generation-accept-v1.py')
terminal_fixture = module('ypal-ordinary-generation-terminal-v1.test.py')


def local_public(path, digest=None, maximum=4000000):
    raw = (HERE/Path(path).name).read_bytes()
    if digest is not None and m.sha(raw) != digest:raise RuntimeError('actual_local_source_pin_required')
    return raw


def local_load(path, digest):
    raw = local_public(path, digest); result = types.ModuleType('fixture_'+Path(path).stem); result.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), result.__dict__)
    if path == m.ATTEMPT:result.public = local_public
    return result


def actual():
    with patch.object(m, 'protected', local_public), patch.object(m, 'load', local_load):return m.prepared_attempt()


class Controls(unittest.TestCase):
    def test_all_166_actual_sources_and_real_immutable_4f_ancestor(self):
        self.assertEqual(len(m.SOURCE_PINS), 166)
        for name, digest in m.SOURCE_PINS.items():self.assertEqual(m.sha((HERE/name).read_bytes()), digest)
        self.assertEqual(m.SOURCE_PINS[m.ATTEMPT.name], m.ATTEMPT_SHA)

    def test_default_inert_and_no_build_cli(self):
        value = subprocess.run(['python3','-I','-B',str(HERE/m.FILE.name)], capture_output=True, check=True)
        self.assertIn(b'"staticOnly": true', value.stdout)
        tree = ast.parse((HERE/m.FILE.name).read_bytes())
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
        phase = [node for node in ast.walk(main) if isinstance(node, ast.keyword) and node.arg == 'choices']
        self.assertEqual(ast.literal_eval(phase[0].value), ['review','accept'])

    def test_new_acceptance_identity_and_pure_actual_build_helpers_are_explicitly_split(self):
        with patch.object(m, 'protected', local_public), patch.object(m, 'load', local_load):
            helpers = m.composition(); self.assertEqual(m.UNIT, 'yunipals-ypal-ordinary-generation-attempt-v2.service')
            self.assertEqual(m.WORK, Path('/run/yunipals-ypal-ordinary-generation-attempt-v2-20261025'))
            self.assertEqual(m.ARTIFACT_MANIFEST_SHA, '4ec5e6012b38bcad0a20816fd71c6eb54bd8137a4e477a396ce1149812109442')
        self.assertEqual(helpers.BASE, m.BUILD_BASE); self.assertNotEqual(m.BASE, helpers.BASE)
        self.assertEqual(helpers.FORMAT, 'yunipals-ypal-ordinary-generation-attempt-v2')
        self.assertFalse(hasattr(helpers, 'build')); self.assertFalse(hasattr(helpers, 'accept'))
        with self.assertRaises(AttributeError):m.__getattr__('build')

    def test_actual_V2_source_DB_capsule_and_success_methods_are_retained(self):
        entry, changed = actual(); original = entry.composition()
        for name in ['successful_worker_evidence','successful_worker','acceptance_review','retained_current','operation','static_legacy_host']:
            a, b = getattr(changed,name), getattr(original,name)
            self.assertEqual((a.__code__.co_code,a.__code__.co_consts),(b.__code__.co_code,b.__code__.co_consts),name)
        self.assertEqual(changed.Host.__init__.__code__.co_code, original.Host.__init__.__code__.co_code)
        self.assertEqual(changed.Host.qualify.__code__.co_code, original.Host.qualify.__code__.co_code)
        self.assertEqual(changed.BASE, m.BUILD_BASE)

    def terminal_body(self):
        entry, attempt = actual(); strict = next(cell.cell_contents for cell in attempt.terminal_worker.__closure__
            if isinstance(cell.cell_contents, types.FunctionType) and cell.cell_contents.__name__ == 'terminal_worker')
        args = terminal_fixture.fixture(); state,start,runtime,started,result = args[:5]
        body = b'actualFixtureUnitBytes'; start['definitionSha256'] = m.sha(body); started['unitSha256'] = m.sha(body)
        proof = terminal_fixture.m.validate(*args)
        captured = {'proof':proof,'state':state,'start':start,'runtime':runtime,'started':started}
        records = {m.BUILD_BASE/(attempt.UNIT+'-start-intent.json'):start, m.BUILD_BASE/(attempt.UNIT+'-started.json'):started,
            m.BUILD_BASE/(attempt.UNIT+'-file-created.json'):{'inode':'fixture'},attempt.WORK/'intent.json':runtime,attempt.WORK/'result.json':result,
            attempt.WORK/'child-process.json':{'artifactDigest':attempt.ARTIFACT,'commandSha256':attempt.sha(attempt.encoded(['node',str(Path('/artifact')/'dist/generation-prepare.mjs')]))}}
        host = types.SimpleNamespace(meta=types.SimpleNamespace(file_identity=lambda _: {'inode':'fixture'},identity_alive=Mock(return_value=False)),
            legacy=types.SimpleNamespace(state=lambda _: copy.deepcopy(state)),m=object(),watch=types.SimpleNamespace(node_args=lambda _:['node'],ARTIFACT=Path('/artifact')))
        replacements = {'document':lambda path,expected=None:copy.deepcopy(records[path]),'protected':lambda *args,**kwargs:body,
                        'empty_application':Mock(),'child_epoch_gone':Mock()}
        with patch.dict(strict.__globals__, replacements), patch.object(m,'protected',local_public):
            changed = m.terminal_function(types.SimpleNamespace(terminal_worker=strict), captured)
        return attempt, strict, changed, host, captured, replacements

    def test_original_strict_fails_actual_cleared_shape_new_body_preserves_real_state_and_all_other_checks(self):
        attempt, strict, changed, host, captured, replacements = self.terminal_body()
        original_exists = Path.exists
        exists = lambda path: True if path == attempt.BASE/(attempt.UNIT+'-started.json') else original_exists(path)
        with patch.object(Path,'exists',exists):
            with patch.dict(strict.__globals__,replacements):
                with self.assertRaisesRegex(RuntimeError,'same_real_worker_invocation'):strict(host,attempt.UNIT,attempt.BASE,attempt.WORK,attempt.APP)
            returned = changed(host,attempt.UNIT,attempt.BASE,attempt.WORK,attempt.APP)
        self.assertEqual(returned[0]['InvocationID'],''); self.assertEqual(returned[0]['ExecMainStartTimestampMonotonic'],'0')
        self.assertEqual(returned[1],captured['runtime']); replacements['empty_application'].assert_called_once()
        replacements['child_epoch_gone'].assert_called_once(); host.meta.identity_alive.assert_called_once()

    def test_changed_actual_state_or_records_refuse_inside_complete_original_terminal_body(self):
        attempt, strict, changed, host, captured, replacements = self.terminal_body()
        host.legacy.state = lambda _: {**captured['state'],'InvocationID':'f'*32}
        with self.assertRaisesRegex(RuntimeError,'same_actual_cleared'):changed(host,attempt.UNIT,attempt.BASE,attempt.WORK,attempt.APP)

    def test_exact_two_terminal_AST_seams_and_no_synthetic_state_write(self):
        source = ast.parse((HERE/m.FILE.name).read_bytes())
        node = next(item for item in source.body if isinstance(item,ast.FunctionDef) and item.name=='terminal_function')
        assignments = [item for item in ast.walk(node) if isinstance(item,ast.Assign)]
        self.assertFalse(any(isinstance(target,ast.Subscript) and ast.unparse(target.value)=='state' for item in assignments for target in item.targets))
        self.assertIn('only_two_invalid_cleared_unit_retention_assumptions_replaced',ast.get_source_segment((HERE/m.FILE.name).read_text(),node))

    def test_candidate_records_use_new_domain_but_actual_old_operation_and_real_Host(self):
        entry, attempt = actual()
        with patch.object(m,'protected',local_public):_, context, _ = m.acceptance_functions(entry,attempt)
        original = next(cell.cell_contents for cell in context.__closure__ if isinstance(cell.cell_contents,types.FunctionType) and cell.cell_contents.__name__=='candidate_context')
        scope = original.__globals__; self.assertEqual(scope['BASE'],m.BASE); self.assertEqual(scope['__file__'],str(m.FILE))
        self.assertEqual(scope['CANDIDATE_FORMAT'],m.CANDIDATE_FORMAT); self.assertIs(scope['Host'],attempt.Host)
        self.assertIs(scope['operation'],attempt.operation)
        calls = []; attempt.document = lambda path,expected=None:calls.append((path,expected))or {'actualFixtureRecord':True}
        scope['document'](m.BASE/'operation.json','a'*64); scope['document'](m.BASE/'accept-intent.json')
        self.assertEqual(calls,[(m.OPERATION,'a'*64),(m.BASE/'accept-intent.json',None)])
        self.assertFalse((m.BASE/'operation.json').exists())

    def test_retained_failed_worker_branch_delegates_genuine_unchanged_strict_body(self):
        entry, attempt = actual(); strict = next(cell.cell_contents for cell in attempt.terminal_worker.__closure__
            if isinstance(cell.cell_contents,types.FunctionType)and cell.cell_contents.__name__=='terminal_worker')
        original = entry.composition().terminal_worker
        self.assertEqual((strict.__code__.co_code,strict.__code__.co_consts),(original.__code__.co_code,original.__code__.co_consts))
        with patch.object(m,'capture_terminal',side_effect=AssertionError('new_success_proof_must_not_touch_failed_domain')):
            with self.assertRaisesRegex(RuntimeError,'exact_old_or_new_worker_domain'):attempt.terminal_worker(object(),'foreign.service',Path('/foreign'),Path('/foreign'),'foreign')

    def test_whole_boot_journal_is_captured_without_tail_limit_and_unit_inode_is_bookended(self):
        text = (HERE/m.FILE.name).read_text(); node = next(item for item in ast.parse(text).body if isinstance(item,ast.FunctionDef)and item.name=='capture_terminal')
        body = ast.get_source_segment(text,node)
        self.assertIn("'UNIT='+attempt.UNIT",body); self.assertIn("'--boot='+terminal.boot(current_boot)",body)
        self.assertNotIn("'--since'",body); self.assertNotIn("'-n'",body); self.assertIn('same_owned_worker_unit_inode_and_bytes',body)


if __name__ == '__main__':unittest.main()
