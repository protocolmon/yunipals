# Local sample collection

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:fixtures
```

Open `http://127.0.0.1:5177`. The port is fixed and the server binds to loopback.
There is no need for `.env.local`, PostgreSQL, the private indexer, provider API
keys or a WalletConnect project. Fixture mode overrides those browser settings.
The fixture handlers never forward unknown requests to live services.

The sample has 48 fictional EVM tokens across four chains and 36 active Exomon,
one burned Exomon and one with unavailable ownership. It covers fictional
collectors, traits, rarity, missing metadata, pagination, token details and
rankings. Try `/?chain=base&t.Type=Water`, `/collection/base/1`, `/leaderboard`,
`/collector/0x0000000000000000000000000000000000000001` or `/?chain=solana`.
Sample token IDs and owners are not claims about real on-chain assets.

All sample tokens are unlisted. Sale/price filters therefore have no matching
listings. Wallet connectors and marketplace capabilities are disabled. Activity,
ENS resolution, visibility signing, writes and trades are not simulated; unsupported
API routes return an explicit error. The normal page may still contain external
links and brand graphics. The generated geometric sample artwork is MIT-licensed.

This is a Vite development mode, not a replacement indexer or production backend.
`vite build --mode fixtures` is rejected, and production builds do not contain the
fixture server or data. To leave fixture mode, stop Vite and run `pnpm dev:web`
with your own service configuration.

Run `pnpm test:fixtures` for catalog-contract, filter, pagination and read-only
checks. Existing fork fixtures below have separate requirements.
Exomon fixture requests stay local, including the burned and unavailable-owner
detail responses. The browser never receives a Helius key or calls Solana RPC.

# Activity UI fixtures

These sale observations were produced on isolated local Anvil forks using test
accounts. They are static test input, not production purchase records or evidence
of live provider availability. The activity UI harness mocks network responses and
blocks external browser requests. Only the observation payloads needed by the
harness are retained here.
