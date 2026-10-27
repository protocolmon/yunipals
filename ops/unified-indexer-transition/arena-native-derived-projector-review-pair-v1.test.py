"""Read-only paired-review orchestration fixtures; no live acceptance."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('paired_projector_review',HERE/'arena-native-derived-projector-review-pair-v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(dir=HERE,prefix='projector-paired-review-fixture-');self.addCleanup(tmp.cleanup)
        self.base=Path(tmp.name);self.audit=self.base/'audit';self.values=[];self.objects=[]
        class Owner:
            def __init__(value,input_sha,support_sha):
                self.assertEqual((input_sha,support_sha),(m.INPUT_SHA,m.SUPPORT_MANIFEST_SHA));self.objects.append(value)
        self.owner=types.SimpleNamespace(Owner=Owner,sha=m.sha,encoded=m.encoded,review_start=self.review)
        self.enterContext(patch.object(m,'AUDIT',self.audit));self.enterContext(patch.object(m,'runtime',return_value=self.owner))
        self.enterContext(patch.object(m,'authenticate',return_value=b'actualAuthenticatedSourceFixture'))
        self.enterContext(patch.object(m.os,'geteuid',return_value=0));self.enterContext(patch.object(m.os,'getegid',return_value=0))
        self.enterContext(patch.object(m.socket,'gethostname',return_value='yunipals-main'))
        self.absence=self.enterContext(patch.object(m,'absent',return_value={'fixtureManagerAbsent':True}))
        self.old_mask=os.umask(0o077);self.addCleanup(os.umask,self.old_mask)

    def review(self,owner):
        value={'format':'fixtureGenuineReview','catalogs':{'capacity':{'observedUsed':len(self.values)},
            'credential':{'privateValue':'fixture-secret-do-not-export'}},'stable':True}
        self.values.append(value);return value

    def test_two_fresh_owners_and_full_private_reviews_yield_only_scalar_hash_and_path_summary(self):
        result=m.capture()
        self.assertTrue(result['completed']);self.assertTrue(result['separateOwnerObjects']);self.assertIsNot(self.objects[0],self.objects[1])
        self.assertEqual(result['changedPaths'],['catalogs.capacity.observedUsed'])
        self.assertEqual(result['reviewHashes'],[m.sha(m.encoded(v))for v in self.values])
        self.assertNotIn('fixture-secret-do-not-export',json.dumps(result));self.assertNotIn('catalogs',result)
        self.assertFalse(result['historicalFailedPairCauseProved']);self.assertEqual(self.absence.call_count,4)
        self.assertEqual(stat.S_IMODE(self.audit.stat().st_mode),0o700)
        for index,value in enumerate(self.values):
            path=self.audit/(str(index)+'-review.private.json')
            self.assertEqual(path.read_bytes(),m.encoded(value));self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)

    def test_audit_is_exclusive_and_prior_evidence_is_never_rewritten(self):
        m.capture();before=(self.audit/'result.json').read_bytes()
        with self.assertRaises(FileExistsError):m.capture()
        self.assertEqual((self.audit/'result.json').read_bytes(),before);self.assertEqual(len(self.values),2)

    def test_second_review_error_is_private_and_still_performs_full_absence_postflight(self):
        original=self.owner.review_start
        def fail(owner):
            if self.values:raise RuntimeError('fixture-private-error-value')
            return original(owner)
        self.owner.review_start=fail;result=m.capture()
        self.assertFalse(result['completed']);self.assertEqual(result['reviewCount'],1)
        self.assertNotIn('fixture-private-error-value',json.dumps(result));self.assertTrue((self.audit/'failure.private.txt').exists())
        self.assertTrue(result['namespaceAndManagerAbsentBeforeAfter']);self.assertEqual(self.absence.call_count,4)

    def test_changed_manager_or_new_namespace_refuses_completed_pair(self):
        self.absence.side_effect=[{'absent':True},{'absent':True},{'absent':True},RuntimeError('namespace-created')]
        result=m.capture();self.assertFalse(result['completed']);self.assertFalse(result['namespaceAndManagerAbsentBeforeAfter'])
        self.assertTrue(result['failure']['postflightFailed'])

    def test_actual_namespace_and_manager_absence_checker_refuses_any_actor_or_physical_file(self):
        # Invoke the genuine function retained before the orchestration mock.
        actual=load_fresh();state={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead',
            'MainPID':'0','ControlPID':'0','Job':'','FragmentPath':'','DropInPaths':''}
        owner=types.SimpleNamespace(BASE=actual.BASE,PUBLIC=actual.PUBLIC,UNIT=actual.UNIT,SOCKET_UNIT=actual.SOCKET_UNIT,SOCKET=actual.SOCKET,
            Owner=types.SimpleNamespace(__new__=lambda _cls:object(),state=lambda _self,_unit:dict(state)))
        with patch.object(actual.os.path,'lexists',return_value=False):
            self.assertEqual(len(actual.absent(owner)),2);state['MainPID']='42'
            with self.assertRaisesRegex(RuntimeError,'absent_and_terminal'):actual.absent(owner)
        with patch.object(actual.os.path,'lexists',return_value=True),self.assertRaisesRegex(RuntimeError,'all_be_absent'):actual.absent(owner)

    def test_default_import_and_cli_are_inert(self):
        output=subprocess.run(['python3','-I','-B',str(HERE/'arena-native-derived-projector-review-pair-v1.py')],check=True,capture_output=True)
        value=json.loads(output.stdout);self.assertTrue(value['staticOnly']);self.assertEqual(value['serviceActions'],0)
        self.assertFalse(self.audit.exists());self.assertFalse(output.stderr)

    def test_actual_program_manifest_input_and_support_are_authenticated_before_any_evaluation(self):
        actual=load_fresh();seen=[]
        def read(path,digest=None,maximum=4000000,private=False):
            seen.append(str(path))
            if Path(path)==actual.INPUT:
                self.assertEqual(digest,actual.INPUT_SHA);self.assertTrue(private);return b'fixturePrivateInput'
            origin=HERE/Path(path).name
            if not origin.exists()or digest is not None and hashlib.sha256(origin.read_bytes()).hexdigest()!=digest:
                matches=[p for p in HERE.parent.rglob(Path(path).name)if p.is_file()and(digest is None or hashlib.sha256(p.read_bytes()).hexdigest()==digest)]
                self.assertGreaterEqual(len(matches),1,str(path));origin=matches[0]
            self.assertEqual(hashlib.sha256(origin.read_bytes()).hexdigest(),digest);return origin.read_bytes()
        with patch.object(actual,'protected',side_effect=read):raw=actual.authenticate()
        self.assertEqual(m.sha(raw),actual.OWNER_SHA);self.assertIn(str(actual.INPUT),seen)
        self.assertIn(str(actual.SUPPORT_MANIFEST),seen)
        with patch.object(actual,'protected',side_effect=RuntimeError('source drift')),self.assertRaisesRegex(RuntimeError,'source drift'):
            actual.runtime()

    def test_nonpublic_dynamic_keys_are_hashed_and_lists_never_export_values(self):
        paths=m.changes({'role':{'private/user/key':{'items':[1]}}},{'role':{'private/user/key':{'items':[2]}}})
        self.assertEqual(len(paths),1);self.assertNotIn('private/user/key',paths[0]);self.assertIn('keySha256_',paths[0])

    def test_added_or_removed_null_is_a_real_changed_path(self):
        self.assertEqual(m.changes({'stable':True},{'stable':True,'added':None}),['added'])
        self.assertEqual(m.changes({'old':None},{}),['old'])
        self.assertEqual(m.changes({'nested':{}},{'nested':{'new':None}}),['nested.new'])


def load_fresh():
    spec=importlib.util.spec_from_file_location('fresh_paired_review',HERE/'arena-native-derived-projector-review-pair-v1.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


if __name__=='__main__':unittest.main()
