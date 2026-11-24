import copy
import datetime
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

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
        self.sales = {f"{item['chain_id']}:{item['name']}": {
            "state": "available", "error": None, "checkedAge": 2, "block": "100",
            "position": ["100", None, None], "releaseId": "0x" + "a" * 64,
            "reviewHash": "0x" + "b" * 64, "selectedAt": iso(NOW - 600)
        } for item in CONFIG["market_checkpoints"]}
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
        return 200, json.dumps({name: {"block": {"timestamp": self.now - lag, "number": 110}}
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
        self.reorgs = Mock(return_value=[])

    def check(self, config=CONFIG):
        self.production.now = self.now
        health = self.health
        if health == "current":
            health = {"checkedAt": iso(self.now), "healthy": True, "failures": []}
        report = monitor.cycle(config, self.directory, health, read=self.production.read,
                               deliver=self.deliver, now=self.now, reorgs=self.reorgs)
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
            self.harness.production.sales["56:bnb-sales"]["state"] = state
            self.harness.checks(1)
        self.harness.deliver.assert_not_called()

    def test_sustained_sales_problem_alerts_with_reason(self):
        self.harness.production.sales["56:bnb-sales"].update(
            state="unavailable", error="shared_receipt_pending")
        self.harness.checks(9)
        self.harness.deliver.assert_not_called()
        self.harness.check()
        self.assertIn("shared_receipt_pending", self.harness.mail()[1])

    def advance_sales(self, count):
        sales = self.harness.production.sales["8453:seaport-sales"]
        sales["state"] = "syncing"
        for index in range(count):
            # A large block can span multiple pages. Consuming logs is progress
            # even before the completed-block checkpoint moves.
            sales["position"] = ["100", {"number": "100"}, {"logIndex": index}]
            report = self.harness.check()
        return report

    def test_advancing_replay_warns_with_impact_and_handover_context(self):
        report = self.advance_sales(10)
        subject, body = self.harness.mail()
        self.assertIn("WARNING: sales history", subject)
        self.assertIn("base sales history", body)
        self.assertIn("replay advancing", body)
        self.assertIn("syncing observed for 540s", body)
        self.assertIn("10 blocks behind indexed head", body)
        self.assertIn("source release 0x", body)
        self.assertIn("handover review 0x", body)
        self.assertIn("sales history may be incomplete", body)
        self.assertIn("market-8453-seaport-sales", report["failing"])
        self.assertEqual(report["sales"]["market-8453-seaport-sales"]["severity"], "warning")

    def test_heartbeat_without_cursor_movement_is_a_stall(self):
        self.harness.production.sales["8453:seaport-sales"]["state"] = "syncing"
        report = self.harness.checks(10)
        self.assertIn("ALERT: sales history", self.harness.mail()[0])
        self.assertEqual(report["sales"]["market-8453-seaport-sales"]["reason"], "sales_stalled")
        self.assertIn("no committed position change", self.harness.mail()[1])

    def test_warning_escalates_once_and_failed_delivery_retries(self):
        self.advance_sales(10)
        self.harness.checks(13)
        self.harness.deliver.assert_called_once()
        self.harness.deliver.side_effect = OSError("private SMTP credentials")
        report = self.harness.check()
        self.assertEqual(report["emailDelivery"], "failed")
        self.assertNotIn("credentials", json.dumps(report))
        self.harness.deliver.side_effect = None
        self.harness.check()
        self.assertIn("ALERT: sales history", self.harness.mail()[0])
        calls = self.harness.deliver.call_count
        self.harness.checks(20)
        self.assertEqual(self.harness.deliver.call_count, calls)
        self.harness.production.sales["8453:seaport-sales"]["state"] = "available"
        self.harness.checks(2)
        self.assertEqual(self.harness.deliver.call_count, calls + 1)
        self.assertIn("RECOVERED: sales history", self.harness.mail()[0])

    def test_advancing_replay_cannot_warn_forever(self):
        report = self.advance_sales(40)
        self.assertEqual(report["sales"]["market-8453-seaport-sales"]["reason"], "sales_sync_overdue")
        self.assertEqual(self.harness.deliver.call_count, 2)
        self.assertIn("ALERT", self.harness.mail()[0])

    def test_available_but_stale_or_missing_heartbeat_alerts(self):
        for age in (None, 361, -31):
            self.harness.production.sales["8453:seaport-sales"]["checkedAge"] = age
            report = self.harness.check()
            self.assertEqual(report["sales"]["market-8453-seaport-sales"]["reason"], "sales_stale")
        self.harness.checks(7)
        self.assertIn("ALERT: sales history", self.harness.mail()[0])

    def test_available_with_error_does_not_recover(self):
        self.harness.production.sales["8453:seaport-sales"]["error"] = "shared_receipt_pending"
        report = self.harness.checks(10)
        self.assertIn("market-8453-seaport-sales", report["failing"])
        self.assertIn("shared_receipt_pending", self.harness.mail()[1])

    def test_seaport_chains_do_not_overwrite_each_other(self):
        self.harness.production.sales["1:seaport-sales"]["state"] = "unavailable"
        report = self.harness.checks(10)
        self.assertEqual(report["failing"], ["market-1-seaport-sales"])
        self.assertIn("mainnet sales history", self.harness.mail()[1])
        self.assertTrue(report["sales"]["market-8453-seaport-sales"]["ok"])
        self.assertTrue(report["sales"]["market-137-seaport-sales"]["ok"])

    def test_unreadable_market_database_is_an_alert(self):
        self.harness.production.sales = None
        self.harness.checks(10)
        self.assertIn("ALERT: sales history", self.harness.mail()[0])
        self.assertIn("No checkpoint", self.harness.mail()[1])

    def test_monitor_gap_does_not_invent_stalled_progress(self):
        self.advance_sales(3)
        self.harness.now += 600
        sample = self.harness.check()["sales"]["market-8453-seaport-sales"]
        self.assertEqual(sample["severity"], "warning")
        self.assertIn("observing progress", sample["detail"])
        self.assertNotIn("stalled", sample["reason"])

    def test_old_active_incident_migrates_without_duplicate_notification(self):
        self.harness.production.sales["8453:seaport-sales"]["state"] = "unavailable"
        self.harness.checks(10)
        path = self.harness.directory / "state.json"
        state = json.loads(path.read_text())
        state["market-seaport-sales"] = state.pop("market-8453-seaport-sales")
        state["market-seaport-sales"].pop("notified_severity")
        path.write_text(json.dumps(state))
        self.harness.checks(10)
        self.harness.deliver.assert_called_once()
        self.harness.production.sales["8453:seaport-sales"]["state"] = "available"
        self.harness.checks(2)
        self.assertEqual(self.harness.deliver.call_count, 2)
        self.assertIn("RECOVERED", self.harness.mail()[0])

    def test_market_limits_are_backward_compatible_and_validated(self):
        old = copy.deepcopy(CONFIG)
        for key in ("max_market_check_age_seconds", "max_market_stall_seconds", "max_market_sync_seconds"):
            del old[key]
        self.assertEqual(monitor.validate_config(old)["max_market_stall_seconds"], 300)
        for value in (0, -1, True, "300"):
            broken = copy.deepcopy(CONFIG)
            broken["max_market_stall_seconds"] = value
            with self.assertRaises(ValueError):
                monitor.validate_config(broken)
        broken = copy.deepcopy(CONFIG)
        broken["market_checkpoints"].append(broken["market_checkpoints"][0])
        with self.assertRaises(ValueError):
            monitor.validate_config(broken)

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


def journal_line(message, cursor, moment=NOW):
    return json.dumps({"MESSAGE": message, "__CURSOR": cursor,
                       "__REALTIME_TIMESTAMP": str(int(moment * 1_000_000))})


# Formats copied from the production indexer journal on 2026-11-05.
PRODUCTION_LINES = [
    journal_line("19:12:42.352 INFO  Reorged block chain=base number=53577908 (256ms)", "a"),
    journal_line("19:12:51.504 WARN  Encountered unrecoverable reorg chain=base "
                 "finalized_block=53577916 (12ms)", "b"),
    journal_line("19:12:51.505 WARN  Failed to fetch latest block chain=base number=53577910 "
                 "hash=0x5005905571e6ab334bcbcd6ff6e24442839d04c56e13d51be9e19e25ff124326 "
                 "retry_count=0", "h"),
    journal_line("Error: Encountered unrecoverable 'base' reorg beyond finalized block 53577916", "c"),
    journal_line(json.dumps({"event": "yunipals_indexer_reorg", "chainId": 1, "depth": 45,
                             "commonAncestorBlock": 26300000}), "d"),
    journal_line(json.dumps({"event": "yunipals_indexer_reorg", "chainId": 1, "depth": 10,
                             "commonAncestorBlock": 26300100}), "e"),
    journal_line("08:01:00.000 WARN  Encountered unrecoverable reorg chain=polygon "
                 "finalized_block=96000000 (5ms)", "f"),
    journal_line("08:02:00.000 INFO  Reorged block chain=unknown number=1 (1ms)", "g"),
    "not json",
]


class ReorgTrackingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def run_with(self, stdout="", returncode=0, stderr=""):
        return Mock(return_value=subprocess.CompletedProcess([], returncode, stdout=stdout,
                                                             stderr=stderr))

    def test_production_messages_are_classified(self):
        run = self.run_with("\n".join(PRODUCTION_LINES))
        events = monitor.journal_reorgs(CONFIG, self.directory, run=run)
        found = [(e["chain"], e["kind"], e["depth"], e["deep"]) for e in events]
        self.assertEqual(found, [
            ("base", "reorg", None, False),
            # Production's 19:12:51 event: the received block was older than finality.
            ("base", "stale_provider_response", None, False),
            ("mainnet", "reorg_depth", 45, True),
            ("mainnet", "reorg_depth", 10, False),
            ("polygon", "beyond_ponder_window", None, True),
        ])
        self.assertEqual(events[1]["block"], 53577916)
        self.assertEqual(events[1]["receivedBlock"], 53577910)
        # Polygon's warning had no following line, so it stays a deep reorg.
        self.assertIsNone(events[4]["receivedBlock"])

    def test_a_newer_received_block_is_a_real_deep_reorg(self):
        lines = [
            journal_line("x WARN  Encountered unrecoverable reorg chain=bnb finalized_block=100 (0ms)", "1"),
            journal_line("x WARN  Failed to fetch latest block chain=bnb number=140 hash=0x1 retry_count=0", "2"),
            journal_line("x WARN  Failed to fetch latest block chain=bnb number=150 hash=0x2 retry_count=1", "3"),
        ]
        events = monitor.journal_reorgs(CONFIG, self.directory, run=self.run_with("\n".join(lines)))
        self.assertEqual([(e["kind"], e["deep"], e["receivedBlock"]) for e in events],
                         [("beyond_ponder_window", True, 140)])

    def test_reads_are_incremental_and_a_first_read_is_bounded(self):
        run = self.run_with()
        monitor.journal_reorgs(CONFIG, self.directory, run=run)
        arguments = run.call_args.args[0]
        self.assertIn("-5min", arguments)
        self.assertIn(f"--cursor-file={self.directory / 'journal.cursor'}", arguments)
        (self.directory / "journal.cursor").write_text("s=1")
        monitor.journal_reorgs(CONFIG, self.directory, run=run)
        self.assertNotIn("--since", run.call_args.args[0])
        monitor.journal_reorgs(CONFIG, self.directory, since="2026-11-01", run=run)
        backfill = run.call_args.args[0]
        self.assertIn("2026-11-01", backfill)
        self.assertFalse(any(item.startswith("--cursor-file") for item in backfill))

    def test_no_matching_entries_is_not_an_error(self):
        self.assertEqual(monitor.journal_reorgs(CONFIG, self.directory,
                                                run=self.run_with(returncode=1)), [])
        for result in (self.run_with(returncode=1, stderr="Failed to open journal"),
                       self.run_with(returncode=2)):
            with self.assertRaises(RuntimeError):
                monitor.journal_reorgs(CONFIG, self.directory, run=result)

    def test_records_are_kept_once_and_privately(self):
        events = monitor.journal_reorgs(CONFIG, self.directory,
                                        run=self.run_with("\n".join(PRODUCTION_LINES)))
        self.assertEqual(monitor.record_reorgs(self.directory, events), 5)
        self.assertEqual(monitor.record_reorgs(self.directory, events), 0)
        path = self.directory / "reorgs.jsonl"
        self.assertEqual(len(path.read_text().splitlines()), 5)
        summary = monitor.reorg_summary(self.directory, NOW)
        self.assertEqual(summary["chains"]["base"]["all"], {"reorgs": 1, "deep": 0, "stale": 1})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_summary_windows_and_depth_records(self):
        lines = [
            journal_line("x INFO  Reorged block chain=bnb number=1 (1ms)", "1", NOW - 3600),
            journal_line("x INFO  Reorged block chain=bnb number=2 (1ms)", "2", NOW - 2 * 86400),
            journal_line("x WARN  Encountered unrecoverable reorg chain=bnb finalized_block=3 (1ms)",
                         "3", NOW - 10 * 86400),
            journal_line("x INFO  Reorged block chain=mainnet number=4 (1ms)", "4", NOW - 40 * 86400),
            journal_line(json.dumps({"event": "yunipals_indexer_reorg", "chainId": 1, "depth": 40,
                                     "commonAncestorBlock": 4}), "5", NOW - 40 * 86400),
        ]
        monitor.record_reorgs(self.directory, monitor.journal_reorgs(
            CONFIG, self.directory, run=self.run_with("\n".join(lines))))
        summary = monitor.reorg_summary(self.directory, NOW)
        bnb = summary["chains"]["bnb"]
        self.assertEqual(bnb["24h"], {"reorgs": 1, "deep": 0, "stale": 0})
        self.assertEqual(bnb["7d"], {"reorgs": 2, "deep": 0, "stale": 0})
        self.assertEqual(bnb["30d"], {"reorgs": 3, "deep": 1, "stale": 0})
        # A depth record describes a reorg already counted from its own log line.
        self.assertEqual(summary["chains"]["mainnet"]["all"], {"reorgs": 1, "deep": 1, "stale": 0})
        self.assertEqual(len(summary["latestDeep"]), 2)

    def test_report_prints_counts(self):
        monitor.record_reorgs(self.directory, monitor.journal_reorgs(
            CONFIG, self.directory, run=self.run_with("\n".join(PRODUCTION_LINES))))
        with patch("builtins.print") as output:
            monitor.print_reorg_report(monitor.reorg_summary(self.directory, NOW))
        text = "\n".join(" ".join(map(str, call.args)) for call in output.call_args_list)
        self.assertIn("base", text)
        self.assertIn("beyond Ponder's finality window", text)
        self.assertIn("depth 45", text)
        self.assertIn("received 53577910, finalized 53577916", text)

    def test_unreadable_journal_alerts_only_when_persistent(self):
        harness = Harness(self.directory)
        harness.reorgs = Mock(side_effect=RuntimeError("no access"))
        for _ in range(14):
            report = harness.check()
        harness.deliver.assert_not_called()
        self.assertEqual(report["failing"], ["reorg-tracking"])
        self.assertIsNone(report["metrics"]["newReorgs"])
        harness.check()
        self.assertIn("reorg-tracking", harness.mail()[0])
        self.assertIn("systemd-journal", harness.mail()[1])

    def test_new_reorgs_are_recorded_during_checks(self):
        harness = Harness(self.directory)
        harness.reorgs = Mock(side_effect=lambda config, directory: monitor.journal_reorgs(
            config, directory, run=self.run_with("\n".join(PRODUCTION_LINES))))
        self.assertEqual(harness.check()["metrics"]["newReorgs"], 5)
        self.assertEqual(harness.check()["metrics"]["newReorgs"], 0)
        harness.deliver.assert_not_called()


class LockTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.config = self.directory / "config.json"
        self.config.write_text(json.dumps(CONFIG))

    def run_main(self, *arguments):
        import fcntl
        import sys
        import threading
        lock = (self.directory / "run.lock").open("w")
        fcntl.flock(lock, fcntl.LOCK_EX)
        releaser = threading.Timer(0.3, lambda: (fcntl.flock(lock, fcntl.LOCK_UN), lock.close()))
        releaser.start()
        argv = ["monitor", "--config", str(self.config), "--state-dir", str(self.directory), *arguments]
        with patch.object(sys, "argv", argv), patch("builtins.print") as output, \
                patch.object(monitor, "journal_reorgs", return_value=[]) as journal, \
                patch.object(monitor, "cycle") as checks:
            monitor.main()
        releaser.join()
        return output, journal, checks

    def test_manual_import_waits_for_a_running_check(self):
        output, journal, _ = self.run_main("--backfill-reorgs=2026-11-01")
        journal.assert_called_once()
        output.assert_called_once_with(json.dumps({"backfilledReorgs": 0}))

    def test_scheduled_check_still_skips_an_overlapping_run(self):
        health = self.directory / "health.json"
        health.write_text("{}")
        output, _, checks = self.run_main("--production-health", str(health))
        checks.assert_not_called()
        output.assert_not_called()


if __name__ == "__main__":
    unittest.main()
