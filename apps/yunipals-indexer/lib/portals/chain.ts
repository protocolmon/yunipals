import {
  createPublicClient,
  parseAbi,
  erc20Abi,
  zeroAddress,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
  type ContractFunctionArgs
} from "viem";
import {
  portalCollectionAbi,
  portalRegistryAbi,
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { z } from "zod";
import {
  portalModels,
  legacyPortalModels,
  rainbowPortalModelsV2,
  rainbowPortalModelsV3,
  portalModelPolicyHash,
  type PortalModelPolicy
} from "@protopals/yunipals-market-core/portals";
import { PortalUserError } from "./errors.js";
import { portalModelPolicySchema } from "./policy.js";
import { readCompetition } from "./competition.js";
import {
  portalRpcUrls,
  portalRpcTransport,
  verifyPortalRpcChains
} from "./rpc.js";

export const portalCardAbi = parseAbi([
  "error ERC721NonexistentToken(uint256 tokenId)",
  "function ownerOf(uint256) view returns (address)",
  "function cardFacts(uint256) view returns (uint32 sequence,uint64 mintedAt,bool initialized)",
  "function provenance(uint256) view returns (uint256 packTypeId,uint256 originalTokenId,uint32 variantId,(uint32 monsterType,uint32 color,uint32 horn,uint32 glitter) traits,bool isOriginal)",
  "function gradingRegistry() view returns(address)"
]);

export interface PortalDeployment {
  chainId: number;
  collection: Address;
  registry: Address;
  grading: Address;
  cards: Address;
  usdc: Address;
}
export type PortalCompletion = ContractFunctionArgs<
  typeof portalGradingAbi,
  "nonpayable",
  "complete"
>[1];
export function portalJson<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item
    )
  ) as unknown;
}

export class PortalChain {
  constructor(
    readonly client: PublicClient,
    readonly deployment: PortalDeployment,
    readonly policies: readonly PortalModelPolicy[] = [
      portalModels,
      rainbowPortalModelsV3,
      rainbowPortalModelsV2,
      legacyPortalModels
    ]
  ) {}
  request(id: bigint, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "getRequest",
      args: [id],
      blockNumber
    });
  }
  async requestTheme(id: bigint) {
    const address = await this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "competition"
    });
    if (address === zeroAddress) return undefined;
    const entry = await this.client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "entryForRequest",
      args: [id]
    });
    if (!entry) return undefined;
    const size = await this.client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "BATCH_SIZE"
    });
    const batchId = (entry - 1n) / size + 1n;
    const theme = await this.client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "getTheme",
      args: [batchId]
    });
    if (theme.hash === `0x${"0".repeat(64)}`)
      throw new Error("Accepted challenge has no published theme.");
    return {
      batchId: batchId.toString(),
      hash: theme.hash,
      title: theme.title,
      brief: theme.brief,
      sourcesHash: theme.sourcesHash
    };
  }
  result(id: bigint, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "getResult",
      args: [id],
      blockNumber
    });
  }
  binding(id: bigint) {
    return this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "requestBinding",
      args: [id]
    });
  }
  owner(token: bigint, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.deployment.cards,
      abi: portalCardAbi,
      functionName: "ownerOf",
      args: [token],
      blockNumber
    });
  }
  provenance(token: bigint) {
    return this.client.readContract({
      address: this.deployment.cards,
      abi: portalCardAbi,
      functionName: "provenance",
      args: [token]
    });
  }
  input(token: bigint, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "inputArtwork",
      args: [token],
      blockNumber
    });
  }
  nonce(owner: Address, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "nonces",
      args: [owner],
      blockNumber
    });
  }
  rubric(id: Hex) {
    return this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "rubric",
      args: [id]
    });
  }

  async portalToken(tokenId: bigint, blockNumber?: bigint) {
    const block = await this.client.getBlock(
      blockNumber === undefined ? {} : { blockNumber }
    );
    const at = { blockNumber: block.number };
    const { collection, grading, registry } = this.deployment;
    const kindId = await this.client.readContract({
      address: collection,
      abi: portalCollectionAbi,
      functionName: "tokenKind",
      args: [tokenId],
      ...at
    });
    if (kindId === 0n) throw new PortalUserError("Portal not found.", 404);
    const [record, kind, balance, round] = await Promise.all([
      this.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "portalRecord",
        args: [tokenId],
        ...at
      }),
      this.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "getKind",
        args: [kindId],
        ...at
      }),
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "claimable",
        args: [tokenId],
        ...at
      }),
      this.client.readContract({
        address: registry,
        abi: portalRegistryAbi,
        functionName: "activePortal",
        ...at
      })
    ]);
    return {
      id: tokenId,
      kindId,
      name: kind.definition.name,
      imageURI: kind.definition.imageURI,
      gates: record[1],
      owner: record[2],
      retired: record[2] === zeroAddress,
      claimable: balance,
      active: round[1] && round[0].portalId === tokenId,
      slotEndsAt: round[0].portalId === tokenId ? round[0].endsAt : 0n,
      asOfBlock: block.number,
      asOfBlockHash: block.hash
    };
  }

  async active() {
    const block = await this.client.getBlock();
    const at = { blockNumber: block.number };
    const { registry, grading, collection, usdc } = this.deployment;
    const [
      state,
      rubricId,
      paused,
      pendingRotation,
      economicsVersion,
      controller,
      live,
      minted,
      liability,
      reserves
    ] = await Promise.all([
      this.client.readContract({
        address: registry,
        abi: portalRegistryAbi,
        functionName: "activePortal",
        ...at
      }),
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "activeRubric",
        ...at
      }),
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "admissionsPaused",
        ...at
      }),
      this.client.readContract({
        address: registry,
        abi: portalRegistryAbi,
        functionName: "pendingRotation",
        ...at
      }),
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "portalEconomicsVersion",
        ...at
      }),
      this.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "claimController",
        ...at
      }),
      this.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "livePortalCount",
        args: [0n],
        ...at
      }),
      this.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "portalCount",
        args: [0n],
        ...at
      }),
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "totalPortalLiability",
        ...at
      }),
      this.client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [grading],
        ...at
      })
    ]);
    const [round, accepting] = state;
    const competition = await readCompetition(
      this.client,
      grading,
      block.number
    );
    const random =
      pendingRotation !== 0n
        ? await this.client.readContract({
            address: registry,
            abi: portalRegistryAbi,
            functionName: "randomRequests",
            args: [pendingRotation],
            ...at
          })
        : null;
    const portal =
      round.portalId === 0n
        ? null
        : await this.portalToken(round.portalId, block.number);
    const configured =
      economicsVersion === 2n &&
      controller.toLowerCase() === grading.toLowerCase();
    const statusReason = !configured
      ? "unconfigured"
      : live === 0n
        ? "empty"
        : round.id === 0n
          ? "not_started"
          : portal?.retired
            ? "retired"
            : block.timestamp >= round.endsAt
              ? "expired"
              : paused
                ? "paused"
                : "open";
    const common = {
      deployment: this.deployment,
      round,
      now: Number(block.timestamp),
      asOfBlock: block.number,
      asOfBlockHash: block.hash,
      open: accepting && !paused && configured,
      paused,
      rubricId,
      economicsVersion,
      competition,
      portalFeeMode: "accumulate_and_burn" as const,
      portalEscrow: grading,
      statusReason,
      supply: { live, minted, burned: minted - live },
      escrow: { reserves, liability },
      rotation: {
        requestId: pendingRotation,
        ready: random?.[2] ?? false,
        canActivate:
          pendingRotation !== 0n &&
          (random?.[2] ?? false) &&
          block.timestamp >= round.endsAt,
        canRequest: pendingRotation === 0n && live !== 0n
      }
    };
    if (!portal) return { ...common, portal: null };
    const [payment, rubric] = await Promise.all([
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "paymentPolicies",
        args: [portal.kindId],
        ...at
      }),
      this.client.readContract({
        address: grading,
        abi: portalGradingAbi,
        functionName: "rubric",
        args: [rubricId],
        ...at
      })
    ]);
    return {
      ...common,
      portal: {
        ...portal,
        payment: {
          aiFee: payment[0],
          portalFee: payment[1],
          aiRecipient: payment[2],
          portalRecipient: payment[3],
          version: payment[4]
        },
        rubric,
        effect:
          this.policies.find(
            (policy) => portalModelPolicyHash(policy) === rubric.modelPolicy
          )?.portalEffects?.[portal.kindId.toString()] ?? null,
        gradingCase:
          this.policies.find(
            (policy) => portalModelPolicyHash(policy) === rubric.modelPolicy
          )?.portalGradingCases?.[portal.kindId.toString()] ?? null
      }
    };
  }

  async quote(tokenId: bigint, submitter: Address) {
    const active = await this.active();
    if (active.competition && !active.competition.accepting)
      throw new PortalUserError(
        "The current challenge is full. Entries reopen after its grades and the next theme are ready."
      );
    if (!active.open || !active.portal)
      throw new PortalUserError(
        "The portal is closed. Wait for the next window."
      );
    const [owner, eligible, input, nonce, pending] = await Promise.all([
      this.owner(tokenId, active.asOfBlock),
      this.client.readContract({
        address: this.deployment.grading,
        abi: portalGradingAbi,
        functionName: "matches",
        args: [active.round.portalId, tokenId],
        blockNumber: active.asOfBlock
      }),
      this.input(tokenId, active.asOfBlock),
      this.nonce(submitter, active.asOfBlock),
      this.client.readContract({
        address: this.deployment.grading,
        abi: portalGradingAbi,
        functionName: "pendingRequest",
        args: [tokenId],
        blockNumber: active.asOfBlock
      })
    ]);
    if (owner.toLowerCase() !== submitter.toLowerCase())
      throw new PortalUserError("Connect the wallet that owns this card.");
    if (pending !== 0n)
      throw new PortalUserError(
        "This card already has a spell being processed."
      );
    if (!eligible)
      throw new PortalUserError(
        "This card does not match the active portal's filters."
      );
    return { ...active, input: input[0], artVersion: input[1], nonce, tokenId };
  }

  async card(tokenId: bigint, before?: bigint, limit = 10) {
    const block = await this.client.getBlock();
    const blockNumber = block.number;
    const [provenance, facts, historyCount, pending] = await Promise.all([
      this.client.readContract({
        address: this.deployment.cards,
        abi: portalCardAbi,
        functionName: "provenance",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.deployment.cards,
        abi: portalCardAbi,
        functionName: "cardFacts",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.deployment.grading,
        abi: portalGradingAbi,
        functionName: "historyCount",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.deployment.grading,
        abi: portalGradingAbi,
        functionName: "pendingRequest",
        args: [tokenId],
        blockNumber
      })
    ]);
    const end =
      before !== undefined && before < historyCount ? before : historyCount;
    const first = end > BigInt(limit) ? end - BigInt(limit) : 0n;
    const history = await Promise.all(
      Array.from({ length: Number(end - first) }, async (_, index) => {
        const id = await this.client.readContract({
          address: this.deployment.grading,
          abi: portalGradingAbi,
          functionName: "historyAt",
          args: [tokenId, first + BigInt(index)],
          blockNumber
        });
        const [request, result, grader] = await Promise.all([
          this.request(id, blockNumber),
          this.result(id, blockNumber),
          this.client.readContract({
            address: this.deployment.grading,
            abi: portalGradingAbi,
            functionName: "completedBy",
            args: [id],
            blockNumber
          })
        ]);
        return { id, request, result, grader };
      })
    );
    const originalArtwork = await this.client.readContract({
      address: this.deployment.grading,
      abi: portalGradingAbi,
      functionName: "baseArt",
      args: [provenance[2]],
      blockNumber
    });
    if ((await this.client.getBlock({ blockNumber })).hash !== block.hash)
      throw new Error("Card history changed during read.");
    return {
      asOfBlock: blockNumber,
      asOfBlockHash: block.hash,
      tokenId,
      provenance,
      facts,
      historyCount,
      pending,
      history,
      originalArtwork,
      nextBefore: first > 0n ? first : null
    };
  }

  async submit(
    id: bigint,
    result: PortalCompletion,
    wallet: WalletClient<Transport, Chain, Account>
  ) {
    // Runtime validation and typed construction are performed by the worker before encoding.
    const { encodeFunctionData } = await import("viem");
    const data = encodeFunctionData({
      abi: portalGradingAbi,
      functionName: "complete",
      args: [id, result]
    });
    return wallet.sendTransaction({
      account: wallet.account,
      chain: wallet.chain,
      to: this.deployment.grading,
      data
    });
  }
}

export async function connectPortalChain(env: NodeJS.ProcessEnv = process.env) {
  const chainId = Number(env.PORTALS_CHAIN_ID ?? 8453);
  if (
    ![8453, 84532].includes(chainId) &&
    !(chainId === 31337 && env.PORTALS_ALLOW_LOCAL_CHAIN === "true")
  )
    throw new Error("Unsupported portal chain.");
  const grading = env.PORTALS_GRADING_ADDRESS;
  if (!grading || !isAddress(grading) || !env.PORTALS_RPC_URL)
    throw new Error("Portal grading address and RPC URL are required.");
  const urls = await verifyPortalRpcChains(portalRpcUrls(env), chainId);
  const client = createPublicClient({ transport: portalRpcTransport(urls) });
  if ((await client.getChainId()) !== chainId)
    throw new Error("Portal RPC chain mismatch.");
  const [registry, cards, usdc] = await Promise.all([
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "registry"
    }),
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "cards"
    }),
    client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "usdc"
    })
  ]);
  const collection = await client.readContract({
    address: registry,
    abi: portalRegistryAbi,
    functionName: "collection"
  });
  const version = await client.readContract({
    address: grading,
    abi: portalGradingAbi,
    functionName: "portalEconomicsVersion"
  });
  if (version !== 2n)
    throw new Error("Portal burn-and-claim contract version mismatch.");
  return new PortalChain(
    client,
    {
      chainId,
      collection,
      registry,
      grading,
      cards,
      usdc
    },
    env.PORTALS_MODEL_POLICIES_JSON
      ? z
          .array(portalModelPolicySchema)
          .min(1)
          .parse(JSON.parse(env.PORTALS_MODEL_POLICIES_JSON))
      : [
          portalModels,
          rainbowPortalModelsV3,
          rainbowPortalModelsV2,
          legacyPortalModels
        ]
  );
}
