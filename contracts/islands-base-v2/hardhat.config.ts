import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config({
  path:
    process.env.AIRDROP_CREDENTIAL_ENV_FILE ??
    "/root/islands-airdrop/.env.local",
  quiet: true
});

const config: HardhatUserConfig = {
  networks: { base: { url: "https://mainnet.base.org", chainId: 8453 } },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun"
    }
  }
};

export default config;
