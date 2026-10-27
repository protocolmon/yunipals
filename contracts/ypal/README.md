# YPAL: verified PROTO wrapper copy

YPAL preserves the verified Base PROTO implementation at
`0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3`. Its Solidity contract identifier is
`YPAL`, `name()` returns `Yunipals`, and `symbol()` returns `YPAL`. Documentation
uses Yunipals branding. These are the complete changes to the implementation;
the builder derives the expected candidate from the original and refuses any
other source difference.

`verified-source/` contains all ten original MIT source files under their exact
compiler source keys. `evidence/proto-standard-input.json` and
`evidence/verified-proto-record.json` preserve the public verification inputs.
The original verified source was supplied from
[BaseScan](https://basescan.org/address/0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3#code).

The constructor remains `constructor(address pmon_, address burnAddress_)`.
The creator owns the token; deployment creates no supply and leaves configuration
unlocked. The intended direct creator is the existing owner wallet
`0xB3883Cd96d72B08b8226452305A28D65974a3727`. The underlying token is
`0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7`, and the retained burn destination is
`0xff2Ba07e6F84D22730eD78D1117735a4B041c6EF`.

Wrapping and unwrapping preserve the 1:1 PMON mapping. Burning destroys YPAL and
transfers that amount of backing PMON to the configured destination; it does not
invoke a PMON supply burn. The original ownership/handover, ERC20, EIP-2612 permit,
configuration locking, rescue and reentrancy behavior remain intact. Locking
prevents further burn-address changes; it does not disable wrapping, unwrapping,
burning or the existing rescue functions. Only excess PMON above total YPAL supply
can be rescued through `rescueExcessPMON`.

The permit domain uses name `Yunipals`, version `1`, the actual chain ID and actual
deployed token address. A future deployment address or domain separator is not
predicted by this package. The fresh booster-stack deployment is a separate
owner operation; this directory creates no pack type, test pack or live contract.

## Reproduce

Use Solidity `0.8.28+commit.7893614a`, optimizer enabled with one run, via IR,
Paris EVM and metadata bytecode hash `none`. The reviewed Linux AMD64 compiler SHA
is `9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25`.
Diagnostic AST/storage outputs are additive to the original output selection.

From the repository root:

```sh
node contracts/ypal/scripts/build-artifacts.mjs /path/to/pinned/solc-0.8.28
node contracts/ypal/scripts/build-artifacts.test.mjs
forge test --root contracts/ypal --use /path/to/pinned/solc-0.8.28 -vv
```

The builder reproduces all 69 verified ABI entries, checks all nine dependency
files unchanged, checks the branding-only source transformation, and compares
the compiler-reported storage rows. It emits the public standard input and
`evidence/YPAL.deployment.json`. The creation bytecode is 5,496 bytes; runtime is
5,161 bytes. All seven immutable slots represent the PMON address and are listed
as `{offset, length:32, value:"pmon"}`. The pure `runtimeCode` helper patches every
slot for deployed-code verification. The same creation/runtime bytes are also
produced by the default Foundry build used in the tests.

## Local integration

The integration profile imports the unchanged reviewed booster source and uses
the already retained booster dependencies. It deploys the exact 0.8.28 YPAL
artifact into local Foundry fork memory, then creates a fresh registry, collection
and permit engine there. It configures exactly one unlimited type at 1 YPAL, 264
variants, one daily mint, batch size seven and purchase limit ten.

```sh
YPAL_FORK_RPC_URL=https://mainnet.base.org YPAL_FORK_BLOCK=52993724 FOUNDRY_PROFILE=integration forge test --root contracts/ypal --use /path/to/pinned/solc-0.8.30 --match-contract YPALBoosterForkTest -vv
```

Both fresh-permit and consumed-permit/allowance cases passed using actual PMON
and the actual Base Chainlink wrapper/coordinator code and state. Each case
purchased three independent originals in one engine call and accounted for the
full YPAL/backing burn. PMON funding is a synthetic balance fixture, signatures
use a public synthetic test key, and reveal callbacks are injected explicitly.
The test does not establish a live VRF fulfillment, production purchase or
elapsed-day claim. All writes remain in local fork memory; no transaction is
broadcast and no paid RPC credentials are used.
