"""Real projector3 derivation and exact authorization projection controls."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('arena-native-derived-projector-v3.py')
def public(path,digest=None,maximum=4000000):
    origin=HERE/Path(path).name
    if not origin.exists()or digest is not None and hashlib.sha256(origin.read_bytes()).hexdigest()!=digest:
        matches=[f for f in HERE.parent.rglob(Path(path).name)if f.is_file()and(digest is None or hashlib.sha256(f.read_bytes()).hexdigest()==digest)]
        if not matches:raise RuntimeError('actual_local_projector3_source_required')
        origin=matches[0]
    raw=origin.read_bytes()
    if len(raw)>maximum or digest is not None and hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('actual_projector3_source_hash_required')
    return raw
with patch.object(m,'protected',side_effect=public):actual=m.composition()


class Controls(unittest.TestCase):
    def setUp(self):
        self.roles=[{'name':'native','oid':'11','limit':32,'used':1},
            {'name':'reader','oid':'12','limit':32,'used':0},{'name':'writer','oid':'13','limit':2,'used':0}]
        self.observed={'readOnly':True,'isolation':'repeatable read','maximum':200,'reserved':3,'used':40,'roles':self.roles}
        self.capacity=actual.capacity_checked(self.observed,*self.roles)
        self.review={'format':actual.FORMAT,'catalogs':{'sharedPoolCapacity':self.capacity,
            'nativeData':{'actualRegistered44':'fixed'},'target':{'privateCatalog':'fixed'}},
            'publicConfigSha256':'a'*64,'unitSha256':'b'*64,'privateInputsSha256':'c'*64}

    def test_only_two_global_observations_change_authorization_while_raw_hash_still_changes(self):
        first=copy.deepcopy(self.review);second=copy.deepcopy(first)
        observed=second['catalogs']['sharedPoolCapacity']['observation'];observed['used']+=1
        second['catalogs']['sharedPoolCapacity']=actual.capacity_checked(observed,*observed['roles'])
        self.assertEqual(actual.review_authorization_hash(first),actual.review_authorization_hash(second))
        self.assertNotEqual(actual.sha(actual.encoded(first)),actual.sha(actual.encoded(second)))
        projected=actual.review_authorization_projection(first)
        expected=copy.deepcopy(first);del expected['catalogs']['sharedPoolCapacity']['observation']['used'];del expected['catalogs']['sharedPoolCapacity']['globalBudgetForEntireCappedRoleSet']
        self.assertEqual(projected,expected);self.assertIn('used',first['catalogs']['sharedPoolCapacity']['observation'])

    def test_global_budget_violation_or_forged_derived_scalar_cannot_be_projected_away(self):
        self.observed['used']=150;self.capacity['globalBudgetForEntireCappedRoleSet']=999
        with self.assertRaisesRegex(RuntimeError,'global_budget'):actual.review_authorization_hash(self.review)
        self.observed['used']=40
        with self.assertRaisesRegex(RuntimeError,'exact_checked_frame'):actual.review_authorization_hash(self.review)

    def test_own_role_used_population_limits_writer_zero_remain_fresh_and_exact(self):
        before=actual.review_authorization_hash(self.review)
        self.roles[0]['used']=2;self.review['catalogs']['sharedPoolCapacity']=actual.capacity_checked(self.observed,*self.roles)
        self.assertNotEqual(before,actual.review_authorization_hash(self.review))
        self.roles[2]['used']=1;self.review['catalogs']['sharedPoolCapacity']=actual.capacity_checked(self.observed,*self.roles)
        with self.assertRaisesRegex(RuntimeError,'zero_writer'):actual.review_authorization_hash(self.review)
        self.roles[2]['used']=0;self.roles[0]['limit']=33
        with self.assertRaises(RuntimeError):actual.review_authorization_hash(self.review)

    def test_private_source_target_unit_and_role_identity_changes_stay_authorized_differences(self):
        initial=actual.review_authorization_hash(self.review)
        for change in [lambda r:r.update(privateInputsSha256='d'*64),lambda r:r.update(unitSha256='d'*64),
            lambda r:r['catalogs']['nativeData'].update(actualRegistered44='changed'),
            lambda r:r['catalogs']['target'].update(privateCatalog='changed'),
            lambda r:r['catalogs']['sharedPoolCapacity']['observation']['roles'][0].update(oid='99')]:
            review=copy.deepcopy(self.review);change(review)
            self.assertNotEqual(actual.review_authorization_hash(review),initial)

    def test_original_business_and_program_protocol_functions_are_retained(self):
        old=load('arena-native-derived-projector-v2.py')
        with patch.object(old,'protected',side_effect=public):prior=old.composition()
        for name in ['review_start','capture','validate_current','capacity_checked']:
            self.assertEqual(getattr(actual,name).__code__.co_code,getattr(prior,name).__code__.co_code,name)
            self.assertEqual(getattr(actual,name).__code__.co_consts,getattr(prior,name).__code__.co_consts,name)
        for name,value in vars(prior.Owner).items():
            if isinstance(value,types.FunctionType):
                self.assertEqual(getattr(actual.Owner,name).__code__.co_code,value.__code__.co_code,name)
                self.assertEqual(getattr(actual.Owner,name).__code__.co_consts,value.__code__.co_consts,name)
        self.assertEqual(actual.PUBLIC,prior.PUBLIC);self.assertEqual(actual.UNIT,prior.UNIT);self.assertEqual(actual.PROJECTOR_SHA,prior.PROJECTOR_SHA)
        self.assertEqual(actual.PROJECTOR_SHA,'37c17e1bdaf22bfecd930ff97da8e6eb7b8337f57469cb16d487e0f6c77be319')
        self.assertNotEqual(actual.BASE,prior.BASE);self.assertNotEqual(actual.INPUT,prior.INPUT)

    def test_start_still_runs_genuine_fresh_review_before_authorization_or_any_effect(self):
        owner=object();effects=Mock(side_effect=AssertionError('no effect before authorization'))
        with patch.object(actual,'Owner',return_value=owner),patch.object(actual,'review_start',return_value=self.review)as review,\
             patch.object(actual,'new_directory',effects):
            with self.assertRaisesRegex(RuntimeError,'exact_fresh'):actual.start('a'*64,'b'*64,'c'*64)
            review.assert_called_once_with(owner);effects.assert_not_called()

    def test_authorized_private_or_own_role_drift_refuses_before_any_start_effect(self):
        expected=actual.review_authorization_hash(self.review);effects=Mock(side_effect=AssertionError('no effect'))
        for key in ['private','role']:
            changed=copy.deepcopy(self.review)
            if key=='private':changed['privateInputsSha256']='d'*64
            else:
                observed=changed['catalogs']['sharedPoolCapacity']['observation'];observed['roles'][0]['used']+=1
                changed['catalogs']['sharedPoolCapacity']=actual.capacity_checked(observed,*observed['roles'])
            with self.subTest(key=key),patch.object(actual,'Owner',return_value=object()),\
                 patch.object(actual,'review_start',return_value=changed),patch.object(actual,'new_directory',effects):
                with self.assertRaisesRegex(RuntimeError,'exact_fresh'):actual.start('a'*64,'b'*64,expected)
        effects.assert_not_called()

    def test_genuine_start_accepts_only_global_churn_and_saves_full_raw_review_SHA_before_start(self):
        first=copy.deepcopy(self.review);self.observed['used']+=1
        self.review['catalogs']['sharedPoolCapacity']=actual.capacity_checked(self.observed,*self.roles)
        owner=types.SimpleNamespace(public_config=lambda:{'actualConfig':True},socket_definition=lambda:b'socket',
            definition=lambda:b'unit',current_catalogs=Mock(),actor=lambda:{'actualNewActor':True})
        saved={};commands=[]
        with patch.object(actual,'Owner',return_value=owner),patch.object(actual,'review_start',return_value=self.review),\
             patch.object(actual,'new_directory',Mock()),patch.object(actual,'save',side_effect=lambda path,value,*_args:saved.setdefault(str(path),value)),\
             patch.object(actual,'command',side_effect=lambda command,**_kwargs:commands.append(command)):
            actual.start('a'*64,'b'*64,actual.review_authorization_hash(first))
        self.assertEqual(saved[str(actual.BASE/'intent.json')],self.review)
        self.assertEqual(saved[str(actual.BASE/'start-intent.json')]['rawReviewSha256'],actual.sha(actual.encoded(self.review)))
        self.assertEqual(commands[-2:],[['/usr/bin/systemctl','start',actual.SOCKET_UNIT],['/usr/bin/systemctl','start',actual.UNIT]])

    def test_new_input_render_changes_only_domain_without_constructing_runtime(self):
        prior={'format':'yunipals-arena-native-derived-projector-owner-v2-input','support':{'manifestSha256':
            'b038bff5a579d08fbd0ebcce4765029d52465f50c854b033b9191c4ecabf1443'},'targetAdmissionSha256':'a'*64,
            'targetAuthSha256':'b'*64,'sourceAuthSha256':'c'*64,'maximumBlocks':100,'maximumEvents':10,'pollMilliseconds':1000}
        with patch.object(m,'protected',return_value=json.dumps(prior).encode())as read,\
             patch.object(m,'composition',side_effect=AssertionError('no runtime construction')):
            self.assertEqual(m.render_input(),{**prior,'format':m.FORMAT+'-input'})
        read.assert_called_once_with(m.PRIOR_INPUT,m.PRIOR_INPUT_SHA,65536)

    def test_default_inert_and_complete_actual_source_map(self):
        result=subprocess.run(['python3','-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertFalse(result.stderr)
        manifest=json.loads(public(m.SOURCE_MANIFEST));self.assertEqual(manifest['files'],{m.FILE.name:hashlib.sha256(public(m.FILE)).hexdigest(),**m.SOURCE_PINS})
        self.assertEqual(actual.MANIFEST.name,'arena-native-derived-support-v2.manifest.json')


if __name__=='__main__':unittest.main()
