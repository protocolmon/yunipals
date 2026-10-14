import { readFileSync } from "node:fs";
import hre from "hardhat";
const deployment = JSON.parse(
  readFileSync("deployments/replacement-v2/deployment.json", "utf8")
);
hre
  .run("verify:verify", {
    address: deployment.contract,
    constructorArguments: deployment.constructorArguments,
    contract:
      "contracts/GrasslandArchipelagoBaseV2.sol:GrasslandArchipelagoBaseV2"
  })
  .catch(() => {
    console.error(
      "Source verification failed; inspect explorer verification status before resubmitting."
    );
    process.exitCode = 1;
  });
