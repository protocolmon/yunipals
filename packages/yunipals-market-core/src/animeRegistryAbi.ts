// Generated from AnimeFighterRegistry.sol.
export const animeRegistryAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address"
      },
      {
        name: "initialCurator",
        type: "address",
        internalType: "address"
      },
      {
        name: "uri",
        type: "string",
        internalType: "string"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "BASE_YUNIPALS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "acceptOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "applicationsOpen",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "applyForArena",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      {
        name: "ids",
        type: "uint256[]",
        internalType: "uint256[]"
      },
      {
        name: "hashes",
        type: "bytes32[]",
        internalType: "bytes32[]"
      },
      {
        name: "recipeVersion",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "baseURI",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "curator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fighters",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "status",
        type: "uint8",
        internalType: "enum AnimeFighterRegistry.Status"
      },
      {
        name: "recipeVersion",
        type: "uint16",
        internalType: "uint16"
      },
      {
        name: "applications",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "manifestHash",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "isEligible",
    inputs: [
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "collection",
        type: "address",
        internalType: "address"
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "manifestURI",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pendingOwner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "reject",
    inputs: [
      {
        name: "ids",
        type: "uint256[]",
        internalType: "uint256[]"
      },
      {
        name: "codes",
        type: "uint8[]",
        internalType: "uint8[]"
      },
      {
        name: "notes",
        type: "string[]",
        internalType: "string[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "revoke",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "code",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "note",
        type: "string",
        internalType: "string"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setApplicationsOpen",
    inputs: [
      {
        name: "open",
        type: "bool",
        internalType: "bool"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setBaseURI",
    inputs: [
      {
        name: "uri",
        type: "string",
        internalType: "string"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setCurator",
    inputs: [
      {
        name: "next",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [
      {
        name: "newOwner",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    name: "ApplicationsOpenChanged",
    inputs: [
      {
        name: "open",
        type: "bool",
        indexed: false,
        internalType: "bool"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Applied",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "application",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Approved",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "manifestHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "recipeVersion",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "BaseURIChanged",
    inputs: [
      {
        name: "baseURI",
        type: "string",
        indexed: false,
        internalType: "string"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "CuratorChanged",
    inputs: [
      {
        name: "previous",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "next",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Rejected",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "reasonCode",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "note",
        type: "string",
        indexed: false,
        internalType: "string"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Revoked",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "reasonCode",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "note",
        type: "string",
        indexed: false,
        internalType: "string"
      }
    ],
    anonymous: false
  },
  {
    type: "error",
    name: "InvalidBatch",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidConfig",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidReason",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidState",
    inputs: []
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: []
  }
] as const;
