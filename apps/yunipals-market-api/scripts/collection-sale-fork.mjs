import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  zeroAddress,
  zeroHash
} from "viem";
import {
  seaportDeployment,
  marketplaceChains
} from "@protopals/yunipals-market-core/registry";
import { openseaCurrencies } from "@protopals/yunipals-market-core/openseaRegistry";
import {
  seaportOrderHash,
  seaportSigningData,
  seaportReadAbi,
  seaportWriteAbi
} from "@protopals/yunipals-market-core/seaport";
import { parseActivityPage } from "@protopals/yunipals-market-core/activity";

// Called only by the guarded actual-Anvil harness. No provider publication or
// application admission: these signed orders exist exclusively on that fork.
export async function verifyCollectionSaleReplay({
  chain,
  client,
  pool,
  rpcUrl,
  tx,
  seller,
  buyer,
  tokenId,
  base,
  pass,
  report
}) {
  const rpc = (method, params = []) => client.request({ method, params });
  assert.match(await rpc("web3_clientVersion"), /anvil/i);
  const config = marketplaceChains[chain];
  assert.equal(
    (await rpc("anvil_metadata")).forkedNetwork?.chainId,
    config.chainId
  );
  const currency = openseaCurrencies[chain];
  const scope = {
    kind: "wallet",
    wallet: seller.address,
    chain,
    view: "sales"
  };
  const snapshots = [];
  const rows = async () =>
    (
      await pool.query(
        "SELECT * FROM yunipals_market.sale WHERE chain_id=$1 AND canonical ORDER BY block_number",
        [config.chainId]
      )
    ).rows;
  for (const table of [
    "sale",
    "sale_receipt",
    "sale_exclusion",
    "sale_replay_config",
    "activity_block"
  ])
    assert.equal(
      (
        await pool.query(
          `SELECT count(*) FROM yunipals_market.${table} WHERE chain_id=$1`,
          [config.chainId]
        )
      ).rows[0].count,
      "0"
    );
  const prior = (
    await pool.query(
      "SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE chain_id=$1 AND name='seaport-sales'",
      [config.chainId]
    )
  ).rows.map((r) => r.value);
  const initial = await rpc("evm_snapshot");
  let worker;
  let output = "";
  let closed;
  const stop = async () => {
    if (!worker) return;
    if (worker.exitCode === null && worker.signalCode === null)
      worker.kill("SIGTERM");
    const timer = setTimeout(() => worker.kill("SIGKILL"), 35000);
    try {
      const [code, signal] = await closed;
      assert.equal(code, 0, output);
      assert.equal(signal, null, output);
    } finally {
      clearTimeout(timer);
      worker = undefined;
    }
  };
  const start = () => {
    output = "";
    worker = spawn(process.execPath, ["dist/sale-worker.mjs"], {
      env: {
        PATH: process.env.PATH,
        MARKET_DEPLOYMENT: "staging",
        MARKET_DATABASE_URL: process.env.MARKET_TEST_RUNTIME_DATABASE_URL,
        MARKET_ALLOWED_ORIGINS: "http://127.0.0.1:5177",
        MARKET_HOST: "127.0.0.1",
        MARKET_PORT: "19613",
        MARKET_SALE_CHAIN: chain,
        MARKET_SALE_MODE: "fork",
        MARKET_SALE_RPC: rpcUrl,
        MARKET_SALE_POLICY: `fork-${chain}-depth-20-v1`,
        MARKET_SALE_MAX_SECONDS: "300"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    closed = once(worker, "close");
    for (const stream of [worker.stdout, worker.stderr])
      stream.on("data", (c) => {
        output = (output + c).slice(-32000);
      });
  };
  const until = async (check) => {
    const end = Date.now() + 30000;
    while (!(await check())) {
      if (worker?.exitCode !== null || Date.now() > end)
        throw new Error(`Sale worker did not reach expected state: ${output}`);
      await delay(200);
    }
  };
  const read = async () => {
    const response = await fetch(
      `${base}/v1/market/wallets/${seller.address}/activity?chain=${chain}&view=sales`,
      { signal: AbortSignal.timeout(15000) }
    );
    const body = await response.json();
    if (response.status !== 200)
      report.collectionSaleReadFailure = {
        body,
        observedAt: new Date().toISOString(),
        sales: (await rows()).map((row) => ({
          blockNumber: row.block_number,
          timestamp: row.block_timestamp,
          observationTimestamp: row.observation.blockTimestamp
        })),
        checkpoint: (
          await pool.query(
            "SELECT block_number::text,block_hash,state,last_error_code,checked_at FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name='seaport-sales'",
            [config.chainId]
          )
        ).rows
      };
    assert.equal(response.status, 200, JSON.stringify(body));
    const page = parseActivityPage(body, scope);
    snapshots.push(page.snapshot.id);
    return page;
  };
  try {
    await pool.query(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.sale_exclusion TO market_test_runtime"
    );
    await tx(
      seller.address,
      config.contractAddress,
      encodeFunctionData({
        abi: erc721Abi,
        functionName: "setApprovalForAll",
        args: [seaportDeployment.address, true]
      })
    );
    await tx(
      buyer.address,
      currency.address,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [seaportDeployment.address, 10n ** 16n]
      })
    );
    const beginning = await client.getBlock({ blockTag: "latest" });
    await pool.query(
      "INSERT INTO yunipals_market.sale_replay_config(chain_id,start_block,confirmations,policy) VALUES($1,$2,20,$3)",
      [config.chainId, beginning.number.toString(), `fork-${chain}-depth-20-v1`]
    );
    await rpc("anvil_mine", ["0x14", "0x0"]);
    start();
    await until(
      async () =>
        (
          await pool.query(
            "SELECT state FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name='seaport-sales'",
            [config.chainId]
          )
        ).rows[0].state === "available"
    );
    const settlements = [];
    for (const [index, [side, wrapped]] of [
      ["listing", false],
      ["listing", true],
      ["offer", true]
    ].entries()) {
      const branch = await rpc("evm_snapshot");
      const head = await client.getBlock({ blockTag: "latest" });
      const maker = side === "listing" ? seller : buyer;
      const amount = 10n ** 14n;
      const nft = {
        itemType: 2,
        token: config.contractAddress,
        identifierOrCriteria: BigInt(tokenId),
        startAmount: 1n,
        endAmount: 1n
      };
      const money = {
        itemType: wrapped ? 1 : 0,
        token: wrapped ? currency.address : zeroAddress,
        identifierOrCriteria: 0n,
        startAmount: amount,
        endAmount: amount
      };
      const order = {
        offerer: maker.address,
        zone: zeroAddress,
        zoneHash: zeroHash,
        orderType: 0,
        offer: [side === "listing" ? nft : money],
        consideration: [
          {
            ...(side === "listing" ? money : nft),
            recipient: side === "listing" ? seller.address : buyer.address
          }
        ],
        startTime: head.timestamp - 1n,
        endTime: head.timestamp + 3600n,
        salt: BigInt(Date.now()) + BigInt(index),
        conduitKey: zeroHash,
        counter: await client.readContract({
          address: seaportDeployment.address,
          abi: seaportReadAbi,
          functionName: "getCounter",
          args: [maker.address]
        })
      };
      const hash = seaportOrderHash(order);
      const signature = await maker.signTypedData(
        seaportSigningData(
          {
            name: "Seaport",
            version: "1.6",
            chainId: config.chainId,
            verifyingContract: seaportDeployment.address
          },
          order
        )
      );
      const receipt = await tx(
        side === "listing" ? buyer.address : seller.address,
        seaportDeployment.address,
        encodeFunctionData({
          abi: seaportWriteAbi,
          functionName: "fulfillOrder",
          args: [
            {
              parameters: {
                ...order,
                totalOriginalConsiderationItems: BigInt(
                  order.consideration.length
                )
              },
              signature
            },
            zeroHash
          ]
        }),
        wrapped ? 0n : amount
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM yunipals_market.orders WHERE chain_id=$1 AND order_hash=$2",
            [config.chainId, hash.toLowerCase()]
          )
        ).rows[0].count,
        "0"
      );
      assert.equal(
        (await rows()).length,
        0,
        "Unconfirmed settlement must remain absent"
      );
      await rpc("anvil_mine", ["0x14", "0x0"]);
      await until(async () => (await rows()).length === 1);
      await until(
        async () =>
          (
            await pool.query(
              "SELECT state FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name='seaport-sales'",
              [config.chainId]
            )
          ).rows[0].state === "available"
      );
      // First-page snapshots are deliberately reusable for five seconds. Poll
      // until this settlement is in a new dated view, without mutating API data.
      let page;
      await until(async () => {
        page = await read();
        return (
          page.total === 1 &&
          page.items[0]?.sale.orderHash.toLowerCase() === hash.toLowerCase()
        );
      });
      assert.equal(page.total, 1, JSON.stringify(page));
      assert.equal(
        page.items[0].sale.orderHash.toLowerCase(),
        hash.toLowerCase()
      );
      assert.equal(page.items[0].sale.transactionHash, receipt.transactionHash);
      assert.equal(page.items[0].sale.grossAmount, amount.toString());
      assert.equal(page.chains[chain].coverage.source, "seaport");
      assert.equal(
        page.chains[chain].coverage.fromBlock,
        beginning.number.toString()
      );
      await stop();
      start();
      await until(async () => output.includes('"result":"idle"'));
      assert.equal((await rows()).length, 1);
      assert.equal(await rpc("evm_revert", [branch]), true);
      await rpc("anvil_mine", ["0x15", "0x0"]);
      await until(
        async () =>
          (await rows()).length === 0 && output.includes('"result":"rewound"')
      );
      await until(
        async () =>
          (
            await pool.query(
              "SELECT state FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name='seaport-sales'",
              [config.chainId]
            )
          ).rows[0].state === "available"
      );
      assert.ok(
        (
          await pool.query(
            "SELECT invalidated_at FROM yunipals_market.snapshot WHERE id=$1",
            [page.snapshot.id]
          )
        ).rows[0].invalidated_at
      );
      assert.equal((await read()).total, 0);
      settlements.push({
        side,
        currency: page.items[0].sale.currency.symbol,
        orderHash: hash,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString()
      });
      pass(
        `Built sale worker and API replay actual ${wrapped ? "WETH" : "native"} ${side}, resume and retract its fork reorg without admission`
      );
    }
    await stop();
    report.collectionSaleReplay = {
      historyStart: beginning.number.toString(),
      policy: `fork-${chain}-depth-20-v1`,
      settlements,
      retainedOrphanReceipts: (
        await pool.query(
          "SELECT count(*) FROM yunipals_market.sale_receipt WHERE chain_id=$1",
          [config.chainId]
        )
      ).rows[0].count,
      finalWorkerOutput: output
    };
  } finally {
    await stop();
    for (const id of snapshots)
      await pool.query("DELETE FROM yunipals_market.snapshot WHERE id=$1", [
        id
      ]);
    for (const table of [
      "sale_exclusion",
      "sale",
      "sale_receipt",
      "activity_block",
      "sale_replay_config"
    ])
      await pool.query(
        `DELETE FROM yunipals_market.${table} WHERE chain_id=$1`,
        [config.chainId]
      );
    await pool.query(
      "DELETE FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name='seaport-sales'",
      [config.chainId]
    );
    await pool.query(
      "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_recordset(NULL::yunipals_market.checkpoint,$1::jsonb)",
      [JSON.stringify(prior)]
    );
    assert.equal(await rpc("evm_revert", [initial]), true);
  }
}
