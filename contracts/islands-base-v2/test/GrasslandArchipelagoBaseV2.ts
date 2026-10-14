import { expect } from "chai";
import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import type { GrasslandArchipelagoBaseV2 } from "../typechain-types";
import { loadDistribution, metadataBaseUri } from "../scripts/plan";

describe("GrasslandArchipelagoBaseV2", function () {
  const plan = loadDistribution();
  async function deploy() {
    const [owner, attacker] = await ethers.getSigners();
    const factory = await ethers.getContractFactory(
      "GrasslandArchipelagoBaseV2"
    );
    const collection = (await factory.deploy(
      owner.address,
      plan.root,
      plan.source.blockNumber,
      plan.source.blockHash,
      `0x${plan.snapshotSha256}`
    )) as unknown as GrasslandArchipelagoBaseV2;
    await collection.waitForDeployment();
    return { collection, owner, attacker };
  }
  const row = (tokenId: string) =>
    plan.tokens.find((t) => t.tokenId === tokenId)!;

  it("pins the replacement snapshot and published reveal commitments", async function () {
    const { collection } = await deploy();
    expect(await collection.DISTRIBUTION_ROOT()).to.equal(plan.root);
    expect(await collection.REPLACEMENT_SNAPSHOT_BLOCK()).to.equal(
      BigInt(plan.source.blockNumber)
    );
    expect(await collection.REPLACEMENT_SNAPSHOT_HASH()).to.equal(
      plan.source.blockHash
    );
    expect(await collection.REPLACEMENT_SNAPSHOT_SHA256()).to.equal(
      `0x${plan.snapshotSha256}`
    );
    expect((await collection.REPLACES_CONTRACT()).toLowerCase()).to.equal(
      plan.source.contract
    );
    expect(await collection.REVEAL_COMMITMENT_SHA256()).to.equal(
      `0x${plan.revealCommitmentSha256}`
    );
    expect(await collection.REVEAL_ASSIGNMENTS_SHA256()).to.equal(
      `0x${plan.revealAssignmentsSha256}`
    );
    expect(await collection.BASE_METADATA_URI()).to.equal(metadataBaseUri);
    expect(await collection.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await collection.supportsInterface("0x5b5e139f")).to.equal(true);
    expect(await collection.supportsInterface("0x780e9d63")).to.equal(true);
  });

  it("returns distinct per-token URLs immediately, including edition boundaries", async function () {
    const { collection, owner } = await deploy();
    const tokens = ["1", "2", "525", "1001", "1002", "1373"].map(row);
    await expect(
      collection.airdropBatch(
        tokens.map((t) => t.recipient),
        tokens.map((t) => t.tokenId),
        tokens.map((t) => t.proof)
      )
    )
      .to.emit(collection, "AirdropBatchMinted")
      .withArgs(owner.address, 6n);
    for (const token of tokens) {
      expect(await collection.tokenURI(token.tokenId)).to.equal(
        metadataBaseUri + token.tokenId
      );
      expect((await collection.ownerOf(token.tokenId)).toLowerCase()).to.equal(
        token.recipient
      );
    }
    await expect(collection.tokenURI(3)).to.be.revertedWithCustomError(
      collection,
      "ERC721NonexistentToken"
    );
  });

  it("rejects changed recipients, mismatched IDs, and unauthorized batches", async function () {
    const { collection, attacker } = await deploy();
    const token = row("1");
    await expect(
      collection.airdropBatch(
        [attacker.address],
        [token.tokenId],
        [token.proof]
      )
    ).to.be.revertedWithCustomError(collection, "InvalidProof");
    await expect(
      collection.airdropBatch([token.recipient], ["2"], [token.proof])
    ).to.be.revertedWithCustomError(collection, "InvalidProof");
    await expect(
      collection
        .connect(attacker)
        .airdropBatch([token.recipient], [token.tokenId], [token.proof])
    ).to.be.revertedWithCustomError(collection, "OwnableUnauthorizedAccount");
    expect(await collection.totalSupply()).to.equal(0n);
  });

  it("rejects malformed and unsupported batches and rolls back the whole batch", async function () {
    const { collection, owner } = await deploy();
    const token = row("1");
    for (const tokenId of [0, 526, 1000, 1374, 4001]) {
      await expect(
        collection.airdropBatch([token.recipient], [tokenId], [token.proof])
      ).to.be.revertedWithCustomError(collection, "UnsupportedTokenId");
    }
    await expect(
      collection.airdropBatch([], [], [])
    ).to.be.revertedWithCustomError(collection, "InvalidBatch");
    await expect(
      collection.airdropBatch([token.recipient], [1], [])
    ).to.be.revertedWithCustomError(collection, "InvalidBatch");
    await expect(
      collection.airdropBatch(
        Array(41).fill(token.recipient),
        Array(41).fill(1),
        Array(41).fill(token.proof)
      )
    ).to.be.revertedWithCustomError(collection, "InvalidBatch");
    await expect(
      collection.airdropBatch(
        [token.recipient, owner.address],
        [1, 2],
        [token.proof, token.proof]
      )
    ).to.be.revertedWithCustomError(collection, "InvalidProof");
    expect(await collection.totalSupply()).to.equal(0n);
  });

  it("prevents duplicate minting and premature finalization", async function () {
    const { collection } = await deploy();
    const token = row("1");
    await collection.airdropBatch([token.recipient], [1], [token.proof]);
    await expect(
      collection.airdropBatch([token.recipient], [1], [token.proof])
    ).to.be.revertedWithCustomError(collection, "ERC721InvalidSender");
    await expect(collection.renounceOwnership()).to.be.revertedWithCustomError(
      collection,
      "UseFinalizeAirdrop"
    );
    await expect(collection.finalizeAirdrop())
      .to.be.revertedWithCustomError(collection, "AirdropSupplyIncomplete")
      .withArgs(1n, 898n);
  });

  it("rehearses all 898 authorized mints, unique URLs, and irreversible mint closure", async function () {
    this.timeout(120_000);
    const { collection } = await deploy();
    const deployment = await collection.deploymentTransaction()!.wait();
    let mintGas = 0n;
    let batches = 0;
    for (let start = 0; start < plan.tokens.length; start += 40) {
      const batch = plan.tokens.slice(start, start + 40);
      const receipt = await (
        await collection.airdropBatch(
          batch.map((t) => t.recipient),
          batch.map((t) => t.tokenId),
          batch.map((t) => t.proof)
        )
      ).wait();
      mintGas += receipt!.gasUsed;
      batches++;
    }
    expect(await collection.totalSupply()).to.equal(898n);
    const uris = new Set<string>();
    for (const token of plan.tokens) {
      expect((await collection.ownerOf(token.tokenId)).toLowerCase()).to.equal(
        token.recipient
      );
      const uri = await collection.tokenURI(token.tokenId);
      expect(uri).to.equal(metadataBaseUri + token.tokenId);
      uris.add(uri);
    }
    expect(uris.size).to.equal(898);
    const finalization = await (await collection.finalizeAirdrop()).wait();
    expect(await collection.airdropFinalized()).to.equal(true);
    expect(await collection.owner()).to.equal(ethers.ZeroAddress);
    const token = row("1");
    await expect(
      collection.airdropBatch([token.recipient], [1], [token.proof])
    ).to.be.revertedWithCustomError(collection, "OwnableUnauthorizedAccount");
    const totalGas = deployment!.gasUsed + mintGas + finalization!.gasUsed;
    mkdirSync("artifacts", { recursive: true });
    writeFileSync(
      "artifacts/rehearsal.json",
      JSON.stringify(
        {
          tokensVerified: 898,
          uniqueMetadataUris: uris.size,
          batches,
          distributionRoot: plan.root,
          snapshotSha256: plan.snapshotSha256,
          deploymentGas: String(deployment!.gasUsed),
          mintGas: String(mintGas),
          finalizationGas: String(finalization!.gasUsed),
          totalGas: String(totalGas)
        },
        null,
        2
      ) + "\n"
    );
  });
});
