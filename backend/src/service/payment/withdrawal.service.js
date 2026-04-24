import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  sunToTrx,
} from "../../util/trxAmount.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import {
  decrypt,
  derivePrivateKeyFromMnemonic,
} from "../../util/EncryptDecrypt.util.js";
import { tatumClient } from "../../controller/tatum/client.controller.js";
import { logger } from "../../util/logger.util.js";
import {
  ensureWalletAccountingFields,
  getWalletBalanceSun,
} from "./walletAccounting.service.js";

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
            ...buildAmountFieldsFromSun(amountSun),
            externalId,
            status,
            processed: false,
            toAddress: destinationAddress,
            provider,
            currency,
            metadata,
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

const markWithdrawalFailure = async ({ transactionId, message }) => {
  await Transaction.updateOne(
    { _id: transactionId, processed: false },
    {
      $set: {
        status: "FAILED",
        lockedAt: null,
        lastError: message,
      },
      $inc: { retryCount: 1 },
    }
  );
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
    await markWithdrawalFailure({
      transactionId,
      message: "Admin wallet missing",
    });
    throw new ApiError(500, "Admin wallet missing");
  }

  if (getWalletBalanceSun(adminWallet) < lockedTransaction.amountSun) {
    await markWithdrawalFailure({
      transactionId,
      message: "Admin insufficient balance",
    });
    throw new ApiError(400, "Admin insufficient balance");
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
          trxBalanceSun: { $gte: lockedTransaction.amountSun },
        },
        { $inc: buildBalanceIncrementFromSun(-lockedTransaction.amountSun) },
        { returnDocument: "after", session: debitSession }
      );

      if (!updatedAdminWallet) {
        throw new ApiError(409, "Admin balance changed before withdrawal send");
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

    const mnemonic = decrypt(adminWallet.mnemonic);
    const privateKey = derivePrivateKeyFromMnemonic(
      mnemonic,
      adminWallet.index || 0
    );

    const response = await tatumClient.post("/tron/transaction", {
      to: lockedTransaction.toAddress,
      amount: sunToTrx(lockedTransaction.amountSun).toString(),
      fromPrivateKey: privateKey,
    });

    await Transaction.updateOne(
      { _id: lockedTransaction._id, processed: false, status: "PROCESSING" },
      {
        $set: {
          txId: response.data.txId,
          lastError: null,
        },
      }
    );

    logger.info("withdrawal.submitted", {
      transactionId: lockedTransaction._id.toString(),
      txId: response?.data?.txId,
      amountSun: lockedTransaction.amountSun,
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
            { $inc: buildBalanceIncrementFromSun(lockedTransaction.amountSun) },
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
        });
      } finally {
        await refundSession.endSession();
      }
    } else {
      await markWithdrawalFailure({
        transactionId: lockedTransaction._id,
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
