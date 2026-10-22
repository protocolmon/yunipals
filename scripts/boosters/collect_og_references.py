"""Collect exact OG species/color references from the public Yunipals indexer."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
from PIL import Image
from art_lab import DEFAULT_LAB, DICTIONARY, register_palette, read_json, write_json

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
LEGACY = {'Yuniair':'Uniair','Yunidonkey':'Unidonkey','Yunibranch':'Unibranch','Yunidragon':'Unidragon','Yunicursed':'Unicursed','Yunikles':'Unikles','Yuniturtle':'Uniturtle','Yuniaqua':'Uniaqua','Yunichick':'Unichick','Yunisheep':'Unisheep','Yunifairy':'Unifairy'}

def fetch(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent':UA,'Origin':'https://www.yunipals.com'})
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read(8*1024*1024+1)
            if len(body)>8*1024*1024: raise ValueError('Reference exceeds 8 MB')
            return body
        except Exception:
            if attempt==2: raise
            time.sleep(attempt+1)

def collect(lab, api):
    dictionary=read_json(DICTIONARY)
    existing=read_json(lab/'references.json').get('palettes',{})
    def one(pair):
        species,color=pair;key=species+':'+color
        if key in existing:
            return {'key':key,'status':'existing','image':existing[key]['image']}
        try:
            query=urllib.parse.urlencode([('limit',1),('traitType','Type'),('traitValue',LEGACY[species]),('traitType','Color'),('traitValue',color),('traitType','Glitter'),('traitValue','None')])
            url=api.rstrip('/')+'/v1/tokens?'+query
            data=json.loads(fetch(url));item=data['items'][0]
            attrs={a['trait_type']:a['value'] for a in item['attributes']}
            if attrs.get('Type')!=LEGACY[species] or attrs.get('Color')!=color:raise ValueError('Indexer reference traits mismatch')
            image_url=item['image']
            if urllib.parse.urlparse(image_url).scheme!='https':raise ValueError('Expected HTTPS OG artwork')
            with Image.open(BytesIO(fetch(image_url))) as im:
                normalized=lab/'references'/('og-'+species.lower()+'-'+color.lower()+'.png')
                im.convert('RGB').save(normalized)
            evidence={k:item.get(k) for k in ['chain','chainId','contractAddress','tokenId','image','attributes','tokenUri','uriProvenance','uriAuditStatus']}
            evidence['lookupUrl']=url
            write_json(normalized.with_suffix('.metadata.json'),evidence)
            description=f'Match the complete original {color} {LEGACY[species]} colorway visible in this exact OG image: primary skin, hair/mane/feathers, shell, fins, feet, iris, markings and accessories, including highlights and shadows. Preserve the original hue and saturation of each corresponding region. The requested booster horn overrides the reference horn.'
            registered=register_palette(lab,color,normalized,description,f'OG {LEGACY[species]} #{item["tokenId"]}; {item["chain"]}; {item["tokenUri"]}; image {image_url}; source metadata in {normalized.with_suffix(".metadata.json")}',species)
            return {'key':key,'status':'registered','image':registered['image'],'tokenId':item['tokenId'],'chain':item['chain']}
        except Exception as error:
            return {'key':key,'status':'missing','error':str(error)}
    pairs=[(t['name'],c['name']) for t in dictionary['types'] for c in dictionary['colors']]
    with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(one,pairs))
    report={'expected':66,'available':sum(r['status']!='missing' for r in results),'missing':[r for r in results if r['status']=='missing'],'references':results}
    write_json(lab/'reference-inventory.json',report)
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lab',type=Path,default=DEFAULT_LAB)
    parser.add_argument('--api',default='https://api.yunipals.com/yunipals-indexer')
    args=parser.parse_args();report=collect(args.lab,args.api)
    print(json.dumps({k:v for k,v in report.items() if k!='references'}))
    raise SystemExit(0 if not report['missing'] else 1)
