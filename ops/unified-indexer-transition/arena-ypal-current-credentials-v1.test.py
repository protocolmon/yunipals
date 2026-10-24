#!/usr/bin/env python3
"""New credential identity/wiring with real reused local filesystem lifecycle."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location('test_'+name.replace('.','_'),HERE/name)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=load('arena-ypal-current-credentials-v1.py');f=load('arena-ypal-native-v2.credentials.test.py')

def build():
    with patch.object(m,'OLD',HERE/m.OLD.name):return m.build()


class Controls(unittest.TestCase):
    def test_transform_only_changes_seven_constants_and_three_domain_literals(self):
        raw=(HERE/m.OLD.name).read_bytes();self.assertEqual(m.sha(raw),m.OLD_SHA)
        actual=m.transform(raw);original=ast.parse(raw)
        values={node.targets[0].id:node.value for node in original.body if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)}
        changed={'FORMAT','AUTH_FORMAT','BASE','ADMISSION','PROPOSAL','PROPOSAL_SHA','ADMISSION_HELPER_SHA'}
        for node in actual.body:
            if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in changed:node.value=values[node.targets[0].id]
        reverse={'yunipals-arena-ypal-current-admission-v1':'yunipals-arena-ypal-admission-v2','arena-ypal-current-admission-v1.py':'arena-ypal-native-v2.admission.py',
                 '/run/lock/yunipals-arena-ypal-current-credentials-v1.lock':'/run/lock/yunipals-arena-ypal-credentials-v2.lock'}
        class Reverse(ast.NodeTransformer):
            def visit_Constant(self,node):
                if isinstance(node.value,str)and node.value in reverse:node.value=reverse[node.value]
                return node
        self.assertEqual(ast.dump(Reverse().visit(actual),include_attributes=False),ast.dump(original,include_attributes=False))
        bad=raw.replace(b"receipt.get('format')=='yunipals-arena-ypal-admission-v2'",b"receipt.get('format')=='foreign'")
        with self.assertRaisesRegex(RuntimeError,'three_credential'):m.transform(bad)

    def test_plan_requires_actual_ACK_and_exact_current_helper(self):
        n=build();sha='a'*64;p=m.plan(sha);self.assertEqual(p['admissionHelperSha256'],m.ADMISSION_HELPER_SHA)
        self.assertEqual(n.FORMAT,m.FORMAT);self.assertEqual(n.BASE,m.BASE);self.assertNotEqual(n.BASE,f.m.BASE)
        for value in [None,'0'*64,'missing','A'*64]:
            with self.assertRaises(RuntimeError):m.plan(value)
        proposal=json.loads((HERE/m.PROPOSAL.name).read_bytes());roles={w['role']:900000+i for i,w in enumerate(proposal['workers'])}
        receipt={'format':'yunipals-arena-ypal-current-admission-v1','operatorSha256':m.ADMISSION_HELPER_SHA,'commitOutcome':'commit_confirmed',
                 'proposalSha256':m.PROPOSAL_SHA,'roles':roles,'sourceRole':{'name':'arena_native_reader','oid':900009},
                 'sqlSha256':{'operational':proposal['sql']['operational-roles.current.sql.review'],'source':proposal['sql']['arena-ypal-native-v1.source.sql.review']},
                 'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'acknowledgedCurrentActors':{'sha256':n.ACTOR_ACK_SHA},'oldWholeInvocationGatePassed':False,
                 'perDatabase':{'operational':{'commitOutcome':'commit_confirmed','roles':roles},'source':{'commitOutcome':'commit_confirmed','roles':{'arena_native_reader':900009}}}}
        raw=(HERE/m.ADMISSION_HELPER.name).read_bytes();self.assertEqual(len(n.validate_admission(p,receipt,raw,proposal)),9)
        for value in ['yunipals-arena-ypal-admission-v2','foreign']:
            bad=copy.deepcopy(receipt);bad['format']=value
            with self.assertRaises(n.Refusal):n.validate_admission(p,bad,raw,proposal)

    def test_current_catalog_adapter_executes_exact_helper_but_no_old_writer(self):
        n=build()
        with patch.object(n,'protected',side_effect=lambda path,*a,**kw:(HERE/Path(path).name).read_bytes()):
            helper=n.load(m.ADMISSION_HELPER,m.ADMISSION_HELPER_SHA)
        # The exact current producer was evaluated; only its constructor is
        # substituted locally, proving the exported adapter routes create()[0].
        current=helper.runner.__closure__[0].cell_contents;sentinel=object();calls=[]
        current.create=lambda:calls.append('static-create')or(sentinel,None)
        self.assertIs(helper.runner(),sentinel);self.assertEqual(calls,['static-create'])
        self.assertEqual(helper.verify_current.__code__.co_code,load(m.ADMISSION_HELPER.name).verify_current.__code__.co_code)
        with patch.object(n,'protected',side_effect=lambda path,*a,**kw:(HERE/Path(path).name).read_bytes()):
            with self.assertRaises(n.Refusal):n.load(m.ADMISSION_HELPER,'f'*64)

    def reused(self,method):
        n=build()
        with patch.object(f,'m',n):
            case=f.Controls(methodName=method);case.setUp()
            try:getattr(case,method)()
            finally:case.tearDown()

    def test_real_reused_setup_login_auth_disable_and_readonly_review(self):
        self.reused('test_positive_three_explicit_phases_and_owned_disable')
        self.reused('test_setup_review_is_readonly_and_nine_paths_are_exclusive')

    def test_real_reused_unknown_password_ACK_preserves_files_and_never_rotates(self):
        self.reused('test_password_commit_ack_loss_refuses_any_retry_or_rotation')
        self.reused('test_login_ack_loss_is_not_auth_authority')

    def test_real_reused_secret_file_SQL_and_inode_boundaries(self):
        self.reused('test_scram_only_sql_plaintext_never_in_sql_or_public_result')
        self.reused('test_same_bytes_foreign_inode_refused')
        self.reused('test_source_connection_has_only_public_selectors_and_readonly_option')


if __name__=='__main__':unittest.main()
