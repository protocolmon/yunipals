#!/usr/bin/env python3
"""Apply the observer fixes to the deployed shared observer bundle.

1. Wait up to 6 seconds for indexer coverage of the observed finalized block.
2. Keep the proven finalized block when a provider reports an older one, and
   log which check reports provider lag.

Usage: patch-observer-bundle.py INPUT OUTPUT

INPUT is /opt/yunipals-unified/shared-observer-v2-20261102/dist/shared-observer.mjs.
The logic matches apps/yunipals-indexer/lib/unified/observer.ts.
"""

import hashlib
import sys

INPUT_SHA256 = "d0d23391ae40e8423939bdce486e0b9416309afd8e211363890ec9991ffca16a"
OUTPUT_SHA256 = "8670d5e0a892cbd063a1c971cede6d8e2c9ebf86459b56bd3c74548c0db065c3"

HELPER = """var finalityCoveragePollMs = 250;
var finalityCoveragePolls = 24;
async function coverageThrough(pool, release, chainId, target, initial, polls, sleep2) {
  let position = initial;
  for (let poll = 0; target !== void 0 && position.indexed < target && poll < polls; poll++) {
    await sleep2(finalityCoveragePollMs);
    const runtime = await indexerTransaction(
      pool,
      (db) => readBoundRuntime(db, release),
      true
    );
    const chain = runtime.chains.find((chain2) => chain2.chainId === chainId);
    const witness = runtime.witnesses.find(
      (witness2) => witness2.chainId === chainId
    );
    if (!runtime.running || chain?.completeThroughBlock === null || chain?.completeThroughBlock === void 0 || !witness)
      break;
    position = {
      indexed: chain.completeThroughBlock < witness.blockNumber ? chain.completeThroughBlock : witness.blockNumber,
      witness
    };
  }
  return position;
}
"""

ENTRY = "async function observeIndexerChain(pool, release, chainId, rpc, options = {}) {"
HEAD = '    const head = validBlock(await rpc.block("latest"));\n'
CALL = """    const { indexed, witness } = await coverageThrough(
      pool,
      release,
      chainId,
      finalized?.number,
      { indexed: initialIndexed, witness: initialWitness },
      options.finalityCoveragePolls ?? finalityCoveragePolls,
      options.sleep ?? ((milliseconds) => new Promise((resolve2) => setTimeout(resolve2, milliseconds)))
    );
"""

REPLACEMENTS = [
    (ENTRY, HELPER + ENTRY),
    (
        "  const witness = read.runtime.witnesses.find(\n",
        "  const initialWitness = read.runtime.witnesses.find(\n",
    ),
    (
        "chain.completeThroughBlock === null || !witness || !read.runtime.running",
        "chain.completeThroughBlock === null || !initialWitness || !read.runtime.running",
    ),
    (
        "  const indexed = chain.completeThroughBlock < witness.blockNumber ? chain.completeThroughBlock : witness.blockNumber;\n  const commitProviderLag",
        "  const initialIndexed = chain.completeThroughBlock < initialWitness.blockNumber ? chain.completeThroughBlock : initialWitness.blockNumber;\n  const commitProviderLag",
    ),
    (HEAD, CALL + HEAD),
    (
        "  const commitProviderLag = async () => {\n",
        "  const commitProviderLag = async (check) => {\n"
        '    console.warn(JSON.stringify({ event: "shared_chain_provider_lag", chainId, check }));\n',
    ),
    (
        "head.number < BigInt(read.previous.head_number))\n      return commitProviderLag();",
        'head.number < BigInt(read.previous.head_number))\n      return commitProviderLag("head_behind_previous");',
    ),
    (
        """      if (read.previous?.finalized_number !== null && read.previous?.finalized_number !== void 0) {
        if (finalized.number < BigInt(read.previous.finalized_number))
          return commitProviderLag();
      }
""",
        """      if (read.previous?.finalized_number !== null && read.previous?.finalized_number !== void 0 && finalized.number < BigInt(read.previous.finalized_number))
        finalized = await blockAt(BigInt(read.previous.finalized_number));
""",
    ),
    (
        "if (indexed > head.number || witness.blockNumber > head.number)\n      return commitProviderLag();",
        'if (indexed > head.number || witness.blockNumber > head.number)\n      return commitProviderLag("witness_ahead_of_head");',
    ),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    with open(sys.argv[1], "rb") as file:
        source = file.read()
    if sha256(source) != INPUT_SHA256:
        sys.exit("The input is not the reviewed observer bundle.")
    text = source.decode("utf-8")
    for before, after in REPLACEMENTS:
        if text.count(before) != 1:
            sys.exit(f"Expected exactly one match for: {before[:60]}")
        text = text.replace(before, after)
    output = text.encode("utf-8")
    if sha256(output) != OUTPUT_SHA256:
        sys.exit("The patched bundle does not match the tested artifact.")
    with open(sys.argv[2], "wb") as file:
        file.write(output)


if __name__ == "__main__":
    main()
