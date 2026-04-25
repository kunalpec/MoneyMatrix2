import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { ProcessedTx } from "../../model/processedTx.model.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  trxToSun,
} from "../../util/trxAmount.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { logger } from "../../util/logger.util.js";
import { ensureWalletAccountingFields } from "./walletAccounting.service.js";
import {
  getConfiguredTronTokenAddress,
  getConfiguredTronTransferCurrency,
} from "../../util/tronTransfer.util.js";

const MAX_WEBHOOK_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES || 5);

const lockTransaction = async ({ filter, session }) =>
  Transaction.findOneAndUpdate(
    {
      ...filter,
      processed: false,
      status: { $in: ["PENDING", "PROCESSING"] },
      retryCount: { $lt: MAX_WEBHOOK_RETRIES },
    },
    {
      $set: {
        status: "LOCKED",
        lockedAt: new Date(),
        lastError: null,
      },
    },
    {
      returnDocument: "after",
      sort: { createdAt: 1 },
      session,
    }
  );

const createSweepPlaceholder = async ({
  session,
  wallet,
  amountSun,
  sourceTxId,
}) => {
  if (wallet.isAdmin) {
    return null;
  }

  const adminWallet = await ensureWalletAccountingFields(
    await Wallet.findOne({ isAdmin: true }).session(session),
    session
  );

  if (!adminWallet) {
    throw new ApiError(500, "Admin wallet missing");
  }

  const networkFeeSun = trxToSun(process.env.TRON_FEE || 1, "TRON_FEE");
  const sweepAmountSun = amountSun - networkFeeSun;

  if (sweepAmountSun <= 0) {
    return null;
  }

  const existingSweep = await Transaction.findOne({
    type: "SWEEP",
    externalId: `SWEEP:${sourceTxId}`,
  }).session(session);

  if (existingSweep) {
    return existingSweep._id;
  }

  const [sweepTx] = await Transaction.create(
    [
      {
        userId: wallet.user,
        type: "SWEEP",
        ...buildAmountFieldsFromSun(sweepAmountSun),
        provider: "TATUM",
        currency: getConfiguredTronTransferCurrency(),
        fromAddress: wallet.address,
        toAddress: adminWallet.address,
        externalId: `SWEEP:${sourceTxId}`,
        status: "PENDING",
        processed: false,
        metadata: {
          tokenAddress: getConfiguredTronTokenAddress(),
        },
      },
    ],
    { session }
  );

  return sweepTx._id;
};

const claimProcessedDeposit = async ({
  session,
  provider,
  txHash,
  address,
  amountSun,
  source,
  metadata,
}) => {
  try {
    await ProcessedTx.create(
      [
        {
          provider,
          direction: "DEPOSIT",
          txHash,
          address,
          amountSun,
          source,
          metadata,
        },
      ],
      { session }
    );

    return true;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }

    throw error;
  }
};

export const validateTatumDepositPayload = (payload = {}) => {
  const txHash =
    payload.txId ||
    payload.tx_id ||
    payload.transactionHash ||
    payload.transaction_hash;
  const address =
    payload.address ||
    payload.to ||
    payload.recipient ||
    payload.walletAddress ||
    payload.wallet_address;
  const amount = payload.amount;

  if (!txHash || !address || amount === undefined || amount === null) {
    throw new ApiError(
      400,
      "Invalid Tatum payload: txId, address, and amount are required"
    );
  }
};

export const getTransactionAmountSun = (transaction) => {
  if (Number.isSafeInteger(transaction?.amountSun)) {
    return transaction.amountSun;
  }

  return trxToSun(transaction?.amount || 0, "Transaction amount");
};

export const processConfirmedDeposit = async ({
  provider = "TATUM",
  txHash,
  address,
  amountSun,
  providerExternalId = null,
  currency = "TRX",
  payload = {},
  source = "WEBHOOK",
}) => {
  let sweepTxId = null;
  let responseMessage = "Deposit processed";

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      let existingTx = null;

      if (providerExternalId) {
        existingTx = await Transaction.findOne({
          type: "DEPOSIT",
          externalId: providerExternalId,
        }).session(session);
      } else {
        existingTx = await Transaction.findOne({
          type: "DEPOSIT",
          txId: txHash,
        }).session(session);
      }

      if (!existingTx) {
        existingTx = await Transaction.findOne({
          type: "DEPOSIT",
          toAddress: address,
          processed: false,
          status: { $in: ["PENDING", "PROCESSING"] },
          amountSun: { $in: [0, amountSun] },
        })
          .sort({ provider: -1, createdAt: 1 })
          .session(session);
      }

      if (!existingTx && !providerExternalId) {
        const wallet = await ensureWalletAccountingFields(
          await Wallet.findOne({ address }).session(session),
          session
        );

        [existingTx] = await Transaction.create(
          [
            {
              userId: wallet.user,
              type: "DEPOSIT",
              ...buildAmountFieldsFromSun(amountSun),
              provider,
              currency,
              txId: txHash,
              toAddress: address,
              status: "PROCESSING",
              processed: false,
              metadata: payload,
            },
          ],
          { session }
        );
      }

      if (!existingTx) {
        throw new ApiError(404, "Deposit transaction not found");
      }

      if (existingTx.processed) {
        responseMessage = "Already processed";
        return;
      }

      const duplicateTxId = await Transaction.findOne({
        type: "DEPOSIT",
        txId: txHash,
        processed: true,
        status: "SUCCESS",
      }).session(session);

      if (duplicateTxId) {
        responseMessage = "Already processed";
        return;
      }

      const lockedTx = await lockTransaction({
        filter: {
          _id: existingTx._id,
          type: "DEPOSIT",
          ...(providerExternalId
            ? { externalId: providerExternalId }
            : existingTx.txId
              ? { txId: txHash }
              : {}),
        },
        session,
      });

      if (!lockedTx || lockedTx.processed) {
        responseMessage = "Already processed";
        return;
      }

      if (
        lockedTx.txId &&
        lockedTx.txId !== txHash &&
        lockedTx.provider !== "TRANSAK"
      ) {
        throw new ApiError(409, "Deposit txId mismatch for externalId");
      }

      if (lockedTx.toAddress && lockedTx.toAddress !== address) {
        throw new ApiError(409, "Deposit address mismatch for externalId");
      }

      const claimed = await claimProcessedDeposit({
        session,
        provider,
        txHash,
        address,
        amountSun,
        source,
        metadata: payload,
      });

      if (!claimed) {
        responseMessage = "Already processed";
        return;
      }

      const wallet = await ensureWalletAccountingFields(
        await Wallet.findOne({ address: lockedTx.toAddress || address }).session(
          session
        ),
        session
      );

      await Wallet.updateOne(
        { _id: wallet._id },
        { $inc: buildBalanceIncrementFromSun(amountSun) },
        { session }
      );

      await Transaction.updateOne(
        { _id: lockedTx._id, processed: false, status: "LOCKED" },
        {
          $set: {
            ...buildAmountFieldsFromSun(amountSun),
            provider,
            currency,
            txId: txHash,
            ...(providerExternalId ? { externalId: providerExternalId } : {}),
            toAddress: lockedTx.toAddress || address,
            status: "SUCCESS",
            processed: true,
            processedAt: new Date(),
            confirmedAt: new Date(),
            completedAt: new Date(),
            lockedAt: null,
            lastError: null,
            metadata: payload,
          },
        },
        { session }
      );

      sweepTxId = await createSweepPlaceholder({
        session,
        wallet,
        amountSun,
        sourceTxId: txHash,
      });
    });
  } finally {
    await session.endSession();
  }

  logger.info("deposit.processed", {
    provider,
    txHash,
    address,
    amountSun,
    source,
    sweepScheduled: Boolean(sweepTxId),
    responseMessage,
  });

  return {
    txHash,
    responseMessage,
    sweepTxId,
    externalId: providerExternalId,
  };
};
