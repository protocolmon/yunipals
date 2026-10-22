// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library VariantDraw {
    /// @dev Zero sentinel stores rank+1, so rank zero and VRF word zero are valid.
    function draw(mapping(uint32 => uint32) storage pool, uint32 remaining, bytes32 entropy)
        internal
        returns (uint32 result)
    {
        require(remaining != 0, "exhausted");
        uint256 bound = remaining;
        uint256 threshold = (type(uint256).max - bound + 1) % bound;
        uint256 random = uint256(entropy);
        uint256 counter;
        while (random < threshold) random = uint256(keccak256(abi.encode(entropy, ++counter)));
        uint32 index = uint32(random % bound);
        uint32 entry = pool[index];
        result = entry == 0 ? index : entry - 1;
        uint32 lastIndex = remaining - 1;
        if (index != lastIndex) {
            uint32 last = pool[lastIndex];
            pool[index] = last == 0 ? lastIndex + 1 : last;
        }
        delete pool[lastIndex];
    }
}
