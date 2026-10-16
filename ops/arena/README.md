# Arena operations

The application runs as separate API, projector, capacity, lobby, control, referee,
settlement and media workers. The public contract and rules are recorded in
[public-deployment.json](../../docs/arena/public-deployment.json). The templates
here describe the existing systemd layout; customize paths, database roles,
origins and RPC proxy endpoints for a separate installation.

## Configuration and credentials

Keep private configuration outside the checkout, for example under
`/etc/yunipals-arena/`, with root ownership and mode 0600. Start from
`runtime.env.example`, `arena.env.example` and `runware.env.example`. These contain
placeholders. Never overwrite a live configuration with an example.

- `runtime.env`: public origin, contract/deployment block/rules hash, enabled
  entry mode, storage allocation and funding policy.
- `database.env`: `ARENA_DATABASE_URL`, using a restricted application role.
- Provider files: existing OpenAI and Runware credentials, delivered only to the
  provider workers that need them.
- `ARENA_ENCRYPTION_KEY_FILE`: a 32-byte hexadecimal strategy encryption key in a
  protected file. The API requires this to protect unrevealed submissions.
- Separate admission, referee and lobby signing keys. systemd `LoadCredential`
  gives each worker only its required files. The API has no admin/referee key.
- The deployer remains in an encrypted Foundry keystore. `unlock-deployer.sh` is
  an interactive operator tool; temporary passwords must never enter the repo,
  backups or logs.

Use `provision_database.py` and `provision_private.py` only after reviewing their
paths and role settings. Keep existing production secrets unchanged. Admission
remains off until the deployment, indexer, catalog hashes and providers are ready.

## Building and staging

Build the API from the repository root and prepare the exact pinned release
runtime dependencies using `release-package.json` and `release-lock.yaml` in a
separate temporary directory. `package_release.py` accepts that directory via
`--dependencies`; its manifest must match. It includes the compiled application,
public rules/data, required reference art and soundtrack, generic operational
scripts and contract artifacts. Private records, credentials and large historical
media archives are excluded.

```sh
pnpm --filter @protopals/yunipals-market-api build
python3 contracts/arena/install-dependencies.py
(cd contracts/arena && forge build)
python3 scripts/arena/fetch_island_art.py --download
```

`install_stage.py` is deliberately restricted to the existing server hostname and
release directory. It checks the archive digest and every manifest entry, reuses
the installed island image cache and runs the offline `arena-inspect.mjs` check as
the service user. It never activates services or broadcasts transactions. A
separate operator action switches the active release after staging succeeds.
Do not copy production credentials into a release to make a build pass.

The media worker needs Python with `jsonschema`, FFmpeg/ffprobe, libx264 and
DejaVu Sans Bold at the path in `scripts/arena/render.py`. The API requires Node
24+ and PostgreSQL. See the unit files for resource limits and credential wiring.

## Intake, indexing and budgets

- HTTP reads use PostgreSQL; a page refresh never starts a chain scan. Reuse the
  configured shared RPC budget proxies for bounded ownership and chain reads.
- The projector scans at most 500 blocks per pass and waits 10 seconds when
  caught up. Arena uses three Base confirmations. Ethereum finality is not an
  Arena prerequisite. Stale/halted projection blocks new admission.
- Keep one available lobby. In ongoing mode, further lobbies can open as rosters
  fill while accepted work stays in its existing queues.
- `ARENA_OPENAI_FUNDING_MODE=capped` is the installation default. It requires an
  unexpired explicit budget; identity analysis has its own subset allowance.
- `ARENA_OPENAI_FUNDING_MODE=ongoing` authorizes ongoing provider billing and
  ignores the pilot cumulative caps/expiry and fixed two-tournament limit.
  Enable it only with the account owner's spending authorization. It does not
  represent an OpenAI account-balance measurement.
- Both modes retain fixed generation limits, ownership/rate limits, actual
  Runware credit, signer/VRF funds and disk allocation checks. Reserve 3 GiB per
  unfinished film, with a minimum 6 GiB within the default 20-GiB media quota.
- Each tournament has one referee candidate, three images and six video clips.
  Saved request IDs survive restart. A timeout with unknown submission status
  requires reconciliation; never create another paid candidate automatically.
- Artwork checks retain their cache, request-token bound, per-wallet daily limit
  and global pending-job bound. Ambiguous anatomy blocks payment.

Keep entry off in previews and during restore/recovery. A database-mode replay
must never accidentally start provider workers against a production account.

## Publication and payouts

A validated result is settled first. The media job verifies and publishes the
24-second film and its hash; only then does settlement call `releasePayouts`.
The API serves allowlisted public artifacts, never raw job directories or private
submission tables. The client waits for the indexed effect of wallet actions.

An unfilled tournament or missed referee deadline can expire with full refunds.
Missing player strategies use the approved automatic attack policy. A technical
video failure preserves successful assets and the accepted result; investigate
and repair it without changing the winner or creating a quality reroll.

## Backups and recovery

The backup, monitor and restore-drill units are included as reusable operational
code. Configure the existing storage-box destination privately. Scheduled backups
include the database and media, plus separately encrypted service/strategy keys.
API credentials, the deployer keystore and temporary passwords are excluded.
Keep the archive encryption key outside those backups. Copying signing/decryption
keys off a server requires the operator's explicit authorization.

Retain the exact release archive, verification manifest, runtime and dependency
versions. Verify an encrypted restore in isolated databases with all application
workers stopped before relying on it. Never let a restore submit generation or
broadcast a second transaction. The backup policy retains recent snapshots and
references existing media objects without deleting live films.

A canonical-history mismatch halts intake. `recover_projection.py` prepares a
bounded replay plan and requires the exact reviewed digest before application.
Preserve encrypted submissions, frozen inputs, accepted outcomes, paid task IDs,
nonces and signed transaction records. Do not reset the projector cursor to bypass
these checks. Unknown transactions are reconciled or rebroadcast as the exact same
signed bytes, never silently re-signed.

Monitoring uses systemd, the journal and local health reports. External alerts
require a separately configured notification channel. Check indexing freshness,
queue age, deadlines, provider credit, gas/VRF funds, disk and backup health.
Claims and applicable refunds remain onchain when new admission is unavailable.
