#!/usr/bin/env python3
"""Local public-source/FS controls only; no production or external network."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name('ypal-restored-managed-host-preparation-v1.py')
spec=importlib.util.spec_from_file_location('tested_inactive_managed_preparation',PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
REPO=PATH.parents[2]


class Pure(unittest.TestCase):
    def test_default_static_has_no_host_network_or_future_authority(self):
        value=subprocess.run([sys.executable,'-I','-B',str(PATH)],capture_output=True,check=True)
        result=json.loads(value.stdout)
        self.assertTrue(result['sourceOnly']);self.assertEqual(result['publicCommit'],m.COMMIT)
        self.assertEqual((result['databaseWrites'],result['serviceActions'],result['providerCalls']),(0,0,0));self.assertEqual(value.stderr,b'')

    def test_exact_public_plan_closes_all_local_bytes_and_only_public_modes(self):
        raw=PATH.with_suffix('.files.json').read_bytes();self.assertEqual(m.sha(raw),m.PLAN_SHA)
        plan=m.validate_plan(json.loads(raw));self.assertEqual(sum(r['bytes']for r in plan['files']),1925797)
        self.assertEqual(sum(r['existingOnly']for r in plan['files']),11)
        for row in plan['files']:
            data=(REPO/row['source']).read_bytes();self.assertEqual((len(data),m.sha(data)),(row['bytes'],row['sha256']))
        bad=copy.deepcopy(plan);bad['files'][0]['target']='../secret'
        with self.assertRaises(RuntimeError):m.validate_plan(bad)
        bad=copy.deepcopy(plan);bad['files'][0]['mode']=0o666
        with self.assertRaises(RuntimeError):m.validate_plan(bad)

    def test_GitHub_preserves_default_proxy_TLS_and_refuses_other_commits_or_redirects(self):
        calls=[]
        class Response:
            status=200;headers={'Content-Length':'4'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def geturl(self):return calls[-1]
            def read(self,n):return b'code'
        class Opener:
            def open(self,request,timeout):calls.append(request.full_url);return Response()
        def build(*handlers):
            self.assertEqual(len(handlers),1);self.assertIsInstance(handlers[0],m.NoRedirect)
            self.assertFalse(any(isinstance(v,m.urllib.request.ProxyHandler)for v in handlers))
            return Opener()
        url='https://raw.githubusercontent.com/'+m.REPOSITORY+'/'+m.COMMIT+'/ops/unified-indexer-transition/a.py'
        with patch.object(m.urllib.request,'build_opener',build):self.assertEqual(m.public_get(url,4),b'code')
        with self.assertRaises(RuntimeError):m.public_get(url.replace(m.COMMIT,'a'*40),4)
        with self.assertRaises(RuntimeError):m.NoRedirect().redirect_request(None,None,None,None,None,None)
        self.assertEqual(len(calls),1)

    def test_public_response_size_refuses_before_overlimit_download(self):
        class Response:
            status=200;headers={'Content-Length':'1000'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def geturl(self):return 'https://api.github.com/repos/'+m.REPOSITORY
            def read(self,n):raise AssertionError('oversized_body_must_not_be_read')
        opener=types.SimpleNamespace(open=lambda *a,**k:Response())
        with patch.object(m.urllib.request,'build_opener',lambda *h:opener):
            with self.assertRaises(RuntimeError):m.public_get('https://api.github.com/repos/'+m.REPOSITORY,10)


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='.inactive-managed-preparation-',dir=REPO)
        self.root=Path(self.tmp.name);self.ops=self.root/'ops';self.ops.mkdir(mode=0o755)
        self.runtime=self.ops/'ypal-restored-managed-indexer-v1';self.base=self.root/'audit'
        self.patcher=patch.multiple(m,OPS=self.ops,RUNTIME=self.runtime,BASE=self.base);self.patcher.start()
        self.existing=self.ops/'existing.py';self.existing.write_bytes(b'existing');self.existing.chmod(0o640)
        self.existing_before=m.identity(self.existing);self.ops_before=m.identity(self.ops,True)
        content={'new.py':b'new public operator','ypal-restored-managed-indexer-v1/launcher.mjs':b'public launcher','ypal-restored-managed-indexer-v1/service.public.env':b'PUBLIC_ONLY=true\n'}
        rows=[{'source':'ops/unified-indexer-transition/existing.py','target':'existing.py','bytes':8,'sha256':m.sha(b'existing'),'existingOnly':False,'mode':0o600,'before':self.existing_before}]
        for target,raw in content.items():rows.append({'source':'ops/unified-indexer-transition/'+target,'target':target,'bytes':len(raw),'sha256':m.sha(raw),'existingOnly':False,'mode':0o644 if '/'in target else 0o600,'before':None})
        self.fetched=content
        self.review={'binding':{'ops':self.ops_before,'runtimeBefore':None,'files':rows,'sourceAndServing':{'source':'stable'}},'reviewHash':'a'*64,'nativeObservation':{}}
        case=self
        class Host:
            qualified=0;changed=False
            def capture(self):return {'binding':{'source':'changed'if self.changed else'stable'},'native':{}}
            def unchanged(self,before,after):m.need(before['binding']==after['binding'],'source_changed')
            def qualify(self):
                self.qualified+=1
                case.assertEqual(stat.S_IMODE(case.runtime.stat().st_mode),0o755)
                for name in ['launcher.mjs','service.public.env']:case.assertEqual(stat.S_IMODE((case.runtime/name).stat().st_mode),0o644)
                return {'completedInverseQualified':False,'actualREADAdmissionQualified':False,'nativeAdoptionQualified':False,'managedHostConstructed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.host=Host()
        self.review_patch=patch.object(m,'review',lambda host:(copy.deepcopy(self.review),dict(self.fetched)));self.review_patch.start()

    def tearDown(self):
        self.review_patch.stop();self.patcher.stop();self.tmp.cleanup()

    def test_exact_stage_preserves_existing0640_inode_and_only_new_public_runtime_modes(self):
        result=m.stage(self.host,'a'*64)
        self.assertTrue(result['completed']);self.assertFalse(result['actualREADAdmissionQualified'])
        self.assertEqual(m.identity(self.existing),self.existing_before);self.assertEqual(m.identity(self.ops,True),self.ops_before)
        self.assertEqual(stat.S_IMODE((self.ops/'new.py').stat().st_mode),0o600)
        self.assertEqual(stat.S_IMODE(self.base.stat().st_mode),0o700)
        self.assertEqual(stat.S_IMODE((self.base/'before.json').stat().st_mode),0o600)
        self.assertEqual(self.host.qualified,1)

    def test_racing_foreign_destination_is_never_overwritten_and_operation_cannot_repeat(self):
        original=m.no_replace
        def race(source,target):
            if target.name=='new.py':target.write_bytes(b'foreign')
            original(source,target)
        with patch.object(m,'no_replace',race):
            with self.assertRaises(FileExistsError):m.stage(self.host,'a'*64)
        self.assertEqual((self.ops/'new.py').read_bytes(),b'foreign');self.assertEqual(self.host.qualified,0)
        self.assertFalse((self.base/'result.json').exists())
        with self.assertRaises(FileExistsError):m.stage(self.host,'a'*64)
        self.assertEqual((self.ops/'new.py').read_bytes(),b'foreign')

    def test_stale_source_review_refuses_before_any_audit_or_runtime_creation(self):
        self.review['reviewHash']='b'*64
        with self.assertRaises(RuntimeError):m.stage(self.host,'a'*64)
        self.assertFalse(self.base.exists());self.assertFalse(self.runtime.exists())
        self.assertEqual(m.identity(self.existing),self.existing_before)

    def test_source_change_after_staging_cannot_create_success_or_future_ACK(self):
        original=self.host.qualify
        def qualify():
            result=original();self.host.changed=True;return result
        self.host.qualify=qualify
        with self.assertRaisesRegex(RuntimeError,'source_changed'):m.stage(self.host,'a'*64)
        self.assertFalse((self.base/'result.json').exists());self.assertEqual(m.identity(self.existing),self.existing_before)

    def test_existing_symlink_or_hardlink_refused_without_mode_changes(self):
        target=self.ops/'link.py';target.symlink_to(self.existing)
        with self.assertRaises(RuntimeError):m.protected(target)
        target.unlink();os.link(self.existing,target)
        with self.assertRaises(RuntimeError):m.protected(target)
        self.assertEqual(stat.S_IMODE(self.existing.stat().st_mode),0o640)

    def test_real_review_preserves_and_refuses_existing_runtime0700(self):
        self.review_patch.stop();self.review_patch=patch.object(m,'review',m.review);self.review_patch.start()
        self.runtime.mkdir(mode=0o700)
        plan=self.root/'files.json';plan.write_bytes(b'{}')
        value={'files':[self.review['binding']['files'][0]]}
        # Exercise actual review control flow with a finite synthetic plan and
        # a mocked public-repository response, never actual network/host reads.
        original=load_original_review()
        with patch.multiple(m,PLAN=plan,PLAN_SHA=m.sha(b'{}')),patch.object(m,'validate_plan',lambda v:value),patch.object(m,'public_get',lambda *args:json.dumps({'full_name':m.REPOSITORY,'private':False}).encode()):
            with self.assertRaisesRegex(RuntimeError,'runtime_mode'):original(self.host)
        self.assertEqual(stat.S_IMODE(self.runtime.stat().st_mode),0o700);self.assertFalse(self.base.exists())


ORIGINAL_REVIEW=m.review
def load_original_review():return ORIGINAL_REVIEW


if __name__=='__main__':unittest.main()
