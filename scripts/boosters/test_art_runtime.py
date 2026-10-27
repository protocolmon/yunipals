"""Verify immutable publication and complete-reference launch commitments."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).parent))
import art_lab as art
import art_runtime as runtime
from PIL import Image,ImageDraw

class ArtRuntimeTest(unittest.TestCase):
    def test_shader_maps_load_from_repo_source_without_review_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'scripts/boosters/artwork';source.mkdir(parents=True)
            for name in ('monster-depth.js','star-highlights.js'):
                shutil.copyfile(art.ROOT/'scripts/boosters/artwork'/name,source/name)
            with patch.object(runtime,'ROOT',root):
                maps=runtime.shader_maps()
            approved='45709a6ac84f0e183a8de46cdab2a76afb0c44d2acafc033a65e248c8d6d8fdd'
            self.assertTrue(maps['monster'][approved].strip().startswith('M'))
            self.assertGreaterEqual(len(maps['stars'][approved]),10)
            self.assertFalse((root/'sites').exists())

    def test_catalog_requires_all_exact_references_and_is_frozen(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);lab=root/'lab';lab.mkdir();(lab/'references').mkdir()
            Image.new('RGB',(512,512),'green').save(lab/'references/og.png')
            registry={'types':{},'logo':'references/og.png','designLock':{'styles':{'No':{'sha256':'a'},'Yes':{'sha256':'b'}}},'palettes':{}}
            art.write_json(lab/'references.json',registry)
            with self.assertRaisesRegex(ValueError,'Missing exact OG'):
                runtime.init_catalog(lab,root/'runtime','demo','http://127.0.0.1:9019')
            d=art.read_json(art.DICTIONARY)
            for t in d['types']:
                for c in d['colors']:
                    registry['palettes'][t['name']+':'+c['name']]={'image':'references/og.png','source':'OG fixture'}
            art.write_json(lab/'references.json',registry)
            first=runtime.init_catalog(lab,root/'runtime','demo','http://127.0.0.1:9019')
            self.assertEqual(len(first['references']),66)
            self.assertEqual(first,runtime.init_catalog(lab,root/'runtime','demo','http://127.0.0.1:9019'))
            traits=art.variant_traits('Yuniaqua','Green','Spiral','Yes')
            job={'schemaVersion':1,'catalog':'demo','catalogHash':first['catalogHash'],'variantId':traits['variantId'],'traits':{key:traits[key] for key in ('type','color','horn','glitter')},'status':'queued'}
            art.write_json(root/'runtime/jobs/demo'/f"{traits['variantId']}.json",job)
            with patch.object(runtime,'prepare',return_value={'runId':'prepared-exact-og'}):
                prepared=runtime.jobs(lab,root/'runtime','demo')
                self.assertEqual(prepared[0]['status'],'prepared')
                self.assertEqual(prepared[0]['runId'],'prepared-exact-og')
            Image.new('RGB',(512,512),'red').save(lab/'references/og.png')
            with self.assertRaisesRegex(ValueError,'already frozen'):
                runtime.jobs(lab,root/'runtime','demo')
            Image.new('RGB',(512,512),'green').save(lab/'references/og.png')
            with self.assertRaisesRegex(ValueError,'already frozen'):
                runtime.init_catalog(lab,root/'runtime','demo','https://other.example')
            with self.assertRaisesRegex(ValueError,'Invalid catalog'):
                runtime.catalog_path(root,'../escape')

    def test_mask_calibration_is_safe_and_bound_to_exact_pixels(self):
        data={'sha256':'abc','foreground':'M10 20 L40 20 L30 60 Z','stars':[[70,80,10]]}
        runtime.validate_masks(data,'abc')
        with self.assertRaisesRegex(ValueError,'exact artwork'):
            runtime.validate_masks(data,'other')
        with self.assertRaisesRegex(ValueError,'numeric SVG'):
            runtime.validate_masks({**data,'foreground':'<script>alert(1)</script>'},'abc')
        with self.assertRaisesRegex(ValueError,'outside'):
            runtime.validate_masks({**data,'stars':[[1100,80,10]]},'abc')

    def test_publish_approved_only_and_never_replace_a_variant(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);lab=root/'lab';lab.mkdir();(lab/'references').mkdir()
            image=Image.new('RGBA',(1024,1536),(0,0,0,0));ImageDraw.Draw(image).rounded_rectangle((20,20,1004,1516),radius=40,fill='purple');image.save(lab/'card.png')
            traits=art.variant_traits('Yunikles','Yellow','Spiral','No');rid='approved-card'
            run={'id':rid,'recipeVersion':'test','traits':traits,'stageOrder':['card'],'references':{},'review':{'decision':'pending'},'stages':{'card':{'path':'card.png','sha256':art.digest((lab/'card.png').read_bytes()),'qa':{'visibleCanvasEdgePixels':0,'visualReview':{'status':'agent-reviewed'}}}}}
            art.write_json(art.run_path(lab,rid),run)
            folder=runtime.catalog_path(root/'runtime','demo');art.write_json(folder/'manifest.json',{'artworkHash':'0x'+'a'*64,'metadataBaseURI':'http://127.0.0.1:9019/v1/boosters/art/demo/'})
            with self.assertRaisesRegex(ValueError,'approved'):
                runtime.publish(lab,root/'runtime','demo',rid)
            run['review']['decision']='accepted';art.write_json(art.run_path(lab,rid),run)
            with patch.object(runtime,'shader_maps',return_value={'monster':{},'stars':{}}):
                first=runtime.publish(lab,root/'runtime','demo',rid)
                self.assertEqual(first,runtime.publish(lab,root/'runtime','demo',rid))
                run['recipeVersion']='changed';art.write_json(art.run_path(lab,rid),run)
                with self.assertRaisesRegex(ValueError,'cannot be replaced'):
                    runtime.publish(lab,root/'runtime','demo',rid)
            document=art.read_json(Path(first['metadata']));self.assertEqual(document['yunipals']['variantId'],120)
            self.assertEqual(document['yunipals']['holo'],None)

if __name__=='__main__':unittest.main()
