import crypto from "crypto";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { tatumClient } from "../../controller/tatum/client.controller.js";
import { ApiError } from "../../util/ApiError.util.js";
import { logger } from "../../util/logger.util.js";
import {
  buildBalanceIncrementFromSun,
  buildLockedBalanceIncrementFromSun,
} from "../../util/trxAmount.util.js";
import {
  buildFinalSuccessMetadata,
  createTransactionMetadata,
} from "./transactionMetadata.service.js";
import { ensureWalletAccountingFields } from "./walletAccounting.service.js";
import { getRedisConnection } from "../../queue/redis.connection.js";

const MIN_TRON_CONFIRMATIONS = Number(process.env.MIN_TRON_CONFIRMATIONS || 1);
const WITHDRAWAL_RECONCILIATION_BATCH_SIZE = Number(
  process.env.WITHDRAWAL_RECONCILIATION_BATCH_SIZE || 20
);
const WITHDRAWAL_RECONCILIATION_LOCK_TTL_MS = Number(
  process.env.WITHDRAWAL_RECONCILIATION_LOCK_TTL_MS || 60000
);
const WITHDRAWAL_RECONCILIATION_LOCK_WAIT_MS = Number(
  process.env.WITHDRAWAL_RECONCILIATION_LOCK_WAIT_MS || 5000
);
const WITHDRAWAL_RECONCILIATION_LOCK_RETRY_MS = Number(
  process.env.WITHDRAWAL_RECONCILIATION_LOCK_RETRY_MS || 100
);
const WITHDRAWAL_RECONCILIATION_CLAIM_TIMEOUT_MS = Number(
  process.env.WITHDRAWAL_RECONCILIATION_CLAIM_TIMEOUT_MS || 600000
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getReservedWithdrawalAmountSun = (transaction) => {
  const requestedAmountSun = transaction?.metadata?.requestedAmountSun;

  if (Number.isSafeInteger(requestedAmountSun) && requestedAmountSun > 0) {
    return requestedAmountSun;
  }

  return transaction?.amountSun || 0;
};

const buildWithdrawalRollbackIncrementFromSun = (amountSun) => ({
  ...buildBalanceIncrementFromSun(amountSun),
  ...buildLockedBalanceIncrementFromSun(-amountSun),
});

const buildWithdrawalFinalizeIncrementFromSun = (amountSun) =>
  buildLockedBalanceIncrementFromSun(-amountSun);

const getWalletLockKey = (walletId) => `lock:wallet:withdraw:${walletId}`;

const acquireWalletRedisLock = async (walletId) => {
  const redis = getRedisConnection();
  const key = getWalletLockKey(walletId);
  const token = crypto.randomUUID();
  const deadline = Date.now() + WITHDRAWAL_RECONCILIATION_LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const result = await redis.set(
      key,
      token,
      "PX",
      WITHDRAWAL_RECONCILIATION_LOCK_TTL_MS,
      "NX"
    );

    if (result === "OK") {
      return { key, token };
    }

    await sleep(WITHDRAWAL_RECONCILIATION_LOCK_RETRY_MS);
  }

  throw new ApiError(423, "Wallet is busy during withdrawal reconciliation");
};

const refreshWalletRedisLock = async (lock) => {
  if (!lock?.key || !lock?.token) {
    return 0;
  }

  const redis = getRedisConnection();

  return redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      end
      return 0
    `,
    1,
    lock.key,
    lock.token,
    String(WITHDRAWAL_RECONCILIATION_LOCK_TTL_MS)
  );
};

const startWalletRedisLockRefresh = (lock) => {
  if (!lock?.key || !lock?.token) {
    return { stop: async () => {} };
  }

  const refreshIntervalMs = Math.max(
    1000,
    Math.floor(WITHDRAWAL_RECONCILIATION_LOCK_TTL_MS / 3)
  );

  let active = true;
  const timer = setInterval(async () => {
    if (!active) {
      return;
    }

    try {
      const refreshed = await refreshWalletRedisLock(lock);

      if (Number(refreshed) !== 1) {
        logger.error("withdrawal.reconciliation.lock_refresh_lost", {
          lockKey: lock.key,
        });
      }
    } catch (error) {
      logger.error("withdrawal.reconciliation.lock_refresh_failed", {
        lockKey: lock.key,
        error: error?.message || "Unknown reconciliation lock refresh error",
      });
    }
  }, refreshIntervalMs);

  return {
    stop: async () => {
      active = false;
      clearInterval(timer);
    },
  };
};

const releaseWalletRedisLock = async (lock, refresher = null) => {
  await refresher?.stop?.();

  if (!lock?.key || !lock?.token) {
    return;
  }

  const redis = getRedisConnection();

  await redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `,
    1,
    lock.key,
    lock.token
  );
};

const getPendingReconciliationCandidates = async () => {
  const staleBefore = new Date(
    Date.now() - WITHDRAWAL_RECONCILIATION_CLAIM_TIMEOUT_MS
  );

  return Transaction.find({
    type: "WITHDRAW",
    "metadata.reconciliationRequired": true,
    $or: [
      { "metadata.reconciliationInProgress": { $ne: true } },
      { "metadata.reconciliationClaimedAt": { $lte: staleBefore } },
    ],
  })
    .sort({ "metadata.reconciliationMarkedAt": 1, createdAt: 1 })
    .limit(WITHDRAWAL_RECONCILIATION_BATCH_SIZE)
    .select({ _id: 1 })
    .lean();
};

const claimWithdrawalForReconciliation = async (transactionId, workerId) => {
  const staleBefore = new Date(
    Date.now() - WITHDRAWAL_RECONCILIATION_CLAIM_TIMEOUT_MS
  );

  return Transaction.findOneAndUpdate(
    {
      _id: transactionId,
      type: "WITHDRAW",
      "metadata.reconciliationRequired": true,
      $or: [
        { "metadata.reconciliationInProgress": { $ne: true } },
        { "metadata.reconciliationClaimedAt": { $lte: staleBefore } },
      ],
    },
    {
      $set: {
        "metadata.reconciliationInProgress": true,
        "metadata.reconciliationWorkerId": workerId,
        "metadata.reconciliationClaimedAt": new Date(),
        "metadata.reconciliationLastCheckedAt": new Date(),
      },
    },
    { returnDocument: "after" }
  );
};

const resolveOnChainWithdrawalStatus = async (txId) => {
  if (!txId) {
    return {
      status: "PENDING",
      reason: "Missing txId for on-chain lookup",
      payload: null,
    };
  }

  try {
    // On-chain status is checked here via Tatum's Tron transaction endpoint.
    const response = await tatumClient.get(`/tron/transaction/${txId}`);
    const payload = response?.data || {};
    const confirmations = Number(
      payload?.confirmations ??
        payload?.receipt?.confirmations ??
        payload?.rawData?.confirmations ??
        0
    );
    const contractRet = String(
      payload?.contractRet ||
        payload?.ret?.[0]?.contractRet ||
        payload?.receipt?.result ||
        payload?.result ||
        ""
    )
      .trim()
      .toUpperCase();

    if (
      [
        "FAILED",
        "FAIL",
        "REVERT",
        "OUT_OF_ENERGY",
        "OUT_OF_TIME",
      ].includes(contractRet)
    ) {
      return {
        status: "FAILED",
        reason: `On-chain failure status: ${contractRet}`,
        payload,
      };
    }

    if (
      contractRet === "SUCCESS" ||
      confirmations >= MIN_TRON_CONFIRMATIONS ||
      payload?.blockNumber ||
      payload?.block
    ) {
      return {
        status: "SUCCESS",
        reason: "Transaction confirmed on chain",
        payload,
      };
    }

    return {
      status: "PENDING",
      reason: "Transaction not yet confirmed on chain",
      payload,
    };
  } catch (error) {
    const statusCode = Number(error?.response?.status || 0);

    if (statusCode === 404) {
      return {
        status: "PENDING",
        reason: "Transaction not yet indexed on chain",
        payload: null,
      };
    }

    throw error;
  }
};

const buildResolvedReconciliationMetadata = (outcome, extra = {}) => ({
  reconciliationRequired: false,
  reconciliationInProgress: false,
  reconciliationResolvedAt: new Date(),
  reconciliationOutcome: outcome,
  ...extra,
});

const markReconciliationPending = async ({ transactionId, workerId, reason }) =>
  Transaction.updateOne(
    {
      _id: transactionId,
      "metadata.reconciliationWorkerId": workerId,
    },
    {
      $set: {
        "metadata.reconciliationInProgress": false,
        "metadata.reconciliationLastCheckedAt": new Date(),
        "metadata.reconciliationLastRetryReason": reason,
      },
      $unset: {
        "metadata.reconciliationWorkerId": "",
      },
    }
  );

const finalizeReconciledWithdrawalSuccess = async ({
  transaction,
  workerId,
  chainResult,
}) => {
  const session = await mongoose.startSession();
  let walletLock = null;
  let walletLockRefresher = null;

  try {
    if (transaction?.metadata?.reservedFromUserBalance && transaction?.userId) {
      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ user: transaction.userId })
      );

      // Reconciliation acquires the wallet lock here before consuming the
      // user's locked balance on a confirmed on-chain success.
      walletLock = await acquireWalletRedisLock(wallet._id.toString());
      walletLockRefresher = startWalletRedisLockRefresh(walletLock);
    }

    await session.withTransaction(async () => {
      const tx = await Transaction.findOne({
        _id: transaction._id,
        type: "WITHDRAW",
        "metadata.reconciliationRequired": true,
        "metadata.reconciliationWorkerId": workerId,
      }).session(session);

      if (!tx) {
        return;
      }

      if (tx.metadata?.reservedFromUserBalance && tx.userId) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: tx.userId }).session(session),
          session
        );

        const finalizeResult = await Wallet.updateOne(
          {
            _id: wallet._id,
            trxLockedBalanceSun: { $gte: getReservedWithdrawalAmountSun(tx) },
          },
          {
            $inc: buildWithdrawalFinalizeIncrementFromSun(
              getReservedWithdrawalAmountSun(tx)
            ),
          },
          { session }
        );

        if (finalizeResult.modifiedCount !== 1) {
          throw new ApiError(
            409,
            "Locked balance missing during withdrawal reconciliation success"
          );
        }
      }

      // Success is applied here after reconciliation proves the chain payout
      // really succeeded, so rollback stays blocked permanently.
      await Transaction.updateOne(
        { _id: tx._id, "metadata.reconciliationWorkerId": workerId },
        {
          $set: {
            status: "SUCCESS",
            processed: true,
            processedAt: tx.processedAt || new Date(),
            confirmedAt: tx.confirmedAt || new Date(),
            completedAt: tx.completedAt || new Date(),
            lockedAt: null,
            lastError: null,
            metadata: createTransactionMetadata({
              existingMetadata: tx.metadata,
              tatum:
                chainResult?.payload && typeof chainResult.payload === "object"
                  ? chainResult.payload
                  : tx.metadata?.tatum,
              success: buildFinalSuccessMetadata({
                transaction: {
                  ...tx.toObject(),
                  status: "COMPLETED",
                  amount: tx.amount || getReservedWithdrawalAmountSun(tx) / 1_000_000,
                  amountSun: getReservedWithdrawalAmountSun(tx),
                },
                status: "COMPLETED",
                transakMetadata: tx.metadata?.transak || null,
                tatumMetadata:
                  chainResult?.payload && typeof chainResult.payload === "object"
                    ? chainResult.payload
                    : tx.metadata?.tatum || null,
              }),
              extra: buildResolvedReconciliationMetadata("SUCCESS", {
                reconciliationLastCheckedAt: new Date(),
                reconciliationResolvedReason: chainResult.reason,
              }),
            }),
          },
          $unset: {
            "metadata.reconciliationWorkerId": "",
            "metadata.reconciliationClaimedAt": "",
          },
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
    // Reconciliation releases the wallet lock here after success handling.
    await releaseWalletRedisLock(walletLock, walletLockRefresher);
  }
};

const refundReconciledWithdrawalBalance = async ({
  transaction,
  workerId,
  chainResult,
}) => {
  const session = await mongoose.startSession();
  let walletLock = null;
  let walletLockRefresher = null;

  try {
    if (transaction?.metadata?.reservedFromUserBalance && transaction?.userId) {
      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ user: transaction.userId })
      );

      // Reconciliation acquires the wallet lock here before refunding the user
      // after confirmed on-chain failure.
      walletLock = await acquireWalletRedisLock(wallet._id.toString());
      walletLockRefresher = startWalletRedisLockRefresh(walletLock);
    }

    await session.withTransaction(async () => {
      const tx = await Transaction.findOne({
        _id: transaction._id,
        type: "WITHDRAW",
        "metadata.reconciliationRequired": true,
        "metadata.reconciliationWorkerId": workerId,
      }).session(session);

      if (!tx) {
        return;
      }

      const amountSun = getReservedWithdrawalAmountSun(tx);
      const adminWallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ isAdmin: true }).session(session),
        session
      );

      if (tx.metadata?.reservedFromUserBalance && tx.userId) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: tx.userId }).session(session),
          session
        );

        const refundResult = await Wallet.updateOne(
          {
            _id: wallet._id,
            trxLockedBalanceSun: { $gte: amountSun },
          },
          {
            $inc: buildWithdrawalRollbackIncrementFromSun(amountSun),
          },
          { session }
        );

        if (refundResult.modifiedCount !== 1) {
          throw new ApiError(
            409,
            "Locked balance missing during withdrawal reconciliation refund"
          );
        }
      }

      // Admin balance is restored here because the withdrawal never finalized
      // on chain, so treasury funds should not remain debited in MongoDB.
      await Wallet.updateOne(
        { _id: adminWallet._id },
        { $inc: buildBalanceIncrementFromSun(amountSun) },
        { session }
      );

      // Refund is applied here after reconciliation proves the chain transfer
      // failed, so funds are safely returned to the user in a dedicated flow.
      await Transaction.updateOne(
        { _id: tx._id, "metadata.reconciliationWorkerId": workerId },
        {
          $set: {
            status: "FAILED",
            processed: true,
            processedAt: new Date(),
            lockedAt: null,
            lastError: chainResult.reason,
            metadata: createTransactionMetadata({
              existingMetadata: tx.metadata,
              tatum:
                chainResult?.payload && typeof chainResult.payload === "object"
                  ? chainResult.payload
                  : tx.metadata?.tatum,
              extra: buildResolvedReconciliationMetadata("REFUNDED", {
                reconciliationLastCheckedAt: new Date(),
                reconciliationResolvedReason: chainResult.reason,
              }),
            }),
          },
          $unset: {
            "metadata.reconciliationWorkerId": "",
            "metadata.reconciliationClaimedAt": "",
          },
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
    // Reconciliation releases the wallet lock here after refund handling.
    await releaseWalletRedisLock(walletLock, walletLockRefresher);
  }
};

const reconcileSingleWithdrawal = async (transaction, workerId) => {
  const chainResult = await resolveOnChainWithdrawalStatus(transaction.txId);

  if (chainResult.status === "SUCCESS") {
    await finalizeReconciledWithdrawalSuccess({
      transaction,
      workerId,
      chainResult,
    });

    logger.info("withdrawal.reconciliation.success", {
      transactionId: transaction._id.toString(),
      txId: transaction.txId || null,
      reason: chainResult.reason,
    });
    return;
  }

  if (chainResult.status === "FAILED") {
    await refundReconciledWithdrawalBalance({
      transaction,
      workerId,
      chainResult,
    });

    logger.warn("withdrawal.reconciliation.refunded", {
      transactionId: transaction._id.toString(),
      txId: transaction.txId || null,
      reason: chainResult.reason,
    });
    return;
  }

  await markReconciliationPending({
    transactionId: transaction._id,
    workerId,
    reason: chainResult.reason,
  });

  logger.info("withdrawal.reconciliation.retried", {
    transactionId: transaction._id.toString(),
    txId: transaction.txId || null,
    reason: chainResult.reason,
  });
};

export const runWithdrawalReconciliationBatch = async () => {
  const workerId = crypto.randomUUID();
  const candidates = await getPendingReconciliationCandidates();

  logger.info("withdrawal.reconciliation.log", {
    workerId,
    candidateCount: candidates.length,
  });

  for (const candidate of candidates) {
    const claimed = await claimWithdrawalForReconciliation(candidate._id, workerId);

    if (!claimed) {
      continue;
    }

    try {
      // Reconciliation is triggered here for withdrawals explicitly flagged
      // as reconciliationRequired after provider success / DB inconsistency.
      await reconcileSingleWithdrawal(claimed, workerId);
    } catch (error) {
      await markReconciliationPending({
        transactionId: claimed._id,
        workerId,
        reason: error?.message || "Unknown reconciliation error",
      }).catch(() => {});

      logger.error("withdrawal.reconciliation.failed", {
        transactionId: claimed._id.toString(),
        txId: claimed.txId || null,
        error: error?.message || "Unknown reconciliation failure",
      });
    }
  }

  return {
    workerId,
    processedCount: candidates.length,
  };
};
