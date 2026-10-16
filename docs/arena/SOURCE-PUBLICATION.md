# Arena source publication verification

Verified on 16 October 2026 from an exported Git index with a separate dependency
installation. No production service, contract, paid generation or deployment was
changed by this publication.

## Checks

- Pinned pnpm lockfile installation in a clean directory: passed.
- Website and API builds: passed (the existing bundle-size warning remains).
- Website, API and indexer TypeScript checks: passed.
- Arena lab, input compiler, live API, ongoing funding and storage suites: **45 passed**.
- Foundry with separately installed pinned upstream dependencies: **43 passed**.
- Python combat validator: **13 passed**.
- Recomputed all 898 catalog entries and the exact deployed rules/pool hashes.
- Generated `IslandPool.sol` and `island-pool.json` reproduce byte-for-byte.
- Downloaded public island #1122 and verified its committed SHA-256; a second run
  verified the cache without downloading.
- Publication set contains no absolute symlinks. A Gitleaks scan uses the normal
  default rules plus an exact exception for the public Base USDC address.

The first database test attempt hit local workstation disk exhaustion. The
successful run used a new isolated PostgreSQL container backed by memory; that
container was removed afterward. No production database was used. The downloader
identifies its HTTP client so Cloudflare accepts its public asset requests.

## Included and excluded material

Included: application and contract source, tests, public ABI/deployment settings,
combat rules/instructions/schemas, public reveal assignments, 898 metadata files,
ten arena profiles, reviewed reference artwork, credited soundtrack and generic
operations tooling. Test strategies are local laboratory fixtures.

Excluded: runtime secrets, keystores, databases, signed recovery records, private
operator notes/approvals, backup inventories, raw provider experiment responses,
redundant screenshots and historical generated media. Existing internal files
remain local under ignore rules. Original media archives were not deleted.

The complete island PNG set stays on the public asset host; use
`scripts/arena/fetch_island_art.py` to retrieve checksum-bound copies. Original
runtime data paths and the hash-bound combat validator were preserved.

These checks establish source/build reproducibility and publication hygiene.
They are not a new independent smart-contract security audit or a new paid-mainnet
acceptance run. The previously completed paid pilot and deployment remain as-is.
