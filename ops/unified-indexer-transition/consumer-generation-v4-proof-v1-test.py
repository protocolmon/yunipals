import copy,hashlib,importlib.util,json,subprocess,types,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('v4',HERE/'consumer-generation-v4-proof-v1.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class Tests(unittest.TestCase):
 def target(self):
  value=copy.deepcopy(json.loads((HERE/'consumer-operational-admission-v1.review.json').read_bytes())['units'][2])
  value['publicSelectors']['OWNERSHIP_READ_SCHEMA']=v.SCHEMA;value['publicSelectors']['READ_DATABASE_SCHEMA']=v.SCHEMA
  return value
 def current(self):return {'id':'104','state':'ready','ownershipReleaseId':v.RELEASE,'ownershipReadIdentity':v.IDENTITY,'viewReleaseId':v.RELEASE,'viewReadIdentity':v.IDENTITY}
 def harness(self,responses):
  queries=[]
  def query(sql):queries.append(sql);return responses.pop(0)
  def run(args,**kwargs):
   r=subprocess.run(args,capture_output=True,text=True,timeout=kwargs['timeout'],cwd=kwargs['cwd']);self.assertEqual(r.returncode,0,r.stderr[:250]);return r.stdout
  a=types.SimpleNamespace(sha=lambda b:hashlib.sha256(b).hexdigest(),document=lambda path,pin:{'committed':True,'rehearsed':False,'readSchema':v.SCHEMA,'readIdentity':v.IDENTITY})
  helper=types.SimpleNamespace(ROOT=ROOT,NODE='/root/.nvm/versions/node/v24.18.1/bin/node',run=run,check_current=lambda:{'sourceDigest':'accepted'})
  return a,types.SimpleNamespace(json_sql=query),helper,queries
 def test_actual_official_compiler_v4_and_canonical_cache_requirements(self):
  current=self.current();a,owner,helper,queries=self.harness([current,{'fresh':True},current])
  result=v.cache_proof(a,owner,helper,self.target())
  self.assertEqual(result['readIdentity'],v.IDENTITY);self.assertTrue(result['generationRechecked'])
  for name in ['ownership_read_identity','read_cache_truncate','chain_anchor',v.SCHEMA]:self.assertIn(name,result['sql'])
  self.assertNotIn('yunipals_ownership_35cdcb32_v3',result['sql']);self.assertNotIn('UPDATE ',result['sql'])
  self.assertEqual(queries[0],queries[2]);self.assertEqual(len(queries),3)
 def test_existing_legacy_generation103_and_v3_cannot_qualify(self):
  for identity in [None,'0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc']:
   current={**self.current(),'id':'103','ownershipReadIdentity':identity}
   with self.assertRaisesRegex(RuntimeError,'actual_ready_generation'):v.generation(current)
  wrong=self.target();wrong['publicSelectors']['READ_DATABASE_SCHEMA']='yunipals_ownership_35cdcb32_v3'
  with self.assertRaisesRegex(RuntimeError,'exact_v4_generation_selectors'):v.selectors(wrong)
 def test_changed_pointer_or_unfresh_cache_rejected(self):
  current=self.current()
  for responses,code in [([current,{'fresh':False}],'not_fresh'),([current,{'fresh':True},{**current,'id':'105'}],'changed_during')]:
   a,owner,helper,_=self.harness(responses)
   with self.assertRaisesRegex(RuntimeError,code):v.cache_proof(a,owner,helper,self.target())

if __name__=='__main__':unittest.main()
