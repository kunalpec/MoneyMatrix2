import { Transaction } from "../model/transaction.model.js";
import { tatumClient } from "../controller/tatum/client.controller.js";
import { trxToSun } from "../util/trxAmount.util.js";
import { logger } from "../util/logger.util.js";
import { processConfirmedDeposit } from "./payment/deposit.service.js";

let depositPollTimer = null;

const getPollIntervalMs = () =>
  Number(process.env.DEPOSIT_POLL_INTERVAL_MS || 120000);

const getPendingDeposits = () =>
  Transaction.find({
    type: "DEPOSIT",
    processed: false,
    status: { $in: ["PENDING", "PROCESSING"] },
    toAddress: { $exists: true, $type: "string" },
  })
    .sort({ createdAt: 1 })
    .limit(Number(process.env.DEPOSIT_POLL_BATCH_SIZE || 25));

const normalizeTransactionItems = (responseData) => {
  if (Array.isArray(responseData)) {
    return responseData;
  }

  if (Array.isArray(responseData?.data)) {
    return responseData.data;
  }

  if (Array.isArray(responseData?.transactions)) {
    return responseData.transactions;
  }

  return [];
};

const resolveItemTxHash = (item = {}) =>
  item.txId || item.hash || item.transactionHash || item.txID || null;

const resolveItemToAddress = (item = {}) =>
  item.to ||
  item.toAddress ||
  item.receiver ||
  item.transferTo ||
  item.recipient ||
  item.address ||
  null;

const resolveItemAmountSun = (item = {}) => {
  const rawAmount =
    item.amount ??
    item.value ??
    item.amountTrx ??
    item.cryptoAmount ??
    null;

  if (rawAmount === null || rawAmount === undefined) {
    return null;
  }

  try {
    return trxToSun(rawAmount, "Polled deposit amount");
  } catch {
    return null;
  }
};

const findMatchingChainTransaction = (pendingDeposit, chainItems = []) =>
  chainItems.find((item) => {
    const itemTxHash = resolveItemTxHash(item);
    const itemToAddress = resolveItemToAddress(item);
    const itemAmountSun = resolveItemAmountSun(item);

    if (
      pendingDeposit.txId &&
      itemTxHash &&
      pendingDeposit.txId === itemTxHash
    ) {
      return true;
    }

    if (
      pendingDeposit.toAddress &&
      itemToAddress &&
      pendingDeposit.toAddress === itemToAddress
    ) {
      if (!pendingDeposit.amountSun || pendingDeposit.amountSun === 0) {
        return Boolean(itemAmountSun && itemTxHash);
      }

      return pendingDeposit.amountSun === itemAmountSun;
    }

    return false;
  });

const pollOnce = async () => {
  const pendingDeposits = await getPendingDeposits();

  for (const deposit of pendingDeposits) {
    try {
      const response = await tatumClient.get(
        `/tron/transaction/account/${deposit.toAddress}`
      );
      const chainItems = normalizeTransactionItems(response.data);
      const matchingTransaction = findMatchingChainTransaction(
        deposit,
        chainItems
      );

      if (!matchingTransaction) {
        continue;
      }

      const txHash = resolveItemTxHash(matchingTransaction);
      const amountSun =
        resolveItemAmountSun(matchingTransaction) || deposit.amountSun;

      if (!txHash || !amountSun) {
        continue;
      }

      const result = await processConfirmedDeposit({
        provider: "TATUM",
        txHash,
        address: deposit.toAddress,
        amountSun,
        providerExternalId: deposit.externalId || null,
        currency: "TRX",
        payload: {
          poller: true,
          chainTransaction: matchingTransaction,
        },
        source: "POLLING",
      });

      logger.info("deposit.poller.match", {
        transactionId: deposit._id.toString(),
        txHash,
        responseMessage: result.responseMessage,
      });
    } catch (error) {
      logger.error("deposit.poller.error", {
        transactionId: deposit._id.toString(),
        address: deposit.toAddress,
        error: error?.message,
      });
    }
  }
};

export const startDepositMonitor = () => {
  if (depositPollTimer) {
    return;
  }

  const intervalMs = getPollIntervalMs();

  if (!intervalMs || intervalMs <= 0) {
    logger.warn("deposit.poller.disabled");
    return;
  }

  depositPollTimer = setInterval(() => {
    pollOnce().catch((error) => {
      logger.error("deposit.poller.loop_failed", {
        error: error?.message,
      });
    });
  }, intervalMs);

  logger.info("deposit.poller.started", { intervalMs });
};
