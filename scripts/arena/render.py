"""Six-shot Runware worker. Provider submissions persist before network calls."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from produce import ROOT, save, digest, status, run
from referee import sha

MODEL='xai:grok-imagine@video-1.5-lite'
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def ffmpeg(args):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)


def receipts(pack):
    return [json.loads(p.read_text()) for p in (pack/'scenes').glob('*/*/runs/*/receipt.json')]


def shot(pack,folder,frame,prompt,seconds,outcome_hash):
    folder.mkdir(exist_ok=True)
    target=folder/'first-frame.png'; text=folder/'video-prompt.txt'
    proposed={'provider':'Runware','model':MODEL,'resolution':'720p','durationSeconds':seconds,
              'nativeAudio':True,'generationAllowed':True,'submissionReady':True,'singleSubmissionOnly':True,
              'automaticRetries':0,'outcomeSha256':outcome_hash,'firstFrame':'first-frame.png',
              'firstFrameSha256':digest(frame),'promptFile':'video-prompt.txt','promptSha256':digest(prompt),
              'estimatedUsdPerSecond':.03,'estimatedInputCostUsd':.01,'outputQuality':85}
    manifest=folder/'production-manifest.json'
    if manifest.exists():
        assert json.loads(manifest.read_text())==proposed,'Shot inputs changed; refusing to reuse or overwrite an existing task.'
        assert digest(target)==proposed['firstFrameSha256'] and digest(text)==proposed['promptSha256']
    else:
        shutil.copyfile(frame,target);shutil.copyfile(prompt,text);save(manifest,proposed)
    saved=list((folder/'runs').glob('*/receipt.json'))
    assert len(saved)<=1,'More than one provider task; operator review required.'
    if saved:
        receipt=json.loads(saved[0].read_text());clip=saved[0].parent/'video.mp4'
        if receipt['status']=='completed' and clip.exists():
            assert digest(clip)==receipt['videoSha256'];return clip
        command=['--resume',str(saved[0].parent)]
    else:
        # Reserve outstanding/ambiguous tasks at their estimate, not zero.
        reserved=sum(r.get('actualCostUsd') if r.get('actualCostUsd') is not None else r.get('estimatedCostUsd',0) for r in receipts(pack))
        assert reserved+seconds*.03+.01<=1.00001,'Approved $1 video submission cap reached.'
        command=['--generate']
    status(pack,'generating-video',message=f'Generating {folder.parent.name} {folder.name}; frozen result unchanged.',completedShots=sum(r['status']=='completed' for r in receipts(pack)))
    run([sys.executable,str(ROOT/'scripts/islands/run_runware_race.py'),'--manifest',str(manifest),*command],folder/'provider.log')
    saved=list((folder/'runs').glob('*/receipt.json'));assert len(saved)==1
    receipt=json.loads(saved[0].read_text());assert receipt['status']=='completed'
    clip=saved[0].parent/'video.mp4';assert digest(clip)==receipt['videoSha256']
    return clip


def render(pack,frozen,locked):
    revisions=json.loads((pack/'video-revisions.json').read_text()) if (pack/'video-revisions.json').exists() else {}
    revision_hash=sha(revisions)
    if (pack/'public/film.json').exists():
        film=json.loads((pack/'public/film.json').read_text())
        assert digest(pack/'public/film.mp4')==film['sha256']
        if film.get('revisionSha256',sha({}))==revision_hash: return
        archive=pack/'previous-edits'/film['sha256'];archive.mkdir(parents=True,exist_ok=True)
        for name in ['film.mp4','native-sfx.mp4','film.json']: shutil.copyfile(pack/'public'/name,archive/name)
    # Verify all initial assets before buying any videos; freeze the artwork set.
    frames={m['id']:pack/'scenes'/m['id']/'first-frame.png' for m in locked['outcome']['matches']}
    assert all(f.is_file() for f in frames.values()),'Prepare all three opening frames first.'
    artwork={'outcomeSha256':locked['outcomeSha256'],'images':{k:digest(v) for k,v in frames.items()}}
    image_lock=pack/'artwork-lock.json'
    if image_lock.exists(): assert json.loads(image_lock.read_text())==artwork,'Opening artwork changed'
    else: save(image_lock,artwork)
    for mid,frame in frames.items(): shutil.copyfile(frame,pack/'public'/f'{mid}.png')
    selection=[];roster={f['id']:f for f in frozen['input']['roster']}
    for match in locked['outcome']['matches']:
        mid=match['id'];folder=pack/'scenes'/mid
        public_frame=pack/'public'/f'{mid}.png';shutil.copyfile(frames[mid],public_frame)
        opening=shot(pack,folder/'opening',frames[mid],folder/'opening-prompt.txt',3,locked['outcomeSha256'])
        continuity=folder/'continuation-frame.png'
        if not continuity.exists():
            ffmpeg(['-i',opening,'-vf',"fps=24,select=eq(n\\,71)",'-frames:v','1',continuity])
            save(folder/'continuity.json',{'sourceSha256':digest(opening),'retainedFrames':[0,71],'frameIndex':71,'fps':24,'frameSha256':digest(continuity)})
        else:
            evidence=json.loads((folder/'continuity.json').read_text())
            assert evidence['sourceSha256']==digest(opening) and evidence['frameSha256']==digest(continuity)
        revision=revisions.get(mid,{}).get('continuation','continuation')
        assert revision in ['continuation','continuation-r2'],'Only explicit operator revision supported'
        continuation=shot(pack,folder/revision,continuity,folder/f'{revision}-prompt.txt',5,locked['outcomeSha256'])
        label=f'{mid}  |  {roster[match["fighterIds"][0]]["name"]} vs {roster[match["fighterIds"][1]]["name"]}'
        selection.extend([{'source':str(opening),'start':0,'seconds':3,'label':label},
                          {'source':str(continuation),'start':1/24,'seconds':5,'label':label,
                           'winner':roster[match['winnerId']]['name']+' wins  |  '+match['verdict'].replace('-',' ')}])
        all_receipts=receipts(pack)
        status(pack,'generating-video',completedShots=min(6,len(all_receipts)),actualVideoCostUsd=round(sum(r.get('actualCostUsd') or 0 for r in all_receipts),4))
    assemble(pack,frozen,locked,selection,revision_hash)


def assemble(pack,frozen,locked,selection,revision_hash,image_provider='ChatGPT imagegen'):
    status(pack,'assembling',message='Joining matched frames and mixing native combat effects with credited action music.')
    save(pack/'selected-footage.json',selection)
    edit=pack/'edit';edit.mkdir(exist_ok=True)
    for index,s in enumerate(selection):
        label=edit/f'{index}-label.txt';label.write_text(s['label'])
        vf=(f'fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=0.1,trim=duration={s["seconds"]},setpts=PTS-STARTPTS,'
            f'drawbox=x=0:y=0:w=iw:h=46:color=0x0e1522@0.75:t=fill,drawtext=fontfile={FONT}:textfile={label}:fontsize=19:fontcolor=white:x=22:y=13')
        if s.get('winner'):
            winner=edit/f'{index}-winner.txt';winner.write_text(s['winner'])
            vf+=f",drawbox=x=20:y=650:w=1240:h=48:color=0x0e1522@0.8:t=fill:enable='gte(t,3)',drawtext=fontfile={FONT}:textfile={winner}:fontsize=22:fontcolor=0xffd477:x=36:y=663:enable='gte(t,3)'"
        af=f'atrim=duration={s["seconds"]},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,afade=t=in:d=0.02,afade=t=out:st={s["seconds"]-.04}:d=0.04'
        ffmpeg(['-ss',s['start'],'-i',s['source'],'-vf',vf,'-af',af,'-map','0:v:0','-map','0:a:0','-t',s['seconds'],'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',edit/f'{index}.mp4'])
    concat=edit/'concat.txt';concat.write_text(''.join(f"file '{i}.mp4'\n" for i in range(6)))
    native=pack/'public/native-sfx.mp4'
    ffmpeg(['-f','concat','-safe','0','-i',concat,'-map','0:v:0','-map','0:a:0','-c','copy','-t','24','-movflags','+faststart',native])
    music=ROOT/'docs/islands/race-film-v4/audio/split-in-synapse-original.mp3';film=pack/'public/film.mp4'
    ffmpeg(['-i',native,'-i',music,'-filter_complex','[0:a]volume=0.9[sfx];[1:a]atrim=duration=24,asetpts=PTS-STARTPTS,volume=0.18,afade=t=in:d=0.25,afade=t=out:st=23:d=1[music];[sfx][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=false[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t','24','-movflags','+faststart',film])
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(film)]))
    video=next(s for s in probe['streams'] if s['codec_type']=='video')
    assert (video['width'],video['height'],video['r_frame_rate'],int(video['nb_frames']))==(1280,720,'24/1',576)
    assert abs(float(probe['format']['duration'])-24)<.05
    save(pack/'public/film.json',{'sha256':digest(film),'outcomeSha256':locked['outcomeSha256'],'probe':probe,'shots':6,'revisionSha256':revision_hash,'visualReview':'pending','audioListeningReview':'pending'})
    (pack/'public/credits.txt').write_text(f'Yunipals Arena — tournament {frozen["input"]["tournamentId"]}.\nNFT artwork: Yunipals collection; original token links in frozen input.\nOpening compositions: {image_provider}. Video: Grok Imagine Video 1.5 Lite via Runware, 720p.\nMusic: "Split In Synapse" by Kevin MacLeod (incompetech.com).\nSource: https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100703\nCreative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/\nChanges: 24-second excerpt, level, fades, native SFX mix. Keep credit when sharing.\n')
    safe_receipts=[{k:r.get(k) for k in ['taskUUID','model','status','actualCostUsd','estimatedCostUsd','videoSha256','videoSeconds']} for r in receipts(pack)]
    save(pack/'public/receipts.json',safe_receipts)
    status(pack,'review-ready',completedShots=6,actualVideoCostUsd=round(sum(r['actualCostUsd'] or 0 for r in safe_receipts),4),message='24-second film assembled. Review the visible hits, defeat poses and native audio.',generationTasks=len(safe_receipts))
