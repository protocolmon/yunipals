import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from PIL import ImageDraw
from kit_assets import key_sheet

spec = importlib.util.spec_from_file_location('studio', Path(__file__).with_name('studio.py'))
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)


class StudioTest(unittest.TestCase):
    def v2_folder(self, lab, tid):
        folder = lab / tid
        (folder / 'raw').mkdir(parents=True)
        (folder / 'prompts').mkdir()
        style, lock = studio.recipe('anime-fighter-v2')
        for pose in style['poses']:
            image = Image.new('RGB', (64,64), '#00ff00')
            ImageDraw.Draw(image).rectangle((10,8,53,55),fill='#aa44cc')
            image.save(folder/'raw'/(pose+'.png'))
        Image.new('RGB',(64,64),'#aa44cc').save(folder/'artwork.png')
        Image.new('RGB',(64,64),'#aa44cc').save(folder/'board.png')
        traits={'monsterType':7,'color':3,'horn':2,'background':1,'glitter':0}
        studio.write(folder/'fighter.json',{'chainId':8453,'collection':studio.COLLECTION,'tokenId':tid,'traits':traits,'traitsHash':'0x'+studio.digest(studio.canonical(traits)),
            'artwork':{'url':'https://drive.polychainmonsters.com/ipfs/QmExample','sha256':'b'*64},
            'identity':{'species':'Unibranch','color':'Purple','horn':'Candy Cane','text':'Four hoof legs, no wings.','locomotion':'ground','identityVersion':'anime-fighter-v1'},
            'identityDraft':False,'recipe':{'id':'anime-fighter-v2','sha256':lock['sha256']},'look':style['defaults'].copy()})
        studio.write(folder/'stage-contract.json',{'tokenId':tid})
        studio.review(folder,'idle',[])
        studio.key(folder);studio.fit(folder);studio.review(folder,'poses',[])
        return folder

    def test_sheet_keying_preserves_grid_and_uses_separate_blending_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);image=Image.new('RGB',(4,4),(21,21,21));image.putpixel((1,1),(58,40,20));image.save(root/'raw.png')
            key_sheet(root/'raw.png',root/'add.webp','add',2,2)
            key_sheet(root/'raw.png',root/'alpha.webp','alpha',1,2)
            additive=Image.open(root/'add.webp');alpha=Image.open(root/'alpha.webp')
            self.assertEqual(additive.size,(4,4));self.assertEqual(additive.getpixel((0,0)),(0,0,0))
            self.assertEqual(additive.getpixel((1,1)),(58,40,20));self.assertEqual(alpha.getpixel((1,1))[3],255)
            self.assertLess(alpha.getpixel((0,0))[3],25)
            with self.assertRaises(ValueError):key_sheet(root/'raw.png',root/'bad.webp','add',3,2)

    def test_v2_export_publish_shared_sheets_and_review_invalidation(self):
        with tempfile.TemporaryDirectory() as tmp:
            lab=Path(tmp)/'lab';folder=self.v2_folder(lab,'1234');calls=[]
            def generate(out,prompt,refs):
                if out.exists():return
                calls.append(str(out));out.parent.mkdir(parents=True,exist_ok=True)
                image=Image.new('RGB',(64,64),'#000000' if 'species' in out.parts else '#00ff00')
                ImageDraw.Draw(image).rectangle((10,8,53,55),fill='#aa44cc');image.save(out)
                studio.write(out.with_suffix('.receipt.json'),{'sha256':studio.digest(out.read_bytes())})
            with patch.object(studio,'generate_image',side_effect=generate):
                studio.kits(folder)
                self.assertEqual(len(calls),6) # three windups, strike, projectile, shared impact
                for kit in studio.read(folder/'kits.json'):studio.review(folder,'approve-kit',[kit['id']])
                studio.review(folder,'approve',[]);studio.export(folder)
                manifest=studio.read(folder/'export/manifest.json')
                self.assertEqual(len(manifest['sprites']),9);self.assertEqual(len(manifest['kits']),3)
                self.assertEqual(manifest['defaultLoadout'],['vine-lash','thorn-volley'])
                self.assertTrue((folder/'kits-contact-sheet.jpg').exists())
                destination=Path(tmp)/'site';studio.publish(lab,destination)
                for kit in manifest['kits']:
                    self.assertTrue((destination/kit['impact']['sheet']).is_file())
                    self.assertTrue((destination/'fighters/v1/1234'/kit['windup']['file']).is_file())
                other=self.v2_folder(lab,'1235');studio.kits(other)
                self.assertEqual(len(calls),9) # no additional shared sheet generation
                with self.assertRaisesRegex(ValueError,'Published species art'):studio.review(folder,'reroll',['species:strike'])
                (folder/'raw/windup-vine-lash.png').write_bytes(b'changed')
                with self.assertRaises(ValueError):studio.export(folder)

    def test_installed_studio_uses_built_helper_without_development_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            built = root / 'apps/yunipals-market-api/dist/arena-anime-studio.mjs'
            built.parent.mkdir(parents=True)
            built.write_text('// installed helper')
            with patch.object(studio, 'ROOT', root), patch.object(studio.subprocess, 'check_output', return_value=b'{"ok":true}') as run:
                self.assertEqual(studio.node_helper('encode', 'batch.json'), {'ok': True})
                self.assertEqual(run.call_args.args[0][1:], [str(built), 'encode', 'batch.json'])

    def test_canonical_matches_javascript_convention(self):
        self.assertEqual(studio.canonical({'z': 1.0, 'a': {'c': 'é', 'b': 2}}).decode(), '{"a":{"b":2,"c":"é"},"z":1}')
        for value in ['../1', '-1', '01', str(2 ** 256)]:
            with self.assertRaises(ValueError): studio.token_id(value)

    def test_frozen_recipe(self):
        style, lock = studio.recipe()
        self.assertEqual(len(style['poses']), 9)
        self.assertEqual(len(lock['sha256']), 64)

    def test_review_invalidated_when_raw_images_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / 'raw').mkdir()
            (folder / 'keyed').mkdir()
            (folder / 'raw/idle.png').write_bytes(b'one')
            studio.write(folder / 'fighter.json', {})
            studio.write(folder / 'key-receipt.json', {'raw': {'idle.png': studio.digest(b'one')}})
            studio.fingerprint(folder)
            (folder / 'raw/idle.png').write_bytes(b'two')
            with self.assertRaisesRegex(ValueError, 'Raw images changed'): studio.fingerprint(folder)

    def test_public_rejection_note_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            studio.review(folder, 'reject', ['2', 'Try after the next recipe update.'])
            self.assertEqual(studio.read(folder / 'review.json')['code'], 2)
            for code, note in [('5', 'revoke only'), ('0', 'x'*141), ('0', 'é'*71)]:
                with self.assertRaises(ValueError): studio.review(folder, 'reject', [code, note])

    def test_export_and_publication_require_the_current_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            lab = Path(tmp) / 'lab'
            folder = lab / '1234'
            (folder / 'raw').mkdir(parents=True)
            (folder / 'keyed').mkdir()
            style, lock = studio.recipe()
            for pose in style['poses']:
                image = Image.new('RGBA', (64, 64), (140, 50, 230, 255))
                image.save(folder / 'raw' / (pose + '.png'))
                image.save(folder / 'keyed' / (pose + '.png'))
            studio.write(folder / 'key-receipt.json', {'raw': {p.name: studio.digest(p.read_bytes()) for p in (folder / 'raw').glob('*.png')}})
            data = {'chainId': 8453, 'collection': studio.COLLECTION, 'tokenId': '1234', 'traits': {'monsterType': 7, 'color': 3, 'horn': 2, 'background': 1, 'glitter': 0}, 'traitsHash': '0x'+'a'*64, 'artwork': {'url': 'https://drive.polychainmonsters.com/ipfs/QmExample', 'sha256': 'b'*64}, 'identity': {'species': 'Unibranch', 'color': 'Purple', 'horn': 'Candy Cane', 'text': 'Four legs, no wings.', 'locomotion': 'ground', 'identityVersion': 'anime-fighter-v1'}, 'recipe': {'id': 'anime-fighter-v1', 'sha256': lock['sha256']}, 'look': style['defaults'].copy(), 'identityDraft': False}
            data['traitsHash'] = '0x' + studio.digest(studio.canonical(data['traits']))
            studio.write(folder / 'fighter.json', data)
            studio.fit(folder)
            fitted = studio.read(folder / 'fighter.json')
            fitted['look']['origin'][0] = 0.0000001
            studio.write(folder / 'fighter.json', fitted)
            studio.review(folder, 'approve', [])
            exported = studio.export(folder)
            manifest = studio.read(folder / 'export/manifest.json')
            self.assertEqual(exported['manifestHash'], '0x'+studio.digest((folder / 'export/manifest.json').read_bytes()))
            self.assertEqual(len(manifest['sprites']), 9)
            published = Path(tmp) / 'site'
            (folder / 'export' / 'private.env').write_text('should-never-be-published')
            studio.publish(lab, published)
            self.assertFalse((published / 'fighters/v1/1234/private.env').exists())
            self.assertFalse((published / 'fighters/v1/1234/manifest.json').exists())
            data['identity']['text'] = 'Changed after review'
            studio.write(folder / 'fighter.json', data)
            with self.assertRaises(ValueError): studio.export(folder)
            self.assertEqual(studio.publish(lab, published)['published'], [])


if __name__ == '__main__': unittest.main()
