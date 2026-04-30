import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  sunToTrx,
} from "../../util/trxAmount.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { logger } from "../../util/logger.util.js";
import {
  ensureWalletAccountingFields,
} from "./walletAccounting.service.js";
import { resolveTronTransactionSigner } from "../../util/tatumSigner.util.js";
import {
  getConfiguredTronTransferCurrency,
  submitTatumTronTransfer,
} from "../../util/tronTransfer.util.js";
import { createTransactionMetadata } from "./transactionMetadata.service.js";

const getReservedWithdrawalAmountSun = (transaction) => {
  const requestedAmountSun = transaction?.metadata?.requestedAmountSun;

  if (Number.isSafeInteger(requestedAmountSun) && requestedAmountSun > 0) {
    return requestedAmountSun;
  }

  return transaction?.amountSun || 0;
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
  let transaction;

  try {
    await session.withTransaction(async () => {
      if (deductUserBalance) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: user._id }).session(session),
          session
        );

        const updatedWallet = await Wallet.findOneAndUpdate(
          {
            _id: wallet._id,
            trxBalanceSun: { $gte: amountSun },
          },
          { $inc: buildBalanceIncrementFromSun(-amountSun) },
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
                provider === "TATUM" && metadata?.tatum ? metadata.tatum : undefined,
            }),
          },
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
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

  try {
    await session.withTransaction(async () => {
      if (refundUserBalance) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ user: user._id }).session(session),
          session
        );

        if (wallet) {
          await Wallet.updateOne(
            { _id: wallet._id },
            { $inc: buildBalanceIncrementFromSun(amountSun) },
            { session }
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
            lastError: error?.response?.data?.message || error?.message || "Unknown error",
          },
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
};

const lockQueuedWithdrawal = async (transactionId) =>
  Transaction.findOneAndUpdate(
    {
      _id: transactionId,
      type: "WITHDRAW",
      processed: false,
      status: { $in: ["PENDING", "FAILED"] },
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

const refundReservedUserBalance = async ({ transaction, session }) => {
  if (!transaction?.metadata?.reservedFromUserBalance || !transaction?.userId) {
    return;
  }

  const wallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ user: transaction.userId }).session(session),
    session
  );

  if (!wallet) {
    throw new ApiError(500, "User wallet missing for failed withdrawal refund");
  }

  await Wallet.updateOne(
    { _id: wallet._id },
    { $inc: buildBalanceIncrementFromSun(transaction.amountSun) },
    { session }
  );
};

const failQueuedWithdrawalWithRefund = async ({ transaction, message }) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Transaction.updateOne(
        { _id: transaction._id, processed: false },
        {
          $set: {
            status: "FAILED",
            lockedAt: null,
            lastError: message,
          },
          $inc: { retryCount: 1 },
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
    await failQueuedWithdrawalWithRefund({
      transaction: lockedTransaction,
      message: "Admin wallet missing",
    });
    throw new ApiError(500, "Admin wallet missing");
  }

  const debitSession = await mongoose.startSession();
  let adminDebited = false;

  try {
    await debitSession.withTransaction(async () => {
      const adminWalletInSession = await ensureWalletAccountingFields(
        adminWallet._id,
        debitSession
      );

      const updatedAdminWallet = await Wallet.findOneAndUpdate(
        {
          _id: adminWalletInSession._id,
          trxBalanceSun: { $gte: getReservedWithdrawalAmountSun(lockedTransaction) },
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

    adminDebited = true;

    const signer = resolveTronTransactionSigner(adminWallet, {
      walletLabel: "Admin withdrawal wallet",
      envSignatureId: process.env.TATUM_TRON_ADMIN_SIGNATURE_ID,
    });

    const response = await submitTatumTronTransfer({
      toAddress: lockedTransaction.toAddress,
      amount: sunToTrx(getReservedWithdrawalAmountSun(lockedTransaction)).toString(),
      fromAddress: adminWallet.address,
      tokenAddress: lockedTransaction.metadata?.tokenAddress,
      signer,
    });

    await Transaction.updateOne(
      { _id: lockedTransaction._id, processed: false, status: "PROCESSING" },
      {
        $set: {
          txId: response.data.txId,
          fromAddress: adminWallet.address,
          ...buildAmountFieldsFromSun(getReservedWithdrawalAmountSun(lockedTransaction)),
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
              txId: response.data.txId,
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
      txId: response?.data?.txId,
      amountSun: getReservedWithdrawalAmountSun(lockedTransaction),
      toAddress: lockedTransaction.toAddress,
    });

    return Transaction.findById(lockedTransaction._id);
  } catch (error) {
    if (adminDebited) {
      const refundSession = await mongoose.startSession();

      try {
        await refundSession.withTransaction(async () => {
          await Wallet.updateOne(
            { _id: adminWallet._id },
            {
              $inc: buildBalanceIncrementFromSun(
                getReservedWithdrawalAmountSun(lockedTransaction)
              ),
            },
            { session: refundSession }
          );

          await Transaction.updateOne(
            { _id: lockedTransaction._id, processed: false },
            {
              $set: {
                status: "FAILED",
                lockedAt: null,
                lastError: error?.response?.data?.message || error.message,
              },
              $inc: { retryCount: 1 },
            },
            { session: refundSession }
          );

          await refundReservedUserBalance({
            transaction: lockedTransaction,
            session: refundSession,
          });
        });
      } finally {
        await refundSession.endSession();
      }
    } else {
      await failQueuedWithdrawalWithRefund({
        transaction: lockedTransaction,
        message: error?.response?.data?.message || error.message,
      });
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
