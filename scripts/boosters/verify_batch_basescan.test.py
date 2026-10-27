"""Offline validation of the real standard-input/ABI verification boundary."""
import copy
import json
import unittest

import verify_batch_basescan as verifier


class Verification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, cls.standard, cls.abi = verifier.reviewed_inputs()

    def record(self):
        return {"SourceCode": "{" + json.dumps(self.standard) + "}",
                "ContractName": "BoosterPacks", "CompilerVersion": verifier.COMPILER,
                "OptimizationUsed": "1", "Runs": "1", "ConstructorArguments": "",
                "SimilarMatch": "", "ABI": json.dumps(self.abi)}

    def test_exact_source_and_full_abi(self):
        value = verifier.validate_record(self.record(), self.standard, self.abi)
        self.assertTrue(value["fullSourceMatch"])
        self.assertTrue(value["fullAbiMatch"])
        self.assertEqual(value["sourceFiles"], 42)

    def test_actual_explorer_omission_of_only_empty_libraries(self):
        row = self.record()
        source = copy.deepcopy(self.standard)
        del source["settings"]["libraries"]
        row["SourceCode"] = json.dumps(source)
        self.assertTrue(verifier.validate_record(row, self.standard, self.abi)["explorerOmittedEmptyLibraries"])

    def test_source_change_rejected(self):
        row = self.record()
        source = copy.deepcopy(self.standard)
        source["sources"]["src/BoosterPacks.sol"]["content"] += "\n// changed\n"
        row["SourceCode"] = json.dumps(source)
        with self.assertRaises(ValueError):
            verifier.validate_record(row, self.standard, self.abi)

    def test_optimizer_and_nonempty_libraries_rejected(self):
        for field, value in [("optimizer", {"enabled": True, "runs": 200}),
                             ("libraries", {"src/External.sol": {"External": "0x" + "11" * 20}}),
                             ("viaIR", False), ("evmVersion", "paris")]:
            with self.subTest(field=field):
                row = self.record()
                source = copy.deepcopy(self.standard)
                source["settings"][field] = value
                row["SourceCode"] = json.dumps(source)
                with self.assertRaises(ValueError):
                    verifier.validate_record(row, self.standard, self.abi)

    def test_wrong_compiler_constructor_or_similar_match_rejected(self):
        for field, value in [("CompilerVersion", "v0.8.29"), ("ConstructorArguments", "00"),
                             ("SimilarMatch", "0x" + "11" * 20), ("Runs", "200")]:
            with self.subTest(field=field):
                row = self.record()
                row[field] = value
                with self.assertRaises(ValueError):
                    verifier.validate_record(row, self.standard, self.abi)

    def test_incomplete_or_changed_abi_rejected(self):
        row = self.record()
        row["ABI"] = json.dumps(self.abi[:-1])
        with self.assertRaises(ValueError):
            verifier.validate_record(row, self.standard, self.abi)


if __name__ == "__main__":
    unittest.main()
