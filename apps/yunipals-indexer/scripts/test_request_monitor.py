import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import request_monitor as monitor

CONFIG = json.loads((Path(__file__).parent.parent / "deploy/request-monitor.json").read_text())
GOOD = {"ok": True, "seconds": 0.2, "status": 200, "reason": None}
BAD = {"ok": False, "seconds": 7, "status": 200, "reason": "slow_response"}


class MonitorTests(unittest.TestCase):
    def test_alert_and_recovery_require_consecutive_checks(self):
        state = {}
        for now, sample in enumerate([BAD, BAD, GOOD, BAD, BAD]):
            state = monitor.advance(state, sample, now * 60, CONFIG)
            self.assertIsNone(monitor.pending_event(state, CONFIG))
        state = monitor.advance(state, BAD, 300, CONFIG)
        self.assertEqual(monitor.pending_event(state, CONFIG), "alert")
        state["notified"] = True
        state = monitor.advance(state, BAD, 360, CONFIG)
        self.assertIsNone(monitor.pending_event(state, CONFIG))
        state = monitor.advance(state, GOOD, 420, CONFIG)
        self.assertIsNone(monitor.pending_event(state, CONFIG))
        state = monitor.advance(state, GOOD, 480, CONFIG)
        self.assertEqual(monitor.pending_event(state, CONFIG), "recovery")

    def test_interrupted_checks_do_not_count_as_consecutive(self):
        state = monitor.advance({}, BAD, 0, CONFIG)
        state = monitor.advance(state, BAD, 60, CONFIG)
        state = monitor.advance(state, BAD, 1000, CONFIG)
        self.assertEqual(state["bad"], 1)
        self.assertIsNone(monitor.pending_event(state, CONFIG))

    def test_persisted_delivery_retry_and_quiet_unchanged_incident(self):
        config = copy.deepcopy(CONFIG)
        config.update(email_enabled=True, routes=CONFIG["routes"][:1])
        sample = Mock(return_value=BAD)
        mail = Mock(side_effect=OSError("secret provider details must not be printed"))
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for now in (0, 60):
                monitor.cycle(config, directory, sample, mail, now)
            mail.assert_not_called()
            result = monitor.cycle(config, directory, sample, mail, 120)
            self.assertEqual(result["emailDelivery"], "failed")
            self.assertNotIn("secret", (directory / "latest.json").read_text())
            mail.side_effect = None
            self.assertEqual(monitor.cycle(config, directory, sample, mail, 180)["emailDelivery"], "sent")
            monitor.cycle(config, directory, sample, mail, 240)
            self.assertEqual(mail.call_count, 2)
            sample.return_value = GOOD
            monitor.cycle(config, directory, sample, mail, 300)
            self.assertEqual(monitor.cycle(config, directory, sample, mail, 360)["emailDelivery"], "sent")
            monitor.cycle(config, directory, sample, mail, 420)
            self.assertEqual(mail.call_count, 3)
            self.assertIn("RECOVERED", mail.call_args.args[0])

    def test_failed_recovery_is_not_sent_during_renewed_failure(self):
        state = {"active": False, "notified": True, "good": 2, "checked_at": 0}
        state = monitor.advance(state, BAD, 60, CONFIG)
        self.assertIsNone(monitor.pending_event(state, CONFIG))

    def test_disabled_email_leaves_incident_ready_for_activation(self):
        config = copy.deepcopy(CONFIG)
        config["routes"] = CONFIG["routes"][:1]
        mail = Mock()
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for now in (0, 60, 120):
                monitor.cycle(config, directory, lambda *_: BAD, mail, now)
            mail.assert_not_called()
            config["email_enabled"] = True
            monitor.cycle(config, directory, lambda *_: BAD, mail, 180)
            mail.assert_called_once()

    def test_multiple_routes_batch_one_notification(self):
        config = copy.deepcopy(CONFIG)
        config.update(email_enabled=True, failure_checks=1)
        mail = Mock()
        with tempfile.TemporaryDirectory() as folder:
            monitor.cycle(config, Path(folder), lambda *_: BAD, mail, 0)
        mail.assert_called_once()
        for route in config["routes"]:
            self.assertIn(route["name"], mail.call_args.args[1])

    def test_probe_validates_body_and_total_elapsed_time(self):
        route = CONFIG["routes"][0]
        body = {"items": [{"tokenId": "1", "chain": "ethereum", "burned": False}], "total": 1}
        def result(body, status=200, code=0):
            return Mock(returncode=code, stdout=json.dumps(body).encode() + f"\n{status}".encode())
        for response, seconds, reason in [
            (result(body), 0.2, None), (result(body), 6, "slow_response"),
            (result(body, 503), 0.2, "http_error"),
            (result(body, 0, 28), 12, "timeout"),
            (result({"status": "ok"}), 0.2, "invalid_or_unready_response")
        ]:
            with self.subTest(reason=reason):
                run = Mock(return_value=response)
                sample = monitor.probe(route, CONFIG, run, Mock(side_effect=[0, seconds]))
                self.assertEqual(sample["reason"], reason)
                self.assertIn("--max-time", run.call_args.args[0])
                self.assertIn("--max-filesize", run.call_args.args[0])

    def test_staking_requires_ready_and_enabled(self):
        self.assertTrue(monitor.valid_response("staking", {"enabled": True, "ready": True}))
        self.assertFalse(monitor.valid_response("staking", {"enabled": True, "ready": False}))
        self.assertFalse(monitor.valid_response("staking", {"ready": True}))

    def test_corrupt_state_fails_without_sending(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / "state.json").write_text("broken")
            mail = Mock()
            with self.assertRaises(ValueError):
                monitor.cycle(CONFIG, directory, lambda *_: BAD, mail, 0)
            mail.assert_not_called()

    def test_config_rejects_unsafe_or_unbounded_probes(self):
        self.assertEqual(monitor.validate_config(copy.deepcopy(CONFIG)), CONFIG)
        for url in ["http://api.yunipals.com/", "https://user:pass@api.yunipals.com/", "https://api.yunipals.com/#fragment"]:
            config = copy.deepcopy(CONFIG)
            config["routes"][0]["url"] = url
            with self.assertRaises(ValueError):
                monitor.validate_config(config)

    @patch.dict("os.environ", {"MONITOR_SMTP_HOST": "smtp.example.test", "MONITOR_EMAIL_FROM": "monitor@example.test", "MONITOR_EMAIL_TO": "owner@example.test", "MONITOR_SMTP_TLS": "starttls", "MONITOR_SMTP_USER": "monitor", "MONITOR_SMTP_PASSWORD": "test-only"}, clear=True)
    def test_smtp_upgrades_to_tls_before_authentication(self):
        with patch.object(monitor.smtplib, "SMTP") as factory:
            connection = factory.return_value.__enter__.return_value
            connection.send_message.return_value = {}
            monitor.send_email("Test", "Body")
            self.assertEqual([call[0] for call in connection.method_calls], ["starttls", "login", "send_message"])
            self.assertEqual(str(connection.send_message.call_args.args[0]["To"]), "owner@example.test")


if __name__ == "__main__":
    unittest.main()
