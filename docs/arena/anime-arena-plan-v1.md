# Anime Arena implementation plan v1

Status on 2026-10-28: economics, timing, rejection visibility, transfer rule and curator key
approved (section 14). Contracts, indexer support, API, website, studio and renderer
are implemented; the runtime is installed and privately rehearsed on the indexer
server. Contracts, website and public anime services remain undeployed. Current verification and remaining live
steps are in `anime-implementation-v1.md` and `ops/anime-arena/README.md`.
It builds on the mainnet Arena launch plan
(`mainnet-launch-plan-v1.md`), the arena contract in `contracts/arena`, the unified
indexer, the market API arena workers, and the anime render prototype that lives in the
ignored `.arena-lab/anime-v1/` directory (review page: `http://91.98.159.219/arena-anime-975ca04bbfba/`).

Implementation follow-up approved by the user: Claude direction is required for
production anime films. The manual Claude CLI film is the quality baseline, including
movement, flight paths, facing changes and body-attack staging. Following the private paid comparison, the implementation
uses Claude Opus 5.5 via OpenRouter, reserves $0.80 per film as conservative funding
headroom, validates bounded presentation paths and exact whole-word strategy quotes, and retains actual charge
receipts. This supersedes the optional/disabled-by-default director described below.
The referee remains the existing direct OpenAI model/settings; the film itself is
rendered locally. OpenRouter access and fresh inference billing were verified in
the private rehearsal; the onchain Base pilot remains a live acceptance requirement.
The existing video arena continues using its original providers.

The corrected fresh production-route rehearsal on 2026-10-29 measured **$0.344467**
in AI inference: $0.200871 from direct OpenAI reported usage at Standard rates
and $0.143596 reported by OpenRouter for full Opus choreography. The new battle
has 7/6/8 attack events. Artwork was reused as in production; gas, server expense
and failed-attempt/schema-development charges are excluded from that per-film figure.
See the implementation report for the separate $0.667234 development total.

## 1. Product summary

- Holders of **Base OG Yunipals** (`0x98433df878e8c898cb907345c3a7756e5f72240f`, ERC-721
  behind an EIP-1967 proxy, implementation `0x4ad38076…`) can **apply** a token for
  the anime arena. Applying is an onchain transaction that costs only Base gas. The
  TCG collection and the Ethereum/Polygon/BNB collections are out of scope for v1.
- The **curator** (Sebastian) generates the fighter art with the Codex subscription in
  an operator tool, reviews it, publishes the sprite set to
  `assets-anime.yunipals.com`, and **approves** tokens onchain in batches with the
  manifest hash. Rejections carry a reason code and a short note; holders can reapply.
- Approved fighters can enter **anime arena tournaments**: a second deployment of the
  existing `YunipalsArena` contract with **1 USDC entry**, Base OG only, approved
  fighters only. The referee flow is unchanged. The film is rendered by the anime
  engine on our server instead of a video model. The required director cost
  $0.11998 in the full-choreography comparison, plus server rendering overhead.
- The existing 2 USDC video arena keeps running unchanged on its own deployment.

## 2. Decisions taken from the brainstorm

| Topic | Decision |
| --- | --- |
| Collection | Base OG only (`8453:0x98433d…`). Other collections refused onchain and by the API. |
| Entry fee | 1 USDC per seat. **Approved split: winner 80 %, island owner 5 %, operations 15 %** (section 3). |
| Application | Onchain (`apply(tokenId)`), indexed by the unified indexer. Ownership checked in the transaction. |
| Approval | Onchain, batched, curator role. Stores status, recipe version and manifest hash per token. |
| Rejection | Onchain event with reason code + note (≤ 140 chars, event data only). **The note is public** on the website. Reapply allowed. |
| Art ownership | Bound to the **token**, not the wallet. **Approved: approval and art follow the NFT on transfer**; a new owner can enter without reapplying. |
| Art generation | Operator tool driving `codex exec` on the subscription. No API key in the tool. API fallback designed but not required. |
| Timing | **Approved: same windows as the video arena** — 7-day join, 24-hour strategy, 24-hour referee resolution (`launch-timing.json`). |
| Curator key | **Approved for now: the arena admin wallet** is the registry curator. The contract keeps a separate rotatable `curator` role so a dedicated wallet can take over later without redeploying. |
| Hosting | New nginx site `assets-anime.yunipals.com` on this server, content-hash-named files, immutable caching, in the storage-box backup. |
| Indexing | Add the registry and the anime arena deployment to the **unified** source manifest in one transition. No legacy projector. Details and cost in section 6. |
| Media | Same publication, verification and payout-release path as today. The anime renderer produces the same published file set, so `releasePayouts(id, videoHash)` and the website film player need no change. |

## 3. Economics at 1 USDC entry (approved)

Four seats make a 4 USDC pot. The contract requires `winnerBps + islandBps <= 10000`
and economics are immutable per deployment; the split below is approved for the
anime deployment.

| Item | Per tournament | Basis |
| --- | --- | --- |
| Referee (`gpt-6.1-sol`, `xhigh`) | ~$0.27 | Pilot measurement in `entry-economics-estimate-v3.json`; one run, not an average |
| VRF, settlement gas, storage | ~$0.10 | Allowance carried over from estimate v3; VRF native cost on Base to be measured |
| Anime media | ~$0.12 plus server overhead | Required full Opus 5.5 choreography measured $0.11998 once; CPU rendering, no video-model call |
| **Operating cost** | **~$0.49** | Uses the carried referee/gas allowances and the full-choreography measurement |

Approved split: **winner 80 % (3.20 USDC), island owner 5 % (0.20 USDC), operations
15 % (0.60 USDC)** — `winnerBps 8000`, `islandBps 500`, `entryFeeRaw 1000000`. That
leaves roughly **$0.11 margin** per full tournament before fixed overhead. The
82.5 / 5 / 12.5 alternative was rejected because it leaves no room for a referee cost
spike.

The referee is now the dominant cost. A later, separately validated change to `high`
effort could roughly halve it; that changes the rules manifest and needs its own
referee validation run, so it is **not** part of this plan.

## 4. Architecture overview

```text
Holder wallet ──apply(tokenId)──► AnimeFighterRegistry (Base)
                                     │ Applied / Approved / Rejected / Revoked events
                                     ▼
                         Unified indexer (Ponder, Base) ── anime_fighter table ──► market API ──► website
                                     ▲                                               │
Curator ── studio CLI ── codex exec ─┘ (reads queue)                                 │ admission permit
         │                                                                           ▼
         ├─ publish sprites + manifest ──► assets-anime.yunipals.com        YunipalsArena (anime deployment)
         └─ approve(tokenIds, manifestHashes) ──► registry                  1 USDC, Base OG, eligibility = registry
                                                                                     │
                                                      referee worker ◄── frozen input ┘
                                                      anime media worker: export → direct → render → mix → publish
                                                      settlement worker: releasePayouts(id, filmHash)
```

## 5. Contracts (`contracts/arena`)

### 5.1 `AnimeFighterRegistry.sol` (new, Base)

Purpose: the single onchain source of truth for who may fight in the anime arena.

```solidity
enum Status { None, Applied, Approved, Rejected, Revoked }
struct Fighter { Status status; uint16 recipeVersion; uint32 applications; bytes32 manifestHash; }

address public constant BASE_YUNIPALS = 0x98433dF878e8C898CB907345C3a7756E5F72240f;
address public curator;            // owner-rotatable; initially the arena admin wallet
bool    public applicationsOpen;   // owner-settable; lets the curator pause intake when the queue is long
string  public baseURI;            // "https://assets-anime.yunipals.com/fighters/v1/"
mapping(uint256 tokenId => Fighter) public fighters;

event Applied(uint256 indexed tokenId, address indexed owner, uint32 application);
event Approved(uint256 indexed tokenId, bytes32 manifestHash, uint16 recipeVersion);
event Rejected(uint256 indexed tokenId, uint8 reasonCode, string note);
event Revoked(uint256 indexed tokenId, uint8 reasonCode, string note);
event CuratorChanged(address indexed previous, address indexed next);
event ApplicationsOpenChanged(bool open);
event BaseURIChanged(string baseURI);

function apply(uint256 tokenId) external;                       // owner of token; status None or Rejected; applicationsOpen
function approve(uint256[] calldata ids, bytes32[] calldata manifestHashes, uint16 recipeVersion) external; // curator
function reject(uint256[] calldata ids, uint8[] calldata codes, string[] calldata notes) external;          // curator
function revoke(uint256 tokenId, uint8 code, string calldata note) external;                                // curator
function isEligible(uint256 chainId, address collection, uint256 tokenId) external view returns (bool);
function manifestURI(uint256 tokenId) external view returns (string memory);                                 // baseURI + tokenId + "/manifest.json"
```

Rules:

- `apply` requires `IERC721(BASE_YUNIPALS).ownerOf(tokenId) == msg.sender`, status `None`
  or `Rejected`, and `applicationsOpen`. It increments `applications` so the indexer can
  distinguish reapplications. No fee, no payment token.
- `approve` only from status `Applied` (or `Revoked`, to re-approve after a recipe
  update). Stores `manifestHash` and `recipeVersion`. The manifest hash commits to the
  identity traits, the artwork hash, every sprite hash and the recipe, so a later
  artwork change is detectable.
- `reject` only from `Applied`. `revoke` only from `Approved`. Both carry a reason code;
  the note is event data only (no storage), so a batch of 20 rejections stays cheap.
- `isEligible` returns `chainId == 8453 && collection == BASE_YUNIPALS && status == Approved`.
- `Ownable2Step` admin like the arena. The curator cannot change admin, URI or pause.
  At deployment `admin == curator == arena admin wallet`; `setCurator` later moves
  batch approvals to a dedicated wallet without touching the admin role.

Reason codes (v1; the website maps them to copy):

| Code | Meaning |
| --- | --- |
| 1 | Artwork not supported yet (unrevealed or placeholder metadata) |
| 2 | Could not produce a consistent fighter for this artwork; may reapply after recipe update |
| 3 | Duplicate artwork already in the queue (same traits); approval will cover both |
| 4 | Queue closed for now |
| 5 | Traits changed after approval (revoke only) |
| 0 | Other, see note |

Gas on Base at current prices: `apply` ≈ 50k gas (one storage slot + event) — about a
cent; `approve` ≈ 45k gas per token (two slots), so 20 tokens per transaction stay far
below a block's limits and cost cents.

### 5.2 `YunipalsArena.sol` eligibility hook (v1.1, new deployment only)

The deployed video arena is not touched. The anime arena is a **new deployment** of
the same contract with these additions:

- `Config` gains `address eligibility` (zero = no extra check, which reproduces today's
  behaviour).
- `join` additionally requires
  `eligibility == address(0) || IEligibility(eligibility).isEligible(e.nftChainId, e.collection, e.tokenId)`.
  The registry rejects every non-Base collection, so the anime deployment is Base-only
  without changing `supportedCollection`.
- Constructor validation: if `eligibility != 0` it must have code.
- Everything else (VRF, strategies, settlement, claims, payouts) stays identical, which
  keeps the referee, settlement and projector code reusable.

Tests to add in `test/YunipalsArena.t.sol` and a new `test/AnimeFighterRegistry.t.sol`:
apply/reapply/ownership, curator permissions, batch approve/reject length checks, status
transitions, `isEligible` for wrong chain/collection/status, join refused for unapproved
token and accepted for approved, join still works with `eligibility = 0`, revoke blocks
a later join but not an active seat. Target ≥ 20 new tests; keep the existing 43 and the
fuzz tests green.

### 5.3 Deployment artifacts

- `contracts/arena/config/anime-economics.json` (1 USDC, 8000 / 500 bps),
  `anime-timing.json` (identical to `launch-timing.json`: 604800 / 86400 / 86400 s),
  `anime-rules-manifest-v1.json` with its `rulesHash` (section 8.3), constructor
  arguments, ABI JSON for both contracts.
- `script/DeployAnimeRegistry.s.sol` and `DeployArena.s.sol` extended with
  `ARENA_ELIGIBILITY`.
- Deploy order on Base: registry (applications closed) → arena (entries paused) →
  publish addresses in `docs/arena/anime-deployment.json` → open applications → open
  entries after the pilot (section 11).

## 6. Indexer (`apps/yunipals-indexer`, `packages/yunipals-indexer-server`)

### 6.1 Sources

Two new Base sources in `lib/unified/sources.ts`:

- `arena:8453:<animeArenaAddress>` — already supported: add the deployment to
  `UNIFIED_ARENA_DEPLOYMENTS`. The `YunipalsArena` contract entry takes an address
  array, so this is one more address in the **existing** log filter and the existing
  `src/arena.ts` handlers. The `deployment` column already keys all arena tables.
- `anime-registry:8453` — new `AnimeFighterRegistry` contract entry with
  `animeRegistryAbi` from `packages/yunipals-market-core/src/animeRegistryAbi.ts`,
  `startBlock` = deployment block, `receiptRequirement: "none"`, policies
  `latest` + `depth 5` like the arena.

### 6.2 Schema and handlers

- `lib/arena/schema.ts`: `animeFighter` onchain table — `id` (tokenId), `status`,
  `recipeVersion`, `manifestHash`, `applicant`, `applications`, `reasonCode`, `note`,
  `appliedBlock`, `lastEventId`, `blockNumber`, `blockHash`; index on `status, blockNumber`.
- `src/anime.ts`: one handler per registry event, `recordCanonicalEvent` first (same
  journal discipline as `src/arena.ts`), then upsert.
- `packages/yunipals-indexer-server/src/arena.ts`: `readAnimeFighter(tokenId)` and
  `readAnimeFighters({ status, cursor, limit })` with the same release/block-witness
  shape as `readArenaTournament`, so the market API can verify it reads a consistent
  snapshot.

### 6.3 Indexing cost — what actually costs and what does not

- **Historical sync:** both contracts are brand new, so their history starts at the
  deployment block. There is nothing to backfill.
- **Live sync:** the Base chain is already polled every 2 s for the collection,
  metadata, islands, boosters and arena sources. The anime arena address joins the
  existing arena filter at no extra request. The registry is one additional log filter
  on an already-polled chain; its event volume is a handful per day. Measure with the
  existing `scripts/unified-rpc-profile.ts` and the allocation review before
  activation; if the measured CU is not negligible, fold the registry into the next
  source review rather than running it elsewhere.
- **The real cost is the transition, not the RPC.** Changing the Ponder source set or
  schema is a new build; the README rule "keep the same source configuration and
  schema on restart" applies. Use the established unified-indexer transition procedure
  (new `UNIFIED_PONDER_SCHEMA`, parity snapshot, handover) and schedule both new sources
  in **one** transition. Do not add them in two steps.
- Rejected alternative: the legacy market-API projector (`ARENA_INDEXER_MODE=legacy`)
  scans 500 Base blocks per pass with its own `eth_getLogs`; that is thousands of extra
  calls per day. Not used.
- Before the transition lands, the website can show fighter status from bounded
  `eth_call` reads (`fighters(tokenId)`) through the production RPC proxies, cached
  60 s by the market API. The admission check (section 8.1) uses a fresh read in any case.

## 7. Fighter art: recipe, studio tool, hosting

### 7.1 Recipe `anime-fighter-v1` (frozen before the first approval)

Per fighter, 9 images from `codex exec` with the built-in image tool, chroma-key
`#00FF00` backgrounds, 1:1 for poses and 16:9 for the cut-in:

| Stage | Pose | References |
| --- | --- | --- |
| 1 | idle | on-chain artwork + fixed style board |
| 2 | attack, dodge or dash (flight species), guard, hurt, down, victory, cut-in | artwork + the approved idle |
| 3 | signature attack kits (section 7.5): one windup pose per kit, plus the species FX sheets if the library lacks them | artwork + the approved idle; style board for FX |

The style text, the style board image and the pose prompts are versioned files in
`docs/arena/anime-recipe-v1/`; the recipe hash goes into every manifest. Species →
attack kind, flight/ground, default sprite scale and anchor tables live in the recipe
too, with per-fighter overrides allowed in the manifest. This replaces the hand-tuned
`LOOK` table in the prototype engine.

The identity text the referee uses (species, anatomy, locomotion) is drafted by the
tool from the Base traits (`yunipal(tokenId)` → monsterType/color/horn) and the existing
`identity-registry-v1` profiles, then **reviewed by the curator** in the same approval.
It is stored in the manifest with `identityVersion: "anime-fighter-v1"`, so anime
entries need no paid `identity_job`.

Compliance item before launch: confirm OpenAI's current terms for commercial use of
subscription-generated images and scripted Codex runs, and note the plan's image usage
limits. The tool records `generatedWith: "codex-subscription"` per image.

### 7.2 Studio CLI `scripts/anime/studio.py`

Modelled on `scripts/boosters/art_lab.py` (operator-driven, no API keys, file-locked
lab directory, JSON receipts). Commands:

| Command | What it does |
| --- | --- |
| `queue` | Lists `Applied` tokens from the indexer reader (or the registry logs before the transition) with traits and application count |
| `prepare <tokenId>` | Fetches artwork + traits, drafts the identity text, writes the stage contract and prompts for the recipe |
| `generate <tokenId> [--stage]` | Runs `codex exec` per stage with references, ≤ 2 retries, parallel across tokens; stores raw PNGs and receipts |
| `kits <tokenId>` | Stage 3: drafts three kit definitions from species + identity (name, kind, element, description), generates the three windup poses, and reuses or generates the species FX sheets |
| `key <tokenId>` | Chroma-key, despill, trim; writes a contact sheet |
| `fit <tokenId>` | Deterministic anchors from the sprite alpha bounds plus recipe species defaults; curator can override |
| `review <tokenId> approve \| reroll <pose> \| reject <code> "note"` | Records the decision; reroll regenerates one pose from the approved idle |
| `export <tokenId>` | WebP sprites named `<pose>.<sha8>.webp`, `manifest.json`, hashes |
| `publish` | rsync the export to the assets site (section 7.4) |
| `approve-batch` | Writes `approve(ids, manifestHashes, recipe)` calldata and a `cast send` command for the arena admin wallet (the current curator); the key never enters the tool |
| `reject-batch` | Same for rejections |

Throughput estimate from the prototype: ~1 minute per image on the subscription with
5 parallel jobs, so about 4 minutes of generation and 1–2 minutes of review per fighter.
Plan for tens of fighters per session. The queue is FIFO and public, so the backlog is
visible.

### 7.3 Fighter manifest `fighters/v1/<tokenId>/manifest.json`

```json
{
  "version": "anime-fighter/v1",
  "chainId": 8453, "collection": "0x98433d…", "tokenId": "1234",
  "traits": { "monsterType": 7, "color": 3, "horn": 2, "background": 1, "glitter": 0 },
  "traitsHash": "0x…",
  "artwork": { "url": "…", "sha256": "…" },
  "identity": { "species": "Unibranch", "color": "Purple", "horn": "Candy Cane",
                "text": "Purple Unibranch, cream chest…", "locomotion": "ground",
                "identityVersion": "anime-fighter-v1" },
  "recipe": { "id": "anime-fighter-v1", "sha256": "…" },
  "look": { "attackKind": "vine", "palette": { "color": "#d63fd0", "light": "#ff8af2", "dark": "#5a1c8c" },
            "face": 1, "stageHeight": { "idle": 270, "attack": 320 }, "origin": [0.34, 0.37], "torso": [0.04, 0.52] },
  "sprites": { "idle": { "file": "idle.3f9a1c2b.webp", "sha256": "…", "w": 1131, "h": 1101 }, "…": {} },
  "kits": [
    { "id": "vine-lash", "name": "Vine Lash", "kind": "strike", "element": "nature",
      "description": "whips a thorny vine from the forehoof into the target",
      "windup": { "file": "vine-lash.windup.8c2d11aa.webp", "sha256": "…", "h": 300 },
      "strike": { "sheet": "species/unibranch/vine.1a2b3c4d.png", "sha256": "…", "cols": 1, "rows": 2, "blend": "alpha" },
      "impact": { "sheet": "species/unibranch/impact-nature.9f8e7d6c.png", "sha256": "…", "cols": 2, "rows": 2, "blend": "add" } },
    { "id": "thorn-volley", "…": "…" },
    { "id": "root-slam", "…": "…" }
  ],
  "defaultLoadout": ["vine-lash", "thorn-volley"],
  "generatedWith": "codex-subscription",
  "reviewedAt": "2026-11-02T10:00:00Z"
}
```

`manifestHash = sha256(canonical JSON)` is what `approve` stores. The engine and the
admission check verify every sprite against the manifest, and the manifest against the
onchain hash, before use (same pattern as `verifyPublicationFile`).

### 7.4 Hosting `assets-anime.yunipals.com`

- nginx site on this server like `alpha.yunipals.com`: root
  `/var/www/assets-anime.yunipals.com`, certbot TLS, `GET`/`HEAD` only, CORS
  `Access-Control-Allow-Origin` for `https://www.yunipals.com` (and the alpha origin),
  `Cache-Control: public, max-age=31536000, immutable` for hash-named files, `max-age=300`
  for `manifest.json`, no directory listing.
- Layout: `fighters/v1/<tokenId>/{manifest.json, <pose>.<sha8>.webp, cutin.<sha8>.jpg, card.jpg}`,
  `recipes/anime-fighter-v1/{style.json, board.png}`,
  `recipes/anime-fighter-v2/species/<species>/{<kind>.<sha8>.png, impact-<element>.<sha8>.png}`
  (the shared FX library), `engine/<version>/` for the
  published engine build used by the website's live mode.
- Published by the studio `publish` command as root via rsync, files 0644. Add the
  directory to `ops/arena/backup_policy.py` so it is in the encrypted storage-box backup.
- DNS: A/AAAA records for the subdomain to this server (Hetzner `91.98.159.219`,
  `2a01:4f8:c17:40ff::1`).

### 7.5 Signature attack kits and the player loadout

Validated on 2026-10-29 with a Cedar/Zephyr experiment (review page `/v3-attacks/` on
the preview site; brief for implementation in `anime-attack-kits-brief-v1.md`):
painted kits plus free engine timing made the attacks read as anime hits at zero
per-battle cost. This is now part of the recipe (as recipe v2; approved v1 fighters
keep their committed recipe until re-approved).

**Kit** = one named attack with its own art. Three per fighter, generated at
sponsorship time:

| Part | Format | Generated | Notes |
| --- | --- | --- | --- |
| `windup` | chroma-key pose, 1:1 | per fighter and kit | Anticipation pose (coiled vine, charging horn). Held, then snapped to the existing `attack` pose |
| `projectile` or `strike` | sheet on **pure black**, 2×2 grid (4 frames); `strike` may be 1×2 | **per species**, recoloured to the fighter palette | Projectiles are additive (`blend: "add"`): no chroma key, no fringes. Strikes (whips, slashes) are opaque objects: luminance key + engine-drawn outline (`blend: "alpha"`) |
| `impact` | sheet on pure black, 2×2 | **per element** (nature, amber, water, void, …) | Additive hit-spark burst, 4 frames over 0.3 s |

Rules learned in the experiment:

- Painted FX **replace** the code-drawn FX for that attack; they never stack (stacking
  overexposed the star to a white blob). The code-drawn versions stay as the fallback
  for fighters or kinds without a kit.
- Ask for the grid shape explicitly and record `cols`/`rows` in the manifest; the model
  sometimes returns 1×2 instead of 2×2.
- Strike sheets need a thick brush; a whip drawn across the full panel width reads thin
  at fighting distance. The recipe prompt states a minimum stroke width.
- Engine timing that ships with kits, all free: hit stop (4 frames on a clean hit, 2 on
  a guard), a two-frame smear of the release pose along the strike line, windup hold →
  one-frame snap, and a 7 % camera punch-in at release decaying over 0.25 s.

**Species FX library.** Projectile, strike and impact sheets are generated once per
species (and per element for impacts) under `recipes/anime-fighter-v2/species/` and
referenced by manifests. The engine recolours a sheet to the fighter palette with a hue
shift. With roughly 20 OG species and a handful of elements this is a one-time library
of about 150 images; per fighter only the three windup poses are new (plus the nine
base poses).

**Loadout.** The owner picks **2 of the 3** kits. Storage is offchain and needs no
contract change: the pick is submitted with the tournament strategy (default
`defaultLoadout` from the manifest if the player does not change it). The chosen kits
enter the **frozen referee input** as the fighter's "known techniques" — name and
one-line description only, explicitly labelled as cosmetic vocabulary with no damage,
energy or timing effect. Strategies stay fully custom; the referee just tends to use
those names in `attackName`, so the director can map events to kits exactly instead of
guessing from keywords. The Opus director receives each fighter's loadout and returns a
`kit` id per attack event; the validator requires the id to be in that fighter's
loadout and the kit kind to be compatible with the event (a body-contact event may use
a `dash` kit). Deterministic fallback: name match in `attackName` → first loadout kit
of the event's kind → code-drawn `look.attackKind`.

Cost: 3 windup images per fighter at sponsorship (subscription, or ~$0.10–0.50 at API
medium quality), the one-time species library, and a few hundred extra referee input
tokens per tournament. Per-battle media cost stays at zero.

## 8. Market API (`apps/yunipals-market-api/src/arena`)

### 8.1 Second deployment instance

`arenaConfig` serves exactly one `ARENA_CONTRACT`, and every table is keyed by
`deployment`, so the anime arena runs as a **second set of services against the same
`yunipals_arena` database**: `yunipals-anime-arena-{api,lobby,referee,settlement,media,
capacity,control}` with `/etc/yunipals-anime-arena/{runtime,database}.env`, API port
53912, nginx `location ^~ /api/anime-arena/`. No multi-deployment refactor of the API
in v1. The projector is not needed in unified mode.

Admission (`admission.ts`) for the anime deployment additionally:

1. Refuses non-Base collections before any read.
2. Reads `fighters(tokenId)` on the registry at the same finalized/latest block as the
   `ownerOf` read; requires `Approved`.
3. Fetches the manifest from `assets-anime.yunipals.com`, verifies
   `sha256(canonical) == manifestHash`, and verifies `traitsHash` against the current
   `yunipal(tokenId)` traits. A mismatch means the artwork changed after approval
   (`Update` events exist on the Base contract): refuse with a clear message and
   surface the token in the studio queue for revoke/re-approve.
4. Compiles the `FighterSnapshot` from the manifest identity (`identityVersion:
   "anime-fighter-v1"`) instead of `ensureIdentity`.
5. Strategy submission accepts `loadout: [kitId, kitId]` (validated against the
   manifest, default `defaultLoadout`). The input compiler adds the chosen kits' names
   and descriptions to the frozen input as cosmetic "known techniques" (section 7.5);
   the referee system prompt states they carry no rule effect.

Config additions: `ARENA_ELIGIBILITY_REGISTRY`, `ARENA_FIGHTER_ASSETS_ORIGIN`,
`ARENA_MEDIA_KIND=anime`.

### 8.2 Anime media worker

A new `animeMedia.ts` + `arena-anime-media.mjs` entry replaces the Runware worker for
this deployment and reuses `ArenaMedia.step`'s locking, job table and publication:

| Step | Implementation |
| --- | --- |
| `export` | Frozen input + adjudication → `tournament.json` (the prototype's `export_tournament.py`, ported to TS inside the worker so no decryption happens in Python) |
| `fighters` | Fetch and verify the four manifests and sprites into the job folder |
| `direct` | Base staging is supplied to the required Opus director through OpenRouter. `claude-choreography/v4` requires every match as a named block, validates exact event/fighter/cut-in coverage after decoding, and returns bounded x/y/depth/facing/rotation paths, per-event default or body-contact attack visuals, and cut-in names, whole-word verbatim strategy quotes and timing within recorded windups. Ground/flight, visible dodge displacement, body-contact distance and channel bounds are checked. Frozen attacks, defense times, damage and winners never change. The manual Claude CLI film is the comparison baseline. With kits (section 7.5) the director also returns a `kit` id per attack event from the actor's loadout; the validator enforces loadout membership and kind compatibility, with the deterministic name-match fallback. |
| `render` | `node render.mjs` with pinned `chrome-headless-shell`, 1280×720 @ 30 fps, deterministic frames; `mix.py` SFX + music; ffmpeg encode. ~2–3 min CPU per tournament. |
| `assemble` | Produce the **existing published file set**: `film.mp4`, `native-sfx.mp4` (same film, SFX-only track), `SF1.png`/`SF2.png`/`FINAL.png` (poster frames from the renderer), `input.json`, `outcome.json`, `prompts.json` (choreography + director inputs), `film.json` (probe, engine version, recipe and manifest hashes), `receipts.json` (render receipts, no provider), `media-policy.json`, `credits.txt` (music CC-BY credit, fonts). |
| publish | Unchanged `buildMediaPublication` / `commitMediaPublication`; settlement calls `releasePayouts(id, filmHash)` as today. |

The offline steps run with the same credential isolation as `offlineMediaTool` (no
provider keys, no signing keys in the Python/Node child). The service user needs its
own `chrome-headless-shell` under `/srv/yunipals-arena/runtime/` plus the `deb.deps`
packages; pin the version and record it in `film.json`.

### 8.3 Rules manifest `anime-rules-v1`

Derived from `mainnet-rules-manifest-v1.json` with: entry 1 USDC and the approved split,
collection restriction and eligibility registry address, `media.policy =
"anime-engine/v1"` with the engine hash and recipe id, identity source
`anime-fighter-v1`. Combat rules, referee model/settings, schema and tie-break stay
identical so the referee validation remains valid. Its `rulesHash` is the deployment's
immutable rules hash.

## 9. Anime engine productionization

Move the prototype out of `.arena-lab/` into `apps/yunipals-anime-engine/`:

- `src/film.js` (engine), `src/director.ts` (rules-based choreography), `render.mjs`,
  `mix.py`, `key.py`, `fixtures/` with the Cedar/Zephyr/Bastion/Elrond tournament.
- Manifest-driven: `LOOK`, attack kinds and anchors come from fighter manifests and the
  recipe tables, not from code. Kits (section 7.5) are loaded from the manifests; the
  prototype's `kits.json` format (windup / projectile / strike / impact, `cols`/`rows`,
  `blend`) is the starting point.
- Ships with the free timing features validated in the kit experiment: hit stop, smear
  frames, windup hold and snap, camera punch-in. These change film timing for every
  tournament, so they land with an engine minor version bump and regenerated golden
  frames.
- Deterministic by construction; add golden tests: hashes of 12 sampled frames for the
  fixture tournament, cue-sheet snapshot, duration. Fail on any engine change that
  alters output without a version bump.
- Text readability rule stays: ≥ 1 s + 55 ms per character for every on-screen text;
  attack names ≤ 2 words.
- Publish a built engine bundle to `assets-anime.yunipals.com/engine/<version>/` so the
  website can play tournaments live from `tournament.json` + manifests (optional
  feature after launch; the film stays the authoritative artifact for payouts).

## 10. Website (`apps/yunipals-home-web`)

- **Token page** `/collection/base/:tokenId`: "Anime Arena" card. States: not applied
  (Apply button if the connected wallet owns the token, via `useWriteContract` like
  `useArenaWallet.ts`), applied (queue position and application number), approved
  (sprite preview, fighter card, "Enter the anime arena"), rejected (reason text from
  the code table, the public curator note, Reapply button), revoked (reason, note,
  "awaiting re-approval"). The card shows the same state to every visitor; only the
  Apply/Reapply buttons depend on ownership.
  Status from the market API (`GET /api/anime-arena/fighters/:tokenId`), which reads the
  indexer table and falls back to a cached `eth_call` before the transition.
- **Anime arena pages** `/arena/anime`, `/arena/anime/:id`, `/arena/anime/me`: reuse
  `LiveArenaPage`, `ArenaDashboard`, `ArenaFilm` and `ArenaJoinBanner` parametrised by
  deployment (API base URL and labels). The fighter picker lists only approved Base
  tokens of the wallet. Film playback is unchanged because the published file set is.
- **Loadout picker** on the fighter card and in the strategy submission form: the three
  kits with name, element and an animated preview (projectile/impact sheets played in a
  small canvas); pick 2, default pre-selected.
- **Rules page** section for the anime arena: 1 USDC, 80 / 5 / 15 split, same windows
  as the video arena, approval requirement, reason codes, public rejection notes, and
  that approval and art follow the token when it is sold.
- **Public queue** `/arena/anime/studio`: read-only list of applied/approved/rejected
  counts and the next tokens in line. Keeps the curator bottleneck transparent.

## 11. Operations and rollout

- Ops files: `ops/anime-arena/` with systemd units, nginx fragments for the API and the
  assets site, runtime env examples, backup policy update, runbook (queue handling,
  reroll, revoke on trait change, Chromium update procedure).
- Monitoring: queue age (oldest `Applied`), render duration and failures, assets site
  health, approved-but-missing-manifest check (daily job that re-verifies every approved
  manifest hash against the site).
- Rollout:
  1. Contracts on Base: registry with applications closed, arena with entries paused.
  2. Indexer transition with both sources; parity check.
  3. Assets site live; the four pilot fighters regenerated **from Base tokens** through
     the real studio tool (the current prototype used Ethereum tokens) and approved.
  4. Pilot tournament with `ARENA_LAUNCH_MODE=pilot` wallets at 1 USDC; verify costs,
     film publication, claims.
  5. Open applications; curate the first batch; open entries.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Base artwork can change after approval (`Update` events) | Manifest commits to traits; admission re-checks; revoke/re-approve path; daily verification job |
| Curator throughput | Batch review, contact sheets, visible FIFO queue, `applicationsOpen` pause, API executor designed as a fallback stage contract |
| Style drift across months | Frozen recipe files with hash in every manifest; a new recipe is a new version, old fighters keep theirs |
| Subscription terms or usage limits | Compliance check before launch; `generatedWith` recorded; API fallback costs ~$1–3 per fighter |
| Renderer non-determinism after a Chromium update | Pinned binary, golden frame tests, engine version in `film.json` |
| Referee cost dominates the 0.60 USDC operations share | Measured per tournament in `provider_task`; effort reduction kept as a separate decision |
| Second service set doubles ops surface | Same code, same DB, templated units; one runbook; no new secrets — the curator is the arena admin wallet for now |
| Admin wallet doubles as curator | Batch approvals are frequent transactions from a high-privilege key; keep batches signed from the admin's own wallet (never a server), and move to a dedicated curator wallet via `setCurator` once the queue is steady |
| Indexer transition risk | One transition for both sources, parity procedure, no legacy projector |

## 13. Work breakdown (estimates in engineering days)

| # | Work item | Depends on | Est. |
| --- | --- | --- | --- |
| A | Write `anime-economics.json`, `anime-timing.json`, reason-code table from the approved decisions | — | 0.5 |
| B | `AnimeFighterRegistry.sol`, arena eligibility hook, tests, deploy scripts, ABI packages | A | 3 |
| C | Recipe v1 frozen (prompts, style board, species tables), compliance check | — | 1 |
| D | Studio CLI (prepare/generate/key/fit/review/export/publish/approve-batch) | C | 3 |
| E | Assets site (nginx, TLS, CORS, backup) | — | 0.5 |
| F | Engine move + manifest-driven look + director + golden tests | C | 3 |
| F2 | Attack kits: recipe v2, studio stage 3, species FX library, engine sheets + timing, director kit ids, loadout in submission/input, website picker (`anime-attack-kits-brief-v1.md`) | D, F, H | 4 + generation time |
| G | Indexer: registry source, schema, handlers, readers, transition | B | 2 + transition window |
| H | Market API: deployment config, admission gating, manifest identity, anime media worker, publication file set | B, F | 4 |
| I | Rules manifest v1 and deployment on Base (paused) | A, B, H | 1 |
| J | Website: token-page card, loadout picker, anime arena routes, rules, public queue | G, H | 3.5 |
| K | Ops: units, nginx, Chromium runtime, monitoring, runbook | H | 1.5 |
| L | Pilot fighters via the real tool, pilot tournament, acceptance report | D, I, J, K | 1.5 |

About four weeks of focused work; B, C/D, E and F can run in parallel from the start.

## 14. Decisions (approved 2026-10-28)

| Question | Decision |
| --- | --- |
| Fee split at 1 USDC | 80 / 5 / 15: winner 3.20, island owner 0.20, operations 0.60 USDC |
| Timing windows | Same as the video arena: 7-day join, 24-hour strategy, 24-hour resolution |
| Rejection notes | Public on the website together with the reason code |
| Token transfer | Approval and art follow the token; the new owner can enter without reapplying |
| Curator key | The arena admin wallet for now; `setCurator` allows a dedicated wallet later |

Remaining pre-launch check (not a product decision): confirm OpenAI's terms for commercial
use of subscription-generated images and scripted Codex runs (section 7.1).
