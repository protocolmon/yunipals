#!/usr/bin/env python3
"""Boundary and refusal controls; actual SQL is also exercised by the PG test."""
import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("parity", Path(__file__).with_name("booster-source-parity-v3.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def point(block, timestamp=1792687427, tail="9" * 33):
    return f"{timestamp:010d}{8453:016d}{block:016d}" + tail


def fixture():
    now = 1792687428
    header = {"chainId": 8453, "number": 52949040, "hash": "0x" + "ab" * 32,
              "timestamp": now - 1, "observedAt": datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat()}
    source = lambda name, block: {"schema": name, "app": {"version": "6", "is_dev": "0", "is_locked": "1",
        "is_ready": "1", "build_id": m.BUILDS[name], "heartbeat_at": now * 1000}, "checkpoint": point(block)}
    snapshot = {"now": now, "sources": [source(m.LEFT, header["number"] + 2), source(m.RIGHT, header["number"])],
                "readOnly": "on", "isolation": "repeatable read", "tails": {"left": 0, "right": 0},
                "unexpectedContracts": {"left": 0, "right": 0},
                "nativeBoundaryHeader": {key: header[key] for key in ("number", "hash", "timestamp")},
                "tables": [{"table": name, "leftCount": 1, "rightCount": 1, "differences": 0,
                            "leftSha256": "a" * 64, "rightSha256": "a" * 64,
                            "leftColumns": [{"name": "id", "type": 25}], "rightColumns": [{"name": "id", "type": 25}]}
                           for name in m.TABLES]}
    snapshot['routes']=[{'route':name,'leftCount':1,'rightCount':1,'differences':0,'leftSha256':'b'*64,'rightSha256':'b'*64}for name in m.ROUTES]
    return snapshot, header


class ParityControls(unittest.TestCase):
    def test_different_complete_heights_are_valid_only_with_empty_booster_tails(self):
        snapshot, header = fixture()
        self.assertTrue(m.assess(snapshot, header)["passed"])
        snapshot["tails"]["left"] = 1
        self.assertIn("newer_booster_events_require_a_later_boundary", m.assess(snapshot, header)["reasons"])

    def test_partial_checkpoint_proves_only_previous_block(self):
        self.assertEqual(m.complete_block(point(52949040, tail="0" * 33)), 52949039)
        snapshot, header = fixture()
        snapshot["sources"][1]["checkpoint"] = point(header["number"], tail="0" * 33)
        self.assertIn(m.RIGHT + ":incomplete_boundary", m.assess(snapshot, header)["reasons"])
        with self.assertRaisesRegex(ValueError, "chain"):
            m.complete_block(point(52949040)[:10] + f"{1:016d}" + point(52949040)[26:])

    def test_native_header_is_required_even_on_quiet_blocks(self):
        snapshot, header = fixture()
        snapshot["nativeBoundaryHeader"]["hash"] = "0x" + "cd" * 32
        self.assertIn("combined_native_header_must_match_external_witness", m.assess(snapshot, header)["reasons"])

    def test_each_state_relation_and_every_field_must_match(self):
        for table in m.TABLES:
            snapshot, header = fixture()
            row = next(row for row in snapshot["tables"] if row["table"] == table)
            row["differences"] = 2
            self.assertIn(table + ":state_difference", m.assess(snapshot, header)["reasons"])
        snapshot, header = fixture()
        snapshot["tables"][0]["rightColumns"].append({"name": "extra", "type": 25})
        self.assertFalse(m.assess(snapshot, header)["passed"])

    def test_stale_runtime_wrong_build_and_missing_table_are_not_accepted(self):
        mutations = [lambda s: s["sources"][0]["app"].update(heartbeat_at=0),
                     lambda s: s["sources"][1]["app"].update(build_id="another-build"),
                     lambda s: s["tables"].pop(), lambda s: s.update(isolation="read committed"),
                     lambda s: s["sources"][1]["app"].update(is_ready="0")]
        for mutate in mutations:
            snapshot, header = fixture()
            mutate(snapshot)
            self.assertFalse(m.assess(snapshot, header)["passed"])

    def test_stale_or_relabelled_witness_and_injected_identifier_are_refused(self):
        snapshot, header = fixture()
        header["timestamp"] -= 181
        self.assertFalse(m.assess(snapshot, header)["passed"])
        for value in ["launch;DROP TABLE booster_type", "launch'", "launch\"", "../launch"]:
            with self.assertRaises(ValueError):
                m.snapshot_sql(left=value)
        header["lastBoosterEvent"] = {}
        with self.assertRaisesRegex(ValueError, "external_header"):
            m.header_witness(header)


class CurrentFeatureControls(unittest.TestCase):
    def test_missing_or_different_current_route_witness_is_not_parity(self):
        for kind in('missing','hash','count','difference','empty'):
            snapshot,header=fixture()
            if kind=='missing':snapshot['routes'].pop()
            elif kind=='hash':snapshot['routes'][0]['rightSha256']='c'*64
            elif kind=='count':snapshot['routes'][1]['rightCount']=0
            elif kind=='difference':snapshot['routes'][2]['differences']=2
            else:snapshot['routes'][2].update(leftCount=0,rightCount=0)
            self.assertFalse(m.assess(snapshot,header)['passed'])
    def test_raw_birth_journal_serialization_is_preserved(self):
        self.assertEqual(m.row_expression('e','booster_event'),'to_jsonb(e)')
        sql=m.route_queries(m.LEFT,52949040)['actualBirthJournal']
        self.assertIn('to_jsonb(e)AS row',sql)
        self.assertNotIn("to_jsonb(e)-'args'",sql)

    def test_recent_feed_witness_is_mandatory_at_the_same_canonical_boundary(self):
        snapshot,header=fixture()
        snapshot['routes']=[r for r in snapshot['routes']if r['route']!='recentOpenings']
        self.assertIn('all_current_public_feature_route_witnesses_required',m.assess(snapshot,header)['reasons'])
        snapshot,header=fixture();row=next(r for r in snapshot['routes']if r['route']=='recentOpenings')
        row['rightSha256']='c'*64
        self.assertIn('recentOpenings:route_difference',m.assess(snapshot,header)['reasons'])
        for bad in('schema;drop','../schema','schema\"'):
            with self.assertRaises(ValueError):m.recent_query(m.LEFT,52949040,bad)

if __name__ == "__main__":
    unittest.main(verbosity=2)
