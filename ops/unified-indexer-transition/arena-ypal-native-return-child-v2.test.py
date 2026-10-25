#!/usr/bin/env python3
"""Real local root-memfd wire checks; no database or service construction."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('actual_retained_sealed_authority',HERE/'arena-ypal-restored-v1.py')
seals=importlib.util.module_from_spec(spec);spec.loader.exec_module(seals)
sha=lambda raw:hashlib.sha256(raw).hexdigest()
CHILD_SHA=sha((HERE/'arena-ypal-native-return-child-v2.mjs').read_bytes())
SCRIPT="""import{readFileSync}from'node:fs';
import{composition}from'./ops/unified-indexer-transition/arena-ypal-native-return-child-v2.mjs';
const r=(name)=>readFileSync('./ops/unified-indexer-transition/'+name);
const n=await composition(r('arena-ypal-native-return-child-v1.mjs'),r('arena-ypal-business-inverse-child-v2.mjs'),r('arena-ypal-business-inverse-child-v1.mjs'),r('arena-modern-public-rollback-v1.mjs'));
n.authority(Number(process.argv[1]),'inspect',Buffer.from('synthetic-native-return-payload'),process.argv[2]);
"""


class Controls(unittest.TestCase):
    def packet(self):
        return{'format':'yunipals-arena-ypal-native-return-authority-v2','action':'inspect',
            'payloadSha256':sha(b'synthetic-native-return-payload'),'childSha256':CHILD_SHA}
    def run_child(self,fd):
        return subprocess.run(['/root/.nvm/versions/node/v24.18.1/bin/node','--input-type=module','-e',SCRIPT,str(fd),CHILD_SHA],
            cwd=HERE.parent.parent,pass_fds=(fd,),capture_output=True,timeout=10)
    def check_packet(self,packet,accepted):
        fd=seals.sealed('arena-public-root-authority',json.dumps(packet).encode())
        try:
            value=self.run_child(fd);self.assertEqual(value.returncode==0,accepted,value.stderr.decode())
        finally:os.close(fd)
    def test_actual_new_wire_and_root_sealed_descriptor_accept(self):
        self.check_packet(self.packet(),True)
    def test_old_wire_foreign_child_action_and_payload_refuse(self):
        for change in[{'format':'yunipals-arena-ypal-native-return-authority-v1'},
            {'childSha256':'d543fef4204dc4c5c16f9daa9c0f49f3c79f8e4045b4dcdd07225ba69516994b'},
            {'action':'switch'},{'payloadSha256':'b'*64}]:
            with self.subTest(change=change):self.check_packet({**self.packet(),**change},False)
    def test_regular_private_file_cannot_substitute_for_sealed_root_authority(self):
        with tempfile.TemporaryFile()as value:
            value.write(json.dumps(self.packet()).encode());value.flush();value.seek(0)
            self.assertNotEqual(self.run_child(value.fileno()).returncode,0)


if __name__=='__main__':unittest.main()
