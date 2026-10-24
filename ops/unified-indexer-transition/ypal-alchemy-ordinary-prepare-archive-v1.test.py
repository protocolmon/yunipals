import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
m = load("ypal-alchemy-ordinary-prepare-archive-v1.py")
p = load("ypal-alchemy-source-switch-v1.plan.py")


class Controls(unittest.TestCase):
    def fixture(self, root):
        root = Path(root); stage = root / "stage"; oldbase = root / "old-audit"; hold = root / "hold"
        for path in [stage, oldbase, hold]: path.mkdir(mode=0o700)
        chains = ("ethereum", "base", "polygon", "bnb")
        module = types.SimpleNamespace(BASE=oldbase, HOLD=hold, DROP=root / "system/source.conf", CHAINS=chains,
            source_bytes=lambda *args: b"source-definition")
        plan = types.SimpleNamespace(**p.__dict__); plan.STAGE = stage; plan.CHAINS = chains; plan.proxy_environment = lambda c: (c + "-env").encode()
        owner = types.SimpleNamespace(p=plan, config={"financialReceiptSha256": m.FINANCIAL_SHA}, original={},
            m=types.SimpleNamespace(boot=lambda: "boot"), financial_current=lambda: None,
            old=types.SimpleNamespace(owner=types.SimpleNamespace(known_source_processes=lambda: []),
                h=types.SimpleNamespace(free_route=lambda c: {"free": c})), peers=lambda: {"peers": "same"},
            h=types.SimpleNamespace(source=types.SimpleNamespace(state=lambda _: {"MainPID": "0", "ControlPID": "0", "ActiveState": "inactive"}),
                source_sessions=lambda _: None, proxy_drop=lambda c: root / "system" / (c + ".conf")),
            source_environment=lambda: b"source-env", proxy_drop=lambda c: (c + "-definition").encode(),
            static=lambda: {"schemaOid": "75963410", "tables": {"one": 1}, "cache": {"oid": 1},
                "checkpoints": {"one": "same"}, "app": {"build_id": "71e2a7f3b7"}})
        for name in ["source", *chains]:
            p.exclusive(hold / (name + ".conf"), module.source_bytes() if name == "source" else owner.proxy_drop(name), 0o644)
            p.exclusive(stage / (name + ".ordinary.public.env"), owner.source_environment() if name == "source" else plan.proxy_environment(name), 0o644)
        return module, owner

    def test_actual_filesystem_archive_preserves_ten_inodes_and_op_absence(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "archive-audit"):
            module, owner = self.fixture(root); before = m.capture(module, owner)
            result = m.archive(module, owner, m.sha(m.encoded(before)))
            self.assertTrue(result["archived"]); self.assertFalse(module.BASE.exists()); self.assertFalse(module.HOLD.exists())
            self.assertFalse(result["freshPrepareExecuted"]); self.assertEqual(result["serviceActions"], 0)
            for old, item in before["publicEnvironment"].items():
                actual = p.identity(Path(before["environmentArchive"]) / Path(old).name)
                self.assertEqual(actual["st_ino"], item["identity"]["st_ino"])
            archived_hold = Path(before["directoryTargets"][str(module.HOLD)])
            for old, item in before["definitions"].items():
                self.assertEqual(p.identity(archived_hold / Path(old).name)["st_ino"], item["identity"]["st_ino"])

    def test_refuses_foreign_file_or_operation_before_any_archive_write(self):
        for target in ["operation", "definition", "environment"]:
            with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "archive-audit"):
                module, owner = self.fixture(root)
                if target == "operation": (module.BASE / "operation.json").write_text("foreign")
                elif target == "definition": (module.HOLD / "source.conf").write_text("foreign")
                else: (owner.p.STAGE / "source.ordinary.public.env").chmod(0o600)
                with self.assertRaises(RuntimeError): m.capture(module, owner)
                self.assertFalse(m.BASE.exists())

    def test_no_replace_directory_race_preserves_source_and_foreign_target(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root:
            source, target = Path(root) / "source", Path(root) / "target"
            source.mkdir(mode=0o700); expected = p.identity(source); target.mkdir(mode=0o700)
            with patch.object(m.os.path, "lexists", lambda _: False):
                with self.assertRaises(OSError): m.rename_directory(types.SimpleNamespace(p=p), source, target, expected)
            self.assertTrue(source.exists()); self.assertTrue(target.exists())

    def test_current_peer_change_refuses_review_and_preserves_all_partial_files(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "archive-audit"):
            module, owner = self.fixture(root); values = iter([{"epoch": 1}, {"epoch": 2}]); owner.peers = lambda: next(values)
            with self.assertRaisesRegex(RuntimeError, "same_source_terminal"): m.capture(module, owner)
            self.assertEqual(len(list(module.HOLD.iterdir())), 5); self.assertFalse(m.BASE.exists())

    def test_unknown_archive_intent_never_retries(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "archive-audit"):
            module, owner = self.fixture(root); m.BASE.mkdir(mode=0o700); p.exclusive(m.BASE / "intent.json", b"{}")
            with self.assertRaisesRegex(RuntimeError, "no_unknown_retry"): m.capture(module, owner)


if __name__ == "__main__": unittest.main()
