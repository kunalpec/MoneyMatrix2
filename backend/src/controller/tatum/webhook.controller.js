import crypto from "crypto";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { WebhookEvent } from "../../model/webhookEvent.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { executePendingSweep } from "./ramp.controller.js";
import { getTransakSignatureCandidates, getTransakWebhookSecret } from "./transak.controller.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  trxToSun,
} from "../../util/trxAmount.util.js";

// ======== Webhook Constants (1) ========
const MAX_WEBHOOK_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES || 5);
const MIN_TRON_CONFIRMATIONS = Number(process.env.MIN_TRON_CONFIRMATIONS || 1);

const TRANSAK_SUCCESS_EVENTS = new Set([
  "ORDER_COMPLETED",
  "COMPLETED",
  "SUCCESS",
]);

const TRANSAK_FAILED_EVENTS = new Set([
  "FAILED",
  "ORDER_FAILED",
  "CANCELLED",
]);

// ======== Retryable Write Conflict Check (2) ========
const isRetryableWriteConflict = (error) =>
  /write conflict|transienttransactionerror|unknowntransactioncommitresult|duplicate key/i.test(
    error?.message || ""
  );

// ======== Parse Currency (3) ========
const parseCurrency = (data = {}) =>
  data.cryptoCurrencyCode ||
  data.cryptoCurrency ||
  data.cryptoTicker ||
  "TRX";

// ======== Parse Provider TxId (4) ========
const parseProviderTxId = (data = {}) =>
  data.transactionHash || data.cryptoTransactionHash || data.txId || null;

// ======== Normalize Webhook Payload (5) ========
const getPayload = (body = {}) => {
  if (body?.eventType && body?.data) {
    return { eventType: body.eventType, data: body.data };
  }

  const webhookData = body?.data?.[0]?.webhookData || {};
  return {
    eventType: webhookData?.status || body?.status || null,
    data: webhookData,
  };
};

// ======== Get Amount In SUN (6) ========
const getAmountSun = (data = {}) => {
  const rawAmount =
    data.cryptoAmount ||
    data.cryptoCurrencyAmount ||
    data.totalAmount ||
    data.amount ||
    0;

  return trxToSun(rawAmount, "Webhook amount");
};

// ======== Parse Webhook Event Id (7) ========
const parseWebhookEventId = (provider, req, data = {}) => {
  if (provider === "TRANSAK") {
    return (
      req.headers["x-transak-event-id"] ||
      data.eventId ||
      data.webhookId ||
      req.body?.eventId ||
      null
    );
  }

  return (
    req.headers["x-tatum-event-id"] ||
    req.body?.eventId ||
    req.body?.webhookId ||
    null
  );
};

// ======== Verify Transak Signature (8) ========
// ======== Verify Transak Signature (FINAL FIXED) ========
const verifyTransakSignature = (req) => {
  const signatureHeader = req.headers["x-transak-signature"];
  const secret = getTransakWebhookSecret();

  // 1. Basic validation
  if (!signatureHeader || !secret) {
    throw new ApiError(401, "Missing Transak signature");
  }

  // 2. Normalize provided signature
  const providedSignature = String(
    Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
  )
    .trim()
    .replace(/^sha256=/i, "") // remove prefix if exists
    .toLowerCase();

  // 3. Generate expected signatures
  const { rawHash, normalizedHash } = getTransakSignatureCandidates({
    body: req.body,
    rawBody: req.rawBody,
    secret,
  });

  try {
    // 4. Convert HEX → Buffer (IMPORTANT FIX)
    const providedBuffer = Buffer.from(providedSignature, "hex");
    const expectedRawBuffer = Buffer.from(rawHash, "hex");
    const expectedNormalizedBuffer = Buffer.from(normalizedHash, "hex");

    // 5. Timing-safe comparison
    const matchesRaw =
      providedBuffer.length === expectedRawBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedRawBuffer);

    const matchesNormalized =
      providedBuffer.length === expectedNormalizedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedNormalizedBuffer);

    // 6. Final validation
    if (!matchesRaw && !matchesNormalized) {
      throw new ApiError(401, "Invalid Transak signature");
    }

  } catch (error) {
    // Handles invalid hex / buffer issues
    throw new ApiError(401, "Invalid Transak signature format");
  }
};

// ======== Verify Tatum Secret (9) ========
const verifyTatum = (req) => {
  const secret = process.env.TATUM_WEBHOOK_SECRET;
  const header = req.headers["x-tatum-webhook-secret"];

  if (!secret || !header || header !== secret) {
    throw new ApiError(401, "Invalid Tatum webhook");
  }
};

// ======== Create Webhook Event (10) ========
const createWebhookEvent = async ({
  provider,
  eventType = null,
  eventId = null,
  txId = null,
  externalId = null,
  payload,
}) => {
  try {
    const event = await WebhookEvent.create({
      provider,
      eventType,
      eventId,
      txId,
      externalId,
      payload,
      receivedAt: new Date(),
      processingStatus: "RECEIVED",
    });

    return { event, isDuplicate: false };
  } catch (error) {
    if (error?.code !== 11000 || !eventId) {
      throw error;
    }

    const existing = await WebhookEvent.findOne({ provider, eventId });
    return { event: existing, isDuplicate: true };
  }
};

// ======== Start Webhook Processing (11) ========
const startWebhookProcessing = async (eventId) =>
  WebhookEvent.findOneAndUpdate(
    {
      _id: eventId,
      processingStatus: { $in: ["RECEIVED", "FAILED"] },
    },
    {
      $set: {
        processingStatus: "PROCESSING",
        startedAt: new Date(),
        error: null,
      },
    },
    { new: true }
  );

// ======== Finalize Webhook Event (12) ========
const finalizeWebhookEvent = async (eventId, update = {}) => {
  await WebhookEvent.updateOne(
    { _id: eventId },
    {
      $set: {
        ...update,
      },
    }
  );
};

// ======== Mark Webhook Success (13) ========
const markWebhookSuccess = async (eventId, status = "SUCCESS", extra = {}) => {
  await finalizeWebhookEvent(eventId, {
    ...extra,
    processed: true,
    processingStatus: status,
    processedAt: new Date(),
    finishedAt: new Date(),
    error: status === "SUCCESS" ? null : extra.error || null,
  });
};

// ======== Mark Webhook Failure (14) ========
const markWebhookFailure = async (eventId, error) => {
  await WebhookEvent.updateOne(
    { _id: eventId },
    {
      $set: {
        error: error?.message || "Webhook processing failed",
        processingStatus: "FAILED",
        finishedAt: new Date(),
      },
      $inc: {
        retryCount: 1,
      },
    }
  );
};

// ======== Increment Transaction Retry (15) ========
const incrementTransactionRetry = async (filter, errorMessage) => {
  const tx = await Transaction.findOne(filter).sort({ createdAt: 1 });
  if (!tx || tx.processed) {
    return;
  }

  tx.retryCount += 1;
  tx.lastError = errorMessage;
  tx.lockedAt = null;

  if (tx.retryCount >= MAX_WEBHOOK_RETRIES) {
    tx.status = "FAILED";
    tx.processed = true;
    tx.processedAt = new Date();
  } else if (tx.status === "LOCKED") {
    tx.status = "PROCESSING";
  }

  await tx.save();
};

// ======== Ensure Wallet Accounting Fields (16) ========
const ensureWalletAccountingFields = async (walletOrId, session = null) => {
  const wallet =
    typeof walletOrId === "object" && walletOrId?._id
      ? walletOrId
      : await Wallet.findById(walletOrId).session(session);

  if (!wallet) {
    throw new ApiError(404, "Wallet not found");
  }

  const update = {};

  if (!Number.isSafeInteger(wallet.balanceSun)) {
    update.balanceSun = trxToSun(wallet.balance || 0, "Wallet balance");
  }

  if (!Number.isSafeInteger(wallet.lockedBalanceSun)) {
    update.lockedBalanceSun = trxToSun(
      wallet.lockedBalance || 0,
      "Locked wallet balance"
    );
  }

  if (Object.keys(update).length === 0) {
    return wallet;
  }

  return Wallet.findByIdAndUpdate(wallet._id, { $set: update }, { new: true, session });
};

// ======== Get Transaction Amount In SUN (17) ========
const getTransactionAmountSun = (transaction) => {
  if (Number.isSafeInteger(transaction?.amountSun)) {
    return transaction.amountSun;
  }

  return trxToSun(transaction?.amount || 0, "Transaction amount");
};

// ======== Lock Transaction (18) ========
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
      new: true,
      sort: { createdAt: 1 },
      session,
    }
  );

// ======== Create Sweep Placeholder (19) ========
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
        currency: "TRX",
        fromAddress: wallet.address,
        toAddress: adminWallet.address,
        externalId: `SWEEP:${sourceTxId}`,
        status: "PENDING",
        processed: false,
      },
    ],
    { session }
  );

  return sweepTx._id;
};

// ======== Transak Webhook Handler (20) ========
export const transakWebhook = AsyncHandler(async (req, res) => {
  verifyTransakSignature(req);

  const { eventType, data } = getPayload(req.body);
  const orderId = data?.partnerOrderId || data?.orderId || null;
  const providerTxId = parseProviderTxId(data);
  const eventId = parseWebhookEventId("TRANSAK", req, data);

  const { event: webhookEvent, isDuplicate } = await createWebhookEvent({
    provider: "TRANSAK",
    eventType,
    eventId,
    txId: providerTxId,
    externalId: orderId,
    payload: req.body,
  });

  if (isDuplicate && webhookEvent?.processed) {
    return res.json(new ApiResponse(200, { orderId }, "Webhook already processed"));
  }

  const processingEvent = await startWebhookProcessing(webhookEvent._id);
  if (!processingEvent) {
    return res.json(new ApiResponse(200, { orderId }, "Webhook already processing"));
  }

  if (!orderId) {
    const error = new ApiError(400, "Missing orderId");
    await markWebhookFailure(webhookEvent._id, error);
    throw error;
  }

  try {
    if (
      !TRANSAK_SUCCESS_EVENTS.has(eventType) &&
      !TRANSAK_FAILED_EVENTS.has(eventType)
    ) {
      await Transaction.updateOne(
        { externalId: orderId },
        {
          $set: {
            metadata: data,
            provider: "TRANSAK",
            currency: parseCurrency(data),
            txId: providerTxId || undefined,
          },
        }
      );

      await markWebhookSuccess(webhookEvent._id, "IGNORED", {
        error: `Ignored event type: ${eventType || "UNKNOWN"}`,
      });

      return res.json(new ApiResponse(200, { orderId }, "Ignored"));
    }

    let responseMessage = "Ignored";

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const existingTx = await Transaction.findOne({ externalId: orderId }).session(
          session
        );

        if (!existingTx) {
          throw new ApiError(404, "Transaction not found");
        }

        if (existingTx.processed) {
          responseMessage = "Already processed";
          return;
        }

        const lockedTx = await lockTransaction({
          filter: {
            _id: existingTx._id,
            externalId: orderId,
          },
          session,
        });

        if (!lockedTx) {
          responseMessage = "Already processed";
          return;
        }

        if (lockedTx.processed) {
          responseMessage = "Already processed";
          return;
        }

        const commonUpdate = {
          metadata: data,
          provider: "TRANSAK",
          currency: parseCurrency(data),
          txId: providerTxId || lockedTx.txId,
          lockedAt: null,
          lastError: null,
        };

        if (TRANSAK_SUCCESS_EVENTS.has(eventType)) {
          if (lockedTx.type === "DEPOSIT") {
            const amountSun = getAmountSun(data);

            await Transaction.updateOne(
              { _id: lockedTx._id, processed: false, status: "LOCKED" },
              {
                $set: {
                  ...commonUpdate,
                  ...buildAmountFieldsFromSun(
                    amountSun > 0
                      ? amountSun
                      : getTransactionAmountSun(lockedTx)
                  ),
                  status: "PROCESSING",
                },
              },
              { session }
            );

            responseMessage =
              "Deposit order confirmed, waiting for blockchain deposit";
            return;
          }

          await Transaction.updateOne(
            { _id: lockedTx._id, processed: false, status: "LOCKED" },
            {
              $set: {
                ...commonUpdate,
                status: "SUCCESS",
                processed: true,
                processedAt: new Date(),
                completedAt: new Date(),
              },
            },
            { session }
          );

          responseMessage = "Withdrawal completed";
          return;
        }

        if (lockedTx.type === "WITHDRAW" && lockedTx.userId) {
          const wallet = await ensureWalletAccountingFields(
            await Wallet.findOne({ user: lockedTx.userId }).session(session),
            session
          );

          await Wallet.updateOne(
            { _id: wallet._id },
            { $inc: buildBalanceIncrementFromSun(getTransactionAmountSun(lockedTx)) },
            { session }
          );
        }

        await Transaction.updateOne(
          { _id: lockedTx._id, processed: false, status: "LOCKED" },
          {
            $set: {
              ...commonUpdate,
              status: "FAILED",
              processed: true,
              processedAt: new Date(),
              lastError: `Provider status: ${eventType}`,
            },
          },
          { session }
        );

        responseMessage = "Transaction failed";
      });
    } finally {
      await session.endSession();
    }

    await markWebhookSuccess(webhookEvent._id);
    return res.json(new ApiResponse(200, { orderId }, responseMessage));
  } catch (error) {
    if (isRetryableWriteConflict(error)) {
      await finalizeWebhookEvent(webhookEvent._id, {
        error: "Duplicate or concurrent Transak delivery detected",
        processingStatus: "IGNORED",
        finishedAt: new Date(),
      });
      return res.json(new ApiResponse(200, { orderId }, "Already processing"));
    }

    await markWebhookFailure(webhookEvent._id, error);
    await incrementTransactionRetry(
      { externalId: orderId },
      error?.message || "Transak webhook failed"
    );
    throw error;
  }
});

// ======== Tron Deposit Webhook Handler (21) ========
export const tronWebhook = AsyncHandler(async (req, res) => {
  verifyTatum(req);

  const txId = req.body?.txId || req.body?.transactionHash || null;
  const providerExternalId = req.body?.externalId || null;
  const address = req.body?.address || req.body?.to || req.body?.recipient || null;
  const rawAmount = req.body?.amount;
  const confirmations = Number(
    req.body?.confirmations ?? req.body?.confirmationCount ?? 0
  );
  const eventId = parseWebhookEventId("TATUM", req);

  const { event: webhookEvent, isDuplicate } = await createWebhookEvent({
    provider: "TATUM",
    eventType: "TRON_DEPOSIT",
    eventId,
    txId,
    externalId: providerExternalId,
    payload: req.body,
  });

  if (isDuplicate && webhookEvent?.processed) {
    return res.json(new ApiResponse(200, { txId }, "Webhook already processed"));
  }

  const processingEvent = await startWebhookProcessing(webhookEvent._id);
  if (!processingEvent) {
    return res.json(new ApiResponse(200, { txId }, "Webhook already processing"));
  }

  let amountSun;
  try {
    amountSun = trxToSun(rawAmount, "Deposit amount");
  } catch (error) {
    await markWebhookFailure(webhookEvent._id, error);
    throw error;
  }

  if (!txId || !address || amountSun <= 0) {
    const error = new ApiError(
      400,
      "Invalid payload: txId, address, and amount are required"
    );
    await markWebhookFailure(webhookEvent._id, error);
    throw error;
  }

  if (confirmations < MIN_TRON_CONFIRMATIONS) {
    await markWebhookSuccess(webhookEvent._id, "IGNORED", {
      error: `Waiting for confirmations: ${confirmations}/${MIN_TRON_CONFIRMATIONS}`,
    });

    return res.json(
      new ApiResponse(200, { txId, confirmations }, "Waiting for confirmations")
    );
  }

  const existingProcessedTx = await Transaction.findOne({
    type: "DEPOSIT",
    txId,
    processed: true,
    status: "SUCCESS",
  });

  if (existingProcessedTx) {
    await markWebhookSuccess(webhookEvent._id);
    return res.json(new ApiResponse(200, { txId }, "Already processed"));
  }

  let sweepTxId = null;
  let responseMessage = "Deposit processed";

  try {
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
            txId,
          }).session(session);
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
                provider: "TATUM",
                currency: "TRX",
                txId,
                toAddress: address,
                status: "PROCESSING",
                processed: false,
                metadata: req.body,
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
          txId,
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
            ...(providerExternalId ? { externalId: providerExternalId } : { txId }),
          },
          session,
        });

        if (!lockedTx) {
          responseMessage = "Already processed";
          return;
        }

        if (lockedTx.processed) {
          responseMessage = "Already processed";
          return;
        }

        if (lockedTx.txId && lockedTx.txId !== txId) {
          throw new ApiError(409, "Deposit txId mismatch for externalId");
        }

        if (lockedTx.toAddress && lockedTx.toAddress !== address) {
          throw new ApiError(409, "Deposit address mismatch for externalId");
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
              provider: "TATUM",
              currency: "TRX",
              txId,
              externalId: providerExternalId,
              toAddress: lockedTx.toAddress || address,
              status: "SUCCESS",
              processed: true,
              processedAt: new Date(),
              confirmedAt: new Date(),
              completedAt: new Date(),
              lockedAt: null,
              lastError: null,
              metadata: req.body,
            },
          },
          { session }
        );

        // The deposit is finalized first. Sweep creation is recorded separately
        // so a sweep failure never reverses or hides a real user deposit.
        sweepTxId = await createSweepPlaceholder({
          session,
          wallet,
          amountSun,
          sourceTxId: txId,
        });
      });
    } finally {
      await session.endSession();
    }

    await markWebhookSuccess(webhookEvent._id);

    if (sweepTxId) {
      executePendingSweep(sweepTxId).catch((error) => {
        console.error("Sweep execution failed:", error.message);
      });
    }

    return res.json(
      new ApiResponse(
        200,
        { txId, externalId: providerExternalId, sweepScheduled: Boolean(sweepTxId) },
        responseMessage
      )
    );
  } catch (error) {
    if (isRetryableWriteConflict(error)) {
      await finalizeWebhookEvent(webhookEvent._id, {
        error: "Duplicate or concurrent Tatum delivery detected",
        processingStatus: "IGNORED",
        finishedAt: new Date(),
      });
      return res.json(new ApiResponse(200, { txId }, "Already processing"));
    }

    await markWebhookFailure(webhookEvent._id, error);
    await incrementTransactionRetry(
      providerExternalId
        ? { type: "DEPOSIT", externalId: providerExternalId }
        : { type: "DEPOSIT", txId },
      error?.message || "Tatum deposit webhook failed"
    );
    throw error;
  }
});

// ======== Tron Withdraw Webhook Handler (22) ========
export const tronWithdrawWebhook = AsyncHandler(async (req, res) => {
  verifyTatum(req);

  const txId = req.body?.txId || req.body?.transactionHash || null;
  const eventId = parseWebhookEventId("TATUM", req);

  const { event: webhookEvent, isDuplicate } = await createWebhookEvent({
    provider: "TATUM",
    eventType: "TRON_WITHDRAW",
    eventId,
    txId,
    payload: req.body,
  });

  if (isDuplicate && webhookEvent?.processed) {
    return res.json(new ApiResponse(200, { txId }, "Webhook already processed"));
  }

  const processingEvent = await startWebhookProcessing(webhookEvent._id);
  if (!processingEvent) {
    return res.json(new ApiResponse(200, { txId }, "Webhook already processing"));
  }

  if (!txId) {
    const error = new ApiError(400, "Missing txId");
    await markWebhookFailure(webhookEvent._id, error);
    throw error;
  }

  try {
    const session = await mongoose.startSession();
    let responseMessage = "Withdrawal confirmed on-chain";

    try {
      await session.withTransaction(async () => {
        const tx = await Transaction.findOne({ txId, type: "WITHDRAW" }).session(session);

        if (!tx) {
          responseMessage = "Transaction not found";
          return;
        }

        if (tx.processed) {
          responseMessage = "Already processed";
          return;
        }

        const lockedTx = await lockTransaction({
          filter: {
            _id: tx._id,
            txId,
            type: "WITHDRAW",
          },
          session,
        });

        if (!lockedTx) {
          responseMessage = "Already processed";
          return;
        }

        if (lockedTx.processed) {
          responseMessage = "Already processed";
          return;
        }

        await Transaction.updateOne(
          { _id: lockedTx._id, processed: false, status: "LOCKED" },
          {
            $set: {
              status: "SUCCESS",
              processed: true,
              processedAt: new Date(),
              confirmedAt: new Date(),
              completedAt: new Date(),
              lockedAt: null,
              lastError: null,
            },
          },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    await markWebhookSuccess(webhookEvent._id);

    return res.json(new ApiResponse(200, { txId }, responseMessage));
  } catch (error) {
    if (isRetryableWriteConflict(error)) {
      await finalizeWebhookEvent(webhookEvent._id, {
        error: "Duplicate or concurrent withdraw delivery detected",
        processingStatus: "IGNORED",
        finishedAt: new Date(),
      });
      return res.json(new ApiResponse(200, { txId }, "Already processing"));
    }

    await markWebhookFailure(webhookEvent._id, error);
    await incrementTransactionRetry(
      { type: "WITHDRAW", txId },
      error?.message || "Tatum withdraw webhook failed"
    );
    throw error;
  }
});
