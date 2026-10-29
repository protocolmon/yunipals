# Anime Arena operations

The confirmed browser contracts are recorded in
`docs/arena/anime-browser-deployment-confirmed-v1.json`. Their owner/curator is the
browser deployment wallet; server workers cannot sign owner actions. Use
`https://www.yunipals.com/arena/anime/pilot` to open applications, apply from the
pilot NFT wallet, approve the four pinned reviewed manifests, fund the draw and
enable the controlled pilot. Applications may remain open; the paid pilot stays
limited to the explicitly configured pilot wallet. Paid entry also requires the API's
explicit pilot wallet allowlist. Keep public entry closed until pilot acceptance.

Each service loads `/etc/yunipals-anime-arena/roles/ROLE.env` with its existing
role-specific operational database identity and read-only source connection.
Copy only those two connection settings from the corresponding native Arena
role. Referee receives OpenAI access; media and capacity receive OpenRouter
access. Systemd credential trust names each anime unit and its exact key names.
No owner key is installed in a server worker.

Install the API location in the `api.yunipals.com` HTTPS server and set the
website's `VITE_ANIME_ARENA_API_URL` to
`https://api.yunipals.com/api/anime-arena`. The website is hosted separately.

For source staging, keep existing ingestion and observers running. An isolated
candidate may use four identity-bound loopback endpoints in its reviewed RPC
profile; do not replace the live profile or bypass preflight.
The isolated relays may opt into `MARKET_RPC_PROXY_UNIFIED_SOURCE_QUEUE=true`
to buffer validated free-source bursts with the existing request, byte, timeout
and cancellation bounds. This setting grants no paid fallback or replay permit;
ordinary callers keep their existing backpressure behavior. Preserve every
existing source definition, including per-contract booster deployment blocks.
Set `UNIFIED_ANIME_ARENA` to give the new arena its own Ponder log filter and
deployment block, retaining the video history cache. Register the actual Ponder
build and source definitions, wait for canonical caught-up coverage, review its
source binding, and only then enable the new operational consumers. Paid replay
requires its own bounded review; the pilot candidate has no paid replay permit.

Before the encrypted restore drill, retain the exact installed anime release
archive and checksum record under `/srv/yunipals-anime-arena/recovery`. Backups
include that release, public artwork, private studio receipts, service configuration,
media, and the pinned Node/Chromium binaries. Keep restored workers quarantined.

This is a second deployment and service set sharing `yunipals_arena`. All operational
records retain the existing deployment/incarnation keys. Keep the video source and
services running. The curator is initially the arena admin wallet and is never loaded
by a service. Batches are signed from that wallet's own keystore.

## Prepare and verify

The user selected **browser wallet deployment** on 2026-10-29. Use
`https://www.yunipals.com/arena/anime/setup` after publishing the reviewed website
build. No server keystore unlock is needed. The connected wallet becomes the new
registry owner/curator and arena owner/treasury; the existing admission, referee and
lobby worker addresses remain unchanged. Review and sign the registry creation,
then the arena creation. Applications and paid entry start closed. Copy the final
deployment record back to the operator for service/indexer setup and the pilot.

The public package is `public/arena/anime-deployment-v1.json`, pinned by SHA-256 in
the browser helper and curated website build. To explicitly regenerate it after
reviewed Solidity or rules changes, build the contracts, then run
`node --import tsx ../../scripts/anime/build-browser-deployment.mts` from the market
API directory and review/update the browser package checksum. The page estimates
fees, retains sent hashes before waiting, supports manual receipt recovery, and
verifies the exact creation input, sender, value, canonical block, deployed runtime
and closed initial state. It computes the arena rules hash from the confirmed
registry address, without guessing wallet nonces. Restore the same deployment in
another browser using its actual transaction hashes; never submit another creation
while a saved transaction is pending.

The server-keystore procedure below remains an alternative for an operator who
explicitly chooses that signing method; do not use it for this browser deployment.

1. Install the workspace with pinned dependencies. Build the market API and website;
   run the arena Solidity suite and anime tests. Install Python Pillow/numpy and ffmpeg.
   Install Node 24.22.1 and Chromium **151.0.7922.34** (headless shell) under
   `/srv/yunipals-arena/runtime/`. Verify the binary version against `engine-lock.json`.
2. Review `contracts/arena/config/anime-{economics,timing}.json`. The entry is 1,000,000
   raw USDC, winner 8000 bps, island 500 bps, remainder 1500 bps. The original referee
   reserve remains $0.70 per candidate, separate from the $0.60 operations revenue;
   fund pilot headroom for a cost spike. Model, effort and token limit are unchanged.
   Anime cut-in text requires Claude Opus 5.5 through OpenRouter, with a separate
   $0.80 reservation per outstanding film. This bounds the request envelope; the
   full-choreography comparison's actual director charge was $0.11998. The referee remains on its existing direct
   OpenAI adapter; this release does not migrate its request/recovery semantics.
3. Dry-run `DeployAnimeRegistry.s.sol` with the arena admin as deployer. Review and
   sign from the admin wallet. Applications start closed. Do not put wallet keys here.
4. Fill a private copy of `constructor.json.example` with public role addresses and
   the reviewed VRF cap. Run the built `arena-anime-deployment.mjs REGISTRY CONFIG OUT`
   (or its TypeScript source via the market API's tsx) to produce the exact rules,
   rules hash and encoded constructor. Review these artifacts before signing.
   Set `ARENA_ELIGIBILITY=REGISTRY` and use `DeployArena.s.sol`; it enforces anime
   economics for a nonzero eligibility hook. The arena starts paused. Record receipt
   addresses/blocks and the rules hash in `docs/arena/anime-deployment.json`.

Run `node scripts/anime/preflight.mjs --output /tmp/anime-release-review.json` after
building. It checks frozen engine/recipe hashes, browser/golden pins, shared artwork, economics,
closed pilot defaults, service credential isolation and compiled anime entrypoints.
It does not load credentials or change services/contracts. `--launch` additionally
refuses missing deployment addresses/blocks/rules and outstanding live acceptance.
A successful deployment review does not authorize opening public entry. Retain the
report and exact source/build artifacts with the deployment review.

## One indexer transition

Use the established `ops/unified-indexer-transition/` procedure. Add the anime arena to
`UNIFIED_ARENA_DEPLOYMENTS` alongside the video arena and configure the registry and its
actual deployment block in the **same** source/schema release. No legacy projector.
Keep the video ABI fingerprint stable; only its existing event filter gets a new address.
Run source allocation/CU profiling, register the new build/schema, take parity snapshots,
and validate the new registry journal and fighter rows at a shared complete block.
Switch consumers through the existing reviewed source-selection procedure. A fresh
anime deployment also needs the existing operational migrations, a registered deployment
row and its selected native source. `control` runs native disclosure; `settlement` runs
the native referee execution role (freeze, expiry, settlement and payout release).
`client` reconciles wallet transaction receipts. Do not start legacy worker entrypoints.

## Assets and subscription studio

Provision DNS A/AAAA for `assets-anime.yunipals.com`, TLS, and the nginx fragments.
Create `/var/www/assets-anime.yunipals.com` and
`/var/lib/yunipals-anime-arena/{media,studio}`. Public files are 0644 and directories
0755; private studio/media paths belong to the service user and are not web roots.
Keep `/var/lib/yunipals-anime-arena` root-owned with group `yunipals-arena` and
mode 0710 so workers can traverse to their owner-only 0700 media directory.
Check media access as `yunipals-arena`; a root-only storage check cannot verify
worker access through the parent directory. Keep studio and recovery permissions
private independently.
The assets server permits GET/HEAD, approved website origins and hash-based immutable
caching. Publish the frozen recipe and versioned engine bundle with their locks too.
DNS and HTTPS were provisioned on `yunipals-main` on 2026-10-29, and the reviewed
engine 1.1.0 and recipe-v2 assets are publicly reachable. No fighter has been
approved and no anime application/entry service has been opened by that asset step.

Complete the functional release with the single reviewed Brookstone Ring #195
background in `docs/arena/anime-backgrounds-v1.json`. Keep its `islands` map empty
for now. All 898 islands remain eligible for the normal draw, terrain and hosting
reward; the website labels the film artwork as shared. The compiler freezes the
chosen asset's source/path/hash in each input and the worker checks those bytes
before direction. Verify the matching provenance in `film.json` and
`media-policy.json` during the pilot.

Unique anime artwork for all 898 islands is the **last artwork step**, after
functionality. Publish reviewed hash-named files under
`islands/v1/<tokenId>/arena.<sha8>.webp` and add overrides matching the existing
island profile hashes. Retain earlier assets for frozen jobs. Reload the catalogue
for new tournaments; this cosmetic update does not require redeploying contracts
or changing combat rules. Bulk image generation has not been started or scheduled.

The studio uses the operator's ChatGPT-authenticated Codex CLI and no API key. Confirm
commercial subscription-generated image terms before launch; the implementation does
not assert that this account-specific review has happened. Record the dated decision
outside public source control if it contains account details.

Use `python3 scripts/anime/studio.py --lab /var/lib/yunipals-anime-arena/studio COMMAND`:

- `queue`, `prepare TOKEN`, `generate TOKEN --stage 1`, then inspect the idle.
- `review TOKEN idle`, `generate TOKEN --stage 2`, `key TOKEN`, `fit TOKEN`.
- Review contact sheet, traits, anatomy, locomotion, anchors and `fighter.json`. For a
  new artwork, edit the draft identity and set `identityDraft=false` after review.
- Launch uses fresh recipe-v2 fighters only. Run `review TOKEN poses`, then
  `kits TOKEN` for the three windups and missing shared species/element sheets.
  Inspect `kits-contact-sheet.jpg`; run `review TOKEN approve-kit KIT_ID` for each
  of the three kits. Sheets are reused across fighters; published sheets cannot
  be rerolled without a recipe change. No Approved-to-Approved upgrade is needed.
- `review TOKEN reroll POSE` retains the old image, invalidates review, and regenerates
  only that pose. Run key/fit and review again. Maximum two retries per generation.
- `review TOKEN approve`, `export TOKEN`, `publish`. The manifest hash commits to the
  exact reviewed export. Hash-named manifest archives are retained so a re-approval
  cannot erase the art committed to an already-entered seat.
- `approve-batch --registry ADDRESS` verifies the live manifest and every sprite and
  writes unsigned calldata for up to 20 fighters. Sign it on the admin wallet itself.
- `review TOKEN reject CODE "PUBLIC NOTE"`, then `reject-batch --registry ADDRESS`.
  Notes are public and at most 140 UTF-8 bytes; reject uses codes 0–4. To revoke changed
  traits, sign `revoke(uint256,uint8,string)` with code 5, then regenerate/review and
  approve from Revoked. Holders cannot reapply a revoked token themselves.

Do not use the historical Ethereum fixture fighters as Base launch fighters. Generate
four actual Base pilot fighters through this process and have the curator review them.
A duplicate-art reason does not automatically approve another token: each token still
needs its own reviewed manifest/hash and onchain approval.

## Services, backups and launch acceptance

Install the service files only after dry-runs. Fill private runtime/database files in
`/etc/yunipals-anime-arena`; existing admission/referee/operator/encryption credentials
are loaded by systemd for their required roles. Only the referee gets OpenAI access.
Provision `/etc/yunipals-anime-arena/openrouter.env` (root-owned, mode 0600) from the
blank example, with `OPENROUTER_API_KEY` installed privately. Only anime media and
capacity load it. Media gets no Runware or transaction key; its renderer/mixer child
processes receive only runtime paths and locale. `ANIME_NODE` names an executable
binary, not the extracted Node distribution directory.
Set `VITE_ANIME_ARENA_API_URL=/api/anime-arena`
when building the website. The API cookie, query caches and routes distinguish deployments.

Keep pilot mode and explicit pilot wallets; entries remain disabled until pilot start.
Fund VRF and worker gas, refresh the existing capacity snapshot, and open only the
controlled pilot. Verify apply/approval, entry and USDC allowance, all four strategies,
referee validation, all three rendered fights, publication hashes, `releasePayouts` and
claims (3.20 / 0.20 / 0.60 USDC). Record actual cost and duration. Check mobile layouts,
rejection notes, reapplication, NFT transfer and trait-change refusal. Then open public
applications, curate the first batch, and open entries after acceptance.

The encrypted arena backup now includes optional anime assets, studio, media and private
configuration once the anime config directory exists; all roots (including pinned Node and Chromium) then become
required and symlinks are refused. The shared arena DB already contains both deployments.
Run an isolated backup restore drill including the new `animeFiles` objects before launch.
Retain the exact release archive and the separately pinned Chromium runtime in the
server's runtime backup inventory; test restoring that binary before reopening jobs.

The `monitor` unit reports changes in queue counts/age, overdue/failed renders and a
once-daily full verification of approved manifests, sprites and current traits. Review
reported token IDs in the public approved list and revoke/re-approve. Failed render jobs
retain inputs/assets and the original Claude response. Investigate the pinned runtime
and rerun the same job under the existing native source fences; a completed Claude
task is reused without another generation charge.

## Claude direction and cost evidence

Use `arena-anime-rehearsal.mjs prepare-studio-choreography JOB REVIEW_ASSETS TOKEN_IDS`
for a comparison using freshly generated v2 kits on the original cast. `TOKEN_IDS`
is a comma-separated list of four reviewed exports matching the original cast's
token IDs and species. It requires three kits and a two-kit default per fighter,
verifies every windup/sheet commitment, pins the new manifest hashes and refuses
to overwrite an existing rehearsal. Character poses and frozen combat are reused;
the director gets only the two selected kits. This is a private reference-cast
comparison and grants no Base approval. The plain `prepare-choreography` command
uses the old prototype kit assets for regression comparison only.

Claude supplies bounded horizontal/flight/depth/facing/rotation paths, per-event
attack visuals, short attack names and cut-in text/timing under
`claude-choreography/v5`. The existing call also selects a compatible kit ID or
null for every event from that actor's chosen two-kit loadout. Foreign IDs and
ranged attacks presented as body-contact kits are rejected. Its provider schema requires a named block for every
match, each with encoded JSON arrays for attacks, motion and cut-ins. This keeps
the provider grammar small enough to compile. The independent decoder validates
every field and exact event/fighter/cut-in coverage before applying movement checks;
a partial final cannot be accepted. Required-key ordering is stable across
PostgreSQL JSON storage and worker restarts. The engine's normalized choreography
remains compatible with the earlier fixtures.
Ground fighters cannot gain flight paths; every recorded
dodge must visibly move; body hits must bring the fighters into contact range.
Cut-ins stay within the recorded windups and retain their participants. Quotes must
be exact whole-word fragments of the fighter's revealed strategy. Combat events,
attack/defense times, damage, HP and winners remain frozen. Model and price/output limits are pinned in
the rules manifest. Production media fails if Claude access is absent or its output
is invalid; it does not silently fall back to the offline fixture director.

The existing `provider_task` ledger stores one `kind='media', asset='anime/director'`
task per deployment/tournament/incarnation, with native action evidence before POST.
The original request/response and generation ID are retained. An unconfirmed POST
never authorizes a replacement. Missing accounting is retrieved by the saved
generation ID, including for an orphaned opening; do not delete tasks to force a reroll.
Native publication requires the original Claude task to be completed.

`receipts.json` includes the OpenRouter-reported USD charge, token usage and generation
ID. Integer micro-USD are rounded up for reservation accounting; the original USD
charge is preserved. Account credit and the key's remaining allowance constrain
admission, with $0.80 held for each outstanding/new film. Missing/expired funding
checks pause new entries. Private account metadata is not logged or persisted.

The referee retains token usage and its conservative $0.70 reservation. Do not call
that reservation an actual charge: reconcile the referee's provider billing separately
before reporting a measured total. Keep artwork preparation, per-battle inference,
CPU/storage and gas as separate cost lines in the live pilot record.

The full offline check is `node --import tsx ../../scripts/anime/smoke-media.mts
/tmp/anime-media-check --mock-director`, run from `apps/yunipals-market-api` with
`ANIME_CHROME` set. It uses historical pixels, synthetic commitments and a mocked
Claude result; it makes zero paid requests and cannot measure live inference costs.

The 2026-10-28 private paid comparison is recorded in
`docs/arena/anime-implementation-v1.md`. Opus passed; Haiku added an invalid quote
and was rejected without a reroll. The successful film's inference cost was
$0.212662; including the failed Haiku attempt the comparison cost $0.2136363.
This reused historical artwork and made no onchain transactions, so the Base
pilot, gas measurement, publication, payout and claim checks are still required.

The later manual-reference comparison uses the same frozen 5/5/6-event battle and
artwork as the earlier Claude CLI film. `prepare-choreography PRIVATE_JOB` creates
one bounded Opus task and reuses the original referee result; `render PRIVATE_JOB
opus` validates and renders it, and `summary PRIVATE_JOB` retains its actual charge.
The original labels-only cost run did not demonstrate choreography parity.

For a new battle through the production API routes, build the latest API and run
`arena-anime-rehearsal.mjs prepare-production PRIVATE_JOB`. This freezes new
strategies, a fresh private draw and the exact direct OpenAI `refereeRequest`
factory output. It reserves $0.70 for that request and $0.80 for Opus, with no
Haiku comparison or reused outcome. Run `production_rehearsal.py PRIVATE_JOB
referee --repository ROOT --wait`, then the built CLI's
`accept-production-referee PRIVATE_JOB`. Validation creates the exact production
Opus request. Run the Python tool again with `opus`, then CLI `validate`, `render`
and `summary`. Reuse prepared fighter sprites, as a production battle does.

The OpenAI response's reported input/cache-read/cache-write/output token counts
are priced using the verified Standard short-context rate card, including output
reasoning tokens once. This is a usage-derived cost, not invoice reconciliation.
The OpenRouter line retains its provider-reported USD charge. Both are distinct
from reservations, one-time fighter artwork, server/storage costs and onchain gas.
Provider IDs and receipts stay private; polling a saved response never buys a
replacement. The harness does not start public services, sign transactions or
write production tournament state.

The corrected 2026-10-29 fresh battle measured $0.344467 for inference: direct
OpenAI reported usage priced at $0.200871 plus OpenRouter's $0.143596 charge for
full Opus choreography. Its bouts have 7/6/8 attack events. The unsuccessful first
battle ($0.317379) and accepted schema diagnostic ($0.005388) are separate
development costs, bringing this task's measured total to $0.667234. Rejected
schema probes added no recorded charge after reconciling the key's usage total
against the saved generation receipts. This is one measured sample, not a fixed
per-battle price.

For a separately authorized fresh comparison, the built `arena-anime-rehearsal.mjs`
supports `prepare`, `accept-referee`, `render` and `summary` in a private job
directory. `scripts/anime/rehearsal_api.py` supports the original three fixed tasks
with a $1.52 ceiling, or one $0.80-bounded Opus choreography-review task. It stores receipts before submission and never replaces an
ambiguous request. It reads the existing private OpenRouter file only on the verified
indexer host. It does not change the production referee provider. Keep requests,
responses, receipts, films and account metadata outside source control and web roots.

For the browser fixture check, start Vite from `apps/yunipals-home-web` with
`VITE_ANIME_ARENA_API_URL=/api/anime-arena VITE_ARENA_API_URL=/api/arena` in fixtures
mode on loopback port 5177. From the repository root, run
`node scripts/anime/test-ui.mjs http://127.0.0.1:5177 /tmp/anime-ui-check` with
`ANIME_CHROME` set. It checks desktop/mobile routes, isolated economics, public notes
and all five fighter states against mocked HTTP responses.

For a Chromium update, create a new engine version, regenerate the engine lock and
review changed golden frames/cues/duration. Regenerate rules for a new deployment if
its immutable engine commitment changes. Keep older bundles available. Pause intake
with `setApplicationsOpen(false)` when the queue grows; onchain approval/art follow
NFT transfers, while paid tournament seats and claim beneficiaries retain their
existing semantics.
