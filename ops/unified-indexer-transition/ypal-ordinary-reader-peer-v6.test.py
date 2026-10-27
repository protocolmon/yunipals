#!/usr/bin/env python3
"""Run the authenticated complete V5 FD test body against the V6 closure.

Only the three versioned public file identities and peer module change. Tests
still execute real restricted UID111/967 children, immutable sealed descriptors,
entry self-authentication and source/path refusal, with all network denied.
"""
import hashlib
from pathlib import Path
import types
import unittest

HERE = Path(__file__).parent.resolve()
TEMPLATE = HERE / 'ypal-ordinary-reader-peer-v5.test.py'
TEMPLATE_SHA = 'b6aac00367838cb3636836672a99105ae0ca52b99aa2752a1eada7185cc6f83a'
raw = TEMPLATE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == TEMPLATE_SHA
text = raw.decode()
for name in ['ypal-ordinary-reader-peer', 'ypal-ordinary-reader-sql',
             'ypal-ordinary-reader-probe', 'ypal-ordinary-reader-wire']:
    text = text.replace(name + '-v5', name + '-v6')
namespace = types.ModuleType('separate_V6_reader_transport_controls')
namespace.__file__ = str(Path(__file__).absolute())
exec(compile(text, namespace.__file__, 'exec'), namespace.__dict__)
Controls = namespace.Controls


if __name__ == '__main__':
    unittest.main()
