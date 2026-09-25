import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getAddress } from "viem";
import { useAccount, useWalletClient } from "wagmi";

import { chainDetails } from "@/data/chains";
import {
  fetchTokenVisibilitySigningData,
  indexedCollectionCacheVersion,
  IndexerError,
  type OwnerTokenPage,
  tokenKey,
  type TokenVisibilityMessage,
  updateTokenVisibility,
  type YunipalToken
} from "@/lib/yunipalsIndexer";

export type VisibilityStage =
  | "idle"
  | "requesting"
  | "switching"
  | "signing"
  | "submitting";

type VisibilityVariables = {
  token: YunipalToken;
  hidden: boolean;
};

function sameAddress(left: string | undefined, right: string | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function visibilityPayloadError(
  token: YunipalToken,
  hidden: boolean,
  connectedAddress: string,
  message: TokenVisibilityMessage,
  chainId: number,
  verifyingContract: string,
  primaryType: string,
  hasVisibilityType: boolean
) {
  const chain = chainDetails[token.chain];

  if (!sameAddress(message.owner, connectedAddress)) {
    return "Connected wallet does not own this NFT.";
  }
  if (message.tokenId !== token.tokenId) {
    return "The visibility request returned the wrong token ID.";
  }
  if (message.hidden !== hidden) {
    return "The visibility request returned the wrong action.";
  }
  if (chainId !== chain.chainId) {
    return "The visibility request returned the wrong network.";
  }
  if (!sameAddress(verifyingContract, chain.contractAddress)) {
    return "The visibility request returned the wrong collection contract.";
  }
  if (!sameAddress(token.contractAddress, chain.contractAddress)) {
    return "This NFT does not match the configured collection contract.";
  }
  try {
    if (BigInt(message.lifecycle) !== BigInt(token.lifecycle)) {
      return "The NFT lifecycle changed. Refresh your collection and try again.";
    }
    if (BigInt(message.deadline) <= BigInt(Math.floor(Date.now() / 1000))) {
      return "The signing request expired. Try again for a fresh request.";
    }
  } catch {
    return "The visibility request contained invalid numeric values.";
  }
  if (primaryType !== "SetTokenVisibility" || !hasVisibilityType) {
    return "The visibility request returned an unsupported signature type.";
  }

  return null;
}

export function visibilityErrorMessage(error: unknown) {
  if (error instanceof IndexerError) {
    switch (error.code) {
      case "nonce_conflict":
        return "Your collection changed. Try again to create a fresh signing request.";
      case "ownership_changed":
        return "Ownership changed while signing. Your collection has been refreshed.";
      case "signature_expired":
        return "The signature expired. Try again to create a fresh signing request.";
      case "erc1271_not_supported":
      case "smart_wallet_not_supported":
        return "Smart contract wallets are not supported for hiding NFTs yet.";
      default:
        return error.message || "NFT visibility could not be updated.";
    }
  }

  if (error instanceof Error) {
    if (/user rejected|user denied|rejected the request/i.test(error.message)) {
      return "Signature cancelled.";
    }
    return error.message;
  }

  return "NFT visibility could not be updated.";
}

export function useTokenVisibility(ownerInput: string) {
  const { address: connectedAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<VisibilityStage>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  const ownerTokenQueryPrefix = [
    "collector",
    indexedCollectionCacheVersion,
    ownerInput,
    "tokens"
  ] as const;

  async function invalidateTokenQueries(
    token: YunipalToken,
    refreshProfile = false
  ) {
    const queries = [
      queryClient.invalidateQueries({
        queryKey: ownerTokenQueryPrefix,
        refetchType: "none"
      }),
      queryClient.invalidateQueries({
        queryKey: ["collection", indexedCollectionCacheVersion, "tokens"]
      }),
      queryClient.invalidateQueries({
        queryKey: ["collection", "token", token.chain, token.tokenId]
      })
    ];

    if (token.chain === "ethereum") {
      queries.push(
        queryClient.invalidateQueries({
          queryKey: ["ethereum-collection", "preview-tokens"]
        })
      );
    }

    if (refreshProfile) {
      queries.push(
        queryClient.invalidateQueries({
          queryKey: ["collector", indexedCollectionCacheVersion, ownerInput]
        })
      );
    }

    await Promise.all(queries);
  }

  const mutation = useMutation({
    mutationFn: async ({ token, hidden }: VisibilityVariables) => {
      setNotice(null);

      if (!connectedAddress || !walletClient) {
        throw new Error("Connect the wallet that owns this NFT first.");
      }

      setStage("requesting");
      const { typedData } = await fetchTokenVisibilitySigningData(
        token.chain,
        token.tokenId,
        hidden
      );
      const payloadError = visibilityPayloadError(
        token,
        hidden,
        connectedAddress,
        typedData.message,
        typedData.domain.chainId,
        typedData.domain.verifyingContract,
        typedData.primaryType,
        Array.isArray(typedData.types.SetTokenVisibility)
      );

      if (payloadError) throw new Error(payloadError);

      setStage("switching");
      await walletClient.switchChain({ id: typedData.domain.chainId });

      const [walletAddress] = await walletClient.getAddresses();
      if (!sameAddress(walletAddress, typedData.message.owner)) {
        throw new Error("The connected wallet changed. Start again.");
      }

      setStage("signing");
      const signature = await walletClient.signTypedData({
        account: getAddress(walletAddress),
        domain: {
          ...typedData.domain,
          verifyingContract: getAddress(typedData.domain.verifyingContract)
        },
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: {
          ...typedData.message,
          owner: getAddress(typedData.message.owner),
          tokenId: BigInt(typedData.message.tokenId),
          lifecycle: BigInt(typedData.message.lifecycle),
          ownershipLogIndex: BigInt(typedData.message.ownershipLogIndex),
          nonce: BigInt(typedData.message.nonce),
          deadline: BigInt(typedData.message.deadline)
        }
      });

      const [currentWalletAddress] = await walletClient.getAddresses();
      if (!sameAddress(currentWalletAddress, typedData.message.owner)) {
        throw new Error("The connected wallet changed. Start again.");
      }

      setStage("submitting");
      await updateTokenVisibility(
        token.chain,
        token.tokenId,
        typedData.message,
        signature
      );
    },
    onSuccess: async (_, { token, hidden }) => {
      queryClient.setQueriesData<OwnerTokenPage>(
        { queryKey: ownerTokenQueryPrefix },
        (data) =>
          data
            ? {
                ...data,
                items: data.items.filter(
                  (candidate) => tokenKey(candidate) !== tokenKey(token)
                )
              }
            : data
      );
      setNotice(
        hidden ? "NFT hidden successfully." : "NFT unhidden successfully."
      );
      await invalidateTokenQueries(token);
    },
    onError: async (error, { token }) => {
      setNotice(visibilityErrorMessage(error));
      if (error instanceof IndexerError && error.code === "ownership_changed") {
        await invalidateTokenQueries(token, true);
      }
    },
    onSettled: () => setStage("idle")
  });

  return {
    updateVisibility: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    pendingTokenKey: mutation.variables
      ? tokenKey(mutation.variables.token)
      : null,
    stage,
    notice,
    errorMessage: mutation.error
      ? visibilityErrorMessage(mutation.error)
      : null,
    clearFeedback() {
      mutation.reset();
      setNotice(null);
    }
  };
}
