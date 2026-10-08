# Public collection request monitoring

The monitor reads the same public EVM and Solana rarity-sorted first pages as the website, the Islands collection page, and staking readiness. Each check measures the complete response body, validates its shape, and treats non-200 responses, timeouts, malformed bodies, unavailable staking verification and responses over five seconds as failures. It makes four bounded HTTPS reads per cycle without database or blockchain credentials.

The default timer runs one minute after the preceding check completes. Three consecutive unhealthy checks open an incident; two healthy checks close it. Gaps over three minutes reset consecutive-check counters without forgetting an open incident. Each route has independent state. Notifications from one cycle share a single email. A continuing incident produces no repeated emails. State survives reboots, concurrent invocations are locked out, and failed SMTP delivery remains pending for the next cycle. SMTP cannot guarantee exactly-once delivery if the provider accepts an email but the connection fails before acknowledgement.

Seven days of timings and status codes are retained under `/var/lib/yunipals-request-monitor`; response bodies and mail credentials are not recorded. `latest.json` exposes email delivery status separately from endpoint health. Corrupt state and delivery failures fail the systemd service instead of silently dropping alerts. Alert times in stored reports are UTC.

## Installation

1. Pin an immutable release containing `scripts/request_monitor.py`. It requires Python 3 and curl only.
2. Install `deploy/request-monitor.json` at `/etc/yunipals-indexer/request-monitor.json`. The supplied config starts with `email_enabled=false` so it can collect timings before mail delivery is configured.
3. Install the service template after replacing `@INDEXER_DIR@` with that release's indexer directory, then install the timer. The service runs as an isolated dynamic user and has write access only to its state directory.
4. Configure `request-monitor.env` from the example using an existing SMTP provider, verified sender and intended recipient. Keep the file root-owned and mode 0600. STARTTLS on port 587 and implicit TLS on port 465 both verify the server certificate. These credentials belong on the server, never in a frontend environment variable or Git.
5. Set `email_enabled=true` in the JSON config. Send a test using the same service environment and the script's `--test-email` option; successful SMTP acceptance is reported without exposing credentials. Confirm inbox receipt before calling email delivery verified.
6. Run `systemctl enable --now yunipals-request-monitor.timer`, start `yunipals-request-monitor.service` once, and inspect its journal and `latest.json`.

```sh
python3 -m unittest discover -s apps/yunipals-indexer/scripts -p 'test_request_monitor.py' -v
journalctl -u yunipals-request-monitor.service --since '1 hour ago'
```

Stop checks with `systemctl disable --now yunipals-request-monitor.timer`; stop an active check separately if needed. Setting `email_enabled=false` pauses email while preserving timing collection and pending incidents. No monitoring action restarts application services or changes data.

This is synthetic monitoring of the configured public routes, not an audit of every user request. The initial deployment runs on the API server, so a total server/network outage can also stop its ability to send email. For independent outage detection, run the same monitor from a separate host with its own state and email configuration, replacing the local timer to avoid duplicate alerts.
