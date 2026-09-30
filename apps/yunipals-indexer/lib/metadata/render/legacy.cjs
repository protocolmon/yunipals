// Initialize the pinned package in the same order as the existing rarity
// adapter: its attribute modules contain CommonJS circular dependencies.
const { rarityFor } = require("@polkamon/web3-util-pmons/src/lib/rarity/rarity.js");
const { AttributeTransformingUtils } = require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/AttributeTransforming.js");
const { PublicAttributeTransformingUtils } = require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/PublicAttributeTransforming.js");
const { getLegacyChain } = require("@polkamon/web3-util-pmons/src/lib/legacy/chain.js");
const { isRainbowByAttrs } = require("@polkamon/web3-util-pmons/src/lib/type/rainbowType.js");
const { NFBOrigins } = require("@polkamon/web3-util-core/src/lib/ids/nfb.js");
module.exports = { AttributeTransformingUtils, PublicAttributeTransformingUtils, getLegacyChain, isRainbowByAttrs, rarityFor, NFBOrigins };
