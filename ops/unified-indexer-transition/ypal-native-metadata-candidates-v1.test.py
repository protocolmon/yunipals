import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

m=load('ypal-native-metadata-candidates-v1');retained=load('retained-workers-stage-v1')

def environment():
 return {'DATABASE_URL':'postgresql://yunipals:synthetic%24secret@127.0.0.1:5432/yunipals_backfill?application_name=retained',
         'DATABASE_SCHEMA':m.OLD_PHYSICAL,'READ_DATABASE_SCHEMA':m.OLD_READ,
         'OWNERSHIP_READ_SCHEMA':m.OLD_READ,'OWNERSHIP_RELEASE_ID':m.OLD_RELEASE,
         'UNIFIED_INDEXER_RELEASE_ID':m.OLD_RELEASE,'OWNERSHIP_READ_MODE':'unified',
         'BASE_METADATA_INGESTION':'native','METADATA_SOURCE_MODE':'archive','YUNIPALS_PROJECTION_MODE':'generation',
         'PONDER_RPC_URL_8453':'http://127.0.0.1:19202/','PROVIDER_KEY':'synthetic-preserved',
         'BNB_CONFIRMATIONS':'20','RARITY_READ_SOURCE':'local','LIMIT':'2'}

class Controls(unittest.TestCase):
 def test_only_actual_created_readview_receipt_is_accepted(self):
  self.assertEqual(m.READ_RESULT_SHA,'17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3')
  with self.assertRaisesRegex(RuntimeError,'exact_created_readview_acknowledgement'):m.load('0'*64)
 def test_exact_old_proxy_recent_storage_predicate_without_provider_calls(self):
  node=next((p for p in [Path('/opt/node-v24.18.1/bin/node'),Path('/root/.nvm/versions/node/v24.18.1/bin/node'),Path('/usr/bin/node')]if p.exists()),None)
  self.assertIsNotNone(node)
  script=r'''import fs from 'node:fs';import crypto from 'node:crypto';import vm from 'node:vm';
const raw=fs.readFileSync(process.argv[1]);if(crypto.createHash('sha256').update(raw).digest('hex')!=='8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c')throw Error('exact_new_artifact');
const one='function createOpenSeaRequestBudget(input = process.env) {\n  const { databaseUrl, scope, coordinatorId } = readOpenSeaBudgetEnvironment(input);\n  const pool = new pg3.Pool({\n    connectionString: databaseUrl,\n    application_name: "yunipals_opensea_budget",\n    max: 1,\n';
const text=raw.toString().replace(one,one.replace('max: 1,','max: 2,'));if(crypto.createHash('sha256').update(text).digest('hex')!=='d8e58d18f7f88bb8b13d4f2d85d562ddd71f7ffc2c96b913410d5a656202f5c8')throw Error('exact_old_artifact');
const start=text.indexOf('var maximumRequestBytes ='),end=text.indexOf('var RpcProxyBusyError =');if(start<0||end<=start)throw Error('exact_policy_span');const free=vm.runInNewContext(text.slice(start,end)+'\nisFreeRpcCall;',{});
const head=53005121n,call=n=>({method:'eth_getStorageAt',params:['0x98433df878e8c898cb907345c3a7756e5f72240f','0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc','0x'+n.toString(16)]});
if(!free({method:'eth_chainId',params:[]},head)||!free({method:'eth_getBlockByNumber',params:['0x1',false]},head)||!free(call(head-20n),head,4096n)||free(call(head-4097n),head,4096n)||free(call(head),undefined,4096n))throw Error('recent_numeric_storage_gate');console.log('ok');'''
  result=subprocess.run([str(node),'--input-type=module','-e',script,str(HERE/'ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs')],capture_output=True,timeout=10,env={'PATH':'/usr/bin:/bin'})
  self.assertEqual((result.returncode,result.stdout,result.stderr),(0,b'ok\n',b''))
 def test_exact_six_selectors_and_all_private_values_preserved(self):
  before=environment();after=m.retarget(before)
  self.assertEqual({k for k in before if before[k]!=after[k]},set(m.REPIN));self.assertEqual(len(m.REPIN),6)
  for k in before.keys()-m.REPIN.keys():self.assertEqual(before[k],after[k])
  self.assertEqual(after['OWNERSHIP_RELEASE_ID'],m.RELEASE);self.assertEqual(after['UNIFIED_INDEXER_RELEASE_ID'],m.RELEASE)
  self.assertNotIn('UNIFIED_INDEXER_DATABASE_URL',after)
 def test_wrong_previous_selector_or_mode_refuses(self):
  for key in m.REPIN:
   with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'exact_previous_metadata_selector'):m.retarget({**environment(),key:'foreign'})
  for key in ['BASE_METADATA_INGESTION','OWNERSHIP_READ_MODE','METADATA_SOURCE_MODE','YUNIPALS_PROJECTION_MODE']:
   with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'exact_retained_native_metadata_modes'):m.retarget({**environment(),key:'foreign'})
 def test_existing_role_database_only_and_no_new_source_credentials(self):
  self.assertEqual(m.database_identity(environment())['roleOid'],'16388')
  for url in ['postgresql://different:x@localhost/yunipals_backfill','postgresql://yunipals:x@remote/yunipals_backfill','postgresql://yunipals:x@localhost/other','postgresql://yunipals:x@localhost:6432/yunipals_backfill']:
   with self.assertRaisesRegex(RuntimeError,'same_local_metadata_database'):m.database_identity({**environment(),'DATABASE_URL':url})
  with self.assertRaisesRegex(RuntimeError,'no_new_source_database_credentials'):m.database_identity({**environment(),'UNIFIED_INDEXER_DATABASE_URL':'synthetic-new'})
 def test_current_private_configuration_change_is_not_silently_copied(self):
  before=environment();current={**before,'DATABASE_SCHEMA':'legacy'};m.same_private_configuration(before,current,m.REPIN)
  with self.assertRaisesRegex(RuntimeError,'private_configuration_no_longer_matches'):m.same_private_configuration(before,{**current,'PROVIDER_KEY':'changed'},m.REPIN)
  with self.assertRaisesRegex(RuntimeError,'private_configuration_no_longer_matches'):m.same_private_configuration(before,{**current,'NEW_SECRET':'unrecorded'},m.REPIN)
 def test_render_keeps_both_node_cli_inputs_same_new_env_and_official_bundle(self):
  env=environment();selectors={k:v for k,v in env.items()if k in set(m.REPIN)|{'OWNERSHIP_READ_MODE','BASE_METADATA_INGESTION','METADATA_SOURCE_MODE','YUNIPALS_PROJECTION_MODE','PONDER_RPC_URL_8453'}}
  wrapper=('node --env-file='+str(m.PREVIOUS/'native-recovery.env')+' /exact/cf333/dist/unified-base-metadata.mjs --env-file '+str(m.PREVIOUS/'native-recovery.env')+' --command "$1"\n').encode()
  drop=('ExecStart=node /exact/cf333/dist/metadata-worker.mjs\nEnvironmentFile='+str(m.PREVIOUS/'yunipals-metadata.selectors.env')+'\n').encode()
  originals={'native-recovery.env':retained.env_bytes(env),'native-recovery.sh':wrapper,'yunipals-metadata.selectors.env':retained.env_bytes(selectors),'yunipals-metadata.service.drop-in.candidate':drop}
  with patch.object(retained,'node_roundtrip')as node:
   files,identity,old=m.render(retained,originals);node.assert_called_once()
  new=retained.parse_env(files['native-recovery.env']);self.assertEqual(new['DATABASE_URL'],env['DATABASE_URL']);self.assertEqual(new['PROVIDER_KEY'],env['PROVIDER_KEY']);self.assertEqual(new['PONDER_RPC_URL_8453'],'http://127.0.0.1:19222/')
  self.assertEqual(files['native-recovery.sh'].count(str(m.BASE/'native-recovery.env').encode()),2);self.assertIn(b'/exact/cf333/dist/unified-base-metadata.mjs',files['native-recovery.sh']);self.assertIn(b'/exact/cf333/dist/metadata-worker.mjs',files['yunipals-metadata.service.drop-in.candidate']);self.assertEqual(set(files),set(m.FILES));self.assertEqual(old,env)
 def test_only_new_combined_root_point_rpc_is_rendered_and_unified_path_is_refused(self):
  env={**environment(),'PONDER_RPC_URL_8453':'http://127.0.0.1:19222/unified'}
  originals={'native-recovery.env':retained.env_bytes(env)}
  with self.assertRaisesRegex(RuntimeError,'exact_previous_metadata_selector'):m.render(retained,originals)
 def test_wrapper_wrong_occurrence_count_is_refused(self):
  with self.assertRaisesRegex(RuntimeError,'exact_prior_candidate_path_occurrences'):m.replace_exact(b'only-one',b'only-one',b'new',2)
 def test_readview_oids_definitions_and_actual_acl_binding_stay_distinct(self):
  before={'schemaOid':'1','relations':[{'oid':'2','definition':'immutable','acl':None}],'functions':[],'nonownerPermissions':0}
  granted={**before,'relations':[{'oid':'2','definition':'immutable','acl':'actual-owned-new-role'}],'nonownerPermissions':1}
  self.assertEqual(m.target_identity(before),m.target_identity(granted));self.assertNotEqual(m.sha(m.encoded(before)),m.sha(m.encoded(granted)))
  foreign={**granted,'relations':[{'oid':'foreign','definition':'immutable','acl':'actual-owned-new-role'}]};self.assertNotEqual(m.target_identity(before),m.target_identity(foreign))
 def test_source_guard_rejects_changed_acknowledged_actor(self):
  class S:
   def check_preserved(self,*a):pass
   def new_owned(self,*a):return{'pid':2}
  class H:
   def old_terminal(self,*a):pass
  with self.assertRaisesRegex(RuntimeError,'same_acknowledged_combined_source'):m.source_guard(S(),H(),{}, {'source':{'pid':1}})
 def test_readonly_context_contains_no_selector_or_business_write(self):
  sql=m.context_sql();self.assertTrue(sql.startswith('SELECT '));self.assertNotRegex(sql,r'\b(?:INSERT|UPDATE|DELETE|GRANT|ALTER|CREATE|DROP)\b');self.assertIn(m.READ+'.base_metadata_probe()',sql);self.assertIn('nativeApprovals',sql);self.assertIn('publicationCounts',sql)
 def test_cli_has_no_adopt_service_grant_or_provider_execution_phase(self):
  text=(HERE/'ypal-native-metadata-candidates-v1.py').read_text();self.assertNotIn("add_argument('--apply'",text);self.assertNotIn("add_argument('--adopt'",text);self.assertNotIn('subprocess.run(',text);self.assertNotIn("manager('",text)

if __name__=='__main__':unittest.main()
