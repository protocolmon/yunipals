// Historical source ABIs copied in full from e8145098221ca70fb33ce844916a31a878fee65a
// packages/yunipals-market-core/src/boosterAbi.ts. Keep array order and every ABI field intact.
// These identify immutable indexed sources; frontend calls continue to use boosterAbi.ts.

export const boosterPacksAbiE8145098 = [
  {
    type: "function",
    name: "CALLBACK_RESERVE",
    inputs: [],
    outputs: [{ name: "", type: "uint32", internalType: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "CONFIG_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PAUSER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADE_INTERFACE_VERSION",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "checkpointBlockHeaders",
    inputs: [
      { name: "childBlock", type: "uint256", internalType: "uint256" },
      { name: "headers", type: "bytes[]", internalType: "bytes[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "checkpointRequestBlock",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "hash", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "checkpointedBlockhash",
    inputs: [{ name: "number", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "originalId", type: "uint256", internalType: "uint256" },
      { name: "quantity", type: "uint32", internalType: "uint32" },
      { name: "maxVrfPrice", type: "uint256", internalType: "uint256" },
      { name: "deadline", type: "uint256", internalType: "uint256" }
    ],
    outputs: [{ name: "requestId", type: "uint256", internalType: "uint256" }],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "claimable",
    inputs: [{ name: "originalId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "uint32", internalType: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "execute",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getOriginal",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BoosterPacks.Original",
        components: [
          { name: "packTypeId", type: "uint256", internalType: "uint256" },
          { name: "pendingRequest", type: "uint256", internalType: "uint256" },
          { name: "revealedAt", type: "uint64", internalType: "uint64" },
          { name: "remaining", type: "uint32", internalType: "uint32" },
          { name: "minted", type: "uint32", internalType: "uint32" },
          { name: "dailyCommitted", type: "uint32", internalType: "uint32" },
          { name: "burned", type: "bool", internalType: "bool" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRequest",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BoosterPacks.Request",
        components: [
          { name: "originalId", type: "uint256", internalType: "uint256" },
          { name: "payer", type: "address", internalType: "address" },
          { name: "paid", type: "uint256", internalType: "uint256" },
          { name: "seed", type: "uint256", internalType: "uint256" },
          { name: "ruleHash", type: "bytes32", internalType: "bytes32" },
          { name: "receivedAt", type: "uint64", internalType: "uint64" },
          { name: "quantity", type: "uint32", internalType: "uint32" },
          { name: "executionGas", type: "uint32", internalType: "uint32" },
          {
            name: "status",
            type: "uint8",
            internalType: "enum BoosterPacks.Status"
          },
          { name: "opening", type: "bool", internalType: "bool" },
          { name: "received", type: "bool", internalType: "bool" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [{ name: "role", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "admin", type: "address", internalType: "address" },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PackRegistry"
      },
      {
        name: "monsters_",
        type: "address",
        internalType: "contract YunipalMonsters"
      },
      {
        name: "wrapper_",
        type: "address",
        internalType: "contract IVRFV2PlusWrapper"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "monsters",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract YunipalMonsters" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "onOriginalBurned",
    inputs: [{ name: "originalId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "openPack",
    inputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "maxVrfPrice", type: "uint256", internalType: "uint256" },
      { name: "deadline", type: "uint256", internalType: "uint256" }
    ],
    outputs: [
      { name: "requestId", type: "uint256", internalType: "uint256" },
      { name: "originalId", type: "uint256", internalType: "uint256" }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "originals",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "pendingRequest", type: "uint256", internalType: "uint256" },
      { name: "revealedAt", type: "uint64", internalType: "uint64" },
      { name: "remaining", type: "uint32", internalType: "uint32" },
      { name: "minted", type: "uint32", internalType: "uint32" },
      { name: "dailyCommitted", type: "uint32", internalType: "uint32" },
      { name: "burned", type: "bool", internalType: "bool" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pauseRequests",
    inputs: [{ name: "paused", type: "bool", internalType: "bool" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "proofContext",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BoosterProofRecovery.ProofContext",
        components: [
          { name: "coordinator", type: "address", internalType: "address" },
          { name: "requestBlock", type: "uint64", internalType: "uint64" },
          { name: "confirmations", type: "uint16", internalType: "uint16" },
          { name: "blockhashStore", type: "address", internalType: "address" },
          { name: "chainId", type: "uint256", internalType: "uint256" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "quote",
    inputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "quantity", type: "uint32", internalType: "uint32" },
      { name: "gasPrice", type: "uint256", internalType: "uint256" }
    ],
    outputs: [
      { name: "price", type: "uint256", internalType: "uint256" },
      { name: "callbackGas", type: "uint32", internalType: "uint32" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "rawFulfillRandomWords",
    inputs: [
      { name: "id", type: "uint256", internalType: "uint256" },
      { name: "words", type: "uint256[]", internalType: "uint256[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "recover",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "refundCredits",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract PackRegistry" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "callerConfirmation", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "requests",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "originalId", type: "uint256", internalType: "uint256" },
      { name: "payer", type: "address", internalType: "address" },
      { name: "paid", type: "uint256", internalType: "uint256" },
      { name: "seed", type: "uint256", internalType: "uint256" },
      { name: "ruleHash", type: "bytes32", internalType: "bytes32" },
      { name: "receivedAt", type: "uint64", internalType: "uint64" },
      { name: "quantity", type: "uint32", internalType: "uint32" },
      { name: "executionGas", type: "uint32", internalType: "uint32" },
      {
        name: "status",
        type: "uint8",
        internalType: "enum BoosterPacks.Status"
      },
      { name: "opening", type: "bool", internalType: "bool" },
      { name: "received", type: "bool", internalType: "bool" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "requestsPaused",
    inputs: [],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "restoreRandomness",
    inputs: [
      { name: "id", type: "uint256", internalType: "uint256" },
      {
        name: "proof",
        type: "tuple",
        internalType: "struct VRF.Proof",
        components: [
          { name: "pk", type: "uint256[2]", internalType: "uint256[2]" },
          { name: "gamma", type: "uint256[2]", internalType: "uint256[2]" },
          { name: "c", type: "uint256", internalType: "uint256" },
          { name: "s", type: "uint256", internalType: "uint256" },
          { name: "seed", type: "uint256", internalType: "uint256" },
          { name: "uWitness", type: "address", internalType: "address" },
          {
            name: "cGammaWitness",
            type: "uint256[2]",
            internalType: "uint256[2]"
          },
          {
            name: "sHashWitness",
            type: "uint256[2]",
            internalType: "uint256[2]"
          },
          { name: "zInv", type: "uint256", internalType: "uint256" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [{ name: "interfaceId", type: "bytes4", internalType: "bytes4" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "totalRefundLiability",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      { name: "newImplementation", type: "address", internalType: "address" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "withdrawRefund",
    inputs: [
      { name: "recipient", type: "address", internalType: "address payable" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "wrapper",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract IVRFV2PlusWrapper" }
    ],
    stateMutability: "view"
  },
  {
    type: "event",
    name: "BlockhashCheckpointed",
    inputs: [
      {
        name: "blockNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "blockHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Initialized",
    inputs: [
      {
        name: "version",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OriginalRevealed",
    inputs: [
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "revealedAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      },
      {
        name: "totalVariants",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "PaymentBurned",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "payer",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "token",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ProofContextRecorded",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "coordinator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "blockhashStore",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "requestBlock",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      },
      {
        name: "confirmations",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RandomnessReceived",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "seed",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "receivedAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RandomnessRestored",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "submitter",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RecoveryRequired",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RefundCredited",
    inputs: [
      {
        name: "requester",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RefundReturned",
    inputs: [
      {
        name: "requester",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RefundWithdrawn",
    inputs: [
      {
        name: "requester",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestCompleted",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "recipient",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "quantity",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "minted",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "remaining",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestCreated",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "payer",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "quantity",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      { name: "opening", type: "bool", indexed: false, internalType: "bool" },
      {
        name: "paid",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "ruleHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "callbackGas",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestForfeited",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestsPaused",
    inputs: [
      { name: "paused", type: "bool", indexed: false, internalType: "bool" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  { type: "error", name: "AccessControlBadConfirmation", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "neededRole", type: "bytes32", internalType: "bytes32" }
    ]
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC1967InvalidImplementation",
    inputs: [
      { name: "implementation", type: "address", internalType: "address" }
    ]
  },
  { type: "error", name: "ERC1967NonPayable", inputs: [] },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidInitialization", inputs: [] },
  { type: "error", name: "NotInitializing", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address", internalType: "address" }]
  },
  { type: "error", name: "UUPSUnauthorizedCallContext", inputs: [] },
  {
    type: "error",
    name: "UUPSUnsupportedProxiableUUID",
    inputs: [{ name: "slot", type: "bytes32", internalType: "bytes32" }]
  }
] as const;

export const yunipalMonstersAbiE8145098 = [
  {
    type: "function",
    name: "CONFIG_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PAUSER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADE_INTERFACE_VERSION",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "burn",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getApproved",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [{ name: "role", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "admin", type: "address", internalType: "address" },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PackRegistry"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "isApprovedForAll",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "operator", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "mintOffspring",
    inputs: [
      { name: "originalId", type: "uint256", internalType: "uint256" },
      { name: "recipient", type: "address", internalType: "address" },
      { name: "variantId", type: "uint32", internalType: "uint32" }
    ],
    outputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "mintOriginal",
    inputs: [
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "recipient", type: "address", internalType: "address" },
      { name: "variantId", type: "uint32", internalType: "uint32" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nextTokenId",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "provenance",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "originalTokenId", type: "uint256", internalType: "uint256" },
      { name: "variantId", type: "uint32", internalType: "uint32" },
      {
        name: "traits",
        type: "tuple",
        internalType: "struct PackRegistry.Traits",
        components: [
          { name: "monsterType", type: "uint32", internalType: "uint32" },
          { name: "color", type: "uint32", internalType: "uint32" },
          { name: "horn", type: "uint32", internalType: "uint32" },
          { name: "glitter", type: "uint32", internalType: "uint32" }
        ]
      },
      { name: "isOriginal", type: "bool", internalType: "bool" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract PackRegistry" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "callerConfirmation", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "reserveOriginal",
    inputs: [{ name: "packTypeId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "reservedType",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "safeTransferFrom",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "safeTransferFrom",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "approved", type: "bool", internalType: "bool" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [{ name: "interfaceId", type: "bytes4", internalType: "bytes4" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "tokenURI",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      { name: "newImplementation", type: "address", internalType: "address" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "approved",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ApprovalForAll",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "operator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      { name: "approved", type: "bool", indexed: false, internalType: "bool" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Initialized",
    inputs: [
      {
        name: "version",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "MonsterMinted",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalTokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "recipient",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "variantId",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "monsterType",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      { name: "color", type: "uint32", indexed: false, internalType: "uint32" },
      { name: "horn", type: "uint32", indexed: false, internalType: "uint32" },
      {
        name: "glitter",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      { name: "isOriginal", type: "bool", indexed: false, internalType: "bool" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OriginalBurned",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true, internalType: "address" },
      { name: "to", type: "address", indexed: true, internalType: "address" },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  { type: "error", name: "AccessControlBadConfirmation", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "neededRole", type: "bytes32", internalType: "bytes32" }
    ]
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC1967InvalidImplementation",
    inputs: [
      { name: "implementation", type: "address", internalType: "address" }
    ]
  },
  { type: "error", name: "ERC1967NonPayable", inputs: [] },
  {
    type: "error",
    name: "ERC721IncorrectOwner",
    inputs: [
      { name: "sender", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "owner", type: "address", internalType: "address" }
    ]
  },
  {
    type: "error",
    name: "ERC721InsufficientApproval",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ]
  },
  {
    type: "error",
    name: "ERC721InvalidApprover",
    inputs: [{ name: "approver", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidOperator",
    inputs: [{ name: "operator", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidOwner",
    inputs: [{ name: "owner", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidReceiver",
    inputs: [{ name: "receiver", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidSender",
    inputs: [{ name: "sender", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721NonexistentToken",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }]
  },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidInitialization", inputs: [] },
  { type: "error", name: "NotInitializing", inputs: [] },
  { type: "error", name: "UUPSUnauthorizedCallContext", inputs: [] },
  {
    type: "error",
    name: "UUPSUnsupportedProxiableUUID",
    inputs: [{ name: "slot", type: "bytes32", internalType: "bytes32" }]
  }
] as const;
