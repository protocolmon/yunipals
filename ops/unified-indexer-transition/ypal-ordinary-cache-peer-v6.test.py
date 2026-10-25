#!/usr/bin/env python3
"""Authenticated cache FD refusal/cross-UID tests against the V6 closure."""
import hashlib
from pathlib import Path
import types
import unittest

HERE = Path(__file__).parent.resolve()
TEMPLATE = HERE / 'ypal-restored-cache-peer-runtime-v1.test.py'
raw = TEMPLATE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '0f1e186dfd46dad1b83f1be17489c3ffe072da066c316ca6aeae9c4b64dc7c00'
text = raw.decode().replace('ypal-restored-cache-peer-runtime-v1.py',
                          'ypal-ordinary-cache-peer-v6.py').replace(
    'ypal-restored-cache-sql-v1.mjs', 'ypal-ordinary-cache-sql-v6.mjs'
)
namespace = types.ModuleType('separate_V6_cache_transport_controls')
namespace.__file__ = str(Path(__file__).absolute())
exec(compile(text, namespace.__file__, 'exec'), namespace.__dict__)
Controls = namespace.Controls


if __name__ == '__main__':
    unittest.main()
