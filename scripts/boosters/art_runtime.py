"""Publish approved variant artwork and process local Codex-assisted jobs.

Publication is immutable per catalog/variant. This never calls an image API.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse
from art_lab import DEFAULT_LAB, DICTIONARY, ROOT, RECIPE_VERSION, asset, digest, locked, next_stage, prepare, read_json, run_path, snapshot, variant_traits, write_json

DEFAULT_DIRECTORY=ROOT/'docs/boosters/artwork-runtime'
CATALOG_HASH='0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733'

def catalog_path(directory, slug):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',slug):raise ValueError('Invalid catalog slug')
    return directory/'catalogs'/slug

def init_catalog(lab,directory,slug,public_url):
    url=urlparse(public_url)
    if url.scheme!='https' and not(url.scheme=='http' and url.hostname in ['localhost','127.0.0.1']):raise ValueError('Use HTTPS or loopback HTTP')
    if url.username or url.password or url.query or url.fragment:raise ValueError('Use a clean public origin URL')
    registry=read_json(lab/'references.json');dictionary=read_json(DICTIONARY)
    references={}
    for typ in dictionary['types']:
        for color in dictionary['colors']:
            key=typ['name']+':'+color['name'];ref=registry.get('palettes',{}).get(key)
            if not ref:raise ValueError('Missing exact OG reference: '+key)
            references[key]={'sha256':snapshot(lab,ref['image'])['sha256'],'source':ref['source'].split('; source metadata in ')[0]}
    descriptor={'schemaVersion':1,'slug':slug,'catalogHash':CATALOG_HASH,'dictionary':dictionary,'recipeVersion':RECIPE_VERSION,'recipeSourceSha256':digest((ROOT/'scripts/boosters/art_lab.py').read_bytes()),'references':references,'styleLock':registry['designLock'],'logoSha256':snapshot(lab,registry['logo'])['sha256'],'metadataBaseURI':public_url.rstrip('/')+'/v1/boosters/art/'+slug+'/'}
    descriptor['styleLock']={**descriptor['styleLock'],'styles':{k:{'sha256':v['sha256']} for k,v in descriptor['styleLock']['styles'].items()}}
    commitment=digest(json.dumps(descriptor,sort_keys=True,separators=(',',':')).encode())
    descriptor['artworkHash']='0x'+commitment
    target=catalog_path(directory,slug)/'manifest.json'
    with locked(directory):
        if target.exists() and read_json(target)!=descriptor:raise ValueError('Catalog already frozen; choose a new slug for different rules/references')
        write_json(target,descriptor)
    return descriptor

def shader_maps():
    source=ROOT/'scripts/boosters/artwork'
    code="const fs=require('fs'),vm=require('vm');const read=(p,n)=>vm.runInNewContext(fs.readFileSync(p,'utf8')+';JSON.stringify('+n+')');process.stdout.write(JSON.stringify({monster:JSON.parse(read(process.argv[1],'ART_MONSTER_SILHOUETTES')),stars:JSON.parse(read(process.argv[2],'ART_STAR_MAPS'))}));"
    return json.loads(subprocess.check_output(['node','-e',code,str(source/'monster-depth.js'),str(source/'star-highlights.js')],text=True))

def validate_masks(data,sha):
    if data.get('sha256')!=sha:raise ValueError('Masks must match the exact artwork SHA256')
    path=data.get('foreground');points=data.get('stars')
    if not isinstance(path,str) or not path.strip().startswith('M') or not re.fullmatch(r'[MmLlHhVvCcSsQqTtAaZz0-9.,+eE\s-]{1,100000}',path):raise ValueError('Use only a numeric SVG foreground path')
    if not isinstance(points,list) or not 1<=len(points)<=300:raise ValueError('Provide 1-300 calibrated star points')
    for point in points:
        if not isinstance(point,list) or len(point)!=3 or any(type(v) not in (int,float) for v in point):raise ValueError('Each star needs numeric x,y,r')
        x,y,r=point
        if not(0<=x<=1024 and 0<=y<=1536 and 0<r<=100):raise ValueError('Star outside the native 1024x1536 artwork')
    return path,points

def register_masks(directory,image,mapping):
    sha=digest(image.read_bytes());data=read_json(mapping);validate_masks(data,sha)
    target=directory/'masks'/(sha+'.json')
    with locked(directory):
        if target.exists() and read_json(target)!=data:raise ValueError('Masks already registered for this artwork')
        write_json(target,data)
    return {'sha256':sha,'masks':str(target)}

def publish(lab,directory,slug,run_id,stage=None):
    run=read_json(run_path(lab,run_id));next_stage(lab,run_id)
    if run['review']['decision']!='accepted':raise ValueError('Only explicitly approved artwork can be published')
    stage=stage or run['stageOrder'][-1];record=run['stages'][stage]
    traits=run['traits'];rank=traits['variantId'];expected=variant_traits(traits['type'],traits['color'],traits['horn'],traits['glitter'])
    if expected!=traits:raise ValueError('Variant traits mismatch')
    catalog=catalog_path(directory,slug);manifest=read_json(catalog/'manifest.json')
    sha=record['sha256'];source=asset(lab,record['path'])
    if digest(source.read_bytes())!=sha:raise ValueError('Artwork fingerprint mismatch')
    if record['qa'].get('visibleCanvasEdgePixels')!=0 or not isinstance(record['qa'].get('visualReview'),dict):raise ValueError('Finalize and visually review the cutout first')
    public=manifest['metadataBaseURI'].split('/v1/boosters/art/')[0]
    assets=directory/'assets';assets.mkdir(parents=True,exist_ok=True)
    def save(data,extension):
        name=digest(data)+'.'+extension;destination=assets/name
        if not destination.exists():destination.write_bytes(data)
        elif destination.read_bytes()!=data:raise ValueError('Asset hash collision')
        return public+'/v1/boosters/art-assets/'+name
    image=save(source.read_bytes(),'png');foil=None
    if traits['glitter']=='Yes':
        calibration=directory/'masks'/(sha+'.json')
        if calibration.exists():
            data=read_json(calibration);path,points=validate_masks(data,sha)
        else:
            maps=shader_maps();path=maps['monster'].get(sha);points=maps['stars'].get(sha)
        if not path or not points:raise ValueError('Holo publication requires calibrated foreground and star masks for this exact image')
        def svg(contents):return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536">'+contents+'</svg>').encode()
        parts=[p.strip() for p in re.split('(?=M)',path) if p.strip()]
        shapes=lambda color:''.join(f'<path d="{p}" fill="{color}"/>' for p in parts)
        foreground=save(svg(shapes('white')),'svg')
        background=save(svg('<defs><mask id="b" mask-type="luminance"><rect width="1024" height="1536" fill="white"/>'+shapes('black')+'</mask></defs><rect width="1024" height="1536" fill="white" mask="url(#b)"/>'),'svg')
        circles=''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#g)"/>' for x,y,r in points)
        stars=save(svg('<defs><radialGradient id="g"><stop stop-color="white"/><stop offset=".28" stop-color="white" stop-opacity=".95"/><stop offset=".65" stop-color="white" stop-opacity=".4"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>'+circles),'svg')
        foil={'foreground':foreground,'background':background,'stars':stars}
    metadata={'name':traits['type'],'description':'A Yunipal from the shared booster collection.','image':image,'attributes':[{'trait_type':label,'value':traits[key]} for label,key in [('Type','type'),('Color','color'),('Horn','horn'),('Glitter','glitter')]],'yunipals':{'version':1,'status':'ready','variantId':rank,'artworkSha256':sha,'catalogCommitment':manifest['artworkHash'],'holo':foil},'provenance':{'runId':run_id,'stage':stage,'recipeVersion':run['recipeVersion']}}
    target=catalog/'variants'/f'{rank}.json'
    with locked(directory):
        if target.exists() and read_json(target)!=metadata:raise ValueError('Variant artwork is already published and cannot be replaced')
        write_json(target,metadata)
    return {'variantId':rank,'metadata':str(target),'sha256':sha}

def jobs(lab,directory,slug):
    catalog=catalog_path(directory,slug);manifest=read_json(catalog/'manifest.json');results=[]
    if manifest['recipeSourceSha256']!=digest((ROOT/'scripts/boosters/art_lab.py').read_bytes()):raise ValueError('Frozen recipe changed; register a new catalog before preparing jobs')
    public=manifest['metadataBaseURI'].split('/v1/boosters/art/')[0]
    init_catalog(lab,directory,slug,public) # Refuse changed reference pixels or style locks.
    for path in sorted((directory/'jobs'/slug).glob('*.json')):
        job=read_json(path);rank=job['variantId']
        if path.name!=f'{rank}.json' or job.get('catalog')!=slug or job.get('catalogHash')!=manifest['catalogHash'] or job.get('schemaVersion')!=1:raise ValueError('Invalid job identity')
        if (catalog/'variants'/f'{rank}.json').exists():continue
        traits=job['traits']
        if variant_traits(traits['type'],traits['color'],traits['horn'],traits['glitter'])['variantId']!=rank:raise ValueError('Invalid queued variant traits')
        try:
            plan=prepare(lab,traits['type'],traits['color'],traits['horn'],traits['glitter']);job.update(status='prepared',runId=plan['runId'],error=None)
        except (ValueError,OSError) as e:job.update(status='blocked',error=str(e))
        write_json(path,job);results.append(job)
    return results

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--lab',type=Path,default=DEFAULT_LAB);p.add_argument('--directory',type=Path,default=DEFAULT_DIRECTORY);p.add_argument('--catalog',default='base-standard-v1-demo')
    sub=p.add_subparsers(dest='command',required=True)
    init=sub.add_parser('init');init.add_argument('--public-url',required=True)
    pub=sub.add_parser('publish');pub.add_argument('--run',required=True);pub.add_argument('--stage')
    masks=sub.add_parser('register-masks');masks.add_argument('--image',required=True,type=Path);masks.add_argument('--map',required=True,type=Path)
    sub.add_parser('jobs')
    a=p.parse_args()
    try:
        result=init_catalog(a.lab,a.directory,a.catalog,a.public_url) if a.command=='init' else publish(a.lab,a.directory,a.catalog,a.run,a.stage) if a.command=='publish' else register_masks(a.directory,a.image,a.map) if a.command=='register-masks' else jobs(a.lab,a.directory,a.catalog)
        print(json.dumps(result,indent=2))
    except (ValueError,OSError,KeyError) as e:p.exit(1,str(e)+'\n')
