import crypto from "crypto";
import mongoose from "mongoose";
import { Wallet } from "../../model/wallet.model.js";
import { Transaction } from "../../model/transaction.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { executePendingSweep } from "./ramp.controller.js";
import { getVerifiedTransakWebhookPayload } from "./transak.controller.js";
import {
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
import {
  parseBufferedJsonBody,
  verifyTatumHMAC,
} from "../../middleware/rawBody.middleware.js";

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
    Object.entries(value).filter(
      ([, fieldValue]) =>
        fieldValue !== undefined &&
        fieldValue !== null &&
        fieldValue !== ""
    )
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
    partnerOrderId: parsePartnerOrderId(data),
    orderId: parseTransakOrderId(data),
    flow:
      data.flow ||
      data.transactionType ||
      data.productType ||
      data.isBuyOrSell ||
      "On-ramp",
    walletAddress: data.walletAddress,
    cryptoCurrency: parseCurrency(data),
    fiatAmount: data.fiatAmount,
    fiatCurrency: data.fiatCurrency,
    countryCode: data.countryCode,
    paymentMethod:
      data.paymentMethod ||
      data.payment_method ||
      data.paymentOption ||
      null,
    bankAccount:
      data.bankAccount ||
      data.bank_account ||
      data.maskedBankAccount ||
      null,
    completedAt: data.completedAt || null,
    status: data.status || null,
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
    fromAddress:
      body.fromAddress ||
      body.from ||
      body.sender ||
      body.counterAddress ||
      null,
    toAddress:
      body.toAddress ||
      body.to ||
      body.recipient ||
      body.address ||
      null,
    fee: body.fee,
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

const validateTransakWebhookPayload = ({ eventType, data = {} }) => {
  const normalizedEventType = normalizeStatus(eventType);

  if (!normalizedEventType) {
    throw new ApiError(400, "Missing Transak event type");
  }

  if (!parsePartnerOrderId(data) && !parseTransakOrderId(data)) {
    throw new ApiError(400, "Missing Transak order identifier");
  }
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
  return;
  const hmacSecret = process.env.TATUM_WEBHOOK_HMAC_SECRET;
  if (!hmacSecret) {
    throw new ApiError(500, "TATUM_WEBHOOK_HMAC_SECRET is not configured");
  }

  if (!req.headers["x-payload-hash"]) {
    throw new ApiError(401, "Missing Tatum webhook HMAC header");
  }

  if (verifyTatumHMAC(req, hmacSecret)) {
    parseBufferedJsonBody(req);
    return;
  }

  throw new ApiError(401, "Invalid Tatum webhook HMAC");
};

export const createTatumWebhookHmac = async (req, res) => {
  const hmacSecret = String(process.env.TATUM_WEBHOOK_HMAC_SECRET || "").trim();

  if (!hmacSecret) {
    throw new ApiError(500, "TATUM_WEBHOOK_HMAC_SECRET is not configured");
  }

  const rawPayload =
    typeof req.body?.rawPayload === "string"
      ? req.body.rawPayload
      : JSON.stringify(
        req.body?.payload && typeof req.body.payload === "object"
          ? req.body.payload
          : req.body || {}
      );
  const xPayloadHash = crypto
    .createHmac("sha512", hmacSecret)
    .update(rawPayload, "utf8")
    .digest("base64");

  return res.json({
    verification: "TATUM_HMAC_SHA512",
    rawPayload,
    xPayloadHash,
    headers: {
      "x-payload-hash": xPayloadHash,
      "Content-Type": "application/json",
    },
    curl: `curl -X POST "BASE_URL/api/v1/webhook/tatum/address" -H "Content-Type: application/json" -H "x-payload-hash: ${xPayloadHash}" --data-raw ${JSON.stringify(
      rawPayload
    )}`,
  });
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
    verificationMethod,
  } = await getVerifiedTransakWebhookPayload(req);
  validateTransakWebhookPayload({ eventType, data });
  const partnerOrderId = parsePartnerOrderId(data);
  const transakOrderId = parseTransakOrderId(data);
  const orderId = partnerOrderId || transakOrderId;
  const providerTxId = parseProviderTxId(data);

  logger.info("webhook.transak.received", {
    eventType,
    orderId,
    providerTxId,
    verificationMethod,
  });

  if (!orderId) {
    throw new ApiError(400, "Missing orderId");
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
      const existingTx = await Transaction.findOne(transactionFilter)
        .sort({ createdAt: 1 });

      await Transaction.updateOne(
        transactionFilter,
        {
          $set: {
            provider: "TRANSAK",
            ...(transakOrderId ? { providerOrderId: transakOrderId } : {}),
            ...(existingTx?.type === "WITHDRAW"
              ? {
                  "metadata.transak": buildTransakMetadata(data),
                  currency: parseCurrency(data),
                }
              : {}),
          },
        }
      );

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

        if (
          existingTx.type === "WITHDRAW" &&
          TRANSAK_SUCCESS_EVENTS.has(eventType) &&
          existingTx.status === "SUCCESS"
        ) {
          await Transaction.updateOne(
            { _id: existingTx._id, type: "WITHDRAW", status: "SUCCESS" },
            {
              $set: {
                provider: "TRANSAK",
                ...(transakOrderId || existingTx.providerOrderId
                  ? {
                      providerOrderId:
                        transakOrderId || existingTx.providerOrderId,
                    }
                  : {}),
                metadata: {
                  ...(existingTx.metadata &&
                  typeof existingTx.metadata === "object"
                    ? existingTx.metadata
                    : {}),
                  transak: buildTransakMetadata(data),
                },
                status: "COMPLETED",
                completedAt: new Date(),
                lastError: null,
              },
            },
            { session }
          );

          responseMessage = "Withdrawal completed";
          return;
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
          provider: "TRANSAK",
          lockedAt: null,
          lastError: null,
          ...(transakOrderId || lockedTx.providerOrderId
            ? { providerOrderId: transakOrderId || lockedTx.providerOrderId }
            : {}),
        };

        if (TRANSAK_SUCCESS_EVENTS.has(eventType)) {
          if (lockedTx.type === "DEPOSIT") {
            await Transaction.updateOne(
              { _id: lockedTx._id, processed: false, status: "LOCKED" },
              {
                $set: {
                  ...commonUpdate,
                  "metadata.transak": buildTransakMetadata(data),
                  status: "PENDING",
                },
              },
              { session }
            );

            responseMessage =
              "Transak order recorded, waiting for Tatum blockchain deposit";
            return;
          }

          const finalizedTransakMetadata = buildTransakMetadata(data);
          const existingMetadata =
            lockedTx.metadata && typeof lockedTx.metadata === "object"
              ? lockedTx.metadata
              : {};

          await Transaction.updateOne(
            { _id: lockedTx._id, status: { $in: ["LOCKED", "SUCCESS"] } },
            {
              $set: {
                ...commonUpdate,
                metadata: {
                  ...existingMetadata,
                  transak: finalizedTransakMetadata,
                },
                status: "COMPLETED",
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
              ...(lockedTx.type === "WITHDRAW"
                ? {
                    "metadata.transak": buildTransakMetadata(data),
                    currency: parseCurrency(data),
                  }
                : {}),
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

    return res.json(new ApiResponse(200, { orderId }, responseMessage));
  } catch (error) {
    if (isRetryableWriteConflict(error)) {
      return res.json(new ApiResponse(200, { orderId }, "Already processing"));
    }

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

  logger.info("webhook.tatum.deposit.received", {
      txId,
      address,
      confirmations,
  });

  let amountSun;
  try {
    amountSun = trxToSun(rawAmount, "Deposit amount");
  } catch (error) {
    throw error;
  }

  if (!txId || !address || amountSun <= 0) {
    throw new ApiError(
      400,
      "Invalid payload: txId, address, and amount are required"
    );
  }

  if (confirmations < MIN_TRON_CONFIRMATIONS) {
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
      return res.json(new ApiResponse(200, { txId }, "Already processing"));
    }

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
  const txId = parseTatumTxId(req.body);
  const tatumMetadata = buildTatumMetadata(req.body);
  const feeValue =
    req.body?.fee !== undefined && req.body?.fee !== null
      ? Number(req.body.fee)
      : null;

  if (!txId) {
    throw new ApiError(400, "Missing txId");
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
              lockedAt: null,
              lastError: null,
              ...(lockedTx.provider !== "TRANSAK"
                ? { completedAt: new Date() }
                : {}),
              ...(feeValue !== null && Number.isFinite(feeValue)
                ? { fee: feeValue }
                : {}),
              metadata: {
                ...(lockedTx.metadata && typeof lockedTx.metadata === "object"
                  ? lockedTx.metadata
                  : {}),
                tatum: tatumMetadata,
              },
            },
          },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    return res.json(new ApiResponse(200, { txId }, responseMessage));
  } catch (error) {
    if (isRetryableWriteConflict(error)) {
      return res.json(new ApiResponse(200, { txId }, "Already processing"));
    }

    await incrementTransactionRetry(
      { type: "WITHDRAW", txId },
      error?.message || "Tatum withdraw webhook failed"
    );
    throw error;
  }
};

// ======== Tron Address Webhook Handler (23) ========
export const tronWebhook = AsyncHandler(async (req, res) => {
  req.body = {
    "currency": "TRON",
    "address": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
    "blockNumber": 652147,
    "counterAddress": "TTransakHotWallet1234567890abcdef",
    "txId": "a1b2c3d4e5f6789012345678901234567890abcdef12",
    "chain": "tron-mainnet",
    "subscriptionType": "INCOMING_NATIVE_TX",
    "amount": "95.123456"
  }

  verifyTatum(req);
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
