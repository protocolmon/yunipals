"""State and cutout checks for the subscription-assisted artwork controller."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw


spec = importlib.util.spec_from_file_location("art_lab", Path(__file__).with_name("art_lab.py"))
art = importlib.util.module_from_spec(spec)
spec.loader.exec_module(art)


class ArtLabTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.lab = Path(self.temporary.name)
        (self.lab / "references").mkdir()
        Image.new("RGB", (1024, 1024), "blue").save(self.lab / "references/og.png")
        Image.new("RGB", (512, 512), "white").save(self.lab / "references/logo.png")
        art.write_json(self.lab / "references.json", {"logo": "references/logo.png", "types": {
            "Yunidragon": {"image": "references/og.png", "identity": "The OG blue dragon", "source": "test fixture"}}})
        self.creature = self.lab / "test-creature.png"
        Image.new("RGB", (1024, 1024), "blue").save(self.creature)
        self.card = self.lab / "test-card.png"
        picture = Image.new("RGBA", (1024, 1536), (0, 0, 0, 0))
        ImageDraw.Draw(picture).rounded_rectangle((20, 20, 1003, 1515), radius=40, fill="gold")
        picture.save(self.card)

    def prepare(self, glitter="No", new=False):
        return art.prepare(self.lab, "Yunidragon", "Blue", "Spiral", glitter, new)

    def finish(self, run):
        art.accept(self.lab, run, "creature", self.creature)
        return art.accept(self.lab, run, "card", self.card)

    def test_repeated_requests_reuse_pending_run_and_candidates_preserve_history(self):
        first = self.prepare()
        repeated = self.prepare()
        second = self.prepare(new=True)
        self.assertEqual(first["runId"], repeated["runId"])
        self.assertNotEqual(first["runId"], second["runId"])
        self.assertEqual(len(list((self.lab / "runs").glob("*/run.json"))), 2)

    def test_stage_order_prevents_overwrite_and_glitter_requires_foil(self):
        run = self.prepare(glitter="Yes")["runId"]
        with self.assertRaises(ValueError):
            art.accept(self.lab, run, "card", self.card)
        result = self.finish(run)
        self.assertFalse(result["complete"])
        self.assertEqual(result["nextStage"]["id"], "foil")
        with self.assertRaises(ValueError):
            art.review(self.lab, run, "accepted")
        result = art.accept(self.lab, run, "foil", self.card)
        self.assertTrue(result["complete"])
        with self.assertRaises(ValueError):
            art.accept(self.lab, run, "foil", self.card)

    def test_changed_reference_rejects_stale_generation(self):
        run = self.prepare()["runId"]
        Image.new("RGB", (1024, 1024), "red").save(self.lab / "references/og.png")
        with self.assertRaisesRegex(ValueError, "reference changed"):
            art.accept(self.lab, run, "creature", self.creature)

    def test_accepted_canonical_cannot_be_replaced_by_another_candidate(self):
        first = self.prepare()["runId"]
        self.finish(first)
        art.review(self.lab, first, "accepted", "first choice")
        second = self.prepare(new=True)["runId"]
        self.finish(second)
        with self.assertRaisesRegex(ValueError, "already has accepted artwork"):
            art.review(self.lab, second, "accepted")
        self.assertEqual(self.prepare()["runId"], first)
        registry = art.read_json(self.lab / "references.json")
        registry["types"]["Yunidragon"]["identity"] = "An updated description for future candidates"
        art.write_json(self.lab / "references.json", registry)
        self.assertEqual(self.prepare()["runId"], first)
        self.assertEqual(json.loads((self.lab / "canonical.json").read_text())["yunidragon-blue-spiral-glitter-no"], first)

    def test_opaque_or_clipped_cards_are_rejected(self):
        opaque = self.lab / "opaque.png"
        Image.new("RGB", (1024, 1536), "gold").save(opaque)
        with self.assertRaisesRegex(ValueError, "transparent exterior"):
            art.image_metrics(opaque, "card")
        clipped = self.lab / "clipped.png"
        picture = Image.new("RGBA", (1024, 1536), (0, 0, 0, 0))
        ImageDraw.Draw(picture).rectangle((0, 20, 1003, 1515), fill="gold")
        picture.save(clipped)
        with self.assertRaisesRegex(ValueError, "Invalid card cutout"):
            art.image_metrics(clipped, "card")

    def test_exports_use_relative_public_assets_and_remain_pending_human_review(self):
        run = self.prepare()["runId"]
        self.finish(run)
        output = self.lab / "public"
        result = art.export(self.lab, output)
        self.assertEqual(result["completed"], 1)
        data = json.loads((output / "data.json").read_text())
        candidate = data["candidates"][0]
        self.assertTrue((output / candidate["image"]).is_file())
        self.assertFalse(candidate["image"].startswith("/"))
        self.assertEqual(candidate["review"]["decision"], "pending")

    def test_finalized_previews_and_qa_export_to_deployable_paths(self):
        run = self.prepare()["runId"]
        self.finish(run)
        art.finalize(self.lab, run)
        output = self.lab / "public"
        art.export(self.lab, output)
        data = art.read_json(output / "data.json")
        paths = art.public_asset_paths(data)
        self.assertTrue(any(name.endswith("_preview.webp") for name in paths))
        self.assertTrue(any(name.endswith("-checkerboard.png") for name in paths))
        for name in paths:
            self.assertTrue((output / name).is_file(), name)
        data["candidates"][0]["stages"]["card"]["preview"] = f"runs/{run}/card_preview.webp"
        with self.assertRaisesRegex(ValueError, "public assets directory"):
            art.public_asset_paths(data)

    def test_brand_revisions_preserve_source_and_keep_frame_candidates_separate(self):
        source = self.prepare()["runId"]
        self.finish(source)
        original = art.run_path(self.lab, source).read_bytes()
        brand = art.prepare_revision(self.lab, source, "brand")
        monster = art.prepare_revision(self.lab, source, "monster")
        self.assertNotEqual(brand["runId"], monster["runId"])
        self.assertEqual(brand["nextStage"]["id"], "revision")
        self.assertIn("honey-gold", brand["nextStage"]["prompt"])
        self.assertIn("OFFICIAL", brand["nextStage"]["prompt"])
        art.accept(self.lab, brand["runId"], "revision", self.card)
        self.assertEqual(self.prepare()["runId"], brand["runId"])
        self.assertEqual(art.run_path(self.lab, source).read_bytes(), original)

    def test_invalid_traits_and_missing_og_reference_do_not_enqueue(self):
        with self.assertRaises(ValueError):
            art.prepare(self.lab, "Yunidragon", "Orange", "Spiral", "No")
        with self.assertRaisesRegex(ValueError, "Register an OG reference"):
            art.prepare(self.lab, "Yuniair", "Blue", "Spiral", "No")
        self.assertFalse((self.lab / "runs").exists())

    def test_selected_frame_export_removes_alternatives_and_preserves_source_runs(self):
        brand = self.prepare()["runId"]
        self.finish(brand)
        monster = art.prepare_revision(self.lab, brand, "monster")["runId"]
        art.accept(self.lab, monster, "revision", self.card)
        output = self.lab / "public"
        art.export(self.lab, output)
        previous = art.read_json(output / "data.json")
        removed_image = next(item["image"] for item in previous["candidates"] if item["id"] == monster)
        registry = art.read_json(self.lab / "references.json")
        registry["gallery"] = {"frameStyle": "brand"}
        art.write_json(self.lab / "references.json", registry)
        art.export(self.lab, output)
        data = art.read_json(output / "data.json")
        self.assertEqual([item["id"] for item in data["candidates"]], [brand])
        self.assertFalse((output / removed_image).exists())
        self.assertTrue(art.run_path(self.lab, monster).exists())
        with self.assertRaisesRegex(ValueError, "selected lavender frame"):
            art.prepare(self.lab, "Yunidragon", "Blue", "Spiral", "No", frame_style="monster")
        with self.assertRaisesRegex(ValueError, "selected lavender frame"):
            art.prepare_revision(self.lab, brand, "monster")

    def test_clarity_proof_preserves_accepted_source_and_exports_both_versions(self):
        source = self.prepare(glitter="Yes")["runId"]
        self.finish(source)
        art.accept(self.lab, source, "foil", self.card)
        art.review(self.lab, source, "accepted", "Approved source")
        classic = self.prepare()["runId"]
        self.finish(classic)
        art.review(self.lab, classic, "accepted", "Approved classic")
        canonical_before = (self.lab / "canonical.json").read_bytes()
        source_before = art.run_path(self.lab, source).read_bytes()
        plan = art.prepare_clarity(self.lab, source, classic)
        self.assertEqual(art.prepare_clarity(self.lab, source, classic)["runId"], plan["runId"])
        self.assertEqual(len(plan["nextStage"]["inputs"]), 2)
        art.accept(self.lab, plan["runId"], "clarity", self.card)
        art.finalize(self.lab, plan["runId"])
        output = self.lab / "public"
        art.export(self.lab, output)
        data = art.read_json(output / "data.json")
        candidate = next(item for item in data["candidates"] if item["id"] == source)
        self.assertEqual(len(data["candidates"]), 2)
        self.assertEqual(candidate["stageOrder"], ["creature", "card", "foil", "clarity"])
        self.assertEqual(candidate["clarityProof"]["review"]["decision"], "pending")
        for name in art.public_asset_paths(data):
            self.assertTrue((output / name).is_file())
        self.assertEqual(art.run_path(self.lab, source).read_bytes(), source_before)
        self.assertEqual((self.lab / "canonical.json").read_bytes(), canonical_before)
        with self.assertRaisesRegex(ValueError, "matching glitter and classic"):
            art.prepare_clarity(self.lab, classic, source)

    def test_palette_correction_preserves_history_and_validates_color_references(self):
        source = self.prepare()["runId"]
        self.finish(source)
        art.review(self.lab, source, "accepted", "Approved original")
        source_bytes = art.run_path(self.lab, source).read_bytes()
        canonical_bytes = (self.lab / "canonical.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "actual Blue OG palette for Yunidragon"):
            art.prepare_color(self.lab, source)
        art.register_palette(self.lab, "Blue", self.creature, "Generic OG tones", "Different species fixture")
        with self.assertRaisesRegex(ValueError, "both species and color must match"):
            art.prepare_color(self.lab, source)
        art.register_palette(self.lab, "Blue", self.creature, "OG aqua tones", "Actual OG palette fixture", "Yunidragon")
        plan = art.prepare_color(self.lab, source)
        self.assertEqual(plan["runId"], art.prepare_color(self.lab, source)["runId"])
        self.assertEqual(plan["nextStage"]["id"], "palette")
        self.assertEqual(len(plan["nextStage"]["inputs"]), 2)
        self.assertIn("eye/iris", plan["nextStage"]["prompt"])
        self.assertIn("ALL character colors", plan["nextStage"]["prompt"])
        art.accept(self.lab, plan["runId"], "palette", self.card)
        art.finalize(self.lab, plan["runId"])
        art.review(self.lab, plan["runId"], "accepted", "Approved color proof")
        art.export(self.lab, self.lab / "export")
        data = art.read_json(self.lab / "export/data.json")
        item = next(c for c in data["candidates"] if c["id"] == source)
        self.assertEqual(item["stageOrder"][-1], "palette")
        self.assertEqual(item["colorProof"]["review"]["decision"], "accepted")
        self.assertTrue(item["paletteReference"]["image"].startswith("assets/"))
        self.assertEqual(art.run_path(self.lab, source).read_bytes(), source_bytes)
        self.assertEqual((self.lab / "canonical.json").read_bytes(), canonical_bytes)
        for image in art.public_asset_paths(data):
            self.assertTrue((self.lab / "export" / image).is_file())
        art.register_palette(self.lab, "Blue", self.card, "Species-specific palette", "OG matching species", "Yunidragon")
        self.assertEqual(art.palette_reference(art.read_json(self.lab / "references.json"), "Yunidragon", "Blue")["monsterType"], "Yunidragon")
        newer = art.prepare_color(self.lab, source)
        art.accept(self.lab, newer["runId"], "palette", self.card)
        art.export(self.lab, self.lab / "export")
        latest = next(c for c in art.read_json(self.lab / "export/data.json")["candidates"] if c["id"] == source)
        self.assertEqual(latest["colorProof"]["runId"], newer["runId"])
        run = art.read_json(art.run_path(self.lab, plan["runId"]))
        Image.new("RGB", (1024, 1024), "red").save(art.asset(self.lab, run["references"]["palette"]["path"]))
        with self.assertRaisesRegex(ValueError, "reference changed"):
            art.next_stage(self.lab, plan["runId"])

    def test_locked_design_prepares_repeatable_cards_with_matching_finish_reference(self):
        classic = self.prepare()["runId"]
        self.finish(classic)
        art.review(self.lab, classic, "accepted", "Approved classic")
        glitter = self.prepare(glitter="Yes")["runId"]
        self.finish(glitter)
        art.accept(self.lab, glitter, "foil", self.card)
        with self.assertRaisesRegex(ValueError, "accepted"):
            art.lock_design(self.lab, classic, glitter)
        art.review(self.lab, glitter, "accepted", "Approved glitter")
        design = art.lock_design(self.lab, classic, glitter)
        self.assertEqual(art.lock_design(self.lab, classic, glitter), design)
        with self.assertRaisesRegex(ValueError, "actual Red OG palette for Yunidragon"):
            art.prepare(self.lab, "Yunidragon", "Red", "Diamond", "Yes")
        art.register_palette(self.lab, "Red", self.creature, "OG coral tones", "Actual OG test fixture", "Yunidragon")
        plan = art.prepare(self.lab, "Yunidragon", "Red", "Diamond", "Yes")
        self.assertEqual(plan["runId"], art.prepare(self.lab, "Yunidragon", "Red", "Diamond", "Yes")["runId"])
        self.assertEqual(plan["nextStage"]["id"], "card")
        self.assertEqual(len(plan["nextStage"]["inputs"]), 4)
        self.assertIn("ACTUAL OG Red Yunidragon", plan["nextStage"]["prompt"])
        self.assertIn("ENTIRE CHARACTER PALETTE", plan["nextStage"]["prompt"])
        self.assertEqual(plan["nextStage"]["inputs"][0], plan["nextStage"]["inputs"][3])
        self.assertEqual(plan["nextStage"]["inputs"][3], str(art.asset(self.lab, art.read_json(art.run_path(self.lab, plan["runId"]))["references"]["palette"]["path"])))
        self.assertEqual(plan["nextStage"]["inputs"][1], str(art.asset(self.lab, design["styles"]["Yes"]["path"])))
        art.accept(self.lab, plan["runId"], "card", self.card)
        self.assertTrue(art.next_stage(self.lab, plan["runId"])["complete"])
        self.assertEqual(art.next_stage(self.lab, plan["runId"])["review"]["decision"], "pending")
        self.assertEqual(self.prepare()["runId"], classic)
        art.register_palette(self.lab, "Green", self.creature, "Exact aqua identity", "OG fixture", "Yuniaqua")
        new_species = art.prepare(self.lab, "Yuniaqua", "Green", "Spiral", "Yes")
        self.assertIn("SPECIFIC OG Green Yuniaqua", new_species["nextStage"]["prompt"])
        self.assertEqual(new_species["nextStage"]["inputs"][0], new_species["nextStage"]["inputs"][3])
        style = art.asset(self.lab, design["styles"]["Yes"]["path"])
        Image.new("RGBA", (1024, 1536), "red").save(style)
        with self.assertRaisesRegex(ValueError, "locked style reference changed"):
            art.prepare(self.lab, "Yunidragon", "Green", "Spiral", "Yes")

    def test_material_print_is_exported_as_companion_without_replacing_canonical(self):
        source = self.prepare()["runId"]
        self.finish(source)
        art.review(self.lab, source, "accepted", "Approved original")
        original = art.run_path(self.lab, source).read_bytes()
        registry = art.read_json(self.lab / "references.json")
        registry["gallery"] = {"frameStyle": "brand"}
        art.write_json(self.lab / "references.json", registry)
        plan = art.prepare_material(self.lab, source)
        self.assertEqual(plan["runId"], art.prepare_material(self.lab, source)["runId"])
        art.accept(self.lab, plan["runId"], "print", self.card)
        art.review(self.lab, plan["runId"], "accepted", "Approved material preview")
        output = self.lab / "public"
        art.export(self.lab, output)
        data = art.read_json(output / "data.json")
        self.assertEqual(len(data["candidates"]), 1)
        candidate = data["candidates"][0]
        self.assertEqual(candidate["id"], source)
        self.assertTrue((output / candidate["materialPrint"]["path"]).is_file())
        self.assertIn(candidate["materialPrint"]["path"], art.public_asset_paths(data))
        self.assertEqual(art.run_path(self.lab, source).read_bytes(), original)
        self.assertEqual(self.prepare()["runId"], source)


if __name__ == "__main__":
    unittest.main()
