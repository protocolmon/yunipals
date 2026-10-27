#!/usr/bin/env python3
"""Credential installer admission/exclusive-copy controls; no host or runtime build."""
import ast
import copy
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
ROOT = HERE.parents[1]


def module(name):
    path = HERE / (name + '.py')
    value = types.ModuleType(name)
    value.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), value.__dict__)
    return value


m = module('arena-credential-install-v2')
builder = module('arena-credential-package-v2')


class Fixture:
    def __init__(self, directory):
        self.root = Path(directory)
        self.work = self.root / 'work'
        self.ops = self.root / 'ops'
        self.releases = self.root / 'releases'
        for path in [self.work, self.ops, self.releases]:
            path.mkdir()
        (self.work / 'runtime-a').mkdir()
        self.target = self.releases / m.SOURCE
        self.artifact = self.root / 'new-artifact'
        self.archive = self.work / 'runtime-a/runtime-supplement.tar.gz'
        self.archive.write_bytes(b'synthetic-runtime-archive')
        self.inventory = {
            'sourceDigest': m.SOURCE,
            'sourceManifestSha256': m.MANIFEST_SHA,
            'archiveSha256': m.sha(self.archive.read_bytes())
        }
        inventory_file = self.work / 'runtime-a/runtime-supplement.inventory.json'
        inventory_file.write_bytes(m.encoded(self.inventory))
        self.proof = {
            'format': builder.FORMAT,
            'status': 'passed',
            'reviewHash': m.BUILD_REVIEW,
            'sourceDigest': m.SOURCE,
            'source': {
                'manifestSha256': m.MANIFEST_SHA,
                'files': 1748,
                'exactPatchedSources': m.PATCHES,
                'baseSourceDigest': builder.BASE_DIGEST,
                'baseBuildProofSha256': builder.BASE_EVIDENCE_SHA
            },
            'verification': {
                'twoFullTypechecks': True,
                'ordinaryMarketBuilds': 2,
                'targetedCredentialReaderSuites': 2,
                'bundleCount': 34,
                'dependencyPackages': 330,
                'nativePonderBuildPerformed': False
            },
            'runtime': {
                'separateRelocatedTreeRebuildByteIdentical': True,
                'entries': 60918,
                'inventorySha256': m.sha(inventory_file.read_bytes()),
                'archiveSha256': self.inventory['archiveSha256']
            },
            'nativeUnits': {'unitsInstalledOrStarted': False, 'files': {str(i): 'synthetic' for i in range(8)}}
        }
        self.steps = [{'name': name, 'exitCode': 0} for name in ['credential-reader-controls', 'relocated-credential-reader-controls']]
        self.manifest = {'files': [{'path': 'fixture/' + str(i)} for i in range(1748)]}
        self.state = 'ActiveState=inactive\nMainPID=0\nResult=success\nExecMainStatus=0\n'
        self.free = 30_000_000_000
        self.write()

    def write(self):
        self.proof_file = self.work / 'arena-consumer-package-proof.json'
        self.proof_file.write_bytes(m.encoded(self.proof))
        self.pin = m.sha(self.proof_file.read_bytes())
        receipt = {'status': 'passed', 'proofSha256': self.pin}
        (self.work / 'attempt-result.json').write_bytes(m.encoded({**receipt, 'steps': self.steps}))
        (self.ops / 'actual-build.stdout.json').write_bytes(m.encoded(receipt))

    @staticmethod
    def pinned(path, pin, limit=100000):
        raw = Path(path).read_bytes()
        if len(raw) > limit or m.sha(raw) != pin:
            raise RuntimeError('fixture_pin_changed')
        return raw

    def review(self):
        primitives = types.SimpleNamespace(
            pinned=self.pinned,
            trusted=lambda path, limit: Path(path).read_bytes(),
            checked_file_hash=lambda path, pin, limit: None if path == Path(builder.NODE) else self.pinned(path, pin, limit)
        )
        helper = types.SimpleNamespace(source_check=lambda path, pin: self.manifest)
        with patch.multiple(m, OPS=self.ops, WORK=self.work, TARGET=self.target, ARTIFACT=self.artifact, PROOF=self.proof_file), \
             patch.object(m, 'modules', return_value=(builder, primitives, helper)), \
             patch.object(m.subprocess, 'run', return_value=types.SimpleNamespace(stdout=self.state)) as command, \
             patch.object(m.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=self.free)):
            result = m.review(self.pin)
        assert command.call_args.args[0][2] == 'yunipals-arena-credential-package-v2-build-20261022.service'
        return result


class Tests(unittest.TestCase):
    def fixture(self):
        directory = tempfile.TemporaryDirectory(dir=HERE)
        self.addCleanup(directory.cleanup)
        return Fixture(directory.name)

    def test_exact_candidate_builder_and_public_patch_pins(self):
        inputs = json.loads((HERE / 'arena-credential-package-v2.inputs.json').read_bytes())
        candidate = inputs['candidate']
        self.assertEqual(m.SOURCE, candidate['sourceDigest'])
        self.assertEqual(m.MANIFEST_SHA, candidate['manifestSha256'])
        self.assertEqual(m.BUILD_REVIEW, '4782a418113b72a5fb4d7428d6a3c99c480b0d394a1a10d3883106e914988dfa')
        self.assertEqual(m.PACKAGE_SHA, m.sha((HERE / 'arena-credential-package-v2.py').read_bytes()))
        self.assertEqual(m.PATCHES, builder.PATCHES)
        for name, pin in m.PATCHES.items():
            self.assertEqual(m.sha((ROOT / name).read_bytes()), pin)
        self.assertEqual(str(m.ARTIFACT), '/var/tmp/yunipals-runtime-110c622a-20261022')

    def test_install_and_main_preserve_original_exclusive_no_overwrite_behavior(self):
        old = ast.parse((HERE / 'arena-consumer-install-v1.py').read_bytes())
        new = ast.parse((HERE / 'arena-credential-install-v2.py').read_bytes())
        for name in ['save', 'install', 'main']:
            functions = [next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name) for tree in [old, new]]
            self.assertEqual(ast.dump(functions[0]), ast.dump(functions[1]))

    def test_completed_review_has_two_reader_acks_and_does_not_create_destinations(self):
        f = self.fixture()
        value = f.review()[0]
        self.assertEqual(value['sourceDigest'], m.SOURCE)
        self.assertEqual(value['proofSha256'], f.pin)
        self.assertEqual(value['serviceChanges'], 0)
        self.assertEqual(value['databaseChanges'], 0)
        self.assertFalse(f.target.exists())
        self.assertFalse(f.artifact.exists())

    def test_wrong_reader_count_patch_hash_base_or_manifest_is_rejected(self):
        f = self.fixture()
        original = copy.deepcopy(f.proof)
        changes = [
            ('verification', 'targetedCredentialReaderSuites', 1),
            ('verification', 'ordinaryMarketBuilds', 1),
            ('source', 'files', 1746),
            ('source', 'manifestSha256', '0' * 64),
            ('source', 'baseSourceDigest', '0' * 64),
            ('source', 'exactPatchedSources', {**m.PATCHES, next(iter(m.PATCHES)): '0' * 64})
        ]
        for section, key, value in changes:
            with self.subTest(section=section, key=key):
                f.proof = copy.deepcopy(original)
                f.proof[section][key] = value
                f.write()
                with self.assertRaisesRegex(RuntimeError, 'accepted_completed_consumer_build_required'):
                    f.review()

    def test_reader_marker_cannot_replace_two_distinct_successful_step_receipts(self):
        f = self.fixture()
        original = copy.deepcopy(f.steps)
        for steps in [[], original[:1], [original[0], original[0]], [original[0], {**original[1], 'exitCode': 1}]]:
            with self.subTest(steps=steps):
                f.steps = steps
                f.write()
                with self.assertRaisesRegex(RuntimeError, 'two_actual_credential_reader_suites_required'):
                    f.review()

    def test_missing_terminal_output_or_mismatched_ack_is_rejected(self):
        f = self.fixture()
        output = f.ops / 'actual-build.stdout.json'
        output.unlink()
        with self.assertRaises(FileNotFoundError):
            f.review()
        f.write()
        output.write_bytes(m.encoded({'status': 'passed', 'proofSha256': '0' * 64}))
        with self.assertRaisesRegex(RuntimeError, 'accepted_completed_consumer_build_required'):
            f.review()

    def test_build_must_be_successfully_terminal_before_install_review(self):
        f = self.fixture()
        for state in ['ActiveState=activating\nMainPID=123\nResult=success\nExecMainStatus=0\n', 'ActiveState=inactive\nMainPID=0\nResult=exit-code\nExecMainStatus=1\n']:
            f.state = state
            with self.assertRaisesRegex(RuntimeError, 'successful_stopped_offline_build_required'):
                f.review()

    def test_existing_target_artifact_or_dangling_link_is_never_overwritten(self):
        f = self.fixture()
        for path, link in [(f.target, False), (f.artifact, False), (f.target, True), (f.artifact, True)]:
            if link:
                path.symlink_to(f.root / 'absent')
            else:
                path.mkdir()
            try:
                with self.assertRaisesRegex(RuntimeError, 'fresh_consumer_artifact_destinations_required'):
                    f.review()
            finally:
                path.unlink() if link else path.rmdir()

    def test_runtime_and_source_inventory_binding_still_required(self):
        f = self.fixture()
        f.manifest['files'].pop()
        with self.assertRaisesRegex(RuntimeError, 'exact_consumer_source_inventory_required'):
            f.review()
        f.manifest['files'].append({'path': 'restored'})
        inventory_file = f.work / 'runtime-a/runtime-supplement.inventory.json'
        inventory_file.write_bytes(m.encoded({**f.inventory, 'sourceDigest': '0' * 64}))
        f.proof['runtime']['inventorySha256'] = m.sha(inventory_file.read_bytes())
        f.write()
        with self.assertRaisesRegex(RuntimeError, 'exact_consumer_runtime_binding_required'):
            f.review()

    def test_disk_reserve_is_preserved_before_any_copy(self):
        f = self.fixture()
        f.free = 26_999_999_999
        with self.assertRaisesRegex(RuntimeError, 'consumer_install_reserve_required'):
            f.review()
        self.assertFalse(f.target.exists())
        self.assertFalse(f.artifact.exists())


if __name__ == '__main__':
    unittest.main()
