const bre = require("@nomiclabs/buidler");

const {
    isMainnet,
    isRinkeby,
    getAssetAddresses,
} = require("../test/helpers.js");
const { getTxOpts } = require("../utils/tx");
const { proposeArgs } = require('../utils/governor')


const isGanacheFork = bre.network.name === "fork";


let totalDeployGasUsed = 0;

// Wait for 3 blocks confirmation on Mainnet/Rinkeby.
const NUM_CONFIRMATIONS = isMainnet || isRinkeby ? 3 : 0;

function log(msg, deployResult = null) {
  if (isMainnet || isRinkeby || process.env.VERBOSE) {
    if (deployResult && deployResult.receipt) {
      const gasUsed = Number(deployResult.receipt.gasUsed.toString());
      totalDeployGasUsed += gasUsed;
      msg += ` Address: ${deployResult.address} Gas Used: ${gasUsed}`;
    }
    console.log("INFO:", msg);
  }
}

// sleep for execute
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const forkDebugDeploy = async ({ getNamedAccounts, deployments }) => {
  let transaction;
  log("Running deployment 015...");

  const { deploy } = deployments;
  const { deployerAddr } = await getNamedAccounts();

  // On mainnet, the governor is the Timelock contract.
  const cMinuteTimelock = await ethers.getContract("MinuteTimelock");

  const governorAddr = cMinuteTimelock.address;

  // those 2 accounts should be unlocked
  const sGovernor = ethers.provider.getSigner(governorAddr);
  const sDeployer = ethers.provider.getSigner(deployerAddr);

  //
  // Deploy a new Curve USDT Strategy
  //
  const dCurveUSDTStrategy = await deploy("CurveUSDTStrategy", {
    from: deployerAddr,
    contract: "ThreePoolStrategy",
    ...(await getTxOpts()),
  });
  await ethers.provider.waitForTransaction(
    dCurveUSDTStrategy.receipt.transactionHash,
    NUM_CONFIRMATIONS
  );
  log("Deployed CurveUSDTStrategy", dCurveUSDTStrategy);

  // Upgrade USDT Strategy by issuing and executing a governance proposal.
  const curveUSDTStrategyProxy = await ethers.getContract(
    "CurveUSDTStrategyProxy"
  );
  const governorContract = await ethers.getContract("Governor");

  console.log("Submitting proposal for USDT Strategy upgrade...");
  const upgradeArgs = await proposeArgs([
    {
      contract: curveUSDTStrategyProxy,
      signature: "upgradeTo(address)",
      args: [dCurveUSDTStrategy.address],
    },
  ]);
  const description = "USDT strategy upgrade";
  transaction = await governorContract
    .connect(sDeployer)
    .propose(...upgradeArgs, description, await getTxOpts());
  await ethers.provider.waitForTransaction(
    transaction.hash,
    NUM_CONFIRMATIONS
  );
  const proposalId = await governorContract.proposalCount();
  console.log(`Submitted proposal ${proposalId}`);

  console.log("Queueing proposal...");
  await governorContract
    .connect(sGovernor)
    .queue(proposalId, await getTxOpts());
  console.log("Waiting for TimeLock. Sleeping for 61 seconds...");
  await sleep(61000);

  transaction = await governorContract
    .connect(sDeployer)
    .execute(proposalId, await getTxOpts());
  await ethers.provider.waitForTransaction(
    transaction.hash,
    NUM_CONFIRMATIONS
  );
  console.log(
    "Proposal executed. VaultCore now points to",
    dCurveUSDTStrategy.address
  );


  return true;
};

forkDebugDeploy.dependencies = ["core"];
forkDebugDeploy.skip = () => !isGanacheFork;

module.exports = forkDebugDeploy;
