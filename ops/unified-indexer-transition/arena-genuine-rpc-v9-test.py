#!/usr/bin/env python3
"""Actual tiny descriptor-walk races plus inherited isolated fixture checks."""
from contextlib import ExitStack
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    s=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
old=load('arena-genuine-rpc-v8-test');m=load('arena-genuine-rpc-v9')
old.m=m;old.old.m=m;old.old.old.m=m;old.old.old.old.m=m;old.old.old.old.old_tests.m=m

class Tests(old.old.Tests):
    def work(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);parent=Path(temp.name);root=parent/'work';root.mkdir(mode=0o700)
        self.enterContext(patch.object(m,'UID',os.getuid()));self.enterContext(patch.object(m,'GID',os.getgid()))
        return parent,root
    def test_v9_exactly_preserves_v8_except_allocator_diagnostics_and_namespace(self):
        before=(HERE/'arena-genuine-rpc-v8.py').read_text();self.assertEqual(m.sha(before.encode()),'071130d4f971fe73dbb921eaea3f57e08cb77f305238ebba0186dde2b5a53f98')
        current=Path(m.__file__).read_text()
        a=before.index('def allocated(work):');b=before.index('\n\ndef process_stat(pid):',a)
        x=current.index('def allocated(work):');y=current.index('\n\ndef process_stat(pid):',x)
        current=current[:x]+before[a:b]+current[y:]
        current=current.replace("FORMAT = 'yunipals-arena-genuine-rpc-v9'","FORMAT = 'yunipals-arena-genuine-rpc-v8'").replace("UNIT = 'yunipals-arena-genuine-rpc-20261021-i.service'","UNIT = 'yunipals-arena-genuine-rpc-20261021-h.service'")
        current=current.replace(";report=None;error=None;failure_origin=None",";report=None;error=None")
        current=current.replace("        except BaseException as exc:\n            error=type(exc).__name__;failure_origin=failure_location(exc,self.work)","        except BaseException as exc:error=type(exc).__name__")
        current=current.replace("'failedPhase':failed_phase,'failureOrigin':failure_origin,'errorLabel':","'failedPhase':failed_phase,'errorLabel':")
        self.assertEqual(current,before)
    def test_total_scratch_includes_private_tmp(self):
        _,root=self.work();(root/'tiny').write_bytes(b'public')
        self.assertEqual(m.SCRATCH_CAP+m.TMP_CAP,4*1024**3);self.assertGreater(m.allocated(root),0)
    def test_actual_enumerated_child_deletion_is_tolerated_only_root_stable(self):
        _,root=self.work();entry=root/'transient-config.mjs';entry.write_bytes(b'public')
        actual=m.os.fwalk
        def raced(*a,**kw):
            for row in actual(*a,**kw):
                if entry.exists():entry.unlink()
                yield row
        with patch.object(m.os,'fwalk',raced):self.assertGreater(m.allocated(root),0)
        self.assertTrue(root.is_dir())
    def test_root_replacement_or_disappearance_is_not_a_tolerated_child_race(self):
        parent,root=self.work();actual=m.os.fwalk
        def replaced(*a,**kw):
            for row in actual(*a,**kw):
                root.rename(parent/'old-root');root.mkdir(mode=0o700);yield row
        with patch.object(m.os,'fwalk',replaced),self.assertRaisesRegex(RuntimeError,'root identity'):m.allocated(root)
        def vanished(*a,**kw):
            for row in actual(*a,**kw):root.rmdir();yield row
        with patch.object(m.os,'fwalk',vanished),self.assertRaises(FileNotFoundError):m.allocated(root)
    def test_symlink_root_and_foreign_device_refused_without_following_links(self):
        parent,root=self.work();link=parent/'link';link.symlink_to(root,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'allocation root'):m.allocated(link)
        (root/'link-to-public-source').symlink_to(HERE/'arena-genuine-rpc-v8.py')
        actual=m.os.stat;seen=[]
        def observed(path,*a,**kw):
            if path=='link-to-public-source':seen.append(kw);self.assertIs(kw['follow_symlinks'],False);self.assertIsInstance(kw['dir_fd'],int)
            return actual(path,*a,**kw)
        with patch.object(m.os,'stat',observed):self.assertGreater(m.allocated(root),0)
        self.assertTrue(seen)
        def wrong_device(path,*a,**kw):
            value=actual(path,*a,**kw)
            if path=='link-to-public-source':return types.SimpleNamespace(st_dev=value.st_dev+1,st_mode=value.st_mode,st_blocks=value.st_blocks)
            return value
        with patch.object(m.os,'stat',wrong_device),self.assertRaisesRegex(RuntimeError,'device'):m.allocated(root)
    def test_other_child_errors_remain_fatal_and_cap_still_measured(self):
        _,root=self.work();(root/'tiny').write_bytes(b'public');actual=m.os.stat
        def denied(path,*a,**kw):
            if path=='tiny':raise PermissionError(13,'private message')
            return actual(path,*a,**kw)
        with patch.object(m.os,'stat',denied),self.assertRaises(PermissionError):m.allocated(root)
        with patch.object(m,'SCRATCH_CAP',0):self.assertGreater(m.allocated(root),0)
    def test_failure_origin_exports_fixed_area_errno_and_operator_lines_only(self):
        _,root=self.work();error=FileNotFoundError(2,'private message',str(root/'tmp/private-secret/.vite-temp/secret.mjs'))
        value=m.failure_location(error,root)
        self.assertEqual(value,{'relativeArea':'owned_vite_cache','errno':2,'operatorFrames':[]})
        self.assertNotIn('secret',str(value));self.assertNotIn('private message',str(value))
        try:m.allocated(root/'missing-root')
        except FileNotFoundError as error:value=m.failure_location(error,root)
        self.assertTrue(any(row['source']=='allocated'and type(row['line'])is int for row in value['operatorFrames']))

if __name__=='__main__':unittest.main()
