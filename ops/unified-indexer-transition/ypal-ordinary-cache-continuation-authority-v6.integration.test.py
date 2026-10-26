#!/usr/bin/env python3
"""Real Context6/Context2 catalog seam; all private records/PG/process data are I/O fixtures."""
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, tag):
    spec = importlib.util.spec_from_file_location(tag, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


a_tests = load("ypal-native-readiness-context-v2.test.py", "actual_context2_integration_fixture")
c_tests = load("ypal-ordinary-cache-continuation-authority-v6.test.py", "actual_authority6_integration_fixture")


class Controls(unittest.TestCase):
    def test_real_contexts_and_original_catalog_positive_plus_four_strict_refusals(self):
        a = a_tests.Controls()
        a.setUp()
        self.addCleanup(lambda: self.assertTrue(a.doCleanups()))
        c = c_tests.Controls()
        c.setUp()
        self.addCleanup(lambda: self.assertTrue(c.doCleanups()))

        # Render an actual-shape protected-input I/O fixture before constructing
        # a fresh genuine authority Context. Its real native policy is supplied
        # by Context2's review/rehearse/apply fixture, not an invented live ACK.
        c.refs = copy.deepcopy(a.refs)
        c.config = {"format": c_tests.m.FORMAT + "-input", "nativePolicyRefs": c.refs}
        c.input_raw = c_tests.m.encoded(c.config)
        c.input_sha = c_tests.m.sha(c.input_raw)
        c.wrapper = c_tests.family.source(c_tests.m.FORWARD)
        c.wrapper.public = c_tests.family.public
        c.wrapper.factory = lambda: c_tests.family.compiler
        with patch.object(c_tests.m, "policy_module", return_value=a.ctx.policy):
            context = c_tests.m.Context(c.input_sha)
        value = context.bind_readiness(a.ctx)

        before = a.catalog()
        after = a.ctx.expected_catalog(before)
        columns = before["allColumnAcl"]
        historical = {
            "catalog": {
                "catalogSha256": "unchanged-cache-only-hash-fixture",
                "postProof": {
                    "catalog": before["read"],
                    "allColumnAcl": copy.deepcopy(columns)
                }
            }
        }
        current = {
            "catalogSha256": "unchanged-cache-only-hash-fixture",
            "postProof": {
                "catalog": after["read"],
                "allColumnAcl": copy.deepcopy(columns)
            }
        }
        cache = types.SimpleNamespace(
            owned=lambda host: (historical, {"immutableRehearsal": "I/O fixture"}),
            _sql_child=lambda host, mode: current
        )
        host = types.SimpleNamespace(read=types.SimpleNamespace(acl_catalog=lambda catalog: catalog))
        prior = lambda cache, host: {"binding": {"actualPriorAbortedIOFixture": True}}

        # The real C413 original_catalog body runs, with only its authenticated
        # expected operand supplied by the genuine Context2 method. Prior
        # process/receipt and inspector replies are explicit I/O fixtures.
        with patch.dict(value.original_catalog.__globals__, {"prior_aborted": prior}):
            self.assertIs(value.original_catalog(cache, host)[1], current)
            changes = {
                "old actual function body": lambda: current["postProof"]["catalog"]["functions"][0].update(
                    definitionMd5=a.ack["beforeFunctionDefinitionMd5"]
                ),
                "cache catalog hash": lambda: current.update(catalogSha256="foreign"),
                "column ACL": lambda: current["postProof"]["allColumnAcl"].append({"foreign": "column"}),
                "role": lambda: current["postProof"]["catalog"]["roles"][0].update(login=True)
            }
            for label, change in changes.items():
                original = copy.deepcopy(current)
                try:
                    with self.subTest(label=label):
                        change()
                        with self.assertRaisesRegex(RuntimeError, "complete_original_cache_catalog"):
                            value.original_catalog(cache, host)
                finally:
                    current.clear()
                    current.update(original)


if __name__ == "__main__":
    unittest.main()
