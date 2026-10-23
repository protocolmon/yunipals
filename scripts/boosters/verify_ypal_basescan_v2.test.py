import copy
import json
import unittest

import verify_ypal_basescan_v2 as v


class ProxyReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proof, cls.source, cls.abi = v.compiled_reference()
        cls.standards, cls.original = v.base.reviewed_inputs()
        cls.plan = v.base.prepare(v.base.ROOT / "docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json",
                                 "/root/.nvm/versions/node/v24.18.1/bin/node")
        cls.entry = next(e for e in cls.plan["contracts"] if e["step"] == "registry")
        cls.record = v.base.document(v.FOLDER / "public-record.json", cls.proof["publicRecordSha256"])
        cls.record["SourceCode"] = json.dumps(cls.source)

    def validate(self, record, *, reference=False, entry=None):
        return v.reference_validator(self.proof, self.source, self.abi)(
            record, entry or self.entry, self.standards, self.original, reference=reference)

    def test_actual_public_full_reference_recompiles_to_deployed_proxy(self):
        r = self.validate(self.record, reference=True)
        self.assertEqual(r["verificationLevel"], "full")
        self.assertTrue(r["referenceCreationAndRuntimeByteIdentical"])

    def test_similar_record_stays_labelled_similar(self):
        record = {**self.record, "SimilarMatch": self.proof["referenceAddress"]}
        r = self.validate(record)
        self.assertEqual(r["verificationLevel"], "similar-proxy")
        self.assertEqual(r["sourceInputSha256"], self.proof["inputSha256"])

    def test_source_settings_abi_reference_and_compiler_mutations_refused(self):
        record = {**self.record, "SimilarMatch": self.proof["referenceAddress"]}
        mutations = [
            {"SimilarMatch": "0x" + "1" * 40},
            {"SimilarMatch": ""},
            {"CompilerVersion": "v0.8.29"},
            {"Runs": "201"},
            {"ABI": "[]"},
            {"OptimizationUsed": "0"}
        ]
        changed = copy.deepcopy(self.source)
        changed["settings"]["evmVersion"] = "shanghai"
        mutations.append({"SourceCode": json.dumps(changed)})
        changed = copy.deepcopy(self.source)
        changed["sources"][next(iter(changed["sources"]))]["content"] += "\n// changed\n"
        mutations.append({"SourceCode": json.dumps(changed)})
        for mutation in mutations:
            with self.subTest(mutation=list(mutation)), self.assertRaises(ValueError):
                self.validate({**record, **mutation})

    def test_reference_must_itself_be_full(self):
        with self.assertRaises(ValueError):
            self.validate({**self.record, "SimilarMatch": self.proof["referenceAddress"]}, reference=True)

    def test_token_and_implementation_require_original_exact_verification(self):
        for step in ("ypal", "engineImplementation"):
            entry = next(e for e in self.plan["contracts"] if e["step"] == step)
            with self.subTest(step=step), self.assertRaises(ValueError):
                self.validate({**self.record, "SimilarMatch": self.proof["referenceAddress"]}, entry=entry)


if __name__ == "__main__":
    unittest.main()
