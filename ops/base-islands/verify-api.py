"""Verify live database-backed island APIs; performs no blockchain calls."""
import json,sys,time,urllib.request
from pathlib import Path
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:9016'
def read(path):
 with urllib.request.urlopen(urllib.request.Request(base+path,headers={'User-Agent':'Yunipals-Base-Islands-Acceptance/1.0'}),timeout=20) as r:return json.load(r)
status=read('/v2/islands/indexing-status')
assert all(status['collections'][id]['ready'] for id in ['ethereum-islands','base-islands']),status
stats=read('/v2/islands/stats');assert stats['activeSupply']==1796 and stats['originals']==898 and stats['airdropped']==898 and stats['complete'],stats
seen=set();cursor=None;pages=0
while True:
 page=read('/v2/islands/tokens?limit=100'+('&cursor='+cursor if cursor else ''))
 assert page['complete'] and not page['unavailableCollections']
 for token in page['items']:
  identity=(token['collectionId'],token['tokenId'])
  assert identity not in seen;seen.add(identity)
  assert token['metadataStatus']=='published' and token['metadata']
  assert token['counterpart']['tokenId']==token['tokenId']
  assert token['counterpart']['collectionId']!=token['collectionId']
  assert token['airdrop']['snapshotBlock']=='25694139'
 cursor=page['nextCursor'];pages+=1
 if not cursor:break
assert len(seen)==1796
for id in ['1','1001']:
 pair=read('/v2/islands/tokens?tokenId='+id)['items'];assert len(pair)==2
 for collection in ['ethereum-islands','base-islands']:
  token=read('/v2/collections/'+collection+'/tokens/'+id)
  # Collection detail is an envelope with a token item.
  token=token.get('token',token.get('item',token))
  assert token['collectionId']==collection and token['tokenId']==id
  assert token['chainId']==(8453 if collection=='base-islands' else 1)
report={'verifiedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'api':base,'activeNFTs':1796,'originals':898,'airdropped':898,'paginationPages':pages,'distinctIdentities':len(seen),'metadataAndCounterpartsVerified':True,'readiness':status}
print(json.dumps(report,indent=2))
