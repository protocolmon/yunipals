import copy
import importlib.util
import json
from pathlib import Path
import unittest
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('owner',HERE/'metadata-readview-v4-owner-v1.py')
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)
p=json.loads((HERE/'metadata-readview-v4-plan.review.json').read_bytes())
profile=json.loads((HERE.parents[1]/'docs/unified-indexer/production-rpc-profile-2026-10-20.draft.json').read_bytes())
grants=(HERE/'metadata-readview-v4-grants.review.sql').read_text()

class Tests(unittest.TestCase):
 def fixture(self):
  return {'database':'yunipals_backfill','sessionUser':'postgres','currentUser':'postgres','port':'5432','socket':True,'targetAbsent':True,'oldRights':True,
   'oldMarker':{'identity':p['previousReadIdentity'],'release_id':p['sourceRelease'],'manifest_hash':'0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029','definitions':p['definitions']},
   'release':{'id':p['sourceRelease'],'physical_schema':p['physicalSchema'],'build_id':p['buildId'],'manifest_hash':'0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029','manifest':profile['manifest']},
   'runtime':{'version':'6','buildId':p['buildId'],'isDev':'0'},
   'sources':[{'id':r['id'],'chainId':r['chainId'],'manifestHash':'0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029','definition':r}for r in profile['manifest']['sources']],
   'roles':[{'name':r['role'],'super':False,'createDb':False,'createRole':False,'replication':False,'bypassRls':False}for r in p['grants']],
   'oldRelations':[None]*10,'oldFunctions':[None]*4}
 def test_exact_source_and_previous_identity_required(self):
  value=self.fixture();o.validate(value,p,profile)
  for key,bad in [('database','other'),('socket',False),('targetAbsent',False),('oldRights',False)]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):o.validate({**value,key:bad},p,profile)
  bad=copy.deepcopy(value);bad['oldMarker']['identity']=p['readIdentity']
  with self.assertRaisesRegex(RuntimeError,'exact_registered_source'):o.validate(bad,p,profile)
  bad=copy.deepcopy(value);bad['sources'][0]['definition']={}
  with self.assertRaisesRegex(RuntimeError,'exact_native_source'):o.validate(bad,p,profile)
  bad=copy.deepcopy(value);bad['roles'][0]['super']=True
  with self.assertRaisesRegex(RuntimeError,'nonadministrative'):o.validate(bad,p,profile)
 def test_atomic_body_preserves_official_statements_and_rehearsal(self):
  before=self.fixture();body=o.owner_sql(p,grants,before,False)
  self.assertTrue(body.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ;'))
  self.assertTrue(body.endswith('ROLLBACK;\n'));self.assertNotIn('\nCOMMIT;',body)
  self.assertIn('owner_result_outside_exact_scope',body);self.assertIn('reviewed_catalog_changed',body)
  self.assertIn("pg_advisory_xact_lock(hashtext('unified-ownership-read-views')",body)
  for row in p['expectedOwnerStatements']:
   if not row['params']:self.assertIn(row['sql']+';',body)
  self.assertTrue(o.owner_sql(p,grants,before,True).endswith('COMMIT;\n'))
 def test_old_candidate_drift_or_negative_permissions_rejected(self):
  before=self.fixture();after={**before,'targetAbsent':False};target=o.expected_target(p)
  o.outcome(before,after,target,p)
  with self.assertRaisesRegex(RuntimeError,'previous_candidate'):o.outcome(before,{**after,'oldRights':False},target,p)
  with self.assertRaisesRegex(RuntimeError,'exact_fresh_view'):o.outcome(before,after,{**target,'forbiddenAuthority':1},p)
  with self.assertRaisesRegex(RuntimeError,'exact_fresh_view'):o.outcome(before,after,{**target,'aclDifferenceCount':1},p)
 def test_exact_nonowner_acl_set_includes_grant_options_and_columns(self):
  sql=o.acl_difference_sql(p)
  self.assertIn('EXCEPT ALL',sql);self.assertIn('col.attacl',sql);self.assertIn('a.is_grantable',sql)
  for row in p['grants']:
   for name in row['tables']+row['functions']:self.assertIn(o.literal(name),sql)
  self.assertNotIn("a.grantee IN",sql)
 def test_bind_only_known_official_insert_values(self):
  bad=copy.deepcopy(p);row=next(r for r in bad['expectedOwnerStatements']if r['params']);row['sql']='UPDATE another SET value=$1';
  with self.assertRaisesRegex(RuntimeError,'exact_official_owner_insert'):o.owner_sql(bad,grants,self.fixture(),False)
 def test_parent_helper_pin_and_no_service_or_provider_mutations(self):
  import hashlib
  self.assertEqual(hashlib.sha256((HERE/'metadata-readview-v4-candidates-stage-v1.py').read_bytes()).hexdigest(),o.STAGER_SHA)
  text=(HERE/'metadata-readview-v4-owner-v1.py').read_text()
  self.assertNotIn('systemctl',text);self.assertNotIn('requests.',text);self.assertNotIn('ALTER ROLE',text)
if __name__=='__main__':unittest.main()
