#!/usr/bin/env python3
"""Authenticated complete restricted-peer FD controls for semantic recovery."""
import hashlib
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "ypal-ordinary-reader-peer-v5.test.py"
TEMPLATE_SHA = "b6aac00367838cb3636836672a99105ae0ca52b99aa2752a1eada7185cc6f83a"
raw = TEMPLATE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == TEMPLATE_SHA
source = raw.decode()
for name in ["ypal-ordinary-reader-peer", "ypal-ordinary-reader-sql", "ypal-ordinary-reader-probe", "ypal-ordinary-reader-wire"]:
    source = source.replace(name + "-v5", name + "-bound-v1")
namespace = types.ModuleType("actual_semantic_reader_peer_controls")
namespace.__file__ = str(Path(__file__).absolute())
exec(compile(source, namespace.__file__, "exec"), namespace.__dict__)
original_setup = namespace.Controls.setUp


def setup(self):
    spec = importlib.util.spec_from_file_location("local_actual_binding_helper", HERE / "ypal-ordinary-generation-binding-v1.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    def public(path, expected=None, maximum=200000):
        raw = (HERE / Path(path).name).read_bytes()
        helper.need(len(raw) <= maximum and (expected is None or helper.sha(raw) == expected), "actual_local_semantic_peer_template_required")
        return raw
    self.enterContext(patch.object(helper, "public", side_effect=public))
    self.enterContext(patch.object(namespace.m, "helper", return_value=helper))
    original_setup(self)


namespace.Controls.setUp = setup
Controls = namespace.Controls


if __name__ == "__main__":
    unittest.main(verbosity=2)
