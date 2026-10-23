"""Actual current modules with synthetic protected receipts; no host actions."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent

def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
A=load('booster-api-binding-v3');P=load('consumer-owned-booster-policy-v3');E=load('consumer-operational-live-booster-v2');R=load('consumer-owned-booster-runtime-v4');C=load('booster-current-api-checks-v2')

def history():
 return {'format':'yunipals-booster-api-admission','committed':True,'operatorSha256':A.HISTORICAL_OPERATOR,'role':A.ROLE,'roleOid':'73187672','noRoleWritesGranted':True,
  'after':{'role':{'login':True,'limit':6,'passwordConfigured':False},'schema':{'oid':'74518314','usage':True,'create':False},'tables':[{'name':name,'oid':str(oid),'owner':'73004621','kind':'r','select':True,'writes':False}for name,oid in sorted(A.SOURCE_OIDS.items())if name!='booster_event']}}

class BindingTests(unittest.TestCase):
 def test_extends_exact_historical_nine_with_only_journal_and_no_attribute_normalization(self):
  original=history();before=copy.deepcopy(original);expected=A.expected_launch(original)
  self.assertEqual(original,before);self.assertEqual(len(expected['tables']),10)
  self.assertEqual(expected['role'],original['after']['role']);self.assertEqual(expected['schema'],original['after']['schema'])
  self.assertEqual(next(r for r in expected['tables']if r['name']=='booster_event'),{'name':'booster_event','oid':'74518495','owner':'73004621','kind':'r','select':True,'writes':False})
 def test_current_attributes_and_all_ten_OIDs_remain_exact(self):
  raw=A.encoded(history());valid={**A.expected_launch(history()),'sessions':3}
  with patch.object(A,'HISTORICAL_SHA',A.sha(raw)),patch.object(A,'protected',return_value=raw):
   A.validate(valid)
   for change in('login','limit','password','write','missing','oid','extra','sessions'):
    bad=copy.deepcopy(valid)
    if change=='login':bad['role']['login']=False
    elif change=='limit':bad['role']['limit']=-1
    elif change=='password':bad['role']['passwordConfigured']=True
    elif change=='write':bad['tables'][0]['writes']=True
    elif change=='missing':bad['tables']=[r for r in bad['tables']if r['name']!='booster_event']
    elif change=='oid':bad['tables'][0]['oid']='1'
    elif change=='extra':bad['tables'].append({**bad['tables'][0],'name':'unowned'})
    else:bad['sessions']=7
    with self.assertRaises(RuntimeError,msg=change):A.validate(bad)
 def test_does_not_offer_legacy_commit_or_login_authority(self):
  self.assertFalse(any(hasattr(A,n)for n in('commit','inverse','rehearse')))
  self.assertEqual(set(A.SOURCE_OIDS),{'_ponder_meta','_ponder_checkpoint','booster_type','booster_original','booster_request','booster_monster','booster_refund','booster_engine_state','booster_event','booster_checkpoint'})
 def test_current_runtime_has_explicit_new_dependency_and_receipt(self):
  self.assertEqual(R.ADMISSION_SHA,hashlib.sha256((HERE/'booster-api-binding-v3.py').read_bytes()).hexdigest())
  self.assertEqual(R.POLICY_SHA,hashlib.sha256((HERE/'consumer-owned-booster-policy-v3.py').read_bytes()).hexdigest())
  self.assertEqual(R.RECEIPT,Path('/var/backups/yunipals-booster-recent-openings-api-v1-20261023/result.json'))

class EntryTests(unittest.TestCase):
 def test_real_install_core_keeps_protocol_and_binds_actual_new_entry(self):
  previous=load('consumer-operational-marketplace-ack-v2');previous.OPS=HERE
  with patch.object(E,'load',return_value=previous):install=E.core('install')
  self.assertEqual(install.FORMAT,'yunipals-consumer-operational-install-v7')
  self.assertEqual(Path(install.__file__),Path(E.__file__))
  self.assertEqual(E.proof()['entrySha256'],hashlib.sha256(Path(install.__file__).read_bytes()).hexdigest())
  self.assertFalse(E.proof()['currentObservationsNormalized']);self.assertEqual(E.proof()['launchReadCount'],10)
  self.assertEqual(E.proof()['format'],'yunipals-current-booster-feature-binding-v2')
  self.assertTrue(E.proof()['recentOpeningsVerified'])
  self.assertEqual(E.proof()['rolloutReceiptSha256'],P.RECEIPT_SHA)
 def test_exact_owner_preview_tuple_and_install_review_interfaces(self):
  for mode,length in(('owner',2),('preview',3),('install',0)):
   result={'binding':{'format':'original'},'reviewHash':'old'}
   value=(result,*range(length-1))if length else result
   m=types.SimpleNamespace(review=lambda *a,**k:copy.deepcopy(value),save=lambda path,value:value,FORMAT='yunipals-consumer-operational-owner-v6',sha=lambda b:hashlib.sha256(b).hexdigest(),encoded=lambda v:json.dumps(v,sort_keys=True).encode())
   previous=types.SimpleNamespace(core=lambda mode:m)
   with patch.object(E,'load',return_value=previous):module=E.core(mode)
   returned=module.review(*(()if mode=='owner'else(m,)))
   checked=returned[0]if length else returned
   self.assertEqual(checked['reviewHash'],m.sha(m.encoded(checked['binding'])))
   self.assertEqual(checked['binding']['acknowledgedCurrentBoosterFeature'],E.proof())
   if length:self.assertEqual(len(returned),length)
 def test_actual_saving_owner_also_acknowledges_preview_and_install_results(self):
  saved=[];m=types.SimpleNamespace(review=lambda:None,save=lambda path,value:saved.append(value),FORMAT='yunipals-consumer-operational-owner-v6')
  with patch.object(E,'load',return_value=types.SimpleNamespace(core=lambda mode:m)):module=E.core('owner')
  for form in('yunipals-consumer-operational-owner-v6','yunipals-consumer-operational-preview-v6','yunipals-consumer-operational-install-v7'):
   module.save(Path('/fixture/result.json'),{'format':form})
   self.assertEqual(saved[-1]['acknowledgedCurrentBoosterFeature'],E.proof())

class PublicContractTests(unittest.TestCase):
 def page(self):
  token={'id':'8453:'+C.COLLECTION+':1','tokenId':'1','collection':C.COLLECTION,'originalKey':'8453:'+C.COLLECTION+':1','requestKey':C.REQUEST_KEY,'isOriginal':True,'burned':False}
  return {'enabled':True,'chainId':8453,'collection':C.COLLECTION,'engine':C.ENGINE,'items':[token],'nextCursor':None}
 def test_global_real_validator_accepts_growth_and_refuses_identity_cursor_corruption(self):
  page=self.page();self.assertEqual(C.verify_global(page)['knownTokenId'],'1')
  page['items'].append({**page['items'][0],'id':'8453:'+C.COLLECTION+':2','tokenId':'2','isOriginal':False})
  self.assertEqual(C.verify_global(page)['pageRows'],2)
  for change in('ownerCollection','duplicate','cursor','opening','request'):
   bad=copy.deepcopy(page)
   if change=='ownerCollection':bad['items'][0]['collection']='0x'+'1'*40
   elif change=='duplicate':bad['items'][1]=copy.deepcopy(bad['items'][0])
   elif change=='cursor':bad['nextCursor']='2'
   elif change=='opening':bad['items'][0]['isOriginal']=False
   else:bad['items'][0]['requestKey']='wrong'
   with self.assertRaises(RuntimeError,msg=change):C.verify_global(bad)

class PolicyTests(unittest.TestCase):
 def fixture(self):
  historical=A.encoded(history());env=(HERE.parent/'booster-launch/booster-api.env').read_bytes()
  operation=A.encoded({'operatorSha256':P.OPERATOR_SHA});operation_sha=A.sha(operation)
  receipt={'format':'yunipals-booster-recent-openings-api-rollout-v1','completed':True,'operationSha256':operation_sha,
   'newBundleSha256':A.BUNDLE_SHA,'unitSha256':A.UNIT_SHA,'publicEnvironment':'BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-mainnet-standard-v1',
   'databaseWrites':0,'grantChanges':0,'schemaChanges':0,'upstreamProviderCalls':0,'independentActorsUnchanged':True,
   'readiness':{'birthMetadataVerified':True,'globalBrowseVerified':True,'requestMonstersVerified':True,'recentOpeningsVerified':True}}
  current={**A.expected_launch(history()),'sessions':2}
  api={'environmentSha256':A.sha(env),'definitionSha256':A.UNIT_SHA,'bundleSha256':A.BUNDLE_SHA,'ActiveState':'active','SubState':'running','ControlGroup':'/system.slice/yunipals-booster-api.service','InvocationID':'a'*32,'MainPID':'123','ExecMainStartTimestampMonotonic':'123'}
  files={str(A.HISTORICAL):historical,'/etc/yunipals-unified/booster-api.env':env,'/var/backups/yunipals-booster-recent-openings-api-v1-20261023/operation.json':operation}
  return receipt,current,api,files
 def test_actual_new_policy_accepts_only_explicit_current_binding(self):
  receipt,current,api,files=self.fixture();raw=A.encoded(receipt)
  with patch.object(A,'HISTORICAL_SHA',A.sha(files[str(A.HISTORICAL)])),patch.object(A,'protected',side_effect=lambda path:files[str(path)]),patch.object(P,'RECEIPT_SHA',A.sha(raw)),patch.object(P,'ROLLOUT_OPERATION_SHA',receipt['operationSha256']):
   proof=P.validate_owned_feature(raw,current,api,dict(P.QUEUE_INPUTS),A)
   self.assertEqual(proof,P.OwnedFeature(A.sha(raw),P.ROLE,P.ROLE_OID))
   for change in('api','queue','write','missing','limit','otherenv'):
    c,a,q=copy.deepcopy(current),copy.deepcopy(api),dict(P.QUEUE_INPUTS)
    if change=='api':a['bundleSha256']='d'*64
    elif change=='queue':q[next(iter(q))]='d'*64
    elif change=='write':c['tables'][0]['writes']=True
    elif change=='missing':c['tables'].pop()
    elif change=='limit':c['role']['limit']=-1
    else:a['environmentSha256']='d'*64
    with self.assertRaises(RuntimeError,msg=change):P.validate_owned_feature(raw,c,a,q,A)
 def test_rollout_producer_and_each_current_feature_are_required(self):
  receipt,current,api,files=self.fixture()
  for change in('producer','birth','global','claim','recent','catalog','rowwrites'):
   r=copy.deepcopy(receipt);f=dict(files)
   if change=='producer':f['/var/backups/yunipals-booster-recent-openings-api-v1-20261023/operation.json']=A.encoded({'operatorSha256':'0'*64})
   elif change=='birth':r['readiness']['birthMetadataVerified']=False
   elif change=='global':r['readiness']['globalBrowseVerified']=False
   elif change=='claim':r['readiness']['requestMonstersVerified']=False
   elif change=='recent':r['readiness']['recentOpeningsVerified']=False
   elif change=='catalog':r['publicEnvironment']='BOOSTER_ARTWORK_CATALOGS=base-standard-v1'
   else:r['databaseWrites']=1
   raw=A.encoded(r)
   with patch.object(A,'protected',side_effect=lambda path:f[str(path)]),patch.object(P,'RECEIPT_SHA',A.sha(raw)),patch.object(P,'ROLLOUT_OPERATION_SHA',r['operationSha256']):
    with self.assertRaises(RuntimeError,msg=change):P.validate_owned_feature(raw,current,api,dict(P.QUEUE_INPUTS),A)

class AvailabilityTests(unittest.TestCase):
 page=PublicContractTests.page
 def transport(self):
  urls=['https://api.yunipals.com/yunipals-indexer/v1/boosters/art-assets/'+hashlib.sha256(bytes([i])).hexdigest()+('.png'if i==0 else'.svg')for i in range(4)]
  shared={'name':'Yunidragon','image':urls[0],'attributes':[{'trait_type':k,'value':'fixture'}for k in('Type','Color','Horn','Glitter')],
   'yunipals':{'variantId':73,'status':'ready','holo':dict(zip(('foreground','background','stars'),urls[1:]))}}
  birth=copy.deepcopy(shared);birth['yunipals'].update(birthMetadataVersion=1,chainId=8453,collection=C.COLLECTION,tokenId='1',originalTokenId='1',isOriginal=True,birthDay=0,bornAt='1792690409',originalBornAt='1792690409',mint={'blockNumber':'100'},originalMint={'blockNumber':'100'})
  birth['attributes']+=[{'trait_type':'Birth day','display_type':'number','value':0},{'trait_type':'Born','display_type':'date','value':1792690409}]
  calls=[];bad_asset=[False]
  def request(path,public=False,binary=False):
   calls.append((path,public,binary));proof={'path':path,'public':public,'status':200,'cors':'*','sha256':'a'*64,'cacheControl':'public, immutable'}
   if binary:
    proof['sha256']='bad'if bad_asset[0]else path.rsplit('/',1)[-1][:-4]
    return proof,b'fixture'
   snapshot={'ready':True,'engine':C.ENGINE,'collection':C.COLLECTION,'indexedBlock':'52990000','indexedTimestamp':'1792760000','buildId':'6d581272ce'}
   if path in('/readyz','/v1/boosters/types'):value={**snapshot,'items':[{'packTypeId':'1'},{'packTypeId':'2'}]}
   elif path==C.REQUEST_PATH:value={'item':{'id':C.REQUEST_KEY,'status':'completed','quantity':1}}
   elif path==C.REQUEST_PATH+'/monsters':value={'status':'completed','quantity':1,'items':self.page()['items']}
   elif path==C.SHARED_VARIANT_PATH:value=shared
   elif path==C.METADATA_PATH:value=birth
   elif path==C.GLOBAL_PATH:value=self.page()
   elif path==C.RECENT_PATH:value={**snapshot,'enabled':True,'chainId':8453,'items':[{'requestKey':C.REQUEST_KEY,'requestId':C.REQUEST_ID,'engine':C.ENGINE,'opening':True,'quantity':1,'revealedAt':'1792690409','monster':{**self.page()['items'][0],'mintBlock':'52950400','mintedTo':'0x'+'1'*40}}]}
   else:raise AssertionError(path)
   return proof,copy.deepcopy(value)
  return request,shared,calls,bad_asset
 def test_real_contract_checks_map_public_readiness_and_verify_all_four_assets(self):
  request,shared,calls,bad=self.transport();original=C.sha
  digest=lambda value:'2dc4fe8be2d14969780fbef59d62f85cf9ef90eebb95ee0668706c93bd3850cc'if value==C.encoded(shared)else original(value)
  with patch.object(C,'sha',side_effect=digest):result=C.availability(request,400,'6d581272ce')
  self.assertEqual(len(result['cachedArtwork']),4)
  self.assertNotIn(('/readyz',True,False),calls)
  self.assertIn(('/v1/boosters/types',True,False),calls)
  self.assertTrue(result['birthMetadataVerified']and result['globalBrowseVerified']and result['requestMonstersVerified']and result['recentOpeningsVerified'])
  self.assertIn((C.RECENT_PATH,True,False),calls)
  bad[0]=True
  with patch.object(C,'sha',side_effect=digest):
   with self.assertRaisesRegex(RuntimeError,'approved_image_bytes'):C.availability(request,400,'6d581272ce')
 def test_wrong_current_build_or_insufficient_prefix_refuses(self):
  request,shared,calls,bad=self.transport()
  with self.assertRaisesRegex(RuntimeError,'current_native_API_prefix'):C.availability(request,52990001,'6d581272ce')
  with self.assertRaisesRegex(RuntimeError,'current_native_API_prefix'):C.availability(request,400,'wrong')

class RecentContractTests(unittest.TestCase):
 def fixture(self):
  return {'enabled':True,'chainId':8453,'engine':C.ENGINE,'collection':C.COLLECTION,'indexedBlock':'52990000','indexedTimestamp':'1792760000',
   'items':[{'requestKey':C.REQUEST_KEY,'requestId':C.REQUEST_ID,'engine':C.ENGINE,'opening':True,'quantity':1,'revealedAt':'1792690409',
    'monster':{'id':'8453:'+C.COLLECTION+':1','collection':C.COLLECTION,'tokenId':'1','requestKey':C.REQUEST_KEY,'isOriginal':True,'burned':True,'mintedTo':'0x'+'1'*40,'mintBlock':'52950400'}}]}
 def test_historical_cover_and_growing_registered_batch_use_real_response_prefix(self):
  value=self.fixture();self.assertEqual(C.verify_recent(value,{})['requestCount'],1)
  row=value['items'][0];row.update(opening=False,quantity=8);row['monster']['isOriginal']=False
  self.assertEqual(C.verify_recent(value,{})['newestRevealedAt'],'1792690409')
 def test_wrong_identity_future_duplicate_batch_and_pending_refuse(self):
  for kind in('future','duplicate','quantity','request','recipient','block','engine','missingPrefix'):
   value=self.fixture();row=value['items'][0]
   if kind=='future':row['revealedAt']='1792760001'
   elif kind=='duplicate':value['items'].append(copy.deepcopy(row))
   elif kind=='quantity':row['quantity']=2
   elif kind=='request':row['monster']['requestKey']='foreign'
   elif kind=='recipient':row['monster']['mintedTo']='foreign'
   elif kind=='block':row['monster']['mintBlock']='52990001'
   elif kind=='engine':row['engine']='foreign'
   else:value.pop('indexedBlock')
   with self.subTest(kind=kind),self.assertRaises(RuntimeError):C.verify_recent(value,{})

if __name__=='__main__':unittest.main()
