#!/usr/bin/env python3
"""Render the three-file source008 overlay. Default prints hashes; no runtime/SQL/RPC actions."""
import argparse
import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOURCE = '008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
BASE_MANIFEST = '55017c503920ddf2d4083bee2425d4daed656cafd0d36e4f88a6352d5903d15d'
BASE_PINS = {'apps/yunipals-indexer/ponder.config.ts':'9a52e04cba44e2903c53bf497a37eeed6e63efd793f1639f29a48a92dc1bfd77','apps/yunipals-indexer/lib/boosters/config.ts':'eba43d7cb6df3bab3d4e4627523fc0984a602a4996159e1ebb6f3a08e8a34e01'}
RPC_SHA = '1b9ff9fc67138d008bab65626228cef3b3c6e664e74a32d23ec36c82077c9ba8'
MANIFEST_HASH = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
PROFILE_ID = '0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'
SCHEMA = 'unified_ypal_20261023_v1'
UNIT = 'yunipals-ypal-combined-source.service'
AREA = '/var/lib/yunipals-unified-ypal/combined-v1-source008'
PROJECT = '/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer'
OPS = '/opt/yunipals-unified/operations/free-replay-20261020'
PROFILE_FILE = OPS + '/ypal-combined-rpc-v1/profile.json'
sha = lambda b: hashlib.sha256(b).hexdigest()
encoded = lambda v: (json.dumps(v,indent=2,ensure_ascii=False)+'\n').encode()
def require(ok, code):
    if not ok: raise ValueError(code)
def once(text, old, new):
    require(text.count(old)==1, 'exact_original_patch_anchor_required'); return text.replace(old,new)
def render(base, rpc_file):
    raw=(base/'BASE-SOURCE-MANIFEST.json').read_bytes();require(sha(raw)==BASE_MANIFEST,'exact_source008_manifest_required');manifest=json.loads(raw);rows=manifest['files'];require(manifest['sourceDigest']==sha(encoded(rows))==SOURCE,'actual_source008_rows_required')
    data={p:(base/p).read_bytes()for p in BASE_PINS};require(all(sha(data[p])==pin for p,pin in BASE_PINS.items()),'exact_original_source008_config_required')
    rpc=rpc_file.read_bytes();require(sha(rpc)==RPC_SHA,'retained_Base1_transport_required')
    confirmed_raw=(REPO/'docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json').read_bytes();require(sha(confirmed_raw)=='3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c','exact_actual_YPAL_deployment_required');confirmed=json.loads(confirmed_raw)
    profile=json.loads((HERE.parent/'ypal-combined-rpc-profile-v1.json').read_bytes());future=profile['manifest'];names={'BoosterRegistry':'registry','BoosterEngine':'engine','BoosterMonsters':'monsters'}
    starts={name:int(confirmed['receipts'][key]['blockNumber'])for name,key in names.items()};addresses={name:confirmed[key].lower()for name,key in names.items()}
    require(all(any(s['contractName']==name and s['address']==addresses[name]and int(s['startBlock'])==starts[name]for s in future['sources'])for name in names),'manifest_matches_actual_CREATE_receipts_required')
    boosters=data['apps/yunipals-indexer/lib/boosters/config.ts'].decode()
    guard='''  const expected = {
    BOOSTER_REGISTRY: "'''+addresses['BoosterRegistry']+'''",
    BOOSTER_ENGINE: "'''+addresses['BoosterEngine']+'''",
    BOOSTER_MONSTERS: "'''+addresses['BoosterMonsters']+'''",
    BOOSTER_WRAPPER: "'''+confirmed['vrfWrapper'].lower()+'''"
  };
  for (const [key, address] of Object.entries(expected))
    if (env[key]?.toLowerCase() !== address)
      throw new Error("The combined source requires the confirmed fresh YPAL stack.");
  if (startBlock !== '''+str(min(starts.values()))+''')
    throw new Error("The combined source requires the actual first YPAL proxy block.");
'''
    boosters=once(boosters,'  return {\n    registry: env.BOOSTER_REGISTRY!',guard+'  return {\n    registry: env.BOOSTER_REGISTRY!')
    for name in names:
        marker='    '+name+': {';start=boosters.index(marker);end=boosters.index('\n    }',start);chunk=boosters[start:end];changed=once(chunk,'startBlock: deployment?.startBlock ?? 0','startBlock: deployment ? '+str(starts[name])+' : 0');boosters=boosters[:start]+changed+boosters[end:]
    config=data['apps/yunipals-indexer/ponder.config.ts'].decode();config=once(config,'  buildSourceManifest\n','  buildSourceManifest,\n  sourceManifestHash\n');config=once(config,'const sourceManifest = buildSourceManifest();','const sourceManifest = buildSourceManifest();\nif (sourceManifestHash(sourceManifest) !== "'+MANIFEST_HASH+'")\n  throw new Error("The full combined YPAL manifest differs from the reviewed profile.");');config=once(config,'database: { kind: "postgres" }','database: { kind: "postgres", poolConfig: { max: 5 } }')
    transport=rpc.decode()
    for old,new in ((19201,19221),(19202,19222),(19203,19223),(19204,19224)):
        transport=once(transport,'http://127.0.0.1:'+str(old)+'/unified','http://127.0.0.1:'+str(new)+'/unified')
    overlay={'ponder.config.ts':config.encode(),'booster-config.ts':boosters.encode(),'rpc-preflight.ts':transport.encode()};targets={'ponder.config.ts':'apps/yunipals-indexer/ponder.config.ts','booster-config.ts':'apps/yunipals-indexer/lib/boosters/config.ts','rpc-preflight.ts':'apps/yunipals-indexer/lib/unified/rpc-preflight.ts'}
    replacement={targets[p]:b for p,b in overlay.items()};new_rows=[{**r,'sha256':sha(replacement[r['path']]),'bytes':len(replacement[r['path']])}if r['path']in replacement else r for r in rows]
    values={'BOOSTER_REGISTRY':addresses['BoosterRegistry'],'BOOSTER_ENGINE':addresses['BoosterEngine'],'BOOSTER_MONSTERS':addresses['BoosterMonsters'],'BOOSTER_WRAPPER':confirmed['vrfWrapper'].lower(),'BOOSTER_DEPLOYMENT_BLOCK':str(min(starts.values())),'PONDER_BOOSTERS_ONLY':'false','PONDER_ISLANDS_ONLY':'false','BNB_CONFIRMATIONS':'20','UNIFIED_BASE_ISLANDS_V2_ENABLED':'true','UNIFIED_ARENA_DEPLOYMENTS':json.dumps([{'address':x['address'],'startBlock':int(x['startBlock'])}for x in future['sources']if x['feature']=='arena'and x['enabled']],separators=(',',':')),'MARKET_BNB_DISCOVERY_START_BLOCK':next(x['startBlock']for x in future['sources']if x['id']=='marketplace:bnb:seaport'),'UNIFIED_RECEIPT_HISTORY_JSON':json.dumps({x['id']:int(x['receiptStartBlock'])for x in future['sources']if 'receiptStartBlock'in x},separators=(',',':')),'DATABASE_SCHEMA':SCHEMA,'UNIFIED_RPC_POLICY_REQUIRED':'true','UNIFIED_RPC_FREE_ONLY':'true','UNIFIED_RPC_PROFILE_FILE':PROFILE_FILE,'UNIFIED_RPC_PROFILE_ID':PROFILE_ID,'UNIFIED_RPC_REPLAY_PERMIT_ID':'',**{'UNIFIED_RPC_REPLAY_PERMIT_ID_'+str(c):''for c in (1,56,137,8453)},**{'PONDER_RPC_URL_'+str(c):'http://127.0.0.1:'+str(p)+'/unified'for c,p in ((1,19221),(8453,19222),(137,19223),(56,19224))}}
    overlay['combined.public.env']=(''.join(k+'='+v+'\n'for k,v in values.items())).encode()
    result={'format':'yunipals-ypal-combined-source-render-v1','baseSourceDigest':SOURCE,'candidateSourceDigest':sha(encoded(new_rows)),'candidateSourceRows':len(new_rows),'changedSourcePaths':sorted(replacement),'fileHashes':{p:sha(b)for p,b in overlay.items()},'unit':UNIT,'schema':SCHEMA,'area':AREA,'project':PROJECT,'profileId':PROFILE_ID,'manifestHash':MANIFEST_HASH,'profileFile':PROFILE_FILE,'databasePoolMax':5,'baseSourceConcurrency':1,'paidAuthority':False,'replayPermits':[],'productionRegistered':False,'productionStarted':False,'nativeCheckpointCopied':False}
    overlay['CANDIDATE-SOURCE-MANIFEST.json']=encoded({**manifest,'sourceDigest':result['candidateSourceDigest'],'files':new_rows,'baseSourceDigest':SOURCE});overlay['render.json']=encoded(result);return overlay,result

def main():
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('--base-root',required=True,type=Path);a.add_argument('--rpc-file',type=Path,default=HERE.parent/'source6-base-priority-rpc.ts');a.add_argument('--write-new',type=Path);args=a.parse_args();overlay,result=render(args.base_root,args.rpc_file)
    if args.write_new:
        args.write_new.mkdir(mode=0o755,parents=False,exist_ok=False)
        for name,raw in overlay.items():
            fd=os.open(args.write_new/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
            with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
