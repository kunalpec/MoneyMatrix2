import crypto from "crypto";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  buildLockedBalanceIncrementFromSun,
  sunToTrx,
} from "../../util/trxAmount.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { logger } from "../../util/logger.util.js";
import { ensureWalletAccountingFields } from "./walletAccounting.service.js";
import { resolveTronTransactionSigner } from "../../util/tatumSigner.util.js";
import {
  getConfiguredTronTransferCurrency,
  submitTatumTronTransfer,
} from "../../util/tronTransfer.util.js";
import { createTransactionMetadata } from "./transactionMetadata.service.js";
import { getRedisConnection } from "../../queue/redis.connection.js";

const WITHDRAWAL_WALLET_LOCK_TTL_MS = Number(
  process.env.WITHDRAWAL_WALLET_LOCK_TTL_MS || 300000
);
const WITHDRAWAL_WALLET_LOCK_WAIT_MS = Number(
  process.env.WITHDRAWAL_WALLET_LOCK_WAIT_MS || 5000
);
const WITHDRAWAL_WALLET_LOCK_RETRY_MS = Number(
  process.env.WITHDRAWAL_WALLET_LOCK_RETRY_MS || 100
);

const getReservedWithdrawalAmountSun = (transaction) => {
  const requestedAmountSun = transaction?.metadata?.requestedAmountSun;

  if (Number.isSafeInteger(requestedAmountSun) && requestedAmountSun > 0) {
    return requestedAmountSun;
  }

  return transaction?.amountSun || 0;
};

const buildWithdrawalLockIncrementFromSun = (amountSun) => ({
  ...buildBalanceIncrementFromSun(-amountSun),
  ...buildLockedBalanceIncrementFromSun(amountSun),
});

const buildWithdrawalRollbackIncrementFromSun = (amountSun) => ({
  ...buildBalanceIncrementFromSun(amountSun),
  ...buildLockedBalanceIncrementFromSun(-amountSun),
});

/**
 * Withdrawal accounting lifecycle:
 * 1. Lock step:
 *    If the user has enough spendable balance, move the requested SUN amount
 *    from trxBalanceSun to trxLockedBalanceSun in one atomic update.
 *    Example for 25 TRX (25,000,000 SUN):
 *      Before: trxBalanceSun=1,000,000,000, trxLockedBalanceSun=0
 *      After lock: trxBalanceSun=975,000,000, trxLockedBalanceSun=25,000,000
 *
 * 2. Backend payout step:
 *    Only after the lock succeeds do we call the withdrawal/payment backend.
 *
 * 3. Rollback step:
 *    If the backend fails for any reason, move the same SUN amount back from
 *    trxLockedBalanceSun to trxBalanceSun in one atomic update.
 *      After rollback: trxBalanceSun=1,000,000,000, trxLockedBalanceSun=0
 *
 * 4. Success step:
 *    If the payout succeeds, keep the user spendable balance reduced and keep
 *    the amount locked until final webhook settlement completes the withdrawal.
 *
 * Guardrails:
 * - We only lock when spendable balance is sufficient.
 * - We only rollback when locked balance is sufficient.
 * - trxLockedBalanceSun is never allowed to go negative.
 * - A Redis lock on walletId prevents concurrent double-withdrawals.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getWalletLockKey = (walletId) => `lock:wallet:withdraw:${walletId}`;

const acquireWalletRedisLock = async (walletId) => {
  const redis = getRedisConnection();
  const key = getWalletLockKey(walletId);
  const token = crypto.randomUUID();
  const deadline = Date.now() + WITHDRAWAL_WALLET_LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const result = await redis.set(
      key,
      token,
      "PX",
      WITHDRAWAL_WALLET_LOCK_TTL_MS,
      "NX"
    );

    if (result === "OK") {
      return { key, token };
    }

    await sleep(WITHDRAWAL_WALLET_LOCK_RETRY_MS);
  }

  throw new ApiError(423, "Wallet is busy processing another withdrawal");
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
    String(WITHDRAWAL_WALLET_LOCK_TTL_MS)
  );
};

const startWalletRedisLockRefresh = (lock) => {
  if (!lock?.key || !lock?.token) {
    return { stop: async () => {} };
  }

  const refreshIntervalMs = Math.max(
    1000,
    Math.floor(WITHDRAWAL_WALLET_LOCK_TTL_MS / 3)
  );

  let active = true;
  const timer = setInterval(async () => {
    if (!active) {
      return;
    }

    try {
      const refreshed = await refreshWalletRedisLock(lock);

      if (Number(refreshed) !== 1) {
        logger.error("withdrawal.lock.refresh_lost", {
          lockKey: lock.key,
        });
      }
    } catch (error) {
      logger.error("withdrawal.lock.refresh_failed", {
        lockKey: lock.key,
        error: error?.message || "Unknown lock refresh error",
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

const markWithdrawalForReconciliation = async ({
  transactionId,
  txId,
  message,
  adminWalletAddress,
}) => {
  try {
    await Transaction.updateOne(
      { _id: transactionId },
      {
        $set: {
          status: "PROCESSING",
          lockedAt: null,
          lastError: message,
          ...(txId ? { txId } : {}),
          ...(adminWalletAddress ? { fromAddress: adminWalletAddress } : {}),
          "metadata.reconciliationRequired": true,
          "metadata.reconciliationReason": message,
          "metadata.reconciliationMarkedAt": new Date(),
          ...(txId ? { "metadata.providerTxId": txId } : {}),
        },
      }
    );
  } catch (reconciliationError) {
    logger.error("withdrawal.reconciliation_mark_failed", {
      transactionId: transactionId?.toString?.() || String(transactionId),
      txId: txId || null,
      error: reconciliationError?.message || "Unknown reconciliation mark error",
    });
  }
};

const refundReservedUserBalance = async ({ transaction, session }) => {
  if (!transaction?.metadata?.reservedFromUserBalance || !transaction?.userId) {
    return;
  }

  const reservedAmountSun = getReservedWithdrawalAmountSun(transaction);
  const wallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ user: transaction.userId }).session(session),
    session
  );

  const rollbackResult = await Wallet.updateOne(
    {
      _id: wallet._id,
      trxLockedBalanceSun: { $gte: reservedAmountSun },
    },
    {
      $inc: buildWithdrawalRollbackIncrementFromSun(reservedAmountSun),
    },
    { session }
  );

  if (rollbackResult.modifiedCount !== 1) {
    throw new ApiError(409, "Locked balance missing for withdrawal refund");
  }
};

export const reserveWithdrawalTransaction = async ({
  user,
  amountSun,
  destinationAddress,
  provider,
  currency,
  status = "PENDING",
  externalId,
  metadata,
  deductUserBalance = true,
}) => {
  const session = await mongoose.startSession();
  let transaction = null;
  let walletLock = null;
  let walletLockRefresher = null;

  try {
    if (deductUserBalance) {
      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ user: user._id })
      );

      // Redis wallet lock is acquired here before any balance mutation.
      walletLock = await acquireWalletRedisLock(wallet._id.toString());
      // The lock is refreshed in the background so long DB work cannot let
      // the lock expire and allow a second withdrawal into the same wallet.
      walletLockRefresher = startWalletRedisLockRefresh(walletLock);
    }

    await session.withTransaction(async () => {
      if (deductUserBalance) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: user._id }).session(session),
          session
        );

        // Lock happens here: spendable balance moves to locked balance in one
        // atomic update so concurrent withdrawals cannot double-spend funds.
        const updatedWallet = await Wallet.findOneAndUpdate(
          {
            _id: wallet._id,
            trxBalanceSun: { $gte: amountSun },
          },
          { $inc: buildWithdrawalLockIncrementFromSun(amountSun) },
          { returnDocument: "after", session }
        );

        if (!updatedWallet) {
          throw new ApiError(400, "Insufficient balance");
        }
      }

      [transaction] = await Transaction.create(
        [
          {
            userId: user._id,
            type: "WITHDRAW",
            ...buildAmountFieldsFromSun(0),
            fee: null,
            externalId,
            status,
            processed: false,
            toAddress: destinationAddress,
            provider,
            currency,
            metadata: createTransactionMetadata({
              extra: {
                ...(metadata && typeof metadata === "object" ? metadata : {}),
                requestedAmountSun: amountSun,
                requestedAmount: Number(sunToTrx(amountSun)),
                reservedFromUserBalance: deductUserBalance,
              },
              transak:
                provider === "TRANSAK" && metadata?.transak
                  ? metadata.transak
                  : undefined,
              tatum:
                provider === "TATUM" && metadata?.tatum
                  ? metadata.tatum
                  : undefined,
            }),
          },
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
    // Redis wallet lock is released here on both success and failure paths.
    await releaseWalletRedisLock(walletLock, walletLockRefresher);
  }

  logger.info("withdrawal.reserved", {
    transactionId: transaction?._id?.toString?.(),
    userId: user?._id?.toString?.(),
    amountSun,
    destinationAddress,
    provider,
  });

  return transaction;
};

export const rollbackReservedWithdrawal = async ({
  user,
  amountSun,
  transactionFilter,
  error,
  refundUserBalance = true,
}) => {
  const session = await mongoose.startSession();
  let walletLock = null;
  let walletLockRefresher = null;

  try {
    if (refundUserBalance) {
      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ user: user._id })
      );

      // Redis wallet lock is acquired here before rollback touches balances.
      walletLock = await acquireWalletRedisLock(wallet._id.toString());
      walletLockRefresher = startWalletRedisLockRefresh(walletLock);
    }

    await session.withTransaction(async () => {
      if (refundUserBalance) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: user._id }).session(session),
          session
        );

        // Rollback happens here: payment backend failed, so we return the
        // locked amount back to spendable balance atomically.
        const rollbackResult = await Wallet.updateOne(
          {
            _id: wallet._id,
            trxLockedBalanceSun: { $gte: amountSun },
          },
          { $inc: buildWithdrawalRollbackIncrementFromSun(amountSun) },
          { session }
        );

        if (rollbackResult.modifiedCount !== 1) {
          throw new ApiError(
            409,
            "Locked balance missing for withdrawal rollback"
          );
        }
      }

      await Transaction.updateOne(
        { ...transactionFilter, processed: false },
        {
          $set: {
            status: "FAILED",
            processed: true,
            processedAt: new Date(),
            lastError:
              error?.response?.data?.message ||
              error?.message ||
              "Unknown error",
          },
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
    // Redis wallet lock is released here after rollback completes or fails.
    await releaseWalletRedisLock(walletLock, walletLockRefresher);
  }
};

const lockQueuedWithdrawal = async (transactionId) =>
  Transaction.findOneAndUpdate(
    {
      _id: transactionId,
      type: "WITHDRAW",
      processed: false,
      status: "PENDING",
    },
    {
      $set: {
        status: "LOCKED",
        lockedAt: new Date(),
        lastError: null,
      },
    },
    { returnDocument: "after" }
  );

const failQueuedWithdrawalWithRefund = async ({ transaction, message }) => {
  const session = await mongoose.startSession();
  let walletLock = null;
  let walletLockRefresher = null;

  try {
    if (transaction?.metadata?.reservedFromUserBalance && transaction?.userId) {
      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ user: transaction.userId })
      );

      // Redis wallet lock is acquired here before refunding the user.
      walletLock = await acquireWalletRedisLock(wallet._id.toString());
      walletLockRefresher = startWalletRedisLockRefresh(walletLock);
    }

    await session.withTransaction(async () => {
      await Transaction.updateOne(
        { _id: transaction._id, processed: false },
        {
          $set: {
            status: "FAILED",
            processed: true,
            processedAt: new Date(),
            lockedAt: null,
            lastError: message,
          },
        },
        { session }
      );

      await refundReservedUserBalance({
        transaction,
        session,
      });
    });
  } finally {
    await session.endSession();
    // Redis wallet lock is released here after refund handling finishes.
    await releaseWalletRedisLock(walletLock, walletLockRefresher);
  }
};

export const processQueuedWithdrawal = async ({ transactionId }) => {
  const lockedTransaction = await lockQueuedWithdrawal(transactionId);

  if (!lockedTransaction) {
    return Transaction.findById(transactionId);
  }

  const adminWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ isAdmin: true })
  );

  if (!adminWallet) {
    await rollbackReservedWithdrawal({
      user: { _id: lockedTransaction.userId },
      amountSun: getReservedWithdrawalAmountSun(lockedTransaction),
      transactionFilter: { _id: lockedTransaction._id },
      error: new ApiError(500, "Admin wallet missing"),
      refundUserBalance: Boolean(
        lockedTransaction.metadata?.reservedFromUserBalance
      ),
    });

    throw new ApiError(500, "Admin wallet missing");
  }

  const debitSession = await mongoose.startSession();
  let providerSubmitted = false;
  let providerTxId = null;

  try {
    await debitSession.withTransaction(async () => {
      const updatedAdminWallet = await Wallet.findOneAndUpdate(
        {
          _id: adminWallet._id,
          trxBalanceSun: {
            $gte: getReservedWithdrawalAmountSun(lockedTransaction),
          },
        },
        {
          $inc: buildBalanceIncrementFromSun(
            -getReservedWithdrawalAmountSun(lockedTransaction)
          ),
        },
        { returnDocument: "after", session: debitSession }
      );

      if (!updatedAdminWallet) {
        throw new ApiError(400, "Admin insufficient balance");
      }

      await Transaction.updateOne(
        { _id: lockedTransaction._id, processed: false, status: "LOCKED" },
        {
          $set: {
            status: "PROCESSING",
            lockedAt: null,
            lastError: null,
          },
        },
        { session: debitSession }
      );
    });

    const signer = resolveTronTransactionSigner(adminWallet, {
      walletLabel: "Admin withdrawal wallet",
      envSignatureId: process.env.TATUM_TRON_ADMIN_SIGNATURE_ID,
    });

    const response = await submitTatumTronTransfer({
      toAddress: lockedTransaction.toAddress,
      amount: sunToTrx(
        getReservedWithdrawalAmountSun(lockedTransaction)
      ).toString(),
      fromAddress: adminWallet.address,
      tokenAddress: lockedTransaction.metadata?.tokenAddress,
      signer,
    });

    providerSubmitted = true;
    providerTxId = response?.data?.txId || null;

    // The withdrawal is marked as externally successful here: once the
    // provider has accepted the payout and returned a txId, rollback must be
    // blocked even if a later DB write fails.
    await Transaction.updateOne(
      { _id: lockedTransaction._id, processed: false, status: "PROCESSING" },
      {
        $set: {
          txId: providerTxId,
          fromAddress: adminWallet.address,
          ...buildAmountFieldsFromSun(
            getReservedWithdrawalAmountSun(lockedTransaction)
          ),
          fee:
            response?.data?.fee !== undefined && response?.data?.fee !== null
              ? Number(response.data.fee)
              : null,
          currency: getConfiguredTronTransferCurrency({
            tokenAddress: lockedTransaction.metadata?.tokenAddress,
          }),
          metadata: createTransactionMetadata({
            existingMetadata: lockedTransaction.metadata,
            tatum: {
              provider: "TATUM",
              subscriptionType: "OUTGOING_NATIVE_TX",
              chain: "tron-mainnet",
              txId: providerTxId,
              fromAddress: adminWallet.address,
              toAddress: lockedTransaction.toAddress,
              amount: sunToTrx(
                getReservedWithdrawalAmountSun(lockedTransaction)
              ).toString(),
              fee:
                response?.data?.fee !== undefined && response?.data?.fee !== null
                  ? String(response.data.fee)
                  : null,
            },
          }),
          lastError: null,
        },
      }
    );

    logger.info("withdrawal.submitted", {
      transactionId: lockedTransaction._id.toString(),
      txId: providerTxId,
      amountSun: getReservedWithdrawalAmountSun(lockedTransaction),
      toAddress: lockedTransaction.toAddress,
    });

    return Transaction.findById(lockedTransaction._id);
  } catch (error) {
    if (providerSubmitted) {
      const reconciliationMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Withdrawal provider succeeded but DB finalization failed";

      // No refund happens here. The provider call already succeeded, so
      // refunding the user would create an on-chain payout plus DB credit.
      await markWithdrawalForReconciliation({
        transactionId: lockedTransaction._id,
        txId: providerTxId,
        message: reconciliationMessage,
        adminWalletAddress: adminWallet.address,
      });

      logger.error("withdrawal.reconciliation_required", {
        transactionId: lockedTransaction._id.toString(),
        txId: providerTxId,
        error: reconciliationMessage,
      });

      throw error;
    }

    const refundSession = await mongoose.startSession();
    let walletLock = null;
    let walletLockRefresher = null;

    try {
      if (
        lockedTransaction.metadata?.reservedFromUserBalance &&
        lockedTransaction.userId
      ) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: lockedTransaction.userId })
        );

        // Redis wallet lock is acquired here before refunding the user after
        // a provider failure or a failure before provider submission.
        walletLock = await acquireWalletRedisLock(wallet._id.toString());
        walletLockRefresher = startWalletRedisLockRefresh(walletLock);
      }

      await refundSession.withTransaction(async () => {
        await Wallet.updateOne(
          { _id: adminWallet._id },
          {
            $inc: buildBalanceIncrementFromSun(
              getReservedWithdrawalAmountSun(lockedTransaction)
            ),
          },
          { session: refundSession }
        ).catch(() => {});

        await Transaction.updateOne(
          { _id: lockedTransaction._id, processed: false },
          {
            $set: {
              status: "FAILED",
              processed: true,
              processedAt: new Date(),
              lockedAt: null,
              lastError: error?.response?.data?.message || error.message,
            },
          },
          { session: refundSession }
        );

        // Rollback happens here: if the external payment fails, the locked
        // crypto is returned to the user so they never lose funds.
        if (lockedTransaction.metadata?.reservedFromUserBalance) {
          await refundReservedUserBalance({
            transaction: lockedTransaction,
            session: refundSession,
          });
        }
      });
    } finally {
      await refundSession.endSession();
      // Redis wallet lock is released here after the refund path completes.
      await releaseWalletRedisLock(walletLock, walletLockRefresher);
    }

    logger.error("withdrawal.failed", {
      transactionId: lockedTransaction._id.toString(),
      error: error?.response?.data?.message || error.message,
    });

    throw error;
  } finally {
    await debitSession.endSession();
  }
};
