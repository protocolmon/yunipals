// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Dense live pools with immutable, transaction-ordered historical positions.
library PortalPool {
    struct Checkpoint {
        uint48 revision;
        uint208 value;
    }

    struct Pool {
        uint256[] tokens;
        mapping(uint256 => uint256) indexPlusOne;
        mapping(uint256 => Checkpoint[]) positions;
        Checkpoint[] counts;
    }

    function add(Pool storage self, uint256 tokenId, uint48 revision) internal {
        uint256 index = self.tokens.length;
        self.tokens.push(tokenId);
        self.indexPlusOne[tokenId] = index + 1;
        _write(self.positions[index], revision, tokenId);
        _write(self.counts, revision, index + 1);
    }

    function remove(Pool storage self, uint256 tokenId, uint48 revision) internal {
        uint256 index = self.indexPlusOne[tokenId] - 1;
        uint256 last = self.tokens.length - 1;
        if (index != last) {
            uint256 moved = self.tokens[last];
            self.tokens[index] = moved;
            self.indexPlusOne[moved] = index + 1;
            _write(self.positions[index], revision, moved);
        }
        _write(self.positions[last], revision, 0);
        self.tokens.pop();
        delete self.indexPlusOne[tokenId];
        _write(self.counts, revision, last);
    }

    function at(Pool storage self, uint48 revision, uint256 index) internal view returns (uint256) {
        require(index < _lookup(self.counts, revision), "snapshot index");
        return _lookup(self.positions[index], revision);
    }

    function _write(Checkpoint[] storage history, uint48 revision, uint256 value) private {
        require(value <= type(uint208).max, "pool value overflow");
        uint256 length = history.length;
        if (length != 0 && history[length - 1].revision == revision) {
            history[length - 1].value = uint208(value);
        } else {
            history.push(Checkpoint(revision, uint208(value)));
        }
    }

    function _lookup(Checkpoint[] storage history, uint48 revision) private view returns (uint256) {
        uint256 low;
        uint256 high = history.length;
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (history[mid].revision > revision) high = mid;
            else low = mid + 1;
        }
        return high == 0 ? 0 : history[high - 1].value;
    }
}
