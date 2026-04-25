import crypto from "crypto";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { WebhookEvent } from "../../model/webhookEvent.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { executePendingSweep } from "./ramp.controller.js";
import { getVerifiedTransakWebhookPayload } from "./transak.controller.js";
import {
  buildAmountFieldsFromSun,
  buildBalanceIncrementFromSun,
  trxToSun,
} from "../../util/trxAmount.util.js";
import {
  ensureWalletAccountingFields,
} from "../../service/payment/walletAccounting.service.js";
import {
  getTransactionAmountSun,
  processConfirmedDeposit,
  validateTatumDepositPayload,
} from "../../service/payment/deposit.service.js";
import { logger } from "../../util/logger.util.js";
import { verifyTatumHMAC } from "../../middleware/rawBody.middleware.js";

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
  "CANCELED",
]);

const compactObject = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  );

const normalizeStatus = (value) => String(value || "").trim().toUpperCase();

const isRetryableWriteConflict = (error) =>
  /write conflict|transienttransactionerror|unknowntransactioncommitresult|duplicate key/i.test(
    error?.message || ""
  );

const parseCurrency = (data = {}) =>
  data.cryptoCurrencyCode ||
  data.crypto_currency_code ||
  data.cryptoCurrency ||
  data.crypto_currency ||
  data.cryptoTicker ||
  data.crypto_ticker ||
  "TRX";

const parseTransakProduct = (data = {}) =>
  String(data.isBuyOrSell || data.product || "").trim().toUpperCase();

const parseProviderTxId = (data = {}) =>
  data.transactionHash ||
  data.transaction_hash ||
  data.cryptoTransactionHash ||
  data.crypto_transaction_hash ||
  data.txId ||
  data.tx_id ||
  null;

const parsePartnerOrderId = (data = {}) =>
  data.partnerOrderId || data.partner_order_id || null;

const parseTransakOrderId = (data = {}) =>
  data.orderId ||
  data.orderID ||
  data.order_id ||
  data.id ||
  data.cardPaymentData?.orderId ||
  null;

const buildTransakMetadata = (data = {}) =>
  compactObject({
    provider: "TRANSAK",
    orderId: parseTransakOrderId(data),
    partnerOrderId: parsePartnerOrderId(data),
    status: data.status,
    product: data.isBuyOrSell,
    network: data.network,
    walletAddress: data.walletAddress,
    fiatCurrency: data.fiatCurrency,
    fiatAmount: data.fiatAmount,
    amountPaid: data.amountPaid,
    cryptoCurrency: parseCurrency(data),
    cryptoAmount: data.cryptoAmount || data.crypto_amount,
    totalFeeInFiat: data.totalFeeInFiat,
    countryCode: data.countryCode,
    paymentOptionId: data.paymentOptionId,
    quoteId: data.quoteId,
    transactionHash: parseProviderTxId(data),
    transactionLink: data.transactionLink,
    completedAt: data.completedAt,
    updatedAt: data.updatedAt,
  });

const buildTatumMetadata = (body = {}) =>
  compactObject({
    provider: "TATUM",
    subscriptionId:
      body.subscriptionId ||
      body.subscriptionID ||
      body.subscription?.id ||
      null,
    subscriptionType: body.subscriptionType,
    chain: body.chain,
    network: body.network,
    asset: body.asset || body.currency,
    txId: body.txId || body.tx_id || body.transactionHash || body.transaction_hash,
    address: body.address || body.to || body.recipient || body.walletAddress,
    counterAddress: body.counterAddress,
    amount: body.amount,
    confirmations: body.confirmations ?? body.confirmationCount,
    blockNumber: body.blockNumber,
    timestamp: body.timestamp,
  });

const buildTransakTransactionFilter = ({ partnerOrderId, transakOrderId }) => {
  const filters = [];

  if (partnerOrderId) {
    filters.push({ externalId: partnerOrderId });
  }

  if (transakOrderId) {
    filters.push(
      { externalId: transakOrderId },
      { providerOrderId: transakOrderId }
    );
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return { $or: filters };
};

// ======== Normalize Webhook Payload (5) ========
const getPayload = (body = {}) => {
  if (body?.eventType && body?.data && !Array.isArray(body.data)) {
    return { eventType: normalizeStatus(body.eventType), data: body.data };
  }

  const firstDataItem = Array.isArray(body?.data) ? body.data[0] : null;
  const webhookData = firstDataItem?.webhookData || body?.webhookData || {};
  const eventType =
    body?.meta?.eventID ||
    body?.meta?.eventId ||
    firstDataItem?.eventID ||
    firstDataItem?.eventId ||
    webhookData?.eventID ||
    webhookData?.eventId ||
    webhookData?.status ||
    body?.eventID ||
    body?.eventId ||
    body?.status ||
    null;

  return {
    eventType: normalizeStatus(eventType),
    data: {
      ...webhookData,
      partnerOrderId:
        webhookData?.partnerOrderId ||
        webhookData?.partner_order_id ||
        firstDataItem?.partnerOrderId ||
        firstDataItem?.partner_order_id ||
        body?.partnerOrderId ||
        body?.partner_order_id,
      orderId:
        webhookData?.orderId ||
        webhookData?.orderID ||
        webhookData?.order_id ||
        webhookData?.id ||
        body?.meta?.orderID ||
        body?.meta?.orderId ||
        body?.meta?.order_id,
      providerWebhookId: firstDataItem?.id || body?.id || body?.webhookId,
    },
  };
};

// ======== Get Amount In SUN (6) ========
const getAmountSun = (data = {}) => {
  const rawAmount =
    data.cryptoAmount ||
    data.crypto_amount ||
    data.cryptoCurrencyAmount ||
    data.crypto_currency_amount ||
    data.totalAmount ||
    data.total_amount ||
    data.amount ||
    0;

  return trxToSun(rawAmount, "Webhook amount");
};

const validateTransakWebhookPayload = ({ eventType, data = {} }) => {
  const normalizedEventType = normalizeStatus(eventType);

  if (!normalizedEventType) {
    throw new ApiError(400, "Missing Transak event type");
  }

  if (!parsePartnerOrderId(data) && !parseTransakOrderId(data)) {
    throw new ApiError(400, "Missing Transak order identifier");
  }
};

// ======== Parse Webhook Event Id (7) ========
const parseWebhookEventId = (provider, req, data = {}) => {
  if (provider === "TRANSAK") {
    const metaOrderId =
      req.body?.meta?.orderID ||
      req.body?.meta?.orderId ||
      req.body?.meta?.order_id;
    const metaEventId = req.body?.meta?.eventID || req.body?.meta?.eventId;

    return (
      req.headers["x-transak-event-id"] ||
      data.eventId ||
      data.eventID ||
      data.webhookId ||
      data.providerWebhookId ||
      req.body?.eventId ||
      req.body?.eventID ||
      (metaOrderId && metaEventId ? `${metaOrderId}:${metaEventId}` : null) ||
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
  throw new ApiError(
    410,
    "Legacy Transak HMAC verification is disabled. Use JWT webhook verification instead."
  );

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
    if (error instanceof ApiError) {
      throw error;
    }

    // Handles invalid hex / buffer issues
    throw new ApiError(401, "Invalid Transak signature format");
  }
};

// ======== Verify Tatum Secret (9) ==========================================================================
const verifyTatum = (req) => {
  const hmacSecret = process.env.TATUM_WEBHOOK_HMAC_SECRET;

  if (!hmacSecret) {
    throw new ApiError(500, "TATUM_WEBHOOK_HMAC_SECRET is not configured");
  }

  if (!req.headers["x-payload-hash"]) {
    throw new ApiError(401, "Missing Tatum webhook HMAC header");
  }

  if (verifyTatumHMAC(req, hmacSecret)) {
    return;
  }

  throw new ApiError(401, "Invalid Tatum webhook HMAC");
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
    { returnDocument: "after" }
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
      returnDocument: "after",
      sort: { createdAt: 1 },
      session,
    }
  );

// ======== Transak Webhook Handler (20) ========
export const transakWebhook = AsyncHandler(async (req, res) => {
  const {
    eventType,
    data,
    decodedPayload,
    verificationMethod,
  } = await getVerifiedTransakWebhookPayload(req);
  validateTransakWebhookPayload({ eventType, data });
  const partnerOrderId = parsePartnerOrderId(data);
  const transakOrderId = parseTransakOrderId(data);
  const orderId = partnerOrderId || transakOrderId;
  const providerTxId = parseProviderTxId(data);
  const eventId =
    req.headers["x-transak-event-id"] ||
    decodedPayload?.eventId ||
    decodedPayload?.eventID ||
    data?.eventId ||
    data?.eventID ||
    req.body?.eventId ||
    req.body?.eventID ||
    (orderId && eventType ? `${orderId}:${eventType}` : null);

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

  logger.info("webhook.transak.received", {
    eventType,
    orderId,
    providerTxId,
    verificationMethod,
  });

  const processingEvent = await startWebhookProcessing(webhookEvent._id);
  if (!processingEvent) {
    return res.json(new ApiResponse(200, { orderId }, "Webhook already processing"));
  }

  if (!orderId) {
    const error = new ApiError(400, "Missing orderId");
    await markWebhookFailure(webhookEvent._id, error);
    throw error;
  }

  const transactionFilter = buildTransakTransactionFilter({
    partnerOrderId,
    transakOrderId,
  });
  const product = parseTransakProduct(data);

  try {
    if (
      !TRANSAK_SUCCESS_EVENTS.has(eventType) &&
      !TRANSAK_FAILED_EVENTS.has(eventType)
    ) {
      await Transaction.updateOne(
        transactionFilter,
        {
          $set: {
            metadata: buildTransakMetadata(data),
            provider: "TRANSAK",
            currency: parseCurrency(data),
            txId: providerTxId || undefined,
            ...(transakOrderId ? { providerOrderId: transakOrderId } : {}),
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
        let existingTx = await Transaction.findOne(transactionFilter)
          .sort({ createdAt: 1 })
          .session(session);

        if (!existingTx && data?.walletAddress) {
          existingTx = await Transaction.findOne({
            type: TRANSAK_SUCCESS_EVENTS.has(eventType)
              ? "DEPOSIT"
              : { $in: ["DEPOSIT", "WITHDRAW"] },
            provider: "TRANSAK",
            toAddress: data.walletAddress,
            processed: false,
            status: { $in: ["PENDING", "PROCESSING"] },
          })
            .sort({ createdAt: 1 })
            .session(session);
        }

        if (!existingTx) {
          if (product === "SELL") {
            responseMessage = "Off-ramp webhook recorded";
            return;
          }

          throw new ApiError(404, "Transaction not found");
        }

        if (existingTx.processed) {
          responseMessage = "Already processed";
          return;
        }

        const lockedTx = await lockTransaction({
          filter: {
            _id: existingTx._id,
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
          metadata: buildTransakMetadata(data),
          provider: "TRANSAK",
          currency: parseCurrency(data),
          txId: providerTxId || lockedTx.txId,
          lockedAt: null,
          lastError: null,
          ...(transakOrderId || lockedTx.providerOrderId
            ? { providerOrderId: transakOrderId || lockedTx.providerOrderId }
            : {}),
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
      transactionFilter,
      error?.message || "Transak webhook failed"
    );
    throw error;
  }
});

const parseTatumTxId = (body = {}) =>
  body.txId || body.tx_id || body.transactionHash || body.transaction_hash || null;

const parseTatumAddress = (body = {}) =>
  body.address ||
  body.to ||
  body.recipient ||
  body.walletAddress ||
  body.wallet_address ||
  null;

const parseTatumIncomingFlag = (body = {}) => {
  if (typeof body.incoming === "boolean") {
    return body.incoming;
  }

  if (typeof body.incoming === "string") {
    const normalized = body.incoming.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  const subscriptionType = String(body.subscriptionType || "").trim().toUpperCase();

  if (subscriptionType.startsWith("INCOMING_")) {
    return true;
  }

  if (subscriptionType.startsWith("OUTGOING_")) {
    return false;
  }

  return null;
};

const resolveTatumWebhookDirection = async (body = {}) => {
  const incoming = parseTatumIncomingFlag(body);
  if (incoming !== null) {
    return incoming ? "DEPOSIT" : "WITHDRAW";
  }

  const txId = parseTatumTxId(body);
  if (txId) {
    const matchingWithdrawal = await Transaction.findOne({
      txId,
      type: "WITHDRAW",
    })
      .select({ _id: 1 })
      .lean();

    if (matchingWithdrawal) {
      return "WITHDRAW";
    }
  }

  return "DEPOSIT";
};

// ======== Handle Tatum Deposit Webhook (21) ========
const handleTatumDepositWebhook = async (req, res) => {
  verifyTatum(req);
  validateTatumDepositPayload(req.body);

  const txId = parseTatumTxId(req.body);
  const providerExternalId =
    req.body?.externalId ||
    req.body?.external_id ||
    req.body?.partnerOrderId ||
    req.body?.partner_order_id ||
    null;
  const address = parseTatumAddress(req.body);
  const rawAmount = req.body?.amount;
  const confirmations = Number(
    req.body?.confirmations ?? req.body?.confirmationCount ?? 0
  );
  const currency = String(
    req.body?.asset || req.body?.currency || "TRX"
  ).toUpperCase();
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

  logger.info("webhook.tatum.deposit.received", {
    txId,
    address,
    confirmations,
  });

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

  try {
    const result = await processConfirmedDeposit({
      provider: "TATUM",
      txHash: txId,
      address,
      amountSun,
      providerExternalId,
      currency,
      payload: buildTatumMetadata(req.body),
      source: "WEBHOOK",
    });

    await markWebhookSuccess(webhookEvent._id);

    if (result.sweepTxId) {
      executePendingSweep(result.sweepTxId).catch((error) => {
        console.error("Sweep execution failed:", error.message);
      });
    }

    logger.info("webhook.tatum.deposit.accepted", {
      txId,
      address,
      amountSun,
      responseMessage: result.responseMessage,
    });

    return res.json(
      new ApiResponse(
        200,
        {
          txId,
          externalId: providerExternalId,
          sweepScheduled: Boolean(result.sweepTxId),
        },
        result.responseMessage
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
};

// ======== Handle Tatum Withdraw Webhook (22) ========
const handleTatumWithdrawWebhook = async (req, res) => {
  verifyTatum(req);

  const txId = parseTatumTxId(req.body);
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
};

// ======== Tron Address Webhook Handler (23) ========
export const tronWebhook = AsyncHandler(async (req, res) => {
  // -------------------------------------------------------------------------------
  req.body = {
    "currency": "TRON",
    "address": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
    "blockNumber": 739301,
    "counterAddress": "TABC123xyz",
    "txId": "27c8f9a1b2c3d4e5f6789012345678901234567890a3ctef",
    "chain": "TRON",
    "subscriptionType": "INCOMING_NATIVE_TX",
    "amount": "10.5"
  }
  console.log("📩 Tatum webhook received:", req.body);
  const txId = parseTatumTxId(req.body);
  const address = parseTatumAddress(req.body);
  const direction = await resolveTatumWebhookDirection(req.body);

  logger.info("webhook.tatum.address.received", {
    txId,
    address,
    incoming: parseTatumIncomingFlag(req.body),
    subscriptionType: req.body?.subscriptionType || null,
    direction,
  });

  if (direction === "WITHDRAW") {
    return handleTatumWithdrawWebhook(req, res);
  }

  return handleTatumDepositWebhook(req, res);
});
