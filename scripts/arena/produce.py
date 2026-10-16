"""Durable operator-run arena pipeline. A single frozen candidate, no outcome retries.

Usage: python3 scripts/arena/produce.py UUID --run
After preparing the three first-frame.png assets in scenes/*: same command --video.
Network/paid operations require these explicit flags. State is private; public/ is
an allowlisted projection. Existing ambiguous provider tasks are retrieved only.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.request import urlopen
from uuid import UUID
from referee import canonical, sha, schema, validate, priorities

ROOT=Path(__file__).resolve().parents[2]


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
    temporary.replace(path)


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def status(pack,phase,**more):
    path=pack/'public/status.json'
    prior=json.loads(path.read_text()) if path.exists() else {}
    save(path,{**prior,**more,'phase':phase,'updatedAt':datetime.now(timezone.utc).isoformat()})


def run(args,log):
    with log.open('ab') as out:
        subprocess.run(args,cwd=ROOT,stdout=out,stderr=subprocess.STDOUT,check=True)


def prepare(pack,tid):
    port=int(os.environ.get('ARENA_LAB_PORT','53901'))
    assert 1024<=port<=65535,'Invalid lab port'
    with urlopen(f'http://127.0.0.1:{port}/api/arena/tournaments/{tid}/input') as response:
        frozen=json.load(response)
    assert frozen['input']['rules']['version']=='arena-combat-lab-v2','Old intake-only rules cannot be adjudicated.'
    assert sha(frozen['input'])==frozen['inputSha256'],'Input hash mismatch'
    existing=pack/'public/input.json'
    if existing.exists():
        assert json.loads(existing.read_text())==frozen,'Frozen input changed'
        return frozen
    save(existing,frozen)
    value=frozen['input'];ad=pack/'adjudication';ad.mkdir()
    referee_input=json.loads(json.dumps(value))
    referee_input['pool'].pop('entries')
    referee_input['rules'].pop('refereeInstructions')
    referee_input['sourceInputSha256']=frozen['inputSha256']
    save(ad/'baseline-input.json',referee_input)
    save(ad/'output-schema.json',schema())
    (ad/'referee-system-prompt-v2.txt').write_text(value['rules']['refereeInstructions'])
    (ad/'request-instructions.txt').write_text('Resolve this single tournament. Public tie priority: '+', '.join(priorities(value))+'. Return schema JSON only.\nFROZEN INPUT\n')
    status(pack,'ready',tournamentId=tid,inputSha256=frozen['inputSha256'],model='xai:grok-imagine@video-1.5-lite',resolution='1280x720',durationSeconds=24,estimatedVideoCostUsd=.78,videoCostCapUsd=1.00,actualVideoCostUsd=0)
    return frozen


def resolve(pack,frozen):
    ad=pack/'adjudication';public=pack/'public'
    if (public/'outcome.json').exists():
        locked=json.loads((public/'outcome.json').read_text())
        assert sha(locked['outcome'])==locked['outcomeSha256']
        assert locked['inputSha256']==frozen['inputSha256']
        assert validate(frozen['input'],locked['outcome'])['valid']
        return locked
    runs=sorted((ad/'runs').glob('*/baseline')) if (ad/'runs').exists() else []
    if not runs:
        status(pack,'refereeing',message='The independent LLM is resolving the four locked strategies.')
        run([sys.executable,str(ROOT/'scripts/islands/run_race_adjudication.py'),'--run','--input-dir',str(ad),'--case','baseline','--timeout-seconds','1200'],pack/'referee.log')
        runs=sorted((ad/'runs').glob('*/baseline'))
    assert len(runs)==1,'Refusing multiple candidates or an ambiguous run.'
    candidate=runs[0];receipt=json.loads((candidate/'receipt.json').read_text())
    assert receipt['status']=='completed' and not receipt.get('toolItems'),'Referee incomplete; inspect the existing run, do not reroll.'
    outcome=json.loads((candidate/'outcome.json').read_text());report=validate(frozen['input'],outcome)
    if (public/'validation.json').exists():
        previous=json.loads((public/'validation.json').read_text())
        if previous!=report: save(pack/'validation-before-checker-fix.json',previous)
    save(public/'validation.json',report)
    if not report['valid']:
        status(pack,'validation-failed',message='Candidate retained. Video generation blocked by validation.',validationErrors=report['errors'])
        raise ValueError('Referee failed validation: '+repr(report['errors']))
    locked={'inputSha256':frozen['inputSha256'],'outcomeSha256':sha(outcome),'outcome':outcome,'validation':report,
            'referee':{k:receipt.get(k) for k in ['model','reasoningEffort','elapsedSeconds','usage','completedAt']}}
    save(public/'outcome.json',locked)
    status(pack,'awaiting-artwork',outcomeSha256=locked['outcomeSha256'],championId=outcome['championId'],validationErrors=[],message='Result validated and frozen. Prepare the three opening compositions before footage.')
    return locked


def prompts(pack,frozen,locked):
    value=frozen['input'];roster={f['id']:f for f in value['roster']}
    compiled=[]
    revisions=json.loads((pack/'video-revisions.json').read_text()) if (pack/'video-revisions.json').exists() else {}
    for match in locked['outcome']['matches']:
        folder=pack/'scenes'/match['id'];folder.mkdir(parents=True,exist_ok=True)
        ids=match['fighterIds'];fighters=' LEFT: '+roster[ids[0]]['identity']+' RIGHT: '+roster[ids[1]]['identity']
        frame=('Create one 16:9 cinematic 3D battle opening frame. Match the supplied exact NFT identities and island reference. '
               'Full bodies, permanent horns, determined competitive expressions. No text/UI. Two fighters only, face each other; never face viewer. '
               'Fixed eye-level three-quarter side camera, flat horizon. '+fighters+' '+match['openingState']+
               '\nISLAND: '+value['island']['profile']['geometry']+'\nResident remains small off-stage in its published perch. No added buildings or fighting characters.')
        actual_frame=folder/'frame-generation.json'
        if actual_frame.exists(): frame=json.loads(actual_frame.read_text())['prompt']
        (folder/'frame-prompt.txt').write_text(frame+'\n')
        common=('Real-time fast physical monster battle, cinematic stylized 3D. ONE UNBROKEN WIDE SHOT; fixed camera, no cuts, no slow motion, no zoom/warp. '
                'Keep exact character anatomy, horns always visible, identities and arena from input frame. '+fighters+
                ' Flying fighters stay airborne until defeated, ground fighters do not fly. Every attack must physically travel from attacker to the real opponent. '
                'Show direct impact and body recoil or an actual dodge/shield. No new attacks or effects. No horn emissions. '
                'Native combat SFX: forceful attack whoosh, single contact impact, wings, grit/body landing where visible. No speech, narration, music, neighs, whinnies or horse/clopping sounds. ')
        for part,start,end in [('opening',0,3),('continuation',3,8)]:
            actions=[]
            for event in match['events']:
                if event['outcome']=='interrupted': continue
                if (part=='opening' and event['contact']<=3) or (part=='continuation' and event['contact']>3):
                    contact=min(2.90,event['contact']) if part=='opening' else event['contact']-3
                    actions.append(f"At clip {max(0,event['start']-start):.2f}–{contact:.2f}s: {event['visibleAction']}")
            if part=='opening':
                narrative='THREE SECONDS. Begin before the first attack. '+match['openingState']+' '.join(actions)+' At end: '+match['continuityAtThree']
            else:
                pose=re.sub(r'(\d+(?:\.\d+)?)s\b',lambda m:f'{max(0,float(m.group(1))-3):.2f}s',match['victoryPose'])
                ending=(f" Defeated fighter settled by clip {max(0,match['settledSeconds']-3):.2f}s, stays down through end. No victory before actual contact; no standing up or second attack after defeat."
                        if match['verdict'] != 'decision' else
                        ' This is a decision at the time limit, not a knockout. Preserve both fighters\' recorded final poses and health. Do not invent a hit, collapse or celebration before the verdict.')
                narrative='FIVE SECONDS, EXACT CONTINUATION of the supplied last frame. No reset or replay. '+ ' '.join(actions)+f" Result at clip {max(0,match['verdictSeconds']-3):.2f}s: {match['verdict']}. "+pose+ending
            identity_common=common if part=='opening' else common.replace(fighters,' '+roster[ids[0]]['name']+': '+roster[ids[0]]['identity']+' '+roster[ids[1]]['name']+': '+roster[ids[1]]['identity'])
            prompt=narrative+'\n'+identity_common
            if len(prompt)>4000: raise ValueError(f'{match["id"]}/{part} prompt exceeds provider limit; tighten wording without altering events.')
            (folder/f'{part}-prompt.txt').write_text(prompt+'\n')
            revision=revisions.get(match['id'],{}).get(part)
            if revision:
                prompt=(folder/f'{revision}-prompt.txt').read_text().rstrip()
            compiled.append({'matchId':match['id'],'part':part,'revision':revision,'prompt':prompt,'framePrompt':frame if part=='opening' else 'Exact frame 71 of the opening clip.'})
    save(pack/'public/prompts.json',{'inputSha256':frozen['inputSha256'],'outcomeSha256':locked['outcomeSha256'],'shots':compiled})


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('tournament');parser.add_argument('--run',action='store_true');parser.add_argument('--video',action='store_true');args=parser.parse_args()
    tid=str(UUID(args.tournament));pack=Path(os.environ.get('ARENA_LAB_STATE_DIR',str(ROOT/'.arena-lab')))/'jobs'/tid
    if not (args.run or args.video): print('No requests made. Use --run for referee; --video additionally submits approved footage.');return
    pack.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (pack/'worker.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            frozen=prepare(pack,tid);locked=resolve(pack,frozen);prompts(pack,frozen,locked)
            if args.video:
                from render import render
                render(pack,frozen,locked)
        except Exception as error:
            current=json.loads((pack/'public/status.json').read_text()) if (pack/'public/status.json').exists() else {}
            if current.get('phase')!='validation-failed': status(pack,'needs-attention',message='Existing job retained; inspect operator logs before resuming.')
            raise
    print(pack/'public/status.json')

if __name__=='__main__': main()
