# Arena contracts (Foundry)

Solidity 0.8.30, Cancun EVM, optimizer with 200 runs and via-IR. Dependencies are
installed from pinned OpenZeppelin 5.4.0, Chainlink 1.4.0 and forge-std v1.9.7
sources by `install-dependencies.py`; downloaded libraries and compiler output
are excluded from Git.

```sh
python3 contracts/arena/install-dependencies.py
cd contracts/arena
forge build
forge test
```

The existing Base deployment is
`0xebd141b6ae36f74fe70b9139b262ee9771b72aca` at block 52,648,146.
See [public deployment data](../../docs/arena/public-deployment.json) and the
[frozen rules manifest](../../docs/arena/mainnet-rules-manifest-v1.json).
Source verification was completed through Sourcify. Public constructor arguments,
ABI and creation bytecode are in `config/`; they contain no signing credentials.

`YunipalsArena.sol` implements four paid seats, a weighted VRF island draw,
strategy commitments and deadlines, automatic fallback commitments, referee
settlement, publication-gated payouts and expiry refunds. `IslandPool.sol` is
reproduced from the public reveal using:

```sh
python3 scripts/arena/build_contract_pool.py
```

Run that command from the repository root. It must reproduce the existing pool
hash; it does not choose new assignments. Genesis islands have weight three and
Personal islands one.

`script/DeployArena.s.sol` is provided for separately reviewed new deployments.
Use `.env.example` as a template and an encrypted Foundry keystore. Keep real
configuration and signing material outside Git. Never reuse test keys or use a
broadcast command merely to verify a build. Application updates use the existing
contract and do not require deployment or an admin unlock.
