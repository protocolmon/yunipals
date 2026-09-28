const {
  rarityFor
} = require("@polkamon/web3-util-pmons/src/lib/rarity/rarity.js");
const {
  AttributeTransformingUtils
} = require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/AttributeTransforming.js");
const {
  isRainbowByAttrs
} = require("@polkamon/web3-util-pmons/src/lib/type/rainbowType.js");

module.exports = { AttributeTransformingUtils, isRainbowByAttrs, rarityFor };
