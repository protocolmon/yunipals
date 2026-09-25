# Yunipals marketplace core

Shared collection/deployment registries, Seaport component encoding and hashing, fixed-order policy checks, input validation and maker-signature verification. The homepage and marketplace API use the same implementation; the homepage's existing module paths re-export this package.

This package contains no database, provider credentials, browser storage or wallet transaction sender. Signature verification supports ECDSA and deployed ERC-1271 wallets at a caller-supplied block. Callers remain responsible for current chain state, visibility, policy, admission and settlement simulation.

Exports are TypeScript source. Vite bundles them for the homepage; the Node API build bundles workspace code while leaving installed runtime dependencies external. Do not deploy an unbundled import of these sources as the API executable.
