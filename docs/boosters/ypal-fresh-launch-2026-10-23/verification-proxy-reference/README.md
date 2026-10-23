# Fresh proxy source verification

BaseScan already associates all three fresh proxies with the full-source reference
`0x1df5e2f815d047b9fbd909549e21ab24302ed44a`. The reference uses Solidity
0.8.30, optimizer 200, Prague and different OpenZeppelin source paths. An exact
source submission for the fresh registry proxy returned `Already Verified`.

The original verifier correctly rejected those compiler/source differences.
This supplement preserves that verifier and adds one explicit reference whose
public input is independently compiled on every v2 run. Its complete 628-byte
creation code, 89-byte runtime and complete ABI are identical to the reviewed
deployment package. The compiler executable is pinned by SHA-256. These checks
cover every byte, rather than assuming that different source/compiler settings
are interchangeable.

`standard-input.json` and `public-record.json` are the public fully verified
reference. `proof.json` binds their hashes and the independently reproduced
creation/runtime hashes to launch package `12bad482…`. Changes to the input,
compiler, ABI, reference or deployed package are rejected. The token and three
implementations still require the original full exact-source verification.

The v2 completion command is:

```sh
python3 -B scripts/boosters/verify_ypal_basescan_v2.py --confirmed docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json --node /root/.nvm/versions/node/v24.18.1/bin/node --submit e33fbe5b07cf6a79a5d77b0e5738d93516fc5ab5c179571236b258c1daba943a --output docs/boosters/ypal-fresh-launch-2026-10-23/verification/basescan-results.json
```

It retains both bounded chain qualifications, all ten actual transaction and
constructor checks, three actual proxy implementation-slot checks, role/rule
checks and independent final explorer rereads. It labels the proxies
`similar-proxy`, independently rereads their full-source reference and verifies
the three explorer implementation links. It never labels a similar match as an
exact full-source match for the new proxy address.

Five additional Python control groups cover recompilation, honest match levels,
source/settings/ABI/compiler/reference substitutions, a non-full reference and
prohibited fallback for token/implementation records. The original seventeen
Python and six bridge controls remain unchanged. No blockchain transaction is
sent by these tools. Explorer credentials remain in the existing loader.
