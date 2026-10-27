"""Actual artifact and durable local filesystem controls; no live installs."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v
i=load('ypal-native-metadata-approval-install-v1.py');old=load('metadata-normalization-runtime-install-v1.py')
ARTIFACT=Path('/tmp/ypal-native-metadata-approval-runtime-v1-20261025')
def local(path,digest):
    raw=(HERE/Path(path).name).read_bytes();i.need(i.sha(raw)==digest,'exact_actual_installer_fixture_source_required');return raw


class Controls(unittest.TestCase):
    def primitive(self):
        def protected(path,maximum=4000000):
            raw=Path(path).read_bytes();self.assertLessEqual(len(raw),maximum);return raw
        def document(path,digest=None):
            raw=protected(path)
            if digest is not None:self.assertEqual(i.sha(raw),digest)
            return json.loads(raw)
        def write(path,raw,mode=0o600):
            fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,mode)
            with os.fdopen(fd,'wb')as out:out.write(raw)
        return types.SimpleNamespace(document=document,protected=protected,sha=i.sha,
            encoded=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode(),
            write_new=write,sync_directory=lambda _:None)

    def composed(self):
        with patch.object(i,'public',side_effect=local):return i.composition()

    def test_all_actual_7489_payload_bytes_and_frozen_dependency_install_functions(self):
        previous,value=self.composed();manifest,files=i.payload(self.primitive(),ARTIFACT)
        self.assertEqual(manifest['artifactDigest'],i.DIGEST);self.assertEqual(len(files),8)
        for name in ['directory','dependencies','install','installed']:
            actual,expected=getattr(value,name).__code__,getattr(old,name).__code__
            self.assertEqual((actual.co_code,actual.co_consts),(expected.co_code,expected.co_consts),name)
        self.assertEqual(value.BASE,i.BASE);self.assertEqual(value.TARGET,i.TARGET);self.assertEqual(value.FORMAT,i.FORMAT)

    def test_durable_actual_local_install_preserves_predecessor_and_authenticates_receipt(self):
        previous,value=self.composed();m=self.primitive()
        with tempfile.TemporaryDirectory(dir=HERE,prefix='approval-install-fixture-')as folder:
            root=Path(folder);(root/'backups').mkdir();(root/'releases').mkdir();deps=root/'dependencies';deps.mkdir()
            value.BASE=root/'backups'/'new';value.TARGET=root/'releases'/i.DIGEST;value.INCOMING=ARTIFACT
            dependency_target=json.loads((ARTIFACT/'manifest.json').read_bytes())['requiredRuntimeDependencyTarget']
            expected={'target':dependency_target,'fixtureAcknowledgedOriginalDependencies':True};value.dependencies=Mock(return_value=expected)
            prior=types.SimpleNamespace(installed=Mock(return_value={'target':'/fixture/immutable-cf333'}))
            with patch.object(i,'composition',return_value=(prior,value)):
                result,files=i.prepare(m,'a'*64);self.assertEqual(result['predecessorNormalizationInstallSha256'],'a'*64)
                receipt=value.install(m,result,files);observed=i.installed(m,receipt)
                self.assertEqual(observed['artifactDigest'],i.DIGEST);self.assertFalse(observed['runtimeCadenceQualified'])
                self.assertTrue(observed['newMetadataEpochRequired']);self.assertEqual(os.readlink(value.TARGET/'node_modules'),dependency_target)
                self.assertEqual({p.name for p in value.TARGET.iterdir()},{'dist','manifest.json','metafile.json','node_modules'})
                self.assertEqual((value.BASE/'result.json').stat().st_mode&0o777,0o600)
                with self.assertRaisesRegex(RuntimeError,'fresh_nonmarket_artifact'):value.install(m,result,files)
                changed=value.TARGET/'dist/metadata-worker.mjs';changed.write_bytes(changed.read_bytes()+b'\n')
                with self.assertRaises(RuntimeError):i.installed(m,receipt)

    def test_predecessor_install_and_output_manifest_cannot_be_invented(self):
        previous,value=self.composed();m=self.primitive()
        with patch.object(i,'composition',return_value=(types.SimpleNamespace(installed=Mock(side_effect=RuntimeError('old_ACK_changed'))),value)):
            with self.assertRaisesRegex(RuntimeError,'old_ACK_changed'):i.prepare(m,'a'*64)
        for ref in [None,'future','0'*64]:
            with self.subTest(ref=ref),self.assertRaisesRegex(RuntimeError,'existing_normalization_install_ACK'):i.prepare(m,ref)
        read=m.document;m.document=lambda path,digest=None:{**read(path,digest),'approvalValiditySeconds':900}
        with self.assertRaisesRegex(RuntimeError,'sixty_ninety_second_gates'):i.payload(m,ARTIFACT)

    def test_default_CLI_is_inert(self):
        p=subprocess.run([sys.executable,'-I','-B',str(HERE/i.FILE.name)],capture_output=True,text=True,check=True)
        self.assertTrue(json.loads(p.stdout)['staticOnly']);self.assertFalse(p.stderr)


if __name__=='__main__':unittest.main()
