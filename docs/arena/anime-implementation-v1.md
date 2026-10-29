# Anime Arena implementation and verification

Prepared 2026-10-28; signature-kit acceptance completed 2026-10-29. Repository implementation and pinned rendering dependencies
are installed on the indexer server for paused deployment review. A fresh private
paid rehearsal validated the referee and selected the required Claude director.
The user's subsequent review found film quality below the manual Claude version.
Full Claude choreography has since been restored; its comparison film is ready for
visual review, which remains an explicit launch acceptance item.
The latest local release adds recipe-v2 kits, the owner loadout picker and engine
1.1.0. Launch uses fresh v2 fighters only; no registry upgrade or v1 migration.
**Contracts, public website and anime services have not been deployed or opened.**
See `ops/anime-arena/README.md` for the ordered rollout and operator commands.
`node scripts/anime/preflight.mjs` checks the local release; `--launch` also refuses
outstanding live acceptance. The generated local review is
`anime-release-review-v1.json` (ignored by Git and included in the review archive).

## Signature-kit acceptance · 2026-10-29

All seven work items in `anime-attack-kits-brief-v1.md` are implemented. Manifests
commit three kits and a two-kit default; the studio reviews three windups plus
shared species/element sheets. The existing Opus call selects kit IDs, validates
membership/compatible visuals and refuses ranged events presented as body contact.
Plaintext loadouts lock with strategy submissions, remain outside the signed text
commitment, appear in disclosure, and supply only cosmetic names/descriptions to
the referee. Missing strategies use the fighter's default pair. The website has
three animated effect previews and a keyboard-accessible two-of-three picker.

Engine **1.1.0**, hash
`773db47209a827ac6c62e2e245da10cd16917f9e53605f6badbf135f6b3a7d5e`, adds
painted projectiles/strikes/impacts, kit windups, hit stops, release smears and camera
punches. Both golden sets were deliberately regenerated once and verified. The
engine and both sets are committed together. Before/after images and all 48
semantic-frame hashes are attached under
`apps/yunipals-anime-engine/fixtures/review/1.1.0*`. Both paths retain exactly the
same frozen tournament hash. Historical no-kit fixtures retain procedural attacks;
they cannot receive launch admission.

The initial engine regression used the prototype Cedar/Zephyr sheets and fallback
effects for Bastion/Elrond. Its production-route OpenRouter Opus rehearsal returned valid kit selections
and **5 / 5 / 6** attacks. Its reported charge was **$0.141292**, within the existing
**$0.80** bound (11,578 prompt tokens, 4,749 completion tokens). The original
manual-reference referee result and prototype artwork were reused, so this is the
incremental director cost, not a fresh referee-plus-artwork price. The resulting
film is **122.51 seconds**, H.264/AAC, 1280×720 at 30 fps. Private original request,
response and accounting are retained on `yunipals-main` under
`/var/lib/yunipals-anime-arena/rehearsals/kits-20261029`.

The corrected original-cast comparison uses **12 freshly generated windups and 12
fresh shared effect sheets** from the recipe-v2 studio. All four reviewed exports
have three kits and a two-kit loadout. The new `prepare-studio-choreography` mode
verifies those exports, pins their hashes and refuses to overwrite a prior demo.
All **16 attacks** select a fresh v2 kit, with **zero procedural fallbacks**; the
character poses and exact frozen combat are reused. The reference exports are
private test artifacts, not verified or approved Base fighters. Their scale and
element palettes were reviewed before the final render.

This comparison's new Opus call cost **$0.150936**. Its original response is retained
under `/var/lib/yunipals-anime-arena/rehearsals/fresh-reference-kits-20261029`.
Appearance review reused the exact same paid request/response without another
provider submission. The final film is **121.65 seconds**, with SHA-256
`805abe730ca385e81b62db48dd2109edcd16d20468bf834cf27b4456f0510e31`.
The local `kit-audit.json` records every selected kit and verifies its windup/sheet
bytes against the rendered manifests, generation receipts and unchanged combat.
The new staging/obsolete-asset checks bring the manifest/admission suite to 16 tests.

Actual Base **Yunibranch #1000001445** completed the subscription studio from
finalized onchain traits and original artwork through all nine poses, three
windups, three shared sheets, visual review, validated export and private local
publication. Its manifest hash is
`0xb4659ad34a120a72ae7afa6739f784a079f5f5ee11524929db734d9afc94c762`.
The complete media callback then consumed that published v2 manifest alongside
the fallback fixtures, verified windup/sheet hashes and default loadout, rendered
both audio variants, and verified all twelve publication files. That offline
callback used mocked direction, made no provider calls and took **183.14 seconds**.
Its film duration is **116.36 seconds**. This acceptance publication is local;
the token has not been approved onchain.

Signature-kit checks: 18 studio/transport tests; 16 manifest/admission/configuration
tests; 9 director/cost tests; 3 input compiler tests; 19 database lifecycle tests
including custom/default/automatic loadouts; 7 engine policy/name tests; both
12-frame golden sets; desktop/mobile preview and keyboard picker flows; API/web
strict type checks and production builds; eight release preflight checks. Public
source scans found no secrets. Audio synthesis and music remain unchanged. The
earlier verification and cost sections below describe the preceding release.

## Single-background functional release · 2026-10-29

The user approved using the existing Brookstone Ring #195 anime backdrop to
finish functionality. The new `anime-backgrounds-v1.json` catalogue supplies that
one reviewed scene to all 898 islands. It preserves the complete weighted draw,
pool hash, selected terrain profiles and hosting rewards. Tournament and film
pages identify shared artwork; the referee instructions explicitly use the
selected island's profile and ignore the artwork's source island.

Each input freezes the background path, checksum, dimensions, source island and
profile hash. Rendering checks the exact bytes before the director can be called,
then publishes that same provenance in `film.json` and `media-policy.json`.
Future reviewed per-island overrides affect new inputs only. The rules manifest
binds the background selection policy rather than the mutable catalogue, so
adding those cosmetic assets does not require another contract deployment.
The engine remains **1.1.0** with its existing lock and golden sets unchanged.

Verification covers all 898 unchanged island records; exact frozen input hashes
before/after a catalogue override; checksum, path and profile refusals before
direction; the existing 16 manifest/admission checks and three input checks;
desktop/mobile routes, previews and keyboard loadout selection; API/web strict
type checks and production builds. The complete offline callback consumed the
actual Base #1000001445 studio publication alongside regression fixtures, rendered
both audio variants in **177.67 seconds**, and verified all twelve publication
files. Duration **116.36 seconds**; **zero provider calls** for this check.
All **nine** local release preflight checks pass. Launch review correctly remains
closed while contract addresses and live acceptance are outstanding.

The functional release uses one background. Generating unique artwork for all
**898 islands** remains the final artwork task, separate from the live rollout
below. Bulk generation has not been started or scheduled.

## Implemented

- Approved 1 USDC economics (80/5/15) and 7-day/24-hour/24-hour timing files.
- Token-bound `AnimeFighterRegistry`, curator rotation, public reason/note events,
  reapplication and revocation; arena eligibility hook for new deployments.
  Solidity reserves `apply`, so the callable function is `applyForArena(uint256)`.
  Notes are limited to 140 UTF-8 bytes (a conservative bound on 140 characters).
- Registry ABI and a separate new-deployment arena ABI. The deployed video arena's
  ABI/source fingerprint is retained; its event subscription accepts another address.
- Optional unified registry source, schema, canonical journal handlers, FIFO pagination,
  release/block evidence, counts and public notes. A single source/schema transition
  adds both the registry and anime arena. No legacy anime projector or rollback source.
- Fresh approval/current-traits checks at the ownership block, exact manifest and sprite
  checksums, manifest identities without paid identity jobs, immutable manifest archives
  for already-entered fighters, deployment-specific balances/refunds and HTTP sessions.
- Frozen recipe, prompts, style board and reviewed anatomy drafts. The studio supports
  per-token locks, up to five independent generation processes, approved-idle staging,
  two retries, key/despill/contact sheets, alpha-bound anchors, review/reroll/reject,
  validated WebP/manifest export, an explicit publication allowlist, engine/recipe
  publication and unsigned curator batches. API-key generation is refused.
- Maintained engine app with manifest-driven appearance, deterministic rendering,
  validated Claude movement/body-attack staging, cut-ins and exact whole-word
  strategy fragments. Current engine **1.1.0**, Chromium **151.0.7922.34**. Font
  licenses are included. The renderer produces 1280×720 at 30 fps, SFX/music variants,
  chapter/event playback clocks and the existing twelve-file publication package.
  It reuses native media locks, source fences, publication verification and payouts.
- Required Claude Opus 5.5 director through OpenRouter. Its sole native media task
  is saved before submission, carries the exact input/result/origin proof, reserves
  $0.80 and retains the original response and actual charge. This is conservative
  funding headroom, not an expected charge. Ambiguous submissions
  never buy a replacement; missing accounting retrieves the saved generation ID.
  Validation permits bounded presentation paths, per-event attack visuals and
  cut-ins within recorded windups, with unchanged participants and whole-word
  verbatim quotes. Combat events, damage and winners stay frozen. The referee's existing direct
  OpenAI model/settings are preserved. No referee-provider migration is included.
- Admission reserves Claude credit for each outstanding/new film, using the lower
  of account credit and the key allowance. Only anime media/capacity get OpenRouter
  credentials; renderer/mixer children still receive neither provider nor signing keys.
- Base token application card, all five public statuses, owner-only Apply/Reapply,
  approved preview/card link, anime tournament/dashboard/rules routes and public queue.
  API addresses, query caches, labels, allowance amounts and session cookies distinguish
  deployments. The video arena retains its 2 USDC economics and existing behavior.
- Separate service units (including native disclosure and wallet receipt tracking),
  nginx API/assets configuration, public/private environment examples, monitoring of
  queue age/assets/changed traits/render jobs, and encrypted backup inclusion for anime
  assets, studio, media, configuration and pinned runtimes.

## Verified locally

| Check                                         | Result                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Solidity suite, including existing fuzz tests | 77 passed (32 registry and 45 arena tests)                                                               |
| Market API arena regression tests             | 245 passed across the broad and service-dependent runs; disposable PostgreSQL and local Anvil            |
| Unified source and registry reader tests      | 9 source checks and 1 PostgreSQL registry-reader check (reader included in API count)                    |
| Studio export/review/publish checks           | 6 passed, including the installed production helper                                                       |
| Backup policy checks                          | 5 passed                                                                                                 |
| Engine director/name checks                   | 4 passed                                                                                                 |
| Claude validation, recovery, cost and funding | 11 passed (included in API count)                                                                        |
| Engine regression                             | 12 sampled PNG hashes, cue-sheet hash and duration                                                       |
| Market API, indexer and website               | Strict type checks pass                                                                                  |
| Market API and website                        | Production builds pass                                                                                   |
| Existing video lifecycle on local Anvil       | Passed entry, strategies, freeze, settlement, film publication, payout and claims                        |
| Native indexer/arena lifecycle on local Anvil | Passed 30 mined transactions, native source/reorg checks, media publication and claims; no mainnet calls |
| Browser fixtures                              | Desktop/mobile anime routes, isolated economics, queue, escaped public notes and five token states       |
| Final complete anime media callback           | Passed with synthetic Base manifests, historical fixture pixels and mocked Claude text                   |
| Deployment preflight                          | 7 release checks pass; launch correctly refuses placeholders/outstanding acceptance                      |
| nginx fragments                               | Syntax/configuration validation passed using a temporary test certificate                                |
| Public-source review                          | Exact changed/new file list scanned; three scanner hits verified as the public Base USDC address         |

The final synthetic anime film is **115.44 seconds**, rendered/mixed in **193.71 seconds**,
with zero media provider calls and an explicitly mocked Claude receipt. Both audio
variants have video/audio, 1280×720 resolution and
30 fps; all twelve publication file proofs match. This verifies the real offline
callback, encoder, mixer, probe and publication manifest, not a live referee run.
The historical Cedar/Zephyr/Bastion/Elrond assets are regression data, never approved
Base launch art. Sampled frames are regression coverage, not exhaustive quality
acceptance for every strategy or anatomy.

The local video lifecycle fixture now refreshes its synthetic capacity snapshot after
film publication, matching the production capacity worker's required behavior.

## Remaining live rollout and acceptance

1. Review and sign the registry (applications closed) and arena (entries paused) on
   Base using the admin wallet. The final rules hash and constructor arguments are
   generated **after the real registry address is known**, using `animeDeployment.ts`
   or the built `arena-anime-deployment.mjs`. No placeholder address is treated as final.
2. Complete the one unified source/schema transition, source allocation/CU measurement,
   parity review and native consumer selection for the real deployment blocks.
3. Install DNS/TLS/assets/services and private selectors; verify the encrypted backup
   with an isolated restore drill, including the pinned Node/Chromium binaries.
   Pinned Node/Chromium, Python Pillow/numpy, ffmpeg and the private OpenRouter
   credential are already installed and verified. Production anime units remain
   uninstalled; activate them only with the real deployment/source configuration.
4. Complete the subscription terms/account review described below. Generate four actual
   Base pilot fighters through the studio and obtain curator review/onchain approval.
5. Run the controlled paid pilot and measure real referee/gas costs, publication,
   payouts and claims. Open public applications/entries only after acceptance.

Addresses and launch state remain explicitly unset in `anime-deployment.json`.
The existing conservative $0.70 referee reservation is retained as pilot funding
headroom; it is distinct from the anime tournament's $0.60 operations revenue. The
referee model, effort, schema and combat rules were not reduced to fit the reservation.

## Subscription terms research (not launch clearance)

Official documentation describes `codex exec` as a supported way to run Codex in scripts
and reuse CLI authentication. That supports the implementation approach; it does not
by itself settle account-specific commercial image automation rights.
[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

The individual terms assign output rights to the user within applicable legal limits,
require rights to supplied inputs and impose restrictions on automated extraction and
circumventing service limits. The applicable regional/account agreement needs checking
against this precise studio workflow before commercial launch.
[Terms of Use](https://openai.com/policies/terms-of-use/),
[Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/).

Service Terms also address third-party licenses for code-generation output and rights
in visual inputs. The implementation preserves model provenance, includes font licenses,
adds music attribution and does not assert that those documents provide blanket
permission for every account or collection artwork.
[Service Terms](https://openai.com/policies/service-terms/).

## Naming follow-up (2026-10-28)

Engine 1.0.2 normalizes legacy `Uni` names in the generated battle view and winner
labels to `Yuni`: Yuniturtle, Yunibranch, Yunifairy and Elrond Yunidragon. Original
NFT metadata, approved manifest identities/hashes, frozen inputs, fighter IDs,
combat events and verbatim strategy quotes are retained. The historical fixture
metadata also stays unchanged; its generated view uses the same naming policy.

Targeted verification: 13 API checks, 4 director/name checks, 12 golden frames,
strict API type checking and the API production build pass. The local sample is
regenerated from the exact same frozen input and outcome as the previous film.

## Encoding and provider follow-up (2026-10-28)

Engine 1.0.3 explicitly serves HTML, JavaScript and JSON as UTF-8, with a matching
HTML charset declaration. Previously Chromium selected Windows-1252, corrupting
the ready ellipsis, result bullet and advancement arrow. The browser regression
reproduced that failure before the fix, and now checks the actual canvas text for
all three characters. Four director tests and twelve updated golden frames pass.

The development workspace and production indexer server are separate. The user
confirmed the production SSH connection, now documented in `AGENTS.md`. On that
server, the active native video-arena workers load the existing OpenAI and Runware
credentials from their separate root-only environment files. No OpenRouter key
was found in the standard arena configuration files checked. No secrets were
copied, no production workers were changed, and no paid inference was submitted.

The required Claude cut-in integration is complete through OpenRouter, with strict
output validation, native source/spend guards, recovery and actual cost receipts.
The later private paid rehearsal below supersedes the earlier credential findings.

The referee's reservation/token-based estimate is distinct from billed cost. A live
cost report must reconcile its actual provider billing separately from Claude's
OpenRouter-reported charge, gas, artwork preparation and server costs.

## Private paid rehearsal (2026-10-28)

A new random draw, strategies, frozen input and referee outcome were generated on
the indexer server. The referee and both directors used OpenRouter for per-request
billing. The production referee adapter and existing video services were unchanged.
Historical fixture pixels were reused; no new artwork or video-model calls occurred.
This was entirely offchain and did not approve historical art for the Base pilot.

| Task | Actual USD charge | Generation wall time | Validation |
| --- | ---: | ---: | --- |
| Referee: gpt-6.1-sol, xhigh | 0.174146 | 323.473 s | Passed; 8 combat events |
| Director: Claude Haiku 5.5 | 0.0009743 | 4.784 s | Rejected: extra empty quote for a fighter absent from a cut-in |
| Director: Claude Opus 5.5, low effort | 0.038516 | 9.782 s | Passed |

The successful Opus film's inference cost is **$0.212662**. The entire comparison
cost **$0.2136363**, including the failed Haiku attempt and sharing one referee run.
These are actual OpenRouter-reported charges, excluding gas, artwork preparation,
server/storage costs and credit-purchase fees. Exactly three generation requests
were submitted, with no rerolls. Private receipts retain the original responses,
usage and generation IDs; they are deliberately outside this public repository.

Opus is pinned for production based on this successful strict validation. This
single comparison does not establish general model reliability. Its $0.80 reserve
bounds the 60 KB input / 16,384 output-token envelope and provider price ceilings;
it is distinct from the measured $0.038516 charge and $0.60 operations revenue.

The server installation verifies Node 24.22.1, Chromium 151.0.7922.34, Pillow
10.2.0 and NumPy 1.26.4. Twelve golden frames, Unicode labels, cues and duration
passed on the server. A release-selector path issue found in the private rehearsal
was fixed by resolving the repository root before launching Node entrypoints;
bounded offline error diagnostics now retain the cause of render failures.
The installed release supports the studio through its built helper without dev
dependencies. Production anime services remain uninstalled and public entry closed.

The fresh Opus film completed at **122.562 seconds**, with both music/SFX and
SFX-only H.264/AAC variants at 1280×720 / 30 fps. All twelve private publication
files and the final film checksum verified. Its render/mix wall time was
**762.335 seconds** under low scheduling priority and CPU caps raised from 75%
to 150% and then 300%; this is not an uncapped throughput benchmark. Preview
review confirmed the Yuni names, ready ellipsis, result bullet, advancement arrow
and verbatim cut-in quote. The final Opus configuration passed all seven installed
release checks, 33 focused API checks, ten Python studio/rehearsal checks, strict
type checking and the production API build. No public anime services were started.

## Film quality review (2026-10-29)

The paid rehearsal measured inference cost and technical validity; it did not
establish parity with the manually directed film. Its bouts contain 1, 3 and 4
attack events, versus 5, 5 and 6 in the earlier manual fixture. In the opening
Yunibranch/Yunifairy bout, Yunibranch has no attack events and Yunifairy's sole
attack starts at referee time 4.15s. Both rehearsal strategies were written around
counterattacks, so this is a sparse combat outcome, not a dropped renderer event.
Valid defensive player strategies must remain valid; a renderer must not invent
attacks or change a frozen result to make a film busier.

There is also an automation gap independent of the combat input. The manual
choreography has flight-height, depth, facing and rotation keyframes, plus per-event
attack-style overrides (including the dragon's shoulder check). The automated
director emits only horizontal position keys and the fighter's default attack
style. At that review, Claude was permitted to change only attack labels and cut-in text;
it cannot supply the richer movement that it authored in the manual workflow.

Quality acceptance therefore requires a comparison using the same frozen combat
events and assets, with validated movement and attack staging matching the manual
workflow. Stronger text-only Claude output does not close this gap. Contract
deployment is no longer the only next item; choreography quality needs revision
before treating the automated films as launch-ready. No combat rules or frozen
rehearsal results were changed by this review.

## Manual-reference choreography restoration (2026-10-29)

The user selected the earlier Claude CLI film as the target. The required director
now uses `claude-choreography/v3` to supply bounded position, flight height, depth,
facing and rotation paths, per-event ranged/body attack visuals, and cut-in timing
within recorded windups. Validation requires complete, unique match/fighter/event
coverage, legal stage bounds, increasing key times, ground/flight separation,
visible dodge displacement and body-contact reach. Labels and exact strategy
quotes retain their existing limits; quotes must also start and end on word
boundaries. The renderer still derives poses, HP, damage, falls and results from
the untouched combat events.

The comparison freezes the original manual battle's input/outcome and historical
artwork. All **5 / 5 / 6 attack events**, including both dragon shoulder-check
events, remain present with their original times and winners. No fresh referee,
image API or video-model request was needed. Engine **1.0.5** preserves all twelve
manual-reference PNG hashes, cue-sheet hash, duration and Unicode label checks.

The first choreography draft cost **$0.112856** and passed the then-current
structural checks, but visual review found mid-word quotes copied from the old
regex extractor. That draft was retained and rejected for final use. The extractor
now selects complete words and suggests the relevant recorded attack quote;
whole-word boundaries are also validated on the returned response. The corrected
request cost **$0.11998** and passed the expanded checks. Total choreography
development inference was **$0.232836**, with one submission per independently
retained request. A conservative combined request bound kept both below $0.80.

These charges cover choreography only because the original referee output and
art were reused. The earlier **$0.212662** end-to-end inference measurement was
for the labels-only director and a different, sparse battle; it is not a measured
total for this restored full-choreography path. The Base onchain pilot and visual
review of the completed comparison remain launch acceptance items.

The corrected comparison film is **120.434 seconds**, rendered and mixed in
**190.345 seconds** on the development runtime. Both H.264/AAC audio variants and
all twelve publication files verify through the real callback. The sanitized
automated direction/choreography are now separate regression fixtures: twelve
automated golden frames accompany the twelve unchanged manual-reference frames.
This closes the earlier test gap where manual frames could pass while the
automated path lacked its movement and body-attack staging.

Final targeted verification: **35 API checks**, **5 engine director/name/quote
checks**, **11 Python studio/rehearsal checks**, both golden-frame sets, strict
API type checking/build and seven release checks passed. The compiled rehearsal
tool supports `validate PRIVATE_JOB opus` to verify a saved response without
another provider call or full encode.

## Fresh production-route cost rehearsal (2026-10-29)

The full fresh rehearsal now uses the production direct OpenAI Responses referee
request and response parser, followed by the production OpenRouter Claude request
and strict choreography validator. New strategies, private random draw, tournament
identity and referee outcome replace the comparison's frozen battle. Prepared
fighter artwork is reused, as it is for production battles; there is no per-battle
image or video-model request. The private harness makes no onchain transactions or
production database changes.

The first fresh attempt produced a valid 6/6/6-event referee result but omitted all
six final-round attack labels in Claude's response. Validation stopped before
rendering. Its retained cost is **$0.317379**: **$0.200031** from OpenAI's reported
usage at published Standard rates and **$0.117348** reported by OpenRouter. That
attempt is rejected for final use and is not hidden in a successful film's cost.

Director policy `claude-choreography/v4` now requires a named block for each match,
including the final, with encoded JSON arrays for attacks, motion and cut-ins.
Schemas requiring every numeric track and event inside the provider grammar were
rejected by Anthropic's compilation limit, including shared-definition variants.
The accepted compact schema keeps coverage in an independent decoder and the
existing movement checks. It validates every field and exact event/fighter/cut-in
sets before converting to the engine format; it never fills in a missing paid
response. Required-key ordering survives JSON storage and worker restarts.
Historical v3 responses and golden frames retain their original format.
Reproduction, saved-task, accounting and recovery tests cover omitted finals and
avoid automatic paid replacement calls. The harness now retains redacted private
HTTP error evidence instead of discarding the reason for a provider rejection.

The cost report distinguishes OpenAI usage priced from its token/cache counters
from OpenRouter's reported USD charge. It does not claim invoice reconciliation
or include one-time art preparation, server/storage expense or gas.

The corrected full request passed without modifying the saved provider response:
**7 / 6 / 8 attack events**, all fighter paths and all cut-ins validate. Its fresh
referee cost is **$0.200871** from reported usage; full Claude direction is
**$0.143596** reported by OpenRouter. The successful film's AI total is therefore
**$0.344467**. Both requests were submitted once. The fresh referee result was
retained during schema recovery, with its original input/outcome hashes.

Four bounded schema diagnostics were rejected before generation. OpenRouter's key
usage reconciled exactly with the previously saved charges, with no additional
charge recorded for those rejections or the original unconfirmed schema request.
The accepted small schema diagnostic cost **$0.005388**. Including that check and
the first rejected-for-use battle, total inference for this fresh-film task is
**$0.667234**. The unconfirmed task remains intact; no automatic retry or hidden
replacement was authorized by its failure state.

The completed film is **118.570 seconds**; the indexer host rendered, mixed and
checked it in **505.6 seconds** with capped CPU use. Both H.264/AAC variants are
1280×720 at 30 fps. All twelve publication files and the downloaded film hash
verify. Opening-contact and cut-in frames show readable READY text, Yuni-prefixed
names and complete-word strategy quotes; the opening bout has four Yunibranch
attacks and three Yunifairy attacks. No provider output was edited for rendering.

Final checks passed: **36 targeted API tests**, **16 Python checks**, strict API
type checking/build, the complete offline callback and seven release checks.
The existing engine and golden frames did not change. The public-source secret
scan and whitespace checks passed. Public anime services and contracts remain
closed; this rehearsal does not replace the separate Base onchain pilot.
