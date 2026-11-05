import copy
import datetime
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock

import indexer_health_monitor as monitor

CONFIG = monitor.validate_config(json.loads(
    (Path(__file__).parent.parent / "deploy/indexer-health-monitor.json").read_text()))
NOW = int(time.time())
CHECKPOINT = "unified_shared_20261102_v2._ponder_checkpoint"


def iso(moment):
    return datetime.datetime.fromtimestamp(moment, datetime.timezone.utc).isoformat()


class Production:
    """A healthy production system that each test then breaks in one specific way."""

    def __init__(self):
        self.lag = {"mainnet": 14, "bnb": 3, "polygon": 20, "base": 3}
        self.ready = 200
        self.status_works = True
        self.oldest = {"pid": 7, "user": "yunipals", "application": "", "state": "active",
                       "seconds": 60, "query": "SELECT 1"}
        self.dead = {"pg_catalog.pg_attribute": 8000, CHECKPOINT: 400,
                     "unified_shared_20261102_v2.chain_checkpoint": 400}
        self.worker_age = 3
        self.observation = {"age": 10, "error": None}
        self.sales = {"bnb-sales": {"state": "available", "error": None},
                      "seaport-sales": {"state": "available", "error": None}}
        self.indexer_read_works = True
        self.now = NOW

    def query(self, database, _sql):
        if database["name"] == CONFIG["market_database"]["name"]:
            return self.sales
        if not self.indexer_read_works:
            raise RuntimeError("Database read failed")
        return {"oldest": self.oldest, "dead": self.dead, "workerAge": self.worker_age,
                "observations": {str(chain["chain_id"]): self.observation
                                 for chain in CONFIG["chains"].values()}}

    def status(self, url):
        if url.endswith("/ready"):
            return self.ready, b""
        if not self.status_works:
            raise OSError("refused")
        return 200, json.dumps({name: {"block": {"timestamp": self.now - lag}}
                                for name, lag in self.lag.items()}).encode()

    def read(self, config, now, production_health):
        return monitor.collect(config, now, production_health, query=self.query, status=self.status)


class Harness:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.production = Production()
        self.health = "current"
        self.deliver = Mock()
        self.now = NOW

    def check(self, config=CONFIG):
        self.production.now = self.now
        health = self.health
        if health == "current":
            health = {"checkedAt": iso(self.now), "healthy": True, "failures": []}
        report = monitor.cycle(config, self.directory, health, read=self.production.read,
                               deliver=self.deliver, now=self.now)
        self.now += 60
        return report

    def checks(self, count):
        return [self.check() for _ in range(count)][-1]

    def mail(self):
        return self.deliver.call_args.args


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.harness = Harness(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def test_healthy_system_sends_nothing(self):
        report = self.harness.checks(20)
        self.harness.deliver.assert_not_called()
        self.assertEqual(report["failing"], [])
        self.assertEqual(report["emailDelivery"], "idle")

    def test_todays_stuck_transaction_alerts_once_and_recovers(self):
        # On 2026-11-05 this query held a snapshot for 3h52m, and BNB fell behind after 3h.
        self.harness.production.oldest = {
            "pid": 3305200, "user": "yunipals", "application": "", "state": "active",
            "seconds": 1201, "query": "SELECT m.collection,m.token_id::text"}
        self.harness.checks(2)
        self.harness.deliver.assert_not_called()
        self.harness.check()
        self.harness.deliver.assert_called_once()
        subject, body = self.harness.mail()
        self.assertIn("ALERT", subject)
        self.assertIn("oldest-transaction", subject)
        self.assertIn("pid 3305200", body)
        self.assertIn("SELECT m.collection", body)
        self.assertIn("pg_cancel_backend", body)
        self.harness.checks(30)
        self.harness.deliver.assert_called_once()

        self.harness.production.oldest["seconds"] = 40
        self.harness.check()
        self.harness.deliver.assert_called_once()
        self.harness.check()
        self.assertEqual(self.harness.deliver.call_count, 2)
        self.assertIn("RECOVERED", self.harness.mail()[0])

    def test_transaction_at_the_limit_is_not_a_problem(self):
        self.harness.production.oldest["seconds"] = CONFIG["max_transaction_seconds"]
        self.harness.checks(10)
        self.harness.deliver.assert_not_called()

    def test_no_open_transaction_is_healthy(self):
        self.harness.production.oldest = None
        self.assertEqual(self.harness.check()["failing"], [])

    def test_bnb_lag_alerts_after_five_checks(self):
        self.harness.production.lag["bnb"] = CONFIG["chains"]["bnb"]["max_lag_seconds"] + 1
        self.harness.checks(4)
        self.harness.deliver.assert_not_called()
        self.harness.check()
        subject, body = self.harness.mail()
        self.assertIn("lag-bnb", subject)
        self.assertIn("index_block", body)

    def test_each_chain_has_its_own_lag_limit(self):
        self.harness.production.lag["polygon"] = 200
        self.harness.production.lag["mainnet"] = 200
        self.assertEqual(self.harness.check()["failing"], [])
        self.harness.production.lag["base"] = 200
        self.assertEqual(self.harness.check()["failing"], ["lag-base"])

    def test_normal_restart_does_not_alert(self):
        # Recovery took 3.5 minutes after the fixes, with Ponder not answering.
        self.harness.production.ready = 503
        self.harness.production.status_works = False
        self.harness.checks(4)
        self.harness.deliver.assert_not_called()
        self.harness.production.ready = 200
        self.harness.production.status_works = True
        self.harness.checks(10)
        self.harness.deliver.assert_not_called()

    def test_stalled_recovery_alerts(self):
        self.harness.production.ready = 503
        self.harness.production.status_works = False
        self.harness.checks(5)
        subject, _ = self.harness.mail()
        self.assertIn("indexer-ready", subject)
        self.assertIn("lag-bnb", subject)

    def test_dead_rows_alert_before_indexing_slows(self):
        self.harness.production.dead[CHECKPOINT] = 10001
        self.harness.checks(3)
        self.assertIn(f"dead-rows-{CHECKPOINT}", self.harness.mail()[0])

    def test_unreadable_database_alerts_instead_of_looking_healthy(self):
        self.harness.production.indexer_read_works = False
        report = self.harness.checks(5)
        self.assertIn("oldest-transaction", report["failing"])
        self.assertIn("metadata-worker", report["failing"])
        self.harness.deliver.assert_called()

    def test_blocked_metadata_worker_alerts(self):
        self.harness.production.worker_age = CONFIG["max_worker_heartbeat_age_seconds"] + 1
        self.harness.checks(3)
        self.assertIn("metadata-worker", self.harness.mail()[0])

    def test_observation_error_alerts(self):
        self.harness.production.observation = {"age": 5, "error": "rpc_unavailable"}
        self.harness.checks(5)
        self.assertIn("rpc_unavailable", self.harness.mail()[1])

    def test_brief_sales_dip_does_not_alert(self):
        # One 7-second dip back to syncing was seen in normal operation.
        for state in ("syncing", "available"):
            self.harness.production.sales["bnb-sales"]["state"] = state
            self.harness.checks(1)
        self.harness.deliver.assert_not_called()

    def test_sustained_sales_problem_alerts_with_reason(self):
        self.harness.production.sales["bnb-sales"] = {"state": "unavailable",
                                                      "error": "shared_receipt_pending"}
        self.harness.checks(9)
        self.harness.deliver.assert_not_called()
        self.harness.check()
        self.assertIn("shared_receipt_pending", self.harness.mail()[1])

    def test_production_health_needs_fifteen_checks(self):
        self.harness.health = {"checkedAt": iso(NOW + 900), "healthy": False,
                               "failures": ["service_inactive:example.service"]}
        self.harness.checks(14)
        self.harness.deliver.assert_not_called()
        self.harness.check()
        self.assertIn("service_inactive:example.service", self.harness.mail()[1])

    def test_stale_or_missing_production_health_is_a_failure(self):
        self.harness.health = {"checkedAt": iso(NOW - 601), "healthy": True, "failures": []}
        self.assertEqual(self.harness.check()["failing"], ["production-health"])
        self.harness.health = None
        self.assertEqual(self.harness.check()["failing"], ["production-health"])

    def test_failed_email_is_retried_without_duplicates(self):
        self.harness.production.dead[CHECKPOINT] = 20000
        self.harness.deliver.side_effect = OSError("smtp password in message")
        self.harness.checks(2)
        report = self.harness.check()
        self.assertEqual(report["emailDelivery"], "failed")
        self.assertNotIn("password", json.dumps(report))
        self.harness.deliver.side_effect = None
        report = self.harness.check()
        self.assertEqual(report["emailDelivery"], "sent")
        calls = self.harness.deliver.call_count
        self.harness.checks(5)
        self.assertEqual(self.harness.deliver.call_count, calls)

    def test_disabled_email_still_records_history(self):
        config = copy.deepcopy(CONFIG)
        config["email_enabled"] = False
        self.harness.production.dead[CHECKPOINT] = 20000
        for _ in range(4):
            report = self.harness.check(config)
        self.harness.deliver.assert_not_called()
        self.assertEqual(report["emailDelivery"], "disabled")
        history = list(Path(self.temporary.name).glob("samples-*.jsonl"))
        self.assertEqual(len(history), 1)
        self.assertEqual(len(history[0].read_text().splitlines()), 4)
        self.assertEqual(history[0].stat().st_mode & 0o777, 0o600)

    def test_history_records_what_explains_a_slowdown(self):
        self.harness.check()
        self.harness.production.oldest["seconds"] = 500
        report = self.harness.check()
        self.assertEqual(report["metrics"]["oldest"]["seconds"], 500)
        self.assertEqual(report["metrics"]["lag"]["bnb"], 3)
        self.assertEqual(report["metrics"]["dead"][CHECKPOINT], 400)

    def test_corrupt_state_stops_instead_of_resending_alerts(self):
        Path(self.temporary.name, "state.json").write_text("{")
        with self.assertRaises(ValueError):
            self.harness.check()

    def test_monitor_failure_email_is_rate_limited(self):
        deliver = Mock()
        directory = Path(self.temporary.name)
        self.assertTrue(monitor.report_monitor_failure(directory, deliver, now=time.time()))
        self.assertFalse(monitor.report_monitor_failure(directory, deliver, now=time.time()))
        deliver.assert_called_once()
        self.assertIn("monitor is failing", deliver.call_args.args[0])


class ConfigAndQueryTests(unittest.TestCase):
    def test_every_query_runs_read_only_with_limits(self):
        run = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='{"ok":1}', stderr=""))
        self.assertEqual(monitor.query_json({"name": "example", "port": 15438}, "SELECT 1", run), {"ok": 1})
        arguments = run.call_args.args[0]
        self.assertIn("15438", arguments)
        options = run.call_args.kwargs["env"]["PGOPTIONS"]
        self.assertIn("default_transaction_read_only=on", options)
        self.assertIn("statement_timeout=10000", options)
        self.assertIn("idle_in_transaction_session_timeout=10000", options)
        self.assertEqual(run.call_args.kwargs["timeout"], 20)

    def test_failed_query_does_not_expose_its_output(self):
        run = Mock(return_value=subprocess.CompletedProcess([], 2, stdout="", stderr="secret detail"))
        with self.assertRaises(RuntimeError) as error:
            monitor.query_json({"name": "example"}, "SELECT 1", run)
        self.assertNotIn("secret", str(error.exception))

    def test_sql_uses_configured_names(self):
        indexer = monitor.indexer_sql(CONFIG)
        self.assertIn(CONFIG["release_id"], indexer)
        self.assertIn(CHECKPOINT, indexer)
        self.assertIn("backend_xmin IS NOT NULL", indexer)
        self.assertIn("(56,'bnb-sales')", monitor.market_sql(CONFIG))

    def test_unsafe_identifiers_are_rejected(self):
        for change in (
            lambda c: c["max_dead_rows"].update({"x'; DROP TABLE y; --": 1}),
            lambda c: c["max_dead_rows"].update({"unqualified": 1}),
            lambda c: c.update(release_id="' OR 1=1"),
            lambda c: c["market_checkpoints"].append({"chain_id": 1, "name": "x'"}),
            lambda c: c["chains"].update({"bad name": {"chain_id": 1, "max_lag_seconds": 1}}),
            lambda c: c["market_database"].update(name="x;y"),
            lambda c: c["failure_checks"].pop("lag"),
            lambda c: c.update(max_transaction_seconds=0),
            lambda c: c.update(email_enabled="yes"),
        ):
            config = copy.deepcopy(CONFIG)
            change(config)
            with self.assertRaises(ValueError):
                monitor.validate_config(config)


if __name__ == "__main__":
    unittest.main()
