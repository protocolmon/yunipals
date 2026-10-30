# Shared Arena pilot cutover — 30 October 2026

The browser deployment is independently verified at
`0xf34fb0a9ecf31bf7516098105036aba7ed4adda9` on Base, block `53261777`.
The confirmed creation, runtime, roles and initially paused modes match
[the deployment record](shared-arena-browser-deployment-confirmed-v2.json).
The existing fighter registry and its four approvals remain in use; applications
remain open as requested.

The production website now serves deployment
`dpl_9Abt43EXcXvkA9to8VfBtSPyEP3v` (frontend commit
`cda2bf56bda047c6ea932b2a9942330fcd356257`). The curated build contains 227 files
and 14,090,063 bytes; manifest SHA256
`71e9ede3e1402eff0186ecf637715471be579e7a5556223ab98dc25aaba605ff`.
The canonical www HTML matches this exact build. Persistent production setting
`VITE_SHARED_ARENA_API_URL=https://api.yunipals.com/api/arena-v2` is installed.
Both service configs advertise version 2 and first-entrant randomness funding.

## Server and canonical source

Hostname `yunipals-main` was verified through `root@168.119.172.10` before changes.
The initial immutable runtime was
`/srv/yunipals-arena-modes/releases/shared-runtime-20261029-d6722fe2ae05`
(backend commit `939fc9c7`); its retained archive SHA256 is
`f63d83b49d3bc4e0558f30efb9878463c0395459acfaee8821404133e4a09c39`.
The tested video monitor unit correction from `e3250870` is installed separately
and retained with the recovery units.

The additional Ponder source retains all 14 previous source definitions and adds
only the confirmed shared Arena. It uses schema
`unified_arena_modes_20261029_v1`, build `754660052d`, manifest
`0xebd1ba37ec0ed205d53fab8a55ccd6d705957278128b095cd89f886abd88b3c2`
and release
`0x1208eee958af251fc4c88e2df40925d85eb8312e80cf3b329ebcb706742fe97d`.
The global source and other consumers were preserved.

Reviewed, applied per-mode source epochs:

| Mode | API | Source epoch |
| --- | --- | --- |
| Video | `/api/arena-v2/video` (loopback 53915) | `478aae2f-ad39-40b3-84a8-3119075ead68` |
| Anime | `/api/arena-v2/anime` (loopback 53916) | `8a3b8df1-0bf1-46b8-b81f-92790887d7d1` |

The initial source-binding application refused stale observations. It was applied
only after real observations recovered, with the same reviewed hashes and no
readiness overrides. The serving policy accepts the SDK's verified complete
prefix while Ponder continues backfill; the last explicit framework observation
still had `is_ready=0`. This is not a claim that every chain has finished catch-up.
The final 45-sample check recorded 135 successful API responses and no source
errors, including actual indexed fighter responses. Historical Ponder rows and
watermarks were not seeded or edited.

The isolated source RPC profile is
`0x6ede1f1a890d77682e8ed87aef6468bcea2a1f1549a1fc83ed726653d3d963ab`.
It has no paid replay permits or paid fallback. Two throttled free Base endpoints
were replaced, in this new relay only, by its already-configured responsive
PublicNode and Tenderly endpoints. Existing relays and reviewed source identities
were preserved. A failover-list formatting error was corrected before readiness
checks; the final relay check passed with zero paid calls.

Separate operational login roles use two-connection pools and separate read-only
source roles. Provider access and signing credentials remain scoped per worker;
no owner key is installed. Twenty-four reviewed services/timers are enabled for
restart, with the video DB-only monitor scheduled by its timer. Both pilot APIs,
capacity checks and all four fighters' 12 kits, windups and sheet hashes passed
readiness verification. The single island background remains in use; the 898
unique backgrounds remain deferred.

## Retirement, recovery and remaining signatures

Old video and anime admission issuers were closed at
`2026-10-29T23:23:44.696064+00:00`; the 602-second permit expiry window elapsed
before the new pilot services were enabled. Old lobby creation workers were
stopped and disabled. Historical API, claim and settlement services remain.
The audited old-video liability of 2 USDC was preserved; no claim funds were swept.

Encrypted backup coverage includes both mode configs and private media, isolated
source/observer/RPC configs, exact release archives, installed units and applied
source-binding receipts. The restore drill completed successfully at
`2026-10-29T22:55:51.724646+00:00`, restoring 27 tables with quarantine preserved.
Final incremental backup status is recorded in the accompanying cutover JSON.

At the initial handoff both contract modes remained paused. Services permit only pilot
wallet `0x08820403d7edb694a2e91eba5bcc73dbcd24ab23`; no paid battle or AI generation
has been started. Desktop/mobile checks and a read-only injected owner wallet
verified the real confirmed contract and available per-mode enable controls on
both the staged and canonical website. Those checks sent no wallet transactions.

The initial handoff requested the deployment wallet's two browser-signed mode unpauses at
`https://www.yunipals.com/arena/setup`, followed by the pilot wallet's new-spender
USDC approval, four anime joins and strategy/loadout signatures. The first
successful entrant supplies the quoted draw fee in ETH; subsequent entrants do
not pay another draw fee. No operator reserve deposit is required. Then verify
one oracle request, film generation using production APIs, settlement, claims
and actual provider costs. Reserved budget amounts must not be reported as
actual charges; OpenAI usage requires pricing/billing reconciliation and
OpenRouter generation receipts supply its actual charge.


## Follow-up: both modes enabled, real lobbies ready

Both owner unpauses are verified onchain. Video tournament #1 and anime tournament
#2 are open and indexed, with no entrants or provider tasks at this observation.
Their opening transactions are recorded in the accompanying JSON. Ponder's
framework readiness flag was observed as 1 before the backend fix.

The first real lobby checks exposed two backend issues: history validation still
compared the canonical source against the private mode deployment identifier,
and signing workers had only two connections while holding a source lease and a
nonce lock before capacity checks. Commit `2307ecd9` fixes canonical history and
cursor validation without removing mode isolation, and gives only the signing
entrypoint a three-connection operational pool. Only its four login limits were
raised to three; other operational and source pools remain at two. The reviewed
operational database had 57 of 96 connections in use before this four-slot change.
Seven real PostgreSQL history tests (including both v2 modes and cursor isolation),
ten native signing/receipt tests (including the three-connection limit), strict
TypeScript and the API build passed.

The current immutable backend is
`shared-runtime-20261030-8ef320e05513`, source commit
`2307ecd96a01969af1c38f63f53290b127d0fd5f`. Its exact archive SHA256 is
`cdc50526099b06d63dcda7ed2a6354c87a8d60c77d9c79b8e6d64586cc6b7a94`.
All 13,837 files and 84 internal symlinks were verified before switching the
current pointer. Engine/recipe hashes, source identities and legacy services were
preserved. The updated release archive is retained in encrypted recovery coverage;
the final incremental backup completed successfully at
`2026-10-30T07:30:00.619854+00:00`.

A read-only pilot account on the actual canonical website verified all four
fighter cards, four enabled entry buttons, the first-entry ETH draw quote, the
4-USDC approval option and the mobile layout, with no signatures or transactions
sent. Public reads also verified ownership of all four fighters and sufficient
USDC and ETH. The draw quote is dynamic and checked again before each join.

The next wallet action is at
`https://www.yunipals.com/arena/anime/2#join`: connect the existing pilot wallet,
choose the 4-USDC/four-entry approval limit, and enter all four fighters. Lock a
strategy/loadout for each fighter when the editors appear to avoid waiting for
the strategy deadline. NFT-owner signatures are required; the workers do not
have authority to sign those wallet actions. The paid film and cost measurement
remain pending these entries.


## Join navigation and entry progress follow-up

Frontend commit `15e41cda` makes repeated navigation to the existing `#join`
fragment scroll the picker into view again. It also uses the same mode-aware
transaction scope for rendering, persistence and polling. Previously the polling
and visible-state checks omitted the shared mode suffix, which stopped the flow
after approval and left a recovered operation showing “Updating entry…”. Approval
and entry progress now have distinct labels; storage keys remain compatible.

The pilot's completed transaction was a 1-USDC allowance approval, not a paid
entry; the tracker had already reconciled it. The updated page recovers that
retained approval and enables entry. Synthetic local browser regressions passed
approval-to-entry continuation and reload recovery in legacy, shared video and
shared anime modes without duplicate sends. The exact staged and canonical builds
passed repeated Join clicks on desktop/mobile and a retained-approval recovery
check using a read-only wallet and mocked tracking responses. Strict TypeScript,
four deployment/storage helper tests and the scoped secret scan passed. These
checks sent no real wallet signatures or transactions.


## Follow-up: compact controls and combined wallet entries

USDC approval now waits for its successful Base receipt and a fresh sufficient
allowance, then proceeds directly to entry without waiting for the indexer.
A local approval-confirmed marker describes that check separately from canonical
indexing. Entries and claims retain their canonical receipt and indexed-result
requirements. Reloading a retained approval checks the same transaction; it never
automatically resends it.

Wallets advertising EIP-5792 atomic support on Base, including an offered wallet
upgrade, receive one batch containing the selected USDC approval limit followed
by the signed entry and any first-entry draw value. Conventional wallets use the
two-confirmation flow. Atomic submission has no automatic sequential fallback.
The caller-supplied batch ID is saved before asking the wallet, retained through
ambiguous responses and reloads, and handed over only after an exact fighter
Entered event yields a durably stored transaction hash. Wrong-chain, non-atomic,
partial or mismatched results do not unlock another payment.

The entry button stays 48 pixels high with short visible labels; its full status
remains available to screen readers and the page-level progress display. Draw
pricing and refund details remain outside the button. Canonical desktop and phone
checks passed on 30 October 2026 at 10:21 UTC: labels fit without truncation, repeat
Join clicks scroll back to the form, and the mocked wallet receives ordered
approval and entry calls. These checks used synthetic wallet submissions and
mock admission responses, with zero real signatures or broadcasts. Eleven local
browser cases cover ordinary approvals, supported/ready/global atomic capability,
rejection, lost responses, reload, complete failure, partial failure and mismatched
receipts. Eight relevant unit tests and strict web TypeScript checks also passed.

At the public API check, tournament #2 had two indexed pilot entries: red turtle
1000702258 and yellow chick 10003506584. The island draw was fulfilled for island
418. The remaining entries and four private strategy/loadout signatures still
require the pilot wallet. No provider generation was started by these UI checks.
Backend services, deployed contracts, frozen recipes and fighter manifests are
unchanged by this frontend release.
