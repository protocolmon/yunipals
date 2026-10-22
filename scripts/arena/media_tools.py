"""Offline production media tools. No credentials, HTTP or generation submissions.

Reads the published settled input/result from a private job directory. The TS worker
owns provider tasks; this process only compiles prompts, extracts a frame or edits
the six already-downloaded clips. It never changes the accepted combat result.
"""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from produce import save, digest, prompts
from referee import sha, validate
from render import assemble, ffmpeg


def locked(pack):
    frozen = json.loads((pack / 'public/input.json').read_text())
    outcome = json.loads((pack / 'public/outcome.json').read_text())
    assert frozen['input']['mode'] == 'base-mainnet'
    assert sha(frozen['input']) == frozen['inputSha256'] == outcome['inputSha256']
    assert sha(outcome['outcome']) == outcome['outcomeSha256']
    assert validate(frozen['input'], outcome['outcome'])['valid']
    return frozen, outcome


def compile_prompts(pack):
    frozen, outcome = locked(pack)
    marker = pack / 'public/prompts.json'
    if marker.exists():
        prior = json.loads(marker.read_text())
        assert prior['inputSha256'] == frozen['inputSha256']
        assert prior['outcomeSha256'] == outcome['outcomeSha256']
        return
    value = frozen['input']; roster = {f['id']: f for f in value['roster']}
    for match in outcome['outcome']['matches']:
        folder = pack / 'scenes' / match['id']; folder.mkdir(parents=True, exist_ok=True)
        left, right = [roster[i] for i in match['fighterIds']]
        # Numeric coordinates/distances previously appeared as labels in image output.
        # Keep those in simulation; image composition uses visual positioning only.
        geometry = re.sub(r'\b\d+(?:\.\d+)?\s*(?:metres|meters|cm|m)\b', '', value['island']['profile']['geometry'])
        frame = ('Create a cinematic landscape 16:9 3D monster battle opening frame. '
                 'Reference one is the exact LEFT fighter, reference two the exact RIGHT fighter, '
                 'reference three the exact island. Preserve the island floor, channels, crossings, '
                 'cover, buildings and resident locations; do not add a central obstacle or rotate the arena layout. '
                 'Low eye-level three-quarter side view, flat horizon, both full bodies and all wingtips visible. '
                 'LEFT faces RIGHT and RIGHT faces LEFT, separated by a clear open fighting gap. '
                 'No attacks yet. Determined competitive expressions. Original horns present from the start; no horn emissions. '
                 'Ground fighters stay grounded; winged fighters hover with tucked feet and separated shadows. '
                 'LEFT anatomy: ' + left['identity'] + ' RIGHT anatomy: ' + right['identity'] +
                 ' Island geometry: ' + geometry +
                 ' The tiny island resident remains small and off the fighting surface. '
                 'No text, measurements, diagrams, guide lines, UI, logos or watermarks.')
        assert len(frame) <= 3000, 'Opening prompt exceeds image model limit'
        save(folder / 'frame-generation.json', {'version': 'arena-api-frames-v1', 'prompt': frame})
    prompts(pack, frozen, outcome)


def extract(pack, match):
    assert match in ['SF1', 'SF2', 'FINAL']
    source = pack / 'provider' / match / 'opening.mp4'
    destination = pack / 'scenes' / match / 'continuation-frame.png'
    receipt = destination.with_suffix('.json')
    if destination.exists() and receipt.exists():
        saved = json.loads(receipt.read_text())
        assert saved['sourceSha256'] == digest(source) and saved['sha256'] == digest(destination)
        return
    temp = destination.with_name('continuation-frame.tmp.png')
    ffmpeg(['-i', source, '-vf', 'fps=24,select=eq(n\\,71)', '-frames:v', '1', temp])
    assert temp.is_file(), 'Opening video has fewer than three seconds'
    temp.replace(destination)
    save(receipt, {'sourceSha256': digest(source), 'sha256': digest(destination), 'frameIndex': 71, 'fps': 24})


def edit(pack):
    frozen, outcome = locked(pack)
    save(pack / 'public/media-policy.json', {
        'firstSuccessfulAssets': True, 'aestheticRerolls': 0,
        'manualVisualApprovalRequired': False,
        'resultAuthority': 'Confirmed tournament result; visual bugs do not change payouts',
        'islandReferenceSha256': digest(pack / 'references/island.png'),
        'musicSha256': digest(Path(__file__).resolve().parents[2] / 'docs/islands/race-film-v4/audio/split-in-synapse-original.mp3')
    })
    film_receipt = pack / 'public/film.json'
    if film_receipt.exists():
        saved = json.loads(film_receipt.read_text())
        assert saved['outcomeSha256'] == outcome['outcomeSha256']
        assert saved['sha256'] == digest(pack / 'public/film.mp4')
        if all((pack / 'public' / f).exists() for f in ['credits.txt', 'native-sfx.mp4', 'SF1.png', 'SF2.png', 'FINAL.png']):
            return
    roster = {f['id']: f for f in frozen['input']['roster']}
    selection = []
    for match in outcome['outcome']['matches']:
        mid = match['id']
        frame = pack / 'provider' / mid / 'image.png'
        shutil.copyfile(frame, pack / 'public' / (mid + '.png'))
        label = mid + ' | ' + ' vs '.join(roster[i]['name'] for i in match['fighterIds'])
        for part, seconds, start in [('opening', 3, 0), ('continuation', 5, 1 / 24)]:
            source = pack / 'provider' / mid / (part + '.mp4')
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)]))
            assert any(s['codec_type'] == 'video' for s in probe['streams'])
            assert float(probe['format']['duration']) >= seconds - .05, 'Provider clip is too short'
            # Audio is mandatory for this release. Retain the asset for repair without reroll.
            assert any(s['codec_type'] == 'audio' for s in probe['streams']), 'Native audio missing; retain successful video for technical repair'
            item = {'source': str(source), 'start': start, 'seconds': seconds, 'label': label}
            if part == 'continuation':
                item['winner'] = roster[match['winnerId']]['name'] + ' wins | ' + match['verdict'].replace('-', ' ')
            selection.append(item)
    assemble(pack, frozen, outcome, selection, sha({}), 'Seedream 4.5 via Runware')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['compile', 'extract', 'assemble'])
    parser.add_argument('--job', type=Path, required=True)
    parser.add_argument('--match', choices=['SF1', 'SF2', 'FINAL'])
    args = parser.parse_args()
    if args.operation == 'compile': compile_prompts(args.job)
    elif args.operation == 'extract': extract(args.job, args.match)
    else: edit(args.job)
