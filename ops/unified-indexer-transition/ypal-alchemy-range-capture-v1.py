#!/usr/bin/env python3
"""Capture fresh retained checkpoints and eight bounded free RPC observations.

Default is source-only; --capture writes one exclusive root-private raw receipt.
No service, database, permission or financial admission is changed.
"""
import argparse
import json


def capture():
    import os
    import socket
    if os.geteuid() != 0 or os.getegid() != 0 or socket.gethostname() != "yunipals-main":
        raise RuntimeError("fixed_root_source_capture_host_required")
    if os.path.lexists("/var/backups/yunipals-alchemy-catchup-range-input-v1-20261024") or os.path.lexists("/var/backups/yunipals-ypal-alchemy-catchup-financial-v1-20261024"):
        raise RuntimeError("fresh_pre_financial_capture_paths_required")
    import datetime,hashlib,json,signal,types,urllib.request
    from pathlib import Path
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(RuntimeError('bounded_chain_gap_observation_expired')));signal.alarm(100)
    p=Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-source-tail-restore-v1.py');raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()=='de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'
    s=types.ModuleType('all_chain_gap_readonly');s.__file__=str(p);exec(compile(raw,str(p),'exec'),s.__dict__);r,m,h,op=s.load()
    receipt_raw=(s.BASE/'result.json').read_bytes();assert hashlib.sha256(receipt_raw).hexdigest()=='0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1';receipt=json.loads(receipt_raw);actor=h.actor(r.SOURCE);assert s.canonical_actor(actor)==receipt['source']
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));heads=[]
    headers={'content-type':'application/json','x-yunipals-rpc-workload':'unified_source','x-yunipals-unified-rpc-profile':'0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'}
    for chain,port in [(1,19221),(8453,19222),(137,19223),(56,19224)]:
     req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/unified',data=json.dumps([{'jsonrpc':'2.0','id':1,'method':'eth_chainId','params':[]},{'jsonrpc':'2.0','id':2,'method':'eth_getBlockByNumber','params':['latest',False]}]).encode(),headers=headers)
     with opener.open(req,timeout=18)as response:
      raw=response.read(1000001);assert response.status==200 and len(raw)<=1000000;values={v['id']:v for v in json.loads(raw)};assert len(values)==2 and all('error'not in v for v in values.values());assert int(values[1]['result'],16)==chain;block=values[2]['result']
     now=datetime.datetime.now(datetime.timezone.utc);age=now.timestamp()-int(block['timestamp'],16);assert -10<=age<=120
     heads.append({'chainId':chain,'observedAt':now.isoformat(),'headBlock':int(block['number'],16),'headHash':block['hash'],'headTimestamp':int(block['timestamp'],16),'headAgeSeconds':round(age,2)})
    n=h.native();assert n['tables']==receipt['native']['tables']and s.canonical_actor(h.actor(r.SOURCE))==receipt['source']
    import os,re,socket
    assert os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main'
    with opener.open('http://127.0.0.1:9028/metrics',timeout=8)as response:
     raw=response.read(2000001);assert response.status==200 and len(raw)<=2000000
    sync={name:int(number)for name,number in re.findall(r'^ponder_sync_block\{chain="([a-z]+)"\}\s+([0-9]+)(?:\.0)?$',raw.decode(),re.M)}
    assert set(sync)=={'mainnet','base','polygon','bnb'}
    source=s.canonical_actor(actor)
    encoded=lambda v:(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
    sha=lambda raw:hashlib.sha256(raw).hexdigest()
    base=Path('/var/backups/yunipals-alchemy-catchup-range-input-v1-20261024');assert not os.path.lexists(base);base.mkdir(mode=0o700)
    value={'format':'yunipals-alchemy-range-actual-capture-v1','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'databaseClockMilliseconds':n['clock'],'source':source,'sourceActorSha256':sha(encoded(source)),'heads':heads,'checkpoints':n['checkpoints'],'sync':sync,'schemaOid':n['schemaOid'],'buildId':n['app']['build_id'],'frameworkReady':n['app']['is_ready'],'native44IdentitySha256':sha(encoded(n['tables'])),'restoreResultSha256':'0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1','boundedProviderRPCRequests':8,'databaseWrites':0,'serviceActions':0}
    raw=encoded(value);fd=os.open(base/'raw.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
    assert s.canonical_actor(h.actor(r.SOURCE))==source
    public={k:v for k,v in value.items()if k!='source'};public['actualRawResultSha256']=sha(raw);print(json.dumps(public,sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true")
    args = parser.parse_args()
    if args.capture:
        capture()
    else:
        print(json.dumps({"sourceOnly": True, "providerCalls": 0, "databaseWrites": 0, "serviceActions": 0}))


if __name__ == "__main__":
    main()
