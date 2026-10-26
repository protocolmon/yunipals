"""Actual pipe/process lifetimes; no database or privileged worker effects."""
import json
import ast
import hashlib
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


SOURCE = Path(__file__).with_name("configure-readers.mjs").resolve()


class Transport(unittest.TestCase):
    def test_catalog_is_exact_actual_python_AST_enhancement_with_both_schemas(self):
        legacy = SOURCE.parent.parent / "unified-indexer-transition"
        raw = (legacy / "ypal-ordinary-read-admission-v5b.py").read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), "a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3")
        tree = ast.parse(raw)
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "enhanced_catalog")
        def need(value, code):
            if not value:
                raise RuntimeError(code)
        scope = {"need": need, "OLD_READ": "yunipals_ownership_4e77f52b_v4", "READ": "yunipals_ownership_4e77f52b_v5"}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(legacy / "ypal-ordinary-read-admission-v5b.py"), "exec"), scope)
        sql = (legacy / "ypal-combined-read-admission-v1.catalog.sql").read_text()
        cases = [sql, sql.replace("'yunipals_ownership_4e77f52b_v4'", "'foreign'", 1), sql.replace("has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')END", "FALSE END")]
        expected = []
        for value in cases:
            try:
                expected.append({"value": scope["enhanced_catalog"](value)})
            except RuntimeError:
                expected.append({"refused": True})
        code = (
            "import {enhancedCatalog} from " + json.dumps(SOURCE.as_uri()) + ";"
            "let text='';for await(const part of process.stdin)text+=part;"
            "console.log(JSON.stringify(JSON.parse(text).map(raw=>{try{return{value:enhancedCatalog(raw)}}catch{return{refused:true}}})));"
        )
        result = subprocess.run(["node", "--input-type=module", "-e", code], input=json.dumps(cases), capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), expected)
        self.assertIn("'yunipals_ownership_4e77f52b_v4','yunipals_ownership_4e77f52b_v5'", expected[0]["value"])
        self.assertIn("has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')", expected[0]["value"])

    def test_worker_initialization_error_exits_with_parent_input_still_open(self):
        code = (
            "import {worker} from " + json.dumps(SOURCE.as_uri()) + ";"
            "process.getuid=()=>111;process.getgid=()=>113;"
            "worker().catch(error=>{console.error(error.message);process.exitCode=1});"
        )
        child = subprocess.Popen(
            ["node", "--input-type=module", "-e", code],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        try:
            child.stdin.write(json.dumps({"action": "invalid-initial-request"}) + "\n")
            child.stdin.flush()
            self.assertEqual(child.wait(timeout=3), 1)
            self.assertTrue(child.stderr.read())
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=3)

    def run_collector(self, python_child, journal):
        code = (
            "import {spawn} from 'node:child_process';"
            "import {collectChild} from " + json.dumps(SOURCE.as_uri()) + ";"
            "const child=spawn('/usr/bin/python3',['-c'," + json.dumps(python_child) + "]);"
            "try{await collectChild(child,{action:'plan',input:{},databaseUrl:'private-fixture',"
            "journal:" + json.dumps(str(journal)) + ",timeoutMilliseconds:3000});"
            "console.log('returned')}catch(error){console.log('refused')}"
        )
        return subprocess.run(
            ["node", "--input-type=module", "-e", code],
            capture_output=True, text=True, timeout=5,
        )

    def test_result_closes_actual_child_input_and_allows_EOF_exit(self):
        with tempfile.TemporaryDirectory() as raw:
            journal = Path(raw)
            child = (
                "import json,sys;sys.stdin.readline();"
                "print(json.dumps({'event':'result','value':{'format':'plan-fixture'}}),flush=True);"
                "sys.stdin.read()"
            )
            result = self.run_collector(child, journal)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "returned")
            self.assertEqual(json.loads((journal / "plan.json").read_text()), {"format": "plan-fixture"})

    def test_initialization_stderr_is_reported_without_global_timeout(self):
        with tempfile.TemporaryDirectory() as raw:
            journal = Path(raw)
            child = (
                "import sys,time;sys.stdin.readline();"
                "print('EACCES explicit private initialization fixture',file=sys.stderr,flush=True);"
                "time.sleep(60)"
            )
            started = time.monotonic()
            result = self.run_collector(child, journal)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "refused")
            self.assertLess(time.monotonic() - started, 3)
            failure = json.loads((journal / "failure.json").read_text())
            self.assertIn("EACCES", failure["stderr"])
            self.assertFalse(failure["automaticRetryAllowed"])


if __name__ == "__main__":
    unittest.main()
